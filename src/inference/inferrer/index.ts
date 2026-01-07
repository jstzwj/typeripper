/**
 * Type Inferrer - Exports
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 */

// Context
export type { InferResult, StatementResult } from './context.js';

export {
  InferenceContext,
  createInitialContext,
  nodeToSource,
  makeSourceLocation,
  inferResult,
  inferType,
  statementResult,
  emptyStatementResult,
} from './context.js';

// Expression inference
export { inferExpression } from './expressions.js';

// Statement inference
export { inferStatement, inferStatements } from './statements.js';

// Function and class inference
export { inferFunction, inferClass } from './functions.js';

// Main inference entry points
export type {
  ProgramInferenceResult,
  ExpressionInferenceResult,
  InferenceError,
} from './infer.js';

export {
  inferProgram,
  inferFile,
  inferExpr,
  inferWithEnv,
  solveConstraints,
  checkSubtype,
  simplifyType,
  IncrementalInferrer,
  createEnv,
  getFreeVars,
} from './infer.js';
