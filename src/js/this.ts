/**
 * This Binding Type Handling
 *
 * JavaScript's `this` binding is complex and context-dependent.
 * This module handles:
 * - Method `this` binding
 * - Function `this` (global or undefined in strict mode)
 * - Arrow function `this` (lexical)
 * - Constructor `this`
 * - Explicit binding (call, apply, bind)
 */

import type { PolarType, TypeVar } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import { func, undefined_, any, param } from '../types/factory.js';
import type { ConstraintSet, SourceLocation } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
} from '../solver/index.js';

// ============================================================================
// This Binding Modes
// ============================================================================

/**
 * Different modes of `this` binding
 */
export type ThisBindingMode =
  | 'method'        // obj.method() - this bound to obj
  | 'function'      // regular function - this is global/undefined
  | 'arrow'         // arrow function - this is lexical
  | 'constructor'   // new Foo() - this is new instance
  | 'explicit';     // call/apply/bind - this is explicit argument

/**
 * Context for this binding resolution
 */
export interface ThisContext {
  /** Current this type */
  readonly thisType: PolarType;

  /** Binding mode */
  readonly mode: ThisBindingMode;

  /** Whether in strict mode */
  readonly strict: boolean;

  /** Parent this context (for arrow functions) */
  readonly parent: ThisContext | null;
}

// ============================================================================
// This Binding Resolution
// ============================================================================

/**
 * Create initial this context
 */
export function createThisContext(
  _thisType: PolarType = any,
  strict: boolean = true
): ThisContext {
  return {
    thisType: strict ? undefined_ : any,
    mode: 'function',
    strict,
    parent: null,
  };
}

/**
 * Create method this context
 */
export function methodThisContext(
  receiverType: PolarType,
  parent: ThisContext | null = null
): ThisContext {
  return {
    thisType: receiverType,
    mode: 'method',
    strict: parent?.strict ?? true,
    parent,
  };
}

/**
 * Create arrow function this context (inherits from parent)
 */
export function arrowThisContext(parent: ThisContext): ThisContext {
  return {
    thisType: parent.thisType,
    mode: 'arrow',
    strict: parent.strict,
    parent,
  };
}

/**
 * Create constructor this context
 */
export function constructorThisContext(
  instanceType: PolarType,
  parent: ThisContext | null = null
): ThisContext {
  return {
    thisType: instanceType,
    mode: 'constructor',
    strict: true,
    parent,
  };
}

/**
 * Create explicit this context (call/apply/bind)
 */
export function explicitThisContext(
  boundThis: PolarType,
  parent: ThisContext | null = null
): ThisContext {
  return {
    thisType: boundThis,
    mode: 'explicit',
    strict: parent?.strict ?? true,
    parent,
  };
}

// ============================================================================
// This Type Constraints
// ============================================================================

/**
 * Generate constraints for method call this binding
 *
 * obj.method(args) binds this to obj
 */
export function bindMethodThis(
  _receiverType: PolarType,
  _methodType: PolarType,
  _source: SourceLocation
): ConstraintSet {
  // The method's this parameter (if it has one) should accept the receiver
  // This is handled implicitly by the method being called on the receiver
  return emptyConstraintSet();
}

/**
 * Generate constraints for explicit this binding via call()
 *
 * func.call(thisArg, ...args)
 */
export function bindCallThis(
  funcType: PolarType,
  _thisArgType: PolarType,
  argTypes: PolarType[],
  source: SourceLocation
): { constraints: ConstraintSet; returnType: TypeVar } {
  const returnVar = freshTypeVar('ret');
  let constraints = emptyConstraintSet();

  // func must be a function that accepts these args
  const params = argTypes.map((type, i) => param(`arg${i}`, type));
  const expectedFunc = func(params, returnVar);

  constraints = addConstraint(constraints, flow(funcType, expectedFunc, source));

  return { constraints, returnType: returnVar };
}

/**
 * Generate constraints for explicit this binding via apply()
 *
 * func.apply(thisArg, argsArray)
 */
export function bindApplyThis(
  funcType: PolarType,
  _thisArgType: PolarType,
  _argsArrayType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; returnType: TypeVar } {
  const returnVar = freshTypeVar('ret');
  let constraints = emptyConstraintSet();

  // func must be a function
  // We can't precisely type this without knowing the array contents
  const expectedFunc = func([param('args', any, { rest: true })], returnVar);

  constraints = addConstraint(constraints, flow(funcType, expectedFunc, source));

  return { constraints, returnType: returnVar };
}

/**
 * Generate constraints for Function.prototype.bind
 *
 * const bound = func.bind(thisArg)
 * Returns a new function with this bound
 */
export function bindBindThis(
  funcType: PolarType,
  _thisArgType: PolarType,
  source: SourceLocation
): { constraints: ConstraintSet; boundType: PolarType } {
  // The bound function has the same signature but with this pre-bound
  // For simplicity, return a fresh function type variable
  const boundVar = freshTypeVar('bound');
  let constraints = emptyConstraintSet();

  // Original must be a function
  const expectedFunc = func([param('arg', any, { rest: true })], freshTypeVar('ret'));
  constraints = addConstraint(constraints, flow(funcType, expectedFunc, source));

  return { constraints, boundType: boundVar };
}

// ============================================================================
// This in Class Methods
// ============================================================================

/**
 * Generate this type for a class method
 */
export function classMethodThis(
  classType: PolarType,
  _methodName: string,
  isStatic: boolean
): PolarType {
  if (isStatic) {
    // Static method: this is the class constructor
    return classType;
  } else {
    // Instance method: this is an instance of the class
    // The instance type is typically a type variable constrained by class structure
    return freshTypeVar('this');
  }
}

/**
 * Generate this type for a class constructor
 */
export function constructorThis(instanceType: PolarType): PolarType {
  return instanceType;
}

// ============================================================================
// This in Special Contexts
// ============================================================================

/**
 * Resolve this type in a getter/setter
 */
export function accessorThis(objectType: PolarType): PolarType {
  return objectType;
}

/**
 * Resolve this type in a computed property
 */
export function computedPropertyThis(objectType: PolarType): PolarType {
  return objectType;
}

/**
 * This type in global scope
 */
export function globalThis(strict: boolean): PolarType {
  return strict ? undefined_ : any;
}

// ============================================================================
// This Type Utilities
// ============================================================================

/**
 * Check if a this context allows this reference
 */
export function canReferenceThis(ctx: ThisContext | null): boolean {
  if (!ctx) return false;

  switch (ctx.mode) {
    case 'method':
    case 'constructor':
    case 'explicit':
      return true;
    case 'arrow':
      // Arrow functions inherit from parent
      return canReferenceThis(ctx.parent);
    case 'function':
      // Regular functions can reference this (even if undefined)
      return true;
    default:
      return false;
  }
}

/**
 * Get the resolved this type
 */
export function resolveThisType(ctx: ThisContext | null): PolarType {
  if (!ctx) return undefined_;
  return ctx.thisType;
}

/**
 * Check if this is bound to a specific type
 */
export function isThisBound(ctx: ThisContext | null): boolean {
  if (!ctx) return false;

  switch (ctx.mode) {
    case 'method':
    case 'constructor':
    case 'explicit':
      return true;
    case 'arrow':
      return isThisBound(ctx.parent);
    case 'function':
      return false;
    default:
      return false;
  }
}
