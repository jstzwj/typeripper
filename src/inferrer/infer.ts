/**
 * Main Type Inference Entry Point
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * This module provides the main entry point for type inference,
 * combining expression and statement inference with constraint solving.
 */

import type { File, Program, Statement, Expression } from '@babel/types';
import type { PolarType, PolyScheme, TypeVar } from '../types/index.js';
import { freeVars } from '../types/index.js';
import { typingScheme, polyScheme } from '../types/scheme.js';
import type { ConstraintSet, FlowConstraint, Bisubstitution, SolveResult } from '../solver/index.js';
import {
  emptyConstraintSet,
  mergeConstraintSets,
  success,
  failure,
} from '../solver/index.js';
import { BiunificationContext, biunify } from '../solver/biunify.js';
import { applyPositive, simplifyTypeForOutput } from '../solver/bisubstitution.js';
import { simplify } from '../automata/index.js';
import { typeToAutomaton, automatonToType } from '../automata/convert.js';
import type { InferResult, StatementResult } from './context.js';
import {
  InferenceContext,
  createInitialContext,
  inferResult,
} from './context.js';
import { inferExpression } from './expressions.js';
import { inferStatements, inferStatement } from './statements.js';

// ============================================================================
// Main Inference Entry Points
// ============================================================================

/**
 * Infer types for an entire program
 */
export function inferProgram(program: Program): ProgramInferenceResult {
  const ctx = createInitialContext();

  // Infer all statements
  const result = inferStatements(ctx, program.body as Statement[]);

  // Solve constraints
  const solveResult = solveConstraints(result.constraints);

  if (!solveResult.ok) {
    return {
      success: false,
      errors: solveResult.errors.map(e => ({ message: e.message, location: e.source })),
      bindings: new Map(),
    };
  }

  // Apply substitution to get final types
  // Use global bindings to include all scopes (including IIFE bodies)
  const finalBindings = new Map<string, PolarType>();
  const allBindings = ctx.getGlobalBindings();

  for (const [name, polyScheme] of allBindings) {
    const instantiated = applyPositive(polyScheme.scheme.body, solveResult.value);
    const simplified = simplifyType(instantiated);
    finalBindings.set(name, simplified);
  }

  return {
    success: true,
    errors: [],
    bindings: finalBindings,
    bisubstitution: solveResult.value,
  };
}

/**
 * Infer types for a Babel File node
 */
export function inferFile(file: File): ProgramInferenceResult {
  return inferProgram(file.program);
}

/**
 * Infer type of a single expression
 */
export function inferExpr(expr: Expression): ExpressionInferenceResult {
  const ctx = createInitialContext();
  const result = inferExpression(ctx, expr);

  // Solve constraints
  const solveResult = solveConstraints(result.constraints);

  if (!solveResult.ok) {
    return {
      success: false,
      errors: solveResult.errors.map(e => ({ message: e.message, location: e.source })),
      type: null,
    };
  }

  // Apply substitution and simplify
  const finalType = applyPositive(result.type, solveResult.value);
  const simplified = simplifyType(finalType);

  return {
    success: true,
    errors: [],
    type: simplified,
    bisubstitution: solveResult.value,
  };
}

/**
 * Infer types with a given initial environment
 */
export function inferWithEnv(
  program: Program,
  initialEnv: Map<string, PolyScheme>
): ProgramInferenceResult {
  const ctx = createInitialContext();

  // Add initial bindings
  for (const [name, scheme] of initialEnv) {
    ctx.bindScheme(name, scheme);
  }

  const result = inferStatements(ctx, program.body as Statement[]);
  const solveResult = solveConstraints(result.constraints);

  if (!solveResult.ok) {
    return {
      success: false,
      errors: solveResult.errors.map(e => ({ message: e.message, location: e.source })),
      bindings: new Map(),
    };
  }

  // Use global bindings to include all scopes
  const finalBindings = new Map<string, PolarType>();
  const allBindings = ctx.getGlobalBindings();

  // Remove initial env bindings from output
  for (const [name, polyScheme] of allBindings) {
    if (!initialEnv.has(name)) {
      const instantiated = applyPositive(polyScheme.scheme.body, solveResult.value);
      const simplified = simplifyType(instantiated);
      finalBindings.set(name, simplified);
    }
  }

  return {
    success: true,
    errors: [],
    bindings: finalBindings,
    bisubstitution: solveResult.value,
  };
}

// ============================================================================
// Constraint Solving
// ============================================================================

/**
 * Solve a set of constraints using biunification
 */
export function solveConstraints(constraints: ConstraintSet): SolveResult<Bisubstitution> {
  const biunifyCtx = new BiunificationContext();
  return biunifyCtx.solve(constraints.constraints);
}

/**
 * Check if a type is a subtype of another
 */
export function checkSubtype(sub: PolarType, sup: PolarType): boolean {
  const biunifyCtx = new BiunificationContext();
  const result = biunifyCtx.solve([{
    kind: 'flow',
    positive: sub,
    negative: sup,
    source: { file: '<check>', line: 0, column: 0 },
  }]);
  return result.ok;
}

// ============================================================================
// Type Simplification
// ============================================================================

/**
 * Simplify a type using automata minimization and output cleanup
 */
