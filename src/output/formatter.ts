/**
 * Type Formatter - Converts MLsub PolarTypes to various output formats
 *
 * Supports multiple output formats:
 * 1. TypeScript syntax (for .d.ts generation and display)
 * 2. JSON (machine-readable)
 * 3. DTS (TypeScript declaration file)
 * 4. Inline (source code with type comments)
 * 5. Report (human-readable analysis)
 */

import type { PolarType, FunctionType, RecordType, ArrayType, FieldType } from '../types/polar.js';
import type { ProgramInferenceResult } from '../inferrer/infer.js';
import { typeToString } from '../types/polar.js';

// Re-export types from inference module for convenience
export type {
  ProgramInferenceResult,
  InferenceError,
} from '../inferrer/infer.js';

// ============================================================================
// Format Options
// ============================================================================

/**
 * Options for type formatting
 */
export interface FormatOptions {
  /** Maximum depth for nested types (default: 10) */
  maxDepth?: number;
  /** Whether to show optional properties with ? (default: true) */
  showOptional?: boolean;
  /** Line width for wrapping (default: 80) */
  lineWidth?: number;
  /** Indentation string (default: '  ') */
  indentStr?: string;
  /** Whether to show verbose details (default: false) */
  verbose?: boolean;
}

const DEFAULT_OPTIONS: Required<FormatOptions> = {
  maxDepth: 10,
  showOptional: true,
  lineWidth: 80,
  indentStr: '  ',
  verbose: false,
};

// ============================================================================
// Type to TypeScript
// ============================================================================

/**
 * Convert a PolarType to TypeScript syntax
 */
export function typeToTypeScript(type: PolarType, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return formatTypeTS(type, opts, 0, new Set());
}

function formatTypeTS(
  type: PolarType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<number>
): string {
  // Prevent infinite recursion
  if (depth > opts.maxDepth) {
    return '...';
  }

  switch (type.kind) {
    case 'primitive':
      if (type.value !== undefined) {
        // Literal type
        if (typeof type.value === 'string') {
          return `"${type.value}"`;
        }
        return String(type.value);
      }
      // Map primitive names to TypeScript types
      switch (type.name) {
        case 'boolean': return 'boolean';
        case 'null': return 'null';
        case 'undefined': return 'undefined';
        case 'bigint': return 'bigint';
        case 'symbol': return 'symbol';
        case 'number': return 'number';
        case 'string': return 'string';
      }

    case 'var':
      // Type variable - use name or unknown
      return type.name || 'unknown';

    case 'function':
      return formatFunctionTS(type, opts, depth, seen);

    case 'record':
      return formatRecordTS(type, opts, depth, seen);

    case 'array':
      return formatArrayTS(type, opts, depth, seen);

    case 'union': {
      if (type.members.length === 0) return 'never';
      const members = type.members.map(m => formatTypeTS(m, opts, depth, seen));
      // Deduplicate
      const unique = [...new Set(members)];
      return unique.join(' | ');
    }

    case 'intersection': {
      if (type.members.length === 0) return 'unknown';
      const members = type.members.map(m => formatTypeTS(m, opts, depth, seen));
      const unique = [...new Set(members)];
      return unique.join(' & ');
    }

    case 'promise':
      return `Promise<${formatTypeTS(type.resolvedType, opts, depth + 1, seen)}>`;

    case 'class':
      return type.name;

    case 'top':
      return 'unknown';

    case 'bottom':
      return 'never';

    case 'any':
      return 'any';

    case 'never':
      return 'never';

    case 'unknown':
      return 'unknown';

    case 'recursive':
      // For recursive types, just use the body type
      return formatTypeTS(type.body, opts, depth + 1, seen);

    default:
      return 'unknown';
  }
}

function formatFunctionTS(
  type: FunctionType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<number>
): string {
  const params = type.params.map((p, i) => {
    const opt = p.optional ? '?' : '';
    const rest = p.rest ? '...' : '';
    const name = p.name || `arg${i}`;
    const paramType = formatTypeTS(p.type, opts, depth + 1, seen);
    return `${rest}${name}${opt}: ${rest ? `${paramType}[]` : paramType}`;
  }).join(', ');

  const ret = formatTypeTS(type.returnType, opts, depth + 1, seen);
  return `(${params}) => ${ret}`;
}

