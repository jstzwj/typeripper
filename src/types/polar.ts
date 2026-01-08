/**
 * Polar Types - Core type definitions for MLsub type system
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Key insight: Types have polarity based on their position:
 * - Positive (+): Output positions (covariant)
 * - Negative (-): Input positions (contravariant)
 *
 * Polar type syntax:
 *   τ⁺ ::= bool | τ⁻ → τ⁺ | {ℓ: τ⁺} | α | τ⁺ ⊔ τ⁺ | ⊥ | μα.τ⁺
 *   τ⁻ ::= bool | τ⁺ → τ⁻ | {ℓ: τ⁻} | α | τ⁻ ⊓ τ⁻ | ⊤ | μα.τ⁻
 */

// ============================================================================
// Polarity
// ============================================================================

/**
 * Type polarity: positive for outputs, negative for inputs
 */
export type Polarity = '+' | '-';

/**
 * Flip polarity (used for contravariant positions)
 */
export function flipPolarity(p: Polarity): Polarity {
  return p === '+' ? '-' : '+';
}

// ============================================================================
// Type Variable
// ============================================================================

let nextTypeVarId = 0;

/**
 * Reset type variable counter (for testing)
 */
export function resetTypeVarCounter(): void {
  nextTypeVarId = 0;
}

/**
 * Generate a fresh type variable ID
 */
export function freshTypeVarId(): number {
  return nextTypeVarId++;
}

/**
 * Type variable with unique ID
 */
export interface TypeVar {
  readonly kind: 'var';
  readonly id: number;
  readonly name: string;
  /** Level for let-polymorphism generalization */
  readonly level: number;
}

/**
 * Create a fresh type variable
 */
export function freshTypeVar(name?: string, level: number = 0): TypeVar {
  const id = freshTypeVarId();
  return {
    kind: 'var',
    id,
    name: name ?? `τ${id}`,
    level,
  };
}

// ============================================================================
// Polar Types
// ============================================================================

/**
 * Base interface for all polar types
 */
interface PolarTypeBase {
  readonly kind: string;
}

/**
 * Primitive types: bool, number, string, null, undefined, symbol, bigint
 */
export interface PrimitiveType extends PolarTypeBase {
  readonly kind: 'primitive';
  readonly name: 'boolean' | 'number' | 'string' | 'null' | 'undefined' | 'symbol' | 'bigint';
  /** Optional literal value for literal types */
  readonly value?: boolean | number | string | bigint;
}

/**
 * Function type: τ⁻ → τ⁺
 * Domain has opposite polarity (contravariant)
 * Codomain has same polarity (covariant)
 *
 * Functions in JavaScript are also objects with properties (e.g., prototype, name, length).
 * The properties field represents these object properties.
 */
export interface FunctionType extends PolarTypeBase {
  readonly kind: 'function';
  /** Parameter types (contravariant) */
  readonly params: readonly ParamType[];
  /** Return type (covariant) */
  readonly returnType: PolarType;
  /** Is this an async function? */
  readonly isAsync: boolean;
  /** Is this a generator function? */
  readonly isGenerator: boolean;
  /** Properties of the function object (e.g., prototype) */
  readonly properties?: ReadonlyMap<string, FieldType>;
}

/**
 * Parameter in a function type
 */
export interface ParamType {
  readonly name: string;
  readonly type: PolarType;
  readonly optional: boolean;
  readonly rest: boolean;
}

/**
 * Record type: {ℓ₁: τ₁, ℓ₂: τ₂, ...}
 * All fields have the same polarity as the record
 *
 * MLsub uses lattice operations (⊔/⊓) for record extensibility instead of row variables:
 * - Join {f} ⊔ {g} = {h} where dom(h) = dom(f) ∩ dom(g)
 * - Meet {f} ⊓ {g} = {h} where dom(h) = dom(f) ∪ dom(g)
 */
export interface RecordType extends PolarTypeBase {
  readonly kind: 'record';
  readonly fields: ReadonlyMap<string, FieldType>;
}

/**
 * Field in a record type
 */
export interface FieldType {
  readonly type: PolarType;
  readonly optional: boolean;
  readonly readonly: boolean;
}

/**
 * Array type: Array<τ>
 * Element type has same polarity (covariant for reads)
 *
 * Arrays in JavaScript are also objects with methods (e.g., push, pop, map).
 * The properties field represents these methods and properties.
 */
