import {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
} from "../../libraries/visual-nodes/generators/feature-morph-v2/analysis.js?v=node-program-hooks-15";
import { fitOverflowDestination } from "../../libraries/render-engine/fit-geometry/index.js?v=fit-geometry-1";

export {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
};

const FALLBACK_ANALYSIS_MODULE = Object.freeze({
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
});

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
let inferenceQueue = Promise.resolve();
let sharedRevision = 0;
const sharedPairEntries = new Map();
const sharedInvalidationSubscribers = new Set();
const pendingAnalyses = new Map();
const imageFeatureCache = new WeakMap();
const spatialEndpointCache = new WeakMap();
const scriptPromises = new Map();

export class MobileNetMorphPairService {
  constructor({
    cache = createMobileNetMorphPersistentCache(),
    debounceMs = 280,
    onInvalidate = null,
  } = {}) {
    this.entries = sharedPairEntries;
    this.cache = cache;
    this.debounceMs = Math.max(0, Number(debounceMs) || 0);
    this.onInvalidate =
      typeof onInvalidate === "function" ? onInvalidate : null;
    if (this.onInvalidate) {
      sharedInvalidationSubscribers.add(this.onInvalidate);
    }
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
    if (entry?.persistentKey !== this.persistentKey(key, media, entry)) return "idle:0";
    return `${entry?.status || "idle"}:${entry?.revision || 0}`;
  }

  status(params = {}, media = {}) {
    const key = this.pairKey(params);
    const entry = this.entries.get(key);
    if (entry?.persistentKey !== this.persistentKey(key, media, entry)) return "idle";
    return entry?.status || "idle";
  }

  request(params = {}, imageA, imageB, media = {}) {
    const key = this.pairKey(params);
    const algorithmRevision = String(media.algorithmRevision || "legacy");
    const persistentKey = this.persistentKey(key, media);
    let entry = this.entries.get(key);
    if (entry?.persistentKey === persistentKey) return entry;
    entry = {
      key,
      persistentKey,
      algorithmRevision,
      status: "loading",
      detail: "checking saved MobileNet field",
      revision: ++sharedRevision,
      result: null,
      error: "",
    };
    this.entries.set(key, entry);
    this.trimCache();
    publishAnalysisInvalidation("feature-morph-analysis-loading", entry);
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
      publishAnalysisInvalidation(
        "feature-morph-analysis-superseded",
        pending.entry,
      );
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
        publishAnalysisInvalidation("feature-morph-analysis-ready", entry);
      })
      .catch((error) => {
        entry.status = "error";
        entry.error = error?.message || String(error || "MobileNet failed");
        entry.revision = ++sharedRevision;
        publishAnalysisInvalidation("feature-morph-analysis-error", entry);
        console.error("[VJ1_MOBILENET_MORPH_FAILED]", error);
      });
    };
    const timer = setTimeout(start, this.debounceMs);
    pendingAnalyses.set(groupKey, { entry, timer });
  }

  async resolvePair(params, imageA, imageB, media = {}, onProgress = () => {}) {
    const persistentKey = this.persistentKey(this.pairKey(params), media);
    const cached = await this.cache.load(persistentKey);
    if (cached) return cached;
    const result = await this.computePair(params, imageA, imageB, onProgress, mobileNetAnalysisModule(media.nodeModule));
    await this.cache.save(persistentKey, result);
    return result;
  }

  async computePair(params, imageA, imageB, onProgress = () => {}, analysisModule = FALLBACK_ANALYSIS_MODULE) {
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
    const matches = analysisModule.matchMobileNetFeatures(featuresA, featuresB, {
      similarityThreshold: Number(params.matchThreshold ?? 0.2),
      spatialCoherence: Number(params.spatialCoherence ?? 0.12),
    });
    if (matches.length < 4) {
      throw new Error(`Only ${matches.length} semantic region matches found; lower Match confidence`);
    }
    return {
      model: MODEL_ID,
      matches,
      field: analysisModule.buildMobileNetMorphField(matches, { gridSize }),
    };
  }

  trimCache() {
    while (this.entries.size > 6) this.entries.delete(this.entries.keys().next().value);
  }

  persistentKey(pairKey, media = {}, entry = null) {
    const algorithmRevision = media.algorithmRevision ?? entry?.algorithmRevision ?? "legacy";
    return mobileNetMorphPersistentKey(pairKey, media.imageAFile, media.imageBFile, algorithmRevision);
  }

  dispose() {
    if (this.onInvalidate) {
      sharedInvalidationSubscribers.delete(this.onInvalidate);
      this.onInvalidate = null;
    }
  }
}

function publishAnalysisInvalidation(reason, entry) {
  for (const subscriber of sharedInvalidationSubscribers) {
    try {
      subscriber(reason, entry);
    } catch {}
  }
}

export function mobileNetAnalysisModule(module = {}) {
  return typeof module?.matchMobileNetFeatures === "function" &&
    typeof module?.buildMobileNetMorphField === "function" &&
    typeof module?.buildRigidMlsMorphField === "function" &&
    typeof module?.mobileNetMorphFieldForStrategy === "function"
    ? module
    : FALLBACK_ANALYSIS_MODULE;
}


