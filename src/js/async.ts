/**
 * Async/Await and Promise Type Handling
 *
 * JavaScript's async/await and Promises require special type handling:
 * - async functions return Promise<T>
 * - await unwraps Promise<T> to T
 * - Promise chaining (.then, .catch, .finally)
 * - Promise combinators (all, race, allSettled, any)
 */

import type { PolarType, TypeVar } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import { union } from '../types/factory.js';
import {
  record,
  func,
  array,
  promise,
  undefined_,
  any,
  param,
} from '../types/factory.js';
import type { ConstraintSet, SourceLocation } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
} from '../solver/index.js';

// ============================================================================
// Async Function Types
// ============================================================================

/**
 * Wrap a return type in Promise for async functions
 */
export function asyncReturnType(returnType: PolarType): PolarType {
  return promise(returnType);
}

/**
 * Create type for an async function
 */
export function asyncFunctionType(
  params: { name: string; type: PolarType }[],
  returnType: PolarType
): PolarType {
  // Async function returns Promise<returnType>
  const paramTypes = params.map(p => param(p.name, p.type));
  return func(paramTypes, promise(returnType), { isAsync: true });
}

/**
 * Generate constraints for async function body
 *
 * The return statements in an async function should flow to the
 * resolved type of the Promise.
 */
export function asyncFunctionBody(
  returnType: PolarType,
  bodyReturnType: PolarType,
  source: SourceLocation
): ConstraintSet {
  // Body return type flows to the Promise's resolved type
  return addConstraint(emptyConstraintSet(), flow(bodyReturnType, returnType, source));
}

// ============================================================================
// Await Expression Types
// ============================================================================

/**
 * Type for await expression: await expr
 *
 * If expr is Promise<T>, result is T
 * If expr is T (not a Promise), result is T
 */
export function awaitExpressionType(
  operandType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; resultType: TypeVar } {
  const resultVar = freshTypeVar('awaited');
  let constraints = emptyConstraintSet();

  // If operand is a Promise, unwrap it
  // For simplicity, we create a constraint that operand flows to Promise<resultVar>
  // This works because if operand is not a Promise, it will be treated as Promise<operand>
  const expectedPromise = promise(resultVar);
  constraints = addConstraint(constraints, flow(operandType, expectedPromise, source));

  return { constraints, resultType: resultVar };
}

/**
 * Handle await on non-Promise value (auto-wrapping)
 *
 * JavaScript allows await on any value, not just Promises.
 * Non-Promise values are auto-wrapped.
 */
export function awaitNonPromise(
  valueType: PolarType
): PolarType {
  // Awaiting a non-Promise just returns the value
  return valueType;
}

// ============================================================================
// Promise Methods
// ============================================================================

/**
 * Type for Promise.prototype.then
 *
 * promise.then(onFulfilled, onRejected?)
 */
export function promiseThenType(
  promiseType: PolarType,
  onFulfilledType: PolarType | null,
  _onRejectedType: PolarType | null,
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  const resolvedVar = freshTypeVar('resolved');
  const resultVar = freshTypeVar('thenResult');
  let constraints = emptyConstraintSet();

  // Promise must be a Promise type
  constraints = addConstraint(constraints, flow(promiseType, promise(resolvedVar), source));

  // onFulfilled must accept the resolved type and return something
  if (onFulfilledType) {
    const expectedCallback = func([param('value', resolvedVar)], resultVar);
    constraints = addConstraint(constraints, flow(onFulfilledType, expectedCallback, source));
  }

  // Result is a new Promise
  return { constraints, resultType: promise(resultVar) };
}

/**
 * Type for Promise.prototype.catch
 *
 * promise.catch(onRejected)
 */
export function promiseCatchType(
  promiseType: PolarType,
  onRejectedType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  const resolvedVar = freshTypeVar('resolved');
  const catchResultVar = freshTypeVar('catchResult');
  let constraints = emptyConstraintSet();

  // Promise must be a Promise type
  constraints = addConstraint(constraints, flow(promiseType, promise(resolvedVar), source));

  // onRejected must accept an error and return something
  const expectedCallback = func([param('error', any)], catchResultVar);
  constraints = addConstraint(constraints, flow(onRejectedType, expectedCallback, source));

  // Result is a Promise that resolves to either original or catch result
  return { constraints, resultType: promise(union([resolvedVar, catchResultVar])) };
}

/**
 * Type for Promise.prototype.finally
 *
 * promise.finally(onFinally)
 */
export function promiseFinallyType(
  promiseType: PolarType,
  onFinallyType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  const resolvedVar = freshTypeVar('resolved');
  let constraints = emptyConstraintSet();

  // Promise must be a Promise type
  constraints = addConstraint(constraints, flow(promiseType, promise(resolvedVar), source));

  // onFinally takes no arguments and its return is ignored (except Promises)
  const expectedCallback = func([], undefined_);
  constraints = addConstraint(constraints, flow(onFinallyType, expectedCallback, source));

  // Result preserves the original Promise type
  return { constraints, resultType: promise(resolvedVar) };
}

// ============================================================================
// Promise Static Methods
// ============================================================================

/**
 * Type for Promise.resolve
 *
 * Promise.resolve(value)
 */
export function promiseResolveType(
  valueType: PolarType
): PolarType {
  return promise(valueType);
}

