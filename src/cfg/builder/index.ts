/**
 * CFG Builder - Constructs Control Flow Graphs from JavaScript AST
 *
 * This is the main entry point for CFG construction.
 */

import * as t from '@babel/types';
import type {
  CFG,
  BasicBlock,
  NodeId,
} from '../../types/index.js';
import type { BuildContext } from './types.js';
import { createBlock, addEdge, resetCFGIds } from './blocks.js';
import { processStatements } from './statements.js';
import { identifyBackEdges, computeDominators, computePostDominators } from './analysis.js';

// Re-export types and utilities
export type { MutableBlock, BuildContext } from './types.js';
export { resetCFGIds, createBlock, addEdge, startNewBlock, generateNodeId, generateEdgeId } from './blocks.js';
export { processStatements, processStatement } from './statements.js';
export { identifyBackEdges, computeDominators, computePostDominators } from './analysis.js';

/**
 * Build a CFG from a function or program body
 */
export function buildCFG(body: t.Statement[] | t.BlockStatement): CFG {
  resetCFGIds();

  const statements = Array.isArray(body) ? body : body.body;

  // Create entry and exit blocks
  const entryBlock = createBlock(true, false);
  const exitBlock = createBlock(false, true);
  exitBlock.terminator = { kind: 'return', argument: null };

  const context: BuildContext = {
    currentBlock: entryBlock,
    blocks: new Map([[entryBlock.id, entryBlock], [exitBlock.id, exitBlock]]),
    edges: new Map(),
    breakTargets: new Map(),
    continueTargets: new Map(),
    tryHandlers: [],
  };

  // Process all statements
  processStatements(statements, context, exitBlock.id);

  // Finalize the current block if it doesn't have a terminator
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: exitBlock.id };
    addEdge(context, context.currentBlock.id, exitBlock.id, 'normal');
  }

  // Build predecessor/successor maps
  const predecessors = new Map<NodeId, NodeId[]>();
  const successors = new Map<NodeId, NodeId[]>();

  for (const [, block] of context.blocks) {
    predecessors.set(block.id, []);
    successors.set(block.id, []);
  }

  for (const [, edge] of context.edges) {
    const preds = predecessors.get(edge.target);
    if (preds) preds.push(edge.source);
    const succs = successors.get(edge.source);
    if (succs) succs.push(edge.target);
  }

  // Identify back edges (for loops)
  const backEdges = identifyBackEdges(context.blocks, context.edges, entryBlock.id);

  // Find all exit blocks
  const exits: NodeId[] = [];
  for (const [, block] of context.blocks) {
    if (block.isExit || (block.terminator && block.terminator.kind === 'return')) {
      exits.push(block.id);
    }
  }

  // Compute dominators (simplified)
  const dominators = computeDominators(context.blocks, predecessors, entryBlock.id);
  const postDominators = computePostDominators(context.blocks, successors, exits);

  // Convert mutable blocks to immutable
  const immutableBlocks = new Map<NodeId, BasicBlock>();
  for (const [id, block] of context.blocks) {
    immutableBlocks.set(id, {
      id: block.id,
      statements: block.statements,
      isEntry: block.isEntry,
      isExit: block.isExit,
      terminator: block.terminator ?? { kind: 'fallthrough', next: exitBlock.id },
    });
  }

  return {
    blocks: immutableBlocks,
    edges: context.edges,
    entry: entryBlock.id,
    exits,
    predecessors: new Map([...predecessors].map(([k, v]) => [k, [...v]])),
    successors: new Map([...successors].map(([k, v]) => [k, [...v]])),
    backEdges,
    dominators,
    postDominators,
  };
}
