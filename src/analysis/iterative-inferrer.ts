/**
 * Iterative Type Inferrer - CFG-based flow-sensitive type inference
 *
 * This module implements iterative dataflow analysis for type inference.
 * It uses the CFG to perform fixed-point iteration, handling:
 * - Forward references
 * - Loop-induced type widening
 * - Mutually recursive functions
 * - Branch-based type narrowing
 */

import * as t from '@babel/types';
import type {
  Type,
  TypeEnvironment,
  Binding,
  ScopeKind,
  CFG,
  BasicBlock,
  NodeId,
  EdgeCondition,
} from '../types/index.js';
import type { TypeAnnotation, TypeAnnotationResult, AnnotationKind } from '../types/annotation.js';
import type { TypeState, AnalysisResult } from '../types/analysis.js';
import { Types } from '../utils/type-factory.js';
import { formatType } from '../output/formatter.js';
import { buildCFG } from '../cfg/builder.js';
import { canBeFalsy, canBeTruthy, narrowByTypeof, removeNullable } from '../utils/type-utils.js';

/**
 * Maximum iterations for fixed-point computation
 */
const MAX_ITERATIONS = 100;

/**
 * Analysis context for iterative inference
 */
interface IterativeContext {
  /** CFG for the current function/program */
  cfg: CFG;
  /** Type state at entry of each block */
  blockEntryStates: Map<NodeId, TypeState>;
  /** Type state at exit of each block */
  blockExitStates: Map<NodeId, TypeState>;
  /** Collected annotations */
  annotations: TypeAnnotation[];
  /** Collected errors */
  errors: Array<{ message: string; line: number; column: number; nodeType?: string }>;
  /** Source code */
  source: string;
  /** Filename */
  filename: string;
  /** Global environment (for builtins) */
  globalEnv: TypeEnvironment;
  /** Hoisted declarations (collected in first pass) */
  hoistedDeclarations: Map<string, HoistedDeclaration>;
}

/**
 * Hoisted declaration info (for forward references)
 */
interface HoistedDeclaration {
  name: string;
  kind: 'var' | 'function' | 'class';
  node: t.Node;
  /** Initial type (undefined for var, function type for function, etc.) */
  initialType: Type;
}

/**
 * Create an empty type environment
 */
function createEnv(parent: TypeEnvironment | null, kind: ScopeKind): TypeEnvironment {
  return {
    bindings: new Map(),
    parent,
    scopeKind: kind,
  };
}

/**
 * Create initial type state
 */
function createInitialState(env: TypeEnvironment): TypeState {
  return {
    env,
    expressionTypes: new Map(),
    reachable: true,
  };
}

/**
 * Create unreachable state
 */
function createUnreachableState(env: TypeEnvironment): TypeState {
  return {
    env,
    expressionTypes: new Map(),
    reachable: false,
  };
}

/**
 * Lookup a binding in the environment chain
 */
function lookupBinding(env: TypeEnvironment, name: string): Binding | undefined {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (env.parent) return lookupBinding(env.parent, name);
  return undefined;
}

/**
 * Update a binding in the environment (returns new env)
 */
function updateBinding(
  env: TypeEnvironment,
  name: string,
  type: Type,
  kind: Binding['kind'],
  node: t.Node
): TypeEnvironment {
  const newBindings = new Map(env.bindings);
  const existing = lookupBinding(env, name);
  newBindings.set(name, {
    name,
    type,
    declarationNode: existing?.declarationNode ?? node,
    kind: existing?.kind ?? kind,
    definitelyAssigned: true,
    possiblyMutated: existing?.possiblyMutated ?? false,
  });
  return {
    ...env,
    bindings: newBindings,
  };
}

/**
 * Join two type environments (for merge points in CFG)
 * Creates a union of types for each binding
 */
function joinEnvironments(env1: TypeEnvironment, env2: TypeEnvironment): TypeEnvironment {
  const newBindings = new Map<string, Binding>();

  // Collect all binding names from both environments
  const allNames = new Set<string>();
  collectBindingNames(env1, allNames);
  collectBindingNames(env2, allNames);

  for (const name of allNames) {
    const binding1 = lookupBinding(env1, name);
    const binding2 = lookupBinding(env2, name);

    if (binding1 && binding2) {
      // Both branches have this binding - join types
      const joinedType = joinTypes(binding1.type, binding2.type);
      newBindings.set(name, {
        name,
        type: joinedType,
        declarationNode: binding1.declarationNode,
        kind: binding1.kind,
        definitelyAssigned: binding1.definitelyAssigned && binding2.definitelyAssigned,
        possiblyMutated: binding1.possiblyMutated || binding2.possiblyMutated,
      });
    } else if (binding1) {
      // Only in env1 - might be undefined in env2
      newBindings.set(name, {
        ...binding1,
        definitelyAssigned: false,
      });
    } else if (binding2) {
      // Only in env2 - might be undefined in env1
      newBindings.set(name, {
        ...binding2,
        definitelyAssigned: false,
      });
    }
  }

  return {
    bindings: newBindings,
    parent: env1.parent, // Assume same parent
    scopeKind: env1.scopeKind,
  };
}

/**
 * Collect all binding names from an environment chain
 */
function collectBindingNames(env: TypeEnvironment | null, names: Set<string>): void {
  if (!env) return;
  for (const name of env.bindings.keys()) {
    names.add(name);
  }
  collectBindingNames(env.parent, names);
}

/**
 * Join two types (create union)
 */
function joinTypes(t1: Type, t2: Type): Type {
  // Same type - no change
  if (t1.id === t2.id) return t1;

  // If either is unreachable (never), return the other
  if (t1.kind === 'never') return t2;
  if (t2.kind === 'never') return t1;

  // Create union
  return Types.union([t1, t2]);
}

/**
 * Join multiple type states (for merge points with multiple predecessors)
 */
function joinStates(states: TypeState[]): TypeState {
  const reachableStates = states.filter((s) => s.reachable);

  if (reachableStates.length === 0) {
    // All predecessors are unreachable
    return createUnreachableState(states[0]?.env ?? createEnv(null, 'module'));
  }

  if (reachableStates.length === 1) {
    return reachableStates[0]!;
  }

  // Join all environments
  let joinedEnv = reachableStates[0]!.env;
  for (let i = 1; i < reachableStates.length; i++) {
    joinedEnv = joinEnvironments(joinedEnv, reachableStates[i]!.env);
  }

  // Join expression types
  const joinedExprTypes = new Map<t.Expression, Type>();
  for (const state of reachableStates) {
    for (const [expr, type] of state.expressionTypes) {
      const existing = joinedExprTypes.get(expr);
      if (existing) {
        joinedExprTypes.set(expr, joinTypes(existing, type));
      } else {
        joinedExprTypes.set(expr, type);
      }
    }
  }

  return {
    env: joinedEnv,
    expressionTypes: joinedExprTypes,
    reachable: true,
  };
}

/**
 * Check if two type states are equal (for fixed-point detection)
 */
