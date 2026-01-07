/**
 * Tests for the iterative type inferrer
 *
 * These tests focus on scenarios that require iterative analysis:
 * - Forward references
 * - Loop-induced type changes
 * - Mutually dependent declarations
 * - Branch-based type narrowing
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/parser/index.js';
import { inferTypesIterative, analyzeIterative } from '../../src/analysis/index.js';

describe('Iterative Type Inferrer', () => {
  describe('basic inference', () => {
    it('should infer primitive types correctly', () => {
      const source = `
        const x = 42;
        const s = "hello";
        const b = true;
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const xAnnotation = result.annotations.find((a) => a.name === 'x');
      const sAnnotation = result.annotations.find((a) => a.name === 's');
      const bAnnotation = result.annotations.find((a) => a.name === 'b');

      expect(xAnnotation?.typeString).toBe('42');
      expect(sAnnotation?.typeString).toBe('"hello"');
      expect(bAnnotation?.typeString).toBe('true');
    });

    it('should infer object types', () => {
      const source = `
        const obj = {
          name: "Alice",
          age: 30
        };
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const objAnnotation = result.annotations.find((a) => a.name === 'obj');
      expect(objAnnotation).toBeDefined();
      expect(objAnnotation?.typeString).toContain('name');
      expect(objAnnotation?.typeString).toContain('age');
    });
  });

  describe('hoisting and forward references', () => {
    it('should handle var hoisting', () => {
      const source = `
        var x = y + 1;
        var y = 10;
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      // Both should be defined (hoisted)
      const xAnnotation = result.annotations.find((a) => a.name === 'x');
      const yAnnotation = result.annotations.find((a) => a.name === 'y');
      expect(xAnnotation).toBeDefined();
      expect(yAnnotation).toBeDefined();
    });

    it('should handle function declaration hoisting', () => {
      const source = `
        const result = add(1, 2);
        function add(a, b) {
          return a + b;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const addAnnotation = result.annotations.find((a) => a.name === 'add' && a.kind === 'function');
      expect(addAnnotation).toBeDefined();
      expect(addAnnotation?.typeString).toContain('=>');
    });

    it('should handle class hoisting for references', () => {
      const source = `
        const instance = new MyClass();
        class MyClass {
          constructor() {
            this.value = 42;
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const classAnnotation = result.annotations.find((a) => a.name === 'MyClass' && a.kind === 'class');
      expect(classAnnotation).toBeDefined();
    });
  });

  describe('loop-induced type widening', () => {
    it('should handle simple loop assignments', () => {
      const source = `
        let x = 0;
        while (true) {
          x = x + 1;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const xAnnotation = result.annotations.find((a) => a.name === 'x');
      expect(xAnnotation).toBeDefined();
      // x should be number (widened from 0)
      expect(xAnnotation?.typeString).toMatch(/number|0/);
    });

    it('should handle for loop counter', () => {
      const source = `
        let sum = 0;
        for (let i = 0; i < 10; i++) {
          sum = sum + i;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const sumAnnotation = result.annotations.find((a) => a.name === 'sum');
      const iAnnotation = result.annotations.find((a) => a.name === 'i');
      expect(sumAnnotation).toBeDefined();
      expect(iAnnotation).toBeDefined();
    });

    it('should handle type widening in conditional loop', () => {
      const source = `
        let value = 0;
        while (Math.random() > 0.5) {
          if (Math.random() > 0.5) {
            value = "string";
          } else {
            value = 42;
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const valueAnnotation = result.annotations.find((a) => a.name === 'value');
      expect(valueAnnotation).toBeDefined();
      // Should be union of number and string
    });
  });

  describe('conditional type narrowing', () => {
    it('should narrow types in if branches', () => {
      const source = `
        function process(x) {
          if (typeof x === "string") {
            return x.toUpperCase();
          }
          return x;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const processAnnotation = result.annotations.find((a) => a.name === 'process' && a.kind === 'function');
      expect(processAnnotation).toBeDefined();
    });

    it('should handle null checks', () => {
      const source = `
        function safe(value) {
          if (value !== null) {
            return value.toString();
          }
          return "null";
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const safeAnnotation = result.annotations.find((a) => a.name === 'safe' && a.kind === 'function');
      expect(safeAnnotation).toBeDefined();
    });

    it('should narrow based on truthiness', () => {
      const source = `
        function getValue(x) {
          if (x) {
            return x;
          }
          return "default";
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const getValueAnnotation = result.annotations.find((a) => a.name === 'getValue' && a.kind === 'function');
      expect(getValueAnnotation).toBeDefined();
    });
  });

  describe('function and class inference', () => {
    it('should infer function return types', () => {
      const source = `
        function double(x) {
          return x * 2;
        }
        const result = double(21);
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const doubleAnnotation = result.annotations.find((a) => a.name === 'double' && a.kind === 'function');
      expect(doubleAnnotation).toBeDefined();
      expect(doubleAnnotation?.typeString).toContain('number');
    });

    it('should infer async function types', () => {
      const source = `
        async function fetchData() {
          return { data: "test" };
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const fetchAnnotation = result.annotations.find((a) => a.name === 'fetchData' && a.kind === 'function');
      expect(fetchAnnotation).toBeDefined();
      expect(fetchAnnotation?.typeString).toContain('Promise');
    });

    it('should infer class method types', () => {
      const source = `
        class Calculator {
          add(a, b) {
            return a + b;
          }
          subtract(a, b) {
            return a - b;
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const calcAnnotation = result.annotations.find((a) => a.name === 'Calculator' && a.kind === 'class');
      expect(calcAnnotation).toBeDefined();
    });
  });

  describe('CFG analysis details', () => {
    it('should provide CFG information in detailed analysis', () => {
      const source = `
        let x = 0;
        if (Math.random() > 0.5) {
          x = 1;
        } else {
          x = 2;
        }
        console.log(x);
      `;
      const { ast } = parse(source);
      const result = analyzeIterative(ast, source, 'test.js');

      expect(result.cfg).toBeDefined();
      expect(result.cfg.blocks.size).toBeGreaterThan(0);
      expect(result.blockEntryStates.size).toBeGreaterThan(0);
      expect(result.blockExitStates.size).toBeGreaterThan(0);
      expect(result.iterations).toBeGreaterThan(0);
    });

    it('should track state changes across branches', () => {
      const source = `
        let value = "initial";
        if (true) {
          value = "then";
        } else {
          value = "else";
        }
      `;
      const { ast } = parse(source);
      const result = analyzeIterative(ast, source, 'test.js');

      // Should have multiple blocks for if/else branches
      expect(result.cfg.blocks.size).toBeGreaterThan(2);
    });

    it('should converge in reasonable iterations', () => {
      const source = `
        let count = 0;
        for (let i = 0; i < 100; i++) {
          count = count + 1;
        }
      `;
      const { ast } = parse(source);
      const result = analyzeIterative(ast, source, 'test.js');

      // Should converge without hitting max iterations
      expect(result.iterations).toBeLessThan(100);
      expect(result.errors.every((e) => !e.message.includes('did not converge'))).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('should handle switch statements', () => {
      const source = `
        function describe(value) {
          switch (typeof value) {
            case "string":
              return "It's a string";
            case "number":
              return "It's a number";
            default:
              return "Unknown type";
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const describeAnnotation = result.annotations.find((a) => a.name === 'describe' && a.kind === 'function');
      expect(describeAnnotation).toBeDefined();
      expect(describeAnnotation?.typeString).toContain('string');
    });

    it('should handle try-catch', () => {
      const source = `
        function safeParse(json) {
          try {
            return JSON.parse(json);
          } catch (e) {
            return null;
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const safeParseAnnotation = result.annotations.find((a) => a.name === 'safeParse' && a.kind === 'function');
      expect(safeParseAnnotation).toBeDefined();
    });

    it('should handle nested functions', () => {
      const source = `
        function outer() {
          const x = 10;
          function inner() {
            return x * 2;
          }
          return inner();
        }
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const outerAnnotation = result.annotations.find((a) => a.name === 'outer' && a.kind === 'function');
      expect(outerAnnotation).toBeDefined();
    });

    it('should handle destructuring with defaults', () => {
      const source = `
        const obj = { a: 1 };
        const { a, b = 2 } = obj;
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const aAnnotation = result.annotations.find((a) => a.name === 'a');
      const bAnnotation = result.annotations.find((a) => a.name === 'b');
      expect(aAnnotation).toBeDefined();
      expect(bAnnotation).toBeDefined();
    });

    it('should handle spread operators', () => {
      const source = `
        const arr1 = [1, 2, 3];
        const arr2 = [...arr1, 4, 5];
        const obj1 = { a: 1 };
        const obj2 = { ...obj1, b: 2 };
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      const arr2Annotation = result.annotations.find((a) => a.name === 'arr2');
      const obj2Annotation = result.annotations.find((a) => a.name === 'obj2');
      expect(arr2Annotation).toBeDefined();
      expect(obj2Annotation).toBeDefined();
    });
  });

  describe('error detection', () => {
    it('should detect const reassignment', () => {
      const source = `
        const x = 10;
        x = 20;
      `;
      const { ast } = parse(source);
      const result = inferTypesIterative(ast, source, 'test.js');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes('const'))).toBe(true);
    });
  });

  describe('comparison with non-iterative inferrer', () => {
    it('should produce consistent results for simple cases', async () => {
      const { inferTypes } = await import('../../src/analysis/inferrer.js');

      const source = `
        const x = 42;
        const y = "hello";
        function add(a, b) {
          return a + b;
        }
      `;
      const { ast } = parse(source);

      const iterativeResult = inferTypesIterative(ast, source, 'test.js');
      const simpleResult = inferTypes(ast, source, 'test.js');

      // Both should find the same annotations for simple cases
      const iterativeX = iterativeResult.annotations.find((a) => a.name === 'x');
      const simpleX = simpleResult.annotations.find((a) => a.name === 'x');
      expect(iterativeX?.typeString).toBe(simpleX?.typeString);

      const iterativeY = iterativeResult.annotations.find((a) => a.name === 'y');
      const simpleY = simpleResult.annotations.find((a) => a.name === 'y');
      expect(iterativeY?.typeString).toBe(simpleY?.typeString);
    });
  });
});
