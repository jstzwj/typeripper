/**
 * Constraint Generator - Generates type constraints from AST traversal
 *
 * This module walks the AST and generates constraints that, when solved,
 * determine the types of all expressions and declarations.
 *
 * The generator does NOT compute types directly - it only produces constraints.
 * The solver then finds a substitution that satisfies all constraints.
 */

import * as t from '@babel/types';
import type {
  Constraint,
  ConstraintType,
  TypeVar,
  ConstraintSet,
} from './types.js';
import { ConstraintCollector, ConstraintEnv } from './collector.js';
import { CTypes } from './constraint-types-factory.js';
import type { TypeEnvironment } from '../types/index.js';

/**
 * Main constraint generator class
 */
export class ConstraintGenerator {
  private collector: ConstraintCollector;
  private env: ConstraintEnv;

  constructor(file: string = 'unknown') {
    this.collector = new ConstraintCollector(file);
    this.env = new ConstraintEnv();
    this.initializeBuiltins();
  }

  /**
   * Initialize built-in types (console, Math, etc.)
   */
  private initializeBuiltins(): void {
    // Add common builtins
    this.env.bind('undefined', CTypes.undefined);
    this.env.bind('NaN', CTypes.number);
    this.env.bind('Infinity', CTypes.number);
    this.env.bind('console', CTypes.object({
      properties: new Map([
        ['log', CTypes.property(CTypes.function({
          params: [CTypes.param('args', CTypes.any(), { rest: true })],
          returnType: CTypes.undefined,
        }))],
        ['error', CTypes.property(CTypes.function({
          params: [CTypes.param('args', CTypes.any(), { rest: true })],
          returnType: CTypes.undefined,
        }))],
      ]),
    }));
    this.env.bind('Math', CTypes.object({
      properties: new Map([
        ['PI', CTypes.property(CTypes.numberLiteral(Math.PI))],
        ['sqrt', CTypes.property(CTypes.function({
          params: [CTypes.param('x', CTypes.number)],
          returnType: CTypes.number,
        }))],
        ['floor', CTypes.property(CTypes.function({
          params: [CTypes.param('x', CTypes.number)],
          returnType: CTypes.number,
        }))],
        ['random', CTypes.property(CTypes.function({
          params: [],
          returnType: CTypes.number,
        }))],
      ]),
    }));
    // Add more builtins as needed
  }

  /**
   * Generate constraints for a program
   */
  generateProgram(program: t.Program): ConstraintSet {
    // First pass: collect hoisted declarations
    this.collectHoistedDeclarations(program.body);

    // Second pass: generate constraints for all statements
    for (const stmt of program.body) {
      this.generateStatement(stmt);
    }

    return this.collector.getConstraintSet(this.env);
  }

