/**
 * Function Type Inference - Infer types for function declarations and expressions
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { type IterativeContext, type HoistedDeclaration, registerCallSite } from './context.js';
import { createEnv, updateBinding } from './state.js';
import { addAnnotation } from './annotations.js';
import { inferExpression, inferArrayExpression, inferObjectExpression, registerFunctions } from './expressions.js';

// Note: registerFunctions is called at the end of this file

/**
 * Analyze a function body (for IIFE and nested functions)
 * Note: This is a simplified version that doesn't do full iterative analysis
 * to avoid circular dependencies. Full analysis happens at the top level.
 *
 * Uses a two-pass approach for call-site-based parameter inference:
 * 1. First pass: collect all call sites (function calls) to gather argument types
 * 2. Second pass: analyze function declarations using collected call site info
 */
export function analyzeFunction(
  node: t.FunctionExpression | t.ArrowFunctionExpression | t.FunctionDeclaration,
  state: TypeState,
  ctx: IterativeContext
): void {
  // Get the function body statements
  let statements: t.Statement[];
  if (t.isBlockStatement(node.body)) {
    statements = node.body.body;
  } else {
    // Arrow function with expression body - nothing to analyze deeply
    return;
  }

  // Create function scope environment
  let funcEnv = createEnv(state.env, 'function');

  // Add parameters to environment (with any type initially)
  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(Types.any()), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      funcEnv = updateBinding(funcEnv, param.left.name, defaultType, 'param', param);
    }
  }

  // Collect hoisted declarations in this function
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(statements, hoistedDeclarations);

  // Add hoisted declarations to environment
  for (const [name, decl] of hoistedDeclarations) {
    funcEnv = updateBinding(funcEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // First pass: collect variables that are modified in loops
  // These need to be widened for soundness
  const modifiedInLoop = new Set<string>();
  for (const stmt of statements) {
    collectModifiedInLoops(stmt, modifiedInLoop, false);
  }

  // Create function state for traversal
  let funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  // FIRST PASS: Collect variable declarations to build the environment
  // This is needed so that call site collection can resolve variable references
  for (const stmt of statements) {
    funcState = collectVariableDeclarations(stmt, funcState, ctx, modifiedInLoop);
  }

  // SECOND PASS: Collect all call sites to gather argument types
  // Now that variables are in the environment, we can properly infer argument types
  for (const stmt of statements) {
    collectCallSitesFromStatement(stmt, funcState, ctx);
  }

  // THIRD PASS: Analyze with loop-awareness and generate annotations
  // Now that call sites are collected, function type inference will use them
  funcState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };
  for (const stmt of statements) {
    funcState = collectAnnotationsFromStatementWithLoop(stmt, funcState, ctx, false, modifiedInLoop);
  }
}

/**
 * Collect variable declarations to build the environment (first pass)
 * This ensures variables are available when collecting call sites
 */
function collectVariableDeclarations(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext,
  modifiedInLoop: Set<string>
): TypeState {
  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    let currentState = state;
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        const shouldWiden = modifiedInLoop.has(decl.id.name);
        let initType: Type = Types.any();
        if (decl.init) {
          initType = inferExpression(decl.init, currentState, ctx);
          if (shouldWiden) {
            initType = Types.widen(initType);
          }
        }
        currentState = {
          ...currentState,
          env: updateBinding(currentState.env, decl.id.name, initType, kind, decl),
        };
      }
    }
    return currentState;
  } else if (t.isBlockStatement(stmt)) {
    let currentState = state;
    for (const s of stmt.body) {
      currentState = collectVariableDeclarations(s, currentState, ctx, modifiedInLoop);
    }
    return currentState;
  } else if (t.isIfStatement(stmt)) {
    let currentState = collectVariableDeclarations(stmt.consequent, state, ctx, modifiedInLoop);
    if (stmt.alternate) {
      currentState = collectVariableDeclarations(stmt.alternate, currentState, ctx, modifiedInLoop);
    }
    return currentState;
  } else if (t.isForStatement(stmt)) {
    let currentState = state;
    if (stmt.init && t.isVariableDeclaration(stmt.init)) {
      currentState = collectVariableDeclarations(stmt.init, currentState, ctx, modifiedInLoop);
    }
    currentState = collectVariableDeclarations(stmt.body, currentState, ctx, modifiedInLoop);
    return currentState;
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    return collectVariableDeclarations(stmt.body, state, ctx, modifiedInLoop);
  } else if (t.isTryStatement(stmt)) {
    let currentState = collectVariableDeclarations(stmt.block, state, ctx, modifiedInLoop);
    if (stmt.handler) {
      currentState = collectVariableDeclarations(stmt.handler.body, currentState, ctx, modifiedInLoop);
    }
    if (stmt.finalizer) {
      currentState = collectVariableDeclarations(stmt.finalizer, currentState, ctx, modifiedInLoop);
    }
    return currentState;
  } else if (t.isSwitchStatement(stmt)) {
    let currentState = state;
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        currentState = collectVariableDeclarations(s, currentState, ctx, modifiedInLoop);
      }
    }
    return currentState;
  }
  return state;
}

