const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
const MOBILENET_URL = "https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js";
const MODEL_ID = "mobilenet-v2-050-dense-flow-v3";
const ANALYSIS_SIZE = 224;
const CACHE_DB_NAME = "vj1-mobilenet-morph-cache";
const CACHE_STORE_NAME = "pairs";
const CACHE_VERSION = 3;
const CACHE_LIMIT = 24;
const INFERENCE_TIMEOUT_MS = 120000;

let modelPromise = null;
let modelReady = false;
let spatialEndpoint = "";
let inferenceQueue = Promise.resolve();
let sharedRevision = 0;
const sharedPairEntries = new Map();
const pendingAnalyses = new Map();
const imageFeatureCache = new WeakMap();
const scriptPromises = new Map();

export class MobileNetMorphPairService {
  constructor({ cache = createMobileNetMorphPersistentCache(), debounceMs = 280 } = {}) {
    this.entries = sharedPairEntries;
    this.cache = cache;
    this.debounceMs = Math.max(0, Number(debounceMs) || 0);
  }

  pairKey(params = {}) {
    return [
      MODEL_ID,
      params.imageAId || "",
      params.imageBId || "",
      Math.max(3, Math.min(48, Math.round(Number(params.featureGrid) || 8))),
      Math.max(0.75, Math.min(12, Number(params.patchScale) || 1)).toFixed(3),
      Number(params.matchThreshold ?? 0.2).toFixed(3),
      Number(params.spatialCoherence ?? 0.12).toFixed(3),
      params.fit || "cover",
    ].join(":");
  }

  externalKey(params = {}, media = {}) {
    const key = this.pairKey(params);
    const entry = this.entries.get(key);
    if (entry?.persistentKey !== mobileNetMorphPersistentKey(key, media.imageAFile, media.imageBFile)) return "idle:0";
    return `${entry?.status || "idle"}:${entry?.revision || 0}`;
  }

  status(params = {}, media = {}) {
    const key = this.pairKey(params);
    const entry = this.entries.get(key);
    if (entry?.persistentKey !== mobileNetMorphPersistentKey(key, media.imageAFile, media.imageBFile)) return "idle";
    return entry?.status || "idle";
  }

  request(params = {}, imageA, imageB, media = {}) {
    const key = this.pairKey(params);
    const persistentKey = mobileNetMorphPersistentKey(key, media.imageAFile, media.imageBFile);
    let entry = this.entries.get(key);
    if (entry?.persistentKey === persistentKey) return entry;
    entry = {
      key,
      persistentKey,
      status: "loading",
      detail: "checking saved MobileNet field",
      revision: ++sharedRevision,
      result: null,
      error: "",
    };
    this.entries.set(key, entry);
    this.trimCache();
    this.schedulePair(entry, params, imageA, imageB, media);
    return entry;
  }

  schedulePair(entry, params, imageA, imageB, media) {
    const groupKey = `${params.imageAId || ""}:${params.imageBId || ""}`;
    const pending = pendingAnalyses.get(groupKey);
    if (pending && pending.entry !== entry) {
      clearTimeout(pending.timer);
      pending.entry.status = "error";
      pending.entry.detail = "analysis superseded";
      pending.entry.revision = ++sharedRevision;
    }
    const start = () => {
      pendingAnalyses.delete(groupKey);
      withTimeout(this.resolvePair(params, imageA, imageB, media, (detail) => {
        entry.detail = detail;
        entry.revision = ++sharedRevision;
      }), INFERENCE_TIMEOUT_MS, "MobileNet analysis timed out")
      .then((result) => {
        entry.status = "ready";
        entry.detail = "MobileNet field ready";
        entry.result = result;
        entry.revision = ++sharedRevision;
      })
      .catch((error) => {
        entry.status = "error";
        entry.error = error?.message || String(error || "MobileNet failed");
        entry.revision = ++sharedRevision;
        console.error("[VJ1_MOBILENET_MORPH_FAILED]", error);
      });
    };
    const timer = setTimeout(start, this.debounceMs);
    pendingAnalyses.set(groupKey, { entry, timer });
  }

  async resolvePair(params, imageA, imageB, media = {}, onProgress = () => {}) {
    const persistentKey = mobileNetMorphPersistentKey(this.pairKey(params), media.imageAFile, media.imageBFile);
    const cached = await this.cache.load(persistentKey);
    if (cached) return cached;
    const result = await this.computePair(params, imageA, imageB, onProgress);
    await this.cache.save(persistentKey, result);
    return result;
  }

