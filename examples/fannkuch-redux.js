// Fannkuch Redux Benchmark
// Based on Computer Language Benchmarks Game
// Demonstrates: array manipulation, permutations, while loops, complex control flow

function fannkuch(n) {
  const perm = new Array(n);
  const perm1 = new Array(n);
  const count = new Array(n);

  let maxFlipsCount = 0;
  let checksum = 0;

  // Initialize perm1
  for (let i = 0; i < n; i++) {
    perm1[i] = i;
  }

  let r = n;
  let permCount = 0;

  while (true) {
    // Generate next permutation
    while (r !== 1) {
      count[r - 1] = r;
      r--;
    }

    // Copy perm1 to perm
    for (let i = 0; i < n; i++) {
      perm[i] = perm1[i];
    }

    // Count flips
    let flipsCount = 0;
    let k = perm[0];

    while (k !== 0) {
      // Reverse first k+1 elements
      let lo = 0;
      let hi = k;
      while (lo < hi) {
        const temp = perm[lo];
        perm[lo] = perm[hi];
        perm[hi] = temp;
        lo++;
        hi--;
      }
      flipsCount++;
      k = perm[0];
    }

    // Update max and checksum
    if (flipsCount > maxFlipsCount) {
      maxFlipsCount = flipsCount;
    }
    checksum += (permCount % 2 === 0) ? flipsCount : -flipsCount;
    permCount++;

    // Generate next permutation in-place
    while (true) {
      if (r === n) {
        return { maxFlips: maxFlipsCount, checksum: checksum };
      }

      const perm0 = perm1[0];
      let i = 0;
      while (i < r) {
        const j = i + 1;
        perm1[i] = perm1[j];
        i = j;
      }
      perm1[r] = perm0;

      count[r]--;
      if (count[r] > 0) {
        break;
      }
      r++;
    }
  }
}

// Run benchmark
const n = 7;
const result = fannkuch(n);
console.log("Pfannkuchen(" + n + ") = " + result.maxFlips);
console.log("Checksum: " + result.checksum);
