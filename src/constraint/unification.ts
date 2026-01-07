/**
 * Unification Algorithm - Core constraint solving via type unification
 *
 * Unification finds a substitution that makes two types equal.
 * This is the heart of Hindley-Milner type inference.
 *
 * The algorithm handles:
 * - Type variables (binds them to other types)
 * - Structural types (recursively unifies components)
 * - Occurs check (prevents infinite types)
 */

import type {
  ConstraintType,
  TypeVar,
  Constraint,
  EqualityConstraint,
  SubtypeConstraint,
  SolveError,
  ConstraintSource,
} from './types.js';
import { SubstitutionBuilder } from './substitution.js';
import { Types } from '../utils/type-factory.js';

/**
 * Result of a unification attempt
 */
export type UnifyResult =
  | { success: true; substitution: SubstitutionBuilder }
  | { success: false; error: SolveError }
  ;

/**
 * Unifier class - performs type unification
 */
export class Unifier {
  private subst: SubstitutionBuilder;
  private errors: SolveError[] = [];

  constructor(initialSubst?: SubstitutionBuilder) {
    this.subst = initialSubst ?? SubstitutionBuilder.empty();
  }

  /**
   * Unify two types, returning success or failure
   */
  unify(t1: ConstraintType, t2: ConstraintType, source: ConstraintSource): boolean {
    // Apply current substitution before unifying
    const s1 = this.subst.apply(t1);
    const s2 = this.subst.apply(t2);

    return this.unifyInternal(s1, s2, source);
  }

  /**
   * Internal unification after substitution application
   */
  private unifyInternal(t1: ConstraintType, t2: ConstraintType, source: ConstraintSource): boolean {
    // Same type - trivially unified
    if (this.structurallyEqual(t1, t2)) {
      return true;
    }

    // Type variable on left
    if (t1.kind === 'typevar') {
      return this.unifyVar(t1 as TypeVar, t2, source);
    }

    // Type variable on right
    if (t2.kind === 'typevar') {
      return this.unifyVar(t2 as TypeVar, t1, source);
    }

    // Both are concrete types - check structural compatibility

    // Any unifies with anything (unsound but practical)
    if (t1.kind === 'any' || t2.kind === 'any') {
      return true;
    }

    // Never unifies with nothing
    if (t1.kind === 'never' || t2.kind === 'never') {
      this.addError('incompatible-types', `Cannot unify ${t1.kind} with ${t2.kind}`, source, [t1, t2]);
      return false;
    }

    // Function types
    if (t1.kind === 'function' && t2.kind === 'function') {
      return this.unifyFunctions(t1, t2, source);
    }

    // Array types
    if (t1.kind === 'array' && t2.kind === 'array') {
      return this.unifyInternal(t1.elementType, t2.elementType, source);
    }

    // Object types
    if (t1.kind === 'object' && t2.kind === 'object') {
      return this.unifyObjects(t1, t2, source);
    }

    // Union types - more complex handling
    if (t1.kind === 'union' || t2.kind === 'union') {
      return this.unifyWithUnion(t1, t2, source);
    }

    // Type application (generics)
    if (t1.kind === 'app' && t2.kind === 'app') {
      if (t1.constructor !== t2.constructor) {
        this.addError('incompatible-types', `Type constructors differ: ${t1.constructor} vs ${t2.constructor}`, source, [t1, t2]);
        return false;
      }
      if (t1.args.length !== t2.args.length) {
        this.addError('incompatible-types', `Type argument count differs`, source, [t1, t2]);
        return false;
      }
      for (let i = 0; i < t1.args.length; i++) {
        if (!this.unifyInternal(t1.args[i]!, t2.args[i]!, source)) {
          return false;
        }
      }
      return true;
    }

    // Row types
    if (t1.kind === 'row' && t2.kind === 'row') {
      return this.unifyRows(t1, t2, source);
    }

    // Promise types
    if (t1.kind === 'promise' && t2.kind === 'promise') {
      return this.unifyInternal(t1.resolvedType, t2.resolvedType, source);
    }

    // Primitive types - must be exactly equal
    if (t1.kind === t2.kind) {
      // For literal types, check values
      if (t1.kind === 'number' && t2.kind === 'number') {
        if (t1.value !== undefined && t2.value !== undefined && t1.value !== t2.value) {
          this.addError('incompatible-types', `Number literals differ: ${t1.value} vs ${t2.value}`, source, [t1, t2]);
          return false;
        }
        return true;
      }
      if (t1.kind === 'string' && t2.kind === 'string') {
        if (t1.value !== undefined && t2.value !== undefined && t1.value !== t2.value) {
          this.addError('incompatible-types', `String literals differ: "${t1.value}" vs "${t2.value}"`, source, [t1, t2]);
          return false;
        }
        return true;
      }
      if (t1.kind === 'boolean' && t2.kind === 'boolean') {
        if (t1.value !== undefined && t2.value !== undefined && t1.value !== t2.value) {
          this.addError('incompatible-types', `Boolean literals differ: ${t1.value} vs ${t2.value}`, source, [t1, t2]);
          return false;
        }
        return true;
      }
      // Other same-kind primitives unify
      return true;
    }

    // Incompatible types
    this.addError('incompatible-types', `Cannot unify ${t1.kind} with ${t2.kind}`, source, [t1, t2]);
    return false;
  }

