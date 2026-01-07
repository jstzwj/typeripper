/**
 * JavaScript Extensions - Exports
 *
 * Provides type handling for JavaScript-specific features:
 * - Prototype chain
 * - this binding
 * - Spread/rest operators
 * - Async/await
 * - Built-in types
 */

// Prototype chain handling
export {
  type PrototypeEntry,
  prototypeType,
  lookupPrototypeProperty,
  getPrototypeOf,
  setPrototypeOf,
  callPrototypeMethod,
  objectPrototype,
  arrayPrototype,
  functionPrototype,
  stringPrototype,
  numberPrototype,
} from './prototype.js';

// This binding handling
export {
  type ThisBindingMode,
  type ThisContext,
  createThisContext,
  methodThisContext,
  arrowThisContext,
  constructorThisContext,
  explicitThisContext,
  bindMethodThis,
  bindCallThis,
  bindApplyThis,
  bindBindThis,
  classMethodThis,
  constructorThis,
  accessorThis,
  computedPropertyThis,
  globalThis,
  canReferenceThis,
  resolveThisType,
  isThisBound,
} from './this.js';

// Spread/rest handling
export {
  spreadArrayType,
  combineArrayElements,
  spreadObjectType,
  combineObjectProperties,
  spreadCallArguments,
  restParameterType,
  functionWithRest,
  destructuringArrayRest,
  destructuringObjectRest,
  isSpreadable,
  getSpreadElementType,
  combineSpreadForCall,
} from './spread.js';

// Async/await handling
export {
  asyncReturnType,
  asyncFunctionType,
  asyncFunctionBody,
  awaitExpressionType,
  awaitNonPromise,
  promiseThenType,
  promiseCatchType,
  promiseFinallyType,
  promiseResolveType,
  promiseRejectType,
  promiseAllType,
  promiseRaceType,
  promiseAllSettledType,
  promiseAnyType,
  generatorFunctionType,
  asyncGeneratorFunctionType,
  yieldExpressionType,
  yieldDelegateType,
} from './async.js';

// Built-in types
export {
  objectConstructorType,
  arrayConstructorType,
  stringConstructorType,
  numberConstructorType,
  booleanConstructorType,
  functionConstructorType,
  promiseConstructorType,
  symbolConstructorType,
  mathObjectType,
  jsonObjectType,
  consoleObjectType,
  parseIntType,
  parseFloatType,
  isNaNType,
  isFiniteType,
  encodeURIType,
  decodeURIType,
  setTimeoutType,
  setIntervalType,
  createBuiltinEnvironment,
  getBuiltinType,
} from './builtins.js';
