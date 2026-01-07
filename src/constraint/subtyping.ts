/**
 * Subtyping Relations - Determines when one type is a subtype of another
 *
 * Subtyping is coarser than equality - τ₁ <: τ₂ means τ₁ can be used where τ₂ is expected.
 *
 * Key relations:
 * - Reflexivity: τ <: τ
 * - Transitivity: τ₁ <: τ₂ ∧ τ₂ <: τ₃ → τ₁ <: τ₃
 * - Top: τ <: any
 * - Bottom: never <: τ
 * - Width subtyping: { a, b, c } <: { a, b }
 * - Depth subtyping: { a: τ₁ } <: { a: τ₂ } when τ₁ <: τ₂
 * - Function contravariance: (τ₂) → τ₁ <: (τ₁) → τ₂ when τ₁ <: τ₂
 * - Array covariance: Array<τ₁> <: Array<τ₂> when τ₁ <: τ₂
 * - Union subtyping: τ <: (τ₁ | τ₂) when τ <: τ₁ or τ <: τ₂
 */

import type {
  ConstraintType,
  TypeVar,
  SubtypeConstraint,
  SolveError,
  ConstraintSource,
} from './types.js';
import { SubstitutionBuilder } from './substitution.js';
import { CTypes } from './constraint-types-factory.js';

/**
 * Result of subtype checking
 */
export type SubtypeResult =
  | { success: true; substitution: SubstitutionBuilder }
  | { success: false; error: SolveError }
  ;

/**
 * Subtype solver - checks and infers subtype relationships
 */
export class SubtypeSolver {
  private subst: SubstitutionBuilder;
  private errors: SolveError[] = [];

  constructor(initialSubst?: SubstitutionBuilder) {
    this.subst = initialSubst ?? SubstitutionBuilder.empty();
  }

  /**
   * Check if sub <: sup (sub is a subtype of sup)
   * May bind type variables to make the relationship hold.
   */
  checkSubtype(sub: ConstraintType, sup: ConstraintType, source: ConstraintSource): boolean {
    // Apply current substitution
    const s1 = this.subst.apply(sub);
    const s2 = this.subst.apply(sup);

    return this.checkInternal(s1, s2, source);
  }

