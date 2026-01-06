/**
 * CFG Builder - Constructs Control Flow Graphs from JavaScript AST
 *
 * This module transforms a Babel AST into a Control Flow Graph (CFG)
 * suitable for flow-sensitive type analysis.
 */

import * as t from '@babel/types';
import type {
  CFG,
  BasicBlock,
  NodeId,
  EdgeId,
  CFGEdge,
  EdgeKind,
  Terminator,
  EdgeCondition,
} from '../types/index.js';

let nodeIdCounter = 0;
let edgeIdCounter = 0;

function generateNodeId(): NodeId {
  return `block_${++nodeIdCounter}`;
}

function generateEdgeId(): EdgeId {
  return `edge_${++edgeIdCounter}`;
}

/**
 * Reset ID counters (for testing)
 */
export function resetCFGIds(): void {
  nodeIdCounter = 0;
  edgeIdCounter = 0;
}

/**
 * Mutable block during CFG construction
 */
interface MutableBlock {
  id: NodeId;
  statements: t.Statement[];
  isEntry: boolean;
  isExit: boolean;
  terminator: Terminator | null;
}

/**
 * Context for building CFG, tracks labels and loop targets
 */
interface BuildContext {
  /** Current block being built */
  currentBlock: MutableBlock;
  /** All blocks created */
  blocks: Map<NodeId, MutableBlock>;
  /** All edges created */
  edges: Map<EdgeId, CFGEdge>;
  /** Label -> target block for break */
  breakTargets: Map<string | null, NodeId>;
  /** Label -> target block for continue */
  continueTargets: Map<string | null, NodeId>;
  /** Stack of try handlers for exception routing */
  tryHandlers: Array<{ catchBlock: NodeId | null; finallyBlock: NodeId | null }>;
}

/**
 * Build a CFG from a function or program body
 */
export function buildCFG(body: t.Statement[] | t.BlockStatement): CFG {
  resetCFGIds();

  const statements = Array.isArray(body) ? body : body.body;

  // Create entry and exit blocks
  const entryBlock = createBlock(true, false);
  const exitBlock = createBlock(false, true);
  exitBlock.terminator = { kind: 'return', argument: null };

  const context: BuildContext = {
    currentBlock: entryBlock,
    blocks: new Map([[entryBlock.id, entryBlock], [exitBlock.id, exitBlock]]),
    edges: new Map(),
    breakTargets: new Map(),
    continueTargets: new Map(),
    tryHandlers: [],
  };

  // Process all statements
  processStatements(statements, context, exitBlock.id);

  // Finalize the current block if it doesn't have a terminator
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: exitBlock.id };
    addEdge(context, context.currentBlock.id, exitBlock.id, 'normal');
  }

  // Build predecessor/successor maps
  const predecessors = new Map<NodeId, NodeId[]>();
  const successors = new Map<NodeId, NodeId[]>();

  for (const [, block] of context.blocks) {
    predecessors.set(block.id, []);
    successors.set(block.id, []);
  }

  for (const [, edge] of context.edges) {
    const preds = predecessors.get(edge.target);
    if (preds) preds.push(edge.source);
    const succs = successors.get(edge.source);
    if (succs) succs.push(edge.target);
  }

  // Identify back edges (for loops)
  const backEdges = identifyBackEdges(context.blocks, context.edges, entryBlock.id);

  // Find all exit blocks
  const exits: NodeId[] = [];
  for (const [, block] of context.blocks) {
    if (block.isExit || (block.terminator && block.terminator.kind === 'return')) {
      exits.push(block.id);
    }
  }

  // Compute dominators (simplified)
  const dominators = computeDominators(context.blocks, predecessors, entryBlock.id);
  const postDominators = computePostDominators(context.blocks, successors, exits);

  // Convert mutable blocks to immutable
  const immutableBlocks = new Map<NodeId, BasicBlock>();
  for (const [id, block] of context.blocks) {
    immutableBlocks.set(id, {
      id: block.id,
      statements: block.statements,
      isEntry: block.isEntry,
      isExit: block.isExit,
      terminator: block.terminator ?? { kind: 'fallthrough', next: exitBlock.id },
    });
  }

  return {
    blocks: immutableBlocks,
    edges: context.edges,
    entry: entryBlock.id,
    exits,
    predecessors: new Map([...predecessors].map(([k, v]) => [k, [...v]])),
    successors: new Map([...successors].map(([k, v]) => [k, [...v]])),
    backEdges,
    dominators,
    postDominators,
  };
}

