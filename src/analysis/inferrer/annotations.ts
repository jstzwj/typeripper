/**
 * Annotation Utilities - Type annotation helpers
 *
 * This module provides utilities for adding type annotations during inference.
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { AnnotationKind } from '../../types/annotation.js';
import { formatType } from '../../output/formatter.js';
import type { InferContext } from './context.js';

/**
 * Add an annotation to the context
 */
export function addAnnotation(
  ctx: InferContext,
  info: {
    node: t.Node;
    name?: string;
    type: Type;
    kind: AnnotationKind;
  }
): void {
  const { node, name, type, kind } = info;
  const loc = node.loc;

  ctx.annotations.push({
    start: node.start ?? 0,
    end: node.end ?? 0,
    line: loc?.start.line ?? 0,
    column: loc?.start.column ?? 0,
    nodeType: node.type,
    name,
    type,
    typeString: formatType(type),
    kind,
  });
}