  /**
   * Internal subtype check after substitution
   */
  private checkInternal(sub: ConstraintType, sup: ConstraintType, source: ConstraintSource): boolean {
    // Reflexivity: τ <: τ
    if (this.structurallyEqual(sub, sup)) {
      return true;
    }

    // Top type: τ <: any
    if (sup.kind === 'any') {
      return true;
    }

    // Bottom type: never <: τ
    if (sub.kind === 'never') {
      return true;
    }

    // Unknown is only a subtype of unknown (any was already checked above)
    if (sub.kind === 'unknown') {
      return sup.kind === 'unknown';
    }

    // Type variable handling
    if (sub.kind === 'typevar') {
      return this.checkVarSubtype(sub as TypeVar, sup, source);
    }
    if (sup.kind === 'typevar') {
      return this.checkSupertypeVar(sub, sup as TypeVar, source);
    }

    // Union subtyping: τ <: (τ₁ | τ₂ | ...) if τ <: τᵢ for some i
    if (sup.kind === 'union') {
      // sub must be a subtype of at least one member
      for (const member of sup.members) {
        const solver = new SubtypeSolver(this.subst.clone());
        if (solver.checkInternal(sub, member, source)) {
          return true;
        }
      }
      this.addError('incompatible-types', `Type is not a subtype of any union member`, source, [sub, sup]);
      return false;
    }

    // Union as subtype: (τ₁ | τ₂ | ...) <: τ if τᵢ <: τ for all i
    if (sub.kind === 'union') {
      for (const member of sub.members) {
        if (!this.checkInternal(member, sup, source)) {
          return false;
        }
      }
      return true;
    }

    // Intersection subtyping
    if (sub.kind === 'intersection') {
      // If any member is a subtype, the intersection is
      for (const member of sub.members) {
        const solver = new SubtypeSolver(this.subst.clone());
        if (solver.checkInternal(member, sup, source)) {
          return true;
        }
      }
      this.addError('incompatible-types', `Intersection is not a subtype`, source, [sub, sup]);
      return false;
    }

    if (sup.kind === 'intersection') {
      // Must be a subtype of all members
      for (const member of sup.members) {
        if (!this.checkInternal(sub, member, source)) {
          return false;
        }
      }
      return true;
    }

    // Literal types are subtypes of their base types
    if (sub.kind === 'number' && sup.kind === 'number') {
      // A number literal is a subtype of number
      if (sub.value !== undefined && sup.value === undefined) {
        return true;
      }
      // Same literals
      if (sub.value === sup.value) {
        return true;
      }
      // number is NOT a subtype of a specific literal
      if (sub.value === undefined && sup.value !== undefined) {
        this.addError('incompatible-types', `Type 'number' is not assignable to literal type '${sup.value}'`, source, [sub, sup]);
        return false;
      }
      // Different literals
      this.addError('incompatible-types', `Type '${sub.value}' is not assignable to type '${sup.value}'`, source, [sub, sup]);
      return false;
    }

    if (sub.kind === 'string' && sup.kind === 'string') {
      if (sub.value !== undefined && sup.value === undefined) {
        return true;
      }
      if (sub.value === sup.value) {
        return true;
      }
      if (sub.value === undefined && sup.value !== undefined) {
        this.addError('incompatible-types', `Type 'string' is not assignable to literal type '${sup.value}'`, source, [sub, sup]);
        return false;
      }
      this.addError('incompatible-types', `Type '${sub.value}' is not assignable to type '${sup.value}'`, source, [sub, sup]);
      return false;
    }

    if (sub.kind === 'boolean' && sup.kind === 'boolean') {
      if (sub.value !== undefined && sup.value === undefined) {
        return true;
      }
      if (sub.value === sup.value) {
        return true;
      }
      if (sub.value === undefined && sup.value !== undefined) {
        this.addError('incompatible-types', `Type 'boolean' is not assignable to literal type '${sup.value}'`, source, [sub, sup]);
        return false;
      }
      this.addError('incompatible-types', `Type '${sub.value}' is not assignable to type '${sup.value}'`, source, [sub, sup]);
      return false;
    }

    // Primitives must match exactly (after literal handling above)
    if (this.isPrimitive(sub) && this.isPrimitive(sup)) {
      if (sub.kind === sup.kind) {
        return true;
      }
      this.addError('incompatible-types', `Type '${sub.kind}' is not assignable to type '${sup.kind}'`, source, [sub, sup]);
      return false;
    }

    // Function subtyping (contravariant in params, covariant in return)
    if (sub.kind === 'function' && sup.kind === 'function') {
      return this.checkFunctionSubtype(sub, sup, source);
    }

    // Array subtyping (covariant)
    if (sub.kind === 'array' && sup.kind === 'array') {
      return this.checkInternal(sub.elementType, sup.elementType, source);
    }

    // Object subtyping (width and depth)
    if (sub.kind === 'object' && sup.kind === 'object') {
      return this.checkObjectSubtype(sub, sup, source);
    }

    // Class subtyping
    if (sub.kind === 'class' && sup.kind === 'class') {
      return this.checkClassSubtype(sub, sup, source);
    }

    // Promise subtyping (covariant)
    if (sub.kind === 'promise' && sup.kind === 'promise') {
      return this.checkInternal(sub.resolvedType, sup.resolvedType, source);
    }

    // Type application
    if (sub.kind === 'app' && sup.kind === 'app') {
      if (sub.constructor !== sup.constructor) {
        this.addError('incompatible-types', `Type constructors differ: ${sub.constructor} vs ${sup.constructor}`, source, [sub, sup]);
        return false;
      }
      // For now, assume covariance (this is not always correct)
      if (sub.args.length !== sup.args.length) {
        this.addError('incompatible-types', `Type argument count differs`, source, [sub, sup]);
        return false;
      }
      for (let i = 0; i < sub.args.length; i++) {
        if (!this.checkInternal(sub.args[i]!, sup.args[i]!, source)) {
          return false;
        }
      }
      return true;
    }

    // Row types
    if (sub.kind === 'row' && sup.kind === 'row') {
      return this.checkRowSubtype(sub, sup, source);
    }

    // Incompatible types
    this.addError('incompatible-types', `Type '${sub.kind}' is not assignable to type '${sup.kind}'`, source, [sub, sup]);
    return false;
  }

