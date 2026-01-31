/**
 * CFG Statement Conversion
 * Convert JavaScript statements to CFG blocks
 */

import * as t from '@babel/types';
import type { NodeId } from '../../types/cfg.js';
import {
  createCFGBuilderState,
  startBlock,
  finalizeBlock,
  createImplicitBlock,
  addEdge,
  markAsBackEdge,
  pushLoop,
  popLoop,
  pushSwitch,
  popSwitch,
  addLabel,
  removeLabel,
  getLabelTarget,
  getCurrentLoop,
  getCurrentSwitch,
  setFallthrough,
  setReturn,
  setThrow,
  addStatement,
  addStatements,
  addDeclaration,
  addReference,
  type CFGBuilderState,
} from './blocks.js';

// ============================================================================
// Main Build Function
// ============================================================================

export interface BuildResult {
  entry: NodeId;
  exits: NodeId[];
}

export function buildCFG(statements: readonly t.Statement[]): BuildResult {
  const state = createCFGBuilderState();

  // Create entry block
  const entryBlock = startBlock(state, true);

  // Process statements
  const exitId = processStatements(statements, state);

  // If no explicit exit, create one
  const finalExit = exitId ?? createImplicitBlock(state);

  // Finalize all blocks
  finalizeBlock(state);

  // Ensure all fallthroughs have targets
  resolveFallthroughs(state);

  return {
    entry: entryBlock.id,
    exits: Array.from(state.exits),
  };
}

// ============================================================================
// Statement Processing
// ============================================================================

function processStatements(
  statements: readonly t.Statement[],
  state: CFGBuilderState
): NodeId | null {
  let lastNodeId: NodeId | null = null;

  for (const stmt of statements) {
    const result = processStatement(stmt, state);
    if (result) {
      lastNodeId = result;
    }
  }

  return lastNodeId;
}

function processStatement(stmt: t.Statement, state: CFGBuilderState): NodeId | null {
  switch (stmt.type) {
    case 'BlockStatement':
      return processBlockStatement(stmt, state);

    case 'ExpressionStatement':
      return processExpressionStatement(stmt, state);

    case 'IfStatement':
      return processIfStatement(stmt, state);

    case 'WhileStatement':
      return processWhileStatement(stmt, state);

    case 'DoWhileStatement':
      return processDoWhileStatement(stmt, state);

    case 'ForStatement':
      return processForStatement(stmt, state);

    case 'ForInStatement':
      return processForInStatement(stmt, state);

    case 'ForOfStatement':
      return processForOfStatement(stmt, state);

    case 'SwitchStatement':
      return processSwitchStatement(stmt, state);

    case 'TryStatement':
      return processTryStatement(stmt, state);

    case 'ReturnStatement':
      return processReturnStatement(stmt, state);

    case 'ThrowStatement':
      return processThrowStatement(stmt, state);

    case 'BreakStatement':
      return processBreakStatement(stmt, state);

    case 'ContinueStatement':
      return processContinueStatement(stmt, state);

    case 'LabeledStatement':
      return processLabeledStatement(stmt, state);

    case 'VariableDeclaration':
      return processVariableDeclaration(stmt, state);

    case 'FunctionDeclaration':
      return processFunctionDeclaration(stmt, state);

    case 'ClassDeclaration':
      return processClassDeclaration(stmt, state);

    case 'EmptyStatement':
      return null; // No-op

    case 'DebuggerStatement':
      return null; // No-op

    case 'WithStatement':
      // With statement is deprecated and complex
      // Treat as a simple block for now
      return processBlockStatement(
        t.blockStatement([stmt.body]),
        state
      );

    default:
      // Unknown statement type - add as expression and continue
      addStatement(state, stmt as t.Statement);
      return null;
  }
}

// ============================================================================
// Block Statement
// ============================================================================

function processBlockStatement(
  stmt: t.BlockStatement,
  state: CFGBuilderState
): NodeId | null {
  addStatements(state, stmt.body);
  return null;
}

// ============================================================================
// Expression Statement
// ============================================================================