function statesEqual(s1: TypeState, s2: TypeState): boolean {
  if (s1.reachable !== s2.reachable) return false;
  if (!s1.reachable && !s2.reachable) return true;

  // Compare environments
  return environmentsEqual(s1.env, s2.env);
}

/**
 * Check if two environments are equal
 */
function environmentsEqual(env1: TypeEnvironment, env2: TypeEnvironment): boolean {
  if (env1.bindings.size !== env2.bindings.size) return false;

  for (const [name, binding1] of env1.bindings) {
    const binding2 = env2.bindings.get(name);
    if (!binding2) return false;
    if (!typesEqual(binding1.type, binding2.type)) return false;
  }

  // Check parents
  if (env1.parent && env2.parent) {
    return environmentsEqual(env1.parent, env2.parent);
  }
  return env1.parent === env2.parent;
}

/**
 * Check if two types are structurally equal
 */
function typesEqual(t1: Type, t2: Type): boolean {
  if (t1.id === t2.id) return true;
  if (t1.kind !== t2.kind) return false;

  // For unions, check if members are equal (order-independent)
  if (t1.kind === 'union' && t2.kind === 'union') {
    if (t1.members.length !== t2.members.length) return false;
    return t1.members.every((m1) => t2.members.some((m2) => typesEqual(m1, m2)));
  }

  return false;
}

/**
 * Narrow type based on edge condition
 */
function narrowTypeByCondition(
  state: TypeState,
  condition: EdgeCondition | undefined
): TypeState {
  if (!condition) return state;

  const expr = condition.expression;
  const whenTruthy = condition.whenTruthy;

  // Handle typeof narrowing: typeof x === "type"
  if (t.isBinaryExpression(expr)) {
    if (
      (expr.operator === '===' || expr.operator === '==') &&
      t.isUnaryExpression(expr.left) &&
      expr.left.operator === 'typeof' &&
      t.isIdentifier(expr.left.argument) &&
      t.isStringLiteral(expr.right)
    ) {
      const varName = expr.left.argument.name;
      const typeofStr = expr.right.value;
      const binding = lookupBinding(state.env, varName);
      if (binding) {
        const narrowed = narrowByTypeof(binding.type, typeofStr, !whenTruthy);
        const newEnv = updateBinding(state.env, varName, narrowed, binding.kind, binding.declarationNode);
        return { ...state, env: newEnv };
      }
    }

    // Handle !== null, !== undefined
    if (
      (expr.operator === '!==' || expr.operator === '!=') &&
      t.isIdentifier(expr.left) &&
      (t.isNullLiteral(expr.right) ||
        (t.isIdentifier(expr.right) && expr.right.name === 'undefined'))
    ) {
      const varName = expr.left.name;
      const binding = lookupBinding(state.env, varName);
      if (binding && whenTruthy) {
        // If x !== null is true, remove null from x's type
        const narrowed = removeNullable(binding.type);
        const newEnv = updateBinding(state.env, varName, narrowed, binding.kind, binding.declarationNode);
        return { ...state, env: newEnv };
      }
    }
  }

  // Handle simple identifier check (if (x) { ... })
  if (t.isIdentifier(expr)) {
    const binding = lookupBinding(state.env, expr.name);
    if (binding) {
      if (whenTruthy) {
        // In truthy branch, remove falsy types (null, undefined)
        if (canBeFalsy(binding.type)) {
          const narrowed = removeNullable(binding.type);
          const newEnv = updateBinding(state.env, expr.name, narrowed, binding.kind, binding.declarationNode);
          return { ...state, env: newEnv };
        }
      }
    }
  }

  return state;
}

/**
 * Transfer function - compute exit state from entry state for a block
 */
function transfer(
  block: BasicBlock,
  entryState: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!entryState.reachable) {
    return entryState;
  }

  let currentState = entryState;

  // Process each statement in the block
  for (const stmt of block.statements) {
    currentState = transferStatement(stmt, currentState, ctx);
  }

  return currentState;
}

/**
 * Transfer function for a single statement
 */
function transferStatement(
  stmt: t.Statement,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!state.reachable) return state;

  switch (stmt.type) {
    case 'VariableDeclaration':
      return transferVariableDeclaration(stmt, state, ctx);

    case 'FunctionDeclaration':
      return transferFunctionDeclaration(stmt, state, ctx);

    case 'ClassDeclaration':
      return transferClassDeclaration(stmt, state, ctx);

    case 'ExpressionStatement':
      return transferExpressionStatement(stmt, state, ctx);

    default:
      return state;
  }
}

/**
 * Transfer function for variable declarations
 */
function transferVariableDeclaration(
  node: t.VariableDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  let currentState = state;
  const kind = node.kind === 'const' ? 'const' : node.kind === 'let' ? 'let' : 'var';

  for (const decl of node.declarations) {
    if (t.isIdentifier(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, currentState, ctx) : Types.undefined;

      // Check if this is a hoisted var - might need to widen type
      const hoisted = ctx.hoistedDeclarations.get(decl.id.name);
      let finalType = initType;

      if (hoisted && kind === 'var') {
        // Widen with existing type from previous iterations
        const existing = lookupBinding(currentState.env, decl.id.name);
        if (existing && existing.type.kind !== 'undefined') {
          finalType = joinTypes(existing.type, initType);
        }
      }

      currentState = {
        ...currentState,
        env: updateBinding(currentState.env, decl.id.name, finalType, kind, decl),
      };

      // Add annotation
      addAnnotation(ctx, {
        node: decl.id,
        name: decl.id.name,
        type: finalType,
        kind: kind === 'const' ? 'const' : 'variable',
      });
    } else if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, currentState, ctx) : Types.undefined;
      currentState = transferDestructuringPattern(decl.id, initType, currentState, ctx, kind);
    }
  }

  return currentState;
}

/**
 * Transfer function for destructuring patterns
 */
