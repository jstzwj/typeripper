/**
 * Transfer Functions
 * Functions that compute the output state for each statement type
 */

import * as t from '@babel/types';
import type { Type } from '../../types/types.js';
import type { TypeState, TypeEnvironment, Binding } from '../../types/analysis.js';
import type { IterationContext } from './context.js';
import { updateBinding, createEnvironment, lookupBinding, createBinding } from '../../types/analysis.js';
import { Types } from '../../utils/type-factory.js';
import { isUnionType, isNeverType } from '../../types/types.js';
import { inferExpression } from './expressions.js';

// ============================================================================
// Main Transfer Function
// ============================================================================

/**
 * Apply transfer function to a statement
 * Returns the output state after executing the statement
 */
export function transferStatement(
  stmt: t.Statement,
  state: TypeState,
  context: IterationContext
): TypeState {
  if (!state.reachable) {
    return state; // Stay unreachable
  }

  switch (stmt.type) {
    case 'VariableDeclaration':
      return transferVariableDeclaration(stmt, state, context);

    case 'FunctionDeclaration':
      return transferFunctionDeclaration(stmt, state, context);

    case 'ClassDeclaration':
      return transferClassDeclaration(stmt, state, context);

    case 'ExpressionStatement':
      return transferExpressionStatement(stmt, state, context);

    case 'ReturnStatement':
      return transferReturnStatement(stmt, state, context);

    case 'ThrowStatement':
      return transferThrowStatement(stmt, state, context);

    case 'BlockStatement':
      return transferBlockStatement(stmt, state, context);

    case 'IfStatement':
      // Handled by CFG structure, but we still process the condition
      return transferIfStatement(stmt, state, context);

    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
      // Loop headers - process condition/init
      return transferLoopStatement(stmt, state, context);

    case 'TryStatement':
      return transferTryStatement(stmt, state, context);

    case 'SwitchStatement':
      return transferSwitchStatement(stmt, state, context);

    case 'BreakStatement':
    case 'ContinueStatement':
      // Handled by CFG
      return state;

    case 'LabeledStatement':
      return transferLabeledStatement(stmt, state, context);

    case 'EmptyStatement':
    case 'DebuggerStatement':
      return state;

    case 'WithStatement':
      // Deprecated - just process body
      return state;

    case 'ImportDeclaration':
      return transferImportDeclaration(stmt, state, context);

    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
    case 'ExportAllDeclaration':
      return transferExportDeclaration(stmt, state, context);

    default:
      return state;
  }
}

// ============================================================================
// Variable Declaration
// ============================================================================

function transferVariableDeclaration(
  stmt: t.VariableDeclaration,
  state: TypeState,
  context: IterationContext
): TypeState {
  let newState = state;
  const kind = stmt.kind; // 'var' | 'let' | 'const' | 'using' | 'await using'

  // Skip 'using' and 'await using' declarations
  if (kind === 'using' || kind === 'await using') {
    return state;
  }

  for (const decl of stmt.declarations) {
    newState = processVariableDeclarator(decl, kind as 'var' | 'let' | 'const', newState, context);
  }

  return newState;
}

function processVariableDeclarator(
  decl: t.VariableDeclarator,
  kind: 'var' | 'let' | 'const',
  state: TypeState,
  context: IterationContext
): TypeState {
  // Get the declared names
  const names = getDeclaredNames(decl.id);

  // Infer the initializer type
  let initType: Type;
  if (decl.init) {
    initType = inferExpression(decl.init, state, context);
  } else {
    initType = Types.undefined();
  }

  // Widen if modified in loop
  if (context.modifiedInLoops.has(names[0] ?? '')) {
    initType = widenType(initType, context.widenThreshold);
  }

  // Handle each name in the pattern
  for (const name of names) {
    // Check if already bound (for var hoisting)
    const existing = lookupBinding(state.env, name);

    let finalType = initType;

    if (existing && kind === 'var') {
      // Join with existing type for re-declarations
      finalType = joinTypes(existing.type, initType);
    }

    // Create binding
    const binding = createBinding(
      decl.id,
      finalType,
      kind === 'var' ? 'var' : kind === 'let' ? 'let' : 'const',
      kind !== 'const',
      state.env.scope,
      decl.init !== undefined
    );

    // Update environment
    state = {
      ...state,
      env: {
        ...state.env,
        bindings: new Map([...state.env.bindings, [name, binding]]),
      },
    };

    // Record annotation
    context.annotations.push({
      node: decl.id,
      name,
      type: finalType,
      kind: 'variable',
      scope: state.env,
    });
  }

  return state;
}

