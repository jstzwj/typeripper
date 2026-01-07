/**
 * Type State Management - Environment and state operations
 *
 * This module handles type environments, bindings, and state management
 * for the iterative type inference algorithm.
 */

import * as t from '@babel/types';
import type {
  Type,
  TypeEnvironment,
  Binding,
  ScopeKind,
  NodeId,
} from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';

/**
 * Create an empty type environment
 */
export function createEnv(parent: TypeEnvironment | null, kind: ScopeKind): TypeEnvironment {
  return {
    bindings: new Map(),
    parent,
    scopeKind: kind,
  };
}

/**
 * Create initial type state
 */
export function createInitialState(env: TypeEnvironment): TypeState {
  return {
    env,
    expressionTypes: new Map(),
    reachable: true,
  };
}

/**
 * Create unreachable state
 */
export function createUnreachableState(env: TypeEnvironment): TypeState {
  return {
    env,
    expressionTypes: new Map(),
    reachable: false,
  };
}

/**
 * Lookup a binding in the environment chain
 */
export function lookupBinding(env: TypeEnvironment, name: string): Binding | undefined {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (env.parent) return lookupBinding(env.parent, name);
  return undefined;
}

/**
 * Update a binding in the environment (returns new env)
 */
export function updateBinding(
  env: TypeEnvironment,
  name: string,
  type: Type,
  kind: Binding['kind'],
  node: t.Node
): TypeEnvironment {
  const newBindings = new Map(env.bindings);
  const existing = lookupBinding(env, name);
  newBindings.set(name, {
    name,
    type,
    declarationNode: existing?.declarationNode ?? node,
    kind: existing?.kind ?? kind,
    definitelyAssigned: true,
    possiblyMutated: existing?.possiblyMutated ?? false,
  });
  return {
    ...env,
    bindings: newBindings,
  };
}

/**
 * Join two type environments (for merge points in CFG)
 * Creates a union of types for each binding
 */
export function joinEnvironments(env1: TypeEnvironment, env2: TypeEnvironment): TypeEnvironment {
  const newBindings = new Map<string, Binding>();

  // Collect all binding names from both environments
  const allNames = new Set<string>();
  collectBindingNames(env1, allNames);
  collectBindingNames(env2, allNames);

  for (const name of allNames) {
    const binding1 = lookupBinding(env1, name);
    const binding2 = lookupBinding(env2, name);

    if (binding1 && binding2) {
      // Both branches have this binding - join types
      const joinedType = joinTypes(binding1.type, binding2.type);
      newBindings.set(name, {
        name,
        type: joinedType,
        declarationNode: binding1.declarationNode,
        kind: binding1.kind,
        definitelyAssigned: binding1.definitelyAssigned && binding2.definitelyAssigned,
        possiblyMutated: binding1.possiblyMutated || binding2.possiblyMutated,
      });
    } else if (binding1) {
      // Only in env1 - might be undefined in env2
      newBindings.set(name, {
        ...binding1,
        definitelyAssigned: false,
      });
    } else if (binding2) {
      // Only in env2 - might be undefined in env1
      newBindings.set(name, {
        ...binding2,
        definitelyAssigned: false,
      });
    }
  }

  return {
    bindings: newBindings,
    parent: env1.parent, // Assume same parent
    scopeKind: env1.scopeKind,
  };
}

/**
 * Collect all binding names from an environment chain
 */
function collectBindingNames(env: TypeEnvironment | null, names: Set<string>): void {
  if (!env) return;
  for (const name of env.bindings.keys()) {
    names.add(name);
  }
  collectBindingNames(env.parent, names);
}

/**
 * Join two types (create union or widen)
 * When joining types at merge points (especially loop headers),
 * we widen literal types to their base types for soundness.
 */
export function joinTypes(t1: Type, t2: Type): Type {
  // Same type - no change
  if (t1.id === t2.id) return t1;

  // Structurally equal types - return the first one
  if (typesEqual(t1, t2)) return t1;

  // If either is unreachable (never), return the other
  if (t1.kind === 'never') return t2;
  if (t2.kind === 'never') return t1;

  // If either is any, the result is any
  if (t1.kind === 'any') return t1;
  if (t2.kind === 'any') return t2;

  // If types are the same kind, try to widen to base type
  if (t1.kind === t2.kind) {
    // Both are numbers (possibly literals) -> widen to number
    if (t1.kind === 'number') {
      return Types.number;
    }
    // Both are strings (possibly literals) -> widen to string
    if (t1.kind === 'string') {
      return Types.string;
    }
    // Both are booleans (possibly literals) -> widen to boolean
    if (t1.kind === 'boolean') {
      return Types.boolean;
    }
    // Both are bigints (possibly literals) -> widen to bigint
    if (t1.kind === 'bigint') {
      return Types.bigint;
    }
  }

  // Create union (will be simplified by Types.union)
  return Types.union([t1, t2]);
}

