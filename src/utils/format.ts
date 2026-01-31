/**
 * Type formatting utilities - convert types to human-readable strings
 */

import type { Type } from '../types/types.js';
import {
  isUndefinedType,
  isNullType,
  isBooleanType,
  isNumberType,
  isStringType,
  isFunctionType,
  isObjectType,
  isArrayType,
  isClassType,
  isUnionType,
  isIntersectionType,
  isAnyType,
  isNeverType,
  isUnknownType,
  isBigIntType,
  isSymbolType,
} from '../types/types.js';

// ============================================================================
// Format Options
// ============================================================================

export interface FormatOptions {
  readonly verbose?: boolean;
  readonly includeId?: boolean;
  readonly pretty?: boolean;
  readonly indent?: number;
  readonly maxDepth?: number;
  readonly compact?: boolean;
}

const DEFAULT_OPTIONS: FormatOptions = {
  verbose: false,
  includeId: false,
  pretty: false,
  indent: 2,
  maxDepth: 5,
};

// ============================================================================
// Main Format Function
// ============================================================================

export function formatType(type: Type, options: FormatOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return formatTypeRecursive(type, opts, 0);
}

function formatTypeRecursive(type: Type, options: FormatOptions, depth: number): string {
  if (options.maxDepth !== undefined && depth >= options.maxDepth) {
    return '...';
  }

  let result = '';

  if (options.includeId) {
    result += `<${type.id}>`;
  }

  switch (type.kind) {
    case 'undefined':
      result += 'undefined';
      break;

    case 'null':
      result += 'null';
      break;

    case 'boolean':
      result += type.value !== undefined ? String(type.value) : 'boolean';
      break;

    case 'number':
      if (type.value !== undefined) {
        result = String(type.value);
        if (!Number.isFinite(type.value)) {
          if (isNaN(type.value)) result = 'NaN';
          else result = type.value > 0 ? 'Infinity' : '-Infinity';
        }
      } else {
        result += 'number';
      }
      break;

    case 'string':
      if (type.value !== undefined) {
        result = JSON.stringify(type.value);
      } else {
        result += 'string';
      }
      break;

    case 'bigint':
      result += type.value !== undefined ? `${type.value}n` : 'bigint';
      break;

    case 'symbol':
      if (type.description) {
        result = `Symbol(${JSON.stringify(type.description)})`;
      } else {
        result += 'symbol';
      }
      break;

    case 'function':
      result += formatFunctionType(type, options, depth);
      break;

    case 'object':
      result += formatObjectType(type, options, depth);
      break;

    case 'array':
      result += formatArrayType(type, options, depth);
      break;

    case 'class':
      result += formatClassType(type, options, depth);
      break;

    case 'union':
      result += formatUnionType(type, options, depth);
      break;

    case 'intersection':
      result += formatIntersectionType(type, options, depth);
      break;

    case 'any':
      result += 'any';
      if (options.verbose && type.reason) {
        result += ` /* ${type.reason} */`;
      }
      break;

    case 'never':
      result += 'never';
      break;

    case 'unknown':
      result += 'unknown';
      break;

    case 'typevar':
      result += type.name;
      if (options.verbose) {
        if (type.upperBound) {
          result += ` extends ${formatTypeRecursive(type.upperBound, options, depth + 1)}`;
        }
        if (type.lowerBound) {
          result += ` >= ${formatTypeRecursive(type.lowerBound, options, depth + 1)}`;
        }
      }
      break;

    case 'promise':
      result += `Promise<${formatTypeRecursive(type.returnType, options, depth + 1)}>`;
      break;

    case 'iterator':
      result += `Iterator<${formatTypeRecursive(type.yieldType, options, depth + 1)}, ${formatTypeRecursive(type.returnType, options, depth + 1)}>`;
      break;

    case 'generator':
      result += `Generator<${formatTypeRecursive(type.yieldType, options, depth + 1)}, ${formatTypeRecursive(type.returnType, options, depth + 1)}, ${formatTypeRecursive(type.nextType, options, depth + 1)}>`;
      break;

    default:
      result += 'unknown';
  }

  return result;
}

// ============================================================================
// Format Functions for Specific Types
// ============================================================================

function formatFunctionType(type: Type & { kind: 'function' }, options: FormatOptions, depth: number): string {
  const params = type.params.map(p => {
    let param = p.rest ? `...${p.name}` : p.name;
    param += ': ';
    param += formatTypeRecursive(p.type, options, depth + 1);
    if (p.optional) param += '?';
    return param;
  }).join(', ');

  let result = '';

  if (type.isAsync) result += 'async ';
  if (type.isGenerator) result += '*';

  result += `(${params}) => ${formatTypeRecursive(type.returnType, options, depth + 1)}`;

  if (options.verbose && type.thisType) {
    result = `this: ${formatTypeRecursive(type.thisType, options, depth + 1)} => ${result}`;
  }

  if (options.verbose && type.captures.size > 0) {
    const captures = Array.from(type.captures.entries())
      .map(([name, t]) => `${name}: ${formatTypeRecursive(t, options, depth + 1)}`)
      .join(', ');
    result = `[captures: ${captures}] ${result}`;
  }

  return result;
}

