/**
 * Iterative Type Inferrer - CFG-based flow-sensitive type inference
 *
 * This module has been refactored into smaller sub-modules for better maintainability.
 * See the `iterative/` directory for the implementation:
 *
 * - iterative/index.ts      - Main entry point and iteration logic
 * - iterative/context.ts    - Context types and interfaces
 * - iterative/state.ts      - Type state management
 * - iterative/transfer.ts   - Transfer functions for statements
 * - iterative/expressions.ts - Expression type inference
 * - iterative/narrowing.ts  - Type narrowing logic
 * - iterative/builtins.ts   - Built-in type definitions
 * - iterative/annotations.ts - Annotation utilities
 */

// Re-export everything from the refactored module
export {
  inferTypesIterative,
  analyzeIterative,
  MAX_ITERATIONS,
  type IterativeContext,
  type HoistedDeclaration,
  type IterativeAnalysisResult,
} from './iterative/index.js';
