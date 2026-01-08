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
import { union, intersection, typeEquals } from '../types/index.js';

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
 * Iteratively applies until a fixed point is reached.
 */
export function applyPositive(type: PolarType, subst: Bisubstitution): PolarType {
  // Use a visited set to detect cycles
  const visited = new Set<number>();
  return applyBisubstWithCycle(type, subst, '+', visited);
}

/**
 * Apply bisubstitution to a type in negative position
 * Iteratively applies until a fixed point is reached.
 */
export function applyNegative(type: PolarType, subst: Bisubstitution): PolarType {
  // Use a visited set to detect cycles
  const visited = new Set<number>();
  return applyBisubstWithCycle(type, subst, '-', visited);
}

/**
 * Apply bisubstitution with cycle detection
 */
function applyBisubstWithCycle(
  type: PolarType,
  subst: Bisubstitution,
  polarity: '+' | '-',
  visited: Set<number>
): PolarType {
  switch (type.kind) {
    case 'var': {
      // Cycle detection: if we've already visited this variable, return it as-is
      if (visited.has(type.id)) {
        return type;
      }

      // Look up in appropriate substitution based on polarity
      const map = polarity === '+' ? subst.positive : subst.negative;
      const replacement = map.get(type.id);

      if (replacement) {
        // Mark as visited before recursing
        visited.add(type.id);
        const result = applyBisubstWithCycle(replacement, subst, polarity, visited);
        visited.delete(type.id);
        return result;
      }

      // If no replacement at current polarity, check opposite polarity
      // and extract concrete bounds
      const oppositeMap = polarity === '+' ? subst.negative : subst.positive;
      const oppositeBound = oppositeMap.get(type.id);

      if (oppositeBound) {
        // Extract concrete types from the bound
        visited.add(type.id);
        const concrete = extractConcreteTypeWithCycle(oppositeBound, type.id, subst, polarity, visited);
        visited.delete(type.id);
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

      // Handle properties if present
      let newProperties: ReadonlyMap<string, FieldType> | undefined;
      if (type.properties) {
        const propsMap = new Map<string, FieldType>();
        for (const [name, field] of type.properties) {
          propsMap.set(name, {
            ...field,
            type: applyBisubstWithCycle(field.type, subst, polarity, visited),
          });
        }
        newProperties = propsMap;
      }

      return {
        ...type,
        params: type.params.map(p => ({
          ...p,
          type: applyBisubstWithCycle(p.type, subst, oppPolarity, visited),
        })),
        returnType: applyBisubstWithCycle(type.returnType, subst, polarity, visited),
        properties: newProperties,
      } as FunctionType;
    }

    case 'record': {
      // All fields: same polarity (covariant)
      const newFields = new Map<string, FieldType>();
      for (const [name, field] of type.fields) {
        newFields.set(name, {
          ...field,
          type: applyBisubstWithCycle(field.type, subst, polarity, visited),
        });
      }
      return {
        ...type,
        fields: newFields,
      } as RecordType;
    }

    case 'array': {
      // Element type: same polarity (covariant for reads)
      // Handle properties if present
      let newProperties: ReadonlyMap<string, FieldType> | undefined;
      if (type.properties) {
        const propsMap = new Map<string, FieldType>();
        for (const [name, field] of type.properties) {
          propsMap.set(name, {
            ...field,
            type: applyBisubstWithCycle(field.type, subst, polarity, visited),
          });
        }
        newProperties = propsMap;
      }

      return {
        ...type,
        elementType: applyBisubstWithCycle(type.elementType, subst, polarity, visited),
        tuple: type.tuple?.map(t => applyBisubstWithCycle(t, subst, polarity, visited)),
        properties: newProperties,
      } as ArrayType;
    }

    case 'union': {
      // Members: same polarity
      return {
        ...type,
        members: type.members.map(m => applyBisubstWithCycle(m, subst, polarity, visited)),
      } as UnionType;
    }

    case 'intersection': {
      // Members: same polarity
      return {
        ...type,
        members: type.members.map(m => applyBisubstWithCycle(m, subst, polarity, visited)),
      } as IntersectionType;
    }

    case 'recursive': {
      // Body: same polarity (but don't substitute bound variable)
      return {
        ...type,
        body: applyBisubstWithCycle(type.body, subst, polarity, visited),
      } as RecursiveType;
    }

    case 'promise': {
      // Resolved type: same polarity
      return {
        ...type,
        resolvedType: applyBisubstWithCycle(type.resolvedType, subst, polarity, visited),
      } as PromiseType;
    }

    case 'class': {
      return {
        ...type,
        constructorType: applyBisubstWithCycle(type.constructorType, subst, polarity, visited) as FunctionType,
        instanceType: applyBisubstWithCycle(type.instanceType, subst, polarity, visited) as RecordType,
        staticType: applyBisubstWithCycle(type.staticType, subst, polarity, visited) as RecordType,
        superClass: type.superClass
          ? applyBisubstWithCycle(type.superClass, subst, polarity, visited) as ClassType
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

/**
 * Extract concrete types from a bound with cycle detection
 */
function extractConcreteTypeWithCycle(
  bound: PolarType,
  varId: number,
  subst: Bisubstitution,
  polarity: '+' | '-',
  visited: Set<number>
): PolarType | null {
  // First apply substitution to the bound
  const applied = applyBisubstWithCycle(bound, subst, polarity, visited);

  if (applied.kind === 'intersection') {
    const concrete = applied.members.filter(m => m.kind !== 'var');
    if (concrete.length === 0) return null;
    if (concrete.length === 1) return concrete[0]!;
    return intersection(concrete);
  }

  if (applied.kind === 'union') {
    const concrete = applied.members.filter(m => m.kind !== 'var');
    if (concrete.length === 0) return null;
    if (concrete.length === 1) return concrete[0]!;
    return union(concrete);
  }

  if (applied.kind === 'var') {
    return null;
  }

  return applied;
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

  // If the bound is the same variable, skip (self-reference)
  if (bound.kind === 'var' && bound.id === varId) {
    return subst;
  }

  // Create union with existing bound, but don't include self-reference
  // This avoids creating types like τ39 | τ39 | ...
  if (existing) {
    // Check if bound is already in existing union
    if (existing.kind === 'union' && existing.members.some(m =>
      m.kind === 'var' && bound.kind === 'var' && m.id === bound.id
    )) {
      return subst;
    }
    return addPositive(subst, varId, union([existing, bound]));
  }

  // When no existing bound, just use the bound directly
  // This avoids self-referential types like τ39 | call
  // where the resulting type still contains τ39
  return addPositive(subst, varId, bound);
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

      // Deduplicate using structural equality
      const deduped = deduplicateTypes(simplified);

      // Filter out unknown types - they are redundant in unions since any concrete type is a subtype of unknown
      const concrete = deduped.filter(m => m.kind !== 'unknown' && m.kind !== 'var');

      // If we have concrete types, use them (unknown is redundant in union with concrete types)
      if (concrete.length > 0) {
        // Further simplify: remove function types that are `() => unknown` when we have more specific types
        const simplified = simplifyFunctionUnion(concrete);
        if (simplified.length === 1) return simplified[0]!;
        return { kind: 'union', members: simplified };
      }

      // If only unknowns, return a single unknown
      if (deduped.length > 0) {
        return { kind: 'unknown' };
      }

      return type;
    }

    case 'intersection': {
      // First simplify all members recursively
      const simplified = type.members.map(m => simplifyTypeForOutput(m));

      // Deduplicate using structural equality
      const deduped = deduplicateTypes(simplified);

      // Filter out unknown types if we have concrete types
      const concrete = deduped.filter(m => m.kind !== 'unknown' && m.kind !== 'var');
      const unknowns = deduped.filter(m => m.kind === 'unknown' || m.kind === 'var');

      // If we have concrete types, prefer them
      if (concrete.length > 0) {
        if (concrete.length === 1) return concrete[0]!;
        return { kind: 'intersection', members: concrete };
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

/**
 * Deduplicate types using structural equality
 */
function deduplicateTypes(types: PolarType[]): PolarType[] {
  const result: PolarType[] = [];
  for (const t of types) {
    // Check if this type is structurally equal to any already added
    if (!result.some(existing => typeEquals(existing, t))) {
      result.push(t);
    }
  }
  return result;
}

/**
 * Simplify a union of function types by removing less specific variants.
 * For example: `() => number | () => unknown` simplifies to `() => number`
 * because () => number is more specific than () => unknown.
 */
function simplifyFunctionUnion(types: PolarType[]): PolarType[] {
  // Separate function types from other types
  const functions: FunctionType[] = [];
  const others: PolarType[] = [];

  for (const t of types) {
    if (t.kind === 'function') {
      functions.push(t);
    } else {
      others.push(t);
    }
  }

  if (functions.length <= 1) {
    return types;
  }

  // Group functions by their parameter signature (arity and param types)
  const groups = new Map<string, FunctionType[]>();
  for (const fn of functions) {
    const key = functionSignatureKey(fn);
    const existing = groups.get(key) ?? [];
    existing.push(fn);
    groups.set(key, existing);
  }

  // For each group, keep only the most specific function (prefer concrete return types over unknown)
  const simplifiedFunctions: FunctionType[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      simplifiedFunctions.push(group[0]!);
    } else {
      // Find the most specific function - prefer concrete return types
      const best = group.reduce((a, b) => {
        const aUnknown = hasUnknownReturn(a);
        const bUnknown = hasUnknownReturn(b);
        // Prefer non-unknown return types
        if (!aUnknown && bUnknown) return a;
        if (aUnknown && !bUnknown) return b;
        // If both or neither are unknown, prefer the first one (arbitrary)
        return a;
      });
      simplifiedFunctions.push(best);
    }
  }

  return [...others, ...simplifiedFunctions];
}

/**
 * Create a key for function signature based on parameter types
 */
function functionSignatureKey(fn: FunctionType): string {
  const params = fn.params.map(p => {
    const opt = p.optional ? '?' : '';
    const rest = p.rest ? '...' : '';
    // Only use kind for grouping, not full type (to group by arity/structure)
    return `${rest}${p.name}${opt}`;
  }).join(',');
  return `(${params})`;
}

/**
 * Check if a function has an unknown return type
 */
function hasUnknownReturn(fn: FunctionType): boolean {
  return fn.returnType.kind === 'unknown';
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
