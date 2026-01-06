/**
 * JavaScript Parser wrapper
 *
 * Uses @babel/parser to parse JavaScript code into AST
 */

import { parse as babelParse, type ParserOptions } from '@babel/parser';
import type * as t from '@babel/types';

export interface ParseOptions {
  /** Source filename (for error messages) */
  filename?: string;
  /** Enable JSX parsing */
  jsx?: boolean;
  /** Enable TypeScript parsing (for comparison/testing) */
  typescript?: boolean;
  /** Source type */
  sourceType?: 'script' | 'module' | 'unambiguous';
}

export interface ParseResult {
  /** The parsed AST */
  ast: t.File;
  /** Any parsing errors */
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
}

/**
 * Parse JavaScript source code into an AST
 */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const parserOptions: ParserOptions = {
    sourceType: options.sourceType ?? 'unambiguous',
    sourceFilename: options.filename,
    errorRecovery: true, // Continue parsing after errors
    plugins: [
      // ECMAScript 2024+ features
      'asyncDoExpressions',
      'decimal',
      'decorators',
      'decoratorAutoAccessors',
      'deferredImportEvaluation',
      'destructuringPrivate',
      'doExpressions',
      'explicitResourceManagement',
      'exportDefaultFrom',
      'functionBind',
      'functionSent',
      'importAttributes',
      'importReflection',
      'moduleBlocks',
      'optionalChainingAssign',
      'partialApplication',
      'pipelineOperator',
      'recordAndTuple',
      'sourcePhaseImports',
      'throwExpressions',
      // Regex
      'regexpUnicodeSets',
      // Class features
      'classPrivateProperties',
      'classPrivateMethods',
      'classProperties',
      'classStaticBlock',
      // Other
      'asyncGenerators',
      'bigInt',
      'dynamicImport',
      'exportNamespaceFrom',
      'importMeta',
      'logicalAssignment',
      'moduleStringNames',
      'nullishCoalescingOperator',
      'numericSeparator',
      'objectRestSpread',
      'optionalCatchBinding',
      'optionalChaining',
      'topLevelAwait',
      'privateIn',
    ],
  };

  // Add JSX if requested
  if (options.jsx) {
    parserOptions.plugins!.push('jsx');
  }

  // Add TypeScript if requested
  if (options.typescript) {
    parserOptions.plugins!.push('typescript');
  }

  // Configure pipeline operator
  parserOptions.plugins = parserOptions.plugins!.map((plugin) => {
    if (plugin === 'pipelineOperator') {
      return ['pipelineOperator', { proposal: 'hack', topicToken: '%' }];
    }
    if (plugin === 'recordAndTuple') {
      return ['recordAndTuple', { syntaxType: 'hash' }];
    }
    if (plugin === 'decorators') {
      return ['decorators', { decoratorsBeforeExport: true }];
    }
    if (plugin === 'optionalChainingAssign') {
      return ['optionalChainingAssign', { version: '2023-07' }];
    }
    return plugin;
  });

  try {
    const ast = babelParse(source, parserOptions);

    // Extract errors from AST
    const errors: ParseError[] = (ast.errors ?? []).map((err) => ({
      message: err.message,
      line: err.loc?.line ?? 0,
      column: err.loc?.column ?? 0,
    }));

    return { ast, errors };
  } catch (error) {
    // This shouldn't happen with errorRecovery enabled, but handle it
    if (error instanceof SyntaxError) {
      const loc = (error as { loc?: { line: number; column: number } }).loc;
      return {
        ast: {
          type: 'File',
          program: {
            type: 'Program',
            body: [],
            directives: [],
            sourceType: 'script',
            sourceFile: options.filename ?? '',
          },
          comments: [],
          errors: [],
        } as t.File,
        errors: [
          {
            message: error.message,
            line: loc?.line ?? 0,
            column: loc?.column ?? 0,
          },
        ],
      };
    }
    throw error;
  }
}

/**
 * Parse a single expression
 */
export function parseExpression(source: string): t.Expression {
  const result = parse(`(${source})`);
  const stmt = result.ast.program.body[0];
  if (stmt && stmt.type === 'ExpressionStatement') {
    return stmt.expression;
  }
  throw new Error('Failed to parse expression');
}
