/**
 * Control Flow Graph (CFG) types
 *
 * These types represent the control flow structure of JavaScript programs.
 * The CFG is constructed from the AST and used for flow-sensitive type analysis.
 */

import type * as t from '@babel/types';

/**
 * Unique identifier for CFG nodes
 */
export type NodeId = string;

/**
 * Unique identifier for CFG edges
 */
export type EdgeId = string;

/**
 * A basic block in the CFG
 * Contains a sequence of statements with no branching (except at the end)
 */
export interface BasicBlock {
  readonly id: NodeId;
  /** The AST nodes contained in this block */
  readonly statements: readonly t.Statement[];
  /** Entry point of the function/program if this is the first block */
  readonly isEntry: boolean;
  /** Exit point of the function/program if this is a terminal block */
  readonly isExit: boolean;
  /** The type of terminator (how control leaves this block) */
  readonly terminator: Terminator;
}

/**
 * How control leaves a basic block
 */
export type Terminator =
  | FallthroughTerminator
  | BranchTerminator
  | SwitchTerminator
  | ReturnTerminator
  | ThrowTerminator
  | BreakTerminator
  | ContinueTerminator
  | TryTerminator;

export interface FallthroughTerminator {
  readonly kind: 'fallthrough';
  /** The next block */
  readonly next: NodeId;
}

export interface BranchTerminator {
  readonly kind: 'branch';
  /** The condition expression */
  readonly condition: t.Expression;
  /** Block to execute if condition is truthy */
  readonly consequent: NodeId;
  /** Block to execute if condition is falsy */
  readonly alternate: NodeId;
}

export interface SwitchTerminator {
  readonly kind: 'switch';
  /** The discriminant expression */
  readonly discriminant: t.Expression;
  /** Cases and their target blocks */
  readonly cases: readonly SwitchCase[];
  /** Default case block (if any) */
  readonly defaultCase: NodeId | null;
}

export interface SwitchCase {
  readonly test: t.Expression;
  readonly target: NodeId;
}

export interface ReturnTerminator {
  readonly kind: 'return';
  /** The return expression (undefined for bare return) */
  readonly argument: t.Expression | null;
}

export interface ThrowTerminator {
  readonly kind: 'throw';
  /** The thrown expression */
  readonly argument: t.Expression;
  /** Handler block if inside try-catch */
  readonly handler: NodeId | null;
}

export interface BreakTerminator {
  readonly kind: 'break';
  /** Target block after the loop/switch */
  readonly target: NodeId;
  /** Optional label */
  readonly label: string | null;
}

export interface ContinueTerminator {
  readonly kind: 'continue';
  /** Target block (loop header) */
  readonly target: NodeId;
  /** Optional label */
  readonly label: string | null;
}

export interface TryTerminator {
  readonly kind: 'try';
  /** The try block */
  readonly tryBlock: NodeId;
  /** The catch block (if any) */
  readonly catchBlock: NodeId | null;
  /** The catch parameter name */
  readonly catchParam: string | null;
  /** The finally block (if any) */
  readonly finallyBlock: NodeId | null;
  /** Block after try-catch-finally */
  readonly continuation: NodeId;
}

/**
 * An edge in the CFG representing control flow
 */
export interface CFGEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  /** Type of edge for analysis purposes */
  readonly kind: EdgeKind;
  /** Condition that must be true for this edge (for narrowing) */
  readonly condition?: EdgeCondition;
}

export type EdgeKind =
  | 'normal'
  | 'true-branch'
  | 'false-branch'
  | 'exception'
  | 'finally'
  | 'back-edge' // For loops
  | 'break'
  | 'continue';

/**
 * Condition associated with a CFG edge
 * Used for type narrowing
 */
export interface EdgeCondition {
  /** The condition expression */
  readonly expression: t.Expression;
  /** Whether this edge is taken when condition is truthy */
  readonly whenTruthy: boolean;
}

/**
 * The complete Control Flow Graph for a function or program
 */
export interface CFG {
  /** All basic blocks indexed by ID */
  readonly blocks: ReadonlyMap<NodeId, BasicBlock>;
  /** All edges indexed by ID */
  readonly edges: ReadonlyMap<EdgeId, CFGEdge>;
  /** The entry block ID */
  readonly entry: NodeId;
  /** The exit block ID(s) - may have multiple for different return paths */
  readonly exits: readonly NodeId[];
  /** Predecessors for each block */
  readonly predecessors: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Successors for each block */
  readonly successors: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Back edges (for loop detection) */
  readonly backEdges: ReadonlySet<EdgeId>;
  /** Dominators for each block */
  readonly dominators: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  /** Post-dominators for each block */
  readonly postDominators: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
}

/**
 * CFG for an entire program, including all functions
 */
export interface ProgramCFG {
  /** The main program CFG */
  readonly main: CFG;
  /** CFGs for each function, keyed by function AST node */
  readonly functions: ReadonlyMap<t.Function, CFG>;
}
