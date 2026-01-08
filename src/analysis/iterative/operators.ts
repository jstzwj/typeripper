/**
 * Operator Type Inference - Infer types for binary, unary, and logical expressions
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';
import { inferExpression, registerOperators } from './expressions.js';

/**
 * Check if a type is definitely numeric (number or bigint, not any/unknown)
 */
function isDefinitelyNumeric(type: Type): boolean {
  if (type.kind === 'number' || type.kind === 'bigint') {
    return true;
  }
  if (type.kind === 'union') {
    // Union is numeric if all non-never members are numeric
    return type.members.every(m => m.kind === 'never' || m.kind === 'number' || m.kind === 'bigint');
  }
  return false;
}

/**
 * Infer binary expression type
 */
export function inferBinaryExpression(
  expr: t.BinaryExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = t.isPrivateName(expr.left) ? Types.any() : inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '+':
      // If either side is definitely a string, result is string
      if (left.kind === 'string' || right.kind === 'string') {
        return Types.string;
      }
      // If both sides are definitely numbers, result is number
      if (left.kind === 'number' && right.kind === 'number') {
        if (left.value !== undefined && right.value !== undefined) {
          return Types.numberLiteral(left.value + right.value);
        }
        return Types.number;
      }
      // If one side is number and other is any/unknown, check context
      // In numeric context (e.g., result of another + with number), prefer number
      if (isDefinitelyNumeric(left) && (right.kind === 'any' || right.kind === 'unknown')) {
        // If we're adding number + any, and this is part of a larger numeric expression,
        // it's likely numeric. Be optimistic and return number.
        return Types.number;
      }
      if (isDefinitelyNumeric(right) && (left.kind === 'any' || left.kind === 'unknown')) {
        return Types.number;
      }
      // If both are any/unknown, could be either
      if ((left.kind === 'any' || left.kind === 'unknown') &&
          (right.kind === 'any' || right.kind === 'unknown')) {
        return Types.union([Types.string, Types.number]);
      }
      // Default: could be string or number
      return Types.union([Types.string, Types.number]);

    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
      return Types.number;

    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return Types.number;

    case '==':
    case '===':
    case '!=':
    case '!==':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'in':
    case 'instanceof':
      return Types.boolean;

    default:
      return Types.any();
  }
}

/**
 * Infer unary expression type
 */
export function inferUnaryExpression(
  expr: t.UnaryExpression,
  _state: TypeState,
  _ctx: IterativeContext
): Type {
  switch (expr.operator) {
    case 'typeof':
      return Types.string;
    case 'void':
      return Types.undefined;
    case '!':
      return Types.boolean;
    case '+':
    case '-':
    case '~':
      return Types.number;
    case 'delete':
      return Types.boolean;
    default:
      return Types.any();
  }
}

/**
 * Infer logical expression type
 */
export function inferLogicalExpression(
  expr: t.LogicalExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '&&':
    case '||':
      return Types.union([left, right]);

    case '??':
      if (left.kind === 'null' || left.kind === 'undefined') {
        return right;
      }
      if (left.kind === 'union') {
        const nonNullable = left.members.filter(
          (m) => m.kind !== 'null' && m.kind !== 'undefined'
        );
        if (nonNullable.length === 0) {
          return right;
        }
        return Types.union([...nonNullable, right]);
      }
      return left;

    default:
      return Types.any();
  }
}

// Register implementations with expressions module
registerOperators({
  inferBinaryExpression,
  inferUnaryExpression,
  inferLogicalExpression,
});
