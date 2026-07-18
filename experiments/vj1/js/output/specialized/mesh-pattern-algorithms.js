const TAU = Math.PI * 2;
const EPSILON = 1e-7;

export const MESH_PATTERN_FAMILIES = Object.freeze([
  "cells",
  "veins",
  "mountains",
  "soap",
  "cracks",
  "coral",
  "fabric",
  "rivers",
  "magnetic fields",
  "bone",
]);

export function meshPatternTopologySignature(params = {}, aspect = 1) {
  return [
    normalizedFamily(params.pattern ?? params.family),
    quantized(params.scale, 8, 0.05),
    quantized(params.density, 1, 0.02),
    quantized(params.irregularity, 0.75, 0.02),
    Math.round(finite(params.seed, 17)),
    quantized(aspect, 1, 0.01),
  ].join(":");
}

export function generateMeshPatternTopology(params = {}, aspect = 1) {
  const family = normalizedFamily(params.pattern);
  const options = {
    family,
    scale: clamp(finite(params.scale, 8), 1, 40),
    density: clamp(finite(params.density, 1), 0.25, 4),
    irregularity: clamp(finite(params.irregularity, 0.75), 0, 2),
    seed: Math.round(finite(params.seed, 17)),
    aspect: clamp(finite(aspect, 1), 0.2, 5),
  };
  const random = seededRandom(hashString(meshPatternTopologySignature(options, options.aspect)));
  const builder = new GeometryBuilder(family);
  const generators = {
    cells: generateCells,
    veins: generateVeins,
    mountains: generateMountains,
    soap: generateSoap,
    cracks: generateCracks,
    coral: generateCoral,
    fabric: generateFabric,
    rivers: generateRivers,
    "magnetic fields": generateMagneticFields,
    bone: generateBone,
  };
  generators[family](builder, options, random);
  return builder.finish(meshPatternTopologySignature(options, options.aspect));
}

class GeometryBuilder {
  constructor(family) {
    this.family = family;
    this.fill = [];
    this.lines = [];
    this.primitiveCount = 0;
  }

  triangle(a, b, c, slot = 0) {
    if (!validPoint(a) || !validPoint(b) || !validPoint(c)) return;
    this.fill.push(a[0], a[1], slot, b[0], b[1], slot, c[0], c[1], slot);
  }

  polygon(points, slot = 0, { wire = true } = {}) {
    const clean = dedupePolygon(points).filter(validPoint);
    if (clean.length < 3) return;
    const centroid = polygonCentroid(clean);
    for (let index = 0; index < clean.length; index += 1) {
      this.triangle(centroid, clean[index], clean[(index + 1) % clean.length], slot);
    }
    if (wire) this.polyline([...clean, clean[0]], slot);
    this.primitiveCount += 1;
  }

  segment(a, b, slot = 0) {
    if (!validPoint(a) || !validPoint(b) || distanceSquared(a, b) < EPSILON) return;
    this.lines.push(a[0], a[1], b[0], b[1], slot);
  }

  polyline(points, slot = 0) {
    for (let index = 1; index < points.length; index += 1) {
      this.segment(points[index - 1], points[index], slot);
    }
    if (points.length > 1) this.primitiveCount += 1;
  }

  disk(center, radius, slot = 0, steps = 16) {
    const ring = [];
    for (let index = 0; index < steps; index += 1) {
      const angle = index / steps * TAU;
      ring.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
    }
    this.polygon(ring, slot);
  }

  finish(signature) {
    return Object.freeze({
      family: this.family,
      signature,
      fillVertices: new Float32Array(this.fill),
      lineSegments: new Float32Array(this.lines),
      fillVertexCount: this.fill.length / 3,
      lineSegmentCount: this.lines.length / 5,
      primitiveCount: this.primitiveCount,
    });
  }
}

// Centroidal Voronoi tessellation: exact half-plane clipping followed by
// bounded Lloyd iterations. This produces real polygons, not a distance-field
// imitation of cells.
function generateCells(builder, options, random) {
  const count = boundedCount(options, 18, 180, 1.55);
  let sites = Array.from({ length: count }, () => [random(), random()]);
  const iterations = clamp(Math.round(4 - options.irregularity * 1.5), 1, 4);
  let cells = [];
  for (let iteration = 0; iteration <= iterations; iteration += 1) {
    cells = voronoiCells(sites);
    if (iteration < iterations) {
      sites = cells.map((cell, index) => cell.length >= 3 ? polygonCentroid(cell) : sites[index]);
    }
  }
  cells.forEach((cell, index) => builder.polygon(cell, index % 4));
}