function transferDestructuringPattern(
  pattern: t.LVal,
  sourceType: Type,
  state: TypeState,
  ctx: IterativeContext,
  kind: 'var' | 'let' | 'const'
): TypeState {
  let currentState = state;

  if (t.isIdentifier(pattern)) {
    currentState = {
      ...currentState,
      env: updateBinding(currentState.env, pattern.name, sourceType, kind, pattern),
    };
    addAnnotation(ctx, {
      node: pattern,
      name: pattern.name,
      type: sourceType,
      kind: kind === 'const' ? 'const' : 'variable',
    });
  } else if (t.isObjectPattern(pattern)) {
    for (const prop of pattern.properties) {
      if (t.isObjectProperty(prop)) {
        let propType: Type = Types.any();

        if (sourceType.kind === 'object' && t.isIdentifier(prop.key)) {
          const propInfo = sourceType.properties.get(prop.key.name);
          if (propInfo) {
            propType = propInfo.type;
          }
        }

        if (t.isIdentifier(prop.value)) {
          currentState = transferDestructuringPattern(prop.value, propType, currentState, ctx, kind);
        } else if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
          const defaultType = inferExpression(prop.value.right, currentState, ctx);
          const unionType = propType.kind === 'any' ? defaultType : Types.union([propType, defaultType]);
          currentState = transferDestructuringPattern(prop.value.left, unionType, currentState, ctx, kind);
        } else if (t.isObjectPattern(prop.value) || t.isArrayPattern(prop.value)) {
          currentState = transferDestructuringPattern(prop.value, propType, currentState, ctx, kind);
        }
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        currentState = transferDestructuringPattern(prop.argument, Types.object({}), currentState, ctx, kind);
      }
    }
  } else if (t.isArrayPattern(pattern)) {
    for (let i = 0; i < pattern.elements.length; i++) {
      const elem = pattern.elements[i];
      if (!elem) continue;

      let elemType: Type = Types.any();

      if (sourceType.kind === 'array') {
        if (sourceType.tuple && i < sourceType.tuple.length) {
          elemType = sourceType.tuple[i]!;
        } else {
          elemType = sourceType.elementType;
        }
      }

      if (t.isIdentifier(elem)) {
        currentState = transferDestructuringPattern(elem, elemType, currentState, ctx, kind);
      } else if (t.isRestElement(elem) && t.isIdentifier(elem.argument)) {
        if (sourceType.kind === 'array') {
          currentState = transferDestructuringPattern(
            elem.argument,
            Types.array(sourceType.elementType),
            currentState,
            ctx,
            kind
          );
        } else {
          currentState = transferDestructuringPattern(
            elem.argument,
            Types.array(Types.any()),
            currentState,
            ctx,
            kind
          );
        }
      } else if (t.isAssignmentPattern(elem) && t.isIdentifier(elem.left)) {
        const defaultType = inferExpression(elem.right, currentState, ctx);
        const unionType = elemType.kind === 'any' ? defaultType : Types.union([elemType, defaultType]);
        currentState = transferDestructuringPattern(elem.left, unionType, currentState, ctx, kind);
      }
    }
  }

  return currentState;
}

/**
 * Transfer function for function declarations
 */
function transferFunctionDeclaration(
  node: t.FunctionDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!node.id) return state;

  const funcType = inferFunctionType(node, state, ctx);

  const newState = {
    ...state,
    env: updateBinding(state.env, node.id.name, funcType, 'function', node),
  };

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: funcType,
    kind: 'function',
  });

  // Annotate parameters
  annotateParameters(node.params, funcType, ctx);

  return newState;
}

/**
 * Transfer function for class declarations
 */
function transferClassDeclaration(
  node: t.ClassDeclaration,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  if (!node.id) return state;

  const classType = inferClassType(node, state, ctx);

  const newState = {
    ...state,
    env: updateBinding(state.env, node.id.name, classType, 'class', node),
  };

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: classType,
    kind: 'class',
  });

  return newState;
}

/**
 * Transfer function for expression statements
 */
function transferExpressionStatement(
  node: t.ExpressionStatement,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  // Handle assignments
  if (t.isAssignmentExpression(node.expression)) {
    return transferAssignment(node.expression, state, ctx);
  }

  // Just infer the expression type (for side effects like call expressions)
  inferExpression(node.expression, state, ctx);
  return state;
}

/**
 * Transfer function for assignments
 */
function transferAssignment(
  node: t.AssignmentExpression,
  state: TypeState,
  ctx: IterativeContext
): TypeState {
  const rightType = inferExpression(node.right, state, ctx);

  if (t.isIdentifier(node.left)) {
    const binding = lookupBinding(state.env, node.left.name);
    if (binding) {
      if (binding.kind === 'const') {
        ctx.errors.push({
          message: `Cannot assign to constant '${node.left.name}'`,
          line: node.loc?.start.line ?? 0,
          column: node.loc?.start.column ?? 0,
          nodeType: 'AssignmentExpression',
        });
        return state;
      }

      // For iterative analysis, we might widen the type
      let newType: Type;
      if (node.operator === '=') {
        newType = rightType;
      } else {
        // Compound assignment - keep existing type structure but might widen
        newType = joinTypes(binding.type, rightType);
      }

      return {
        ...state,
        env: updateBinding(state.env, node.left.name, newType, binding.kind, binding.declarationNode),
      };
    }
  }

  return state;
}

/**
 * Infer expression type (using current state)
 */
function inferExpression(
  expr: t.Expression | t.SpreadElement,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (t.isSpreadElement(expr)) {
    return inferExpression(expr.argument, state, ctx);
  }

  switch (expr.type) {
    case 'NumericLiteral':
      return Types.numberLiteral(expr.value);
    case 'StringLiteral':
      return Types.stringLiteral(expr.value);
    case 'BooleanLiteral':
      return Types.booleanLiteral(expr.value);
    case 'NullLiteral':
      return Types.null;
    case 'BigIntLiteral':
      return Types.bigintLiteral(BigInt(expr.value));
    case 'RegExpLiteral':
      return Types.object({ properties: new Map() });

    case 'TemplateLiteral':
      if (expr.expressions.length === 0 && expr.quasis.length === 1) {
        return Types.stringLiteral(expr.quasis[0]!.value.cooked ?? '');
      }
      return Types.string;

    case 'Identifier':
      const binding = lookupBinding(state.env, expr.name);
      return binding?.type ?? Types.any(`undefined variable '${expr.name}'`);

    case 'ArrayExpression':
      return inferArrayExpression(expr, state, ctx);

    case 'ObjectExpression':
      return inferObjectExpression(expr, state, ctx);

    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return inferFunctionType(expr, state, ctx);

    case 'BinaryExpression':
      return inferBinaryExpression(expr, state, ctx);

    case 'UnaryExpression':
      return inferUnaryExpression(expr, state, ctx);

    case 'LogicalExpression':
      return inferLogicalExpression(expr, state, ctx);

    case 'ConditionalExpression':
      const consequent = inferExpression(expr.consequent, state, ctx);
      const alternate = inferExpression(expr.alternate, state, ctx);
      return Types.union([consequent, alternate]);

    case 'CallExpression':
      return inferCallExpression(expr, state, ctx);

    case 'NewExpression':
      return inferNewExpression(expr, state, ctx);

    case 'MemberExpression':
      return inferMemberExpression(expr, state, ctx);

    case 'AssignmentExpression':
      return inferExpression(expr.right, state, ctx);

    case 'SequenceExpression':
      const last = expr.expressions[expr.expressions.length - 1];
      return last ? inferExpression(last, state, ctx) : Types.undefined;

    case 'AwaitExpression':
      const awaitedType = inferExpression(expr.argument, state, ctx);
      if (awaitedType.kind === 'promise') {
        return awaitedType.resolvedType;
      }
      return awaitedType;

    case 'YieldExpression':
      return Types.any();

    case 'ThisExpression':
      return Types.any();

    case 'ClassExpression':
      return inferClassType(expr, state, ctx);

    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return Types.union([inferOptionalExpression(expr, state, ctx), Types.undefined]);

    default:
      return Types.any();
  }
}

/**
 * Infer array expression type
 */