function getDeclaredNames(node: t.Node | null): string[] {
  if (!node) return [];

  if (t.isIdentifier(node)) {
    return [node.name];
  }

  if (t.isObjectPattern(node)) {
    const names: string[] = [];
    for (const prop of node.properties) {
      if (t.isRestElement(prop)) {
        names.push(...getDeclaredNames(prop.argument));
      } else if (t.isObjectProperty(prop)) {
        names.push(...getDeclaredNames(prop.value));
      }
    }
    return names;
  }

  if (t.isArrayPattern(node)) {
    const names: string[] = [];
    for (const elem of node.elements) {
      if (elem) {
        names.push(...getDeclaredNames(elem));
      }
    }
    return names;
  }

  if (t.isRestElement(node)) {
    return getDeclaredNames(node.argument);
  }

  if (t.isAssignmentPattern(node)) {
    return getDeclaredNames(node.left);
  }

  return [];
}

// ============================================================================
// Function Declaration
// ============================================================================

function transferFunctionDeclaration(
  stmt: t.FunctionDeclaration,
  state: TypeState,
  context: IterationContext
): TypeState {
  if (!stmt.id) return state;

  // Infer function type
  const functionType = inferFunctionType(stmt, state, context);

  // Create binding
  const binding = createBinding(
    stmt.id,
    functionType,
    'function',
    false,
    state.env.scope,
    true
  );

  // Update environment
  const newState = {
    ...state,
    env: {
      ...state.env,
      bindings: new Map([...state.env.bindings, [stmt.id.name, binding]]),
    },
  };

  // Record annotation
  context.annotations.push({
    node: stmt.id,
    name: stmt.id.name,
    type: functionType,
    kind: 'function',
    scope: state.env,
  });

  return newState;
}

function inferFunctionType(
  fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
  state: TypeState,
  context: IterationContext
): Type {
  // Infer parameter types
  const params = fn.params.map((param, i) => {
    let name = '';
    let optional = false;
    let rest = false;

    if (t.isIdentifier(param)) {
      name = param.name;
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      name = param.argument.name;
      rest = true;
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      name = param.left.name;
      optional = true;
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      name = `param_${i}`;
    }

    // Default to unknown for parameters
    const paramType = Types.unknown();

    return {
      name,
      type: paramType,
      optional,
      rest,
    };
  });

  // Infer return type from body
  const returnType = inferReturnType(fn.body, state, context);

  // Analyze captures
  const captures = analyzeCaptures(fn, state);

  return Types.function({
    params,
    returnType,
    isAsync: fn.async,
    isGenerator: fn.generator,
    captures,
    thisType: inferThisType(fn, state),
  });
}

function inferReturnType(
  body: t.BlockStatement | t.Expression,
  state: TypeState,
  context: IterationContext
): Type {
  // Collect return statements
  const returnTypes: Type[] = [];

  const traverse = (node: t.Node) => {
    if (t.isReturnStatement(node)) {
      if (node.argument) {
        returnTypes.push(inferExpression(node.argument, state, context));
      } else {
        returnTypes.push(Types.undefined());
      }
    }

    if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) {
      return; // Don't traverse into nested functions
    }

    'body' in node && Array.isArray(node.body) && node.body.forEach(traverse);
    if ('consequent' in node) traverse(node.consequent as t.Node);
    if ('alternate' in node && node.alternate) traverse(node.alternate as t.Node);
    if ('test' in node) traverse(node.test as t.Node);
    if ('expression' in node && node.expression) traverse(node.expression as t.Node);
  };

  traverse(body);

  if (returnTypes.length === 0) {
    return Types.undefined();
  }

  if (returnTypes.length === 1) {
    return returnTypes[0]!;
  }

  return Types.union(...returnTypes);
}