function createBlock(isEntry = false, isExit = false): MutableBlock {
  return {
    id: generateNodeId(),
    statements: [],
    isEntry,
    isExit,
    terminator: null,
  };
}

function addEdge(
  context: BuildContext,
  source: NodeId,
  target: NodeId,
  kind: EdgeKind,
  condition?: EdgeCondition
): void {
  const edge: CFGEdge = {
    id: generateEdgeId(),
    source,
    target,
    kind,
    condition,
  };
  context.edges.set(edge.id, edge);
}

function startNewBlock(context: BuildContext): MutableBlock {
  const block = createBlock();
  context.blocks.set(block.id, block);
  context.currentBlock = block;
  return block;
}

function processStatements(
  statements: t.Statement[],
  context: BuildContext,
  implicitNext: NodeId
): void {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;

    // If current block already has a terminator, start a new unreachable block
    if (context.currentBlock.terminator) {
      startNewBlock(context);
    }

    processStatement(stmt, context, implicitNext);
  }
}

function processStatement(
  stmt: t.Statement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  switch (stmt.type) {
    case 'BlockStatement':
      processStatements(stmt.body, context, implicitNext);
      break;

    case 'ExpressionStatement':
    case 'VariableDeclaration':
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
    case 'EmptyStatement':
    case 'DebuggerStatement':
      // Simple statements - just add to current block
      context.currentBlock.statements.push(stmt);
      break;

    case 'IfStatement':
      processIfStatement(stmt, context, implicitNext);
      break;

    case 'WhileStatement':
      processWhileStatement(stmt, context, implicitNext);
      break;

    case 'DoWhileStatement':
      processDoWhileStatement(stmt, context, implicitNext);
      break;

    case 'ForStatement':
      processForStatement(stmt, context, implicitNext);
      break;

    case 'ForInStatement':
    case 'ForOfStatement':
      processForInOfStatement(stmt, context, implicitNext);
      break;

    case 'SwitchStatement':
      processSwitchStatement(stmt, context, implicitNext);
      break;

    case 'TryStatement':
      processTryStatement(stmt, context, implicitNext);
      break;

    case 'ReturnStatement':
      processReturnStatement(stmt, context);
      break;

    case 'ThrowStatement':
      processThrowStatement(stmt, context);
      break;

    case 'BreakStatement':
      processBreakStatement(stmt, context);
      break;

    case 'ContinueStatement':
      processContinueStatement(stmt, context);
      break;

    case 'LabeledStatement':
      processLabeledStatement(stmt, context, implicitNext);
      break;

    case 'WithStatement':
      // 'with' is problematic for sound analysis - treat as opaque
      context.currentBlock.statements.push(stmt);
      break;

    default:
      // Unknown statement type - add as-is
      context.currentBlock.statements.push(stmt);
  }
}

function processIfStatement(
  stmt: t.IfStatement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  // Add test expression to current block
  const testBlock = context.currentBlock;

  // Create blocks for consequent, alternate, and merge point
  const consequentBlock = createBlock();
  const alternateBlock = stmt.alternate ? createBlock() : null;
  const mergeBlock = createBlock();

  context.blocks.set(consequentBlock.id, consequentBlock);
  if (alternateBlock) context.blocks.set(alternateBlock.id, alternateBlock);
  context.blocks.set(mergeBlock.id, mergeBlock);

  // Set terminator for test block
  testBlock.terminator = {
    kind: 'branch',
    condition: stmt.test,
    consequent: consequentBlock.id,
    alternate: alternateBlock?.id ?? mergeBlock.id,
  };

  // Add edges
  addEdge(context, testBlock.id, consequentBlock.id, 'true-branch', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(context, testBlock.id, alternateBlock?.id ?? mergeBlock.id, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Process consequent
  context.currentBlock = consequentBlock;
  processStatement(stmt.consequent, context, mergeBlock.id);
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: mergeBlock.id };
    addEdge(context, context.currentBlock.id, mergeBlock.id, 'normal');
  }

  // Process alternate if present
  if (alternateBlock && stmt.alternate) {
    context.currentBlock = alternateBlock;
    processStatement(stmt.alternate, context, mergeBlock.id);
    if (!context.currentBlock.terminator) {
      context.currentBlock.terminator = { kind: 'fallthrough', next: mergeBlock.id };
      addEdge(context, context.currentBlock.id, mergeBlock.id, 'normal');
    }
  }

  // Continue from merge block
  context.currentBlock = mergeBlock;
}