export interface ArrayType extends PolarTypeBase {
  readonly kind: 'array';
  readonly elementType: PolarType;
  /** Tuple types have fixed length */
  readonly tuple?: readonly PolarType[];
  /** Properties of the array object (e.g., push, pop, length) */
  readonly properties?: ReadonlyMap<string, FieldType>;
}

/**
 * Union type: τ⁺ ⊔ τ⁺ (only valid at positive polarity)
 * Represents "one of these types" at output positions
 */
export interface UnionType extends PolarTypeBase {
  readonly kind: 'union';
  readonly members: readonly PolarType[];
}

/**
 * Intersection type: τ⁻ ⊓ τ⁻ (only valid at negative polarity)
 * Represents "all of these types" at input positions
 */
export interface IntersectionType extends PolarTypeBase {
  readonly kind: 'intersection';
  readonly members: readonly PolarType[];
}

/**
 * Top type: ⊤ (only at negative polarity)
 * Accepts any input - the supertype of all types
 */
export interface TopType extends PolarTypeBase {
  readonly kind: 'top';
}

/**
 * Bottom type: ⊥ (only at positive polarity)
 * Produces nothing - the subtype of all types
 */
export interface BottomType extends PolarTypeBase {
  readonly kind: 'bottom';
}

/**
 * Recursive type: μα.τ
 * The bound variable must be covariant and guarded
 */
export interface RecursiveType extends PolarTypeBase {
  readonly kind: 'recursive';
  /** The bound type variable */
  readonly binder: TypeVar;
  /** The body type */
  readonly body: PolarType;
}

/**
 * Promise type: Promise<τ>
 * Resolved type has same polarity (covariant)
 */
export interface PromiseType extends PolarTypeBase {
  readonly kind: 'promise';
  readonly resolvedType: PolarType;
}

/**
 * Class type (for constructor and instance relationship)
 */
export interface ClassType extends PolarTypeBase {
  readonly kind: 'class';
  readonly name: string;
  /** Constructor function type */
  readonly constructorType: FunctionType;
  /** Instance type (what `new Class()` produces) */
  readonly instanceType: RecordType;
  /** Static properties */
  readonly staticType: RecordType;
  /** Parent class (for extends) */
  readonly superClass: ClassType | null;
}

/**
 * Any type - escape hatch for gradual typing
 */
export interface AnyType extends PolarTypeBase {
  readonly kind: 'any';
  /** Reason why we fell back to any */
  readonly reason?: string;
}

/**
 * Never type - represents unreachable code
 */
export interface NeverType extends PolarTypeBase {
  readonly kind: 'never';
}

/**
 * Unknown type - represents unresolved types during inference
 */
export interface UnknownType extends PolarTypeBase {
  readonly kind: 'unknown';
}

// ============================================================================
// Polar Type Union
// ============================================================================

/**
 * All polar types
 */
export type PolarType =
  | TypeVar
  | PrimitiveType
  | FunctionType
  | RecordType
  | ArrayType
  | UnionType
  | IntersectionType
  | TopType
  | BottomType
  | RecursiveType
  | PromiseType
  | ClassType
  | AnyType
  | NeverType
  | UnknownType;

// ============================================================================
// Type Predicates
// ============================================================================

export function isTypeVar(t: PolarType): t is TypeVar {
  return t.kind === 'var';
}

export function isPrimitive(t: PolarType): t is PrimitiveType {
  return t.kind === 'primitive';
}

export function isFunction(t: PolarType): t is FunctionType {
  return t.kind === 'function';
}

export function isRecord(t: PolarType): t is RecordType {
  return t.kind === 'record';
}

export function isArray(t: PolarType): t is ArrayType {
  return t.kind === 'array';
}

export function isUnion(t: PolarType): t is UnionType {
  return t.kind === 'union';
}

export function isIntersection(t: PolarType): t is IntersectionType {
  return t.kind === 'intersection';
}

export function isTop(t: PolarType): t is TopType {
  return t.kind === 'top';
}

export function isBottom(t: PolarType): t is BottomType {
  return t.kind === 'bottom';
}

export function isRecursive(t: PolarType): t is RecursiveType {
  return t.kind === 'recursive';
}

export function isPromise(t: PolarType): t is PromiseType {
  return t.kind === 'promise';
}

export function isClass(t: PolarType): t is ClassType {
  return t.kind === 'class';
}

export function isAny(t: PolarType): t is AnyType {
  return t.kind === 'any';
}

export function isNever(t: PolarType): t is NeverType {
  return t.kind === 'never';
}

