/**
 * Expression Type Inference - Infer types for expressions
 *
 * This module handles type inference for all JavaScript expression types.
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';
import { lookupBinding, updateBinding, createEnv } from './state.js';
import { addAnnotation } from './annotations.js';
import type { HoistedDeclaration } from './context.js';

/**
 * Infer expression type (using current state)
 */
export function inferExpression(
  expr: t.Expression | t.SpreadElement,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (t.isSpreadElement(expr)) {
    return inferExpression(expr.argument, state, ctx);
  }

  switch (expr.type) {
    case 'NumericLiteral':
      return Types.numberLiteral(expr.value);
    case 'StringLiteral':
      return Types.stringLiteral(expr.value);
    case 'BooleanLiteral':
      return Types.booleanLiteral(expr.value);
    case 'NullLiteral':
      return Types.null;
    case 'BigIntLiteral':
      return Types.bigintLiteral(BigInt(expr.value));
    case 'RegExpLiteral':
      return Types.object({ properties: new Map() });

    case 'TemplateLiteral':
      if (expr.expressions.length === 0 && expr.quasis.length === 1) {
        return Types.stringLiteral(expr.quasis[0]!.value.cooked ?? '');
      }
      return Types.string;

    case 'Identifier':
      const binding = lookupBinding(state.env, expr.name);
      return binding?.type ?? Types.any(`undefined variable '${expr.name}'`);

    case 'ArrayExpression':
      return inferArrayExpression(expr, state, ctx);

    case 'ObjectExpression':
      return inferObjectExpression(expr, state, ctx);

    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return inferFunctionType(expr, state, ctx);

    case 'BinaryExpression':
      return inferBinaryExpression(expr, state, ctx);

    case 'UnaryExpression':
      return inferUnaryExpression(expr, state, ctx);

    case 'LogicalExpression':
      return inferLogicalExpression(expr, state, ctx);

    case 'ConditionalExpression':
      const consequent = inferExpression(expr.consequent, state, ctx);
      const alternate = inferExpression(expr.alternate, state, ctx);
      return Types.union([consequent, alternate]);

    case 'CallExpression':
      return inferCallExpression(expr, state, ctx);

    case 'NewExpression':
      return inferNewExpression(expr, state, ctx);

    case 'MemberExpression':
      return inferMemberExpression(expr, state, ctx);

    case 'AssignmentExpression':
      return inferExpression(expr.right, state, ctx);

    case 'SequenceExpression':
      const last = expr.expressions[expr.expressions.length - 1];
      return last ? inferExpression(last, state, ctx) : Types.undefined;

    case 'AwaitExpression':
      const awaitedType = inferExpression(expr.argument, state, ctx);
      if (awaitedType.kind === 'promise') {
        return awaitedType.resolvedType;
      }
      return awaitedType;

    case 'YieldExpression':
      return Types.any();

    case 'ThisExpression':
      return Types.any();

    case 'ClassExpression':
      return inferClassType(expr, state, ctx);

    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return Types.union([inferOptionalExpression(expr, state, ctx), Types.undefined]);

    default:
      return Types.any();
  }
}

/**
 * Infer array expression type
 */
export function inferArrayExpression(
  expr: t.ArrayExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (expr.elements.length === 0) {
    return Types.array(Types.never);
  }

  const elementTypes: Type[] = [];
  let hasSpread = false;

  for (const elem of expr.elements) {
    if (elem === null) {
      elementTypes.push(Types.undefined);
    } else if (t.isSpreadElement(elem)) {
      hasSpread = true;
      const spreadType = inferExpression(elem.argument, state, ctx);
      if (spreadType.kind === 'array') {
        elementTypes.push(spreadType.elementType);
      } else {
        elementTypes.push(Types.any());
      }
    } else {
      elementTypes.push(inferExpression(elem, state, ctx));
    }
  }

  if (hasSpread) {
    return Types.array(Types.union(elementTypes));
  }

  if (elementTypes.length <= 10) {
    return Types.tuple(elementTypes);
  }

  return Types.array(Types.union(elementTypes));
}

/**
 * Infer object expression type
 */
