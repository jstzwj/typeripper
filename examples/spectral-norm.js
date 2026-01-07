// Spectral Norm Benchmark
// Based on Computer Language Benchmarks Game
// Demonstrates: arrays, mathematical operations, nested loops, closures

function A(i, j) {
  return 1 / ((i + j) * (i + j + 1) / 2 + i + 1);
}

function multiplyAv(n, v, av) {
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += A(i, j) * v[j];
    }
    av[i] = sum;
  }
}

function multiplyAtv(n, v, atv) {
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += A(j, i) * v[j];
    }
    atv[i] = sum;
  }
}

function multiplyAtAv(n, v, atav) {
  const u = new Array(n);
  multiplyAv(n, v, u);
  multiplyAtv(n, u, atav);
}

function spectralNorm(n) {
  const u = new Array(n);
  const v = new Array(n);

  // Initialize u to all 1s
  for (let i = 0; i < n; i++) {
    u[i] = 1;
  }

  // Power iteration
  for (let i = 0; i < 10; i++) {
    multiplyAtAv(n, u, v);
    multiplyAtAv(n, v, u);
  }

  // Calculate result
  let vBv = 0;
  let vv = 0;
  for (let i = 0; i < n; i++) {
    vBv += u[i] * v[i];
    vv += v[i] * v[i];
  }

  return Math.sqrt(vBv / vv);
}

// Run benchmark
const n = 100;
const result = spectralNorm(n);
console.log("Spectral norm of " + n + "x" + n + " matrix: " + result.toFixed(9));