function processExpressionStatement(
  stmt: t.ExpressionStatement,
  state: CFGBuilderState
): NodeId | null {
  addStatement(state, stmt);

  // Collect references
  collectReferences(stmt.expression, state);

  return null;
}

// ============================================================================
// If Statement
// ============================================================================

function processIfStatement(stmt: t.IfStatement, state: CFGBuilderState): NodeId | null {
  // Structure:
  //   [current] --condition--> [consequent]
  //      |                       |
  //      | (false)               | (fallthrough)
  //      v                       v
  //   [alternate] ---------> [merge]
  //      |
  //      | (fallthrough)
  //      v
  //   [merge]

  // Collect references from condition
  collectReferences(stmt.test, state);

  // Create blocks
  const mergeBlock = createImplicitBlock(state);
  const consequentEntry = createImplicitBlock(state);
  const alternateEntry = stmt.alternate ? createImplicitBlock(state) : mergeBlock;

  // Set branch terminator from current block
  setFallthrough(state, consequentEntry);

  // Process consequent
  state.blocks.set(consequentEntry, {
    id: consequentEntry,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: mergeBlock },
  });

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: consequentEntry,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: mergeBlock },
    addStatement: () => {},
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(consequentEntry)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.consequent, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(consequentEntry, built);
  }

  // Process alternate if present
  if (stmt.alternate) {
    state.blocks.set(alternateEntry, {
      id: alternateEntry,
      statements: [],
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: mergeBlock },
    });

    state.currentBlock = {
      id: alternateEntry,
      statements: [],
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: mergeBlock },
      addStatement: () => {},
      setTerminator: () => {},
      setExit: () => {},
      build: () => state.blocks.get(alternateEntry)!,
      addDeclaration: () => {},
      addReference: () => {},
    } as any;

    processStatement(stmt.alternate, state);
    if (state.currentBlock) {
      const built = state.currentBlock.build();
      state.blocks.set(alternateEntry, built);
    }
  }

  state.currentBlock = prevBlock;
  addEdge(state, state.currentBlock?.id ?? '', consequentEntry, 'true-branch', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(state, state.currentBlock?.id ?? '', alternateEntry, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Set fallthrough to merge block
  setFallthrough(state, mergeBlock);

  return mergeBlock;
}

// ============================================================================
// While Statement
// ============================================================================

function processWhileStatement(stmt: t.WhileStatement, state: CFGBuilderState): NodeId | null {
  // Structure:
  //   [header] --condition(true)--> [body] --back-edge--> [header]
  //      |                                          |
  //      | (false)                                  |
  //      v                                          v
  //   [exit] <---------------------------------- [fallthrough from body]

  const headerBlock = createImplicitBlock(state);
  const bodyBlock = createImplicitBlock(state);
  const exitBlock = createImplicitBlock(state);

  // Collect references from condition
  collectReferences(stmt.test, state);

  // Set fallthrough to header
  setFallthrough(state, headerBlock);

  // Create header block (condition check)
  state.blocks.set(headerBlock, {
    id: headerBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: {
      kind: 'branch',
      condition: stmt.test,
      consequent: bodyBlock,
      alternate: exitBlock,
    },
  });

  // Push loop context
  pushLoop(state, headerBlock, bodyBlock, exitBlock);

  // Create body block
  state.blocks.set(bodyBlock, {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: headerBlock },
  });

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: headerBlock },
    addStatement: (s) => {
      const block = state.blocks.get(bodyBlock)!;
      state.blocks.set(bodyBlock, { ...block, statements: [...block.statements, s] });
    },
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(bodyBlock)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.body, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(bodyBlock, built);
  }

  state.currentBlock = prevBlock;

  // Add edges
  const fromHeader = state.blocks.get(headerBlock)!;
  addEdge(state, headerBlock, bodyBlock, 'true-branch', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(state, headerBlock, exitBlock, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Mark back edge from body to header
  const backEdgeId = addEdge(state, bodyBlock, headerBlock, 'normal');
  markAsBackEdge(state, backEdgeId);

  // Pop loop context
  popLoop(state);

  // Set fallthrough to exit
  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// Do-While Statement
// ============================================================================

function processDoWhileStatement(stmt: t.DoWhileStatement, state: CFGBuilderState): NodeId | null {
  // Structure:
  //   [body] --> [check] --condition(true)--> [body]  (back edge)
  //      |             |
  //      |             | (false)
  //      v             v
  //   [exit] <---- [implicit fallthrough]

  const bodyBlock = createImplicitBlock(state);
  const checkBlock = createImplicitBlock(state);
  const exitBlock = createImplicitBlock(state);

  // Set fallthrough to body
  setFallthrough(state, bodyBlock);

  // Create body block
  state.blocks.set(bodyBlock, {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: checkBlock },
  });

  // Push loop context
  pushLoop(state, checkBlock, bodyBlock, exitBlock);

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: checkBlock },
    addStatement: (s) => {
      const block = state.blocks.get(bodyBlock)!;
      state.blocks.set(bodyBlock, { ...block, statements: [...block.statements, s] });
    },
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(bodyBlock)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.body, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(bodyBlock, built);
  }

  state.currentBlock = prevBlock;

  // Collect references from condition
  collectReferences(stmt.test, state);

  // Create check block
  state.blocks.set(checkBlock, {
    id: checkBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: {
      kind: 'branch',
      condition: stmt.test,
      consequent: bodyBlock,
      alternate: exitBlock,
    },
  });

  // Add edges
  addEdge(state, bodyBlock, checkBlock, 'normal');
  addEdge(state, checkBlock, bodyBlock, 'true-branch', {
    expression: stmt.test,
    whenTruthy: true,
  });
  addEdge(state, checkBlock, exitBlock, 'false-branch', {
    expression: stmt.test,
    whenTruthy: false,
  });

  // Mark back edge from check to body
  const backEdgeId = addEdge(state, checkBlock, bodyBlock, 'normal');
  markAsBackEdge(state, backEdgeId);

  // Pop loop context
  popLoop(state);

  // Set fallthrough to exit
  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// For Statement