/**
 * Collect call sites from statements (first pass for call-site-based inference)
 * This traverses all statements and expressions to find function calls,
 * registering their argument types in the context.
 */
function collectCallSitesFromStatement(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isExpressionStatement(stmt)) {
    collectCallSitesFromExpression(stmt.expression, state, ctx);
  } else if (t.isVariableDeclaration(stmt)) {
    for (const decl of stmt.declarations) {
      if (decl.init) {
        collectCallSitesFromExpression(decl.init, state, ctx);
      }
    }
  } else if (t.isReturnStatement(stmt) && stmt.argument) {
    collectCallSitesFromExpression(stmt.argument, state, ctx);
  } else if (t.isIfStatement(stmt)) {
    collectCallSitesFromExpression(stmt.test, state, ctx);
    collectCallSitesFromStatement(stmt.consequent, state, ctx);
    if (stmt.alternate) {
      collectCallSitesFromStatement(stmt.alternate, state, ctx);
    }
  } else if (t.isBlockStatement(stmt)) {
    for (const s of stmt.body) {
      collectCallSitesFromStatement(s, state, ctx);
    }
  } else if (t.isForStatement(stmt)) {
    if (stmt.init) {
      if (t.isVariableDeclaration(stmt.init)) {
        collectCallSitesFromStatement(stmt.init, state, ctx);
      } else {
        collectCallSitesFromExpression(stmt.init, state, ctx);
      }
    }
    if (stmt.test) collectCallSitesFromExpression(stmt.test, state, ctx);
    if (stmt.update) collectCallSitesFromExpression(stmt.update, state, ctx);
    collectCallSitesFromStatement(stmt.body, state, ctx);
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    collectCallSitesFromExpression(stmt.test, state, ctx);
    collectCallSitesFromStatement(stmt.body, state, ctx);
  } else if (t.isFunctionDeclaration(stmt)) {
    // Recursively collect from nested function bodies
    if (t.isBlockStatement(stmt.body)) {
      for (const s of stmt.body.body) {
        collectCallSitesFromStatement(s, state, ctx);
      }
    }
  } else if (t.isTryStatement(stmt)) {
    collectCallSitesFromStatement(stmt.block, state, ctx);
    if (stmt.handler) {
      collectCallSitesFromStatement(stmt.handler.body, state, ctx);
    }
    if (stmt.finalizer) {
      collectCallSitesFromStatement(stmt.finalizer, state, ctx);
    }
  } else if (t.isSwitchStatement(stmt)) {
    collectCallSitesFromExpression(stmt.discriminant, state, ctx);
    for (const c of stmt.cases) {
      if (c.test) collectCallSitesFromExpression(c.test, state, ctx);
      for (const s of c.consequent) {
        collectCallSitesFromStatement(s, state, ctx);
      }
    }
  }
}

/**
 * Collect call sites from expressions
 */
