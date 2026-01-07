/**
 * Type factory functions
 *
 * Provides convenient ways to create type instances with unique IDs.
 */

import type {
  Type,
  TypeId,
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
} from '../types/index.js';

let typeIdCounter = 0;

/**
 * Generate a unique type ID
 */
export function generateTypeId(prefix = 'type'): TypeId {
  return `${prefix}_${++typeIdCounter}`;
}

/**
 * Reset type ID counter (for testing)
 */
export function resetTypeIdCounter(): void {
  typeIdCounter = 0;
}

// Singleton types (only need one instance)
const undefinedSingleton: UndefinedType = {
  kind: 'undefined',
  id: 'undefined',
};

const nullSingleton: NullType = {
  kind: 'null',
  id: 'null',
};

const neverSingleton: NeverType = {
  kind: 'never',
  id: 'never',
};

const unknownSingleton: UnknownType = {
  kind: 'unknown',
  id: 'unknown',
};

const booleanSingleton: BooleanType = {
  kind: 'boolean',
  id: 'boolean',
};

const numberSingleton: NumberType = {
  kind: 'number',
  id: 'number',
};

const stringSingleton: StringType = {
  kind: 'string',
  id: 'string',
};

const bigintSingleton: BigIntType = {
  kind: 'bigint',
  id: 'bigint',
};

const symbolSingleton: SymbolType = {
  kind: 'symbol',
  id: 'symbol',
};

/**
 * Type factory object
 */
