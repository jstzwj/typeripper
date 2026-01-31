/**
 * Expression Type Inference
 * Infer types for JavaScript expressions
 */

import * as t from '@babel/types';
import type { Type } from '../../types/types.js';
import type { TypeState, TypeEnvironment } from '../../types/analysis.js';
import type { IterationContext } from './context.js';
import { lookupBinding } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import {
  isUnionType,
  isNeverType,
  isObjectType,
  isArrayType,
  isFunctionType,
  isClassType,
} from '../../types/types.js';
import { nullable, optional } from '../../utils/type-factory.js';

// ============================================================================
// Main Expression Inference
// ============================================================================

/**
 * Infer the type of an expression
 */
export function inferExpression(
  expr: t.Expression,
  state: TypeState,
  context: IterationContext
): Type {
  if (!state.reachable) {
    return Types.never();
  }

  // Handle literals (Babel types: StringLiteral, NumericLiteral, BooleanLiteral, etc.)
  if ('value' in expr && ('leading' in expr || 'innerComments' in expr || 'extra' in expr)) {
    return inferLiteral(expr as any);
  }

  if (expr.type === 'NullLiteral') {
    return Types.null();
  }

  switch (expr.type) {
    // Identifiers and member access
    case 'Identifier':
      return inferIdentifier(expr, state);

    case 'MemberExpression':
      return inferMemberExpression(expr, state, context);

    case 'OptionalMemberExpression':
      return inferOptionalMemberExpression(expr, state, context);

    case 'MetaProperty':
      return inferMetaProperty(expr);

    // Operators
    case 'BinaryExpression':
      return inferBinaryExpression(expr, state, context);

    case 'LogicalExpression':
      return inferLogicalExpression(expr, state, context);

    case 'UnaryExpression':
      return inferUnaryExpression(expr, state, context);

    case 'UpdateExpression':
      return inferUpdateExpression(expr, state, context);

    case 'AssignmentExpression':
      return inferAssignmentExpression(expr, state, context);

    // Conditionals
    case 'ConditionalExpression':
      return inferConditionalExpression(expr, state, context);

    // Functions and classes
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return inferFunctionExpression(expr, state, context);

    case 'NewExpression':
      return inferNewExpression(expr, state, context);

    case 'ClassExpression':
      return inferClassExpression(expr, state, context);

    // Objects and arrays
    case 'ObjectExpression':
      return inferObjectExpression(expr, state, context);

    case 'ArrayExpression':
      return inferArrayExpression(expr, state, context);

    // Calls
    case 'CallExpression':
      return inferCallExpression(expr, state, context);

    case 'OptionalCallExpression':
      return inferOptionalCallExpression(expr, state, context);

    // Sequences
    case 'SequenceExpression':
      return inferSequenceExpression(expr, state, context);

    // Templates
    case 'TemplateLiteral':
      return inferTemplateLiteral(expr, state, context);

    case 'TaggedTemplateExpression':
      return inferTaggedTemplateExpression(expr, state, context);

    // Spread and rest - these are handled separately since they're not Expressions
    // case 'SpreadElement':
    // case 'RestElement':

    // Super
    case 'Super':
      return inferSuper(expr, state);

    // Import
    case 'Import':
      return Types.object({}); // import() returns a Promise

    // Parenthesized
    case 'ParenthesizedExpression':
      return inferExpression(expr.expression, state, context);

    // Type annotations (TypeScript - ignore for JS)
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
      return inferExpression((expr as any).expression, state, context);

    default:
      return Types.unknown();
  }
}

// ============================================================================
// Literals
// ============================================================================

function inferLiteral(expr: t.StringLiteral | t.BooleanLiteral | t.NumericLiteral | t.BigIntLiteral | t.RegExpLiteral): Type {
  if (t.isStringLiteral(expr)) {
    return Types.string(expr.value);
  }

  if (t.isBooleanLiteral(expr)) {
    return Types.boolean(expr.value);
  }

  if (t.isNumericLiteral(expr)) {
    return Types.number(expr.value);
  }

  if (t.isBigIntLiteral(expr)) {
    return Types.bigint(BigInt(expr.value));
  }

  if (t.isRegExpLiteral(expr)) {
    // RegExp is an instance of RegExp
    return Types.object({
      properties: Object.fromEntries([
        ['test', Types.property(Types.function({
          params: [Types.param('str', Types.string())],
          returnType: Types.boolean(),
        }))],
        ['exec', Types.property(Types.function({
          params: [Types.param('str', Types.string())],
          returnType: Types.union(Types.object({}), Types.null()),
        }))],
      ]),
    });
  }

  return Types.unknown();
}

