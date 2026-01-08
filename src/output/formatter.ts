/**
 * Type Formatter - Converts types to various output formats
 *
 * Supports multiple output formats:
 * 1. Inline comments (like Flow/TypeScript inline annotations)
 * 2. JSON (machine-readable)
 * 3. DTS-like (TypeScript declaration style)
 * 4. Report (human-readable analysis report)
 */

import type { Type, ObjectType, FunctionType, ArrayType, ClassType } from '../types/index.js';
import type { TypeAnnotation, TypeAnnotationResult, OutputOptions } from '../types/annotation.js';

/**
 * Format options for detailed type output
 */
export interface FormatOptions {
  /** Maximum depth for nested types */
  maxDepth?: number;
  /** Whether to show optional properties with ? */
  showOptional?: boolean;
  /** Whether to expand type aliases */
  expandAliases?: boolean;
  /** Line width for wrapping */
  lineWidth?: number;
  /** Current indentation level */
  indentLevel?: number;
  /** Indentation string (default: '  ') */
  indentStr?: string;
}

const DEFAULT_FORMAT_OPTIONS: Required<FormatOptions> = {
  maxDepth: 5,
  showOptional: true,
  expandAliases: true,
  lineWidth: 80,
  indentLevel: 0,
  indentStr: '  ',
};

/**
 * Format a type to a detailed string representation
 */
export function formatType(type: Type, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_FORMAT_OPTIONS, ...options };
  return formatTypeInternal(type, opts, 0, new Set());
}

function formatTypeInternal(
  type: Type,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  // Prevent infinite recursion for recursive types
  if (depth > opts.maxDepth) {
    return '...';
  }

  if (seen.has(type.id)) {
    return `<circular: ${type.id}>`;
  }

  switch (type.kind) {
    case 'undefined':
      return 'undefined';
    case 'null':
      return 'null';
    case 'boolean':
      return type.value !== undefined ? String(type.value) : 'boolean';
    case 'number':
      return type.value !== undefined ? String(type.value) : 'number';
    case 'string':
      return type.value !== undefined ? JSON.stringify(type.value) : 'string';
    case 'bigint':
      return type.value !== undefined ? `${type.value}n` : 'bigint';
    case 'symbol':
      return type.description ? `unique symbol /* ${type.description} */` : 'symbol';
    case 'function':
      return formatFunctionTypeDetailed(type, opts, depth, seen);
    case 'object':
      return formatObjectTypeDetailed(type, opts, depth, seen);
    case 'array':
      return formatArrayTypeDetailed(type, opts, depth, seen);
    case 'class':
      return formatClassTypeDetailed(type, opts, depth, seen);
    case 'union':
      return formatUnionType(type.members, opts, depth, seen);
    case 'intersection':
      return type.members.map((m) => formatTypeInternal(m, opts, depth, seen)).join(' & ');
    case 'any':
      return type.reason ? `any /* ${type.reason} */` : 'any';
    case 'never':
      return 'never';
    case 'unknown':
      return 'unknown';
    case 'typevar':
      return type.name;
    case 'promise':
      return `Promise<${formatTypeInternal(type.resolvedType, opts, depth + 1, seen)}>`;
    case 'iterator':
      return `Generator<${formatTypeInternal(type.yieldType, opts, depth + 1, seen)}, ${formatTypeInternal(type.returnType, opts, depth + 1, seen)}, ${formatTypeInternal(type.nextType, opts, depth + 1, seen)}>`;
    default:
      return 'unknown';
  }
}

function formatFunctionTypeDetailed(
  type: FunctionType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  const newSeen = new Set(seen);
  newSeen.add(type.id);

  const params = type.params.map((p) => {
    let paramStr = p.rest ? '...' : '';
    paramStr += p.name;
    if (p.optional && opts.showOptional) paramStr += '?';
    paramStr += ': ' + formatTypeInternal(p.type, opts, depth + 1, newSeen);
    return paramStr;
  });

  const returnStr = formatTypeInternal(type.returnType, opts, depth + 1, newSeen);

  let prefix = '';
  if (type.isAsync) prefix = 'async ';
  if (type.isGenerator) {
    return `${prefix}function*(${params.join(', ')}): ${returnStr}`;
  }

  return `${prefix}(${params.join(', ')}) => ${returnStr}`;
}

