/**
 * Call Expression Type Inference - Infer types for function calls and new expressions
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { type IterativeContext, registerCallSite } from './context.js';
import { lookupBinding, createEnv, updateBinding } from './state.js';
import { inferExpression, registerCalls } from './expressions.js';
import { analyzeFunction } from './functions.js';

// Note: registerCalls is called at the end of this file

/**
 * Infer call expression type
 *
 * Also collects call site information for named function calls
 * to enable call-site-based parameter type inference.
 */
export function inferCallExpression(
  expr: t.CallExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  // Handle IIFE (Immediately Invoked Function Expression)
  if (t.isFunctionExpression(expr.callee) || t.isArrowFunctionExpression(expr.callee)) {
    // Analyze the IIFE body
    analyzeFunction(expr.callee, state, ctx);
  }

  // For named function calls, collect call site information
  if (t.isIdentifier(expr.callee)) {
    const funcName = expr.callee.name;

    // Infer argument types at this call site
    const argTypes = expr.arguments.map((arg) =>
      t.isExpression(arg) ? inferExpression(arg, state, ctx) : Types.any()
    );

    // Register this call site
    registerCallSite(ctx, funcName, expr, argTypes);
  }

  const calleeType = t.isExpression(expr.callee)
    ? inferExpression(expr.callee, state, ctx)
    : Types.any();

  if (calleeType.kind === 'function') {
    return calleeType.returnType;
  }

  return Types.any();
}

/**
 * Infer new expression type
 *
 * This function implements call-site-based type inference for constructors:
 * 1. Collect argument types from this call site
 * 2. Register/update call site info in context
 * 3. Merge with previous call sites to get union of param types
 * 4. Use merged param types to infer instance type
 */
export function inferNewExpression(
  expr: t.NewExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const calleeType = t.isExpression(expr.callee)
    ? inferExpression(expr.callee, state, ctx)
    : Types.any();

  if (calleeType.kind === 'class') {
    return calleeType.instanceType;
  }

  // For function constructors, use call-site-based inference
  if (calleeType.kind === 'function' && t.isIdentifier(expr.callee)) {
    const funcName = expr.callee.name;
    const binding = lookupBinding(state.env, funcName);

    if (binding?.declarationNode) {
      const funcNode = getFunctionFromBinding(binding.declarationNode);
      if (funcNode) {
        // Infer argument types at this call site
        const argTypes = expr.arguments.map((arg) =>
          t.isExpression(arg) ? inferExpression(arg, state, ctx) : Types.any()
        );

        // Register this call site
        registerCallSite(ctx, funcName, expr, argTypes);

        // Get merged param types from all call sites
        const callInfo = ctx.functionCallInfo.get(funcName);
        const mergedParamTypes = callInfo?.paramTypes ?? argTypes;

        // Analyze constructor with merged param types
        const instanceType = analyzeConstructorFunction(funcNode, state, ctx, mergedParamTypes);

        // Cache the instance type for this constructor
        if (callInfo) {
          callInfo.instanceType = instanceType;
        }

        return instanceType;
      }
    }
    return Types.object({});
  }

  return Types.object({});
}

/**
 * Get function node from a binding's declaration node
 */
function getFunctionFromBinding(node: t.Node): t.FunctionDeclaration | t.FunctionExpression | null {
  if (t.isFunctionDeclaration(node)) {
    return node;
  }
  if (t.isVariableDeclarator(node) && node.init) {
    if (t.isFunctionExpression(node.init)) {
      return node.init;
    }
  }
  return null;
}

/**
 * Analyze a constructor function to determine the instance type
 * by looking at `this.xxx = ...` assignments in the function body.
 *
 * @param func - The constructor function node
 * @param state - Current type state
 * @param ctx - Iterative context
 * @param paramTypes - Optional array of parameter types inferred from call sites.
 *                     If provided, these types are used instead of `any` for parameters.
 */
function analyzeConstructorFunction(
  func: t.FunctionDeclaration | t.FunctionExpression,
  state: TypeState,
  ctx: IterativeContext,
  paramTypes?: Type[]
): Type {
  const properties = new Map<string, ReturnType<typeof Types.property>>();

  if (!t.isBlockStatement(func.body)) {
    return Types.object({ properties });
  }

  // Create a state with parameters bound to their inferred types
  let funcEnv = createEnv(state.env, 'function');
  for (let i = 0; i < func.params.length; i++) {
    const param = func.params[i];
    if (t.isIdentifier(param)) {
      // Use call-site inferred type if available, otherwise fallback to any
      const paramType = paramTypes && i < paramTypes.length ? paramTypes[i]! : Types.any();
      funcEnv = updateBinding(funcEnv, param.name, paramType, 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      // Rest params get array type
      const restElemType = paramTypes && i < paramTypes.length ? paramTypes[i]! : Types.any();
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(restElemType), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      // For default params, use call-site type if available, otherwise infer from default
      const paramType = paramTypes && i < paramTypes.length
        ? paramTypes[i]!
        : inferExpression(param.right, state, ctx);
      funcEnv = updateBinding(funcEnv, param.left.name, paramType, 'param', param);
    }
  }

  const funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  // Traverse function body to find this.xxx = ... assignments
  collectThisAssignments(func.body, properties, funcState, ctx);

  return Types.object({ properties });
}

/**
 * Recursively collect this.xxx = ... assignments from statements
 */
function collectThisAssignments(
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
      collectThisAssignments(stmt, properties, state, ctx);
    }
  } else if (t.isIfStatement(node)) {
    collectThisAssignments(node.consequent, properties, state, ctx);
    if (node.alternate) {
      collectThisAssignments(node.alternate, properties, state, ctx);
    }
  } else if (t.isForStatement(node) || t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
    collectThisAssignments(node.body, properties, state, ctx);
  } else if (t.isTryStatement(node)) {
    collectThisAssignments(node.block, properties, state, ctx);
    if (node.handler) {
      collectThisAssignments(node.handler.body, properties, state, ctx);
    }
    if (node.finalizer) {
      collectThisAssignments(node.finalizer, properties, state, ctx);
    }
  }
}

// Register implementations with expressions module
registerCalls({
  inferCallExpression,
  inferNewExpression,
});