// ============================================================================
// Identifiers
// ============================================================================

function inferIdentifier(expr: t.Identifier, state: TypeState): Type {
  const binding = lookupBinding(state.env, expr.name);

  if (binding) {
    return binding.type;
  }

  // Check for built-in globals
  return getBuiltinType(expr.name) ?? Types.unknown();
}

function getBuiltinType(name: string): Type | null {
  const builtins: Record<string, () => Type> = {
    'undefined': () => Types.undefined(),
    'NaN': () => Types.number(NaN),
    'Infinity': () => Types.number(Infinity),
    'Object': () => Types.function({ params: [], returnType: Types.object({}) }),
    'Array': () => Types.function({ params: [], returnType: Types.array(Types.unknown()) }),
    'String': () => Types.function({ params: [], returnType: Types.string() }),
    'Number': () => Types.function({ params: [], returnType: Types.number() }),
    'Boolean': () => Types.function({ params: [], returnType: Types.boolean() }),
    'Symbol': () => Types.function({ params: [], returnType: Types.symbol() }),
    'Math': () => Types.object({}),
    'console': () => Types.object({}),
    'JSON': () => Types.object({}),
    'Date': () => Types.function({ params: [], returnType: Types.object({}) }),
    'Error': () => Types.function({ params: [], returnType: Types.object({}) }),
    'RegExp': () => Types.function({ params: [], returnType: Types.object({}) }),
    'Map': () => Types.function({ params: [], returnType: Types.object({}) }),
    'Set': () => Types.function({ params: [], returnType: Types.object({}) }),
    'Promise': () => Types.function({ params: [], returnType: Types.object({}) }),
    'parseInt': () => Types.function({
      params: [Types.param('str', Types.string())],
      returnType: Types.number(),
    }),
    'parseFloat': () => Types.function({
      params: [Types.param('str', Types.string())],
      returnType: Types.number(),
    }),
    'isNaN': () => Types.function({
      params: [Types.param('value', Types.unknown())],
      returnType: Types.boolean(),
    }),
    'isFinite': () => Types.function({
      params: [Types.param('value', Types.unknown())],
      returnType: Types.boolean(),
    }),
    'eval': () => Types.function({
      params: [Types.param('code', Types.string())],
      returnType: Types.unknown(),
    }),
    'typeof': () => Types.function({
      params: [Types.param('value', Types.unknown())],
      returnType: Types.string(),
    }),
    'instanceof': () => Types.function({
      params: [Types.param('obj', Types.unknown()), Types.param('ctor', Types.unknown())],
      returnType: Types.boolean(),
    }),
    'delete': () => Types.function({
      params: [Types.param('prop', Types.unknown())],
      returnType: Types.boolean(),
    }),
    'void': () => Types.function({
      params: [Types.param('value', Types.unknown())],
      returnType: Types.undefined(),
    }),
  };

  const fn = builtins[name];
  return fn ? fn() : null;
}

// ============================================================================
// Member Expression
// ============================================================================

function inferMemberExpression(
  expr: t.MemberExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const objectType = inferExpression(expr.object, state, context);

  if (isNeverType(objectType)) {
    return Types.never();
  }

  // Get property name
  let propertyName: string | null = null;

  if (expr.computed) {
    if (t.isExpression(expr.property)) {
      const propType = inferExpression(expr.property, state, context);
    }
    // For computed properties with string literal, extract the value
    if (t.isStringLiteral(expr.property)) {
      propertyName = expr.property.value;
    }
  } else if (t.isIdentifier(expr.property)) {
    propertyName = expr.property.name;
  }

  if (!propertyName) {
    // Computed property with non-literal key - return unknown
    return Types.unknown();
  }

  // Look up property in object type
  return getPropertyType(objectType, propertyName);
}

function inferOptionalMemberExpression(
  expr: t.OptionalMemberExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const objectType = inferExpression(expr.object, state, context);

  // Handle optional chaining - result is nullable
  const result = inferMemberExpression(expr as any, state, context);

  if (isUnionType(objectType) && objectType.members.some(m => m.kind === 'null' || m.kind === 'undefined')) {
    return nullable(result);
  }

  return result;
}

