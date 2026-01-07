/**
 * Type Variable Management - Creation and tracking of type variables
 *
 * Type variables are placeholders for unknown types that are determined
 * through constraint solving. This module provides:
 * - Fresh type variable generation with unique IDs
 * - Scope level tracking for let-polymorphism
 * - Type variable naming for debugging
 */

import type { TypeVar, TypeScheme, ConstraintType, ConstraintSource } from './types.js';

/**
 * Manages the creation and tracking of type variables.
 * Ensures each type variable has a unique ID and tracks scope levels
 * for proper generalization in let-polymorphism.
 */
export class TypeVarManager {
  /** Counter for generating unique IDs */
  private counter = 0;

  /** Current scope level (0 = top level) */
  private level = 0;

  /** Greek letters for naming type variables */
  private static readonly GREEK = [
    'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ',
    'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π',
    'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω'
  ];

  /**
   * Create a fresh type variable with a unique ID
   * @param prefix Optional prefix for the name (defaults to Greek letter)
   * @param source Optional source location for error reporting
   */
  fresh(prefix?: string, source?: ConstraintSource): TypeVar {
    const id = this.counter++;
    const name = prefix ?? this.generateName(id);

    return {
      kind: 'typevar',
      id,
      name,
      level: this.level,
      source,
    };
  }

  /**
   * Create a fresh type variable for a specific purpose
   */
  freshFor(purpose: 'return' | 'param' | 'element' | 'property' | 'result', source?: ConstraintSource): TypeVar {
    const prefixes: Record<string, string> = {
      return: 'ρ',      // rho for return
      param: 'π',       // pi for parameter
      element: 'ε',     // epsilon for element
      property: 'φ',    // phi for property
      result: 'τ',      // tau for result
    };
    return this.fresh(prefixes[purpose] ?? 'τ', source);
  }

  /**
   * Create multiple fresh type variables
   */
  freshN(count: number, prefix?: string): TypeVar[] {
    return Array.from({ length: count }, () => this.fresh(prefix));
  }

  /**
   * Generate a human-readable name for a type variable
   */
  private generateName(id: number): string {
    const greekIndex = id % TypeVarManager.GREEK.length;
    const subscript = Math.floor(id / TypeVarManager.GREEK.length);

    if (subscript === 0) {
      return TypeVarManager.GREEK[greekIndex]!;
    }
    return `${TypeVarManager.GREEK[greekIndex]}${this.toSubscript(subscript)}`;
  }

  /**
   * Convert a number to Unicode subscript characters
   */
  private toSubscript(n: number): string {
    const subscripts = '₀₁₂₃₄₅₆₇₈₉';
    return n.toString().split('').map(d => subscripts[parseInt(d)]!).join('');
  }

  /**
   * Enter a new scope (increases level)
   * Used for let-bindings to track which variables can be generalized
   */
  enterScope(): void {
    this.level++;
  }

  /**
   * Leave the current scope (decreases level)
   */
  leaveScope(): void {
    if (this.level > 0) {
      this.level--;
    }
  }

  /**
   * Get the current scope level
   */
  getLevel(): number {
    return this.level;
  }

  /**
   * Reset the manager (for testing)
   */
  reset(): void {
    this.counter = 0;
    this.level = 0;
  }

  /**
   * Get current counter value (for debugging)
   */
  getCount(): number {
    return this.counter;
  }
}

/**
 * Create a type scheme by generalizing free type variables
 * that are above the given level.
 *
 * This is the key operation for let-polymorphism:
 * - Variables at higher levels (introduced in the let binding) are generalized
 * - Variables at lower levels (from outer scopes) remain free
 *
 * @param type The type to generalize
 * @param level The current scope level
 * @param freeInEnv Type variables that are free in the environment
 */
export function generalize(
  type: ConstraintType,
  level: number,
  freeInEnv: Set<number>
): TypeScheme | ConstraintType {
  const quantified: TypeVar[] = [];

  function collectGeneralizable(t: ConstraintType): void {
    if (t.kind === 'typevar') {
      const tv = t as TypeVar;
      // Generalize if: level is higher AND not free in environment
      if (tv.level > level && !freeInEnv.has(tv.id)) {
        if (!quantified.some(v => v.id === tv.id)) {
          quantified.push(tv);
        }
      }
      return;
    }

    if (t.kind === 'function') {
      t.params.forEach(p => collectGeneralizable(p.type));
      collectGeneralizable(t.returnType);
      return;
    }

    if (t.kind === 'array') {
      collectGeneralizable(t.elementType);
      return;
    }

    if (t.kind === 'object') {
      for (const prop of t.properties.values()) {
        collectGeneralizable(prop.type);
      }
      return;
    }

    if (t.kind === 'union' || t.kind === 'intersection') {
      t.members.forEach(collectGeneralizable);
      return;
    }

    if (t.kind === 'app') {
      t.args.forEach(collectGeneralizable);
      return;
    }

    if (t.kind === 'row') {
      for (const fieldType of t.fields.values()) {
        collectGeneralizable(fieldType);
      }
      if (t.rest) {
        const restVar = t.rest;
        if (restVar.level > level && !freeInEnv.has(restVar.id)) {
          if (!quantified.some(v => v.id === restVar.id)) {
            quantified.push(restVar);
          }
        }
      }
      return;
    }
  }

  collectGeneralizable(type);

  // If no variables to generalize, return the type as-is
  if (quantified.length === 0) {
    return type;
  }

  // Sort by ID for deterministic output
  quantified.sort((a, b) => a.id - b.id);

  return {
    kind: 'scheme',
    quantified,
    body: type,
  };
}

