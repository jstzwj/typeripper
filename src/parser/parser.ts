/**
 * Babel parser wrapper - parse JavaScript to AST
 */

import * as babelParser from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import * as t from '@babel/types';

// ============================================================================
// Parse Options
// ============================================================================

export interface ParseOptions {
  source: string;
  filename?: string;
  strictMode?: boolean;
  jsx?: boolean;
  allowImportExportEverywhere?: boolean;
  allowReturnOutsideFunction?: boolean;
}

export const DEFAULT_PARSE_OPTIONS: Partial<ParseOptions> = {
  strictMode: true,
  jsx: false,
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
};

// ============================================================================
// Parse Result
// ============================================================================

export interface ParseResult {
  ast: t.File;
  source: string;
  filename: string;
  errors: readonly ParseError[];
}

export interface ParseError {
  message: string;
  loc?: t.SourceLocation;
}

// ============================================================================
// Parser Class
// ============================================================================

export class Parser {
  private options: Partial<ParseOptions>;

  constructor(options: Partial<ParseOptions> = {}) {
    this.options = { ...DEFAULT_PARSE_OPTIONS, ...options };
  }

  /**
   * Parse JavaScript source code to AST
   */
  parse(source: string, filename: string = '<unknown>'): ParseResult {
    const errors: ParseError[] = [];
    let ast: t.File | null = null;

    try {
      ast = babelParser.parse(source, {
        sourceType: 'module',
        plugins: [
          'jsx',
          'typescript',
          'decorators-legacy',
          'classProperties',
          'objectRestSpread',
          'functionBind',
          'exportDefaultFrom',
          'exportNamespaceFrom',
          'dynamicImport',
          'nullishCoalescingOperator',
          'optionalChaining',
          'bigInt',
          'optionalCatchBinding',
          'throwExpressions',
          'topLevelAwait',
          'doExpressions',
          'asyncDoExpressions',
        ],
        strictMode: this.options.strictMode ?? true,
        allowImportExportEverywhere: this.options.allowImportExportEverywhere ?? true,
        allowReturnOutsideFunction: this.options.allowReturnOutsideFunction ?? true,
      });
    } catch (e) {
      if (e instanceof SyntaxError) {
        errors.push({
          message: e.message,
          loc: (e as any).loc,
        });
      }
    }

    return {
      ast: ast ?? this.emptyProgram(),
      source,
      filename,
      errors,
    };
  }

  /**
   * Parse a single expression
   */
  parseExpression(source: string, filename: string = '<unknown>'): t.Expression {
    try {
      const ast = babelParser.parse(source, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        strictMode: this.options.strictMode ?? true,
      });

      if (ast.program.body.length === 1) {
        const stmt = ast.program.body[0];
        if (t.isExpressionStatement(stmt)) {
          return stmt.expression;
        }
      }
    } catch (e) {
      // Fall through to empty expression
    }

    return t.identifier('undefined');
  }

  /**
   * Traverse AST with visitor
   */
  traverse(ast: t.Node, visitors: any): void {
    (babelTraverse as any)(ast, visitors);
  }

  /**
   * Create an empty program
   */
  private emptyProgram(): t.File {
    return t.file(t.program([], [], 'module'));
  }

  /**
   * Get node source location
   */
  getSourceLoc(node: t.Node): t.SourceLocation | null {
    if (node.loc) {
      return node.loc;
    }
    return null;
  }

  /**
   * Get node source code
   */
  getSource(node: t.Node, source: string): string | null {
    const loc = node.loc;
    if (loc) {
      const lines = source.split('\n');
      if (loc.start.line === loc.end.line) {
        return lines[loc.start.line - 1]!.slice(loc.start.column, loc.end.column);
      }
      const start = lines[loc.start.line - 1]!.slice(loc.start.column);
      const middle = lines.slice(loc.start.line, loc.end.line - 1).join('\n');
      const end = lines[loc.end.line - 1]!.slice(0, loc.end.column);
      return [start, middle, end].join('\n');
    }
    return null;
  }
}

// ============================================================================
// Singleton Parser Instance
// ============================================================================

const defaultParser = new Parser();

export function parse(source: string, filename?: string): ParseResult {
  return defaultParser.parse(source, filename);
}

export function parseExpression(source: string, filename?: string): t.Expression {
  return defaultParser.parseExpression(source, filename);
}

export function traverseAST(ast: t.Node, visitors: any): void {
  defaultParser.traverse(ast, visitors);
}

// ============================================================================
// AST Node Utilities
// ============================================================================

/**
 * Check if node is a specific type
 */
export function isNodeType<N extends t.Node['type']>(
  node: t.Node,
  type: N
): node is Extract<t.Node, { type: N }> {
  return node.type === type;
}

