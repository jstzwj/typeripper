/**
 * Substitution - Mapping from type variables to their solved types
 *
 * A substitution is the result of unification/constraint solving.
 * It maps type variable IDs to their resolved types.
 * Substitutions can be composed and applied to types.
 */

import type { ConstraintType, TypeVar, Substitution as SubstitutionData } from './types.js';
import { substituteTypeVars } from './type-variable.js';

/**
 * Mutable substitution builder for constraint solving.
 * Once solving is complete, call toImmutable() to get the final result.
 */
export class SubstitutionBuilder {
  private mapping: Map<number, ConstraintType> = new Map();

  /**
   * Create an empty substitution
   */
  static empty(): SubstitutionBuilder {
    return new SubstitutionBuilder();
  }

  /**
   * Create a substitution from an existing mapping
   */
  static from(mapping: Map<number, ConstraintType>): SubstitutionBuilder {
    const builder = new SubstitutionBuilder();
    for (const [id, type] of mapping) {
      builder.mapping.set(id, type);
    }
    return builder;
  }

  /**
   * Create a singleton substitution { tv → type }
   */
  static singleton(tv: TypeVar, type: ConstraintType): SubstitutionBuilder {
    const builder = new SubstitutionBuilder();
    builder.mapping.set(tv.id, type);
    return builder;
  }

  /**
   * Bind a type variable to a type.
   * This applies the current substitution to the type before binding.
   */
  bind(tv: TypeVar, type: ConstraintType): void {
    // Apply current substitution to the type
    const resolvedType = this.apply(type);
    this.mapping.set(tv.id, resolvedType);

    // Update existing mappings to use the new binding
    // This maintains the substitution in "solved form"
    for (const [id, existingType] of this.mapping) {
      if (id !== tv.id) {
        this.mapping.set(id, this.substituteOne(existingType, tv.id, resolvedType));
      }
    }
  }

  /**
   * Substitute a single type variable in a type
   */
  private substituteOne(type: ConstraintType, varId: number, replacement: ConstraintType): ConstraintType {
    const mapping = new Map<number, ConstraintType>();
    mapping.set(varId, replacement);
    return substituteTypeVars(type, mapping);
  }

  /**
   * Apply this substitution to a type, resolving all type variables
   */
  apply(type: ConstraintType): ConstraintType {
    return this.applyInternal(type, new Set());
  }

  /**
   * Internal apply with cycle detection
   */
  private applyInternal(type: ConstraintType, seen: Set<number>): ConstraintType {
    if (type.kind === 'typevar') {
      const tv = type as TypeVar;
      // Check for cycles
      if (seen.has(tv.id)) {
        // Cyclic type - return the variable as-is
        return type;
      }

      const resolved = this.mapping.get(tv.id);
      if (resolved) {
        // Recursively apply to handle chains of substitutions
        return this.applyInternal(resolved, new Set([...seen, tv.id]));
      }
      return type;
    }

    if (type.kind === 'scheme') {
      // Don't substitute bound variables
      const boundIds = new Set(type.quantified.map(v => v.id));
      return {
        ...type,
        body: this.applyWithExclusions(type.body, boundIds),
      };
    }

    if (type.kind === 'function') {
      return {
        ...type,
        params: type.params.map(p => ({
          ...p,
          type: this.applyInternal(p.type as ConstraintType, seen),
        })) as any,
        returnType: this.applyInternal(type.returnType as ConstraintType, seen) as any,
      } as ConstraintType;
    }

    if (type.kind === 'array') {
      return {
        ...type,
        elementType: this.applyInternal(type.elementType as ConstraintType, seen) as any,
        tuple: type.tuple?.map(t => this.applyInternal(t as ConstraintType, seen)) as any,
      } as ConstraintType;
    }

    if (type.kind === 'object') {
      const newProperties = new Map<string, any>();
      for (const [name, prop] of type.properties) {
        newProperties.set(name, {
          ...prop,
          type: this.applyInternal(prop.type as ConstraintType, seen),
        });
      }
      return {
        ...type,
        properties: newProperties,
      } as ConstraintType;
    }

    if (type.kind === 'union') {
      return {
        ...type,
        members: type.members.map(m => this.applyInternal(m as ConstraintType, seen)) as any,
      } as ConstraintType;
    }

    if (type.kind === 'intersection') {
      return {
        ...type,
        members: type.members.map(m => this.applyInternal(m as ConstraintType, seen)) as any,
      } as ConstraintType;
    }

    if (type.kind === 'app') {
      return {
        ...type,
        args: type.args.map(a => this.applyInternal(a, seen)),
      };
    }

    if (type.kind === 'row') {
      const newFields = new Map<string, ConstraintType>();
      for (const [name, fieldType] of type.fields) {
        newFields.set(name, this.applyInternal(fieldType, seen));
      }
      const newRest = type.rest
        ? (this.applyInternal(type.rest, seen) as TypeVar)
        : null;
      return {
        ...type,
        fields: newFields,
        rest: newRest?.kind === 'typevar' ? newRest : null,
      };
    }

    if (type.kind === 'promise') {
      return {
        ...type,
        resolvedType: this.applyInternal(type.resolvedType as ConstraintType, seen) as any,
      } as ConstraintType;
    }

    if (type.kind === 'iterator') {
      return {
        ...type,
        yieldType: this.applyInternal(type.yieldType as ConstraintType, seen) as any,
        returnType: this.applyInternal(type.returnType as ConstraintType, seen) as any,
        nextType: this.applyInternal(type.nextType as ConstraintType, seen) as any,
      } as ConstraintType;
    }

    // Primitive types - no substitution needed
    return type;
  }