function formatObjectType(type: Type & { kind: 'object' }, options: FormatOptions, depth: number): string {
  if (type.properties.size === 0) {
    return '{}';
  }

  const props: string[] = [];
  const indent = ' '.repeat((depth + 1) * (options.indent ?? 2));

  for (const [key, prop] of type.properties) {
    let propStr = '';
    if (options.pretty && depth > 0) {
      propStr += '\n' + indent;
    }

    // Handle computed property names
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
      propStr += key;
    } else {
      propStr += JSON.stringify(key);
    }

    propStr += ': ' + formatTypeRecursive(prop.type, options, depth + 1);

    if (options.verbose) {
      const flags = [];
      if (!prop.writable) flags.push('readonly');
      if (!prop.enumerable) flags.push('non-enum');
      if (!prop.configurable) flags.push('non-config');
      if (flags.length > 0) {
        propStr += ` /* ${flags.join(', ')} */`;
      }
    }

    props.push(propStr);
  }

  if (options.pretty) {
    return `{\n${indent}${props.join(',\n' + indent)}\n${' '.repeat(depth * (options.indent ?? 2))}}`;
  }

  return `{ ${props.join(', ')} }`;
}

function formatArrayType(type: Type & { kind: 'array' }, options: FormatOptions, depth: number): string {
  const readonly = type.readOnly ? 'readonly ' : '';
  return `${readonly}${formatTypeRecursive(type.elementType, options, depth + 1)}[]`;
}

function formatClassType(type: Type & { kind: 'class' }, options: FormatOptions, depth: number): string {
  let result = `class ${type.name}`;

  if (options.verbose) {
    if (type.superClass) {
      result += ` extends ${type.superClass.name}`;
    }

    const instanceProps = Array.from(type.instanceType.properties.keys());
    if (instanceProps.length > 0) {
      result += ` { ${instanceProps.join(', ')} }`;
    }
  }

  return result;
}

function formatUnionType(type: Type & { kind: 'union' }, options: FormatOptions, depth: number): string {
  if (type.members.length === 0) {
    return 'never';
  }

  const members = type.members.map(m => formatTypeRecursive(m, options, depth + 1));

  // Special case: null | undefined -> ?
  if (members.length === 2 && members.includes('null') && members.includes('undefined')) {
    return '?';
  }

  // Special case: T | null -> T?
  if (members.length === 2 && members.includes('null')) {
    const other = members.find(m => m !== 'null');
    if (other) return `${other}?`;
  }

  // Group primitive types for cleaner output
  const primitives = members.filter(m =>
    m === 'undefined' || m === 'null' || m === 'boolean' ||
    m === 'number' || m === 'string' || m === 'bigint' || m === 'symbol'
  );

  if (primitives.length > 2) {
    const primitivesSet = new Set<string>(primitives);
    const remaining = members.filter(m => !primitivesSet.has(m));
    if (remaining.length === 0) {
      return 'primitive';
    }
    return `${primitives.join(' | ')} | ${remaining.join(' | ')}`;
  }

  return members.join(' | ');
}

function formatIntersectionType(type: Type & { kind: 'intersection' }, options: FormatOptions, depth: number): string {
  if (type.members.length === 0) {
    return 'unknown';
  }

  const members = type.members.map(m => formatTypeRecursive(m, options, depth + 1));
  return members.join(' & ');
}

// ============================================================================
// Color Formatting (for terminal output)
// ============================================================================

export function formatTypeColored(type: Type, options: FormatOptions = {}): string {
  const formatted = formatType(type, options);

  // Apply colors based on type kind
  let color = '\x1b[37m'; // FgWhite
  switch (type.kind) {
    case 'boolean':
      color = '\x1b[33m'; // FgYellow
      break;
    case 'number':
    case 'bigint':
      color = '\x1b[35m'; // FgMagenta
      break;
    case 'string':
      color = '\x1b[32m'; // FgGreen
      break;
    case 'function':
      color = '\x1b[34m'; // FgBlue
      break;
    case 'class':
      color = '\x1b[36m'; // FgCyan
      break;
    case 'union':
    case 'intersection':
      color = '\x1b[31m'; // FgRed
      break;
    case 'any':
      color = '\x1b[41m\x1b[37m'; // BgRed + FgWhite
      break;
    case 'never':
      color = '\x1b[31m'; // FgRed
      break;
    case 'unknown':
      color = '\x1b[33m'; // FgYellow
      break;
  }

  return `${color}${formatted}\x1b[0m`;
}

// ============================================================================
// Compact Format (for inline display)
// ============================================================================

export function formatTypeCompact(type: Type): string {
  return formatType(type, { verbose: false, pretty: false, includeId: false, maxDepth: 3 });
}

// ============================================================================
// Verbose Format (for debugging)
// ============================================================================

export function formatTypeVerbose(type: Type): string {
  return formatType(type, {
    verbose: true,
    pretty: true,
    includeId: true,
    maxDepth: 10,
    indent: 2,
  });
}
