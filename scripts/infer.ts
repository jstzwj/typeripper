#!/usr/bin/env node
/**
 * CLI Type Inference Tool
 *
 * Usage:
 *   npm run infer -- <file.js>
 *   npm run infer -- <file.js> --format json
 *   npm run infer -- <file.js> --format d.ts --output types.d.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { inferTypesSimple } from '../src/analysis/iterative/index.js';
import {
  formatForTerminal,
  formatAsJSON,
  formatAsTypeScript,
  formatInlineAnnotations,
  formatSummary,
} from '../src/output/formatter.js';

interface CLIOptions {
  format: 'terminal' | 'json' | 'typescript' | 'inline';
  output?: string;
  verbose?: boolean;
  color?: boolean;
  summary?: boolean;
}

function parseArgs(args: string[]): { file: string; options: CLIOptions } {
  let file = '';
  const options: CLIOptions = {
    format: 'terminal',
    color: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--format') {
      const format = args[++i];
      if (format === 'json' || format === 'typescript' || format === 'inline' || format === 'terminal') {
        options.format = format;
      }
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--no-color') {
      options.color = false;
    } else if (arg === '--summary' || arg === '-s') {
      options.summary = true;
    } else if (!arg.startsWith('-')) {
      file = arg;
    }
  }

  return { file, options };
}

async function main() {
  const args = process.argv.slice(2);
  const { file, options } = parseArgs(args);

  if (!file) {
    console.error('Usage: infer <file.js> [options]');
    console.error('Options:');
    console.error('  --format <format>   Output format: terminal, json, typescript, inline');
    console.error('  --output, -o <file>  Write output to file');
    console.error('  --verbose, -v        Verbose output');
    console.error('  --no-color           Disable colored output');
    console.error('  --summary, -s        Show summary only');
    process.exit(1);
  }

  // Check if file exists
  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  // Read source
  const source = fs.readFileSync(file, 'utf-8');
  const filename = path.basename(file);

  console.error(`Inferring types for ${filename}...`);

  // Infer types
  const result = await inferTypesSimple(source, filename);

  // Format output
  let output: string;

  switch (options.format) {
    case 'json':
      output = formatAsJSON(result);
      break;
    case 'typescript':
      output = formatAsTypeScript(result);
      break;
    case 'inline':
      output = formatInlineAnnotations(result);
      break;
    case 'terminal':
    default:
      output = formatForTerminal(result);
      break;
  }

  // Add summary if requested
  if (options.summary) {
    output = formatSummary(result) + '\n\n' + output;
  }

  // Write output
  if (options.output) {
    fs.writeFileSync(options.output, output, 'utf-8');
    console.error(`Output written to ${options.output}`);
  } else {
    console.log(output);
  }

  console.error(`Found ${result.annotations.length} type annotations`);
}

main().catch(console.error);
