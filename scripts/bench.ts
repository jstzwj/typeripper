#!/usr/bin/env npx tsx
/**
 * Benchmark script to measure inference performance
 */

import { readFileSync } from 'node:fs';
import { parse } from '../src/parser/index.js';
import { inferTypes } from '../src/analysis/index.js';

const filePath = process.argv[2] || 'examples/nbody/nbody_time.js';
const source = readFileSync(filePath, 'utf-8');

console.log(`File: ${filePath}`);
console.log(`Size: ${source.length} bytes, ${source.split('\n').length} lines`);
console.log('');

// Warm up
parse(source);

// Benchmark parse
const parseStart = performance.now();
const { ast } = parse(source);
const parseEnd = performance.now();
console.log(`Parse time: ${(parseEnd - parseStart).toFixed(2)}ms`);

// Benchmark inference
const inferStart = performance.now();
const result = inferTypes(ast, source, filePath);
const inferEnd = performance.now();
console.log(`Inference time: ${(inferEnd - inferStart).toFixed(2)}ms`);

console.log('');
console.log(`Total annotations: ${result.annotations.length}`);
console.log(`Errors: ${result.errors.length}`);