function inferMetaProperty(expr: t.MetaProperty): Type {
  if (expr.meta.type === 'Identifier' && expr.property.type === 'Identifier') {
    if (expr.meta.name === 'new' && expr.property.name === 'target') {
      return Types.function({ params: [], returnType: Types.object({}) });
    }
    if (expr.meta.name === 'import' && expr.property.name === 'meta') {
      return Types.object({});
    }
  }
  return Types.unknown();
}

function getPropertyType(objectType: Type, propertyName: string): Type {
  if (isObjectType(objectType)) {
    const prop = objectType.properties.get(propertyName);
    if (prop) {
      return prop.type;
    }
  }

  if (isClassType(objectType)) {
    // Check instance properties
    const instanceProp = objectType.instanceType.properties.get(propertyName);
    if (instanceProp) {
      return instanceProp.type;
    }

    // Check static properties
    const staticProp = objectType.staticProperties.get(propertyName);
    if (staticProp) {
      return staticProp.type;
    }

    // Check prototype chain
    if (objectType.superClass) {
      return getPropertyType(objectType.superClass, propertyName);
    }
  }

  if (isArrayType(objectType)) {
    if (propertyName === 'length') {
      return Types.number();
    }
    // Array methods
    return getArrayTypeMethod(propertyName, objectType.elementType);
  }

  if (isFunctionType(objectType)) {
    if (propertyName === 'prototype') {
      return Types.object({});
    }
    if (propertyName === 'length') {
      return Types.number();
    }
    if (propertyName === 'name') {
      return Types.string();
    }
    if (propertyName === 'bind' || propertyName === 'call' || propertyName === 'apply') {
      return Types.function({ params: [], returnType: Types.unknown() });
    }
  }

  // Check for common built-in methods
  return getBuiltinMethodType(objectType, propertyName);
}

function getArrayTypeMethod(methodName: string, elementType: Type): Type {
  const methods: Record<string, () => Type> = {
    'push': () => Types.function({
      params: [Types.param('items', elementType, false, true)],
      returnType: Types.number(),
    }),
    'pop': () => Types.function({
      params: [],
      returnType: optional(elementType),
    }),
    'map': () => Types.function({
      params: [Types.param('callback', Types.function({
        params: [Types.param('item', elementType), Types.param('index', Types.number()), Types.param('arr', Types.array(elementType))],
        returnType: Types.unknown(),
      }))],
      returnType: Types.array(Types.unknown()),
    }),
    'filter': () => Types.function({
      params: [Types.param('callback', Types.function({
        params: [Types.param('item', elementType), Types.param('index', Types.number()), Types.param('arr', Types.array(elementType))],
        returnType: Types.boolean(),
      }))],
      returnType: Types.array(elementType),
    }),
    'reduce': () => Types.function({
      params: [Types.param('callback', Types.function({
        params: [Types.param('acc', Types.unknown()), Types.param('item', elementType), Types.param('index', Types.number()), Types.param('arr', Types.array(elementType))],
        returnType: Types.unknown(),
      }))],
      returnType: Types.unknown(),
    }),
    'forEach': () => Types.function({
      params: [Types.param('callback', Types.function({
        params: [Types.param('item', elementType), Types.param('index', Types.number()), Types.param('arr', Types.array(elementType))],
        returnType: Types.undefined(),
      }))],
      returnType: Types.undefined(),
    }),
    'find': () => Types.function({
      params: [Types.param('callback', Types.function({
        params: [Types.param('item', elementType), Types.param('index', Types.number()), Types.param('arr', Types.array(elementType))],
        returnType: Types.boolean(),
      }))],
      returnType: optional(elementType),
    }),
    'includes': () => Types.function({
      params: [Types.param('item', elementType)],
      returnType: Types.boolean(),
    }),
    'indexOf': () => Types.function({
      params: [Types.param('item', elementType)],
      returnType: Types.number(),
    }),
    'join': () => Types.function({
      params: [Types.param('separator', Types.string())],
      returnType: Types.string(),
    }),
    'slice': () => Types.function({
      params: [Types.param('start', Types.number()), Types.param('end', Types.number())],
      returnType: Types.array(elementType),
    }),
    'splice': () => Types.function({
      params: [Types.param('start', Types.number()), Types.param('deleteCount', Types.number())],
      returnType: Types.array(elementType),
    }),
    'reverse': () => Types.function({
      params: [],
      returnType: Types.array(elementType),
    }),
    'sort': () => Types.function({
      params: [Types.param('compareFn', Types.function({
        params: [Types.param('a', elementType), Types.param('b', elementType)],
        returnType: Types.number(),
      }))],
      returnType: Types.array(elementType),
    }),
    'toString': () => Types.function({
      params: [],
      returnType: Types.string(),
    }),
    'at': () => Types.function({
      params: [Types.param('index', Types.number())],
      returnType: optional(elementType),
    }),
  };

  const fn = methods[methodName];
  return fn ? fn() : Types.unknown();
}

