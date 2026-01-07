/**
 * Type Simplification via Automata Minimization
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 5.3
 *
 * The key theorem (Theorem 10): Two types are equivalent iff their
 * automata accept the same language.
 *
 * This allows us to use any automata minimization algorithm:
 * - DFA minimization (Hopcroft's algorithm)
 * - NFA reduction techniques
 * - Dead state removal
 */

import { TypeAutomaton } from './automaton.js';
import type { AutomatonState, HeadConstructor } from './state.js';
import { headsCompatible } from './state.js';

// ============================================================================
// Dead State Removal
// ============================================================================

/**
 * Remove unreachable states from the automaton
 *
 * This is the simplest simplification - just removes states
 * that can't be reached from any start state.
 */
export function removeDeadStates(automaton: TypeAutomaton): TypeAutomaton {
  const simplified = automaton.clone();
  simplified.removeUnreachable();
  return simplified;
}

// ============================================================================
// State Equivalence
// ============================================================================

/**
 * Check if two states are equivalent (bisimilar)
 *
 * Two states are equivalent if:
 * 1. They have the same polarity
 * 2. They have compatible heads
 * 3. Their transitions lead to equivalent states
 */
function statesEquivalent(
  automaton: TypeAutomaton,
  id1: number,
  id2: number,
  equivalence: Map<string, boolean>
): boolean {
  if (id1 === id2) return true;

  const key = id1 < id2 ? `${id1},${id2}` : `${id2},${id1}`;
  const cached = equivalence.get(key);
  if (cached !== undefined) return cached;

  // Assume equivalent for recursive check
  equivalence.set(key, true);

  const state1 = automaton.getState(id1);
  const state2 = automaton.getState(id2);

  if (!state1 || !state2) {
    equivalence.set(key, false);
    return false;
  }

  // Check polarity
  if (state1.polarity !== state2.polarity) {
    equivalence.set(key, false);
    return false;
  }

  // Check heads compatibility
  if (!headsEqual(state1.heads, state2.heads)) {
    equivalence.set(key, false);
    return false;
  }

  // Check transitions
  const allLabels = new Set([
    ...state1.transitions.keys(),
    ...state2.transitions.keys(),
  ]);

  for (const label of allLabels) {
    const target1 = state1.transitions.get(label);
    const target2 = state2.transitions.get(label);

    if (target1 === undefined || target2 === undefined) {
      equivalence.set(key, false);
      return false;
    }

    if (!statesEquivalent(automaton, target1, target2, equivalence)) {
      equivalence.set(key, false);
      return false;
    }
  }

  // Check flow edges
  if (state1.flowTo.size !== state2.flowTo.size ||
      state1.flowFrom.size !== state2.flowFrom.size) {
    equivalence.set(key, false);
    return false;
  }

  return true;
}

/**
 * Check if two head sets are equal
 */
