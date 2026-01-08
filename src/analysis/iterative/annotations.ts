/**
 * Annotation Utilities - Type annotation helpers
 *
 * This module provides utilities for adding type annotations during inference.
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { AnnotationKind, TypeAnnotation } from '../../types/annotation.js';
import { formatType } from '../../output/formatter.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';

/**
 * Add an annotation to the context
 */
export function addAnnotation(
  ctx: IterativeContext,
  info: {
    node: t.Node;
    name?: string;
    type: Type;
    kind: AnnotationKind;
    /** If true, only add if no existing annotation (don't update) */
    skipIfExists?: boolean;
  }
): void {
  const { node, name, type, kind, skipIfExists } = info;
  const loc = node.loc;
  const start = node.start ?? 0;

  // Check for duplicate annotation at same position with same name and kind
  const existing = ctx.annotations.find(
    (a) => a.start === start && a.name === name && a.kind === kind
  );
  if (existing) {
    if (skipIfExists) {
      // Don't update, keep the existing (more precise) type
      return;
    }
    // Update the type if it changed (for iterative refinement)
    existing.type = type;
    existing.typeString = formatType(type);
    return;
  }

  ctx.annotations.push({
    start,
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

/**
 * Annotate function parameters
 */
export function annotateParameters(
  params: Array<t.Identifier | t.Pattern | t.RestElement>,
  funcType: Type,
  ctx: IterativeContext
): void {
  if (funcType.kind !== 'function') return;

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const paramType = funcType.params[i]?.type ?? Types.any();

    if (t.isIdentifier(param)) {
      addAnnotation(ctx, {
        node: param,
        name: param.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      addAnnotation(ctx, {
        node: param.argument,
        name: param.argument.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      addAnnotation(ctx, {
        node: param.left,
        name: param.left.name,
        type: paramType,
        kind: 'parameter',
      });
    }
  }
}