// ============================================================================

function processForStatement(stmt: t.ForStatement, state: CFGBuilderState): NodeId | null {
  // Structure:
  //   [init] --> [cond] --true--> [body] --> [update] --back-edge--> [cond]
  //      |          |
  //      |          | false
  //      v          v
  //   [exit] <---- [implicit]

  const initBlock = createImplicitBlock(state);
  const condBlock = createImplicitBlock(state);
  const bodyBlock = createImplicitBlock(state);
  const updateBlock = createImplicitBlock(state);
  const exitBlock = createImplicitBlock(state);

  // Process init
  if (stmt.init) {
    if (t.isVariableDeclaration(stmt.init)) {
      for (const decl of stmt.init.declarations) {
        collectDeclaredNames(decl.id, state);
      }
    }
  }

  // Set fallthrough to cond
  setFallthrough(state, condBlock);

  // Create cond block
  if (stmt.test) {
    collectReferences(stmt.test, state);
    state.blocks.set(condBlock, {
      id: condBlock,
      statements: [],
      isEntry: false,
      isExit: false,
      terminator: {
        kind: 'branch',
        condition: stmt.test,
        consequent: bodyBlock,
        alternate: exitBlock,
      },
    });

    addEdge(state, condBlock, bodyBlock, 'true-branch', {
      expression: stmt.test,
      whenTruthy: true,
    });
    addEdge(state, condBlock, exitBlock, 'false-branch', {
      expression: stmt.test,
      whenTruthy: false,
    });
  } else {
    state.blocks.set(condBlock, {
      id: condBlock,
      statements: [],
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: bodyBlock },
    });
    addEdge(state, condBlock, bodyBlock, 'normal');
  }

  // Push loop context
  pushLoop(state, condBlock, bodyBlock, exitBlock, updateBlock);

  // Create body block
  state.blocks.set(bodyBlock, {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: updateBlock },
  });

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: updateBlock },
    addStatement: (s) => {
      const block = state.blocks.get(bodyBlock)!;
      state.blocks.set(bodyBlock, { ...block, statements: [...block.statements, s] });
    },
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(bodyBlock)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.body, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(bodyBlock, built);
  }

  state.currentBlock = prevBlock;

  // Create update block
  if (stmt.update) {
    collectReferences(stmt.update, state);
    state.blocks.set(updateBlock, {
      id: updateBlock,
      statements: [t.expressionStatement(stmt.update)],
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: condBlock },
    });

    addEdge(state, bodyBlock, updateBlock, 'normal');
    const backEdgeId = addEdge(state, updateBlock, condBlock, 'normal');
    markAsBackEdge(state, backEdgeId);
  } else {
    // No update block - back edge from body directly
    const backEdgeId = addEdge(state, bodyBlock, condBlock, 'normal');
    markAsBackEdge(state, backEdgeId);
  }

  // Pop loop context
  popLoop(state);

  // Set fallthrough to exit
  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// For-In Statement
