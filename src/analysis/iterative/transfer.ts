/**
 * Transfer Functions - Compute exit state from entry state for CFG blocks
 *
 * This module implements the transfer functions for different statement types.
 */

import * as t from '@babel/types';
import type { Type, BasicBlock } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';
import { lookupBinding, updateBinding, joinTypes } from './state.js';
import { addAnnotation, annotateParameters } from './annotations.js';
import {
  inferExpression,
  inferFunctionType,
  inferClassType,
} from './expressions.js';

/**
 * Transfer function - compute exit state from entry state for a block
 */
export function transfer(
  block: BasicBlock,
  entryState: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!entryState.reachable) {
    return entryState;
  }

  let currentState = entryState;

  // Process each statement in the block
  for (const stmt of block.statements) {
    currentState = transferStatement(stmt, currentState, ctx);
  }

  return currentState;
}

/**
 * Transfer function for a single statement
 */
function transferStatement(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!state.reachable) return state;

  switch (stmt.type) {
    case 'VariableDeclaration':
      return transferVariableDeclaration(stmt, state, ctx);

    case 'FunctionDeclaration':
      return transferFunctionDeclaration(stmt, state, ctx);

    case 'ClassDeclaration':
      return transferClassDeclaration(stmt, state, ctx);

    case 'ExpressionStatement':
      return transferExpressionStatement(stmt, state, ctx);

    default:
      return state;
  }
}

/**
 * Transfer function for variable declarations
 */
function transferVariableDeclaration(
  node: t.VariableDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  let currentState = state;
  const kind = node.kind === 'const' ? 'const' : node.kind === 'let' ? 'let' : 'var';

  for (const decl of node.declarations) {
    if (t.isIdentifier(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, currentState, ctx) : Types.undefined;

      // Check if this is a hoisted var - might need to widen type
      const hoisted = ctx.hoistedDeclarations.get(decl.id.name);
      let finalType = initType;

      if (hoisted && kind === 'var') {
        // Widen with existing type from previous iterations
        const existing = lookupBinding(currentState.env, decl.id.name);
        if (existing && existing.type.kind !== 'undefined') {
          finalType = joinTypes(existing.type, initType);
        }
      }

      currentState = {
        ...currentState,
        env: updateBinding(currentState.env, decl.id.name, finalType, kind, decl),
      };

      // Add annotation
      addAnnotation(ctx, {
        node: decl.id,
        name: decl.id.name,
        type: finalType,
        kind: kind === 'const' ? 'const' : 'variable',
      });
    } else if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, currentState, ctx) : Types.undefined;
      currentState = transferDestructuringPattern(decl.id, initType, currentState, ctx, kind);
    }
  }

  return currentState;
}

/**
 * Transfer function for destructuring patterns
 */
function transferDestructuringPattern(
  pattern: t.LVal,
  sourceType: Type,
  state: TypeState,
  ctx: IterativeContext,
  kind: 'var' | 'let' | 'const'
): TypeState {
  let currentState = state;

  if (t.isIdentifier(pattern)) {
    currentState = {
      ...currentState,
      env: updateBinding(currentState.env, pattern.name, sourceType, kind, pattern),
    };
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
          currentState = transferDestructuringPattern(prop.value, propType, currentState, ctx, kind);
        } else if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
          const defaultType = inferExpression(prop.value.right, currentState, ctx);
          const unionType = propType.kind === 'any' ? defaultType : Types.union([propType, defaultType]);
          currentState = transferDestructuringPattern(prop.value.left, unionType, currentState, ctx, kind);
        } else if (t.isObjectPattern(prop.value) || t.isArrayPattern(prop.value)) {
          currentState = transferDestructuringPattern(prop.value, propType, currentState, ctx, kind);
        }
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        currentState = transferDestructuringPattern(prop.argument, Types.object({}), currentState, ctx, kind);
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
        currentState = transferDestructuringPattern(elem, elemType, currentState, ctx, kind);
      } else if (t.isRestElement(elem) && t.isIdentifier(elem.argument)) {
        if (sourceType.kind === 'array') {
          currentState = transferDestructuringPattern(
            elem.argument,
            Types.array(sourceType.elementType),
            currentState,
            ctx,
            kind
          );
        } else {
          currentState = transferDestructuringPattern(
            elem.argument,
            Types.array(Types.any()),
            currentState,
            ctx,
            kind
          );
        }
      } else if (t.isAssignmentPattern(elem) && t.isIdentifier(elem.left)) {
        const defaultType = inferExpression(elem.right, currentState, ctx);
        const unionType = elemType.kind === 'any' ? defaultType : Types.union([elemType, defaultType]);
        currentState = transferDestructuringPattern(elem.left, unionType, currentState, ctx, kind);
      }
    }
  }

  return currentState;
}

/**
 * Transfer function for function declarations
 */
function transferFunctionDeclaration(
  node: t.FunctionDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!node.id) return state;

  const funcType = inferFunctionType(node, state, ctx);

  const newState = {
    ...state,
    env: updateBinding(state.env, node.id.name, funcType, 'function', node),
  };

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: funcType,
    kind: 'function',
  });

  // Annotate parameters
  annotateParameters(node.params, funcType, ctx);

  return newState;
}

/**
 * Transfer function for class declarations
 */
function transferClassDeclaration(
  node: t.ClassDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!node.id) return state;

  const classType = inferClassType(node, state, ctx);

  const newState = {
    ...state,
    env: updateBinding(state.env, node.id.name, classType, 'class', node),
  };

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: classType,
    kind: 'class',
  });

  return newState;
}

/**
 * Transfer function for expression statements
 */
function transferExpressionStatement(
  node: t.ExpressionStatement,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  // Handle assignments
  if (t.isAssignmentExpression(node.expression)) {
    return transferAssignment(node.expression, state, ctx);
  }

  // Just infer the expression type (for side effects like call expressions)
  inferExpression(node.expression, state, ctx);
  return state;
}

/**
 * Transfer function for assignments
 */
function transferAssignment(
  node: t.AssignmentExpression,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  const rightType = inferExpression(node.right, state, ctx);

  if (t.isIdentifier(node.left)) {
    const binding = lookupBinding(state.env, node.left.name);
    if (binding) {
      if (binding.kind === 'const') {
        ctx.errors.push({
          message: `Cannot assign to constant '${node.left.name}'`,
          line: node.loc?.start.line ?? 0,
          column: node.loc?.start.column ?? 0,
          nodeType: 'AssignmentExpression',
        });
        return state;
      }

      // Determine the new type based on assignment operator
      let newType: Type;
      if (node.operator === '=') {
        newType = rightType;
      } else {
        // Compound assignment (+=, -=, *=, etc.)
        // The result is always the widened type of the operation
        switch (node.operator) {
          case '+=':
            // Could be string concatenation or numeric addition
            if (binding.type.kind === 'string' || rightType.kind === 'string') {
              newType = Types.string;
            } else {
              newType = Types.number;
            }
            break;
          case '-=':
          case '*=':
          case '/=':
          case '%=':
          case '**=':
          case '|=':
          case '&=':
          case '^=':
          case '<<=':
          case '>>=':
          case '>>>=':
            // These always produce numbers
            newType = Types.number;
            break;
          default:
            // For any other operator, join types
            newType = joinTypes(binding.type, rightType);
        }
      }

      return {
        ...state,
        env: updateBinding(state.env, node.left.name, newType, binding.kind, binding.declarationNode),
      };
    }
  }

  return state;
}
