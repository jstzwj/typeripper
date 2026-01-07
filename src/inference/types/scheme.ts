/**
 * Typing Schemes - MLsub's lambda-lifted style type representation
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 3.1
 *
 * Instead of traditional type schemes σ = ∀α₁...αₙ.τ,
 * MLsub uses typing schemes [Δ]τ where:
 * - Δ maps λ-bound variables to types
 * - τ is the body type (positive polarity)
 *
 * This explicitly tracks dependencies on λ-bound variables,
 * which is crucial for correct handling of subtyping.
 */

import type { PolarType, TypeVar } from './polar.js';
import { freeVars, substitute, freshTypeVar, typeEquals } from './polar.js';

// ============================================================================
// Typing Scheme
// ============================================================================

/**
 * MLsub Typing Scheme: [Δ]τ
 *
 * Represents a type that may depend on λ-bound variables.
 * All type variables not in Δ are implicitly universally quantified.
 */
export interface TypingScheme {
  /**
   * Delta (Δ): mapping from λ-bound term variables to their types
   * These represent dependencies on the enclosing context
   */
  readonly delta: ReadonlyMap<string, PolarType>;

  /**
   * The body type (always positive polarity for expression types)
   */
  readonly body: PolarType;
}

/**
 * Polymorphic Scheme for let-polymorphism
 *
 * Explicitly tracks which type variables are quantified.
 */
export interface PolyScheme {
  /**
   * Set of quantified type variable IDs
   * These variables will be instantiated with fresh variables on use
   */
  readonly quantified: ReadonlySet<number>;

  /**
   * The underlying typing scheme
   */
  readonly scheme: TypingScheme;
}

// ============================================================================
// Scheme Construction
// ============================================================================

/**
 * Create a typing scheme from a type and its dependencies
 */
export function typingScheme(
  body: PolarType,
  delta: ReadonlyMap<string, PolarType> = new Map()
): TypingScheme {
  return { delta, body };
}

/**
 * Create a monomorphic scheme (no quantified variables)
 * Used for λ-bound variables
 */
export function monoScheme(type: PolarType): PolyScheme {
  return {
    quantified: new Set(),
    scheme: typingScheme(type),
  };
}

/**
 * Create a polymorphic scheme with explicit quantification
 */
export function polyScheme(
  quantified: ReadonlySet<number>,
  body: PolarType,
  delta: ReadonlyMap<string, PolarType> = new Map()
): PolyScheme {
  return {
    quantified,
    scheme: typingScheme(body, delta),
  };
}

// ============================================================================
// Generalization
// ============================================================================

/**
 * Get free type variables in a typing environment
 */
export function freeVarsInEnv(env: ReadonlyMap<string, PolyScheme>): Set<number> {
  const result = new Set<number>();

  for (const scheme of env.values()) {
    // Only collect free vars that are NOT quantified
    const schemeVars = freeVarsInScheme(scheme.scheme);
    for (const varId of schemeVars) {
      if (!scheme.quantified.has(varId)) {
        result.add(varId);
      }
    }
  }

  return result;
}

/**
 * Get free type variables in a typing scheme
 */
export function freeVarsInScheme(scheme: TypingScheme): Set<number> {
  const result = freeVars(scheme.body);

  for (const type of scheme.delta.values()) {
    for (const varId of freeVars(type)) {
      result.add(varId);
    }
  }

  return result;
}

/**
 * Generalize a type to a polymorphic scheme
 *
 * Quantifies all type variables that are:
 * 1. Free in the type
 * 2. NOT free in the environment
 *
 * This implements let-polymorphism in MLsub.
 */
export function generalize(
  env: ReadonlyMap<string, PolyScheme>,
  type: PolarType,
  delta: ReadonlyMap<string, PolarType> = new Map()
): PolyScheme {
  const envFree = freeVarsInEnv(env);
  const typeFree = freeVars(type);

  // Also consider variables free in delta
  for (const deltaType of delta.values()) {
    for (const varId of freeVars(deltaType)) {
      envFree.add(varId);
    }
  }

  // Quantify variables free in type but not in env
  const quantified = new Set<number>();
  for (const varId of typeFree) {
    if (!envFree.has(varId)) {
      quantified.add(varId);
    }
  }

  return {
    quantified,
    scheme: typingScheme(type, delta),
  };
}

// ============================================================================
// Instantiation
// ============================================================================

/**
 * Result of instantiating a scheme
 */
export interface InstantiationResult {
  /** The instantiated type */
  type: PolarType;
  /** Mapping from old variable IDs to new variables */
  substitution: ReadonlyMap<number, TypeVar>;
}

