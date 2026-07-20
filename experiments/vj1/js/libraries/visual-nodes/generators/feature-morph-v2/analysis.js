export function matchMobileNetFeatures(featuresA = [], featuresB = [], {
  similarityThreshold = 0.35,
  spatialCoherence = 0.35,
} = {}) {
  const threshold = Math.max(-1, Math.min(0.99, Number(similarityThreshold) || 0));
  const coherence = Math.max(0, Math.min(1, Number(spatialCoherence) || 0));
  const matches = [];
  const maximumDisplacement = Math.max(0.18, 0.7 - coherence * 0.5);
  for (const a of featuresA) {
    let best = null;
    for (const b of featuresB) {
      const similarity = descriptorSimilarity(a.descriptor, b.descriptor);
      if (similarity < threshold) continue;
      const displacement = Math.hypot(b.x - a.x, b.y - a.y);
      if (displacement > maximumDisplacement) continue;
      const score = similarity - displacement * coherence * 0.45;
      if (!best || score > best.score) best = { b, similarity, score };
    }
    if (!best) continue;
    matches.push({
      a: { x: a.x, y: a.y },
      b: { x: best.b.x, y: best.b.y },
      confidence: Math.max(0, Math.min(1, (best.similarity - threshold) / Math.max(0.01, 1 - threshold))),
      similarity: best.similarity,
    });
  }
  return matches;
}

export function buildMobileNetMorphField(matches = [], {
  gridSize = 8,
  width = 48,
  height = 48,
  maxFlow = 0.5,
  smoothingPasses = 3,
} = {}) {
  const columns = Math.max(2, Math.round(gridSize));
  const rows = columns;
  const vectors = Array.from({ length: columns * rows }, () => ({ x: 0, y: 0, confidence: 0 }));
  for (const match of matches) {
    const x = Math.max(0, Math.min(columns - 1, Math.round(Number(match.a?.x) * columns - 0.5)));
    const y = Math.max(0, Math.min(rows - 1, Math.round(Number(match.a?.y) * rows - 0.5)));
    const confidence = Math.max(0, Math.min(1, Number(match.confidence) || 0));
    vectors[y * columns + x] = {
      x: (Number(match.b?.x) - Number(match.a?.x)) * confidence,
      y: (Number(match.b?.y) - Number(match.a?.y)) * confidence,
      confidence,
    };
  }
  let filtered = rejectIsolatedFlowVectors(vectors, columns, rows);
  for (let pass = 0; pass < Math.max(0, Math.round(smoothingPasses)); pass++) {
    filtered = smoothFlowVectors(filtered, columns, rows);
  }
  const fieldWidth = Math.max(2, Math.round(width));
  const fieldHeight = Math.max(2, Math.round(height));
  const pixels = new Uint8ClampedArray(fieldWidth * fieldHeight * 4);
  for (let y = 0; y < fieldHeight; y++) {
    const v = y / (fieldHeight - 1);
    for (let x = 0; x < fieldWidth; x++) {
      const u = x / (fieldWidth - 1);
      const flow = sampleFlowGrid(filtered, columns, rows, u, v);
      const edgeDistance = Math.min(u, v, 1 - u, 1 - v);
      const edgeAnchor = smoothStep(0, 0.16, edgeDistance);
      const offset = (y * fieldWidth + x) * 4;
      pixels[offset] = encodeFlow(flow.x * edgeAnchor, maxFlow);
      pixels[offset + 1] = encodeFlow(flow.y * edgeAnchor, maxFlow);
      pixels[offset + 2] = Math.round(Math.max(0, Math.min(1, flow.confidence)) * 255);
      pixels[offset + 3] = 255;
    }
  }
  return { width: fieldWidth, height: fieldHeight, phases: 1, pixels, maxFlow };
}

export function mobileNetMorphFieldForStrategy(result = {}, strategy = "elastic") {
  if (strategy === "elastic") {
    if (!result.elasticField) {
      result.elasticField = buildRigidMlsMorphField(result.matches, {
        width: result.field?.width || 48,
        height: result.field?.height || 48,
        phases: 11,
        localAmount: 0.96,
        localRadius: 0.0025,
        anchorConfidence: 0.7,
      });
    }
    return result.elasticField;
  }
  if (strategy !== "rigid") return result.field;
  if (!result.rigidField) {
    result.rigidField = buildRigidMlsMorphField(result.matches, {
      width: result.field?.width || 48,
      height: result.field?.height || 48,
    });
  }
  return result.rigidField;
}

