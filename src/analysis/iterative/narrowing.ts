/**
 * Type Narrowing - Narrow types based on control flow conditions
 *
 * This module handles type narrowing based on edge conditions in the CFG.
 */

import * as t from '@babel/types';
import type { EdgeCondition } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { canBeFalsy } from '../../utils/type-utils.js';
import { narrowByTypeof, removeNullable } from '../../utils/type-utils.js';
import { lookupBinding, updateBinding } from './state.js';

/**
 * Narrow type based on edge condition
 */
export function narrowTypeByCondition(
  state: TypeState,
  condition: EdgeCondition | undefined
): TypeState {
  if (!condition) return state;

  const expr = condition.expression;
  const whenTruthy = condition.whenTruthy;

  // Handle typeof narrowing: typeof x === "type"
  if (t.isBinaryExpression(expr)) {
    if (
      (expr.operator === '===' || expr.operator === '==') &&
      t.isUnaryExpression(expr.left) &&
      expr.left.operator === 'typeof' &&
      t.isIdentifier(expr.left.argument) &&
      t.isStringLiteral(expr.right)
    ) {
      const varName = expr.left.argument.name;
      const typeofStr = expr.right.value;
      const binding = lookupBinding(state.env, varName);
      if (binding) {
        const narrowed = narrowByTypeof(binding.type, typeofStr, !whenTruthy);
        const newEnv = updateBinding(state.env, varName, narrowed, binding.kind, binding.declarationNode);
        return { ...state, env: newEnv };
      }
    }

    // Handle !== null, !== undefined
    if (
      (expr.operator === '!==' || expr.operator === '!=') &&
      t.isIdentifier(expr.left) &&
      (t.isNullLiteral(expr.right) ||
        (t.isIdentifier(expr.right) && expr.right.name === 'undefined'))
    ) {
      const varName = expr.left.name;
      const binding = lookupBinding(state.env, varName);
      if (binding && whenTruthy) {
        // If x !== null is true, remove null from x's type
        const narrowed = removeNullable(binding.type);
        const newEnv = updateBinding(state.env, varName, narrowed, binding.kind, binding.declarationNode);
        return { ...state, env: newEnv };
      }
    }
  }

  // Handle simple identifier check (if (x) { ... })
  if (t.isIdentifier(expr)) {
    const binding = lookupBinding(state.env, expr.name);
    if (binding) {
      if (whenTruthy) {
        // In truthy branch, remove falsy types (null, undefined)
        if (canBeFalsy(binding.type)) {
          const narrowed = removeNullable(binding.type);
          const newEnv = updateBinding(state.env, expr.name, narrowed, binding.kind, binding.declarationNode);
          return { ...state, env: newEnv };
        }
      }
    }
  }

  return state;
}