// ============================================================================
// Free Variables
// ============================================================================

/**
 * Get all free type variables in a type
 */
export function freeVars(type: PolarType): Set<number> {
  const result = new Set<number>();

  function collect(t: PolarType, bound: Set<number>): void {
    switch (t.kind) {
      case 'var':
        if (!bound.has(t.id)) {
          result.add(t.id);
        }
        break;

      case 'function':
        for (const param of t.params) {
          collect(param.type, bound);
        }
        collect(t.returnType, bound);
        break;

      case 'record':
        for (const field of t.fields.values()) {
          collect(field.type, bound);
        }
        break;

      case 'array':
        collect(t.elementType, bound);
        if (t.tuple) {
          for (const elem of t.tuple) {
            collect(elem, bound);
          }
        }
        break;

      case 'union':
      case 'intersection':
        for (const member of t.members) {
          collect(member, bound);
        }
        break;

      case 'recursive': {
        const newBound = new Set(bound);
        newBound.add(t.binder.id);
        collect(t.body, newBound);
        break;
      }

      case 'promise':
        collect(t.resolvedType, bound);
        break;

      case 'class':
        collect(t.constructorType, bound);
        collect(t.instanceType, bound);
        collect(t.staticType, bound);
        if (t.superClass) {
          collect(t.superClass, bound);
        }
        break;

      // No free variables in these
      case 'primitive':
      case 'top':
      case 'bottom':
      case 'any':
      case 'never':
      case 'unknown':
        break;
    }
  }

  collect(type, new Set());
  return result;
}

/**
 * Check if a type variable occurs in a type (for occurs check)
 */
export function occursIn(varId: number, type: PolarType): boolean {
  return freeVars(type).has(varId);
}

// ============================================================================
// Type Substitution
// ============================================================================

/**
 * Substitute a type variable with another type
 */
export function substitute(
  type: PolarType,
  varId: number,
  replacement: PolarType
): PolarType {
  function subst(t: PolarType): PolarType {
    switch (t.kind) {
      case 'var':
        return t.id === varId ? replacement : t;

      case 'function':
        return {
          ...t,
          params: t.params.map(p => ({ ...p, type: subst(p.type) })),
          returnType: subst(t.returnType),
        };

      case 'record': {
        const newFields = new Map<string, FieldType>();
        for (const [name, field] of t.fields) {
          newFields.set(name, { ...field, type: subst(field.type) });
        }
        return {
          ...t,
          fields: newFields,
        };
      }

      case 'array':
        return {
          ...t,
          elementType: subst(t.elementType),
          tuple: t.tuple?.map(subst),
        };

      case 'union':
      case 'intersection':
        return {
          ...t,
          members: t.members.map(subst),
        };

      case 'recursive':
        // Don't substitute bound variables
        if (t.binder.id === varId) return t;
        return {
          ...t,
          body: subst(t.body),
        };

      case 'promise':
        return {
          ...t,
          resolvedType: subst(t.resolvedType),
        };

      case 'class':
        return {
          ...t,
          constructorType: subst(t.constructorType) as FunctionType,
          instanceType: subst(t.instanceType) as RecordType,
          staticType: subst(t.staticType) as RecordType,
          superClass: t.superClass ? subst(t.superClass) as ClassType : null,
        };

      default:
        return t;
    }
  }

  return subst(type);
}

// ============================================================================
// Type Equality
// ============================================================================

/**
 * Check structural equality of two types
 */
