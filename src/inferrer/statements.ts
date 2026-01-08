/**
 * Statement Type Inference
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * Statements don't produce types but generate constraints
 * and may modify the typing environment.
 */

import type { Statement, Node } from '@babel/types';
import type { PolarType, PolyScheme, FunctionType, RecordType } from '../types/index.js';
import {
  undefined_,
  any,
  func,
  param,
  record,
  field,
  array,
  union,
  promise,
} from '../types/factory.js';
import { monoScheme } from '../types/scheme.js';
import type { ConstraintSet } from '../solver/index.js';
import {
  flow,
  emptyConstraintSet,
  addConstraint,
  mergeConstraintSets,
} from '../solver/index.js';
import type { StatementResult, InferResult } from './context.js';
import {
  InferenceContext,
  statementResult,
  emptyStatementResult,
  nodeToSource,
} from './context.js';
import { inferExpression } from './expressions.js';

// ============================================================================
// Main Statement Inference
// ============================================================================

/**
 * Infer constraints from a statement
 */
export function inferStatement(ctx: InferenceContext, stmt: Statement): StatementResult {
  switch (stmt.type) {
    case 'BlockStatement':
      return inferStatements(ctx.child(), (stmt as any).body);

    case 'ExpressionStatement': {
      const result = inferExpression(ctx, (stmt as any).expression);
      return statementResult(result.constraints);
    }

    case 'VariableDeclaration':
      return inferVariableDeclaration(ctx, stmt as any);

    case 'FunctionDeclaration':
      return inferFunctionDeclaration(ctx, stmt as any);

    case 'ClassDeclaration':
      return inferClassDeclaration(ctx, stmt as any);

    case 'ReturnStatement':
      return inferReturnStatement(ctx, stmt as any);

    case 'IfStatement':
      return inferIfStatement(ctx, stmt as any);

    case 'SwitchStatement':
      return inferSwitchStatement(ctx, stmt as any);

    case 'WhileStatement':
      return inferWhileStatement(ctx, stmt as any);

    case 'DoWhileStatement':
      return inferDoWhileStatement(ctx, stmt as any);

    case 'ForStatement':
      return inferForStatement(ctx, stmt as any);

    case 'ForInStatement':
      return inferForInStatement(ctx, stmt as any);

    case 'ForOfStatement':
      return inferForOfStatement(ctx, stmt as any);

    case 'TryStatement':
      return inferTryStatement(ctx, stmt as any);

    case 'ThrowStatement':
      return inferThrowStatement(ctx, stmt as any);

    case 'BreakStatement':
    case 'ContinueStatement':
      return emptyStatementResult();

    case 'LabeledStatement':
      return inferStatement(ctx, (stmt as any).body);

    case 'WithStatement': {
      const objResult = inferExpression(ctx, (stmt as any).object);
      const bodyResult = inferStatement(ctx.child(), (stmt as any).body);
      return statementResult(
        mergeConstraintSets(objResult.constraints, bodyResult.constraints),
        bodyResult.diverges
      );
    }

    case 'EmptyStatement':
    case 'DebuggerStatement':
      return emptyStatementResult();

    case 'ImportDeclaration':
      return inferImportDeclaration(ctx, stmt as any);

    case 'ExportNamedDeclaration':
      return inferExportNamedDeclaration(ctx, stmt as any);

    case 'ExportDefaultDeclaration':
      return inferExportDefaultDeclaration(ctx, stmt as any);

    case 'ExportAllDeclaration':
      return emptyStatementResult();

    // TypeScript declarations
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
    case 'TSEnumDeclaration':
    case 'TSModuleDeclaration':
    case 'TSDeclareFunction':
      return emptyStatementResult();

    default:
      return emptyStatementResult();
  }
}

/**
 * Infer constraints from a sequence of statements
 */
export function inferStatements(
  ctx: InferenceContext,
  stmts: readonly Statement[]
): StatementResult {
  let constraints = emptyConstraintSet();
  let diverges = false;
  const bindings = new Map<string, PolyScheme>();

  for (const stmt of stmts) {
    if (diverges) break;

    const result = inferStatement(ctx, stmt);
    constraints = mergeConstraintSets(constraints, result.constraints);
    diverges = result.diverges;

    for (const [name, scheme] of result.bindings) {
      ctx.bindScheme(name, scheme);
      bindings.set(name, scheme);
    }
  }

  return statementResult(constraints, diverges, bindings);
}

