/**
 * Z3 SMT Solver Backend - Optional enhanced constraint solving
 *
 * This module provides Z3-based constraint solving as an optional backend.
 * The main biunification algorithm in biunify.ts works without Z3,
 * but Z3 can be used for:
 * - Complex disjunctive constraints
 * - Verification of subtyping relationships
 * - More precise error messages
 *
 * To use Z3, install the z3-solver package:
 *   npm install z3-solver
 */

import type { PolarType } from '../types/index.js';
import type { FlowConstraint, SolveResult, SolveError } from './constraint.js';
import { success, failure } from './constraint.js';
import type { Bisubstitution } from './bisubstitution.js';
import { emptyBisubst } from './bisubstitution.js';

// ============================================================================
// Z3 Types (dynamically imported)
// ============================================================================

// Z3 is optional - we'll check if it's available at runtime
let z3Module: any = null;
let z3Available = false;

/**
 * Initialize Z3 (async, call once at startup if using Z3 features)
 */
export async function initZ3(): Promise<boolean> {
  try {
    // Dynamic import to avoid build-time dependency on z3-solver
    // The module may not be installed
    // @ts-ignore - z3-solver is an optional dependency
    z3Module = await import(/* webpackIgnore: true */ 'z3-solver');
    z3Available = true;
    console.log('Z3 solver initialized successfully');
    return true;
  } catch (e) {
    console.warn('Z3 solver not available, using pure TypeScript biunification');
    z3Available = false;
    return false;
  }
}

/**
 * Check if Z3 is available
 */
export function isZ3Available(): boolean {
  return z3Available;
}

// ============================================================================
// Z3 Solver Context
// ============================================================================

/**
 * Z3-based constraint solver
 *
 * Uses SMT solving for complex constraint scenarios that are
 * difficult to handle with pure biunification.
 */
export class Z3Solver {
  private z3: any;
  private solver: any;
  private context: any;

  /** Type variable to Z3 sort mapping */
  private typeVarSorts: Map<number, any> = new Map();

  /** Type to Z3 expression cache */
  private typeExprs: Map<string, any> = new Map();

  /**
   * Initialize the Z3 solver
   */
  async initialize(): Promise<boolean> {
    if (!z3Available) {
      const ok = await initZ3();
      if (!ok) return false;
    }

    try {
      const { init } = z3Module;
      this.z3 = await init();
      this.context = this.z3.Context('main');
      this.solver = new this.context.Solver();
      return true;
    } catch (e) {
      console.error('Failed to initialize Z3 context:', e);
      return false;
    }
  }

  /**
   * Solve constraints using Z3
   */
  async solve(constraints: readonly FlowConstraint[]): Promise<SolveResult<Bisubstitution>> {
    if (!this.z3) {
      const initialized = await this.initialize();
      if (!initialized) {
        return failure([{
          kind: 'unsatisfiable',
          message: 'Z3 solver not available',
          source: constraints[0]?.source ?? {
            file: '',
            line: 0,
            column: 0,
          },
        }]);
      }
    }

    try {
      // Encode all constraints
      for (const constraint of constraints) {
        const encoded = this.encodeConstraint(constraint);
        this.solver.add(encoded);
      }

      // Check satisfiability
      const result = await this.solver.check();

      if (result === 'sat') {
        // Extract model and build substitution
        const model = this.solver.model();
        const subst = this.extractSubstitution(model);
        return success(subst);
      } else if (result === 'unsat') {
        // Get unsat core for better error messages
        return failure([{
          kind: 'unsatisfiable',
          message: 'Constraints are unsatisfiable',
          source: constraints[0]?.source ?? {
            file: '',
            line: 0,
            column: 0,
          },
        }]);
      } else {
        // Unknown (timeout or other)
        return failure([{
          kind: 'unsatisfiable',
          message: 'Z3 returned unknown (possible timeout)',
          source: constraints[0]?.source ?? {
            file: '',
            line: 0,
            column: 0,
          },
        }]);
      }
    } catch (e) {
      return failure([{
        kind: 'unsatisfiable',
        message: `Z3 error: ${e}`,
        source: constraints[0]?.source ?? {
          file: '',
          line: 0,
          column: 0,
        },
      }]);
    }
  }

