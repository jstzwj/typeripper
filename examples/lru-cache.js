// LRU (Least Recently Used) Cache Implementation
// Demonstrates: doubly linked list, hash map, object references, cache eviction

function LRUCache(capacity) {
  this.capacity = capacity;
  this.size = 0;
  this.cache = {};  // key -> node

  // Dummy head and tail for doubly linked list
  this.head = { key: null, value: null, prev: null, next: null };
  this.tail = { key: null, value: null, prev: null, next: null };
  this.head.next = this.tail;
  this.tail.prev = this.head;
}

LRUCache.prototype.createNode = function(key, value) {
  return {
    key: key,
    value: value,
    prev: null,
    next: null
  };
};

LRUCache.prototype.addToFront = function(node) {
  node.prev = this.head;
  node.next = this.head.next;
  this.head.next.prev = node;
  this.head.next = node;
};

LRUCache.prototype.removeNode = function(node) {
  const prev = node.prev;
  const next = node.next;
  prev.next = next;
  next.prev = prev;
};

LRUCache.prototype.moveToFront = function(node) {
  this.removeNode(node);
  this.addToFront(node);
};

LRUCache.prototype.removeLRU = function() {
  const lru = this.tail.prev;
  this.removeNode(lru);
  delete this.cache[lru.key];
  this.size--;
  return lru;
};

LRUCache.prototype.get = function(key) {
  if (this.cache[key] === undefined) {
    return -1;
  }

  const node = this.cache[key];
  this.moveToFront(node);
  return node.value;
};

LRUCache.prototype.put = function(key, value) {
  if (this.cache[key] !== undefined) {
    // Update existing
    const node = this.cache[key];
    node.value = value;
    this.moveToFront(node);
    return;
  }

  // Add new
  const node = this.createNode(key, value);
  this.cache[key] = node;
  this.addToFront(node);
  this.size++;

  // Evict if over capacity
  if (this.size > this.capacity) {
    this.removeLRU();
  }
};

LRUCache.prototype.getKeys = function() {
  const keys = [];
  let current = this.head.next;
  while (current !== this.tail) {
    keys.push(current.key);
    current = current.next;
  }
  return keys;
};

LRUCache.prototype.toString = function() {
  const items = [];
  let current = this.head.next;
  while (current !== this.tail) {
    items.push(current.key + ":" + current.value);
    current = current.next;
  }
  return "[" + items.join(" -> ") + "] (size: " + this.size + "/" + this.capacity + ")";
};

// Test the cache
console.log("=== LRU Cache Demo ===\n");

const cache = new LRUCache(3);

console.log("Put a=1, b=2, c=3");
cache.put("a", 1);
cache.put("b", 2);
cache.put("c", 3);
console.log("Cache: " + cache.toString());

console.log("\nGet 'a' => " + cache.get("a"));
console.log("Cache: " + cache.toString());
console.log("('a' moved to front)");

console.log("\nPut d=4 (causes eviction)");
cache.put("d", 4);
console.log("Cache: " + cache.toString());
console.log("('b' was evicted as LRU)");

console.log("\nGet 'b' => " + cache.get("b"));
console.log("(returns -1, 'b' was evicted)");

console.log("\nGet 'c' => " + cache.get("c"));
console.log("Cache: " + cache.toString());

console.log("\nUpdate 'a' to 10");
cache.put("a", 10);
console.log("Cache: " + cache.toString());

console.log("\nPut e=5, f=6 (two evictions)");
cache.put("e", 5);
console.log("Cache: " + cache.toString());
cache.put("f", 6);
console.log("Cache: " + cache.toString());

console.log("\nFinal keys (MRU to LRU): " + cache.getKeys().join(", "));
