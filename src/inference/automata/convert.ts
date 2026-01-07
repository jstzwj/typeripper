/**
 * Type ↔ Automaton Conversion
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 5.2
 *
 * Converts between polar types and type automata.
 * The key insight is that types can be represented as finite automata
 * by treating type constructors as head labels and subtype positions
 * as transitions.
 */

import type {
  PolarType,
  TypeVar,
  PrimitiveType,
  FunctionType,
  RecordType,
  ArrayType,
  UnionType,
  IntersectionType,
  RecursiveType,
  PromiseType,
  ClassType,
  Polarity,
} from '../types/index.js';
import { flipPolarity } from '../types/index.js';
import { TypeAutomaton } from './automaton.js';
import type { HeadConstructor, TransitionLabel } from './state.js';
import {
  varHead,
  arrowHead,
  primitiveHead,
  recordHead,
  arrayHead,
  promiseHead,
  classHead,
  topHead,
  bottomHead,
  anyHead,
} from './state.js';

// ============================================================================
// Type to Automaton Conversion
// ============================================================================

/**
 * Convert a polar type to a type automaton
 */
export function typeToAutomaton(type: PolarType, polarity: Polarity = '+'): TypeAutomaton {
  const automaton = TypeAutomaton.create(polarity);
  const startState = automaton.getStartState()!;

  // Map from recursive binders to state IDs
  const binderStates = new Map<number, number>();

  // Convert recursively
  convertType(automaton, startState.id, type, polarity, binderStates);

  // Remove unreachable states
  automaton.removeUnreachable();

  return automaton;
}

/**
 * Convert a type and add it to an existing state
 */
function convertType(
  automaton: TypeAutomaton,
  stateId: number,
  type: PolarType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  switch (type.kind) {
    case 'var':
      convertTypeVar(automaton, stateId, type, polarity, binderStates);
      break;

    case 'primitive':
      convertPrimitive(automaton, stateId, type);
      break;

    case 'function':
      convertFunction(automaton, stateId, type, polarity, binderStates);
      break;

    case 'record':
      convertRecord(automaton, stateId, type, polarity, binderStates);
      break;

    case 'array':
      convertArray(automaton, stateId, type, polarity, binderStates);
      break;

    case 'union':
      convertUnion(automaton, stateId, type, polarity, binderStates);
      break;

    case 'intersection':
      convertIntersection(automaton, stateId, type, polarity, binderStates);
      break;

    case 'recursive':
      convertRecursive(automaton, stateId, type, polarity, binderStates);
      break;

    case 'promise':
      convertPromise(automaton, stateId, type, polarity, binderStates);
      break;

    case 'class':
      convertClass(automaton, stateId, type, polarity, binderStates);
      break;

    case 'top':
      automaton.addHeadToState(stateId, topHead);
      break;

    case 'bottom':
      automaton.addHeadToState(stateId, bottomHead);
      break;

    case 'any':
      automaton.addHeadToState(stateId, anyHead);
      break;

    case 'never':
      automaton.addHeadToState(stateId, bottomHead);
      break;

    case 'unknown':
      automaton.addHeadToState(stateId, topHead);
      break;
  }
}

/**
 * Convert a type variable
 */
function convertTypeVar(
  automaton: TypeAutomaton,
  stateId: number,
  typeVar: TypeVar,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  // Check if this is a reference to a recursive binder
  const binderStateId = binderStates.get(typeVar.id);
  if (binderStateId !== undefined) {
    // This is a recursive reference - add epsilon transition
    // (In our representation, we just note the connection)
    if (polarity === '+') {
      // Positive var flows to binder state
      automaton.addFlowEdge(stateId, binderStateId);
    } else {
      // Binder state flows to negative var
      automaton.addFlowEdge(binderStateId, stateId);
    }
    return;
  }

  // Regular type variable
  automaton.addHeadToState(stateId, varHead(typeVar.id, typeVar.name));
}

/**
 * Convert a primitive type
 */
function convertPrimitive(
  automaton: TypeAutomaton,
  stateId: number,
  type: PrimitiveType
): void {
  automaton.addHeadToState(stateId, primitiveHead(type.name, type.value));
}

/**
 * Convert a function type
 */
function convertFunction(
  automaton: TypeAutomaton,
  stateId: number,
  type: FunctionType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  automaton.addHeadToState(stateId, arrowHead(type.isAsync, type.isGenerator));

  // Domain transitions (contravariant - flip polarity)
  const domainPolarity = flipPolarity(polarity);
  for (let i = 0; i < type.params.length; i++) {
    const param = type.params[i]!;
    const domainState = automaton.addState(domainPolarity);
    const label: TransitionLabel = { kind: 'd', paramIndex: i };
    automaton.addTransitionToState(stateId, label, domainState.id);
    convertType(automaton, domainState.id, param.type, domainPolarity, binderStates);
  }

  // Range transition (covariant - same polarity)
  const rangeState = automaton.addState(polarity);
  automaton.addTransitionToState(stateId, { kind: 'r' }, rangeState.id);
  convertType(automaton, rangeState.id, type.returnType, polarity, binderStates);
}

