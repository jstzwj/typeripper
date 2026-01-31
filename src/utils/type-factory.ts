/**
 * Type factory - create and manipulate types
 * Provides a fluent interface for type construction
 */

import type {
  Type,
  UndefinedType,
  NullType,
  BooleanType,
  NumberType,
  StringType,
  BigIntType,
  SymbolType,
  FunctionType,
  ObjectType,
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
  GeneratorType,
  ParamType,
  PropertyType,
  IndexSignature,
} from '../types/types.js';
import {
  generateTypeId,
} from '../types/types.js';
import {
  isUnionType,
  isIntersectionType,
  isNeverType,
} from '../types/types.js';

// ============================================================================
// Primitive Type Factory
// ============================================================================

export const Types = {
  // undefined
  undefined(): UndefinedType {
    return { kind: 'undefined', id: generateTypeId() };
  },

  // null
  null(): NullType {
    return { kind: 'null', id: generateTypeId() };
  },

  // boolean
  boolean(value?: boolean): BooleanType {
    return { kind: 'boolean', id: generateTypeId(), value };
  },

  // true literal
  true(): BooleanType {
    return { kind: 'boolean', id: generateTypeId(), value: true };
  },

  // false literal
  false(): BooleanType {
    return { kind: 'boolean', id: generateTypeId(), value: false };
  },

  // number
  number(value?: number): NumberType {
    return { kind: 'number', id: generateTypeId(), value };
  },

  // string
  string(value?: string): StringType {
    return { kind: 'string', id: generateTypeId(), value };
  },

  // bigint
  bigint(value?: bigint): BigIntType {
    return { kind: 'bigint', id: generateTypeId(), value };
  },

  // symbol
  symbol(description?: string): SymbolType {
    return { kind: 'symbol', id: generateTypeId(), description };
  },

  // ============================================================================
  // Composite Type Factory
  // ============================================================================

  // function
  function(config: {
    params: (ParamType | string)[];
    returnType: Type;
    isAsync?: boolean;
    isGenerator?: boolean;
    captures?: Map<string, Type>;
    thisType?: Type;
  }): FunctionType {
    const params: ParamType[] = config.params.map(p =>
      typeof p === 'string'
        ? { name: p, type: Types.unknown(), optional: false, rest: false }
        : p
    );

    return {
      kind: 'function',
      id: generateTypeId(),
      params,
      returnType: config.returnType,
      isAsync: config.isAsync ?? false,
      isGenerator: config.isGenerator ?? false,
      captures: config.captures ?? new Map(),
      thisType: config.thisType,
    };
  },

  // parameter
  param(
    name: string,
    type: Type,
    optional: boolean = false,
    rest: boolean = false
  ): ParamType {
    return { name, type, optional, rest };
  },

  // object/record
  object(config: {
    properties?: Record<string, PropertyType | Type>;
    prototype?: Type | null;
    indexSignature?: IndexSignature;
    sealed?: boolean;
    frozen?: boolean;
  }): ObjectType {
    const properties = new Map<string, PropertyType>();

    if (config.properties) {
      for (const [key, value] of Object.entries(config.properties)) {
        if (isPropertyType(value)) {
          properties.set(key, value);
        } else {
          properties.set(key, {
            type: value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      }
    }

    return {
      kind: 'object',
      id: generateTypeId(),
      properties,
      prototype: config.prototype ?? null,
      indexSignature: config.indexSignature,
      sealed: config.sealed ?? false,
      frozen: config.frozen ?? false,
    };
  },

  // property
  property(
    type: Type,
    writable: boolean = true,
    enumerable: boolean = true,
    configurable: boolean = true,
    getter?: FunctionType,
    setter?: FunctionType
  ): PropertyType {
    return { type, writable, enumerable, configurable, getter, setter };
  },

  // array
  array(elementType: Type, readOnly: boolean = false): ArrayType {
    return { kind: 'array', id: generateTypeId(), elementType, readOnly };
  },

  // class
  class(config: {
    name: string;
    constructor: FunctionType;
    instanceType: ObjectType;
    staticProperties?: Record<string, PropertyType | Type>;
    superClass?: ClassType | null;
  }): ClassType {
    const staticProperties = new Map<string, PropertyType>();

    if (config.staticProperties) {
      for (const [key, value] of Object.entries(config.staticProperties)) {
        if (isPropertyType(value)) {
          staticProperties.set(key, value);
        } else {
          staticProperties.set(key, {
            type: value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      }
    }

    return {
      kind: 'class',
      id: generateTypeId(),
      name: config.name,
      constructor: config.constructor,
      instanceType: config.instanceType,
      staticProperties,
      superClass: config.superClass ?? null,
    };
  },

  // ============================================================================
  // Union and Intersection
  // ============================================================================

  // union type (T1 | T2 | ...)
  union(...members: Type[]): Type {
    // Flatten nested unions
    const flat: Type[] = [];
    const seen = new Set<string>();

    for (const t of members) {
      if (isNeverType(t)) continue;

      if (isUnionType(t)) {
        for (const m of t.members) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            flat.push(m);
          }
        }
      } else {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          flat.push(t);
        }
      }
    }

    // Single member? Return it
    if (flat.length === 0) return Types.never();
    if (flat.length === 1) return flat[0]!;

    return { kind: 'union', id: generateTypeId(), members: flat as Type[] };
  },

  // intersection type (T1 & T2 & ...)
  intersection(...members: Type[]): Type {
    // Flatten nested intersections
    const flat: Type[] = [];
    const seen = new Set<string>();

    for (const t of members) {
      if (isNeverType(t)) return Types.never();

      if (isIntersectionType(t)) {
        for (const m of t.members) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            flat.push(m);
          }
        }
      } else {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          flat.push(t);
        }
      }
    }

    // Single member? Return it
    if (flat.length === 0) return Types.unknown();
    if (flat.length === 1) return flat[0]!;

    return { kind: 'intersection', id: generateTypeId(), members: flat as Type[] };
  },

  // ============================================================================
  // Special Types
  // ============================================================================

  any(reason?: string): AnyType {
    return { kind: 'any', id: generateTypeId(), reason };
  },

  never(): NeverType {
    return { kind: 'never', id: generateTypeId() };
  },

  unknown(): UnknownType {
    return { kind: 'unknown', id: generateTypeId() };
  },

  // type variable
  typeVar(name: string, upperBound?: Type, lowerBound?: Type): TypeVariable {
    return { kind: 'typevar', id: generateTypeId(), name, upperBound, lowerBound };
  },

  // ============================================================================
  // Async Types
  // ============================================================================

  promise(returnType: Type): PromiseType {
    return { kind: 'promise', id: generateTypeId(), returnType };
  },

  iterator(yieldType: Type, returnType: Type = Types.undefined()): IteratorType {
    return { kind: 'iterator', id: generateTypeId(), yieldType, returnType };
  },

  generator(
    yieldType: Type,
    returnType: Type = Types.undefined(),
    nextType: Type = Types.undefined()
  ): GeneratorType {
    return { kind: 'generator', id: generateTypeId(), yieldType, returnType, nextType };
  },
};

