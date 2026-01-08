/**
 * Expression Type Inference - Infer types for expressions
 *
 * This module handles type inference for all JavaScript expression types.
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import { Types } from '../../utils/type-factory.js';
import type { InferContext } from './context.js';
import { lookupBinding, isArrayType, addBinding, createEnv } from './context.js';
import { addAnnotation } from './annotations.js';

/**
 * Infer type of an expression
 */
export function inferExpression(expr: t.Expression | t.SpreadElement, ctx: InferContext): Type {
  if (t.isSpreadElement(expr)) {
    const argType = inferExpression(expr.argument, ctx);
    return argType;
  }

  switch (expr.type) {
    // Literals
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
      return Types.object({ properties: new Map() }); // RegExp object

    // Template literals
    case 'TemplateLiteral':
      if (expr.expressions.length === 0 && expr.quasis.length === 1) {
        return Types.stringLiteral(expr.quasis[0]!.value.cooked ?? '');
      }
      return Types.string;

    // Identifier
    case 'Identifier':
      const binding = lookupBinding(ctx.env, expr.name);
      return binding?.type ?? Types.any(`undefined variable '${expr.name}'`);

    // Array
    case 'ArrayExpression':
      return inferArrayExpression(expr, ctx);

    // Object
    case 'ObjectExpression':
      return inferObjectExpression(expr, ctx);

    // Function expressions
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return inferFunctionType(expr, ctx);

    // Binary expressions
    case 'BinaryExpression':
      return inferBinaryExpression(expr, ctx);

    // Unary expressions
    case 'UnaryExpression':
      return inferUnaryExpression(expr, ctx);

    // Logical expressions
    case 'LogicalExpression':
      return inferLogicalExpression(expr, ctx);

    // Conditional expression
    case 'ConditionalExpression':
      const consequent = inferExpression(expr.consequent, ctx);
      const alternate = inferExpression(expr.alternate, ctx);
      return Types.union([consequent, alternate]);

    // Call expression
    case 'CallExpression':
      return inferCallExpression(expr, ctx);

    // New expression
    case 'NewExpression':
      return inferNewExpression(expr, ctx);

    // Member expression
    case 'MemberExpression':
      return inferMemberExpression(expr, ctx);

    // Assignment expression
    case 'AssignmentExpression':
      return inferExpression(expr.right, ctx);

    // Sequence expression
    case 'SequenceExpression':
      const last = expr.expressions[expr.expressions.length - 1];
      return last ? inferExpression(last, ctx) : Types.undefined;

    // Await expression
    case 'AwaitExpression':
      const awaitedType = inferExpression(expr.argument, ctx);
      if (awaitedType.kind === 'promise') {
        return awaitedType.resolvedType;
      }
      return awaitedType;

    // Yield expression
    case 'YieldExpression':
      return Types.any(); // Complex to infer

    // This expression
    case 'ThisExpression':
      return Types.any(); // Needs context

    // Class expression
    case 'ClassExpression':
      return inferClassType(expr, ctx);

    // Optional chaining
    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return Types.union([inferOptionalExpression(expr, ctx), Types.undefined]);

    // Nullish coalescing handled in LogicalExpression

    default:
      return Types.any();
  }
}

/**
 * Infer array expression type
 */
export function inferArrayExpression(expr: t.ArrayExpression, ctx: InferContext): Type {
  if (expr.elements.length === 0) {
    return Types.array(Types.never); // Empty array
  }

  const elementTypes: Type[] = [];
  let hasSpread = false;

  for (const elem of expr.elements) {
    if (elem === null) {
      elementTypes.push(Types.undefined); // Hole in array
    } else if (t.isSpreadElement(elem)) {
      hasSpread = true;
      const spreadType = inferExpression(elem.argument, ctx);
      if (spreadType.kind === 'array') {
        elementTypes.push(spreadType.elementType);
      } else {
        elementTypes.push(Types.any());
      }
    } else {
      elementTypes.push(inferExpression(elem, ctx));
    }
  }

  if (hasSpread) {
    // Cannot determine exact tuple type with spread
    return Types.array(Types.union(elementTypes));
  }

  // Create tuple type for small arrays with known elements
  if (elementTypes.length <= 10) {
    return Types.tuple(elementTypes);
  }

  return Types.array(Types.union(elementTypes));
}