  async computePair(params, imageA, imageB, onProgress = () => {}) {
    if (!imageA || !imageB) throw new Error("Choose two image sources");
    onProgress(modelReady ? "preparing MobileNet features" : "loading MobileNet V2 from CDN");
    const model = await getMobileNetModel();
    const gridSize = Math.max(3, Math.min(48, Math.round(Number(params.featureGrid) || 8)));
    const patchScale = Math.max(0.75, Math.min(12, Number(params.patchScale) || 1));
    const fit = params.fit || "cover";
    const [featuresA, featuresB] = await enqueueInference(async () => {
      const first = await cachedMobileNetGrid(model, imageA, { gridSize, patchScale, fit }, (done, total) => {
        onProgress(`analyzing image A · ${done}/${total}`);
      });
      const second = await cachedMobileNetGrid(model, imageB, { gridSize, patchScale, fit }, (done, total) => {
        onProgress(`analyzing image B · ${done}/${total}`);
      });
      return [first, second];
    });
    onProgress("matching MobileNet regions");
    const matches = matchMobileNetFeatures(featuresA, featuresB, {
      similarityThreshold: Number(params.matchThreshold ?? 0.2),
      spatialCoherence: Number(params.spatialCoherence ?? 0.12),
    });
    if (matches.length < 4) {
      throw new Error(`Only ${matches.length} semantic region matches found; lower Match confidence`);
    }
    return {
      model: MODEL_ID,
      matches,
      field: buildMobileNetMorphField(matches, { gridSize }),
    };
  }

  trimCache() {
    while (this.entries.size > 6) this.entries.delete(this.entries.keys().next().value);
  }
}

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

export function mobileNetMorphPersistentKey(pairKey, imageAFile = {}, imageBFile = {}) {
  return [CACHE_VERSION, pairKey, fileFingerprint(imageAFile), fileFingerprint(imageBFile)].join("|");
}

export function createMobileNetMorphPersistentCache(database = globalThis.indexedDB) {
  return {
    async load(key) {
      if (!database || !key) return null;
      try {
        const store = await openCacheStore(database, "readonly");
        const record = await idbRequest(store.get(key));
        return normalizeCachedPair(record?.result);
      } catch (error) {
        console.warn("[VJ1_MOBILENET_CACHE_READ_FAILED]", { fallback: "reanalyze image pair", message: error?.message || String(error) });
        return null;
      }
    },
    async save(key, result) {
      const normalized = normalizeCachedPair(result);
      if (!database || !key || !normalized) return;
      try {
        const store = await openCacheStore(database, "readwrite");
        await idbRequest(store.put({ key, savedAt: Date.now(), result: normalized }));
        await prunePersistentCache(database);
      } catch (error) {
        console.warn("[VJ1_MOBILENET_CACHE_WRITE_FAILED]", { fallback: "memory cache only", message: error?.message || String(error) });
      }
    },
  };
}

async function extractMobileNetGrid(model, image, { gridSize, patchScale, fit }, onProgress) {
  const composition = createAnalysisCanvas();
  drawFittedImage(composition, image, fit);
  const spatialFeatures = await extractMobileNetSpatialGrid(model, composition, { gridSize, patchScale });
  if (spatialFeatures) {
    onProgress?.(spatialFeatures.length, spatialFeatures.length);
    return spatialFeatures;
  }
  console.warn("[VJ1_MOBILENET_SPATIAL_FALLBACK]", { fallback: "batched patch descriptors" });
  const patch = createAnalysisCanvas();
  const context = patch.getContext("2d", { willReadFrequently: false });
  const features = [];
  const total = gridSize * gridSize;
  const patchSpan = ANALYSIS_SIZE / gridSize * patchScale;
  const tf = globalThis.tf;
  const fallbackBatchSize = 7;
  for (let y = 0; y < gridSize; y++) {
    for (let startX = 0; startX < gridSize; startX += fallbackBatchSize) {
      const endX = Math.min(gridSize, startX + fallbackBatchSize);
      const patchTensors = [];
      for (let x = startX; x < endX; x++) {
        const centerX = (x + 0.5) / gridSize * ANALYSIS_SIZE;
        const centerY = (y + 0.5) / gridSize * ANALYSIS_SIZE;
        context.fillStyle = "#000";
        context.fillRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
        context.drawImage(
          composition,
          centerX - patchSpan * 0.5,
          centerY - patchSpan * 0.5,
          patchSpan,
          patchSpan,
          0,
          0,
          ANALYSIS_SIZE,
          ANALYSIS_SIZE
        );
        patchTensors.push(tf.browser.fromPixels(patch));
      }
      const batch = tf.stack(patchTensors);
      patchTensors.forEach((tensor) => tensor.dispose());
      const embeddings = model.infer(batch, true);
      batch.dispose();
      const values = await embeddings.data();
      const batchCount = endX - startX;
      const descriptorSize = Math.floor(values.length / batchCount);
      embeddings.dispose();
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const x = startX + batchIndex;
        const descriptor = normalizeDescriptor(values.subarray(batchIndex * descriptorSize, (batchIndex + 1) * descriptorSize));
        features.push({
          x: (x + 0.5) / gridSize,
          y: (y + 0.5) / gridSize,
          descriptor,
        });
        onProgress?.(features.length, total);
      }
    }
    await yieldToUi();
  }
  return features;
}

