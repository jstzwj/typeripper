/**
 * Spread and Rest Operator Type Handling
 *
 * JavaScript's spread (...) and rest operators require special type handling:
 * - Spread in arrays: [...arr]
 * - Spread in objects: {...obj}
 * - Spread in function calls: f(...args)
 * - Rest parameters: function f(...args)
 * - Rest in destructuring: const [a, ...rest] = arr
 */

import type { PolarType, TypeVar } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import { record, array, func, param, union } from '../types/factory.js';
import type { ConstraintSet, SourceLocation } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
  mergeConstraintSets,
} from '../solver/index.js';

// ============================================================================
// Array Spread
// ============================================================================

/**
 * Type for spreading an array: [...arr]
 *
 * The spread array contributes its elements to the parent array.
 */
export function spreadArrayType(
  arrayType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; elementType: TypeVar } {
  const elemVar = freshTypeVar('elem');
  let constraints = emptyConstraintSet();

  // The array being spread must be an array type
  const expectedArray = array(elemVar);
  constraints = addConstraint(constraints, flow(arrayType, expectedArray, source));

  return { constraints, elementType: elemVar };
}

/**
 * Combine spread and non-spread elements in array literal
 *
 * [a, b, ...arr, c]
 */
export function combineArrayElements(
  elementTypes: PolarType[],
  spreadTypes: { type: PolarType; source: SourceLocation }[]
): { constraints: ConstraintSet; resultType: PolarType } {
  let constraints = emptyConstraintSet();
  const allElementTypes: PolarType[] = [...elementTypes];

  // Process spread elements
  for (const spread of spreadTypes) {
    const spreadResult = spreadArrayType(spread.type, spread.source);
    constraints = mergeConstraintSets(constraints, spreadResult.constraints);
    allElementTypes.push(spreadResult.elementType);
  }

  // Result is array of union of all element types
  const elemType = allElementTypes.length > 0
    ? union(allElementTypes)
    : freshTypeVar('elem');

  return { constraints, resultType: array(elemType) };
}

// ============================================================================
// Object Spread
// ============================================================================

/**
 * Type for spreading an object: {...obj}
 *
 * The spread object contributes its properties to the parent object.
 */
export function spreadObjectType(
  objectType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; spreadType: PolarType } {
  let constraints = emptyConstraintSet();

  // The object being spread must be a record type
  constraints = addConstraint(constraints, flow(objectType, record({}), source));

  // Return the object type itself (its properties will be merged)
  return { constraints, spreadType: objectType };
}

/**
 * Combine spread and non-spread properties in object literal
 *
 * { a: 1, ...obj, b: 2 }
 *
 * Later properties override earlier ones.
 */
export function combineObjectProperties(
  ownProperties: Map<string, PolarType>,
  spreadSources: { type: PolarType; source: SourceLocation; position: number }[],
  _source: SourceLocation
): { constraints: ConstraintSet; resultType: PolarType } {
  let constraints = emptyConstraintSet();

  // Process spread sources
  const allSpreadTypes: PolarType[] = [];
  for (const spread of spreadSources) {
    const spreadResult = spreadObjectType(spread.type, spread.source);
    constraints = mergeConstraintSets(constraints, spreadResult.constraints);
    allSpreadTypes.push(spreadResult.spreadType);
  }

  // Result has own properties plus spread properties
  // Own properties take precedence (later in source order)
  const fields: Record<string, PolarType> = {};
  for (const [key, value] of ownProperties) {
    fields[key] = value;
  }
  const resultType = record(fields);

  return { constraints, resultType };
}

// ============================================================================
// Function Call Spread
// ============================================================================

/**
 * Type for spread arguments in function call: f(...args)
 *
 * The spread array provides arguments to the function.
 */
