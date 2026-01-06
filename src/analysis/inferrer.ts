/**
 * Type Inferrer - Core type inference engine
 *
 * Performs flow-sensitive type inference on JavaScript AST.
 * Identifies which nodes need types and infers their types.
 */

import * as t from '@babel/types';
import type { Type, TypeEnvironment, Binding, ScopeKind, ArrayType } from '../types/index.js';
import type { TypeAnnotation, TypeAnnotationResult, AnnotationKind } from '../types/annotation.js';
import { Types } from '../utils/type-factory.js';
import { formatType } from '../output/formatter.js';

/**
 * Helper to check if type is array
 */
function isArrayType(type: Type): type is ArrayType {
  return type.kind === 'array';
}

/**
 * Type inference context
 */
interface InferContext {
  /** Current type environment */
  env: TypeEnvironment;
  /** Collected annotations */
  annotations: TypeAnnotation[];
  /** Collected errors */
  errors: Array<{ message: string; line: number; column: number; nodeType?: string }>;
  /** Source code */
  source: string;
  /** Filename */
  filename: string;
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
 * Lookup a binding in the environment chain
 */
function lookupBinding(env: TypeEnvironment, name: string): Binding | undefined {
  const binding = env.bindings.get(name);
  if (binding) return binding;
  if (env.parent) return lookupBinding(env.parent, name);
  return undefined;
}

/**
 * Add a binding to the current environment
 */
function addBinding(
  env: TypeEnvironment,
  name: string,
  type: Type,
  kind: Binding['kind'],
  node: t.Node
): TypeEnvironment {
  const newBindings = new Map(env.bindings);
  newBindings.set(name, {
    name,
    type,
    declarationNode: node,
    kind,
    definitelyAssigned: true,
    possiblyMutated: false,
  });
  return {
    ...env,
    bindings: newBindings,
  };
}

/**
 * Infer types for an entire program/file
 */
export function inferTypes(ast: t.File, source: string, filename: string): TypeAnnotationResult {
  const ctx: InferContext = {
    env: createEnv(null, 'module'),
    annotations: [],
    errors: [],
    source,
    filename,
  };

  // Add global/built-in bindings
  ctx.env = addBuiltins(ctx.env);

  // Traverse the AST using simple recursive traversal
  traverseProgram(ast.program, ctx);

  return {
    filename,
    source,
    annotations: ctx.annotations.sort((a, b) => a.start - b.start),
    errors: ctx.errors,
    scopes: [], // TODO: collect scope info
  };
}

/**
 * Simple AST traversal for type inference
 */
function traverseProgram(program: t.Program, ctx: InferContext): void {
  for (const stmt of program.body) {
    traverseStatement(stmt, ctx);
  }
}

function traverseStatement(stmt: t.Statement, ctx: InferContext): void {
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
 * Add built-in global bindings
 */
function addBuiltins(env: TypeEnvironment): TypeEnvironment {
  const builtins: Array<[string, Type]> = [
    ['undefined', Types.undefined],
    ['NaN', Types.number],
    ['Infinity', Types.number],
    ['console', Types.object({
      properties: new Map([
        ['log', Types.property(Types.function({ params: [Types.param('args', Types.any(), { rest: true })], returnType: Types.undefined }))],
        ['error', Types.property(Types.function({ params: [Types.param('args', Types.any(), { rest: true })], returnType: Types.undefined }))],
        ['warn', Types.property(Types.function({ params: [Types.param('args', Types.any(), { rest: true })], returnType: Types.undefined }))],
      ]),
    })],
    ['Math', Types.object({
      properties: new Map([
        ['PI', Types.property(Types.numberLiteral(Math.PI))],
        ['E', Types.property(Types.numberLiteral(Math.E))],
        ['abs', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['floor', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['ceil', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['round', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['random', Types.property(Types.function({ params: [], returnType: Types.number }))],
        ['sqrt', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['sin', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['cos', Types.property(Types.function({ params: [Types.param('x', Types.number)], returnType: Types.number }))],
        ['pow', Types.property(Types.function({ params: [Types.param('x', Types.number), Types.param('y', Types.number)], returnType: Types.number }))],
        ['min', Types.property(Types.function({ params: [Types.param('values', Types.number, { rest: true })], returnType: Types.number }))],
        ['max', Types.property(Types.function({ params: [Types.param('values', Types.number, { rest: true })], returnType: Types.number }))],
      ]),
    })],
    ['Date', Types.class({
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
    })],
    ['print', Types.function({ params: [Types.param('args', Types.any(), { rest: true })], returnType: Types.undefined })],
    ['JSON', Types.object({
      properties: new Map([
        ['parse', Types.property(Types.function({ params: [Types.param('text', Types.string)], returnType: Types.any() }))],
        ['stringify', Types.property(Types.function({ params: [Types.param('value', Types.any())], returnType: Types.string }))],
      ]),
    })],
    ['Object', Types.function({ params: [], returnType: Types.object({}) })],
    ['Array', Types.function({ params: [], returnType: Types.array(Types.any()) })],
    ['String', Types.function({ params: [Types.param('value', Types.any())], returnType: Types.string })],
    ['Number', Types.function({ params: [Types.param('value', Types.any())], returnType: Types.number })],
    ['Boolean', Types.function({ params: [Types.param('value', Types.any())], returnType: Types.boolean })],
  ];

  let result = env;
  for (const [name, type] of builtins) {
    result = addBinding(result, name, type, 'var', { type: 'Identifier', name } as t.Identifier);
  }
  return result;
}

/**
 * Traverse expressions to find nested declarations (e.g., IIFE)
 */
function traverseExpression(expr: t.Expression | t.SpreadElement, ctx: InferContext): void {
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
function traverseFunctionBody(
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

/**
 * Handle variable declarations
 */
function handleVariableDeclaration(node: t.VariableDeclaration, ctx: InferContext): void {
  const kind = node.kind === 'const' ? 'const' : node.kind === 'let' ? 'let' : 'var';

  for (const decl of node.declarations) {
    if (t.isIdentifier(decl.id)) {
      const initType = decl.init ? inferExpression(decl.init, ctx) : Types.undefined;

      // Add to environment
      ctx.env = addBinding(ctx.env, decl.id.name, initType, kind, decl);

      // Create annotation
      addAnnotation(ctx, {
        node: decl.id,
        name: decl.id.name,
        type: initType,
        kind: kind === 'const' ? 'const' : 'variable',
      });
    } else if (t.isObjectPattern(decl.id) || t.isArrayPattern(decl.id)) {
      // Handle destructuring
      handleDestructuringPattern(decl.id, decl.init ? inferExpression(decl.init, ctx) : Types.undefined, ctx, kind);
    }
  }
}

/**
 * Handle destructuring patterns
 */
function handleDestructuringPattern(
  pattern: t.LVal,
  sourceType: Type,
  ctx: InferContext,
  kind: 'var' | 'let' | 'const'
): void {
  if (t.isIdentifier(pattern)) {
    ctx.env = addBinding(ctx.env, pattern.name, sourceType, kind, pattern);
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
          handleDestructuringPattern(prop.value, propType, ctx, kind);
        } else if (t.isAssignmentPattern(prop.value) && t.isIdentifier(prop.value.left)) {
          // Handle default value: { x = 10 }
          const defaultType = inferExpression(prop.value.right, ctx);
          const unionType = propType.kind === 'any' ? defaultType : Types.union([propType, defaultType]);
          handleDestructuringPattern(prop.value.left, unionType, ctx, kind);
        } else if (t.isObjectPattern(prop.value) || t.isArrayPattern(prop.value)) {
          handleDestructuringPattern(prop.value, propType, ctx, kind);
        }
      } else if (t.isRestElement(prop) && t.isIdentifier(prop.argument)) {
        // Rest element: { ...rest }
        handleDestructuringPattern(prop.argument, Types.object({}), ctx, kind);
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
        handleDestructuringPattern(elem, elemType, ctx, kind);
      } else if (t.isRestElement(elem) && t.isIdentifier(elem.argument)) {
        // Rest element: [a, ...rest]
        if (sourceType.kind === 'array') {
          handleDestructuringPattern(elem.argument, Types.array(sourceType.elementType), ctx, kind);
        } else {
          handleDestructuringPattern(elem.argument, Types.array(Types.any()), ctx, kind);
        }
      } else if (t.isAssignmentPattern(elem) && t.isIdentifier(elem.left)) {
        const defaultType = inferExpression(elem.right, ctx);
        const unionType = elemType.kind === 'any' ? defaultType : Types.union([elemType, defaultType]);
        handleDestructuringPattern(elem.left, unionType, ctx, kind);
      }
    }
  }
}

/**
 * Handle function declarations
 */
function handleFunctionDeclaration(node: t.FunctionDeclaration, ctx: InferContext): void {
  if (!node.id) return;

  const funcType = inferFunctionType(node, ctx);

  // Add function to environment
  ctx.env = addBinding(ctx.env, node.id.name, funcType, 'function', node);

  // Create annotation
  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: funcType,
    kind: 'function',
  });

  // Annotate parameters
  annotateParameters(node.params, funcType, ctx);

  // Traverse function body to process nested declarations
  traverseFunctionBody(node, ctx);
}

/**
 * Annotate function parameters
 */
function annotateParameters(
  params: Array<t.Identifier | t.Pattern | t.RestElement>,
  funcType: Type,
  ctx: InferContext
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
 * Handle class declarations
 */
function handleClassDeclaration(node: t.ClassDeclaration, ctx: InferContext): void {
  if (!node.id) return;

  const classType = inferClassType(node, ctx);

  ctx.env = addBinding(ctx.env, node.id.name, classType, 'class', node);

  addAnnotation(ctx, {
    node: node.id,
    name: node.id.name,
    type: classType,
    kind: 'class',
  });
}

/**
 * Handle assignment expressions
 */
function handleAssignment(node: t.AssignmentExpression, ctx: InferContext): void {
  if (t.isIdentifier(node.left)) {
    const binding = lookupBinding(ctx.env, node.left.name);
    if (binding && binding.kind === 'const') {
      ctx.errors.push({
        message: `Cannot assign to constant '${node.left.name}'`,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
        nodeType: 'AssignmentExpression',
      });
    }
  }
}

/**
 * Infer type of an expression
 */
function inferExpression(expr: t.Expression | t.SpreadElement, ctx: InferContext): Type {
  if (t.isSpreadElement(expr)) {
    const argType = inferExpression(expr.argument, ctx);
    return argType;
  }

  switch (expr.type) {
    // Literals
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
      return Types.object({ properties: new Map() }); // RegExp object

    // Template literals
    case 'TemplateLiteral':
      if (expr.expressions.length === 0 && expr.quasis.length === 1) {
        return Types.stringLiteral(expr.quasis[0]!.value.cooked ?? '');
      }
      return Types.string;

    // Identifier
    case 'Identifier':
      const binding = lookupBinding(ctx.env, expr.name);
      return binding?.type ?? Types.any(`undefined variable '${expr.name}'`);

    // Array
    case 'ArrayExpression':
      return inferArrayExpression(expr, ctx);

    // Object
    case 'ObjectExpression':
      return inferObjectExpression(expr, ctx);

    // Function expressions
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return inferFunctionType(expr, ctx);

    // Binary expressions
    case 'BinaryExpression':
      return inferBinaryExpression(expr, ctx);

    // Unary expressions
    case 'UnaryExpression':
      return inferUnaryExpression(expr, ctx);

    // Logical expressions
    case 'LogicalExpression':
      return inferLogicalExpression(expr, ctx);

    // Conditional expression
    case 'ConditionalExpression':
      const consequent = inferExpression(expr.consequent, ctx);
      const alternate = inferExpression(expr.alternate, ctx);
      return Types.union([consequent, alternate]);

    // Call expression
    case 'CallExpression':
      return inferCallExpression(expr, ctx);

    // New expression
    case 'NewExpression':
      return inferNewExpression(expr, ctx);

    // Member expression
    case 'MemberExpression':
      return inferMemberExpression(expr, ctx);

    // Assignment expression
    case 'AssignmentExpression':
      return inferExpression(expr.right, ctx);

    // Sequence expression
    case 'SequenceExpression':
      const last = expr.expressions[expr.expressions.length - 1];
      return last ? inferExpression(last, ctx) : Types.undefined;

    // Await expression
    case 'AwaitExpression':
      const awaitedType = inferExpression(expr.argument, ctx);
      if (awaitedType.kind === 'promise') {
        return awaitedType.resolvedType;
      }
      return awaitedType;

    // Yield expression
    case 'YieldExpression':
      return Types.any(); // Complex to infer

    // This expression
    case 'ThisExpression':
      return Types.any(); // Needs context

    // Class expression
    case 'ClassExpression':
      return inferClassType(expr, ctx);

    // Optional chaining
    case 'OptionalMemberExpression':
    case 'OptionalCallExpression':
      return Types.union([inferOptionalExpression(expr, ctx), Types.undefined]);

    // Nullish coalescing handled in LogicalExpression

    default:
      return Types.any();
  }
}

/**
 * Infer array expression type
 */
function inferArrayExpression(expr: t.ArrayExpression, ctx: InferContext): Type {
  if (expr.elements.length === 0) {
    return Types.array(Types.never); // Empty array
  }

  const elementTypes: Type[] = [];
  let hasSpread = false;

  for (const elem of expr.elements) {
    if (elem === null) {
      elementTypes.push(Types.undefined); // Hole in array
    } else if (t.isSpreadElement(elem)) {
      hasSpread = true;
      const spreadType = inferExpression(elem.argument, ctx);
      if (spreadType.kind === 'array') {
        elementTypes.push(spreadType.elementType);
      } else {
        elementTypes.push(Types.any());
      }
    } else {
      elementTypes.push(inferExpression(elem, ctx));
    }
  }

  if (hasSpread) {
    // Cannot determine exact tuple type with spread
    return Types.array(Types.union(elementTypes));
  }

  // Create tuple type for small arrays with known elements
  if (elementTypes.length <= 10) {
    return Types.tuple(elementTypes);
  }

  return Types.array(Types.union(elementTypes));
}

/**
 * Infer object expression type
 */
function inferObjectExpression(expr: t.ObjectExpression, ctx: InferContext): Type {
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
        const valueType = inferExpression(prop.value, ctx);
        properties.set(key, Types.property(valueType));
      }
    } else if (t.isObjectMethod(prop)) {
      let key: string | undefined;

      if (t.isIdentifier(prop.key)) {
        key = prop.key.name;
      }

      if (key) {
        const methodType = inferFunctionType(prop, ctx);
        properties.set(key, Types.property(methodType));
      }
    } else if (t.isSpreadElement(prop)) {
      const spreadType = inferExpression(prop.argument, ctx);
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
 * Infer function type from function node
 */
function inferFunctionType(
  node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ObjectMethod,
  ctx: InferContext
): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // Infer return type from body
  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, ctx);
  } else if (t.isExpression(node.body)) {
    // Arrow function with expression body
    returnType = inferExpression(node.body, ctx);
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
 * Infer class method type
 */
function inferClassMethodType(node: t.ClassMethod, ctx: InferContext): Type {
  const params: Array<ReturnType<typeof Types.param>> = [];

  for (const param of node.params) {
    if (t.isIdentifier(param)) {
      params.push(Types.param(param.name, Types.any()));
    } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      params.push(Types.param(param.argument.name, Types.array(Types.any()), { rest: true }));
    } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
      const defaultType = inferExpression(param.right, ctx);
      params.push(Types.param(param.left.name, defaultType, { optional: true }));
    } else if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
      params.push(Types.param('_destructured', Types.any()));
    }
  }

  // Infer return type from body
  let returnType: Type = Types.undefined;

  if (t.isBlockStatement(node.body)) {
    returnType = inferBlockReturnType(node.body, ctx);
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
 * Infer return type from function body
 */
function inferBlockReturnType(body: t.BlockStatement, ctx: InferContext): Type {
  const returnTypes: Type[] = [];

  // Simple traversal to find return statements
  for (const stmt of body.body) {
    collectReturnTypes(stmt, returnTypes, ctx);
  }

  if (returnTypes.length === 0) {
    return Types.undefined;
  }

  return Types.union(returnTypes);
}

function collectReturnTypes(node: t.Node, types: Type[], ctx: InferContext): void {
  if (t.isReturnStatement(node)) {
    if (node.argument) {
      types.push(inferExpression(node.argument, ctx));
    } else {
      types.push(Types.undefined);
    }
  } else if (t.isIfStatement(node)) {
    collectReturnTypes(node.consequent, types, ctx);
    if (node.alternate) {
      collectReturnTypes(node.alternate, types, ctx);
    }
  } else if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      collectReturnTypes(stmt, types, ctx);
    }
  } else if (t.isSwitchStatement(node)) {
    for (const c of node.cases) {
      for (const stmt of c.consequent) {
        collectReturnTypes(stmt, types, ctx);
      }
    }
  } else if (t.isTryStatement(node)) {
    collectReturnTypes(node.block, types, ctx);
    if (node.handler) {
      collectReturnTypes(node.handler.body, types, ctx);
    }
    if (node.finalizer) {
      collectReturnTypes(node.finalizer, types, ctx);
    }
  }
  // Skip loops and other control structures for simplicity
}

/**
 * Infer class type
 */
function inferClassType(node: t.ClassDeclaration | t.ClassExpression, ctx: InferContext): Type {
  const className = node.id?.name ?? 'Anonymous';
  const instanceProps = new Map<string, ReturnType<typeof Types.property>>();
  const staticProps = new Map<string, ReturnType<typeof Types.property>>();
  let ctorType = Types.function({ params: [], returnType: Types.undefined });

  for (const member of node.body.body) {
    if (t.isClassMethod(member)) {
      const methodType = inferClassMethodType(member, ctx);

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
      const propType = member.value ? inferExpression(member.value, ctx) : Types.any();

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
 * Infer binary expression type
 */
function inferBinaryExpression(expr: t.BinaryExpression, ctx: InferContext): Type {
  const left = t.isPrivateName(expr.left) ? Types.any() : inferExpression(expr.left, ctx);
  const right = inferExpression(expr.right, ctx);

  switch (expr.operator) {
    // Arithmetic
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

    // Comparison
    case '==':
    case '===':
    case '!=':
    case '!==':
    case '<':
    case '>':
    case '<=':
    case '>=':
      return Types.boolean;

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
function inferUnaryExpression(expr: t.UnaryExpression, ctx: InferContext): Type {
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
function inferLogicalExpression(expr: t.LogicalExpression, ctx: InferContext): Type {
  const left = inferExpression(expr.left, ctx);
  const right = inferExpression(expr.right, ctx);

  switch (expr.operator) {
    case '&&':
      // Returns left if falsy, otherwise right
      return Types.union([left, right]);

    case '||':
      // Returns left if truthy, otherwise right
      return Types.union([left, right]);

    case '??':
      // Returns left if not null/undefined, otherwise right
      // Remove null/undefined from left type
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
function inferCallExpression(expr: t.CallExpression, ctx: InferContext): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, ctx) : Types.any();

  if (calleeType.kind === 'function') {
    return calleeType.returnType;
  }

  return Types.any();
}

/**
 * Infer new expression type
 */
function inferNewExpression(expr: t.NewExpression, ctx: InferContext): Type {
  const calleeType = t.isExpression(expr.callee) ? inferExpression(expr.callee, ctx) : Types.any();

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
function inferMemberExpression(expr: t.MemberExpression, ctx: InferContext): Type {
  const objectType = t.isExpression(expr.object) ? inferExpression(expr.object, ctx) : Types.any();

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

  if (isArrayType(objectType)) {
    // Array index access
    if (t.isNumericLiteral(expr.property) && objectType.tuple) {
      const idx = expr.property.value;
      if (idx >= 0 && idx < objectType.tuple.length) {
        return objectType.tuple[idx]!;
      }
    }

    // Array methods
    if (propName) {
      const elemType = objectType.elementType;
      const arrayMethods: Record<string, Type> = {
        length: Types.number,
        push: Types.function({ params: [Types.param('item', elemType, { rest: true })], returnType: Types.number }),
        pop: Types.function({ params: [], returnType: Types.union([elemType, Types.undefined]) }),
        shift: Types.function({ params: [], returnType: Types.union([elemType, Types.undefined]) }),
        unshift: Types.function({ params: [Types.param('item', elemType, { rest: true })], returnType: Types.number }),
        slice: Types.function({ params: [Types.param('start', Types.number, { optional: true }), Types.param('end', Types.number, { optional: true })], returnType: Types.array(elemType) }),
        map: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.any() }))], returnType: Types.array(Types.any()) }),
        filter: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }))], returnType: Types.array(elemType) }),
        reduce: Types.function({ params: [Types.param('fn', Types.any()), Types.param('init', Types.any(), { optional: true })], returnType: Types.any() }),
        find: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }))], returnType: Types.union([elemType, Types.undefined]) }),
        includes: Types.function({ params: [Types.param('item', elemType)], returnType: Types.boolean }),
        indexOf: Types.function({ params: [Types.param('item', elemType)], returnType: Types.number }),
        join: Types.function({ params: [Types.param('sep', Types.string, { optional: true })], returnType: Types.string }),
        forEach: Types.function({ params: [Types.param('fn', Types.function({ params: [Types.param('item', elemType)], returnType: Types.undefined }))], returnType: Types.undefined }),
      };
      if (arrayMethods[propName]) {
        return arrayMethods[propName]!;
      }
    }

    return objectType.elementType;
  }

  // String methods
  if (objectType.kind === 'string' && propName) {
    const stringMethods: Record<string, Type> = {
      length: Types.number,
      charAt: Types.function({ params: [Types.param('index', Types.number)], returnType: Types.string }),
      slice: Types.function({ params: [Types.param('start', Types.number), Types.param('end', Types.number, { optional: true })], returnType: Types.string }),
      split: Types.function({ params: [Types.param('sep', Types.string)], returnType: Types.array(Types.string) }),
      toLowerCase: Types.function({ params: [], returnType: Types.string }),
      toUpperCase: Types.function({ params: [], returnType: Types.string }),
      trim: Types.function({ params: [], returnType: Types.string }),
      includes: Types.function({ params: [Types.param('search', Types.string)], returnType: Types.boolean }),
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
  ctx: InferContext
): Type {
  if (t.isOptionalMemberExpression(expr)) {
    const objectType = inferExpression(expr.object, ctx);

    let propName: string | undefined;
    if (t.isIdentifier(expr.property) && !expr.computed) {
      propName = expr.property.name;
    }

    if (propName && objectType.kind === 'object') {
      const prop = objectType.properties.get(propName);
      if (prop) return prop.type;
    }
  } else if (t.isOptionalCallExpression(expr)) {
    const calleeType = inferExpression(expr.callee, ctx);
    if (calleeType.kind === 'function') {
      return calleeType.returnType;
    }
  }

  return Types.any();
}

/**
 * Add an annotation to the context
 */
function addAnnotation(
  ctx: InferContext,
  info: {
    node: t.Node;
    name?: string;
    type: Type;
    kind: AnnotationKind;
  }
): void {
  const { node, name, type, kind } = info;
  const loc = node.loc;

  ctx.annotations.push({
    start: node.start ?? 0,
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
