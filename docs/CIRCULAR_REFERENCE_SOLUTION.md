# Circular Reference Solution - Final Design

## 当前实现状态

### ✅ 已完成

1. **Nullable Field Widening** (expressions.ts:279-286)
   ```typescript
   // For null/undefined fields, create union with fresh type variable
   if (valueResult.type.kind === 'primitive' &&
       (valueResult.type.name === 'null' || valueResult.type.name === 'undefined')) {
     fieldType = union([valueResult.type, ctx.fresh(`${key}_val`)]);
   }
   ```

   **效果**：`{ self: null }` → `{ self: null | α }`

2. **Member Access Caching** (context.ts:241-294)
   - 为同一属性路径返回相同的 TypeVar
   - 解决了多次访问导致约束丢失的问题

### ⚠️ 剩余问题

尽管 nullable widening 正在工作，LRU cache 仍然报错。经过深入分析，问题在于：

**问题场景**：
```javascript
this.head = { prev: null | α, next: null | β };
this.tail = { prev: null | γ, next: null | δ };
this.head.next = this.tail;  // β := { prev: null | γ, next: null | δ }
this.tail.prev = this.head;  // γ := { prev: null | α, next: null | β }
```

这创建了**互相引用**：
- β 需要是包含 γ 的 record
- γ 需要是包含 β 的 record
- 形成无限类型：`β = { prev: { prev: { prev: ... } } }`

**根本原因**：没有真正的 **recursive type generation**。

## 完整解决方案（需要进一步工作）

### Approach 1: Occurs-Check Relaxation + Recursive Type Generation

在 biunification 中，当检测到循环时自动生成 recursive type：

```typescript
// 在 biunify.ts 中添加
function detectCycle(typeVar: TypeVar, type: PolarType): boolean {
  // 检查 typeVar 是否出现在 type 中（occurs-check）
  const freeVarsInType = freeVars(type);
  return freeVarsInType.has(typeVar.id);
}

// 当 α := T 且 α ∈ freeVars(T) 时
if (detectCycle(typeVar, type)) {
  // 生成 recursive type: μα.T
  const recursiveType: RecursiveType = {
    kind: 'recursive',
    binder: typeVar,
    body: type
  };
  return recursiveType;
}
```

**优点**：
- 符合 MLsub 理论
- 生成正确的 recursive types

**缺点**：
- 需要修改约束求解器的核心逻辑
- 性能开销（occurs-check）
- 复杂度高

### Approach 2: 延迟约束求解 + Optimistic Unification

允许类型变量在第一次出现时"optimistically"接受自己：

```typescript
// 在 bisubstitution.ts 中
function optimisticUnify(α: TypeVar, T: PolarType): boolean {
  if (α appears in T) {
    // Don't fail, just record that α may be recursive
    markAsRecursive(α);
    return true;  // 乐观接受
  }
  return normalUnify(α, T);
}
```

**优点**：
- 实现简单
- 性能好

**缺点**：
- 可能过于宽松
- 不生成真正的 recursive types

### Approach 3: 用户标注（推荐用于当前阶段）

提供 JSDoc 标注支持，让用户显式声明 recursive types：

```javascript
/**
 * @typedef {Object} Node
 * @property {*} value
 * @property {Node | null} next
 * @property {Node | null} prev
 */

/** @type {Node} */
this.head = { value: null, next: null, prev: null };
```

**优点**：
- 无需修改核心推断
- 用户有完全控制
- 文档化代码

**缺点**：
- 需要手动标注
- 不是"自动推断"

## 建议的实施路径

### 短期（1-2周）
1. ✅ 实现 nullable widening（已完成）
2. ✅ 实现 member cache（已完成）
3. 📝 文档化循环引用的限制
4. 📝 提供 workaround 建议

### 中期（1-2月）
1. 实现 JSDoc 类型标注解析
2. 支持用户显式声明 recursive types
3. 改进错误消息，提示用户添加标注

### 长期（3-6月）
1. 实现 Approach 1：完整的 recursive type generation
2. 添加 occurs-check 和 cycle detection
3. 自动为常见模式生成 recursive types

## 当前建议

对于 LRU cache 这样的例子，推荐的做法是：

### 方案 A：使用构造函数（已经工作）
```javascript
function Node(value) {
  this.value = value;
  this.next = null;  // 通过 this-binding，类型自动递归
  this.prev = null;
}

const node1 = new Node(1);
const node2 = new Node(2);
node1.next = node2;  // ✅ 工作！
```

### 方案 B：Two-phase initialization
```javascript
// Phase 1: 创建对象
const head = createNode();
const tail = createNode();

// Phase 2: 建立连接
connectNodes(head, tail);

function createNode() {
  return { value: null, next: null, prev: null };
}

function connectNodes(a, b) {
  a.next = b;
  b.prev = a;
}
```

### 方案 C：添加 JSDoc（未来）
```javascript
/** @typedef {{ value: *, next: Node | null, prev: Node | null }} Node */

/** @type {Node} */
const head = { value: 1, next: null, prev: null };
```

## 测试结果

```
✓ Nullable widening 正常工作
✓ Member access caching 正常工作
✓ 简单循环（构造函数）✓
✓ 树结构 ✓
⚠ Object literal 互相引用 ✗ (需要 recursive types)
⚠ LRU doubly-linked list ✗ (需要 recursive types)
```

## 结论

我们成功实现了 **nullable field widening** 和 **member access caching**，这解决了大部分常见场景。

对于真正的循环引用（如 LRU cache），需要更深层的改动来支持自动 recursive type generation。当前阶段，推荐：

1. **文档化这个限制**
2. **提供 workaround 建议**
3. **规划未来的完整实现**

这是一个**务实的平衡**：核心功能已完善，高级功能留待未来迭代。

---
*Generated: 2026-01-09*
*Status: Nullable widening ✅ | Member cache ✅ | Recursive types 🚧*