function processWhileStatement(
  stmt: t.WhileStatement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  // Create blocks
  const headerBlock = createBlock();
  const bodyBlock = createBlock();
  const exitBlock = createBlock();

  context.blocks.set(headerBlock.id, headerBlock);
  context.blocks.set(bodyBlock.id, bodyBlock);
  context.blocks.set(exitBlock.id, exitBlock);

  // Connect current block to header
  context.currentBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
  addEdge(context, context.currentBlock.id, headerBlock.id, 'normal');

  // Header evaluates condition
  headerBlock.terminator = {
    kind: 'branch',
    condition: stmt.test,
    consequent: bodyBlock.id,
    alternate: exitBlock.id,
  };
  addEdge(context, headerBlock.id, bodyBlock.id, 'true-branch', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(context, headerBlock.id, exitBlock.id, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Set up break/continue targets
  const prevBreak = context.breakTargets.get(null);
  const prevContinue = context.continueTargets.get(null);
  context.breakTargets.set(null, exitBlock.id);
  context.continueTargets.set(null, headerBlock.id);

  // Process body
  context.currentBlock = bodyBlock;
  processStatement(stmt.body, context, headerBlock.id);
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
    addEdge(context, context.currentBlock.id, headerBlock.id, 'back-edge');
  }

  // Restore break/continue targets
  if (prevBreak !== undefined) context.breakTargets.set(null, prevBreak);
  else context.breakTargets.delete(null);
  if (prevContinue !== undefined) context.continueTargets.set(null, prevContinue);
  else context.continueTargets.delete(null);

  context.currentBlock = exitBlock;
}

function processDoWhileStatement(
  stmt: t.DoWhileStatement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  const bodyBlock = createBlock();
  const testBlock = createBlock();
  const exitBlock = createBlock();

  context.blocks.set(bodyBlock.id, bodyBlock);
  context.blocks.set(testBlock.id, testBlock);
  context.blocks.set(exitBlock.id, exitBlock);

  // Connect to body first
  context.currentBlock.terminator = { kind: 'fallthrough', next: bodyBlock.id };
  addEdge(context, context.currentBlock.id, bodyBlock.id, 'normal');

  // Set up break/continue
  const prevBreak = context.breakTargets.get(null);
  const prevContinue = context.continueTargets.get(null);
  context.breakTargets.set(null, exitBlock.id);
  context.continueTargets.set(null, testBlock.id);

  // Process body
  context.currentBlock = bodyBlock;
  processStatement(stmt.body, context, testBlock.id);
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: testBlock.id };
    addEdge(context, context.currentBlock.id, testBlock.id, 'normal');
  }

  // Test block
  testBlock.terminator = {
    kind: 'branch',
    condition: stmt.test,
    consequent: bodyBlock.id,
    alternate: exitBlock.id,
  };
  addEdge(context, testBlock.id, bodyBlock.id, 'back-edge', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(context, testBlock.id, exitBlock.id, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Restore
  if (prevBreak !== undefined) context.breakTargets.set(null, prevBreak);
  else context.breakTargets.delete(null);
  if (prevContinue !== undefined) context.continueTargets.set(null, prevContinue);
  else context.continueTargets.delete(null);

  context.currentBlock = exitBlock;
}

function processForStatement(
  stmt: t.ForStatement,
  context: BuildContext,
  _implicitNext: NodeId
): void {
  // Add init to current block
  if (stmt.init) {
    if (t.isVariableDeclaration(stmt.init)) {
      context.currentBlock.statements.push(stmt.init);
    } else {
      context.currentBlock.statements.push(t.expressionStatement(stmt.init));
    }
  }

  const headerBlock = createBlock();
  const bodyBlock = createBlock();
  const updateBlock = createBlock();
  const exitBlock = createBlock();

  context.blocks.set(headerBlock.id, headerBlock);
  context.blocks.set(bodyBlock.id, bodyBlock);
  context.blocks.set(updateBlock.id, updateBlock);
  context.blocks.set(exitBlock.id, exitBlock);

  // Connect to header
  context.currentBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
  addEdge(context, context.currentBlock.id, headerBlock.id, 'normal');

  // Header tests condition (or falls through if no test)
  if (stmt.test) {
    headerBlock.terminator = {
      kind: 'branch',
      condition: stmt.test,
      consequent: bodyBlock.id,
      alternate: exitBlock.id,
    };
    addEdge(context, headerBlock.id, bodyBlock.id, 'true-branch', {
      expression: stmt.test,
      whenTruthy: true,
    });
    addEdge(context, headerBlock.id, exitBlock.id, 'false-branch', {
      expression: stmt.test,
      whenTruthy: false,
    });
  } else {
    headerBlock.terminator = { kind: 'fallthrough', next: bodyBlock.id };
    addEdge(context, headerBlock.id, bodyBlock.id, 'normal');
  }

  // Set up break/continue
  const prevBreak = context.breakTargets.get(null);
  const prevContinue = context.continueTargets.get(null);
  context.breakTargets.set(null, exitBlock.id);
  context.continueTargets.set(null, updateBlock.id);

  // Process body
  context.currentBlock = bodyBlock;
  processStatement(stmt.body, context, updateBlock.id);
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: updateBlock.id };
    addEdge(context, context.currentBlock.id, updateBlock.id, 'normal');
  }

  // Update block
  if (stmt.update) {
    updateBlock.statements.push(t.expressionStatement(stmt.update));
  }
  updateBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
  addEdge(context, updateBlock.id, headerBlock.id, 'back-edge');

  // Restore
  if (prevBreak !== undefined) context.breakTargets.set(null, prevBreak);
  else context.breakTargets.delete(null);
  if (prevContinue !== undefined) context.continueTargets.set(null, prevContinue);
  else context.continueTargets.delete(null);

  context.currentBlock = exitBlock;
}