/**
 * Convert a record type
 */
function convertRecord(
  automaton: TypeAutomaton,
  stateId: number,
  type: RecordType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  const labels = [...type.fields.keys()];
  automaton.addHeadToState(stateId, recordHead(labels, type.rest !== null));

  // Field transitions (covariant)
  for (const [name, field] of type.fields) {
    const fieldState = automaton.addState(polarity);
    const label: TransitionLabel = { kind: 'field', name };
    automaton.addTransitionToState(stateId, label, fieldState.id);
    convertType(automaton, fieldState.id, field.type, polarity, binderStates);
  }

  // Row variable (if present)
  if (type.rest) {
    automaton.addHeadToState(stateId, varHead(type.rest.id, type.rest.name));
  }
}

/**
 * Convert an array type
 */
function convertArray(
  automaton: TypeAutomaton,
  stateId: number,
  type: ArrayType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  const isTuple = type.tuple !== undefined;
  automaton.addHeadToState(stateId, arrayHead(isTuple, type.tuple?.length));

  if (type.tuple) {
    // Tuple: separate transition for each element
    for (let i = 0; i < type.tuple.length; i++) {
      const elemState = automaton.addState(polarity);
      const label: TransitionLabel = { kind: 'element', index: i };
      automaton.addTransitionToState(stateId, label, elemState.id);
      convertType(automaton, elemState.id, type.tuple[i]!, polarity, binderStates);
    }
  } else {
    // Regular array: single element transition
    const elemState = automaton.addState(polarity);
    automaton.addTransitionToState(stateId, { kind: 'element' }, elemState.id);
    convertType(automaton, elemState.id, type.elementType, polarity, binderStates);
  }
}

/**
 * Convert a union type
 *
 * Union adds epsilon transitions to each member (conceptually)
 * In our representation, we add all heads and share transitions
 */
function convertUnion(
  automaton: TypeAutomaton,
  stateId: number,
  type: UnionType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  // For each union member, add its structure to this state
  for (const member of type.members) {
    convertType(automaton, stateId, member, polarity, binderStates);
  }
}

/**
 * Convert an intersection type
 */
function convertIntersection(
  automaton: TypeAutomaton,
  stateId: number,
  type: IntersectionType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  // For each intersection member, add its structure to this state
  for (const member of type.members) {
    convertType(automaton, stateId, member, polarity, binderStates);
  }
}

/**
 * Convert a recursive type (μα.τ)
 */
function convertRecursive(
  automaton: TypeAutomaton,
  stateId: number,
  type: RecursiveType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  // Register this state as the binder state
  const newBinderStates = new Map(binderStates);
  newBinderStates.set(type.binder.id, stateId);

  // Convert the body
  convertType(automaton, stateId, type.body, polarity, newBinderStates);
}

/**
 * Convert a promise type
 */
function convertPromise(
  automaton: TypeAutomaton,
  stateId: number,
  type: PromiseType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  automaton.addHeadToState(stateId, promiseHead());

  // Resolved type transition (covariant)
  const resolvedState = automaton.addState(polarity);
  automaton.addTransitionToState(stateId, { kind: 'resolved' }, resolvedState.id);
  convertType(automaton, resolvedState.id, type.resolvedType, polarity, binderStates);
}

/**
 * Convert a class type
 */
function convertClass(
  automaton: TypeAutomaton,
  stateId: number,
  type: ClassType,
  polarity: Polarity,
  binderStates: Map<number, number>
): void {
  automaton.addHeadToState(stateId, classHead(type.name));

  // Instance type (covariant)
  const instanceState = automaton.addState(polarity);
  automaton.addTransitionToState(stateId, { kind: 'field', name: 'instance' }, instanceState.id);
  convertType(automaton, instanceState.id, type.instanceType, polarity, binderStates);
}

// ============================================================================
// Automaton to Type Conversion
// ============================================================================

/**
 * Convert a type automaton back to a polar type
 */
export function automatonToType(automaton: TypeAutomaton): PolarType {
  const startState = automaton.getStartState();
  if (!startState) {
    return { kind: 'unknown' };
  }

  // Track visited states to detect cycles
  const visiting = new Set<number>();
  const completed = new Map<number, PolarType>();

  return stateToType(automaton, startState.id, visiting, completed);
}

/**
 * Convert a single state to a type
 */