/**
 * Type for Promise.reject
 *
 * Promise.reject(reason)
 */
export function promiseRejectType(): PolarType {
  return promise(freshTypeVar('never'));
}

/**
 * Type for Promise.all
 *
 * Promise.all([p1, p2, ...])
 * Returns Promise<[T1, T2, ...]> where each Pi resolves to Ti
 */
export function promiseAllType(
  promiseTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  let constraints = emptyConstraintSet();
  const resolvedTypes: TypeVar[] = [];

  for (const pType of promiseTypes) {
    const resolvedVar = freshTypeVar('resolved');
    constraints = addConstraint(constraints, flow(pType, promise(resolvedVar), source));
    resolvedTypes.push(resolvedVar);
  }

  // Result is Promise of array of resolved types
  const resultElemType = resolvedTypes.length > 0
    ? union(resolvedTypes)
    : freshTypeVar('elem');

  return { constraints, resultType: promise(array(resultElemType)) };
}

/**
 * Type for Promise.race
 *
 * Promise.race([p1, p2, ...])
 * Returns Promise<T1 | T2 | ...> where first to settle wins
 */
export function promiseRaceType(
  promiseTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  let constraints = emptyConstraintSet();
  const resolvedTypes: TypeVar[] = [];

  for (const pType of promiseTypes) {
    const resolvedVar = freshTypeVar('resolved');
    constraints = addConstraint(constraints, flow(pType, promise(resolvedVar), source));
    resolvedTypes.push(resolvedVar);
  }

  // Result is Promise of union of resolved types
  const resultType = resolvedTypes.length > 0
    ? union(resolvedTypes)
    : freshTypeVar('elem');

  return { constraints, resultType: promise(resultType) };
}

/**
 * Type for Promise.allSettled
 *
 * Promise.allSettled([p1, p2, ...])
 * Returns Promise<PromiseSettledResult<T>[]>
 */
export function promiseAllSettledType(
  promiseTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  let constraints = emptyConstraintSet();

  // Each result is either { status: 'fulfilled', value: T } or { status: 'rejected', reason: any }
  const fulfilledRecord = record({
    status: freshTypeVar('fulfilled'),
    value: freshTypeVar('value'),
  });

  const rejectedRecord = record({
    status: freshTypeVar('rejected'),
    reason: any,
  });

  const settledResultType = union([fulfilledRecord, rejectedRecord]);

  for (const pType of promiseTypes) {
    const resolvedVar = freshTypeVar('resolved');
    constraints = addConstraint(constraints, flow(pType, promise(resolvedVar), source));
  }

  return { constraints, resultType: promise(array(settledResultType)) };
}

/**
 * Type for Promise.any
 *
 * Promise.any([p1, p2, ...])
 * Returns Promise<T1 | T2 | ...> where first to fulfill wins
 */
export function promiseAnyType(
  promiseTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  // Same as race but only considers fulfilled promises
  return promiseRaceType(promiseTypes, source);
}

// ============================================================================
// Generator and Async Generator Types
// ============================================================================

/**
 * Create type for a generator function
 */
export function generatorFunctionType(
  params: { name: string; type: PolarType }[],
  yieldType: PolarType,
  returnType: PolarType,
  nextType: PolarType
): PolarType {
  // Generator returns an Iterator
  const iteratorResultType = record({
    value: union([yieldType, returnType]),
    done: freshTypeVar('bool'),
  });

  const iteratorType = record({
    next: func([param('value', nextType, { optional: true })], iteratorResultType),
    return: func([param('value', returnType, { optional: true })], iteratorResultType),
    throw: func([param('error', any, { optional: true })], iteratorResultType),
  });

  const paramTypes = params.map(p => param(p.name, p.type));
  return func(paramTypes, iteratorType, { isGenerator: true });
}

/**
 * Create type for an async generator function
 */
export function asyncGeneratorFunctionType(
  params: { name: string; type: PolarType }[],
  yieldType: PolarType,
  returnType: PolarType,
  nextType: PolarType
): PolarType {
  // Async generator returns an AsyncIterator
  const iteratorResultType = record({
    value: union([yieldType, returnType]),
    done: freshTypeVar('bool'),
  });

  const asyncIteratorType = record({
    next: func([param('value', nextType, { optional: true })], promise(iteratorResultType)),
    return: func([param('value', returnType, { optional: true })], promise(iteratorResultType)),
    throw: func([param('error', any, { optional: true })], promise(iteratorResultType)),
  });

  const paramTypes = params.map(p => param(p.name, p.type));
  return func(paramTypes, asyncIteratorType, { isAsync: true, isGenerator: true });
}

/**
 * Type for yield expression
 */
export function yieldExpressionType(
  yieldedType: PolarType,
  receivedType: TypeVar
): { yieldType: PolarType; resultType: PolarType } {
  return {
    yieldType: yieldedType,
    resultType: receivedType,
  };
}

/**
 * Type for yield* expression (delegating generator)
 */
export function yieldDelegateType(
  iterableType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  const elemVar = freshTypeVar('elem');
  let constraints = emptyConstraintSet();

  // Must be an iterable
  // Simplified: treat as array
  constraints = addConstraint(constraints, flow(iterableType, array(elemVar), source));

  return { constraints, resultType: elemVar };
}
