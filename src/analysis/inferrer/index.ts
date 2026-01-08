/**
 * Type Inferrer - Core type inference engine
 *
 * This is the main entry point for type inference.
 * It performs flow-sensitive type inference on JavaScript AST.
 */

import * as t from '@babel/types';
import type { TypeAnnotationResult } from '../../types/annotation.js';
import type { InferContext } from './context.js';
import { createEnv } from './context.js';
import { addBuiltins } from './builtins.js';
import { traverseProgram } from './traversal.js';

// Re-export types for external use
export type { InferContext } from './context.js';
export { createEnv, addBinding, lookupBinding, isArrayType } from './context.js';
export { addBuiltins } from './builtins.js';
export { addAnnotation } from './annotations.js';
export {
  inferExpression,
  inferFunctionType,
  inferClassType,
  inferArrayExpression,
  inferObjectExpression,
} from './expressions.js';
export {
  handleVariableDeclaration,
  handleFunctionDeclaration,
  handleClassDeclaration,
  handleDestructuringPattern,
  annotateParameters,
} from './declarations.js';
export { traverseProgram, traverseStatement, traverseExpression, traverseFunctionBody } from './traversal.js';

/**
 * Infer types for an entire program/file
 */
export function inferTypes(ast: t.File, source: string, filename: string): TypeAnnotationResult {
  const ctx: InferContext = {
    env: createEnv(null, 'module'),
    annotations: [],
    errors: [],
    source,
    filename,
  };

  // Add global/built-in bindings
  ctx.env = addBuiltins(ctx.env);

  // Traverse the AST using simple recursive traversal
  traverseProgram(ast.program, ctx);

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [], // TODO: collect scope info
  };
}
