import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/stl/dantes-inferno");
const TAU = Math.PI * 2;

class Mesh {
  constructor(name) {
    this.name = name;
    this.triangles = [];
  }

  tri(a, b, c) {
    this.triangles.push([a, b, c]);
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

const point = (x, y, z) => [x, y, z];

function addBox(mesh, cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const p = [
    point(x0, y0, z0), point(x1, y0, z0), point(x1, y1, z0), point(x0, y1, z0),
    point(x0, y0, z1), point(x1, y0, z1), point(x1, y1, z1), point(x0, y1, z1),
  ];
  mesh.quad(p[0], p[3], p[2], p[1]);
  mesh.quad(p[4], p[5], p[6], p[7]);
  mesh.quad(p[0], p[1], p[5], p[4]);
  mesh.quad(p[1], p[2], p[6], p[5]);
  mesh.quad(p[2], p[3], p[7], p[6]);
  mesh.quad(p[3], p[0], p[4], p[7]);
}

function addFrustum(mesh, cx, cy, z0, z1, r0, r1, segments = 24) {
  const bottomCenter = point(cx, cy, z0);
  const topCenter = point(cx, cy, z1);
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * TAU;
    const a1 = (i + 1) / segments * TAU;
    const b0 = point(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z0);
    const b1 = point(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z0);
    const t0 = point(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z1);
    const t1 = point(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z1);
    mesh.quad(b0, b1, t1, t0);
    mesh.tri(bottomCenter, b1, b0);
    mesh.tri(topCenter, t0, t1);
  }
}

function addCylinderBetween(mesh, a, b, radius, segments = 12) {
  const axis = normalize(sub(b, a));
  const helper = Math.abs(axis[2]) < 0.9 ? point(0, 0, 1) : point(0, 1, 0);
  const u = normalize(cross(axis, helper));
  const v = cross(axis, u);
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments * TAU;
    const t1 = (i + 1) / segments * TAU;
    const ra = add(scale(u, Math.cos(t0) * radius), scale(v, Math.sin(t0) * radius));
    const rb = add(scale(u, Math.cos(t1) * radius), scale(v, Math.sin(t1) * radius));
    const a0 = add(a, ra), a1 = add(a, rb), b0 = add(b, ra), b1 = add(b, rb);
    mesh.quad(a0, b0, b1, a1);
    mesh.tri(a, a1, a0);
    mesh.tri(b, b0, b1);
  }
}

function addTorus(mesh, cx, cy, cz, major, minor, majorSegments = 48, minorSegments = 10) {
  for (let i = 0; i < majorSegments; i++) {
    const a0 = i / majorSegments * TAU;
    const a1 = (i + 1) / majorSegments * TAU;
    for (let j = 0; j < minorSegments; j++) {
      const b0 = j / minorSegments * TAU;
      const b1 = (j + 1) / minorSegments * TAU;
      mesh.quad(
        torusPoint(cx, cy, cz, major, minor, a0, b0),
        torusPoint(cx, cy, cz, major, minor, a1, b0),
        torusPoint(cx, cy, cz, major, minor, a1, b1),
        torusPoint(cx, cy, cz, major, minor, a0, b1),
      );
    }
  }
}

function torusPoint(cx, cy, cz, major, minor, a, b) {
  const radial = major + Math.cos(b) * minor;
  return point(cx + Math.cos(a) * radial, cy + Math.sin(a) * radial, cz + Math.sin(b) * minor);
}

function addArchTube(mesh, cx, cy, baseZ, radius, tube, segments = 32, tubeSegments = 10) {
  const ring = (angle, phase) => point(
    cx + Math.cos(angle) * (radius + Math.cos(phase) * tube),
    cy + Math.sin(phase) * tube,
    baseZ + Math.sin(angle) * (radius + Math.cos(phase) * tube),
  );
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * Math.PI;
    const a1 = (i + 1) / segments * Math.PI;
    for (let j = 0; j < tubeSegments; j++) {
      const b0 = j / tubeSegments * TAU;
      const b1 = (j + 1) / tubeSegments * TAU;
      mesh.quad(ring(a0, b0), ring(a1, b0), ring(a1, b1), ring(a0, b1));
    }
  }
  for (const angle of [0, Math.PI]) {
    const center = ring(angle, 0).map((value, index) => index === 0
      ? cx + Math.cos(angle) * radius
      : index === 1 ? cy : baseZ + Math.sin(angle) * radius);
    for (let j = 0; j < tubeSegments; j++) {
      const b0 = j / tubeSegments * TAU;
      const b1 = (j + 1) / tubeSegments * TAU;
      if (angle === 0) mesh.tri(center, ring(angle, b1), ring(angle, b0));
      else mesh.tri(center, ring(angle, b0), ring(angle, b1));
    }
  }
}

