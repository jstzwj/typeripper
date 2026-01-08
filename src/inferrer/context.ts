/**
 * Type Inference Context
 *
 * Based on: "Polymorphism, Subtyping, and Type Inference in MLsub"
 * (Dolan & Mycroft, POPL 2017)
 *
 * The context maintains:
 * - Type environment Π (mapping variables to typing schemes)
 * - Accumulated constraints
 * - Fresh type variable generation
 */

import type { Node } from '@babel/types';
import type {
  PolarType,
  TypeVar,
  PolyScheme,
  TypingScheme,
} from '../types/index.js';
import {
  freshTypeVar,
  freeVars,
} from '../types/index.js';
import {
  typingScheme,
  monoScheme,
  polyScheme,
  instantiate,
  instantiateType,
  generalize,
} from '../types/scheme.js';
import type {
  FlowConstraint,
  ConstraintSet,
  SourceLocation,
} from '../solver/index.js';
import {
  makeSource,
  flow,
  emptyConstraintSet,
  addConstraint,
  mergeConstraintSets,
} from '../solver/index.js';

// ============================================================================
// Inference Context
// ============================================================================

/**
 * Type inference context
 *
 * Maintains the typing environment and accumulated constraints
 */
/**
 * Global binding collector - shared across all scopes
 */
class GlobalBindingCollector {
  /** All bindings from all scopes, keyed by scope-qualified name */
  public allBindings: Map<string, PolyScheme> = new Map();

  /** Scope depth for qualification */
  private scopeCounter: number = 0;

  /** Get next scope ID */
  nextScope(): number {
    return this.scopeCounter++;
  }
}

export class InferenceContext {
  /** Type environment: variable name -> polymorphic scheme */
  private env: Map<string, PolyScheme>;

  /** Accumulated constraints */
  private constraints: ConstraintSet;

  /** Parent context (for nested scopes) */
  private parent: InferenceContext | null;

  /** Current function return type (for return statements) */
  private returnType: PolarType | null;

  /** Whether we're in an async context */
  private asyncContext: boolean;

  /** Whether we're in a generator context */
  private generatorContext: boolean;

  /** Current this type (for method calls) */
  private thisType: PolarType | null;

  /** Label for break/continue targets */
  private loopLabels: Map<string | null, { breakType: TypeVar; continueAllowed: boolean }>;

  /** Global binding collector (shared across all child contexts) */
  private globalCollector: GlobalBindingCollector;

  /** Current scope depth */
  private scopeDepth: number;

  /**
   * Member access cache: object path -> property -> type variable
   * This ensures that multiple accesses to the same property path
   * share the same type variable, enabling proper constraint propagation.
   *
   * Example: this.head.next accessed multiple times should share the same TypeVar
   */
  private memberCache: Map<string, Map<string, TypeVar>>;

  constructor(parent: InferenceContext | null = null) {
    this.env = new Map();
    this.constraints = emptyConstraintSet();
    this.parent = parent;
    this.returnType = parent?.returnType ?? null;
    this.asyncContext = parent?.asyncContext ?? false;
    this.generatorContext = parent?.generatorContext ?? false;
    this.thisType = parent?.thisType ?? null;
    this.loopLabels = parent ? new Map(parent.loopLabels) : new Map();
    this.globalCollector = parent?.globalCollector ?? new GlobalBindingCollector();
    this.scopeDepth = parent ? parent.scopeDepth + 1 : 0;
    this.memberCache = parent?.memberCache ?? new Map();
  }

  // ==========================================================================
  // Environment Operations
  // ==========================================================================

  /**
   * Look up a variable in the environment
   */
  lookup(name: string): PolyScheme | null {
    const local = this.env.get(name);
    if (local) return local;
    if (this.parent) return this.parent.lookup(name);
    return null;
  }

  /**
   * Bind a variable to a monomorphic type
   */
  bind(name: string, type: PolarType): void {
    this.env.set(name, monoScheme(type));
  }

  /**
   * Bind a variable to a polymorphic scheme
   */
  bindScheme(name: string, scheme: PolyScheme): void {
    this.env.set(name, scheme);
    // Also record in global collector (using simple name, last one wins)
    this.globalCollector.allBindings.set(name, scheme);
  }

  /**
   * Instantiate a polymorphic scheme with fresh type variables
   */
  instantiate(scheme: PolyScheme): PolarType {
    return instantiateType(scheme);
  }