export function typeEquals(a: PolarType, b: PolarType): boolean {
  if (a.kind !== b.kind) return false;

  switch (a.kind) {
    case 'var':
      return a.id === (b as TypeVar).id;

    case 'primitive': {
      const bp = b as PrimitiveType;
      return a.name === bp.name && a.value === bp.value;
    }

    case 'function': {
      const bf = b as FunctionType;
      if (a.params.length !== bf.params.length) return false;
      if (a.isAsync !== bf.isAsync || a.isGenerator !== bf.isGenerator) return false;
      for (let i = 0; i < a.params.length; i++) {
        if (!typeEquals(a.params[i]!.type, bf.params[i]!.type)) return false;
      }
      return typeEquals(a.returnType, bf.returnType);
    }

    case 'record': {
      const br = b as RecordType;
      if (a.fields.size !== br.fields.size) return false;
      for (const [name, field] of a.fields) {
        const bField = br.fields.get(name);
        if (!bField || !typeEquals(field.type, bField.type)) return false;
      }
      return true;
    }

    case 'array': {
      const ba = b as ArrayType;
      if (!typeEquals(a.elementType, ba.elementType)) return false;
      if (a.tuple && ba.tuple) {
        if (a.tuple.length !== ba.tuple.length) return false;
        return a.tuple.every((t, i) => typeEquals(t, ba.tuple![i]!));
      }
      return !a.tuple && !ba.tuple;
    }

    case 'union':
    case 'intersection': {
      const bu = b as UnionType | IntersectionType;
      if (a.members.length !== bu.members.length) return false;
      // Order-independent comparison
      return a.members.every(am =>
        bu.members.some(bm => typeEquals(am, bm))
      );
    }

    case 'recursive': {
      const br = b as RecursiveType;
      // Alpha-equivalence: rename bound variables
      const freshVar = freshTypeVar();
      const aBody = substitute(a.body, a.binder.id, freshVar);
      const bBody = substitute(br.body, br.binder.id, freshVar);
      return typeEquals(aBody, bBody);
    }

    case 'promise':
      return typeEquals(a.resolvedType, (b as PromiseType).resolvedType);

    case 'class': {
      const bc = b as ClassType;
      return a.name === bc.name &&
        typeEquals(a.instanceType, bc.instanceType);
    }

    case 'top':
    case 'bottom':
    case 'any':
    case 'never':
    case 'unknown':
      return true;

    default:
      return false;
  }
}

// ============================================================================
// Type to String Conversion
// ============================================================================

/**
 * Check if a record type represents a Date instance
 */
function isDateType(type: RecordType): boolean {
  // Date has these characteristic methods
  const dateSignature = ['getTime', 'getFullYear', 'getMonth', 'toISOString', 'valueOf'];
  return dateSignature.every(method => type.fields.has(method));
}

/**
 * Convert a polar type to a human-readable string representation
 */
export function typeToString(type: PolarType, seen: Set<number> = new Set()): string {
  switch (type.kind) {
    case 'primitive':
      if (type.value !== undefined) {
        // Literal type
        if (typeof type.value === 'string') {
          return `"${type.value}"`;
        }
        return String(type.value);
      }
      return type.name;

    case 'var':
      return type.name;

    case 'function': {
      const params = type.params.map(p => {
        const opt = p.optional ? '?' : '';
        const rest = p.rest ? '...' : '';
        return `${rest}${p.name}${opt}: ${typeToString(p.type, seen)}`;
      }).join(', ');
      const ret = typeToString(type.returnType, seen);
      const async = type.isAsync ? 'async ' : '';
      const gen = type.isGenerator ? '*' : '';
      return `${async}${gen}(${params}) => ${ret}`;
    }

    case 'record': {
      if (type.fields.size === 0) {
        return '{}';
      }

      // Check if this is a known built-in type (like Date)
      // by checking for characteristic fields
      if (isDateType(type)) {
        return 'Date';
      }

      const fields = Array.from(type.fields.entries()).map(([name, field]) => {
        const opt = field.optional ? '?' : '';
        const ro = field.readonly ? 'readonly ' : '';
        return `${ro}${name}${opt}: ${typeToString(field.type, seen)}`;
      });
      return `{ ${fields.join(', ')} }`;
    }

    case 'array':
      if (type.tuple) {
        const elements = type.tuple.map(t => typeToString(t, seen));
        return `[${elements.join(', ')}]`;
      }
      return `${typeToString(type.elementType, seen)}[]`;

    case 'union': {
      if (type.members.length === 0) return 'never';
      return type.members.map(m => typeToString(m, seen)).join(' | ');
    }

    case 'intersection': {
      if (type.members.length === 0) return 'unknown';
      return type.members.map(m => typeToString(m, seen)).join(' & ');
    }

    case 'top':
      return '⊤';

    case 'bottom':
      return '⊥';

    case 'recursive': {
      // Prevent infinite recursion
      if (seen.has(type.binder.id)) {
        return type.binder.name;
      }
      const newSeen = new Set(seen);
      newSeen.add(type.binder.id);
      return `μ${type.binder.name}.${typeToString(type.body, newSeen)}`;
    }

    case 'promise':
      return `Promise<${typeToString(type.resolvedType, seen)}>`;

    case 'class':
      return `class ${type.name}`;

    case 'any':
      return 'any';

    case 'never':
      return 'never';

    case 'unknown':
      return 'unknown';

    default:
      return 'unknown';
  }
}
