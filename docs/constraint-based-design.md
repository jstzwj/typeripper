# 基于约束求解的类型系统设计

## 1. 概述

本文档描述将 Typeripper 从直接推断模式重写为基于约束求解模式的设计方案。

### 1.1 当前架构 vs 新架构

```
当前架构（直接推断）：
  AST → 遍历 → 直接计算类型 → 类型注解

新架构（约束求解）：
  AST → 遍历 → 生成约束 → 求解约束 → 类型注解
         ↓
    Constraint Generation    Constraint Solving
    (收集所有约束)            (Z3 求解 + Unification)
```

### 1.2 核心优势

1. **更精确的类型推断**：全局视角，而非局部贪婪
2. **更好的错误信息**：约束冲突可以精确定位
3. **支持多态**：类型变量 + 约束 = 泛型推断
4. **数组元素类型**：自动收集所有写入点的类型
5. **相互递归**：函数间相互调用可以正确推断

## 2. 类型变量系统

### 2.1 类型变量定义

```typescript
// src/constraint/type-variable.ts

/** 类型变量 - 代表未知类型 */
interface TypeVar {
  kind: 'typevar';
  id: number;           // 唯一标识
  name: string;         // 调试用名称 (α, β, γ, ...)
  level: number;        // 作用域级别（用于 let-polymorphism）
}

/** 类型变量管理器 */
class TypeVarManager {
  private counter = 0;
  private level = 0;

  fresh(prefix = 'τ'): TypeVar {
    return {
      kind: 'typevar',
      id: this.counter++,
      name: `${prefix}${this.counter}`,
      level: this.level,
    };
  }

  enterScope(): void { this.level++; }
  leaveScope(): void { this.level--; }
}
```

### 2.2 扩展的类型定义

```typescript
// 扩展现有 Type 联合类型
type ConstraintType =
  | Type              // 现有的具体类型
  | TypeVar           // 类型变量
  | AppType           // 类型应用 (Array<τ>, Promise<τ>)
  | RowType           // 行类型（用于对象的可扩展性）
  ;

/** 类型应用 - 泛型实例化 */
interface AppType {
  kind: 'app';
  constructor: string;    // 'Array', 'Promise', 'Map', etc.
  args: ConstraintType[];
}

/** 行类型 - 可扩展对象类型 */
interface RowType {
  kind: 'row';
  fields: Map<string, ConstraintType>;
  rest: TypeVar | null;   // ρ - 剩余字段的类型变量
}
```

## 3. 约束系统

### 3.1 约束类型定义

```typescript
// src/constraint/constraints.ts

/** 所有约束类型的联合 */
type Constraint =
  | EqualityConstraint      // τ₁ = τ₂
  | SubtypeConstraint       // τ₁ <: τ₂
  | HasPropertyConstraint   // τ has property p: τₚ
  | CallableConstraint      // τ is callable with (τ₁,...,τₙ) → τᵣ
  | InstanceOfConstraint    // τ instanceof C
  | ConditionalConstraint   // if C₁ then C₂ else C₃
  | DisjunctionConstraint   // C₁ ∨ C₂ (用于 union 类型)
  ;

/** 等式约束: τ₁ = τ₂ */
interface EqualityConstraint {
  kind: 'equality';
  left: ConstraintType;
  right: ConstraintType;
  source: ConstraintSource;
}

/** 子类型约束: τ₁ <: τ₂ */
interface SubtypeConstraint {
  kind: 'subtype';
  sub: ConstraintType;
  sup: ConstraintType;
  source: ConstraintSource;
}

/** 属性约束: τ 有属性 p，类型为 τₚ */
interface HasPropertyConstraint {
  kind: 'has-property';
  object: ConstraintType;
  property: string;
  propertyType: ConstraintType;
  source: ConstraintSource;
}

/** 可调用约束: τ 可以用 (τ₁,...,τₙ) 调用，返回 τᵣ */
interface CallableConstraint {
  kind: 'callable';
  callee: ConstraintType;
  args: ConstraintType[];
  returnType: ConstraintType;
  source: ConstraintSource;
}

/** 约束来源 - 用于错误报告 */
interface ConstraintSource {
  node: t.Node;
  file: string;
  line: number;
  column: number;
  description: string;
}
```

### 3.2 约束收集器

