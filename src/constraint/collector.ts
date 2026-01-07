/**
 * Constraint Collector - Collects constraints during AST traversal
 *
 * The collector provides a convenient API for generating constraints
 * while traversing the AST. It manages:
 * - Type variable creation
 * - Constraint storage
 * - Environment (variable bindings)
 * - Source location tracking
 */

import type * as t from '@babel/types';
import type {
  Constraint,
  ConstraintType,
  ConstraintSource,
  ConstraintSet,
  TypeVar,
  TypeScheme,
  SolveError,
  SolveWarning,
} from './types.js';
import { TypeVarManager, generalize, instantiate } from './type-variable.js';
import { Types } from '../utils/type-factory.js';

/**
 * Environment for constraint generation.
 * Maps variable names to their types (or type schemes for polymorphic values).
 */
export class ConstraintEnv {
  private bindings: Map<string, TypeScheme | ConstraintType>;
  private parent: ConstraintEnv | null;

  constructor(parent: ConstraintEnv | null = null) {
    this.bindings = new Map();
    this.parent = parent;
  }

  /**
   * Create a new child environment
   */
  extend(): ConstraintEnv {
    return new ConstraintEnv(this);
  }

  /**
   * Bind a variable to a type
   */
  bind(name: string, type: TypeScheme | ConstraintType): void {
    this.bindings.set(name, type);
  }

  /**
   * Look up a variable in the environment chain
   */
  lookup(name: string): TypeScheme | ConstraintType | undefined {
    const local = this.bindings.get(name);
    if (local !== undefined) {
      return local;
    }
    if (this.parent) {
      return this.parent.lookup(name);
    }
    return undefined;
  }

  /**
   * Check if a variable is bound in this environment (not parents)
   */
  hasLocal(name: string): boolean {
    return this.bindings.has(name);
  }

  /**
   * Get all bindings in this environment (not parents)
   */
  localBindings(): ReadonlyMap<string, TypeScheme | ConstraintType> {
    return this.bindings;
  }

  /**
   * Get all free type variables in the environment
   */
  freeTypeVars(): Set<number> {
    const result = new Set<number>();

    const collectFree = (type: TypeScheme | ConstraintType): void => {
      if (type.kind === 'typevar') {
        // TypeVar from constraint system has numeric id
        result.add((type as TypeVar).id);
        return;
      }
      if (type.kind === 'scheme') {
        // Free vars in scheme = free in body - quantified
        const bound = new Set(type.quantified.map(v => v.id));
        collectTypeVars(type.body, result, bound);
        return;
      }
      collectTypeVars(type, result, new Set());
    };

    for (const type of this.bindings.values()) {
      collectFree(type);
    }
    if (this.parent) {
      for (const id of this.parent.freeTypeVars()) {
        result.add(id);
      }
    }

    return result;
  }
}

/**
 * Helper to collect type variables from a type
 */
function collectTypeVars(type: ConstraintType, result: Set<number>, bound: Set<number>): void {
  if (type.kind === 'typevar') {
    const tv = type as TypeVar;
    if (!bound.has(tv.id)) {
      result.add(tv.id);
    }
    return;
  }
  if (type.kind === 'function') {
    type.params.forEach(p => collectTypeVars(p.type, result, bound));
    collectTypeVars(type.returnType, result, bound);
    return;
  }
  if (type.kind === 'array') {
    collectTypeVars(type.elementType, result, bound);
    return;
  }
  if (type.kind === 'object') {
    for (const prop of type.properties.values()) {
      collectTypeVars(prop.type, result, bound);
    }
    return;
  }
  if (type.kind === 'union' || type.kind === 'intersection') {
    type.members.forEach(m => collectTypeVars(m, result, bound));
    return;
  }
}

/**
 * Main constraint collector class.
 * Provides methods for adding various constraint types during AST traversal.
 */
export class ConstraintCollector {
  private constraints: Constraint[] = [];
  private typeVars: TypeVar[] = [];
  private nodeTypes: Map<t.Node, ConstraintType> = new Map();
  private errors: SolveError[] = [];
  private warnings: SolveWarning[] = [];

  readonly typeVarManager: TypeVarManager;
  private currentFile: string;

  constructor(file: string = 'unknown') {
    this.typeVarManager = new TypeVarManager();
    this.currentFile = file;
  }

  // ===========================================================================
  // Type Variable Creation
  // ===========================================================================

