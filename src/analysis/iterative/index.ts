/**
 * Main Iterative Type Analyzer
 * Orchestrates flow-sensitive type inference using fixed-point iteration
 */

import * as t from '@babel/types';
import type { Type } from '../../types/types.js';
import type { TypeAnnotationResult } from '../../types/types.js';
import type {
  TypeState,
  TypeEnvironment,
  Binding,
} from '../../types/analysis.js';
import type {
  CFG,
  NodeId,
} from '../../types/cfg.js';
import { generateTypeId } from '../../types/types.js';
import {
  createEnvironment,
  createBinding,
} from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { buildCFG } from '../../cfg/builder/statements.js';
import { computeLoops, computeDominators } from '../../cfg/builder/analysis.js';
import { transferStatement } from './transfer.js';
import {
  createIterationContext,
  createEntryState,
  resetIterationCount,
  incrementIteration,
  shouldContinue,
  type IterationContext,
  type TypeAnnotation
} from './context.js';
import { joinStates, statesEqual, widenLoopState } from './state.js';

// ============================================================================
// Main Type Inference Functions
// ============================================================================

/**
 * Infer types for JavaScript source code
 * Full flow-sensitive analysis with CFG
 */
export async function inferTypes(
  source: string,
  filename: string = '<unknown>'
): Promise<TypeAnnotationResult> {
  // Import parser dynamically to avoid circular dependencies
  const { parse } = await import('../../parser/parser.js');

  // Parse source to AST
  const parseResult = parse(source, filename);
  const ast = parseResult.ast;

  // Build CFG
  const cfgResult = buildCFG(ast.program.body);
  const cfg = buildCompleteCFG(cfgResult, ast);

  // Create analysis context
  const context = createIterationContext(cfg, source, filename);

  // Run fixed-point iteration
  analyzeFixedPoint(context);

  // Convert annotations to result format
  return {
    annotations: context.annotations.map(a => ({
      node: a.node,
      name: a.name,
      type: a.type,
      kind: a.kind as any,
    })),
    source,
    filename,
  };
}

/**
 * Simple type inference - no CFG, just one-pass analysis
 * Useful for quick type checks
 */
export async function inferTypesSimple(
  source: string,
  filename: string = '<unknown>'
): Promise<TypeAnnotationResult> {
  // Import parser dynamically
  const { parse } = await import('../../parser/parser.js');

  // Parse source to AST
  const parseResult = parse(source, filename);
  const ast = parseResult.ast;

  // Create simple context
  const cfg: CFG = {
    blocks: new Map(),
    edges: new Map(),
    entry: 'entry',
    exits: ['exit'],
    loops: new Map(),
    dominators: new Map(),
    postDominators: new Map(),
    predecessors: new Map(),
    successors: new Map(),
    backEdges: new Set(),
    immediateDominator: new Map(),
    dominanceFrontier: new Map(),
  } as CFG;

  const context = createIterationContext(cfg, source, filename);

  // One-pass analysis
  const globalEnv = context.globalEnv;
  const state: TypeState = {
    env: globalEnv,
    reachable: true,
    loopDepth: 0,
    inTryBlock: false,
    modifiedVars: new Set(),
  };

  // Process each statement
  for (const stmt of ast.program.body) {
    processStatementSimple(stmt, state, context);
  }

  return {
    annotations: context.annotations.map(a => ({
      node: a.node,
      name: a.name,
      type: a.type,
      kind: a.kind as any,
    })),
    source,
    filename,
  };
}

// ============================================================================
// Fixed-Point Iteration
// ============================================================================

/**
 * Main fixed-point iteration algorithm
 * Iterates until types stabilize or max iterations reached
 */
