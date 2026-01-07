/**
 * Type Automaton States - State representation for type automata
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 5.1
 *
 * A type automaton is a variant of an NFA where:
 * - States have polarity (+ or -)
 * - States have head constructors (type constructors at that position)
 * - Transitions are labeled with field accessors (d, r, ℓ)
 * - Flow edges connect type variable occurrences
 */

import type { Polarity } from '../types/index.js';

// ============================================================================
// Head Constructors
// ============================================================================

/**
 * Head constructors label the "type" of each state
 *
 * From the paper: H(q) can contain type variables, ⟨→⟩, ⟨b⟩, ⟨L⟩
 */
export type HeadConstructor =
  | TypeVarHead
  | FunctionHead
  | PrimitiveHead
  | RecordHead
  | ArrayHead
  | PromiseHead
  | ClassHead
  | TopHead
  | BottomHead
  | AnyHead
  ;

/**
 * Type variable head: marks this state as representing a type variable
 */
export interface TypeVarHead {
  readonly kind: 'var';
  readonly id: number;
  readonly name: string;
}

/**
 * Function type head: ⟨→⟩
 */
export interface FunctionHead {
  readonly kind: 'arrow';
  readonly isAsync: boolean;
  readonly isGenerator: boolean;
}

/**
 * Primitive type head: ⟨boolean⟩, ⟨number⟩, ⟨string⟩, etc.
 */
export interface PrimitiveHead {
  readonly kind: 'primitive';
  readonly name: 'boolean' | 'number' | 'string' | 'null' | 'undefined' | 'symbol' | 'bigint';
  readonly value?: boolean | number | string | bigint;
}

/**
 * Record type head: ⟨{ℓ₁, ℓ₂, ...}⟩
 * The set of labels indicates required fields
 */
export interface RecordHead {
  readonly kind: 'record';
  readonly labels: ReadonlySet<string>;
  readonly hasRest: boolean;
}

/**
 * Array type head
 */
export interface ArrayHead {
  readonly kind: 'array';
  readonly isTuple: boolean;
  readonly tupleLength?: number;
}

/**
 * Promise type head
 */
export interface PromiseHead {
  readonly kind: 'promise';
}

/**
 * Class type head
 */
export interface ClassHead {
  readonly kind: 'class';
  readonly name: string;
}

/**
 * Top type head (⊤)
 */
export interface TopHead {
  readonly kind: 'top';
}

/**
 * Bottom type head (⊥)
 */
export interface BottomHead {
  readonly kind: 'bottom';
}

/**
 * Any type head (escape hatch)
 */
export interface AnyHead {
  readonly kind: 'any';
}

// ============================================================================
// Transition Labels
// ============================================================================

/**
 * Labels on automaton transitions
 *
 * From the paper: Σ_F contains d (domain), r (range), and ℓ for each label
 */
export type TransitionLabel =
  | DomainLabel
  | RangeLabel
  | FieldLabel
  | ElementLabel
  | ResolvedLabel
  ;

/**
 * Domain transition: d (for function parameter)
 * Connects states of DIFFERENT polarity (contravariant)
 */
export interface DomainLabel {
  readonly kind: 'd';
  readonly paramIndex?: number;  // For multiple parameters
}

/**
 * Range transition: r (for function return)
 * Connects states of SAME polarity (covariant)
 */
export interface RangeLabel {
  readonly kind: 'r';
}

/**
 * Field transition: ℓ (for record field)
 * Connects states of SAME polarity (covariant)
 */
export interface FieldLabel {
  readonly kind: 'field';
  readonly name: string;
}

/**
 * Element transition: for array elements
 * Connects states of SAME polarity (covariant)
 */
export interface ElementLabel {
  readonly kind: 'element';
  readonly index?: number;  // For tuple positions
}

/**
 * Resolved transition: for Promise.resolve
 * Connects states of SAME polarity (covariant)
 */
export interface ResolvedLabel {
  readonly kind: 'resolved';
}

/**
 * Check if a transition is contravariant
 */
export function isContravariant(label: TransitionLabel): boolean {
  return label.kind === 'd';
}

/**
 * Create a string key for a transition label
 */
export function labelKey(label: TransitionLabel): string {
  switch (label.kind) {
    case 'd':
      return label.paramIndex !== undefined ? `d${label.paramIndex}` : 'd';
    case 'r':
      return 'r';
    case 'field':
      return `f:${label.name}`;
    case 'element':
      return label.index !== undefined ? `e${label.index}` : 'e';
    case 'resolved':
      return 'res';
  }
}

// ============================================================================
// Automaton State
// ============================================================================

/**
 * State in a type automaton
 */
export interface AutomatonState {
  /** Unique state identifier */
  readonly id: number;

  /** Polarity: + for output positions, - for input positions */
  readonly polarity: Polarity;

  /**
   * Head constructors at this state
   * Multiple heads represent union (positive) or intersection (negative)
   */
  readonly heads: Set<HeadConstructor>;

  /**
   * Transitions from this state
   * Maps transition labels to target state IDs
   */
  readonly transitions: Map<string, number>;