/**
 * Infer object expression type
 */
export function inferObjectExpression(expr: t.ObjectExpression, ctx: InferContext): Type {
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
        const valueType = inferExpression(prop.value, ctx);
        properties.set(key, Types.property(valueType));
      }
    } else if (t.isObjectMethod(prop)) {
      let key: string | undefined;

      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      }

      if (key) {
        const methodType = inferFunctionType(prop, ctx);
        properties.set(key, Types.property(methodType));
      }
    } else if (t.isSpreadElement(prop)) {
      const spreadType = inferExpression(prop.argument, ctx);
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
 * Infer function type from function node
 */
export function inferFunctionType(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  ctx: InferContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // Infer return type from body
  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, ctx);
  } else if (t.isExpression(node.body)) {
    // Arrow function with expression body
    returnType = inferExpression(node.body, ctx);
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
 * Infer class method type
 */
export function inferClassMethodType(node: t.ClassMethod, ctx: InferContext): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // Infer return type from body
  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, ctx);
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
 * Infer return type from function body
 */
export function inferBlockReturnType(body: t.BlockStatement, ctx: InferContext): Type {
  const returnTypes: Type[] = [];

  // Simple traversal to find return statements
  for (const stmt of body.body) {
    collectReturnTypes(stmt, returnTypes, ctx);
  }

  if (returnTypes.length === 0) {
    return Types.undefined;
  }

  return Types.union(returnTypes);
}

function collectReturnTypes(node: t.Node, types: Type[], ctx: InferContext): void {
  if (t.isReturnStatement(node)) {
    if (node.argument) {
      types.push(inferExpression(node.argument, ctx));
    } else {
      types.push(Types.undefined);
    }
  } else if (t.isIfStatement(node)) {
    collectReturnTypes(node.consequent, types, ctx);
    if (node.alternate) {
      collectReturnTypes(node.alternate, types, ctx);
    }
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectReturnTypes(stmt, types, ctx);
    }
  } else if (t.isSwitchStatement(node)) {
    for (const c of node.cases) {
      for (const stmt of c.consequent) {
        collectReturnTypes(stmt, types, ctx);
      }
    }
  } else if (t.isTryStatement(node)) {
    collectReturnTypes(node.block, types, ctx);
    if (node.handler) {
      collectReturnTypes(node.handler.body, types, ctx);
    }
    if (node.finalizer) {
      collectReturnTypes(node.finalizer, types, ctx);
    }
  }
  // Skip loops and other control structures for simplicity
}

/**
 * Infer class type
 */