  /**
   * Collect hoisted function and var declarations
   */
  private collectHoistedDeclarations(statements: t.Statement[]): void {
    for (const stmt of statements) {
      if (t.isFunctionDeclaration(stmt) && stmt.id) {
        // Create a type variable for the function
        const funcType = this.collector.fresh('func', stmt);
        this.env.bind(stmt.id.name, funcType);
      } else if (t.isVariableDeclaration(stmt) && stmt.kind === 'var') {
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id)) {
            const varType = this.collector.fresh(decl.id.name, decl);
            this.env.bind(decl.id.name, varType);
          }
        }
      }
    }
  }

  // ===========================================================================
  // Statement Generation
  // ===========================================================================

  /**
   * Generate constraints for a statement
   */
  generateStatement(stmt: t.Statement): void {
    switch (stmt.type) {
      case 'VariableDeclaration':
        this.generateVariableDeclaration(stmt);
        break;

      case 'FunctionDeclaration':
        this.generateFunctionDeclaration(stmt);
        break;

      case 'ExpressionStatement':
        this.generateExpression(stmt.expression);
        break;

      case 'ReturnStatement':
        if (stmt.argument) {
          this.generateExpression(stmt.argument);
        }
        break;

      case 'IfStatement':
        this.generateIfStatement(stmt);
        break;

      case 'ForStatement':
        this.generateForStatement(stmt);
        break;

      case 'WhileStatement':
        this.generateWhileStatement(stmt);
        break;

      case 'BlockStatement':
        this.generateBlock(stmt);
        break;

      case 'ClassDeclaration':
        this.generateClassDeclaration(stmt);
        break;

      case 'TryStatement':
        this.generateTryStatement(stmt);
        break;

      case 'SwitchStatement':
        this.generateSwitchStatement(stmt);
        break;

      // Other statement types...
    }
  }

  /**
   * Generate constraints for variable declaration
   */
  private generateVariableDeclaration(stmt: t.VariableDeclaration): void {
    for (const decl of stmt.declarations) {
      if (t.isIdentifier(decl.id)) {
        const varType = this.collector.fresh(decl.id.name, decl);

        if (decl.init) {
          const initType = this.generateExpression(decl.init);
          // The init type must be a subtype of the variable type
          this.collector.subtype(initType, varType, decl, `initialization of ${decl.id.name}`);
        }

        // Update environment (or check if already hoisted for var)
        if (stmt.kind !== 'var' || !this.env.hasLocal(decl.id.name)) {
          this.env.bind(decl.id.name, varType);
        } else {
          // var was hoisted - add constraint to existing type
          const existingType = this.env.lookup(decl.id.name);
          if (existingType && decl.init) {
            const initType = this.generateExpression(decl.init);
            this.collector.subtype(initType, existingType, decl, `initialization of ${decl.id.name}`);
          }
        }

        // Register node type for annotation
        this.collector.registerNodeType(decl.id, varType);
      }
    }
  }

  /**
   * Generate constraints for function declaration
   */
  private generateFunctionDeclaration(stmt: t.FunctionDeclaration): void {
    if (!stmt.id) return;

    const funcType = this.generateFunctionType(stmt);

    // If function was hoisted, add equality constraint
    const existingType = this.env.lookup(stmt.id.name);
    if (existingType) {
      this.collector.equal(existingType, funcType, stmt, `function ${stmt.id.name}`);
    } else {
      this.env.bind(stmt.id.name, funcType);
    }

    this.collector.registerNodeType(stmt.id, funcType);
  }

  /**
   * Generate constraints for a function type
   */
  private generateFunctionType(
    func: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ClassMethod
  ): ConstraintType {
    // Enter new scope
    this.collector.enterScope();
    const bodyEnv = this.env.extend();

    // Create type variables for parameters
    const paramTypes: Array<ReturnType<typeof CTypes.param>> = [];
    for (const param of func.params) {
      if (t.isIdentifier(param)) {
        const paramType = this.collector.freshFor('param', param);
        paramTypes.push(CTypes.param(param.name, paramType));
        bodyEnv.bind(param.name, paramType);
      } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
        // Default parameter
        const defaultType = this.generateExpression(param.right);
        const paramType = this.collector.freshFor('param', param);
        this.collector.subtype(defaultType, paramType, param, 'default parameter');
        paramTypes.push(CTypes.param(param.left.name, paramType, { optional: true }));
        bodyEnv.bind(param.left.name, paramType);
      } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
        const elemType = this.collector.freshFor('element', param);
        const restType = CTypes.array(elemType);
        paramTypes.push(CTypes.param(param.argument.name, restType, { rest: true }));
        bodyEnv.bind(param.argument.name, restType);
      }
    }

    // Create return type variable
    const returnType = this.collector.freshFor('return', func);

    // Save current env and switch to body env
    const savedEnv = this.env;
    this.env = bodyEnv;

    // Generate constraints for function body
    if (t.isBlockStatement(func.body)) {
      // Collect return statements and constrain return type
      this.generateBlockWithReturns(func.body, returnType);
    } else {
      // Arrow function with expression body
      const exprType = this.generateExpression(func.body);
      this.collector.subtype(exprType, returnType, func.body, 'arrow function return');
    }

    // Restore env
    this.env = savedEnv;
    this.collector.leaveScope();

    return CTypes.function({
      params: paramTypes,
      returnType,
      isAsync: func.async ?? false,
      isGenerator: func.generator ?? false,
    });
  }

  /**
   * Generate constraints for a block with return statements
   */
  private generateBlockWithReturns(block: t.BlockStatement, returnType: ConstraintType): void {
    for (const stmt of block.body) {
      if (t.isReturnStatement(stmt)) {
        if (stmt.argument) {
          const argType = this.generateExpression(stmt.argument);
          this.collector.subtype(argType, returnType, stmt, 'return statement');
        } else {
          this.collector.subtype(CTypes.undefined, returnType, stmt, 'return undefined');
        }
      } else if (t.isIfStatement(stmt)) {
        this.generateExpression(stmt.test);
        if (t.isBlockStatement(stmt.consequent)) {
          this.generateBlockWithReturns(stmt.consequent, returnType);
        } else {
          this.generateStatement(stmt.consequent);
        }
        if (stmt.alternate) {
          if (t.isBlockStatement(stmt.alternate)) {
            this.generateBlockWithReturns(stmt.alternate, returnType);
          } else {
            this.generateStatement(stmt.alternate);
          }
        }
      } else {
        this.generateStatement(stmt);
      }
    }
  }

  /**
   * Generate constraints for block statement
   */
  private generateBlock(block: t.BlockStatement): void {
    const blockEnv = this.env.extend();
    const savedEnv = this.env;
    this.env = blockEnv;

    for (const stmt of block.body) {
      this.generateStatement(stmt);
    }

    this.env = savedEnv;
  }

  /**
   * Generate constraints for if statement
   */
  private generateIfStatement(stmt: t.IfStatement): void {
    this.generateExpression(stmt.test);
    this.generateStatement(stmt.consequent);
    if (stmt.alternate) {
      this.generateStatement(stmt.alternate);
    }
  }

  /**
   * Generate constraints for for statement
   */
  private generateForStatement(stmt: t.ForStatement): void {
    const forEnv = this.env.extend();
    const savedEnv = this.env;
    this.env = forEnv;

    if (stmt.init) {
      if (t.isVariableDeclaration(stmt.init)) {
        this.generateVariableDeclaration(stmt.init);
      } else {
        this.generateExpression(stmt.init);
      }
    }

    if (stmt.test) {
      this.generateExpression(stmt.test);
    }

    if (stmt.update) {
      this.generateExpression(stmt.update);
    }

    this.generateStatement(stmt.body);

    this.env = savedEnv;
  }

  /**
   * Generate constraints for while statement
   */
  private generateWhileStatement(stmt: t.WhileStatement): void {
    this.generateExpression(stmt.test);
    this.generateStatement(stmt.body);
  }

  /**
   * Generate constraints for class declaration
   */
  private generateClassDeclaration(stmt: t.ClassDeclaration): void {
    if (!stmt.id) return;

    // Create type variables for the class
    const instanceProps = new Map<string, ReturnType<typeof CTypes.property>>();
    const staticProps = new Map<string, ReturnType<typeof CTypes.property>>();
    let constructorType = CTypes.function({ params: [], returnType: CTypes.undefined });

    for (const member of stmt.body.body) {
      if (t.isClassMethod(member)) {
        if (member.kind === 'constructor') {
          constructorType = this.generateFunctionType(member) as any;
        } else if (t.isIdentifier(member.key)) {
          const methodType = this.generateFunctionType(member);
          if (member.static) {
            staticProps.set(member.key.name, CTypes.property(methodType));
          } else {
            instanceProps.set(member.key.name, CTypes.property(methodType));
          }
        }
      } else if (t.isClassProperty(member) && t.isIdentifier(member.key)) {
        const propType = member.value
          ? this.generateExpression(member.value)
          : this.collector.fresh(member.key.name, member);

        if (member.static) {
          staticProps.set(member.key.name, CTypes.property(propType));
        } else {
          instanceProps.set(member.key.name, CTypes.property(propType));
        }
      }
    }

    const classType = CTypes.class({
      name: stmt.id.name,
      constructor: constructorType as any,
      instanceType: CTypes.object({ properties: instanceProps }),
      staticProperties: staticProps,
    });

    this.env.bind(stmt.id.name, classType);
    this.collector.registerNodeType(stmt.id, classType);
  }

  /**
   * Generate constraints for try statement
   */
  private generateTryStatement(stmt: t.TryStatement): void {
    this.generateBlock(stmt.block);

    if (stmt.handler) {
      const handlerEnv = this.env.extend();
      if (stmt.handler.param && t.isIdentifier(stmt.handler.param)) {
        handlerEnv.bind(stmt.handler.param.name, CTypes.any());
      }
      const savedEnv = this.env;
      this.env = handlerEnv;
      this.generateBlock(stmt.handler.body);
      this.env = savedEnv;
    }

    if (stmt.finalizer) {
      this.generateBlock(stmt.finalizer);
    }
  }

  /**
   * Generate constraints for switch statement
   */
  private generateSwitchStatement(stmt: t.SwitchStatement): void {
    this.generateExpression(stmt.discriminant);

    for (const caseClause of stmt.cases) {
      if (caseClause.test) {
        this.generateExpression(caseClause.test);
      }
      for (const consequent of caseClause.consequent) {
        this.generateStatement(consequent);
      }
    }
  }

  // ===========================================================================
  // Expression Generation
  // ===========================================================================

  /**
   * Generate constraints for an expression, returning its type
   */
  generateExpression(expr: t.Expression): ConstraintType {
    let type: ConstraintType;

    switch (expr.type) {
      case 'NumericLiteral':
        type = CTypes.numberLiteral(expr.value);
        break;

      case 'StringLiteral':
        type = CTypes.stringLiteral(expr.value);
        break;

      case 'BooleanLiteral':
        type = CTypes.booleanLiteral(expr.value);
        break;

      case 'NullLiteral':
        type = CTypes.null;
        break;

      case 'Identifier':
        type = this.generateIdentifier(expr);
        break;

      case 'BinaryExpression':
        type = this.generateBinaryExpression(expr);
        break;

      case 'UnaryExpression':
        type = this.generateUnaryExpression(expr);
        break;

      case 'LogicalExpression':
        type = this.generateLogicalExpression(expr);
        break;

      case 'CallExpression':
        type = this.generateCallExpression(expr);
        break;

      case 'NewExpression':
        type = this.generateNewExpression(expr);
        break;

      case 'MemberExpression':
        type = this.generateMemberExpression(expr);
        break;

      case 'ArrayExpression':
        type = this.generateArrayExpression(expr);
        break;

      case 'ObjectExpression':
        type = this.generateObjectExpression(expr);
        break;

      case 'FunctionExpression':
        type = this.generateFunctionType(expr);
        break;

      case 'ArrowFunctionExpression':
        type = this.generateFunctionType(expr);
        break;

      case 'AssignmentExpression':
        type = this.generateAssignmentExpression(expr);
        break;

      case 'UpdateExpression':
        type = this.generateUpdateExpression(expr);
        break;

      case 'ConditionalExpression':
        type = this.generateConditionalExpression(expr);
        break;

      case 'SequenceExpression':
        type = this.generateSequenceExpression(expr);
        break;

      case 'ThisExpression':
        type = this.collector.fresh('this', expr);
        break;

      case 'TemplateLiteral':
        type = CTypes.string;
        break;

      default:
        type = CTypes.any();
    }

    this.collector.registerNodeType(expr, type);
    return type;
  }

  /**
   * Generate constraints for identifier
   */
  private generateIdentifier(expr: t.Identifier): ConstraintType {
    const binding = this.env.lookup(expr.name);
    if (binding) {
      // Instantiate type scheme if needed
      return this.collector.instantiate(binding);
    }

    // Undefined variable - create type variable and report warning
    const tv = this.collector.fresh(expr.name, expr);
    this.collector.warning(`Undefined variable: ${expr.name}`, expr, 'implicit-any');
    return tv;
  }

  /**
   * Generate constraints for binary expression
   */
  private generateBinaryExpression(expr: t.BinaryExpression): ConstraintType {
    const leftType = t.isExpression(expr.left)
      ? this.generateExpression(expr.left)
      : CTypes.any();
    const rightType = this.generateExpression(expr.right);
    const resultType = this.collector.freshFor('result', expr);

    switch (expr.operator) {
      case '+':
        // Special handling for + (numeric addition or string concatenation)
        this.collector.addPlusConstraint(leftType, rightType, resultType, expr);
        break;

      case '-':
      case '*':
      case '/':
      case '%':
      case '**':
        // Numeric operations
        this.collector.subtype(leftType, CTypes.number, expr, `left operand of ${expr.operator}`);
        this.collector.subtype(rightType, CTypes.number, expr, `right operand of ${expr.operator}`);
        this.collector.equal(resultType, CTypes.number, expr, `result of ${expr.operator}`);
        break;

      case '|':
      case '&':
      case '^':
      case '<<':
      case '>>':
      case '>>>':
        // Bitwise operations - always number
        this.collector.equal(resultType, CTypes.number, expr, `result of ${expr.operator}`);
        break;

      case '===':
      case '!==':
      case '==':
      case '!=':
      case '<':
      case '>':
      case '<=':
      case '>=':
        // Comparison - returns boolean
        this.collector.equal(resultType, CTypes.boolean, expr, `result of ${expr.operator}`);
        break;

      case 'instanceof':
        this.collector.equal(resultType, CTypes.boolean, expr, 'result of instanceof');
        break;

      case 'in':
        this.collector.equal(resultType, CTypes.boolean, expr, 'result of in');
        break;
    }

    return resultType;
  }

  /**
   * Generate constraints for unary expression
   */
  private generateUnaryExpression(expr: t.UnaryExpression): ConstraintType {
    const argType = this.generateExpression(expr.argument);
    const resultType = this.collector.freshFor('result', expr);

    switch (expr.operator) {
      case 'typeof':
        this.collector.equal(resultType, CTypes.string, expr, 'result of typeof');
        break;

      case '!':
        this.collector.equal(resultType, CTypes.boolean, expr, 'result of !');
        break;

      case '-':
      case '+':
      case '~':
        this.collector.equal(resultType, CTypes.number, expr, `result of ${expr.operator}`);
        break;

      case 'void':
        this.collector.equal(resultType, CTypes.undefined, expr, 'result of void');
        break;

      case 'delete':
        this.collector.equal(resultType, CTypes.boolean, expr, 'result of delete');
        break;
    }

    return resultType;
  }

  /**
   * Generate constraints for logical expression
   */
  private generateLogicalExpression(expr: t.LogicalExpression): ConstraintType {
    const leftType = this.generateExpression(expr.left);
    const rightType = this.generateExpression(expr.right);
    const resultType = this.collector.freshFor('result', expr);

    switch (expr.operator) {
      case '&&':
      case '||':
        // Result is union of both types (simplified)
        this.collector.unionMember(leftType, resultType, expr, `left of ${expr.operator}`);
        this.collector.unionMember(rightType, resultType, expr, `right of ${expr.operator}`);
        break;

      case '??':
        // Nullish coalescing
        this.collector.unionMember(leftType, resultType, expr, 'left of ??');
        this.collector.unionMember(rightType, resultType, expr, 'right of ??');
        break;
    }

    return resultType;
  }

  /**
   * Generate constraints for call expression
   */
  private generateCallExpression(expr: t.CallExpression): ConstraintType {
    // Handle IIFE
    if (t.isFunctionExpression(expr.callee) || t.isArrowFunctionExpression(expr.callee)) {
      return this.generateExpression(expr.callee);
    }

    const calleeType = t.isExpression(expr.callee)
      ? this.generateExpression(expr.callee)
      : CTypes.any();

    const argTypes = expr.arguments.map(arg =>
      t.isExpression(arg) ? this.generateExpression(arg) : CTypes.any()
    );

    const returnType = this.collector.freshFor('return', expr);

    // Add callable constraint
    this.collector.callable(calleeType, argTypes, returnType, expr, 'function call');

    // Special handling for array methods
    if (t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property)) {
      const methodName = expr.callee.property.name;
      const objType = this.collector.getNodeType(expr.callee.object);

      if (objType && methodName === 'push') {
        // arr.push(x) - x becomes element of array
        for (const arg of argTypes) {
          this.collector.addPushConstraint(objType, arg, expr);
        }
      }
    }

    return returnType;
  }

  /**
   * Generate constraints for new expression
   */
  private generateNewExpression(expr: t.NewExpression): ConstraintType {
    const ctorType = t.isExpression(expr.callee)
      ? this.generateExpression(expr.callee)
      : CTypes.any();

    const argTypes = expr.arguments.map(arg =>
      t.isExpression(arg) ? this.generateExpression(arg) : CTypes.any()
    );

    const instanceType = this.collector.fresh('instance', expr);

    // Add constructable constraint
    this.collector.constructable(ctorType, argTypes, instanceType, expr, 'constructor call');

    return instanceType;
  }

  /**
   * Generate constraints for member expression
   */
  private generateMemberExpression(expr: t.MemberExpression): ConstraintType {
    const objType = this.generateExpression(expr.object);
    const propType = this.collector.freshFor('property', expr);

    if (t.isIdentifier(expr.property) && !expr.computed) {
      // obj.prop
      this.collector.hasProperty(objType, expr.property.name, propType, 'read', expr, `property ${expr.property.name}`);
    } else if (t.isNumericLiteral(expr.property)) {
      // arr[0]
      this.collector.hasIndex(objType, CTypes.numberLiteral(expr.property.value), propType, 'read', expr, 'index access');
    } else if (t.isStringLiteral(expr.property)) {
      // obj["prop"]
      this.collector.hasProperty(objType, expr.property.value, propType, 'read', expr, `property "${expr.property.value}"`);
    } else {
      // obj[expr]
      const indexType = t.isExpression(expr.property)
        ? this.generateExpression(expr.property)
        : CTypes.any();
      this.collector.hasIndex(objType, indexType, propType, 'read', expr, 'dynamic property');
    }

    return propType;
  }

  /**
   * Generate constraints for array expression
   */
  private generateArrayExpression(expr: t.ArrayExpression): ConstraintType {
    const elemType = this.collector.freshFor('element', expr);

    for (const elem of expr.elements) {
      if (elem === null) {
        this.collector.subtype(CTypes.undefined, elemType, expr, 'array hole');
      } else if (t.isSpreadElement(elem)) {
        const spreadType = this.generateExpression(elem.argument);
        this.collector.addSpreadConstraint(spreadType, elemType, elem);
      } else {
        const itemType = this.generateExpression(elem);
        this.collector.subtype(itemType, elemType, elem, 'array element');
      }
    }

    return CTypes.array(elemType);
  }

  /**
   * Generate constraints for object expression
   */
  private generateObjectExpression(expr: t.ObjectExpression): ConstraintType {
    const properties = new Map<string, ReturnType<typeof CTypes.property>>();

    for (const prop of expr.properties) {
      if (t.isObjectProperty(prop)) {
        let propName: string | undefined;
        if (t.isIdentifier(prop.key)) {
          propName = prop.key.name;
        } else if (t.isStringLiteral(prop.key)) {
          propName = prop.key.value;
        }

        if (propName && t.isExpression(prop.value)) {
          const valueType = this.generateExpression(prop.value);
          properties.set(propName, CTypes.property(valueType));
        }
      } else if (t.isSpreadElement(prop)) {
        // Spread in object - merge properties
        this.generateExpression(prop.argument);
        // TODO: Handle spreading object properties
      }
    }

    return CTypes.object({ properties });
  }

  /**
   * Generate constraints for assignment expression
   */
  private generateAssignmentExpression(expr: t.AssignmentExpression): ConstraintType {
    const rightType = this.generateExpression(expr.right);

    if (t.isIdentifier(expr.left)) {
      const binding = this.env.lookup(expr.left.name);
      if (binding) {
        // Variable assignment
        if (expr.operator === '=') {
          this.collector.subtype(rightType, binding, expr, `assignment to ${expr.left.name}`);
        } else {
          // Compound assignment (+=, -=, etc.)
          // The result type depends on the operator
          const resultType = this.generateCompoundAssignmentType(expr.operator, binding, rightType, expr);
          this.collector.equal(binding, resultType, expr, `compound assignment to ${expr.left.name}`);
        }
        return binding;
      }
    } else if (t.isMemberExpression(expr.left)) {
      const objType = this.generateExpression(expr.left.object);

      if (t.isIdentifier(expr.left.property) && !expr.left.computed) {
        this.collector.hasProperty(objType, expr.left.property.name, rightType, 'write', expr, `assignment to .${expr.left.property.name}`);
      } else {
        const indexType = t.isExpression(expr.left.property)
          ? this.generateExpression(expr.left.property)
          : CTypes.any();
        this.collector.hasIndex(objType, indexType, rightType, 'write', expr, 'index assignment');

        // For array index assignment, also add array element constraint
        this.collector.arrayElement(objType, rightType, 'write', expr, 'array element assignment');
      }
    }

    return rightType;
  }

  /**
   * Determine type for compound assignment
   */
  private generateCompoundAssignmentType(
    operator: string,
    leftType: ConstraintType,
    rightType: ConstraintType,
    node: t.Node
  ): ConstraintType {
    switch (operator) {
      case '+=':
        // Could be number or string
        const resultType = this.collector.freshFor('result', node);
        this.collector.addPlusConstraint(leftType, rightType, resultType, node);
        return resultType;

      case '-=':
      case '*=':
      case '/=':
      case '%=':
      case '**=':
      case '|=':
      case '&=':
      case '^=':
      case '<<=':
      case '>>=':
      case '>>>=':
        return CTypes.number;

      default:
        return rightType;
    }
  }

  /**
   * Generate constraints for update expression (++, --)
   */
  private generateUpdateExpression(expr: t.UpdateExpression): ConstraintType {
    const argType = this.generateExpression(expr.argument);
    this.collector.subtype(argType, CTypes.number, expr, 'update expression operand');
    return CTypes.number;
  }

  /**
   * Generate constraints for conditional expression
   */
  private generateConditionalExpression(expr: t.ConditionalExpression): ConstraintType {
    this.generateExpression(expr.test);
    const consequentType = this.generateExpression(expr.consequent);
    const alternateType = this.generateExpression(expr.alternate);

    const resultType = this.collector.freshFor('result', expr);
    this.collector.unionMember(consequentType, resultType, expr, 'conditional consequent');
    this.collector.unionMember(alternateType, resultType, expr, 'conditional alternate');

    return resultType;
  }

  /**
   * Generate constraints for sequence expression
   */
  private generateSequenceExpression(expr: t.SequenceExpression): ConstraintType {
    let lastType: ConstraintType = CTypes.undefined;
    for (const e of expr.expressions) {
      lastType = this.generateExpression(e);
    }
    return lastType;
  }

  // ===========================================================================
  // Result
  // ===========================================================================

  /**
   * Get the constraint set
   */
  getConstraintSet(): ConstraintSet {
    return this.collector.getConstraintSet(this.env);
  }

  /**
   * Get the collector (for debugging)
   */
  getCollector(): ConstraintCollector {
    return this.collector;
  }
}

/**
 * Generate constraints for a program
 */
export function generateConstraints(program: t.Program, file: string = 'unknown'): ConstraintSet {
  const generator = new ConstraintGenerator(file);
  return generator.generateProgram(program);
}
