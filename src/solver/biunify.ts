/**
 * Biunification - Core constraint solving algorithm for MLsub
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 4.3 and Figure 7
 *
 * Biunification solves constraints of the form τ⁺ ≤ τ⁻
 * (positive type flows to negative type).
 *
 * The algorithm:
 * 1. Decompose structural constraints using sub_B rules
 * 2. Eliminate atomic constraints using bisubstitution
 * 3. Track visited constraint pairs to handle recursive types
 */

import type { PolarType, TypeVar, RecordType, FieldType } from '../types/index.js';
import { isTypeVar, occursIn, freeVars, substitute } from '../types/index.js';
import { union, intersection, freshTypeVar } from '../types/index.js';
import type { FlowConstraint, SourceLocation, SolveResult, SolveError } from './constraint.js';
import { success, failure, fail } from './constraint.js';
import type { Bisubstitution } from './bisubstitution.js';
import {
  emptyBisubst,
  compose,
  eliminateUpperBound,
  eliminateLowerBound,
  applyPositive,
  applyNegative,
} from './bisubstitution.js';

// ============================================================================
// Biunification Context
// ============================================================================

/**
 * Context for biunification algorithm
 */
export class BiunificationContext {
  /** Memoization set H: previously seen constraint pairs */
  private readonly seen: Set<string> = new Set();

  /** Current bisubstitution */
  private subst: Bisubstitution = emptyBisubst();

  /** Collected errors */
  private readonly errors: SolveError[] = [];

  /**
   * Solve a set of flow constraints
   */
  solve(constraints: readonly FlowConstraint[]): SolveResult<Bisubstitution> {
    // Worklist algorithm
    const worklist = [...constraints];

    while (worklist.length > 0) {
      const constraint = worklist.shift()!;

      // Apply current substitution
      const pos = applyPositive(constraint.positive, this.subst);
      const neg = applyNegative(constraint.negative, this.subst);

      // Decompose and get new constraints
      const result = this.biunify(pos, neg, constraint.source);

      if (!result.ok) {
        return failure(result.errors);
      }

      // Add new constraints to worklist
      worklist.push(...result.value);
    }

    return success(this.subst);
  }

  /**
   * Main biunification function: τ⁺ ≤ τ⁻
   *
   * Implements B(H; C) from Figure 7
   */
  private biunify(
    pos: PolarType,
    neg: PolarType,
    source: SourceLocation
  ): SolveResult<FlowConstraint[]> {
    // Check memoization (for recursive types)
    const key = this.makeKey(pos, neg);
    if (this.seen.has(key)) {
      return success([]);
    }
    this.seen.add(key);

    // Rule: α ≤ α (reflexivity for same variable)
    if (isTypeVar(pos) && isTypeVar(neg) && pos.id === neg.id) {
      return success([]);
    }

    // Rule: α⁺ ≤ β⁻ (two different type variables)
    // This creates a flow from α to β, so:
    // - α gets an upper bound (β)
    // - β gets a lower bound (α)
    if (isTypeVar(pos) && isTypeVar(neg)) {
      // Give α an upper bound
      this.subst = eliminateUpperBound(this.subst, pos.id, neg);
      // Give β a lower bound
      this.subst = eliminateLowerBound(this.subst, neg.id, pos);
      return success([]);
    }

    // Rule: α⁺ ≤ τ⁻ (variable on left, concrete on right)
    if (isTypeVar(pos)) {
      return this.eliminateLower(pos, neg, source);
    }

    // Rule: τ⁺ ≤ α⁻ (concrete on left, variable on right)
    if (isTypeVar(neg)) {
      return this.eliminateUpper(pos, neg, source);
    }

    // Decompose structural constraints using sub_B
    return this.decompose(pos, neg, source);
  }

