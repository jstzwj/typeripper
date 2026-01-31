/**
 * Type State Management
 * Utilities for creating, joining, and manipulating TypeState during analysis
 */

import type { Type } from '../../types/types.js';
import type { TypeEnvironment, TypeState, Binding } from '../../types/analysis.js';
import {
  createEnvironment,
  createInitialState,
  createUnreachableState,
  updateBinding,
  lookupBinding,
} from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { isUnionType, isNeverType } from '../../types/types.js';

// ============================================================================
// State Creation
// ============================================================================

export function createState(
  env: TypeEnvironment,
  reachable: boolean = true
): TypeState {
  return reachable ? createInitialState(env) : createUnreachableState(env);
}

export function copyState(state: TypeState): TypeState {
  return {
    ...state,
    env: { ...state.env },
    // We don't deep copy the environment to preserve sharing
  };
}

// ============================================================================
// State Joining (for merge points)
// ============================================================================

/**
 * Join multiple states at a control flow merge point
 * This is a critical operation for flow-sensitive analysis
 */
export function joinStates(states: readonly TypeState[]): TypeState {
  if (states.length === 0) {
    return createUnreachableState(createEnvironment(null, 'block'));
  }

  if (states.length === 1) {
    return states[0]!;
  }

  // Filter reachable states
  const reachable = states.filter(s => s.reachable);
  if (reachable.length === 0) {
    return createUnreachableState(states[0]!.env);
  }

  // Find common ancestor environment
  const commonEnv = findCommonEnvironment(reachable.map(s => s.env));

  // Join all bindings into common environment
  const joinedEnv = joinEnvironments(reachable.map(s => s.env), commonEnv);

  // Join return values
  const returnValue = joinOptionalTypes(
    reachable.map(s => s.returnValue)
  );

  // Join this types
  const thisType = joinOptionalTypes(
    reachable.map(s => s.thisType)
  );

  // Union of modified variables
  const modifiedVars = new Set<string>();
  for (const s of reachable) {
    for (const v of s.modifiedVars) {
      modifiedVars.add(v);
    }
  }

  // Max loop depth (conservative)
  const loopDepth = Math.max(...reachable.map(s => s.loopDepth));

  // In try block if any are (conservative)
  const inTryBlock = reachable.some(s => s.inTryBlock);

  return {
    env: joinedEnv,
    reachable: true,
    returnValue,
    thisType,
    loopDepth,
    inTryBlock,
    modifiedVars,
  };
}

