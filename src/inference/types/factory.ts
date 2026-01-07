/**
 * Type Factory - Convenient constructors for polar types
 *
 * Provides a clean API for creating MLsub types without verbose object literals.
 */

import type {
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
} from './polar.js';
import { freshTypeVar as createFreshTypeVar } from './polar.js';

// ============================================================================
// Type Variable
// ============================================================================

/**
 * Create a fresh type variable
 */
export function typeVar(name?: string, level?: number): TypeVar {
  return createFreshTypeVar(name, level);
}

// ============================================================================
// Primitive Types (Singletons)
// ============================================================================

/** Boolean type */
export const boolean: PrimitiveType = {
  kind: 'primitive',
  name: 'boolean',
};

/** Number type */
export const number: PrimitiveType = {
  kind: 'primitive',
  name: 'number',
};

/** String type */
export const string: PrimitiveType = {
  kind: 'primitive',
  name: 'string',
};

/** Null type */
export const nullType: PrimitiveType = {
  kind: 'primitive',
  name: 'null',
};

/** Undefined type */
export const undefined_: PrimitiveType = {
  kind: 'primitive',
  name: 'undefined',
};

/** Symbol type */
export const symbol: PrimitiveType = {
  kind: 'primitive',
  name: 'symbol',
};

/** BigInt type */
export const bigint: PrimitiveType = {
  kind: 'primitive',
  name: 'bigint',
};

// ============================================================================
// Literal Types
// ============================================================================

/**
 * Create a boolean literal type
 */
export function booleanLiteral(value: boolean): PrimitiveType {
  return {
    kind: 'primitive',
    name: 'boolean',
    value,
  };
}

/**
 * Create a number literal type
 */
export function numberLiteral(value: number): PrimitiveType {
  return {
    kind: 'primitive',
    name: 'number',
    value,
  };
}

/**
 * Create a string literal type
 */
export function stringLiteral(value: string): PrimitiveType {
  return {
    kind: 'primitive',
    name: 'string',
    value,
  };
}

/**
 * Create a bigint literal type
 */
export function bigintLiteral(value: bigint): PrimitiveType {
  return {
    kind: 'primitive',
    name: 'bigint',
    value,
  };
}

// ============================================================================
// Special Types (Singletons)
// ============================================================================

/** Top type (⊤) - accepts any input */
export const top: TopType = { kind: 'top' };

/** Bottom type (⊥) - produces nothing */
export const bottom: BottomType = { kind: 'bottom' };

/** Any type - escape hatch */
export const any: AnyType = { kind: 'any' };

/** Never type - unreachable */
export const never: NeverType = { kind: 'never' };

/** Unknown type - unresolved */
export const unknown: UnknownType = { kind: 'unknown' };

/**
 * Create an any type with a reason
 */
export function anyWithReason(reason: string): AnyType {
  return { kind: 'any', reason };
}

// ============================================================================
// Function Types
// ============================================================================

/**
 * Create a parameter type
 */
export function param(
  name: string,
  type: PolarType,
  options: { optional?: boolean; rest?: boolean } = {}
): ParamType {
  return {
    name,
    type,
    optional: options.optional ?? false,
    rest: options.rest ?? false,
  };
}

/**
 * Create a function type
 */
export function func(
  params: readonly ParamType[],
  returnType: PolarType,
  options: { isAsync?: boolean; isGenerator?: boolean } = {}
): FunctionType {
  return {
    kind: 'function',
    params,
    returnType,
    isAsync: options.isAsync ?? false,
    isGenerator: options.isGenerator ?? false,
  };
}

/**
 * Create a simple function type (no optional/rest params)
 */
export function simpleFunc(
  paramTypes: readonly PolarType[],
  returnType: PolarType
): FunctionType {
  return func(
    paramTypes.map((t, i) => param(`arg${i}`, t)),
    returnType
  );
}

/**
 * Create an async function type
 */
export function asyncFunc(
  params: readonly ParamType[],
  returnType: PolarType
): FunctionType {
  return func(params, promise(returnType), { isAsync: true });
}

// ============================================================================
// Record Types
// ============================================================================

/**
 * Create a field type
 */
export function field(
  type: PolarType,
  options: { optional?: boolean; readonly?: boolean } = {}
): FieldType {
  return {
    type,
    optional: options.optional ?? false,
    readonly: options.readonly ?? false,
  };
}

/**
 * Create a record type from an object of types
 */
export function record(
  fields: Record<string, PolarType | FieldType>,
  rest: TypeVar | null = null
): RecordType {
  const fieldMap = new Map<string, FieldType>();
  for (const [name, typeOrField] of Object.entries(fields)) {
    if ('type' in typeOrField && 'optional' in typeOrField) {
      fieldMap.set(name, typeOrField as FieldType);
    } else {
      fieldMap.set(name, field(typeOrField as PolarType));
    }
  }
  return {
    kind: 'record',
    fields: fieldMap,
    rest,
  };
}

/**
 * Create an empty record type
 */
export function emptyRecord(): RecordType {
  return record({});
}

