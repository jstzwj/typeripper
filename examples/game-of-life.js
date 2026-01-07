// Conway's Game of Life
// Demonstrates: 2D arrays, neighbor counting, state transitions, modular arithmetic

function createGrid(width, height) {
  const grid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(0);
    }
    grid.push(row);
  }
  return grid;
}

function copyGrid(grid) {
  const height = grid.length;
  const width = grid[0].length;
  const newGrid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(grid[y][x]);
    }
    newGrid.push(row);
  }
  return newGrid;
}

function countNeighbors(grid, x, y) {
  const height = grid.length;
  const width = grid[0].length;
  let count = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;

      // Wrap around edges (toroidal grid)
      const nx = (x + dx + width) % width;
      const ny = (y + dy + height) % height;

      count += grid[ny][nx];
    }
  }

  return count;
}

function step(grid) {
  const height = grid.length;
  const width = grid[0].length;
  const newGrid = createGrid(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const neighbors = countNeighbors(grid, x, y);
      const alive = grid[y][x] === 1;

      if (alive) {
        // Survival: 2 or 3 neighbors
        newGrid[y][x] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
      } else {
        // Birth: exactly 3 neighbors
        newGrid[y][x] = (neighbors === 3) ? 1 : 0;
      }
    }
  }

  return newGrid;
}

function printGrid(grid) {
  const height = grid.length;
  for (let y = 0; y < height; y++) {
    let line = "";
    const width = grid[y].length;
    for (let x = 0; x < width; x++) {
      line += grid[y][x] === 1 ? "#" : ".";
    }
    console.log(line);
  }
}

function countAlive(grid) {
  let count = 0;
  const height = grid.length;
  for (let y = 0; y < height; y++) {
    const width = grid[y].length;
    for (let x = 0; x < width; x++) {
      count += grid[y][x];
    }
  }
  return count;
}

// Initialize with some patterns
function addGlider(grid, startX, startY) {
  // Glider pattern
  const pattern = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1]
  ];
  for (let y = 0; y < pattern.length; y++) {
    for (let x = 0; x < pattern[y].length; x++) {
      grid[(startY + y) % grid.length][(startX + x) % grid[0].length] = pattern[y][x];
    }
  }
}

function addBlinker(grid, startX, startY) {
  // Blinker pattern (oscillator)
  grid[startY][startX] = 1;
  grid[startY][startX + 1] = 1;
  grid[startY][startX + 2] = 1;
}

function addBlock(grid, startX, startY) {
  // Block pattern (still life)
  grid[startY][startX] = 1;
  grid[startY][startX + 1] = 1;
  grid[startY + 1][startX] = 1;
  grid[startY + 1][startX + 1] = 1;
}

// Run simulation
const width = 40;
const height = 20;
let grid = createGrid(width, height);

// Add some patterns
addGlider(grid, 2, 2);
addBlinker(grid, 10, 5);
addBlock(grid, 20, 10);
addGlider(grid, 30, 15);

console.log("=== Conway's Game of Life ===\n");
console.log("Initial state (" + countAlive(grid) + " cells alive):");
printGrid(grid);

// Run for a few generations
const generations = 5;
for (let gen = 1; gen <= generations; gen++) {
  grid = step(grid);
  console.log("\nGeneration " + gen + " (" + countAlive(grid) + " cells alive):");
  printGrid(grid);
}