  /**
   * Decompose a structural constraint using sub_B rules
   *
   * Implements sub_B from Figure 7
   */
  private decompose(
    pos: PolarType,
    neg: PolarType,
    source: SourceLocation
  ): SolveResult<FlowConstraint[]> {
    // Rule: ⊥ ≤ τ⁻ (bottom is subtype of everything)
    if (pos.kind === 'bottom') {
      return success([]);
    }

    // Rule: τ⁺ ≤ ⊤ (everything is subtype of top)
    if (neg.kind === 'top') {
      return success([]);
    }

    // Rule: any ≤ τ⁻ and τ⁺ ≤ any (any is compatible with everything)
    if (pos.kind === 'any' || neg.kind === 'any') {
      return success([]);
    }

    // Rule: never flows to anything, anything flows to unknown
    if (pos.kind === 'never' || neg.kind === 'unknown') {
      return success([]);
    }

    // Rule: (τ₁⁺ ⊔ τ₂⁺) ≤ τ⁻ → {τ₁⁺ ≤ τ⁻, τ₂⁺ ≤ τ⁻}
    if (pos.kind === 'union') {
      return success(
        pos.members.map(m => ({
          kind: 'flow' as const,
          positive: m,
          negative: neg,
          source,
        }))
      );
    }

    // Rule: τ⁺ ≤ (τ₁⁻ ⊓ τ₂⁻) → {τ⁺ ≤ τ₁⁻, τ⁺ ≤ τ₂⁻}
    if (neg.kind === 'intersection') {
      return success(
        neg.members.map(m => ({
          kind: 'flow' as const,
          positive: pos,
          negative: m,
          source,
        }))
      );
    }

    // Rule: (τ₁⁺ ⊓ τ₂⁺) ≤ τ⁻ → find a matching member
    // For intersection in positive position, we try each member until one succeeds.
    // This is needed for callable objects (like Array which is Function & {isArray: ...}).
    if (pos.kind === 'intersection') {
      // For function types: find a function member in the intersection
      if (neg.kind === 'function') {
        const funcMember = pos.members.find(m => m.kind === 'function');
        if (funcMember) {
          return success([{
            kind: 'flow' as const,
            positive: funcMember,
            negative: neg,
            source,
          }]);
        }
      }

      // For record types: merge all record members and check against neg
      if (neg.kind === 'record') {
        const recordMembers = pos.members.filter(m => m.kind === 'record');
        if (recordMembers.length > 0) {
          // Merge all record fields
          const mergedFields = new Map<string, FieldType>();
          for (const rec of recordMembers) {
            if (rec.kind === 'record') {
              for (const [name, field] of rec.fields) {
                mergedFields.set(name, field);
              }
            }
          }
          const mergedRecord: RecordType = {
            kind: 'record',
            fields: mergedFields,
            rest: null,
          };
          return success([{
            kind: 'flow' as const,
            positive: mergedRecord,
            negative: neg,
            source,
          }]);
        }
      }

      // Fallback: each member of the intersection must satisfy the negative type
      // This is sound but may be overly strict
      return success(
        pos.members.map(m => ({
          kind: 'flow' as const,
          positive: m,
          negative: neg,
          source,
        }))
      );
    }

    // Rule: μα.τ⁺ ≤ τ⁻ → τ⁺[μα.τ⁺/α] ≤ τ⁻ (unfold left)
    if (pos.kind === 'recursive') {
      const unfolded = substitute(pos.body, pos.binder.id, pos);
      return success([{ kind: 'flow', positive: unfolded, negative: neg, source }]);
    }

    // Rule: τ⁺ ≤ μα.τ⁻ → τ⁺ ≤ τ⁻[μα.τ⁻/α] (unfold right)
    if (neg.kind === 'recursive') {
      const unfolded = substitute(neg.body, neg.binder.id, neg);
      return success([{ kind: 'flow', positive: pos, negative: unfolded, source }]);
    }

    // Rule: bool ≤ bool (and other primitives)
    if (pos.kind === 'primitive' && neg.kind === 'primitive') {
      if (pos.name === neg.name) {
        // Check literal compatibility
        if (pos.value !== undefined && neg.value !== undefined && pos.value !== neg.value) {
          return fail('incompatible-types', `Literal ${pos.value} is not assignable to ${neg.value}`, source, [pos, neg]);
        }
        return success([]);
      }
      return fail('incompatible-types', `Type '${pos.name}' is not assignable to '${neg.name}'`, source, [pos, neg]);
    }

    // Rule: (τ₁⁻ → τ₁⁺) ≤ (τ₂⁺ → τ₂⁻) → {τ₂⁺ ≤ τ₁⁻, τ₁⁺ ≤ τ₂⁻}
    // Note: Function types are contravariant in domain, covariant in codomain
    if (pos.kind === 'function' && neg.kind === 'function') {
      const constraints: FlowConstraint[] = [];

      // Check arity
      const minPos = pos.params.filter(p => !p.optional && !p.rest).length;
      const minNeg = neg.params.filter(p => !p.optional && !p.rest).length;

      if (minPos < minNeg) {
        // Positive has fewer required params - that's OK (contravariance)
      }

      // Contravariant in parameters: neg.params ≤ pos.params
      const maxParams = Math.max(pos.params.length, neg.params.length);
      for (let i = 0; i < maxParams; i++) {
        const posParam = pos.params[i];
        const negParam = neg.params[i];

        if (posParam && negParam) {
          // Contravariant: flow from neg to pos
          constraints.push({
            kind: 'flow',
            positive: negParam.type,
            negative: posParam.type,
            source,
          });
        }
      }

      // Covariant in return type: pos.return ≤ neg.return
      constraints.push({
        kind: 'flow',
        positive: pos.returnType,
        negative: neg.returnType,
        source,
      });

      return success(constraints);
    }

    // Rule: {f} ≤ {g} where dom(g) ⊆ dom(f)
    // For each field in g, there must be a corresponding field in f
    if (pos.kind === 'record' && neg.kind === 'record') {
      const constraints: FlowConstraint[] = [];

      // Check that all required fields in neg are present in pos
      for (const [name, negField] of neg.fields) {
        const posField = pos.fields.get(name);

        if (!posField) {
          // Field missing in positive type
          if (!negField.optional) {
            return fail('missing-property', `Property '${name}' is missing`, source, [pos, neg]);
          }
          continue;
        }

        // Covariant field: pos.field ≤ neg.field
        constraints.push({
          kind: 'flow',
          positive: posField.type,
          negative: negField.type,
          source,
        });
      }

      // Handle row variables (open records)
      if (neg.rest && pos.rest) {
        // Both open: row variables must be compatible
        constraints.push({
          kind: 'flow',
          positive: pos.rest,
          negative: neg.rest,
          source,
        });
      }

      return success(constraints);
    }

    // Rule: Array<τ₁> ≤ Array<τ₂>
    if (pos.kind === 'array' && neg.kind === 'array') {
      const constraints: FlowConstraint[] = [];

      // Covariant in element type
      constraints.push({
        kind: 'flow',
        positive: pos.elementType,
        negative: neg.elementType,
        source,
      });

      // Handle tuples
      if (pos.tuple && neg.tuple) {
        if (pos.tuple.length !== neg.tuple.length) {
          return fail('incompatible-types', `Tuple lengths differ: ${pos.tuple.length} vs ${neg.tuple.length}`, source, [pos, neg]);
        }
        for (let i = 0; i < pos.tuple.length; i++) {
          constraints.push({
            kind: 'flow',
            positive: pos.tuple[i]!,
            negative: neg.tuple[i]!,
            source,
          });
        }
      }

      return success(constraints);
    }

    // Rule: Promise<τ₁> ≤ Promise<τ₂>
    if (pos.kind === 'promise' && neg.kind === 'promise') {
      return success([{
        kind: 'flow',
        positive: pos.resolvedType,
        negative: neg.resolvedType,
        source,
      }]);
    }

    // Rule: Class types
    if (pos.kind === 'class' && neg.kind === 'class') {
      // Check name compatibility (nominal for classes)
      if (pos.name !== neg.name) {
        // Check inheritance
        let current: typeof pos | null = pos;
        while (current) {
          if (current.name === neg.name) {
            // Found match through inheritance
            return success([{
              kind: 'flow',
              positive: pos.instanceType,
              negative: neg.instanceType,
              source,
            }]);
          }
          current = current.superClass;
        }
        return fail('incompatible-types', `Class '${pos.name}' is not assignable to '${neg.name}'`, source, [pos, neg]);
      }

      return success([{
        kind: 'flow',
        positive: pos.instanceType,
        negative: neg.instanceType,
        source,
      }]);
    }

    // Incompatible types
    return fail(
      'incompatible-types',
      `Type '${pos.kind}' is not assignable to type '${neg.kind}'`,
      source,
      [pos, neg]
    );
  }