export function inferObjectExpression(
  expr: t.ObjectExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const properties = new Map<string, ReturnType<typeof Types.property>>();

  for (const prop of expr.properties) {
    if (t.isObjectProperty(prop)) {
      let key: string | undefined;

      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      } else if (t.isNumericLiteral(prop.key)) {
        key = String(prop.key.value);
      }

      if (key && t.isExpression(prop.value)) {
        const valueType = inferExpression(prop.value, state, ctx);
        properties.set(key, Types.property(valueType));
      }
    } else if (t.isObjectMethod(prop)) {
      let key: string | undefined;
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      }
      if (key) {
        const methodType = inferFunctionType(prop, state, ctx);
        properties.set(key, Types.property(methodType));
      }
    } else if (t.isSpreadElement(prop)) {
      const spreadType = inferExpression(prop.argument, state, ctx);
      if (spreadType.kind === 'object') {
        for (const [k, v] of spreadType.properties) {
          properties.set(k, v);
        }
      }
    }
  }

  return Types.object({ properties });
}

/**
 * Analyze a function body (for IIFE and nested functions)
 * Note: This is a simplified version that doesn't do full iterative analysis
 * to avoid circular dependencies. Full analysis happens at the top level.
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

  // Add parameters to environment
  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
      addAnnotation(ctx, {
        node: param,
        name: param.name,
        type: Types.any(),
        kind: 'parameter',
      });
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(Types.any()), 'param', param);
      addAnnotation(ctx, {
        node: param.argument,
        name: param.argument.name,
        type: Types.array(Types.any()),
        kind: 'parameter',
      });
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      funcEnv = updateBinding(funcEnv, param.left.name, defaultType, 'param', param);
      addAnnotation(ctx, {
        node: param.left,
        name: param.left.name,
        type: defaultType,
        kind: 'parameter',
      });
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

  // Create function state for simple traversal
  let funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  // Simple traversal to collect annotations (with loop-awareness)
  // State is updated as we process declarations to allow forward references
  for (const stmt of statements) {
    funcState = collectAnnotationsFromStatementWithLoop(stmt, funcState, ctx, false, modifiedInLoop);
  }
}

/**
 * Infer function type
 */