function processForInOfStatement(
  stmt: t.ForInStatement | t.ForOfStatement,
  context: BuildContext,
  _implicitNext: NodeId
): void {
  const headerBlock = createBlock();
  const bodyBlock = createBlock();
  const exitBlock = createBlock();

  context.blocks.set(headerBlock.id, headerBlock);
  context.blocks.set(bodyBlock.id, bodyBlock);
  context.blocks.set(exitBlock.id, exitBlock);

  // Connect to header
  context.currentBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
  addEdge(context, context.currentBlock.id, headerBlock.id, 'normal');

  // Header - iteration check (implicit)
  // For-in/of have implicit "has next element" check
  headerBlock.terminator = {
    kind: 'branch',
    condition: stmt.right, // Use right as a proxy for "has more"
    consequent: bodyBlock.id,
    alternate: exitBlock.id,
  };
  addEdge(context, headerBlock.id, bodyBlock.id, 'true-branch');
  addEdge(context, headerBlock.id, exitBlock.id, 'false-branch');

  // Set up break/continue
  const prevBreak = context.breakTargets.get(null);
  const prevContinue = context.continueTargets.get(null);
  context.breakTargets.set(null, exitBlock.id);
  context.continueTargets.set(null, headerBlock.id);

  // Body - add the left-hand side assignment
  bodyBlock.statements.push(stmt);
  context.currentBlock = bodyBlock;
  processStatement(stmt.body, context, headerBlock.id);
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: headerBlock.id };
    addEdge(context, context.currentBlock.id, headerBlock.id, 'back-edge');
  }

  // Restore
  if (prevBreak !== undefined) context.breakTargets.set(null, prevBreak);
  else context.breakTargets.delete(null);
  if (prevContinue !== undefined) context.continueTargets.set(null, prevContinue);
  else context.continueTargets.delete(null);

  context.currentBlock = exitBlock;
}