/**
 * Join multiple type states (for merge points with multiple predecessors)
 */
export function joinStates(states: TypeState[]): TypeState {
  const reachableStates = states.filter((s) => s.reachable);

  if (reachableStates.length === 0) {
    // All predecessors are unreachable
    return createUnreachableState(states[0]?.env ?? createEnv(null, 'module'));
  }

  if (reachableStates.length === 1) {
    return reachableStates[0]!;
  }

  // Join all environments
  let joinedEnv = reachableStates[0]!.env;
  for (let i = 1; i < reachableStates.length; i++) {
    joinedEnv = joinEnvironments(joinedEnv, reachableStates[i]!.env);
  }

  // Join expression types
  const joinedExprTypes = new Map<t.Expression, Type>();
  for (const state of reachableStates) {
    for (const [expr, type] of state.expressionTypes) {
      const existing = joinedExprTypes.get(expr);
      if (existing) {
        joinedExprTypes.set(expr, joinTypes(existing, type));
      } else {
        joinedExprTypes.set(expr, type);
      }
    }
  }

  return {
    env: joinedEnv,
    expressionTypes: joinedExprTypes,
    reachable: true,
  };
}

/**
 * Check if two type states are equal (for fixed-point detection)
 */
export function statesEqual(s1: TypeState, s2: TypeState): boolean {
  if (s1.reachable !== s2.reachable) return false;
  if (!s1.reachable && !s2.reachable) return true;

  // Compare environments
  return environmentsEqual(s1.env, s2.env);
}

/**
 * Check if two environments are equal
 */
function environmentsEqual(env1: TypeEnvironment, env2: TypeEnvironment): boolean {
  if (env1.bindings.size !== env2.bindings.size) return false;

  for (const [name, binding1] of env1.bindings) {
    const binding2 = env2.bindings.get(name);
    if (!binding2) return false;
    if (!typesEqual(binding1.type, binding2.type)) return false;
  }

  // Check parents
  if (env1.parent && env2.parent) {
    return environmentsEqual(env1.parent, env2.parent);
  }
  return env1.parent === env2.parent;
}

/**
 * Check if two types are structurally equal
 */
export function typesEqual(t1: Type, t2: Type): boolean {
  if (t1.id === t2.id) return true;
  if (t1.kind !== t2.kind) return false;

  // For unions, check if members are equal (order-independent)
  if (t1.kind === 'union' && t2.kind === 'union') {
    if (t1.members.length !== t2.members.length) return false;
    return t1.members.every((m1) => t2.members.some((m2) => typesEqual(m1, m2)));
  }

  // For objects, check properties
  if (t1.kind === 'object' && t2.kind === 'object') {
    if (t1.properties.size !== t2.properties.size) return false;
    for (const [key, prop1] of t1.properties) {
      const prop2 = t2.properties.get(key);
      if (!prop2 || !typesEqual(prop1.type, prop2.type)) return false;
    }
    return true;
  }

  // For functions, check params and return type
  if (t1.kind === 'function' && t2.kind === 'function') {
    if (t1.params.length !== t2.params.length) return false;
    if (!typesEqual(t1.returnType, t2.returnType)) return false;
    for (let i = 0; i < t1.params.length; i++) {
      if (!typesEqual(t1.params[i]!.type, t2.params[i]!.type)) return false;
    }
    return true;
  }

  // For classes, check name and instance type
  if (t1.kind === 'class' && t2.kind === 'class') {
    if (t1.name !== t2.name) return false;
    return typesEqual(t1.instanceType, t2.instanceType);
  }

  // For arrays, check element type
  if (t1.kind === 'array' && t2.kind === 'array') {
    return typesEqual(t1.elementType, t2.elementType);
  }

  // For primitives with values (literal types)
  if (t1.kind === 'number' && t2.kind === 'number') {
    return (t1 as import('../../types/index.js').NumberType).value ===
           (t2 as import('../../types/index.js').NumberType).value;
  }
  if (t1.kind === 'string' && t2.kind === 'string') {
    return (t1 as import('../../types/index.js').StringType).value ===
           (t2 as import('../../types/index.js').StringType).value;
  }
  if (t1.kind === 'boolean' && t2.kind === 'boolean') {
    return (t1 as import('../../types/index.js').BooleanType).value ===
           (t2 as import('../../types/index.js').BooleanType).value;
  }

  // For any/undefined/null/never/unknown - if same kind, they're equal
  if (t1.kind === 'any' || t1.kind === 'undefined' || t1.kind === 'null' ||
      t1.kind === 'never' || t1.kind === 'unknown') {
    return true;
  }

  return false;
}