  /**
   * Eliminate constraint: τ⁺ ≤ α⁻ (type flows into variable)
   *
   * This gives α a lower bound: α must accept τ.
   * Apply θ_{τ≤α} = [α ⊔ τ / α⁺]
   */
  private eliminateUpper(
    pos: PolarType,
    neg: TypeVar,
    source: SourceLocation
  ): SolveResult<FlowConstraint[]> {
    // Occurs check
    if (occursIn(neg.id, pos)) {
      // Need to create recursive type
      const beta = freshTypeVar();
      const newType = {
        kind: 'recursive' as const,
        binder: beta,
        body: substitute(pos, neg.id, beta),
      };
      this.subst = eliminateLowerBound(this.subst, neg.id, newType);
    } else {
      this.subst = eliminateLowerBound(this.subst, neg.id, pos);
    }

    return success([]);
  }

  /**
   * Eliminate constraint: α⁺ ≤ τ⁻ (variable flows into type)
   *
   * This gives α an upper bound: α cannot produce more than τ.
   * Apply θ_{α≤τ} = [α ⊓ τ / α⁻]
   */
  private eliminateLower(
    pos: TypeVar,
    neg: PolarType,
    source: SourceLocation
  ): SolveResult<FlowConstraint[]> {
    // Occurs check
    if (occursIn(pos.id, neg)) {
      // Need to create recursive type
      const beta = freshTypeVar();
      const newType = {
        kind: 'recursive' as const,
        binder: beta,
        body: substitute(neg, pos.id, beta),
      };
      this.subst = eliminateUpperBound(this.subst, pos.id, newType);
    } else {
      this.subst = eliminateUpperBound(this.subst, pos.id, neg);
    }

    return success([]);
  }