function addHeightfield(mesh, sizeX, sizeY, nx, ny, height, floorZ = -12) {
  const vertices = [];
  for (let y = 0; y <= ny; y++) {
    const row = [];
    for (let x = 0; x <= nx; x++) {
      const px = (x / nx - 0.5) * sizeX;
      const py = (y / ny - 0.5) * sizeY;
      row.push(point(px, py, height(px, py)));
    }
    vertices.push(row);
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const a = vertices[y][x], b = vertices[y][x + 1];
      const c = vertices[y + 1][x + 1], d = vertices[y + 1][x];
      mesh.quad(a, b, c, d);
    }
  }
  const edges = [
    Array.from({ length: nx + 1 }, (_, x) => vertices[0][x]),
    Array.from({ length: ny + 1 }, (_, y) => vertices[y][nx]),
    Array.from({ length: nx + 1 }, (_, x) => vertices[ny][nx - x]),
    Array.from({ length: ny + 1 }, (_, y) => vertices[ny - y][0]),
  ];
  for (const edge of edges) {
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1];
      mesh.quad(a, point(a[0], a[1], floorZ), point(b[0], b[1], floorZ), b);
    }
  }
  mesh.quad(
    point(-sizeX / 2, -sizeY / 2, floorZ),
    point(-sizeX / 2, sizeY / 2, floorZ),
    point(sizeX / 2, sizeY / 2, floorZ),
    point(sizeX / 2, -sizeY / 2, floorZ),
  );
}

function makeNineCircles() {
  const mesh = new Mesh("Nine circles descent");
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    addTorus(mesh, 0, 0, 42 - i * 10, 37 - t * 25, 1.5 + t * 0.8, 44, 8);
  }
  addFrustum(mesh, 0, 0, -45, 45, 10, 2.8, 28);
  return mesh;
}

function makeAbyss() {
  const mesh = new Mesh("Abyssal pit");
  addHeightfield(mesh, 100, 100, 42, 42, (x, y) => {
    const r = Math.hypot(x, y);
    const rim = 15 * Math.exp(-Math.pow((r - 29) / 8, 2));
    const pit = -48 * Math.exp(-Math.pow(r / 21, 2));
    return rim + pit + fbm(x * 0.06, y * 0.06) * 5;
  }, -55);
  return mesh;
}

function makeVolcano() {
  const mesh = new Mesh("Volcanic terrain");
  addHeightfield(mesh, 100, 100, 42, 42, (x, y) => {
    const r = Math.hypot(x, y);
    return 48 * Math.exp(-Math.pow(r / 26, 2))
      - 28 * Math.exp(-Math.pow(r / 8, 2))
      + fbm(x * 0.09, y * 0.09) * 7 * Math.exp(-r / 55);
  }, -15);
  return mesh;
}

function makeMountains() {
  const mesh = new Mesh("Mountain range");
  const peaks = [[-32, -12, 37, 15], [-8, 8, 52, 17], [18, -8, 44, 14], [35, 14, 30, 12]];
  addHeightfield(mesh, 110, 75, 46, 32, (x, y) => peaks.reduce((z, [px, py, h, spread]) =>
    z + h * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (spread ** 2)), 0)
    + fbm(x * 0.08, y * 0.08) * 5, -10);
  return mesh;
}

function makeCanyon() {
  const mesh = new Mesh("Canyon chasm");
  addHeightfield(mesh, 110, 80, 46, 34, (x, y) => {
    const channel = smoothstep(7, 27, Math.abs(x + Math.sin(y * 0.08) * 7));
    const shelves = Math.floor(channel * 4) / 4;
    return shelves * 42 + fbm(x * 0.07, y * 0.07) * 4;
  }, -12);
  return mesh;
}

function makeArch() {
  const mesh = new Mesh("Infernal arch");
  addBox(mesh, -30, 0, 24, 10, 18, 48);
  addBox(mesh, 30, 0, 24, 10, 18, 48);
  addBox(mesh, 0, 0, 3, 78, 25, 6);
  addArchTube(mesh, 0, 0, 47, 30, 5, 36, 10);
  for (const x of [-30, 30]) {
    addFrustum(mesh, x, 0, 47, 57, 8, 5, 12);
    addFrustum(mesh, x, 0, 0, 8, 9, 7, 12);
  }
  return mesh;
}

