/**
 * Declaration Handlers - Handle variable, function, and class declarations
 *
 * This module handles processing of declarations and patterns.
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import { Types } from '../../utils/type-factory.js';
import type { InferContext } from './context.js';
import { addBinding, lookupBinding, createEnv } from './context.js';
import { addAnnotation } from './annotations.js';
import {
  inferExpression,
  inferFunctionType,
  inferClassType,
} from './expressions.js';
import { traverseFunctionBody, traverseExpression } from './traversal.js';

/**
 * Handle variable declarations
 */
export function handleVariableDeclaration(node: t.VariableDeclaration, ctx: InferContext): void {
  const kind = node.kind === 'const' ? 'const' : node.kind === 'let' ? 'let' : 'var';

  for (const decl of node.declarations) {
    if (t.isIdentifier(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, ctx) : Types.undefined;

      // Add to environment
      ctx.env = addBinding(ctx.env, decl.id.name, initType, kind, decl);

      // Create annotation
      addAnnotation(ctx, {
        node: decl.id,
        name: decl.id.name,
        type: initType,
        kind: kind === 'const' ? 'const' : 'variable',
      });
    } else if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) {
      // Handle destructuring
      handleDestructuringPattern(decl.id, decl.init ? inferExpression(decl.init, ctx) : Types.undefined, ctx, kind);
    }
  }
}

/**
 * Handle destructuring patterns
 */
export function handleDestructuringPattern(
  pattern: t.LVal,
  sourceType: Type,
  ctx: InferContext,
  kind: 'var' | 'let' | 'const'
): void {
  if (t.isIdentifier(pattern)) {
    ctx.env = addBinding(ctx.env, pattern.name, sourceType, kind, pattern);
    addAnnotation(ctx, {
      node: pattern,
      name: pattern.name,
      type: sourceType,
      kind: kind === 'const' ? 'const' : 'variable',
    });
  } else if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isObjectProperty(prop)) {
        let propType: Type = Types.any();

        if (sourceType.kind === 'object' && t.isIdentifier(prop.key)) {
          const propInfo = sourceType.properties.get(prop.key.name);
          if (propInfo) {
            propType = propInfo.type;
          }
        }

        if (t.isIdentifier(prop.value)) {
          handleDestructuringPattern(prop.value, propType, ctx, kind);
        } else if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
          // Handle default value: { x = 10 }
          const defaultType = inferExpression(prop.value.right, ctx);
          const unionType = propType.kind === 'any' ? defaultType : Types.union([propType, defaultType]);
          handleDestructuringPattern(prop.value.left, unionType, ctx, kind);
        } else if (t.isObjectPattern(prop.value) || t.isArrayPattern(prop.value)) {
          handleDestructuringPattern(prop.value, propType, ctx, kind);
        }
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        // Rest element: { ...rest }
        handleDestructuringPattern(prop.argument, Types.object({}), ctx, kind);
      }
    }
  } else if (t.isArrayPattern(pattern)) {
    for (let i = 0; i < pattern.elements.length; i++) {
      const elem = pattern.elements[i];
      if (!elem) continue;

      let elemType: Type = Types.any();

      if (sourceType.kind === 'array') {
        if (sourceType.tuple && i < sourceType.tuple.length) {
          elemType = sourceType.tuple[i]!;
        } else {
          elemType = sourceType.elementType;
        }
      }

      if (t.isIdentifier(elem)) {
        handleDestructuringPattern(elem, elemType, ctx, kind);
      } else if (t.isRestElement(elem) && t.isIdentifier(elem.argument)) {
        // Rest element: [a, ...rest]
        if (sourceType.kind === 'array') {
          handleDestructuringPattern(elem.argument, Types.array(sourceType.elementType), ctx, kind);
        } else {
          handleDestructuringPattern(elem.argument, Types.array(Types.any()), ctx, kind);
        }
      } else if (t.isAssignmentPattern(elem) && t.isIdentifier(elem.left)) {
        const defaultType = inferExpression(elem.right, ctx);
        const unionType = elemType.kind === 'any' ? defaultType : Types.union([elemType, defaultType]);
        handleDestructuringPattern(elem.left, unionType, ctx, kind);
      }
    }
  }
}

/**
 * Handle function declarations
 */
export function handleFunctionDeclaration(node: t.FunctionDeclaration, ctx: InferContext): void {
  if (!node.id) return;

  const funcType = inferFunctionType(node, ctx);

  // Add function to environment
  ctx.env = addBinding(ctx.env, node.id.name, funcType, 'function', node);

  // Create annotation
  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: funcType,
    kind: 'function',
  });

  // Annotate parameters
  annotateParameters(node.params, funcType, ctx);

  // Traverse function body to process nested declarations
  traverseFunctionBody(node, ctx);
}

/**
 * Annotate function parameters
 */
export function annotateParameters(
  params: Array<t.Identifier | t.Pattern | t.RestElement>,
  funcType: Type,
  ctx: InferContext
): void {
  if (funcType.kind !== 'function') return;

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const paramType = funcType.params[i]?.type ?? Types.any();

    if (t.isIdentifier(param)) {
      addAnnotation(ctx, {
        node: param,
        name: param.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      addAnnotation(ctx, {
        node: param.argument,
        name: param.argument.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      addAnnotation(ctx, {
        node: param.left,
        name: param.left.name,
        type: paramType,
        kind: 'parameter',
      });
    }
  }
}

/**
 * Handle class declarations
 */
export function handleClassDeclaration(node: t.ClassDeclaration, ctx: InferContext): void {
  if (!node.id) return;

  const classType = inferClassType(node, ctx);

  ctx.env = addBinding(ctx.env, node.id.name, classType, 'class', node);

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: classType,
    kind: 'class',
  });
}

/**
 * Handle assignment expressions
 */
export function handleAssignment(node: t.AssignmentExpression, ctx: InferContext): void {
  if (t.isIdentifier(node.left)) {
    const binding = lookupBinding(ctx.env, node.left.name);
    if (binding && binding.kind === 'const') {
      ctx.errors.push({
        message: `Cannot assign to constant '${node.left.name}'`,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
        nodeType: 'AssignmentExpression',
      });
    }
  }
}
