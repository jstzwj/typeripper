/**
 * Expression Type Inference
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Implements P(Π; e) - the inference judgment for expressions.
 */

import type { Expression, Node } from '@babel/types';
import type { PolarType, FunctionType, RecordType, ArrayType } from '../types/index.js';
import {
  boolean,
  number,
  string,
  nullType,
  undefined_,
  bigint,
  any,
  param,
  record,
  field,
  array,
  tuple,
  union,
  promise,
} from '../types/factory.js';
import type { ConstraintSet } from '../solver/index.js';
import {
  emptyConstraintSet,
  mergeConstraintSets,
  addConstraint,
  flow,
} from '../solver/index.js';
import type { InferResult, StatementResult } from './context.js';
import {
  InferenceContext,
  inferType,
  inferResult,
  nodeToSource,
} from './context.js';
import { inferStatements } from './statements.js';

// ============================================================================
// Main Expression Inference
// ============================================================================

/**
 * Infer the type of an expression
 *
 * P(Π; e) = [Δ]τ
 */
export function inferExpression(ctx: InferenceContext, expr: Expression): InferResult {
  switch (expr.type) {
    // Literals
    case 'Identifier':
      return inferIdentifier(ctx, expr);

    case 'NullLiteral':
      return inferType(nullType);

    case 'BooleanLiteral':
      return inferType(boolean);

    case 'NumericLiteral':
      return inferType(number);

    case 'StringLiteral':
      return inferType(string);

    case 'BigIntLiteral':
      return inferType(bigint);

    case 'RegExpLiteral':
      return inferType(any);

    case 'TemplateLiteral':
      return inferTemplateLiteral(ctx, expr);

    case 'TaggedTemplateExpression':
      return inferTaggedTemplate(ctx, expr);

    // Compound expressions
    case 'ArrayExpression':
      return inferArrayExpression(ctx, expr);

    case 'ObjectExpression':
      return inferObjectExpression(ctx, expr);

    // Function expressions
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return inferFunctionExpression(ctx, expr);

    // Calls and member access
    case 'CallExpression':
      return inferCallExpression(ctx, expr);

    case 'NewExpression':
      return inferNewExpression(ctx, expr);

    case 'MemberExpression':
      return inferMemberExpression(ctx, expr);

    case 'OptionalMemberExpression':
      return inferOptionalMemberExpression(ctx, expr);

    case 'OptionalCallExpression':
      return inferOptionalCallExpression(ctx, expr);

    // Operators
    case 'BinaryExpression':
      return inferBinaryExpression(ctx, expr);

    case 'UnaryExpression':
      return inferUnaryExpression(ctx, expr);

    case 'UpdateExpression':
      return inferUpdateExpression(ctx, expr);

    case 'LogicalExpression':
      return inferLogicalExpression(ctx, expr);

    case 'ConditionalExpression':
      return inferConditionalExpression(ctx, expr);

    case 'AssignmentExpression':
      return inferAssignmentExpression(ctx, expr);

    case 'SequenceExpression':
      return inferSequenceExpression(ctx, expr);

    // Async/await
    case 'AwaitExpression':
      return inferAwaitExpression(ctx, expr);

    case 'YieldExpression':
      return inferYieldExpression(ctx, expr);

    // Special
    case 'ThisExpression':
      return inferThisExpression(ctx);

    case 'Super':
      return inferType(any);

    // SpreadElement is not an Expression, but handled in array/call contexts
    // case 'SpreadElement':
    //   return inferSpreadElement(ctx, expr);

    case 'ParenthesizedExpression':
      return inferExpression(ctx, (expr as any).expression);

    // Class expression
    case 'ClassExpression':
      return inferClassExpression(ctx, expr);

    // Misc
    case 'MetaProperty':
      return inferMetaProperty(ctx, expr);

    case 'Import':
      return inferType(promise(any));

    // TypeScript specific - ignore type info, infer from value
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
      return inferExpression(ctx, (expr as any).expression);

    case 'TSInstantiationExpression':
      return inferExpression(ctx, (expr as any).expression);

    // Fallback for other expressions
    default:
      return inferType(ctx.fresh('expr'));
  }
}