```typescript
// src/constraint/collector.ts

class ConstraintCollector {
  private constraints: Constraint[] = [];
  private typeVars: TypeVarManager;
  private env: ConstraintEnv;

  constructor() {
    this.typeVars = new TypeVarManager();
    this.env = new ConstraintEnv();
  }

  /** 添加等式约束 */
  equal(left: ConstraintType, right: ConstraintType, source: ConstraintSource): void {
    this.constraints.push({ kind: 'equality', left, right, source });
  }

  /** 添加子类型约束 */
  subtype(sub: ConstraintType, sup: ConstraintType, source: ConstraintSource): void {
    this.constraints.push({ kind: 'subtype', sub, sup, source });
  }

  /** 添加属性约束 */
  hasProperty(obj: ConstraintType, prop: string, propType: ConstraintType, source: ConstraintSource): void {
    this.constraints.push({ kind: 'has-property', object: obj, property: prop, propertyType: propType, source });
  }

  /** 创建新的类型变量 */
  freshVar(prefix?: string): TypeVar {
    return this.typeVars.fresh(prefix);
  }

  /** 获取所有约束 */
  getConstraints(): Constraint[] {
    return this.constraints;
  }
}
```

## 4. 约束生成

### 4.1 表达式约束生成

```typescript
// src/constraint/generator.ts

class ConstraintGenerator {
  private collector: ConstraintCollector;

  /** 为表达式生成约束，返回表达式的类型变量 */
  generateExpr(expr: t.Expression, env: ConstraintEnv): ConstraintType {
    switch (expr.type) {
      case 'NumericLiteral':
        return Types.numberLiteral(expr.value);

      case 'StringLiteral':
        return Types.stringLiteral(expr.value);

      case 'Identifier':
        return this.generateIdentifier(expr, env);

      case 'BinaryExpression':
        return this.generateBinaryExpr(expr, env);

      case 'CallExpression':
        return this.generateCallExpr(expr, env);

      case 'MemberExpression':
        return this.generateMemberExpr(expr, env);

      case 'ArrayExpression':
        return this.generateArrayExpr(expr, env);

      case 'ObjectExpression':
        return this.generateObjectExpr(expr, env);

      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return this.generateFunctionExpr(expr, env);

      // ... 其他表达式类型
    }
  }

  /** 标识符 - 从环境查找或创建约束 */
  private generateIdentifier(expr: t.Identifier, env: ConstraintEnv): ConstraintType {
    const binding = env.lookup(expr.name);
    if (binding) {
      return binding.type;
    }
    // 未定义变量 - 创建类型变量并报错
    const tv = this.collector.freshVar(expr.name);
    this.collector.error(`Undefined variable: ${expr.name}`, expr);
    return tv;
  }

  /** 二元运算符 */
  private generateBinaryExpr(expr: t.BinaryExpression, env: ConstraintEnv): ConstraintType {
    const leftType = this.generateExpr(expr.left, env);
    const rightType = this.generateExpr(expr.right, env);
    const resultType = this.collector.freshVar('binop');

    switch (expr.operator) {
      case '+':
        // + 可以是数字加法或字符串连接
        // 生成析取约束: (left: number ∧ right: number ∧ result: number)
        //            ∨ (left: string ∧ result: string)
        //            ∨ (right: string ∧ result: string)
        this.collector.addPlusConstraint(leftType, rightType, resultType, this.source(expr));
        break;

      case '-':
      case '*':
      case '/':
      case '%':
        // 数字运算
        this.collector.subtype(leftType, Types.number, this.source(expr));
        this.collector.subtype(rightType, Types.number, this.source(expr));
        this.collector.equal(resultType, Types.number, this.source(expr));
        break;

      case '===':
      case '!==':
      case '<':
      case '>':
        this.collector.equal(resultType, Types.boolean, this.source(expr));
        break;
    }

    return resultType;
  }

  /** 调用表达式 */
  private generateCallExpr(expr: t.CallExpression, env: ConstraintEnv): ConstraintType {
    const calleeType = this.generateExpr(expr.callee, env);
    const argTypes = expr.arguments.map(arg =>
      t.isExpression(arg) ? this.generateExpr(arg, env) : Types.any()
    );
    const returnType = this.collector.freshVar('ret');

    // 添加可调用约束
    this.collector.callable(calleeType, argTypes, returnType, this.source(expr));

    return returnType;
  }

  /** 成员访问 */
  private generateMemberExpr(expr: t.MemberExpression, env: ConstraintEnv): ConstraintType {
    const objectType = this.generateExpr(expr.object, env);
    const propertyType = this.collector.freshVar('prop');

    if (t.isIdentifier(expr.property) && !expr.computed) {
      // obj.prop
      this.collector.hasProperty(objectType, expr.property.name, propertyType, this.source(expr));
    } else if (t.isNumericLiteral(expr.property)) {
      // arr[0] - 数组索引
      this.collector.hasIndex(objectType, expr.property.value, propertyType, this.source(expr));
    } else {
      // obj[expr] - 动态属性
      const keyType = this.generateExpr(expr.property, env);
      this.collector.hasDynamicProperty(objectType, keyType, propertyType, this.source(expr));
    }

    return propertyType;
  }

  /** 数组表达式 */
  private generateArrayExpr(expr: t.ArrayExpression, env: ConstraintEnv): ConstraintType {
    const elementVar = this.collector.freshVar('elem');

    for (const elem of expr.elements) {
      if (elem === null) {
        this.collector.subtype(Types.undefined, elementVar, this.source(expr));
      } else if (t.isSpreadElement(elem)) {
        const spreadType = this.generateExpr(elem.argument, env);
        this.collector.spreadIntoArray(spreadType, elementVar, this.source(expr));
      } else {
        const elemType = this.generateExpr(elem, env);
        this.collector.subtype(elemType, elementVar, this.source(expr));
      }
    }

    return Types.array(elementVar);
  }

  /** 函数表达式 */
  private generateFunctionExpr(
    expr: t.FunctionExpression | t.ArrowFunctionExpression,
    env: ConstraintEnv
  ): ConstraintType {
    // 为每个参数创建类型变量
    const paramTypes: ConstraintType[] = [];
    const bodyEnv = env.extend();

    for (const param of expr.params) {
      if (t.isIdentifier(param)) {
        const paramType = this.collector.freshVar(param.name);
        paramTypes.push(paramType);
        bodyEnv.bind(param.name, paramType);
      }
    }

    // 为返回类型创建类型变量
    const returnType = this.collector.freshVar('return');

    // 分析函数体
    if (t.isBlockStatement(expr.body)) {
      this.generateBlock(expr.body, bodyEnv, returnType);
    } else {
      // 箭头函数的表达式体
      const bodyType = this.generateExpr(expr.body, bodyEnv);
      this.collector.subtype(bodyType, returnType, this.source(expr));
    }

    return Types.function({ params: paramTypes, returnType });
  }
}
```

