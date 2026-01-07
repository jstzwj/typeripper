/**
 * Statement Type Inference
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Statements don't produce types but generate constraints
 * and may modify the typing environment.
 */

import type { Statement, Expression } from '@babel/types';
import type { PolarType, PolyScheme } from '../types/index.js';
import { freshTypeVar } from '../types/index.js';
import { undefined_ } from '../types/factory.js';
import { monoScheme } from '../types/scheme.js';
import type { ConstraintSet } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
  mergeConstraintSets,
} from '../solver/index.js';
import type { StatementResult, InferResult } from './context.js';
import {
  InferenceContext,
  statementResult,
  emptyStatementResult,
  nodeToSource,
} from './context.js';
import { inferExpression } from './expressions.js';

// ============================================================================
// Main Statement Inference
// ============================================================================

/**
 * Infer constraints from a statement
 */
export function inferStatement(ctx: InferenceContext, stmt: Statement): StatementResult {
  switch (stmt.type) {
    case 'BlockStatement':
      return inferStatements(ctx.child(), stmt.body);

    case 'ExpressionStatement': {
      const result = inferExpression(ctx, stmt.expression);
      return statementResult(result.constraints);
    }

    case 'VariableDeclaration': {
      let constraints = emptyConstraintSet();
      const bindings = new Map<string, PolyScheme>();

      for (const decl of stmt.declarations) {
        let initType: PolarType = undefined_;
        if (decl.init) {
          const initResult = inferExpression(ctx, decl.init);
          constraints = mergeConstraintSets(constraints, initResult.constraints);
          initType = initResult.type;
        }

        if (decl.id.type === 'Identifier') {
          const polyScheme = ctx.generalize(initType);
          bindings.set(decl.id.name, polyScheme);
          ctx.bindScheme(decl.id.name, polyScheme);
        }
      }

      return statementResult(constraints, false, bindings);
    }

    case 'ReturnStatement': {
      let constraints = emptyConstraintSet();
      let returnType: PolarType = undefined_;

      if (stmt.argument) {
        const argResult = inferExpression(ctx, stmt.argument);
        constraints = argResult.constraints;
        returnType = argResult.type;
      }

      const expectedReturn = ctx.getReturnType();
      if (expectedReturn) {
        constraints = addConstraint(
          constraints,
          flow(returnType, expectedReturn, nodeToSource(stmt))
        );
      }

      return statementResult(constraints, true);
    }

    case 'IfStatement': {
      const testResult = inferExpression(ctx, stmt.test);
      let constraints = testResult.constraints;

      const consequentResult = inferStatement(ctx.child(), stmt.consequent);
      constraints = mergeConstraintSets(constraints, consequentResult.constraints);

      if (stmt.alternate) {
        const alternateResult = inferStatement(ctx.child(), stmt.alternate);
        constraints = mergeConstraintSets(constraints, alternateResult.constraints);
      }

      return statementResult(constraints, false);
    }

    case 'FunctionDeclaration': {
      if (stmt.id) {
        const funcType = ctx.fresh(stmt.id.name);
        const funcScheme = ctx.generalize(funcType);
        return statementResult(
          emptyConstraintSet(),
          false,
          new Map([[stmt.id.name, funcScheme]])
        );
      }
      return emptyStatementResult();
    }

    // For other statements, return empty result for now
    default:
      return emptyStatementResult();
  }
}

/**
 * Infer constraints from a sequence of statements
 */
export function inferStatements(
  ctx: InferenceContext,
  stmts: Statement[]
): StatementResult {
  let constraints = emptyConstraintSet();
  let diverges = false;
  const bindings = new Map<string, PolyScheme>();

  for (const stmt of stmts) {
    if (diverges) {
      // Unreachable code after diverging statement
      break;
    }

    const result = inferStatement(ctx, stmt);
    constraints = mergeConstraintSets(constraints, result.constraints);
    diverges = result.diverges;

    // Apply new bindings to context
    for (const [name, scheme] of result.bindings) {
      ctx.bindScheme(name, scheme);
      bindings.set(name, scheme);
    }
  }

  return statementResult(constraints, diverges, bindings);
}