/**
 * Instantiate a polymorphic scheme with fresh type variables
 *
 * For each quantified variable, create a fresh variable and substitute.
 */
export function instantiate(scheme: PolyScheme, level: number = 0): InstantiationResult {
  const substitution = new Map<number, TypeVar>();

  // Create fresh variables for each quantified variable
  for (const varId of scheme.quantified) {
    substitution.set(varId, freshTypeVar(undefined, level));
  }

  // Apply substitution to the body
  let type = scheme.scheme.body;
  for (const [oldId, newVar] of substitution) {
    type = substitute(type, oldId, newVar);
  }

  return { type, substitution };
}

/**
 * Instantiate a scheme, returning only the type
 */
export function instantiateType(scheme: PolyScheme, level: number = 0): PolarType {
  return instantiate(scheme, level).type;
}

// ============================================================================
// Subsumption
// ============================================================================

/**
 * Check if one scheme subsumes another: [Δ₁]τ₁ ≤^∀ [Δ₂]τ₂
 *
 * This holds when there exists a substitution ρ such that:
 * - ρ(τ₁) ≤ τ₂
 * - Δ₂(x) ≤ ρ(Δ₁(x)) for all x in dom(Δ₁)
 *
 * Note: This requires a full constraint solver to implement correctly.
 * This is a placeholder that will be integrated with the biunification solver.
 */
export function subsumes(
  _scheme1: TypingScheme,
  _scheme2: TypingScheme
): boolean {
  // TODO: Implement using biunification
  // This requires solving: ρ(τ₁) ≤ τ₂ and Δ₂(x) ≤ ρ(Δ₁(x))
  throw new Error('subsumes requires biunification solver');
}

// ============================================================================
// Scheme Equivalence
// ============================================================================

/**
 * Check if two typing schemes are equivalent
 *
 * Two schemes are equivalent if they have the same instances (flow edges).
 * See paper Section 3.2 for the example with `choose`.
 */
export function schemeEquals(a: PolyScheme, b: PolyScheme): boolean {
  // Simple check: same quantified count and body structure
  // Full equivalence requires checking inst(a) = inst(b)
  if (a.quantified.size !== b.quantified.size) {
    // Different number of quantified vars might still be equivalent
    // e.g., [](α → α → α) ≡ [](β → γ → (β ⊔ γ))
    // Fall through to structural check
  }

  // For now, just check structural equality of bodies
  // TODO: Implement proper scheme equivalence via flow edges
  return typeEquals(instantiateType(a), instantiateType(b));
}

// ============================================================================
// Delta Operations
// ============================================================================

/**
 * Merge two deltas using intersection (⊓) for types
 *
 * Used when combining constraints from multiple subexpressions
 * in rules like (APP), (IF), (CONS)
 */
export function mergeDelta(
  delta1: ReadonlyMap<string, PolarType>,
  delta2: ReadonlyMap<string, PolarType>
): Map<string, PolarType> {
  const result = new Map<string, PolarType>();

  // Get all variable names from both deltas
  const allVars = new Set([...delta1.keys(), ...delta2.keys()]);

  for (const name of allVars) {
    const t1 = delta1.get(name);
    const t2 = delta2.get(name);

    if (t1 && t2) {
      // Both have this variable: intersect the types
      // Import dynamically to avoid circular dependency
      const { intersection } = require('./factory.js');
      result.set(name, intersection([t1, t2]));
    } else if (t1) {
      result.set(name, t1);
    } else if (t2) {
      result.set(name, t2);
    }
  }

  return result;
}

/**
 * Remove a variable from delta
 *
 * Used when processing λ-abstractions: the bound variable
 * is removed from delta and becomes part of the function type.
 */
export function removeDelta(
  delta: ReadonlyMap<string, PolarType>,
  varName: string
): { type: PolarType | null; delta: Map<string, PolarType> } {
  const newDelta = new Map(delta);
  const type = newDelta.get(varName) ?? null;
  newDelta.delete(varName);
  return { type, delta: newDelta };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a scheme is monomorphic (no quantified variables)
 */
export function isMonomorphic(scheme: PolyScheme): boolean {
  return scheme.quantified.size === 0;
}

/**
 * Get the number of quantified variables
 */
export function polyDegree(scheme: PolyScheme): number {
  return scheme.quantified.size;
}

/**
 * Create a scheme from just a type (common case)
 */
export function schemeFromType(type: PolarType): TypingScheme {
  return typingScheme(type);
}

/**
 * Extract the body type from a scheme (for quick access)
 */
export function schemeBody(scheme: TypingScheme | PolyScheme): PolarType {
  if ('scheme' in scheme) {
    return scheme.scheme.body;
  }
  return scheme.body;
}
