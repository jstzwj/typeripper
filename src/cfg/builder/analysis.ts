/**
 * CFG Analysis Utilities
 * Functions for computing dominators, back edges, loops, and reverse post-order traversal
 */

import type {
  NodeId,
  EdgeId,
  CFG,
  BasicBlock,
  LoopInfo,
} from '../../types/cfg.js';
import {
  isBranch,
  isBackEdge,
  isBranchEdge,
} from '../../types/cfg.js';

// ============================================================================
// Dominator Analysis
// ============================================================================

/**
 * Compute dominators for all nodes in the CFG
 * A node d dominates node n if every path from entry to n must go through d
 */
export function computeDominators(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  entry: NodeId;
}): Map<NodeId, Set<NodeId>> {
  const dominators = new Map<NodeId, Set<NodeId>>();

  // Initialize: entry dominates itself, all nodes are dominated by all nodes
  for (const nodeId of cfg.blocks.keys()) {
    if (nodeId === cfg.entry) {
      dominators.set(nodeId, new Set([cfg.entry]));
    } else {
      dominators.set(nodeId, new Set(cfg.blocks.keys()));
    }
  }

  // Iteratively compute dominators until fixed point
  let changed = true;
  while (changed) {
    changed = false;

    for (const [nodeId, block] of cfg.blocks) {
      if (nodeId === cfg.entry) continue;

      // Get predecessors of this node
      const predecessors = getPredecessors(nodeId, cfg.edges);

      if (predecessors.length === 0) continue;

      // Intersection of predecessors' dominators
      const newDoms = new Set<NodeId>();
      newDoms.add(nodeId);

      const firstPred = predecessors[0]!;
      const firstPredDoms = dominators.get(firstPred);
      if (firstPredDoms) {
        for (const d of firstPredDoms) {
          let dominatedByAll = true;
          for (let i = 1; i < predecessors.length; i++) {
            const predDoms = dominators.get(predecessors[i]!);
            if (!predDoms || !predDoms.has(d)) {
              dominatedByAll = false;
              break;
            }
          }
          if (dominatedByAll) {
            newDoms.add(d);
          }
        }
      }

      const oldDoms = dominators.get(nodeId);
      if (!oldDoms || !setsEqual(oldDoms, newDoms)) {
        dominators.set(nodeId, newDoms);
        changed = true;
      }
    }
  }

  return dominators;
}

/**
 * Compute immediate dominators (idom)
 * The immediate dominator of a node is the unique strict dominator closest to it
 */
export function computeImmediateDominators(
  dominators: Map<NodeId, Set<NodeId>>,
  entry: NodeId
): Map<NodeId, NodeId | null> {
  const idom = new Map<NodeId, NodeId | null>();

  for (const [nodeId, doms] of dominators) {
    if (nodeId === entry) {
      idom.set(nodeId, null);
      continue;
    }

    // Find strict dominators (excluding the node itself)
    const strictDoms = new Set(doms);
    strictDoms.delete(nodeId);

    if (strictDoms.size === 0) {
      idom.set(nodeId, null);
      continue;
    }

    // Find the strict dominator that is dominated by all other strict dominators
    let immediate: NodeId | null = null;
    for (const d of strictDoms) {
      let isImmediate = true;
      for (const other of strictDoms) {
        if (d !== other && dominators.get(other)?.has(d)) {
          // d is dominated by another strict dominator
          isImmediate = false;
          break;
        }
      }
      if (isImmediate) {
        immediate = d;
        break;
      }
    }

    idom.set(nodeId, immediate);
  }

  return idom;
}

/**
 * Compute dominance frontier
 * The dominance frontier of a node is the set of nodes where its dominance ends
 */