  /**
   * Generalize a type to a polymorphic scheme
   */
  generalize(type: PolarType, delta: ReadonlyMap<string, PolarType> = new Map()): PolyScheme {
    // Get free variables from environment
    const envSchemes = new Map<string, PolyScheme>();
    for (const [name, scheme] of this.getAllBindings()) {
      envSchemes.set(name, scheme);
    }
    return generalize(envSchemes, type, delta);
  }

  /**
   * Get all bindings (including parent scopes)
   */
  getAllBindings(): Map<string, PolyScheme> {
    const result = new Map<string, PolyScheme>();

    // Parent bindings first (can be shadowed)
    if (this.parent) {
      for (const [name, scheme] of this.parent.getAllBindings()) {
        result.set(name, scheme);
      }
    }

    // Local bindings override
    for (const [name, scheme] of this.env) {
      result.set(name, scheme);
    }

    return result;
  }

  /**
   * Get all bindings collected from all scopes (including nested functions)
   */
  getGlobalBindings(): Map<string, PolyScheme> {
    return this.globalCollector.allBindings;
  }

  // ==========================================================================
  // Constraint Operations
  // ==========================================================================

  /**
   * Add a flow constraint: positive ≤ negative
   */
  addFlow(positive: PolarType, negative: PolarType, source: SourceLocation): void {
    this.constraints = addConstraint(this.constraints, flow(positive, negative, source));
  }

  /**
   * Add a constraint from a Babel node location
   */
  addFlowFromNode(positive: PolarType, negative: PolarType, node: Node): void {
    const source = nodeToSource(node);
    this.addFlow(positive, negative, source);
  }

  /**
   * Get all accumulated constraints
   */
  getConstraints(): ConstraintSet {
    return this.constraints;
  }

  /**
   * Merge constraints from another context
   */
  mergeConstraints(other: InferenceContext): void {
    this.constraints = mergeConstraintSets(this.constraints, other.constraints);
  }

  /**
   * Merge a constraint set
   */
  mergeConstraintSet(cs: ConstraintSet): void {
    this.constraints = mergeConstraintSets(this.constraints, cs);
  }

  // ==========================================================================
  // Member Access Cache
  // ==========================================================================

  /**
   * Get or create a cached type variable for a member access path.
   * This ensures that accessing the same property on the same object
   * multiple times returns the same type variable.
   *
   * @param objectPath - String representation of the object (e.g., "this.head")
   * @param propertyName - Name of the property (e.g., "next")
   * @returns The cached or newly created type variable for this member access
   */
  getCachedMemberVar(objectPath: string, propertyName: string): TypeVar {
    let objectCache = this.memberCache.get(objectPath);
    if (!objectCache) {
      objectCache = new Map();
      this.memberCache.set(objectPath, objectCache);
    }

    let propVar = objectCache.get(propertyName);
    if (!propVar) {
      propVar = this.fresh(`${propertyName}`);
      objectCache.set(propertyName, propVar);
    }

    return propVar;
  }

  /**
   * Try to build a stable path string from an expression.
   * Returns null if the expression is too complex to cache.
   */
  getStablePath(expr: any): string | null {
    if (!expr) return null;

    if (expr.type === 'ThisExpression') {
      return 'this';
    }

    if (expr.type === 'Identifier') {
      return expr.name;
    }

    if (expr.type === 'MemberExpression' && !expr.computed && expr.property?.type === 'Identifier') {
      const objectPath = this.getStablePath(expr.object);
      if (objectPath) {
        return `${objectPath}.${expr.property.name}`;
      }
    }

    // For complex expressions, don't cache
    return null;
  }

  // ==========================================================================
  // Scope Management
  // ==========================================================================

  /**
   * Create a child context for a nested scope
   */
  child(): InferenceContext {
    return new InferenceContext(this);
  }

  /**
   * Create a function context
   */
  functionContext(options: {
    returnType: PolarType;
    isAsync?: boolean;
    isGenerator?: boolean;
    thisType?: PolarType;
  }): InferenceContext {
    const ctx = this.child();
    ctx.returnType = options.returnType;
    ctx.asyncContext = options.isAsync ?? false;
    ctx.generatorContext = options.isGenerator ?? false;
    ctx.thisType = options.thisType ?? null;
    ctx.loopLabels = new Map(); // Reset loop labels
    return ctx;
  }

