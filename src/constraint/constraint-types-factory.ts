/**
 * Constraint Type Factory - Creates constraint types with proper typing
 *
 * This factory creates types that can contain type variables,
 * unlike the main Types factory which creates concrete types.
 *
 * IMPORTANT: This factory intentionally uses type assertions because
 * ConstraintType extends Type to include TypeVar, but the underlying
 * Type interfaces expect concrete types. The constraint system handles
 * this by converting back to concrete types during reconstruction.
 */

import type { ConstraintType, TypeVar, AppType, RowType } from './types.js';

let idCounter = 0;

function nextId(): string {
  return `ct-${idCounter++}`;
}

// Helper to get ID from a constraint type
function getTypeId(t: ConstraintType): string {
  if (t.kind === 'typevar') return `var-${t.id}`;
  if (t.kind === 'scheme') return `scheme-${idCounter++}`;
  if (t.kind === 'app') return `app-${t.constructor}-${idCounter++}`;
  if (t.kind === 'row') return `row-${idCounter++}`;
  return (t as any).id ?? `unknown-${idCounter++}`;
}

/**
 * Constraint type factory
 */
export const CTypes = {
  // Primitives
  get undefined(): ConstraintType {
    return { kind: 'undefined', id: 'undefined' } as ConstraintType;
  },

  get null(): ConstraintType {
    return { kind: 'null', id: 'null' } as ConstraintType;
  },

  get boolean(): ConstraintType {
    return { kind: 'boolean', id: 'boolean' } as ConstraintType;
  },

  get number(): ConstraintType {
    return { kind: 'number', id: 'number' } as ConstraintType;
  },

  get string(): ConstraintType {
    return { kind: 'string', id: 'string' } as ConstraintType;
  },

  get never(): ConstraintType {
    return { kind: 'never', id: 'never' } as ConstraintType;
  },

  // Literal types
  booleanLiteral(value: boolean): ConstraintType {
    return { kind: 'boolean', id: `boolean-${value}`, value } as ConstraintType;
  },

  numberLiteral(value: number): ConstraintType {
    return { kind: 'number', id: `number-${value}`, value } as ConstraintType;
  },

  stringLiteral(value: string): ConstraintType {
    return { kind: 'string', id: `string-${value}`, value } as ConstraintType;
  },

  // Any
  any(reason?: string): ConstraintType {
    return { kind: 'any', id: nextId(), reason } as ConstraintType;
  },

  // Array - uses 'as any' to allow ConstraintType for elementType
  array(elementType: ConstraintType): ConstraintType {
    return {
      kind: 'array',
      id: nextId(),
      elementType: elementType as any,
    } as ConstraintType;
  },

  // Tuple
  tuple(elements: ConstraintType[]): ConstraintType {
    const elementType = elements.length > 0 ? this.union(elements) : this.never;
    return {
      kind: 'array',
      id: nextId(),
      elementType: elementType as any,
      tuple: elements as any,
      length: elements.length,
    } as ConstraintType;
  },

  // Function
  function(config: {
    params: Array<{
      name: string;
      type: ConstraintType;
      optional?: boolean;
      rest?: boolean;
    }>;
    returnType: ConstraintType;
    isAsync?: boolean;
    isGenerator?: boolean;
  }): ConstraintType {
    return {
      kind: 'function',
      id: nextId(),
      params: config.params.map(p => ({
        name: p.name,
        type: p.type as any,
        optional: p.optional ?? false,
        rest: p.rest ?? false,
      })),
      returnType: config.returnType as any,
      isAsync: config.isAsync ?? false,
      isGenerator: config.isGenerator ?? false,
      captures: new Map(),
    } as ConstraintType;
  },

  // Parameter helper
  param(
    name: string,
    type: ConstraintType,
    opts?: { optional?: boolean; rest?: boolean }
  ): { name: string; type: ConstraintType; optional: boolean; rest: boolean } {
    return {
      name,
      type,
      optional: opts?.optional ?? false,
      rest: opts?.rest ?? false,
    };
  },

  // Object
  object(config: {
    properties?: Map<string, { type: ConstraintType; writable?: boolean; enumerable?: boolean; configurable?: boolean }>;
  }): ConstraintType {
    const properties = new Map<string, any>();
    if (config.properties) {
      for (const [name, prop] of config.properties) {
        properties.set(name, {
          type: prop.type as any,
          writable: prop.writable ?? true,
          enumerable: prop.enumerable ?? true,
          configurable: prop.configurable ?? true,
        });
      }
    }
    return {
      kind: 'object',
      id: nextId(),
      properties,
      prototype: null,
      sealed: false,
      frozen: false,
    } as ConstraintType;
  },

  // Property helper
  property(type: ConstraintType): { type: ConstraintType; writable: boolean; enumerable: boolean; configurable: boolean } {
    return {
      type,
      writable: true,
      enumerable: true,
      configurable: true,
    };
  },

  // Union
  union(members: ConstraintType[]): ConstraintType {
    if (members.length === 0) return this.never;
    if (members.length === 1) return members[0]!;

    // Flatten nested unions
    const flattened: ConstraintType[] = [];
    for (const m of members) {
      if (m.kind === 'union') {
        flattened.push(...(m as any).members);
      } else {
        flattened.push(m);
      }
    }

    // Remove duplicates (simple check)
    const seen = new Set<string>();
    const unique: ConstraintType[] = [];
    for (const m of flattened) {
      const key = getTypeId(m);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(m);
      }
    }

    if (unique.length === 1) return unique[0]!;

    return {
      kind: 'union',
      id: nextId(),
      members: unique as any,
    } as ConstraintType;
  },

  // Intersection
  intersection(members: ConstraintType[]): ConstraintType {
    if (members.length === 0) return this.any();
    if (members.length === 1) return members[0]!;

    return {
      kind: 'intersection',
      id: nextId(),
      members: members as any,
    } as ConstraintType;
  },

  // Class
  class(config: {
    name: string;
    constructor: ConstraintType;
    instanceType: ConstraintType;
    staticProperties?: Map<string, { type: ConstraintType }>;
  }): ConstraintType {
    return {
      kind: 'class',
      id: nextId(),
      name: config.name,
      constructor: config.constructor as any,
      instanceType: config.instanceType as any,
      staticProperties: config.staticProperties ?? new Map(),
      superClass: null,
    } as ConstraintType;
  },

  // Promise
  promise(resolvedType: ConstraintType): ConstraintType {
    return {
      kind: 'promise',
      id: nextId(),
      resolvedType: resolvedType as any,
    } as ConstraintType;
  },

  // Type application
  app(constructor: string, args: ConstraintType[]): AppType {
    return {
      kind: 'app',
      constructor,
      args,
    };
  },

  // Row type
  row(fields: Map<string, ConstraintType>, rest: TypeVar | null = null): RowType {
    return {
      kind: 'row',
      fields,
      rest,
    };
  },
};