function inferArrayExpression(
  expr: t.ArrayExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (expr.elements.length === 0) {
    return Types.array(Types.never);
  }

  const elementTypes: Type[] = [];
  let hasSpread = false;

  for (const elem of expr.elements) {
    if (elem === null) {
      elementTypes.push(Types.undefined);
    } else if (t.isSpreadElement(elem)) {
      hasSpread = true;
      const spreadType = inferExpression(elem.argument, state, ctx);
      if (spreadType.kind === 'array') {
        elementTypes.push(spreadType.elementType);
      } else {
        elementTypes.push(Types.any());
      }
    } else {
      elementTypes.push(inferExpression(elem, state, ctx));
    }
  }

  if (hasSpread) {
    return Types.array(Types.union(elementTypes));
  }

  if (elementTypes.length <= 10) {
    return Types.tuple(elementTypes);
  }

  return Types.array(Types.union(elementTypes));
}

/**
 * Infer object expression type
 */
function inferObjectExpression(
  expr: t.ObjectExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const properties = new Map<string, ReturnType<typeof Types.property>>();

  for (const prop of expr.properties) {
    if (t.isObjectProperty(prop)) {
      let key: string | undefined;

      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      } else if (t.isStringLiteral(prop.key)) {
        key = prop.key.value;
      } else if (t.isNumericLiteral(prop.key)) {
        key = String(prop.key.value);
      }

      if (key && t.isExpression(prop.value)) {
        const valueType = inferExpression(prop.value, state, ctx);
        properties.set(key, Types.property(valueType));
      }
    } else if (t.isObjectMethod(prop)) {
      let key: string | undefined;
      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      }
      if (key) {
        const methodType = inferFunctionType(prop, state, ctx);
        properties.set(key, Types.property(methodType));
      }
    } else if (t.isSpreadElement(prop)) {
      const spreadType = inferExpression(prop.argument, state, ctx);
      if (spreadType.kind === 'object') {
        for (const [k, v] of spreadType.properties) {
          properties.set(k, v);
        }
      }
    }
  }

  return Types.object({ properties });
}

/**
 * Analyze a function body (for IIFE and nested functions)
 * This performs full iterative analysis on the function body
 */
function analyzeFunction(
  node: t.FunctionExpression | t.ArrowFunctionExpression | t.FunctionDeclaration,
  state: TypeState,
  ctx: IterativeContext
): void {
  // Get the function body statements
  let statements: t.Statement[];
  if (t.isBlockStatement(node.body)) {
    statements = node.body.body;
  } else {
    // Arrow function with expression body - nothing to analyze deeply
    return;
  }

  // Build CFG for this function
  const functionCFG = buildCFG(statements);

  // Create function scope environment
  let funcEnv = createEnv(state.env, 'function');

  // Add parameters to environment
  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
      addAnnotation(ctx, {
        node: param,
        name: param.name,
        type: Types.any(),
        kind: 'parameter',
      });
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(Types.any()), 'param', param);
      addAnnotation(ctx, {
        node: param.argument,
        name: param.argument.name,
        type: Types.array(Types.any()),
        kind: 'parameter',
      });
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      funcEnv = updateBinding(funcEnv, param.left.name, defaultType, 'param', param);
      addAnnotation(ctx, {
        node: param.left,
        name: param.left.name,
        type: defaultType,
        kind: 'parameter',
      });
    }
  }

  // Collect hoisted declarations in this function
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(statements, hoistedDeclarations);

  // Add hoisted declarations to environment
  for (const [name, decl] of hoistedDeclarations) {
    funcEnv = updateBinding(funcEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // Initialize block states
  const blockEntryStates = new Map<NodeId, TypeState>();
  const blockExitStates = new Map<NodeId, TypeState>();

  for (const [blockId] of functionCFG.blocks) {
    blockEntryStates.set(blockId, createUnreachableState(funcEnv));
    blockExitStates.set(blockId, createUnreachableState(funcEnv));
  }

  // Entry block starts as reachable with function environment
  blockEntryStates.set(functionCFG.entry, createInitialState(funcEnv));

  // Create a sub-context for this function
  const funcCtx: IterativeContext = {
    cfg: functionCFG,
    blockEntryStates,
    blockExitStates,
    annotations: ctx.annotations, // Share annotations
    errors: ctx.errors, // Share errors
    source: ctx.source,
    filename: ctx.filename,
    globalEnv: ctx.globalEnv,
    hoistedDeclarations,
  };

  // Compute reverse post-order
  const rpo = computeReversePostOrder(functionCFG);

  // Fixed-point iteration
  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const blockId of rpo) {
      const block = functionCFG.blocks.get(blockId);
      if (!block) continue;

      const predecessors = functionCFG.predecessors.get(blockId) ?? [];
      let newEntryState: TypeState;

      if (block.isEntry) {
        newEntryState = blockEntryStates.get(blockId)!;
      } else if (predecessors.length === 0) {
        newEntryState = createUnreachableState(funcEnv);
      } else {
        const predStates: TypeState[] = [];
        for (const predId of predecessors) {
          const predExitState = blockExitStates.get(predId);
          if (predExitState) {
            const edge = [...functionCFG.edges.values()].find(
              (e) => e.source === predId && e.target === blockId
            );
            const narrowedState = narrowTypeByCondition(predExitState, edge?.condition);
            predStates.push(narrowedState);
          }
        }
        newEntryState = predStates.length > 0 ? joinStates(predStates) : createUnreachableState(funcEnv);
      }

      const oldEntryState = blockEntryStates.get(blockId)!;
      if (!statesEqual(oldEntryState, newEntryState)) {
        blockEntryStates.set(blockId, newEntryState);
        changed = true;
      }

      const newExitState = transfer(block, newEntryState, funcCtx);

      const oldExitState = blockExitStates.get(blockId)!;
      if (!statesEqual(oldExitState, newExitState)) {
        blockExitStates.set(blockId, newExitState);
        changed = true;
      }
    }
  }
}

/**
 * Infer function type
 */
function inferFunctionType(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  // Create function-local environment with parameters
  let funcEnv = createEnv(state.env, 'function');

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
      funcEnv = updateBinding(funcEnv, param.name, Types.any(), 'param', param);
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
      funcEnv = updateBinding(funcEnv, param.argument.name, Types.array(Types.any()), 'param', param);
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
      funcEnv = updateBinding(funcEnv, param.left.name, defaultType, 'param', param);
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // Collect all variable declarations in function body for return type inference
  // Also adds annotations for each local variable
  if (t.isBlockStatement(node.body)) {
    funcEnv = collectDeclarationsInBlock(node.body, funcEnv, ctx);
  }

  // Create function-local state
  const funcState: TypeState = {
    env: funcEnv,
    expressionTypes: new Map(),
    reachable: true,
  };

  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, funcState, ctx);
  } else if (t.isExpression(node.body)) {
    returnType = inferExpression(node.body, funcState, ctx);
  }

  const isAsync = 'async' in node && node.async;
  const isGenerator = 'generator' in node && node.generator;

  if (isAsync && returnType.kind !== 'promise') {
    returnType = Types.promise(returnType);
  }

  return Types.function({
    params,
    returnType,
    isAsync,
    isGenerator,
  });
}