// ============================================================================
// Identifier Inference
// ============================================================================

function inferIdentifier(ctx: InferenceContext, id: { name: string }): InferResult {
  const scheme = ctx.lookup(id.name);

  if (!scheme) {
    const freshVar = ctx.fresh(id.name);
    return inferType(freshVar);
  }

  const type = ctx.instantiate(scheme);
  return inferType(type);
}

// ============================================================================
// Literal Expressions
// ============================================================================

function inferTemplateLiteral(ctx: InferenceContext, expr: any): InferResult {
  let constraints = emptyConstraintSet();
  for (const e of expr.expressions) {
    const result = inferExpression(ctx, e);
    constraints = mergeConstraintSets(constraints, result.constraints);
  }
  return inferResult(string, constraints);
}

function inferTaggedTemplate(ctx: InferenceContext, expr: any): InferResult {
  const tagResult = inferExpression(ctx, expr.tag);
  let constraints = tagResult.constraints;

  for (const e of expr.quasi.expressions) {
    const result = inferExpression(ctx, e);
    constraints = mergeConstraintSets(constraints, result.constraints);
  }

  const retVar = ctx.fresh('tagged');
  return inferResult(retVar, constraints);
}

// ============================================================================
// Compound Expressions
// ============================================================================

function inferArrayExpression(ctx: InferenceContext, expr: any): InferResult {
  let constraints = emptyConstraintSet();
  const elementTypes: PolarType[] = [];
  let hasSpread = false;

  for (const elem of expr.elements) {
    if (elem === null) {
      elementTypes.push(undefined_);
    } else if (elem.type === 'SpreadElement') {
      hasSpread = true;
      const spreadResult = inferExpression(ctx, elem.argument);
      constraints = mergeConstraintSets(constraints, spreadResult.constraints);
      elementTypes.push(spreadResult.type);
    } else {
      const elemResult = inferExpression(ctx, elem);
      constraints = mergeConstraintSets(constraints, elemResult.constraints);
      elementTypes.push(elemResult.type);
    }
  }

  if (hasSpread || elementTypes.length > 10) {
    const elemType = elementTypes.length > 0 ? union(elementTypes) : undefined_;
    return inferResult(array(elemType), constraints);
  }

  return inferResult(tuple(elementTypes), constraints);
}

function inferObjectExpression(ctx: InferenceContext, expr: any): InferResult {
  let constraints = emptyConstraintSet();
  const fields = new Map<string, { type: PolarType; optional: boolean; readonly: boolean }>();
  let hasSpread = false;

  for (const prop of expr.properties) {
    if (prop.type === 'SpreadElement') {
      hasSpread = true;
      const spreadResult = inferExpression(ctx, prop.argument);
      constraints = mergeConstraintSets(constraints, spreadResult.constraints);
    } else if (prop.type === 'ObjectMethod') {
      const methodType = inferObjectMethod(ctx, prop);
      constraints = mergeConstraintSets(constraints, methodType.constraints);

      const key = getPropertyKey(prop);
      if (key) {
        fields.set(key, { type: methodType.type, optional: false, readonly: false });
      }
    } else {
      const key = getPropertyKey(prop);
      if (key && prop.value?.type !== 'AssignmentPattern') {
        const valueResult = inferExpression(ctx, prop.value);
        constraints = mergeConstraintSets(constraints, valueResult.constraints);
        fields.set(key, { type: valueResult.type, optional: false, readonly: false });
      } else if (key && prop.value?.type === 'AssignmentPattern') {
        const defaultResult = inferExpression(ctx, prop.value.right);
        constraints = mergeConstraintSets(constraints, defaultResult.constraints);
        fields.set(key, { type: defaultResult.type, optional: true, readonly: false });
      }
    }
  }

  const fieldMap = new Map<string, { type: PolarType; optional: boolean; readonly: boolean }>();
  for (const [name, f] of fields) {
    fieldMap.set(name, field(f.type, { optional: f.optional, readonly: f.readonly }));
  }

  const rest = hasSpread ? ctx.fresh('ρ') : null;
  const recordType: RecordType = {
    kind: 'record',
    fields: fieldMap,
    rest,
  };

  return inferResult(recordType, constraints);
}

