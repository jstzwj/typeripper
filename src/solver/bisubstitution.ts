/**
 * Bisubstitution - Separate substitutions for positive and negative positions
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 4.3-4.4
 *
 * Unlike standard substitution which replaces all occurrences of a variable,
 * bisubstitution applies different replacements based on polarity:
 * - [τ⁺/α⁺]: replaces positive occurrences of α
 * - [τ⁻/α⁻]: replaces negative occurrences of α
 *
 * This is essential for MLsub's atomic constraint elimination:
 * - θ_{α≤τ} = [α ⊓ τ / α⁻] (constrain negative occurrences)
 * - θ_{τ≤α} = [α ⊔ τ / α⁺] (constrain positive occurrences)
 */

import type {
  PolarType,
  TypeVar,
  FunctionType,
  RecordType,
  ArrayType,
  UnionType,
  IntersectionType,
  RecursiveType,
  PromiseType,
  ClassType,
  FieldType,
} from '../types/index.js';
import { union, intersection } from '../types/index.js';

// ============================================================================
// Bisubstitution
// ============================================================================

/**
 * Bisubstitution: separate mappings for positive and negative positions
 */
export interface Bisubstitution {
  /**
   * Positive substitution: α⁺ → τ⁺
   * Applied to type variables in positive (output) positions
   */
  readonly positive: ReadonlyMap<number, PolarType>;

  /**
   * Negative substitution: α⁻ → τ⁻
   * Applied to type variables in negative (input) positions
   */
  readonly negative: ReadonlyMap<number, PolarType>;
}

/**
 * Create an empty bisubstitution
 */
export function emptyBisubst(): Bisubstitution {
  return {
    positive: new Map(),
    negative: new Map(),
  };
}

/**
 * Create a bisubstitution from maps
 */
export function bisubst(
  positive: ReadonlyMap<number, PolarType>,
  negative: ReadonlyMap<number, PolarType>
): Bisubstitution {
  return { positive, negative };
}

/**
 * Add a positive substitution: α⁺ → τ
 */
export function addPositive(
  subst: Bisubstitution,
  varId: number,
  type: PolarType
): Bisubstitution {
  const newPos = new Map(subst.positive);
  newPos.set(varId, type);
  return { ...subst, positive: newPos };
}

/**
 * Add a negative substitution: α⁻ → τ
 */
export function addNegative(
  subst: Bisubstitution,
  varId: number,
  type: PolarType
): Bisubstitution {
  const newNeg = new Map(subst.negative);
  newNeg.set(varId, type);
  return { ...subst, negative: newNeg };
}

/**
 * Compose two bisubstitutions
 * Apply s1 first, then s2
 */
export function compose(s1: Bisubstitution, s2: Bisubstitution): Bisubstitution {
  // Apply s2 to the types in s1
  const newPositive = new Map<number, PolarType>();
  const newNegative = new Map<number, PolarType>();

  for (const [id, type] of s1.positive) {
    newPositive.set(id, applyPositive(type, s2));
  }
  for (const [id, type] of s2.positive) {
    if (!newPositive.has(id)) {
      newPositive.set(id, type);
    }
  }

  for (const [id, type] of s1.negative) {
    newNegative.set(id, applyNegative(type, s2));
  }
  for (const [id, type] of s2.negative) {
    if (!newNegative.has(id)) {
      newNegative.set(id, type);
    }
  }

  return { positive: newPositive, negative: newNegative };
}

// ============================================================================
// Apply Bisubstitution
// ============================================================================

/**
 * Apply bisubstitution to a type in positive position
 */
export function applyPositive(type: PolarType, subst: Bisubstitution): PolarType {
  return applyBisubst(type, subst, '+');
}

/**
 * Apply bisubstitution to a type in negative position
 */
export function applyNegative(type: PolarType, subst: Bisubstitution): PolarType {
  return applyBisubst(type, subst, '-');
}

/**
 * Apply bisubstitution to a type at given polarity
 *
 * When a type variable has bounds at the opposite polarity, we can use them
 * to get more precise types. Specifically:
 * - In positive position: if we have α ≤ τ (negative bound), α represents
 *   something that flows into τ, so we can use the concrete part of the bound.
 * - In negative position: if we have τ ≤ α (positive bound), α represents
 *   something that receives from τ, so we can use the concrete part of the bound.
 */
