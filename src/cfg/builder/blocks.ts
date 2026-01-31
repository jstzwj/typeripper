/**
 * CFG Block Creation Utilities
 * Functions for creating basic blocks, terminators, and managing block connections
 */

import type * as t from '@babel/types';
import type {
  NodeId,
  EdgeId,
  Terminator,
  BasicBlock,
  CFGEdge,
  LoopInfo,
} from '../../types/cfg.js';
import {
  generateNodeId,
  generateEdgeId,
  isFallthrough,
  isBranch,
} from '../../types/cfg.js';

// ============================================================================
// Block Creation
// ============================================================================

export interface BlockBuilder {
  readonly id: NodeId;
  readonly statements: t.Statement[];
  readonly isEntry: boolean;
  readonly isExit: boolean;
  terminator: Terminator | null;
  readonly scope: {
    declarations: Set<string>;
    references: Set<string>;
  };

  addStatement(stmt: t.Statement): void;
  setTerminator(terminator: Terminator): void;
  setExit(): void;
  build(): BasicBlock;
  addDeclaration(name: string): void;
  addReference(name: string): void;
}

export class BlockBuilderImpl implements BlockBuilder {
  readonly id: NodeId;
  readonly statements: t.Statement[] = [];
  isEntry: boolean = false;
  isExit: boolean = false;
  terminator: Terminator | null = null;
  readonly scope = {
    declarations: new Set<string>(),
    references: new Set<string>(),
  };

  constructor(id?: NodeId) {
    this.id = id ?? generateNodeId();
  }

  addStatement(stmt: t.Statement): void {
    this.statements.push(stmt);
  }

  setTerminator(terminator: Terminator): void {
    this.terminator = terminator;
  }

  setExit(): void {
    this.isExit = true;
    this.terminator = {
      kind: 'return',
      argument: null,
    };
  }

  build(): BasicBlock {
    if (!this.terminator) {
      this.terminator = {
        kind: 'fallthrough',
        next: generateNodeId(),
      };
    }

    return {
      id: this.id,
      statements: this.statements,
      isEntry: this.isEntry,
      isExit: this.isExit,
      terminator: this.terminator,
      scope: {
        declarations: this.scope.declarations,
        references: this.scope.references,
      },
    };
  }

  addDeclaration(name: string): void {
    this.scope.declarations.add(name);
  }

  addReference(name: string): void {
    this.scope.references.add(name);
  }
}

// ============================================================================
// Terminator Creation Helpers
// ============================================================================

export function createFallthrough(next: NodeId): Terminator {
  return { kind: 'fallthrough', next };
}

export function createBranch(
  condition: t.Expression,
  consequent: NodeId,
  alternate: NodeId
): Terminator {
  return { kind: 'branch', condition, consequent, alternate };
}

export function createReturn(argument: t.Expression | null): Terminator {
  return { kind: 'return', argument };
}

export function createThrow(argument: t.Expression): Terminator {
  return { kind: 'throw', argument };
}

export function createBreak(target: NodeId, label?: string): Terminator {
  return { kind: 'break', target, label };
}

export function createContinue(target: NodeId, label?: string): Terminator {
  return { kind: 'continue', target, label };
}

export function createSwitch(
  discriminant: t.Expression,
  cases: Array<{ test: t.Expression | null; consequent: NodeId }>,
  defaultCase: NodeId | null
): Terminator {
  return {
    kind: 'switch',
    discriminant,
    cases,
    default: defaultCase,
  };
}

// ============================================================================
// Edge Creation
// ============================================================================

export function createEdge(
  source: NodeId,
  target: NodeId,
  kind: CFGEdge['kind'] = 'normal',
  condition?: { expression: t.Expression; whenTruthy: boolean }
): CFGEdge {
  return {
    id: generateEdgeId(),
    source,
    target,
    kind,
    condition,
  };
}

// ============================================================================
// CFG Builder State
// ============================================================================

export interface CFGBuilderState {
  // All blocks created so far
  readonly blocks: Map<NodeId, BasicBlock>;

