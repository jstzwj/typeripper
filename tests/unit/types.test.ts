/**
 * Tests for type factory and type utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Types, resetTypeIdCounter, typeToString, isSubtypeOf, narrowByTypeof, canBeFalsy, canBeTruthy } from '../../src/utils/index.js';

describe('Type Factory', () => {
  beforeEach(() => {
    resetTypeIdCounter();
  });

  describe('primitive types', () => {
    it('should create singleton primitive types', () => {
      expect(Types.undefined.kind).toBe('undefined');
      expect(Types.null.kind).toBe('null');
      expect(Types.boolean.kind).toBe('boolean');
      expect(Types.number.kind).toBe('number');
      expect(Types.string.kind).toBe('string');
      expect(Types.bigint.kind).toBe('bigint');
      expect(Types.symbol.kind).toBe('symbol');
      expect(Types.never.kind).toBe('never');
      expect(Types.unknown.kind).toBe('unknown');
    });

    it('should create literal types', () => {
      const trueType = Types.booleanLiteral(true);
      expect(trueType.kind).toBe('boolean');
      expect(trueType.value).toBe(true);

      const numType = Types.numberLiteral(42);
      expect(numType.kind).toBe('number');
      expect(numType.value).toBe(42);

      const strType = Types.stringLiteral('hello');
      expect(strType.kind).toBe('string');
      expect(strType.value).toBe('hello');
    });
  });

  describe('union types', () => {
    it('should create union of two types', () => {
      const union = Types.union([Types.string, Types.number]);
      expect(union.kind).toBe('union');
      if (union.kind === 'union') {
        expect(union.members).toHaveLength(2);
      }
    });

    it('should flatten nested unions', () => {
      const inner = Types.union([Types.string, Types.number]);
      const outer = Types.union([inner, Types.boolean]);
      expect(outer.kind).toBe('union');
      if (outer.kind === 'union') {
        expect(outer.members).toHaveLength(3);
      }
    });

    it('should remove never from unions', () => {
      const union = Types.union([Types.string, Types.never]);
      expect(union.kind).toBe('string');
    });

    it('should return never for empty union', () => {
      const union = Types.union([Types.never]);
      expect(union.kind).toBe('never');
    });

    it('should return single type if union has one member', () => {
      const union = Types.union([Types.string]);
      expect(union.kind).toBe('string');
    });

    it('should remove duplicates', () => {
      const union = Types.union([Types.string, Types.string, Types.number]);
      expect(union.kind).toBe('union');
      if (union.kind === 'union') {
        expect(union.members).toHaveLength(2);
      }
    });
  });

  describe('function types', () => {
    it('should create function type', () => {
      const fn = Types.function({
        params: [
          Types.param('x', Types.number),
          Types.param('y', Types.string, { optional: true }),
        ],
        returnType: Types.boolean,
      });
      expect(fn.kind).toBe('function');
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0]?.name).toBe('x');
      expect(fn.params[1]?.optional).toBe(true);
      expect(fn.returnType.kind).toBe('boolean');
      expect(fn.isAsync).toBe(false);
      expect(fn.isGenerator).toBe(false);
    });

    it('should create async function type', () => {
      const fn = Types.function({
        params: [],
        returnType: Types.promise(Types.string),
        isAsync: true,
      });
      expect(fn.isAsync).toBe(true);
    });
  });

  describe('object types', () => {
    it('should create object type with properties', () => {
      const props = new Map([
        ['name', Types.property(Types.string)],
        ['age', Types.property(Types.number)],
      ]);
      const obj = Types.object({ properties: props });
      expect(obj.kind).toBe('object');
      expect(obj.properties.size).toBe(2);
    });
  });

  describe('array types', () => {
    it('should create array type', () => {
      const arr = Types.array(Types.number);
      expect(arr.kind).toBe('array');
      expect(arr.elementType.kind).toBe('number');
    });

    it('should create tuple type', () => {
      const tuple = Types.tuple([Types.string, Types.number, Types.boolean]);
      expect(tuple.kind).toBe('array');
      expect(tuple.tuple).toHaveLength(3);
      expect(tuple.length).toBe(3);
    });
  });
});

describe('Type Utilities', () => {
  describe('typeToString', () => {
    it('should format primitive types', () => {
      expect(typeToString(Types.undefined)).toBe('undefined');
      expect(typeToString(Types.null)).toBe('null');
      expect(typeToString(Types.boolean)).toBe('boolean');
      expect(typeToString(Types.number)).toBe('number');
      expect(typeToString(Types.string)).toBe('string');
    });

    it('should format literal types', () => {
      expect(typeToString(Types.booleanLiteral(true))).toBe('true');
      expect(typeToString(Types.numberLiteral(42))).toBe('42');
      expect(typeToString(Types.stringLiteral('hello'))).toBe('"hello"');
    });

    it('should format union types', () => {
      const union = Types.union([Types.string, Types.number]);
      expect(typeToString(union)).toBe('string | number');
    });
  });

  describe('isSubtypeOf', () => {
    it('should handle same types', () => {
      expect(isSubtypeOf(Types.string, Types.string)).toBe(true);
      expect(isSubtypeOf(Types.number, Types.number)).toBe(true);
    });

    it('should handle never as subtype', () => {
      expect(isSubtypeOf(Types.never, Types.string)).toBe(true);
      expect(isSubtypeOf(Types.never, Types.number)).toBe(true);
    });

    it('should handle any as supertype', () => {
      expect(isSubtypeOf(Types.string, Types.any())).toBe(true);
      expect(isSubtypeOf(Types.number, Types.any())).toBe(true);
    });

    it('should handle union subtypes', () => {
      const union = Types.union([Types.string, Types.number]);
      expect(isSubtypeOf(Types.string, union)).toBe(true);
      expect(isSubtypeOf(Types.boolean, union)).toBe(false);
    });

    it('should handle literal subtypes', () => {
      const literal = Types.stringLiteral('hello');
      expect(isSubtypeOf(literal, Types.string)).toBe(true);
    });
  });

  describe('narrowByTypeof', () => {
    it('should narrow union by typeof', () => {
      const union = Types.union([Types.string, Types.number, Types.boolean]);

      const narrowedToString = narrowByTypeof(union, 'string', false);
      expect(narrowedToString.kind).toBe('string');

      const narrowedNotString = narrowByTypeof(union, 'string', true);
      expect(narrowedNotString.kind).toBe('union');
    });

    it('should return never for impossible narrowing', () => {
      const narrowed = narrowByTypeof(Types.string, 'number', false);
      expect(narrowed.kind).toBe('never');
    });
  });

  describe('canBeFalsy / canBeTruthy', () => {
    it('should identify falsy types', () => {
      expect(canBeFalsy(Types.undefined)).toBe(true);
      expect(canBeFalsy(Types.null)).toBe(true);
      expect(canBeFalsy(Types.booleanLiteral(false))).toBe(true);
      expect(canBeFalsy(Types.numberLiteral(0))).toBe(true);
      expect(canBeFalsy(Types.stringLiteral(''))).toBe(true);
    });

    it('should identify truthy types', () => {
      expect(canBeTruthy(Types.booleanLiteral(true))).toBe(true);
      expect(canBeTruthy(Types.numberLiteral(1))).toBe(true);
      expect(canBeTruthy(Types.stringLiteral('hello'))).toBe(true);
      expect(canBeTruthy(Types.object({}))).toBe(true);
    });

    it('should handle general types', () => {
      expect(canBeFalsy(Types.boolean)).toBe(true);
      expect(canBeTruthy(Types.boolean)).toBe(true);
      expect(canBeFalsy(Types.number)).toBe(true);
      expect(canBeTruthy(Types.number)).toBe(true);
    });
  });
});