### 4.2 语句约束生成

```typescript
/** 变量声明 */
private generateVarDecl(stmt: t.VariableDeclaration, env: ConstraintEnv): void {
  for (const decl of stmt.declarations) {
    if (t.isIdentifier(decl.id)) {
      const varType = this.collector.freshVar(decl.id.name);

      if (decl.init) {
        const initType = this.generateExpr(decl.init, env);
        // 初始化值的类型是变量类型的子类型
        this.collector.subtype(initType, varType, this.source(decl));
      }

      env.bind(decl.id.name, varType);
    }
  }
}

/** 赋值表达式 */
private generateAssignment(expr: t.AssignmentExpression, env: ConstraintEnv): ConstraintType {
  const rightType = this.generateExpr(expr.right, env);

  if (t.isIdentifier(expr.left)) {
    const binding = env.lookup(expr.left.name);
    if (binding) {
      // 赋值的右侧必须是变量类型的子类型
      this.collector.subtype(rightType, binding.type, this.source(expr));
      return binding.type;
    }
  } else if (t.isMemberExpression(expr.left)) {
    // arr[i] = x 或 obj.prop = x
    const objectType = this.generateExpr(expr.left.object, env);

    if (t.isIdentifier(expr.left.property) && !expr.left.computed) {
      // obj.prop = x
      this.collector.hasProperty(objectType, expr.left.property.name, rightType, this.source(expr));
    } else {
      // arr[i] = x - 更新数组元素类型
      this.collector.arrayElementAssign(objectType, rightType, this.source(expr));
    }
  }

  return rightType;
}

/** push 方法调用的特殊处理 */
private generatePushCall(
  objectType: ConstraintType,
  args: t.Expression[],
  env: ConstraintEnv,
  source: ConstraintSource
): ConstraintType {
  for (const arg of args) {
    const argType = this.generateExpr(arg, env);
    // arr.push(x) 约束: x 是数组元素类型的子类型
    this.collector.arrayPush(objectType, argType, source);
  }
  return Types.number; // push 返回新长度
}
```

