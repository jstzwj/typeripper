/**
 * Statement Handlers - Process different statement types for CFG
 *
 * This module handles the CFG construction for various JavaScript statements.
 */

import * as t from '@babel/types';
import type { NodeId } from '../../types/index.js';
import type { BuildContext } from './types.js';
import { createBlock, addEdge, startNewBlock } from './blocks.js';

/**
 * Process statements and build CFG
 */
export function processStatements(
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

export function processStatement(
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
  const caseBlocks: ReturnType<typeof createBlock>[] = [];
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
