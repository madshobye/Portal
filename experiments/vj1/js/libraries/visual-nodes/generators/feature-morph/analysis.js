const EPSILON = 1e-8;

export function matchSuperPointFeatures(featuresA = [], featuresB = [], {
  maxMatches = 64,
  similarityThreshold = 0.72,
  ratioThreshold = 0.88,
  minimumSpacing = 0.035,
  maximumDisplacement = 0.7,
} = {}) {
  if (!featuresA.length || !featuresB.length) return [];
  const forward = nearestMatches(featuresA, featuresB);
  const backward = nearestMatches(featuresB, featuresA);
  const candidates = [];

  for (let indexA = 0; indexA < forward.length; indexA++) {
    const candidate = forward[indexA];
    if (!candidate || backward[candidate.index]?.index !== indexA) continue;
    const ratio = candidate.secondDistance > EPSILON
      ? candidate.distance / candidate.secondDistance
      : 1;
    const similarity = 1 - candidate.distance * 0.5;
    const a = featuresA[indexA];
    const b = featuresB[candidate.index];
    const displacement = Math.hypot(b.x - a.x, b.y - a.y);
    if (ratio > ratioThreshold || similarity < similarityThreshold || displacement > maximumDisplacement) continue;
    candidates.push({
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      confidence: similarity * (1 - ratio),
    });
  }

  candidates.sort((left, right) => right.confidence - left.confidence);
  const selected = [];
  for (const candidate of candidates) {
    const separated = selected.every((match) =>
      Math.hypot(match.a.x - candidate.a.x, match.a.y - candidate.a.y) >= minimumSpacing &&
      Math.hypot(match.b.x - candidate.b.x, match.b.y - candidate.b.y) >= minimumSpacing
    );
    if (!separated) continue;
    selected.push(candidate);
    if (selected.length >= maxMatches) break;
  }
  return selected;
}

export function buildFeatureMorphField(matches = [], {
  width = 48,
  height = 48,
  phases = 12,
  influence = 0.18,
  maxFlow = 0.5,
} = {}) {
  const fieldWidth = Math.max(2, Math.round(width));
  const fieldHeight = Math.max(2, Math.round(height));
  const fieldPhases = Math.max(2, Math.round(phases));
  const morphStrength = Math.max(0.2, Math.min(1.5, (Number(influence) || 0.18) / 0.18));
  const mesh = buildFeatureMorphMesh(matches);
  const pixels = new Uint8ClampedArray(fieldWidth * fieldHeight * fieldPhases * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 128;
    pixels[offset + 1] = 128;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }

  for (let phase = 0; phase < fieldPhases; phase++) {
    const morph = phase / (fieldPhases - 1);
    const positions = mesh.vertices.map((vertex) => ({
      x: vertex.a.x + (vertex.b.x - vertex.a.x) * morph,
      y: vertex.a.y + (vertex.b.y - vertex.a.y) * morph,
    }));
    for (const triangle of mesh.triangles) {
      const a = positions[triangle[0]];
      const b = positions[triangle[1]];
      const c = positions[triangle[2]];
      const denominator = barycentricDenominator(a, b, c);
      if (Math.abs(denominator) < EPSILON) continue;
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x) * (fieldWidth - 1)));
      const maxX = Math.min(fieldWidth - 1, Math.ceil(Math.max(a.x, b.x, c.x) * (fieldWidth - 1)));
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) * (fieldHeight - 1)));
      const maxY = Math.min(fieldHeight - 1, Math.ceil(Math.max(a.y, b.y, c.y) * (fieldHeight - 1)));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const weights = barycentricWeights(x / (fieldWidth - 1), y / (fieldHeight - 1), a, b, c, denominator);
          if (weights.some((weight) => weight < -0.001)) continue;
          let flowX = 0;
          let flowY = 0;
          for (let corner = 0; corner < 3; corner++) {
            const vertex = mesh.vertices[triangle[corner]];
            flowX += (vertex.b.x - vertex.a.x) * weights[corner];
            flowY += (vertex.b.y - vertex.a.y) * weights[corner];
          }
          const offset = ((phase * fieldHeight + y) * fieldWidth + x) * 4;
          pixels[offset] = encodeFlow(flowX * morphStrength, maxFlow);
          pixels[offset + 1] = encodeFlow(flowY * morphStrength, maxFlow);
        }
      }
    }
  }
  return { width: fieldWidth, height: fieldHeight, phases: fieldPhases, pixels, maxFlow };
}