function formatRecordTS(
  type: RecordType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<number>
): string {
  if (type.fields.size === 0) {
    return type.rest ? 'Record<string, unknown>' : '{}';
  }

  const fields = Array.from(type.fields.entries()).map(([name, field]) => {
    const opt = field.optional ? '?' : '';
    const ro = field.readonly ? 'readonly ' : '';
    return `${ro}${name}${opt}: ${formatTypeTS(field.type, opts, depth + 1, seen)}`;
  });

  return `{ ${fields.join('; ')} }`;
}

function formatArrayTS(
  type: ArrayType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<number>
): string {
  if (type.tuple) {
    const elements = type.tuple.map(t => formatTypeTS(t, opts, depth + 1, seen));
    return `[${elements.join(', ')}]`;
  }
  return `${formatTypeTS(type.elementType, opts, depth + 1, seen)}[]`;
}

// ============================================================================
// Program Inference Result Types
// ============================================================================

// Types are re-exported from inference module above

/**
 * Inference result for a single binding
 */
export interface InferredBinding {
  name: string;
  type: PolarType;
}

// ============================================================================
// Report Format
// ============================================================================

/**
 * Format inference result as a human-readable report
 */
export function formatReport(result: ProgramInferenceResult, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push('Type Inference Results');
  lines.push('='.repeat(60));
  lines.push('');

  if (result.bindings.size === 0) {
    lines.push('No type bindings found.');
  } else {
    lines.push('Inferred Types:');
    lines.push('-'.repeat(40));

    // Group bindings by kind
    const functions: [string, PolarType][] = [];
    const classes: [string, PolarType][] = [];
    const variables: [string, PolarType][] = [];

    for (const [name, type] of result.bindings) {
      if (type.kind === 'function') {
        functions.push([name, type]);
      } else if (type.kind === 'class') {
        classes.push([name, type]);
      } else {
        variables.push([name, type]);
      }
    }

    if (variables.length > 0) {
      lines.push('\n  Variables:');
      for (const [name, type] of variables) {
        const typeStr = typeToString(type);
        lines.push(`    ${name}: ${typeStr}`);
        if (opts.verbose && type.kind !== 'primitive' && type.kind !== 'var') {
          lines.push(`      (kind: ${type.kind})`);
        }
      }
    }

    if (functions.length > 0) {
      lines.push('\n  Functions:');
      for (const [name, type] of functions) {
        const typeStr = typeToString(type);
        lines.push(`    ${name}: ${typeStr}`);
      }
    }

    if (classes.length > 0) {
      lines.push('\n  Classes:');
      for (const [name, type] of classes) {
        const typeStr = typeToString(type);
        lines.push(`    ${name}: ${typeStr}`);
      }
    }
  }

  lines.push('');

  if (result.errors.length > 0) {
    lines.push('Type Errors:');
    lines.push('-'.repeat(40));
    for (const error of result.errors) {
      lines.push(`  - ${error.message}`);
      if (error.location) {
        lines.push(`     at ${error.location.file}:${error.location.line}:${error.location.column}`);
      }
    }
  } else {
    lines.push('No type errors detected');
  }

  return lines.join('\n');
}

// ============================================================================
// JSON Format
// ============================================================================

/**
 * Get detailed type information for JSON output
 */
function getTypeDetails(type: PolarType): Record<string, unknown> | null {
  switch (type.kind) {
    case 'function':
      return {
        params: type.params.map(p => ({
          name: p.name,
          type: typeToString(p.type),
          optional: p.optional,
          rest: p.rest,
        })),
        returnType: typeToString(type.returnType),
        isAsync: type.isAsync,
        isGenerator: type.isGenerator,
      };
    case 'record':
      return {
        fields: Object.fromEntries(
          Array.from(type.fields.entries()).map(([name, field]) => [
            name,
            {
              type: typeToString(field.type),
              optional: field.optional,
              readonly: field.readonly,
            }
          ])
        ),
      };
    case 'array':
      return {
        elementType: typeToString(type.elementType),
        isTuple: !!type.tuple,
      };
    case 'union':
      return {
        members: type.members.map(m => typeToString(m)),
      };
    case 'intersection':
      return {
        members: type.members.map(m => typeToString(m)),
      };
    default:
      return null;
  }
}

/**
 * Format inference result as JSON
 */
