/**
 * CFG Builder Types - Types and interfaces for CFG construction
 *
 * This module defines the types used during CFG construction.
 */

import * as t from '@babel/types';
import type {
  NodeId,
  EdgeId,
  CFGEdge,
  Terminator,
} from '../../types/index.js';

/**
 * Mutable block during CFG construction
 */
export interface MutableBlock {
  id: NodeId;
  statements: t.Statement[];
  isEntry: boolean;
  isExit: boolean;
  terminator: Terminator | null;
}

/**
 * Context for building CFG, tracks labels and loop targets
 */
export interface BuildContext {
  /** Current block being built */
  currentBlock: MutableBlock;
  /** All blocks created */
  blocks: Map<NodeId, MutableBlock>;
  /** All edges created */
  edges: Map<EdgeId, CFGEdge>;
  /** Label -> target block for break */
  breakTargets: Map<string | null, NodeId>;
  /** Label -> target block for continue */
  continueTargets: Map<string | null, NodeId>;
  /** Stack of try handlers for exception routing */
  tryHandlers: Array<{ catchBlock: NodeId | null; finallyBlock: NodeId | null }>;
}
