/**
 * Class Type Inference - Infer types for class declarations and expressions
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';
import { createEnv, updateBinding } from './state.js';
import { inferExpression, registerClasses } from './expressions.js';
import { inferBlockReturnType } from './functions.js';

// Note: registerClasses is called at the end of this file

/**
 * Infer class type
 */
export function inferClassType(
  node: t.ClassDeclaration | t.ClassExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const className = node.id?.name ?? 'Anonymous';
  const instanceProps = new Map<string, ReturnType<typeof Types.property>>();
  const staticProps = new Map<string, ReturnType<typeof Types.property>>();
  let ctorType = Types.function({ params: [], returnType: Types.undefined });
  let ctorParams: Array<ReturnType<typeof Types.param>> = [];

  // First pass: find constructor and extract parameter types
  // Also collect this.xxx = yyy assignments to infer instance properties
  for (const member of node.body.body) {
    if (t.isClassMethod(member) && member.kind === 'constructor') {
      // Extract constructor parameters
      for (const param of member.params) {
        if (t.isIdentifier(param)) {
          ctorParams.push(Types.param(param.name, Types.any()));
        } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
          ctorParams.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
        } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
          const defaultType = inferExpression(param.right, state, ctx);
          ctorParams.push(Types.param(param.left.name, defaultType, { optional: true }));
        }
      }

      // Analyze constructor body for this.xxx = yyy assignments
      if (t.isBlockStatement(member.body)) {
        // Create a temporary environment with constructor parameters
        let ctorEnv = createEnv(state.env, 'function');
        for (const param of member.params) {
          if (t.isIdentifier(param)) {
            ctorEnv = updateBinding(ctorEnv, param.name, Types.any(), 'param', param);
          }
        }
        const ctorState: TypeState = { ...state, env: ctorEnv };

        collectThisAssignmentsForClass(member.body, instanceProps, ctorState, ctx);
      }

      ctorType = Types.function({ params: ctorParams, returnType: Types.undefined });
    }
  }

  // Create a preliminary instance type for recursive references
  const prelimInstanceType = Types.object({ properties: new Map(instanceProps) });

  // Create the class type early so methods can reference it
  const selfClassType = Types.class({
    name: className,
    constructor: ctorType,
    instanceType: prelimInstanceType,
    staticProperties: new Map(),
  });

  // Second pass: infer method types with proper 'this' type
  for (const member of node.body.body) {
    if (t.isClassMethod(member)) {
      if (member.kind === 'constructor') {
        // Already handled above
        continue;
      }

      // Infer method type with 'this' bound to instance type
      const methodType = inferClassMethodTypeWithThis(member, state, ctx, prelimInstanceType, className);

      const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
      if (member.static) {
        staticProps.set(name, Types.property(methodType));
      } else {
        instanceProps.set(name, Types.property(methodType));
      }
    } else if (t.isClassProperty(member)) {
      const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
      const propType = member.value ? inferExpression(member.value, state, ctx) : Types.any();

      if (member.static) {
        staticProps.set(name, Types.property(propType));
      } else {
        // Don't overwrite properties from constructor
        if (!instanceProps.has(name)) {
          instanceProps.set(name, Types.property(propType));
        }
      }
    }
  }

  return Types.class({
    name: className,
    constructor: ctorType,
    instanceType: Types.object({ properties: instanceProps }),
    staticProperties: staticProps,
  });
}

/**
 * Collect this.xxx = yyy assignments from constructor body for class instance properties
 */
function collectThisAssignmentsForClass(
  node: t.Node,
  properties: Map<string, ReturnType<typeof Types.property>>,
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isExpressionStatement(node) && t.isAssignmentExpression(node.expression)) {
    const assignment = node.expression;
    // Check for this.xxx = ...
    if (
      t.isMemberExpression(assignment.left) &&
      t.isThisExpression(assignment.left.object) &&
      t.isIdentifier(assignment.left.property) &&
      !assignment.left.computed
    ) {
      const propName = assignment.left.property.name;
      const valueType = inferExpression(assignment.right, state, ctx);
      properties.set(propName, Types.property(valueType));
    }
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectThisAssignmentsForClass(stmt, properties, state, ctx);
    }
  } else if (t.isIfStatement(node)) {
    collectThisAssignmentsForClass(node.consequent, properties, state, ctx);
    if (node.alternate) {
      collectThisAssignmentsForClass(node.alternate, properties, state, ctx);
    }
  } else if (t.isForStatement(node) || t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
    collectThisAssignmentsForClass(node.body, properties, state, ctx);
  }
}

/**
 * Infer class method type with proper 'this' binding
 */
function inferClassMethodTypeWithThis(
  node: t.ClassMethod,
  state: TypeState,
  ctx: IterativeContext,
  thisType: Type,
  className: string
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  // Create environment with 'this' bound to the instance type
  let methodEnv = createEnv(state.env, 'function');
  methodEnv = updateBinding(methodEnv, 'this', thisType, 'const', node);

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
      methodEnv = updateBinding(methodEnv, param.name, Types.any(), 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
      methodEnv = updateBinding(methodEnv, param.argument.name, Types.array(Types.any()), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
      methodEnv = updateBinding(methodEnv, param.left.name, defaultType, 'param', param);
    }
  }

  const methodState: TypeState = {
    env: methodEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, methodState, ctx);
  }

  const isAsync = node.async;
  const isGenerator = node.generator;

  if (isAsync && returnType.kind !== 'promise') {
    returnType = Types.promise(returnType);
  }

  return Types.function({
    params,
    returnType,
    isAsync,
    isGenerator,
  });
}

// Register implementations with expressions module
registerClasses({
  inferClassType,
});
