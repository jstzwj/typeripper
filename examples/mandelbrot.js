// Mandelbrot Set Generator
// Demonstrates: nested loops, complex number arithmetic, bitwise operations

function mandelbrot(width, height, maxIterations) {
  const result = [];

  for (let py = 0; py < height; py++) {
    let row = "";
    for (let px = 0; px < width; px++) {
      // Map pixel to complex plane
      const x0 = (px / width) * 3.5 - 2.5;
      const y0 = (py / height) * 2.0 - 1.0;

      let x = 0;
      let y = 0;
      let iteration = 0;

      // Iterate z = z^2 + c
      while (x * x + y * y <= 4 && iteration < maxIterations) {
        const xtemp = x * x - y * y + x0;
        y = 2 * x * y + y0;
        x = xtemp;
        iteration++;
      }

      // Map to character
      if (iteration === maxIterations) {
        row += "#";
      } else if (iteration > maxIterations * 0.8) {
        row += "+";
      } else if (iteration > maxIterations * 0.6) {
        row += "-";
      } else if (iteration > maxIterations * 0.4) {
        row += ".";
      } else {
        row += " ";
      }
    }
    result.push(row);
  }

  return result;
}

function calculateArea(width, height, maxIterations) {
  let insideCount = 0;
  const total = width * height;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x0 = (px / width) * 3.5 - 2.5;
      const y0 = (py / height) * 2.0 - 1.0;

      let x = 0;
      let y = 0;
      let iteration = 0;

      while (x * x + y * y <= 4 && iteration < maxIterations) {
        const xtemp = x * x - y * y + x0;
        y = 2 * x * y + y0;
        x = xtemp;
        iteration++;
      }

      if (iteration === maxIterations) {
        insideCount++;
      }
    }
  }

  // Estimate area (the visible region is 3.5 x 2.0)
  return (insideCount / total) * 3.5 * 2.0;
}

// Generate and display
const width = 80;
const height = 40;
const maxIter = 100;

const image = mandelbrot(width, height, maxIter);
for (let i = 0; i < image.length; i++) {
  console.log(image[i]);
}

const area = calculateArea(width, height, maxIter);
console.log("\nEstimated Mandelbrot area: " + area.toFixed(6));