/**
 * Create an open record (with row variable for extensibility)
 */
export function openRecord(
  fields: Record<string, PolarType | FieldType>,
  rowVar?: TypeVar
): RecordType {
  return record(fields, rowVar ?? typeVar('ρ'));
}

// ============================================================================
// Array Types
// ============================================================================

/**
 * Create an array type
 */
export function array(elementType: PolarType): ArrayType {
  return {
    kind: 'array',
    elementType,
  };
}

/**
 * Create a tuple type
 */
export function tuple(elements: readonly PolarType[]): ArrayType {
  // Element type is union of all elements (or never if empty)
  const elementType = elements.length === 0
    ? never
    : union(elements);
  return {
    kind: 'array',
    elementType,
    tuple: elements,
  };
}

// ============================================================================
// Union and Intersection Types
// ============================================================================

/**
 * Create a union type (τ⁺ ⊔ τ⁺)
 * Flattens nested unions and removes duplicates
 */
export function union(members: readonly PolarType[]): PolarType {
  const flattened: PolarType[] = [];

  for (const member of members) {
    if (member.kind === 'union') {
      flattened.push(...member.members);
    } else if (member.kind === 'never') {
      // never is identity for union
      continue;
    } else if (member.kind === 'any') {
      // any absorbs everything in union
      return any;
    } else {
      flattened.push(member);
    }
  }

  // Remove duplicates (simple reference equality)
  const unique = [...new Set(flattened)];

  if (unique.length === 0) return never;
  if (unique.length === 1) return unique[0]!;

  return {
    kind: 'union',
    members: unique,
  };
}

/**
 * Create an intersection type (τ⁻ ⊓ τ⁻)
 * Flattens nested intersections and removes duplicates
 */
export function intersection(members: readonly PolarType[]): PolarType {
  const flattened: PolarType[] = [];

  for (const member of members) {
    if (member.kind === 'intersection') {
      flattened.push(...member.members);
    } else if (member.kind === 'any') {
      // any is identity for intersection
      continue;
    } else if (member.kind === 'never') {
      // never absorbs everything in intersection
      return never;
    } else {
      flattened.push(member);
    }
  }

  // Remove duplicates
  const unique = [...new Set(flattened)];

  if (unique.length === 0) return any;
  if (unique.length === 1) return unique[0]!;

  return {
    kind: 'intersection',
    members: unique,
  };
}

/**
 * Create a nullable type (T | null | undefined)
 */
export function nullable(type: PolarType): UnionType {
  return {
    kind: 'union',
    members: [type, nullType, undefined_],
  };
}

/**
 * Create an optional type (T | undefined)
 */
export function optional(type: PolarType): UnionType {
  return {
    kind: 'union',
    members: [type, undefined_],
  };
}

// ============================================================================
// Recursive Types
// ============================================================================

/**
 * Create a recursive type (μα.τ)
 */
export function recursive(binder: TypeVar, body: PolarType): RecursiveType {
  return {
    kind: 'recursive',
    binder,
    body,
  };
}

/**
 * Unfold a recursive type once
 * μα.τ → τ[μα.τ/α]
 */
export function unfold(rec: RecursiveType): PolarType {
  const { substitute } = require('./polar.js');
  return substitute(rec.body, rec.binder.id, rec);
}

// ============================================================================
// Promise Types
// ============================================================================

/**
 * Create a Promise type
 */
export function promise(resolvedType: PolarType): PromiseType {
  return {
    kind: 'promise',
    resolvedType,
  };
}

// ============================================================================
// Class Types
// ============================================================================

/**
 * Create a class type
 */
export function classType(options: {
  name: string;
  constructorParams?: readonly ParamType[];
  instanceFields?: Record<string, PolarType | FieldType>;
  staticFields?: Record<string, PolarType | FieldType>;
  superClass?: ClassType;
}): ClassType {
  return {
    kind: 'class',
    name: options.name,
    constructorType: func(
      options.constructorParams ?? [],
      undefined_
    ),
    instanceType: record(options.instanceFields ?? {}),
    staticType: record(options.staticFields ?? {}),
    superClass: options.superClass ?? null,
  };
}

// ============================================================================
// Type Factory Namespace
// ============================================================================

/**
 * Namespace containing all type constructors
 */
export const Types = {
  // Type variables
  var: typeVar,

  // Primitives
  boolean,
  number,
  string,
  null: nullType,
  undefined: undefined_,
  symbol,
  bigint,

  // Literals
  booleanLiteral,
  numberLiteral,
  stringLiteral,
  bigintLiteral,

  // Special
  top,
  bottom,
  any,
  never,
  unknown,
  anyWithReason,

  // Functions
  param,
  func,
  simpleFunc,
  asyncFunc,

  // Records
  field,
  record,
  emptyRecord,
  openRecord,

  // Arrays
  array,
  tuple,

  // Unions and intersections
  union,
  intersection,
  nullable,
  optional,

  // Recursive
  recursive,
  unfold,

  // Promise
  promise,

  // Class
  class: classType,
} as const;

export default Types;
