import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/stl/anatomical-organs");
const TAU = Math.PI * 2;
const GRID = Object.freeze({ x: 42, y: 48, z: 38 });

const point = (x, y, z) => [x, y, z];
const add = (a, b) => point(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
const sub = (a, b) => point(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const scale = (a, amount) => point(a[0] * amount, a[1] * amount, a[2] * amount);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => point(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
const length = (value) => Math.hypot(...value);
const normalize = (value) => scale(value, 1 / (length(value) || 1));
const mix = (a, b, amount) => a + (b - a) * amount;
const mixPoint = (a, b, amount) => point(mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount));

function ellipsoid(p, center, radius) {
  return 1 - Math.hypot(
    (p[0] - center[0]) / radius[0],
    (p[1] - center[1]) / radius[1],
    (p[2] - center[2]) / radius[2],
  );
}

function capsule(p, start, end, radius) {
  const axis = sub(end, start);
  const amount = Math.max(0, Math.min(1, dot(sub(p, start), axis) / (dot(axis, axis) || 1)));
  return radius - length(sub(p, mixPoint(start, end, amount)));
}

function torus(p, center, majorRadius, minorRadius, axis = "z") {
  const q = sub(p, center);
  const radial = axis === "x" ? Math.hypot(q[1], q[2]) : axis === "y" ? Math.hypot(q[0], q[2]) : Math.hypot(q[0], q[1]);
  const axial = axis === "x" ? q[0] : axis === "y" ? q[1] : q[2];
  return minorRadius - Math.hypot(radial - majorRadius, axial);
}

function smoothUnion(a, b, softness = 0.08) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  const blend = Math.max(0, Math.min(1, 0.5 + 0.5 * (a - b) / softness));
  return mix(b, a, blend) + softness * blend * (1 - blend);
}

function union(fields, softness = 0.08) {
  return fields.reduce((value, field) => smoothUnion(value, field, softness), -Infinity);
}

function subtractField(shape, cutter) {
  return Math.min(shape, -cutter);
}

function organicNoise(p) {
  return (
    Math.sin(p[0] * 17.1 + p[1] * 6.3) +
    Math.sin(p[1] * 19.7 - p[2] * 8.9) +
    Math.sin(p[2] * 15.3 + p[0] * 7.7)
  ) / 3;
}

function tubePath(p, nodes, radius, softness = 0.035) {
  const fields = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const startRadius = Array.isArray(radius) ? radius[Math.min(index, radius.length - 1)] : radius;
    fields.push(capsule(p, nodes[index], nodes[index + 1], startRadius));
  }
  return union(fields, softness);
}

function heartField(p) {
  const body = union([
    ellipsoid(p, [-0.19, 0.13, 0], [0.43, 0.5, 0.36]),
    ellipsoid(p, [0.18, 0.1, 0.01], [0.4, 0.46, 0.34]),
    ellipsoid(p, [-0.02, -0.19, 0.015], [0.49, 0.57, 0.39]),
    ellipsoid(p, [0.02, -0.54, 0.005], [0.24, 0.4, 0.22]),
  ], 0.14) + organicNoise(scale(p, 1.2)) * 0.018;
  const vessels = union([
    tubePath(p, [[-0.15, 0.34, 0.02], [-0.18, 0.69, 0.03], [0.02, 0.86, 0.01], [0.24, 0.72, -0.01]], [0.12, 0.105, 0.085]),
    tubePath(p, [[0.12, 0.31, 0.02], [0.34, 0.62, 0.02], [0.52, 0.57, 0]], [0.1, 0.075]),
    tubePath(p, [[-0.3, 0.28, -0.02], [-0.53, 0.48, -0.04]], 0.085),
    tubePath(p, [[0.2, 0.24, -0.04], [0.28, 0.64, -0.06]], 0.09),
  ], 0.06);
  const coronary = union([
    tubePath(p, [[-0.08, 0.26, 0.34], [-0.18, -0.03, 0.39], [-0.1, -0.37, 0.3], [0.0, -0.7, 0.17]], [0.032, 0.027, 0.02]),
    tubePath(p, [[0.04, 0.28, 0.34], [0.25, 0.02, 0.34], [0.31, -0.32, 0.24]], [0.029, 0.022]),
  ], 0.025);
  return union([body, vessels, coronary], 0.055);
}

