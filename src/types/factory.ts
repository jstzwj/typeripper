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
import { freshTypeVar as createFreshTypeVar, substitute } from './polar.js';

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
  fields: Record<string, PolarType | FieldType>
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
  };
}

/**
 * Create an empty record type
 */
export function emptyRecord(): RecordType {
  return record({});
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
 * Check if a type is a record type
 */
function isRecordType(t: PolarType): t is RecordType {
  return t.kind === 'record';
}

/**
 * Compute record join: {f} ⊔ {g} = {h} where dom(h) = dom(f) ∩ dom(g)
 *
 * MLsub semantics (Figure 3 from the paper):
 * - The result contains only fields present in BOTH records
 * - Field types are joined (union)
 *
 * This gives us width subtyping automatically:
 *   {a: T, b: U} ≤ {a: T}  because {a: T, b: U} ⊔ {a: T} = {a: T}
 */
function recordJoin(records: RecordType[]): RecordType {
  if (records.length === 0) return emptyRecord();
  if (records.length === 1) return records[0]!;

  // Find intersection of all field names
  const allFieldNames = records.map(r => new Set(r.fields.keys()));
  const commonFields = new Set(allFieldNames[0]);

  for (let i = 1; i < allFieldNames.length; i++) {
    const currentFields = allFieldNames[i]!;
    for (const name of commonFields) {
      if (!currentFields.has(name)) {
        commonFields.delete(name);
      }
    }
  }

  // Build result with common fields, joining their types
  const resultFields: Record<string, FieldType> = {};

  for (const name of commonFields) {
    const fieldTypes: PolarType[] = [];
    let isOptional = false;
    let isReadonly = true;

    for (const record of records) {
      const field = record.fields.get(name)!;
      fieldTypes.push(field.type);
      isOptional = isOptional || field.optional;
      isReadonly = isReadonly && field.readonly;
    }

    resultFields[name] = {
      type: union(fieldTypes),
      optional: isOptional,
      readonly: isReadonly,
    };
  }

  return record(resultFields);
}

/**
 * Compute record meet: {f} ⊓ {g} = {h} where dom(h) = dom(f) ∪ dom(g)
 *
 * MLsub semantics (Figure 3 from the paper):
 * - The result contains fields from ALL records (union of domains)
 * - Field types are intersected (meet)
 * - Fields only in one record keep their original type
 *
 * This allows expressing "has at least these fields":
 *   {a: T} ⊓ {b: U} = {a: T, b: U}
 */
function recordMeet(records: RecordType[]): RecordType {
  if (records.length === 0) return emptyRecord();
  if (records.length === 1) return records[0]!;

  // Collect all field names (union of domains)
  const allFieldNames = new Set<string>();
  for (const record of records) {
    for (const name of record.fields.keys()) {
      allFieldNames.add(name);
    }
  }

  // Build result with all fields
  const resultFields: Record<string, FieldType> = {};

  for (const name of allFieldNames) {
    const fieldTypes: PolarType[] = [];
    let isOptional = true;
    let isReadonly = false;
    let presentCount = 0;

    for (const record of records) {
      const field = record.fields.get(name);
      if (field) {
        fieldTypes.push(field.type);
        isOptional = isOptional && field.optional;
        isReadonly = isReadonly || field.readonly;
        presentCount++;
      }
    }

    // If field is only in one record, use its type directly
    if (presentCount === 1) {
      const originalField = records.find(r => r.fields.has(name))!.fields.get(name)!;
      resultFields[name] = originalField;
    } else {
      // Field in multiple records: intersect types
      resultFields[name] = {
        type: intersection(fieldTypes),
        optional: isOptional,
        readonly: isReadonly,
      };
    }
  }

  return record(resultFields);
}

/**
 * Create a union type (τ⁺ ⊔ τ⁺)
 * Flattens nested unions and removes duplicates
 *
 * Special handling for records: implements MLsub record join semantics
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

  // MLsub record join: if all members are records, apply record join semantics
  const records = unique.filter(isRecordType);
  if (records.length > 1 && records.length === unique.length) {
    return recordJoin(records);
  }

  // If we have concrete types mixed with type variables, prefer concrete types
  // This is a simplification: union([var, number]) -> number (when var is unconstrained)
  const concreteTypes = unique.filter(t => t.kind !== 'var');
  const typeVars = unique.filter(t => t.kind === 'var');

  // If we have both concrete types and type variables, check if we can simplify
  if (concreteTypes.length > 0 && typeVars.length > 0) {
    // Heuristic: if all concrete types are primitives of the same kind, and we have
    // type variables, keep the union. Otherwise, if we have primitives that cover
    // the expected domain, we can drop the type variables.
    // For now, just keep both - the automata simplification should handle this.
  }

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
 *
 * Special handling for records: implements MLsub record meet semantics
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

  // MLsub record meet: if all members are records, apply record meet semantics
  const records = unique.filter(isRecordType);
  if (records.length > 1 && records.length === unique.length) {
    return recordMeet(records);
  }

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