  /**
   * Unify a type variable with another type
   */
  private unifyVar(tv: TypeVar, type: ConstraintType, source: ConstraintSource): boolean {
    // Variable already bound?
    const existing = this.subst.get(tv);
    if (existing) {
      return this.unifyInternal(existing, type, source);
    }

    // Occurs check - prevent infinite types like α = List<α>
    if (this.occursIn(tv, type)) {
      this.addError('infinite-type', `Type variable ${tv.name} occurs in its own definition`, source, [tv, type]);
      return false;
    }

    // Bind the variable
    this.subst.bind(tv, type);
    return true;
  }

  /**
   * Occurs check - does tv appear anywhere in type?
   */
  private occursIn(tv: TypeVar, type: ConstraintType): boolean {
    // Apply substitution first
    const t = this.subst.apply(type);

    if (t.kind === 'typevar') {
      return t.id === tv.id;
    }

    if (t.kind === 'function') {
      return t.params.some(p => this.occursIn(tv, p.type)) ||
             this.occursIn(tv, t.returnType);
    }

    if (t.kind === 'array') {
      return this.occursIn(tv, t.elementType);
    }

    if (t.kind === 'object') {
      for (const prop of t.properties.values()) {
        if (this.occursIn(tv, prop.type)) return true;
      }
      return false;
    }

    if (t.kind === 'union' || t.kind === 'intersection') {
      return t.members.some(m => this.occursIn(tv, m));
    }

    if (t.kind === 'app') {
      return t.args.some(a => this.occursIn(tv, a));
    }

    if (t.kind === 'row') {
      for (const fieldType of t.fields.values()) {
        if (this.occursIn(tv, fieldType)) return true;
      }
      return t.rest !== null && t.rest.id === tv.id;
    }

    if (t.kind === 'promise') {
      return this.occursIn(tv, t.resolvedType);
    }

    return false;
  }

  /**
   * Unify function types
   */
  private unifyFunctions(
    f1: ConstraintType & { kind: 'function' },
    f2: ConstraintType & { kind: 'function' },
    source: ConstraintSource
  ): boolean {
    // Parameter count must match (or handle optional/rest params)
    const minParams = Math.min(f1.params.length, f2.params.length);

    // Unify parameters (contravariant)
    for (let i = 0; i < minParams; i++) {
      if (!this.unifyInternal(f1.params[i]!.type, f2.params[i]!.type, source)) {
        return false;
      }
    }

    // Unify return types (covariant)
    return this.unifyInternal(f1.returnType, f2.returnType, source);
  }

  /**
   * Unify object types
   */
  private unifyObjects(
    o1: ConstraintType & { kind: 'object' },
    o2: ConstraintType & { kind: 'object' },
    source: ConstraintSource
  ): boolean {
    // All properties in o1 must exist in o2 with compatible types
    for (const [name, prop1] of o1.properties) {
      const prop2 = o2.properties.get(name);
      if (!prop2) {
        this.addError('missing-property', `Property '${name}' missing in object`, source, [o1, o2]);
        return false;
      }
      if (!this.unifyInternal(prop1.type, prop2.type, source)) {
        return false;
      }
    }

    // All properties in o2 must exist in o1 (for strict equality)
    for (const [name] of o2.properties) {
      if (!o1.properties.has(name)) {
        this.addError('missing-property', `Property '${name}' missing in object`, source, [o1, o2]);
        return false;
      }
    }

    return true;
  }

