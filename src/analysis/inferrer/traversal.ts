/**
 * AST Traversal - Traverse AST for type inference
 *
 * This module handles traversal of the AST for type inference.
 */

import * as t from '@babel/types';
import { Types } from '../../utils/type-factory.js';
import type { InferContext } from './context.js';
import { createEnv, addBinding } from './context.js';
import { inferExpression } from './expressions.js';
import {
  handleVariableDeclaration,
  handleFunctionDeclaration,
  handleClassDeclaration,
  handleAssignment,
} from './declarations.js';

/**
 * Simple AST traversal for type inference
 */
export function traverseProgram(program: t.Program, ctx: InferContext): void {
  for (const stmt of program.body) {
    traverseStatement(stmt, ctx);
  }
}

export function traverseStatement(stmt: t.Statement, ctx: InferContext): void {
  switch (stmt.type) {
    case 'VariableDeclaration':
      handleVariableDeclaration(stmt, ctx);
      break;
    case 'FunctionDeclaration':
      handleFunctionDeclaration(stmt, ctx);
      break;
    case 'ClassDeclaration':
      handleClassDeclaration(stmt, ctx);
      break;
    case 'ExpressionStatement':
      traverseExpression(stmt.expression, ctx);
      break;
    case 'ReturnStatement':
      if (stmt.argument) {
        traverseExpression(stmt.argument, ctx);
      }
      break;
    case 'BlockStatement':
      for (const s of stmt.body) {
        traverseStatement(s, ctx);
      }
      break;
    case 'IfStatement':
      traverseStatement(stmt.consequent, ctx);
      if (stmt.alternate) traverseStatement(stmt.alternate, ctx);
      break;
    case 'WhileStatement':
    case 'DoWhileStatement':
      traverseStatement(stmt.body, ctx);
      break;
    case 'ForStatement':
      if (stmt.init && t.isVariableDeclaration(stmt.init)) {
        handleVariableDeclaration(stmt.init, ctx);
      }
      traverseStatement(stmt.body, ctx);
      break;
    case 'ForInStatement':
    case 'ForOfStatement':
      if (t.isVariableDeclaration(stmt.left)) {
        handleVariableDeclaration(stmt.left, ctx);
      }
      traverseStatement(stmt.body, ctx);
      break;
    case 'SwitchStatement':
      for (const c of stmt.cases) {
        for (const s of c.consequent) {
          traverseStatement(s, ctx);
        }
      }
      break;
    case 'TryStatement':
      traverseStatement(stmt.block, ctx);
      if (stmt.handler) traverseStatement(stmt.handler.body, ctx);
      if (stmt.finalizer) traverseStatement(stmt.finalizer, ctx);
      break;
  }
}

/**
 * Traverse expressions to find nested declarations (e.g., IIFE)
 */
export function traverseExpression(expr: t.Expression | t.SpreadElement, ctx: InferContext): void {
  if (t.isSpreadElement(expr)) {
    traverseExpression(expr.argument, ctx);
    return;
  }

  switch (expr.type) {
    case 'AssignmentExpression':
      handleAssignment(expr, ctx);
      traverseExpression(expr.right, ctx);
      break;

    case 'CallExpression':
      // Handle IIFE: (function() { ... })() or (() => { ... })()
      if (t.isFunctionExpression(expr.callee) || t.isArrowFunctionExpression(expr.callee)) {
        traverseFunctionBody(expr.callee, ctx);
      } else if (t.isExpression(expr.callee)) {
        traverseExpression(expr.callee, ctx);
      }
      for (const arg of expr.arguments) {
        if (t.isExpression(arg) || t.isSpreadElement(arg)) {
          traverseExpression(arg, ctx);
        }
      }
      break;

    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      traverseFunctionBody(expr, ctx);
      break;

    case 'ObjectExpression':
      for (const prop of expr.properties) {
        if (t.isObjectProperty(prop) && t.isExpression(prop.value)) {
          traverseExpression(prop.value, ctx);
        } else if (t.isObjectMethod(prop)) {
          traverseFunctionBody(prop, ctx);
        } else if (t.isSpreadElement(prop)) {
          traverseExpression(prop.argument, ctx);
        }
      }
      break;

    case 'ArrayExpression':
      for (const elem of expr.elements) {
        if (elem && (t.isExpression(elem) || t.isSpreadElement(elem))) {
          traverseExpression(elem, ctx);
        }
      }
      break;

    case 'ConditionalExpression':
      traverseExpression(expr.consequent, ctx);
      traverseExpression(expr.alternate, ctx);
      break;

    case 'LogicalExpression':
    case 'BinaryExpression':
      if (t.isExpression(expr.left)) {
        traverseExpression(expr.left, ctx);
      }
      traverseExpression(expr.right, ctx);
      break;

    case 'SequenceExpression':
      for (const e of expr.expressions) {
        traverseExpression(e, ctx);
      }
      break;

    case 'NewExpression':
      if (t.isExpression(expr.callee)) {
        traverseExpression(expr.callee, ctx);
      }
      for (const arg of expr.arguments) {
        if (t.isExpression(arg) || t.isSpreadElement(arg)) {
          traverseExpression(arg, ctx);
        }
      }
      break;

    case 'MemberExpression':
      if (t.isExpression(expr.object)) {
        traverseExpression(expr.object, ctx);
      }
      break;

    case 'ClassExpression':
      handleClassDeclaration(expr as unknown as t.ClassDeclaration, ctx);
      break;
  }
}

/**
 * Traverse function body and annotate contents
 */
export function traverseFunctionBody(
  func: t.FunctionExpression | t.ArrowFunctionExpression | t.FunctionDeclaration | t.ObjectMethod,
  ctx: InferContext
): void {
  // Create new scope for function
  const oldEnv = ctx.env;
  ctx.env = createEnv(oldEnv, 'function');

  // Add function parameters to environment
  for (const param of func.params) {
    if (t.isIdentifier(param)) {
      ctx.env = addBinding(ctx.env, param.name, Types.any(), 'var', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      ctx.env = addBinding(ctx.env, param.argument.name, Types.array(Types.any()), 'var', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      ctx.env = addBinding(ctx.env, param.left.name, inferExpression(param.right, ctx), 'var', param);
    }
  }

  // Traverse function body
  if (t.isBlockStatement(func.body)) {
    for (const stmt of func.body.body) {
      traverseStatement(stmt, ctx);
    }
  } else if (t.isExpression(func.body)) {
    traverseExpression(func.body, ctx);
  }

  // Restore outer scope
  ctx.env = oldEnv;
}