/**
 * Collect all variable declarations in a block (for return type inference)
 * Also adds annotations for each declaration
 */
function collectDeclarationsInBlock(
  block: t.BlockStatement,
  env: TypeEnvironment,
  ctx?: IterativeContext
): TypeEnvironment {
  let result = env;

  for (const stmt of block.body) {
    result = collectDeclarationsInStatement(stmt, result, ctx);
  }

  return result;
}

/**
 * Recursively collect declarations from a statement
 * Also adds annotations for each declaration
 */
function collectDeclarationsInStatement(
  stmt: t.Statement,
  env: TypeEnvironment,
  ctx?: IterativeContext
): TypeEnvironment {
  let result = env;

  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind === 'const' ? 'const' : stmt.kind === 'let' ? 'let' : 'var';
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        // Infer initial type if possible
        let initType: Type = Types.any();
        if (decl.init) {
          if (t.isNumericLiteral(decl.init)) {
            initType = Types.numberLiteral(decl.init.value);
          } else if (t.isStringLiteral(decl.init)) {
            initType = Types.stringLiteral(decl.init.value);
          } else if (t.isBooleanLiteral(decl.init)) {
            initType = Types.booleanLiteral(decl.init.value);
          } else if (t.isNullLiteral(decl.init)) {
            initType = Types.null;
          } else if (t.isArrayExpression(decl.init)) {
            initType = Types.array(Types.any());
          } else if (t.isObjectExpression(decl.init)) {
            initType = Types.object({});
          } else {
            // For complex expressions, use number/string/any based on common patterns
            initType = Types.any();
          }
        }
        result = updateBinding(result, decl.id.name, initType, kind, decl);

        // Add annotation for this declaration
        // Use skipIfExists because transfer() may have already added a more precise type
        if (ctx) {
          addAnnotation(ctx, {
            node: decl.id,
            name: decl.id.name,
            type: initType,
            kind: kind === 'const' ? 'const' : 'variable',
            skipIfExists: true,
          });
        }
      }
    }
  } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
    result = updateBinding(result, stmt.id.name, Types.function({ params: [], returnType: Types.any() }), 'function', stmt);
  } else if (t.isForStatement(stmt)) {
    // Collect declarations in for init
    if (t.isVariableDeclaration(stmt.init)) {
      result = collectDeclarationsInStatement(stmt.init, result, ctx);
    }
    // Collect declarations in for body
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx);
    }
  } else if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt)) {
    if (t.isBlockStatement(stmt.body)) {
      result = collectDeclarationsInBlock(stmt.body, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.body, result, ctx);
    }
  } else if (t.isIfStatement(stmt)) {
    if (t.isBlockStatement(stmt.consequent)) {
      result = collectDeclarationsInBlock(stmt.consequent, result, ctx);
    } else {
      result = collectDeclarationsInStatement(stmt.consequent, result, ctx);
    }
    if (stmt.alternate) {
      if (t.isBlockStatement(stmt.alternate)) {
        result = collectDeclarationsInBlock(stmt.alternate, result, ctx);
      } else {
        result = collectDeclarationsInStatement(stmt.alternate, result, ctx);
      }
    }
  } else if (t.isTryStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt.block, result, ctx);
    if (stmt.handler) {
      result = collectDeclarationsInBlock(stmt.handler.body, result, ctx);
    }
    if (stmt.finalizer) {
      result = collectDeclarationsInBlock(stmt.finalizer, result, ctx);
    }
  } else if (t.isSwitchStatement(stmt)) {
    for (const c of stmt.cases) {
      for (const s of c.consequent) {
        result = collectDeclarationsInStatement(s, result, ctx);
      }
    }
  } else if (t.isBlockStatement(stmt)) {
    result = collectDeclarationsInBlock(stmt, result, ctx);
  }

  return result;
}

/**
 * Infer return type from function body
 */
function inferBlockReturnType(
  body: t.BlockStatement,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const returnTypes: Type[] = [];

  for (const stmt of body.body) {
    collectReturnTypes(stmt, returnTypes, state, ctx);
  }

  if (returnTypes.length === 0) {
    return Types.undefined;
  }

  return Types.union(returnTypes);
}

function collectReturnTypes(
  node: t.Node,
  types: Type[],
  state: TypeState,
  ctx: IterativeContext
): void {
  if (t.isReturnStatement(node)) {
    if (node.argument) {
      types.push(inferExpression(node.argument, state, ctx));
    } else {
      types.push(Types.undefined);
    }
  } else if (t.isIfStatement(node)) {
    collectReturnTypes(node.consequent, types, state, ctx);
    if (node.alternate) {
      collectReturnTypes(node.alternate, types, state, ctx);
    }
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectReturnTypes(stmt, types, state, ctx);
    }
  } else if (t.isSwitchStatement(node)) {
    for (const c of node.cases) {
      for (const stmt of c.consequent) {
        collectReturnTypes(stmt, types, state, ctx);
      }
    }
  } else if (t.isTryStatement(node)) {
    collectReturnTypes(node.block, types, state, ctx);
    if (node.handler) {
      collectReturnTypes(node.handler.body, types, state, ctx);
    }
    if (node.finalizer) {
      collectReturnTypes(node.finalizer, types, state, ctx);
    }
  }
}

/**
 * Infer class type
 */
function inferClassType(
  node: t.ClassDeclaration | t.ClassExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const className = node.id?.name ?? 'Anonymous';
  const instanceProps = new Map<string, ReturnType<typeof Types.property>>();
  const staticProps = new Map<string, ReturnType<typeof Types.property>>();
  let ctorType = Types.function({ params: [], returnType: Types.undefined });

  for (const member of node.body.body) {
    if (t.isClassMethod(member)) {
      const methodType = inferClassMethodType(member, state, ctx);

      if (member.kind === 'constructor') {
        if (methodType.kind === 'function') {
          ctorType = methodType;
        }
      } else {
        const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
        if (member.static) {
          staticProps.set(name, Types.property(methodType));
        } else {
          instanceProps.set(name, Types.property(methodType));
        }
      }
    } else if (t.isClassProperty(member)) {
      const name = t.isIdentifier(member.key) ? member.key.name : 'unknown';
      const propType = member.value ? inferExpression(member.value, state, ctx) : Types.any();

      if (member.static) {
        staticProps.set(name, Types.property(propType));
      } else {
        instanceProps.set(name, Types.property(propType));
      }
    }
  }

  return Types.class({
    name: className,
    constructor: ctorType,
    instanceType: Types.object({ properties: instanceProps }),
    staticProperties: staticProps,
  });
}

/**
 * Infer class method type
 */
function inferClassMethodType(
  node: t.ClassMethod,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, state, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    }
  }

  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, state, ctx);
  }

  const isAsync = node.async;
  const isGenerator = node.generator;

  if (isAsync && returnType.kind !== 'promise') {
    returnType = Types.promise(returnType);
  }

  return Types.function({
    params,
    returnType,
    isAsync,
    isGenerator,
  });
}

