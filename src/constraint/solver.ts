/**
 * Constraint Solver - Main entry point for solving type constraints
 *
 * This module orchestrates the solving process:
 * 1. Classifies constraints by type
 * 2. Applies unification for equality constraints
 * 3. Applies subtype checking for subtype constraints
 * 4. Handles complex constraints (callable, has-property, etc.)
 * 5. Handles disjunctions and conditionals
 */

import type {
  Constraint,
  ConstraintType,
  TypeVar,
  ConstraintSource,
  SolveResult,
  SolveError,
  SolveWarning,
  EqualityConstraint,
  SubtypeConstraint,
  HasPropertyConstraint,
  HasIndexConstraint,
  CallableConstraint,
  ConstructableConstraint,
  ArrayElementConstraint,
  UnionMemberConstraint,
  DisjunctionConstraint,
  ConjunctionConstraint,
  ConditionalConstraint,
} from './types.js';
import { SubstitutionBuilder } from './substitution.js';
import { Unifier, solveEqualityConstraints } from './unification.js';
import { SubtypeSolver, solveSubtypeConstraints, leastUpperBound } from './subtyping.js';
import { CTypes } from './constraint-types-factory.js';

/**
 * Configuration for the solver
 */
export interface SolverConfig {
  /** Maximum iterations for fixpoint solving */
  maxIterations: number;
  /** Whether to allow implicit any */
  allowImplicitAny: boolean;
  /** Whether to use strict null checks */
  strictNullChecks: boolean;
}

const DEFAULT_CONFIG: SolverConfig = {
  maxIterations: 100,
  allowImplicitAny: true,
  strictNullChecks: false,
};

/**
 * Main constraint solver
 */
export class ConstraintSolver {
  private subst: SubstitutionBuilder;
  private errors: SolveError[] = [];
  private warnings: SolveWarning[] = [];
  private config: SolverConfig;