  /**
   * Unify with union types
   * This is more complex - we need to check if one type is a member of the union
   */
  private unifyWithUnion(t1: ConstraintType, t2: ConstraintType, source: ConstraintSource): boolean {
    // If both are unions, check if they have compatible members
    if (t1.kind === 'union' && t2.kind === 'union') {
      // For now, try to unify each member of t1 with some member of t2
      // This is a simplification - full union unification is complex
      for (const m1 of t1.members) {
        let found = false;
        for (const m2 of t2.members) {
          // Try unification without modifying the substitution permanently
          const tempUnifier = new Unifier(this.subst.clone());
          if (tempUnifier.unifyInternal(m1, m2, source)) {
            found = true;
            break;
          }
        }
        if (!found) {
          this.addError('incompatible-types', `Union member not found in other union`, source, [t1, t2]);
          return false;
        }
      }
      return true;
    }

    // If one is a union, check if the other is a member
    const [union, other] = t1.kind === 'union' ? [t1, t2] : [t2, t1];
    if (union.kind === 'union') {
      for (const member of union.members) {
        const tempUnifier = new Unifier(this.subst.clone());
        if (tempUnifier.unifyInternal(member, other, source)) {
          // Found a compatible member - use its substitution
          this.subst = tempUnifier.subst;
          return true;
        }
      }
      this.addError('incompatible-types', `Type not compatible with any union member`, source, [t1, t2]);
      return false;
    }

    return false;
  }

  /**
   * Unify row types
   */
  private unifyRows(
    r1: ConstraintType & { kind: 'row' },
    r2: ConstraintType & { kind: 'row' },
    source: ConstraintSource
  ): boolean {
    // Unify common fields
    for (const [name, type1] of r1.fields) {
      const type2 = r2.fields.get(name);
      if (type2) {
        if (!this.unifyInternal(type1, type2, source)) {
          return false;
        }
      }
    }

    // Handle row variables
    if (r1.rest && r2.rest) {
      return this.unifyInternal(r1.rest, r2.rest, source);
    }

    // One is open, one is closed - the open one must be closed
    if (r1.rest && !r2.rest) {
      // r1 is open, r2 is closed
      // Check that r2 has all fields not in r1
      for (const name of r2.fields.keys()) {
        if (!r1.fields.has(name)) {
          // r1.rest must include this field
          // This is complex - for now, bind r1.rest to the remaining fields
        }
      }
    }

    return true;
  }

  /**
   * Check structural equality of two types
   */
  private structurallyEqual(t1: ConstraintType, t2: ConstraintType): boolean {
    if (t1.kind !== t2.kind) return false;

    if (t1.kind === 'typevar' && t2.kind === 'typevar') {
      return t1.id === t2.id;
    }

    if (t1.kind === 'number' && t2.kind === 'number') {
      return t1.value === t2.value;
    }

    if (t1.kind === 'string' && t2.kind === 'string') {
      return t1.value === t2.value;
    }

    if (t1.kind === 'boolean' && t2.kind === 'boolean') {
      return t1.value === t2.value;
    }

    // For primitive types without values, same kind is enough
    if (['undefined', 'null', 'any', 'never', 'unknown'].includes(t1.kind)) {
      return true;
    }

    // For complex types, we'd need deeper comparison
    // For now, return false to trigger unification
    return false;
  }

  /**
   * Add an error
   */
  private addError(
    kind: SolveError['kind'],
    message: string,
    source: ConstraintSource,
    types?: ConstraintType[]
  ): void {
    this.errors.push({ kind, message, source, types });
  }

  /**
   * Get the current substitution
   */
  getSubstitution(): SubstitutionBuilder {
    return this.subst;
  }

  /**
   * Get all errors
   */
  getErrors(): readonly SolveError[] {
    return this.errors;
  }

  /**
   * Check if unification succeeded (no errors)
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
}

/**
 * Solve a set of equality constraints
 */
export function solveEqualityConstraints(
  constraints: EqualityConstraint[],
  initialSubst?: SubstitutionBuilder
): UnifyResult {
  const unifier = new Unifier(initialSubst);

  for (const constraint of constraints) {
    if (!unifier.unify(constraint.left, constraint.right, constraint.source)) {
      return {
        success: false,
        error: unifier.getErrors()[0]!,
      };
    }
  }

  return {
    success: true,
    substitution: unifier.getSubstitution(),
  };
}

/**
 * Try to unify two types, returning the substitution or null on failure
 */
export function tryUnify(
  t1: ConstraintType,
  t2: ConstraintType,
  source: ConstraintSource
): SubstitutionBuilder | null {
  const unifier = new Unifier();
  if (unifier.unify(t1, t2, source)) {
    return unifier.getSubstitution();
  }
  return null;
}

/**
 * Check if two types are unifiable (without producing substitution)
 */
export function areUnifiable(t1: ConstraintType, t2: ConstraintType): boolean {
  const dummySource: ConstraintSource = {
    node: { type: 'EmptyStatement' } as any,
    file: '',
    line: 0,
    column: 0,
    description: 'unifiability check',
  };
  const unifier = new Unifier();
  return unifier.unify(t1, t2, dummySource);
}