function cachedMobileNetGrid(model, image, options, onProgress) {
  if (!image || (typeof image !== "object" && typeof image !== "function")) {
    return extractMobileNetGrid(model, image, options, onProgress);
  }
  let entries = imageFeatureCache.get(image);
  if (!entries) {
    entries = new Map();
    imageFeatureCache.set(image, entries);
  }
  const key = `${options.gridSize}:${Number(options.patchScale).toFixed(3)}:${options.fit}`;
  if (entries.has(key)) {
    onProgress?.(options.gridSize * options.gridSize, options.gridSize * options.gridSize);
    return entries.get(key);
  }
  const promise = extractMobileNetGrid(model, image, options, onProgress).catch((error) => {
    entries.delete(key);
    throw error;
  });
  entries.set(key, promise);
  return promise;
}

async function extractMobileNetSpatialGrid(model, composition, { gridSize, patchScale }) {
  const tf = globalThis.tf;
  const graphModel = model?.model;
  const nodeNames = Object.keys(graphModel?.executor?.graph?.nodes || {});
  const candidates = mobileNetSpatialEndpointCandidates(nodeNames);
  if (spatialEndpoint && !candidates.includes(spatialEndpoint)) candidates.unshift(spatialEndpoint);
  if (!graphModel?.execute || !candidates.length) return null;
  const input = tf.tidy(() => tf.browser.fromPixels(composition).toFloat().div(255).expandDims(0));
  try {
    for (const endpoint of candidates.slice(0, 8)) {
      let activation = null;
      try {
        activation = graphModel.execute(input, endpoint);
        if (Array.isArray(activation)) activation = activation[0];
        const shape = activation?.shape || [];
        if (shape.length !== 4 || shape[0] !== 1 || shape[1] < gridSize || shape[2] < gridSize || shape[3] < 16) {
          continue;
        }
        const values = await activation.data();
        spatialEndpoint = endpoint;
        return sampleSpatialActivation(values, shape, gridSize, patchScale);
      } catch {
      } finally {
        activation?.dispose?.();
      }
    }
  } finally {
    input.dispose();
  }
  return null;
}

function mobileNetSpatialEndpointCandidates(nodeNames = []) {
  return nodeNames
    .filter((name) => /MobilenetV2\/expanded_conv_\d+\/(?:project\/BatchNorm\/FusedBatchNorm(?:V3)?|expand\/Relu6)$/.test(name))
    .map((name) => {
      const block = Number(name.match(/expanded_conv_(\d+)/)?.[1]) || 0;
      const project = name.includes("/project/BatchNorm") ? 1 : 0;
      return { name, score: Math.abs(block - 12) * 10 - project };
    })
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.name);
}

function sampleSpatialActivation(values, shape, gridSize, patchScale) {
  const [, height, width, channels] = shape;
  const radius = Math.max(0, Math.min(12, Math.round((Number(patchScale) - 0.75) / 0.85)));
  const features = [];
  for (let gridY = 0; gridY < gridSize; gridY++) {
    for (let gridX = 0; gridX < gridSize; gridX++) {
      const centerX = Math.max(0, Math.min(width - 1, Math.round((gridX + 0.5) / gridSize * width - 0.5)));
      const centerY = Math.max(0, Math.min(height - 1, Math.round((gridY + 0.5) / gridSize * height - 0.5)));
      const descriptor = new Float32Array(channels);
      let samples = 0;
      for (let y = Math.max(0, centerY - radius); y <= Math.min(height - 1, centerY + radius); y++) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x++) {
          const offset = (y * width + x) * channels;
          for (let channel = 0; channel < channels; channel++) descriptor[channel] += values[offset + channel];
          samples++;
        }
      }
      if (samples > 1) {
        for (let channel = 0; channel < channels; channel++) descriptor[channel] /= samples;
      }
      features.push({
        x: (gridX + 0.5) / gridSize,
        y: (gridY + 0.5) / gridSize,
        descriptor: normalizeDescriptor(descriptor),
      });
    }
  }
  return features;
}

