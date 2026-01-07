#!/usr/bin/env npx tsx
/**
 * CLI script to run type inference on a JavaScript file
 * Usage: npx tsx scripts/infer.ts <file.js> [options]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '../src/parser/index.js';
import { inferProgram } from '../src/inference/inferrer/infer.js';
import {
  formatReport,
  formatJSON,
  formatDTS,
  formatInline,
} from '../src/output/index.js';

// ============================================================================
// Main Entry Point
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  // Parse arguments
  let filePath = '';
  let format = 'report';
  let verbose = false;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('Error: No file path provided');
    process.exit(1);
  }

  // Validate format
  const validFormats = ['report', 'json', 'dts', 'inline'];
  if (!validFormats.includes(format)) {
    console.error(`Error: Invalid format '${format}'`);
    console.error(`Valid formats: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  // Resolve and read file
  const absolutePath = resolve(process.cwd(), filePath);
  let source: string;

  try {
    source = readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    console.error(`Error: Could not read file '${absolutePath}'`);
    process.exit(1);
  }

  // Parse the source
  console.error(`Parsing ${filePath}...`);
  const { ast, errors: parseErrors } = parse(source);

  if (parseErrors.length > 0) {
    console.error('Parse errors:');
    for (const err of parseErrors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  // Run type inference
  const startTime = Date.now();
  console.error('Running MLsub type inference...');

  const result = inferProgram(ast.program);

  const elapsed = Date.now() - startTime;
  console.error(`Analysis completed in ${elapsed}ms`);
  console.error(`Found ${result.bindings.size} type bindings`);

  if (!result.success) {
    console.error(`Found ${result.errors.length} type errors`);
    for (const error of result.errors) {
      console.error(`  - ${error.message}`);
      if (error.location) {
        console.error(`    at ${error.location.file}:${error.location.line}:${error.location.column}`);
      }
    }
  }
  console.error('');

  // Format output using the output module
  switch (format) {
    case 'json':
      console.log(formatJSON(result));
      break;
    case 'dts':
      console.log(formatDTS(result, filePath));
      break;
    case 'inline':
      console.log(formatInline(result, source));
      break;
    case 'report':
    default:
      console.log(formatReport(result, { verbose }));
      break;
  }
}

// ============================================================================
// Usage
// ============================================================================

function printUsage() {
  console.log('Usage: npx tsx scripts/infer.ts <file.js> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --format=report   Human-readable analysis report (default)');
  console.log('  --format=json     Machine-readable JSON output');
  console.log('  --format=dts      TypeScript declaration file format');
  console.log('  --format=inline   Source code with inline type comments');
  console.log('  --verbose, -v     Show detailed type information');
  console.log('  --help, -h        Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/infer.ts src/app.js');
  console.log('  npx tsx scripts/infer.ts src/app.js --format=dts > app.d.ts');
  console.log('  npx tsx scripts/infer.ts src/app.js --format=inline');
}

// ============================================================================
// Run
// ============================================================================

main();