## 5. 约束求解

### 5.1 Unification 算法

```typescript
// src/constraint/unification.ts

/** 替换 - 类型变量到类型的映射 */
class Substitution {
  private mapping: Map<number, ConstraintType> = new Map();

  /** 应用替换到类型 */
  apply(type: ConstraintType): ConstraintType {
    if (type.kind === 'typevar') {
      const resolved = this.mapping.get(type.id);
      if (resolved) {
        return this.apply(resolved); // 递归应用
      }
      return type;
    }

    // 递归应用到复合类型
    if (type.kind === 'function') {
      return {
        ...type,
        params: type.params.map(p => ({ ...p, type: this.apply(p.type) })),
        returnType: this.apply(type.returnType),
      };
    }

    if (type.kind === 'array') {
      return {
        ...type,
        elementType: this.apply(type.elementType),
      };
    }

    // ... 其他复合类型

    return type;
  }

  /** 添加映射 */
  extend(varId: number, type: ConstraintType): void {
    this.mapping.set(varId, type);
  }

  /** 组合两个替换 */
  compose(other: Substitution): Substitution {
    const result = new Substitution();

    // 先应用 other，再应用 this
    for (const [id, type] of other.mapping) {
      result.mapping.set(id, this.apply(type));
    }
    for (const [id, type] of this.mapping) {
      if (!result.mapping.has(id)) {
        result.mapping.set(id, type);
      }
    }

    return result;
  }
}

/** Unification 求解器 */
class Unifier {
  private subst: Substitution = new Substitution();
  private errors: TypeError[] = [];

  /** 合一两个类型 */
  unify(t1: ConstraintType, t2: ConstraintType, source: ConstraintSource): boolean {
    const s1 = this.subst.apply(t1);
    const s2 = this.subst.apply(t2);

    // 相同类型
    if (this.structurallyEqual(s1, s2)) {
      return true;
    }

    // 类型变量
    if (s1.kind === 'typevar') {
      return this.unifyVar(s1, s2, source);
    }
    if (s2.kind === 'typevar') {
      return this.unifyVar(s2, s1, source);
    }

    // 函数类型
    if (s1.kind === 'function' && s2.kind === 'function') {
      return this.unifyFunctions(s1, s2, source);
    }

    // 数组类型
    if (s1.kind === 'array' && s2.kind === 'array') {
      return this.unify(s1.elementType, s2.elementType, source);
    }

    // 对象类型
    if (s1.kind === 'object' && s2.kind === 'object') {
      return this.unifyObjects(s1, s2, source);
    }

    // 联合类型 - 特殊处理
    if (s1.kind === 'union' || s2.kind === 'union') {
      return this.unifyWithUnion(s1, s2, source);
    }

    // 类型不兼容
    this.errors.push({
      kind: 'incompatible-types',
      expected: s1,
      actual: s2,
      source,
    });
    return false;
  }

  /** 合一类型变量 */
  private unifyVar(tv: TypeVar, type: ConstraintType, source: ConstraintSource): boolean {
    // Occurs check - 防止无限类型
    if (this.occursIn(tv, type)) {
      this.errors.push({
        kind: 'infinite-type',
        variable: tv,
        type,
        source,
      });
      return false;
    }

    this.subst.extend(tv.id, type);
    return true;
  }

  /** Occurs check */
  private occursIn(tv: TypeVar, type: ConstraintType): boolean {
    if (type.kind === 'typevar') {
      return type.id === tv.id;
    }
    if (type.kind === 'function') {
      return type.params.some(p => this.occursIn(tv, p.type)) ||
             this.occursIn(tv, type.returnType);
    }
    if (type.kind === 'array') {
      return this.occursIn(tv, type.elementType);
    }
    // ... 其他复合类型
    return false;
  }
}
```

### 5.2 Z3 集成

