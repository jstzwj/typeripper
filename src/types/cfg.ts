/**
 * Control Flow Graph (CFG) type definitions
 */

import type { Expression, Statement } from '@babel/types';

// ============================================================================
// Node and Edge Identifiers
// ============================================================================

export type NodeId = string;
export type EdgeId = string;

let nodeIdCounter = 0;
export function generateNodeId(): NodeId {
  return `n_${nodeIdCounter++}`;
}

let edgeIdCounter = 0;
export function generateEdgeId(): EdgeId {
  return `e_${edgeIdCounter++}`;
}

// ============================================================================
// Terminators (Block Exit)
// ============================================================================

export type Terminator =
  | FallthroughTerminator
  | BranchTerminator
  | ReturnTerminator
  | ThrowTerminator
  | BreakTerminator
  | ContinueTerminator
  | SwitchTerminator;

export interface FallthroughTerminator {
  readonly kind: 'fallthrough';
  readonly next: NodeId;
}

export interface BranchTerminator {
  readonly kind: 'branch';
  readonly condition: Expression;
  readonly consequent: NodeId; // true branch
  readonly alternate: NodeId; // false branch
}

export interface ReturnTerminator {
  readonly kind: 'return';
  readonly argument: Expression | null;
}

export interface ThrowTerminator {
  readonly kind: 'throw';
  readonly argument: Expression;
}

export interface BreakTerminator {
  readonly kind: 'break';
  readonly label?: string;
  readonly target: NodeId;
}

export interface ContinueTerminator {
  readonly kind: 'continue';
  readonly label?: string;
  readonly target: NodeId;
}

export interface SwitchTerminator {
  readonly kind: 'switch';
  readonly discriminant: Expression;
  readonly cases: readonly { test: Expression | null; consequent: NodeId }[];
  readonly default: NodeId | null;
}

// ============================================================================
// Basic Block
// ============================================================================

export interface BasicBlock {
  readonly id: NodeId;
  readonly statements: Statement[];
  readonly isEntry: boolean;
  readonly isExit: boolean;
  readonly terminator: Terminator;
  readonly scope?: {
    readonly declarations: Set<string>;
    readonly references: Set<string>;
  };
}

// ============================================================================
// Edge Conditions (for narrowing)
// ============================================================================

export interface EdgeCondition {
  readonly expression: Expression;
  readonly whenTruthy: boolean;
}

// ============================================================================
// CFG Edge
// ============================================================================

export type EdgeKind = 'normal' | 'true-branch' | 'false-branch' | 'exception' | 'back-edge';

export interface CFGEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly kind: EdgeKind;
  readonly condition?: EdgeCondition;
}

// ============================================================================
// Loop Information
// ============================================================================

export interface LoopInfo {
  readonly header: NodeId;
  readonly body: readonly NodeId[];
  readonly exits: readonly NodeId[];
  readonly backEdges: readonly EdgeId[];
}

// ============================================================================
// Complete CFG
// ============================================================================

export interface CFG {
  readonly blocks: ReadonlyMap<NodeId, BasicBlock>;
  readonly edges: ReadonlyMap<EdgeId, CFGEdge>;
  readonly entry: NodeId;
  readonly exits: readonly NodeId[];

  // CFG analysis results
  readonly predecessors: ReadonlyMap<NodeId, readonly NodeId[]>;
  readonly successors: ReadonlyMap<NodeId, readonly NodeId[]>;
  readonly backEdges: ReadonlySet<EdgeId>;
  readonly loops: ReadonlyMap<NodeId, LoopInfo>; // header -> loop info

  // Dominator analysis
  readonly dominators: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  readonly postDominators: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  readonly immediateDominator: ReadonlyMap<NodeId, NodeId>;
  readonly dominanceFrontier: ReadonlyMap<NodeId, readonly NodeId[]>;
}

// ============================================================================
// Terminator Guards
// ============================================================================

export function isFallthrough(t: Terminator): t is FallthroughTerminator {
  return t.kind === 'fallthrough';
}

export function isBranch(t: Terminator): t is BranchTerminator {
  return t.kind === 'branch';
}

export function isReturn(t: Terminator): t is ReturnTerminator {
  return t.kind === 'return';
}

export function isThrow(t: Terminator): t is ThrowTerminator {
  return t.kind === 'throw';
}

export function isBreak(t: Terminator): t is BreakTerminator {
  return t.kind === 'break';
}

export function isContinue(t: Terminator): t is ContinueTerminator {
  return t.kind === 'continue';
}

export function isSwitch(t: Terminator): t is SwitchTerminator {
  return t.kind === 'switch';
}

export function isConditionalTerminator(t: Terminator): boolean {
  return isBranch(t) || isSwitch(t);
}

// ============================================================================
// Edge Guards
// ============================================================================

export function isBackEdge(edge: CFGEdge): boolean {
  return edge.kind === 'back-edge';
}

export function isBranchEdge(edge: CFGEdge): boolean {
  return edge.kind === 'true-branch' || edge.kind === 'false-branch';
}

export function isExceptionEdge(edge: CFGEdge): boolean {
  return edge.kind === 'exception';
}