function applyBisubst(
  type: PolarType,
  subst: Bisubstitution,
  polarity: '+' | '-'
): PolarType {
  switch (type.kind) {
    case 'var': {
      // Look up in appropriate substitution based on polarity
      const map = polarity === '+' ? subst.positive : subst.negative;
      const replacement = map.get(type.id);

      if (replacement) {
        return replacement;
      }

      // If no replacement at current polarity, check opposite polarity
      // and extract concrete bounds
      const oppositeMap = polarity === '+' ? subst.negative : subst.positive;
      const oppositeBound = oppositeMap.get(type.id);

      if (oppositeBound) {
        // Extract concrete types from the bound
        const concrete = extractConcreteType(oppositeBound, type.id);
        if (concrete) {
          return concrete;
        }
      }

      return type;
    }

    case 'function': {
      // Domain: flip polarity (contravariant)
      // Codomain: same polarity (covariant)
      const oppPolarity = polarity === '+' ? '-' : '+';
      return {
        ...type,
        params: type.params.map(p => ({
          ...p,
          type: applyBisubst(p.type, subst, oppPolarity),
        })),
        returnType: applyBisubst(type.returnType, subst, polarity),
      } as FunctionType;
    }

    case 'record': {
      // All fields: same polarity (covariant)
      const newFields = new Map<string, FieldType>();
      for (const [name, field] of type.fields) {
        newFields.set(name, {
          ...field,
          type: applyBisubst(field.type, subst, polarity),
        });
      }
      // Rest variable also substituted
      let newRest = type.rest;
      if (type.rest) {
        const map = polarity === '+' ? subst.positive : subst.negative;
        const replacement = map.get(type.rest.id);
        if (replacement && replacement.kind === 'var') {
          newRest = replacement;
        }
      }
      return {
        ...type,
        fields: newFields,
        rest: newRest,
      } as RecordType;
    }

    case 'array': {
      // Element type: same polarity (covariant for reads)
      return {
        ...type,
        elementType: applyBisubst(type.elementType, subst, polarity),
        tuple: type.tuple?.map(t => applyBisubst(t, subst, polarity)),
      } as ArrayType;
    }

    case 'union': {
      // Members: same polarity
      return {
        ...type,
        members: type.members.map(m => applyBisubst(m, subst, polarity)),
      } as UnionType;
    }

    case 'intersection': {
      // Members: same polarity
      return {
        ...type,
        members: type.members.map(m => applyBisubst(m, subst, polarity)),
      } as IntersectionType;
    }

    case 'recursive': {
      // Body: same polarity (but don't substitute bound variable)
      // TODO: Handle capture-avoiding substitution
      return {
        ...type,
        body: applyBisubst(type.body, subst, polarity),
      } as RecursiveType;
    }

    case 'promise': {
      // Resolved type: same polarity
      return {
        ...type,
        resolvedType: applyBisubst(type.resolvedType, subst, polarity),
      } as PromiseType;
    }

    case 'class': {
      return {
        ...type,
        constructorType: applyBisubst(type.constructorType, subst, polarity) as FunctionType,
        instanceType: applyBisubst(type.instanceType, subst, polarity) as RecordType,
        staticType: applyBisubst(type.staticType, subst, polarity) as RecordType,
        superClass: type.superClass
          ? applyBisubst(type.superClass, subst, polarity) as ClassType
          : null,
      } as ClassType;
    }

    // These don't contain type variables
    case 'primitive':
    case 'top':
    case 'bottom':
    case 'any':
    case 'never':
    case 'unknown':
      return type;

    default:
      return type;
  }
}

// ============================================================================
// Atomic Constraint Elimination
// ============================================================================

/**
 * Eliminate an upper bound constraint: α ≤ τ
 *
 * From the paper Section 4.4:
 * θ_{α≤τ} = [α ⊓ τ / α⁻]  (when α not free in τ)
 *
 * This means: constrain negative occurrences of α to also satisfy τ
 */
export function eliminateUpperBound(
  subst: Bisubstitution,
  varId: number,
  bound: PolarType
): Bisubstitution {
  const existing = subst.negative.get(varId);
  const newType = existing
    ? intersection([existing, bound])  // α ⊓ existing ⊓ bound
    : intersection([{ kind: 'var', id: varId, name: `τ${varId}`, level: 0 }, bound]);

  return addNegative(subst, varId, newType);
}

/**
 * Eliminate a lower bound constraint: τ ≤ α
 *
 * From the paper Section 4.4:
 * θ_{τ≤α} = [α ⊔ τ / α⁺]  (when α not free in τ)
 *
 * This means: constrain positive occurrences of α to include τ
 *
 * Optimization: If the bound is a concrete type (primitive, function, etc.),
 * we can directly use it instead of creating a union with the type variable.
 * This produces cleaner types in the output.
 */
export function eliminateLowerBound(
  subst: Bisubstitution,
  varId: number,
  bound: PolarType
): Bisubstitution {
  const existing = subst.positive.get(varId);

  // If the bound is a concrete type (not a type variable), we can use it directly
  // when there's no existing bound
  if (!existing && isConcreteType(bound)) {
    return addPositive(subst, varId, bound);
  }

  const newType = existing
    ? union([existing, bound])  // α ⊔ existing ⊔ bound
    : union([{ kind: 'var', id: varId, name: `τ${varId}`, level: 0 }, bound]);

  return addPositive(subst, varId, newType);
}

/**
 * Check if a type is concrete (not a type variable)
 */
function isConcreteType(type: PolarType): boolean {
  switch (type.kind) {
    case 'var':
      return false;
    case 'union':
      // A union is concrete if all members are concrete
      return type.members.every(m => isConcreteType(m));
    case 'intersection':
      return type.members.every(m => isConcreteType(m));
    default:
      return true;
  }
}

/**
 * Extract concrete types from a bound, filtering out type variables
 *
 * For example, if we have bound = τ28 | instance,
 * we extract instance (the concrete part).
 *
 * This is essential for producing readable type output - we prefer showing
 * concrete types over type variables when possible.
 */