function analyzeCaptures(
  fn: t.Function,
  state: TypeState
): Map<string, Type> {
  const captures = new Map<string, Type>();
  const paramNames = new Set<string>();

  for (const param of fn.params) {
    if (t.isIdentifier(param)) {
      paramNames.add(param.name);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      paramNames.add(param.argument.name);
    }
  }

  const findCaptures = (node: t.Node) => {
    if (t.isIdentifier(node) && !paramNames.has(node.name)) {
      const binding = lookupBinding(state.env, node.name);
      if (binding && binding.scope !== 'function') {
        if (!captures.has(node.name)) {
          captures.set(node.name, binding.type);
        }
      }
    }

    if (t.isFunction(node)) {
      return; // Don't traverse into nested functions
    }

    if ('body' in node && Array.isArray(node.body)) {
      node.body.forEach(findCaptures);
    }
  };

  findCaptures(fn);
  return captures;
}

function inferThisType(
  fn: t.Function,
  state: TypeState
): Type {
  // For now, default to object
  // A full implementation would analyze call sites
  return Types.object({});
}

// ============================================================================
// Class Declaration
// ============================================================================

function transferClassDeclaration(
  stmt: t.ClassDeclaration,
  state: TypeState,
  context: IterationContext
): TypeState {
  if (!stmt.id) return state;

  // Infer class type
  const classType = inferClassType(stmt, state, context);

  // Create binding
  const binding = createBinding(
    stmt.id,
    classType,
    'class',
    false,
    state.env.scope,
    true
  );

  // Update environment
  const newState = {
    ...state,
    env: {
      ...state.env,
      bindings: new Map([...state.env.bindings, [stmt.id.name, binding]]),
    },
  };

  // Record annotation
  context.annotations.push({
    node: stmt.id,
    name: stmt.id.name,
    type: classType,
    kind: 'class',
    scope: state.env,
  });

  return newState;
}

function inferClassType(
  stmt: t.ClassDeclaration | t.ClassExpression,
  state: TypeState,
  context: IterationContext
): Type {
  const className = stmt.id?.name ?? '(anonymous)';

  // Infer instance type
  const instanceProperties = inferInstanceProperties(stmt, state, context);
  const instanceType = Types.object({
    properties: Object.fromEntries(instanceProperties),
    prototype: Types.object({}),
  });

  // Infer constructor type
  const constructorType = Types.function({
    params: [],
    returnType: Types.object({ properties: Object.fromEntries(instanceProperties) }),
  });

  // Infer static properties
  const staticProperties = inferStaticProperties(stmt, state, context);

  return Types.class({
    name: className,
    constructor: constructorType,
    instanceType,
    staticProperties: Object.fromEntries(staticProperties),
  });
}

