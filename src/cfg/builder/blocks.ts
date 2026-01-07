/**
 * Block Management - Create and manage CFG blocks
 *
 * This module handles creation and management of basic blocks.
 */

import type {
  NodeId,
  EdgeId,
  EdgeKind,
  EdgeCondition,
  CFGEdge,
} from '../../types/index.js';
import type { MutableBlock, BuildContext } from './types.js';

let nodeIdCounter = 0;
let edgeIdCounter = 0;

export function generateNodeId(): NodeId {
  return `block_${++nodeIdCounter}`;
}

export function generateEdgeId(): EdgeId {
  return `edge_${++edgeIdCounter}`;
}

/**
 * Reset ID counters (for testing)
 */
export function resetCFGIds(): void {
  nodeIdCounter = 0;
  edgeIdCounter = 0;
}

export function createBlock(isEntry = false, isExit = false): MutableBlock {
  return {
    id: generateNodeId(),
    statements: [],
    isEntry,
    isExit,
    terminator: null,
  };
}

export function addEdge(
  context: BuildContext,
  source: NodeId,
  target: NodeId,
  kind: EdgeKind,
  condition?: EdgeCondition
): void {
  const edge: CFGEdge = {
    id: generateEdgeId(),
    source,
    target,
    kind,
    condition,
  };
  context.edges.set(edge.id, edge);
}

export function startNewBlock(context: BuildContext): MutableBlock {
  const block = createBlock();
  context.blocks.set(block.id, block);
  context.currentBlock = block;
  return block;
}