  // All edges created so far
  readonly edges: Map<EdgeId, CFGEdge>;

  // Entry block ID
  entry: NodeId | null;

  // Exit block IDs
  readonly exits: Set<NodeId>;

  // Current block being built
  currentBlock: BlockBuilder | null;

  // Loops being built (for break/continue targets)
  loopStack: LoopContext;

  // Switch statements being built
  switchStack: SwitchContext;

  // Labels (for labeled break/continue)
  readonly labels: Map<string, NodeId>;

  // Next available implicit block ID
  nextImplicitId: number;
}

interface LoopContext {
  readonly header: NodeId;      // Loop condition check block
  readonly body: NodeId;         // Loop body block
  readonly exit: NodeId;         // Exit block after loop
  readonly update?: NodeId;      // Update block (for loops)
  parent?: LoopContext;
}

interface SwitchContext {
  readonly discriminant: t.Expression;
  readonly exit: NodeId;
  parent?: SwitchContext;
}

export function createCFGBuilderState(): CFGBuilderState {
  return {
    blocks: new Map(),
    edges: new Map(),
    entry: null,
    exits: new Set(),
    currentBlock: null,
    loopStack: null as any,
    switchStack: null as any,
    labels: new Map(),
    nextImplicitId: 0,
  };
}

// ============================================================================
// Block Management
// ============================================================================

export function startBlock(
  state: CFGBuilderState,
  isEntry: boolean = false
): BlockBuilder {
  // Finalize previous block if exists
  if (state.currentBlock) {
    finalizeBlock(state);
  }

  const builder = new BlockBuilderImpl();
  builder.isEntry = isEntry;

  state.currentBlock = builder;

  if (isEntry && !state.entry) {
    state.entry = builder.id;
  }

  return builder;
}

export function finalizeBlock(state: CFGBuilderState): void {
  if (!state.currentBlock) return;

  const block = state.currentBlock.build();
  state.blocks.set(block.id, block);

  // Handle fallthrough terminator - create edge and next block
  if (isFallthrough(block.terminator)) {
    const edge = createEdge(block.id, block.terminator.next, 'normal');
    state.edges.set(edge.id, edge);
  }
  // Handle branch terminator
  else if (isBranch(block.terminator)) {
    const trueEdge = createEdge(
      block.id,
      block.terminator.consequent,
      'true-branch',
      { expression: block.terminator.condition, whenTruthy: true }
    );
    const falseEdge = createEdge(
      block.id,
      block.terminator.alternate,
      'false-branch',
      { expression: block.terminator.condition, whenTruthy: false }
    );
    state.edges.set(trueEdge.id, trueEdge);
    state.edges.set(falseEdge.id, falseEdge);
  }

  state.currentBlock = null;
}

export function createImplicitBlock(state: CFGBuilderState): NodeId {
  const id = `implicit_${state.nextImplicitId++}`;
  const builder = new BlockBuilderImpl(id);
  const block = builder.build();
  state.blocks.set(id, block);
  return id;
}

// ============================================================================
// Edge Management
// ============================================================================

export function addEdge(
  state: CFGBuilderState,
  source: NodeId,
  target: NodeId,
  kind: CFGEdge['kind'] = 'normal',
  condition?: { expression: t.Expression; whenTruthy: boolean }
): EdgeId {
  const edge = createEdge(source, target, kind, condition);
  state.edges.set(edge.id, edge);
  return edge.id;
}

export function markAsBackEdge(state: CFGBuilderState, edgeId: EdgeId): void {
  const edge = state.edges.get(edgeId);
  if (edge) {
    state.edges.set(edgeId, {
      ...edge,
      kind: 'back-edge',
    });
  }
}

export function markExit(state: CFGBuilderState, nodeId: NodeId): void {
  state.exits.add(nodeId);
}

// ============================================================================
// Loop Management
// ============================================================================

export function pushLoop(
  state: CFGBuilderState,
  header: NodeId,
  body: NodeId,
  exit: NodeId,
  update?: NodeId
): void {
  state.loopStack = {
    header,
    body,
    exit,
    update,
    parent: state.loopStack,
  };
}