  /**
   * Flow edges TO this state (from negative states)
   * Only meaningful when this state is positive
   */
  readonly flowTo: Set<number>;

  /**
   * Flow edges FROM this state (to positive states)
   * Only meaningful when this state is negative
   */
  readonly flowFrom: Set<number>;
}

/**
 * Create a fresh automaton state
 */
let nextStateId = 0;

export function resetStateCounter(): void {
  nextStateId = 0;
}

export function freshStateId(): number {
  return nextStateId++;
}

export function createState(polarity: Polarity): AutomatonState {
  return {
    id: freshStateId(),
    polarity,
    heads: new Set(),
    transitions: new Map(),
    flowTo: new Set(),
    flowFrom: new Set(),
  };
}

/**
 * Add a head constructor to a state
 */
export function addHead(state: AutomatonState, head: HeadConstructor): AutomatonState {
  const newHeads = new Set(state.heads);
  newHeads.add(head);
  return { ...state, heads: newHeads };
}

/**
 * Add a transition from a state
 */
export function addTransition(
  state: AutomatonState,
  label: TransitionLabel,
  targetId: number
): AutomatonState {
  const key = labelKey(label);
  const newTransitions = new Map(state.transitions);
  newTransitions.set(key, targetId);
  return { ...state, transitions: newTransitions };
}

/**
 * Add a flow edge to a positive state
 */
export function addFlowTo(state: AutomatonState, fromId: number): AutomatonState {
  if (state.polarity !== '+') {
    throw new Error('flowTo only applies to positive states');
  }
  const newFlowTo = new Set(state.flowTo);
  newFlowTo.add(fromId);
  return { ...state, flowTo: newFlowTo };
}

/**
 * Add a flow edge from a negative state
 */
export function addFlowFrom(state: AutomatonState, toId: number): AutomatonState {
  if (state.polarity !== '-') {
    throw new Error('flowFrom only applies to negative states');
  }
  const newFlowFrom = new Set(state.flowFrom);
  newFlowFrom.add(toId);
  return { ...state, flowFrom: newFlowFrom };
}

// ============================================================================
// Head Compatibility
// ============================================================================

/**
 * Check if two head constructors are compatible
 *
 * Used in biunification to check if constraint is satisfiable
 */
export function headsCompatible(h1: HeadConstructor, h2: HeadConstructor): boolean {
  // Same kind is required for most heads
  if (h1.kind !== h2.kind) {
    // Special cases
    if (h1.kind === 'any' || h2.kind === 'any') return true;
    if (h1.kind === 'top' || h2.kind === 'bottom') return true;
    if (h1.kind === 'bottom' || h2.kind === 'top') return true;
    return false;
  }

  switch (h1.kind) {
    case 'var':
      return (h2 as TypeVarHead).id === h1.id;

    case 'primitive': {
      const h2p = h2 as PrimitiveHead;
      if (h1.name !== h2p.name) return false;
      // Literal compatibility
      if (h1.value !== undefined && h2p.value !== undefined) {
        return h1.value === h2p.value;
      }
      return true;
    }

    case 'record': {
      const h2r = h2 as RecordHead;
      // For records, we check label compatibility in biunification
      return true;
    }

    case 'class': {
      return h1.name === (h2 as ClassHead).name;
    }

    default:
      return true;
  }
}

/**
 * Check if a set of heads is compatible with another set
 */
export function headSetsCompatible(
  posHeads: Set<HeadConstructor>,
  negHeads: Set<HeadConstructor>
): boolean {
  // Empty sets are always compatible
  if (posHeads.size === 0 || negHeads.size === 0) return true;

  // For positive: at least one head must be compatible with each negative head
  // For negative: all heads must be compatible with at least one positive head
  for (const neg of negHeads) {
    let foundCompatible = false;
    for (const pos of posHeads) {
      if (headsCompatible(pos, neg)) {
        foundCompatible = true;
        break;
      }
    }
    if (!foundCompatible) return false;
  }

  return true;
}

// ============================================================================
// Head Constructor Factories
// ============================================================================

export function varHead(id: number, name: string): TypeVarHead {
  return { kind: 'var', id, name };
}

export function arrowHead(isAsync = false, isGenerator = false): FunctionHead {
  return { kind: 'arrow', isAsync, isGenerator };
}

export function primitiveHead(
  name: PrimitiveHead['name'],
  value?: boolean | number | string | bigint
): PrimitiveHead {
  return value !== undefined
    ? { kind: 'primitive', name, value }
    : { kind: 'primitive', name };
}

export function recordHead(labels: Iterable<string>, hasRest = false): RecordHead {
  return { kind: 'record', labels: new Set(labels), hasRest };
}

export function arrayHead(isTuple = false, tupleLength?: number): ArrayHead {
  return { kind: 'array', isTuple, tupleLength };
}

export function promiseHead(): PromiseHead {
  return { kind: 'promise' };
}

export function classHead(name: string): ClassHead {
  return { kind: 'class', name };
}

export const topHead: TopHead = { kind: 'top' };
export const bottomHead: BottomHead = { kind: 'bottom' };
export const anyHead: AnyHead = { kind: 'any' };
