/**
 * Type inference analysis state types
 */

import type { Node } from '@babel/types';
import type { Type } from './types.js';

// ============================================================================
// Variable Binding Kind
// ============================================================================

export type BindingKind = 'const' | 'let' | 'var' | 'function' | 'class' | 'param';

// ============================================================================
// Variable Binding
// ============================================================================

export interface Binding {
  readonly type: Type;
  readonly kind: BindingKind;
  readonly node: Node;
  readonly mutable: boolean;
  readonly scope: 'global' | 'function' | 'block' | 'module';
  // For hoisted declarations (var, function), tracks if initialized
  readonly initialized: boolean;
}

// ============================================================================
// Type Environment (Symbol Table)
// ============================================================================

export interface TypeEnvironment {
  readonly parent: TypeEnvironment | null;
  readonly bindings: ReadonlyMap<string, Binding>;
  readonly scope: 'global' | 'function' | 'block' | 'module';
  readonly scopeId: string;
}

// ============================================================================
// Analysis State (per program point)
// ============================================================================

export interface TypeState {
  readonly env: TypeEnvironment;
  readonly reachable: boolean;
  readonly thisType?: Type;
  readonly returnValue?: Type;
  // For control flow tracking
  readonly loopDepth: number;
  // For exception handling
  readonly inTryBlock: boolean;
  // For tracking modified variables (for widening)
  readonly modifiedVars: ReadonlySet<string>;
}

// ============================================================================
// State Change Tracking
// ============================================================================

export interface StateChange {
  readonly nodeId: string;
  readonly oldState: TypeState;
  readonly newState: TypeState;
  readonly changes: readonly BindingChange[];
}

export interface BindingChange {
  readonly name: string;
  readonly oldType: Type;
  readonly newType: Type;
  readonly kind: 'added' | 'modified' | 'removed';
}

// ============================================================================
// Iteration Context (shared across analysis)
// ============================================================================

export interface IterationContext {
  readonly cfg: any; // CFG from cfg.ts
  readonly source: string;
  readonly filename: string;
  readonly modifiedInLoops: ReadonlySet<string>;
  readonly hoistedDeclarations: ReadonlyMap<string, Node>;
  readonly globalEnv: TypeEnvironment;
  // For tracking progress
  readonly maxIterations: number;
  readonly iterationCount: { value: number };
}

// ============================================================================
// Environment Creation
// ============================================================================

let scopeIdCounter = 0;
export function generateScopeId(): string {
  return `scope_${scopeIdCounter++}`;
}

export function createEnvironment(
  parent: TypeEnvironment | null,
  scope: TypeEnvironment['scope']
): TypeEnvironment {
  return {
    parent,
    bindings: new Map(),
    scope,
    scopeId: generateScopeId(),
  };
}

// ============================================================================
// Initial State Creation
// ============================================================================

export function createInitialState(env: TypeEnvironment): TypeState {
  return {
    env,
    reachable: true,
    loopDepth: 0,
    inTryBlock: false,
    modifiedVars: new Set(),
  };
}

export function createUnreachableState(env: TypeEnvironment): TypeState {
  return {
    env,
    reachable: false,
    loopDepth: 0,
    inTryBlock: false,
    modifiedVars: new Set(),
  };
}

// ============================================================================
// State Utilities
// ============================================================================

export function isStateEqual(s1: TypeState, s2: TypeState): boolean {
  if (s1.reachable !== s2.reachable) return false;
  if (s1.loopDepth !== s2.loopDepth) return false;
  if (s1.inTryBlock !== s2.inTryBlock) return false;

  // Compare returnValue types
  if (s1.returnValue !== undefined || s2.returnValue !== undefined) {
    if (!s1.returnValue || !s2.returnValue) return false;
    if (!isTypeEqual(s1.returnValue, s2.returnValue)) return false;
  }

  // Compare thisType
  if (s1.thisType !== undefined || s2.thisType !== undefined) {
    if (!s1.thisType || !s2.thisType) return false;
    if (!isTypeEqual(s1.thisType, s2.thisType)) return false;
  }

  // Compare environments
  return isEnvironmentEqual(s1.env, s2.env);
}

function isEnvironmentEqual(e1: TypeEnvironment, e2: TypeEnvironment): boolean {
  if (e1.scope !== e2.scope) return false;
  if (e1.bindings.size !== e2.bindings.size) return false;

  for (const [name, binding1] of e1.bindings) {
    const binding2 = e2.bindings.get(name);
    if (!binding2) return false;

    if (binding1.kind !== binding2.kind) return false;
    if (binding1.mutable !== binding2.mutable) return false;
    if (binding1.scope !== binding2.scope) return false;
    if (!isTypeEqual(binding1.type, binding2.type)) return false;
  }

  return true;
}

function isTypeEqual(t1: Type, t2: Type): boolean {
  // For our purposes, we can use reference equality for types
  // since we use type IDs for identity
  return t1.id === t2.id;
}

// ============================================================================
// Binding Utilities
// ============================================================================

export function createBinding(
  node: Node,
  type: Type,
  kind: BindingKind,
  mutable: boolean,
  scope: Binding['scope'],
  initialized: boolean = true
): Binding {
  return {
    type,
    kind,
    node,
    mutable,
    scope,
    initialized,
  };
}

