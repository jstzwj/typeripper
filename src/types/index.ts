/**
 * MLsub Type System - Main exports
 */

// Core polar types
export type {
  Polarity,
  TypeVar,
  PolarType,
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
} from './polar.js';

export {
  flipPolarity,
  resetTypeVarCounter,
  freshTypeVarId,
  freshTypeVar,
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
  typeToString,
} from './polar.js';

// Typing schemes
export type {
  TypingScheme,
  PolyScheme,
  InstantiationResult,
} from './scheme.js';

export {
  typingScheme,
  monoScheme,
  polyScheme,
  generalize,
  instantiate,
  instantiateType,
  freeVarsInEnv,
  freeVarsInScheme,
  mergeDelta,
  removeDelta,
  isMonomorphic,
  polyDegree,
  schemeFromType,
  schemeBody,
  schemeEquals,
} from './scheme.js';

// Type factory
export {
  Types,
  typeVar,
  boolean,
  number,
  string,
  nullType,
  undefined_,
  symbol,
  bigint,
  booleanLiteral,
  numberLiteral,
  stringLiteral,
  bigintLiteral,
  top,
  bottom,
  any,
  never,
  unknown,
  anyWithReason,
  param,
  func,
  simpleFunc,
  asyncFunc,
  field,
  record,
  emptyRecord,
  array,
  tuple,
  union,
  intersection,
  nullable,
  optional,
  recursive,
  unfold,
  promise,
  classType,
} from './factory.js';

export { Types as default } from './factory.js';