/**
 * Get identifier name from node
 */
export function getIdentifierName(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name;
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value);
  }
  return null;
}

/**
 * Check if node is a pure expression (no side effects)
 */
export function isPureExpression(node: t.Node): boolean {
  if (t.isLiteral(node)) {
    return true;
  }

  if (t.isIdentifier(node)) {
    return true;
  }

  if (t.isUnaryExpression(node)) {
    return node.operator === 'void' || node.operator === 'typeof' || isPureExpression(node.argument);
  }

  if (t.isBinaryExpression(node)) {
    return isPureExpression(node.left) && isPureExpression(node.right);
  }

  if (t.isLogicalExpression(node)) {
    return isPureExpression(node.left) && isPureExpression(node.right);
  }

  if (t.isConditionalExpression(node)) {
    return isPureExpression(node.test) &&
           isPureExpression(node.consequent) &&
           isPureExpression(node.alternate);
  }

  if (t.isArrayExpression(node)) {
    return node.elements.every(e => e === null || isPureExpression(e));
  }

  if (t.isObjectExpression(node)) {
    return node.properties.every(p => {
      if (t.isSpreadElement(p)) {
        return isPureExpression(p.argument);
      }
      if (t.isObjectProperty(p)) {
        return isPureExpression(p.value) && (!p.computed || isPureExpression(p.key));
      }
      // ObjectMethod is always pure for the key
      return !p.computed || isPureExpression(p.key as any);
    });
  }

  return false;
}

/**
 * Check if statement is a terminator (always exits current scope)
 */
export function isTerminator(node: t.Statement): boolean {
  return t.isReturnStatement(node) ||
         t.isThrowStatement(node) ||
         t.isBreakStatement(node) ||
         t.isContinueStatement(node);
}

/**
 * Check if node is a declaration
 */
export function isDeclaration(node: t.Node): boolean {
  return t.isFunctionDeclaration(node) ||
         t.isVariableDeclaration(node) ||
         t.isClassDeclaration(node) ||
         t.isImportDeclaration(node) ||
         t.isExportNamedDeclaration(node) ||
         t.isExportDefaultDeclaration(node);
}

/**
 * Get all declared names from a node
 */
export function getDeclaredNames(node: t.Node): string[] {
  const names: string[] = [];

  if (t.isIdentifier(node)) {
    names.push(node.name);
  }

  if (t.isObjectPattern(node)) {
    for (const prop of node.properties) {
      if (t.isRestElement(prop)) {
        names.push(...getDeclaredNames(prop.argument));
      } else if (t.isObjectProperty(prop)) {
        names.push(...getDeclaredNames(prop.value));
      }
    }
  }

  if (t.isArrayPattern(node)) {
    for (const elem of node.elements) {
      if (elem) {
        names.push(...getDeclaredNames(elem));
      }
    }
  }

  if (t.isRestElement(node)) {
    names.push(...getDeclaredNames(node.argument));
  }

  if (t.isAssignmentPattern(node)) {
    names.push(...getDeclaredNames(node.left));
  }

  return names;
}

/**
 * Get all referenced identifiers from a node
 */
export function getReferencedNames(node: t.Node): Set<string> {
  const refs = new Set<string>();

  (babelTraverse as any)(node, {
    Identifier(path: any) {
      if (path.isReferencedIdentifier()) {
        refs.add(path.node.name);
      }
    },
  });

  return refs;
}

/**
 * Find all free variables in a node
 */
export function getFreeVariables(
  node: t.Node,
  boundVars: Set<string> = new Set()
): Set<string> {
  const refs = getReferencedNames(node);
  const free = new Set<string>();

  for (const ref of refs) {
    if (!boundVars.has(ref)) {
      free.add(ref);
    }
  }

  return free;
}

// ============================================================================
// Source Map Utilities
// ============================================================================

export interface Position {
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/**
 * Convert Babel location to range
 */
export function locToRange(loc: t.SourceLocation): Range {
  return {
    start: { line: loc.start.line, column: loc.start.column },
    end: { line: loc.end.line, column: loc.end.column },
  };
}

/**
 * Get position from offset
 */
export function offsetToPosition(source: string, offset: number): Position {
  const lines = source.substring(0, offset).split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length,
  };
}

/**
 * Get offset from position
 */
export function positionToOffset(source: string, pos: Position): number {
  const lines = source.split('\n');
  let offset = 0;

  for (let i = 0; i < pos.line - 1; i++) {
    offset += lines[i]!.length + 1; // +1 for newline
  }

  offset += pos.column;
  return offset;
}

// ============================================================================
// Re-exports
// ============================================================================

export { t as types };
export default Parser;