  /**
   * Create a loop context
   */
  loopContext(label: string | null, breakType: TypeVar): InferenceContext {
    const ctx = this.child();
    ctx.loopLabels.set(label, { breakType, continueAllowed: true });
    return ctx;
  }

  // ==========================================================================
  // Context Queries
  // ==========================================================================

  /**
   * Get the current return type (for return statements)
   */
  getReturnType(): PolarType | null {
    return this.returnType;
  }

  /**
   * Check if we're in an async context
   */
  isAsync(): boolean {
    return this.asyncContext;
  }

  /**
   * Check if we're in a generator context
   */
  isGenerator(): boolean {
    return this.generatorContext;
  }

  /**
   * Get the current this type
   */
  getThisType(): PolarType | null {
    return this.thisType;
  }

  /**
   * Get break type for a label
   */
  getBreakType(label: string | null): TypeVar | null {
    const info = this.loopLabels.get(label);
    return info?.breakType ?? null;
  }

  /**
   * Check if continue is allowed for a label
   */
  canContinue(label: string | null): boolean {
    const info = this.loopLabels.get(label);
    return info?.continueAllowed ?? false;
  }

  // ==========================================================================
  // Fresh Type Variables
  // ==========================================================================

  /**
   * Create a fresh type variable
   */
  fresh(name?: string): TypeVar {
    return freshTypeVar(name);
  }

  /**
   * Create a fresh positive type variable
   */
  freshPositive(name?: string): TypeVar {
    return freshTypeVar(name);
  }

  /**
   * Create a fresh negative type variable
   */
  freshNegative(name?: string): TypeVar {
    return freshTypeVar(name);
  }
}

// ============================================================================
// Source Location Utilities
// ============================================================================

/**
 * Convert a Babel node to a source location
 */
export function nodeToSource(node: Node): SourceLocation {
  const loc = node.loc;
  if (loc) {
    return makeSource(
      loc.filename ?? '<unknown>',
      loc.start.line,
      loc.start.column
    );
  }
  return makeSource('<unknown>', 0, 0);
}

/**
 * Create a source location from file and position
 */
export function makeSourceLocation(
  file: string,
  line: number,
  column: number
): SourceLocation {
  return makeSource(file, line, column);
}

// ============================================================================
// Inference Result
// ============================================================================

/**
 * Result of type inference for an expression
 */
export interface InferResult {
  /** Inferred type (positive polarity) */
  readonly type: PolarType;

  /** Accumulated constraints */
  readonly constraints: ConstraintSet;
}

/**
 * Create an inference result
 */
export function inferResult(type: PolarType, constraints: ConstraintSet): InferResult {
  return { type, constraints };
}

/**
 * Create an inference result with no constraints
 */
export function inferType(type: PolarType): InferResult {
  return { type, constraints: emptyConstraintSet() };
}

// ============================================================================
// Statement Result
// ============================================================================

/**
 * Result of type inference for a statement
 *
 * Statements don't produce a type but may produce constraints
 * and may affect the environment (declarations, assignments)
 */
export interface StatementResult {
  /** Accumulated constraints */
  readonly constraints: ConstraintSet;

  /** Whether this statement always returns/throws */
  readonly diverges: boolean;

  /** Updated bindings (for declarations) */
  readonly bindings: ReadonlyMap<string, PolyScheme>;
}

/**
 * Create a statement result
 */
export function statementResult(
  constraints: ConstraintSet,
  diverges: boolean = false,
  bindings: ReadonlyMap<string, PolyScheme> = new Map()
): StatementResult {
  return { constraints, diverges, bindings };
}

/**
 * Create an empty statement result
 */
export function emptyStatementResult(): StatementResult {
  return { constraints: emptyConstraintSet(), diverges: false, bindings: new Map() };
}

// ============================================================================
// Type Environment
// ============================================================================

import { createBuiltinEnvironment } from '../js/builtins.js';

/**
 * Initial type environment with built-in types
 */
export function createInitialContext(): InferenceContext {
  const ctx = new InferenceContext();

  // Load built-in global values (Math, Array, Object, etc.)
  const builtins = createBuiltinEnvironment();
  for (const [name, scheme] of builtins) {
    ctx.bindScheme(name, scheme);
  }

  return ctx;
}