function collectCallSitesFromExpression(
  expr: t.Expression,
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isCallExpression(expr)) {
    // Register this call site
    if (t.isIdentifier(expr.callee)) {
      const funcName = expr.callee.name;
      const argTypes = expr.arguments.map((arg) =>
        t.isExpression(arg) ? inferExpression(arg, state, ctx) : Types.any()
      );
      registerCallSite(ctx, funcName, expr, argTypes);
    }
    // Also process arguments
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) {
        collectCallSitesFromExpression(arg, state, ctx);
      }
    }
    // Process callee
    if (t.isExpression(expr.callee)) {
      collectCallSitesFromExpression(expr.callee, state, ctx);
    }
  } else if (t.isNewExpression(expr)) {
    if (t.isIdentifier(expr.callee)) {
      const funcName = expr.callee.name;
      const argTypes = expr.arguments.map((arg) =>
        t.isExpression(arg) ? inferExpression(arg, state, ctx) : Types.any()
      );
      registerCallSite(ctx, funcName, expr, argTypes);
    }
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) {
        collectCallSitesFromExpression(arg, state, ctx);
      }
    }
  } else if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
    if (t.isExpression(expr.left)) {
      collectCallSitesFromExpression(expr.left, state, ctx);
    }
    collectCallSitesFromExpression(expr.right, state, ctx);
  } else if (t.isUnaryExpression(expr) && t.isExpression(expr.argument)) {
    collectCallSitesFromExpression(expr.argument, state, ctx);
  } else if (t.isConditionalExpression(expr)) {
    collectCallSitesFromExpression(expr.test, state, ctx);
    collectCallSitesFromExpression(expr.consequent, state, ctx);
    collectCallSitesFromExpression(expr.alternate, state, ctx);
  } else if (t.isAssignmentExpression(expr)) {
    collectCallSitesFromExpression(expr.right, state, ctx);
  } else if (t.isMemberExpression(expr) && t.isExpression(expr.object)) {
    collectCallSitesFromExpression(expr.object, state, ctx);
  } else if (t.isArrayExpression(expr)) {
    for (const elem of expr.elements) {
      if (t.isExpression(elem)) {
        collectCallSitesFromExpression(elem, state, ctx);
      }
    }
  } else if (t.isObjectExpression(expr)) {
    for (const prop of expr.properties) {
      if (t.isObjectProperty(prop) && t.isExpression(prop.value)) {
        collectCallSitesFromExpression(prop.value, state, ctx);
      }
    }
  } else if (t.isSequenceExpression(expr)) {
    for (const e of expr.expressions) {
      collectCallSitesFromExpression(e, state, ctx);
    }
  } else if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
    // Recursively collect from nested function bodies
    if (t.isBlockStatement(expr.body)) {
      for (const s of expr.body.body) {
        collectCallSitesFromStatement(s, state, ctx);
      }
    } else if (t.isExpression(expr.body)) {
      collectCallSitesFromExpression(expr.body, state, ctx);
    }
  }
}

/**
 * Infer function type
 *
 * Uses call-site-based parameter type inference when available.
 * For named functions (FunctionDeclaration or named FunctionExpression),
 * looks up collected call site information to infer parameter types.
 */