function processSwitchStatement(
  stmt: t.SwitchStatement,
  context: BuildContext,
  _implicitNext: NodeId
): void {
  const exitBlock = createBlock();
  context.blocks.set(exitBlock.id, exitBlock);

  // Set up break target
  const prevBreak = context.breakTargets.get(null);
  context.breakTargets.set(null, exitBlock.id);

  // Create blocks for each case
  const caseBlocks: MutableBlock[] = [];
  let defaultIndex = -1;

  for (let i = 0; i < stmt.cases.length; i++) {
    const block = createBlock();
    context.blocks.set(block.id, block);
    caseBlocks.push(block);
    if (stmt.cases[i]!.test === null) {
      defaultIndex = i;
    }
  }

  // Build switch terminator
  const cases = stmt.cases
    .filter((c) => c.test !== null)
    .map((c, _i) => {
      const originalIndex = stmt.cases.indexOf(c);
      return {
        test: c.test!,
        target: caseBlocks[originalIndex]!.id,
      };
    });

  context.currentBlock.terminator = {
    kind: 'switch',
    discriminant: stmt.discriminant,
    cases,
    defaultCase: defaultIndex >= 0 ? caseBlocks[defaultIndex]!.id : exitBlock.id,
  };

  // Add edges
  for (const caseInfo of cases) {
    addEdge(context, context.currentBlock.id, caseInfo.target, 'normal');
  }
  addEdge(
    context,
    context.currentBlock.id,
    defaultIndex >= 0 ? caseBlocks[defaultIndex]!.id : exitBlock.id,
    'normal'
  );

  // Process each case body
  for (let i = 0; i < stmt.cases.length; i++) {
    const caseStmt = stmt.cases[i]!;
    context.currentBlock = caseBlocks[i]!;

    processStatements(caseStmt.consequent, context, exitBlock.id);

    // Fall through to next case if no terminator
    if (!context.currentBlock.terminator) {
      const nextBlock = i < stmt.cases.length - 1 ? caseBlocks[i + 1]!.id : exitBlock.id;
      context.currentBlock.terminator = { kind: 'fallthrough', next: nextBlock };
      addEdge(context, context.currentBlock.id, nextBlock, 'normal');
    }
  }

  // Restore break target
  if (prevBreak !== undefined) context.breakTargets.set(null, prevBreak);
  else context.breakTargets.delete(null);

  context.currentBlock = exitBlock;
}

function processTryStatement(
  stmt: t.TryStatement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  const tryBlock = createBlock();
  const catchBlock = stmt.handler ? createBlock() : null;
  const finallyBlock = stmt.finalizer ? createBlock() : null;
  const exitBlock = createBlock();

  context.blocks.set(tryBlock.id, tryBlock);
  if (catchBlock) context.blocks.set(catchBlock.id, catchBlock);
  if (finallyBlock) context.blocks.set(finallyBlock.id, finallyBlock);
  context.blocks.set(exitBlock.id, exitBlock);

  // Set terminator
  const catchParam = stmt.handler?.param && t.isIdentifier(stmt.handler.param)
    ? stmt.handler.param.name
    : null;

  context.currentBlock.terminator = {
    kind: 'try',
    tryBlock: tryBlock.id,
    catchBlock: catchBlock?.id ?? null,
    catchParam,
    finallyBlock: finallyBlock?.id ?? null,
    continuation: exitBlock.id,
  };

  addEdge(context, context.currentBlock.id, tryBlock.id, 'normal');

  // Push try handler
  context.tryHandlers.push({
    catchBlock: catchBlock?.id ?? null,
    finallyBlock: finallyBlock?.id ?? null,
  });

  // Process try body
  context.currentBlock = tryBlock;
  processStatements(stmt.block.body, context, catchBlock?.id ?? finallyBlock?.id ?? exitBlock.id);
  if (!context.currentBlock.terminator) {
    const next = finallyBlock?.id ?? exitBlock.id;
    context.currentBlock.terminator = { kind: 'fallthrough', next };
    addEdge(context, context.currentBlock.id, next, 'normal');
  }

  context.tryHandlers.pop();

  // Process catch
  if (catchBlock && stmt.handler) {
    context.currentBlock = catchBlock;
    addEdge(context, tryBlock.id, catchBlock.id, 'exception');
    processStatements(stmt.handler.body.body, context, finallyBlock?.id ?? exitBlock.id);
    if (!context.currentBlock.terminator) {
      const next = finallyBlock?.id ?? exitBlock.id;
      context.currentBlock.terminator = { kind: 'fallthrough', next };
      addEdge(context, context.currentBlock.id, next, 'normal');
    }
  }

  // Process finally
  if (finallyBlock && stmt.finalizer) {
    context.currentBlock = finallyBlock;
    if (catchBlock) {
      addEdge(context, catchBlock.id, finallyBlock.id, 'finally');
    }
    processStatements(stmt.finalizer.body, context, exitBlock.id);
    if (!context.currentBlock.terminator) {
      context.currentBlock.terminator = { kind: 'fallthrough', next: exitBlock.id };
      addEdge(context, context.currentBlock.id, exitBlock.id, 'normal');
    }
  }

  context.currentBlock = exitBlock;
}