function makeSpires() {
  const mesh = new Mesh("Gothic spires");
  const towers = [[0, 0, 60, 12], [-25, 6, 43, 9], [25, 6, 43, 9], [-38, 12, 30, 7], [38, 12, 30, 7]];
  addBox(mesh, 0, 7, 4, 92, 38, 8);
  for (const [x, y, h, r] of towers) {
    addFrustum(mesh, x, y, 6, h * 0.65, r, r * 0.78, 12);
    addFrustum(mesh, x, y, h * 0.65, h, r * 0.95, 0.35, 12);
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU + Math.PI / 4;
      const bx = x + Math.cos(a) * r * 0.75;
      const by = y + Math.sin(a) * r * 0.75;
      addFrustum(mesh, bx, by, h * 0.48, h * 0.78, r * 0.16, 0.15, 8);
    }
  }
  return mesh;
}

function makeButtressGate() {
  const mesh = makeArch();
  mesh.name = "Flying buttress gate";
  for (const side of [-1, 1]) {
    for (const depth of [-1, 1]) {
      const foot = point(side * 49, depth * 17, 5);
      const shoulder = point(side * 27, depth * 8, 43);
      addCylinderBetween(mesh, foot, shoulder, 3.3, 10);
      addBox(mesh, foot[0], foot[1], 8, 9, 9, 16);
    }
  }
  return mesh;
}

function makeSpiral() {
  const mesh = new Mesh("Spiral stair descent");
  const steps = 72;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const angle = t * TAU * 3.25;
    const radius = 33 - t * 17;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = 48 - t * 88;
    addBox(mesh, x, y, z, 18, 6, 3);
  }
  addFrustum(mesh, 0, 0, -45, 52, 3.2, 3.2, 16);
  return mesh;
}

function makeCage() {
  const mesh = new Mesh("Cage of souls");
  addTorus(mesh, 0, 0, 0, 34, 2.8, 40, 8);
  addTorus(mesh, 0, 0, 78, 34, 2.8, 40, 8);
  addTorus(mesh, 0, 0, 39, 34, 1.8, 40, 8);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU;
    addCylinderBetween(mesh, point(Math.cos(a) * 34, Math.sin(a) * 34, 0), point(Math.cos(a) * 34, Math.sin(a) * 34, 78), 1.6, 8);
  }
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    addCylinderBetween(mesh, point(Math.cos(a) * 34, Math.sin(a) * 34, 78), point(0, 0, 97), 1.8, 8);
  }
  return mesh;
}

function makeLabyrinth() {
  const mesh = new Mesh("Labyrinth structure");
  const grid = 11;
  const cell = 8;
  addBox(mesh, 0, 0, 2, grid * cell + 8, grid * cell + 8, 4);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const px = (x - (grid - 1) / 2) * cell;
      const py = (y - (grid - 1) / 2) * cell;
      const ring = Math.max(Math.abs(x - 5), Math.abs(y - 5));
      if ((x + y + ring) % 3 !== 0) addBox(mesh, px, py - cell / 2, 10 + ring, cell + 1.2, 1.4, 16 + ring * 2);
      if ((x * 2 + y + ring) % 4 !== 0) addBox(mesh, px - cell / 2, py, 10 + ring, 1.4, cell + 1.2, 16 + ring * 2);
    }
  }
  return mesh;
}

function makePlateau() {
  const mesh = new Mesh("Cracked plateau");
  addHeightfield(mesh, 105, 90, 44, 38, (x, y) => {
    const r = Math.hypot(x * 0.9, y);
    const plateau = smoothstep(47, 25, r) * 30;
    const cracks = -8 * Math.pow(Math.max(0, Math.cos(Math.atan2(y, x) * 7 + r * 0.12)), 18);
    return Math.round((plateau + fbm(x * 0.1, y * 0.1) * 3 + cracks) / 4) * 4;
  }, -15);
  return mesh;
}

function makeEternalRings() {
  const mesh = new Mesh("Eternal rings");
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * TAU;
    addTorus(mesh, Math.cos(angle) * 8, Math.sin(angle) * 8, i * 11 - 33, 36 - i * 2.6, 2.1, 40, 8);
  }
  return mesh;
}