function getPropertyKey(prop: any): string | null {
  if (prop.computed) return null;

  if (prop.key?.type === 'Identifier') {
    return prop.key.name;
  }
  if (prop.key?.type === 'StringLiteral') {
    return prop.key.value;
  }
  if (prop.key?.type === 'NumericLiteral') {
    return String(prop.key.value);
  }
  return null;
}

function inferObjectMethod(ctx: InferenceContext, method: any): InferResult {
  return inferFunctionLike(ctx, {
    params: method.params,
    body: method.body,
    async: method.async,
    generator: method.generator,
  });
}

// ============================================================================
// Function Expressions
// ============================================================================

function inferFunctionExpression(ctx: InferenceContext, expr: any): InferResult {
  return inferFunctionLike(ctx, {
    params: expr.params,
    body: expr.body,
    async: expr.async,
    generator: expr.generator,
    name: expr.id?.name,
  });
}

interface FunctionLikeNode {
  params: any[];
  body: any;
  async: boolean;
  generator: boolean;
  name?: string;
}

function inferFunctionLike(ctx: InferenceContext, fn: FunctionLikeNode): InferResult {
  const retVar = ctx.fresh('ret');

  const fnCtx = ctx.functionContext({
    returnType: retVar,
    isAsync: fn.async,
    isGenerator: fn.generator,
  });

  const paramTypes: { name: string; type: PolarType; optional: boolean; rest: boolean }[] = [];
  let constraints = emptyConstraintSet();

  for (const p of fn.params) {
    const paramInfo = inferPattern(fnCtx, p);
    constraints = mergeConstraintSets(constraints, paramInfo.constraints);

    for (const binding of paramInfo.bindings) {
      fnCtx.bind(binding.name, binding.type);
      paramTypes.push({
        name: binding.name,
        type: binding.type,
        optional: binding.optional,
        rest: binding.rest,
      });
    }
  }

  if (fn.body.type === 'BlockStatement') {
    const bodyResult = inferStatements(fnCtx, fn.body.body) as StatementResult;
    constraints = mergeConstraintSets(constraints, bodyResult.constraints);

    if (!bodyResult.diverges) {
      constraints = addConstraint(
        constraints,
        flow(undefined_, retVar, nodeToSource(fn.body as Node))
      );
    }
  } else {
    const bodyResult = inferExpression(fnCtx, fn.body);
    constraints = mergeConstraintSets(constraints, bodyResult.constraints);

    constraints = addConstraint(
      constraints,
      flow(bodyResult.type, retVar, nodeToSource(fn.body as Node))
    );
  }

  let returnType: PolarType = retVar;
  if (fn.async) {
    returnType = promise(retVar);
  }

  const funcType: FunctionType = {
    kind: 'function',
    params: paramTypes.map(p => param(p.name, p.type, { optional: p.optional, rest: p.rest })),
    returnType,
    isAsync: fn.async,
    isGenerator: fn.generator,
  };

  return inferResult(funcType, constraints);
}

// ============================================================================
// Pattern Inference
// ============================================================================

interface PatternBinding {
  name: string;
  type: PolarType;
  optional: boolean;
  rest: boolean;
}

interface PatternResult {
  bindings: PatternBinding[];
  constraints: ConstraintSet;
}

