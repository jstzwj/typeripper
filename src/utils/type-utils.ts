/**
 * Type utilities for type checking and manipulation
 */

import type { Type, TypeKind, UnionType, ObjectType, FunctionType, ArrayType } from '../types/index.js';

/**
 * Check if a type is of a specific kind
 */
export function isTypeKind<K extends TypeKind>(type: Type, kind: K): type is Extract<Type, { kind: K }> {
  return type.kind === kind;
}

/**
 * Check if a type is a primitive type
 */
export function isPrimitive(type: Type): boolean {
  return (
    type.kind === 'undefined' ||
    type.kind === 'null' ||
    type.kind === 'boolean' ||
    type.kind === 'number' ||
    type.kind === 'string' ||
    type.kind === 'bigint' ||
    type.kind === 'symbol'
  );
}

/**
 * Check if a type is nullable (undefined or null)
 */
export function isNullable(type: Type): boolean {
  if (type.kind === 'undefined' || type.kind === 'null') {
    return true;
  }
  if (type.kind === 'union') {
    return type.members.some((m) => m.kind === 'undefined' || m.kind === 'null');
  }
  return false;
}

/**
 * Check if a type is falsy (can be false, 0, '', null, undefined, NaN)
 */
export function canBeFalsy(type: Type): boolean {
  switch (type.kind) {
    case 'undefined':
    case 'null':
      return true;
    case 'boolean':
      return type.value !== true;
    case 'number':
      return type.value === undefined || type.value === 0 || Number.isNaN(type.value);
    case 'string':
      return type.value === undefined || type.value === '';
    case 'bigint':
      return type.value === undefined || type.value === 0n;
    case 'union':
      return type.members.some(canBeFalsy);
    case 'any':
    case 'unknown':
      return true;
    default:
      return false;
  }
}

/**
 * Check if a type can be truthy
 */
export function canBeTruthy(type: Type): boolean {
  switch (type.kind) {
    case 'undefined':
    case 'null':
    case 'never':
      return false;
    case 'boolean':
      return type.value !== false;
    case 'number':
      return type.value === undefined || (type.value !== 0 && !Number.isNaN(type.value));
    case 'string':
      return type.value === undefined || type.value !== '';
    case 'bigint':
      return type.value === undefined || type.value !== 0n;
    case 'object':
    case 'array':
    case 'function':
    case 'class':
    case 'symbol':
      return true;
    case 'union':
      return type.members.some(canBeTruthy);
    case 'any':
    case 'unknown':
      return true;
    default:
      return true;
  }
}

/**
 * Get all member types from a union, or wrap single type in array
 */
export function getUnionMembers(type: Type): readonly Type[] {
  if (type.kind === 'union') {
    return type.members;
  }
  return [type];
}

/**
 * Check if type A is a subtype of type B (A <: B)
 * This is a simplified check - full subtyping requires constraint solving
 */
export function isSubtypeOf(subtype: Type, supertype: Type): boolean {
  // Same type
  if (subtype.id === supertype.id) {
    return true;
  }

  // Never is subtype of everything
  if (subtype.kind === 'never') {
    return true;
  }

  // Everything is subtype of any and unknown
  if (supertype.kind === 'any' || supertype.kind === 'unknown') {
    return true;
  }

  // Any is subtype of everything (unsound but necessary for interop)
  if (subtype.kind === 'any') {
    return true;
  }

  // Union subtyping: A | B <: C iff A <: C and B <: C
  if (subtype.kind === 'union') {
    return subtype.members.every((m) => isSubtypeOf(m, supertype));
  }

  // Subtype of union: A <: B | C iff A <: B or A <: C
  if (supertype.kind === 'union') {
    return supertype.members.some((m) => isSubtypeOf(subtype, m));
  }

  // Same kind checks
  if (subtype.kind !== supertype.kind) {
    return false;
  }

  // Literal subtyping
  if (subtype.kind === 'boolean' && supertype.kind === 'boolean') {
    return subtype.value === undefined || supertype.value === undefined || subtype.value === supertype.value;
  }

  if (subtype.kind === 'number' && supertype.kind === 'number') {
    return subtype.value === undefined || supertype.value === undefined || subtype.value === supertype.value;
  }

  if (subtype.kind === 'string' && supertype.kind === 'string') {
    return subtype.value === undefined || supertype.value === undefined || subtype.value === supertype.value;
  }

  // For complex types, we'd need deeper analysis
  return false;
}