  /**
   * Handle subtype checking when sub is a type variable
   */
  private checkVarSubtype(tv: TypeVar, sup: ConstraintType, source: ConstraintSource): boolean {
    const existing = this.subst.get(tv);
    if (existing) {
      return this.checkInternal(existing, sup, source);
    }

    // Bind the variable to the supertype
    // This is sound because we're constraining what the variable can be
    this.subst.bind(tv, sup);
    return true;
  }

  /**
   * Handle subtype checking when sup is a type variable
   */
  private checkSupertypeVar(sub: ConstraintType, tv: TypeVar, source: ConstraintSource): boolean {
    const existing = this.subst.get(tv);
    if (existing) {
      return this.checkInternal(sub, existing, source);
    }

    // For a lower bound, we need to track that the variable must be at least as general as sub
    // For simplicity, bind to sub (this may need refinement)
    this.subst.bind(tv, sub);
    return true;
  }

  /**
   * Check function subtyping (contravariant params, covariant return)
   */
  private checkFunctionSubtype(
    sub: ConstraintType & { kind: 'function' },
    sup: ConstraintType & { kind: 'function' },
    source: ConstraintSource
  ): boolean {
    // Check parameter count compatibility
    // A function with fewer required params can substitute for one with more
    // (due to optional params in JS)
    const minParams = Math.min(sub.params.length, sup.params.length);

    // Parameters are contravariant: sup's param types must be subtypes of sub's
    for (let i = 0; i < minParams; i++) {
      const subParam = sub.params[i]!;
      const supParam = sup.params[i]!;

      // Contravariance: supParam.type <: subParam.type
      if (!this.checkInternal(supParam.type, subParam.type, source)) {
        return false;
      }
    }

    // Return type is covariant: sub's return must be subtype of sup's return
    return this.checkInternal(sub.returnType, sup.returnType, source);
  }

  /**
   * Check object subtyping (width and depth)
   */
  private checkObjectSubtype(
    sub: ConstraintType & { kind: 'object' },
    sup: ConstraintType & { kind: 'object' },
    source: ConstraintSource
  ): boolean {
    // Width subtyping: sub must have all properties of sup
    for (const [name, supProp] of sup.properties) {
      const subProp = sub.properties.get(name);
      if (!subProp) {
        this.addError('missing-property', `Property '${name}' is missing in type`, source, [sub, sup]);
        return false;
      }

      // Depth subtyping: property types must be compatible
      if (!this.checkInternal(subProp.type, supProp.type, source)) {
        return false;
      }
    }

    // sub may have additional properties (width subtyping allows this)
    return true;
  }

  /**
   * Check class subtyping
   */
  private checkClassSubtype(
    sub: ConstraintType & { kind: 'class' },
    sup: ConstraintType & { kind: 'class' },
    source: ConstraintSource
  ): boolean {
    // Same class
    if (sub.name === sup.name) {
      return true;
    }

    // Check inheritance chain
    if (sub.superClass) {
      return this.checkInternal(sub.superClass, sup, source);
    }

    this.addError('incompatible-types', `Class '${sub.name}' is not assignable to class '${sup.name}'`, source, [sub, sup]);
    return false;
  }