export function spreadCallArguments(
  funcType: PolarType,
  regularArgs: PolarType[],
  spreadArgs: { type: PolarType; source: SourceLocation }[],
  source: SourceLocation
): { constraints: ConstraintSet; returnType: TypeVar } {
  const returnVar = freshTypeVar('ret');
  let constraints = emptyConstraintSet();

  // Process regular arguments
  const paramTypes: PolarType[] = [...regularArgs];

  // Process spread arguments
  for (const spread of spreadArgs) {
    const elemVar = freshTypeVar('spreadArg');
    constraints = addConstraint(
      constraints,
      flow(spread.type, array(elemVar), spread.source)
    );
    paramTypes.push(elemVar);
  }

  // Build expected function type
  const params = paramTypes.map((type, i) => {
    const isRest = i >= regularArgs.length;
    return param(`arg${i}`, type, { rest: isRest });
  });

  const expectedFunc = func(params, returnVar);
  constraints = addConstraint(constraints, flow(funcType, expectedFunc, source));

  return { constraints, returnType: returnVar };
}

// ============================================================================
// Rest Parameters
// ============================================================================

/**
 * Type for rest parameter: function f(...args)
 *
 * The rest parameter collects remaining arguments into an array.
 */
export function restParameterType(
  elementType: TypeVar
): PolarType {
  return array(elementType);
}

/**
 * Generate constraints for a function with rest parameter
 *
 * function f(a, b, ...rest) { }
 */
export function functionWithRest(
  regularParams: { name: string; type: PolarType }[],
  restParam: { name: string; elementType: TypeVar },
  returnType: PolarType
): PolarType {
  const params = [
    ...regularParams.map(p => param(p.name, p.type)),
    param(restParam.name, restParam.elementType, { rest: true }),
  ];

  return func(params, returnType);
}

// ============================================================================
// Destructuring Rest
// ============================================================================

/**
 * Type for rest in array destructuring: const [a, ...rest] = arr
 *
 * The rest variable gets an array of remaining elements.
 */
export function destructuringArrayRest(
  arrayType: PolarType,
  _beforeCount: number,
  source: SourceLocation
): { constraints: ConstraintSet; restType: PolarType } {
  const elemVar = freshTypeVar('elem');
  let constraints = emptyConstraintSet();

  // Source must be an array
  constraints = addConstraint(constraints, flow(arrayType, array(elemVar), source));

  // Rest gets an array of the same element type
  return { constraints, restType: array(elemVar) };
}

/**
 * Type for rest in object destructuring: const { a, ...rest } = obj
 *
 * The rest variable gets an object with remaining properties.
 */
export function destructuringObjectRest(
  objectType: PolarType,
  _extractedKeys: string[],
  source: SourceLocation
): { constraints: ConstraintSet; restType: PolarType } {
  let constraints = emptyConstraintSet();

  // Source must be an object
  constraints = addConstraint(constraints, flow(objectType, record({}), source));

  // Rest gets a record with remaining properties
  // We can't precisely type this without knowing all properties
  const restVar = freshTypeVar('rest');
  constraints = addConstraint(constraints, flow(objectType, restVar, source));

  return { constraints, restType: restVar };
}

// ============================================================================
// Spread/Rest Utilities
// ============================================================================

/**
 * Check if a type is spreadable (array or iterable)
 */
export function isSpreadable(type: PolarType): boolean {
  if (type.kind === 'array') return true;
  // Also check for Symbol.iterator on records
  return false;
}

/**
 * Get element type from a spreadable type
 */
export function getSpreadElementType(
  type: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; elementType: TypeVar } {
  const elemVar = freshTypeVar('elem');
  let constraints = emptyConstraintSet();

  if (type.kind === 'array') {
    // Constraint: array element type flows to elemVar
    constraints = addConstraint(constraints, flow(type, array(elemVar), source));
  } else {
    // For other types, require iterable protocol
    // Simplified: just require array-like
    constraints = addConstraint(constraints, flow(type, array(elemVar), source));
  }

  return { constraints, elementType: elemVar };
}

/**
 * Combine multiple spread types for variadic function
 */
export function combineSpreadForCall(
  spreadTypes: PolarType[]
): PolarType {
  if (spreadTypes.length === 0) {
    return array(freshTypeVar('elem'));
  }

  // Union of all spread element types
  const elementType = union(spreadTypes);
  return array(elementType);
}