function joinOptionalTypes(types: (Type | undefined)[]): Type | undefined {
  const defined = types.filter((t): t is Type => t !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return defined.reduce((acc, t) => joinTypes(acc, t));
}

/**
 * Find the deepest common ancestor environment
 */
function findCommonEnvironment(envs: readonly TypeEnvironment[]): TypeEnvironment {
  if (envs.length === 0) {
    return createEnvironment(null, 'global');
  }

  if (envs.length === 1) {
    return envs[0]!;
  }

  // Collect all ancestors of first environment
  const ancestors = new Set<string>();
  let current: TypeEnvironment | null = envs[0]!;
  while (current) {
    ancestors.add(current.scopeId);
    current = current.parent;
  }

  // For each other environment, intersect ancestors
  for (let i = 1; i < envs.length; i++) {
    let other: TypeEnvironment | null = envs[i]!;
    const otherAncestors = new Set<string>();

    while (other) {
      otherAncestors.add(other.scopeId);
      other = other.parent;
    }

    // Intersect
    for (const id of ancestors) {
      if (!otherAncestors.has(id)) {
        ancestors.delete(id);
      }
    }

    if (ancestors.size === 0) {
      return createEnvironment(null, 'global');
    }
  }

  // Find the first environment in the original chain that's in the intersection
  current = envs[0]!;
  while (current && !ancestors.has(current.scopeId)) {
    current = current.parent;
  }

  return current ?? createEnvironment(null, 'global');
}

/**
 * Join multiple environments at a common ancestor
 */
function joinEnvironments(
  envs: readonly TypeEnvironment[],
  common: TypeEnvironment
): TypeEnvironment {
  const bindings = new Map<string, Binding>();

  // Collect all binding names
  const allNames = new Set<string>();
  for (const env of envs) {
    for (const name of env.bindings.keys()) {
      allNames.add(name);
    }
  }

  // For each name, join the types from all environments that have it
  for (const name of allNames) {
    const types: Type[] = [];
    let kind: Binding['kind'] = 'const';
    let mutable = false;
    let node: any = null;
    let scope = common.scope;
    let initialized = true;

    for (const env of envs) {
      const binding = env.bindings.get(name);
      if (binding) {
        types.push(binding.type);

        // Use most permissive kind
        if (binding.kind === 'var') kind = 'var';
        else if (binding.kind === 'let' && kind !== 'var') kind = 'let';
        else if (binding.kind === 'param' && kind === 'const') kind = 'param';
        else if (binding.kind === 'function' && kind === 'const') kind = 'function';
        else if (binding.kind === 'class' && kind === 'const') kind = 'class';

        mutable = mutable || binding.mutable;
        node = node || binding.node;
        scope = binding.scope;
        initialized = initialized && binding.initialized;
      }
    }

    if (types.length > 0 && node) {
      const joinedType = types.length === 1 ? types[0]! : types.reduce((a, b) => joinTypes(a, b));
      bindings.set(name, {
        type: joinedType,
        kind,
        node,
        mutable,
        scope,
        initialized,
      });
    }
  }

  return {
    ...common,
    bindings,
  };
}

/**
 * Join two types
 * This is the core type operation for merge points
 */
export function joinTypes(t1: Type, t2: Type): Type {
  if (t1.id === t2.id) return t1;

  // Handle never type
  if (isNeverType(t1)) return t2;
  if (isNeverType(t2)) return t1;

  // Handle union types
  if (isUnionType(t1) && isUnionType(t2)) {
    return Types.union(...t1.members, ...t2.members);
  }

  if (isUnionType(t1)) {
    // Check if t2 is already in t1
    if (t1.members.some(m => m.id === t2.id)) {
      return t1;
    }
    return Types.union(...t1.members, t2);
  }

  if (isUnionType(t2)) {
    // Check if t1 is already in t2
    if (t2.members.some(m => m.id === t1.id)) {
      return t2;
    }
    return Types.union(t1, ...t2.members);
  }

  // Different primitive types -> union
  if (t1.kind !== t2.kind && isPrimitiveType(t1) && isPrimitiveType(t2)) {
    return Types.union(t1, t2);
  }

  // Same kind but different values -> union
  if (t1.kind === t2.kind) {
    switch (t1.kind) {
      case 'boolean':
      case 'number':
      case 'string':
      case 'bigint':
        // Different literals -> union of literals or primitive
        return Types.union(t1, t2);
      default:
        break;
    }
  }

  // Default: union
  return Types.union(t1, t2);
}

function isPrimitiveType(type: Type): boolean {
  return [
    'undefined',
    'null',
    'boolean',
    'number',
    'string',
    'bigint',
    'symbol',
  ].includes(type.kind);
}

// ============================================================================
// State Narrowing (for conditional branches)
// ============================================================================

/**
 * Narrow state based on a condition
 * This is used for type narrowing in if statements
 */
export function narrowState(
  state: TypeState,
  condition: {
    expression: any;
    whenTruthy: boolean;
  }
): TypeState {
  if (!state.reachable) return state;

  // Extract narrowing from condition
  const narrowed = narrowByCondition(state, condition);

  return narrowed;
}

/**
 * Narrow state based on a specific condition
 */
function narrowByCondition(
  state: TypeState,
  condition: {
    expression: any;
    whenTruthy: boolean;
  }
): TypeState {
  const expr = condition.expression;

  // Handle identifier checks: x, x === null, x !== null, typeof x === "..."
  if (expr.type === 'Identifier') {
    return narrowIdentifier(state, expr.name, condition.whenTruthy);
  }

  // Handle binary expressions
  if (expr.type === 'BinaryExpression') {
    return narrowBinaryExpression(state, expr, condition.whenTruthy);
  }

  // Handle logical expressions
  if (expr.type === 'LogicalExpression') {
    return narrowLogicalExpression(state, expr, condition.whenTruthy);
  }

  // Handle unary expressions
  if (expr.type === 'UnaryExpression' && expr.operator === '!') {
    return narrowByCondition(state, {
      expression: expr.argument,
      whenTruthy: !condition.whenTruthy,
    });
  }

  return state;
}

/**
 * Narrow based on identifier truthiness
 */
function narrowIdentifier(
  state: TypeState,
  name: string,
  whenTruthy: boolean
): TypeState {
  const binding = lookupBinding(state.env, name);
  if (!binding) return state;

  let narrowedType = binding.type;

  if (whenTruthy) {
    // Remove null/undefined from type
    narrowedType = removeNullOrUndefined(narrowedType);
  } else {
    // Narrow to only null/undefined/falsy
    narrowedType = keepOnlyFalsy(narrowedType);
  }

  if (narrowedType.id !== binding.type.id) {
    return {
      ...state,
      env: updateBinding(
        state.env,
        name,
        narrowedType,
        binding.kind,
        binding.node,
        binding.mutable,
        binding.initialized
      ),
    };
  }

  return state;
}

/**
 * Narrow based on binary expression
 */
function narrowBinaryExpression(
  state: TypeState,
  expr: any,
  whenTruthy: boolean
): TypeState {
  // Handle equality checks: x === null, x !== null, x == undefined, etc.
  if ((expr.operator === '===' || expr.operator === '==' || expr.operator === '!==' || expr.operator === '!=')) {
    if (expr.left.type === 'Identifier' && isNullLiteral(expr.right)) {
      const name = expr.left.name;
      const isEqual = expr.operator === '===' || expr.operator === '==';
      const shouldNarrowToNull = isEqual ? whenTruthy : !whenTruthy;

      return narrowNullCheck(state, name, shouldNarrowToNull);
    }

    if (expr.right.type === 'Identifier' && isNullLiteral(expr.left)) {
      const name = expr.right.name;
      const isEqual = expr.operator === '===' || expr.operator === '==';
      const shouldNarrowToNull = isEqual ? whenTruthy : !whenTruthy;

      return narrowNullCheck(state, name, shouldNarrowToNull);
    }

    // Handle typeof checks
    if (isTypeofCheck(expr)) {
      return narrowTypeofCheck(state, expr, whenTruthy);
    }
  }

  return state;
}

/**
 * Narrow based on logical expression
 */
function narrowLogicalExpression(
  state: TypeState,
  expr: any,
  whenTruthy: boolean
): TypeState {
  if (expr.operator === '&&') {
    if (whenTruthy) {
      // Both sides must be truthy
      let narrowed = narrowByCondition(state, {
        expression: expr.left,
        whenTruthy: true,
      });
      narrowed = narrowByCondition(narrowed, {
        expression: expr.right,
        whenTruthy: true,
      });
      return narrowed;
    } else {
      // Either side is falsy - can't narrow much
      return state;
    }
  }

  if (expr.operator === '||') {
    if (whenTruthy) {
      // Either side is truthy - can't narrow much
      return state;
    } else {
      // Both sides must be falsy
      let narrowed = narrowByCondition(state, {
        expression: expr.left,
        whenTruthy: false,
      });
      narrowed = narrowByCondition(narrowed, {
        expression: expr.right,
        whenTruthy: false,
      });
      return narrowed;
    }
  }

  return state;
}

/**
 * Narrow null check: x === null or x !== null
 */
function narrowNullCheck(state: TypeState, name: string, isNull: boolean): TypeState {
  const binding = lookupBinding(state.env, name);
  if (!binding) return state;

  let narrowedType = binding.type;

  if (isNull) {
    // Narrow to null (or null | undefined)
    narrowedType = keepOnlyNullish(narrowedType);
  } else {
    // Remove null
    narrowedType = removeNull(narrowedType);
  }

  if (narrowedType.id !== binding.type.id) {
    return {
      ...state,
      env: updateBinding(
        state.env,
        name,
        narrowedType,
        binding.kind,
        binding.node,
        binding.mutable,
        binding.initialized
      ),
    };
  }

  return state;
}

/**
 * Narrow typeof check: typeof x === "string"
 */
function narrowTypeofCheck(state: TypeState, expr: any, whenTruthy: boolean): TypeState {
  // Extract identifier and type
  let identifier: any = null;
  let expectedType: string | null = null;

  if (expr.left.type === 'UnaryExpression' && expr.left.operator === 'typeof' && expr.left.argument.type === 'Identifier') {
    identifier = expr.left.argument;
    if (expr.right.type === 'StringLiteral') {
      expectedType = expr.right.value;
    }
  }

  if (!identifier || !expectedType) return state;

  const binding = lookupBinding(state.env, identifier.name);
  if (!binding) return state;

  if (whenTruthy) {
    // Narrow to the specific type
    const narrowedType = typeStringToType(expectedType);
    if (narrowedType && narrowedType.id !== binding.type.id) {
      return {
        ...state,
        env: updateBinding(
          state.env,
          identifier.name,
          narrowedType,
          binding.kind,
          binding.node,
          binding.mutable,
          binding.initialized
        ),
      };
    }
  } else {
    // Remove the specific type
    const unwantedType = typeStringToType(expectedType);
    if (unwantedType) {
      const narrowedType = removeTypeFromUnion(binding.type, unwantedType);
      if (narrowedType.id !== binding.type.id) {
        return {
          ...state,
          env: updateBinding(
            state.env,
            identifier.name,
            narrowedType,
            binding.kind,
            binding.node,
            binding.mutable,
            binding.initialized
          ),
        };
      }
    }
  }

  return state;
}

// ============================================================================
// Type Narrowing Helpers
// ============================================================================

function removeNullOrUndefined(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(
      t => t.kind !== 'null' && t.kind !== 'undefined'
    );
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  if (type.kind === 'null' || type.kind === 'undefined') {
    return Types.never();
  }
  return type;
}

function removeNull(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(t => t.kind !== 'null');
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  if (type.kind === 'null') {
    return Types.never();
  }
  return type;
}

function keepOnlyFalsy(type: Type): Type {
  // For simplicity, return null | undefined
  // A more complete implementation would also include false, 0, "", etc.
  if (isUnionType(type)) {
    const filtered = type.members.filter(
      t => t.kind === 'null' || t.kind === 'undefined' ||
           (t.kind === 'boolean' && t.value === false) ||
           (t.kind === 'number' && t.value === 0) ||
           (t.kind === 'string' && t.value === '')
    );
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  if (type.kind === 'null' || type.kind === 'undefined') {
    return type;
  }
  return Types.null();
}

function keepOnlyNullish(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(
      t => t.kind === 'null' || t.kind === 'undefined'
    );
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  if (type.kind === 'null' || type.kind === 'undefined') {
    return type;
  }
  return Types.never();
}

function removeTypeFromUnion(type: Type, toRemove: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(t => t.kind !== toRemove.kind);
    if (filtered.length === 0) return Types.never();
    if (filtered.length === 1) return filtered[0]!;
    return Types.union(...filtered);
  }
  if (type.kind === toRemove.kind) {
    return Types.never();
  }
  return type;
}

function isNullLiteral(node: any): boolean {
  return node.type === 'NullLiteral' ||
         (node.type === 'Identifier' && node.name === 'null');
}

function isTypeofCheck(expr: any): boolean {
  return (expr.left?.type === 'UnaryExpression' && expr.left?.operator === 'typeof') ||
         (expr.right?.type === 'UnaryExpression' && expr.right?.operator === 'typeof');
}

function typeStringToType(typeStr: string): Type | null {
  switch (typeStr) {
    case 'undefined':
      return Types.undefined();
    case 'object':
      return Types.object({});
    case 'boolean':
      return Types.boolean();
    case 'number':
      return Types.number();
    case 'string':
      return Types.string();
    case 'function':
      return Types.function({ params: [], returnType: Types.any() });
    case 'symbol':
      return Types.symbol();
    case 'bigint':
      return Types.bigint();
    default:
      return null;
  }
}

// ============================================================================
// Type Widening (for loop termination)
// ============================================================================

/**
 * Widen a type to prevent infinite unions in loops
 * This is crucial for ensuring the analysis terminates
 */
export function widenType(type: Type, threshold: number = 10): Type {
  if (isUnionType(type)) {
    if (type.members.length > threshold) {
      // Widen large unions
      const primitiveKinds = new Set(['undefined', 'null', 'boolean', 'number', 'string', 'bigint', 'symbol']);

      // Group by kind
      const byKind = new Map<string, Type[]>();
      for (const m of type.members) {
        if (!byKind.has(m.kind)) {
          byKind.set(m.kind, []);
        }
        byKind.get(m.kind)!.push(m);
      }

      // Widen primitive literals
      const widened: Type[] = [];
      for (const [kind, members] of byKind) {
        if (primitiveKinds.has(kind) && members.length > 2) {
          // Widen to primitive type
          switch (kind) {
            case 'boolean':
              widened.push(Types.boolean());
              break;
            case 'number':
              widened.push(Types.number());
              break;
            case 'string':
              widened.push(Types.string());
              break;
            case 'bigint':
              widened.push(Types.bigint());
              break;
            default:
              widened.push(...members);
          }
        } else {
          widened.push(...members);
        }
      }

      return widened.length === 1 ? widened[0]! : Types.union(...widened);
    }
  }

  return type;
}

/**
 * Widen state for loop headers
 */
export function widenLoopState(
  state: TypeState,
  modifiedVars: Set<string>,
  threshold: number = 10
): TypeState {
  if (modifiedVars.size === 0) return state;

  const newBindings = new Map(state.env.bindings);

  for (const name of modifiedVars) {
    const binding = state.env.bindings.get(name);
    if (binding) {
      const widened = widenType(binding.type, threshold);
      if (widened.id !== binding.type.id) {
        newBindings.set(name, {
          ...binding,
          type: widened,
        });
      }
    }
  }

  return {
    ...state,
    env: {
      ...state.env,
      bindings: newBindings,
    },
  };
}

// ============================================================================
// State Equality
// ============================================================================

export function statesEqual(s1: TypeState, s2: TypeState): boolean {
  if (s1.reachable !== s2.reachable) return false;
  if (s1.loopDepth !== s2.loopDepth) return false;
  if (s1.inTryBlock !== s2.inTryBlock) return false;

  // Compare returnValue
  if (s1.returnValue !== undefined || s2.returnValue !== undefined) {
    if (!s1.returnValue || !s2.returnValue) return false;
    if (s1.returnValue.id !== s2.returnValue.id) return false;
  }

  // Compare thisType
  if (s1.thisType !== undefined || s2.thisType !== undefined) {
    if (!s1.thisType || !s2.thisType) return false;
    if (s1.thisType.id !== s2.thisType.id) return false;
  }

  // Compare environments (by bindings)
  if (s1.env.bindings.size !== s2.env.bindings.size) return false;

  for (const [name, b1] of s1.env.bindings) {
    const b2 = s2.env.bindings.get(name);
    if (!b2) return false;
    if (b1.type.id !== b2.type.id) return false;
  }

  return true;
}

// ============================================================================
// Reachability
// ============================================================================

export function makeUnreachable(state: TypeState): TypeState {
  return createUnreachableState(state.env);
}

export function makeReachable(state: TypeState): TypeState {
  if (state.reachable) return state;
  return { ...state, reachable: true };
}