function headsEqual(heads1: Set<HeadConstructor>, heads2: Set<HeadConstructor>): boolean {
  if (heads1.size !== heads2.size) return false;

  for (const h1 of heads1) {
    let found = false;
    for (const h2 of heads2) {
      if (headEquals(h1, h2)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
}

/**
 * Check if two heads are equal
 */
function headEquals(h1: HeadConstructor, h2: HeadConstructor): boolean {
  if (h1.kind !== h2.kind) return false;

  switch (h1.kind) {
    case 'var':
      return h1.id === (h2 as typeof h1).id;
    case 'primitive':
      return h1.name === (h2 as typeof h1).name &&
             h1.value === (h2 as typeof h1).value;
    case 'arrow':
      return h1.isAsync === (h2 as typeof h1).isAsync &&
             h1.isGenerator === (h2 as typeof h1).isGenerator;
    case 'record':
      return setsEqual(h1.labels, (h2 as typeof h1).labels);
    case 'array':
      return h1.isTuple === (h2 as typeof h1).isTuple &&
             h1.tupleLength === (h2 as typeof h1).tupleLength;
    case 'class':
      return h1.name === (h2 as typeof h1).name;
    default:
      return true;
  }
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// ============================================================================
// Automaton Minimization
// ============================================================================

/**
 * Find equivalence classes of states
 *
 * Uses partition refinement (similar to Hopcroft's algorithm)
 */
function findEquivalenceClasses(automaton: TypeAutomaton): Map<number, number> {
  const states = automaton.getAllStates();
  if (states.length === 0) return new Map();

  // Initial partition by polarity and heads
  const partitions = new Map<string, number[]>();

  for (const state of states) {
    const key = stateSignature(state);
    const partition = partitions.get(key) ?? [];
    partition.push(state.id);
    partitions.set(key, partition);
  }

  // Refine partitions based on transitions
  let changed = true;
  const stateToPartition = new Map<number, number>();
  let partitionIndex = 0;

  // Assign initial partition indices
  for (const [_key, members] of partitions) {
    for (const id of members) {
      stateToPartition.set(id, partitionIndex);
    }
    partitionIndex++;
  }

  while (changed) {
    changed = false;
    const newPartitions = new Map<string, number[]>();

    for (const [_key, members] of partitions) {
      // Split partition based on transition targets
      const subPartitions = new Map<string, number[]>();

      for (const id of members) {
        const state = automaton.getState(id)!;
        const transitionKey = getTransitionSignature(state, stateToPartition);
        const sub = subPartitions.get(transitionKey) ?? [];
        sub.push(id);
        subPartitions.set(transitionKey, sub);
      }

      if (subPartitions.size > 1) {
        changed = true;
      }

      for (const [subKey, subMembers] of subPartitions) {
        const newKey = `${partitionIndex++}`;
        newPartitions.set(newKey, subMembers);
        for (const id of subMembers) {
          stateToPartition.set(id, partitionIndex - 1);
        }
      }
    }

    partitions.clear();
    for (const [key, members] of newPartitions) {
      partitions.set(key, members);
    }
  }

  // Map each state to its canonical representative (first member of partition)
  const canonical = new Map<number, number>();
  for (const members of partitions.values()) {
    const representative = members[0]!;
    for (const id of members) {
      canonical.set(id, representative);
    }
  }

  return canonical;
}

/**
 * Get a signature string for a state (for initial partitioning)
 */
function stateSignature(state: AutomatonState): string {
  const heads = [...state.heads]
    .map(h => headSignature(h))
    .sort()
    .join(',');
  return `${state.polarity}:${heads}`;
}

/**
 * Get a signature string for a head constructor
 */
function headSignature(head: HeadConstructor): string {
  switch (head.kind) {
    case 'var':
      return `var(${head.id})`;
    case 'primitive':
      return head.value !== undefined ? `${head.name}(${head.value})` : head.name;
    case 'arrow':
      return `arrow(${head.isAsync},${head.isGenerator})`;
    case 'record':
      return `record(${[...head.labels].sort().join(',')})`;
    case 'array':
      return `array(${head.isTuple},${head.tupleLength})`;
    case 'promise':
      return 'promise';
    case 'class':
      return `class(${head.name})`;
    default:
      return head.kind;
  }
}

/**
 * Get a transition signature based on current partition
 */
function getTransitionSignature(
  state: AutomatonState,
  partitions: Map<number, number>
): string {
  const parts: string[] = [];

  for (const [label, target] of [...state.transitions].sort((a, b) => a[0].localeCompare(b[0]))) {
    const partition = partitions.get(target) ?? target;
    parts.push(`${label}:${partition}`);
  }

  // Include flow edges
  for (const to of [...state.flowTo].sort()) {
    parts.push(`->+${partitions.get(to) ?? to}`);
  }
  for (const from of [...state.flowFrom].sort()) {
    parts.push(`<--${partitions.get(from) ?? from}`);
  }

  return parts.join(';');
}

/**
 * Minimize an automaton by merging equivalent states
 */
export function minimizeAutomaton(automaton: TypeAutomaton): TypeAutomaton {
  // First remove dead states
  const simplified = removeDeadStates(automaton);

  // Find equivalence classes
  const canonical = findEquivalenceClasses(simplified);

  // Create new automaton with merged states
  const minimized = simplified.clone();

  // Merge equivalent states
  for (const [id, representative] of canonical) {
    if (id !== representative) {
      minimized.merge(representative, id);
    }
  }

  return minimized;
}

// ============================================================================
// Type Variable Simplification
// ============================================================================

/**
 * Simplify type variables by removing redundant ones
 *
 * A type variable is redundant if:
 * - It only appears once
 * - It has no flow constraints
 */
export function simplifyTypeVars(automaton: TypeAutomaton): TypeAutomaton {
  const simplified = automaton.clone();
  const states = simplified.getAllStates();

  // Count type variable occurrences
  const varOccurrences = new Map<number, number>();
  const varStates = new Map<number, number[]>();

  for (const state of states) {
    for (const head of state.heads) {
      if (head.kind === 'var') {
        const count = varOccurrences.get(head.id) ?? 0;
        varOccurrences.set(head.id, count + 1);

        const stateList = varStates.get(head.id) ?? [];
        stateList.push(state.id);
        varStates.set(head.id, stateList);
      }
    }
  }

  // Remove type variables that appear only once with no flow edges
  for (const [varId, count] of varOccurrences) {
    if (count === 1) {
      const stateIds = varStates.get(varId) ?? [];
      for (const stateId of stateIds) {
        const state = simplified.getState(stateId);
        if (state && state.flowTo.size === 0 && state.flowFrom.size === 0) {
          // This variable is unconstrained - can be simplified
          // (Keep it for now, as it might be intentional)
        }
      }
    }
  }

  return simplified;
}

// ============================================================================
// Combined Simplification
// ============================================================================

/**
 * Apply all simplifications to an automaton
 */
export function simplify(automaton: TypeAutomaton): TypeAutomaton {
  let simplified = automaton;

  // Remove dead states
  simplified = removeDeadStates(simplified);

  // Minimize (merge equivalent states)
  simplified = minimizeAutomaton(simplified);

  // Simplify type variables
  simplified = simplifyTypeVars(simplified);

  return simplified;
}
