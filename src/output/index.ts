/**
 * Output module exports - MLsub PolarType formatters
 */

export {
  typeToTypeScript,
  formatReport,
  formatJSON,
  formatDTS,
  formatInline,
} from './formatter.js';

export type {
  FormatOptions,
  InferredBinding,
  InferenceError,
  ProgramInferenceResult,
} from './formatter.js';