export function formatJSON(result: ProgramInferenceResult): string {
  const jsonOutput = {
    success: result.success,
    bindings: Object.fromEntries(
      Array.from(result.bindings.entries()).map(([name, type]) => [
        name,
        {
          type: typeToString(type),
          kind: type.kind,
          details: getTypeDetails(type),
        }
      ])
    ),
    errors: result.errors.map(e => ({
      message: e.message,
      location: e.location,
    })),
    statistics: {
      totalBindings: result.bindings.size,
      errorCount: result.errors.length,
    },
  };
  return JSON.stringify(jsonOutput, null, 2);
}

// ============================================================================
// DTS Format (TypeScript Declaration)
// ============================================================================

/**
 * Check if a string is a valid JS identifier
 */
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Check if a variable name is internal (loop variable, temp, etc.)
 */
function isInternalVariable(name: string): boolean {
  const internal = ['i', 'j', 'k', 'n', '_', 'tmp', 'temp'];
  return internal.includes(name) || name.startsWith('_');
}

/**
 * Format a function type as a TypeScript function declaration
 */
function formatFunctionDeclaration(name: string, type: FunctionType, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const asyncPrefix = type.isAsync ? 'async ' : '';
  const genSuffix = type.isGenerator ? ' (generator)' : '';

  const params = type.params.map((p, i) => {
    const opt = p.optional ? '?' : '';
    const rest = p.rest ? '...' : '';
    const paramName = p.name || `arg${i}`;
    const paramType = typeToTypeScript(p.type, opts);
    return `${rest}${paramName}${opt}: ${rest ? `${paramType}[]` : paramType}`;
  }).join(', ');

  const returnType = typeToTypeScript(type.returnType, opts);

  return `declare ${asyncPrefix}function ${name}(${params}): ${returnType};${genSuffix ? ` // ${genSuffix}` : ''}`;
}

/**
 * Format inference result as TypeScript declaration file
 */
export function formatDTS(result: ProgramInferenceResult, filePath: string, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];

  const fileName = filePath.replace(/^.*[\\/]/, '').replace(/\.js$/, '');

  lines.push(`// Type definitions for ${fileName}`);
  lines.push(`// Generated by Typeripper MLsub type inference`);
  lines.push(`// Source: ${filePath}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('// Type errors were detected during inference:');
    for (const error of result.errors) {
      lines.push(`//   - ${error.message}`);
    }
    lines.push('');
  }

  // Separate declarations by type
  const functions: [string, PolarType][] = [];
  const classes: [string, PolarType][] = [];
  const variables: [string, PolarType][] = [];

  for (const [name, type] of result.bindings) {
    // Skip internal/loop variables
    if (isInternalVariable(name)) continue;

    if (type.kind === 'function') {
      functions.push([name, type]);
    } else if (type.kind === 'class') {
      classes.push([name, type]);
    } else {
      variables.push([name, type]);
    }
  }

  // Output variable declarations
  if (variables.length > 0) {
    lines.push('// Variables');
    for (const [name, type] of variables) {
      if (isValidIdentifier(name)) {
        lines.push(`declare const ${name}: ${typeToTypeScript(type, opts)};`);
      }
    }
    lines.push('');
  }

  // Output function declarations
  if (functions.length > 0) {
    lines.push('// Functions');
    for (const [name, type] of functions) {
      if (isValidIdentifier(name) && type.kind === 'function') {
        lines.push(formatFunctionDeclaration(name, type, opts));
      }
    }
    lines.push('');
  }

  // Output class declarations
  if (classes.length > 0) {
    lines.push('// Classes');
    for (const [name, type] of classes) {
      if (isValidIdentifier(name)) {
        lines.push(`declare class ${name} {`);
        lines.push(`  constructor(...args: any[]): ${name};`);
        lines.push(`}`);
        lines.push('');
      }
    }
  }

  // Export declarations
  const exportedNames = [...variables, ...functions, ...classes]
    .map(([name]) => name)
    .filter(isValidIdentifier)
    .filter(name => !isInternalVariable(name));

  if (exportedNames.length > 0) {
    lines.push('// Exports');
    lines.push(`export { ${exportedNames.join(', ')} };`);
  }

  return lines.join('\n');
}

// ============================================================================
// Inline Format (Source with Type Comments)
// ============================================================================