export function inferFunctionType(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  // Try to get call-site inferred param types for named functions
  let callSiteParamTypes: Type[] | undefined;
  const funcName = getFunctionName(node);
  if (funcName) {
    const callInfo = ctx.functionCallInfo.get(funcName);
    if (callInfo && callInfo.paramTypes.length > 0) {
      callSiteParamTypes = callInfo.paramTypes;
    }
  }

  // Create function-local environment with parameters
  let funcEnv = createEnv(state.env, 'function');

  for (let i = 0; i < node.params.length; i++) {
    const param = node.params[i];
    if (t.isIdentifier(param)) {
      // Use call-site inferred type if available
      const paramType = callSiteParamTypes && i < callSiteParamTypes.length
        ? callSiteParamTypes[i]!
        : Types.any();
      params.push(Types.param(param.name, paramType));
      funcEnv = updateBinding(funcEnv, param.name, paramType, 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      const restElemType = callSiteParamTypes && i < callSiteParamTypes.length
        ? callSiteParamTypes[i]!
        : Types.any();
      params.push(Types.param(param.argument.name, Types.array(restElemType), { rest: true }));
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(restElemType), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const paramType = callSiteParamTypes && i < callSiteParamTypes.length
        ? callSiteParamTypes[i]!
        : inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, paramType, { optional: true }));
      funcEnv = updateBinding(funcEnv, param.left.name, paramType, 'param', param);
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // First pass: collect variables that are modified in loops
  // These need to be widened for soundness
  const modifiedInLoop = new Set<string>();
  if (t.isBlockStatement(node.body)) {
    collectModifiedInLoops(node.body, modifiedInLoop, false);
  }

  // Collect all variable declarations in function body for return type inference
  // Also adds annotations for each local variable
  if (t.isBlockStatement(node.body)) {
    funcEnv = collectDeclarationsInBlockWithModified(node.body, funcEnv, ctx, modifiedInLoop);
  }

  // Create function-local state
  const funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, funcState, ctx);
  } else if (t.isExpression(node.body)) {
    returnType = inferExpression(node.body, funcState, ctx);
  }

  const isAsync = 'async' in node && node.async;
  const isGenerator = 'generator' in node && node.generator;

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

/**
 * Get the name of a function if it has one
 */
function getFunctionName(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod
): string | undefined {
  if (t.isFunctionDeclaration(node) && node.id) {
    return node.id.name;
  }
  if (t.isFunctionExpression(node) && node.id) {
    return node.id.name;
  }
  if (t.isObjectMethod(node) && t.isIdentifier(node.key)) {
    return node.key.name;
  }
  return undefined;
}

/**
 * Collect variables that are modified inside loops for top-level code
 * Returns a set of variable names that need to be widened
 */
export function collectModifiedInLoopsTopLevel(statements: t.Statement[]): Set<string> {
  const modified = new Set<string>();
  for (const stmt of statements) {
    collectModifiedInLoops(stmt, modified, false);
  }
  return modified;
}

/**
 * Collect variables that are modified inside loops (compound assignment, ++, --)
 * These need to be widened to their base types for soundness.
 */
function collectModifiedInLoops(
  node: t.Node,
  modified: Set<string>,
  insideLoop: boolean
): void {
  if (t.isForStatement(node)) {
    // The loop body is inside the loop
    if (node.init) collectModifiedInLoops(node.init, modified, false);
    if (node.test) collectModifiedInLoops(node.test, modified, true);
    if (node.update) collectModifiedInLoops(node.update, modified, true);
    if (node.body) collectModifiedInLoops(node.body, modified, true);
  } else if (t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
    if (node.test) collectModifiedInLoops(node.test, modified, true);
    collectModifiedInLoops(node.body, modified, true);
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectModifiedInLoops(stmt, modified, insideLoop);
    }
  } else if (t.isIfStatement(node)) {
    collectModifiedInLoops(node.consequent, modified, insideLoop);
    if (node.alternate) collectModifiedInLoops(node.alternate, modified, insideLoop);
  } else if (t.isExpressionStatement(node)) {
    collectModifiedInLoops(node.expression, modified, insideLoop);
  } else if (t.isAssignmentExpression(node)) {
    // Check for any assignment inside a loop - even simple assignment (=)
    // needs to be tracked because the variable may take different values
    if (insideLoop && t.isIdentifier(node.left)) {
      modified.add(node.left.name);
    }
    // Also check the right side for nested assignments
    collectModifiedInLoops(node.right, modified, insideLoop);
  } else if (t.isUpdateExpression(node)) {
    // ++i or i++ inside a loop
    if (insideLoop && t.isIdentifier(node.argument)) {
      modified.add(node.argument.name);
    }
  } else if (t.isTryStatement(node)) {
    collectModifiedInLoops(node.block, modified, insideLoop);
    if (node.handler) collectModifiedInLoops(node.handler.body, modified, insideLoop);
    if (node.finalizer) collectModifiedInLoops(node.finalizer, modified, insideLoop);
  } else if (t.isSwitchStatement(node)) {
    for (const c of node.cases) {
      for (const stmt of c.consequent) {
        collectModifiedInLoops(stmt, modified, insideLoop);
      }
    }
  }
}

