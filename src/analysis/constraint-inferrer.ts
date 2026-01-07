/**
 * Constraint-Based Type Inferrer
 *
 * Main entry point for constraint-based type inference.
 * This integrates the constraint system with the existing analysis infrastructure.
 */

import type * as t from '@babel/types';
import type { Type, TypeAnnotationResult, TypeAnnotation, ScopeInfo } from '../types/index.js';
import {
  ConstraintGenerator,
  ConstraintSolver,
  type ConstraintSet,
  type SolveResult,
  type ConstraintType,
} from '../constraint/index.js';
import { SubstitutionBuilder } from '../constraint/substitution.js';
import { formatType } from '../output/formatter.js';
import { Types } from '../utils/type-factory.js';

/**
 * Result of constraint-based type inference
 */
export interface ConstraintInferenceResult {
  /** Type annotations for the source code */
  annotations: TypeAnnotationResult;
  /** The generated constraint set */
  constraints: ConstraintSet;
  /** The solve result (substitution or errors) */
  solveResult: SolveResult;
  /** Statistics */
  stats: {
    constraintCount: number;
    typeVarCount: number;
    solveTimeMs: number;
    success: boolean;
  };
}

/**
 * Run constraint-based type inference on an AST
 */
export function inferTypesWithConstraints(
  ast: t.File,
  source: string,
  filename: string = 'unknown'
): ConstraintInferenceResult {
  const startTime = performance.now();

  // Phase 1: Generate constraints
  const generator = new ConstraintGenerator(filename);
  const constraintSet = generator.generateProgram(ast.program);

  // Phase 2: Solve constraints
  const solver = new ConstraintSolver({
    maxIterations: 100,
    allowImplicitAny: true,
    strictNullChecks: false,
  });
  const solveResult = solver.solve(constraintSet.constraints);

  const solveTime = performance.now() - startTime;

  // Phase 3: Reconstruct types and create annotations
  const annotations = reconstructTypes(
    constraintSet,
    solveResult,
    source,
    filename
  );

  return {
    annotations,
    constraints: constraintSet,
    solveResult,
    stats: {
      constraintCount: constraintSet.constraints.length,
      typeVarCount: constraintSet.typeVars.length,
      solveTimeMs: solveTime,
      success: solveResult.success,
    },
  };
}

/**
 * Reconstruct concrete types from solved constraints
 */
function reconstructTypes(
  constraintSet: ConstraintSet,
  solveResult: SolveResult,
  source: string,
  filename: string
): TypeAnnotationResult {
  const annotations: TypeAnnotation[] = [];
  const errors: Array<{ message: string; line: number; column: number }> = [];
  const scopes: ScopeInfo[] = [];

  if (!solveResult.success) {
    // Add solve errors
    for (const error of solveResult.errors) {
      errors.push({
        message: error.message,
        line: error.source.line,
        column: error.source.column,
      });
    }

    // Still try to reconstruct what we can
    return {
      annotations,
      source,
      filename,
      errors,
      scopes,
    };
  }

  // Apply substitution to all node types
  const subst = SubstitutionBuilder.from(
    solveResult.substitution.mapping as Map<number, ConstraintType>
  );

  for (const [node, type] of constraintSet.nodeTypes) {
    const resolvedType = subst.apply(type);

    // Convert to concrete Type
    const concreteType = toConcreteType(resolvedType);

    const annotation: TypeAnnotation = {
      start: node.start ?? 0,
      end: node.end ?? 0,
      line: node.loc?.start.line ?? 0,
      column: node.loc?.start.column ?? 0,
      nodeType: node.type,
      name: 'name' in node && typeof node.name === 'string' ? node.name : undefined,
      type: concreteType,
      typeString: formatType(concreteType),
      kind: getAnnotationKind(node),
    };

    annotations.push(annotation);
  }

  // Sort annotations by position
  annotations.sort((a, b) => a.start - b.start);

  return {
    annotations,
    source,
    filename,
    errors,
    scopes,
  };
}

/**
 * Convert a ConstraintType to a concrete Type
 * Handles type variables by defaulting to 'any'
 */
function toConcreteType(type: ConstraintType): Type {
  if (type.kind === 'typevar') {
    // Unresolved type variable - default to any
    return Types.any(`unresolved type variable ${type.name}`);
  }

  if (type.kind === 'scheme') {
    // Instantiate with any
    return toConcreteType(type.body);
  }

  if (type.kind === 'app') {
    // Convert type application to concrete type
    if (type.constructor === 'Array') {
      const elemType = type.args[0] ? toConcreteType(type.args[0]) : Types.any();
      return Types.array(elemType);
    }
    // Other type applications - return any
    return Types.any(`unhandled type application ${type.constructor}`);
  }

  if (type.kind === 'row') {
    // Convert row type to object type
    const properties = new Map<string, ReturnType<typeof Types.property>>();
    for (const [name, fieldType] of type.fields) {
      properties.set(name, Types.property(toConcreteType(fieldType)));
    }
    return Types.object({ properties });
  }

  // Recursively convert compound types
  if (type.kind === 'function') {
    return Types.function({
      params: type.params.map(p => Types.param(p.name, toConcreteType(p.type), {
        optional: p.optional,
        rest: p.rest,
      })),
      returnType: toConcreteType(type.returnType),
      isAsync: type.isAsync,
      isGenerator: type.isGenerator,
    });
  }

  if (type.kind === 'array') {
    const elemType = toConcreteType(type.elementType);
    if (type.tuple) {
      return Types.tuple(type.tuple.map(toConcreteType));
    }
    return Types.array(elemType);
  }

  if (type.kind === 'object') {
    const properties = new Map<string, ReturnType<typeof Types.property>>();
    for (const [name, prop] of type.properties) {
      properties.set(name, Types.property(toConcreteType(prop.type)));
    }
    return Types.object({ properties });
  }

  if (type.kind === 'union') {
    return Types.union(type.members.map(toConcreteType));
  }

  if (type.kind === 'intersection') {
    return Types.intersection(type.members.map(toConcreteType));
  }

  if (type.kind === 'class') {
    return Types.class({
      name: type.name,
      constructor: toConcreteType(type.constructor) as any,
      instanceType: toConcreteType(type.instanceType) as any,
      staticProperties: new Map(
        Array.from(type.staticProperties.entries()).map(
          ([k, v]) => [k, Types.property(toConcreteType(v.type))]
        )
      ),
    });
  }

  if (type.kind === 'promise') {
    return Types.promise(toConcreteType(type.resolvedType));
  }

  // Primitive types - return as-is (they are compatible)
  return type as Type;
}

/**
 * Determine the annotation kind for a node
 */
function getAnnotationKind(node: t.Node): TypeAnnotation['kind'] {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return 'function';
    case 'ClassDeclaration':
    case 'ClassExpression':
      return 'class';
    case 'VariableDeclarator':
      return 'variable';
    case 'Identifier':
      // Could be variable, parameter, or property
      return 'variable';
    default:
      return 'expression';
  }
}

/**
 * Simple constraint-based inference that returns just annotations
 */
export function inferTypesConstraintBased(
  ast: t.File,
  source: string,
  filename: string = 'unknown'
): TypeAnnotationResult {
  const result = inferTypesWithConstraints(ast, source, filename);
  return result.annotations;
}
