/**
 * JavaScript Built-in Types
 *
 * Provides type definitions for JavaScript built-in objects and functions.
 * These form the initial type environment for inference.
 */

import type { PolarType, PolyScheme } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import {
  boolean,
  number,
  string,
  nullType,
  undefined_,
  symbol,
  func,
  record,
  array,
  promise,
  any,
  never,
  param,
  union,
} from '../types/factory.js';
import { typingScheme, polyScheme } from '../types/scheme.js';
import {
  objectPrototype,
  arrayPrototype,
  stringPrototype,
  numberPrototype,
  functionPrototype,
} from './prototype.js';

// ============================================================================
// Global Objects
// ============================================================================

/**
 * Create the Object constructor type
 */
export function objectConstructorType(): PolarType {
  const objVar = freshTypeVar('T');

  return record({
    prototype: objectPrototype(),
    create: func([param('proto', union([record({}), nullType]))], record({})),
    keys: func([param('obj', record({}))], array(string)),
    values: func([param('obj', record({}))], array(any)),
    entries: func([param('obj', record({}))], array(array(any))),
    assign: func([
      param('target', objVar),
      param('sources', record({}), { rest: true }),
    ], objVar),
    freeze: func([param('obj', objVar)], objVar),
    seal: func([param('obj', objVar)], objVar),
    getPrototypeOf: func([param('obj', any)], union([record({}), nullType])),
    setPrototypeOf: func([
      param('obj', objVar),
      param('proto', union([record({}), nullType])),
    ], objVar),
    defineProperty: func([
      param('obj', objVar),
      param('prop', union([string, symbol])),
      param('descriptor', record({})),
    ], objVar),
    hasOwn: func([
      param('obj', record({})),
      param('prop', union([string, symbol])),
    ], boolean),
  });
}

/**
 * Create the Array constructor type
 */
export function arrayConstructorType(): PolarType {
  const elemVar = freshTypeVar('T');

  return record({
    prototype: arrayPrototype(),
    isArray: func([param('value', any)], boolean),
    from: func([
      param('iterable', any),
      param('mapFn', func([param('item', any)], elemVar), { optional: true }),
    ], array(elemVar)),
    of: func([param('items', elemVar, { rest: true })], array(elemVar)),
  });
}

/**
 * Create the String constructor type
 */
export function stringConstructorType(): PolarType {
  return record({
    prototype: stringPrototype(),
    fromCharCode: func([param('codes', number, { rest: true })], string),
    fromCodePoint: func([param('codes', number, { rest: true })], string),
    raw: func([
      param('template', record({})),
      param('substitutions', any, { rest: true }),
    ], string),
  });
}

/**
 * Create the Number constructor type
 */
export function numberConstructorType(): PolarType {
  return record({
    prototype: numberPrototype(),
    isFinite: func([param('value', any)], boolean),
    isInteger: func([param('value', any)], boolean),
    isNaN: func([param('value', any)], boolean),
    isSafeInteger: func([param('value', any)], boolean),
    parseFloat: func([param('str', string)], number),
    parseInt: func([
      param('str', string),
      param('radix', number, { optional: true }),
    ], number),
    MAX_VALUE: number,
    MIN_VALUE: number,
    NaN: number,
    POSITIVE_INFINITY: number,
    NEGATIVE_INFINITY: number,
    MAX_SAFE_INTEGER: number,
    MIN_SAFE_INTEGER: number,
  });
}

/**
 * Create the Boolean constructor type
 */
export function booleanConstructorType(): PolarType {
  return record({
    prototype: record({
      valueOf: func([], boolean),
      toString: func([], string),
    }),
  });
}

/**
 * Create the Function constructor type
 */
export function functionConstructorType(): PolarType {
  return record({
    prototype: functionPrototype(),
  });
}

/**
 * Create the Promise constructor type
 */