async function getMobileNetModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    await loadScript(TFJS_URL, () => globalThis.tf);
    await globalThis.tf.ready();
    if (globalThis.tf.getBackend() !== "webgl") {
      try {
        await globalThis.tf.setBackend("webgl");
        await globalThis.tf.ready();
      } catch (error) {
        console.warn("[VJ1_TFJS_WEBGL_BACKEND_FAILED]", { fallback: globalThis.tf.getBackend(), message: error?.message || String(error) });
      }
    }
    await loadScript(MOBILENET_URL, () => globalThis.mobilenet);
    const model = await globalThis.mobilenet.load({ version: 2, alpha: 0.5 });
    modelReady = true;
    return model;
  })().catch((error) => {
    modelPromise = null;
    modelReady = false;
    throw error;
  });
  return modelPromise;
}

function loadScript(url, ready) {
  if (ready?.()) return Promise.resolve();
  if (scriptPromises.has(url)) return scriptPromises.get(url);
  if (typeof document === "undefined") return Promise.reject(new Error(`Cannot load ${url} outside a browser`));
  const promise = new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === url);
    const script = existing || document.createElement("script");
    const finish = () => ready?.() ? resolve() : reject(new Error(`CDN script loaded without its API: ${url}`));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error(`Unable to load MobileNet dependency: ${url}`)), { once: true });
    if (!existing) {
      script.src = url;
      script.crossOrigin = "anonymous";
      document.head.append(script);
    }
  });
  scriptPromises.set(url, promise);
  return promise;
}

function createAnalysisCanvas() {
  if (typeof document !== "undefined") {
    return Object.assign(document.createElement("canvas"), { width: ANALYSIS_SIZE, height: ANALYSIS_SIZE });
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(ANALYSIS_SIZE, ANALYSIS_SIZE);
  throw new Error("MobileNet image analysis requires a browser canvas");
}

function drawFittedImage(canvas, image, fit = "cover") {
  const drawable = image?.canvas || image?.elt || image;
  const sourceWidth = Math.max(1, image?.width || drawable?.videoWidth || drawable?.naturalWidth || drawable?.width || 1);
  const sourceHeight = Math.max(1, image?.height || drawable?.videoHeight || drawable?.naturalHeight || drawable?.height || 1);
  const context = canvas.getContext("2d", { willReadFrequently: false });
  context.fillStyle = "#000";
  context.fillRect(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  if (fit === "stretch") {
    context.drawImage(drawable, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    return;
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const scale = fit === "contain"
    ? Math.min(ANALYSIS_SIZE / sourceWidth, ANALYSIS_SIZE / sourceHeight)
    : Math.max(ANALYSIS_SIZE / sourceWidth, ANALYSIS_SIZE / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(drawable, (ANALYSIS_SIZE - width) * 0.5, (ANALYSIS_SIZE - height) * 0.5, width, height);
}

function normalizeDescriptor(values) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Float32Array.from(values, (value) => value / magnitude);
}

function descriptorSimilarity(left = [], right = []) {
  const length = Math.min(left.length || 0, right.length || 0);
  if (!length) return -1;
  let dot = 0;
  for (let index = 0; index < length; index++) dot += left[index] * right[index];
  return Math.max(-1, Math.min(1, dot));
}

function enqueueInference(run) {
  const result = inferenceQueue.then(run, run);
  inferenceQueue = result.catch(() => {});
  return result;
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = 0;
  const guard = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timeout));
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fileFingerprint(file = {}) {
  return [
    file.relativePath || file.webkitRelativePath || file.name || "unknown",
    Number(file.size) || 0,
    Number(file.lastModified) || 0,
    file.type || "",
  ].join(":");
}

function normalizeCachedPair(result) {
  const field = result?.field;
  if (!Array.isArray(result?.matches) || !field || !Number(field.width) || !Number(field.height) || !field.pixels) return null;
  const pixels = field.pixels instanceof Uint8ClampedArray
    ? field.pixels
    : Uint8ClampedArray.from(field.pixels);
  const phases = Math.max(1, Math.round(field.phases) || 1);
  if (pixels.length !== Math.round(field.width) * Math.round(field.height) * phases * 4) return null;
  return { ...result, matches: result.matches, field: { ...field, phases, pixels } };
}

async function prunePersistentCache(database) {
  const store = await openCacheStore(database, "readwrite");
  await new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const stale = request.result
        .sort((left, right) => Number(right.savedAt || 0) - Number(left.savedAt || 0))
        .slice(CACHE_LIMIT);
      for (const record of stale) store.delete(record.key);
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    };
  });
}

function openCacheStore(database, mode) {
  return new Promise((resolve, reject) => {
    const open = database.open(CACHE_DB_NAME, CACHE_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
        open.result.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction(CACHE_STORE_NAME, mode);
      transaction.onerror = () => reject(transaction.error);
      resolve(transaction.objectStore(CACHE_STORE_NAME));
    };
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