  /**
   * Create a unique key for a constraint pair (for memoization)
   */
  private makeKey(pos: PolarType, neg: PolarType): string {
    // Simple key based on type structure
    // TODO: Better key generation for complex types
    return `${this.typeKey(pos)}<=${this.typeKey(neg)}`;
  }

  /**
   * Generate a key for a single type
   */
  private typeKey(type: PolarType): string {
    switch (type.kind) {
      case 'var':
        return `var(${type.id})`;
      case 'primitive':
        return type.value !== undefined ? `${type.name}(${type.value})` : type.name;
      case 'function':
        return `(${type.params.map(p => this.typeKey(p.type)).join(',')})=>${this.typeKey(type.returnType)}`;
      case 'record':
        return `{${[...type.fields.entries()].map(([k, v]) => `${k}:${this.typeKey(v.type)}`).join(',')}}`;
      case 'array':
        return `Array<${this.typeKey(type.elementType)}>`;
      case 'union':
        return `(${type.members.map(m => this.typeKey(m)).join('|')})`;
      case 'intersection':
        return `(${type.members.map(m => this.typeKey(m)).join('&')})`;
      case 'recursive':
        return `μ${type.binder.id}.${this.typeKey(type.body)}`;
      case 'promise':
        return `Promise<${this.typeKey(type.resolvedType)}>`;
      case 'class':
        return `class(${type.name})`;
      default:
        return type.kind;
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Solve a set of flow constraints using biunification
 */
export function biunify(constraints: readonly FlowConstraint[]): SolveResult<Bisubstitution> {
  const ctx = new BiunificationContext();
  return ctx.solve(constraints);
}

/**
 * Check if one type is a subtype of another
 */
export function isSubtype(
  sub: PolarType,
  sup: PolarType,
  source: SourceLocation
): SolveResult<Bisubstitution> {
  return biunify([{
    kind: 'flow',
    positive: sub,
    negative: sup,
    source,
  }]);
}