// ============================================================================

function processForInStatement(stmt: t.ForInStatement, state: CFGBuilderState): NodeId | null {
  // Simplified: treat as while loop
  const leftBlock = createImplicitBlock(state);
  const bodyBlock = createImplicitBlock(state);
  const exitBlock = createImplicitBlock(state);

  // Collect declared names from left
  if (t.isVariableDeclaration(stmt.left)) {
    for (const decl of stmt.left.declarations) {
      collectDeclaredNames(decl.id, state);
    }
  }

  collectReferences(stmt.right, state);

  setFallthrough(state, leftBlock);
  addEdge(state, leftBlock, bodyBlock, 'normal');
  // Create a condition expression - use an identifier if left is a pattern
  const leftExpr = t.isExpression(stmt.left) ? stmt.left : t.identifier('undefined');
  addEdge(state, leftBlock, exitBlock, 'false-branch', {
    expression: t.binaryExpression('in', leftExpr, stmt.right),
    whenTruthy: false,
  });

  pushLoop(state, leftBlock, bodyBlock, exitBlock);

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: leftBlock },
    addStatement: (s) => {
      const block = state.blocks.get(bodyBlock)!;
      state.blocks.set(bodyBlock, { ...block, statements: [...block.statements, s] });
    },
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(bodyBlock)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.body, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(bodyBlock, built);
  }

  state.currentBlock = prevBlock;
  popLoop(state);

  const backEdgeId = addEdge(state, bodyBlock, leftBlock, 'normal');
  markAsBackEdge(state, backEdgeId);

  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// For-Of Statement
// ============================================================================

function processForOfStatement(stmt: t.ForOfStatement, state: CFGBuilderState): NodeId | null {
  // Similar to for-in
  const leftBlock = createImplicitBlock(state);
  const bodyBlock = createImplicitBlock(state);
  const exitBlock = createImplicitBlock(state);

  if (t.isVariableDeclaration(stmt.left)) {
    for (const decl of stmt.left.declarations) {
      collectDeclaredNames(decl.id, state);
    }
  }

  collectReferences(stmt.right, state);

  setFallthrough(state, leftBlock);
  addEdge(state, leftBlock, bodyBlock, 'normal');
  addEdge(state, leftBlock, exitBlock, 'false-branch');

  pushLoop(state, leftBlock, bodyBlock, exitBlock);

  const prevBlock = state.currentBlock;
  state.currentBlock = {
    id: bodyBlock,
    statements: [],
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: leftBlock },
    addStatement: (s) => {
      const block = state.blocks.get(bodyBlock)!;
      state.blocks.set(bodyBlock, { ...block, statements: [...block.statements, s] });
    },
    setTerminator: () => {},
    setExit: () => {},
    build: () => state.blocks.get(bodyBlock)!,
    addDeclaration: () => {},
    addReference: () => {},
  } as any;

  processStatement(stmt.body, state);
  if (state.currentBlock) {
    const built = state.currentBlock.build();
    state.blocks.set(bodyBlock, built);
  }

  state.currentBlock = prevBlock;
  popLoop(state);

  const backEdgeId = addEdge(state, bodyBlock, leftBlock, 'normal');
  markAsBackEdge(state, backEdgeId);

  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// Switch Statement