function inferInstanceProperties(
  stmt: t.ClassDeclaration | t.ClassExpression,
  state: TypeState,
  context: IterationContext
): Map<string, any> {
  const properties = new Map<string, any>();

  for (const elem of stmt.body.body) {
    if (t.isClassProperty(elem) || t.isClassPrivateProperty(elem)) {
      const key = elem.key;
      let name = '';

      if (t.isIdentifier(key)) {
        name = key.name;
      } else if (t.isStringLiteral(key)) {
        name = key.value;
      } else if (t.isPrivateName(key)) {
        name = `#${key.id.name}`;
      }

      if (name) {
        const valueType = elem.value
          ? inferExpression(elem.value, state, context)
          : Types.undefined();

        properties.set(name, Types.property(valueType, !elem.readonly));
      }
    } else if (t.isClassMethod(elem)) {
      const key = elem.key;
      let name = '';

      if (t.isIdentifier(key)) {
        name = key.name;
      } else if (t.isStringLiteral(key)) {
        name = key.value;
      } else if ((key as any).type === 'PrivateName') {
        name = `#${(key as any).id.name}`;
      }

      if (name) {
        const methodType = Types.function({
          params: [],
          returnType: Types.unknown(),
          isAsync: elem.async,
          isGenerator: elem.generator,
        });
        properties.set(name, Types.property(methodType));
      }
    }
  }

  return properties;
}

function inferStaticProperties(
  stmt: t.ClassDeclaration | t.ClassExpression,
  state: TypeState,
  context: IterationContext
): Map<string, any> {
  const properties = new Map<string, any>();

  for (const elem of stmt.body.body) {
    if (t.isStaticBlock(elem)) {
      // Static blocks - skip for now
      continue;
    }

    if ((t.isClassProperty(elem) || t.isClassMethod(elem)) && elem.static) {
      const key = elem.key;
      let name = '';

      if (t.isIdentifier(key)) {
        name = key.name;
      } else if (t.isStringLiteral(key)) {
        name = key.value;
      }

      if (name) {
        const valueType = t.isClassProperty(elem) && elem.value
          ? inferExpression(elem.value, state, context)
          : Types.function({ params: [], returnType: Types.unknown() });

        properties.set(name, Types.property(valueType));
      }
    }
  }

  return properties;
}

// ============================================================================
// Expression Statement
// ============================================================================

function transferExpressionStatement(
  stmt: t.ExpressionStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Infer expression type (side effects)
  inferExpression(stmt.expression, state, context);
  return state;
}

// ============================================================================
// Return Statement
// ============================================================================

function transferReturnStatement(
  stmt: t.ReturnStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  const returnType = stmt.argument
    ? inferExpression(stmt.argument, state, context)
    : Types.undefined();

  return {
    ...state,
    returnValue: state.returnValue
      ? joinTypes(state.returnValue, returnType)
      : returnType,
  };
}

// ============================================================================
// Throw Statement
// ============================================================================

function transferThrowStatement(
  stmt: t.ThrowStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Throw makes the code unreachable
  inferExpression(stmt.argument, state, context);
  return {
    ...state,
    reachable: false,
  };
}

// ============================================================================
// Block Statement
// ============================================================================

function transferBlockStatement(
  stmt: t.BlockStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  let newState = state;

  for (const bodyStmt of stmt.body) {
    newState = transferStatement(bodyStmt, newState, context);
    if (!newState.reachable) break;
  }

  return newState;
}

// ============================================================================
// If Statement
// ============================================================================

function transferIfStatement(
  stmt: t.IfStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Infer condition type
  inferExpression(stmt.test, state, context);
  return state;
}

// ============================================================================
// Loop Statements
// ============================================================================

function transferLoopStatement(
  stmt:
    | t.WhileStatement
    | t.DoWhileStatement
    | t.ForStatement
    | t.ForInStatement
    | t.ForOfStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Process init/test/update depending on loop type
  if (t.isForStatement(stmt)) {
    if (stmt.init) {
      if (t.isVariableDeclaration(stmt.init)) {
        return transferVariableDeclaration(stmt.init, state, context);
      } else {
        inferExpression(stmt.init, state, context);
      }
    }
    if (stmt.test) {
      inferExpression(stmt.test, state, context);
    }
    if (stmt.update) {
      inferExpression(stmt.update, state, context);
    }
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    inferExpression(stmt.test, state, context);
  } else if (t.isForInStatement(stmt) || t.isForOfStatement(stmt)) {
    inferExpression(stmt.right, state, context);
  }

  return state;
}

