/**
 * Constraint Types - Core constraint definitions for MLsub
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 4
 *
 * The key constraint in MLsub is the flow constraint: τ⁺ ≤ τ⁻
 * This represents data flowing from a positive (output) position
 * to a negative (input) position.
 */

import type { PolarType } from '../types/index.js';

// ============================================================================
// Source Location
// ============================================================================

/**
 * Source location for error reporting
 */
export interface SourceLocation {
  /** Source file path */
  readonly file: string;
  /** Line number (1-indexed) */
  readonly line: number;
  /** Column number (0-indexed) */
  readonly column: number;
}

/**
 * Create a source location
 */
export function makeSource(
  file: string,
  line: number,
  column: number
): SourceLocation {
  return { file, line, column };
}

// ============================================================================
// Flow Constraint
// ============================================================================

/**
 * Flow constraint: τ⁺ ≤ τ⁻
 *
 * This is the core constraint in MLsub. It represents:
 * - Data flows from the positive type (output/source)
 * - To the negative type (input/sink)
 *
 * Examples:
 * - In `f(x)`: the argument type flows to the parameter type
 * - In `let y = e`: the expression type flows to the binding type
 * - In `return e`: the expression type flows to the return type
 */
export interface FlowConstraint {
  readonly kind: 'flow';
  /** Positive type (output position, covariant) */
  readonly positive: PolarType;
  /** Negative type (input position, contravariant) */
  readonly negative: PolarType;
  /** Source location for error reporting */
  readonly source: SourceLocation;
}

/**
 * Create a flow constraint
 */
export function flow(
  positive: PolarType,
  negative: PolarType,
  source: SourceLocation
): FlowConstraint {
  return {
    kind: 'flow',
    positive,
    negative,
    source,
  };
}

/**
 * Create a flow constraint with a simple source
 */
export function flowSimple(
  positive: PolarType,
  negative: PolarType,
  file: string,
  line: number,
  column: number
): FlowConstraint {
  return flow(positive, negative, makeSource(file, line, column));
}

// ============================================================================
// Constraint Set
// ============================================================================

/**
 * A collection of constraints to be solved
 */
export interface ConstraintSet {
  /** All flow constraints */
  readonly constraints: readonly FlowConstraint[];
}

/**
 * Create an empty constraint set
 */
export function emptyConstraintSet(): ConstraintSet {
  return { constraints: [] };
}

/**
 * Add a constraint to a set
 */
export function addConstraint(
  set: ConstraintSet,
  constraint: FlowConstraint
): ConstraintSet {
  return {
    constraints: [...set.constraints, constraint],
  };
}

/**
 * Merge multiple constraint sets
 */
export function mergeConstraintSets(
  ...sets: readonly ConstraintSet[]
): ConstraintSet {
  return {
    constraints: sets.flatMap(s => s.constraints),
  };
}

/**
 * Create a constraint set from an array of constraints
 */
export function constraintSet(constraints: readonly FlowConstraint[]): ConstraintSet {
  return { constraints };
}

// ============================================================================
// Solve Result
// ============================================================================

/**
 * Error during constraint solving
 */
export interface SolveError {
  readonly kind: SolveErrorKind;
  readonly message: string;
  readonly source?: SourceLocation;
  /** Types involved in the error */
  readonly types?: readonly PolarType[];
}

export type SolveErrorKind =
  | 'incompatible-types'    // τ₁ ≰ τ₂
  | 'infinite-type'         // Occurs check failure
  | 'missing-property'      // Record lacks field
  | 'not-callable'          // Type is not a function
  | 'unsatisfiable'         // No solution exists
  ;

/**
 * Result of constraint solving
 */
export type SolveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly SolveError[] }
  ;

/**
 * Create a successful result
 */
export function success<T>(value: T): SolveResult<T> {
  return { ok: true, value };
}

/**
 * Create a failed result
 */
export function failure<T>(errors: readonly SolveError[]): SolveResult<T> {
  return { ok: false, errors };
}

/**
 * Create a single error failure
 */
export function fail<T>(
  kind: SolveErrorKind,
  message: string,
  source?: SourceLocation,
  types?: readonly PolarType[]
): SolveResult<T> {
  return failure([{ kind, message, source, types }]);
}
