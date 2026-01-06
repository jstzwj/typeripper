/**
 * Type Environment and Analysis Context types
 *
 * These types manage the type state at each program point
 * for flow-sensitive type inference.
 */

import type * as t from '@babel/types';
import type { Type, TypeId } from './types.js';
import type { NodeId } from './cfg.js';

/**
 * A binding in the type environment
 */
export interface Binding {
  /** The variable/parameter name */
  readonly name: string;
  /** Current type of the binding */
  readonly type: Type;
  /** AST node where this binding was declared */
  readonly declarationNode: t.Node;
  /** Declaration kind */
  readonly kind: 'var' | 'let' | 'const' | 'param' | 'function' | 'class' | 'import';
  /** Is this binding definitely assigned at this point? */
  readonly definitelyAssigned: boolean;
  /** Is this binding possibly mutated? (for const checking) */
  readonly possiblyMutated: boolean;
}

/**
 * Type environment at a specific program point
 * Maps variable names to their types
 */
export interface TypeEnvironment {
  /** Bindings in the current scope */
  readonly bindings: ReadonlyMap<string, Binding>;
  /** Parent scope (for closures and nested blocks) */
  readonly parent: TypeEnvironment | null;
  /** The scope kind */
  readonly scopeKind: ScopeKind;
}

export type ScopeKind =
  | 'global'
  | 'module'
  | 'function'
  | 'block'
  | 'catch'
  | 'class'
  | 'with'; // 'with' is unsound but must be handled

/**
 * Type state at a CFG node
 * This is what flows through the dataflow analysis
 */
export interface TypeState {
  /** The type environment at this point */
  readonly env: TypeEnvironment;
  /** Types of expressions (for sub-expressions) */
  readonly expressionTypes: ReadonlyMap<t.Expression, Type>;
  /** Is this state reachable? */
  readonly reachable: boolean;
}

/**
 * Type constraint generated during analysis
 */
export type TypeConstraint =
  | EqualityConstraint
  | SubtypeConstraint
  | PropertyConstraint
  | CallConstraint
  | AssignmentConstraint;

export interface EqualityConstraint {
  readonly kind: 'equality';
  readonly left: TypeId;
  readonly right: TypeId;
  readonly location: t.Node;
}

export interface SubtypeConstraint {
  readonly kind: 'subtype';
  readonly subtype: TypeId;
  readonly supertype: TypeId;
  readonly location: t.Node;
}

export interface PropertyConstraint {
  readonly kind: 'property';
  readonly objectType: TypeId;
  readonly propertyName: string;
  readonly propertyType: TypeId;
  readonly location: t.Node;
}

export interface CallConstraint {
  readonly kind: 'call';
  readonly calleeType: TypeId;
  readonly argTypes: readonly TypeId[];
  readonly returnType: TypeId;
  readonly location: t.Node;
}

export interface AssignmentConstraint {
  readonly kind: 'assignment';
  readonly target: TypeId;
  readonly source: TypeId;
  readonly location: t.Node;
}

/**
 * Analysis result for a single function or program
 */
export interface AnalysisResult {
  /** Type state at each CFG block entry */
  readonly blockEntryStates: ReadonlyMap<NodeId, TypeState>;
  /** Type state at each CFG block exit */
  readonly blockExitStates: ReadonlyMap<NodeId, TypeState>;
  /** Inferred type for each expression */
  readonly expressionTypes: ReadonlyMap<t.Expression, Type>;
  /** Inferred type for each declaration */
  readonly declarationTypes: ReadonlyMap<t.Declaration, Type>;
  /** Collected type constraints */
  readonly constraints: readonly TypeConstraint[];
  /** Type errors found */
  readonly errors: readonly TypeError[];
  /** Warnings (potential issues but not definitely errors) */
  readonly warnings: readonly TypeWarning[];
}

/**
 * Type error detected during analysis
 */
export interface TypeError {
  readonly kind: TypeErrorKind;
  readonly message: string;
  readonly location: t.Node;
  readonly expectedType?: Type;
  readonly actualType?: Type;
}

export type TypeErrorKind =
  | 'type-mismatch'
  | 'undefined-variable'
  | 'undefined-property'
  | 'not-callable'
  | 'not-constructable'
  | 'invalid-operation'
  | 'const-assignment'
  | 'unreachable-code';

/**
 * Type warning (potential issues)
 */
export interface TypeWarning {
  readonly kind: TypeWarningKind;
  readonly message: string;
  readonly location: t.Node;
}

export type TypeWarningKind =
  | 'implicit-any'
  | 'possibly-undefined'
  | 'possibly-null'
  | 'unused-variable'
  | 'narrowing-failed';
