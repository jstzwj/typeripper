// Binary Trees Benchmark
// Based on Computer Language Benchmarks Game
// Demonstrates: classes, recursion, object creation, method calls

class TreeNode {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }

  check() {
    if (this.left === null) {
      return 1;
    }
    return 1 + this.left.check() + this.right.check();
  }
}

function createTree(depth) {
  if (depth <= 0) {
    return new TreeNode(null, null);
  }
  return new TreeNode(createTree(depth - 1), createTree(depth - 1));
}

function run(maxDepth) {
  const minDepth = 4;
  const stretchDepth = maxDepth + 1;

  // Stretch tree
  const stretchTree = createTree(stretchDepth);
  console.log("stretch tree of depth " + stretchDepth + "\t check: " + stretchTree.check());

  // Long-lived tree
  const longLivedTree = createTree(maxDepth);

  // Iterate over depths
  for (let depth = minDepth; depth <= maxDepth; depth += 2) {
    const iterations = 1 << (maxDepth - depth + minDepth);
    let check = 0;

    for (let i = 0; i < iterations; i++) {
      const tree = createTree(depth);
      check += tree.check();
    }

    console.log(iterations + "\t trees of depth " + depth + "\t check: " + check);
  }

  console.log("long lived tree of depth " + maxDepth + "\t check: " + longLivedTree.check());
}

// Run with depth 10 (adjust for performance testing)
run(10);
