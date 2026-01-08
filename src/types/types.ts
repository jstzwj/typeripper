/**
 * Typeripper - Sound Type System for JavaScript
 *
 * Core type definitions for the type inference system.
 * These types represent all possible JavaScript runtime types.
 */

/** Unique ID for types */
export type TypeId = string;

/**
 * Base interface for all types
 */
export interface BaseType {
  readonly kind: string;
  readonly id: TypeId;
}

/**
 * Primitive types in JavaScript
 */
export interface UndefinedType extends BaseType {
  readonly kind: 'undefined';
}

export interface NullType extends BaseType {
  readonly kind: 'null';
}

export interface BooleanType extends BaseType {
  readonly kind: 'boolean';
  /** If we know the exact value */
  readonly value?: boolean;
}

export interface NumberType extends BaseType {
  readonly kind: 'number';
  /** If we know the exact value */
  readonly value?: number;
}

export interface StringType extends BaseType {
  readonly kind: 'string';
  /** If we know the exact value */
  readonly value?: string;
}

export interface BigIntType extends BaseType {
  readonly kind: 'bigint';
  /** If we know the exact value */
  readonly value?: bigint;
}

export interface SymbolType extends BaseType {
  readonly kind: 'symbol';
  /** Symbol description if known */
  readonly description?: string;
}

/**
 * Function type
 */
export interface FunctionType extends BaseType {
  readonly kind: 'function';
  /** Parameter types (may include rest parameter) */
  readonly params: readonly ParamType[];
  /** Return type */
  readonly returnType: Type;
  /** Is this an async function? */
  readonly isAsync: boolean;
  /** Is this a generator function? */
  readonly isGenerator: boolean;
  /** Captured variables from outer scope (for closures) */
  readonly captures: ReadonlyMap<string, Type>;
}

export interface ParamType {
  readonly name: string;
  readonly type: Type;
  readonly optional: boolean;
  readonly rest: boolean;
}

/**
 * Object type with known properties
 */
export interface ObjectType extends BaseType {
  readonly kind: 'object';
  /** Known properties */
  readonly properties: ReadonlyMap<string, PropertyType>;
  /** Prototype chain */
  readonly prototype: Type | null;
  /** Index signature for dynamic property access */
  readonly indexSignature?: {
    readonly key: Type;
    readonly value: Type;
  };
  /** Is this object sealed/frozen? */
  readonly sealed: boolean;
  readonly frozen: boolean;
}

export interface PropertyType {
  readonly type: Type;
  readonly writable: boolean;
  readonly enumerable: boolean;
  readonly configurable: boolean;
  /** Getter function type */
  readonly getter?: FunctionType;
  /** Setter function type */
  readonly setter?: FunctionType;
}

/**
 * Array type
 */
export interface ArrayType extends BaseType {
  readonly kind: 'array';
  /** Element type */
  readonly elementType: Type;
  /** If we know the exact length */
  readonly length?: number;
  /** Tuple types if known */
  readonly tuple?: readonly Type[];
}

/**
 * Class type (constructor)
 */
export interface ClassType extends BaseType {
  readonly kind: 'class';
  readonly name: string;
  /** Constructor function type */
  readonly constructor: FunctionType;
  /** Instance type when `new` is called */
  readonly instanceType: ObjectType;
  /** Static properties */
  readonly staticProperties: ReadonlyMap<string, PropertyType>;
  /** Parent class */
  readonly superClass: ClassType | null;
}

/**
 * Union type (T1 | T2 | ... | Tn)
 * Used for sound type inference when value could be multiple types
 */
export interface UnionType extends BaseType {
  readonly kind: 'union';
  /** Member types (flattened, no nested unions) */
  readonly members: readonly Type[];
}

/**
 * Intersection type (T1 & T2 & ... & Tn)
 */
export interface IntersectionType extends BaseType {
  readonly kind: 'intersection';
  readonly members: readonly Type[];
}

/**
 * Any type - escape hatch for dynamic features
 * Used when we cannot determine the type soundly
 */
export interface AnyType extends BaseType {
  readonly kind: 'any';
  /** Reason why this became any (for diagnostics) */
  readonly reason?: string;
}

/**
 * Never type - represents impossible values
 * e.g., after throw statement or in unreachable code
 */
export interface NeverType extends BaseType {
  readonly kind: 'never';
}

/**
 * Unknown type - type not yet resolved
 * Used during inference before resolution
 */
export interface UnknownType extends BaseType {
  readonly kind: 'unknown';
}

/**
 * Type variable for generic inference
 */
export interface TypeVariable extends BaseType {
  readonly kind: 'typevar';
  readonly name: string;
  /** Upper bound constraint */
  readonly upperBound?: Type;
  /** Lower bound constraint */
  readonly lowerBound?: Type;
}

/**
 * Promise type
 */
export interface PromiseType extends BaseType {
  readonly kind: 'promise';
  readonly resolvedType: Type;
}

/**
 * Iterator/Generator result type
 */
export interface IteratorType extends BaseType {
  readonly kind: 'iterator';
  readonly yieldType: Type;
  readonly returnType: Type;
  readonly nextType: Type;
}

/**
 * Union of all possible types
 */
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
  | IteratorType;

/**
 * Type kind discriminant
 */
export type TypeKind = Type['kind'];

/**
 * Extract type by kind
 */
export type TypeByKind<K extends TypeKind> = Extract<Type, { kind: K }>;