// ============================================================================
// Variable Declaration
// ============================================================================

function inferVariableDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  let constraints = emptyConstraintSet();
  const bindings = new Map<string, PolyScheme>();

  for (const decl of stmt.declarations) {
    let initType: PolarType = undefined_;
    if (decl.init) {
      const initResult = inferExpression(ctx, decl.init);
      constraints = mergeConstraintSets(constraints, initResult.constraints);
      initType = initResult.type;
    }

    const patternBindings = inferPatternBindings(ctx, decl.id, initType);
    constraints = mergeConstraintSets(constraints, patternBindings.constraints);

    for (const [name, type] of patternBindings.bindings) {
      const polyScheme = ctx.generalize(type);
      bindings.set(name, polyScheme);
      ctx.bindScheme(name, polyScheme);
    }
  }

  return statementResult(constraints, false, bindings);
}

interface PatternBindingsResult {
  bindings: Map<string, PolarType>;
  constraints: ConstraintSet;
}

function inferPatternBindings(
  ctx: InferenceContext,
  pattern: any,
  initType: PolarType
): PatternBindingsResult {
  const bindings = new Map<string, PolarType>();
  let constraints = emptyConstraintSet();

  if (!pattern) {
    return { bindings, constraints };
  }

  switch (pattern.type) {
    case 'Identifier':
      bindings.set(pattern.name, initType);
      break;

    case 'ArrayPattern': {
      for (let i = 0; i < pattern.elements.length; i++) {
        const elem = pattern.elements[i];
        if (elem === null || elem === undefined) continue;

        if (elem.type === 'RestElement') {
          const restType = array(ctx.fresh('rest'));
          const restResult = inferPatternBindings(ctx, elem.argument, restType);
          for (const [name, type] of restResult.bindings) {
            bindings.set(name, type);
          }
          constraints = mergeConstraintSets(constraints, restResult.constraints);
        } else {
          const elemType = ctx.fresh(`elem${i}`);
          const elemResult = inferPatternBindings(ctx, elem, elemType);
          for (const [name, type] of elemResult.bindings) {
            bindings.set(name, type);
          }
          constraints = mergeConstraintSets(constraints, elemResult.constraints);
        }
      }
      break;
    }

    case 'ObjectPattern': {
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          const restType = record({});
          const restResult = inferPatternBindings(ctx, prop.argument, restType);
          for (const [name, type] of restResult.bindings) {
            bindings.set(name, type);
          }
          constraints = mergeConstraintSets(constraints, restResult.constraints);
        } else {
          const key = getPatternPropertyKey(prop);
          if (key) {
            const propType = ctx.fresh(key);

            if (initType.kind !== 'var') {
              const expectedObj: RecordType = {
                kind: 'record',
                fields: new Map([[key, field(propType)]]),
              };
              constraints = addConstraint(
                constraints,
                flow(initType, expectedObj, nodeToSource(pattern))
              );
            }

            const valueResult = inferPatternBindings(ctx, prop.value, propType);
            for (const [name, type] of valueResult.bindings) {
              bindings.set(name, type);
            }
            constraints = mergeConstraintSets(constraints, valueResult.constraints);
          }
        }
      }
      break;
    }

    case 'AssignmentPattern': {
      const defaultResult = inferExpression(ctx, pattern.right);
      constraints = mergeConstraintSets(constraints, defaultResult.constraints);

      const unionType = union([initType, defaultResult.type]);
      const leftResult = inferPatternBindings(ctx, pattern.left, unionType);
      for (const [name, type] of leftResult.bindings) {
        bindings.set(name, type);
      }
      constraints = mergeConstraintSets(constraints, leftResult.constraints);
      break;
    }
  }

  return { bindings, constraints };
}

function getPatternPropertyKey(prop: any): string | null {
  if (prop.computed) return null;

  if (prop.key?.type === 'Identifier') {
    return prop.key.name;
  }
  if (prop.key?.type === 'StringLiteral') {
    return prop.key.value;
  }
  if (prop.key?.type === 'NumericLiteral') {
    return String(prop.key.value);
  }
  return null;
}

// ============================================================================
// Function Declaration
// ============================================================================

function inferFunctionDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  if (!stmt.id) {
    return emptyStatementResult();
  }

  const funcName = stmt.id.name;
  const retVar = ctx.fresh('ret');

  const fnCtx = ctx.functionContext({
    returnType: retVar,
    isAsync: stmt.async,
    isGenerator: stmt.generator,
  });

  const paramTypes: { name: string; type: PolarType; optional: boolean; rest: boolean }[] = [];
  let constraints = emptyConstraintSet();

  for (const p of stmt.params) {
    const paramInfo = inferFunctionParam(fnCtx, p);
    constraints = mergeConstraintSets(constraints, paramInfo.constraints);

    for (const binding of paramInfo.bindings) {
      fnCtx.bind(binding.name, binding.type);
      paramTypes.push({
        name: binding.name,
        type: binding.type,
        optional: binding.optional,
        rest: binding.rest,
      });
    }
  }

  const bodyResult = inferStatements(fnCtx, stmt.body.body);
  constraints = mergeConstraintSets(constraints, bodyResult.constraints);

  if (!bodyResult.diverges) {
    constraints = addConstraint(
      constraints,
      flow(undefined_, retVar, nodeToSource(stmt))
    );
  }

  let returnType: PolarType = retVar;
  if (stmt.async) {
    returnType = promise(retVar);
  }

  const funcType: FunctionType = {
    kind: 'function',
    params: paramTypes.map(p => param(p.name, p.type, { optional: p.optional, rest: p.rest })),
    returnType,
    isAsync: stmt.async,
    isGenerator: stmt.generator,
  };

  // Don't generalize function types during constraint collection.
  // Generalization should only happen after constraint solving to ensure
  // that all constraints between functions in the same scope are properly resolved.
  // Using monoScheme ensures that when nbody() calls energy(), they share
  // the same type variables and constraints propagate correctly.
  const funcScheme = monoScheme(funcType);

  return statementResult(
    constraints,
    false,
    new Map([[funcName, funcScheme]])
  );
}

interface ParamBinding {
  name: string;
  type: PolarType;
  optional: boolean;
  rest: boolean;
}

interface ParamResult {
  bindings: ParamBinding[];
  constraints: ConstraintSet;
}

function inferFunctionParam(ctx: InferenceContext, param: any): ParamResult {
  if (!param) {
    return { bindings: [], constraints: emptyConstraintSet() };
  }

  switch (param.type) {
    case 'Identifier':
      return {
        bindings: [{
          name: param.name,
          type: ctx.fresh(param.name),
          optional: false,
          rest: false,
        }],
        constraints: emptyConstraintSet(),
      };

    case 'AssignmentPattern': {
      const leftResult = inferFunctionParam(ctx, param.left);
      const defaultResult = inferExpression(ctx, param.right);

      let constraints = mergeConstraintSets(leftResult.constraints, defaultResult.constraints);

      for (const binding of leftResult.bindings) {
        constraints = addConstraint(
          constraints,
          flow(defaultResult.type, binding.type, nodeToSource(param))
        );
      }

      return {
        bindings: leftResult.bindings.map(b => ({ ...b, optional: true })),
        constraints,
      };
    }

    case 'RestElement': {
      const argResult = inferFunctionParam(ctx, param.argument);
      return {
        bindings: argResult.bindings.map(b => ({
          ...b,
          type: array(b.type),
          rest: true,
        })),
        constraints: argResult.constraints,
      };
    }

    case 'ArrayPattern': {
      const bindings: ParamBinding[] = [];
      let constraints = emptyConstraintSet();

      for (const elem of param.elements) {
        if (elem === null || elem === undefined) continue;
        const elemResult = inferFunctionParam(ctx, elem);
        bindings.push(...elemResult.bindings);
        constraints = mergeConstraintSets(constraints, elemResult.constraints);
      }

      return { bindings, constraints };
    }

    case 'ObjectPattern': {
      const bindings: ParamBinding[] = [];
      let constraints = emptyConstraintSet();

      for (const prop of param.properties) {
        if (prop.type === 'RestElement') {
          const restResult = inferFunctionParam(ctx, prop);
          bindings.push(...restResult.bindings);
          constraints = mergeConstraintSets(constraints, restResult.constraints);
        } else {
          const propResult = inferFunctionParam(ctx, prop.value);
          bindings.push(...propResult.bindings);
          constraints = mergeConstraintSets(constraints, propResult.constraints);
        }
      }

      return { bindings, constraints };
    }

    default:
      return { bindings: [], constraints: emptyConstraintSet() };
  }
}

// ============================================================================
// Class Declaration
// ============================================================================

function inferClassDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  if (!stmt.id) {
    return emptyStatementResult();
  }

  const className = stmt.id.name;
  let constraints = emptyConstraintSet();

  let superType: PolarType | null = null;
  if (stmt.superClass) {
    const superResult = inferExpression(ctx, stmt.superClass);
    constraints = mergeConstraintSets(constraints, superResult.constraints);
    superType = superResult.type;
  }

  const instanceFields = new Map<string, { type: PolarType; optional: boolean; readonly: boolean }>();
  const staticFields = new Map<string, { type: PolarType; optional: boolean; readonly: boolean }>();
  let constructorType: FunctionType | null = null;

  const instanceType = ctx.fresh(`${className}Instance`);
  const classCtx = ctx.functionContext({
    returnType: undefined_,
    thisType: instanceType,
  });

  for (const member of stmt.body.body) {
    const memberResult = inferClassMember(classCtx, member, instanceFields, staticFields);
    constraints = mergeConstraintSets(constraints, memberResult.constraints);

    if (memberResult.constructorType) {
      constructorType = memberResult.constructorType;
    }
  }

  // Note: In MLsub lattice-based approach, inheritance is handled through
  // intersection types rather than row variables
  const classType: RecordType = {
    kind: 'record',
    fields: new Map(
      Array.from(instanceFields.entries()).map(([name, f]) => [name, field(f.type, { optional: f.optional, readonly: f.readonly })])
    ),
  };

  constraints = addConstraint(
    constraints,
    flow(classType, instanceType, nodeToSource(stmt))
  );

  const ctorType = constructorType ?? func([], instanceType);
  const classScheme = ctx.generalize(ctorType);

  return statementResult(
    constraints,
    false,
    new Map([[className, classScheme]])
  );
}

interface ClassMemberResult {
  constraints: ConstraintSet;
  constructorType: FunctionType | null;
}

function inferClassMember(
  ctx: InferenceContext,
  member: any,
  instanceFields: Map<string, { type: PolarType; optional: boolean; readonly: boolean }>,
  staticFields: Map<string, { type: PolarType; optional: boolean; readonly: boolean }>
): ClassMemberResult {
  let constraints = emptyConstraintSet();
  let constructorType: FunctionType | null = null;

  switch (member.type) {
    case 'ClassMethod': {
      const key = getMethodKey(member);
      const isStatic = member.static;

      if (member.kind === 'constructor') {
        const ctorResult = inferMethod(ctx, member);
        constraints = mergeConstraintSets(constraints, ctorResult.constraints);
        constructorType = ctorResult.type as FunctionType;
      } else if (key) {
        const methodResult = inferMethod(ctx, member);
        constraints = mergeConstraintSets(constraints, methodResult.constraints);

        const targetFields = isStatic ? staticFields : instanceFields;
        targetFields.set(key, { type: methodResult.type, optional: false, readonly: true });
      }
      break;
    }

    case 'ClassProperty': {
      const key = getPropertyName(member);
      const isStatic = member.static;

      if (key) {
        let propType: PolarType = ctx.fresh(key);

        if (member.value) {
          const valueResult = inferExpression(ctx, member.value);
          constraints = mergeConstraintSets(constraints, valueResult.constraints);
          propType = valueResult.type;
        }

        const targetFields = isStatic ? staticFields : instanceFields;
        targetFields.set(key, {
          type: propType,
          optional: member.optional ?? false,
          readonly: member.readonly ?? false,
        });
      }
      break;
    }

    case 'ClassPrivateMethod':
    case 'ClassPrivateProperty':
      break;

    case 'StaticBlock': {
      const blockResult = inferStatements(ctx.child(), member.body);
      constraints = mergeConstraintSets(constraints, blockResult.constraints);
      break;
    }
  }

  return { constraints, constructorType };
}

function getMethodKey(method: any): string | null {
  if (method.computed) return null;

  if (method.key?.type === 'Identifier') {
    return method.key.name;
  }
  if (method.key?.type === 'StringLiteral') {
    return method.key.value;
  }
  return null;
}

function getPropertyName(prop: any): string | null {
  if (prop.computed) return null;

  if (prop.key?.type === 'Identifier') {
    return prop.key.name;
  }
  if (prop.key?.type === 'StringLiteral') {
    return prop.key.value;
  }
  return null;
}