export function inferFunctionType(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  // Create function-local environment with parameters
  let funcEnv = createEnv(state.env, 'function');

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(Types.any()), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
      funcEnv = updateBinding(funcEnv, param.left.name, defaultType, 'param', param);
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
 * Collect all variable declarations in a block (for return type inference)
 * Also adds annotations for each declaration
 *
 * @param insideLoop - Whether we're inside a loop body (for widening)
 */
export function collectDeclarationsInBlock(
  block: t.BlockStatement,
  env: TypeEnvironment,
  ctx?: IterativeContext,
  insideLoop: boolean = false
): TypeEnvironment {
  let result = env;

  for (const stmt of block.body) {
    result = collectDeclarationsInStatement(stmt, result, ctx, insideLoop);
  }

  return result;
}

/**
 * Recursively collect declarations from a statement
 * Also adds annotations for each declaration
 *
 * @param insideLoop - Whether we're inside a loop body (for widening)
 */
function collectDeclarationsInStatement(
  stmt: t.Statement,
  env: TypeEnvironment,
  ctx?: IterativeContext,
  insideLoop: boolean = false
): TypeEnvironment {
  let result = env;

  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        // Infer initial type if possible
        let initType: Type = Types.any();
        if (decl.init) {
          if (t.isNumericLiteral(decl.init)) {
            // If we're inside a loop (e.g., for loop init), widen to number
            // because the variable will be modified
            initType = insideLoop ? Types.number : Types.numberLiteral(decl.init.value);
          } else if (t.isStringLiteral(decl.init)) {
            initType = insideLoop ? Types.string : Types.stringLiteral(decl.init.value);
          } else if (t.isBooleanLiteral(decl.init)) {
            initType = insideLoop ? Types.boolean : Types.booleanLiteral(decl.init.value);
          } else if (t.isNullLiteral(decl.init)) {
            initType = Types.null;
          } else if (t.isArrayExpression(decl.init)) {
            initType = Types.array(Types.any());
          } else if (t.isObjectExpression(decl.init)) {
            initType = Types.object({});
          } else {
            // For complex expressions, use number/string/any based on common patterns
            initType = Types.any();
          }
        }
        result = updateBinding(result, decl.id.name, initType, kind, decl);

        // Add annotation for this declaration
        // Use skipIfExists because transfer() may have already added a more precise type
        if (ctx) {
          addAnnotation(ctx, {
            node: decl.id,
            name: decl.id.name,
            type: initType,
            kind: kind === 'const' ? 'const' : 'variable',
            skipIfExists: true,
          });
        }
      }
    }
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    result = updateBinding(result, stmt.id.name, Types.function({ params: [], returnType: Types.any() }), 'function', stmt);
  } else if (t.isForStatement(stmt)) {
    // Collect declarations in for init - these are loop variables, so widen
    if (t.isVariableDeclaration(stmt.init)) {
      result = collectDeclarationsInStatement(stmt.init, result, ctx, true);
    }
    // Collect declarations in for body (still in loop context)
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx, true);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx, true);
    }
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx, true);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx, true);
    }
  } else if (t.isIfStatement(stmt)) {
    if (t.isBlockStatement(stmt.consequent)) {
      result = collectDeclarationsInBlock(stmt.consequent, result, ctx, insideLoop);
    } else {
      result = collectDeclarationsInStatement(stmt.consequent, result, ctx, insideLoop);
    }
    if (stmt.alternate) {
      if (t.isBlockStatement(stmt.alternate)) {
        result = collectDeclarationsInBlock(stmt.alternate, result, ctx, insideLoop);
      } else {
        result = collectDeclarationsInStatement(stmt.alternate, result, ctx, insideLoop);
      }
    }
  } else if (t.isTryStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt.block, result, ctx, insideLoop);
    if (stmt.handler) {
      result = collectDeclarationsInBlock(stmt.handler.body, result, ctx, insideLoop);
    }
    if (stmt.finalizer) {
      result = collectDeclarationsInBlock(stmt.finalizer, result, ctx, insideLoop);
    }
  } else if (t.isSwitchStatement(stmt)) {
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        result = collectDeclarationsInStatement(s, result, ctx, insideLoop);
      }
    }
  } else if (t.isBlockStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt, result, ctx, insideLoop);
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

/**
 * Infer class method type
 */
function inferClassMethodType(
  node: t.ClassMethod,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    }
  }

  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, state, ctx);
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

/**
 * Check if a type is definitely numeric (number or bigint, not any/unknown)
 */
function isDefinitelyNumeric(type: Type): boolean {
  if (type.kind === 'number' || type.kind === 'bigint') {
    return true;
  }
  if (type.kind === 'union') {
    // Union is numeric if all non-never members are numeric
    return type.members.every(m => m.kind === 'never' || m.kind === 'number' || m.kind === 'bigint');
  }
  return false;
}

/**
 * Check if a type could be a string (for + operator disambiguation)
 */
function couldBeString(type: Type): boolean {
  if (type.kind === 'string') return true;
  if (type.kind === 'any' || type.kind === 'unknown') return true;
  if (type.kind === 'union') {
    return type.members.some(m => couldBeString(m));
  }
  return false;
}

/**
 * Infer binary expression type
 */
export function inferBinaryExpression(
  expr: t.BinaryExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = t.isPrivateName(expr.left) ? Types.any() : inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '+':
      // If either side is definitely a string, result is string
      if (left.kind === 'string' || right.kind === 'string') {
        return Types.string;
      }
      // If both sides are definitely numbers, result is number
      if (left.kind === 'number' && right.kind === 'number') {
        if (left.value !== undefined && right.value !== undefined) {
          return Types.numberLiteral(left.value + right.value);
        }
        return Types.number;
      }
      // If one side is number and other is any/unknown, check context
      // In numeric context (e.g., result of another + with number), prefer number
      if (isDefinitelyNumeric(left) && (right.kind === 'any' || right.kind === 'unknown')) {
        // If we're adding number + any, and this is part of a larger numeric expression,
        // it's likely numeric. Be optimistic and return number.
        return Types.number;
      }
      if (isDefinitelyNumeric(right) && (left.kind === 'any' || left.kind === 'unknown')) {
        return Types.number;
      }
      // If both are any/unknown, could be either
      if ((left.kind === 'any' || left.kind === 'unknown') &&
          (right.kind === 'any' || right.kind === 'unknown')) {
        return Types.union([Types.string, Types.number]);
      }
      // Default: could be string or number
      return Types.union([Types.string, Types.number]);

    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
      return Types.number;

    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return Types.number;

    case '==':
    case '===':
    case '!=':
    case '!==':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'in':
    case 'instanceof':
      return Types.boolean;

    default:
      return Types.any();
  }
}

