// Simple Ray Tracer
// Demonstrates: vector math, object-oriented design, complex calculations

// Vector3 operations
function vec3(x, y, z) {
  return { x: x, y: y, z: z };
}

function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mul(v, s) {
  return vec3(v.x * s, v.y * s, v.z * s);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(v) {
  return Math.sqrt(dot(v, v));
}

function normalize(v) {
  const len = length(v);
  return vec3(v.x / len, v.y / len, v.z / len);
}

function reflect(v, n) {
  return sub(v, mul(n, 2 * dot(v, n)));
}

// Ray
function ray(origin, direction) {
  return { origin: origin, direction: normalize(direction) };
}

function pointAt(r, t) {
  return add(r.origin, mul(r.direction, t));
}

// Sphere
function sphere(center, radius, color, reflective) {
  return {
    center: center,
    radius: radius,
    color: color,
    reflective: reflective || 0
  };
}

function intersectSphere(r, s) {
  const oc = sub(r.origin, s.center);
  const a = dot(r.direction, r.direction);
  const b = 2.0 * dot(oc, r.direction);
  const c = dot(oc, oc) - s.radius * s.radius;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    return null;
  }

  const t1 = (-b - Math.sqrt(discriminant)) / (2 * a);
  const t2 = (-b + Math.sqrt(discriminant)) / (2 * a);

  if (t1 > 0.001) return t1;
  if (t2 > 0.001) return t2;
  return null;
}

function getNormal(s, point) {
  return normalize(sub(point, s.center));
}

// Scene
const scene = {
  spheres: [
    sphere(vec3(0, 0, 5), 1, vec3(1, 0, 0), 0.3),      // Red sphere
    sphere(vec3(2, 0, 4), 0.7, vec3(0, 1, 0), 0.5),    // Green sphere
    sphere(vec3(-2, 0, 6), 1.2, vec3(0, 0, 1), 0.2),   // Blue sphere
    sphere(vec3(0, -101, 5), 100, vec3(0.8, 0.8, 0.8), 0.1) // Ground
  ],
  light: normalize(vec3(-1, -1, -1)),
  ambient: 0.1
};

function trace(r, depth) {
  if (depth <= 0) {
    return vec3(0, 0, 0);
  }

  let closest = null;
  let closestT = Infinity;
  let closestSphere = null;

  for (let i = 0; i < scene.spheres.length; i++) {
    const s = scene.spheres[i];
    const t = intersectSphere(r, s);
    if (t !== null && t < closestT) {
      closestT = t;
      closestSphere = s;
    }
  }

  if (closestSphere === null) {
    // Sky gradient
    const t = 0.5 * (r.direction.y + 1.0);
    return add(mul(vec3(1, 1, 1), 1 - t), mul(vec3(0.5, 0.7, 1.0), t));
  }

  const hitPoint = pointAt(r, closestT);
  const normal = getNormal(closestSphere, hitPoint);

  // Diffuse lighting
  const lightIntensity = Math.max(0, -dot(normal, scene.light));
  const diffuse = mul(closestSphere.color, lightIntensity + scene.ambient);

  // Reflection
  if (closestSphere.reflective > 0 && depth > 1) {
    const reflectDir = reflect(r.direction, normal);
    const reflectRay = ray(hitPoint, reflectDir);
    const reflectColor = trace(reflectRay, depth - 1);

    return add(
      mul(diffuse, 1 - closestSphere.reflective),
      mul(reflectColor, closestSphere.reflective)
    );
  }

  return diffuse;
}

function render(width, height) {
  const aspectRatio = width / height;
  const fov = 1.0;
  const result = [];

  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      // Map pixel to normalized device coordinates
      const px = (2 * x / width - 1) * aspectRatio * fov;
      const py = (1 - 2 * y / height) * fov;

      const r = ray(vec3(0, 0, 0), vec3(px, py, 1));
      const color = trace(r, 3);

      // Convert to character
      const brightness = (color.x + color.y + color.z) / 3;
      if (brightness > 0.8) row += "@";
      else if (brightness > 0.6) row += "#";
      else if (brightness > 0.4) row += "+";
      else if (brightness > 0.2) row += ".";
      else row += " ";
    }
    result.push(row);
  }

  return result;
}

// Render and display
const image = render(60, 30);
for (let i = 0; i < image.length; i++) {
  console.log(image[i]);
}
console.log("\nRay traced scene with 4 spheres");
