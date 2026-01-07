/**
 * Iterative Context Types - Shared types for iterative inference
 *
 * This module defines the context and types used across the iterative inference modules.
 */

import * as t from '@babel/types';
import type {
  Type,
  TypeEnvironment,
  CFG,
  NodeId,
} from '../../types/index.js';
import type { TypeAnnotation } from '../../types/annotation.js';
import type { TypeState } from '../../types/analysis.js';

/**
 * Maximum iterations for fixed-point computation
 */
export const MAX_ITERATIONS = 100;

/**
 * Analysis context for iterative inference
 */
export interface IterativeContext {
  /** CFG for the current function/program */
  cfg: CFG;
  /** Type state at entry of each block */
  blockEntryStates: Map<NodeId, TypeState>;
  /** Type state at exit of each block */
  blockExitStates: Map<NodeId, TypeState>;
  /** Collected annotations */
  annotations: TypeAnnotation[];
  /** Collected errors */
  errors: Array<{ message: string; line: number; column: number; nodeType?: string }>;
  /** Source code */
  source: string;
  /** Filename */
  filename: string;
  /** Global environment (for builtins) */
  globalEnv: TypeEnvironment;
  /** Hoisted declarations (collected in first pass) */
  hoistedDeclarations: Map<string, HoistedDeclaration>;
}

/**
 * Hoisted declaration info (for forward references)
 */
export interface HoistedDeclaration {
  name: string;
  kind: 'var' | 'function' | 'class';
  node: t.Node;
  /** Initial type (undefined for var, function type for function, etc.) */
  initialType: Type;
}
