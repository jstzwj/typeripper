/**
 * Typeripper - Flow-Sensitive JavaScript Type Inference Engine
 *
 * Main entry point for the type inference system
 */

// Parser
export { parse, parseExpression, traverseAST, Parser } from './parser/parser.js';
export type { ParseResult, ParseOptions } from './parser/parser.js';

// Types
export * from './types/types.js';
export * from './types/cfg.js';
export * from './types/analysis.js';

// Type Factory
export { Types, nullable, optional, primitive, numeric, widen, isNullable } from './utils/type-factory.js';
export type { Type } from './utils/type-factory.js';

// Type Formatting
export {
  formatType,
  formatTypeColored,
  formatTypeCompact,
  formatTypeVerbose,
} from './utils/format.js';

// CFG Builder
export {
  buildCFG,
  createCFGBuilderState,
  startBlock,
  finalizeBlock,
} from './cfg/builder/index.js';
export {
  computeDominators,
  computePostDominators,
  computeLoops,
  computeReversePostOrder,
} from './cfg/builder/analysis.js';

// Type Inference
export {
  inferTypes,
  inferTypesSimple,
} from './analysis/iterative/index.js';
export {
  createIterationContext,
  createBlockContext,
  addAnnotation,
  getAnnotations,
} from './analysis/iterative/context.js';

// Built-in Types
export { createBuiltinEnvironment } from './analysis/iterative/builtins.js';

// Output Formatting
export {
  formatAnnotationResult,
  formatAnnotation,
  formatForTerminal,
  formatAsJSON,
  formatAsTypeScript,
  formatInlineAnnotations,
  formatSummary,
} from './output/formatter.js';