  constructor(config: Partial<SolverConfig> = {}) {
    this.subst = SubstitutionBuilder.empty();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Solve a set of constraints
   */
  solve(constraints: readonly Constraint[]): SolveResult {
    // Classify constraints
    const classified = this.classifyConstraints(constraints);

    // Phase 1: Solve equality constraints (unification)
    const eqResult = this.solveEqualities(classified.equalities);
    if (!eqResult) {
      return this.makeFailure();
    }

    // Phase 2: Solve subtype constraints
    const subResult = this.solveSubtypes(classified.subtypes);
    if (!subResult) {
      return this.makeFailure();
    }

    // Phase 3: Solve property constraints
    for (const constraint of classified.properties) {
      if (!this.solvePropertyConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 4: Solve index constraints
    for (const constraint of classified.indices) {
      if (!this.solveIndexConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 5: Solve callable constraints
    for (const constraint of classified.callables) {
      if (!this.solveCallableConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 6: Solve constructable constraints
    for (const constraint of classified.constructables) {
      if (!this.solveConstructableConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 7: Solve array element constraints
    for (const constraint of classified.arrayElements) {
      if (!this.solveArrayElementConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 8: Solve union member constraints
    for (const constraint of classified.unionMembers) {
      if (!this.solveUnionMemberConstraint(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 9: Solve conjunctions
    for (const constraint of classified.conjunctions) {
      if (!this.solveConjunction(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 10: Solve disjunctions
    for (const constraint of classified.disjunctions) {
      if (!this.solveDisjunction(constraint)) {
        return this.makeFailure();
      }
    }

    // Phase 11: Solve conditionals
    for (const constraint of classified.conditionals) {
      if (!this.solveConditional(constraint)) {
        return this.makeFailure();
      }
    }

    return {
      success: true,
      substitution: this.subst.toImmutable(),
      warnings: this.warnings,
    };
  }

  /**
   * Classify constraints by type for phased solving
   */
  private classifyConstraints(constraints: readonly Constraint[]): ClassifiedConstraints {
    const result: ClassifiedConstraints = {
      equalities: [],
      subtypes: [],
      properties: [],
      indices: [],
      callables: [],
      constructables: [],
      arrayElements: [],
      unionMembers: [],
      conjunctions: [],
      disjunctions: [],
      conditionals: [],
    };

    for (const c of constraints) {
      switch (c.kind) {
        case 'equality':
          result.equalities.push(c);
          break;
        case 'subtype':
          result.subtypes.push(c);
          break;
        case 'has-property':
          result.properties.push(c);
          break;
        case 'has-index':
          result.indices.push(c);
          break;
        case 'callable':
          result.callables.push(c);
          break;
        case 'constructable':
          result.constructables.push(c);
          break;
        case 'array-element':
          result.arrayElements.push(c);
          break;
        case 'union-member':
          result.unionMembers.push(c);
          break;
        case 'conjunction':
          result.conjunctions.push(c);
          break;
        case 'disjunction':
          result.disjunctions.push(c);
          break;
        case 'conditional':
          result.conditionals.push(c);
          break;
      }
    }

    return result;
  }

  /**
   * Solve equality constraints using unification
   */
  private solveEqualities(constraints: EqualityConstraint[]): boolean {
    const result = solveEqualityConstraints(constraints, this.subst);
    if (result.success) {
      this.subst = result.substitution;
      return true;
    }
    this.errors.push(result.error);
    return false;
  }

  /**
   * Solve subtype constraints
   */
  private solveSubtypes(constraints: SubtypeConstraint[]): boolean {
    const result = solveSubtypeConstraints(constraints, this.subst);
    if (result.success) {
      this.subst = result.substitution;
      return true;
    }
    this.errors.push(result.error);
    return false;
  }

  /**
   * Solve a property constraint: obj.prop : propType
   */
  private solvePropertyConstraint(constraint: HasPropertyConstraint): boolean {
    const objType = this.subst.apply(constraint.object);
    const propType = this.subst.apply(constraint.propertyType);

    if (objType.kind === 'typevar') {
      // Object is a type variable - create an object type with the property
      const objectType = CTypes.object({
        properties: new Map([[constraint.property, CTypes.property(propType)]]),
      });
      this.subst.bind(objType as TypeVar, objectType);
      return true;
    }

    if (objType.kind === 'any') {
      // Any has any property
      return true;
    }

    if (objType.kind === 'object') {
      const prop = objType.properties.get(constraint.property);
      if (prop) {
        // Property exists - unify types
        const unifier = new Unifier(this.subst);
        if (constraint.access === 'read') {
          // Reading: property type flows to propType
          if (unifier.unify(prop.type, propType, constraint.source)) {
            this.subst = unifier.getSubstitution();
            return true;
          }
        } else {
          // Writing: propType must be subtype of property type
          const solver = new SubtypeSolver(this.subst);
          if (solver.checkSubtype(propType, prop.type, constraint.source)) {
            this.subst = solver.getSubstitution();
            return true;
          }
        }
        this.errors.push(...unifier.getErrors());
        return false;
      }

      // Property doesn't exist
      if (constraint.access === 'write') {
        // Writing to non-existent property - could be adding it
        // For now, treat as error
        this.addError('missing-property', `Property '${constraint.property}' does not exist`, constraint.source, [objType]);
        return false;
      }

      this.addError('missing-property', `Property '${constraint.property}' does not exist on type`, constraint.source, [objType]);
      return false;
    }

    if (objType.kind === 'array') {
      // Array properties
      const arrayProps: Record<string, ConstraintType> = {
        length: CTypes.number,
        push: CTypes.function({
          params: [CTypes.param('item', objType.elementType, { rest: true })],
          returnType: CTypes.number,
        }),
        pop: CTypes.function({
          params: [],
          returnType: CTypes.union([objType.elementType, CTypes.undefined]),
        }),
        // ... other array methods
      };

      const arrayProp = arrayProps[constraint.property];
      if (arrayProp) {
        const unifier = new Unifier(this.subst);
        if (unifier.unify(arrayProp, propType, constraint.source)) {
          this.subst = unifier.getSubstitution();
          return true;
        }
        this.errors.push(...unifier.getErrors());
        return false;
      }
    }

    // TODO: Handle string, function properties
    this.addError('missing-property', `Cannot access property '${constraint.property}' on type '${objType.kind}'`, constraint.source, [objType]);
    return false;
  }

  /**
   * Solve an index constraint: obj[index] : elemType
   */
  private solveIndexConstraint(constraint: HasIndexConstraint): boolean {
    const objType = this.subst.apply(constraint.object);
    const indexType = this.subst.apply(constraint.index);
    const elemType = this.subst.apply(constraint.elementType);

    if (objType.kind === 'typevar') {
      // Assume it's an array
      const arrayType = CTypes.array(elemType);
      this.subst.bind(objType as TypeVar, arrayType);
      return true;
    }

    if (objType.kind === 'any') {
      return true;
    }

    if (objType.kind === 'array') {
      const unifier = new Unifier(this.subst);
      if (constraint.access === 'read') {
        // Reading: element type flows to elemType
        // Include undefined for out-of-bounds access
        const readType = CTypes.union([objType.elementType, CTypes.undefined]);
        if (unifier.unify(readType, elemType, constraint.source)) {
          this.subst = unifier.getSubstitution();
          return true;
        }
      } else {
        // Writing: elemType must be subtype of element type
        const solver = new SubtypeSolver(this.subst);
        if (solver.checkSubtype(elemType, objType.elementType, constraint.source)) {
          this.subst = solver.getSubstitution();
          return true;
        }
      }
      this.errors.push(...unifier.getErrors());
      return false;
    }

    if (objType.kind === 'object') {
      // Object indexing with string key
      if (indexType.kind === 'string' && indexType.value !== undefined) {
        // Known property name
        const prop = objType.properties.get(indexType.value);
        if (prop) {
          const unifier = new Unifier(this.subst);
          if (unifier.unify(prop.type, elemType, constraint.source)) {
            this.subst = unifier.getSubstitution();
            return true;
          }
          this.errors.push(...unifier.getErrors());
          return false;
        }
      }
      // Dynamic property access - return any
      if (this.config.allowImplicitAny) {
        const unifier = new Unifier(this.subst);
        if (unifier.unify(CTypes.any(), elemType, constraint.source)) {
          this.subst = unifier.getSubstitution();
          return true;
        }
      }
    }

    this.addError('incompatible-types', `Cannot index type '${objType.kind}'`, constraint.source, [objType]);
    return false;
  }

  /**
   * Solve a callable constraint: callee(args) : returnType
   */
  private solveCallableConstraint(constraint: CallableConstraint): boolean {
    const calleeType = this.subst.apply(constraint.callee);
    const argTypes = constraint.args.map(a => this.subst.apply(a));
    const returnType = this.subst.apply(constraint.returnType);

    if (calleeType.kind === 'typevar') {
      // Create a function type
      const funcType = CTypes.function({
        params: argTypes.map((t, i) => CTypes.param(`arg${i}`, t)),
        returnType,
      });
      this.subst.bind(calleeType as TypeVar, funcType);
      return true;
    }

    if (calleeType.kind === 'any') {
      return true;
    }

    if (calleeType.kind === 'function') {
      // Check argument count
      const minParams = calleeType.params.filter(p => !p.optional && !p.rest).length;
      const maxParams = calleeType.params.some(p => p.rest)
        ? Infinity
        : calleeType.params.length;

      if (argTypes.length < minParams) {
        this.addError('argument-count', `Expected at least ${minParams} arguments, got ${argTypes.length}`, constraint.source);
        return false;
      }

      if (argTypes.length > maxParams) {
        this.addError('argument-count', `Expected at most ${maxParams} arguments, got ${argTypes.length}`, constraint.source);
        return false;
      }

      // Check argument types (contravariance)
      for (let i = 0; i < argTypes.length; i++) {
        const param = calleeType.params[i];
        if (param) {
          const solver = new SubtypeSolver(this.subst);
          if (!solver.checkSubtype(argTypes[i]!, param.type, constraint.source)) {
            this.errors.push(...solver.getErrors());
            return false;
          }
          this.subst = solver.getSubstitution();
        }
      }

      // Unify return type
      const unifier = new Unifier(this.subst);
      if (unifier.unify(calleeType.returnType, returnType, constraint.source)) {
        this.subst = unifier.getSubstitution();
        return true;
      }
      this.errors.push(...unifier.getErrors());
      return false;
    }

    this.addError('not-callable', `Type '${calleeType.kind}' is not callable`, constraint.source, [calleeType]);
    return false;
  }

  /**
   * Solve a constructable constraint: new ctor(args) : instanceType
   */
  private solveConstructableConstraint(constraint: ConstructableConstraint): boolean {
    const ctorType = this.subst.apply(constraint.constructor);
    const argTypes = constraint.args.map(a => this.subst.apply(a));
    const instanceType = this.subst.apply(constraint.instanceType);

    if (ctorType.kind === 'typevar') {
      // Create a class type
      const classType = CTypes.class({
        name: 'Anonymous',
        constructor: CTypes.function({
          params: argTypes.map((t, i) => CTypes.param(`arg${i}`, t)),
          returnType: CTypes.undefined,
        }),
        instanceType: instanceType.kind === 'object' ? instanceType as any : CTypes.object({}),
        staticProperties: new Map(),
      });
      this.subst.bind(ctorType as TypeVar, classType);
      return true;
    }

    if (ctorType.kind === 'class') {
      // Unify instance type
      const unifier = new Unifier(this.subst);
      if (unifier.unify(ctorType.instanceType, instanceType, constraint.source)) {
        this.subst = unifier.getSubstitution();
        return true;
      }
      this.errors.push(...unifier.getErrors());
      return false;
    }

    if (ctorType.kind === 'function') {
      // Function used as constructor
      // The instance type is typically inferred from this.xxx assignments
      // For now, treat return type as instance type hint
      return true;
    }

    this.addError('not-constructable', `Type '${ctorType.kind}' is not constructable`, constraint.source, [ctorType]);
    return false;
  }

  /**
   * Solve an array element constraint
   */
  private solveArrayElementConstraint(constraint: ArrayElementConstraint): boolean {
    const arrayType = this.subst.apply(constraint.array);
    const elemType = this.subst.apply(constraint.element);

    if (arrayType.kind === 'typevar') {
      // Create array type with element
      const newArrayType = CTypes.array(elemType);
      this.subst.bind(arrayType as TypeVar, newArrayType);
      return true;
    }

    if (arrayType.kind === 'array') {
      switch (constraint.operation) {
        case 'read':
          // Element must be compatible with array element type
          const unifier = new Unifier(this.subst);
          if (unifier.unify(arrayType.elementType, elemType, constraint.source)) {
            this.subst = unifier.getSubstitution();
            return true;
          }
          this.errors.push(...unifier.getErrors());
          return false;

        case 'write':
        case 'push':
          // Element type is added to array element type
          // This requires widening the array's element type
          const newElemType = leastUpperBound(arrayType.elementType, elemType);
          // Update the array type if the element type changed
          if (newElemType !== arrayType.elementType) {
            // This is where we'd update the array type in the environment
            // For now, just check subtype
            const solver = new SubtypeSolver(this.subst);
            if (solver.checkSubtype(elemType, arrayType.elementType, constraint.source)) {
              this.subst = solver.getSubstitution();
              return true;
            }
            // If not a subtype, the array element type needs widening
            // This is handled by the constraint collector tracking all writes
          }
          return true;

        case 'spread':
          // Source array's elements flow into target
          const spreadUnifier = new Unifier(this.subst);
          if (spreadUnifier.unify(arrayType.elementType, elemType, constraint.source)) {
            this.subst = spreadUnifier.getSubstitution();
            return true;
          }
          this.errors.push(...spreadUnifier.getErrors());
          return false;
      }
    }

    this.addError('incompatible-types', `Type '${arrayType.kind}' is not an array`, constraint.source, [arrayType]);
    return false;
  }

  /**
   * Solve a union member constraint
   */
  private solveUnionMemberConstraint(constraint: UnionMemberConstraint): boolean {
    const memberType = this.subst.apply(constraint.member);
    const unionType = this.subst.apply(constraint.union);

    if (unionType.kind === 'typevar') {
      // Union is a type variable - bind to include member
      this.subst.bind(unionType as TypeVar, memberType);
      return true;
    }

    if (unionType.kind === 'union') {
      // Check if member is a subtype of any union member
      for (const m of unionType.members) {
        const solver = new SubtypeSolver(this.subst.clone());
        if (solver.checkSubtype(memberType, m, constraint.source)) {
          return true;
        }
      }
      this.addError('incompatible-types', `Type is not a member of union`, constraint.source, [memberType, unionType]);
      return false;
    }

    // Union is a concrete type - member must be subtype
    const solver = new SubtypeSolver(this.subst);
    if (solver.checkSubtype(memberType, unionType, constraint.source)) {
      this.subst = solver.getSubstitution();
      return true;
    }
    this.errors.push(...solver.getErrors());
    return false;
  }

  /**
   * Solve a conjunction (all constraints must hold)
   */
  private solveConjunction(constraint: ConjunctionConstraint): boolean {
    // Solve all sub-constraints
    const subSolver = new ConstraintSolver(this.config);
    subSolver.subst = this.subst.clone();

    const result = subSolver.solve(constraint.constraints);
    if (result.success) {
      this.subst = SubstitutionBuilder.from(result.substitution.mapping as Map<number, ConstraintType>);
      return true;
    }
    this.errors.push(...subSolver.errors);
    return false;
  }

  /**
   * Solve a disjunction (at least one must hold)
   */
  private solveDisjunction(constraint: DisjunctionConstraint): boolean {
    // Try each alternative
    for (const alt of constraint.constraints) {
      const subSolver = new ConstraintSolver(this.config);
      subSolver.subst = this.subst.clone();

      const result = subSolver.solve([alt]);
      if (result.success) {
        this.subst = SubstitutionBuilder.from(result.substitution.mapping as Map<number, ConstraintType>);
        return true;
      }
    }

    this.addError('unsatisfiable', `No alternative in disjunction is satisfiable`, constraint.source);
    return false;
  }

  /**
   * Solve a conditional constraint
   */
  private solveConditional(constraint: ConditionalConstraint): boolean {
    // Try to solve the condition
    const condSolver = new ConstraintSolver(this.config);
    condSolver.subst = this.subst.clone();

    const condResult = condSolver.solve([constraint.condition]);

    if (condResult.success) {
      // Condition holds - solve consequent
      this.subst = SubstitutionBuilder.from(condResult.substitution.mapping as Map<number, ConstraintType>);
      return this.solve(constraint.consequent).success;
    } else {
      // Condition doesn't hold - solve alternate
      return this.solve(constraint.alternate).success;
    }
  }

  /**
   * Add an error
   */
  private addError(
    kind: SolveError['kind'],
    message: string,
    source: ConstraintSource,
    types?: ConstraintType[]
  ): void {
    this.errors.push({ kind, message, source, types });
  }

  /**
   * Make a failure result
   */
  private makeFailure(): SolveResult {
    return {
      success: false,
      errors: this.errors,
    };
  }

  /**
   * Get the current substitution
   */
  getSubstitution(): SubstitutionBuilder {
    return this.subst;
  }
}

/**
 * Classified constraints for phased solving
 */
interface ClassifiedConstraints {
  equalities: EqualityConstraint[];
  subtypes: SubtypeConstraint[];
  properties: HasPropertyConstraint[];
  indices: HasIndexConstraint[];
  callables: CallableConstraint[];
  constructables: ConstructableConstraint[];
  arrayElements: ArrayElementConstraint[];
  unionMembers: UnionMemberConstraint[];
  conjunctions: ConjunctionConstraint[];
  disjunctions: DisjunctionConstraint[];
  conditionals: ConditionalConstraint[];
}

/**
 * Convenience function to solve constraints
 */
export function solveConstraints(
  constraints: readonly Constraint[],
  config?: Partial<SolverConfig>
): SolveResult {
  const solver = new ConstraintSolver(config);
  return solver.solve(constraints);
}