export function updateBinding(
  env: TypeEnvironment,
  name: string,
  type: Type,
  kind: BindingKind,
  node: Node,
  mutable: boolean = true,
  initialized: boolean = true
): TypeEnvironment {
  const newBindings = new Map(env.bindings);
  newBindings.set(name, createBinding(node, type, kind, mutable, env.scope, initialized));

  return {
    ...env,
    bindings: newBindings,
  };
}

export function lookupBinding(env: TypeEnvironment, name: string): Binding | null {
  let current: TypeEnvironment | null = env;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) {
      return binding;
    }
    current = current.parent;
  }
  return null;
}

export function hasBinding(env: TypeEnvironment, name: string): boolean {
  return lookupBinding(env, name) !== null;
}

// ============================================================================
// State Helpers
// ============================================================================

export function withReturnValue(state: TypeState, returnValue: Type): TypeState {
  return {
    ...state,
    returnValue: state.returnValue ? joinTypes(state.returnValue, returnValue) : returnValue,
  };
}

export function withLoopDepth(state: TypeState, delta: number): TypeState {
  return {
    ...state,
    loopDepth: Math.max(0, state.loopDepth + delta),
  };
}

export function withTryBlock(state: TypeState, inTry: boolean): TypeState {
  return {
    ...state,
    inTryBlock: inTry,
  };
}

export function markModified(state: TypeState, varName: string): TypeState {
  const modified = new Set(state.modifiedVars);
  modified.add(varName);
  return {
    ...state,
    modifiedVars: modified,
  };
}

export function joinStates(states: readonly TypeState[]): TypeState {
  if (states.length === 0) {
    return createUnreachableState(createEnvironment(null, 'block'));
  }

  if (states.length === 1) {
    return states[0]!;
  }

  // Filter unreachable states
  const reachable = states.filter(s => s.reachable);
  if (reachable.length === 0) {
    return createUnreachableState(states[0]!.env);
  }

  // Find deepest common ancestor environment
  const commonEnv = findCommonEnvironment(reachable.map(s => s.env));

  // Join all bindings into common environment
  const joinedEnv = joinEnvironments(reachable.map(s => s.env), commonEnv);

  // Join return values
  const returnValues = reachable.map(s => s.returnValue).filter((v): v is Type => v !== undefined);
  const returnValue = returnValues.length > 0
    ? returnValues.reduce((acc, t) => joinTypes(acc, t))
    : undefined;

  // Join this types
  const thisTypes = reachable.map(s => s.thisType).filter((v): v is Type => v !== undefined);
  const thisType = thisTypes.length > 0
    ? thisTypes.reduce((acc, t) => joinTypes(acc, t))
    : undefined;

  // Union of modified variables
  const modifiedVars = new Set<string>();
  for (const s of reachable) {
    for (const v of s.modifiedVars) {
      modifiedVars.add(v);
    }
  }

  // Max loop depth
  const loopDepth = Math.max(...reachable.map(s => s.loopDepth));

  // In try block if any are
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

function findCommonEnvironment(envs: readonly TypeEnvironment[]): TypeEnvironment {
  if (envs.length === 0) {
    return createEnvironment(null, 'global');
  }

  if (envs.length === 1) {
    return envs[0]!;
  }

  // Find common ancestor by walking up from first env
  let current: TypeEnvironment | null = envs[0]!;
  const ancestors = new Set<string>();

  while (current) {
    ancestors.add(current.scopeId);
    current = current.parent;
  }

  // For each other env, walk up until we find a common ancestor
  for (let i = 1; i < envs.length; i++) {
    let other: TypeEnvironment | null = envs[i]!;
    const otherAncestors = new Set<string>();

    while (other) {
      otherAncestors.add(other.scopeId);
      other = other.parent;
    }

    // Intersect ancestors
    for (const id of ancestors) {
      if (!otherAncestors.has(id)) {
        ancestors.delete(id);
      }
    }

    if (ancestors.size === 0) {
      return createEnvironment(null, 'global');
    }
  }

  // Return the first environment in the original chain that's in the intersection
  current = envs[0]!;
  while (current && !ancestors.has(current.scopeId)) {
    current = current.parent;
  }

  return current || createEnvironment(null, 'global');
}

function joinEnvironments(envs: readonly TypeEnvironment[], common: TypeEnvironment): TypeEnvironment {
  const bindings = new Map<string, Binding>();

  // For each binding in any env, join the types
  const allNames = new Set<string>();
  for (const env of envs) {
    for (const name of env.bindings.keys()) {
      allNames.add(name);
    }
  }

  for (const name of allNames) {
    const types: Type[] = [];
    let kind: BindingKind = 'const';
    let mutable = false;
    let node: Node | null = null;
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

        mutable = mutable || binding.mutable;
        node = node || binding.node;
        initialized = initialized && binding.initialized;
      }
    }

    if (types.length > 0 && node) {
      const joinedType = types.length === 1 ? types[0]! : types.reduce((a, b) => joinTypes(a, b));
      bindings.set(name, createBinding(node, joinedType, kind, mutable, scope, initialized));
    }
  }

  return {
    ...common,
    bindings,
  };
}

// Simple join for now - will be replaced with proper MLsub join
function joinTypes(t1: Type, t2: Type): Type {
  if (t1.id === t2.id) return t1;

  // Check if t1 is a union type
  if (t1.kind === 'union') {
    const members = [...(t1 as any).members, t2];
    return { kind: 'union', id: `u_${members.map((t: any) => t.id).join('_')}`, members };
  }

  return {
    kind: 'union',
    id: `u_${t1.id}_${t2.id}`,
    members: [t1, t2],
  };
}