function inferMethod(ctx: InferenceContext, method: any): InferResult {
  const retVar = ctx.fresh('ret');

  const fnCtx = ctx.functionContext({
    returnType: retVar,
    isAsync: method.async,
    isGenerator: method.generator,
    thisType: ctx.getThisType() ?? undefined,
  });

  const paramTypes: { name: string; type: PolarType; optional: boolean; rest: boolean }[] = [];
  let constraints = emptyConstraintSet();

  for (const p of method.params) {
    const paramInfo = inferFunctionParam(fnCtx, p);
    constraints = mergeConstraintSets(constraints, paramInfo.constraints);

    for (const binding of paramInfo.bindings) {
      fnCtx.bind(binding.name, binding.type);
      paramTypes.push({
        name: binding.name,
        type: binding.type,
        optional: binding.optional,
        rest: binding.rest,
      });
    }
  }

  const bodyResult = inferStatements(fnCtx, method.body.body);
  constraints = mergeConstraintSets(constraints, bodyResult.constraints);

  if (!bodyResult.diverges && method.kind !== 'constructor') {
    constraints = addConstraint(
      constraints,
      flow(undefined_, retVar, nodeToSource(method))
    );
  }

  let returnType: PolarType = retVar;
  if (method.async) {
    returnType = promise(retVar);
  }

  const funcType: FunctionType = {
    kind: 'function',
    params: paramTypes.map(p => param(p.name, p.type, { optional: p.optional, rest: p.rest })),
    returnType,
    isAsync: method.async,
    isGenerator: method.generator,
  };

  return { type: funcType, constraints };
}

// ============================================================================
// Control Flow Statements
// ============================================================================

function inferReturnStatement(ctx: InferenceContext, stmt: any): StatementResult {
  let constraints = emptyConstraintSet();
  let returnType: PolarType = undefined_;

  if (stmt.argument) {
    const argResult = inferExpression(ctx, stmt.argument);
    constraints = argResult.constraints;
    returnType = argResult.type;
  }

  const expectedReturn = ctx.getReturnType();
  if (expectedReturn) {
    constraints = addConstraint(
      constraints,
      flow(returnType, expectedReturn, nodeToSource(stmt))
    );
  }

  return statementResult(constraints, true);
}

function inferIfStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const testResult = inferExpression(ctx, stmt.test);
  let constraints = testResult.constraints;

  const consequentResult = inferStatement(ctx.child(), stmt.consequent);
  constraints = mergeConstraintSets(constraints, consequentResult.constraints);

  let diverges = consequentResult.diverges;

  if (stmt.alternate) {
    const alternateResult = inferStatement(ctx.child(), stmt.alternate);
    constraints = mergeConstraintSets(constraints, alternateResult.constraints);
    diverges = consequentResult.diverges && alternateResult.diverges;
  } else {
    diverges = false;
  }

  return statementResult(constraints, diverges);
}

function inferSwitchStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const discResult = inferExpression(ctx, stmt.discriminant);
  let constraints = discResult.constraints;
  let allDiverge = true;
  let hasDefault = false;

  for (const c of stmt.cases) {
    if (c.test === null) {
      hasDefault = true;
    } else {
      const testResult = inferExpression(ctx, c.test);
      constraints = mergeConstraintSets(constraints, testResult.constraints);
    }

    const caseResult = inferStatements(ctx.child(), c.consequent);
    constraints = mergeConstraintSets(constraints, caseResult.constraints);

    if (!caseResult.diverges) {
      allDiverge = false;
    }
  }

  return statementResult(constraints, allDiverge && hasDefault);
}

// ============================================================================
// Loop Statements
// ============================================================================

function inferWhileStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const testResult = inferExpression(ctx, stmt.test);
  const bodyResult = inferStatement(ctx.child(), stmt.body);

  return statementResult(
    mergeConstraintSets(testResult.constraints, bodyResult.constraints),
    false
  );
}

function inferDoWhileStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const bodyResult = inferStatement(ctx.child(), stmt.body);
  const testResult = inferExpression(ctx, stmt.test);

  return statementResult(
    mergeConstraintSets(bodyResult.constraints, testResult.constraints),
    false
  );
}

function inferForStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const loopCtx = ctx.child();
  let constraints = emptyConstraintSet();

  if (stmt.init) {
    if (stmt.init.type === 'VariableDeclaration') {
      const initResult = inferVariableDeclaration(loopCtx, stmt.init);
      constraints = mergeConstraintSets(constraints, initResult.constraints);
    } else {
      const initResult = inferExpression(loopCtx, stmt.init);
      constraints = mergeConstraintSets(constraints, initResult.constraints);
    }
  }

  if (stmt.test) {
    const testResult = inferExpression(loopCtx, stmt.test);
    constraints = mergeConstraintSets(constraints, testResult.constraints);
  }

  const bodyResult = inferStatement(loopCtx, stmt.body);
  constraints = mergeConstraintSets(constraints, bodyResult.constraints);

  if (stmt.update) {
    const updateResult = inferExpression(loopCtx, stmt.update);
    constraints = mergeConstraintSets(constraints, updateResult.constraints);
  }

  return statementResult(constraints, false);
}

function inferForInStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const loopCtx = ctx.child();
  let constraints = emptyConstraintSet();

  const rightResult = inferExpression(ctx, stmt.right);
  constraints = mergeConstraintSets(constraints, rightResult.constraints);

  if (stmt.left.type === 'VariableDeclaration') {
    const leftResult = inferVariableDeclaration(loopCtx, stmt.left);
    constraints = mergeConstraintSets(constraints, leftResult.constraints);
  } else {
    const leftResult = inferExpression(loopCtx, stmt.left);
    constraints = mergeConstraintSets(constraints, leftResult.constraints);
  }

  const bodyResult = inferStatement(loopCtx, stmt.body);
  constraints = mergeConstraintSets(constraints, bodyResult.constraints);

  return statementResult(constraints, false);
}

function inferForOfStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const loopCtx = ctx.child();
  let constraints = emptyConstraintSet();

  const rightResult = inferExpression(ctx, stmt.right);
  constraints = mergeConstraintSets(constraints, rightResult.constraints);

  if (stmt.left.type === 'VariableDeclaration') {
    const leftResult = inferVariableDeclaration(loopCtx, stmt.left);
    constraints = mergeConstraintSets(constraints, leftResult.constraints);
  } else {
    const leftResult = inferExpression(loopCtx, stmt.left);
    constraints = mergeConstraintSets(constraints, leftResult.constraints);
  }

  const bodyResult = inferStatement(loopCtx, stmt.body);
  constraints = mergeConstraintSets(constraints, bodyResult.constraints);

  return statementResult(constraints, false);
}

// ============================================================================
// Try/Catch Statements
// ============================================================================

function inferTryStatement(ctx: InferenceContext, stmt: any): StatementResult {
  let constraints = emptyConstraintSet();

  const tryResult = inferStatements(ctx.child(), stmt.block.body);
  constraints = mergeConstraintSets(constraints, tryResult.constraints);

  if (stmt.handler) {
    const catchCtx = ctx.child();

    if (stmt.handler.param?.type === 'Identifier') {
      catchCtx.bind(stmt.handler.param.name, any);
    }

    const catchResult = inferStatements(catchCtx, stmt.handler.body.body);
    constraints = mergeConstraintSets(constraints, catchResult.constraints);
  }

  if (stmt.finalizer) {
    const finallyResult = inferStatements(ctx.child(), stmt.finalizer.body);
    constraints = mergeConstraintSets(constraints, finallyResult.constraints);
  }

  return statementResult(constraints, false);
}

function inferThrowStatement(ctx: InferenceContext, stmt: any): StatementResult {
  const argResult = inferExpression(ctx, stmt.argument);
  return statementResult(argResult.constraints, true);
}

// ============================================================================
// Import/Export Declarations
// ============================================================================

function inferImportDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  const bindings = new Map<string, PolyScheme>();

  for (const spec of stmt.specifiers) {
    const localName = spec.local.name;
    bindings.set(localName, monoScheme(any));
    ctx.bind(localName, any);
  }

  return statementResult(emptyConstraintSet(), false, bindings);
}

function inferExportNamedDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  if (stmt.declaration) {
    return inferStatement(ctx, stmt.declaration);
  }
  return emptyStatementResult();
}

function inferExportDefaultDeclaration(ctx: InferenceContext, stmt: any): StatementResult {
  if (stmt.declaration?.type === 'FunctionDeclaration' ||
      stmt.declaration?.type === 'ClassDeclaration') {
    return inferStatement(ctx, stmt.declaration);
  }

  const exprResult = inferExpression(ctx, stmt.declaration);
  return statementResult(exprResult.constraints);
}