function inferPattern(ctx: InferenceContext, pattern: any): PatternResult {
  if (!pattern) {
    return { bindings: [], constraints: emptyConstraintSet() };
  }

  switch (pattern.type) {
    case 'Identifier':
      return {
        bindings: [{
          name: pattern.name,
          type: ctx.fresh(pattern.name),
          optional: false,
          rest: false,
        }],
        constraints: emptyConstraintSet(),
      };

    case 'AssignmentPattern': {
      const leftResult = inferPattern(ctx, pattern.left);
      const defaultResult = inferExpression(ctx, pattern.right);

      let constraints = mergeConstraintSets(leftResult.constraints, defaultResult.constraints);
      for (const binding of leftResult.bindings) {
        constraints = addConstraint(
          constraints,
          flow(defaultResult.type, binding.type, nodeToSource(pattern))
        );
      }

      return {
        bindings: leftResult.bindings.map(b => ({ ...b, optional: true })),
        constraints,
      };
    }

    case 'RestElement': {
      const argResult = inferPattern(ctx, pattern.argument);
      return {
        bindings: argResult.bindings.map(b => ({
          ...b,
          type: array(b.type),
          rest: true,
        })),
        constraints: argResult.constraints,
      };
    }

    case 'ArrayPattern': {
      const bindings: PatternBinding[] = [];
      let constraints = emptyConstraintSet();

      for (const elem of pattern.elements) {
        if (elem === null) continue;
        const elemResult = inferPattern(ctx, elem);
        bindings.push(...elemResult.bindings);
        constraints = mergeConstraintSets(constraints, elemResult.constraints);
      }

      return { bindings, constraints };
    }

    case 'ObjectPattern': {
      const bindings: PatternBinding[] = [];
      let constraints = emptyConstraintSet();

      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          const restResult = inferPattern(ctx, prop);
          bindings.push(...restResult.bindings);
          constraints = mergeConstraintSets(constraints, restResult.constraints);
        } else {
          const propResult = inferPattern(ctx, prop.value);
          bindings.push(...propResult.bindings);
          constraints = mergeConstraintSets(constraints, propResult.constraints);
        }
      }

      return { bindings, constraints };
    }

    default:
      return { bindings: [], constraints: emptyConstraintSet() };
  }
}

// ============================================================================
// Call Expressions
// ============================================================================

function inferCallExpression(ctx: InferenceContext, expr: any): InferResult {
  const calleeResult = inferExpression(ctx, expr.callee);
  let constraints = calleeResult.constraints;

  const argTypes: PolarType[] = [];
  for (const arg of expr.arguments) {
    if (arg.type === 'SpreadElement') {
      const spreadResult = inferExpression(ctx, arg.argument);
      constraints = mergeConstraintSets(constraints, spreadResult.constraints);
      argTypes.push(spreadResult.type);
    } else if (arg.type === 'ArgumentPlaceholder') {
      argTypes.push(ctx.fresh('_'));
    } else {
      const argResult = inferExpression(ctx, arg);
      constraints = mergeConstraintSets(constraints, argResult.constraints);
      argTypes.push(argResult.type);
    }
  }

  const retVar = ctx.fresh('call');
  const expectedFunc: FunctionType = {
    kind: 'function',
    params: argTypes.map((t, i) => param(`arg${i}`, t)),
    returnType: retVar,
    isAsync: false,
    isGenerator: false,
  };

  constraints = addConstraint(
    constraints,
    flow(calleeResult.type, expectedFunc, nodeToSource(expr))
  );

  return inferResult(retVar, constraints);
}