export function popLoop(state: CFGBuilderState): void {
  state.loopStack = state.loopStack?.parent ?? (null as any);
}

export function getCurrentLoop(state: CFGBuilderState): LoopContext | null {
  return state.loopStack;
}

export function findLoopForBlock(state: CFGBuilderState, blockId: NodeId): LoopContext | null {
  let current = state.loopStack;
  while (current) {
    if (current.header === blockId || current.body === blockId) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

// ============================================================================
// Switch Management
// ============================================================================

export function pushSwitch(
  state: CFGBuilderState,
  discriminant: t.Expression,
  exit: NodeId
): void {
  state.switchStack = {
    discriminant,
    exit,
    parent: state.switchStack,
  };
}

export function popSwitch(state: CFGBuilderState): void {
  state.switchStack = state.switchStack?.parent ?? (null as any);
}

export function getCurrentSwitch(state: CFGBuilderState): SwitchContext | null {
  return state.switchStack;
}

// ============================================================================
// Label Management
// ============================================================================

export function addLabel(state: CFGBuilderState, label: string, target: NodeId): void {
  state.labels.set(label, target);
}

export function getLabelTarget(state: CFGBuilderState, label: string): NodeId | undefined {
  return state.labels.get(label);
}

export function removeLabel(state: CFGBuilderState, label: string): void {
  state.labels.delete(label);
}

// ============================================================================
// Block Builder Utilities
// ============================================================================

/**
 * Add a statement to the current block
 */
export function addStatement(state: CFGBuilderState, stmt: t.Statement): void {
  if (state.currentBlock) {
    state.currentBlock.addStatement(stmt);
  }
}

/**
 * Add multiple statements to the current block
 */
export function addStatements(state: CFGBuilderState, stmts: readonly t.Statement[]): void {
  for (const stmt of stmts) {
    addStatement(state, stmt);
  }
}

/**
 * Set the terminator for the current block
 */
export function setTerminator(state: CFGBuilderState, terminator: Terminator): void {
  if (state.currentBlock) {
    state.currentBlock.setTerminator(terminator);
  }
}

/**
 * Mark the current block as an exit block
 */
export function setExit(state: CFGBuilderState): void {
  if (state.currentBlock) {
    state.currentBlock.setExit();
    markExit(state, state.currentBlock.id);
  }
}

/**
 * Set fallthrough to a specific block
 */
export function setFallthrough(state: CFGBuilderState, next: NodeId): void {
  setTerminator(state, createFallthrough(next));
}

/**
 * Set return terminator
 */
export function setReturn(state: CFGBuilderState, argument: t.Expression | null): void {
  setTerminator(state, createReturn(argument));
}

/**
 * Set throw terminator
 */
export function setThrow(state: CFGBuilderState, argument: t.Expression): void {
  setTerminator(state, createThrow(argument));
}

// ============================================================================
// Scope Management
// ============================================================================

export function addDeclaration(state: CFGBuilderState, name: string): void {
  if (state.currentBlock) {
    state.currentBlock.addDeclaration(name);
  }
}

export function addReference(state: CFGBuilderState, name: string): void {
  if (state.currentBlock) {
    state.currentBlock.addReference(name);
  }
}

// ============================================================================
// Builder Factory
// ============================================================================

export function createBlockBuilder(id?: NodeId): BlockBuilder {
  return new BlockBuilderImpl(id);
}

/**
 * Create a complete CFG from builder state
 */
export function finalizeCFG(state: CFGBuilderState): {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, CFGEdge>;
  entry: NodeId;
  exits: Set<NodeId>;
} {
  // Finalize current block if exists
  if (state.currentBlock) {
    finalizeBlock(state);
  }

  // Ensure we have an entry block
  if (!state.entry && state.blocks.size > 0) {
    state.entry = state.blocks.keys().next().value;
  }

  return {
    blocks: new Map(state.blocks),
    edges: new Map(state.edges),
    entry: state.entry ?? generateNodeId(),
    exits: new Set(state.exits),
  };
}
