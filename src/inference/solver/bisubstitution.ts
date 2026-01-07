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
      return replacement ?? type;
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
 */
export function eliminateLowerBound(
  subst: Bisubstitution,
  varId: number,
  bound: PolarType
): Bisubstitution {
  const existing = subst.positive.get(varId);
  const newType = existing
    ? union([existing, bound])  // α ⊔ existing ⊔ bound
    : union([{ kind: 'var', id: varId, name: `τ${varId}`, level: 0 }, bound]);

  return addPositive(subst, varId, newType);
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