function inferNewExpression(ctx: InferenceContext, expr: any): InferResult {
  const calleeResult = inferExpression(ctx, expr.callee);
  let constraints = calleeResult.constraints;

  // Collect argument types for the constructor
  const argTypes: PolarType[] = [];
  for (const arg of expr.arguments) {
    if (arg.type === 'SpreadElement') {
      const spreadResult = inferExpression(ctx, arg.argument);
      constraints = mergeConstraintSets(constraints, spreadResult.constraints);
      argTypes.push(spreadResult.type);
    } else if (arg.type !== 'ArgumentPlaceholder') {
      const argResult = inferExpression(ctx, arg);
      constraints = mergeConstraintSets(constraints, argResult.constraints);
      argTypes.push(argResult.type);
    }
  }

  // The result type of `new` expression
  const instanceVar = ctx.fresh('instance');

  // For built-in constructors with __instanceType__ (like Date),
  // we need to check if the callee has this property
  const instanceTypeVar = ctx.fresh('instType');
  const constructorWithInstanceType: RecordType = {
    kind: 'record',
    fields: new Map([
      ['__instanceType__', field(instanceTypeVar)],
    ]),
    rest: ctx.fresh('ρ'),
  };

  // Try to extract __instanceType__ from built-in constructors
  constraints = addConstraint(
    constraints,
    flow(calleeResult.type, constructorWithInstanceType, nodeToSource(expr))
  );

  // __instanceType__ flows to instance (for built-in constructors)
  constraints = addConstraint(
    constraints,
    flow(instanceTypeVar, instanceVar, nodeToSource(expr))
  );

  // For user-defined constructors, they set properties via `this`
  // The instance type will be collected from the constructor body
  // through the this-binding mechanism (handled elsewhere)

  return inferResult(instanceVar, constraints);
}

// ============================================================================
// Member Access
// ============================================================================

function inferMemberExpression(ctx: InferenceContext, expr: any): InferResult {
  const objResult = inferExpression(ctx, expr.object);
  let constraints = objResult.constraints;

  if (!expr.computed && expr.property?.type === 'Identifier') {
    const propName = expr.property.name;
    const propVar = ctx.fresh(`${propName}`);

    // Create a union of possible object types that can have this property:
    // 1. A record type with the property
    // 2. A function type with the property (for cases like func.prototype)
    // 3. An array type with the property (for cases like arr.push)
    // This allows records, functions, and arrays to have properties
    const recordWithProp: RecordType = {
      kind: 'record',
      fields: new Map([[propName, field(propVar)]]),
      rest: ctx.fresh('ρ'),
    };

    const funcWithProp: FunctionType = {
      kind: 'function',
      params: [],
      returnType: ctx.fresh('ret'),
      isAsync: false,
      isGenerator: false,
      properties: new Map([[propName, field(propVar)]]),
    };

    const arrayWithProp: ArrayType = {
      kind: 'array',
      elementType: ctx.fresh('elem'),
      properties: new Map([[propName, field(propVar)]]),
    };

    // The object must be either a record with this property OR a function with this property OR an array with this property
    const expectedObj = union([recordWithProp, funcWithProp, arrayWithProp]);

    constraints = addConstraint(
      constraints,
      flow(objResult.type, expectedObj, nodeToSource(expr))
    );

    return inferResult(propVar, constraints);
  } else {
    const keyResult = inferExpression(ctx, expr.property);
    constraints = mergeConstraintSets(constraints, keyResult.constraints);

    const propVar = ctx.fresh('prop');
    return inferResult(propVar, constraints);
  }
}

function inferOptionalMemberExpression(ctx: InferenceContext, expr: any): InferResult {
  const result = inferMemberExpression(ctx, expr);
  return inferResult(union([result.type, undefined_]), result.constraints);
}

function inferOptionalCallExpression(ctx: InferenceContext, expr: any): InferResult {
  const result = inferCallExpression(ctx, expr);
  return inferResult(union([result.type, undefined_]), result.constraints);
}

// ============================================================================
// Operators
// ============================================================================

