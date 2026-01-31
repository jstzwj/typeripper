/**
 * Built-in Type Definitions
 * Definitions for JavaScript built-in objects and methods
 */

import type { TypeEnvironment } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { createBinding, createEnvironment } from '../../types/analysis.js';

// ============================================================================
// Create Built-in Environment
// ============================================================================

export function createBuiltinEnvironment(): TypeEnvironment {
  const env = createEnvironment(null, 'global');

  // Global constructors
  addBuiltin(env, 'Object', createObjectType());
  addBuiltin(env, 'Array', createArrayType());
  addBuiltin(env, 'String', createStringType());
  addBuiltin(env, 'Number', createNumberType());
  addBuiltin(env, 'Boolean', createBooleanType());
  addBuiltin(env, 'Symbol', createSymbolType());
  addBuiltin(env, 'BigInt', createBigIntType());
  addBuiltin(env, 'Function', createFunctionType());
  addBuiltin(env, 'Date', createDateType());
  addBuiltin(env, 'RegExp', createRegExpType());
  addBuiltin(env, 'Error', createErrorType());
  addBuiltin(env, 'Map', createMapType());
  addBuiltin(env, 'Set', createSetType());
  addBuiltin(env, 'Promise', createPromiseType());
  addBuiltin(env, 'Proxy', Types.any());
  addBuiltin(env, 'Reflect', createReflectType());
  addBuiltin(env, 'WeakMap', Types.any());
  addBuiltin(env, 'WeakSet', Types.any());
  addBuiltin(env, 'WeakRef', Types.any());
  addBuiltin(env, 'FinalizationRegistry', Types.any());

  // Global objects
  addBuiltin(env, 'Math', createMathType());
  addBuiltin(env, 'console', createConsoleType());
  addBuiltin(env, 'JSON', createJSONType());

  // Global functions
  addBuiltin(env, 'parseInt', createParseIntType());
  addBuiltin(env, 'parseFloat', createParseFloatType());
  addBuiltin(env, 'isNaN', createIsNaNType());
  addBuiltin(env, 'isFinite', createIsFiniteType());
  addBuiltin(env, 'eval', createEvalType());
  addBuiltin(env, 'encodeURIComponent', createEncodeURIComponentType());
  addBuiltin(env, 'decodeURIComponent', createDecodeURIComponentType());

  // Global values
  addBuiltin(env, 'undefined', Types.undefined());
  addBuiltin(env, 'NaN', Types.number(NaN));
  addBuiltin(env, 'Infinity', Types.number(Infinity));

  return env;
}

function addBuiltin(env: TypeEnvironment, name: string, type: Type): void {
  const binding = createBinding(
    { type: 'Identifier', name } as any,
    type,
    'const',
    false,
    'global',
    true
  );

  // Create new environment with the binding added
  const newBindings = new Map(env.bindings);
  newBindings.set(name, binding);

  // Note: In actual implementation, we'd return a new environment
  // For now, we'll modify in place (this works because bindings is a Map)
  (env as unknown as { bindings: Map<string, any> }).bindings = newBindings;
}

type Type = import('../../types/types.js').Type;

// Helper function to convert Map to Record for Types.object
function mapToRecord(map: Map<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of map) {
    result[key] = value;
  }
  return result;
}

// ============================================================================
// Object Constructor
// ============================================================================

function createObjectType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any(), true)],
    returnType: Types.object({}),
  });
}

// ============================================================================
// Array Constructor
// ============================================================================

function createArrayType(): Type {
  return Types.function({
    params: [
      Types.param('length', Types.number(), true),
      Types.param('items', Types.unknown(), false, true),
    ],
    returnType: Types.array(Types.unknown()),
  });
}

// ============================================================================
// String Constructor
// ============================================================================

function createStringType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any(), true)],
    returnType: Types.string(),
  });
}

// ============================================================================
// Number Constructor
// ============================================================================

function createNumberType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any(), true)],
    returnType: Types.number(),
  });
}

// ============================================================================
// Boolean Constructor
// ============================================================================

function createBooleanType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any(), true)],
    returnType: Types.boolean(),
  });
}

// ============================================================================
// Symbol Constructor
// ============================================================================

function createSymbolType(): Type {
  return Types.function({
    params: [Types.param('description', Types.string(), true)],
    returnType: Types.symbol(),
  });
}

// ============================================================================
// BigInt Constructor
// ============================================================================

function createBigIntType(): Type {
  return Types.function({
    params: [Types.param('value', Types.union(Types.number(), Types.string()), false)],
    returnType: Types.bigint(),
  });
}

// ============================================================================
// Function Constructor
// ============================================================================