export function promiseConstructorType(): PolarType {
  const resolveVar = freshTypeVar('T');

  return record({
    prototype: record({
      then: func([
        param('onFulfilled', func([param('value', resolveVar)], freshTypeVar('U')), { optional: true }),
        param('onRejected', func([param('reason', any)], freshTypeVar('V')), { optional: true }),
      ], promise(freshTypeVar('Result'))),
      catch: func([
        param('onRejected', func([param('reason', any)], freshTypeVar('U'))),
      ], promise(union([resolveVar, freshTypeVar('U')]))),
      finally: func([
        param('onFinally', func([], undefined_)),
      ], promise(resolveVar)),
    }),
    resolve: func([param('value', resolveVar)], promise(resolveVar)),
    reject: func([param('reason', any)], promise(never)),
    all: func([param('promises', array(promise(resolveVar)))], promise(array(resolveVar))),
    race: func([param('promises', array(promise(resolveVar)))], promise(resolveVar)),
    allSettled: func([param('promises', array(promise(any)))], promise(array(record({})))),
    any: func([param('promises', array(promise(resolveVar)))], promise(resolveVar)),
  });
}

/**
 * Create the Symbol constructor type
 */
export function symbolConstructorType(): PolarType {
  return record({
    for: func([param('key', string)], symbol),
    keyFor: func([param('sym', symbol)], union([string, undefined_])),
    iterator: symbol,
    asyncIterator: symbol,
    toStringTag: symbol,
  });
}

/**
 * Create the Math object type
 */
export function mathObjectType(): PolarType {
  const numFunc = func([param('x', number)], number);
  const numFunc2 = func([param('y', number), param('x', number)], number);
  const variadicNum = func([param('values', number, { rest: true })], number);

  return record({
    // Constants
    E: number,
    LN10: number,
    LN2: number,
    LOG10E: number,
    LOG2E: number,
    PI: number,
    SQRT1_2: number,
    SQRT2: number,
    // Single-arg functions
    abs: numFunc,
    acos: numFunc,
    acosh: numFunc,
    asin: numFunc,
    asinh: numFunc,
    atan: numFunc,
    atanh: numFunc,
    cbrt: numFunc,
    ceil: numFunc,
    clz32: numFunc,
    cos: numFunc,
    cosh: numFunc,
    exp: numFunc,
    expm1: numFunc,
    floor: numFunc,
    fround: numFunc,
    log: numFunc,
    log10: numFunc,
    log1p: numFunc,
    log2: numFunc,
    round: numFunc,
    sign: numFunc,
    sin: numFunc,
    sinh: numFunc,
    sqrt: numFunc,
    tan: numFunc,
    tanh: numFunc,
    trunc: numFunc,
    // Two-arg functions
    atan2: numFunc2,
    imul: numFunc2,
    pow: numFunc2,
    // Variadic functions
    hypot: variadicNum,
    max: variadicNum,
    min: variadicNum,
    // No-arg functions
    random: func([], number),
  });
}

/**
 * Create the JSON object type
 */
export function jsonObjectType(): PolarType {
  return record({
    parse: func([
      param('text', string),
      param('reviver', func([param('key', string), param('value', any)], any), { optional: true }),
    ], any),
    stringify: func([
      param('value', any),
      param('replacer', any, { optional: true }),
      param('space', union([string, number]), { optional: true }),
    ], union([string, undefined_])),
  });
}

/**
 * Create the console object type
 */
export function consoleObjectType(): PolarType {
  const logFunc = func([param('data', any, { rest: true })], undefined_);

  return record({
    log: logFunc,
    info: logFunc,
    warn: logFunc,
    error: logFunc,
    debug: logFunc,
    trace: logFunc,
    dir: func([param('obj', any)], undefined_),
    table: func([param('data', any)], undefined_),
    time: func([param('label', string, { optional: true })], undefined_),
    timeEnd: func([param('label', string, { optional: true })], undefined_),
    clear: func([], undefined_),
    assert: func([
      param('condition', any),
      param('data', any, { rest: true }),
    ], undefined_),
  });
}

// ============================================================================
// Global Functions
// ============================================================================