/**
 * Infer binary expression type
 */
function inferBinaryExpression(
  expr: t.BinaryExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = t.isPrivateName(expr.left) ? Types.any() : inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '+':
      if (left.kind === 'string' || right.kind === 'string') {
        return Types.string;
      }
      if (left.kind === 'number' && right.kind === 'number') {
        if (left.value !== undefined && right.value !== undefined) {
          return Types.numberLiteral(left.value + right.value);
        }
        return Types.number;
      }
      return Types.union([Types.string, Types.number]);

    case '-':
    case '*':
    case '/':
    case '%':
    case '**':
      return Types.number;

    case '|':
    case '&':
    case '^':
    case '<<':
    case '>>':
    case '>>>':
      return Types.number;

    case '==':
    case '===':
    case '!=':
    case '!==':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'in':
    case 'instanceof':
      return Types.boolean;

    default:
      return Types.any();
  }
}

/**
 * Infer unary expression type
 */
function inferUnaryExpression(
  expr: t.UnaryExpression,
  _state: TypeState,
  _ctx: IterativeContext
): Type {
  switch (expr.operator) {
    case 'typeof':
      return Types.string;
    case 'void':
      return Types.undefined;
    case '!':
      return Types.boolean;
    case '+':
    case '-':
    case '~':
      return Types.number;
    case 'delete':
      return Types.boolean;
    default:
      return Types.any();
  }
}

/**
 * Infer logical expression type
 */
function inferLogicalExpression(
  expr: t.LogicalExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const left = inferExpression(expr.left, state, ctx);
  const right = inferExpression(expr.right, state, ctx);

  switch (expr.operator) {
    case '&&':
    case '||':
      return Types.union([left, right]);

    case '??':
      if (left.kind === 'null' || left.kind === 'undefined') {
        return right;
      }
      if (left.kind === 'union') {
        const nonNullable = left.members.filter(
          (m) => m.kind !== 'null' && m.kind !== 'undefined'
        );
        if (nonNullable.length === 0) {
          return right;
        }
        return Types.union([...nonNullable, right]);
      }
      return left;

    default:
      return Types.any();
  }
}

/**
 * Infer call expression type
 */
function inferCallExpression(
  expr: t.CallExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  // Handle IIFE (Immediately Invoked Function Expression)
  if (t.isFunctionExpression(expr.callee) || t.isArrowFunctionExpression(expr.callee)) {
    // Analyze the IIFE body
    analyzeFunction(expr.callee, state, ctx);
  }

  const calleeType = t.isExpression(expr.callee)
    ? inferExpression(expr.callee, state, ctx)
    : Types.any();

  if (calleeType.kind === 'function') {
    return calleeType.returnType;
  }

  return Types.any();
}

/**
 * Infer new expression type
 */
function inferNewExpression(
  expr: t.NewExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const calleeType = t.isExpression(expr.callee)
    ? inferExpression(expr.callee, state, ctx)
    : Types.any();

  if (calleeType.kind === 'class') {
    return calleeType.instanceType;
  }

  if (calleeType.kind === 'function') {
    return Types.object({});
  }

  return Types.object({});
}

/**
 * Infer member expression type
 */
function inferMemberExpression(
  expr: t.MemberExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  const objectType = t.isExpression(expr.object)
    ? inferExpression(expr.object, state, ctx)
    : Types.any();

  let propName: string | undefined;
  if (t.isIdentifier(expr.property) && !expr.computed) {
    propName = expr.property.name;
  } else if (t.isStringLiteral(expr.property)) {
    propName = expr.property.value;
  }

  if (propName && objectType.kind === 'object') {
    const prop = objectType.properties.get(propName);
    if (prop) {
      return prop.type;
    }
  }

  if (objectType.kind === 'array') {
    if (t.isNumericLiteral(expr.property) && objectType.tuple) {
      const idx = expr.property.value;
      if (idx >= 0 && idx < objectType.tuple.length) {
        return objectType.tuple[idx]!;
      }
    }

    if (propName) {
      const elemType = objectType.elementType;
      const arrayMethods: Record<string, Type> = {
        length: Types.number,
        push: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        pop: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        shift: Types.function({
          params: [],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        unshift: Types.function({
          params: [Types.param('item', elemType, { rest: true })],
          returnType: Types.number,
        }),
        slice: Types.function({
          params: [
            Types.param('start', Types.number, { optional: true }),
            Types.param('end', Types.number, { optional: true }),
          ],
          returnType: Types.array(elemType),
        }),
        map: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.any() })
            ),
          ],
          returnType: Types.array(Types.any()),
        }),
        filter: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.array(elemType),
        }),
        find: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean })
            ),
          ],
          returnType: Types.union([elemType, Types.undefined]),
        }),
        includes: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.boolean,
        }),
        indexOf: Types.function({
          params: [Types.param('item', elemType)],
          returnType: Types.number,
        }),
        join: Types.function({
          params: [Types.param('sep', Types.string, { optional: true })],
          returnType: Types.string,
        }),
        forEach: Types.function({
          params: [
            Types.param(
              'fn',
              Types.function({
                params: [Types.param('item', elemType)],
                returnType: Types.undefined,
              })
            ),
          ],
          returnType: Types.undefined,
        }),
        reduce: Types.function({
          params: [Types.param('fn', Types.any()), Types.param('init', Types.any(), { optional: true })],
          returnType: Types.any(),
        }),
      };
      if (arrayMethods[propName]) {
        return arrayMethods[propName]!;
      }
    }

    return objectType.elementType;
  }

  if (objectType.kind === 'string' && propName) {
    const stringMethods: Record<string, Type> = {
      length: Types.number,
      charAt: Types.function({
        params: [Types.param('index', Types.number)],
        returnType: Types.string,
      }),
      slice: Types.function({
        params: [
          Types.param('start', Types.number),
          Types.param('end', Types.number, { optional: true }),
        ],
        returnType: Types.string,
      }),
      split: Types.function({
        params: [Types.param('sep', Types.string)],
        returnType: Types.array(Types.string),
      }),
      toLowerCase: Types.function({ params: [], returnType: Types.string }),
      toUpperCase: Types.function({ params: [], returnType: Types.string }),
      trim: Types.function({ params: [], returnType: Types.string }),
      includes: Types.function({
        params: [Types.param('search', Types.string)],
        returnType: Types.boolean,
      }),
    };
    if (stringMethods[propName]) {
      return stringMethods[propName]!;
    }
  }

  return Types.any();
}

/**
 * Infer optional expression type
 */
function inferOptionalExpression(
  expr: t.OptionalMemberExpression | t.OptionalCallExpression,
  state: TypeState,
  ctx: IterativeContext
): Type {
  if (t.isOptionalMemberExpression(expr)) {
    const objectType = inferExpression(expr.object, state, ctx);

    let propName: string | undefined;
    if (t.isIdentifier(expr.property) && !expr.computed) {
      propName = expr.property.name;
    }

    if (propName && objectType.kind === 'object') {
      const prop = objectType.properties.get(propName);
      if (prop) return prop.type;
    }
  } else if (t.isOptionalCallExpression(expr)) {
    const calleeType = inferExpression(expr.callee, state, ctx);
    if (calleeType.kind === 'function') {
      return calleeType.returnType;
    }
  }

  return Types.any();
}

