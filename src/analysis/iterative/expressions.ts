/**
 * Expression Type Inference - Infer types for expressions
 *
 * This module handles type inference for all JavaScript expression types.
 * It serves as the central hub for expression type inference.
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext, HoistedDeclaration } from './context.js';
import { lookupBinding, updateBinding, createEnv } from './state.js';
import { addAnnotation } from './annotations.js';

// Forward declarations for functions that will be set by other modules
// This breaks the circular dependency by using late binding
let _inferBinaryExpression: (expr: t.BinaryExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferUnaryExpression: (expr: t.UnaryExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferLogicalExpression: (expr: t.LogicalExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferMemberExpression: (expr: t.MemberExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferOptionalExpression: (expr: t.OptionalMemberExpression | t.OptionalCallExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferCallExpression: (expr: t.CallExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferNewExpression: (expr: t.NewExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferClassType: (node: t.ClassDeclaration | t.ClassExpression, state: TypeState, ctx: IterativeContext) => Type;
let _inferFunctionType: (node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod, state: TypeState, ctx: IterativeContext) => Type;

// Registration functions for other modules to set their implementations
export function registerOperators(impl: {
  inferBinaryExpression: typeof _inferBinaryExpression;
  inferUnaryExpression: typeof _inferUnaryExpression;
  inferLogicalExpression: typeof _inferLogicalExpression;
}): void {
  _inferBinaryExpression = impl.inferBinaryExpression;
  _inferUnaryExpression = impl.inferUnaryExpression;
  _inferLogicalExpression = impl.inferLogicalExpression;
}

export function registerMembers(impl: {
  inferMemberExpression: typeof _inferMemberExpression;
  inferOptionalExpression: typeof _inferOptionalExpression;
}): void {
  _inferMemberExpression = impl.inferMemberExpression;
  _inferOptionalExpression = impl.inferOptionalExpression;
}

export function registerCalls(impl: {
  inferCallExpression: typeof _inferCallExpression;
  inferNewExpression: typeof _inferNewExpression;
}): void {
  _inferCallExpression = impl.inferCallExpression;
  _inferNewExpression = impl.inferNewExpression;
}

export function registerClasses(impl: {
  inferClassType: typeof _inferClassType;
}): void {
  _inferClassType = impl.inferClassType;
}

export function registerFunctions(impl: {
  inferFunctionType: typeof _inferFunctionType;
}): void {
  _inferFunctionType = impl.inferFunctionType;
}

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
      return _inferFunctionType(expr, state, ctx);

    case 'BinaryExpression':
      return _inferBinaryExpression(expr, state, ctx);

    case 'UnaryExpression':
      return _inferUnaryExpression(expr, state, ctx);

    case 'LogicalExpression':
      return _inferLogicalExpression(expr, state, ctx);

    case 'ConditionalExpression':
      const consequent = inferExpression(expr.consequent, state, ctx);
      const alternate = inferExpression(expr.alternate, state, ctx);
      return Types.union([consequent, alternate]);

    case 'CallExpression':
      return _inferCallExpression(expr, state, ctx);

    case 'NewExpression':
      return _inferNewExpression(expr, state, ctx);

    case 'MemberExpression':
      return _inferMemberExpression(expr, state, ctx);

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
      return _inferClassType(expr, state, ctx);

    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return Types.union([_inferOptionalExpression(expr, state, ctx), Types.undefined]);

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
        const methodType = _inferFunctionType(prop, state, ctx);
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