export function computeDominanceFrontier(
  cfg: {
    blocks: Map<NodeId, BasicBlock>;
    edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  },
  idom: Map<NodeId, NodeId | null>
): Map<NodeId, NodeId[]> {
  const frontier = new Map<NodeId, NodeId[]>();

  for (const [nodeId, _] of cfg.blocks) {
    frontier.set(nodeId, []);
  }

  for (const [nodeId, block] of cfg.blocks) {
    const predecessors = getPredecessors(nodeId, cfg.edges);

    if (predecessors.length < 2) continue;

    for (const pred of predecessors) {
      let runner = pred;
      while (runner !== null && runner !== idom.get(nodeId)) {
        const currentFrontier = frontier.get(runner) ?? [];
        if (!currentFrontier.includes(nodeId)) {
          currentFrontier.push(nodeId);
          frontier.set(runner, currentFrontier);
        }
        runner = idom.get(runner) ?? null;
      }
    }
  }

  return frontier;
}

// ============================================================================
// Post-Dominator Analysis
// ============================================================================

/**
 * Compute post-dominators for all nodes in the CFG
 * A node d post-dominates node n if every path from n to an exit must go through d
 */
export function computePostDominators(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  exits: NodeId[];
}): Map<NodeId, Set<NodeId>> {
  const postDominators = new Map<NodeId, Set<NodeId>>();
  const exitSet = new Set(cfg.exits);

  // Initialize: exits post-dominate themselves, all nodes are post-dominated by all nodes
  for (const nodeId of cfg.blocks.keys()) {
    if (exitSet.has(nodeId)) {
      postDominators.set(nodeId, new Set([nodeId]));
    } else {
      postDominators.set(nodeId, new Set(cfg.blocks.keys()));
    }
  }

  // Iteratively compute post-dominators until fixed point
  let changed = true;
  while (changed) {
    changed = false;

    // Process in reverse topological order
    const reverseOrder = Array.from(cfg.blocks.keys()).reverse();

    for (const nodeId of reverseOrder) {
      if (exitSet.has(nodeId)) continue;

      // Get successors of this node
      const successors = getSuccessors(nodeId, cfg.edges);

      if (successors.length === 0) continue;

      // Intersection of successors' post-dominators
      const newPostDoms = new Set<NodeId>();
      newPostDoms.add(nodeId);

      const firstSucc = successors[0]!;
      const firstSuccPostDoms = postDominators.get(firstSucc);
      if (firstSuccPostDoms) {
        for (const d of firstSuccPostDoms) {
          let postDominatedByAll = true;
          for (let i = 1; i < successors.length; i++) {
            const succPostDoms = postDominators.get(successors[i]!);
            if (!succPostDoms || !succPostDoms.has(d)) {
              postDominatedByAll = false;
              break;
            }
          }
          if (postDominatedByAll) {
            newPostDoms.add(d);
          }
        }
      }

      const oldPostDoms = postDominators.get(nodeId);
      if (!oldPostDoms || !setsEqual(oldPostDoms, newPostDoms)) {
        postDominators.set(nodeId, newPostDoms);
        changed = true;
      }
    }
  }

  return postDominators;
}

// ============================================================================
// Loop Detection
// ============================================================================

/**
 * Identify back edges in the CFG
 * A back edge is an edge that points to a dominator of its source
 */
export function identifyBackEdges(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId; kind?: string }>;
  entry: NodeId;
}): Set<EdgeId> {
  const dominators = computeDominators(cfg);
  const backEdges = new Set<EdgeId>();

  for (const [edgeId, edge] of cfg.edges) {
    if (edge.kind === 'back-edge') {
      backEdges.add(edgeId);
      continue;
    }

    const sourceDoms = dominators.get(edge.source);
    if (sourceDoms && sourceDoms.has(edge.target)) {
      // Edge from node to its dominator is a back edge
      backEdges.add(edgeId);
    }
  }

  return backEdges;
}

/**
 * Compute loop information for all natural loops in the CFG
 * Each back edge defines a natural loop
 */