/**
 * Collect declarations and widen types for variables that are modified in loops
 * Now uses full expression inference for better type accuracy
 */
function collectDeclarationsInBlockWithModified(
  block: t.BlockStatement,
  env: TypeEnvironment,
  ctx: IterativeContext,
  modifiedInLoop: Set<string>
): TypeEnvironment {
  let result = env;

  for (const stmt of block.body) {
    result = collectDeclarationsInStatementWithModified(stmt, result, ctx, false, modifiedInLoop);
  }

  return result;
}

/**
 * Collect declarations with awareness of loop-modified variables
 * Uses full expression inference for accurate types
 */
function collectDeclarationsInStatementWithModified(
  stmt: t.Statement,
  env: TypeEnvironment,
  ctx: IterativeContext,
  insideLoop: boolean,
  modifiedInLoop: Set<string>
): TypeEnvironment {
  let result = env;

  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        // Check if this variable is modified in a loop
        const shouldWiden = insideLoop || modifiedInLoop.has(decl.id.name);

        let initType: Type = Types.undefined;
        if (decl.init) {
          // Create a temporary state for expression inference
          const tempState: TypeState = {
            env: result,
            expressionTypes: new Map(),
            reachable: true,
          };
          // Use full expression inference for accurate types
          initType = inferExpression(decl.init, tempState, ctx);

          // Widen if needed
          if (shouldWiden) {
            initType = Types.widen(initType);
          }
        }
        result = updateBinding(result, decl.id.name, initType, kind, decl);

        addAnnotation(ctx, {
          node: decl.id,
          name: decl.id.name,
          type: initType,
          kind: kind === 'const' ? 'const' : 'variable',
          skipIfExists: true,
        });
      }
    }
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    // Create a temporary state for function type inference
    const tempState: TypeState = {
      env: result,
      expressionTypes: new Map(),
      reachable: true,
    };
    const funcType = inferFunctionType(stmt, tempState, ctx);
    result = updateBinding(result, stmt.id.name, funcType, 'function', stmt);
  } else if (t.isForStatement(stmt)) {
    if (t.isVariableDeclaration(stmt.init)) {
      result = collectDeclarationsInStatementWithModified(stmt.init, result, ctx, true, modifiedInLoop);
    }
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlockWithModified(stmt.body, result, ctx, modifiedInLoop);
    } else {
      result = collectDeclarationsInStatementWithModified(stmt.body, result, ctx, true, modifiedInLoop);
    }
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlockWithModified(stmt.body, result, ctx, modifiedInLoop);
    } else {
      result = collectDeclarationsInStatementWithModified(stmt.body, result, ctx, true, modifiedInLoop);
    }
  } else if (t.isIfStatement(stmt)) {
    if (t.isBlockStatement(stmt.consequent)) {
      result = collectDeclarationsInBlockWithModified(stmt.consequent, result, ctx, modifiedInLoop);
    } else {
      result = collectDeclarationsInStatementWithModified(stmt.consequent, result, ctx, insideLoop, modifiedInLoop);
    }
    if (stmt.alternate) {
      if (t.isBlockStatement(stmt.alternate)) {
        result = collectDeclarationsInBlockWithModified(stmt.alternate, result, ctx, modifiedInLoop);
      } else {
        result = collectDeclarationsInStatementWithModified(stmt.alternate, result, ctx, insideLoop, modifiedInLoop);
      }
    }
  } else if (t.isTryStatement(stmt)) {
    result = collectDeclarationsInBlockWithModified(stmt.block, result, ctx, modifiedInLoop);
    if (stmt.handler) {
      result = collectDeclarationsInBlockWithModified(stmt.handler.body, result, ctx, modifiedInLoop);
    }
    if (stmt.finalizer) {
      result = collectDeclarationsInBlockWithModified(stmt.finalizer, result, ctx, modifiedInLoop);
    }
  } else if (t.isSwitchStatement(stmt)) {
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        result = collectDeclarationsInStatementWithModified(s, result, ctx, insideLoop, modifiedInLoop);
      }
    }
  } else if (t.isBlockStatement(stmt)) {
    result = collectDeclarationsInBlockWithModified(stmt, result, ctx, modifiedInLoop);
  }

  return result;
}