export const Types = {
  // Primitive singletons
  undefined: undefinedSingleton,
  null: nullSingleton,
  never: neverSingleton,
  unknown: unknownSingleton,
  boolean: booleanSingleton,
  number: numberSingleton,
  string: stringSingleton,
  bigint: bigintSingleton,
  symbol: symbolSingleton,

  // Literal types
  booleanLiteral(value: boolean): BooleanType {
    return {
      kind: 'boolean',
      id: `boolean_${value}`,
      value,
    };
  },

  numberLiteral(value: number): NumberType {
    return {
      kind: 'number',
      id: `number_${value}`,
      value,
    };
  },

  stringLiteral(value: string): StringType {
    return {
      kind: 'string',
      id: `string_${JSON.stringify(value)}`,
      value,
    };
  },

  bigintLiteral(value: bigint): BigIntType {
    return {
      kind: 'bigint',
      id: `bigint_${value}`,
      value,
    };
  },

  symbolType(description?: string): SymbolType {
    return {
      kind: 'symbol',
      id: description ? `symbol_${description}` : generateTypeId('symbol'),
      description,
    };
  },

  // Complex types
  function(params: {
    params: ParamType[];
    returnType: Type;
    isAsync?: boolean;
    isGenerator?: boolean;
    captures?: Map<string, Type>;
  }): FunctionType {
    return {
      kind: 'function',
      id: generateTypeId('func'),
      params: params.params,
      returnType: params.returnType,
      isAsync: params.isAsync ?? false,
      isGenerator: params.isGenerator ?? false,
      captures: params.captures ?? new Map(),
    };
  },

  object(params: {
    properties?: Map<string, PropertyType>;
    prototype?: Type | null;
    indexSignature?: { key: Type; value: Type };
    sealed?: boolean;
    frozen?: boolean;
  }): ObjectType {
    return {
      kind: 'object',
      id: generateTypeId('obj'),
      properties: params.properties ?? new Map(),
      prototype: params.prototype ?? null,
      indexSignature: params.indexSignature,
      sealed: params.sealed ?? false,
      frozen: params.frozen ?? false,
    };
  },

  array(elementType: Type, options?: { length?: number; tuple?: Type[] }): ArrayType {
    return {
      kind: 'array',
      id: generateTypeId('arr'),
      elementType,
      length: options?.length,
      tuple: options?.tuple,
    };
  },

  tuple(elements: Type[]): ArrayType {
    const unionElement = elements.length > 0 ? Types.union(elements) : Types.never;
    return {
      kind: 'array',
      id: generateTypeId('tuple'),
      elementType: unionElement,
      length: elements.length,
      tuple: elements,
    };
  },

  class(params: {
    name: string;
    constructor: FunctionType;
    instanceType: ObjectType;
    staticProperties?: Map<string, PropertyType>;
    superClass?: ClassType | null;
  }): ClassType {
    return {
      kind: 'class',
      id: generateTypeId('class'),
      name: params.name,
      constructor: params.constructor,
      instanceType: params.instanceType,
      staticProperties: params.staticProperties ?? new Map(),
      superClass: params.superClass ?? null,
    };
  },

  union(members: Type[]): Type {
    // Flatten nested unions
    const flattened: Type[] = [];
    for (const member of members) {
      if (member.kind === 'union') {
        flattened.push(...member.members);
      } else {
        flattened.push(member);
      }
    }

    // Remove duplicates by ID first (fast path)
    const seen = new Set<TypeId>();
    const unique: Type[] = [];
    for (const member of flattened) {
      if (!seen.has(member.id)) {
        seen.add(member.id);
        unique.push(member);
      }
    }

    // Remove structurally equal types (slower, but necessary for convergence)
    const deduped: Type[] = [];
    for (const member of unique) {
      let isDuplicate = false;
      for (const existing of deduped) {
        if (Types.structurallyEqual(member, existing)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        deduped.push(member);
      }
    }

    // Remove never types (they don't contribute to unions)
    const withoutNever = deduped.filter((t) => t.kind !== 'never');

    if (withoutNever.length === 0) {
      return Types.never;
    }
    if (withoutNever.length === 1) {
      return withoutNever[0]!;
    }

    // Check for any - any absorbs everything
    if (withoutNever.some((t) => t.kind === 'any')) {
      return Types.any();
    }

    return {
      kind: 'union',
      id: generateTypeId('union'),
      members: withoutNever,
    };
  },

  intersection(members: Type[]): Type {
    // Flatten nested intersections
    const flattened: Type[] = [];
    for (const member of members) {
      if (member.kind === 'intersection') {
        flattened.push(...member.members);
      } else {
        flattened.push(member);
      }
    }

    // Remove duplicates by ID
    const seen = new Set<TypeId>();
    const unique: Type[] = [];
    for (const member of flattened) {
      if (!seen.has(member.id)) {
        seen.add(member.id);
        unique.push(member);
      }
    }

    // Check for never - never absorbs everything in intersections
    if (unique.some((t) => t.kind === 'never')) {
      return Types.never;
    }

    if (unique.length === 0) {
      return Types.unknown;
    }
    if (unique.length === 1) {
      return unique[0]!;
    }

    return {
      kind: 'intersection',
      id: generateTypeId('intersection'),
      members: unique,
    };
  },

  any(reason?: string): AnyType {
    return {
      kind: 'any',
      id: reason ? `any_${reason}` : generateTypeId('any'),
      reason,
    };
  },

  typeVariable(name: string, bounds?: { upper?: Type; lower?: Type }): TypeVariable {
    return {
      kind: 'typevar',
      id: generateTypeId('tvar'),
      name,
      upperBound: bounds?.upper,
      lowerBound: bounds?.lower,
    };
  },

  promise(resolvedType: Type): PromiseType {
    return {
      kind: 'promise',
      id: generateTypeId('promise'),
      resolvedType,
    };
  },

  iterator(params: { yieldType: Type; returnType: Type; nextType: Type }): IteratorType {
    return {
      kind: 'iterator',
      id: generateTypeId('iterator'),
      yieldType: params.yieldType,
      returnType: params.returnType,
      nextType: params.nextType,
    };
  },

  // Helper for creating property descriptors
  property(
    type: Type,
    options?: {
      writable?: boolean;
      enumerable?: boolean;
      configurable?: boolean;
      getter?: FunctionType;
      setter?: FunctionType;
    }
  ): PropertyType {
    return {
      type,
      writable: options?.writable ?? true,
      enumerable: options?.enumerable ?? true,
      configurable: options?.configurable ?? true,
      getter: options?.getter,
      setter: options?.setter,
    };
  },

  // Helper for creating function parameters
  param(
    name: string,
    type: Type,
    options?: { optional?: boolean; rest?: boolean }
  ): ParamType {
    return {
      name,
      type,
      optional: options?.optional ?? false,
      rest: options?.rest ?? false,
    };
  },

  /**
   * Widen a literal type to its base type.
   * This is used to ensure soundness when a variable may hold multiple values.
   * - number literal (e.g., 0) -> number
   * - string literal (e.g., "hello") -> string
   * - boolean literal (e.g., true) -> boolean
   * - bigint literal -> bigint
   * - union of literals -> base type if all same kind
   */
  widen(type: Type): Type {
    switch (type.kind) {
      case 'number':
        // If it's a literal (has value), widen to base number
        if ((type as NumberType).value !== undefined) {
          return numberSingleton;
        }
        return type;
      case 'string':
        if ((type as StringType).value !== undefined) {
          return stringSingleton;
        }
        return type;
      case 'boolean':
        if ((type as BooleanType).value !== undefined) {
          return booleanSingleton;
        }
        return type;
      case 'bigint':
        if ((type as BigIntType).value !== undefined) {
          return bigintSingleton;
        }
        return type;
      case 'union':
        // Widen all members and simplify
        const widenedMembers = (type as UnionType).members.map(m => Types.widen(m));
        // Check if all are same kind after widening
        const kinds = new Set(widenedMembers.map(m => m.kind));
        if (kinds.size === 1) {
          // All same kind, return just that type
          return widenedMembers[0]!;
        }
        return Types.union(widenedMembers);
      case 'array':
        // Widen element type
        const arrType = type as ArrayType;
        const widenedElement = Types.widen(arrType.elementType);
        if (widenedElement.id !== arrType.elementType.id) {
          return Types.array(widenedElement);
        }
        return type;
      default:
        return type;
    }
  },

  /**
   * Check if a type is a literal type (has a specific value)
   */
  isLiteral(type: Type): boolean {
    switch (type.kind) {
      case 'number':
        return (type as NumberType).value !== undefined;
      case 'string':
        return (type as StringType).value !== undefined;
      case 'boolean':
        return (type as BooleanType).value !== undefined;
      case 'bigint':
        return (type as BigIntType).value !== undefined;
      default:
        return false;
    }
  },

  /**
   * Check if two types are structurally equal
   */
  structurallyEqual(t1: Type, t2: Type): boolean {
    if (t1.id === t2.id) return true;
    if (t1.kind !== t2.kind) return false;

    // For unions, check if members are equal (order-independent)
    if (t1.kind === 'union' && t2.kind === 'union') {
      if (t1.members.length !== t2.members.length) return false;
      return t1.members.every((m1) => t2.members.some((m2) => Types.structurallyEqual(m1, m2)));
    }

    // For objects, check properties
    if (t1.kind === 'object' && t2.kind === 'object') {
      if (t1.properties.size !== t2.properties.size) return false;
      for (const [key, prop1] of t1.properties) {
        const prop2 = t2.properties.get(key);
        if (!prop2 || !Types.structurallyEqual(prop1.type, prop2.type)) return false;
      }
      return true;
    }

    // For functions, check params and return type
    if (t1.kind === 'function' && t2.kind === 'function') {
      if (t1.params.length !== t2.params.length) return false;
      if (!Types.structurallyEqual(t1.returnType, t2.returnType)) return false;
      for (let i = 0; i < t1.params.length; i++) {
        if (!Types.structurallyEqual(t1.params[i]!.type, t2.params[i]!.type)) return false;
      }
      return true;
    }

    // For classes, check name and instance type
    if (t1.kind === 'class' && t2.kind === 'class') {
      if (t1.name !== t2.name) return false;
      return Types.structurallyEqual(t1.instanceType, t2.instanceType);
    }

    // For arrays, check element type
    if (t1.kind === 'array' && t2.kind === 'array') {
      return Types.structurallyEqual(t1.elementType, t2.elementType);
    }

    // For primitives with values (literal types)
    if (t1.kind === 'number' && t2.kind === 'number') {
      return (t1 as NumberType).value === (t2 as NumberType).value;
    }
    if (t1.kind === 'string' && t2.kind === 'string') {
      return (t1 as StringType).value === (t2 as StringType).value;
    }
    if (t1.kind === 'boolean' && t2.kind === 'boolean') {
      return (t1 as BooleanType).value === (t2 as BooleanType).value;
    }

    // For any/undefined/null/never/unknown - if same kind, they're equal
    if (t1.kind === 'any' || t1.kind === 'undefined' || t1.kind === 'null' ||
        t1.kind === 'never' || t1.kind === 'unknown') {
      return true;
    }

    return false;
  },
} as const;