function createFunctionType(): Type {
  return Types.function({
    params: [
      Types.param('body', Types.string()),
      Types.param('args', Types.string(), false, true),
    ],
    returnType: Types.function({
      params: [],
      returnType: Types.any(),
    }),
  });
}

// ============================================================================
// Date Constructor
// ============================================================================

function createDateType(): Type {
  return Types.function({
    params: [
      Types.param('value', Types.union(Types.number(), Types.string(), Types.object({}), Types.array(Types.number())), true),
    ],
    returnType: Types.object({
      properties: mapToRecord(new Map([
        ['toString', Types.property(Types.function({ params: [], returnType: Types.string() }))],
        ['toISOString', Types.property(Types.function({ params: [], returnType: Types.string() }))],
        ['getTime', Types.property(Types.function({ params: [], returnType: Types.number() }))],
        ['setTime', Types.property(Types.function({ params: [Types.param('time', Types.number())], returnType: Types.number() }))],
      ])),
    }),
  });
}

// ============================================================================
// RegExp Constructor
// ============================================================================

function createRegExpType(): Type {
  return Types.function({
    params: [
      Types.param('pattern', Types.union(Types.string(), Types.object({}))),
      Types.param('flags', Types.string(), true),
    ],
    returnType: Types.object({
      properties: mapToRecord(new Map([        ['test', Types.property(Types.function({
          params: [Types.param('str', Types.string())],
          returnType: Types.boolean(),
        }))],
        ['exec', Types.property(Types.function({
          params: [Types.param('str', Types.string())],
          returnType: Types.union(Types.object({}), Types.null()),
        }))],
        ['source', Types.property(Types.string())],
        ['flags', Types.property(Types.string())],
      ])),
    }),
  });
}

// ============================================================================
// Error Constructor
// ============================================================================

function createErrorType(): Type {
  return Types.function({
    params: [Types.param('message', Types.string(), true)],
    returnType: Types.object({
      properties: mapToRecord(new Map([        ['message', Types.property(Types.string())],
        ['name', Types.property(Types.string())],
        ['stack', Types.property(Types.string())],
      ])),
    }),
  });
}

// ============================================================================
// Map Constructor
// ============================================================================

function createMapType(): Type {
  return Types.function({
    params: [Types.param('entries', Types.any(), true)],
    returnType: Types.object({
      properties: mapToRecord(new Map([        ['set', Types.property(Types.function({
          params: [Types.param('key', Types.any()), Types.param('value', Types.any())],
          returnType: Types.object({}),
        }))],
        ['get', Types.property(Types.function({
          params: [Types.param('key', Types.any())],
          returnType: Types.any(),
        }))],
        ['has', Types.property(Types.function({
          params: [Types.param('key', Types.any())],
          returnType: Types.boolean(),
        }))],
        ['delete', Types.property(Types.function({
          params: [Types.param('key', Types.any())],
          returnType: Types.boolean(),
        }))],
        ['clear', Types.property(Types.function({ params: [], returnType: Types.undefined() }))],
        ['size', Types.property(Types.number())],
      ])),
    }),
  });
}

// ============================================================================
// Set Constructor
// ============================================================================

function createSetType(): Type {
  return Types.function({
    params: [Types.param('values', Types.any(), true)],
    returnType: Types.object({
      properties: mapToRecord(new Map([        ['add', Types.property(Types.function({
          params: [Types.param('value', Types.any())],
          returnType: Types.object({}),
        }))],
        ['has', Types.property(Types.function({
          params: [Types.param('value', Types.any())],
          returnType: Types.boolean(),
        }))],
        ['delete', Types.property(Types.function({
          params: [Types.param('value', Types.any())],
          returnType: Types.boolean(),
        }))],
        ['clear', Types.property(Types.function({ params: [], returnType: Types.undefined() }))],
        ['size', Types.property(Types.number())],
      ])),
    }),
  });
}

// ============================================================================
// Promise Constructor
// ============================================================================

function createPromiseType(): Type {
  return Types.function({
    params: [Types.param('executor', Types.function({
      params: [
        Types.param('resolve', Types.function({
          params: [Types.param('value', Types.any())],
          returnType: Types.undefined(),
        })),
        Types.param('reject', Types.function({
          params: [Types.param('reason', Types.any())],
          returnType: Types.undefined(),
        })),
      ],
      returnType: Types.undefined(),
    }))],
    returnType: Types.object({
      properties: mapToRecord(new Map([        ['then', Types.property(Types.function({
          params: [
            Types.param('onFulfilled', Types.function({
              params: [Types.param('value', Types.any())],
              returnType: Types.any(),
            }), true),
            Types.param('onRejected', Types.function({
              params: [Types.param('reason', Types.any())],
              returnType: Types.any(),
            }), true),
          ],
          returnType: Types.promise(Types.unknown()),
        }))],
        ['catch', Types.property(Types.function({
          params: [Types.param('onRejected', Types.function({
            params: [Types.param('reason', Types.any())],
            returnType: Types.any(),
          }))],
          returnType: Types.promise(Types.unknown()),
        }))],
        ['finally', Types.property(Types.function({
          params: [Types.param('onFinally', Types.function({
            params: [],
            returnType: Types.undefined(),
          }))],
          returnType: Types.promise(Types.unknown()),
        }))],
      ])),
    }),
  });
}