export function buildFeatureMorphMesh(matches = []) {
  const anchors = [
    [0, 0], [0.5, 0], [1, 0], [1, 0.5],
    [1, 1], [0.5, 1], [0, 1], [0, 0.5],
  ].map(([x, y]) => ({ a: { x, y }, b: { x, y }, anchor: true }));
  const vertices = anchors.slice();
  for (const match of matches) {
    const midpoint = {
      x: (Number(match.a?.x) + Number(match.b?.x)) * 0.5,
      y: (Number(match.a?.y) + Number(match.b?.y)) * 0.5,
    };
    if (!Number.isFinite(midpoint.x) || !Number.isFinite(midpoint.y)) continue;
    if (vertices.some((vertex) => {
      const existing = { x: (vertex.a.x + vertex.b.x) * 0.5, y: (vertex.a.y + vertex.b.y) * 0.5 };
      return Math.hypot(existing.x - midpoint.x, existing.y - midpoint.y) < 0.002;
    })) continue;
    vertices.push({
      a: { x: Number(match.a.x), y: Number(match.a.y) },
      b: { x: Number(match.b.x), y: Number(match.b.y) },
      confidence: Number(match.confidence) || 0,
      anchor: false,
    });
  }
  const points = vertices.map((vertex) => ({
    x: (vertex.a.x + vertex.b.x) * 0.5,
    y: (vertex.a.y + vertex.b.y) * 0.5,
  }));
  return { vertices, triangles: delaunayTriangles(points) };
}

function delaunayTriangles(points) {
  const count = points.length;
  const working = points.concat([{ x: -20, y: -10 }, { x: 20, y: -10 }, { x: 0.5, y: 20 }]);
  let triangles = [[count, count + 1, count + 2]];
  for (let pointIndex = 0; pointIndex < count; pointIndex++) {
    const bad = triangles.filter((triangle) => pointInCircumcircle(working[pointIndex], ...triangle.map((index) => working[index])));
    const badSet = new Set(bad);
    const edges = new Map();
    for (const triangle of bad) {
      for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
        const key = left < right ? `${left}:${right}` : `${right}:${left}`;
        const entry = edges.get(key) || { edge: [left, right], count: 0 };
        entry.count++;
        edges.set(key, entry);
      }
    }
    triangles = triangles.filter((triangle) => !badSet.has(triangle));
    for (const { edge, count: edgeCount } of edges.values()) {
      if (edgeCount !== 1) continue;
      const triangle = [edge[0], edge[1], pointIndex];
      if (Math.abs(orientation(...triangle.map((index) => working[index]))) > EPSILON) triangles.push(triangle);
    }
  }
  return triangles.filter((triangle) => triangle.every((index) => index < count));
}

function pointInCircumcircle(point, a, b, c) {
  const ax = a.x - point.x;
  const ay = a.y - point.y;
  const bx = b.x - point.x;
  const by = b.y - point.y;
  const cx = c.x - point.x;
  const cy = c.y - point.y;
  const determinant = (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay);
  return orientation(a, b, c) > 0 ? determinant > -EPSILON : determinant < EPSILON;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function barycentricDenominator(a, b, c) {
  return (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
}

function barycentricWeights(x, y, a, b, c, denominator) {
  const first = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const second = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  return [first, second, 1 - first - second];
}

function nearestMatches(from, to) {
  return from.map((feature) => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    let secondDistance = Infinity;
    for (let index = 0; index < to.length; index++) {
      const distance = descriptorDistance(feature.descriptor, to[index].descriptor);
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        bestIndex = index;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    }
    return { index: bestIndex, distance: bestDistance, secondDistance };
  });
}

function descriptorDistance(left = [], right = []) {
  const length = Math.min(left.length || 0, right.length || 0);
  if (!length) return Infinity;
  let dot = 0;
  for (let index = 0; index < length; index++) dot += left[index] * right[index];
  return Math.max(0, Math.min(2, 2 - 2 * dot));
}

function encodeFlow(value, maxFlow) {
  const normalized = Math.max(-1, Math.min(1, value / Math.max(EPSILON, maxFlow)));
  return Math.round((normalized * 0.5 + 0.5) * 255);
}

// The editor compiles node parts as one lexical module. Keep the private
// geometry helpers in the same editable part as the public analysis API so an
// installed or project-forked node owns the real algorithm, not a host wrapper.
export function featureMorphAnalysisModuleSource() {
  return [
    `const EPSILON = ${EPSILON};`,
    matchSuperPointFeatures,
    buildFeatureMorphField,
    buildFeatureMorphMesh,
    delaunayTriangles,
    pointInCircumcircle,
    orientation,
    barycentricDenominator,
    barycentricWeights,
    nearestMatches,
    descriptorDistance,
    encodeFlow,
  ].map(String).join("\n\n");
}

export const FeatureMorphAnalysisExports = Object.freeze({
  matchSuperPointFeatures,
  buildFeatureMorphField,
  buildFeatureMorphMesh,
});