export function buildRigidMlsMorphField(matches = [], {
  width = 48,
  height = 48,
  phases = 9,
  maxFlow = 0.5,
  maxControls = 96,
  localAmount = 0.78,
  localRadius = 0.0009,
  anchorConfidence = 1.5,
} = {}) {
  const fieldWidth = Math.max(2, Math.round(width));
  const fieldHeight = Math.max(2, Math.round(height));
  const fieldPhases = Math.max(2, Math.round(phases));
  const controls = rigidMlsControls(matches, maxControls, anchorConfidence);
  const layers = 2;
  const pixels = new Uint8ClampedArray(fieldWidth * fieldHeight * fieldPhases * layers * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 128;
    pixels[offset + 1] = 128;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }
  for (let phase = 0; phase < fieldPhases; phase++) {
    const morph = phase / (fieldPhases - 1);
    const phaseControls = controls.map((control) => ({
      ...control,
      x: control.a.x + (control.b.x - control.a.x) * morph,
      y: control.a.y + (control.b.y - control.a.y) * morph,
    }));
    for (let y = 0; y < fieldHeight; y++) {
      const v = y / (fieldHeight - 1);
      for (let x = 0; x < fieldWidth; x++) {
        const u = x / (fieldWidth - 1);
        const mappedA = rigidMlsMap(u, v, phaseControls, "a", { localAmount, localRadius });
        const mappedB = rigidMlsMap(u, v, phaseControls, "b", { localAmount, localRadius });
        const edgeDistance = Math.min(u, v, 1 - u, 1 - v);
        const edgeAnchor = smoothStep(0, 0.1, edgeDistance);
        const offsetA = ((phase * fieldHeight + y) * fieldWidth + x) * 4;
        const offsetB = ((((fieldPhases + phase) * fieldHeight) + y) * fieldWidth + x) * 4;
        pixels[offsetA] = encodeFlow((mappedA.x - u) * edgeAnchor, maxFlow);
        pixels[offsetA + 1] = encodeFlow((mappedA.y - v) * edgeAnchor, maxFlow);
        pixels[offsetB] = encodeFlow((mappedB.x - u) * edgeAnchor, maxFlow);
        pixels[offsetB + 1] = encodeFlow((mappedB.y - v) * edgeAnchor, maxFlow);
      }
    }
  }
  return { width: fieldWidth, height: fieldHeight, phases: fieldPhases, layers, pixels, maxFlow, layout: "inverse-pair" };
}

function rigidMlsControls(matches, maxControls, anchorConfidence) {
  const selected = [];
  const candidates = matches
    .filter((match) => [match.a?.x, match.a?.y, match.b?.x, match.b?.y].every(Number.isFinite))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0));
  for (const match of candidates) {
    const midpoint = {
      x: (match.a.x + match.b.x) * 0.5,
      y: (match.a.y + match.b.y) * 0.5,
    };
    if (selected.some((control) => {
      const centerX = (control.a.x + control.b.x) * 0.5;
      const centerY = (control.a.y + control.b.y) * 0.5;
      return Math.hypot(centerX - midpoint.x, centerY - midpoint.y) < 0.025;
    })) continue;
    selected.push({
      a: { x: Number(match.a.x), y: Number(match.a.y) },
      b: { x: Number(match.b.x), y: Number(match.b.y) },
      confidence: Math.max(0.08, Math.min(1, Number(match.confidence) || 0)),
    });
    if (selected.length >= Math.max(8, Math.round(maxControls))) break;
  }
  for (const [x, y] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
    selected.push({ a: { x, y }, b: { x, y }, confidence: Math.max(0.1, Number(anchorConfidence) || 0.1) });
  }
  return selected;
}

function rigidMlsMap(x, y, controls, target, { localAmount = 0.78, localRadius = 0.0009 } = {}) {
  let weightTotal = 0;
  let localWeightTotal = 0;
  let sourceX = 0;
  let sourceY = 0;
  let targetX = 0;
  let targetY = 0;
  let localOffsetX = 0;
  let localOffsetY = 0;
  const weighted = [];
  for (const control of controls) {
    const distanceSquared = (x - control.x) ** 2 + (y - control.y) ** 2;
    if (distanceSquared < 1e-10) return { ...control[target] };
    const weight = control.confidence / (distanceSquared + 0.0025);
    const localWeight = control.confidence / ((distanceSquared + Math.max(0.0001, localRadius)) ** 2);
    weighted.push({ control, weight });
    weightTotal += weight;
    localWeightTotal += localWeight;
    sourceX += control.x * weight;
    sourceY += control.y * weight;
    targetX += control[target].x * weight;
    targetY += control[target].y * weight;
    localOffsetX += (control[target].x - control.x) * localWeight;
    localOffsetY += (control[target].y - control.y) * localWeight;
  }
  if (weightTotal < 1e-8) return { x, y };
  sourceX /= weightTotal;
  sourceY /= weightTotal;
  targetX /= weightTotal;
  targetY /= weightTotal;
  let rotationA = 0;
  let rotationB = 0;
  for (const { control, weight } of weighted) {
    const px = control.x - sourceX;
    const py = control.y - sourceY;
    const qx = control[target].x - targetX;
    const qy = control[target].y - targetY;
    rotationA += weight * (px * qx + py * qy);
    rotationB += weight * (px * qy - py * qx);
  }
  const magnitude = Math.hypot(rotationA, rotationB);
  const localMap = {
    x: x + localOffsetX / Math.max(1e-8, localWeightTotal),
    y: y + localOffsetY / Math.max(1e-8, localWeightTotal),
  };
  if (magnitude < 1e-8) return localMap;
  const cosine = rotationA / magnitude;
  const sine = rotationB / magnitude;
  const localX = x - sourceX;
  const localY = y - sourceY;
  const rigidMap = {
    x: targetX + cosine * localX - sine * localY,
    y: targetY + sine * localX + cosine * localY,
  };
  const elasticAmount = Math.max(0, Math.min(1, Number(localAmount) || 0));
  return {
    x: rigidMap.x + (localMap.x - rigidMap.x) * elasticAmount,
    y: rigidMap.y + (localMap.y - rigidMap.y) * elasticAmount,
  };
}