function voronoiCells(sites) {
  return sites.map((site, siteIndex) => {
    let polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let otherIndex = 0; otherIndex < sites.length && polygon.length; otherIndex += 1) {
      if (otherIndex === siteIndex) continue;
      const other = sites[otherIndex];
      const normal = [other[0] - site[0], other[1] - site[1]];
      const midpoint = [(site[0] + other[0]) * 0.5, (site[1] + other[1]) * 0.5];
      polygon = clipPolygonHalfPlane(polygon, midpoint, normal);
    }
    return polygon;
  });
}

function clipPolygonHalfPlane(polygon, midpoint, normal) {
  const result = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const da = dot(subtract(a, midpoint), normal);
    const db = dot(subtract(b, midpoint), normal);
    const insideA = da <= EPSILON;
    const insideB = db <= EPSILON;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      result.push([mix(a[0], b[0], t), mix(a[1], b[1], t)]);
    }
  }
  return result;
}

// Runions/Lane/Prusinkiewicz space colonization. Attractors select their
// nearest branch node, those directions are averaged, and reached attractors
// are removed. The stored edges are the resulting tree graph.
function generateVeins(builder, options, random) {
  const attractorCount = boundedCount(options, 90, 560, 4.2);
  const attractors = Array.from({ length: attractorCount }, () => {
    const y = 0.04 + random() * 0.9;
    const envelope = Math.sin(Math.PI * y) * 0.46;
    return [0.5 + (random() * 2 - 1) * envelope, y];
  });
  const nodes = [{ point: [0.5, 0.98], parent: -1 }];
  const influence = 0.11 + 0.09 / Math.sqrt(options.density);
  const kill = influence * 0.19;
  const step = kill * (0.62 + options.irregularity * 0.08);
  const maxNodes = Math.min(1400, attractorCount * 3);
  for (let iteration = 0; iteration < 480 && attractors.length && nodes.length < maxNodes; iteration += 1) {
    const directions = new Map();
    for (let index = attractors.length - 1; index >= 0; index -= 1) {
      const attractor = attractors[index];
      let nearest = -1;
      let nearestDistance = influence * influence;
      let reached = false;
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const d2 = distanceSquared(attractor, nodes[nodeIndex].point);
        if (d2 < kill * kill) {
          reached = true;
          break;
        }
        if (d2 < nearestDistance) {
          nearestDistance = d2;
          nearest = nodeIndex;
        }
      }
      if (reached) {
        attractors.splice(index, 1);
      } else if (nearest >= 0) {
        const direction = normalize(subtract(attractor, nodes[nearest].point));
        const sum = directions.get(nearest) || [0, 0, 0];
        sum[0] += direction[0];
        sum[1] += direction[1];
        sum[2] += 1;
        directions.set(nearest, sum);
      }
    }
    if (!directions.size) break;
    const additions = [];
    for (const [parent, sum] of directions) {
      const direction = normalize([sum[0] / sum[2], sum[1] / sum[2]]);
      const jitter = (random() * 2 - 1) * options.irregularity * 0.12;
      const rotated = rotate(direction, jitter);
      const point = add(nodes[parent].point, scaleVector(rotated, step));
      if (!insideUnit(point) || nodes.some((node) => distanceSquared(node.point, point) < step * step * 0.16)) continue;
      additions.push({ point, parent });
    }
    nodes.push(...additions);
    if (!additions.length) break;
  }
  nodes.forEach((node, index) => {
    if (node.parent < 0) return;
    const depthSlot = Math.min(3, Math.floor(index / Math.max(1, nodes.length) * 4));
    builder.segment(nodes[node.parent].point, node.point, depthSlot);
  });
  nodes.filter((_node, index) => index % 3 === 0).forEach((node, index) => {
    builder.disk(node.point, step * 0.32, index % 4, 8);
  });
}