/**
 * Annotate function parameters
 */
function annotateParameters(
  params: Array<t.Identifier | t.Pattern | t.RestElement>,
  funcType: Type,
  ctx: IterativeContext
): void {
  if (funcType.kind !== 'function') return;

  for (let i = 0; i < params.length; i++) {
    const param = params[i]!;
    const paramType = funcType.params[i]?.type ?? Types.any();

    if (t.isIdentifier(param)) {
      addAnnotation(ctx, {
        node: param,
        name: param.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      addAnnotation(ctx, {
        node: param.argument,
        name: param.argument.name,
        type: paramType,
        kind: 'parameter',
      });
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      addAnnotation(ctx, {
        node: param.left,
        name: param.left.name,
        type: paramType,
        kind: 'parameter',
      });
    }
  }
}

/**
 * Add an annotation to the context
 */
function addAnnotation(
  ctx: IterativeContext,
  info: {
    node: t.Node;
    name?: string;
    type: Type;
    kind: AnnotationKind;
    /** If true, only add if no existing annotation (don't update) */
    skipIfExists?: boolean;
  }
): void {
  const { node, name, type, kind, skipIfExists } = info;
  const loc = node.loc;
  const start = node.start ?? 0;

  // Check for duplicate annotation at same position with same name and kind
  const existing = ctx.annotations.find(
    (a) => a.start === start && a.name === name && a.kind === kind
  );
  if (existing) {
    if (skipIfExists) {
      // Don't update, keep the existing (more precise) type
      return;
    }
    // Update the type if it changed (for iterative refinement)
    existing.type = type;
    existing.typeString = formatType(type);
    return;
  }

  ctx.annotations.push({
    start,
    end: node.end ?? 0,
    line: loc?.start.line ?? 0,
    column: loc?.start.column ?? 0,
    nodeType: node.type,
    name,
    type,
    typeString: formatType(type),
    kind,
  });
}

/**
 * Add built-in global bindings
 */
function addBuiltins(env: TypeEnvironment): TypeEnvironment {
  const builtins: Array<[string, Type]> = [
    ['undefined', Types.undefined],
    ['NaN', Types.number],
    ['Infinity', Types.number],
    [
      'console',
      Types.object({
        properties: new Map([
          [
            'log',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
          [
            'error',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
          [
            'warn',
            Types.property(
              Types.function({
                params: [Types.param('args', Types.any(), { rest: true })],
                returnType: Types.undefined,
              })
            ),
          ],
        ]),
      }),
    ],
    [
      'Math',
      Types.object({
        properties: new Map([
          ['PI', Types.property(Types.numberLiteral(Math.PI))],
          ['E', Types.property(Types.numberLiteral(Math.E))],
          [
            'abs',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'floor',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'ceil',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'round',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          ['random', Types.property(Types.function({ params: [], returnType: Types.number }))],
          [
            'sqrt',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'sin',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'cos',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'pow',
            Types.property(
              Types.function({
                params: [Types.param('x', Types.number), Types.param('y', Types.number)],
                returnType: Types.number,
              })
            ),
          ],
          [
            'min',
            Types.property(
              Types.function({
                params: [Types.param('values', Types.number, { rest: true })],
                returnType: Types.number,
              })
            ),
          ],
          [
            'max',
            Types.property(
              Types.function({
                params: [Types.param('values', Types.number, { rest: true })],
                returnType: Types.number,
              })
            ),
          ],
        ]),
      }),
    ],
    [
      'Date',
      Types.class({
        name: 'Date',
        constructor: Types.function({ params: [], returnType: Types.undefined }),
        instanceType: Types.object({
          properties: new Map([
            ['getTime', Types.property(Types.function({ params: [], returnType: Types.number }))],
            ['toString', Types.property(Types.function({ params: [], returnType: Types.string }))],
          ]),
        }),
        staticProperties: new Map([
          ['now', Types.property(Types.function({ params: [], returnType: Types.number }))],
        ]),
      }),
    ],
    [
      'print',
      Types.function({
        params: [Types.param('args', Types.any(), { rest: true })],
        returnType: Types.undefined,
      }),
    ],
    [
      'JSON',
      Types.object({
        properties: new Map([
          [
            'parse',
            Types.property(
              Types.function({
                params: [Types.param('text', Types.string)],
                returnType: Types.any(),
              })
            ),
          ],
          [
            'stringify',
            Types.property(
              Types.function({
                params: [Types.param('value', Types.any())],
                returnType: Types.string,
              })
            ),
          ],
        ]),
      }),
    ],
    ['Object', Types.function({ params: [], returnType: Types.object({}) })],
    ['Array', Types.function({ params: [], returnType: Types.array(Types.any()) })],
    [
      'String',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.string }),
    ],
    [
      'Number',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.number }),
    ],
    [
      'Boolean',
      Types.function({ params: [Types.param('value', Types.any())], returnType: Types.boolean }),
    ],
  ];

  let result = env;
  for (const [name, type] of builtins) {
    result = updateBinding(result, name, type, 'var', { type: 'Identifier', name } as t.Identifier);
  }
  return result;
}

/**
 * Collect hoisted declarations from statements (first pass)
 */
function collectHoistedDeclarations(
  statements: t.Statement[],
  hoisted: Map<string, HoistedDeclaration>
): void {
  for (const stmt of statements) {
    if (t.isFunctionDeclaration(stmt) && stmt.id) {
      hoisted.set(stmt.id.name, {
        name: stmt.id.name,
        kind: 'function',
        node: stmt,
        initialType: Types.function({ params: [], returnType: Types.any() }), // Placeholder
      });
    } else if (t.isClassDeclaration(stmt) && stmt.id) {
      hoisted.set(stmt.id.name, {
        name: stmt.id.name,
        kind: 'class',
        node: stmt,
        initialType: Types.class({
          name: stmt.id.name,
          constructor: Types.function({ params: [], returnType: Types.undefined }),
          instanceType: Types.object({}),
          staticProperties: new Map(),
        }),
      });
    } else if (t.isVariableDeclaration(stmt) && stmt.kind === 'var') {
      for (const decl of stmt.declarations) {
        if (t.isIdentifier(decl.id)) {
          hoisted.set(decl.id.name, {
            name: decl.id.name,
            kind: 'var',
            node: decl,
            initialType: Types.undefined,
          });
        }
      }
    }
  }
}

/**
 * Compute reverse post-order of CFG blocks
 */
function computeReversePostOrder(cfg: CFG): NodeId[] {
  const visited = new Set<NodeId>();
  const postOrder: NodeId[] = [];

  function dfs(nodeId: NodeId): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const successors = cfg.successors.get(nodeId) ?? [];
    for (const succ of successors) {
      dfs(succ);
    }
    postOrder.push(nodeId);
  }

  dfs(cfg.entry);
  return postOrder.reverse();
}

