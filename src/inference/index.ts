/**
 * MLsub Type Inference System
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * This module provides a complete type inference system for JavaScript,
 * implementing the MLsub algorithm with extensions for JS-specific features.
 *
 * Key components:
 * - Polar type system (positive/negative polarity)
 * - Biunification constraint solver
 * - Type automata for compact representation
 * - JavaScript-specific extensions (prototype, this, async, etc.)
 */

// =============================================================================
// Type System
// =============================================================================

// Core polar types
export type {
  Polarity,
  PolarType,
  TypeVar,
  PrimitiveType,
  FunctionType,
  RecordType,
  ArrayType,
  UnionType,
  IntersectionType,
  TopType,
  BottomType,
  RecursiveType,
  PromiseType,
  ClassType,
  AnyType,
  NeverType,
  UnknownType,
  ParamType,
  FieldType,
} from './types/index.js';

export {
  freshTypeVar,
  resetTypeVarCounter,
  flipPolarity,
  freeVars,
  occursIn,
  substitute,
  typeEquals,
  isTypeVar,
  isPrimitive,
  isFunction,
  isRecord,
  isArray,
  isUnion,
  isIntersection,
  isTop,
  isBottom,
  isRecursive,
  isPromise,
  isClass,
  isAny,
  isNever,
  bottom,
  top,
  any,
  never,
  unknown,
} from './types/index.js';

// Type factories
export {
  boolean,
  number,
  string,
  nullType,
  undefined_ as undefinedType,
  symbol,
  bigint,
  param,
  func,
  simpleFunc,
  asyncFunc,
  field,
  record,
  emptyRecord,
  openRecord,
  array,
  tuple,
  union,
  intersection,
  nullable,
  optional,
  promise,
  recursive,
  unfold,
  classType,
  booleanLiteral,
  numberLiteral,
  stringLiteral,
  bigintLiteral,
  anyWithReason,
  Types,
} from './types/factory.js';

// Typing schemes
export type {
  TypingScheme,
  PolyScheme,
  InstantiationResult,
} from './types/scheme.js';

export {
  typingScheme,
  monoScheme,
  polyScheme,
  instantiate,
  instantiateType,
  generalize,
  schemeEquals,
  freeVarsInEnv,
  freeVarsInScheme,
  mergeDelta,
  removeDelta,
  isMonomorphic,
  polyDegree,
  schemeFromType,
  schemeBody,
} from './types/scheme.js';

// =============================================================================
// Constraint Solver
// =============================================================================

export type {
  SourceLocation,
  FlowConstraint,
  ConstraintSet,
  SolveError,
  SolveErrorKind,
  SolveResult,
  Bisubstitution,
} from './solver/index.js';

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
  BiunificationContext,
  biunify,
  initZ3,
  isZ3Available,
  Z3Solver,
  getZ3Solver,
  solveWithZ3,
} from './solver/index.js';

// =============================================================================
// Type Automata
// =============================================================================

export type {
  HeadConstructor,
  TransitionLabel,
  AutomatonState,
} from './automata/index.js';

export {
  TypeAutomaton,
  typeToAutomaton,
  automatonToType,
  simplify,
  minimizeAutomaton,
  removeDeadStates,
} from './automata/index.js';

// =============================================================================
// Type Inference
// =============================================================================

export type {
  InferResult,
  StatementResult,
  ProgramInferenceResult,
  ExpressionInferenceResult,
  InferenceError,
} from './inferrer/index.js';

export {
  InferenceContext,
  createInitialContext,
  inferExpression,
  inferStatement,
  inferStatements,
  inferFunction,
  inferClass,
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
} from './inferrer/index.js';

// =============================================================================
// JavaScript Extensions
// =============================================================================

export {
  // Prototype chain
  prototypeType,
  lookupPrototypeProperty,
  objectPrototype,
  arrayPrototype,
  stringPrototype,
  numberPrototype,
  functionPrototype,

  // This binding
  type ThisContext,
  createThisContext,
  methodThisContext,
  arrowThisContext,
  constructorThisContext,
  resolveThisType,

  // Spread/rest
  spreadArrayType,
  spreadObjectType,
  spreadCallArguments,
  restParameterType,

  // Async/await
  asyncReturnType,
  asyncFunctionType,
  awaitExpressionType,
  promiseThenType,
  promiseCatchType,

  // Built-ins
  createBuiltinEnvironment,
  getBuiltinType,
} from './js/index.js';
