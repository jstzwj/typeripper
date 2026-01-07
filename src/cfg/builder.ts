/**
 * CFG Builder - Constructs Control Flow Graphs from JavaScript AST
 *
 * This module has been refactored into smaller sub-modules for better maintainability.
 * See the `builder/` directory for the implementation:
 *
 * - builder/index.ts     - Main entry point (buildCFG function)
 * - builder/types.ts     - Types and interfaces
 * - builder/blocks.ts    - Block management utilities
 * - builder/statements.ts - Statement processing
 * - builder/analysis.ts  - Dominator and back edge analysis
 */

// Re-export everything from the refactored module
export {
  buildCFG,
  type MutableBlock,
  type BuildContext,
  resetCFGIds,
  createBlock,
  addEdge,
  startNewBlock,
  generateNodeId,
  generateEdgeId,
  processStatements,
  processStatement,
  identifyBackEdges,
  computeDominators,
  computePostDominators,
} from './builder/index.js';
