/**
 * Constraint Types - Core type definitions for constraint-based type inference
 *
 * This module defines the constraint language used by the type inference system.
 * The system works by:
 * 1. Generating constraints from AST traversal
 * 2. Solving constraints using unification and Z3
 * 3. Reconstructing concrete types from the solution
 */

import type * as t from '@babel/types';
import type { Type } from '../types/index.js';

// ============================================================================
// Type Variables
// ============================================================================

/**
 * A type variable represents an unknown type to be determined by constraint solving.
 * Type variables are created fresh for each expression/declaration that needs inference.
 */
export interface TypeVar {
  readonly kind: 'typevar';
  /** Unique identifier for this type variable */
  readonly id: number;
  /** Human-readable name for debugging (e.g., τ1, α, β) */
  readonly name: string;
  /** Scope level for let-polymorphism (generalization) */
  readonly level: number;
  /** Optional source location for error reporting */
  readonly source?: ConstraintSource;
}

/**
 * Type scheme for polymorphic types (let-polymorphism)
 * ∀α₁...αₙ. τ
 */
export interface TypeScheme {
  readonly kind: 'scheme';
  /** Universally quantified type variables */
  readonly quantified: readonly TypeVar[];
  /** The body type containing the quantified variables */
  readonly body: ConstraintType;
}

// ============================================================================
// Constraint Types (extended from base Type)
// ============================================================================

/**
 * Extended type system that includes type variables for constraint solving.
 * This is a superset of the concrete Type union.
 */
export type ConstraintType =
  | Type                    // Concrete types from base system
  | TypeVar                 // Type variables
  | TypeScheme              // Polymorphic types
  | AppType                 // Type application (generics)
  | RowType                 // Row types for extensible records
  ;

/**
 * Type application - instantiation of a generic type
 * e.g., Array<τ>, Promise<τ>, Map<K, V>
 */
export interface AppType {
  readonly kind: 'app';
  /** Type constructor name */
  readonly constructor: string;
  /** Type arguments */
  readonly args: readonly ConstraintType[];
}

/**
 * Row type for extensible records/objects
 * Enables structural subtyping with unknown fields
 * { a: τ₁, b: τ₂ | ρ } where ρ represents remaining fields
 */
export interface RowType {
  readonly kind: 'row';
  /** Known fields */
  readonly fields: ReadonlyMap<string, ConstraintType>;
  /** Row variable for remaining (unknown) fields, null if closed */
  readonly rest: TypeVar | null;
}

// ============================================================================
// Constraints
// ============================================================================

/**
 * All constraint types supported by the system
 */
export type Constraint =
  | EqualityConstraint
  | SubtypeConstraint
  | HasPropertyConstraint
  | HasIndexConstraint
  | CallableConstraint
  | ConstructableConstraint
  | InstanceOfConstraint
  | ArrayElementConstraint
  | UnionMemberConstraint
  | ConditionalConstraint
  | ConjunctionConstraint
  | DisjunctionConstraint
  ;

/**
 * Source location and context for a constraint.
 * Used for error reporting and debugging.
 */
export interface ConstraintSource {
  /** AST node that generated this constraint */
  readonly node: t.Node;
  /** Source file path */
  readonly file: string;
  /** Line number (1-indexed) */
  readonly line: number;
  /** Column number (0-indexed) */
  readonly column: number;
  /** Human-readable description of why this constraint exists */
  readonly description: string;
}

/**
 * Equality constraint: τ₁ = τ₂
 * The two types must be exactly equal after substitution.
 */
