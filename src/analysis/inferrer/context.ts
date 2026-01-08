/**
 * Inference Context - Environment and context management
 *
 * This module handles type environments, bindings, and context for type inference.
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment, Binding, ScopeKind, ArrayType } from '../../types/index.js';
import type { TypeAnnotation } from '../../types/annotation.js';

/**
 * Helper to check if type is array
 */
export function isArrayType(type: Type): type is ArrayType {
  return type.kind === 'array';
}

/**
 * Type inference context
 */
export interface InferContext {
  /** Current type environment */
  env: TypeEnvironment;
  /** Collected annotations */
  annotations: TypeAnnotation[];
  /** Collected errors */
  errors: Array<{ message: string; line: number; column: number; nodeType?: string }>;
  /** Source code */
  source: string;
  /** Filename */
  filename: string;
}

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
 * Lookup a binding in the environment chain
 */
export function lookupBinding(env: TypeEnvironment, name: string): Binding | undefined {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (env.parent) return lookupBinding(env.parent, name);
  return undefined;
}

/**
 * Add a binding to the current environment
 */
export function addBinding(
  env: TypeEnvironment,
  name: string,
  type: Type,
  kind: Binding['kind'],
  node: t.Node
): TypeEnvironment {
  const newBindings = new Map(env.bindings);
  newBindings.set(name, {
    name,
    type,
    declarationNode: node,
    kind,
    definitelyAssigned: true,
    possiblyMutated: false,
  });
  return {
    ...env,
    bindings: newBindings,
  };
}
