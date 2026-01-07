/**
 * CFG Analysis - Dominator and back edge analysis
 *
 * This module handles CFG analysis including dominator computation
 * and back edge identification.
 */

import type {
  NodeId,
  EdgeId,
  CFGEdge,
} from '../../types/index.js';
import type { MutableBlock } from './types.js';

/**
 * Identify back edges using DFS
 */
export function identifyBackEdges(
  blocks: Map<NodeId, MutableBlock>,
  edges: Map<EdgeId, CFGEdge>,
  entry: NodeId
): Set<EdgeId> {
  const visited = new Set<NodeId>();
  const inStack = new Set<NodeId>();
  const backEdges = new Set<EdgeId>();

  function dfs(nodeId: NodeId): void {
    visited.add(nodeId);
    inStack.add(nodeId);

    for (const [edgeId, edge] of edges) {
      if (edge.source === nodeId) {
        if (inStack.has(edge.target)) {
          backEdges.add(edgeId);
        } else if (!visited.has(edge.target)) {
          dfs(edge.target);
        }
      }
    }

    inStack.delete(nodeId);
  }

  dfs(entry);
  return backEdges;
}

/**
 * Compute dominators using iterative dataflow
 */
export function computeDominators(
  blocks: Map<NodeId, MutableBlock>,
  predecessors: Map<NodeId, NodeId[]>,
  entry: NodeId
): Map<NodeId, Set<NodeId>> {
  const dominators = new Map<NodeId, Set<NodeId>>();

  // Initialize: entry dominates only itself, others dominated by all
  const allNodes = new Set(blocks.keys());
  for (const nodeId of blocks.keys()) {
    if (nodeId === entry) {
      dominators.set(nodeId, new Set([nodeId]));
    } else {
      dominators.set(nodeId, new Set(allNodes));
    }
  }

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of blocks.keys()) {
      if (nodeId === entry) continue;

      const preds = predecessors.get(nodeId) ?? [];
      let newDom: Set<NodeId> | null = null;

      for (const pred of preds) {
        const predDom = dominators.get(pred);
        if (predDom) {
          if (newDom === null) {
            newDom = new Set(predDom);
          } else {
            // Intersection
            for (const d of newDom) {
              if (!predDom.has(d)) {
                newDom.delete(d);
              }
            }
          }
        }
      }

      if (newDom === null) {
        newDom = new Set();
      }
      newDom.add(nodeId);

      const oldDom = dominators.get(nodeId)!;
      if (newDom.size !== oldDom.size || ![...newDom].every((d) => oldDom.has(d))) {
        dominators.set(nodeId, newDom);
        changed = true;
      }
    }
  }

  return dominators;
}

/**
 * Compute post-dominators (simplified)
 */
export function computePostDominators(
  blocks: Map<NodeId, MutableBlock>,
  successors: Map<NodeId, NodeId[]>,
  exits: NodeId[]
): Map<NodeId, Set<NodeId>> {
  const postDominators = new Map<NodeId, Set<NodeId>>();

  // Initialize
  const allNodes = new Set(blocks.keys());
  const exitSet = new Set(exits);

  for (const nodeId of blocks.keys()) {
    if (exitSet.has(nodeId)) {
      postDominators.set(nodeId, new Set([nodeId]));
    } else {
      postDominators.set(nodeId, new Set(allNodes));
    }
  }

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of blocks.keys()) {
      if (exitSet.has(nodeId)) continue;

      const succs = successors.get(nodeId) ?? [];
      let newPostDom: Set<NodeId> | null = null;

      for (const succ of succs) {
        const succPostDom = postDominators.get(succ);
        if (succPostDom) {
          if (newPostDom === null) {
            newPostDom = new Set(succPostDom);
          } else {
            for (const d of newPostDom) {
              if (!succPostDom.has(d)) {
                newPostDom.delete(d);
              }
            }
          }
        }
      }

      if (newPostDom === null) {
        newPostDom = new Set();
      }
      newPostDom.add(nodeId);

      const oldPostDom = postDominators.get(nodeId)!;
      if (newPostDom.size !== oldPostDom.size || ![...newPostDom].every((d) => oldPostDom.has(d))) {
        postDominators.set(nodeId, newPostDom);
        changed = true;
      }
    }
  }

  return postDominators;
}
