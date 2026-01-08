/**
 * Unit tests for MLsub record lattice operations
 */

import { describe, it, expect } from 'vitest';
import { record, union, intersection, number, string } from '../../src/types/factory.js';
import type { RecordType } from '../../src/types/polar.js';

describe('MLsub Record Lattice Operations', () => {
  describe('Record Join (⊔) - Domain Intersection', () => {
    it('should compute intersection of field domains', () => {
      // {a: number, b: number} ⊔ {a: number, c: number} = {a: number}
      const rec1 = record({ a: number, b: number });
      const rec2 = record({ a: number, c: number });

      const result = union([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(1);
      expect(result.fields.has('a')).toBe(true);
      expect(result.fields.has('b')).toBe(false);
      expect(result.fields.has('c')).toBe(false);
    });

    it('should handle disjoint records (empty join)', () => {
      // {a: number} ⊔ {b: string} = {}
      const rec1 = record({ a: number });
      const rec2 = record({ b: string });

      const result = union([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(0);
    });

    it('should handle identical records', () => {
      // {a: number, b: string} ⊔ {a: number, b: string} = {a: number, b: string}
      const rec1 = record({ a: number, b: string });
      const rec2 = record({ a: number, b: string });

      const result = union([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(2);
      expect(result.fields.has('a')).toBe(true);
      expect(result.fields.has('b')).toBe(true);
    });

    it('should join field types for common fields', () => {
      // {a: number} ⊔ {a: string} = {a: number | string}
      const rec1 = record({ a: number });
      const rec2 = record({ a: string });

      const result = union([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(1);
      const fieldA = result.fields.get('a');
      expect(fieldA?.type.kind).toBe('union');
    });
  });

  describe('Record Meet (⊓) - Domain Union', () => {
    it('should compute union of field domains', () => {
      // {a: number} ⊓ {b: string} = {a: number, b: string}
      const rec1 = record({ a: number });
      const rec2 = record({ b: string });

      const result = intersection([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(2);
      expect(result.fields.has('a')).toBe(true);
      expect(result.fields.has('b')).toBe(true);
    });

    it('should intersect types for common fields', () => {
      // {a: number, b: number} ⊓ {a: number, c: string} = {a: number, b: number, c: string}
      const rec1 = record({ a: number, b: number });
      const rec2 = record({ a: number, c: string });

      const result = intersection([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(3);
      expect(result.fields.has('a')).toBe(true);
      expect(result.fields.has('b')).toBe(true);
      expect(result.fields.has('c')).toBe(true);
    });

    it('should handle empty records', () => {
      // {} ⊓ {a: number} = {a: number}
      const rec1 = record({});
      const rec2 = record({ a: number });

      const result = intersection([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(1);
      expect(result.fields.has('a')).toBe(true);
    });

    it('should preserve field from only one record', () => {
      // {a: number, b: string} ⊓ {c: number} = {a: number, b: string, c: number}
      const rec1 = record({ a: number, b: string });
      const rec2 = record({ c: number });

      const result = intersection([rec1, rec2]) as RecordType;

      expect(result.kind).toBe('record');
      expect(result.fields.size).toBe(3);
      // Field 'a' and 'b' from rec1 should be preserved
      const fieldA = result.fields.get('a');
      expect(fieldA?.type.kind).toBe('primitive');
      const fieldC = result.fields.get('c');
      expect(fieldC?.type.kind).toBe('primitive');
    });
  });

  describe('Width Subtyping via Lattice', () => {
    it('demonstrates width subtyping through join', () => {
      // This test demonstrates that {a, b} ≤ {a} because {a, b} ⊔ {a} = {a}
      const wide = record({ a: number, b: string });
      const narrow = record({ a: number });

      const result = union([wide, narrow]) as RecordType;

      // Result should be narrow (only common field 'a')
      expect(result.fields.size).toBe(1);
      expect(result.fields.has('a')).toBe(true);
      expect(result.fields.has('b')).toBe(false);
    });
  });
});