function rejectIsolatedFlowVectors(vectors, columns, rows) {
  return vectors.map((vector, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const neighbors = flowNeighbors(vectors, columns, rows, x, y).filter((item) => item.confidence > 0);
    if (neighbors.length < 2) return { ...vector };
    const medianX = median(neighbors.map((item) => item.x));
    const medianY = median(neighbors.map((item) => item.y));
    const disagreement = Math.hypot(vector.x - medianX, vector.y - medianY);
    if (vector.confidence <= 0 || disagreement > 0.16) {
      return { x: medianX, y: medianY, confidence: average(neighbors.map((item) => item.confidence)) * 0.75 };
    }
    return { ...vector };
  });
}

function smoothFlowVectors(vectors, columns, rows) {
  return vectors.map((vector, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const neighbors = flowNeighbors(vectors, columns, rows, x, y);
    let totalWeight = 1.5;
    let flowX = vector.x * 1.5;
    let flowY = vector.y * 1.5;
    let confidence = vector.confidence * 1.5;
    for (const neighbor of neighbors) {
      const weight = 0.65 + neighbor.confidence * 0.35;
      flowX += neighbor.x * weight;
      flowY += neighbor.y * weight;
      confidence += neighbor.confidence * weight;
      totalWeight += weight;
    }
    return { x: flowX / totalWeight, y: flowY / totalWeight, confidence: confidence / totalWeight };
  });
}

function flowNeighbors(vectors, columns, rows, centerX, centerY) {
  const neighbors = [];
  for (let y = Math.max(0, centerY - 1); y <= Math.min(rows - 1, centerY + 1); y++) {
    for (let x = Math.max(0, centerX - 1); x <= Math.min(columns - 1, centerX + 1); x++) {
      if (x === centerX && y === centerY) continue;
      neighbors.push(vectors[y * columns + x]);
    }
  }
  return neighbors;
}

function sampleFlowGrid(vectors, columns, rows, u, v) {
  const gridX = Math.max(0, Math.min(columns - 1, u * columns - 0.5));
  const gridY = Math.max(0, Math.min(rows - 1, v * rows - 0.5));
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(columns - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const top = mixFlow(vectors[y0 * columns + x0], vectors[y0 * columns + x1], tx);
  const bottom = mixFlow(vectors[y1 * columns + x0], vectors[y1 * columns + x1], tx);
  return mixFlow(top, bottom, ty);
}

function mixFlow(left, right, amount) {
  return {
    x: left.x + (right.x - left.x) * amount,
    y: left.y + (right.y - left.y) * amount,
    confidence: left.confidence + (right.confidence - left.confidence) * amount,
  };
}

function median(values = []) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function average(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function smoothStep(edge0, edge1, value) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-8, edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function encodeFlow(value, maxFlow) {
  const normalized = Math.max(-1, Math.min(1, value / Math.max(1e-8, maxFlow)));
  return Math.round((normalized * 0.5 + 0.5) * 255);
}

function descriptorSimilarity(left = [], right = []) {
  const length = Math.min(left.length || 0, right.length || 0);
  if (!length) return -1;
  let dot = 0;
  for (let index = 0; index < length; index++) dot += left[index] * right[index];
  return Math.max(-1, Math.min(1, dot));
}

// The editor compiles this as one lexical JavaScript module. Private field
// helpers stay beside the exported algorithms so a fork owns the complete
// algorithm rather than calling back into the output service.
export function featureMorphV2AnalysisModuleSource() {
  return [
    matchMobileNetFeatures,
    buildMobileNetMorphField,
    mobileNetMorphFieldForStrategy,
    buildRigidMlsMorphField,
    rigidMlsControls,
    rigidMlsMap,
    rejectIsolatedFlowVectors,
    smoothFlowVectors,
    flowNeighbors,
    sampleFlowGrid,
    mixFlow,
    median,
    average,
    smoothStep,
    encodeFlow,
    descriptorSimilarity,
  ].map(String).join("\n\n");
}

export const FeatureMorphV2AnalysisExports = Object.freeze({
  matchMobileNetFeatures,
  buildMobileNetMorphField,
  mobileNetMorphFieldForStrategy,
  buildRigidMlsMorphField,
});

