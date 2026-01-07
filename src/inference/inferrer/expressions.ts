/**
 * Expression Type Inference
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Implements P(Π; e) - the inference judgment for expressions.
 */

import type { Expression } from '@babel/types';
import type { PolarType } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import {
  boolean,
  number,
  string,
  nullType,
  undefined_,
  bigint,
  any,
} from '../types/factory.js';
import { emptyConstraintSet } from '../solver/index.js';
import type { InferResult } from './context.js';
import { InferenceContext, inferType } from './context.js';

// ============================================================================
// Main Expression Inference
// ============================================================================

/**
 * Infer the type of an expression
 *
 * P(Π; e) = [Δ]τ
 */
export function inferExpression(ctx: InferenceContext, expr: Expression): InferResult {
  switch (expr.type) {
    case 'Identifier':
      return inferIdentifier(ctx, expr);

    case 'NullLiteral':
      return inferType(nullType);

    case 'BooleanLiteral':
      return inferType(boolean);

    case 'NumericLiteral':
      return inferType(number);

    case 'StringLiteral':
      return inferType(string);

    case 'BigIntLiteral':
      return inferType(bigint);

    case 'TemplateLiteral':
      return inferType(string);

    // For now, return fresh type variables or any for complex expressions
    // These will be implemented properly in future iterations
    default:
      return inferType(ctx.fresh('expr'));
  }
}

// ============================================================================
// Identifier Inference
// ============================================================================

/**
 * Infer type of identifier
 *
 * P(Π; x) = [Δ]τ where Π(x) = [Δ]τ
 */
function inferIdentifier(ctx: InferenceContext, id: { name: string }): InferResult {
  const scheme = ctx.lookup(id.name);

  if (!scheme) {
    // Undeclared variable - create fresh type variable
    const freshVar = ctx.fresh(id.name);
    return inferType(freshVar);
  }

  // Instantiate the polymorphic scheme
  const type = ctx.instantiate(scheme);
  return inferType(type);
}
