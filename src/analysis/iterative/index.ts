/**
 * Iterative Type Inferrer - CFG-based flow-sensitive type inference
 *
 * This is the main entry point for iterative type inference.
 * It coordinates the fixed-point iteration using the CFG.
 */

import * as t from '@babel/types';
import type { NodeId } from '../../types/index.js';
import type { TypeAnnotationResult } from '../../types/annotation.js';
import type { TypeState } from '../../types/analysis.js';
import { buildCFG } from '../../cfg/builder.js';
import type { IterativeContext, HoistedDeclaration } from './context.js';
import { MAX_ITERATIONS } from './context.js';
import {
  createEnv,
  createInitialState,
  createUnreachableState,
  updateBinding,
  joinStates,
  statesEqual,
} from './state.js';
import { narrowTypeByCondition } from './narrowing.js';
import { addBuiltins } from './builtins.js';
import { transfer } from './transfer.js';
import { collectHoistedDeclarations, computeReversePostOrder } from './expressions.js';

// Re-export types for external use
export type { IterativeContext, HoistedDeclaration } from './context.js';
export { MAX_ITERATIONS } from './context.js';

/**
 * Extended analysis result with CFG information
 */
export interface IterativeAnalysisResult extends TypeAnnotationResult {
  /** CFG used for analysis */
  cfg: ReturnType<typeof buildCFG>;
  /** Entry states for each block */
  blockEntryStates: ReadonlyMap<NodeId, TypeState>;
  /** Exit states for each block */
  blockExitStates: ReadonlyMap<NodeId, TypeState>;
  /** Number of iterations to converge */
  iterations: number;
}

/**
 * Main entry point: Iterative type inference using CFG
 */
