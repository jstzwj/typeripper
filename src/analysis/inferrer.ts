/**
 * Type Inferrer - Core type inference engine
 *
 * This module has been refactored into smaller sub-modules for better maintainability.
 * See the `inferrer/` directory for the implementation:
 *
 * - inferrer/index.ts       - Main entry point
 * - inferrer/context.ts     - Context types and environment management
 * - inferrer/builtins.ts    - Built-in type definitions
 * - inferrer/expressions.ts - Expression type inference
 * - inferrer/declarations.ts - Declaration handling
 * - inferrer/traversal.ts   - AST traversal
 * - inferrer/annotations.ts - Annotation utilities
 */

// Re-export everything from the refactored module
export {
  inferTypes,
  type InferContext,
  createEnv,
  addBinding,
  lookupBinding,
  isArrayType,
  addBuiltins,
  addAnnotation,
  inferExpression,
  inferFunctionType,
  inferClassType,
  inferArrayExpression,
  inferObjectExpression,
  handleVariableDeclaration,
  handleFunctionDeclaration,
  handleClassDeclaration,
  handleDestructuringPattern,
  annotateParameters,
  traverseProgram,
  traverseStatement,
  traverseExpression,
  traverseFunctionBody,
} from './inferrer/index.js';
