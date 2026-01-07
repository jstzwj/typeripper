/**
 * Type Automaton - Finite automaton representation of types
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 5
 *
 * Type automata provide:
 * 1. Compact representation of infinite recursive types
 * 2. Efficient biunification via state merging
 * 3. Type simplification via automata minimization
 *
 * The key insight is that two types are equivalent iff their
 * automata accept the same language (Theorem 10).
 */

import type { Polarity } from '../types/index.js';
import type {
  AutomatonState,
  HeadConstructor,
  TransitionLabel,
} from './state.js';
import {
  createState,
  addHead,
  addTransition,
  addFlowTo,
  addFlowFrom,
  labelKey,
  isContravariant,
  headSetsCompatible,
} from './state.js';

// ============================================================================
// Type Automaton
// ============================================================================

/**
 * Type Automaton
 *
 * A collection of states with a designated start state.
 * Represents a type (positive) or an environment entry (with delta).
 */
export class TypeAutomaton {
  /** All states in the automaton */
  private states: Map<number, AutomatonState> = new Map();

  /** Start state ID (for the main type) */
  private startState: number | null = null;

  /** Delta start states (for typing scheme dependencies) */
  private deltaStates: Map<string, number> = new Map();

  /** Memoization for biunification */
  private biunified: Set<string> = new Set();

  /**
   * Create a new automaton with a fresh start state
   */
  static create(polarity: Polarity): TypeAutomaton {
    const automaton = new TypeAutomaton();
    const start = createState(polarity);
    automaton.states.set(start.id, start);
    automaton.startState = start.id;
    return automaton;
  }

  /**
   * Get the start state
   */
  getStartState(): AutomatonState | null {
    if (this.startState === null) return null;
    return this.states.get(this.startState) ?? null;
  }

  /**
   * Get a state by ID
   */
  getState(id: number): AutomatonState | null {
    return this.states.get(id) ?? null;
  }

  /**
   * Get all states
   */
  getAllStates(): AutomatonState[] {
    return [...this.states.values()];
  }

  /**
   * Get delta start state for a variable
   */
  getDeltaState(varName: string): AutomatonState | null {
    const id = this.deltaStates.get(varName);
    if (id === undefined) return null;
    return this.states.get(id) ?? null;
  }

  /**
   * Add a new state
   */
  addState(polarity: Polarity): AutomatonState {
    const state = createState(polarity);
    this.states.set(state.id, state);
    return state;
  }

  /**
   * Update a state
   */
  updateState(state: AutomatonState): void {
    this.states.set(state.id, state);
  }

  /**
   * Add a head constructor to a state
   */
  addHeadToState(stateId: number, head: HeadConstructor): void {
    const state = this.states.get(stateId);
    if (!state) return;
    this.states.set(stateId, addHead(state, head));
  }

  /**
   * Add a transition between states
   */
  addTransitionToState(fromId: number, label: TransitionLabel, toId: number): void {
    const state = this.states.get(fromId);
    if (!state) return;
    this.states.set(fromId, addTransition(state, label, toId));
  }

  /**
   * Add a flow edge (for type variables)
   */
  addFlowEdge(negId: number, posId: number): void {
    const negState = this.states.get(negId);
    const posState = this.states.get(posId);

    if (!negState || !posState) return;
    if (negState.polarity !== '-' || posState.polarity !== '+') {
      throw new Error('Flow edge must go from negative to positive');
    }

    this.states.set(negId, addFlowFrom(negState, posId));
    this.states.set(posId, addFlowTo(posState, negId));
  }

  /**
   * Set the start state for a delta variable
   */
  setDeltaStart(varName: string, stateId: number): void {
    this.deltaStates.set(varName, stateId);
  }

  // ==========================================================================
  // Biunification on Automata (Figure 10)
  // ==========================================================================