function lungLobe(p, side) {
  const x = p[0] * side;
  const warped = point(x + 0.04 * Math.sin(p[1] * 4), p[1], p[2]);
  let lobe = union([
    ellipsoid(warped, [0.27, 0.08, 0], [0.28, 0.65, 0.32]),
    ellipsoid(warped, [0.31, -0.34, 0.015], [0.33, 0.37, 0.35]),
  ], 0.12);
  lobe = subtractField(lobe, ellipsoid(warped, [-0.03, 0.02, 0.12], [0.22, 0.46, 0.23]));
  const fissure = capsule(warped, [0.1, -0.06, 0.28], [0.52, -0.25, 0.26], 0.025);
  return Math.min(lobe + organicNoise(scale(warped, 1.5)) * 0.012, -fissure);
}

function lungsField(p) {
  const tissue = Math.max(lungLobe(p, -1), lungLobe(p, 1));
  const airway = union([
    tubePath(p, [[0, 0.86, 0], [0, 0.35, 0]], [0.075]),
    tubePath(p, [[0, 0.36, 0], [-0.21, 0.15, 0.01], [-0.42, -0.02, 0.03]], [0.065, 0.045]),
    tubePath(p, [[0, 0.36, 0], [0.21, 0.15, 0.01], [0.42, -0.02, 0.03]], [0.065, 0.045]),
    tubePath(p, [[-0.22, 0.15, 0.01], [-0.35, -0.22, 0.08]], 0.032),
    tubePath(p, [[0.22, 0.15, 0.01], [0.35, -0.22, 0.08]], 0.032),
  ], 0.04);
  return union([tissue, airway], 0.035);
}

function liverStomachField(p) {
  const liverPoint = point(p[0], p[1] + 0.05 * p[0], p[2]);
  let liver = union([
    ellipsoid(liverPoint, [-0.1, 0.23, -0.03], [0.72, 0.32, 0.3]),
    ellipsoid(liverPoint, [0.38, 0.16, -0.04], [0.36, 0.27, 0.25]),
  ], 0.12);
  liver = subtractField(liver, ellipsoid(liverPoint, [0.2, -0.05, 0.22], [0.28, 0.16, 0.13]));
  const stomach = union([
    tubePath(p, [[0.08, -0.12, 0.05], [0.24, -0.27, 0.06], [0.32, -0.5, 0.03], [0.13, -0.66, 0]], [0.14, 0.19, 0.145], 0.09),
    tubePath(p, [[0.1, -0.02, 0.04], [0.02, 0.18, 0.03]], 0.08),
  ], 0.08);
  const gallbladder = tubePath(p, [[-0.1, 0.04, 0.25], [-0.13, -0.19, 0.27]], [0.055]);
  return Math.max(liver + organicNoise(scale(p, 1.4)) * 0.012, stomach, gallbladder);
}

function kidneyShape(p, side) {
  const q = point(p[0] * side, p[1], p[2]);
  let kidney = union([
    ellipsoid(q, [0.34, 0, 0], [0.25, 0.49, 0.25]),
    ellipsoid(q, [0.4, -0.05, 0], [0.22, 0.35, 0.26]),
  ], 0.1);
  kidney = subtractField(kidney, ellipsoid(q, [0.16, 0, 0.05], [0.2, 0.24, 0.17]));
  const ureter = tubePath(q, [[0.2, -0.06, 0], [0.12, -0.47, -0.02], [0.06, -0.82, -0.03]], [0.035, 0.024]);
  const artery = tubePath(q, [[0.18, 0.03, 0.02], [0.01, 0.08, 0.03]], 0.03);
  return union([kidney + organicNoise(scale(q, 1.8)) * 0.014, ureter, artery], 0.03);
}

function kidneysField(p) {
  return Math.max(kidneyShape(p, -1), kidneyShape(p, 1));
}

function brainField(p) {
  const q = point(p[0], p[1], p[2] * 1.04);
  const left = ellipsoid(q, [-0.22, 0.12, 0], [0.49, 0.57, 0.43]);
  const right = ellipsoid(q, [0.22, 0.12, 0], [0.49, 0.57, 0.43]);
  const folds = 0.045 * (
    Math.sin(q[0] * 22 + Math.sin(q[1] * 7)) *
    Math.sin(q[1] * 19 - q[2] * 5) +
    0.55 * Math.sin(q[2] * 24 + q[0] * 8)
  );
  let cerebrum = Math.max(left, right) + folds;
  const fissure = 0.025 - Math.abs(q[0] + Math.sin(q[1] * 8) * 0.012);
  cerebrum = subtractField(cerebrum, fissure);
  const cerebellum = ellipsoid(q, [0, -0.43, -0.17], [0.48, 0.24, 0.31]) + 0.03 * Math.sin(q[0] * 27) * Math.sin(q[2] * 20);
  const stem = tubePath(q, [[0, -0.35, -0.15], [0.03, -0.72, -0.2]], [0.105]);
  return union([cerebrum, cerebellum, stem], 0.045);
}