// ============================================================================
// Type Guards
// ============================================================================

function isPropertyType(value: PropertyType | Type): value is PropertyType {
  return 'writable' in value && 'enumerable' in value && 'configurable' in value;
}

// ============================================================================
// Common Type Combinations
// ============================================================================

// Nullable type: T | null
export function nullable(type: Type): Type {
  return Types.union(type, Types.null());
}

// Nullable or undefined: T | null | undefined
export function optional(type: Type): Type {
  return Types.union(type, Types.null(), Types.undefined());
}

// Common primitive union
export const primitive = Types.union(
  Types.undefined(),
  Types.null(),
  Types.boolean(),
  Types.number(),
  Types.string(),
  Types.bigint(),
  Types.symbol()
);

// Numeric type: number | bigint
export const numeric = Types.union(Types.number(), Types.bigint());

// Truthy type
export const truthy = Types.union(
  Types.boolean(true),
  Types.number(),
  Types.bigint(),
  Types.string(),
  Types.symbol()
);

// Falsy type
export const falsy = Types.union(
  Types.boolean(false),
  Types.null(),
  Types.undefined(),
  Types.number(0),
  Types.number(NaN),
  Types.bigint(0n),
  Types.string('')
);

// ============================================================================
// Type Utilities
// ============================================================================

// Check if type is nullable (contains null or undefined)
export function isNullable(type: Type): boolean {
  if (isUnionType(type)) {
    return type.members.some(isNullable);
  }
  return type.kind === 'null' || type.kind === 'undefined';
}

// Remove null and undefined from type
export function removeNullish(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(
      t => t.kind !== 'null' && t.kind !== 'undefined'
    );
    return filtered.length === 0 ? Types.never() :
           filtered.length === 1 ? filtered[0]! :
           Types.union(...filtered);
  }
  return type;
}

// Keep only null and undefined from type
export function onlyNullish(type: Type): Type {
  if (isUnionType(type)) {
    const filtered = type.members.filter(
      t => t.kind === 'null' || t.kind === 'undefined'
    );
    return filtered.length === 0 ? Types.never() :
           filtered.length === 1 ? filtered[0]! :
           Types.union(...filtered);
  }
  return type.kind === 'null' || type.kind === 'undefined' ? type : Types.never();
}

// Get literal value from type if present
export function getLiteralValue(type: Type): string | number | boolean | bigint | null {
  switch (type.kind) {
    case 'boolean':
    case 'number':
    case 'string':
    case 'bigint':
      return type.value ?? null;
    default:
      return null;
  }
}

// Check if type is a literal type
export function isLiteralType(type: Type): boolean {
  switch (type.kind) {
    case 'boolean':
      return type.value !== undefined;
    case 'number':
      return type.value !== undefined;
    case 'string':
      return type.value !== undefined;
    case 'bigint':
      return type.value !== undefined;
    default:
      return false;
  }
}

// Widen literal unions to primitive types
export function widen(type: Type): Type {
  if (isUnionType(type)) {
    const widened = type.members.map(widen);
    // Group by kind
    const byKind = new Map<string, Type[]>();
    for (const t of widened) {
      const kind = isLiteralType(t) ? t.kind : t.kind;
      if (!byKind.has(kind)) {
        byKind.set(kind, []);
      }
      byKind.get(kind)!.push(t);
    }

    // If all members of a kind are literals, replace with primitive
    const result: Type[] = [];
    for (const [kind, members] of byKind) {
      if (members.length > 1 && members.every(isLiteralType)) {
        switch (kind) {
          case 'boolean':
            result.push(Types.boolean());
            break;
          case 'number':
            result.push(Types.number());
            break;
          case 'string':
            result.push(Types.string());
            break;
          case 'bigint':
            result.push(Types.bigint());
            break;
          default:
            result.push(...members);
        }
      } else {
        result.push(...members);
      }
    }

    return result.length === 1 ? result[0]! : Types.union(...result);
  }

  if (isLiteralType(type)) {
    switch (type.kind) {
      case 'boolean':
        return Types.boolean();
      case 'number':
        return Types.number();
      case 'string':
        return Types.string();
      case 'bigint':
        return Types.bigint();
    }
  }

  return type;
}

// ============================================================================
// Re-exports
// ============================================================================

export { Types as default };
export type { Type } from '../types/types.js';
