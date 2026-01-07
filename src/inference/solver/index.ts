/**
 * MLsub Solver - Constraint solving exports
 */

// Constraint types
export type {
  SourceLocation,
  FlowConstraint,
  ConstraintSet,
  SolveError,
  SolveErrorKind,
  SolveResult,
} from './constraint.js';

export {
  makeSource,
  flow,
  flowSimple,
  emptyConstraintSet,
  addConstraint,
  mergeConstraintSets,
  constraintSet,
  success,
  failure,
  fail,
} from './constraint.js';

// Bisubstitution
export type { Bisubstitution } from './bisubstitution.js';

export {
  emptyBisubst,
  bisubst,
  addPositive,
  addNegative,
  compose,
  applyPositive,
  applyNegative,
  eliminateUpperBound,
  eliminateLowerBound,
  isStable,
  toSubstitution,
} from './bisubstitution.js';

// Biunification
export { BiunificationContext, biunify, isSubtype } from './biunify.js';

// Z3 backend (optional)
export {
  initZ3,
  isZ3Available,
  Z3Solver,
  getZ3Solver,
  solveWithZ3,
} from './z3-backend.js';