export function mobileNetMorphPersistentKey(pairKey, imageAFile = {}, imageBFile = {}, algorithmRevision = "legacy") {
  return [CACHE_VERSION, pairKey, String(algorithmRevision || "legacy"), fileFingerprint(imageAFile), fileFingerprint(imageBFile)].join("|");
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
  onProgress?.(spatialFeatures.length, spatialFeatures.length);
  return spatialFeatures;
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
  const nodeNames = mobileNetGraphNodeNames(graphModel);
  const candidates = mobileNetSpatialEndpointCandidates(nodeNames, gridSize);
  const endpointCache = spatialEndpointCache.get(graphModel) || new Map();
  if (graphModel && !spatialEndpointCache.has(graphModel)) spatialEndpointCache.set(graphModel, endpointCache);
  const cachedEndpoint = endpointCache.get(gridSize);
  if (cachedEndpoint && !candidates.includes(cachedEndpoint)) candidates.unshift(cachedEndpoint);
  if (!graphModel?.execute || !candidates.length) {
    throw mobileNetSpatialEndpointError({ gridSize, nodeNames, candidates });
  }
  const input = tf.tidy(() => tf.browser.fromPixels(composition).toFloat().div(255).expandDims(0));
  const rejectedShapes = [];
  try {
    for (const endpoint of candidates) {
      let result = null;
      try {
        result = graphModel.execute(input, endpoint);
        const activation = firstTensor(result);
        const shape = activation?.shape || [];
        if (shape.length !== 4 || shape[0] !== 1 || shape[1] < gridSize || shape[2] < gridSize || shape[3] < 16) {
          rejectedShapes.push(`${endpoint}:${shape.join("x") || "not-a-tensor"}`);
          continue;
        }
        const values = await activation.data();
        endpointCache.set(gridSize, endpoint);
        return sampleSpatialActivation(values, shape, gridSize, patchScale);
      } catch (error) {
        rejectedShapes.push(`${endpoint}:error:${error?.message || String(error)}`);
      } finally {
        disposeTensorResult(result);
      }
    }
  } finally {
    input.dispose();
  }
  throw mobileNetSpatialEndpointError({ gridSize, nodeNames, candidates, rejectedShapes });
}

export function mobileNetGraphNodeNames(graphModel = {}) {
  const nodes = graphModel?.executor?.graph?.nodes;
  if (nodes instanceof Map) return [...nodes.keys()];
  if (Array.isArray(nodes)) return nodes.map((node) => node?.name).filter(Boolean);
  return Object.keys(nodes || {});
}

export function mobileNetSpatialEndpointCandidates(nodeNames = [], gridSize = 8) {
  const preferredBlock = gridSize > 28 ? 2 : gridSize > 14 ? 5 : 12;
  return nodeNames
    .filter((name) => /MobilenetV2\/expanded_conv_\d+\/(?:project\/BatchNorm\/FusedBatchNorm(?:V3)?|expand\/Relu6)$/.test(name))
    .map((name) => {
      const block = Number(name.match(/expanded_conv_(\d+)/)?.[1]) || 0;
      const project = name.includes("/project/BatchNorm") ? 1 : 0;
      return { name, score: Math.abs(block - preferredBlock) * 10 - project };
    })
    .sort((left, right) => left.score - right.score)
    .map((entry) => entry.name);
}

function firstTensor(result) {
  if (Array.isArray(result)) return result.find((value) => Array.isArray(value?.shape));
  if (result && !Array.isArray(result.shape) && typeof result === "object") {
    return Object.values(result).find((value) => Array.isArray(value?.shape));
  }
  return result;
}

function disposeTensorResult(result) {
  if (Array.isArray(result)) {
    result.forEach((value) => value?.dispose?.());
    return;
  }
  if (result && !Array.isArray(result.shape) && typeof result === "object") {
    Object.values(result).forEach((value) => value?.dispose?.());
    return;
  }
  result?.dispose?.();
}

function mobileNetSpatialEndpointError({ gridSize, nodeNames = [], candidates = [], rejectedShapes = [] }) {
  const details = [
    `grid=${gridSize}`,
    `graphNodes=${nodeNames.length}`,
    `candidates=${candidates.length}`,
  ];
  if (rejectedShapes.length) details.push(`rejected=${rejectedShapes.slice(0, 6).join(",")}`);
  return new Error(`VJ1_MOBILENET_SPATIAL_ENDPOINT_REQUIRED:${details.join(":")}`);
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
        console.error("[VJ1_TFJS_WEBGL_BACKEND_FAILED]", { message: error?.message || String(error) });
        throw error;
      }
    }
    if (globalThis.tf.getBackend() !== "webgl") {
      throw new Error(`VJ1_TFJS_WEBGL_BACKEND_REQUIRED:${globalThis.tf.getBackend() || "none"}`);
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
  const fitted = fitOverflowDestination(
    { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    { x: 0, y: 0, width: ANALYSIS_SIZE, height: ANALYSIS_SIZE },
    fit
  );
  const destination = fitted.destination;
  context.drawImage(drawable, destination.x, destination.y, destination.width, destination.height);
}

function normalizeDescriptor(values) {
  let magnitude = 0;
  for (const value of values) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Float32Array.from(values, (value) => value / magnitude);
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
