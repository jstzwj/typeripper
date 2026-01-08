#!/usr/bin/env npx tsx
/**
 * CLI script to run type inference on a JavaScript file
 * Usage: npx tsx scripts/infer.ts <file.js> [options]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '../src/parser/index.js';
import { inferTypes, analyzeIterative } from '../src/analysis/index.js';
import {
  formatAsReport,
  formatAsInlineComments,
  formatAsDTS,
  formatAsJSON
} from '../src/output/index.js';

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/infer.ts <file.js> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --format=report   Human-readable analysis report (default)');
    console.log('  --format=json     Machine-readable JSON output');
    console.log('  --format=dts      TypeScript declaration file format');
    console.log('  --format=inline   Source code with inline type comments');
    console.log('  --simple          Use simple single-pass analysis (default: iterative)');
    console.log('  --verbose         Show CFG statistics (iterative mode only)');
    process.exit(1);
  }

  // Parse arguments
  let filePath = '';
  let format = 'report';
  let useSimple = false;
  let verbose = false;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else if (arg === '--simple') {
      useSimple = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    }
  }

  if (!filePath) {
    console.error('Error: No file path provided');
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
  let result;

  if (useSimple) {
    console.error('Running simple (single-pass) type inference...');
    result = inferTypes(ast, source, filePath);
  } else {
    console.error('Running iterative type inference...');
    const iterResult = analyzeIterative(ast, source, filePath);
    result = iterResult;

    if (verbose) {
      console.error('');
      console.error('CFG Statistics:');
      console.error(`  Blocks: ${iterResult.cfg.blocks.size}`);
      console.error(`  Edges: ${iterResult.cfg.edges.size}`);
      console.error(`  Back edges (loops): ${iterResult.cfg.backEdges.size}`);
      console.error(`  Iterations to converge: ${iterResult.iterations}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.error(`Analysis completed in ${elapsed}ms`);
  console.error(`Found ${result.annotations.length} type annotations`);
  if (result.errors.length > 0) {
    console.error(`Found ${result.errors.length} type errors`);
  }
  console.error('');

  // Format output
  let output: string;
  switch (format) {
    case 'json':
      output = formatAsJSON(result);
      break;
    case 'dts':
      output = formatAsDTS(result);
      break;
    case 'inline':
      output = formatAsInlineComments(result);
      break;
    case 'report':
    default:
      output = formatAsReport(result);
      break;
  }

  console.log(output);
}

main();