/**
 * Format inference result as source code with inline type comments
 */
export function formatInline(result: ProgramInferenceResult, source: string): string {
  const lines = source.split('\n');
  const bindings = result.bindings;

  // Build a map of variable declarations to their types
  const typeAnnotations = new Map<string, string>();
  for (const [name, type] of bindings) {
    typeAnnotations.set(name, typeToString(type));
  }

  // Patterns to match declarations
  const constLetVarPattern = /^(\s*)(const|let|var)\s+(\w+)\s*=/;
  const functionDeclPattern = /^(\s*)function\s+(\w+)\s*\(/;
  const arrowFuncPattern = /^(\s*)(const|let|var)\s+(\w+)\s*=\s*(\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/;
  const classPattern = /^(\s*)class\s+(\w+)/;
  // Pattern for for-loop variable declarations: for (let i = 0; ...)
  const forLoopVarPattern = /^(\s*)for\s*\(\s*(let|var|const)\s+(\w+)\s*=/;

  const outputLines: string[] = [];

  outputLines.push('// ============================================================');
  outputLines.push('// Type-annotated source code');
  outputLines.push('// Generated by Typeripper MLsub type inference');
  outputLines.push('// ============================================================');
  outputLines.push('');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Try to match different declaration patterns
    let match: RegExpMatchArray | null;
    let annotation = '';

    // For-loop variable declaration
    match = line.match(forLoopVarPattern);
    if (match) {
      const name = match[3]!;
      const type = typeAnnotations.get(name);
      if (type) {
        annotation = ` /* : ${type} */`;
        // Insert annotation after the variable name in the for loop
        // Find the position after "let i" or "var i" or "const i"
        const varDeclMatch = line.match(/(for\s*\(\s*(?:let|var|const)\s+\w+)/);
        if (varDeclMatch) {
          const insertPos = varDeclMatch.index! + varDeclMatch[0].length;
          outputLines.push(line.slice(0, insertPos) + annotation + line.slice(insertPos));
          continue;
        }
      }
    }

    // Arrow function assignment
    match = line.match(arrowFuncPattern);
    if (match) {
      const name = match[3]!;
      const type = typeAnnotations.get(name);
      if (type) {
        annotation = ` /* : ${type} */`;
      }
      const insertPos = line.indexOf('=');
      if (insertPos > 0 && annotation) {
        outputLines.push(line.slice(0, insertPos) + annotation + line.slice(insertPos));
        continue;
      }
    }

    // Regular variable declaration
    match = line.match(constLetVarPattern);
    if (match && !arrowFuncPattern.test(line)) {
      const name = match[3]!;
      const type = typeAnnotations.get(name);
      if (type) {
        annotation = ` /* : ${type} */`;
      }
      const insertPos = line.indexOf('=');
      if (insertPos > 0 && annotation) {
        outputLines.push(line.slice(0, insertPos) + annotation + line.slice(insertPos));
        continue;
      }
    }

    // Function declaration
    match = line.match(functionDeclPattern);
    if (match) {
      const name = match[2]!;
      const type = typeAnnotations.get(name);
      if (type) {
        annotation = ` /* : ${type} */`;
        const funcNameEnd = line.indexOf(name) + name.length;
        outputLines.push(line.slice(0, funcNameEnd) + annotation + line.slice(funcNameEnd));
        continue;
      }
    }

    // Class declaration
    match = line.match(classPattern);
    if (match) {
      const name = match[2]!;
      const type = typeAnnotations.get(name);
      if (type) {
        annotation = ` /* : ${type} */`;
        const classNameEnd = line.indexOf(name) + name.length;
        outputLines.push(line.slice(0, classNameEnd) + annotation + line.slice(classNameEnd));
        continue;
      }
    }

    // No annotation needed, output original line
    outputLines.push(line);
  }

  // Output type errors as comments at the end
  if (result.errors.length > 0) {
    outputLines.push('');
    outputLines.push('// ============================================================');
    outputLines.push('// Type Errors');
    outputLines.push('// ============================================================');
    for (const error of result.errors) {
      outputLines.push(`// - ${error.message}`);
      if (error.location) {
        outputLines.push(`//    at line ${error.location.line}, column ${error.location.column}`);
      }
    }
  }

  return outputLines.join('\n');
}