  /**
   * Check row subtyping
   */
  private checkRowSubtype(
    sub: ConstraintType & { kind: 'row' },
    sup: ConstraintType & { kind: 'row' },
    source: ConstraintSource
  ): boolean {
    // All fields in sup must exist in sub with compatible types
    for (const [name, supType] of sup.fields) {
      const subType = sub.fields.get(name);
      if (!subType) {
        if (sub.rest) {
          // If sub is open, the missing field must be in the rest
          continue;
        }
        this.addError('missing-property', `Field '${name}' is missing in row type`, source, [sub, sup]);
        return false;
      }
      if (!this.checkInternal(subType, supType, source)) {
        return false;
      }
    }

    // If sup is closed but sub is open, that's ok (sub may have more fields)
    // If sup is open but sub is closed, sub's fields must cover sup's rest

    return true;
  }

  /**
   * Check if a type is a primitive
   */
  private isPrimitive(type: ConstraintType): boolean {
    return ['undefined', 'null', 'boolean', 'number', 'string', 'bigint', 'symbol'].includes(type.kind);
  }

  /**
   * Structural equality check
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

    if (['undefined', 'null', 'any', 'never', 'unknown'].includes(t1.kind)) {
      return true;
    }

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
   * Check if there were any errors
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }
}

/**
 * Solve a set of subtype constraints
 */
export function solveSubtypeConstraints(
  constraints: SubtypeConstraint[],
  initialSubst?: SubstitutionBuilder
): SubtypeResult {
  const solver = new SubtypeSolver(initialSubst);

  for (const constraint of constraints) {
    if (!solver.checkSubtype(constraint.sub, constraint.sup, constraint.source)) {
      return {
        success: false,
        error: solver.getErrors()[0]!,
      };
    }
  }

  return {
    success: true,
    substitution: solver.getSubstitution(),
  };
}

/**
 * Check if one type is a subtype of another
 */
export function isSubtype(sub: ConstraintType, sup: ConstraintType): boolean {
  const dummySource: ConstraintSource = {
    node: { type: 'EmptyStatement' } as any,
    file: '',
    line: 0,
    column: 0,
    description: 'subtype check',
  };
  const solver = new SubtypeSolver();
  return solver.checkSubtype(sub, sup, dummySource);
}

/**
 * Compute the least upper bound (LUB) of two types
 * This is the most specific type that is a supertype of both.
 */
export function leastUpperBound(t1: ConstraintType, t2: ConstraintType): ConstraintType {
  // If one is a subtype of the other, return the supertype
  if (isSubtype(t1, t2)) return t2;
  if (isSubtype(t2, t1)) return t1;

  // Both are the same primitive type (with possibly different literals)
  if (t1.kind === t2.kind) {
    if (t1.kind === 'number' && t2.kind === 'number') {
      // LUB of two number literals is number
      return CTypes.number;
    }
    if (t1.kind === 'string' && t2.kind === 'string') {
      return CTypes.string;
    }
    if (t1.kind === 'boolean' && t2.kind === 'boolean') {
      return CTypes.boolean;
    }
  }

  // Default: create a union
  return CTypes.union([t1, t2]);
}

/**
 * Compute the greatest lower bound (GLB) of two types
 * This is the most general type that is a subtype of both.
 */
export function greatestLowerBound(t1: ConstraintType, t2: ConstraintType): ConstraintType {
  // If one is a subtype of the other, return the subtype
  if (isSubtype(t1, t2)) return t1;
  if (isSubtype(t2, t1)) return t2;

  // For objects, intersection captures the GLB
  if (t1.kind === 'object' && t2.kind === 'object') {
    // Merge properties
    const properties = new Map<string, any>();
    for (const [name, prop] of t1.properties) {
      properties.set(name, prop);
    }
    for (const [name, prop] of t2.properties) {
      if (properties.has(name)) {
        // Both have this property - take the GLB of the property types
        const existing = properties.get(name);
        properties.set(name, {
          ...existing,
          type: greatestLowerBound(existing.type, prop.type),
        });
      } else {
        properties.set(name, prop);
      }
    }
    return CTypes.object({ properties });
  }

  // Default: never (no value can be both types)
  return CTypes.never;
}