export interface EqualityConstraint {
  readonly kind: 'equality';
  readonly left: ConstraintType;
  readonly right: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Subtype constraint: τ₁ <: τ₂
 * τ₁ must be a subtype of (assignable to) τ₂
 */
export interface SubtypeConstraint {
  readonly kind: 'subtype';
  /** The subtype */
  readonly sub: ConstraintType;
  /** The supertype */
  readonly sup: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Property access constraint: τ has property p of type τₚ
 * Used for obj.prop expressions
 */
export interface HasPropertyConstraint {
  readonly kind: 'has-property';
  /** Object type being accessed */
  readonly object: ConstraintType;
  /** Property name */
  readonly property: string;
  /** Type of the property */
  readonly propertyType: ConstraintType;
  /** Is this a read or write access? */
  readonly access: 'read' | 'write';
  readonly source: ConstraintSource;
}

/**
 * Index access constraint: τ[i] has type τₑ
 * Used for arr[i] expressions
 */
export interface HasIndexConstraint {
  readonly kind: 'has-index';
  /** Object/array being indexed */
  readonly object: ConstraintType;
  /** Index type (number for arrays, string for objects) */
  readonly index: ConstraintType;
  /** Type of the element */
  readonly elementType: ConstraintType;
  /** Is this a read or write access? */
  readonly access: 'read' | 'write';
  readonly source: ConstraintSource;
}

/**
 * Callable constraint: τ is callable with args (τ₁, ..., τₙ) returning τᵣ
 */
export interface CallableConstraint {
  readonly kind: 'callable';
  /** Type being called */
  readonly callee: ConstraintType;
  /** Argument types */
  readonly args: readonly ConstraintType[];
  /** Return type */
  readonly returnType: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Constructable constraint: new τ(args) returns τᵢ
 * Similar to callable but for constructor calls
 */
export interface ConstructableConstraint {
  readonly kind: 'constructable';
  /** Constructor type */
  readonly constructor: ConstraintType;
  /** Argument types */
  readonly args: readonly ConstraintType[];
  /** Instance type */
  readonly instanceType: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Instance-of constraint: τ is an instance of class C
 */
export interface InstanceOfConstraint {
  readonly kind: 'instance-of';
  /** Type being checked */
  readonly type: ConstraintType;
  /** Class type */
  readonly classType: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Array element constraint: τ is an array with element type τₑ
 * Special handling for array mutations (push, index assignment)
 */
export interface ArrayElementConstraint {
  readonly kind: 'array-element';
  /** Array type */
  readonly array: ConstraintType;
  /** Element type being added/accessed */
  readonly element: ConstraintType;
  /** Operation type */
  readonly operation: 'read' | 'write' | 'push' | 'spread';
  readonly source: ConstraintSource;
}

/**
 * Union member constraint: τ is a member of union type τᵤ
 * Used for type narrowing and union construction
 */
export interface UnionMemberConstraint {
  readonly kind: 'union-member';
  /** The member type */
  readonly member: ConstraintType;
  /** The union type */
  readonly union: ConstraintType;
  readonly source: ConstraintSource;
}

/**
 * Conditional constraint: if C₁ then C₂ else C₃
 * Used for conditional type narrowing
 */
export interface ConditionalConstraint {
  readonly kind: 'conditional';
  /** Condition constraint (must be satisfiable) */
  readonly condition: Constraint;
  /** Constraints if condition holds */
  readonly consequent: readonly Constraint[];
  /** Constraints if condition doesn't hold */
  readonly alternate: readonly Constraint[];
  readonly source: ConstraintSource;
}

/**
 * Conjunction constraint: C₁ ∧ C₂ ∧ ... ∧ Cₙ
 * All constraints must be satisfied
 */
export interface ConjunctionConstraint {
  readonly kind: 'conjunction';
  readonly constraints: readonly Constraint[];
  readonly source: ConstraintSource;
}

/**
 * Disjunction constraint: C₁ ∨ C₂ ∨ ... ∨ Cₙ
 * At least one constraint must be satisfied
 * Used for overloaded functions and union types
 */
export interface DisjunctionConstraint {
  readonly kind: 'disjunction';
  readonly constraints: readonly Constraint[];
  readonly source: ConstraintSource;
}

// ============================================================================
// Constraint Set
// ============================================================================

/**
 * A set of constraints with metadata
 */
export interface ConstraintSet {
  /** All constraints collected during analysis */
  readonly constraints: readonly Constraint[];
  /** Type variables created during analysis */
  readonly typeVars: readonly TypeVar[];
  /** Mapping from AST nodes to their type variables */
  readonly nodeTypes: ReadonlyMap<t.Node, ConstraintType>;
  /** Mapping from variable names to their type schemes */
  readonly bindings: ReadonlyMap<string, TypeScheme | ConstraintType>;
}

// ============================================================================
// Solution
// ============================================================================

/**
 * A substitution maps type variables to their solved types
 */
export interface Substitution {
  readonly mapping: ReadonlyMap<number, ConstraintType>;
}

/**
 * Result of constraint solving
 */
export type SolveResult =
  | SolveSuccess
  | SolveFailure
  ;

export interface SolveSuccess {
  readonly success: true;
  /** Substitution that satisfies all constraints */
  readonly substitution: Substitution;
  /** Any warnings generated during solving */
  readonly warnings: readonly SolveWarning[];
}

export interface SolveFailure {
  readonly success: false;
  /** Errors explaining why solving failed */
  readonly errors: readonly SolveError[];
}

/**
 * Error during constraint solving
 */
export interface SolveError {
  readonly kind: SolveErrorKind;
  readonly message: string;
  readonly source: ConstraintSource;
  /** Types involved in the error */
  readonly types?: readonly ConstraintType[];
  /** Related constraints */
  readonly constraints?: readonly Constraint[];
}

export type SolveErrorKind =
  | 'incompatible-types'      // τ₁ ≠ τ₂
  | 'infinite-type'           // τ occurs in its own definition
  | 'missing-property'        // Object lacks required property
  | 'not-callable'           // Type is not callable
  | 'not-constructable'      // Type is not constructable
  | 'argument-count'         // Wrong number of arguments
  | 'unsatisfiable'          // No solution exists
  | 'ambiguous'              // Multiple solutions (for overloading)
  ;

/**
 * Warning during constraint solving
 */
export interface SolveWarning {
  readonly kind: SolveWarningKind;
  readonly message: string;
  readonly source: ConstraintSource;
}

export type SolveWarningKind =
  | 'widened-to-any'         // Type widened to any
  | 'implicit-any'           // Could not infer type
  | 'unused-variable'        // Type variable not constrained
  ;

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Check if a type is a type variable
 */
export function isTypeVar(type: ConstraintType): type is TypeVar {
  return type.kind === 'typevar';
}

/**
 * Check if a type is a type scheme
 */
export function isTypeScheme(type: ConstraintType | TypeScheme): type is TypeScheme {
  return type.kind === 'scheme';
}

/**
 * Check if a type contains any type variables
 */
export function containsTypeVar(type: ConstraintType): boolean {
  if (type.kind === 'typevar') return true;
  if (type.kind === 'scheme') return true;

  if (type.kind === 'app') {
    return type.args.some(containsTypeVar);
  }

  if (type.kind === 'row') {
    for (const fieldType of type.fields.values()) {
      if (containsTypeVar(fieldType)) return true;
    }
    return type.rest !== null;
  }

  if (type.kind === 'function') {
    return type.params.some(p => containsTypeVar(p.type)) ||
           containsTypeVar(type.returnType);
  }

  if (type.kind === 'array') {
    return containsTypeVar(type.elementType);
  }

  if (type.kind === 'union' || type.kind === 'intersection') {
    return type.members.some(containsTypeVar);
  }

  if (type.kind === 'object') {
    for (const prop of type.properties.values()) {
      if (containsTypeVar(prop.type)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Get all free type variables in a type
 */
export function freeTypeVars(type: ConstraintType): Set<number> {
  const result = new Set<number>();

  function collect(t: ConstraintType): void {
    if (t.kind === 'typevar') {
      result.add((t as TypeVar).id);
      return;
    }

    if (t.kind === 'scheme') {
      const bound = new Set(t.quantified.map(v => v.id));
      const bodyFree = freeTypeVars(t.body);
      for (const id of bodyFree) {
        if (!bound.has(id)) result.add(id);
      }
      return;
    }

    if (t.kind === 'app') {
      t.args.forEach(collect);
      return;
    }

    if (t.kind === 'row') {
      for (const fieldType of t.fields.values()) {
        collect(fieldType);
      }
      if (t.rest) result.add(t.rest.id);
      return;
    }

    if (t.kind === 'function') {
      t.params.forEach(p => collect(p.type));
      collect(t.returnType);
      return;
    }

    if (t.kind === 'array') {
      collect(t.elementType);
      return;
    }

    if (t.kind === 'union' || t.kind === 'intersection') {
      t.members.forEach(collect);
      return;
    }

    if (t.kind === 'object') {
      for (const prop of t.properties.values()) {
        collect(prop.type);
      }
      return;
    }
  }

  collect(type);
  return result;
}