  /**
   * Apply substitution but exclude certain variable IDs
   */
  private applyWithExclusions(type: ConstraintType, exclude: Set<number>): ConstraintType {
    if (type.kind === 'typevar') {
      const tv = type as TypeVar;
      if (exclude.has(tv.id)) {
        return type;
      }
      const resolved = this.mapping.get(tv.id);
      if (resolved) {
        return this.applyWithExclusions(resolved, exclude);
      }
      return type;
    }

    // For compound types, recursively apply
    // (simplified - full implementation would check all cases)
    return this.apply(type);
  }

  /**
   * Compose this substitution with another.
   * The result is: apply(other) then apply(this)
   * i.e., (this ∘ other)(τ) = this(other(τ))
   */
  compose(other: SubstitutionBuilder): SubstitutionBuilder {
    const result = new SubstitutionBuilder();

    // First, apply this substitution to all mappings in other
    for (const [id, type] of other.mapping) {
      result.mapping.set(id, this.apply(type));
    }

    // Then add our own mappings (overwriting if necessary)
    for (const [id, type] of this.mapping) {
      if (!result.mapping.has(id)) {
        result.mapping.set(id, type);
      }
    }

    return result;
  }

  /**
   * Check if a type variable is bound in this substitution
   */
  has(tv: TypeVar): boolean {
    return this.mapping.has(tv.id);
  }

  /**
   * Get the binding for a type variable (if any)
   */
  get(tv: TypeVar): ConstraintType | undefined {
    return this.mapping.get(tv.id);
  }

  /**
   * Get the size of the substitution
   */
  get size(): number {
    return this.mapping.size;
  }

  /**
   * Check if this substitution is empty
   */
  isEmpty(): boolean {
    return this.mapping.size === 0;
  }

  /**
   * Get all bound type variable IDs
   */
  boundIds(): Set<number> {
    return new Set(this.mapping.keys());
  }

  /**
   * Convert to an immutable substitution data structure
   */
  toImmutable(): SubstitutionData {
    return {
      mapping: new Map(this.mapping),
    };
  }

  /**
   * Create a copy of this substitution
   */
  clone(): SubstitutionBuilder {
    return SubstitutionBuilder.from(this.mapping);
  }

  /**
   * Debug string representation
   */
  toString(): string {
    if (this.mapping.size === 0) {
      return '{}';
    }

    const entries = Array.from(this.mapping.entries())
      .map(([id, type]) => `τ${id} ↦ ${formatTypeForDebug(type)}`)
      .join(', ');

    return `{ ${entries} }`;
  }
}

/**
 * Apply an immutable substitution to a type
 */
export function applySubstitution(subst: SubstitutionData, type: ConstraintType): ConstraintType {
  const builder = SubstitutionBuilder.from(subst.mapping as Map<number, ConstraintType>);
  return builder.apply(type);
}

/**
 * Compose two immutable substitutions
 */
export function composeSubstitutions(s1: SubstitutionData, s2: SubstitutionData): SubstitutionData {
  const b1 = SubstitutionBuilder.from(s1.mapping as Map<number, ConstraintType>);
  const b2 = SubstitutionBuilder.from(s2.mapping as Map<number, ConstraintType>);
  return b1.compose(b2).toImmutable();
}

/**
 * Create an empty immutable substitution
 */
export function emptySubstitution(): SubstitutionData {
  return { mapping: new Map() };
}

/**
 * Create a singleton substitution
 */
export function singletonSubstitution(tv: TypeVar, type: ConstraintType): SubstitutionData {
  return SubstitutionBuilder.singleton(tv, type).toImmutable();
}

/**
 * Simple type formatting for debug output
 */
function formatTypeForDebug(type: ConstraintType): string {
  if (type.kind === 'typevar') {
    return `τ${type.id}`;
  }
  if (type.kind === 'number') {
    return type.value !== undefined ? String(type.value) : 'number';
  }
  if (type.kind === 'string') {
    return type.value !== undefined ? `"${type.value}"` : 'string';
  }
  if (type.kind === 'boolean') {
    return type.value !== undefined ? String(type.value) : 'boolean';
  }
  if (type.kind === 'array') {
    return `Array<${formatTypeForDebug(type.elementType)}>`;
  }
  if (type.kind === 'function') {
    const params = type.params.map(p => formatTypeForDebug(p.type)).join(', ');
    return `(${params}) => ${formatTypeForDebug(type.returnType)}`;
  }
  if (type.kind === 'union') {
    return type.members.map(formatTypeForDebug).join(' | ');
  }
  if (type.kind === 'object') {
    const props = Array.from(type.properties.entries())
      .map(([k, v]) => `${k}: ${formatTypeForDebug(v.type)}`)
      .join('; ');
    return `{ ${props} }`;
  }
  return type.kind;
}
