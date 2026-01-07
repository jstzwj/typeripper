/**
 * Prototype Chain Type Handling
 *
 * JavaScript's prototype chain requires special handling in the type system.
 * This module provides utilities for:
 * - Modeling prototype inheritance
 * - Method resolution
 * - Property lookup across the chain
 */

import type { PolarType, TypeVar } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import {
  record,
  func,
  undefined_,
  nullType,
  string,
  number,
  boolean,
  array,
  param,
  union,
} from '../types/factory.js';
import type { ConstraintSet, SourceLocation } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
} from '../solver/index.js';

// ============================================================================
// Prototype Types
// ============================================================================

/**
 * Represents a prototype chain entry
 */
export interface PrototypeEntry {
  /** Own properties (not inherited) */
  readonly ownProperties: ReadonlyMap<string, PolarType>;

  /** Prototype object (parent in chain) */
  readonly prototype: PolarType | null;
}

/**
 * Create a prototype chain type
 */
export function prototypeType(
  ownProperties: Map<string, PolarType>,
  prototype: PolarType | null
): PolarType {
  // Model as a record with __proto__ field
  const fields: Record<string, PolarType> = {};

  for (const [key, value] of ownProperties) {
    fields[key] = value;
  }

  if (prototype !== null) {
    fields['__proto__'] = prototype;
  }

  return record(fields);
}

// ============================================================================
// Prototype Lookup
// ============================================================================

/**
 * Generate constraints for prototype property lookup
 *
 * When accessing obj.prop:
 * 1. Check if prop exists on obj directly
 * 2. If not, check obj.__proto__
 * 3. Continue up the chain until found or null
 */
export function lookupPrototypeProperty(
  objectType: PolarType,
  propertyName: string,
  resultVar: TypeVar,
  source: SourceLocation
): ConstraintSet {
  let constraints = emptyConstraintSet();

  // Create expected type with property
  const expectedType = record({ [propertyName]: resultVar });

  // Add constraint: object must have property (directly or through prototype)
  constraints = addConstraint(constraints, flow(objectType, expectedType, source));

  return constraints;
}

/**
 * Model Object.getPrototypeOf(obj)
 */
export function getPrototypeOf(
  objectType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; type: PolarType } {
  const protoVar = freshTypeVar('proto');

  // Object must have __proto__ property
  const expectedType = record({ __proto__: protoVar });

  const constraints = addConstraint(
    emptyConstraintSet(),
    flow(objectType, expectedType, source)
  );

  // Result can be object or null
  return {
    constraints,
    type: union([protoVar, nullType]),
  };
}

/**
 * Model Object.setPrototypeOf(obj, proto)
 */
export function setPrototypeOf(
  objectType: PolarType,
  prototypeType: PolarType,
  source: SourceLocation
): ConstraintSet {
  // This is typically discouraged but we should handle it
  // The object's __proto__ becomes the prototype

  // Create expected type with __proto__
  const expectedType = record({ __proto__: prototypeType });

  return addConstraint(emptyConstraintSet(), flow(objectType, expectedType, source));
}

// ============================================================================
// Prototype Method Binding
// ============================================================================

/**
 * Generate constraints for method call through prototype
 *
 * obj.method(args) where method is inherited
 */
export function callPrototypeMethod(
  objectType: PolarType,
  methodName: string,
  argTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; returnType: TypeVar } {
  const returnVar = freshTypeVar('ret');
  let constraints = emptyConstraintSet();

  // Build expected method type
  const params = argTypes.map((type, i) => param(`arg${i}`, type));
  const methodType = func(params, returnVar);

  // Object must have this method
  const expectedType = record({ [methodName]: methodType });
  constraints = addConstraint(constraints, flow(objectType, expectedType, source));

  return { constraints, returnType: returnVar };
}

// ============================================================================
// Standard Prototype Chains
// ============================================================================

/**
 * Create Object.prototype type
 */
export function objectPrototype(): PolarType {
  return record({
    toString: func([], string),
    valueOf: func([], freshTypeVar('value')),
    hasOwnProperty: func([param('prop', string)], boolean),
    isPrototypeOf: func([param('obj', freshTypeVar('obj'))], boolean),
    propertyIsEnumerable: func([param('prop', string)], boolean),
  });
}

/**
 * Create Array.prototype type
 */
export function arrayPrototype(): PolarType {
  const elemVar = freshTypeVar('T');
  const arrType = array(elemVar);

  return record({
    length: number,
    push: func([param('item', elemVar, { rest: true })], number),
    pop: func([], union([elemVar, undefined_])),
    shift: func([], union([elemVar, undefined_])),
    unshift: func([param('item', elemVar, { rest: true })], number),
    slice: func([param('start', number, { optional: true }), param('end', number, { optional: true })], arrType),
    splice: func([param('start', number), param('deleteCount', number, { optional: true })], arrType),
    concat: func([param('arr', arrType, { rest: true })], arrType),
    indexOf: func([param('item', elemVar)], number),
    includes: func([param('item', elemVar)], boolean),
    forEach: func([param('callback', func([param('item', elemVar)], undefined_))], undefined_),
    map: func([param('callback', func([param('item', elemVar)], freshTypeVar('U')))], array(freshTypeVar('U'))),
    filter: func([param('callback', func([param('item', elemVar)], boolean))], arrType),
    reduce: func([param('callback', freshTypeVar('reducer'))], freshTypeVar('reduced')),
    find: func([param('callback', func([param('item', elemVar)], boolean))], union([elemVar, undefined_])),
    __proto__: objectPrototype(),
  });
}

/**
 * Create Function.prototype type
 */
export function functionPrototype(): PolarType {
  return record({
    call: func([param('thisArg', freshTypeVar('this')), param('args', freshTypeVar('arg'), { rest: true })], freshTypeVar('ret')),
    apply: func([param('thisArg', freshTypeVar('this')), param('args', array(freshTypeVar('arg')), { optional: true })], freshTypeVar('ret')),
    bind: func([param('thisArg', freshTypeVar('this')), param('args', freshTypeVar('arg'), { rest: true })], freshTypeVar('bound')),
    length: number,
    name: string,
    __proto__: objectPrototype(),
  });
}

/**
 * Create String.prototype type
 */
export function stringPrototype(): PolarType {
  return record({
    length: number,
    charAt: func([param('index', number)], string),
    charCodeAt: func([param('index', number)], number),
    concat: func([param('str', string, { rest: true })], string),
    includes: func([param('search', string)], boolean),
    indexOf: func([param('search', string)], number),
    slice: func([param('start', number, { optional: true }), param('end', number, { optional: true })], string),
    split: func([param('sep', union([string, freshTypeVar('regexp')]))], array(string)),
    substring: func([param('start', number), param('end', number, { optional: true })], string),
    toLowerCase: func([], string),
    toUpperCase: func([], string),
    trim: func([], string),
    replace: func([param('search', union([string, freshTypeVar('regexp')])), param('replacement', string)], string),
    match: func([param('regexp', freshTypeVar('regexp'))], union([array(string), nullType])),
    __proto__: objectPrototype(),
  });
}

/**
 * Create Number.prototype type
 */
export function numberPrototype(): PolarType {
  return record({
    toFixed: func([param('digits', number, { optional: true })], string),
    toPrecision: func([param('precision', number, { optional: true })], string),
    toString: func([param('radix', number, { optional: true })], string),
    valueOf: func([], number),
    __proto__: objectPrototype(),
  });
}