export function simplifyType(type: PolarType): PolarType {
  try {
    // First apply output simplification to clean up type variables
    const cleaned = simplifyTypeForOutput(type);

    // If the cleaned type is already a simple type (unknown, primitive, etc.),
    // skip automaton processing
    if (cleaned.kind === 'unknown' || cleaned.kind === 'never' ||
        cleaned.kind === 'any' || cleaned.kind === 'primitive') {
      return cleaned;
    }

    // For function types with only unknown parameters and return, keep it simple
    if (cleaned.kind === 'function') {
      const allParamsUnknown = cleaned.params.every(p => p.type.kind === 'unknown');
      const returnUnknown = cleaned.returnType.kind === 'unknown';
      if (allParamsUnknown || returnUnknown) {
        // Return the simplified function without automaton processing
        return cleaned;
      }
    }

    // Skip automaton conversion for record types
    // Record types are already in a simplified form, and automaton conversion
    // can lose field type information during the round-trip conversion
    if (cleaned.kind === 'record') {
      return cleaned;
    }

    // Convert to automaton
    const automaton = typeToAutomaton(cleaned, '+');

    // Simplify
    const simplified = simplify(automaton);

    // Convert back
    const result = automatonToType(simplified);

    // Apply output simplification again after automaton conversion
    return simplifyTypeForOutput(result);
  } catch {
    // If simplification fails, at least clean up the type
    return simplifyTypeForOutput(type);
  }
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of program inference
 */
export interface ProgramInferenceResult {
  /** Whether inference succeeded */
  success: boolean;

  /** Type errors encountered */
  errors: InferenceError[];

  /** Inferred types for top-level bindings */
  bindings: Map<string, PolarType>;

  /** The bisubstitution (if successful) */
  bisubstitution?: Bisubstitution;
}

/**
 * Result of expression inference
 */
export interface ExpressionInferenceResult {
  /** Whether inference succeeded */
  success: boolean;

  /** Type errors encountered */
  errors: InferenceError[];

  /** Inferred type (if successful) */
  type: PolarType | null;

  /** The bisubstitution (if successful) */
  bisubstitution?: Bisubstitution;
}

/**
 * A type inference error
 */
export interface InferenceError {
  /** Error message */
  message: string;

  /** Source location */
  location?: {
    file: string;
    line: number;
    column: number;
  };

  /** Types involved in the error */
  types?: {
    expected?: PolarType;
    actual?: PolarType;
  };
}

// ============================================================================
// Incremental Inference
// ============================================================================

/**
 * Incremental inference context for interactive use
 */
export class IncrementalInferrer {
  private ctx: InferenceContext;
  private constraints: ConstraintSet;
  private solved: Bisubstitution | null;

  constructor() {
    this.ctx = createInitialContext();
    this.constraints = emptyConstraintSet();
    this.solved = null;
  }

  /**
   * Add a statement and infer its types
   */
  addStatement(stmt: Statement): StatementResult {
    const result = inferStatement(this.ctx, stmt);

    // Add new constraints
    this.constraints = mergeConstraintSets(this.constraints, result.constraints);

    // Apply new bindings
    for (const [name, scheme] of result.bindings) {
      this.ctx.bindScheme(name, scheme);
    }

    // Invalidate cached solution
    this.solved = null;

    return result;
  }

  /**
   * Infer type of an expression in current context
   */
  inferExpression(expr: Expression): InferResult {
    return inferExpression(this.ctx, expr);
  }

  /**
   * Get type of a variable
   */
  getType(name: string): PolarType | null {
    const scheme = this.ctx.lookup(name);
    if (!scheme) return null;

    // Solve if needed
    if (!this.solved) {
      const solveResult = solveConstraints(this.constraints);
      if (!solveResult.ok) return null;
      this.solved = solveResult.value;
    }

    const type = this.ctx.instantiate(scheme);
    const final = applyPositive(type, this.solved);
    return simplifyType(final);
  }

  /**
   * Get all bindings
   */
  getAllTypes(): Map<string, PolarType> {
    // Solve if needed
    if (!this.solved) {
      const solveResult = solveConstraints(this.constraints);
      if (!solveResult.ok) return new Map();
      this.solved = solveResult.value;
    }

    const result = new Map<string, PolarType>();
    for (const [name, scheme] of this.ctx.getAllBindings()) {
      const type = this.ctx.instantiate(scheme);
      const final = applyPositive(type, this.solved);
      result.set(name, simplifyType(final));
    }

    return result;
  }

  /**
   * Check for type errors
   */
  checkErrors(): InferenceError[] {
    const solveResult = solveConstraints(this.constraints);
    if (!solveResult.ok) {
      return solveResult.errors.map(e => ({ message: e.message, location: e.source }));
    }
    this.solved = solveResult.value;
    return [];
  }

  /**
   * Reset the inferrer
   */
  reset(): void {
    this.ctx = createInitialContext();
    this.constraints = emptyConstraintSet();
    this.solved = null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a typing environment from a map of names to types
 */
export function createEnv(bindings: Map<string, PolarType>): Map<string, PolyScheme> {
  const env = new Map<string, PolyScheme>();
  for (const [name, type] of bindings) {
    env.set(name, polyScheme(new Set(), type));
  }
  return env;
}

/**
 * Get free type variables in a type
 */
export function getFreeVars(type: PolarType): Set<number> {
  return freeVars(type);
}