/**
 * Infer unary expression type
 */
export function inferUnaryExpression(
  expr: t.UnaryExpression,
  _state: TypeState,
  _ctx: IterativeContext
): Type {
  switch (expr.operator) {
    case 'typeof':
      return Types.string;
    case 'void':
      return Types.undefined;
    case '!':
      return Types.boolean;
    case '+':
    case '-':
    case '~':
      return Types.number;
    case 'delete':
      return Types.boolean;
    default:
      return Types.any();
  }
}

/**
 * Infer logical expression type
 */
export function inferLogicalExpression(
  expr: t.LogicalExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '&&':
    case '||':
      return Types.union([left, right]);

    case '??':
      if (left.kind === 'null' || left.kind === 'undefined') {
        return right;
      }
      if (left.kind === 'union') {
        const nonNullable = left.members.filter(
          (m) => m.kind !== 'null' && m.kind !== 'undefined'
        );
        if (nonNullable.length === 0) {
          return right;
        }
        return Types.union([...nonNullable, right]);
      }
      return left;

    default:
      return Types.any();
  }
}

/**
 * Infer call expression type
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

  // For function constructors, analyze the function body for `this` assignments
  if (calleeType.kind === 'function') {
    // Try to find the original function node to analyze this assignments
    if (t.isIdentifier(expr.callee)) {
      const binding = lookupBinding(state.env, expr.callee.name);
      if (binding?.declarationNode) {
        const funcNode = getFunctionFromBinding(binding.declarationNode);
        if (funcNode) {
          const instanceType = analyzeConstructorFunction(funcNode, state, ctx);
          return instanceType;
        }
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
 */
function analyzeConstructorFunction(
  func: t.FunctionDeclaration | t.FunctionExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const properties = new Map<string, ReturnType<typeof Types.property>>();

  if (!t.isBlockStatement(func.body)) {
    return Types.object({ properties });
  }

  // Create a state with parameters bound
  let funcEnv = createEnv(state.env, 'function');
  for (const param of func.params) {
    if (t.isIdentifier(param)) {
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
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

/**
 * Infer member expression type
 */
export function inferMemberExpression(
  expr: t.MemberExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const objectType = t.isExpression(expr.object)
    ? inferExpression(expr.object, state, ctx)
    : Types.any();

  let propName: string | undefined;
  if (t.isIdentifier(expr.property) && !expr.computed) {
    propName = expr.property.name;
  } else if (t.isStringLiteral(expr.property)) {
    propName = expr.property.value;
  }

  if (propName && objectType.kind === 'object') {
    const prop = objectType.properties.get(propName);
    if (prop) {
      return prop.type;
    }
  }

  if (objectType.kind === 'array') {
    if (t.isNumericLiteral(expr.property) && objectType.tuple) {
      const idx = expr.property.value;
      if (idx >= 0 && idx < objectType.tuple.length) {
        return objectType.tuple[idx]!;
      }
    }

    if (propName) {
      const elemType = objectType.elementType;
      const arrayMethods: Record<string, Type> = {
        length: Types.number,
        push: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        pop: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        shift: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        unshift: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        slice: Types.function({
          params: [
            Types.param('start', Types.number, { optional: true }),
            Types.param('end', Types.number, { optional: true }),
          ],
          returnType: Types.array(elemType),
        }),
        map: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.any() })
            ),
          ],
          returnType: Types.array(Types.any()),
        }),
        filter: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.array(elemType),
        }),
        find: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        includes: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.boolean,
        }),
        indexOf: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.number,
        }),
        join: Types.function({
          params: [Types.param('sep', Types.string, { optional: true })],
          returnType: Types.string,
        }),
        forEach: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({
                params: [Types.param('item', elemType)],
                returnType: Types.undefined,
              })
            ),
          ],
          returnType: Types.undefined,
        }),
        reduce: Types.function({
          params: [Types.param('fn', Types.any()), Types.param('init', Types.any(), { optional: true })],
          returnType: Types.any(),
        }),
      };
      if (arrayMethods[propName]) {
        return arrayMethods[propName]!;
      }
    }

    return objectType.elementType;
  }

  if (objectType.kind === 'string' && propName) {
    const stringMethods: Record<string, Type> = {
      length: Types.number,
      charAt: Types.function({
        params: [Types.param('index', Types.number)],
        returnType: Types.string,
      }),
      slice: Types.function({
        params: [
          Types.param('start', Types.number),
          Types.param('end', Types.number, { optional: true }),
        ],
        returnType: Types.string,
      }),
      split: Types.function({
        params: [Types.param('sep', Types.string)],
        returnType: Types.array(Types.string),
      }),
      toLowerCase: Types.function({ params: [], returnType: Types.string }),
      toUpperCase: Types.function({ params: [], returnType: Types.string }),
      trim: Types.function({ params: [], returnType: Types.string }),
      includes: Types.function({
        params: [Types.param('search', Types.string)],
        returnType: Types.boolean,
      }),
    };
    if (stringMethods[propName]) {
      return stringMethods[propName]!;
    }
  }

  return Types.any();
}