// ============================================================================

function processSwitchStatement(stmt: t.SwitchStatement, state: CFGBuilderState): NodeId | null {
  // Create exit block
  const exitBlock = createImplicitBlock(state);

  collectReferences(stmt.discriminant, state);

  // Push switch context
  pushSwitch(state, stmt.discriminant, exitBlock);

  // Create blocks for each case
  const caseBlocks: NodeId[] = [];
  const defaultBlock = createImplicitBlock(state);

  for (const c of stmt.cases) {
    const caseBlock = createImplicitBlock(state);
    caseBlocks.push(caseBlock);

    state.blocks.set(caseBlock, {
      id: caseBlock,
      statements: c.consequent,
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: caseBlocks[caseBlocks.indexOf(caseBlock) + 1] ?? exitBlock },
    });
  }

  // Add edges from current to first case
  if (caseBlocks.length > 0) {
    setFallthrough(state, caseBlocks[0]!);
  } else {
    setFallthrough(state, exitBlock);
  }

  // Pop switch context
  popSwitch(state);

  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// Try Statement
// ============================================================================

function processTryStatement(stmt: t.TryStatement, state: CFGBuilderState): NodeId | null {
  // Structure:
  //   [try] --> [catch/finally] --> [exit]
  //      |
  //      | exception
  //      v
  //   [handler] --> [finally]

  const tryBlock = createImplicitBlock(state);
  const handlerBlock = stmt.handler ? createImplicitBlock(state) : null;
  const finalizerBlock = stmt.finalizer ? createImplicitBlock(state) : null;
  const exitBlock = createImplicitBlock(state);

  // Set fallthrough to try block
  setFallthrough(state, tryBlock);

  // Process try block
  state.blocks.set(tryBlock, {
    id: tryBlock,
    statements: stmt.block.body,
    isEntry: false,
    isExit: false,
    terminator: { kind: 'fallthrough', next: finalizerBlock ?? exitBlock },
  });

  addEdge(state, tryBlock, finalizerBlock ?? exitBlock, 'normal');
  if (handlerBlock) {
    addEdge(state, tryBlock, handlerBlock, 'exception');
  }

  // Process catch block if present
  if (stmt.handler && handlerBlock) {
    if (t.isIdentifier(stmt.handler.param)) {
      addDeclaration(state, stmt.handler.param.name);
    }
    state.blocks.set(handlerBlock, {
      id: handlerBlock,
      statements: stmt.handler.body.body,
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: finalizerBlock ?? exitBlock },
    });
    addEdge(state, handlerBlock, finalizerBlock ?? exitBlock, 'normal');
  }

  // Process finally block if present
  if (stmt.finalizer && finalizerBlock) {
    state.blocks.set(finalizerBlock, {
      id: finalizerBlock,
      statements: stmt.finalizer.body,
      isEntry: false,
      isExit: false,
      terminator: { kind: 'fallthrough', next: exitBlock },
    });
    addEdge(state, finalizerBlock, exitBlock, 'normal');
  }

  setFallthrough(state, exitBlock);

  return exitBlock;
}

// ============================================================================
// Return Statement
// ============================================================================

function processReturnStatement(stmt: t.ReturnStatement, state: CFGBuilderState): NodeId | null {
  if (stmt.argument) {
    collectReferences(stmt.argument, state);
  }
  setReturn(state, stmt.argument);
  return null;
}

// ============================================================================
// Throw Statement
// ============================================================================

function processThrowStatement(stmt: t.ThrowStatement, state: CFGBuilderState): NodeId | null {
  collectReferences(stmt.argument, state);
  setThrow(state, stmt.argument);
  return null;
}

// ============================================================================
// Break Statement
// ============================================================================