/**
 * Create type for parseInt
 */
export function parseIntType(): PolarType {
  return func([
    param('str', string),
    param('radix', number, { optional: true }),
  ], number);
}

/**
 * Create type for parseFloat
 */
export function parseFloatType(): PolarType {
  return func([param('str', string)], number);
}

/**
 * Create type for isNaN
 */
export function isNaNType(): PolarType {
  return func([param('value', any)], boolean);
}

/**
 * Create type for isFinite
 */
export function isFiniteType(): PolarType {
  return func([param('value', any)], boolean);
}

/**
 * Create type for encodeURI
 */
export function encodeURIType(): PolarType {
  return func([param('uri', string)], string);
}

/**
 * Create type for decodeURI
 */
export function decodeURIType(): PolarType {
  return func([param('uri', string)], string);
}

/**
 * Create type for setTimeout
 */
export function setTimeoutType(): PolarType {
  return func([
    param('handler', func([], undefined_)),
    param('timeout', number, { optional: true }),
    param('args', any, { rest: true }),
  ], number);
}

/**
 * Create type for setInterval
 */
export function setIntervalType(): PolarType {
  return func([
    param('handler', func([], undefined_)),
    param('timeout', number, { optional: true }),
    param('args', any, { rest: true }),
  ], number);
}

// ============================================================================
// Built-in Environment
// ============================================================================

/**
 * Create the initial type environment with all built-ins
 */
export function createBuiltinEnvironment(): Map<string, PolyScheme> {
  const env = new Map<string, PolyScheme>();

  const mono = (type: PolarType): PolyScheme =>
    polyScheme(new Set(), type);

  // Global objects
  env.set('Object', mono(objectConstructorType()));
  env.set('Array', mono(arrayConstructorType()));
  env.set('String', mono(stringConstructorType()));
  env.set('Number', mono(numberConstructorType()));
  env.set('Boolean', mono(booleanConstructorType()));
  env.set('Function', mono(functionConstructorType()));
  env.set('Promise', mono(promiseConstructorType()));
  env.set('Symbol', mono(symbolConstructorType()));
  env.set('Math', mono(mathObjectType()));
  env.set('JSON', mono(jsonObjectType()));
  env.set('console', mono(consoleObjectType()));

  // Global functions
  env.set('parseInt', mono(parseIntType()));
  env.set('parseFloat', mono(parseFloatType()));
  env.set('isNaN', mono(isNaNType()));
  env.set('isFinite', mono(isFiniteType()));
  env.set('encodeURI', mono(encodeURIType()));
  env.set('decodeURI', mono(decodeURIType()));
  env.set('encodeURIComponent', mono(encodeURIType()));
  env.set('decodeURIComponent', mono(decodeURIType()));
  env.set('setTimeout', mono(setTimeoutType()));
  env.set('setInterval', mono(setIntervalType()));
  env.set('clearTimeout', mono(func([param('id', number)], undefined_)));
  env.set('clearInterval', mono(func([param('id', number)], undefined_)));

  // Global values
  env.set('undefined', mono(undefined_));
  env.set('NaN', mono(number));
  env.set('Infinity', mono(number));

  // Error types
  const errorType = record({
    name: string,
    message: string,
    stack: union([string, undefined_]),
  });
  env.set('Error', mono(func([param('message', string, { optional: true })], errorType)));
  env.set('TypeError', mono(func([param('message', string, { optional: true })], errorType)));
  env.set('ReferenceError', mono(func([param('message', string, { optional: true })], errorType)));
  env.set('SyntaxError', mono(func([param('message', string, { optional: true })], errorType)));
  env.set('RangeError', mono(func([param('message', string, { optional: true })], errorType)));

  return env;
}

/**
 * Get type for a specific built-in
 */
export function getBuiltinType(name: string): PolarType | null {
  const env = createBuiltinEnvironment();
  const scheme = env.get(name);
  if (!scheme) return null;
  return scheme.scheme.body;
}
