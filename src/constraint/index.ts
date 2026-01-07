/**
 * Constraint-Based Type Inference System
 *
 * This module provides a constraint-based approach to type inference,
 * following the principles of Hindley-Milner type inference with extensions
 * for JavaScript's structural typing and subtyping.
 *
 * The system works in three phases:
 * 1. Constraint Generation: Walk the AST and generate type constraints
 * 2. Constraint Solving: Find a substitution that satisfies all constraints
 * 3. Type Reconstruction: Apply the substitution to get final types
 *
 * @module constraint
 */

// Type definitions
export type {
  TypeVar,
  TypeScheme,
  ConstraintType,
  AppType,
  RowType,
  Constraint,
  EqualityConstraint,
  SubtypeConstraint,
  HasPropertyConstraint,
  HasIndexConstraint,
  CallableConstraint,
  ConstructableConstraint,
  InstanceOfConstraint,
  ArrayElementConstraint,
  UnionMemberConstraint,
  ConditionalConstraint,
  ConjunctionConstraint,
  DisjunctionConstraint,
  ConstraintSource,
  ConstraintSet,
  Substitution,
  SolveResult,
  SolveSuccess,
  SolveFailure,
  SolveError,
  SolveErrorKind,
  SolveWarning,
  SolveWarningKind,
} from './types.js';

// Type utilities
export {
  isTypeVar,
  isTypeScheme,
  containsTypeVar,
  freeTypeVars,
} from './types.js';

// Type variable management
export {
  TypeVarManager,
  generalize,
  instantiate,
  substituteTypeVars,
  sameTypeVar,
  formatTypeVar,
  formatTypeScheme,
  formatConstraintType,
} from './type-variable.js';

// Substitution
export {
  SubstitutionBuilder,
  applySubstitution,
  composeSubstitutions,
  emptySubstitution,
  singletonSubstitution,
} from './substitution.js';

// Constraint collection
export {
  ConstraintCollector,
  ConstraintEnv,
} from './collector.js';

// Unification
export {
  Unifier,
  solveEqualityConstraints,
  tryUnify,
  areUnifiable,
} from './unification.js';
export type { UnifyResult } from './unification.js';

// Subtyping
export {
  SubtypeSolver,
  solveSubtypeConstraints,
  isSubtype,
  leastUpperBound,
  greatestLowerBound,
} from './subtyping.js';
export type { SubtypeResult } from './subtyping.js';

// Main solver
export {
  ConstraintSolver,
  solveConstraints,
} from './solver.js';
export type { SolverConfig } from './solver.js';

// Constraint generation
export {
  ConstraintGenerator,
  generateConstraints,
} from './generator.js';
