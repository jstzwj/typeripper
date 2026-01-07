/**
 * Type exports
 */

// Core types (legacy - kept for compatibility)
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

// Annotation types
export type {
  TypeAnnotation,
  TypeAnnotationResult,
  AnnotationKind,
  InferenceError,
  ScopeInfo,
  TypeMap,
  OutputOptions,
} from './annotation.js';
