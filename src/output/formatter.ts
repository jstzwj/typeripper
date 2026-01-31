/**
 * Output Formatter
 * Format and display inferred types
 */

import type { TypeAnnotation, TypeAnnotationResult } from '../types/types.js';
import { formatType, formatTypeColored } from '../utils/format.js';

// ============================================================================
// Format Options
// ============================================================================

export interface FormatterOptions {
  readonly color?: boolean;
  readonly verbose?: boolean;
  readonly includeSource?: boolean;
  readonly groupByScope?: boolean;
}

// ============================================================================
// Format Annotation Result
// ============================================================================

export function formatAnnotationResult(
  result: TypeAnnotationResult,
  options: FormatterOptions = {}
): string {
  const lines: string[] = [];

  if (options.includeSource) {
    lines.push('// Source: ' + result.filename);
    lines.push('');
  }

  // Group annotations by line number
  const byLine = new Map<number, TypeAnnotation[]>();

  for (const annotation of result.annotations) {
    const line = annotation.node.loc?.start.line ?? 0;
    if (!byLine.has(line)) {
      byLine.set(line, []);
    }
    byLine.get(line)!.push(annotation);
  }

  // Sort by line number
  const sortedLines = Array.from(byLine.entries()).sort((a, b) => a[0] - b[0]);

  for (const [line, annotations] of sortedLines) {
    if (annotations.length === 0) continue;

    lines.push(`// Line ${line}:`);

    for (const annotation of annotations) {
      const formatted = formatAnnotation(annotation, options);
      lines.push(`  ${formatted}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Format Single Annotation
// ============================================================================

export function formatAnnotation(
  annotation: TypeAnnotation,
  options: FormatterOptions = {}
): string {
  const name = annotation.name ?? '(anonymous)';
  const kind = annotation.kind ?? 'unknown';

  const typeStr = options.color
    ? formatTypeColored(annotation.type, { verbose: options.verbose })
    : formatType(annotation.type, { verbose: options.verbose });

  return `${kind} ${name}: ${typeStr}`;
}

// ============================================================================
// Format for Terminal Output
// ============================================================================

export function formatForTerminal(
  result: TypeAnnotationResult
): string {
  return formatAnnotationResult(result, { color: true, verbose: false });
}

// ============================================================================
// Format for JSON Output
// ============================================================================

export function formatAsJSON(
  result: TypeAnnotationResult
): string {
  const annotations = result.annotations.map(a => ({
    name: a.name,
    kind: a.kind,
    type: formatType(a.type, { verbose: true }),
    line: a.node.loc?.start.line,
    column: a.node.loc?.start.column,
  }));

  return JSON.stringify(
    {
      filename: result.filename,
      annotations,
    },
    null,
    2
  );
}

// ============================================================================
// Format Inline Annotations (for source code)
// ============================================================================

export function formatInlineAnnotations(
  result: TypeAnnotationResult
): string {
  const lines = result.source.split('\n');

  // Create a map of line to annotations
  const byLine = new Map<number, TypeAnnotation[]>();

  for (const annotation of result.annotations) {
    const line = annotation.node.loc?.start.line ?? 0;
    if (!byLine.has(line)) {
      byLine.set(line, []);
    }
    byLine.get(line)!.push(annotation);
  }

  // Add type comments after each relevant line
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i]!;

    const annotations = byLine.get(lineNum);
    if (annotations && annotations.length > 0) {
      const comments = annotations.map(a => {
        const name = a.name ?? '';
        const type = formatType(a.type, { verbose: false, compact: true });
        return `${name}: ${type}`;
      });

      if (comments.length > 0) {
        // Append comment to the same line
        line = line.trimEnd() + ' // ' + comments.join(', ');
      }
    }

    output.push(line);
  }

  return output.join('\n');
}

// ============================================================================
// Format for TypeScript Definition Output
// ============================================================================

export function formatAsTypeScript(
  result: TypeAnnotationResult
): string {
  const declarations: string[] = [];

  // Group by name to avoid duplicates
  const byName = new Map<string, TypeAnnotation[]>();

  for (const annotation of result.annotations) {
    if (annotation.name) {
      if (!byName.has(annotation.name)) {
        byName.set(annotation.name, []);
      }
      byName.get(annotation.name)!.push(annotation);
    }
  }

  // Generate declarations
  for (const [name, annotations] of byName) {
    const annotation = annotations[0]!;
    const type = formatTypeAsTypeScript(annotation.type);

    let declaration = '';

    switch (annotation.kind) {
      case 'function':
        declaration = `declare function ${name}${type};`;
        break;
      case 'class':
        declaration = `declare class ${name} ${type};`;
        break;
      case 'variable':
        declaration = `declare const ${name}: ${type};`;
        break;
      case 'parameter':
        // Skip - parameters are part of their parent function
        continue;
      default:
        declaration = `declare ${annotation.kind} ${name}: ${type};`;
    }

    declarations.push(declaration);
  }

  return declarations.join('\n');
}

function formatTypeAsTypeScript(type: any): string {
  // This would format the type as TypeScript syntax
  // For now, return the formatted type
  return formatType(type, { verbose: true });
}

// ============================================================================
// Format Summary Statistics
// ============================================================================

export function formatSummary(result: TypeAnnotationResult): string {
  const annotations = result.annotations;

  const byKind = new Map<string, number>();

  for (const annotation of annotations) {
    const kind = annotation.kind ?? 'unknown';
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push('=== Type Inference Summary ===');
  lines.push(`File: ${result.filename}`);
  lines.push(`Total annotations: ${annotations.length}`);
  lines.push('');
  lines.push('By kind:');

  for (const [kind, count] of byKind) {
    lines.push(`  ${kind}: ${count}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Format Error Messages
// ============================================================================

export function formatError(
  message: string,
  node?: { loc?: { start: { line: number; column: number } } }
): string {
  if (node?.loc) {
    return `Error at line ${node.loc.start.line}, column ${node.loc.start.column}: ${message}`;
  }
  return `Error: ${message}`;
}

// ============================================================================
// Format Warning Messages
// ============================================================================

export function formatWarning(
  message: string,
  node?: { loc?: { start: { line: number; column: number } } }
): string {
  if (node?.loc) {
    return `Warning at line ${node.loc.start.line}, column ${node.loc.start.column}: ${message}`;
  }
  return `Warning: ${message}`;
}

// ============================================================================
// Re-exports
// ============================================================================

export * from '../utils/format.js';
