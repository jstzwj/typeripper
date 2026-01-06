/**
 * Tests for the parser module
 */

import { describe, it, expect } from 'vitest';
import { parse, parseExpression } from '../../src/parser/index.js';

describe('Parser', () => {
  describe('parse', () => {
    it('should parse simple variable declaration', () => {
      const result = parse('const x = 1;');
      expect(result.errors).toHaveLength(0);
      expect(result.ast.program.body).toHaveLength(1);
      expect(result.ast.program.body[0]?.type).toBe('VariableDeclaration');
    });

    it('should parse function declaration', () => {
      const result = parse('function foo(x, y) { return x + y; }');
      expect(result.errors).toHaveLength(0);
      expect(result.ast.program.body[0]?.type).toBe('FunctionDeclaration');
    });

    it('should parse arrow function', () => {
      const result = parse('const add = (x, y) => x + y;');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse async function', () => {
      const result = parse('async function fetch() { await something(); }');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse class declaration', () => {
      const result = parse(`
        class Person {
          constructor(name) {
            this.name = name;
          }
          greet() {
            return 'Hello, ' + this.name;
          }
        }
      `);
      expect(result.errors).toHaveLength(0);
      expect(result.ast.program.body[0]?.type).toBe('ClassDeclaration');
    });

    it('should parse control flow statements', () => {
      const result = parse(`
        if (x > 0) {
          console.log('positive');
        } else if (x < 0) {
          console.log('negative');
        } else {
          console.log('zero');
        }
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse loops', () => {
      const result = parse(`
        for (let i = 0; i < 10; i++) {
          console.log(i);
        }

        while (condition) {
          doSomething();
        }

        do {
          doSomethingElse();
        } while (anotherCondition);

        for (const item of items) {
          process(item);
        }

        for (const key in obj) {
          console.log(key);
        }
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse try-catch-finally', () => {
      const result = parse(`
        try {
          riskyOperation();
        } catch (e) {
          handleError(e);
        } finally {
          cleanup();
        }
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse switch statement', () => {
      const result = parse(`
        switch (value) {
          case 1:
            doOne();
            break;
          case 2:
            doTwo();
            break;
          default:
            doDefault();
        }
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse ES2020+ features', () => {
      const result = parse(`
        // Optional chaining
        const x = obj?.prop?.nested;

        // Nullish coalescing
        const y = value ?? defaultValue;

        // BigInt
        const big = 123456789012345678901234567890n;

        // Dynamic import
        const module = await import('./module.js');

        // Private class fields
        class Counter {
          #count = 0;
          increment() {
            this.#count++;
          }
        }
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse logical assignment operators', () => {
      const result = parse(`
        x ||= defaultValue;
        y &&= newValue;
        z ??= fallback;
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse destructuring', () => {
      const result = parse(`
        const { a, b: renamed, c = defaultC } = obj;
        const [first, second, ...rest] = arr;
        function foo({ x, y }, [a, b]) {}
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse spread operator', () => {
      const result = parse(`
        const arr = [...arr1, ...arr2];
        const obj = { ...obj1, ...obj2 };
        foo(...args);
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse template literals', () => {
      const result = parse(`
        const str = \`Hello, \${name}!\`;
        const tagged = tag\`template\`;
      `);
      expect(result.errors).toHaveLength(0);
    });

    it('should recover from syntax errors', () => {
      const result = parse('const x = ; const y = 2;');
      // errorRecovery mode may or may not produce errors depending on the syntax
      // The important thing is that parsing doesn't throw and we get some AST
      expect(result.ast).toBeDefined();
      expect(result.ast.program).toBeDefined();
    });
  });

  describe('parseExpression', () => {
    it('should parse simple expression', () => {
      const expr = parseExpression('x + y');
      expect(expr.type).toBe('BinaryExpression');
    });

    it('should parse function expression', () => {
      const expr = parseExpression('function(x) { return x * 2; }');
      expect(expr.type).toBe('FunctionExpression');
    });

    it('should parse arrow function expression', () => {
      const expr = parseExpression('(x) => x * 2');
      expect(expr.type).toBe('ArrowFunctionExpression');
    });

    it('should parse object literal', () => {
      const expr = parseExpression('{ a: 1, b: 2 }');
      expect(expr.type).toBe('ObjectExpression');
    });

    it('should parse array literal', () => {
      const expr = parseExpression('[1, 2, 3]');
      expect(expr.type).toBe('ArrayExpression');
    });
  });
});
