/**
 * Type exports
 */

// Core types
export type {
  Type,
  TypeKind,
  TypeByKind,
  TypeId,
  BaseType,
  UndefinedType,
  NullType,
  BooleanType,
  NumberType,
  StringType,
  BigIntType,
  SymbolType,
  FunctionType,
  ParamType,
  ObjectType,
  PropertyType,
  ArrayType,
  ClassType,
  UnionType,
  IntersectionType,
  AnyType,
  NeverType,
  UnknownType,
  TypeVariable,
  PromiseType,
  IteratorType,
} from './types.js';

// CFG types
export type {
  NodeId,
  EdgeId,
  BasicBlock,
  Terminator,
  FallthroughTerminator,
  BranchTerminator,
  SwitchTerminator,
  ReturnTerminator,
  ThrowTerminator,
  BreakTerminator,
  ContinueTerminator,
  TryTerminator,
  CFGEdge,
  EdgeKind,
  EdgeCondition,
  CFG,
  ProgramCFG,
  SwitchCase,
} from './cfg.js';

// Analysis types
export type {
  Binding,
  TypeEnvironment,
  ScopeKind,
  TypeState,
  TypeConstraint,
  EqualityConstraint,
  SubtypeConstraint,
  PropertyConstraint,
  CallConstraint,
  AssignmentConstraint,
  AnalysisResult,
  TypeError,
  TypeErrorKind,
  TypeWarning,
  TypeWarningKind,
} from './analysis.js';