function inferBinaryExpression(ctx: InferenceContext, expr: any): InferResult {
  const leftResult = inferExpression(ctx, expr.left);
  const rightResult = inferExpression(ctx, expr.right);
  let constraints = mergeConstraintSets(leftResult.constraints, rightResult.constraints);

  switch (expr.operator) {
    case '+':
      // Smart + operator: if both operands are known to be numbers, result is number
      // Otherwise, we need to check if either operand could be string
      return inferPlusOperator(ctx, leftResult.type, rightResult.type, constraints);

    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return inferResult(number, constraints);

    case '==':
    case '!=':
    case '===':
    case '!==':
    case '<':
    case '<=':
    case '>':
    case '>=':
    case 'in':
    case 'instanceof':
      return inferResult(boolean, constraints);

    case '??':
      return inferResult(union([leftResult.type, rightResult.type]), constraints);

    default:
      return inferResult(ctx.fresh('binop'), constraints);
  }
}

function inferUnaryExpression(ctx: InferenceContext, expr: any): InferResult {
  const argResult = inferExpression(ctx, expr.argument);

  switch (expr.operator) {
    case '!':
      return inferResult(boolean, argResult.constraints);

    case '+':
    case '-':
    case '~':
      return inferResult(number, argResult.constraints);

    case 'typeof':
      return inferResult(string, argResult.constraints);

    case 'void':
      return inferResult(undefined_, argResult.constraints);

    case 'delete':
      return inferResult(boolean, argResult.constraints);

    default:
      return inferResult(ctx.fresh('unary'), argResult.constraints);
  }
}

function inferUpdateExpression(ctx: InferenceContext, expr: any): InferResult {
  const argResult = inferExpression(ctx, expr.argument);
  return inferResult(number, argResult.constraints);
}

function inferLogicalExpression(ctx: InferenceContext, expr: any): InferResult {
  const leftResult = inferExpression(ctx, expr.left);
  const rightResult = inferExpression(ctx, expr.right);
  const constraints = mergeConstraintSets(leftResult.constraints, rightResult.constraints);

  switch (expr.operator) {
    case '&&':
    case '||':
    case '??':
      return inferResult(union([leftResult.type, rightResult.type]), constraints);

    default:
      return inferResult(boolean, constraints);
  }
}

function inferConditionalExpression(ctx: InferenceContext, expr: any): InferResult {
  const testResult = inferExpression(ctx, expr.test);
  const consequentResult = inferExpression(ctx, expr.consequent);
  const alternateResult = inferExpression(ctx, expr.alternate);

  const constraints = mergeConstraintSets(
    mergeConstraintSets(testResult.constraints, consequentResult.constraints),
    alternateResult.constraints
  );

  return inferResult(
    union([consequentResult.type, alternateResult.type]),
    constraints
  );
}

function inferAssignmentExpression(ctx: InferenceContext, expr: any): InferResult {
  const rightResult = inferExpression(ctx, expr.right);
  let constraints = rightResult.constraints;

  if (expr.left.type === 'Identifier') {
    const scheme = ctx.lookup(expr.left.name);
    if (scheme) {
      const leftType = ctx.instantiate(scheme);
      constraints = addConstraint(
        constraints,
        flow(rightResult.type, leftType, nodeToSource(expr))
      );
    }
  } else {
    const leftResult = inferExpression(ctx, expr.left);
    constraints = mergeConstraintSets(constraints, leftResult.constraints);
    constraints = addConstraint(
      constraints,
      flow(rightResult.type, leftResult.type, nodeToSource(expr))
    );
  }

  return inferResult(rightResult.type, constraints);
}

function inferSequenceExpression(ctx: InferenceContext, expr: any): InferResult {
  let constraints = emptyConstraintSet();
  let lastType: PolarType = undefined_;

  for (const e of expr.expressions) {
    const result = inferExpression(ctx, e);
    constraints = mergeConstraintSets(constraints, result.constraints);
    lastType = result.type;
  }

  return inferResult(lastType, constraints);
}

// ============================================================================
// Async/Yield
// ============================================================================

