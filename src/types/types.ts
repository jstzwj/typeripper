/**
 * Core type system definitions for Typeripper
 * MLsub-inspired type system with flow-sensitive inference
 */

import type { Node } from '@babel/types';

// Unique type identifier
export type TypeId = string;

let typeIdCounter = 0;
export function generateTypeId(): TypeId {
  return `t_${typeIdCounter++}`;
}

// ============================================================================
// Base Type Interface
// ============================================================================

export interface BaseType {
  readonly kind: string;
  readonly id: TypeId;
}

// ============================================================================
// Primitive Types
// ============================================================================

export interface UndefinedType extends BaseType {
  readonly kind: 'undefined';
}

export interface NullType extends BaseType {
  readonly kind: 'null';
}

export interface BooleanType extends BaseType {
  readonly kind: 'boolean';
  readonly value?: boolean; // Literal boolean if known
}

export interface NumberType extends BaseType {
  readonly kind: 'number';
  readonly value?: number; // Literal number if known
}

export interface StringType extends BaseType {
  readonly kind: 'string';
  readonly value?: string; // Literal string if known
}

export interface BigIntType extends BaseType {
  readonly kind: 'bigint';
  readonly value?: bigint;
}

export interface SymbolType extends BaseType {
  readonly kind: 'symbol';
  readonly description?: string;
}

// ============================================================================
// Function Types
// ============================================================================

export interface ParamType {
  readonly name: string;
  readonly type: Type;
  readonly optional: boolean;
  readonly rest: boolean;
}

export interface FunctionType extends BaseType {
  readonly kind: 'function';
  readonly params: readonly ParamType[];
  readonly returnType: Type;
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
  readonly captures: ReadonlyMap<string, Type>; // Closure captures
  readonly thisType?: Type; // This annotation
}

// ============================================================================
// Object/Record Types (MLsub-style)
// ============================================================================

export interface PropertyType {
  readonly type: Type;
  readonly writable: boolean;
  readonly enumerable: boolean;
  readonly configurable: boolean;
  readonly getter?: FunctionType;
  readonly setter?: FunctionType;
}

export interface IndexSignature {
  readonly key: Type;
  readonly value: Type;
}

export interface ObjectType extends BaseType {
  readonly kind: 'object';
  readonly properties: ReadonlyMap<string, PropertyType>;
  readonly prototype: Type | null;
  readonly indexSignature?: IndexSignature;
  readonly sealed: boolean;
  readonly frozen: boolean;
}

// ============================================================================
// Array Types
// ============================================================================

export interface ArrayType extends BaseType {
  readonly kind: 'array';
  readonly elementType: Type;
  readonly readOnly: boolean;
}

// ============================================================================
// Class Types
// ============================================================================

export interface ClassType extends BaseType {
  readonly kind: 'class';
  readonly name: string;
  readonly constructor: FunctionType;
  readonly instanceType: ObjectType;
  readonly staticProperties: ReadonlyMap<string, PropertyType>;
  readonly superClass: ClassType | null;
}

// ============================================================================
// Union and Intersection Types
// ============================================================================

export interface UnionType extends BaseType {
  readonly kind: 'union';
  readonly members: readonly Type[]; // Flattened, no nested unions
}

export interface IntersectionType extends BaseType {
  readonly kind: 'intersection';
  readonly members: readonly Type[];
}

// ============================================================================
// Special Types
// ============================================================================

export interface AnyType extends BaseType {
  readonly kind: 'any';
  readonly reason?: string;
}

export interface NeverType extends BaseType {
  readonly kind: 'never';
}

export interface UnknownType extends BaseType {
  readonly kind: 'unknown';
}

// ============================================================================
// Type Variable (for generics)
// ============================================================================

export interface TypeVariable extends BaseType {
  readonly kind: 'typevar';
  readonly name: string;
  readonly upperBound?: Type;
  readonly lowerBound?: Type;
}

// ============================================================================
// Promise and Async Types
// ============================================================================

export interface PromiseType extends BaseType {
  readonly kind: 'promise';
  readonly returnType: Type;
}

export interface IteratorType extends BaseType {
  readonly kind: 'iterator';
  readonly yieldType: Type;
  readonly returnType: Type;
}

export interface GeneratorType extends BaseType {
  readonly kind: 'generator';
  readonly yieldType: Type;
  readonly returnType: Type;
  readonly nextType: Type;
}

// ============================================================================
// Type Union
// ============================================================================

export type Type =
  | UndefinedType
  | NullType
  | BooleanType
  | NumberType
  | StringType
  | BigIntType
  | SymbolType
  | FunctionType
  | ObjectType
  | ArrayType
  | ClassType
  | UnionType
  | IntersectionType
  | AnyType
  | NeverType
  | UnknownType
  | TypeVariable
  | PromiseType
  | IteratorType
  | GeneratorType;

// ============================================================================
// Type Guards
// ============================================================================

export function isUndefinedType(type: Type): type is UndefinedType {
  return type.kind === 'undefined';
}

export function isNullType(type: Type): type is NullType {
  return type.kind === 'null';
}

export function isBooleanType(type: Type): type is BooleanType {
  return type.kind === 'boolean';
}

export function isNumberType(type: Type): type is NumberType {
  return type.kind === 'number';
}

export function isStringType(type: Type): type is StringType {
  return type.kind === 'string';
}

export function isBigIntType(type: Type): type is BigIntType {
  return type.kind === 'bigint';
}

export function isSymbolType(type: Type): type is SymbolType {
  return type.kind === 'symbol';
}

export function isFunctionType(type: Type): type is FunctionType {
  return type.kind === 'function';
}

export function isObjectType(type: Type): type is ObjectType {
  return type.kind === 'object';
}

export function isArrayType(type: Type): type is ArrayType {
  return type.kind === 'array';
}

export function isClassType(type: Type): type is ClassType {
  return type.kind === 'class';
}

export function isUnionType(type: Type): type is UnionType {
  return type.kind === 'union';
}

export function isIntersectionType(type: Type): type is IntersectionType {
  return type.kind === 'intersection';
}

export function isAnyType(type: Type): type is AnyType {
  return type.kind === 'any';
}

export function isNeverType(type: Type): type is NeverType {
  return type.kind === 'never';
}

export function isUnknownType(type: Type): type is UnknownType {
  return type.kind === 'unknown';
}

export function isNullableType(type: Type): boolean {
  if (isUnionType(type)) {
    return type.members.some(isNullableType);
  }
  return isNullType(type) || isUndefinedType(type);
}

// ============================================================================
// Utility Types for Annotations
// ============================================================================

export interface TypeAnnotation {
  readonly node: Node;
  readonly name: string | null;
  readonly type: Type;
  readonly kind?: 'variable' | 'function' | 'class' | 'parameter' | 'property' | 'return';
}

export interface TypeAnnotationResult {
  readonly annotations: readonly TypeAnnotation[];
  readonly source: string;
  readonly filename: string;
}