```typescript
// src/constraint/z3-solver.ts

import { init } from 'z3-solver';

class Z3TypeSolver {
  private z3: any;
  private ctx: any;
  private solver: any;
  private typeSort: any;
  private typeVarMap: Map<number, any> = new Map();

  async initialize(): Promise<void> {
    const { Context } = await init();
    this.ctx = new Context('main');
    this.solver = new this.ctx.Solver();

    // 定义类型排序 (Sort)
    this.typeSort = this.ctx.DeclareSort('Type');

    // 定义类型构造器
    this.defineTypeConstructors();
  }

  private defineTypeConstructors(): void {
    // 基础类型作为常量
    this.numberType = this.ctx.Const('number', this.typeSort);
    this.stringType = this.ctx.Const('string', this.typeSort);
    this.booleanType = this.ctx.Const('boolean', this.typeSort);
    this.undefinedType = this.ctx.Const('undefined', this.typeSort);
    this.nullType = this.ctx.Const('null', this.typeSort);
    this.anyType = this.ctx.Const('any', this.typeSort);

    // Array 作为一元函数
    this.arrayFunc = this.ctx.Function.declare(
      'Array',
      [this.typeSort],
      this.typeSort
    );

    // 子类型关系作为谓词
    this.subtypeRel = this.ctx.Function.declare(
      'subtype',
      [this.typeSort, this.typeSort],
      this.ctx.Bool.sort()
    );
  }

  /** 添加子类型公理 */
  private addSubtypeAxioms(): void {
    // 反身性: ∀T. T <: T
    const t = this.ctx.Const('t', this.typeSort);
    this.solver.add(
      this.ctx.ForAll([t], this.subtypeRel.call(t, t))
    );

    // 传递性: ∀T1,T2,T3. T1 <: T2 ∧ T2 <: T3 → T1 <: T3
    const t1 = this.ctx.Const('t1', this.typeSort);
    const t2 = this.ctx.Const('t2', this.typeSort);
    const t3 = this.ctx.Const('t3', this.typeSort);
    this.solver.add(
      this.ctx.ForAll([t1, t2, t3],
        this.ctx.Implies(
          this.ctx.And(
            this.subtypeRel.call(t1, t2),
            this.subtypeRel.call(t2, t3)
          ),
          this.subtypeRel.call(t1, t3)
        )
      )
    );

    // any 是顶类型: ∀T. T <: any
    this.solver.add(
      this.ctx.ForAll([t], this.subtypeRel.call(t, this.anyType))
    );

    // 数组协变: ∀T1,T2. T1 <: T2 → Array<T1> <: Array<T2>
    this.solver.add(
      this.ctx.ForAll([t1, t2],
        this.ctx.Implies(
          this.subtypeRel.call(t1, t2),
          this.subtypeRel.call(
            this.arrayFunc.call(t1),
            this.arrayFunc.call(t2)
          )
        )
      )
    );
  }

  /** 转换约束到 Z3 */
  translateConstraint(constraint: Constraint): any {
    switch (constraint.kind) {
      case 'equality':
        return this.ctx.Eq(
          this.translateType(constraint.left),
          this.translateType(constraint.right)
        );

      case 'subtype':
        return this.subtypeRel.call(
          this.translateType(constraint.sub),
          this.translateType(constraint.sup)
        );

      // ... 其他约束类型
    }
  }

  /** 转换类型到 Z3 表达式 */
  translateType(type: ConstraintType): any {
    if (type.kind === 'typevar') {
      let z3Var = this.typeVarMap.get(type.id);
      if (!z3Var) {
        z3Var = this.ctx.Const(`τ${type.id}`, this.typeSort);
        this.typeVarMap.set(type.id, z3Var);
      }
      return z3Var;
    }

    if (type.kind === 'number') return this.numberType;
    if (type.kind === 'string') return this.stringType;
    if (type.kind === 'boolean') return this.booleanType;
    if (type.kind === 'undefined') return this.undefinedType;
    if (type.kind === 'null') return this.nullType;
    if (type.kind === 'any') return this.anyType;

    if (type.kind === 'array') {
      return this.arrayFunc.call(this.translateType(type.elementType));
    }

    // ... 其他类型
  }

  /** 求解约束 */
  async solve(constraints: Constraint[]): Promise<SolveResult> {
    this.addSubtypeAxioms();

    for (const c of constraints) {
      this.solver.add(this.translateConstraint(c));
    }

    const result = await this.solver.check();

    if (result === 'sat') {
      const model = this.solver.model();
      return this.extractSolution(model);
    } else if (result === 'unsat') {
      return { success: false, errors: this.extractUnsatCore() };
    } else {
      return { success: false, errors: ['Solver timeout'] };
    }
  }

  /** 从模型提取解 */
  private extractSolution(model: any): SolveResult {
    const solution = new Map<number, ConstraintType>();

    for (const [varId, z3Var] of this.typeVarMap) {
      const value = model.eval(z3Var);
      solution.set(varId, this.z3ToType(value));
    }

    return { success: true, solution };
  }
}
```