// ============================================================================
// Reflect Object
// ============================================================================

function createReflectType(): Type {
  return Types.object({
    properties: mapToRecord(new Map([      ['get', Types.property(Types.function({
        params: [Types.param('target', Types.any()), Types.param('prop', Types.string())],
        returnType: Types.any(),
      }))],
      ['set', Types.property(Types.function({
        params: [Types.param('target', Types.any()), Types.param('prop', Types.string()), Types.param('value', Types.any())],
        returnType: Types.boolean(),
      }))],
      ['has', Types.property(Types.function({
        params: [Types.param('target', Types.any()), Types.param('prop', Types.string())],
        returnType: Types.boolean(),
      }))],
      ['deleteProperty', Types.property(Types.function({
        params: [Types.param('target', Types.any()), Types.param('prop', Types.string())],
        returnType: Types.boolean(),
      }))],
      ['apply', Types.property(Types.function({
        params: [
          Types.param('target', Types.any()),
          Types.param('thisArg', Types.any()),
          Types.param('arguments', Types.array(Types.any())),
        ],
        returnType: Types.any(),
      }))],
    ])),
  });
}

// ============================================================================
// Math Object
// ============================================================================

function createMathType(): Type {
  return Types.object({
    properties: mapToRecord(new Map([
      ['E', Types.property(Types.number())],
      ['PI', Types.property(Types.number())],
      ['abs', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['floor', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['ceil', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['round', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['sqrt', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['pow', Types.property(Types.function({
        params: [Types.param('x', Types.number()), Types.param('y', Types.number())],
        returnType: Types.number(),
      }))],
      ['min', Types.property(Types.function({
        params: [Types.param('values', Types.number(), false, true)],
        returnType: Types.number(),
      }))],
      ['max', Types.property(Types.function({
        params: [Types.param('values', Types.number(), false, true)],
        returnType: Types.number(),
      }))],
      ['random', Types.property(Types.function({
        params: [],
        returnType: Types.number(),
      }))],
      ['sin', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['cos', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
      ['tan', Types.property(Types.function({
        params: [Types.param('x', Types.number())],
        returnType: Types.number(),
      }))],
    ])),
  });
}

// ============================================================================
// Console Object
// ============================================================================

function createConsoleType(): Type {
  return Types.object({
    properties: mapToRecord(new Map([
      ['log', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['error', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['warn', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['info', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['debug', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['trace', Types.property(Types.function({
        params: [Types.param('args', Types.any(), false, true)],
        returnType: Types.undefined(),
      }))],
      ['table', Types.property(Types.function({
        params: [Types.param('data', Types.any())],
        returnType: Types.undefined(),
      }))],
    ])),
  });
}

// ============================================================================
// JSON Object
// ============================================================================

function createJSONType(): Type {
  return Types.object({
    properties: mapToRecord(new Map([
      ['parse', Types.property(Types.function({
        params: [Types.param('text', Types.string())],
        returnType: Types.any(),
      }))],
      ['stringify', Types.property(Types.function({
        params: [Types.param('value', Types.any())],
        returnType: Types.string(),
      }))],
    ])),
  });
}

// ============================================================================
// Global Functions
// ============================================================================

function createParseIntType(): Type {
  return Types.function({
    params: [
      Types.param('string', Types.string()),
      Types.param('radix', Types.number(), true),
    ],
    returnType: Types.number(),
  });
}

function createParseFloatType(): Type {
  return Types.function({
    params: [Types.param('string', Types.string())],
    returnType: Types.number(),
  });
}

function createIsNaNType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any())],
    returnType: Types.boolean(),
  });
}

function createIsFiniteType(): Type {
  return Types.function({
    params: [Types.param('value', Types.any())],
    returnType: Types.boolean(),
  });
}

function createEvalType(): Type {
  return Types.function({
    params: [Types.param('code', Types.string())],
    returnType: Types.any(),
  });
}

function createEncodeURIComponentType(): Type {
  return Types.function({
    params: [Types.param('uri', Types.string())],
    returnType: Types.string(),
  });
}

function createDecodeURIComponentType(): Type {
  return Types.function({
    params: [Types.param('uri', Types.string())],
    returnType: Types.string(),
  });
}