// ============================================================================
// Try Statement
// ============================================================================

function transferTryStatement(
  stmt: t.TryStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  let newState = state;

  // Process try block
  for (const bodyStmt of stmt.block.body) {
    newState = transferStatement(bodyStmt, newState, context);
  }

  // Process catch block
  if (stmt.handler) {
    // Add error parameter binding
    if (stmt.handler.param && t.isIdentifier(stmt.handler.param)) {
      const errorBinding = createBinding(
        stmt.handler.param,
        Types.union(Types.object({}), Types.string()),
        'let',
        true,
        state.env.scope,
        true
      );

      newState = {
        ...newState,
        env: {
          ...newState.env,
          bindings: new Map([...newState.env.bindings, [stmt.handler.param.name, errorBinding]]),
        },
      };
    }

    for (const bodyStmt of stmt.handler.body.body) {
      newState = transferStatement(bodyStmt, newState, context);
    }
  }

  // Process finally block
  if (stmt.finalizer) {
    for (const bodyStmt of stmt.finalizer.body) {
      newState = transferStatement(bodyStmt, newState, context);
    }
  }

  return newState;
}

// ============================================================================
// Switch Statement
// ============================================================================

function transferSwitchStatement(
  stmt: t.SwitchStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Infer discriminant type
  inferExpression(stmt.discriminant, state, context);
  return state;
}

// ============================================================================
// Labeled Statement
// ============================================================================

function transferLabeledStatement(
  stmt: t.LabeledStatement,
  state: TypeState,
  context: IterationContext
): TypeState {
  return transferStatement(stmt.body, state, context);
}

// ============================================================================
// Import/Export Statements
// ============================================================================

function transferImportDeclaration(
  stmt: t.ImportDeclaration,
  state: TypeState,
  context: IterationContext
): TypeState {
  // For now, skip imports
  // A full implementation would resolve imported modules
  return state;
}

function transferExportDeclaration(
  stmt:
    | t.ExportNamedDeclaration
    | t.ExportDefaultDeclaration
    | t.ExportAllDeclaration,
  state: TypeState,
  context: IterationContext
): TypeState {
  // Process the declaration
  if (t.isExportNamedDeclaration(stmt) && stmt.declaration) {
    if (t.isStatement(stmt.declaration)) {
      return transferStatement(stmt.declaration, state, context);
    }
  }

  if (t.isExportDefaultDeclaration(stmt)) {
    if (t.isStatement(stmt.declaration)) {
      return transferStatement(stmt.declaration, state, context);
    }
  }

  return state;
}

// ============================================================================
// Utilities
// ============================================================================

function joinTypes(t1: Type, t2: Type): Type {
  if (t1.id === t2.id) return t1;

  if (isNeverType(t1)) return t2;
  if (isNeverType(t2)) return t1;

  if (isUnionType(t1) && isUnionType(t2)) {
    return Types.union(...t1.members, ...t2.members);
  }

  if (isUnionType(t1)) {
    return Types.union(...t1.members, t2);
  }

  if (isUnionType(t2)) {
    return Types.union(t1, ...t2.members);
  }

  return Types.union(t1, t2);
}

function widenType(type: Type, threshold: number): Type {
  if (isUnionType(type) && type.members.length > threshold) {
    // Widen large unions to primitive types
    const primitives = new Map<string, Type>();
    const others: Type[] = [];

    for (const m of type.members) {
      if (m.kind === 'boolean' || m.kind === 'number' || m.kind === 'string' || m.kind === 'bigint') {
        primitives.set(m.kind, Types[m.kind === 'boolean' ? 'boolean' : m.kind === 'number' ? 'number' : m.kind === 'string' ? 'string' : 'bigint']());
      } else {
        others.push(m);
      }
    }

    return Types.union(...primitives.values(), ...others);
  }

  return type;
}

// Re-export types
export type { Type } from '../../types/types.js';