/**
 * Remove null and undefined from a type (for type narrowing)
 */
export function removeNullable(type: Type): Type {
  if (type.kind === 'undefined' || type.kind === 'null') {
    return { kind: 'never', id: 'never' };
  }
  if (type.kind === 'union') {
    const filtered = type.members.filter((m) => m.kind !== 'undefined' && m.kind !== 'null');
    if (filtered.length === 0) {
      return { kind: 'never', id: 'never' };
    }
    if (filtered.length === 1) {
      return filtered[0]!;
    }
    return { ...type, members: filtered };
  }
  return type;
}

/**
 * Narrow type based on typeof check
 */
export function narrowByTypeof(type: Type, typeofResult: string, negate: boolean): Type {
  const filter = (t: Type): boolean => {
    let matches: boolean;
    switch (typeofResult) {
      case 'undefined':
        matches = t.kind === 'undefined';
        break;
      case 'boolean':
        matches = t.kind === 'boolean';
        break;
      case 'number':
        matches = t.kind === 'number';
        break;
      case 'string':
        matches = t.kind === 'string';
        break;
      case 'bigint':
        matches = t.kind === 'bigint';
        break;
      case 'symbol':
        matches = t.kind === 'symbol';
        break;
      case 'function':
        matches = t.kind === 'function' || t.kind === 'class';
        break;
      case 'object':
        matches = t.kind === 'object' || t.kind === 'array' || t.kind === 'null';
        break;
      default:
        matches = false;
    }
    return negate ? !matches : matches;
  };

  if (type.kind === 'union') {
    const filtered = type.members.filter(filter);
    if (filtered.length === 0) {
      return { kind: 'never', id: 'never' };
    }
    if (filtered.length === 1) {
      return filtered[0]!;
    }
    return { kind: 'union', id: type.id + '_narrowed', members: filtered };
  }

  return filter(type) ? type : { kind: 'never', id: 'never' };
}

/**
 * Get a human-readable string representation of a type
 */
export function typeToString(type: Type): string {
  switch (type.kind) {
    case 'undefined':
      return 'undefined';
    case 'null':
      return 'null';
    case 'boolean':
      return type.value !== undefined ? String(type.value) : 'boolean';
    case 'number':
      return type.value !== undefined ? String(type.value) : 'number';
    case 'string':
      return type.value !== undefined ? JSON.stringify(type.value) : 'string';
    case 'bigint':
      return type.value !== undefined ? `${type.value}n` : 'bigint';
    case 'symbol':
      return type.description ? `symbol(${type.description})` : 'symbol';
    case 'function':
      return formatFunctionType(type);
    case 'object':
      return formatObjectType(type);
    case 'array':
      return formatArrayType(type);
    case 'class':
      return `class ${type.name}`;
    case 'union':
      return type.members.map(typeToString).join(' | ');
    case 'intersection':
      return type.members.map(typeToString).join(' & ');
    case 'any':
      return 'any';
    case 'never':
      return 'never';
    case 'unknown':
      return 'unknown';
    case 'typevar':
      return type.name;
    case 'promise':
      return `Promise<${typeToString(type.resolvedType)}>`;
    case 'iterator':
      return `Iterator<${typeToString(type.yieldType)}, ${typeToString(type.returnType)}, ${typeToString(type.nextType)}>`;
    default:
      return 'unknown';
  }
}

function formatFunctionType(type: FunctionType): string {
  const params = type.params.map((p) => {
    let s = p.name;
    if (p.optional) s += '?';
    if (p.rest) s = '...' + s;
    s += ': ' + typeToString(p.type);
    return s;
  });
  let prefix = '';
  if (type.isAsync) prefix += 'async ';
  if (type.isGenerator) prefix += 'function* ';
  else prefix += '(';
  return `${prefix}${params.join(', ')}) => ${typeToString(type.returnType)}`;
}

function formatObjectType(type: ObjectType): string {
  if (type.properties.size === 0) {
    return '{}';
  }
  const props: string[] = [];
  for (const [key, prop] of type.properties) {
    props.push(`${key}: ${typeToString(prop.type)}`);
  }
  return `{ ${props.join(', ')} }`;
}

function formatArrayType(type: ArrayType): string {
  if (type.tuple) {
    return `[${type.tuple.map(typeToString).join(', ')}]`;
  }
  return `${typeToString(type.elementType)}[]`;
}
