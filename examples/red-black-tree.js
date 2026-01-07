// Red-Black Tree Implementation
// Demonstrates: classes, inheritance patterns, complex object manipulation, enums

const Color = {
  RED: 0,
  BLACK: 1
};

class RBNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.color = Color.RED;
    this.left = null;
    this.right = null;
    this.parent = null;
  }
}

class RedBlackTree {
  constructor() {
    this.root = null;
    this.size = 0;
  }

  rotateLeft(node) {
    const rightChild = node.right;
    node.right = rightChild.left;

    if (rightChild.left !== null) {
      rightChild.left.parent = node;
    }

    rightChild.parent = node.parent;

    if (node.parent === null) {
      this.root = rightChild;
    } else if (node === node.parent.left) {
      node.parent.left = rightChild;
    } else {
      node.parent.right = rightChild;
    }

    rightChild.left = node;
    node.parent = rightChild;
  }

  rotateRight(node) {
    const leftChild = node.left;
    node.left = leftChild.right;

    if (leftChild.right !== null) {
      leftChild.right.parent = node;
    }

    leftChild.parent = node.parent;

    if (node.parent === null) {
      this.root = leftChild;
    } else if (node === node.parent.right) {
      node.parent.right = leftChild;
    } else {
      node.parent.left = leftChild;
    }

    leftChild.right = node;
    node.parent = leftChild;
  }

  insert(key, value) {
    const newNode = new RBNode(key, value);

    if (this.root === null) {
      this.root = newNode;
      newNode.color = Color.BLACK;
      this.size++;
      return;
    }

    let current = this.root;
    let parent = null;

    while (current !== null) {
      parent = current;
      if (key < current.key) {
        current = current.left;
      } else if (key > current.key) {
        current = current.right;
      } else {
        // Key exists, update value
        current.value = value;
        return;
      }
    }

    newNode.parent = parent;
    if (key < parent.key) {
      parent.left = newNode;
    } else {
      parent.right = newNode;
    }

    this.size++;
    this.fixInsert(newNode);
  }

  fixInsert(node) {
    while (node !== this.root && node.parent.color === Color.RED) {
      if (node.parent === node.parent.parent.left) {
        const uncle = node.parent.parent.right;

        if (uncle !== null && uncle.color === Color.RED) {
          // Case 1: Uncle is red
          node.parent.color = Color.BLACK;
          uncle.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          node = node.parent.parent;
        } else {
          if (node === node.parent.right) {
            // Case 2: Node is right child
            node = node.parent;
            this.rotateLeft(node);
          }
          // Case 3: Node is left child
          node.parent.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          this.rotateRight(node.parent.parent);
        }
      } else {
        const uncle = node.parent.parent.left;

        if (uncle !== null && uncle.color === Color.RED) {
          node.parent.color = Color.BLACK;
          uncle.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          node = node.parent.parent;
        } else {
          if (node === node.parent.left) {
            node = node.parent;
            this.rotateRight(node);
          }
          node.parent.color = Color.BLACK;
          node.parent.parent.color = Color.RED;
          this.rotateLeft(node.parent.parent);
        }
      }
    }
    this.root.color = Color.BLACK;
  }

  find(key) {
    let current = this.root;
    while (current !== null) {
      if (key < current.key) {
        current = current.left;
      } else if (key > current.key) {
        current = current.right;
      } else {
        return current.value;
      }
    }
    return null;
  }

  inorderTraversal(node, result) {
    if (node === null) return;
    this.inorderTraversal(node.left, result);
    result.push({ key: node.key, value: node.value });
    this.inorderTraversal(node.right, result);
  }

  toArray() {
    const result = [];
    this.inorderTraversal(this.root, result);
    return result;
  }

  getHeight(node) {
    if (node === null) return 0;
    const leftHeight = this.getHeight(node.left);
    const rightHeight = this.getHeight(node.right);
    return 1 + Math.max(leftHeight, rightHeight);
  }

  height() {
    return this.getHeight(this.root);
  }
}

// Test the implementation
const tree = new RedBlackTree();

const values = [50, 25, 75, 10, 30, 60, 90, 5, 15, 27, 35];
for (let i = 0; i < values.length; i++) {
  tree.insert(values[i], "value_" + values[i]);
}

console.log("Tree size: " + tree.size);
console.log("Tree height: " + tree.height());
console.log("Find 30: " + tree.find(30));
console.log("Find 100: " + tree.find(100));
console.log("Sorted keys: " + tree.toArray().map(function(n) { return n.key; }).join(", "));
