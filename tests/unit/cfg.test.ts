/**
 * Tests for CFG builder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../src/parser/index.js';
import { buildCFG, resetCFGIds } from '../../src/cfg/index.js';

describe('CFG Builder', () => {
  beforeEach(() => {
    resetCFGIds();
  });

  describe('basic blocks', () => {
    it('should create entry and exit blocks for empty program', () => {
      const result = parse('');
      const cfg = buildCFG(result.ast.program.body);

      expect(cfg.blocks.size).toBeGreaterThanOrEqual(2);
      expect(cfg.entry).toBeDefined();
      expect(cfg.exits.length).toBeGreaterThan(0);
    });

    it('should create basic block for sequential statements', () => {
      const result = parse(`
        const x = 1;
        const y = 2;
        const z = x + y;
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Entry block should contain all three statements
      const entryBlock = cfg.blocks.get(cfg.entry);
      expect(entryBlock).toBeDefined();
      expect(entryBlock?.statements.length).toBe(3);
    });
  });

  describe('if statements', () => {
    it('should create branches for if statement', () => {
      const result = parse(`
        if (x > 0) {
          console.log('positive');
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Should have: entry, consequent, merge, exit
      expect(cfg.blocks.size).toBeGreaterThanOrEqual(3);

      // Find branch terminator
      let hasBranch = false;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'branch') {
          hasBranch = true;
          break;
        }
      }
      expect(hasBranch).toBe(true);
    });

    it('should create branches for if-else statement', () => {
      const result = parse(`
        if (x > 0) {
          console.log('positive');
        } else {
          console.log('non-positive');
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Find branch and check it has both consequent and alternate
      let branchTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'branch') {
          branchTerminator = block.terminator;
          break;
        }
      }
      expect(branchTerminator).not.toBeNull();
      expect(branchTerminator?.consequent).toBeDefined();
      expect(branchTerminator?.alternate).toBeDefined();
      expect(branchTerminator?.consequent).not.toBe(branchTerminator?.alternate);
    });
  });

  describe('while loops', () => {
    it('should create loop structure for while', () => {
      const result = parse(`
        while (i < 10) {
          i++;
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Should have back edges
      expect(cfg.backEdges.size).toBeGreaterThan(0);
    });
  });

  describe('for loops', () => {
    it('should create loop structure for for', () => {
      const result = parse(`
        for (let i = 0; i < 10; i++) {
          console.log(i);
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Should have back edges
      expect(cfg.backEdges.size).toBeGreaterThan(0);
    });
  });

  describe('do-while loops', () => {
    it('should create loop structure for do-while', () => {
      const result = parse(`
        do {
          i++;
        } while (i < 10);
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Should have back edges
      expect(cfg.backEdges.size).toBeGreaterThan(0);
    });
  });

  describe('switch statements', () => {
    it('should create switch terminator', () => {
      const result = parse(`
        switch (x) {
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
      const cfg = buildCFG(result.ast.program.body);

      // Find switch terminator
      let switchTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'switch') {
          switchTerminator = block.terminator;
          break;
        }
      }
      expect(switchTerminator).not.toBeNull();
      expect(switchTerminator?.cases.length).toBe(2); // case 1 and case 2
      expect(switchTerminator?.defaultCase).toBeDefined();
    });
  });

  describe('try-catch-finally', () => {
    it('should create try terminator', () => {
      const result = parse(`
        try {
          riskyOperation();
        } catch (e) {
          handleError(e);
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Find try terminator
      let tryTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'try') {
          tryTerminator = block.terminator;
          break;
        }
      }
      expect(tryTerminator).not.toBeNull();
      expect(tryTerminator?.catchBlock).toBeDefined();
    });

    it('should handle try-finally', () => {
      const result = parse(`
        try {
          riskyOperation();
        } finally {
          cleanup();
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Find try terminator
      let tryTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'try') {
          tryTerminator = block.terminator;
          break;
        }
      }
      expect(tryTerminator).not.toBeNull();
      expect(tryTerminator?.finallyBlock).toBeDefined();
    });
  });

  describe('return statements', () => {
    it('should create return terminator', () => {
      const result = parse(`
        function foo() {
          return 42;
        }
      `);
      // Get the function body
      const funcDecl = result.ast.program.body[0];
      if (funcDecl?.type === 'FunctionDeclaration' && funcDecl.body) {
        const cfg = buildCFG(funcDecl.body.body);

        let returnTerminator = null;
        for (const [, block] of cfg.blocks) {
          if (block.terminator.kind === 'return') {
            returnTerminator = block.terminator;
            break;
          }
        }
        expect(returnTerminator).not.toBeNull();
      }
    });
  });

  describe('break and continue', () => {
    it('should create break terminator in loop', () => {
      const result = parse(`
        while (true) {
          if (done) break;
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      let breakTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'break') {
          breakTerminator = block.terminator;
          break;
        }
      }
      expect(breakTerminator).not.toBeNull();
    });

    it('should create continue terminator in loop', () => {
      const result = parse(`
        while (true) {
          if (skip) continue;
          process();
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      let continueTerminator = null;
      for (const [, block] of cfg.blocks) {
        if (block.terminator.kind === 'continue') {
          continueTerminator = block.terminator;
          break;
        }
      }
      expect(continueTerminator).not.toBeNull();
    });
  });

  describe('dominators', () => {
    it('should compute dominators', () => {
      const result = parse(`
        if (x) {
          doA();
        } else {
          doB();
        }
        doC();
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Entry should dominate all blocks
      for (const [nodeId, doms] of cfg.dominators) {
        expect(doms.has(cfg.entry)).toBe(true);
      }
    });
  });

  describe('edge conditions', () => {
    it('should attach conditions to branch edges', () => {
      const result = parse(`
        if (x > 0) {
          positive();
        }
      `);
      const cfg = buildCFG(result.ast.program.body);

      // Find edges with conditions
      let trueEdge = null;
      let falseEdge = null;
      for (const [, edge] of cfg.edges) {
        if (edge.kind === 'true-branch' && edge.condition) {
          trueEdge = edge;
        }
        if (edge.kind === 'false-branch' && edge.condition) {
          falseEdge = edge;
        }
      }

      expect(trueEdge).not.toBeNull();
      expect(trueEdge?.condition?.whenTruthy).toBe(true);
      expect(falseEdge).not.toBeNull();
      expect(falseEdge?.condition?.whenTruthy).toBe(false);
    });
  });
});