  /**
   * Encode a flow constraint as a Z3 formula
   *
   * τ⁺ ≤ τ⁻ becomes a subtyping assertion in Z3
   */
  private encodeConstraint(constraint: FlowConstraint): any {
    const posExpr = this.encodeType(constraint.positive);
    const negExpr = this.encodeType(constraint.negative);

    // Subtyping as implication in the type lattice
    // For now, use equality (TODO: proper subtyping encoding)
    return this.context.Eq(posExpr, negExpr);
  }

  /**
   * Encode a type as a Z3 expression
   */
  private encodeType(type: PolarType): any {
    const key = this.typeKey(type);
    const cached = this.typeExprs.get(key);
    if (cached) return cached;

    let expr: any;

    switch (type.kind) {
      case 'var':
        // Type variable as uninterpreted constant
        expr = this.getOrCreateTypeVar(type.id);
        break;

      case 'primitive':
        // Primitive as constant
        expr = this.context.Int.val(this.primitiveCode(type.name));
        break;

      case 'function':
        // Function type as constructor application
        // Encode as: func(domain, codomain)
        const domainExpr = type.params.length > 0
          ? this.encodeType(type.params[0]!.type)
          : this.context.Int.val(0);
        const codomainExpr = this.encodeType(type.returnType);
        // Use pair constructor
        expr = this.context.Int.add(
          this.context.Int.mul(domainExpr, this.context.Int.val(1000)),
          codomainExpr
        );
        break;

      case 'top':
        expr = this.context.Int.val(9999);
        break;

      case 'bottom':
        expr = this.context.Int.val(-9999);
        break;

      default:
        // Fallback: unique constant per type kind
        expr = this.context.Int.val(this.typeKindCode(type.kind));
    }

    this.typeExprs.set(key, expr);
    return expr;
  }

  /**
   * Get or create a Z3 constant for a type variable
   */
  private getOrCreateTypeVar(id: number): any {
    const existing = this.typeVarSorts.get(id);
    if (existing) return existing;

    const varExpr = this.context.Int.const(`t${id}`);
    this.typeVarSorts.set(id, varExpr);
    return varExpr;
  }

  /**
   * Extract a bisubstitution from a Z3 model
   */
  private extractSubstitution(model: any): Bisubstitution {
    // TODO: Parse Z3 model and build substitution
    // For now, return empty substitution
    return emptyBisubst();
  }

  /**
   * Generate a unique key for a type
   */
  private typeKey(type: PolarType): string {
    switch (type.kind) {
      case 'var':
        return `var:${type.id}`;
      case 'primitive':
        return `prim:${type.name}`;
      case 'function':
        return `func:${type.params.length}:${type.params.map(p => this.typeKey(p.type)).join(',')}:${this.typeKey(type.returnType)}`;
      default:
        return `${type.kind}:${JSON.stringify(type)}`;
    }
  }

  /**
   * Numeric code for primitive types
   */
  private primitiveCode(name: string): number {
    const codes: Record<string, number> = {
      boolean: 1,
      number: 2,
      string: 3,
      null: 4,
      undefined: 5,
      symbol: 6,
      bigint: 7,
    };
    return codes[name] ?? 0;
  }

  /**
   * Numeric code for type kinds
   */
  private typeKindCode(kind: string): number {
    const codes: Record<string, number> = {
      primitive: 100,
      function: 200,
      record: 300,
      array: 400,
      union: 500,
      intersection: 600,
      promise: 700,
      class: 800,
    };
    return codes[kind] ?? 999;
  }

  /**
   * Reset the solver (clear all assertions)
   */
  reset(): void {
    if (this.solver) {
      this.solver.reset();
    }
    this.typeExprs.clear();
  }

  /**
   * Push a new scope
   */
  push(): void {
    if (this.solver) {
      this.solver.push();
    }
  }

  /**
   * Pop to previous scope
   */
  pop(): void {
    if (this.solver) {
      this.solver.pop();
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalZ3Solver: Z3Solver | null = null;

/**
 * Get the global Z3 solver instance
 */
export function getZ3Solver(): Z3Solver {
  if (!globalZ3Solver) {
    globalZ3Solver = new Z3Solver();
  }
  return globalZ3Solver;
}

/**
 * Solve constraints using Z3 (convenience function)
 */
export async function solveWithZ3(
  constraints: readonly FlowConstraint[]
): Promise<SolveResult<Bisubstitution>> {
  const solver = getZ3Solver();
  return solver.solve(constraints);
}