function processReturnStatement(stmt: t.ReturnStatement, context: BuildContext): void {
  context.currentBlock.statements.push(stmt);
  context.currentBlock.terminator = {
    kind: 'return',
    argument: stmt.argument ?? null,
  };
}

function processThrowStatement(stmt: t.ThrowStatement, context: BuildContext): void {
  context.currentBlock.statements.push(stmt);

  // Find nearest catch handler
  let handler: NodeId | null = null;
  for (let i = context.tryHandlers.length - 1; i >= 0; i--) {
    const h = context.tryHandlers[i]!;
    if (h.catchBlock) {
      handler = h.catchBlock;
      break;
    }
  }

  context.currentBlock.terminator = {
    kind: 'throw',
    argument: stmt.argument,
    handler,
  };

  if (handler) {
    addEdge(context, context.currentBlock.id, handler, 'exception');
  }
}

function processBreakStatement(stmt: t.BreakStatement, context: BuildContext): void {
  const label = stmt.label?.name ?? null;
  const target = context.breakTargets.get(label);

  if (target) {
    context.currentBlock.terminator = {
      kind: 'break',
      target,
      label,
    };
    addEdge(context, context.currentBlock.id, target, 'break');
  }
}

function processContinueStatement(stmt: t.ContinueStatement, context: BuildContext): void {
  const label = stmt.label?.name ?? null;
  const target = context.continueTargets.get(label);

  if (target) {
    context.currentBlock.terminator = {
      kind: 'continue',
      target,
      label,
    };
    addEdge(context, context.currentBlock.id, target, 'continue');
  }
}

function processLabeledStatement(
  stmt: t.LabeledStatement,
  context: BuildContext,
  implicitNext: NodeId
): void {
  const labelName = stmt.label.name;

  // Create exit block for this label (break target)
  const labelExitBlock = createBlock();
  context.blocks.set(labelExitBlock.id, labelExitBlock);

  // Set up labeled break target
  const prevBreak = context.breakTargets.get(labelName);
  context.breakTargets.set(labelName, labelExitBlock.id);

  // If the body is a loop, also set up continue target
  if (
    t.isWhileStatement(stmt.body) ||
    t.isDoWhileStatement(stmt.body) ||
    t.isForStatement(stmt.body) ||
    t.isForInStatement(stmt.body) ||
    t.isForOfStatement(stmt.body)
  ) {
    const headerBlock = createBlock();
    context.blocks.set(headerBlock.id, headerBlock);
    context.continueTargets.set(labelName, headerBlock.id);
  }

  // Process the body
  processStatement(stmt.body, context, labelExitBlock.id);

  // Connect to exit block if not terminated
  if (!context.currentBlock.terminator) {
    context.currentBlock.terminator = { kind: 'fallthrough', next: labelExitBlock.id };
    addEdge(context, context.currentBlock.id, labelExitBlock.id, 'normal');
  }

  // Restore
  if (prevBreak !== undefined) context.breakTargets.set(labelName, prevBreak);
  else context.breakTargets.delete(labelName);
  context.continueTargets.delete(labelName);

  context.currentBlock = labelExitBlock;
}