function analyzeFixedPoint(context: IterationContext): void {
  const { cfg } = context;

  // Initialize block states
  const blockStates = new Map<NodeId, TypeState>();
  const entryState = createEntryState(context);
  blockStates.set(cfg.entry, entryState);

  resetIterationCount(context);

  let changed = true;
  let iterations = 0;

  while (changed && shouldContinue(context)) {
    changed = false;
    iterations++;

    // Process blocks in order (forward analysis)
    const blockIds = Array.from(cfg.blocks.keys());
    for (const blockId of blockIds) {
      const block = cfg.blocks.get(blockId);
      if (!block) continue;

      // Compute input state by joining predecessors
      const inputState = computeInputState(blockId, cfg, blockStates);
      if (!inputState) continue; // Unreachable

      // Check if input state changed
      const oldInputState = blockStates.get(blockId);
      if (oldInputState && statesEqual(oldInputState, inputState)) {
        continue; // No change
      }

      blockStates.set(blockId, inputState);

      // Apply transfer functions to statements
      let outputState = inputState;

      // Widen if this is a loop header
      if (cfg.loops.has(blockId) && iterations > 1) {
        const loopInfo = cfg.loops.get(blockId)!;
        const modifiedVars = new Set<string>();
        for (const nodeId of loopInfo.body) {
          const b = cfg.blocks.get(nodeId);
          if (b?.scope) {
            for (const ref of b.scope.references) {
              if (b.scope.declarations.has(ref)) {
                modifiedVars.add(ref);
              }
            }
          }
        }
        outputState = widenLoopState(outputState, modifiedVars, context.widenThreshold);
      }

      // Process each statement in the block
      for (const stmt of block.statements) {
        outputState = transferStatement(stmt, outputState, context);
      }

      // Store output state for successors to use
      blockStates.set(blockId, outputState);
    }

    incrementIteration(context);
  }
}

/**
 * Compute input state for a block by joining all predecessors
 */
function computeInputState(
  blockId: NodeId,
  cfg: CFG,
  blockStates: Map<NodeId, TypeState>
): TypeState | null {
  const predecessors = cfg.predecessors.get(blockId) ?? [];

  if (predecessors.length === 0) {
    // Entry block - use initial state
    return null;
  }

  if (predecessors.length === 1) {
    const predState = blockStates.get(predecessors[0]!);
    return predState ?? null;
  }

  // Join all predecessor states
  const predStates: TypeState[] = [];
  for (const predId of predecessors) {
    const state = blockStates.get(predId);
    if (state && state.reachable) {
      predStates.push(state);
    }
  }

  if (predStates.length === 0) {
    return null; // Unreachable
  }

  return joinStates(predStates);
}

// ============================================================================
// CFG Construction
// ============================================================================

/**
 * Build complete CFG with analysis info
 */
function buildCompleteCFG(
  buildResult: { entry: string; exits: string[] },
  ast: t.File
): CFG {
  const blocks = new Map(); // Would be populated by buildCFG
  const edges = new Map();

  // Build predecessor map
  const predecessors = new Map<NodeId, NodeId[]>();
  const successors = new Map<NodeId, NodeId[]>();
  const backEdges = new Set<string>();

  // Compute loop info
  const loops = computeLoops({ blocks, edges, entry: buildResult.entry });

  // Compute dominators
  const dominators = computeDominators({ blocks, edges, entry: buildResult.entry as NodeId });

  // Compute post-dominators (simplified)
  const postDominators = new Map<NodeId, Set<NodeId>>();

  // Compute immediate dominator (simplified)
  const immediateDominator = new Map<NodeId, NodeId>();

  // Compute dominance frontier (simplified)
  const dominanceFrontier = new Map<NodeId, NodeId[]>();

  // Compute post-order and reverse post-order
  const postOrder: NodeId[] = [];
  const reversePostOrder: NodeId[] = [];

  return {
    blocks,
    edges,
    entry: buildResult.entry as NodeId,
    exits: Array.from(new Set(buildResult.exits as NodeId[])),
    loops,
    dominators,
    postDominators,
    predecessors,
    successors,
    backEdges,
    immediateDominator,
    dominanceFrontier,
  } as CFG;
}

// ============================================================================
// Simple Statement Processing
// ============================================================================

/**
 * Process a statement without CFG (simple mode)
 */