function formatObjectTypeDetailed(
  type: ObjectType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  const newSeen = new Set(seen);
  newSeen.add(type.id);

  if (type.properties.size === 0 && !type.indexSignature) {
    return '{}';
  }

  const indent = opts.indentStr.repeat(depth + 1);
  const closingIndent = opts.indentStr.repeat(depth);

  const props: string[] = [];

  // Regular properties
  for (const [key, prop] of type.properties) {
    const keyStr = isValidIdentifier(key) ? key : JSON.stringify(key);
    const readonly = prop.writable ? '' : 'readonly ';
    const optional = !prop.writable && opts.showOptional ? '?' : '';
    const typeStr = formatTypeInternal(prop.type, opts, depth + 1, newSeen);

    if (prop.getter && prop.setter) {
      props.push(`${indent}${readonly}${keyStr}${optional}: ${typeStr} /* get/set */`);
    } else if (prop.getter) {
      props.push(`${indent}get ${keyStr}(): ${typeStr}`);
    } else if (prop.setter) {
      props.push(`${indent}set ${keyStr}(value: ${typeStr})`);
    } else {
      props.push(`${indent}${readonly}${keyStr}${optional}: ${typeStr}`);
    }
  }

  // Index signature
  if (type.indexSignature) {
    const keyType = formatTypeInternal(type.indexSignature.key, opts, depth + 1, newSeen);
    const valueType = formatTypeInternal(type.indexSignature.value, opts, depth + 1, newSeen);
    props.push(`${indent}[key: ${keyType}]: ${valueType}`);
  }

  // Check if we should format inline or multiline
  const inlineStr = `{ ${props.map((p) => p.trim()).join('; ')} }`;
  if (inlineStr.length <= opts.lineWidth && props.length <= 3) {
    return inlineStr;
  }

  return `{\n${props.join(';\n')};\n${closingIndent}}`;
}

function formatArrayTypeDetailed(
  type: ArrayType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  const newSeen = new Set(seen);
  newSeen.add(type.id);

  // Tuple type
  if (type.tuple && type.tuple.length > 0) {
    const elements = type.tuple.map((t) => formatTypeInternal(t, opts, depth + 1, newSeen));

    // Check if inline or multiline
    const inlineStr = `[${elements.join(', ')}]`;
    if (inlineStr.length <= opts.lineWidth || elements.length <= 4) {
      return inlineStr;
    }

    const indent = opts.indentStr.repeat(depth + 1);
    const closingIndent = opts.indentStr.repeat(depth);
    return `[\n${indent}${elements.join(',\n' + indent)}\n${closingIndent}]`;
  }

  // Regular array
  const elementStr = formatTypeInternal(type.elementType, opts, depth + 1, newSeen);

  // Use Array<T> syntax for complex element types
  if (type.elementType.kind === 'union' || type.elementType.kind === 'function') {
    return `Array<${elementStr}>`;
  }

  return `${elementStr}[]`;
}

function formatClassTypeDetailed(
  type: ClassType,
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  const newSeen = new Set(seen);
  newSeen.add(type.id);

  const indent = opts.indentStr.repeat(depth + 1);
  const closingIndent = opts.indentStr.repeat(depth);

  const parts: string[] = [];

  // Class name and extends
  let header = `class ${type.name}`;
  if (type.superClass) {
    header += ` extends ${type.superClass.name}`;
  }

  // Static properties
  for (const [key, prop] of type.staticProperties) {
    const typeStr = formatTypeInternal(prop.type, opts, depth + 1, newSeen);
    parts.push(`${indent}static ${key}: ${typeStr}`);
  }

  // Constructor
  const ctorParams = type.constructor.params
    .map((p) => {
      let s = p.rest ? '...' : '';
      s += p.name;
      if (p.optional) s += '?';
      s += ': ' + formatTypeInternal(p.type, opts, depth + 1, newSeen);
      return s;
    })
    .join(', ');
  parts.push(`${indent}constructor(${ctorParams})`);

  // Instance properties
  for (const [key, prop] of type.instanceType.properties) {
    const typeStr = formatTypeInternal(prop.type, opts, depth + 1, newSeen);
    if (prop.type.kind === 'function') {
      // Format as method
      const funcType = prop.type as FunctionType;
      const methodParams = funcType.params
        .map((p) => `${p.name}: ${formatTypeInternal(p.type, opts, depth + 1, newSeen)}`)
        .join(', ');
      const returnStr = formatTypeInternal(funcType.returnType, opts, depth + 1, newSeen);
      parts.push(`${indent}${key}(${methodParams}): ${returnStr}`);
    } else {
      parts.push(`${indent}${key}: ${typeStr}`);
    }
  }

  return `${header} {\n${parts.join(';\n')};\n${closingIndent}}`;
}

function formatUnionType(
  members: readonly Type[],
  opts: Required<FormatOptions>,
  depth: number,
  seen: Set<string>
): string {
  // Simplify common patterns
  const hasNull = members.some((m) => m.kind === 'null');
  const hasUndefined = members.some((m) => m.kind === 'undefined');
  const others = members.filter((m) => m.kind !== 'null' && m.kind !== 'undefined');

  if (others.length === 1 && (hasNull || hasUndefined)) {
    const baseType = formatTypeInternal(others[0]!, opts, depth, seen);
    if (hasNull && hasUndefined) {
      return `${baseType} | null | undefined`;
    } else if (hasNull) {
      return `${baseType} | null`;
    } else {
      return `${baseType} | undefined`;
    }
  }

  const formatted = members.map((m) => formatTypeInternal(m, opts, depth, seen));

  // Wrap complex union members in parentheses
  return formatted
    .map((s, i) => {
      const member = members[i]!;
      if (member.kind === 'function' || member.kind === 'intersection') {
        return `(${s})`;
      }
      return s;
    })
    .join(' | ');
}