function stateToType(
  automaton: TypeAutomaton,
  stateId: number,
  visiting: Set<number>,
  completed: Map<number, PolarType>
): PolarType {
  // Check for completed types (memoization)
  const cached = completed.get(stateId);
  if (cached) return cached;

  // Check for cycles (recursive type)
  if (visiting.has(stateId)) {
    // Return a placeholder that will be filled in
    return { kind: 'var', id: stateId, name: `μ${stateId}`, level: 0 };
  }

  visiting.add(stateId);

  const state = automaton.getState(stateId);
  if (!state) {
    return { kind: 'unknown' };
  }

  // Convert based on heads
  const heads = [...state.heads];
  if (heads.length === 0) {
    // No heads - use transitions to infer type
    return inferTypeFromTransitions(automaton, state, visiting, completed);
  }

  // Multiple heads mean union (positive) or intersection (negative)
  if (heads.length > 1) {
    const memberTypes = heads.map(h => headToType(automaton, state, h, visiting, completed));
    if (state.polarity === '+') {
      return { kind: 'union', members: memberTypes };
    } else {
      return { kind: 'intersection', members: memberTypes };
    }
  }

  // Single head
  const result = headToType(automaton, state, heads[0]!, visiting, completed);

  visiting.delete(stateId);
  completed.set(stateId, result);

  return result;
}

/**
 * Convert a head constructor to a type
 */
function headToType(
  automaton: TypeAutomaton,
  state: import('./state.js').AutomatonState,
  head: HeadConstructor,
  visiting: Set<number>,
  completed: Map<number, PolarType>
): PolarType {
  switch (head.kind) {
    case 'var':
      return { kind: 'var', id: head.id, name: head.name, level: 0 };

    case 'primitive':
      return {
        kind: 'primitive',
        name: head.name,
        value: head.value,
      };

    case 'arrow': {
      // Get domain and range from transitions
      const params: import('../types/index.js').ParamType[] = [];
      for (const [label, targetId] of state.transitions) {
        if (label.startsWith('d')) {
          const paramType = stateToType(automaton, targetId, visiting, completed);
          const index = label.length > 1 ? parseInt(label.slice(1)) : 0;
          params[index] = { name: `p${index}`, type: paramType, optional: false, rest: false };
        }
      }

      const rangeId = state.transitions.get('r');
      const returnType = rangeId !== undefined
        ? stateToType(automaton, rangeId, visiting, completed)
        : { kind: 'unknown' as const };

      return {
        kind: 'function',
        params,
        returnType,
        isAsync: head.isAsync,
        isGenerator: head.isGenerator,
      };
    }

    case 'record': {
      const fields = new Map<string, import('../types/index.js').FieldType>();
      for (const [label, targetId] of state.transitions) {
        if (label.startsWith('f:')) {
          const fieldName = label.slice(2);
          const fieldType = stateToType(automaton, targetId, visiting, completed);
          fields.set(fieldName, { type: fieldType, optional: false, readonly: false });
        }
      }
      return { kind: 'record', fields, rest: null };
    }

    case 'array': {
      if (head.isTuple && head.tupleLength !== undefined) {
        const tuple: PolarType[] = [];
        for (let i = 0; i < head.tupleLength; i++) {
          const elemId = state.transitions.get(`e${i}`);
          tuple[i] = elemId !== undefined
            ? stateToType(automaton, elemId, visiting, completed)
            : { kind: 'unknown' };
        }
        const elementType = tuple.length > 0
          ? { kind: 'union' as const, members: tuple }
          : { kind: 'never' as const };
        return { kind: 'array', elementType, tuple };
      } else {
        const elemId = state.transitions.get('e');
        const elementType = elemId !== undefined
          ? stateToType(automaton, elemId, visiting, completed)
          : { kind: 'unknown' as const };
        return { kind: 'array', elementType };
      }
    }

    case 'promise': {
      const resolvedId = state.transitions.get('res');
      const resolvedType = resolvedId !== undefined
        ? stateToType(automaton, resolvedId, visiting, completed)
        : { kind: 'unknown' as const };
      return { kind: 'promise', resolvedType };
    }

    case 'class': {
      return {
        kind: 'class',
        name: head.name,
        constructorType: { kind: 'function', params: [], returnType: { kind: 'primitive' as const, name: 'undefined' }, isAsync: false, isGenerator: false },
        instanceType: { kind: 'record', fields: new Map(), rest: null },
        staticType: { kind: 'record', fields: new Map(), rest: null },
        superClass: null,
      };
    }

    case 'top':
      return { kind: 'top' };

    case 'bottom':
      return { kind: 'bottom' };

    case 'any':
      return { kind: 'any' };
  }
}

/**
 * Infer type from transitions when no heads are present
 */
function inferTypeFromTransitions(
  automaton: TypeAutomaton,
  state: import('./state.js').AutomatonState,
  visiting: Set<number>,
  completed: Map<number, PolarType>
): PolarType {
  // Check for function transitions
  if (state.transitions.has('r')) {
    return headToType(automaton, state, arrowHead(), visiting, completed);
  }

  // Check for array transitions
  if (state.transitions.has('e')) {
    return headToType(automaton, state, arrayHead(), visiting, completed);
  }

  // Check for record transitions
  const fieldLabels = [...state.transitions.keys()].filter(l => l.startsWith('f:'));
  if (fieldLabels.length > 0) {
    const labels = fieldLabels.map(l => l.slice(2));
    return headToType(automaton, state, recordHead(labels), visiting, completed);
  }

  return { kind: 'unknown' };
}