// Scalar field + marching squares. Ambiguous saddle cases are resolved from
// the cell-center value; interpolation locates the contour between samples.
function generateMountains(builder, options, random) {
  const grid = clamp(Math.round(34 + options.scale * 1.3 * Math.sqrt(options.density)), 36, 96);
  const field = scalarField(grid, options, random);
  const levels = clamp(Math.round(4 + options.scale * 0.42 * options.density), 5, 18);
  for (let levelIndex = 1; levelIndex <= levels; levelIndex += 1) {
    const iso = levelIndex / (levels + 1);
    marchingSquares(field, grid, iso).forEach(([a, b]) => builder.segment(a, b, levelIndex % 4));
  }
  // A triangulated elevation underlay makes Fill meaningful while contours
  // remain the actual vector output of the family.
  for (let y = 0; y < grid - 1; y += 2) {
    for (let x = 0; x < grid - 1; x += 2) {
      const a = [x / (grid - 1), y / (grid - 1)];
      const b = [(x + 2) / (grid - 1), y / (grid - 1)];
      const c = [(x + 2) / (grid - 1), (y + 2) / (grid - 1)];
      const d = [x / (grid - 1), (y + 2) / (grid - 1)];
      const slot = Math.min(3, Math.floor(sampleField(field, grid, x + 1, y + 1) * 4));
      builder.triangle(a, b, c, slot);
      builder.triangle(a, c, d, slot);
    }
  }
}

function marchingSquares(field, size, iso) {
  const segments = [];
  const edgePoint = (x, y, edge, values) => {
    const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const [from, to] = pairs[edge];
    const denominator = values[to] - values[from];
    const t = Math.abs(denominator) < EPSILON ? 0.5 : clamp((iso - values[from]) / denominator, 0, 1);
    return [
      mix(corners[from][0], corners[to][0], t) / (size - 1),
      mix(corners[from][1], corners[to][1], t) / (size - 1),
    ];
  };
  const table = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]],
    11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
  };
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const values = [
        sampleField(field, size, x, y), sampleField(field, size, x + 1, y),
        sampleField(field, size, x + 1, y + 1), sampleField(field, size, x, y + 1),
      ];
      const mask = values.reduce((result, value, index) => result | ((value >= iso ? 1 : 0) << index), 0);
      let pairs = table[mask] || [];
      if (mask === 5 || mask === 10) {
        const centerHigh = values.reduce((sum, value) => sum + value, 0) * 0.25 >= iso;
        pairs = mask === 5
          ? (centerHigh ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]])
          : (centerHigh ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]);
      }
      pairs.forEach(([a, b]) => segments.push([edgePoint(x, y, a, values), edgePoint(x, y, b, values)]));
    }
  }
  return segments;
}

// Polydisperse circle packing using repeated overlap projection. The actual
// circles are retained as curved cell boundaries instead of replaced by a
// Voronoi distance approximation.
function generateSoap(builder, options, random) {
  const count = boundedCount(options, 18, 130, 1.2);
  const circles = Array.from({ length: count }, () => ({
    center: [0.05 + random() * 0.9, 0.05 + random() * 0.9],
    radius: (0.018 + random() * 0.042) / Math.sqrt(Math.max(0.5, options.density)),
  }));
  for (let iteration = 0; iteration < 90; iteration += 1) {
    for (let a = 0; a < circles.length; a += 1) {
      for (let b = a + 1; b < circles.length; b += 1) {
        const delta = subtract(circles[b].center, circles[a].center);
        const distance = Math.max(0.0001, length(delta));
        const target = circles[a].radius + circles[b].radius + 0.002;
        if (distance >= target) continue;
        const correction = scaleVector(delta, (target - distance) * 0.5 / distance);
        circles[a].center = subtract(circles[a].center, correction);
        circles[b].center = add(circles[b].center, correction);
      }
    }
    circles.forEach((circle) => {
      circle.center[0] = clamp(circle.center[0], circle.radius, 1 - circle.radius);
      circle.center[1] = clamp(circle.center[1], circle.radius, 1 - circle.radius);
    });
  }
  circles.forEach((circle, index) => {
    const steps = clamp(Math.round(12 + circle.radius * 180), 12, 28);
    builder.disk(circle.center, circle.radius, index % 4, steps);
  });
}