function isValidIdentifier(s: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);
}

/**
 * Format annotation result to inline commented source
 */
export function formatAsInlineComments(result: TypeAnnotationResult): string {
  const lines = result.source.split('\n');
  const annotations = [...result.annotations].sort((a, b) => b.line - a.line);

  // Group annotations by line
  const lineAnnotations = new Map<number, TypeAnnotation[]>();
  for (const ann of annotations) {
    const existing = lineAnnotations.get(ann.line) ?? [];
    existing.push(ann);
    lineAnnotations.set(ann.line, existing);
  }

  // Insert annotations as comments
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const anns = lineAnnotations.get(lineNum);

    if (anns && anns.length > 0) {
      // Format annotations for this line
      const comments = anns
        .filter((a) => a.kind !== 'expression') // Skip expression types by default
        .map((a) => {
          const name = a.name ? `${a.name}: ` : '';
          return `/* ${name}${a.typeString} */`;
        });

      if (comments.length > 0) {
        output.push(lines[i] + ' ' + comments.join(' '));
      } else {
        output.push(lines[i]!);
      }
    } else {
      output.push(lines[i]!);
    }
  }

  return output.join('\n');
}

/**
 * Format annotation result as JSON
 */
export function formatAsJSON(result: TypeAnnotationResult, indent = 2): string {
  const serializable = {
    filename: result.filename,
    annotations: result.annotations.map((a) => ({
      line: a.line,
      column: a.column,
      kind: a.kind,
      name: a.name,
      type: a.typeString,
    })),
    errors: result.errors,
  };
  return JSON.stringify(serializable, null, indent);
}

/**
 * Format annotation result as TypeScript declaration (.d.ts style)
 */
export function formatAsDTS(result: TypeAnnotationResult): string {
  const lines: string[] = [];
  lines.push(`// Type declarations for ${result.filename}`);
  lines.push('');

  // Group by kind
  const variables = result.annotations.filter((a) => a.kind === 'variable' || a.kind === 'const');
  const functions = result.annotations.filter((a) => a.kind === 'function');
  const classes = result.annotations.filter((a) => a.kind === 'class');

  // Variables
  for (const v of variables) {
    const keyword = v.kind === 'const' ? 'const' : 'let';
    lines.push(`declare ${keyword} ${v.name}: ${v.typeString};`);
  }

  if (variables.length > 0) lines.push('');

  // Functions
  for (const f of functions) {
    lines.push(`declare function ${f.name}${f.typeString};`);
  }

  if (functions.length > 0) lines.push('');

  // Classes
  for (const c of classes) {
    lines.push(`declare ${c.typeString}`);
  }

  return lines.join('\n');
}

/**
 * Format annotation result as human-readable report
 */
export function formatAsReport(result: TypeAnnotationResult): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  Type Inference Report: ${result.filename}`);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Summary
  const counts = {
    variables: result.annotations.filter((a) => a.kind === 'variable' || a.kind === 'const').length,
    functions: result.annotations.filter((a) => a.kind === 'function').length,
    parameters: result.annotations.filter((a) => a.kind === 'parameter').length,
    classes: result.annotations.filter((a) => a.kind === 'class').length,
    errors: result.errors.length,
  };

  lines.push('  Summary:');
  lines.push(`    Variables:  ${counts.variables}`);
  lines.push(`    Functions:  ${counts.functions}`);
  lines.push(`    Parameters: ${counts.parameters}`);
  lines.push(`    Classes:    ${counts.classes}`);
  lines.push(`    Errors:     ${counts.errors}`);
  lines.push('');

  // Errors first
  if (result.errors.length > 0) {
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('  Errors:');
    lines.push('───────────────────────────────────────────────────────────────');
    for (const err of result.errors) {
      lines.push(`    Line ${err.line}:${err.column} - ${err.message}`);
    }
    lines.push('');
  }

  // Detailed annotations by category
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('  Inferred Types:');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('');

  // Group by scope/function
  const sorted = [...result.annotations].sort((a, b) => a.line - b.line);

  for (const ann of sorted) {
    if (ann.kind === 'expression') continue; // Skip expressions in report

    const location = `${ann.line}:${ann.column}`.padEnd(8);
    const kind = ann.kind.padEnd(12);
    const name = (ann.name ?? '(anonymous)').padEnd(20);

    lines.push(`  ${location} ${kind} ${name}`);
    lines.push(`             └─ ${ann.typeString}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}
