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

  // Create function state for simple traversal
  const funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  // Simple traversal to collect annotations (without full iterative analysis)
  for (const stmt of statements) {
    collectAnnotationsFromStatement(stmt, funcState, ctx);
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

  // Collect all variable declarations in function body for return type inference
  // Also adds annotations for each local variable
  if (t.isBlockStatement(node.body)) {
    funcEnv = collectDeclarationsInBlock(node.body, funcEnv, ctx);
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
 * Collect all variable declarations in a block (for return type inference)
 * Also adds annotations for each declaration
 */
export function collectDeclarationsInBlock(
  block: t.BlockStatement,
  env: TypeEnvironment,
  ctx?: IterativeContext
): TypeEnvironment {
  let result = env;

  for (const stmt of block.body) {
    result = collectDeclarationsInStatement(stmt, result, ctx);
  }

  return result;
}

/**
 * Recursively collect declarations from a statement
 * Also adds annotations for each declaration
 */
function collectDeclarationsInStatement(
  stmt: t.Statement,
  env: TypeEnvironment,
  ctx?: IterativeContext
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
            initType = Types.numberLiteral(decl.init.value);
          } else if (t.isStringLiteral(decl.init)) {
            initType = Types.stringLiteral(decl.init.value);
          } else if (t.isBooleanLiteral(decl.init)) {
            initType = Types.booleanLiteral(decl.init.value);
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
    // Collect declarations in for init
    if (t.isVariableDeclaration(stmt.init)) {
      result = collectDeclarationsInStatement(stmt.init, result, ctx);
    }
    // Collect declarations in for body
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx);
    }
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx);
    }
  } else if (t.isIfStatement(stmt)) {
    if (t.isBlockStatement(stmt.consequent)) {
      result = collectDeclarationsInBlock(stmt.consequent, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.consequent, result, ctx);
    }
    if (stmt.alternate) {
      if (t.isBlockStatement(stmt.alternate)) {
        result = collectDeclarationsInBlock(stmt.alternate, result, ctx);
      } else {
        result = collectDeclarationsInStatement(stmt.alternate, result, ctx);
      }
    }
  } else if (t.isTryStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt.block, result, ctx);
    if (stmt.handler) {
      result = collectDeclarationsInBlock(stmt.handler.body, result, ctx);
    }
    if (stmt.finalizer) {
      result = collectDeclarationsInBlock(stmt.finalizer, result, ctx);
    }
  } else if (t.isSwitchStatement(stmt)) {
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        result = collectDeclarationsInStatement(s, result, ctx);
      }
    }
  } else if (t.isBlockStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt, result, ctx);
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

  for (const member of node.body.body) {
    if (t.isClassMethod(member)) {
      const methodType = inferClassMethodType(member, state, ctx);

      if (member.kind === 'constructor') {
        if (methodType.kind === 'function') {
          ctorType = methodType;
        }
      } else {
        const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
        if (member.static) {
          staticProps.set(name, Types.property(methodType));
        } else {
          instanceProps.set(name, Types.property(methodType));
        }
      }
    } else if (t.isClassProperty(member)) {
      const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
      const propType = member.value ? inferExpression(member.value, state, ctx) : Types.any();

      if (member.static) {
        staticProps.set(name, Types.property(propType));
      } else {
        instanceProps.set(name, Types.property(propType));
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
      if (left.kind === 'string' || right.kind === 'string') {
        return Types.string;
      }
      if (left.kind === 'number' && right.kind === 'number') {
        if (left.value !== undefined && right.value !== undefined) {
          return Types.numberLiteral(left.value + right.value);
        }
        return Types.number;
      }
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

  if (calleeType.kind === 'function') {
    return Types.object({});
  }

  return Types.object({});
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