// Crack tips propagate until they hit a previous segment or the boundary.
// Primary impact rays also define colored fracture facets.
function generateCracks(builder, options, random) {
  const impacts = clamp(Math.round(1 + options.density * 0.8), 1, 4);
  const spatialIndex = new Map();
  const spatialCellSize = 0.04;
  const indexSegment = (segment) => {
    const [a, b] = segment;
    const minX = Math.floor(Math.min(a[0], b[0]) / spatialCellSize);
    const maxX = Math.floor(Math.max(a[0], b[0]) / spatialCellSize);
    const minY = Math.floor(Math.min(a[1], b[1]) / spatialCellSize);
    const maxY = Math.floor(Math.max(a[1], b[1]) / spatialCellSize);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x}:${y}`;
        const bucket = spatialIndex.get(key) || [];
        bucket.push(segment);
        spatialIndex.set(key, bucket);
      }
    }
  };
  const intersectsExisting = (a, b) => {
    const minX = Math.floor(Math.min(a[0], b[0]) / spatialCellSize);
    const maxX = Math.floor(Math.max(a[0], b[0]) / spatialCellSize);
    const minY = Math.floor(Math.min(a[1], b[1]) / spatialCellSize);
    const maxY = Math.floor(Math.max(a[1], b[1]) / spatialCellSize);
    const visited = new Set();
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        for (const segment of spatialIndex.get(`${x}:${y}`) || []) {
          if (visited.has(segment)) continue;
          visited.add(segment);
          if (segmentIntersection(a, b, segment[0], segment[1])) return true;
        }
      }
    }
    return false;
  };
  for (let impactIndex = 0; impactIndex < impacts; impactIndex += 1) {
    const center = [0.18 + random() * 0.64, 0.18 + random() * 0.64];
    const rays = clamp(Math.round(7 + options.scale * 0.55), 7, 26);
    const boundaryEnds = [];
    const tips = [];
    for (let ray = 0; ray < rays; ray += 1) {
      const angle = ray / rays * TAU + (random() - 0.5) * 0.35;
      tips.push({ point: center, angle, life: 90, slot: (ray + impactIndex) % 4 });
      boundaryEnds.push(rayToUnitBoundary(center, angle));
    }
    boundaryEnds.forEach((point, index) => {
      builder.polygon([center, point, boundaryEnds[(index + 1) % boundaryEnds.length]], index % 4, { wire: false });
    });
    for (let iteration = 0; iteration < 110 && tips.length; iteration += 1) {
      for (let index = tips.length - 1; index >= 0; index -= 1) {
        const tip = tips[index];
        tip.angle += (random() - 0.5) * (0.10 + options.irregularity * 0.18);
        const step = 0.009 + 0.004 / Math.max(0.5, options.density);
        const next = add(tip.point, [Math.cos(tip.angle) * step, Math.sin(tip.angle) * step]);
        const hit = !insideUnit(next) || intersectsExisting(tip.point, next);
        if (hit || tip.life-- <= 0) {
          tips.splice(index, 1);
          continue;
        }
        builder.segment(tip.point, next, tip.slot);
        const segment = [tip.point, next];
        indexSegment(segment);
        tip.point = next;
        if (tips.length < 90 && random() < 0.014 * options.density * (0.5 + options.irregularity)) {
          tips.push({ point: next, angle: tip.angle + (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.65), life: tip.life * 0.65, slot: (tip.slot + 1) % 4 });
        }
      }
    }
  }
}

// Lattice diffusion-limited aggregation. Walkers launch outside the current
// cluster and stick on first contact; parent contacts form the branch network.
function generateCoral(builder, options, random) {
  const size = clamp(Math.round(54 + options.scale * 1.4), 56, 104);
  const target = boundedCount(options, 180, 900, 7.5);
  const occupied = new Map();
  const key = (x, y) => `${x}:${y}`;
  const seed = [Math.floor(size / 2), size - 3];
  occupied.set(key(...seed), { point: seed, parent: null });
  let radius = 3;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let particle = 1; particle < target; particle += 1) {
    const angle = random() * Math.PI + Math.PI;
    let x = clamp(Math.round(seed[0] + Math.cos(angle) * radius), 1, size - 2);
    let y = clamp(Math.round(seed[1] + Math.sin(angle) * radius), 1, size - 2);
    let stuck = null;
    for (let walk = 0; walk < 1500; walk += 1) {
      const neighbor = directions[Math.floor(random() * directions.length)];
      x += neighbor[0];
      y += neighbor[1];
      const dx = x - seed[0];
      const dy = y - seed[1];
      if (x < 1 || x >= size - 1 || y < 1 || y >= size - 1 || dx * dx + dy * dy > (radius + 10) ** 2) {
        const relaunch = random() * Math.PI + Math.PI;
        x = clamp(Math.round(seed[0] + Math.cos(relaunch) * radius), 1, size - 2);
        y = clamp(Math.round(seed[1] + Math.sin(relaunch) * radius), 1, size - 2);
      }
      for (const [nx, ny] of directions) {
        const parent = occupied.get(key(x + nx, y + ny));
        if (parent) {
          stuck = parent;
          break;
        }
      }
      if (stuck) break;
    }
    if (!stuck || occupied.has(key(x, y))) continue;
    const node = { point: [x, y], parent: stuck };
    occupied.set(key(x, y), node);
    radius = Math.min(size * 0.48, Math.max(radius, Math.hypot(x - seed[0], y - seed[1]) + 4));
  }
  let index = 0;
  for (const node of occupied.values()) {
    const point = [node.point[0] / (size - 1), node.point[1] / (size - 1)];
    if (node.parent) {
      const parent = [node.parent.point[0] / (size - 1), node.parent.point[1] / (size - 1)];
      builder.segment(parent, point, index % 4);
    }
    if (index % 4 === 0) builder.disk(point, 0.0045, index % 4, 7);
    index += 1;
  }
}

// Structural + shear springs relax a displaced cloth grid. The final mass
// positions are retained as a triangle mesh.
function generateFabric(builder, options, random) {
  const columns = clamp(Math.round(8 + options.scale * 0.65 * Math.sqrt(options.density)), 9, 30);
  const rows = clamp(Math.round(columns / options.aspect), 8, 28);
  const points = Array.from({ length: rows }, (_row, y) => Array.from({ length: columns }, (_column, x) => ({
    point: [x / (columns - 1), y / (rows - 1)],
    fixed: y === 0 && (x === 0 || x === columns - 1 || x === Math.floor(columns / 2)),
  })));
  const restX = 1 / (columns - 1);
  const restY = 1 / (rows - 1);
  const relax = (a, b, rest, stiffness) => {
    const delta = subtract(b.point, a.point);
    const distance = Math.max(EPSILON, length(delta));
    const correction = scaleVector(delta, (distance - rest) / distance * stiffness);
    if (!a.fixed && !b.fixed) {
      a.point = add(a.point, scaleVector(correction, 0.5));
      b.point = subtract(b.point, scaleVector(correction, 0.5));
    } else if (!a.fixed) a.point = add(a.point, correction);
    else if (!b.fixed) b.point = subtract(b.point, correction);
  };
  for (let iteration = 0; iteration < 72; iteration += 1) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const node = points[y][x];
        if (!node.fixed) {
          node.point[1] += 0.0008 * (0.5 + options.irregularity);
          node.point[0] += Math.sin(y * 0.73 + x * 0.41) * options.irregularity * 0.00008;
        }
        if (x + 1 < columns) relax(node, points[y][x + 1], restX, 0.72);
        if (y + 1 < rows) relax(node, points[y + 1][x], restY, 0.72);
        if (x + 1 < columns && y + 1 < rows) relax(node, points[y + 1][x + 1], Math.hypot(restX, restY), 0.24);
      }
    }
  }
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < columns - 1; x += 1) {
      const a = points[y][x].point;
      const b = points[y][x + 1].point;
      const c = points[y + 1][x + 1].point;
      const d = points[y + 1][x].point;
      const slot = (x + y) % 4;
      if ((x + y) % 2) {
        builder.triangle(a, b, d, slot);
        builder.triangle(b, c, d, slot);
        builder.segment(b, d, slot);
      } else {
        builder.triangle(a, b, c, slot);
        builder.triangle(a, c, d, slot);
        builder.segment(a, c, slot);
      }
      builder.segment(a, b, slot);
      builder.segment(a, d, slot);
      if (x === columns - 2) builder.segment(b, c, slot);
      if (y === rows - 2) builder.segment(d, c, slot);
    }
  }
}

// D8 steepest descent and upstream flow accumulation over a seeded elevation
// model. Only channels above a drainage-area threshold become river edges.
function generateRivers(builder, options, random) {
  const size = clamp(Math.round(36 + options.scale * 0.9 * Math.sqrt(options.density)), 38, 72);
  const field = scalarField(size, { ...options, irregularity: options.irregularity + 0.35 }, random, true);
  const cellCount = size * size;
  const downstream = new Int32Array(cellCount).fill(-1);
  const accumulation = new Float32Array(cellCount).fill(1);
  const order = Array.from({ length: cellCount }, (_value, index) => index).sort((a, b) => field[b] - field[a]);
  const neighbors = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x;
      let best = index;
      let bestHeight = field[index];
      neighbors.forEach(([dx, dy]) => {
        const candidate = (y + dy) * size + x + dx;
        if (field[candidate] < bestHeight) {
          bestHeight = field[candidate];
          best = candidate;
        }
      });
      if (best !== index) downstream[index] = best;
    }
  }
  order.forEach((index) => {
    if (downstream[index] >= 0) accumulation[downstream[index]] += accumulation[index];
  });
  const threshold = cellCount * (0.0045 / Math.max(0.5, options.density));
  for (let index = 0; index < cellCount; index += 1) {
    const next = downstream[index];
    if (next < 0 || accumulation[index] < threshold) continue;
    const point = [(index % size) / (size - 1), Math.floor(index / size) / (size - 1)];
    const target = [(next % size) / (size - 1), Math.floor(next / size) / (size - 1)];
    const slot = Math.min(3, Math.floor(Math.log2(accumulation[index] / threshold + 1)));
    builder.segment(point, target, slot);
  }
  for (let y = 0; y < size - 1; y += 3) {
    for (let x = 0; x < size - 1; x += 3) {
      const slot = Math.min(3, Math.floor(field[y * size + x] * 4));
      const a = [x / (size - 1), y / (size - 1)];
      const b = [(x + 3) / (size - 1), y / (size - 1)];
      const c = [(x + 3) / (size - 1), (y + 3) / (size - 1)];
      const d = [x / (size - 1), (y + 3) / (size - 1)];
      builder.triangle(a, b, c, slot);
      builder.triangle(a, c, d, slot);
    }
  }
}

// Streamlines of a 2D inverse-square vector field, integrated with RK4.
function generateMagneticFields(builder, options, random) {
  const chargeCount = clamp(Math.round(2 + options.density), 2, 6);
  const charges = Array.from({ length: chargeCount }, (_value, index) => ({
    point: [0.18 + random() * 0.64, 0.18 + random() * 0.64],
    strength: index % 2 === 0 ? 1 : -1,
  }));
  const field = (point) => charges.reduce((sum, charge) => {
    const delta = subtract(point, charge.point);
    const d2 = Math.max(0.0008, distanceSquared(point, charge.point));
    return add(sum, scaleVector(delta, charge.strength / (d2 * Math.sqrt(d2))));
  }, [0, 0]);
  const step = 0.006 + 0.004 / Math.sqrt(options.density);
  const seedCount = clamp(Math.round(10 + options.scale * 1.1 * options.density), 14, 90);
  for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
    const positive = charges[(seedIndex * 2) % charges.length];
    const angle = seedIndex / seedCount * TAU + random() * 0.12;
    let point = add(positive.point, [Math.cos(angle) * 0.018, Math.sin(angle) * 0.018]);
    const path = [point];
    for (let iteration = 0; iteration < 420; iteration += 1) {
      const next = rk4Step(point, field, step);
      if (!insideUnit(next) || charges.some((charge) => charge.strength < 0 && distanceSquared(next, charge.point) < 0.0003)) break;
      if (path.length > 10 && distanceSquared(next, path[path.length - 10]) < 0.00001) break;
      path.push(next);
      point = next;
    }
    if (path.length > 2) builder.polyline(path, seedIndex % 4);
  }
  charges.forEach((charge, index) => builder.disk(charge.point, 0.012, index % 4, 12));
}

function rk4Step(point, field, step) {
  const direction = (p) => normalize(field(p));
  const k1 = direction(point);
  const k2 = direction(add(point, scaleVector(k1, step * 0.5)));
  const k3 = direction(add(point, scaleVector(k2, step * 0.5)));
  const k4 = direction(add(point, scaleVector(k3, step)));
  const delta = scaleVector(add(add(k1, scaleVector(k2, 2)), add(scaleVector(k3, 2), k4)), step / 6);
  return add(point, delta);
}

// A bounded 2D ground-structure truss solve. The linear-elastic stiffness
// system is assembled from axial bars, constrained at two supports, loaded at
// the top, solved, then low-force members are pruned.
function generateBone(builder, options, random) {
  const columns = clamp(Math.round(6 + options.scale * 0.28 * Math.sqrt(options.density)), 7, 13);
  const rows = clamp(Math.round(columns / Math.max(0.7, options.aspect)), 6, 11);
  const nodes = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const boundary = x === 0 || y === 0 || x === columns - 1 || y === rows - 1;
      const jitter = boundary ? 0 : options.irregularity * 0.018;
      nodes.push([
        x / (columns - 1) + (random() - 0.5) * jitter,
        y / (rows - 1) + (random() - 0.5) * jitter,
      ]);
    }
  }
  const nodeIndex = (x, y) => y * columns + x;
  const edges = [];
  const edgeSet = new Set();
  const addEdge = (a, b) => {
    const id = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a !== b && !edgeSet.has(id)) {
      edgeSet.add(id);
      edges.push({ a, b, force: 0 });
    }
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const a = nodeIndex(x, y);
      if (x + 1 < columns) addEdge(a, nodeIndex(x + 1, y));
      if (y + 1 < rows) addEdge(a, nodeIndex(x, y + 1));
      if (x + 1 < columns && y + 1 < rows) {
        addEdge(a, nodeIndex(x + 1, y + 1));
        addEdge(nodeIndex(x + 1, y), nodeIndex(x, y + 1));
      }
    }
  }
  solveTruss(nodes, edges, [nodeIndex(0, rows - 1), nodeIndex(columns - 1, rows - 1)], nodeIndex(Math.floor(columns / 2), 0));
  const sortedForces = edges.map((edge) => Math.abs(edge.force)).sort((a, b) => a - b);
  const cutoffIndex = Math.floor(sortedForces.length * clamp(0.42 + (1 - options.density / 4) * 0.22, 0.32, 0.68));
  const cutoff = sortedForces[cutoffIndex] || 0;
  const maximum = sortedForces[sortedForces.length - 1] || 1;
  edges.forEach((edge) => {
    const stress = Math.abs(edge.force);
    if (stress < cutoff && random() > 0.05) return;
    const slot = Math.min(3, Math.floor(stress / maximum * 3.999));
    builder.segment(nodes[edge.a], nodes[edge.b], slot);
  });
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < columns - 1; x += 1) {
      const ids = [nodeIndex(x, y), nodeIndex(x + 1, y), nodeIndex(x + 1, y + 1), nodeIndex(x, y + 1)];
      const slot = (x + y) % 4;
      builder.triangle(nodes[ids[0]], nodes[ids[1]], nodes[ids[2]], slot);
      builder.triangle(nodes[ids[0]], nodes[ids[2]], nodes[ids[3]], slot);
    }
  }
}

function solveTruss(nodes, edges, supports, loadNode) {
  const dof = nodes.length * 2;
  const matrix = Array.from({ length: dof }, () => new Float64Array(dof));
  const loads = new Float64Array(dof);
  loads[loadNode * 2 + 1] = 1;
  edges.forEach((edge) => {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const delta = subtract(b, a);
    const lengthValue = Math.max(EPSILON, length(delta));
    const c = delta[0] / lengthValue;
    const s = delta[1] / lengthValue;
    const local = [[c * c, c * s], [c * s, s * s]];
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        const stiffness = local[i][j] / lengthValue;
        matrix[edge.a * 2 + i][edge.a * 2 + j] += stiffness;
        matrix[edge.b * 2 + i][edge.b * 2 + j] += stiffness;
        matrix[edge.a * 2 + i][edge.b * 2 + j] -= stiffness;
        matrix[edge.b * 2 + i][edge.a * 2 + j] -= stiffness;
      }
    }
  });
  for (let index = 0; index < dof; index += 1) matrix[index][index] += 1e-7;
  const constrained = new Set(supports.flatMap((node) => [node * 2, node * 2 + 1]));
  constrained.forEach((index) => {
    matrix[index].fill(0);
    for (let row = 0; row < dof; row += 1) matrix[row][index] = 0;
    matrix[index][index] = 1;
    loads[index] = 0;
  });
  const displacement = solveLinearSystem(matrix, loads);
  edges.forEach((edge) => {
    const delta = subtract(nodes[edge.b], nodes[edge.a]);
    const lengthValue = Math.max(EPSILON, length(delta));
    const direction = scaleVector(delta, 1 / lengthValue);
    const relative = [
      displacement[edge.b * 2] - displacement[edge.a * 2],
      displacement[edge.b * 2 + 1] - displacement[edge.a * 2 + 1],
    ];
    edge.force = dot(relative, direction) / lengthValue;
  });
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const result = Float64Array.from(vector);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (pivot !== column) {
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      [result[column], result[pivot]] = [result[pivot], result[column]];
    }
    const divisor = Math.abs(matrix[column][column]) < EPSILON ? EPSILON : matrix[column][column];
    for (let row = column + 1; row < size; row += 1) {
      const factor = matrix[row][column] / divisor;
      if (Math.abs(factor) < EPSILON) continue;
      for (let entry = column; entry < size; entry += 1) matrix[row][entry] -= factor * matrix[column][entry];
      result[row] -= factor * result[column];
    }
  }
  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = result[row];
    for (let column = row + 1; column < size; column += 1) value -= matrix[row][column] * solution[column];
    solution[row] = value / (Math.abs(matrix[row][row]) < EPSILON ? EPSILON : matrix[row][row]);
  }
  return solution;
}

function scalarField(size, options, random, downhill = false) {
  const seedX = random() * 1000;
  const seedY = random() * 1000;
  const values = new Float32Array(size * size);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const frequency = 1.8 + options.scale * 0.12;
      let value = fbm(nx * frequency + seedX, ny * frequency + seedY, options.seed);
      value += (1 - Math.hypot(nx - 0.5, ny - 0.5) * 1.4) * 0.18;
      if (downhill) value += (1 - ny) * 0.22;
      const index = y * size + x;
      values[index] = value;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  const range = Math.max(EPSILON, maximum - minimum);
  for (let index = 0; index < values.length; index += 1) values[index] = (values[index] - minimum) / range;
  return values;
}

function fbm(x, y, seed) {
  let value = 0;
  let amplitude = 0.56;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    value += valueNoise(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function sampleField(field, size, x, y) {
  return field[clamp(Math.round(y), 0, size - 1) * size + clamp(Math.round(x), 0, size - 1)];
}

function rayToUnitBoundary(origin, angle) {
  const direction = [Math.cos(angle), Math.sin(angle)];
  const distances = [];
  if (direction[0] > EPSILON) distances.push((1 - origin[0]) / direction[0]);
  if (direction[0] < -EPSILON) distances.push((0 - origin[0]) / direction[0]);
  if (direction[1] > EPSILON) distances.push((1 - origin[1]) / direction[1]);
  if (direction[1] < -EPSILON) distances.push((0 - origin[1]) / direction[1]);
  const distance = Math.min(...distances.filter((value) => value > 0));
  return add(origin, scaleVector(direction, distance));
}

function segmentIntersection(a, b, c, d) {
  const r = subtract(b, a);
  const s = subtract(d, c);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < EPSILON) return false;
  const offset = subtract(c, a);
  const t = cross(offset, s) / denominator;
  const u = cross(offset, r) / denominator;
  return t > 0.08 && t < 0.98 && u > 0.02 && u < 0.98;
}

function polygonCentroid(points) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const crossValue = cross(a, b);
    area += crossValue;
    x += (a[0] + b[0]) * crossValue;
    y += (a[1] + b[1]) * crossValue;
  }
  if (Math.abs(area) < EPSILON) {
    return points.reduce((sum, point) => add(sum, point), [0, 0]).map((value) => value / points.length);
  }
  return [x / (3 * area), y / (3 * area)];
}

function dedupePolygon(points) {
  return points.filter((point, index) => index === 0 || distanceSquared(point, points[index - 1]) > EPSILON);
}

function boundedCount(options, minimum, maximum, multiplier) {
  return clamp(Math.round(options.scale * options.density * multiplier), minimum, maximum);
}

function normalizedFamily(value) {
  const clean = String(value || "cells").trim().toLowerCase();
  const aliases = {
    "tectonic plates": "cells",
    "leaf veins": "veins",
    "topographic contours": "mountains",
    "soap bubble foam": "soap",
    "shattered glass": "cracks",
    "coral skeleton": "coral",
    "fabric tension": "fabric",
    "river delta": "rivers",
    "magnetic field": "magnetic fields",
    "crystalline growth": "cracks",
    "root system": "veins",
    "neural tissue": "veins",
    "spider web": "veins",
    "city blocks": "cells",
    "lava cooling": "cells",
    "constellation graph": "bone",
  };
  const family = aliases[clean] || clean;
  return MESH_PATTERN_FAMILIES.includes(family) ? family : "cells";
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hash2(x, y, seed) {
  let value = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 69069);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

function quantized(value, fallback, step) {
  return Math.round(finite(value, fallback) / step) * step;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function validPoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function insideUnit(point) {
  return point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1;
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function scaleVector(vector, amount) {
  return [vector[0] * amount, vector[1] * amount];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1]);
}

function normalize(vector) {
  const magnitude = Math.max(EPSILON, length(vector));
  return [vector[0] / magnitude, vector[1] / magnitude];
}

function rotate(vector, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [vector[0] * cosine - vector[1] * sine, vector[0] * sine + vector[1] * cosine];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function distanceSquared(a, b) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  return x * x + y * y;
}