/**
 * Infer return type from function body
 */
export function inferBlockReturnType(
  body: t.BlockStatement,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const returnTypes: Type[] = [];

  for (const stmt of body.body) {
    collectReturnTypes(stmt, returnTypes, state, ctx);
  }

  if (returnTypes.length === 0) {
    return Types.undefined;
  }

  return Types.union(returnTypes);
}

function collectReturnTypes(
  node: t.Node,
  types: Type[],
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isReturnStatement(node)) {
    if (node.argument) {
      types.push(inferExpression(node.argument, state, ctx));
    } else {
      types.push(Types.undefined);
    }
  } else if (t.isIfStatement(node)) {
    collectReturnTypes(node.consequent, types, state, ctx);
    if (node.alternate) {
      collectReturnTypes(node.alternate, types, state, ctx);
    }
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectReturnTypes(stmt, types, state, ctx);
    }
  } else if (t.isSwitchStatement(node)) {
    for (const c of node.cases) {
      for (const stmt of c.consequent) {
        collectReturnTypes(stmt, types, state, ctx);
      }
    }
  } else if (t.isTryStatement(node)) {
    collectReturnTypes(node.block, types, state, ctx);
    if (node.handler) {
      collectReturnTypes(node.handler.body, types, state, ctx);
    }
    if (node.finalizer) {
      collectReturnTypes(node.finalizer, types, state, ctx);
    }
  } else if (t.isWhileStatement(node) || t.isDoWhileStatement(node)) {
    // Handle return statements inside while/do-while loops
    collectReturnTypes(node.body, types, state, ctx);
  } else if (t.isForStatement(node)) {
    // Handle return statements inside for loops
    collectReturnTypes(node.body, types, state, ctx);
  } else if (t.isForInStatement(node) || t.isForOfStatement(node)) {
    // Handle return statements inside for-in/for-of loops
    collectReturnTypes(node.body, types, state, ctx);
  } else if (t.isLabeledStatement(node)) {
    // Handle labeled statements
    collectReturnTypes(node.body, types, state, ctx);
  }
}

/**
 * Collect hoisted declarations from statements (first pass)
 */
export function collectHoistedDeclarations(
  statements: t.Statement[],
  hoisted: Map<string, HoistedDeclaration>
): void {
  for (const stmt of statements) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      hoisted.set(stmt.id.name, {
        name: stmt.id.name,
        kind: 'function',
        node: stmt,
        initialType: Types.function({ params: [], returnType: Types.any() }), // Placeholder
      });
    } else if (t.isClassDeclaration(stmt) && stmt.id) {
      hoisted.set(stmt.id.name, {
        name: stmt.id.name,
        kind: 'class',
        node: stmt,
        initialType: Types.class({
          name: stmt.id.name,
          constructor: Types.function({ params: [], returnType: Types.undefined }),
          instanceType: Types.object({}),
          staticProperties: new Map(),
        }),
      });
    } else if (t.isVariableDeclaration(stmt) && stmt.kind === 'var') {
      for (const decl of stmt.declarations) {
        if (t.isIdentifier(decl.id)) {
          hoisted.set(decl.id.name, {
            name: decl.id.name,
            kind: 'var',
            node: decl,
            initialType: Types.undefined,
          });
        }
      }
    }
  }
}

/**
 * Compute reverse post-order of CFG blocks
 */
export function computeReversePostOrder(cfg: { entry: string; successors: ReadonlyMap<string, readonly string[]> }): string[] {
  const visited = new Set<string>();
  const postOrder: string[] = [];

  function dfs(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const successors = cfg.successors.get(nodeId) ?? [];
    for (const succ of successors) {
      dfs(succ);
    }
    postOrder.push(nodeId);
  }

  dfs(cfg.entry);
  return postOrder.reverse();
}

