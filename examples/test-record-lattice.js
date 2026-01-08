// Test MLsub record lattice operations (join ⊔ and meet ⊓)

// Test 1: Record Join - domain intersection
// {a, b} ⊔ {a, c} should give {a}
function testJoin1(x) {
  if (Math.random() > 0.5) {
    return { a: 1, b: 2 };
  } else {
    return { a: 3, c: 4 };
  }
}

// Test 2: Width subtyping via join
// {a, b, c} ≤ {a} because {a, b, c} ⊔ {a} = {a}
function testWidthSubtyping(obj) {
  const wide = { a: 1, b: 2, c: 3 };
  const narrow = { a: 4 };

  // This should typecheck: wide can be used where narrow is expected
  return testJoin1(wide);
}

// Test 3: Record Meet - domain union
// {a: number} ⊓ {b: string} should give {a: number, b: string}
function testMeet1(needBoth) {
  const hasA = { a: 1 };
  const hasB = { b: "hello" };

  // The intersection of these two types should have both fields
  function requireBoth(obj) {
    return obj.a + obj.b.length;
  }

  // This simulates meet through intersection type
  return requireBoth({ a: 1, b: "world" });
}

// Test 4: Depth subtyping (covariant fields)
// {a: number} ≤ {a: number | string}
function testDepthSubtyping() {
  const specific = { a: 42 };
  const general = { a: Math.random() > 0.5 ? 42 : "hello" };

  return specific;
}

// Test 5: Empty record join
// {} ⊔ {a: T} = {}
function testEmptyJoin(x) {
  if (Math.random() > 0.5) {
    return {};
  } else {
    return { a: 1 };
  }
}

// Test 6: Complex nested records
function testNestedRecords() {
  const obj1 = {
    user: { name: "Alice", age: 30 },
    score: 100
  };

  const obj2 = {
    user: { name: "Bob", email: "bob@example.com" },
    rank: 5
  };

  // Union of obj1 and obj2 should have only common fields
  function getCommon(o) {
    return o.user;
  }

  return getCommon(Math.random() > 0.5 ? obj1 : obj2);
}

// Test 7: Member access on union (should infer common fields)
function testMemberOnUnion() {
  const obj = Math.random() > 0.5
    ? { x: 1, y: 2, z: 3 }
    : { x: 4, y: 5, w: 6 };

  // Should be able to access x and y (common fields)
  return obj.x + obj.y;
}

console.log("Test 1:", testJoin1());
console.log("Test 2:", testWidthSubtyping({ a: 1, b: 2, c: 3 }));
console.log("Test 3:", testMeet1(true));
console.log("Test 4:", testDepthSubtyping());
console.log("Test 5:", testEmptyJoin());
console.log("Test 6:", testNestedRecords());
console.log("Test 7:", testMemberOnUnion());