function getBuiltinMethodType(objectType: Type, methodName: string): Type {
  // Common object methods
  const objectMethods: Record<string, () => Type> = {
    'toString': () => Types.function({ params: [], returnType: Types.string() }),
    'valueOf': () => Types.function({ params: [], returnType: Types.unknown() }),
    'hasOwnProperty': () => Types.function({
      params: [Types.param('prop', Types.string())],
      returnType: Types.boolean(),
    }),
  };

  const fn = objectMethods[methodName];
  return fn ? fn() : Types.unknown();
}

// ============================================================================
// Binary Expressions
// ============================================================================

function inferBinaryExpression(
  expr: t.BinaryExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const leftType = t.isExpression(expr.left) ? inferExpression(expr.left, state, context) : Types.unknown();
  const rightType = t.isExpression(expr.right) ? inferExpression(expr.right, state, context) : Types.unknown();

  switch (expr.operator) {
    // Arithmetic operators
    case '+':
      // String concatenation if either operand is string
      if (leftType.kind === 'string' || rightType.kind === 'string') {
        return Types.string();
      }
      return Types.number();

    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
      return Types.number();

    case '<<':
    case '>>':
    case '>>>':
    case '&':
    case '|':
    case '^':
      return Types.number();

    // Comparison operators
    case '<':
    case '<=':
    case '>':
    case '>=':
      return Types.boolean();

    // Equality operators
    case '==':
    case '===':
    case '!=':
    case '!==':
      return Types.boolean();

    // in operator
    case 'in':
      return Types.boolean();

    // instanceof operator
    case 'instanceof':
      return Types.boolean();

    default:
      return Types.unknown();
  }
}

// ============================================================================
// Logical Expressions
// ============================================================================

function inferLogicalExpression(
  expr: t.LogicalExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const leftType = inferExpression(expr.left, state, context);
  const rightType = inferExpression(expr.right, state, context);

  switch (expr.operator) {
    case '&&':
      // Short-circuit AND - result is right type if left is truthy
      return joinTypes(leftType, rightType);

    case '||':
      // Short-circuit OR - result is left type if truthy, right if falsy
      return joinTypes(leftType, rightType);

    case '??':
      // Nullish coalescing - result is right type if left is nullish
      return joinTypes(removeNullish(leftType), rightType);

    default:
      return Types.unknown();
  }
}

function joinTypes(t1: Type, t2: Type): Type {
  if (t1.id === t2.id) return t1;
  if (isNeverType(t1)) return t2;
  if (isNeverType(t2)) return t1;
  if (isUnionType(t1) && isUnionType(t2)) {
    return Types.union(...t1.members, ...t2.members);
  }
  if (isUnionType(t1)) {
    return Types.union(...t1.members, t2);
  }
  if (isUnionType(t2)) {
    return Types.union(t1, ...t2.members);
  }
  return Types.union(t1, t2);
}

function removeNullish(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(t => t.kind !== 'null' && t.kind !== 'undefined');
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  return type;
}

// ============================================================================
// Unary Expressions
// ============================================================================

function inferUnaryExpression(
  expr: t.UnaryExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const argType = inferExpression(expr.argument, state, context);

  switch (expr.operator) {
    case '-':
    case '+':
      return Types.number();

    case '!':
      return Types.boolean();

    case '~':
      return Types.number();

    case 'typeof':
      return Types.string();

    case 'void':
      return Types.undefined();

    case 'delete':
      return Types.boolean();

    default:
      return Types.unknown();
  }
}

// ============================================================================
// Update Expressions
// ============================================================================

function inferUpdateExpression(
  expr: t.UpdateExpression,
  state: TypeState,
  context: IterationContext
): Type {
  // Update expressions always return number
  return Types.number();
}

// ============================================================================
// Assignment Expressions
// ============================================================================

function inferAssignmentExpression(
  expr: t.AssignmentExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const rightType = inferExpression(expr.right, state, context);

  // For compound assignments, infer left type first
  if (expr.operator !== '=' && t.isExpression(expr.left)) {
    inferExpression(expr.left, state, context);
  }

  return rightType;
}