  /**
   * Biunify two states: q⁺ ≤ q⁻
   *
   * Implements Figure 10 from the paper
   */
  biunify(posId: number, negId: number): boolean {
    const key = `${posId},${negId}`;

    // Check memoization
    if (this.biunified.has(key)) {
      return true;
    }
    this.biunified.add(key);

    const posState = this.states.get(posId);
    const negState = this.states.get(negId);

    if (!posState || !negState) {
      throw new Error(`State not found: ${posId} or ${negId}`);
    }

    if (posState.polarity !== '+' || negState.polarity !== '-') {
      throw new Error('biunify requires positive and negative states');
    }

    // Check head compatibility
    if (!headSetsCompatible(posState.heads, negState.heads)) {
      return false;
    }

    // Process flow edges: for q'⁺ where q⁻ ⇝ q'⁺, merge(q'⁺, q⁺)
    for (const qPrimePosId of negState.flowFrom) {
      this.merge(qPrimePosId, posId);
    }

    // Process flow edges: for q'⁻ where q'⁻ ⇝ q⁺, merge(q'⁻, q⁻)
    for (const qPrimeNegId of posState.flowTo) {
      this.merge(qPrimeNegId, negId);
    }

    // Process domain transitions (contravariant: swap)
    for (const [label, posTargetId] of posState.transitions) {
      if (label.startsWith('d')) {
        const negTargetId = negState.transitions.get(label);
        if (negTargetId !== undefined) {
          // Contravariant: biunify(neg.target, pos.target)
          if (!this.biunify(negTargetId, posTargetId)) {
            return false;
          }
        }
      }
    }

    // Process covariant transitions (r, fields, elements)
    for (const [label, posTargetId] of posState.transitions) {
      if (!label.startsWith('d')) {
        const negTargetId = negState.transitions.get(label);
        if (negTargetId !== undefined) {
          // Covariant: biunify(pos.target, neg.target)
          if (!this.biunify(posTargetId, negTargetId)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Merge two states of the same polarity
   *
   * q1 absorbs q2's transitions, heads, and flow edges
   */
  merge(id1: number, id2: number): void {
    if (id1 === id2) return;

    const state1 = this.states.get(id1);
    const state2 = this.states.get(id2);

    if (!state1 || !state2) return;
    if (state1.polarity !== state2.polarity) {
      throw new Error('Cannot merge states of different polarity');
    }

    // Merge heads
    const newHeads = new Set(state1.heads);
    for (const head of state2.heads) {
      newHeads.add(head);
    }

    // Merge transitions (union)
    const newTransitions = new Map(state1.transitions);
    for (const [label, target] of state2.transitions) {
      if (!newTransitions.has(label)) {
        newTransitions.set(label, target);
      }
      // If both have same transition, we might need to merge targets
    }

    // Merge flow edges
    const newFlowTo = new Set(state1.flowTo);
    const newFlowFrom = new Set(state1.flowFrom);
    for (const id of state2.flowTo) newFlowTo.add(id);
    for (const id of state2.flowFrom) newFlowFrom.add(id);

    // Update state1
    this.states.set(id1, {
      ...state1,
      heads: newHeads,
      transitions: newTransitions,
      flowTo: newFlowTo,
      flowFrom: newFlowFrom,
    });

    // Redirect all references to state2 to state1
    for (const [id, state] of this.states) {
      if (id === id1 || id === id2) continue;

      // Update transitions
      let changed = false;
      const updatedTransitions = new Map<string, number>();
      for (const [label, target] of state.transitions) {
        updatedTransitions.set(label, target === id2 ? id1 : target);
        if (target === id2) changed = true;
      }

      // Update flow edges
      const updatedFlowTo = new Set<number>();
      const updatedFlowFrom = new Set<number>();
      for (const fid of state.flowTo) {
        updatedFlowTo.add(fid === id2 ? id1 : fid);
        if (fid === id2) changed = true;
      }
      for (const fid of state.flowFrom) {
        updatedFlowFrom.add(fid === id2 ? id1 : fid);
        if (fid === id2) changed = true;
      }

      if (changed) {
        this.states.set(id, {
          ...state,
          transitions: updatedTransitions,
          flowTo: updatedFlowTo,
          flowFrom: updatedFlowFrom,
        });
      }
    }

    // Update start state if needed
    if (this.startState === id2) {
      this.startState = id1;
    }

    // Update delta states if needed
    for (const [varName, stateId] of this.deltaStates) {
      if (stateId === id2) {
        this.deltaStates.set(varName, id1);
      }
    }

    // Remove state2
    this.states.delete(id2);
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Clone the automaton
   */
  clone(): TypeAutomaton {
    const cloned = new TypeAutomaton();
    cloned.startState = this.startState;
    cloned.deltaStates = new Map(this.deltaStates);
    cloned.biunified = new Set(this.biunified);

    for (const [id, state] of this.states) {
      cloned.states.set(id, {
        ...state,
        heads: new Set(state.heads),
        transitions: new Map(state.transitions),
        flowTo: new Set(state.flowTo),
        flowFrom: new Set(state.flowFrom),
      });
    }

    return cloned;
  }

  /**
   * Get reachable states from the start state(s)
   */
  getReachableStates(): Set<number> {
    const reachable = new Set<number>();
    const worklist: number[] = [];

    // Add all start states
    if (this.startState !== null) {
      worklist.push(this.startState);
    }
    for (const id of this.deltaStates.values()) {
      worklist.push(id);
    }

    while (worklist.length > 0) {
      const id = worklist.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);

      const state = this.states.get(id);
      if (!state) continue;

      // Add transition targets
      for (const targetId of state.transitions.values()) {
        if (!reachable.has(targetId)) {
          worklist.push(targetId);
        }
      }

      // Add flow edge targets
      for (const targetId of state.flowTo) {
        if (!reachable.has(targetId)) {
          worklist.push(targetId);
        }
      }
      for (const targetId of state.flowFrom) {
        if (!reachable.has(targetId)) {
          worklist.push(targetId);
        }
      }
    }

    return reachable;
  }

  /**
   * Remove unreachable states
   */
  removeUnreachable(): void {
    const reachable = this.getReachableStates();
    for (const id of [...this.states.keys()]) {
      if (!reachable.has(id)) {
        this.states.delete(id);
      }
    }
  }

  /**
   * Get statistics about the automaton
   */
  getStats(): {
    stateCount: number;
    transitionCount: number;
    flowEdgeCount: number;
  } {
    let transitionCount = 0;
    let flowEdgeCount = 0;

    for (const state of this.states.values()) {
      transitionCount += state.transitions.size;
      flowEdgeCount += state.flowTo.size + state.flowFrom.size;
    }

    return {
      stateCount: this.states.size,
      transitionCount,
      flowEdgeCount: flowEdgeCount / 2, // Each edge counted twice
    };
  }
}
