/**
 * Member Expression Type Inference - Infer types for property access
 */

import * as t from '@babel/types';
import type { Type } from '../../types/index.js';
import type { TypeState } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import type { IterativeContext } from './context.js';
import { inferExpression, registerMembers } from './expressions.js';

/**
 * Infer member expression type
 */
export function inferMemberExpression(
  expr: t.MemberExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const objectType = t.isExpression(expr.object)
    ? inferExpression(expr.object, state, ctx)
    : Types.any();

  let propName: string | undefined;
  if (t.isIdentifier(expr.property) && !expr.computed) {
    propName = expr.property.name;
  } else if (t.isStringLiteral(expr.property)) {
    propName = expr.property.value;
  }

  if (propName && objectType.kind === 'object') {
    const prop = objectType.properties.get(propName);
    if (prop) {
      return prop.type;
    }
  }

  if (objectType.kind === 'array') {
    if (t.isNumericLiteral(expr.property) && objectType.tuple) {
      const idx = expr.property.value;
      if (idx >= 0 && idx < objectType.tuple.length) {
        return objectType.tuple[idx]!;
      }
    }

    if (propName) {
      const elemType = objectType.elementType;
      const arrayMethods: Record<string, Type> = {
        length: Types.number,
        push: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        pop: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        shift: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        unshift: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        slice: Types.function({
          params: [
            Types.param('start', Types.number, { optional: true }),
            Types.param('end', Types.number, { optional: true }),
          ],
          returnType: Types.array(elemType),
        }),
        map: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.any() })
            ),
          ],
          returnType: Types.array(Types.any()),
        }),
        filter: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.array(elemType),
        }),
        find: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        includes: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.boolean,
        }),
        indexOf: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.number,
        }),
        join: Types.function({
          params: [Types.param('sep', Types.string, { optional: true })],
          returnType: Types.string,
        }),
        forEach: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({
                params: [Types.param('item', elemType)],
                returnType: Types.undefined,
              })
            ),
          ],
          returnType: Types.undefined,
        }),
        reduce: Types.function({
          params: [Types.param('fn', Types.any()), Types.param('init', Types.any(), { optional: true })],
          returnType: Types.any(),
        }),
      };
      if (arrayMethods[propName]) {
        return arrayMethods[propName]!;
      }
    }

    return objectType.elementType;
  }

  if (objectType.kind === 'string' && propName) {
    const stringMethods: Record<string, Type> = {
      length: Types.number,
      charAt: Types.function({
        params: [Types.param('index', Types.number)],
        returnType: Types.string,
      }),
      slice: Types.function({
        params: [
          Types.param('start', Types.number),
          Types.param('end', Types.number, { optional: true }),
        ],
        returnType: Types.string,
      }),
      split: Types.function({
        params: [Types.param('sep', Types.string)],
        returnType: Types.array(Types.string),
      }),
      toLowerCase: Types.function({ params: [], returnType: Types.string }),
      toUpperCase: Types.function({ params: [], returnType: Types.string }),
      trim: Types.function({ params: [], returnType: Types.string }),
      includes: Types.function({
        params: [Types.param('search', Types.string)],
        returnType: Types.boolean,
      }),
    };
    if (stringMethods[propName]) {
      return stringMethods[propName]!;
    }
  }

  return Types.any();
}

/**
 * Infer optional expression type
 */
export function inferOptionalExpression(
  expr: t.OptionalMemberExpression | t.OptionalCallExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (t.isOptionalMemberExpression(expr)) {
    const objectType = inferExpression(expr.object, state, ctx);

    let propName: string | undefined;
    if (t.isIdentifier(expr.property) && !expr.computed) {
      propName = expr.property.name;
    }

    if (propName && objectType.kind === 'object') {
      const prop = objectType.properties.get(propName);
      if (prop) return prop.type;
    }
  } else if (t.isOptionalCallExpression(expr)) {
    const calleeType = inferExpression(expr.callee, state, ctx);
    if (calleeType.kind === 'function') {
      return calleeType.returnType;
    }
  }

  return Types.any();
}

// Register implementations with expressions module
registerMembers({
  inferMemberExpression,
  inferOptionalExpression,
});