function inferAwaitExpression(ctx: InferenceContext, expr: any): InferResult {
  const argResult = inferExpression(ctx, expr.argument);

  const resolvedVar = ctx.fresh('awaited');
  const constraints = addConstraint(
    argResult.constraints,
    flow(argResult.type, promise(resolvedVar), nodeToSource(expr))
  );

  return inferResult(resolvedVar, constraints);
}

function inferYieldExpression(ctx: InferenceContext, expr: any): InferResult {
  if (expr.argument) {
    const argResult = inferExpression(ctx, expr.argument);
    return argResult;
  }

  return inferType(undefined_);
}

// ============================================================================
// Special Expressions
// ============================================================================

function inferThisExpression(ctx: InferenceContext): InferResult {
  const thisType = ctx.getThisType();
  if (thisType) {
    return inferType(thisType);
  }
  return inferType(any);
}

function inferSpreadElement(ctx: InferenceContext, expr: any): InferResult {
  return inferExpression(ctx, expr.argument);
}

function inferClassExpression(ctx: InferenceContext, expr: any): InferResult {
  const classVar = ctx.fresh(expr.id?.name ?? 'Class');
  let constraints = emptyConstraintSet();

  if (expr.superClass) {
    const superResult = inferExpression(ctx, expr.superClass);
    constraints = mergeConstraintSets(constraints, superResult.constraints);
  }

  return inferResult(classVar, constraints);
}

function inferMetaProperty(ctx: InferenceContext, expr: any): InferResult {
  if (expr.meta?.name === 'new' && expr.property?.name === 'target') {
    return inferType(union([ctx.fresh('constructor'), undefined_]));
  }
  if (expr.meta?.name === 'import' && expr.property?.name === 'meta') {
    return inferType(record({}));
  }
  return inferType(any);
}

// ============================================================================
// Plus Operator Type Inference
// ============================================================================

/**
 * Check if a type is definitely a number (not possibly string)
 */
function isDefinitelyNumber(type: PolarType): boolean {
  if (type.kind === 'primitive' && type.name === 'number') {
    return true;
  }
  if (type.kind === 'union') {
    // Union is definitely number if all members are numbers
    return type.members.every(m => isDefinitelyNumber(m));
  }
  return false;
}

/**
 * Check if a type is definitely a string
 */
function isDefinitelyString(type: PolarType): boolean {
  if (type.kind === 'primitive' && type.name === 'string') {
    return true;
  }
  if (type.kind === 'union') {
    return type.members.every(m => isDefinitelyString(m));
  }
  return false;
}

/**
 * Check if a type could possibly be a string
 */
function couldBeString(type: PolarType): boolean {
  if (type.kind === 'primitive' && type.name === 'string') {
    return true;
  }
  if (type.kind === 'union') {
    return type.members.some(m => couldBeString(m));
  }
  if (type.kind === 'var' || type.kind === 'any' || type.kind === 'unknown') {
    // Unknown types could be string
    return true;
  }
  return false;
}

/**
 * Infer the type of the + operator based on operand types
 *
 * In JavaScript:
 * - number + number = number
 * - string + anything = string
 * - anything + string = string
 * - Otherwise, could be number or string
 */
function inferPlusOperator(
  ctx: InferenceContext,
  leftType: PolarType,
  rightType: PolarType,
  constraints: ConstraintSet
): InferResult {
  // If both are definitely numbers, result is number
  if (isDefinitelyNumber(leftType) && isDefinitelyNumber(rightType)) {
    return inferResult(number, constraints);
  }

  // If either is definitely a string, result is string
  if (isDefinitelyString(leftType) || isDefinitelyString(rightType)) {
    return inferResult(string, constraints);
  }

  // If neither could be a string, result is number
  if (!couldBeString(leftType) && !couldBeString(rightType)) {
    return inferResult(number, constraints);
  }

  // Otherwise, result could be number or string
  return inferResult(union([number, string]), constraints);
}