/**
 * Loop-aware statement traversal to collect annotations (for nested functions)
 * This version tracks whether we're inside a loop and widens types accordingly.
 * Returns updated state with any new bindings.
 */
function collectAnnotationsFromStatementWithLoop(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext,
  insideLoop: boolean,
  modifiedInLoop: Set<string>
): TypeState {
  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    let currentState = state;
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        // Check if this variable is modified in a loop
        const shouldWiden = insideLoop || modifiedInLoop.has(decl.id.name);

        let initType: Type = Types.any();
        if (decl.init) {
          initType = inferExpression(decl.init, currentState, ctx);
          // Widen if needed
          if (shouldWiden) {
            initType = Types.widen(initType);
          }
        }

        currentState = {
          ...currentState,
          env: updateBinding(currentState.env, decl.id.name, initType, kind, decl),
        };

        addAnnotation(ctx, {
          node: decl.id,
          name: decl.id.name,
          type: initType,
          kind: kind === 'const' ? 'const' : 'variable',
        });
      }
    }
    return currentState;
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    const funcType = inferFunctionType(stmt, state, ctx);
    // Update environment with the inferred function type
    const newState = {
      ...state,
      env: updateBinding(state.env, stmt.id.name, funcType, 'function', stmt),
    };
    addAnnotation(ctx, {
      node: stmt.id,
      name: stmt.id.name,
      type: funcType,
      kind: 'function',
    });
    return newState;
  } else if (t.isBlockStatement(stmt)) {
    let currentState = state;
    for (const s of stmt.body) {
      currentState = collectAnnotationsFromStatementWithLoop(s, currentState, ctx, insideLoop, modifiedInLoop);
    }
    return currentState;
  } else if (t.isIfStatement(stmt)) {
    let currentState = collectAnnotationsFromStatementWithLoop(stmt.consequent, state, ctx, insideLoop, modifiedInLoop);
    if (stmt.alternate) {
      currentState = collectAnnotationsFromStatementWithLoop(stmt.alternate, currentState, ctx, insideLoop, modifiedInLoop);
    }
    return currentState;
  } else if (t.isForStatement(stmt)) {
    let currentState = state;
    // For loop init declares loop variables - these should be widened
    if (stmt.init && t.isVariableDeclaration(stmt.init)) {
      currentState = collectAnnotationsFromStatementWithLoop(stmt.init, currentState, ctx, true, modifiedInLoop);
    }
    // Body is inside the loop
    currentState = collectAnnotationsFromStatementWithLoop(stmt.body, currentState, ctx, true, modifiedInLoop);
    return currentState;
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    // Body is inside the loop
    return collectAnnotationsFromStatementWithLoop(stmt.body, state, ctx, true, modifiedInLoop);
  } else if (t.isTryStatement(stmt)) {
    let currentState = collectAnnotationsFromStatementWithLoop(stmt.block, state, ctx, insideLoop, modifiedInLoop);
    if (stmt.handler) {
      currentState = collectAnnotationsFromStatementWithLoop(stmt.handler.body, currentState, ctx, insideLoop, modifiedInLoop);
    }
    if (stmt.finalizer) {
      currentState = collectAnnotationsFromStatementWithLoop(stmt.finalizer, currentState, ctx, insideLoop, modifiedInLoop);
    }
    return currentState;
  } else if (t.isSwitchStatement(stmt)) {
    let currentState = state;
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        currentState = collectAnnotationsFromStatementWithLoop(s, currentState, ctx, insideLoop, modifiedInLoop);
      }
    }
    return currentState;
  } else if (t.isExpressionStatement(stmt)) {
    // Process the expression to collect call site information
    // This is important for function calls like advance(0.01)
    inferExpression(stmt.expression, state, ctx);
    return state;
  } else if (t.isReturnStatement(stmt)) {
    // Process return expression to collect call site information
    if (stmt.argument) {
      inferExpression(stmt.argument, state, ctx);
    }
    return state;
  }
  return state;
}

// Register implementations with expressions module
registerFunctions({
  inferFunctionType,
});