export function computeLoops(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId; kind?: string }>;
  entry: NodeId;
}): Map<NodeId, LoopInfo> {
  const backEdges = identifyBackEdges(cfg);
  const loops = new Map<NodeId, LoopInfo>();

  for (const edgeId of backEdges) {
    const edge = cfg.edges.get(edgeId)!;
    const header = edge.target;
    const latch = edge.source;

    // Find all nodes in the loop
    const loopNodes = new Set<NodeId>([header]);
    collectLoopNodes(latch, header, cfg.edges, loopNodes);

    // Find loop exits (edges from loop nodes to non-loop nodes)
    const exits = new Set<NodeId>();
    for (const nodeId of loopNodes) {
      for (const [eId, e] of cfg.edges) {
        if (e.source === nodeId && !loopNodes.has(e.target)) {
          exits.add(e.target);
        }
      }
    }

    const existingLoop = loops.get(header);
    const loop: LoopInfo = {
      header,
      body: Array.from(loopNodes),
      exits: Array.from(exits),
      backEdges: existingLoop ? [...existingLoop.backEdges, edgeId] : [edgeId],
    };

    loops.set(header, loop);
  }

  return loops;
}

/**
 * Collect all nodes in a loop using DFS
 */
function collectLoopNodes(
  node: NodeId,
  header: NodeId,
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>,
  visited: Set<NodeId>
): void {
  if (visited.has(node) || node === header) return;

  visited.add(node);

  // Follow all predecessors to find nodes that can reach the header
  for (const [edgeId, edge] of edges) {
    if (edge.target === node) {
      collectLoopNodes(edge.source, header, edges, visited);
    }
  }
}

/**
 * Get loop header for a given block
 */
export function getLoopHeader(
  nodeId: NodeId,
  loops: Map<NodeId, LoopInfo>
): NodeId | null {
  for (const [header, loop] of loops) {
    if (loop.body.includes(nodeId) && nodeId !== header) {
      return header;
    }
  }
  return null;
}

/**
 * Check if a node is a loop header
 */
export function isLoopHeader(nodeId: NodeId, loops: Map<NodeId, LoopInfo>): boolean {
  return loops.has(nodeId);
}

/**
 * Check if a node is inside a loop
 */
export function isInLoop(nodeId: NodeId, loops: Map<NodeId, LoopInfo>): boolean {
  for (const loop of loops.values()) {
    if (loop.body.includes(nodeId)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Topological Ordering
// ============================================================================

/**
 * Compute reverse post-order traversal of the CFG
 * This is a good order for fixed-point iteration
 */
export function computeReversePostOrder(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  entry: NodeId;
}): NodeId[] {
  const postOrder = computePostOrder(cfg);
  return postOrder.reverse();
}

/**
 * Compute post-order traversal of the CFG
 */
export function computePostOrder(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  entry: NodeId;
}): NodeId[] {
  const visited = new Set<NodeId>();
  const result: NodeId[] = [];

  function dfs(nodeId: NodeId): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const successors = getSuccessors(nodeId, cfg.edges);
    for (const succ of successors) {
      dfs(succ);
    }

    result.push(nodeId);
  }

  dfs(cfg.entry);

  return result;
}

/**
 * Compute pre-order traversal of the CFG
 */
export function computePreOrder(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  entry: NodeId;
}): NodeId[] {
  const visited = new Set<NodeId>();
  const result: NodeId[] = [];

  function dfs(nodeId: NodeId): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    result.push(nodeId);

    const successors = getSuccessors(nodeId, cfg.edges);
    for (const succ of successors) {
      dfs(succ);
    }
  }

  dfs(cfg.entry);

  return result;
}

// ============================================================================
// Control Flow Queries
// ============================================================================

/**
 * Get all predecessors of a node
 */
export function getPredecessors(
  nodeId: NodeId,
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>
): NodeId[] {
  const predecessors: NodeId[] = [];
  for (const edge of edges.values()) {
    if (edge.target === nodeId) {
      predecessors.push(edge.source);
    }
  }
  return predecessors;
}

/**
 * Get all successors of a node
 */
export function getSuccessors(
  nodeId: NodeId,
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>
): NodeId[] {
  const successors: NodeId[] = [];
  for (const edge of edges.values()) {
    if (edge.source === nodeId) {
      successors.push(edge.target);
    }
  }
  return successors;
}