function extractConcreteType(bound: PolarType, varId: number): PolarType | null {
  if (bound.kind === 'intersection') {
    // For intersection: α ⊓ τ₁ ⊓ τ₂ -> extract concrete members
    const concrete = bound.members.filter(m => m.kind !== 'var');
    if (concrete.length === 0) return null;
    if (concrete.length === 1) return concrete[0]!;
    return intersection(concrete);
  }

  if (bound.kind === 'union') {
    // For union: α ⊔ τ₁ ⊔ τ₂ -> extract concrete members
    const concrete = bound.members.filter(m => m.kind !== 'var');
    if (concrete.length === 0) return null;
    if (concrete.length === 1) return concrete[0]!;
    return union(concrete);
  }

  // If it's any type variable, no concrete type
  if (bound.kind === 'var') {
    return null;
  }

  // Otherwise, the bound is concrete
  return bound;
}

/**
 * Simplify a type by removing type variables from unions/intersections
 * where we have concrete types available, and converting unresolved
 * type variables to 'unknown' for clean output.
 *
 * This is used for final output to produce clean, readable types.
 */
export function simplifyTypeForOutput(type: PolarType): PolarType {
  switch (type.kind) {
    case 'var':
      // Type variables that reach output are unresolved
      // Convert them to 'unknown' for cleaner output
      return { kind: 'unknown' };

    case 'union': {
      // First simplify all members recursively
      const simplified = type.members.map(m => simplifyTypeForOutput(m));

      // Filter out unknown types if we have concrete types
      const concrete = simplified.filter(m => m.kind !== 'unknown' && m.kind !== 'var');
      const unknowns = simplified.filter(m => m.kind === 'unknown' || m.kind === 'var');

      // If we have concrete types, prefer them over unknowns
      if (concrete.length > 0) {
        if (concrete.length === 1) return concrete[0]!;
        return union(concrete);
      }

      // If only unknowns, return a single unknown
      if (unknowns.length > 0) {
        return { kind: 'unknown' };
      }

      return type;
    }

    case 'intersection': {
      // First simplify all members recursively
      const simplified = type.members.map(m => simplifyTypeForOutput(m));

      // Filter out unknown types if we have concrete types
      const concrete = simplified.filter(m => m.kind !== 'unknown' && m.kind !== 'var');
      const unknowns = simplified.filter(m => m.kind === 'unknown' || m.kind === 'var');

      // If we have concrete types, prefer them
      if (concrete.length > 0) {
        if (concrete.length === 1) return concrete[0]!;
        return intersection(concrete);
      }

      // If only unknowns, return a single unknown
      if (unknowns.length > 0) {
        return { kind: 'unknown' };
      }

      return type;
    }

    case 'function':
      return {
        ...type,
        params: type.params.map(p => ({
          ...p,
          type: simplifyTypeForOutput(p.type),
        })),
        returnType: simplifyTypeForOutput(type.returnType),
      } as FunctionType;

    case 'record': {
      const newFields = new Map<string, FieldType>();
      for (const [name, field] of type.fields) {
        newFields.set(name, {
          ...field,
          type: simplifyTypeForOutput(field.type),
        });
      }
      return { ...type, fields: newFields } as RecordType;
    }

    case 'array':
      return {
        ...type,
        elementType: simplifyTypeForOutput(type.elementType),
        tuple: type.tuple?.map(t => simplifyTypeForOutput(t)),
      } as ArrayType;

    case 'promise':
      return {
        ...type,
        resolvedType: simplifyTypeForOutput(type.resolvedType),
      };

    default:
      return type;
  }
}

// ============================================================================
// Stable Bisubstitution
// ============================================================================

/**
 * Check if a bisubstitution is stable
 *
 * A bisubstitution ξ is stable when:
 * 1. ξ(α⁻) ≤ ξ(α⁺) for all type variables α
 * 2. ξ² = ξ (idempotent)
 *
 * Stable bisubstitutions ensure that applying them yields instances.
 */
export function isStable(subst: Bisubstitution): boolean {
  // Check idempotence: applying twice should give same result
  // This is expensive, so we skip for now
  // TODO: Implement proper stability check

  // Basic check: each variable should have consistent bounds
  for (const varId of subst.positive.keys()) {
    const posType = subst.positive.get(varId);
    const negType = subst.negative.get(varId);

    if (posType && negType) {
      // Would need to check posType ≤ negType (requires subtyping check)
      // For now, accept if both are defined
    }
  }

  return true;
}

/**
 * Extract a standard substitution from a bisubstitution
 *
 * For each variable, use the positive binding if available,
 * otherwise the negative binding.
 */
export function toSubstitution(subst: Bisubstitution): Map<number, PolarType> {
  const result = new Map<number, PolarType>();

  // Prefer positive bindings (more general for output positions)
  for (const [id, type] of subst.positive) {
    result.set(id, type);
  }

  // Fall back to negative bindings
  for (const [id, type] of subst.negative) {
    if (!result.has(id)) {
      result.set(id, type);
    }
  }

  return result;
}
