/**
 * Function and Class Type Inference
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Handles inference for:
 * - Function declarations/expressions
 * - Arrow functions
 * - Class declarations/expressions
 * - Methods
 */

import type {
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  ClassDeclaration,
  ClassExpression,
} from '@babel/types';
import type { PolarType, FunctionType } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import { func, param, undefined_, record } from '../types/factory.js';
import type { ConstraintSet } from '../solver/index.js';
import { emptyConstraintSet, mergeConstraintSets } from '../solver/index.js';
import type { InferResult } from './context.js';
import { InferenceContext, inferResult, inferType } from './context.js';
import { inferStatements } from './statements.js';

// ============================================================================
// Function Inference
// ============================================================================

type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunctionExpression;

/**
 * Infer type of a function
 *
 * P(Π; λx.e) = [{x: α}]β where P(Π, x:α; e) = [Δ]β
 */
export function inferFunction(ctx: InferenceContext, fn: FunctionLike): InferResult {
  // Create return type variable
  const returnVar = ctx.fresh('return');

  // Determine function properties
  const isAsync = 'async' in fn && fn.async === true;
  const isGenerator = 'generator' in fn && fn.generator === true;

  // Create function context
  const funcCtx = ctx.functionContext({
    returnType: returnVar,
    isAsync,
    isGenerator,
  });

  // Process parameters
  const params = fn.params.map((p, i) => {
    const paramVar = ctx.fresh(`param${i}`);
    if (p.type === 'Identifier') {
      funcCtx.bind(p.name, paramVar);
    }
    return param(`arg${i}`, paramVar);
  });

  // Infer body
  let constraints = emptyConstraintSet();
  if (fn.body.type === 'BlockStatement') {
    const bodyResult = inferStatements(funcCtx, fn.body.body);
    constraints = bodyResult.constraints;
  }

  // Build function type
  const funcType = func(params, returnVar, { isAsync, isGenerator });

  return inferResult(funcType, constraints);
}

// ============================================================================
// Class Inference
// ============================================================================

type ClassLike = ClassDeclaration | ClassExpression;

/**
 * Infer type of a class
 */
export function inferClass(ctx: InferenceContext, cls: ClassLike): InferResult {
  // For now, return a simple constructor type
  const instanceVar = ctx.fresh('instance');
  const ctorType = func([], instanceVar);

  return inferType(ctorType);
}