function makeTriangleMonolith() {
  const mesh = new Mesh("Divine triangle monolith");
  const outer = [point(-42, 0, 0), point(42, 0, 0), point(0, 0, 82)];
  const inner = [point(-19, 0, 15), point(19, 0, 15), point(0, 0, 56)];
  for (const y of [-5, 5]) {
    const o = outer.map(([x, , z]) => point(x, y, z));
    const n = inner.map(([x, , z]) => point(x, y, z));
    if (y < 0) {
      mesh.quad(o[0], o[1], n[1], n[0]);
      mesh.quad(o[1], o[2], n[2], n[1]);
      mesh.quad(o[2], o[0], n[0], n[2]);
    } else {
      mesh.quad(o[0], n[0], n[1], o[1]);
      mesh.quad(o[1], n[1], n[2], o[2]);
      mesh.quad(o[2], n[2], n[0], o[0]);
    }
  }
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    mesh.quad(point(outer[i][0], -5, outer[i][2]), point(outer[j][0], -5, outer[j][2]), point(outer[j][0], 5, outer[j][2]), point(outer[i][0], 5, outer[i][2]));
    mesh.quad(point(inner[i][0], -5, inner[i][2]), point(inner[i][0], 5, inner[i][2]), point(inner[j][0], 5, inner[j][2]), point(inner[j][0], -5, inner[j][2]));
  }
  addBox(mesh, 0, 0, -3, 100, 24, 6);
  return mesh;
}

function fbm(x, y) {
  let value = 0, amplitude = 0.55, frequency = 1;
  for (let i = 0; i < 5; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.48;
  }
  return value;
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return mix(mix(a, b, sx), mix(c, d, sx), sy) * 2 - 1;
}

function hash(x, y) {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

const fract = (value) => value - Math.floor(value);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};
const add = (a, b) => point(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
const sub = (a, b) => point(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const scale = (a, s) => point(a[0] * s, a[1] * s, a[2] * s);
const cross = (a, b) => point(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
const normalize = (a) => {
  const length = Math.hypot(...a) || 1;
  return scale(a, 1 / length);
};

function normalizedMesh(mesh, targetSize = 100) {
  const vertices = mesh.triangles.flat();
  const min = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
  const size = Math.max(...max.map((value, axis) => value - min[axis])) || 1;
  const factor = targetSize / size;
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  return mesh.triangles.map((triangle) => triangle.map(([x, y, z]) => point(
    (x - centerX) * factor,
    (y - centerY) * factor,
    (z - min[2]) * factor,
  )));
}

function binaryStl(name, triangles) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write(`Dante's Inferno: ${name}`.slice(0, 80), 0, "ascii");
  buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const triangle of triangles) {
    const normal = normalize(cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])));
    for (const value of normal) { buffer.writeFloatLE(value, offset); offset += 4; }
    for (const vertex of triangle) {
      for (const value of vertex) { buffer.writeFloatLE(value, offset); offset += 4; }
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  return buffer;
}

const models = [
  ["01_nine_circles_descent.stl", makeNineCircles],
  ["02_abyssal_pit.stl", makeAbyss],
  ["03_volcanic_terrain.stl", makeVolcano],
  ["04_mountain_range.stl", makeMountains],
  ["05_canyon_chasm.stl", makeCanyon],
  ["06_infernal_arch.stl", makeArch],
  ["07_gothic_spires.stl", makeSpires],
  ["08_flying_buttress_gate.stl", makeButtressGate],
  ["09_spiral_stair_descent.stl", makeSpiral],
  ["10_cage_of_souls.stl", makeCage],
  ["11_labyrinth_structure.stl", makeLabyrinth],
  ["12_cracked_plateau.stl", makePlateau],
  ["13_eternal_rings.stl", makeEternalRings],
  ["14_divine_triangle_monolith.stl", makeTriangleMonolith],
];

await mkdir(outputDir, { recursive: true });
const manifest = [];
for (const [filename, create] of models) {
  const mesh = create();
  const triangles = normalizedMesh(mesh);
  const data = binaryStl(mesh.name, triangles);
  await writeFile(resolve(outputDir, filename), data);
  manifest.push({ filename, name: mesh.name, triangles: triangles.length, bytes: data.byteLength });
}
await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${manifest.length} STL files in ${outputDir}`);
for (const entry of manifest) console.log(`${entry.filename}: ${entry.triangles} triangles, ${entry.bytes} bytes`);