function eyeField(p) {
  const globe = ellipsoid(p, [0, 0.05, 0], [0.5, 0.5, 0.48]) + organicNoise(scale(p, 2)) * 0.006;
  const cornea = ellipsoid(p, [0, 0.08, 0.39], [0.29, 0.29, 0.16]);
  const iris = torus(p, [0, 0.08, 0.49], 0.17, 0.022, "z");
  const nerve = tubePath(p, [[0, 0.04, -0.42], [0.05, 0.0, -0.73], [0.14, -0.08, -0.9]], [0.075, 0.055]);
  return union([globe, cornea, iris, nerve], 0.035);
}

function earField(p) {
  const outerNodes = [];
  for (let index = 0; index <= 30; index += 1) {
    const angle = -2.45 + index / 30 * 5.15;
    outerNodes.push([Math.cos(angle) * 0.44 - 0.02, Math.sin(angle) * 0.66, 0.04 * Math.sin(angle * 2)]);
  }
  const innerNodes = [];
  for (let index = 0; index <= 24; index += 1) {
    const amount = index / 24;
    const angle = -1.8 + amount * 4.8;
    const radius = 0.3 * (1 - amount * 0.48);
    innerNodes.push([Math.cos(angle) * radius - 0.02, Math.sin(angle) * radius * 1.25, 0.09]);
  }
  const helix = tubePath(p, outerNodes, 0.09, 0.05);
  const antihelix = tubePath(p, innerNodes, 0.06, 0.04);
  const lobe = ellipsoid(p, [-0.09, -0.61, 0], [0.23, 0.24, 0.16]);
  const canal = torus(p, [0.02, -0.03, 0.05], 0.12, 0.045, "z");
  const innerEar = tubePath(p, [[0.1, -0.02, -0.02], [0.35, -0.04, -0.12], [0.52, 0.03, -0.18]], [0.055, 0.04]);
  return union([helix, antihelix, lobe, canal, innerEar], 0.045);
}

function vascularField(p) {
  const paths = [
    { nodes: [[0, -0.82, 0], [0, -0.25, 0], [0.02, 0.22, 0], [0, 0.83, 0]], radii: [0.07, 0.065, 0.055] },
    { nodes: [[0, -0.2, 0], [-0.28, 0.02, 0.03], [-0.55, 0.2, 0.01], [-0.78, 0.36, 0]], radii: [0.055, 0.04, 0.025] },
    { nodes: [[0, -0.2, 0], [0.28, 0.02, -0.02], [0.54, 0.23, 0.01], [0.78, 0.42, 0]], radii: [0.055, 0.04, 0.025] },
    { nodes: [[-0.29, 0.02, 0.03], [-0.42, -0.25, 0.06], [-0.64, -0.48, 0.04]], radii: [0.036, 0.022] },
    { nodes: [[0.28, 0.02, -0.02], [0.43, -0.28, -0.05], [0.67, -0.52, -0.03]], radii: [0.036, 0.022] },
    { nodes: [[-0.54, 0.2, 0.01], [-0.48, 0.5, 0.05], [-0.62, 0.76, 0.03]], radii: [0.03, 0.018] },
    { nodes: [[0.54, 0.23, 0.01], [0.48, 0.51, -0.04], [0.63, 0.78, -0.02]], radii: [0.03, 0.018] },
  ];
  return union(paths.map((path) => tubePath(p, path.nodes, path.radii, 0.025)), 0.035);
}

const organs = [
  ["01_anatomical_heart.stl", "Organic anatomical heart", heartField],
  ["02_bronchial_lungs.stl", "Bronchial lungs", lungsField],
  ["03_liver_and_stomach.stl", "Liver and stomach", liverStomachField],
  ["04_kidney_pair.stl", "Kidney pair", kidneysField],
  ["05_cerebral_brain.stl", "Cerebral brain", brainField],
  ["06_eye_and_optic_nerve.stl", "Eye and optic nerve", eyeField],
  ["07_inner_outer_ear.stl", "Inner and outer ear", earField],
  ["08_vascular_tree.stl", "Vascular tree", vascularField],
];