/**
 * Identify back edges using DFS
 */
function identifyBackEdges(
  blocks: Map<NodeId, MutableBlock>,
  edges: Map<EdgeId, CFGEdge>,
  entry: NodeId
): Set<EdgeId> {
  const visited = new Set<NodeId>();
  const inStack = new Set<NodeId>();
  const backEdges = new Set<EdgeId>();

  function dfs(nodeId: NodeId): void {
    visited.add(nodeId);
    inStack.add(nodeId);

    for (const [edgeId, edge] of edges) {
      if (edge.source === nodeId) {
        if (inStack.has(edge.target)) {
          backEdges.add(edgeId);
        } else if (!visited.has(edge.target)) {
          dfs(edge.target);
        }
      }
    }

    inStack.delete(nodeId);
  }

  dfs(entry);
  return backEdges;
}

/**
 * Compute dominators using iterative dataflow
 */
function computeDominators(
  blocks: Map<NodeId, MutableBlock>,
  predecessors: Map<NodeId, NodeId[]>,
  entry: NodeId
): Map<NodeId, Set<NodeId>> {
  const dominators = new Map<NodeId, Set<NodeId>>();

  // Initialize: entry dominates only itself, others dominated by all
  const allNodes = new Set(blocks.keys());
  for (const nodeId of blocks.keys()) {
    if (nodeId === entry) {
      dominators.set(nodeId, new Set([nodeId]));
    } else {
      dominators.set(nodeId, new Set(allNodes));
    }
  }

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of blocks.keys()) {
      if (nodeId === entry) continue;

      const preds = predecessors.get(nodeId) ?? [];
      let newDom: Set<NodeId> | null = null;

      for (const pred of preds) {
        const predDom = dominators.get(pred);
        if (predDom) {
          if (newDom === null) {
            newDom = new Set(predDom);
          } else {
            // Intersection
            for (const d of newDom) {
              if (!predDom.has(d)) {
                newDom.delete(d);
              }
            }
          }
        }
      }

      if (newDom === null) {
        newDom = new Set();
      }
      newDom.add(nodeId);

      const oldDom = dominators.get(nodeId)!;
      if (newDom.size !== oldDom.size || ![...newDom].every((d) => oldDom.has(d))) {
        dominators.set(nodeId, newDom);
        changed = true;
      }
    }
  }

  return dominators;
}

/**
 * Compute post-dominators (simplified)
 */
function computePostDominators(
  blocks: Map<NodeId, MutableBlock>,
  successors: Map<NodeId, NodeId[]>,
  exits: NodeId[]
): Map<NodeId, Set<NodeId>> {
  const postDominators = new Map<NodeId, Set<NodeId>>();

  // Initialize
  const allNodes = new Set(blocks.keys());
  const exitSet = new Set(exits);

  for (const nodeId of blocks.keys()) {
    if (exitSet.has(nodeId)) {
      postDominators.set(nodeId, new Set([nodeId]));
    } else {
      postDominators.set(nodeId, new Set(allNodes));
    }
  }

  // Iterate until fixed point
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of blocks.keys()) {
      if (exitSet.has(nodeId)) continue;

      const succs = successors.get(nodeId) ?? [];
      let newPostDom: Set<NodeId> | null = null;

      for (const succ of succs) {
        const succPostDom = postDominators.get(succ);
        if (succPostDom) {
          if (newPostDom === null) {
            newPostDom = new Set(succPostDom);
          } else {
            for (const d of newPostDom) {
              if (!succPostDom.has(d)) {
                newPostDom.delete(d);
              }
            }
          }
        }
      }

      if (newPostDom === null) {
        newPostDom = new Set();
      }
      newPostDom.add(nodeId);

      const oldPostDom = postDominators.get(nodeId)!;
      if (newPostDom.size !== oldPostDom.size || ![...newPostDom].every((d) => oldPostDom.has(d))) {
        postDominators.set(nodeId, newPostDom);
        changed = true;
      }
    }
  }

  return postDominators;
}