/**
 * Infer optional expression type
 */
function inferOptionalExpression(
  expr: t.OptionalMemberExpression | t.OptionalCallExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (t.isOptionalMemberExpression(expr)) {
    const objectType = inferExpression(expr.object, state, ctx);

    let propName: string | undefined;
    if (t.isIdentifier(expr.property) && !expr.computed) {
      propName = expr.property.name;
    }

    if (propName && objectType.kind === 'object') {
      const prop = objectType.properties.get(propName);
      if (prop) return prop.type;
    }
  } else if (t.isOptionalCallExpression(expr)) {
    const calleeType = inferExpression(expr.callee, state, ctx);
    if (calleeType.kind === 'function') {
      return calleeType.returnType;
    }
  }

  return Types.any();
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
 * Simple statement traversal to collect annotations (for nested functions)
 */
function collectAnnotationsFromStatement(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        const initType = decl.init ? inferExpression(decl.init, state, ctx) : Types.undefined;
        addAnnotation(ctx, {
          node: decl.id,
          name: decl.id.name,
          type: initType,
          kind: kind === 'const' ? 'const' : 'variable',
        });
      }
    }
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    const funcType = inferFunctionType(stmt, state, ctx);
    addAnnotation(ctx, {
      node: stmt.id,
      name: stmt.id.name,
      type: funcType,
      kind: 'function',
    });
  } else if (t.isBlockStatement(stmt)) {
    for (const s of stmt.body) {
      collectAnnotationsFromStatement(s, state, ctx);
    }
  } else if (t.isIfStatement(stmt)) {
    collectAnnotationsFromStatement(stmt.consequent, state, ctx);
    if (stmt.alternate) {
      collectAnnotationsFromStatement(stmt.alternate, state, ctx);
    }
  } else if (t.isForStatement(stmt)) {
    if (stmt.init && t.isVariableDeclaration(stmt.init)) {
      collectAnnotationsFromStatement(stmt.init, state, ctx);
    }
    collectAnnotationsFromStatement(stmt.body, state, ctx);
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    collectAnnotationsFromStatement(stmt.body, state, ctx);
  } else if (t.isTryStatement(stmt)) {
    collectAnnotationsFromStatement(stmt.block, state, ctx);
    if (stmt.handler) {
      collectAnnotationsFromStatement(stmt.handler.body, state, ctx);
    }
    if (stmt.finalizer) {
      collectAnnotationsFromStatement(stmt.finalizer, state, ctx);
    }
  }
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
  }
  return state;
}