function processBreakStatement(stmt: t.BreakStatement, state: CFGBuilderState): NodeId | null {
  let target: NodeId | undefined;

  if (stmt.label) {
    target = getLabelTarget(state, stmt.label.name);
  } else {
    // Find innermost loop or switch
    const loop = getCurrentLoop(state);
    const sw = getCurrentSwitch(state);
    if (sw && (!loop || sw.discriminant.loc && loop.header && sw.discriminant.loc.end.line > (state.blocks.get(loop.header)?.id.charCodeAt(0) ?? 0))) {
      target = sw.exit;
    } else if (loop) {
      target = loop.exit;
    }
  }

  if (target) {
    addEdge(state, state.currentBlock?.id ?? '', target, 'normal');
  }

  return null;
}

// ============================================================================
// Continue Statement
// ============================================================================

function processContinueStatement(stmt: t.ContinueStatement, state: CFGBuilderState): NodeId | null {
  let target: NodeId | undefined;

  if (stmt.label) {
    target = getLabelTarget(state, stmt.label.name);
  } else {
    const loop = getCurrentLoop(state);
    if (loop) {
      target = loop.update ?? loop.header;
    }
  }

  if (target) {
    addEdge(state, state.currentBlock?.id ?? '', target, 'normal');
  }

  return null;
}

// ============================================================================
// Labeled Statement
// ============================================================================

function processLabeledStatement(stmt: t.LabeledStatement, state: CFGBuilderState): NodeId | null {
  const labelBlock = createImplicitBlock(state);
  addLabel(state, stmt.label.name, labelBlock);
  const result = processStatement(stmt.body, state);
  removeLabel(state, stmt.label.name);
  return result;
}

// ============================================================================
// Variable Declaration
// ============================================================================

function processVariableDeclaration(stmt: t.VariableDeclaration, state: CFGBuilderState): NodeId | null {
  for (const decl of stmt.declarations) {
    collectDeclaredNames(decl.id, state);
    if (decl.init) {
      collectReferences(decl.init, state);
    }
  }
  addStatement(state, stmt);
  return null;
}

// ============================================================================
// Function Declaration
// ============================================================================

function processFunctionDeclaration(stmt: t.FunctionDeclaration, state: CFGBuilderState): NodeId | null {
  if (stmt.id) {
    addDeclaration(state, stmt.id.name);
  }
  // Function body will be analyzed separately
  addStatement(state, stmt);
  return null;
}

// ============================================================================
// Class Declaration
// ============================================================================

function processClassDeclaration(stmt: t.ClassDeclaration, state: CFGBuilderState): NodeId | null {
  if (stmt.id) {
    addDeclaration(state, stmt.id.name);
  }
  // Class body will be analyzed separately
  addStatement(state, stmt);
  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

function collectReferences(node: t.Node, state: CFGBuilderState): void {
  // Simple reference collection - traverse and collect identifiers
  // In a full implementation, this would use @babel/traverse
  if (t.isIdentifier(node)) {
    addReference(state, node.name);
  }
}

function collectDeclaredNames(node: t.Node, state: CFGBuilderState): void {
  if (t.isIdentifier(node)) {
    addDeclaration(state, node.name);
  } else if (t.isObjectPattern(node)) {
    for (const prop of node.properties) {
      if (t.isRestElement(prop)) {
        collectDeclaredNames(prop.argument, state);
      } else {
        collectDeclaredNames(prop.value, state);
      }
    }
  } else if (t.isArrayPattern(node)) {
    for (const elem of node.elements) {
      if (elem) {
        collectDeclaredNames(elem, state);
      }
    }
  } else if (t.isRestElement(node)) {
    collectDeclaredNames(node.argument, state);
  } else if (t.isAssignmentPattern(node)) {
    collectDeclaredNames(node.left, state);
  }
}

function resolveFallthroughs(state: CFGBuilderState): void {
  // Ensure all fallthrough terminators point to valid blocks
  for (const [id, block] of state.blocks) {
    if (block.terminator.kind === 'fallthrough') {
      const target = block.terminator.next;
      if (!state.blocks.has(target)) {
        // Create empty target block
        state.blocks.set(target, {
          id: target,
          statements: [],
          isEntry: false,
          isExit: true,
          terminator: { kind: 'return', argument: null },
        });
      }
    }
  }
}
