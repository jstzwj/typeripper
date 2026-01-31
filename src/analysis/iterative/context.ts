/**
 * Iterative Analysis Context
 * Shared context for type inference analysis
 */

import type * as t from '@babel/types';
import type { Type } from '../../types/types.js';
import type {
  TypeEnvironment,
  TypeState,
} from '../../types/analysis.js';
import type {
  CFG,
  NodeId,
  LoopInfo,
} from '../../types/cfg.js';
import { createEnvironment, createInitialState } from '../../types/analysis.js';
import { createBuiltinEnvironment as createBuiltins } from './builtins.js';

// ============================================================================
// Iteration Context
// ============================================================================

export interface IterationContext {
  // The CFG being analyzed
  readonly cfg: CFG;

  // Source code information
  readonly source: string;
  readonly filename: string;

  // Global environment with builtins
  readonly globalEnv: TypeEnvironment;

  // Variables modified in loops (for widening)
  readonly modifiedInLoops: ReadonlySet<string>;

  // Hoisted declarations (var, function)
  readonly hoistedDeclarations: ReadonlyMap<string, t.Node>;

  // Type annotations being collected
  readonly annotations: TypeAnnotation[];

  // Analysis limits
  readonly maxIterations: number;
  readonly iterationCount: IterationCounter;

  // Widen threshold for unions
  readonly widenThreshold: number;
}

export interface IterationCounter {
  value: number;
}

// ============================================================================
// Block Analysis Context
// ============================================================================

export interface BlockContext {
  readonly blockId: NodeId;
  readonly state: TypeState;
  readonly loopInfo: LoopInfo | null;
  readonly isLoopHeader: boolean;
  readonly isLoopExit: boolean;
  readonly isMergePoint: boolean;
}

// ============================================================================
// Create Context
// ============================================================================

export function createIterationContext(
  cfg: CFG,
  source: string,
  filename: string,
  options: Partial<IterationContextOptions> = {}
): IterationContext {
  const opts: IterationContextOptions = {
    maxIterations: 100,
    widenThreshold: 10,
    ...options,
  };

  // Collect variables modified in loops
  const modifiedInLoops = collectModifiedInLoops(cfg);

  return {
    cfg,
    source,
    filename,
    globalEnv: createBuiltins(),
    modifiedInLoops,
    hoistedDeclarations: new Map(),
    annotations: [],
    maxIterations: opts.maxIterations,
    iterationCount: { value: 0 },
    widenThreshold: opts.widenThreshold,
  };
}

export interface IterationContextOptions {
  readonly maxIterations: number;
  readonly widenThreshold: number;
}

// ============================================================================
// Collect Variables Modified in Loops
// ============================================================================

function collectModifiedInLoops(cfg: CFG): Set<string> {
  const modified = new Set<string>();

  for (const [header, loop] of cfg.loops) {
    for (const nodeId of loop.body) {
      const block = cfg.blocks.get(nodeId);
      if (block?.scope) {
        // Find variables that are both declared and referenced in the loop
        for (const ref of block.scope.references) {
          if (block.scope.declarations.has(ref)) {
            modified.add(ref);
          }
        }
      }
    }
  }

  return modified;
}

// ============================================================================
// Block Context Creation
// ============================================================================

export function createBlockContext(
  blockId: NodeId,
  state: TypeState,
  cfg: CFG
): BlockContext {
  const loopInfo = Array.from(cfg.loops.values()).find(
    loop => loop.header === blockId || loop.body.includes(blockId)
  ) ?? null;

  const isLoopHeader = cfg.loops.has(blockId);

  const isLoopExit = Array.from(cfg.loops.values()).some(
    loop => loop.exits.includes(blockId)
  );

  // Check if this is a merge point (has multiple predecessors)
  const predecessors = cfg.predecessors.get(blockId) ?? [];
  const isMergePoint = predecessors.length > 1;

  return {
    blockId,
    state,
    loopInfo,
    isLoopHeader,
    isLoopExit,
    isMergePoint,
  };
}

// ============================================================================
// Type Annotation Tracking
// ============================================================================

export interface TypeAnnotation {
  readonly node: t.Node;
  readonly name: string | null;
  readonly type: Type;
  readonly kind?: 'variable' | 'function' | 'class' | 'parameter' | 'property' | 'return';
  readonly scope?: TypeEnvironment;
}

export function addAnnotation(
  context: IterationContext,
  annotation: TypeAnnotation
): void {
  context.annotations.push(annotation);
}

export function getAnnotations(
  context: IterationContext
): readonly TypeAnnotation[] {
  return context.annotations;
}

// ============================================================================
// Context Helpers
// ============================================================================

export function isLoopHeader(blockId: NodeId, cfg: CFG): boolean {
  return cfg.loops.has(blockId);
}

export function isInLoop(blockId: NodeId, cfg: CFG): boolean {
  for (const loop of cfg.loops.values()) {
    if (loop.body.includes(blockId)) {
      return true;
    }
  }
  return false;
}

export function getLoopForBlock(blockId: NodeId, cfg: CFG): LoopInfo | null {
  for (const loop of cfg.loops.values()) {
    if (loop.header === blockId || loop.body.includes(blockId)) {
      return loop;
    }
  }
  return null;
}

export function shouldWidenType(
  varName: string,
  context: IterationContext
): boolean {
  return context.modifiedInLoops.has(varName);
}

export function incrementIteration(context: IterationContext): void {
  context.iterationCount.value++;
}

export function shouldContinue(context: IterationContext): boolean {
  return context.iterationCount.value < context.maxIterations;
}

export function resetIterationCount(context: IterationContext): void {
  context.iterationCount.value = 0;
}

// ============================================================================
// State Management Helpers
// ============================================================================

export function createEntryState(
  context: IterationContext
): TypeState {
  return createInitialState(context.globalEnv);
}

export function createUnreachableState(
  context: IterationContext
): TypeState {
  return {
    env: context.globalEnv,
    reachable: false,
    loopDepth: 0,
    inTryBlock: false,
    modifiedVars: new Set(),
  };
}
