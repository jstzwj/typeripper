/**
 * Type Automata - Exports
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017), Section 5
 */

// State types and utilities
export type {
  HeadConstructor,
  TypeVarHead,
  FunctionHead,
  PrimitiveHead,
  RecordHead,
  ArrayHead,
  PromiseHead,
  ClassHead,
  TopHead,
  BottomHead,
  AnyHead,
  TransitionLabel,
  DomainLabel,
  RangeLabel,
  FieldLabel,
  ElementLabel,
  ResolvedLabel,
  AutomatonState,
} from './state.js';

export {
  isContravariant,
  labelKey,
  resetStateCounter,
  freshStateId,
  createState,
  addHead,
  addTransition,
  addFlowTo,
  addFlowFrom,
  headsCompatible,
  headSetsCompatible,
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

// Type Automaton
export { TypeAutomaton } from './automaton.js';

// Conversion between types and automata
export {
  typeToAutomaton,
  automatonToType,
} from './convert.js';

// Simplification
export {
  removeDeadStates,
  minimizeAutomaton,
  simplifyTypeVars,
  simplify,
} from './simplify.js';
