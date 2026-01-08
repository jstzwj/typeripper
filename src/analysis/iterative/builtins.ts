/**
 * Built-in Types - Global built-in type definitions
 *
 * This module defines built-in JavaScript global types like console, Math, etc.
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment } from '../../types/index.js';
import { Types } from '../../utils/type-factory.js';
import { updateBinding } from './state.js';

/**
 * Add built-in global bindings
 */
export function addBuiltins(env: TypeEnvironment): TypeEnvironment {
  const builtins: Array<[string, Type]> = [
    ['undefined', Types.undefined],
    ['NaN', Types.number],
    ['Infinity', Types.number],
    [
      'console',
      Types.object({
        properties: new Map([
          [
            'log',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
          [
            'error',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
          [
            'warn',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
        ]),
      }),
    ],
    [
      'Math',
      Types.object({
        properties: new Map([
          ['PI', Types.property(Types.numberLiteral(Math.PI))],
          ['E', Types.property(Types.numberLiteral(Math.E))],
          [
            'abs',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'floor',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'ceil',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'round',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          ['random', Types.property(Types.function({ params: [], returnType: Types.number }))],
          [
            'sqrt',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'sin',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'cos',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'pow',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number), Types.param('y', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'min',
            Types.property(
              Types.function({
                params: [Types.param('values', Types.number, { rest: true })],
                returnType: Types.number,
              })
            ),
          ],
          [
            'max',
            Types.property(
              Types.function({
                params: [Types.param('values', Types.number, { rest: true })],
                returnType: Types.number,
              })
            ),
          ],
        ]),
      }),
    ],
    [
      'Date',
      Types.class({
        name: 'Date',
        constructor: Types.function({ params: [], returnType: Types.undefined }),
        instanceType: Types.object({
          properties: new Map([
            ['getTime', Types.property(Types.function({ params: [], returnType: Types.number }))],
            ['toString', Types.property(Types.function({ params: [], returnType: Types.string }))],
          ]),
        }),
        staticProperties: new Map([
          ['now', Types.property(Types.function({ params: [], returnType: Types.number }))],
        ]),
      }),
    ],
    [
      'print',
      Types.function({
        params: [Types.param('args', Types.any(), { rest: true })],
        returnType: Types.undefined,
      }),
    ],
    [
      'JSON',
      Types.object({
        properties: new Map([
          [
            'parse',
            Types.property(
              Types.function({
                params: [Types.param('text', Types.string)],
                returnType: Types.any(),
              })
            ),
          ],
          [
            'stringify',
            Types.property(
              Types.function({
                params: [Types.param('value', Types.any())],
                returnType: Types.string,
              })
            ),
          ],
        ]),
      }),
    ],
    ['Object', Types.function({ params: [], returnType: Types.object({}) })],
    ['Array', Types.function({ params: [], returnType: Types.array(Types.any()) })],
    [
      'String',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.string }),
    ],
    [
      'Number',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.number }),
    ],
    [
      'Boolean',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.boolean }),
    ],
  ];

  let result = env;
  for (const [name, type] of builtins) {
    result = updateBinding(result, name, type, 'var', { type: 'Identifier', name } as t.Identifier);
  }
  return result;
}