function processStatementSimple(
  stmt: t.Statement,
  state: TypeState,
  context: IterationContext
): void {
  switch (stmt.type) {
    case 'VariableDeclaration':
      processVariableDeclarationSimple(stmt, state, context);
      break;
    case 'FunctionDeclaration':
      processFunctionDeclarationSimple(stmt, state, context);
      break;
    case 'ClassDeclaration':
      processClassDeclarationSimple(stmt, state, context);
      break;
    case 'ExpressionStatement':
      processExpressionStatementSimple(stmt, state, context);
      break;
    case 'BlockStatement':
      for (const innerStmt of stmt.body) {
        processStatementSimple(innerStmt, state, context);
      }
      break;
    case 'IfStatement':
      processStatementSimple(stmt.consequent, state, context);
      if (stmt.alternate) {
        processStatementSimple(stmt.alternate, state, context);
      }
      break;
    case 'ForStatement':
      if (stmt.init) {
        processStatementSimple(stmt.init, state, context);
      }
      if (stmt.body) {
        processStatementSimple(stmt.body, state, context);
      }
      break;
    case 'WhileStatement':
      if (stmt.body) {
        processStatementSimple(stmt.body, state, context);
      }
      break;
    case 'ForOfStatement':
      if (stmt.body) {
        processStatementSimple(stmt.body, state, context);
      }
      break;
    case 'ForInStatement':
      if (stmt.body) {
        processStatementSimple(stmt.body, state, context);
      }
      break;
    case 'ReturnStatement':
      // Skip - return type is already handled
      break;
    case 'TryStatement':
      for (const innerStmt of stmt.block.body) {
        processStatementSimple(innerStmt, state, context);
      }
      if (stmt.handler) {
        for (const innerStmt of stmt.handler.body.body) {
          processStatementSimple(innerStmt, state, context);
        }
      }
      if (stmt.finalizer) {
        for (const innerStmt of stmt.finalizer.body) {
          processStatementSimple(innerStmt, state, context);
        }
      }
      break;
    default:
      // Other statement types not handled in simple mode
      break;
  }
}

function processExpressionStatementSimple(
  stmt: t.ExpressionStatement,
  state: TypeState,
  context: IterationContext
): void {
  // Check for IIFE: (function() {...})() or (() => {...})()
  if (t.isCallExpression(stmt.expression)) {
    const callee = stmt.expression.callee;

    // Handle IIFE with function expression
    if (t.isFunctionExpression(callee) || t.isArrowFunctionExpression(callee)) {
      // Process the function body
      if (callee.body) {
        if (t.isBlockStatement(callee.body)) {
          for (const innerStmt of callee.body.body) {
            processStatementSimple(innerStmt, state, context);
          }
        } else if (t.isExpression(callee.body)) {
          // Arrow function with expression body
          inferExpressionSimple(callee.body, state);
        }
      }
    }
  }

  // Still evaluate the expression for side effects
  inferExpressionSimple(stmt.expression, state);
}

function processVariableDeclarationSimple(
  stmt: t.VariableDeclaration,
  state: TypeState,
  context: IterationContext
): void {
  for (const decl of stmt.declarations) {
    if (t.isIdentifier(decl.id)) {
      let type: Type = Types.undefined();
      if (decl.init) {
        type = inferExpressionSimple(decl.init, state);
      }

      const binding = createBinding(
        decl.id,
        type,
        stmt.kind as 'var' | 'let' | 'const',
        stmt.kind !== 'const',
        state.env.scope,
        decl.init !== undefined
      );

      (state.env.bindings as Map<string, Binding>).set(decl.id.name, binding);

      context.annotations.push({
        node: decl.id,
        name: decl.id.name,
        type,
        kind: 'variable',
        scope: state.env,
      });
    }
  }
}

function processFunctionDeclarationSimple(
  stmt: t.FunctionDeclaration,
  state: TypeState,
  context: IterationContext
): void {
  if (!stmt.id) return;

  const type = Types.function({
    params: stmt.params.map((p, i) => ({
      name: t.isIdentifier(p) ? p.name : `param_${i}`,
      type: Types.unknown(),
      optional: false,
      rest: false,
    })),
    returnType: Types.unknown(),
    isAsync: stmt.async,
    isGenerator: stmt.generator,
    captures: new Map(),
  });

  const binding = createBinding(
    stmt.id,
    type,
    'function',
    false,
    state.env.scope,
    true
  );

  (state.env.bindings as Map<string, Binding>).set(stmt.id.name, binding);

  context.annotations.push({
    node: stmt.id,
    name: stmt.id.name,
    type,
    kind: 'function',
    scope: state.env,
  });
}

