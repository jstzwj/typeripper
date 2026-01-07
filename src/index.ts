/**
 * Typeripper - JavaScript Type Inference
 *
 * Based on MLsub (Polymorphism, Subtyping, and Type Inference)
 * by Dolan & Mycroft, POPL 2017
 */

// Re-export legacy types (with namespace to avoid conflicts)
export * as LegacyTypes from './types/index.js';

// Re-export utils (with namespace to avoid conflicts)
export * as Utils from './utils/index.js';

// Re-export parser
export * from './parser/index.js';

// Re-export output
export * from './output/index.js';

// Re-export type inference system
export * from './inference/index.js';