/**
 * Instantiate a type scheme by replacing quantified variables with fresh ones.
 * This is used when a polymorphic value is used.
 *
 * @param scheme The type scheme to instantiate
 * @param manager Type variable manager for creating fresh variables
 */
export function instantiate(
  scheme: TypeScheme | ConstraintType,
  manager: TypeVarManager
): ConstraintType {
  if (scheme.kind !== 'scheme') {
    return scheme;
  }

  // Create fresh type variables for each quantified variable
  const freshVars = new Map<number, TypeVar>();
  for (const quantified of scheme.quantified) {
    freshVars.set(quantified.id, manager.fresh(quantified.name));
  }

  // Replace quantified variables with fresh ones
  return substituteTypeVars(scheme.body, freshVars);
}

/**
 * Substitute type variables in a type according to a mapping
 */
export function substituteTypeVars(
  type: ConstraintType,
  mapping: Map<number, TypeVar | ConstraintType>
): ConstraintType {
  function subst(t: ConstraintType): ConstraintType {
    if (t.kind === 'typevar') {
      const tv = t as TypeVar;
      const replacement = mapping.get(tv.id);
      return replacement ?? t;
    }

    if (t.kind === 'scheme') {
      // Don't substitute bound variables
      const boundIds = new Set(t.quantified.map(v => v.id));
      const filteredMapping = new Map<number, TypeVar | ConstraintType>();
      for (const [id, replacement] of mapping) {
        if (!boundIds.has(id)) {
          filteredMapping.set(id, replacement);
        }
      }
      return {
        ...t,
        body: substituteTypeVars(t.body, filteredMapping),
      };
    }

    if (t.kind === 'function') {
      return {
        ...t,
        params: t.params.map(p => ({
          ...p,
          type: subst(p.type as ConstraintType),
        })) as any,
        returnType: subst(t.returnType as ConstraintType) as any,
      } as ConstraintType;
    }

    if (t.kind === 'array') {
      return {
        ...t,
        elementType: subst(t.elementType as ConstraintType) as any,
        tuple: t.tuple?.map(elem => subst(elem as ConstraintType)) as any,
      } as ConstraintType;
    }

    if (t.kind === 'object') {
      const newProperties = new Map<string, any>();
      for (const [name, prop] of t.properties) {
        newProperties.set(name, {
          ...prop,
          type: subst(prop.type as ConstraintType),
        });
      }
      return {
        ...t,
        properties: newProperties,
      } as ConstraintType;
    }

    if (t.kind === 'union') {
      return {
        ...t,
        members: t.members.map(m => subst(m as ConstraintType)) as any,
      } as ConstraintType;
    }

    if (t.kind === 'intersection') {
      return {
        ...t,
        members: t.members.map(m => subst(m as ConstraintType)) as any,
      } as ConstraintType;
    }

    if (t.kind === 'app') {
      return {
        ...t,
        args: t.args.map(subst),
      };
    }

    if (t.kind === 'row') {
      const newFields = new Map<string, ConstraintType>();
      for (const [name, fieldType] of t.fields) {
        newFields.set(name, subst(fieldType));
      }
      return {
        ...t,
        fields: newFields,
        rest: t.rest ? (subst(t.rest) as TypeVar) : null,
      };
    }

    if (t.kind === 'promise') {
      return {
        ...t,
        resolvedType: subst(t.resolvedType as ConstraintType) as any,
      } as ConstraintType;
    }

    if (t.kind === 'iterator') {
      return {
        ...t,
        yieldType: subst(t.yieldType as ConstraintType) as any,
        returnType: subst(t.returnType as ConstraintType) as any,
        nextType: subst(t.nextType as ConstraintType) as any,
      } as ConstraintType;
    }

    // Primitive types - no substitution needed
    return t;
  }

  return subst(type);
}

/**
 * Check if two type variables are the same
 */
export function sameTypeVar(a: TypeVar, b: TypeVar): boolean {
  return a.id === b.id;
}

/**
 * Pretty-print a type variable
 */
export function formatTypeVar(tv: TypeVar): string {
  return tv.name;
}

/**
 * Pretty-print a type scheme
 */
export function formatTypeScheme(scheme: TypeScheme): string {
  if (scheme.quantified.length === 0) {
    return formatConstraintType(scheme.body);
  }

  const vars = scheme.quantified.map(formatTypeVar).join(', ');
  return `∀${vars}. ${formatConstraintType(scheme.body)}`;
}

/**
 * Format a constraint type for display
 * This is a simplified version - full formatting is in output/formatter.ts
 */
export function formatConstraintType(type: ConstraintType): string {
  if (type.kind === 'typevar') {
    return type.name;
  }

  if (type.kind === 'scheme') {
    return formatTypeScheme(type);
  }

  if (type.kind === 'app') {
    const args = type.args.map(formatConstraintType).join(', ');
    return `${type.constructor}<${args}>`;
  }

  if (type.kind === 'row') {
    const fields = Array.from(type.fields.entries())
      .map(([name, t]) => `${name}: ${formatConstraintType(t)}`)
      .join('; ');
    const rest = type.rest ? ` | ${type.rest.name}` : '';
    return `{ ${fields}${rest} }`;
  }

  // Delegate to base type formatting for concrete types
  return type.kind;
}