// ============================================================================
// Conditional Expression
// ============================================================================

function inferConditionalExpression(
  expr: t.ConditionalExpression,
  state: TypeState,
  context: IterationContext
): Type {
  // Infer test
  inferExpression(expr.test, state, context);

  // Infer consequent and alternate
  const consequentType = inferExpression(expr.consequent, state, context);
  const alternateType = inferExpression(expr.alternate, state, context);

  // Result is union of both branches
  return joinTypes(consequentType, alternateType);
}

// ============================================================================
// Function Expression
// ============================================================================

function inferFunctionExpression(
  expr: t.FunctionExpression | t.ArrowFunctionExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const params = expr.params.map((param, i) => {
    let name = '';
    let optional = false;
    let rest = false;

    if (t.isIdentifier(param)) {
      name = param.name;
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      name = param.argument.name;
      rest = true;
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      name = param.left.name;
      optional = true;
    }

    return Types.param(name, Types.unknown(), optional, rest);
  });

  // Infer return type
  const returnType = inferReturnTypeFromBody(expr.body, state, context);

  // Analyze captures
  const captures = analyzeCapturesFromFunction(expr, state);

  return Types.function({
    params,
    returnType,
    isAsync: expr.async,
    isGenerator: expr.generator,
    captures,
  });
}

function inferReturnTypeFromBody(
  body: t.BlockStatement | t.Expression,
  state: TypeState,
  context: IterationContext
): Type {
  const returnTypes: Type[] = [];

  const collectReturns = (node: t.Node) => {
    if (t.isReturnStatement(node)) {
      if (node.argument) {
        returnTypes.push(inferExpression(node.argument, state, context));
      } else {
        returnTypes.push(Types.undefined());
      }
      return;
    }

    // Don't traverse into nested functions
    if (t.isFunction(node)) {
      return;
    }

    if (t.isBlockStatement(node)) {
      node.body.forEach(collectReturns);
    } else if (t.isExpression(node)) {
      // For arrow function with expression body
      returnTypes.push(inferExpression(node, state, context));
    }
  };

  if (t.isBlockStatement(body)) {
    body.body.forEach(collectReturns);
  } else {
    returnTypes.push(inferExpression(body, state, context));
  }

  if (returnTypes.length === 0) {
    return Types.undefined();
  }

  return returnTypes.length === 1 ? returnTypes[0]! : Types.union(...returnTypes);
}

function analyzeCapturesFromFunction(
  fn: t.FunctionExpression | t.ArrowFunctionExpression,
  state: TypeState
): Map<string, Type> {
  const captures = new Map<string, Type>();
  const paramNames = new Set(
    fn.params
      .filter((p): p is t.Identifier => t.isIdentifier(p))
      .map(p => p.name)
  );

  const findCaptures = (node: t.Node) => {
    if (t.isIdentifier(node)) {
      if (!paramNames.has(node.name)) {
        const binding = lookupBinding(state.env, node.name);
        if (binding) {
          captures.set(node.name, binding.type);
        }
      }
    }

    if (t.isFunction(node)) {
      return;
    }

    if ('body' in node && Array.isArray(node.body)) {
      node.body.forEach(findCaptures);
    }
  };

  findCaptures(fn);
  return captures;
}

// ============================================================================
// New Expression
// ============================================================================

function inferNewExpression(
  expr: t.NewExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, state, context) : Types.unknown();

  if (isClassType(calleeType)) {
    return calleeType.instanceType;
  }

  if (isFunctionType(calleeType)) {
    return calleeType.returnType;
  }

  return Types.object({});
}

// ============================================================================
// Class Expression
// ============================================================================

function inferClassExpression(
  expr: t.ClassExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const className = expr.id?.name ?? '(anonymous)';

  // Similar to class declaration
  const instanceProperties = new Map<string, any>();
  const staticProperties = new Map<string, any>();

  for (const elem of expr.body.body) {
    // Process class elements...
  }

  const instanceType = Types.object({
    properties: Object.fromEntries(instanceProperties),
  });

  return Types.class({
    name: className,
    constructor: Types.function({ params: [], returnType: instanceType }),
    instanceType,
    staticProperties: Object.fromEntries(staticProperties),
  });
}

// ============================================================================
// Object Expression
// ============================================================================

