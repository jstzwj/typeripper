/**
 * Type Annotation Output Format
 *
 * This module defines how inferred types are attached to AST nodes
 * and how they are serialized to human-readable format.
 */

import type * as t from '@babel/types';
import type { Type } from './types.js';

/**
 * Which AST nodes need type annotations?
 *
 * 1. Declarations (variables, functions, classes, parameters)
 * 2. Expressions (for understanding intermediate types)
 * 3. Properties (object shapes)
 */

/**
 * Type annotation for a specific source location
 */
export interface TypeAnnotation {
  /** Start position in source */
  start: number;
  /** End position in source */
  end: number;
  /** Line number (1-based) */
  line: number;
  /** Column number (0-based) */
  column: number;
  /** The AST node type */
  nodeType: string;
  /** The identifier/expression name (if applicable) */
  name?: string;
  /** The inferred type */
  type: Type;
  /** Human-readable type string */
  typeString: string;
  /** Annotation kind */
  kind: AnnotationKind;
}

export type AnnotationKind =
  | 'variable'      // let x = ...
  | 'const'         // const x = ...
  | 'parameter'     // function(x, ...)
  | 'function'      // function foo() or const foo = () => ...
  | 'return'        // return type of function
  | 'property'      // object property
  | 'element'       // array element
  | 'expression'    // general expression
  | 'class'         // class declaration
  | 'method'        // class method
  | 'field';        // class field

/**
 * Complete type annotation result for a source file
 */
export interface TypeAnnotationResult {
  /** Source file path */
  filename: string;
  /** Original source code */
  source: string;
  /** All type annotations, sorted by position */
  annotations: TypeAnnotation[];
  /** Any errors during inference */
  errors: InferenceError[];
  /** Scope information */
  scopes: ScopeInfo[];
}

export interface InferenceError {
  message: string;
  line: number;
  column: number;
  nodeType?: string;
}

export interface ScopeInfo {
  /** Scope kind */
  kind: 'global' | 'function' | 'block' | 'class';
  /** Start position */
  start: number;
  /** End position */
  end: number;
  /** Variables declared in this scope */
  variables: Map<string, Type>;
}

/**
 * Map from AST node to its inferred type
 * We use a WeakMap so nodes can be garbage collected
 */
export type TypeMap = WeakMap<t.Node, Type>;

/**
 * Output format options
 */
export interface OutputOptions {
  /** Include expression types (verbose) */
  includeExpressions?: boolean;
  /** Include internal type IDs */
  includeTypeIds?: boolean;
  /** Format for output */
  format: 'inline' | 'json' | 'dts' | 'report';
  /** Indentation for JSON/report */
  indent?: number;
}