const cubeCorners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const cubeTetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

function polygonize(field, grid = GRID) {
  const values = new Float32Array((grid.x + 1) * (grid.y + 1) * (grid.z + 1));
  const index = (x, y, z) => x + (grid.x + 1) * (y + (grid.y + 1) * z);
  const position = (x, y, z) => point(x / grid.x * 2 - 1, y / grid.y * 2 - 1, z / grid.z * 2 - 1);
  for (let z = 0; z <= grid.z; z += 1) for (let y = 0; y <= grid.y; y += 1) for (let x = 0; x <= grid.x; x += 1) {
    values[index(x, y, z)] = field(position(x, y, z));
  }
  const triangles = [];
  for (let z = 0; z < grid.z; z += 1) for (let y = 0; y < grid.y; y += 1) for (let x = 0; x < grid.x; x += 1) {
    const positions = cubeCorners.map(([dx, dy, dz]) => position(x + dx, y + dy, z + dz));
    const samples = cubeCorners.map(([dx, dy, dz]) => values[index(x + dx, y + dy, z + dz)]);
    for (const tetrahedron of cubeTetrahedra) polygonizeTetrahedron(field, tetrahedron.map((corner) => positions[corner]), tetrahedron.map((corner) => samples[corner]), triangles);
  }
  return normalizedTriangles(triangles);
}

function polygonizeTetrahedron(field, positions, samples, triangles) {
  const inside = [], outside = [];
  for (let index = 0; index < 4; index += 1) (samples[index] >= 0 ? inside : outside).push(index);
  if (!inside.length || !outside.length) return;
  const crossing = (a, b) => {
    const amount = samples[a] / (samples[a] - samples[b] || 1);
    return mixPoint(positions[a], positions[b], amount);
  };
  if (inside.length === 1 || outside.length === 1) {
    const loneInside = inside.length === 1;
    const lone = loneInside ? inside[0] : outside[0];
    const others = loneInside ? outside : inside;
    addOrientedTriangle(field, crossing(lone, others[0]), crossing(lone, others[1]), crossing(lone, others[2]), triangles);
    return;
  }
  const [a, b] = inside, [c, d] = outside;
  const ac = crossing(a, c), ad = crossing(a, d), bc = crossing(b, c), bd = crossing(b, d);
  addOrientedTriangle(field, ac, ad, bc, triangles);
  addOrientedTriangle(field, ad, bd, bc, triangles);
}

function addOrientedTriangle(field, a, b, c, triangles) {
  const center = scale(add(add(a, b), c), 1 / 3);
  const epsilon = 0.002;
  const gradient = point(
    field(add(center, [epsilon, 0, 0])) - field(add(center, [-epsilon, 0, 0])),
    field(add(center, [0, epsilon, 0])) - field(add(center, [0, -epsilon, 0])),
    field(add(center, [0, 0, epsilon])) - field(add(center, [0, 0, -epsilon])),
  );
  const normal = cross(sub(b, a), sub(c, a));
  triangles.push(dot(normal, gradient) > 0 ? [a, c, b] : [a, b, c]);
}

function normalizedTriangles(triangles, targetSize = 100) {
  const vertices = triangles.flat();
  const min = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
  const extent = Math.max(...max.map((value, axis) => value - min[axis])) || 1;
  const factor = targetSize / extent;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  return triangles.map((triangle) => triangle.map(([x, y, z]) => [
    (x - center[0]) * factor,
    (y - center[1]) * factor,
    (z - min[2]) * factor,
  ]));
}

function binaryStl(name, triangles) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write(`VJ1 ${name}`.slice(0, 80), 0, "ascii");
  buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const triangle of triangles) {
    const normal = normalize(cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])));
    for (const value of [...normal, ...triangle[0], ...triangle[1], ...triangle[2]]) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buffer;
}

await mkdir(outputDir, { recursive: true });
for (const [filename, name, field] of organs) {
  const triangles = polygonize(field);
  await writeFile(resolve(outputDir, filename), binaryStl(name, triangles));
  console.log(`${filename}: ${triangles.length} triangles`);
}
