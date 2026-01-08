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
import { Types } from '../../utils/type-factory.js';

/**
 * Maximum iterations for fixed-point computation
 */
export const MAX_ITERATIONS = 100;

/**
 * Call site information for a function/constructor
 * Used for call-site-based parameter type inference
 */
export interface CallSiteInfo {
  /** The call/new expression node */
  node: t.CallExpression | t.NewExpression;
  /** Argument types at this call site */
  argTypes: Type[];
}

/**
 * Aggregated call information for a function/constructor
 * Stores the merged parameter types from all call sites
 */
export interface FunctionCallInfo {
  /** All call sites for this function */
  callSites: CallSiteInfo[];
  /** Merged parameter types from all call sites (union of all argument types) */
  paramTypes: Type[];
  /** For constructors: the inferred instance type based on paramTypes */
  instanceType?: Type;
}

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
  /** Variables that are modified inside loops (need widening) */
  modifiedInLoops: Set<string>;
  /**
   * Call site information for functions/constructors.
   * Key is the function name, value contains all call sites and merged param types.
   * This enables call-site-based parameter type inference.
   */
  functionCallInfo: Map<string, FunctionCallInfo>;
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

/**
 * Register a call site for a function/constructor.
 * Merges argument types with existing call sites to build union param types.
 */
export function registerCallSite(
  ctx: IterativeContext,
  funcName: string,
  node: t.CallExpression | t.NewExpression,
  argTypes: Type[]
): void {
  let callInfo = ctx.functionCallInfo.get(funcName);

  if (!callInfo) {
    // First call site for this function
    callInfo = {
      callSites: [{ node, argTypes }],
      paramTypes: argTypes.map((t) => t), // Clone
    };
    ctx.functionCallInfo.set(funcName, callInfo);
  } else {
    // Check if this exact node is already registered (avoid duplicates during iteration)
    const existingIndex = callInfo.callSites.findIndex((cs) => cs.node === node);
    if (existingIndex >= 0) {
      // Update existing call site's arg types (they may have become more precise)
      const existing = callInfo.callSites[existingIndex]!;
      existing.argTypes = argTypes;
    } else {
      // New call site
      callInfo.callSites.push({ node, argTypes });
    }

    // Rebuild merged param types from all call sites
    callInfo.paramTypes = mergeParamTypesFromCallSites(callInfo.callSites);
  }
}

/**
 * Merge parameter types from multiple call sites.
 * For each parameter position, creates a union of all argument types at that position.
 */
function mergeParamTypesFromCallSites(callSites: Array<{ argTypes: Type[] }>): Type[] {
  if (callSites.length === 0) return [];
  if (callSites.length === 1) return callSites[0]!.argTypes;

  // Find max param count across all call sites
  const maxParams = Math.max(...callSites.map((cs) => cs.argTypes.length));
  const result: Type[] = [];

  for (let i = 0; i < maxParams; i++) {
    // Collect types at position i from all call sites
    const typesAtPosition: Type[] = [];
    for (const cs of callSites) {
      if (i < cs.argTypes.length) {
        typesAtPosition.push(cs.argTypes[i]!);
      }
    }

    if (typesAtPosition.length === 0) {
      result.push(Types.undefined);
    } else if (typesAtPosition.length === 1) {
      result.push(typesAtPosition[0]!);
    } else {
      // Merge types - widen if they're all same primitive kind
      result.push(Types.widen(Types.union(typesAtPosition)));
    }
  }

  return result;
}