  /**
   * Create a fresh type variable
   */
  fresh(prefix?: string, node?: t.Node): TypeVar {
    const source = node ? this.sourceFromNode(node, 'fresh type variable') : undefined;
    const tv = this.typeVarManager.fresh(prefix, source);
    this.typeVars.push(tv);
    return tv;
  }

  /**
   * Create a fresh type variable for a specific purpose
   */
  freshFor(purpose: 'return' | 'param' | 'element' | 'property' | 'result', node?: t.Node): TypeVar {
    const source = node ? this.sourceFromNode(node, `${purpose} type`) : undefined;
    const tv = this.typeVarManager.freshFor(purpose, source);
    this.typeVars.push(tv);
    return tv;
  }

  // ===========================================================================
  // Constraint Addition
  // ===========================================================================

  /**
   * Add an equality constraint: τ₁ = τ₂
   */
  equal(left: ConstraintType, right: ConstraintType, node: t.Node, description: string): void {
    this.constraints.push({
      kind: 'equality',
      left,
      right,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a subtype constraint: sub <: sup
   */
  subtype(sub: ConstraintType, sup: ConstraintType, node: t.Node, description: string): void {
    this.constraints.push({
      kind: 'subtype',
      sub,
      sup,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a property constraint: obj has property prop of type propType
   */
  hasProperty(
    obj: ConstraintType,
    prop: string,
    propType: ConstraintType,
    access: 'read' | 'write',
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'has-property',
      object: obj,
      property: prop,
      propertyType: propType,
      access,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add an index constraint: obj[index] has type elemType
   */
  hasIndex(
    obj: ConstraintType,
    index: ConstraintType,
    elemType: ConstraintType,
    access: 'read' | 'write',
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'has-index',
      object: obj,
      index,
      elementType: elemType,
      access,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a callable constraint: callee(args) returns returnType
   */
  callable(
    callee: ConstraintType,
    args: readonly ConstraintType[],
    returnType: ConstraintType,
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'callable',
      callee,
      args,
      returnType,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a constructable constraint: new ctor(args) returns instanceType
   */
  constructable(
    ctor: ConstraintType,
    args: readonly ConstraintType[],
    instanceType: ConstraintType,
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'constructable',
      constructor: ctor,
      args,
      instanceType,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add an array element constraint
   */
  arrayElement(
    array: ConstraintType,
    element: ConstraintType,
    operation: 'read' | 'write' | 'push' | 'spread',
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'array-element',
      array,
      element,
      operation,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a union member constraint
   */
  unionMember(member: ConstraintType, union: ConstraintType, node: t.Node, description: string): void {
    this.constraints.push({
      kind: 'union-member',
      member,
      union,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a conditional constraint
   */
  conditional(
    condition: Constraint,
    consequent: Constraint[],
    alternate: Constraint[],
    node: t.Node,
    description: string
  ): void {
    this.constraints.push({
      kind: 'conditional',
      condition,
      consequent,
      alternate,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a conjunction constraint (all must hold)
   */
  conjunction(constraints: Constraint[], node: t.Node, description: string): void {
    this.constraints.push({
      kind: 'conjunction',
      constraints,
      source: this.sourceFromNode(node, description),
    });
  }

  /**
   * Add a disjunction constraint (at least one must hold)
   */
  disjunction(constraints: Constraint[], node: t.Node, description: string): void {
    this.constraints.push({
      kind: 'disjunction',
      constraints,
      source: this.sourceFromNode(node, description),
    });
  }

  // ===========================================================================
  // Special Constraints for Common Patterns
  // ===========================================================================

  /**
   * Add constraints for the + operator (number addition or string concatenation)
   */
  addPlusConstraint(
    left: ConstraintType,
    right: ConstraintType,
    result: ConstraintType,
    node: t.Node
  ): void {
    // + is either (number, number) => number or (string, any) => string or (any, string) => string
    this.disjunction(
      [
        // Number addition
        {
          kind: 'conjunction',
          constraints: [
            { kind: 'subtype', sub: left, sup: Types.number, source: this.sourceFromNode(node, 'numeric +') },
            { kind: 'subtype', sub: right, sup: Types.number, source: this.sourceFromNode(node, 'numeric +') },
            { kind: 'equality', left: result, right: Types.number, source: this.sourceFromNode(node, 'numeric +') },
          ],
          source: this.sourceFromNode(node, 'numeric addition'),
        },
        // String concatenation (left is string)
        {
          kind: 'conjunction',
          constraints: [
            { kind: 'subtype', sub: left, sup: Types.string, source: this.sourceFromNode(node, 'string +') },
            { kind: 'equality', left: result, right: Types.string, source: this.sourceFromNode(node, 'string +') },
          ],
          source: this.sourceFromNode(node, 'string concatenation'),
        },
        // String concatenation (right is string)
        {
          kind: 'conjunction',
          constraints: [
            { kind: 'subtype', sub: right, sup: Types.string, source: this.sourceFromNode(node, 'string +') },
            { kind: 'equality', left: result, right: Types.string, source: this.sourceFromNode(node, 'string +') },
          ],
          source: this.sourceFromNode(node, 'string concatenation'),
        },
      ],
      node,
      '+ operator'
    );
  }

  /**
   * Add constraint for arr.push(elem) - element becomes part of array
   */
  addPushConstraint(
    array: ConstraintType,
    element: ConstraintType,
    node: t.Node
  ): void {
    this.arrayElement(array, element, 'push', node, 'Array.push');
  }

  /**
   * Add constraint for spread into array: [...arr]
   */
  addSpreadConstraint(
    source: ConstraintType,
    targetElement: ConstraintType,
    node: t.Node
  ): void {
    this.arrayElement(source, targetElement, 'spread', node, 'spread into array');
  }

  // ===========================================================================
  // Node Type Registration
  // ===========================================================================

  /**
   * Register the type for an AST node
   */
  registerNodeType(node: t.Node, type: ConstraintType): void {
    this.nodeTypes.set(node, type);
  }

  /**
   * Get the registered type for an AST node
   */
  getNodeType(node: t.Node): ConstraintType | undefined {
    return this.nodeTypes.get(node);
  }

  // ===========================================================================
  // Error/Warning Reporting
  // ===========================================================================

  /**
   * Report an error
   */
  error(message: string, node: t.Node, kind: SolveError['kind'] = 'unsatisfiable'): void {
    this.errors.push({
      kind,
      message,
      source: this.sourceFromNode(node, message),
    });
  }

  /**
   * Report a warning
   */
  warning(message: string, node: t.Node, kind: SolveWarning['kind'] = 'implicit-any'): void {
    this.warnings.push({
      kind,
      message,
      source: this.sourceFromNode(node, message),
    });
  }

  // ===========================================================================
  // Scope Management
  // ===========================================================================

  /**
   * Enter a new scope (for let-polymorphism)
   */
  enterScope(): void {
    this.typeVarManager.enterScope();
  }

  /**
   * Leave the current scope
   */
  leaveScope(): void {
    this.typeVarManager.leaveScope();
  }

  /**
   * Generalize a type at the current scope level
   */
  generalize(type: ConstraintType, env: ConstraintEnv): TypeScheme | ConstraintType {
    return generalize(type, this.typeVarManager.getLevel(), env.freeTypeVars());
  }

  /**
   * Instantiate a type scheme with fresh type variables
   */
  instantiate(scheme: TypeScheme | ConstraintType): ConstraintType {
    return instantiate(scheme, this.typeVarManager);
  }

  // ===========================================================================
  // Result Extraction
  // ===========================================================================

  /**
   * Get all collected constraints
   */
  getConstraints(): readonly Constraint[] {
    return this.constraints;
  }

  /**
   * Get the constraint set result
   */
  getConstraintSet(env: ConstraintEnv): ConstraintSet {
    return {
      constraints: this.constraints,
      typeVars: this.typeVars,
      nodeTypes: this.nodeTypes,
      bindings: env.localBindings(),
    };
  }

  /**
   * Get all errors
   */
  getErrors(): readonly SolveError[] {
    return this.errors;
  }

  /**
   * Get all warnings
   */
  getWarnings(): readonly SolveWarning[] {
    return this.warnings;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Create a constraint source from an AST node
   */
  private sourceFromNode(node: t.Node, description: string): ConstraintSource {
    return {
      node,
      file: this.currentFile,
      line: node.loc?.start.line ?? 0,
      column: node.loc?.start.column ?? 0,
      description,
    };
  }

  /**
   * Set the current file path
   */
  setFile(file: string): void {
    this.currentFile = file;
  }

  /**
   * Get debug statistics
   */
  getStats(): { constraints: number; typeVars: number; errors: number; warnings: number } {
    return {
      constraints: this.constraints.length,
      typeVars: this.typeVars.length,
      errors: this.errors.length,
      warnings: this.warnings.length,
    };
  }
}