function inferObjectExpression(
  expr: t.ObjectExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const properties = new Map<string, any>();

  for (const prop of expr.properties) {
    if (t.isSpreadElement(prop)) {
      // Spread element - merge properties
      const spreadType = inferExpression(prop.argument, state, context);
      if (isObjectType(spreadType)) {
        for (const [key, value] of spreadType.properties) {
          properties.set(key, value);
        }
      }
    } else if (t.isObjectProperty(prop)) {
      let key = '';
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      } else if (t.isNumericLiteral(prop.key)) {
        key = String(prop.key.value);
      }

      const valueType = t.isExpression(prop.value) ? inferExpression(prop.value, state, context) : Types.unknown();
      properties.set(key, Types.property(valueType));
    } else if (t.isObjectMethod(prop)) {
      let key = '';
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      }

      const methodType = Types.function({
        params: [],
        returnType: Types.unknown(),
        isAsync: prop.async,
        isGenerator: prop.generator,
      });
      properties.set(key, Types.property(methodType));
    }
  }

  return Types.object({
    properties: Object.fromEntries(properties),
  });
}

// ============================================================================
// Array Expression
// ============================================================================

function inferArrayExpression(
  expr: t.ArrayExpression,
  state: TypeState,
  context: IterationContext
): Type {
  if (expr.elements.length === 0) {
    return Types.array(Types.unknown());
  }

  const elementTypes: Type[] = [];

  for (const elem of expr.elements) {
    if (elem === null) {
      // Holes in sparse arrays
      continue;
    }

    if (t.isSpreadElement(elem)) {
      const spreadType = inferExpression(elem.argument, state, context);
      if (isArrayType(spreadType)) {
        elementTypes.push(spreadType.elementType);
      } else {
        elementTypes.push(spreadType);
      }
    } else {
      elementTypes.push(inferExpression(elem, state, context));
    }
  }

  if (elementTypes.length === 0) {
    return Types.array(Types.unknown());
  }

  // Join all element types
  const elementType = elementTypes.length === 1
    ? elementTypes[0]!
    : Types.union(...elementTypes);

  return Types.array(elementType);
}

// ============================================================================
// Call Expression
// ============================================================================

function inferCallExpression(
  expr: t.CallExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, state, context) : Types.unknown();

  if (isFunctionType(calleeType)) {
    return calleeType.returnType;
  }

  if (isObjectType(calleeType)) {
    // Check for callable object (has [[Call]] internal method)
    const callProp = calleeType.properties.get('call');
    if (callProp && isFunctionType(callProp.type)) {
      return callProp.type.returnType;
    }
  }

  // Member call like obj.method()
  if (t.isMemberExpression(expr.callee)) {
    const objType = inferExpression(expr.callee.object, state, context);
    let methodName = '';

    if (t.isIdentifier(expr.callee.property)) {
      methodName = expr.callee.property.name;
    }

    if (methodName && isObjectType(objType)) {
      const method = objType.properties.get(methodName);
      if (method && isFunctionType(method.type)) {
        return method.type.returnType;
      }
    }
  }

  return Types.unknown();
}

function inferOptionalCallExpression(
  expr: t.OptionalCallExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const result = inferCallExpression(expr as any, state, context);
  return nullable(result);
}

// ============================================================================
// Sequence Expression
// ============================================================================

function inferSequenceExpression(
  expr: t.SequenceExpression,
  state: TypeState,
  context: IterationContext
): Type {
  // Return type of last expression
  return inferExpression(expr.expressions[expr.expressions.length - 1]!, state, context);
}

// ============================================================================
// Template Literal
// ============================================================================

function inferTemplateLiteral(
  expr: t.TemplateLiteral,
  state: TypeState,
  context: IterationContext
): Type {
  return Types.string();
}

function inferTaggedTemplateExpression(
  expr: t.TaggedTemplateExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const tagType = inferExpression(expr.tag, state, context);

  if (isFunctionType(tagType)) {
    return tagType.returnType;
  }

  return Types.unknown();
}

// ============================================================================
// Spread Element
// ============================================================================

function inferSpreadElement(
  expr: t.SpreadElement,
  state: TypeState,
  context: IterationContext
): Type {
  return inferExpression(expr.argument, state, context);
}

// ============================================================================
// Rest Element
// ============================================================================

function inferRestElement(
  expr: t.RestElement,
  state: TypeState,
  context: IterationContext
): Type {
  return Types.array(Types.unknown());
}

// ============================================================================
// Super
// ============================================================================

function inferSuper(expr: t.Super, state: TypeState): Type {
  // super refers to parent class
  return Types.object({});
}