/**
 * Build predecessor and successor maps for the entire CFG
 */
export function buildPredecessorSuccessorMaps(cfg: {
  blocks: Map<NodeId, BasicBlock>;
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
}): {
  predecessors: Map<NodeId, NodeId[]>;
  successors: Map<NodeId, NodeId[]>;
} {
  const predecessors = new Map<NodeId, NodeId[]>();
  const successors = new Map<NodeId, NodeId[]>();

  for (const nodeId of cfg.blocks.keys()) {
    predecessors.set(nodeId, []);
    successors.set(nodeId, []);
  }

  for (const edge of cfg.edges.values()) {
    predecessors.get(edge.target)?.push(edge.source);
    successors.get(edge.source)?.push(edge.target);
  }

  return { predecessors, successors };
}

/**
 * Check if a path exists between two nodes
 */
export function pathExists(
  from: NodeId,
  to: NodeId,
  edges: Map<EdgeId, { source: NodeId; target: NodeId }>
): boolean {
  const visited = new Set<NodeId>();

  function dfs(nodeId: NodeId): boolean {
    if (nodeId === to) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);

    for (const succ of getSuccessors(nodeId, edges)) {
      if (dfs(succ)) return true;
    }

    return false;
  }

  return dfs(from);
}

// ============================================================================
// Variable Analysis
// ============================================================================

/**
 * Find variables that are modified within loops
 * These need widening to ensure termination
 */
export function findLoopModifiedVariables(
  cfg: {
    blocks: Map<NodeId, BasicBlock>;
    edges: Map<EdgeId, { source: NodeId; target: NodeId }>;
  },
  loops: Map<NodeId, LoopInfo>
): Set<string> {
  const modified = new Set<string>();

  for (const loop of loops.values()) {
    for (const nodeId of loop.body) {
      const block = cfg.blocks.get(nodeId);
      if (block?.scope) {
        for (const ref of block.scope.references) {
          modified.add(ref);
        }
      }
    }
  }

  return modified;
}

// ============================================================================
// Utility Functions
// ============================================================================

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * Build a complete CFG structure with all analysis results
 */
export function buildCompleteCFG(
  blocks: Map<NodeId, BasicBlock>,
  edges: Map<EdgeId, { source: NodeId; target: NodeId; kind?: string; condition?: any }>,
  entry: NodeId,
  exits: NodeId[]
): CFG {
  const edgeMap = new Map<EdgeId, any>();

  for (const [id, e] of edges) {
    edgeMap.set(id, {
      id,
      source: e.source,
      target: e.target,
      kind: e.kind ?? 'normal',
      condition: e.condition,
    });
  }

  // Compute predecessor and successor maps
  const { predecessors, successors } = buildPredecessorSuccessorMaps({ blocks, edges });

  // Identify back edges
  const backEdges = identifyBackEdges({ blocks, edges, entry });

  // Mark back edges in edge map
  for (const id of backEdges) {
    const edge = edgeMap.get(id);
    if (edge) {
      edgeMap.set(id, { ...edge, kind: 'back-edge' });
    }
  }

  // Compute dominators
  const dominators = computeDominators({ blocks, edges, entry });
  const immediateDominator = computeImmediateDominators(dominators, entry);
  const dominanceFrontier = computeDominanceFrontier({ blocks, edges }, immediateDominator);

  // Compute post-dominators
  const postDominators = computePostDominators({ blocks, edges, exits });

  // Compute loops
  const loops = computeLoops({ blocks, edges: edgeMap, entry } as {
    blocks: Map<NodeId, BasicBlock>;
    edges: Map<string, { source: NodeId; target: NodeId; kind?: string }>;
    entry: NodeId;
  });

  return {
    blocks,
    edges: edgeMap,
    entry,
    exits,
    predecessors,
    successors,
    backEdges,
    loops,
    dominators,
    postDominators,
    immediateDominator,
    dominanceFrontier,
  };
}