/**
 * Main entry point: Iterative type inference using CFG
 */
export function inferTypesIterative(
  ast: t.File,
  source: string,
  filename: string
): TypeAnnotationResult {
  // Build CFG from program body
  const cfg = buildCFG(ast.program.body);

  // Create global environment with builtins
  const globalEnv = addBuiltins(createEnv(null, 'module'));

  // Collect hoisted declarations
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(ast.program.body, hoistedDeclarations);

  // Initialize context
  const ctx: IterativeContext = {
    cfg,
    blockEntryStates: new Map(),
    blockExitStates: new Map(),
    annotations: [],
    errors: [],
    source,
    filename,
    globalEnv,
    hoistedDeclarations,
  };

  // Initialize entry state with hoisted declarations
  let entryEnv = globalEnv;
  for (const [name, decl] of hoistedDeclarations) {
    entryEnv = updateBinding(entryEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // Initialize all blocks with bottom state (unreachable)
  for (const [blockId] of cfg.blocks) {
    ctx.blockEntryStates.set(blockId, createUnreachableState(globalEnv));
    ctx.blockExitStates.set(blockId, createUnreachableState(globalEnv));
  }

  // Entry block starts as reachable
  ctx.blockEntryStates.set(cfg.entry, createInitialState(entryEnv));

  // Compute reverse post-order for efficient iteration
  const rpo = computeReversePostOrder(cfg);

  // Fixed-point iteration
  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const blockId of rpo) {
      const block = cfg.blocks.get(blockId);
      if (!block) continue;

      // Compute entry state by joining predecessor exit states
      const predecessors = cfg.predecessors.get(blockId) ?? [];
      let newEntryState: TypeState;

      if (block.isEntry) {
        // Entry block keeps its initial state
        newEntryState = ctx.blockEntryStates.get(blockId)!;
      } else if (predecessors.length === 0) {
        // No predecessors - unreachable
        newEntryState = createUnreachableState(globalEnv);
      } else {
        // Join all predecessor exit states
        const predStates: TypeState[] = [];
        for (const predId of predecessors) {
          const predExitState = ctx.blockExitStates.get(predId);
          if (predExitState) {
            // Apply edge conditions for narrowing
            const edge = [...cfg.edges.values()].find(
              (e) => e.source === predId && e.target === blockId
            );
            const narrowedState = narrowTypeByCondition(predExitState, edge?.condition);
            predStates.push(narrowedState);
          }
        }
        newEntryState = predStates.length > 0 ? joinStates(predStates) : createUnreachableState(globalEnv);
      }

      // Check if entry state changed
      const oldEntryState = ctx.blockEntryStates.get(blockId)!;
      if (!statesEqual(oldEntryState, newEntryState)) {
        ctx.blockEntryStates.set(blockId, newEntryState);
        changed = true;
      }

      // Compute exit state via transfer function
      const newExitState = transfer(block, newEntryState, ctx);

      // Check if exit state changed
      const oldExitState = ctx.blockExitStates.get(blockId)!;
      if (!statesEqual(oldExitState, newExitState)) {
        ctx.blockExitStates.set(blockId, newExitState);
        changed = true;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    ctx.errors.push({
      message: `Type inference did not converge after ${MAX_ITERATIONS} iterations`,
      line: 0,
      column: 0,
    });
  }

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [],
  };
}

/**
 * Extended analysis result with CFG information
 */
export interface IterativeAnalysisResult extends TypeAnnotationResult {
  /** CFG used for analysis */
  cfg: CFG;
  /** Entry states for each block */
  blockEntryStates: ReadonlyMap<NodeId, TypeState>;
  /** Exit states for each block */
  blockExitStates: ReadonlyMap<NodeId, TypeState>;
  /** Number of iterations to converge */
  iterations: number;
}

/**
 * Full iterative analysis with detailed results
 */
export function analyzeIterative(
  ast: t.File,
  source: string,
  filename: string
): IterativeAnalysisResult {
  // Build CFG from program body
  const cfg = buildCFG(ast.program.body);

  // Create global environment with builtins
  const globalEnv = addBuiltins(createEnv(null, 'module'));

  // Collect hoisted declarations
  const hoistedDeclarations = new Map<string, HoistedDeclaration>();
  collectHoistedDeclarations(ast.program.body, hoistedDeclarations);

  // Initialize context
  const ctx: IterativeContext = {
    cfg,
    blockEntryStates: new Map(),
    blockExitStates: new Map(),
    annotations: [],
    errors: [],
    source,
    filename,
    globalEnv,
    hoistedDeclarations,
  };

  // Initialize entry state with hoisted declarations
  let entryEnv = globalEnv;
  for (const [name, decl] of hoistedDeclarations) {
    entryEnv = updateBinding(entryEnv, name, decl.initialType, decl.kind, decl.node);
  }

  // Initialize all blocks
  for (const [blockId] of cfg.blocks) {
    ctx.blockEntryStates.set(blockId, createUnreachableState(globalEnv));
    ctx.blockExitStates.set(blockId, createUnreachableState(globalEnv));
  }

  ctx.blockEntryStates.set(cfg.entry, createInitialState(entryEnv));

  const rpo = computeReversePostOrder(cfg);

  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    for (const blockId of rpo) {
      const block = cfg.blocks.get(blockId);
      if (!block) continue;

      const predecessors = cfg.predecessors.get(blockId) ?? [];
      let newEntryState: TypeState;

      if (block.isEntry) {
        newEntryState = ctx.blockEntryStates.get(blockId)!;
      } else if (predecessors.length === 0) {
        newEntryState = createUnreachableState(globalEnv);
      } else {
        const predStates: TypeState[] = [];
        for (const predId of predecessors) {
          const predExitState = ctx.blockExitStates.get(predId);
          if (predExitState) {
            const edge = [...cfg.edges.values()].find(
              (e) => e.source === predId && e.target === blockId
            );
            const narrowedState = narrowTypeByCondition(predExitState, edge?.condition);
            predStates.push(narrowedState);
          }
        }
        newEntryState = predStates.length > 0 ? joinStates(predStates) : createUnreachableState(globalEnv);
      }

      const oldEntryState = ctx.blockEntryStates.get(blockId)!;
      if (!statesEqual(oldEntryState, newEntryState)) {
        ctx.blockEntryStates.set(blockId, newEntryState);
        changed = true;
      }

      const newExitState = transfer(block, newEntryState, ctx);

      const oldExitState = ctx.blockExitStates.get(blockId)!;
      if (!statesEqual(oldExitState, newExitState)) {
        ctx.blockExitStates.set(blockId, newExitState);
        changed = true;
      }
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    ctx.errors.push({
      message: `Type inference did not converge after ${MAX_ITERATIONS} iterations`,
      line: 0,
      column: 0,
    });
  }

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [],
    cfg,
    blockEntryStates: ctx.blockEntryStates,
    blockExitStates: ctx.blockExitStates,
    iterations,
  };
}
