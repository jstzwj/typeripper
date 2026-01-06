/**
 * Tests for the type inferrer
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/parser/index.js';
import { inferTypes } from '../../src/analysis/index.js';
import { formatAsReport, formatAsInlineComments, formatAsDTS, formatAsJSON } from '../../src/output/index.js';

describe('Type Inferrer', () => {
  describe('primitive types', () => {
    it('should infer number literal type', () => {
      const source = 'const x = 42;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      expect(result.annotations.length).toBeGreaterThan(0);
      const xAnnotation = result.annotations.find(a => a.name === 'x');
      expect(xAnnotation).toBeDefined();
      expect(xAnnotation?.typeString).toBe('42');
    });

    it('should infer string literal type', () => {
      const source = 'const s = "hello";';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const sAnnotation = result.annotations.find(a => a.name === 's');
      expect(sAnnotation?.typeString).toBe('"hello"');
    });

    it('should infer boolean literal type', () => {
      const source = 'const b = true;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const bAnnotation = result.annotations.find(a => a.name === 'b');
      expect(bAnnotation?.typeString).toBe('true');
    });

    it('should infer null type', () => {
      const source = 'const n = null;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const nAnnotation = result.annotations.find(a => a.name === 'n');
      expect(nAnnotation?.typeString).toBe('null');
    });

    it('should infer undefined type', () => {
      const source = 'let u;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const uAnnotation = result.annotations.find(a => a.name === 'u');
      expect(uAnnotation?.typeString).toBe('undefined');
    });
  });

  describe('object types', () => {
    it('should infer object shape', () => {
      const source = `
        const obj = {
          name: "Alice",
          age: 30,
          active: true
        };
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const objAnnotation = result.annotations.find(a => a.name === 'obj');
      expect(objAnnotation).toBeDefined();
      // Object type should contain all properties
      expect(objAnnotation?.typeString).toContain('name');
      expect(objAnnotation?.typeString).toContain('age');
      expect(objAnnotation?.typeString).toContain('active');
    });

    it('should infer nested object shape', () => {
      const source = `
        const person = {
          name: "Bob",
          address: {
            city: "NYC",
            zip: 10001
          }
        };
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const personAnnotation = result.annotations.find(a => a.name === 'person');
      expect(personAnnotation).toBeDefined();
      expect(personAnnotation?.typeString).toContain('address');
    });
  });

  describe('array types', () => {
    it('should infer array element types', () => {
      const source = 'const arr = [1, 2, 3];';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const arrAnnotation = result.annotations.find(a => a.name === 'arr');
      expect(arrAnnotation).toBeDefined();
      // Should be tuple type [1, 2, 3]
      expect(arrAnnotation?.typeString).toContain('1');
      expect(arrAnnotation?.typeString).toContain('2');
      expect(arrAnnotation?.typeString).toContain('3');
    });

    it('should infer mixed array as tuple', () => {
      const source = 'const mixed = [1, "two", true];';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const mixedAnnotation = result.annotations.find(a => a.name === 'mixed');
      expect(mixedAnnotation).toBeDefined();
    });

    it('should infer empty array', () => {
      const source = 'const empty = [];';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const emptyAnnotation = result.annotations.find(a => a.name === 'empty');
      expect(emptyAnnotation).toBeDefined();
    });
  });

  describe('function types', () => {
    it('should infer function declaration type', () => {
      const source = `
        function add(a, b) {
          return a + b;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const addAnnotation = result.annotations.find(a => a.name === 'add' && a.kind === 'function');
      expect(addAnnotation).toBeDefined();
      expect(addAnnotation?.typeString).toContain('=>');
    });

    it('should infer arrow function type', () => {
      const source = 'const multiply = (x, y) => x * y;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const multiplyAnnotation = result.annotations.find(a => a.name === 'multiply');
      expect(multiplyAnnotation).toBeDefined();
    });

    it('should infer function with return type', () => {
      const source = `
        function greet(name) {
          return "Hello, " + name;
        }
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const greetAnnotation = result.annotations.find(a => a.name === 'greet');
      expect(greetAnnotation).toBeDefined();
      expect(greetAnnotation?.typeString).toContain('string');
    });

    it('should infer async function type', () => {
      const source = `
        async function fetchData() {
          return { data: "test" };
        }
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const fetchAnnotation = result.annotations.find(a => a.name === 'fetchData');
      expect(fetchAnnotation).toBeDefined();
      expect(fetchAnnotation?.typeString).toContain('Promise');
    });
  });

  describe('binary expressions', () => {
    it('should infer arithmetic expression type', () => {
      const source = 'const sum = 1 + 2;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const sumAnnotation = result.annotations.find(a => a.name === 'sum');
      expect(sumAnnotation?.typeString).toBe('3');
    });

    it('should infer string concatenation type', () => {
      const source = 'const greeting = "Hello, " + "World";';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const greetingAnnotation = result.annotations.find(a => a.name === 'greeting');
      expect(greetingAnnotation?.typeString).toBe('string');
    });

    it('should infer comparison expression type', () => {
      const source = 'const isGreater = 5 > 3;';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const isGreaterAnnotation = result.annotations.find(a => a.name === 'isGreater');
      expect(isGreaterAnnotation?.typeString).toBe('boolean');
    });
  });

  describe('conditional expressions', () => {
    it('should infer conditional as union', () => {
      const source = 'const result = true ? 1 : "one";';
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const resultAnnotation = result.annotations.find(a => a.name === 'result');
      expect(resultAnnotation).toBeDefined();
      // Should be union of 1 and "one"
      expect(resultAnnotation?.typeString).toContain('|');
    });
  });

  describe('class types', () => {
    it('should infer class declaration type', () => {
      const source = `
        class Person {
          constructor(name, age) {
            this.name = name;
            this.age = age;
          }

          greet() {
            return "Hello, " + this.name;
          }
        }
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const personAnnotation = result.annotations.find(a => a.name === 'Person' && a.kind === 'class');
      expect(personAnnotation).toBeDefined();
      expect(personAnnotation?.typeString).toContain('class Person');
    });
  });

  describe('destructuring', () => {
    it('should infer destructured variable types', () => {
      const source = `
        const obj = { a: 1, b: "two" };
        const { a, b } = obj;
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const aAnnotation = result.annotations.find(a => a.name === 'a');
      const bAnnotation = result.annotations.find(a => a.name === 'b');
      expect(aAnnotation).toBeDefined();
      expect(bAnnotation).toBeDefined();
    });

    it('should infer array destructured types', () => {
      const source = `
        const arr = [1, "two", true];
        const [first, second, third] = arr;
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      const firstAnnotation = result.annotations.find(a => a.name === 'first');
      expect(firstAnnotation).toBeDefined();
    });
  });

  describe('error detection', () => {
    it('should detect assignment to const', () => {
      const source = `
        const x = 10;
        x = 20;
      `;
      const { ast } = parse(source);
      const result = inferTypes(ast, source, 'test.js');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toContain('const');
    });
  });
});

describe('Output Formatters', () => {
  const sampleSource = `
const name = "Alice";
const age = 30;

function greet(person) {
  return "Hello, " + person;
}

const numbers = [1, 2, 3];
  `.trim();

  it('should format as inline comments', () => {
    const { ast } = parse(sampleSource);
    const result = inferTypes(ast, sampleSource, 'test.js');
    const output = formatAsInlineComments(result);

    expect(output).toContain('const name');
    // Should have type comments
    expect(output.length).toBeGreaterThan(sampleSource.length);
  });

  it('should format as JSON', () => {
    const { ast } = parse(sampleSource);
    const result = inferTypes(ast, sampleSource, 'test.js');
    const output = formatAsJSON(result);

    const parsed = JSON.parse(output);
    expect(parsed.filename).toBe('test.js');
    expect(parsed.annotations).toBeDefined();
    expect(Array.isArray(parsed.annotations)).toBe(true);
  });

  it('should format as DTS', () => {
    const { ast } = parse(sampleSource);
    const result = inferTypes(ast, sampleSource, 'test.js');
    const output = formatAsDTS(result);

    expect(output).toContain('declare');
    expect(output).toContain('const name');
    expect(output).toContain('function greet');
  });

  it('should format as report', () => {
    const { ast } = parse(sampleSource);
    const result = inferTypes(ast, sampleSource, 'test.js');
    const output = formatAsReport(result);

    expect(output).toContain('Type Inference Report');
    expect(output).toContain('Summary');
    expect(output).toContain('Variables');
    expect(output).toContain('Functions');
  });
});