## 6. 混合求解策略

### 6.1 分层求解

实际实现中，我们采用混合策略：

1. **第一层：局部 Unification**
   - 快速处理简单的等式约束
   - 无需 Z3

2. **第二层：子类型约束**
   - 使用简化的子类型规则
   - 处理 Union 类型

3. **第三层：Z3 求解**
   - 处理复杂约束
   - 验证解的一致性

```typescript
class HybridSolver {
  private unifier: Unifier;
  private z3Solver: Z3TypeSolver;

  async solve(constraints: Constraint[]): Promise<Solution> {
    // 分类约束
    const { equalities, subtypes, complex } = this.classifyConstraints(constraints);

    // 第一层：Unification
    const subst1 = this.unifier.solveEqualities(equalities);

    // 应用替换到剩余约束
    const remainingSubtypes = subtypes.map(c => this.applySubst(subst1, c));
    const remainingComplex = complex.map(c => this.applySubst(subst1, c));

    // 第二层：子类型求解
    const subst2 = this.solveSubtypes(remainingSubtypes);

    // 第三层：Z3（如果有复杂约束）
    if (remainingComplex.length > 0) {
      const z3Result = await this.z3Solver.solve(remainingComplex);
      if (!z3Result.success) {
        return { success: false, errors: z3Result.errors };
      }
      return this.combineSolutions(subst1, subst2, z3Result.solution);
    }

    return { success: true, solution: subst1.compose(subst2) };
  }
}
```

## 7. 数组类型推断示例

### 7.1 约束生成

```javascript
const arr = [];           // τ_arr = Array<τ_elem>
arr.push(1);             // number <: τ_elem
arr.push("hello");       // string <: τ_elem
const x = arr[0];        // τ_x = τ_elem
```

生成的约束：
```
1. τ_arr = Array<τ_elem>     (数组创建)
2. number <: τ_elem          (push number)
3. string <: τ_elem          (push string)
4. τ_x = τ_elem              (索引访问)
```

### 7.2 求解过程

```
Step 1: τ_elem 必须是 number 和 string 的超类型
Step 2: 计算最小上界 (LUB): τ_elem = number | string
Step 3: 应用替换:
        τ_arr = Array<number | string>
        τ_x = number | string
```

## 8. 项目结构

```
src/
├── constraint/
│   ├── index.ts              # 导出
│   ├── types.ts              # 约束类型定义
│   ├── type-variable.ts      # 类型变量管理
│   ├── collector.ts          # 约束收集器
│   ├── generator.ts          # 约束生成器
│   ├── environment.ts        # 约束环境
│   ├── unification.ts        # Unification 算法
│   ├── subtyping.ts          # 子类型关系
│   ├── solver.ts             # 混合求解器
│   ├── z3-solver.ts          # Z3 集成
│   └── reconstruction.ts     # 类型重建
├── analysis/
│   ├── constraint-inferrer.ts  # 新的主入口
│   └── ... (保留现有结构)
└── ...
```

## 9. 实施计划

### Phase 1: 基础设施（1-2 天）
- [ ] 类型变量系统
- [ ] 约束类型定义
- [ ] 约束收集器

### Phase 2: 约束生成（2-3 天）
- [ ] 表达式约束生成
- [ ] 语句约束生成
- [ ] 数组和对象特殊处理

### Phase 3: 求解器（2-3 天）
- [ ] Unification 实现
- [ ] 子类型求解
- [ ] Z3 集成

### Phase 4: 集成（1-2 天）
- [ ] 与现有 CFG 集成
- [ ] 类型重建
- [ ] 注解输出

### Phase 5: 测试和优化（1-2 天）
- [ ] 迁移现有测试
- [ ] 性能优化
- [ ] 错误信息改进