function processClassDeclarationSimple(
  stmt: t.ClassDeclaration,
  state: TypeState,
  context: IterationContext
): void {
  if (!stmt.id) return;

  const type = Types.class({
    name: stmt.id.name,
    constructor: Types.function({ params: [], returnType: Types.object({}) }),
    instanceType: Types.object({}),
    staticProperties: {},
  });

  const binding = createBinding(
    stmt.id,
    type,
    'class',
    false,
    state.env.scope,
    true
  );

  (state.env.bindings as Map<string, Binding>).set(stmt.id.name, binding);

  context.annotations.push({
    node: stmt.id,
    name: stmt.id.name,
    type,
    kind: 'class',
    scope: state.env,
  });
}

/**
 * Simple expression type inference (without full context)
 */
function inferExpressionSimple(expr: t.Expression, state: TypeState): Type {
  switch (expr.type) {
    case 'NumericLiteral':
      return Types.number(expr.value);
    case 'StringLiteral':
      return Types.string(expr.value);
    case 'BooleanLiteral':
      return Types.boolean(expr.value);
    case 'NullLiteral':
      return Types.null();
    case 'Identifier':
      const binding = state.env.bindings.get(expr.name);
      return binding?.type ?? Types.unknown();
    case 'ArrayExpression':
      return Types.array(Types.unknown());
    case 'ObjectExpression':
      return Types.object({});
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return Types.function({
        params: [],
        returnType: Types.unknown(),
        isAsync: expr.async,
        isGenerator: expr.generator,
        captures: new Map(),
      });
    case 'UnaryExpression':
      if (expr.operator === 'typeof') {
        return Types.string();
      }
      return inferExpressionSimple(expr.argument, state);
    case 'BinaryExpression':
      // Simple inference for some operators
      if (expr.operator === '===') return Types.boolean();
      if (expr.operator === '+') return Types.union(Types.number(), Types.string());
      if (['-', '*', '/', '%', '**'].includes(expr.operator)) return Types.number();
      if (['<', '>', '<=', '>=', '!==', '==', '!='].includes(expr.operator)) {
        return Types.boolean();
      }
      return Types.unknown();
    case 'LogicalExpression':
      return Types.union(Types.boolean(), inferExpressionSimple(expr.left, state));
    case 'ConditionalExpression':
      return Types.union(
        inferExpressionSimple(expr.consequent, state),
        inferExpressionSimple(expr.alternate, state)
      );
    case 'CallExpression': {
      const calleeType = inferExpressionSimple(expr.callee, state);
      // Try to get return type from function type
      if (calleeType.kind === 'function') {
        return calleeType.returnType;
      }
      return Types.unknown();
    }
    case 'MemberExpression': {
      const objectType = inferExpressionSimple(expr.object, state);
      let propertyName: string | null = null;

      if (expr.computed) {
        if (t.isStringLiteral(expr.property)) {
          propertyName = expr.property.value;
        }
      } else if (t.isIdentifier(expr.property)) {
        propertyName = expr.property.name;
      }

      if (!propertyName) {
        return Types.unknown();
      }

      return getPropertyTypeSimple(objectType, propertyName);
    }
    case 'AssignmentExpression':
      return inferExpressionSimple(expr.right, state);
    case 'NewExpression': {
      const calleeType = inferExpressionSimple(expr.callee, state);
      if (calleeType.kind === 'function') {
        return calleeType.returnType;
      }
      return Types.object({});
    }
    default:
      return Types.unknown();
  }
}

/**
 * Get property type from an object type (simple version)
 */
function getPropertyTypeSimple(objectType: import('../../types/types.js').Type, propertyName: string): Type {
  if (objectType.kind === 'object') {
    const prop = objectType.properties.get(propertyName);
    if (prop) {
      return prop.type;
    }
  }

  if (objectType.kind === 'class') {
    const instanceProp = objectType.instanceType.properties.get(propertyName);
    if (instanceProp) {
      return instanceProp.type;
    }
    const staticProp = objectType.staticProperties.get(propertyName);
    if (staticProp) {
      return staticProp.type;
    }
  }

  if (objectType.kind === 'array') {
    if (propertyName === 'length') {
      return Types.number();
    }
  }

  if (objectType.kind === 'function') {
    if (propertyName === 'prototype') {
      return Types.object({});
    }
    if (propertyName === 'length') {
      return Types.number();
    }
    if (propertyName === 'name') {
      return Types.string();
    }
  }

  return Types.unknown();
}

// ============================================================================
// Re-exports
// ============================================================================

export * from './context.js';
export * from './state.js';
export * from './transfer.js';
export * from './expressions.js';
export * from './builtins.js';