export function inferClassType(node: t.ClassDeclaration | t.ClassExpression, ctx: InferContext): Type {
  const className = node.id?.name ?? 'Anonymous';
  const instanceProps = new Map<string, ReturnType<typeof Types.property>>();
  const staticProps = new Map<string, ReturnType<typeof Types.property>>();
  let ctorType = Types.function({ params: [], returnType: Types.undefined });

  for (const member of node.body.body) {
    if (t.isClassMethod(member)) {
      const methodType = inferClassMethodType(member, ctx);

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
      const propType = member.value ? inferExpression(member.value, ctx) : Types.any();

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
 * Infer binary expression type
 */
export function inferBinaryExpression(expr: t.BinaryExpression, ctx: InferContext): Type {
  const left = t.isPrivateName(expr.left) ? Types.any() : inferExpression(expr.left, ctx);
  const right = inferExpression(expr.right, ctx);

  switch (expr.operator) {
    // Arithmetic
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

    // Comparison
    case '==':
    case '===':
    case '!=':
    case '!==':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return Types.boolean;

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
export function inferUnaryExpression(expr: t.UnaryExpression, ctx: InferContext): Type {
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
export function inferLogicalExpression(expr: t.LogicalExpression, ctx: InferContext): Type {
  const left = inferExpression(expr.left, ctx);
  const right = inferExpression(expr.right, ctx);

  switch (expr.operator) {
    case '&&':
      // Returns left if falsy, otherwise right
      return Types.union([left, right]);

    case '||':
      // Returns left if truthy, otherwise right
      return Types.union([left, right]);

    case '??':
      // Returns left if not null/undefined, otherwise right
      // Remove null/undefined from left type
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
export function inferCallExpression(expr: t.CallExpression, ctx: InferContext): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, ctx) : Types.any();

  if (calleeType.kind === 'function') {
    return calleeType.returnType;
  }

  return Types.any();
}

/**
 * Infer new expression type
 */
export function inferNewExpression(expr: t.NewExpression, ctx: InferContext): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, ctx) : Types.any();

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
export function inferMemberExpression(expr: t.MemberExpression, ctx: InferContext): Type {
  const objectType = t.isExpression(expr.object) ? inferExpression(expr.object, ctx) : Types.any();

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

  if (isArrayType(objectType)) {
    // Array index access
    if (t.isNumericLiteral(expr.property) && objectType.tuple) {
      const idx = expr.property.value;
      if (idx >= 0 && idx < objectType.tuple.length) {
        return objectType.tuple[idx]!;
      }
    }

    // Array methods
    if (propName) {
      const elemType = objectType.elementType;
      const arrayMethods: Record<string, Type> = {
        length: Types.number,
        push: Types.function({ params: [Types.param('item', elemType, { rest: true })], returnType: Types.number }),
        pop: Types.function({ params: [], returnType: Types.union([elemType, Types.undefined]) }),
        shift: Types.function({ params: [], returnType: Types.union([elemType, Types.undefined]) }),
        unshift: Types.function({ params: [Types.param('item', elemType, { rest: true })], returnType: Types.number }),
        slice: Types.function({ params: [Types.param('start', Types.number, { optional: true }), Types.param('end', Types.number, { optional: true })], returnType: Types.array(elemType) }),
        map: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.any() }))], returnType: Types.array(Types.any()) }),
        filter: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }))], returnType: Types.array(elemType) }),
        reduce: Types.function({ params: [Types.param('fn', Types.any()), Types.param('init', Types.any(), { optional: true })], returnType: Types.any() }),
        find: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }))], returnType: Types.union([elemType, Types.undefined]) }),
        includes: Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }),
        indexOf: Types.function({ params: [Types.param('item', elemType)], returnType: Types.number }),
        join: Types.function({ params: [Types.param('sep', Types.string, { optional: true })], returnType: Types.string }),
        forEach: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.undefined }))], returnType: Types.undefined }),
      };
      if (arrayMethods[propName]) {
        return arrayMethods[propName]!;
      }
    }

    return objectType.elementType;
  }

  // String methods
  if (objectType.kind === 'string' && propName) {
    const stringMethods: Record<string, Type> = {
      length: Types.number,
      charAt: Types.function({ params: [Types.param('index', Types.number)], returnType: Types.string }),
      slice: Types.function({ params: [Types.param('start', Types.number), Types.param('end', Types.number, { optional: true })], returnType: Types.string }),
      split: Types.function({ params: [Types.param('sep', Types.string)], returnType: Types.array(Types.string) }),
      toLowerCase: Types.function({ params: [], returnType: Types.string }),
      toUpperCase: Types.function({ params: [], returnType: Types.string }),
      trim: Types.function({ params: [], returnType: Types.string }),
      includes: Types.function({ params: [Types.param('search', Types.string)], returnType: Types.boolean }),
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
  ctx: InferContext
): Type {
  if (t.isOptionalMemberExpression(expr)) {
    const objectType = inferExpression(expr.object, ctx);

    let propName: string | undefined;
    if (t.isIdentifier(expr.property) && !expr.computed) {
      propName = expr.property.name;
    }

    if (propName && objectType.kind === 'object') {
      const prop = objectType.properties.get(propName);
      if (prop) return prop.type;
    }
  } else if (t.isOptionalCallExpression(expr)) {
    const calleeType = inferExpression(expr.callee, ctx);
    if (calleeType.kind === 'function') {
      return calleeType.returnType;
    }
  }

  return Types.any();
}