export function inferTypesIterative(
  ast: t.File,
  source: string,
  filename: string
): TypeAnnotationResult {
  // Build CFG from program body
  const cfg = buildCFG(ast.program.body);

  // Create global environment with builtins
  const globalEnv = addBuiltins(createEnv(null, 'module'));

  // Collect hoisted declarations
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(ast.program.body, hoistedDeclarations);

  // Initialize context
  const ctx: IterativeContext = {
    cfg,
    blockEntryStates: new Map(),
    blockExitStates: new Map(),
    annotations: [],
    errors: [],
    source,
    filename,
    globalEnv,
    hoistedDeclarations,
  };

  // Initialize entry state with hoisted declarations
  let entryEnv = globalEnv;
  for (const [name, decl] of hoistedDeclarations) {
    entryEnv = updateBinding(entryEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // Initialize all blocks with bottom state (unreachable)
  for (const [blockId] of cfg.blocks) {
    ctx.blockEntryStates.set(blockId, createUnreachableState(globalEnv));
    ctx.blockExitStates.set(blockId, createUnreachableState(globalEnv));
  }

  // Entry block starts as reachable
  ctx.blockEntryStates.set(cfg.entry, createInitialState(entryEnv));

  // Compute reverse post-order for efficient iteration
  const rpo = computeReversePostOrder(cfg);

  // Fixed-point iteration
  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const blockId of rpo) {
      const block = cfg.blocks.get(blockId);
      if (!block) continue;

      // Compute entry state by joining predecessor exit states
      const predecessors = cfg.predecessors.get(blockId) ?? [];
      let newEntryState: TypeState;

      if (block.isEntry) {
        // Entry block keeps its initial state
        newEntryState = ctx.blockEntryStates.get(blockId)!;
      } else if (predecessors.length === 0) {
        // No predecessors - unreachable
        newEntryState = createUnreachableState(globalEnv);
      } else {
        // Join all predecessor exit states
        const predStates: TypeState[] = [];
        for (const predId of predecessors) {
          const predExitState = ctx.blockExitStates.get(predId);
          if (predExitState) {
            // Apply edge conditions for narrowing
            const edge = [...cfg.edges.values()].find(
              (e) => e.source === predId && e.target === blockId
            );
            const narrowedState = narrowTypeByCondition(predExitState, edge?.condition);
            predStates.push(narrowedState);
          }
        }
        newEntryState = predStates.length > 0 ? joinStates(predStates) : createUnreachableState(globalEnv);
      }

      // Check if entry state changed
      const oldEntryState = ctx.blockEntryStates.get(blockId)!;
      if (!statesEqual(oldEntryState, newEntryState)) {
        ctx.blockEntryStates.set(blockId, newEntryState);
        changed = true;
      }

      // Compute exit state via transfer function
      const newExitState = transfer(block, newEntryState, ctx);

      // Check if exit state changed
      const oldExitState = ctx.blockExitStates.get(blockId)!;
      if (!statesEqual(oldExitState, newExitState)) {
        ctx.blockExitStates.set(blockId, newExitState);
        changed = true;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    ctx.errors.push({
      message: `Type inference did not converge after ${MAX_ITERATIONS} iterations`,
      line: 0,
      column: 0,
    });
  }

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [],
  };
}

/**
 * Full iterative analysis with detailed results
 */
export function analyzeIterative(
  ast: t.File,
  source: string,
  filename: string
): IterativeAnalysisResult {
  // Build CFG from program body
  const cfg = buildCFG(ast.program.body);

  // Create global environment with builtins
  const globalEnv = addBuiltins(createEnv(null, 'module'));

  // Collect hoisted declarations
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(ast.program.body, hoistedDeclarations);

  // Initialize context
  const ctx: IterativeContext = {
    cfg,
    blockEntryStates: new Map(),
    blockExitStates: new Map(),
    annotations: [],
    errors: [],
    source,
    filename,
    globalEnv,
    hoistedDeclarations,
  };

  // Initialize entry state with hoisted declarations
  let entryEnv = globalEnv;
  for (const [name, decl] of hoistedDeclarations) {
    entryEnv = updateBinding(entryEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // Initialize all blocks
  for (const [blockId] of cfg.blocks) {
    ctx.blockEntryStates.set(blockId, createUnreachableState(globalEnv));
    ctx.blockExitStates.set(blockId, createUnreachableState(globalEnv));
  }

  ctx.blockEntryStates.set(cfg.entry, createInitialState(entryEnv));

  const rpo = computeReversePostOrder(cfg);

  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const blockId of rpo) {
      const block = cfg.blocks.get(blockId);
      if (!block) continue;

      const predecessors = cfg.predecessors.get(blockId) ?? [];
      let newEntryState: TypeState;

      if (block.isEntry) {
        newEntryState = ctx.blockEntryStates.get(blockId)!;
      } else if (predecessors.length === 0) {
        newEntryState = createUnreachableState(globalEnv);
      } else {
        const predStates: TypeState[] = [];
        for (const predId of predecessors) {
          const predExitState = ctx.blockExitStates.get(predId);
          if (predExitState) {
            const edge = [...cfg.edges.values()].find(
              (e) => e.source === predId && e.target === blockId
            );
            const narrowedState = narrowTypeByCondition(predExitState, edge?.condition);
            predStates.push(narrowedState);
          }
        }
        newEntryState = predStates.length > 0 ? joinStates(predStates) : createUnreachableState(globalEnv);
      }

      const oldEntryState = ctx.blockEntryStates.get(blockId)!;
      if (!statesEqual(oldEntryState, newEntryState)) {
        ctx.blockEntryStates.set(blockId, newEntryState);
        changed = true;
      }

      const newExitState = transfer(block, newEntryState, ctx);

      const oldExitState = ctx.blockExitStates.get(blockId)!;
      if (!statesEqual(oldExitState, newExitState)) {
        ctx.blockExitStates.set(blockId, newExitState);
        changed = true;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    ctx.errors.push({
      message: `Type inference did not converge after ${MAX_ITERATIONS} iterations`,
      line: 0,
      column: 0,
    });
  }

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [],
    cfg,
    blockEntryStates: ctx.blockEntryStates,
    blockExitStates: ctx.blockExitStates,
    iterations,
  };
}
