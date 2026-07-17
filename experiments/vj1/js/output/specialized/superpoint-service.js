import { buildFeatureMorphField, matchSuperPointFeatures } from "./feature-morph-field.js?v=feature-morph-mesh-38";

const INPUT_WIDTH = 640;
const INPUT_HEIGHT = 480;
const DESCRIPTOR_WIDTH = 80;
const DESCRIPTOR_HEIGHT = 60;
const DESCRIPTOR_SIZE = 256;
const MODEL_URL = new URL("../../../models/superpoint/superpoint_no_borders.onnx", import.meta.url);
const MODEL_DATA_URL = new URL("../../../models/superpoint/superpoint_no_borders.onnx.data", import.meta.url);
const CACHE_DB_NAME = "vj1-feature-morph-cache";
const CACHE_STORE_NAME = "pairs";
const CACHE_VERSION = 3;
const CACHE_LIMIT = 24;
let sessionPromise = null;
let inferenceQueue = Promise.resolve();
let sharedRevision = 0;
const sharedPairEntries = new Map();
const INFERENCE_TIMEOUT_MS = 60000;

export class SuperPointPairService {
  constructor({ cache = createSuperPointPersistentCache() } = {}) {
    // Control preview, output windows, and render routes can request the same
    // pair. Share one result instead of running the WASM session repeatedly.
    this.entries = sharedPairEntries;
    this.cache = cache;
  }

  pairKey(params = {}) {
    return [
      params.imageAId || "",
      params.imageBId || "",
      Math.round(Number(params.landmarkCount) || 64),
      Number(params.matchThreshold || 0.72).toFixed(3),
      Number(params.influence || 0.18).toFixed(3),
      params.fit || "cover",
    ].join(":");
  }

  externalKey(params = {}, media = {}) {
    const key = this.pairKey(params);
    const entry = this.entries.get(key);
    if (entry?.persistentKey !== featureMorphPersistentKey(key, media.imageAFile, media.imageBFile)) return "idle:0";
    return `${entry?.status || "idle"}:${entry?.revision || 0}`;
  }

  status(params = {}, media = {}) {
    const key = this.pairKey(params);
    const entry = this.entries.get(key);
    if (entry?.persistentKey !== featureMorphPersistentKey(key, media.imageAFile, media.imageBFile)) return "idle";
    return entry?.status || "idle";
  }

  request(params = {}, imageA, imageB, media = {}) {
    const key = this.pairKey(params);
    const persistentKey = featureMorphPersistentKey(key, media.imageAFile, media.imageBFile);
    let entry = this.entries.get(key);
    if (entry?.persistentKey === persistentKey) return entry;
    entry = { key, persistentKey, status: "loading", detail: "checking saved landmarks", revision: ++sharedRevision, result: null, error: "" };
    this.entries.set(key, entry);
    this.trimCache();
    withTimeout(
      this.resolvePair(params, imageA, imageB, media, (detail) => {
        entry.detail = detail;
        entry.revision = ++sharedRevision;
      }),
      INFERENCE_TIMEOUT_MS,
      "SuperPoint analysis timed out"
    )
      .then((result) => {
        entry.status = "ready";
        entry.detail = "landmarks ready";
        entry.result = result;
        entry.revision = ++sharedRevision;
      })
      .catch((error) => {
        entry.status = "error";
        entry.error = error?.message || String(error || "SuperPoint failed");
        entry.revision = ++sharedRevision;
        console.error("[VJ1_SUPERPOINT_FAILED]", error);
      });
    return entry;
  }

  async resolvePair(params, imageA, imageB, media = {}, onProgress = () => {}) {
    const persistentKey = featureMorphPersistentKey(this.pairKey(params), media.imageAFile, media.imageBFile);
    const cached = await this.cache.load(persistentKey);
    if (cached) return cached;
    const result = await this.computePair(params, imageA, imageB, onProgress);
    await this.cache.save(persistentKey, result);
    return result;
  }

  async computePair(params, imageA, imageB, onProgress = () => {}) {
    if (!imageA || !imageB) throw new Error("Choose two image sources");
    onProgress("loading SuperPoint model");
    const session = await getSession();
    const limit = Math.max(32, Math.min(512, Math.round((Number(params.landmarkCount) || 64) * 5)));
    onProgress("analyzing image A");
    const featuresA = await detectFeatures(session, imageA, limit, params.fit || "cover");
    onProgress("analyzing image B");
    const featuresB = await detectFeatures(session, imageB, limit, params.fit || "cover");
    onProgress("matching landmarks");
    const matches = matchSuperPointFeatures(featuresA, featuresB, {
      maxMatches: Math.max(8, Math.min(300, Math.round(Number(params.landmarkCount) || 64))),
      similarityThreshold: Number(params.matchThreshold) || 0.72,
    });
    if (matches.length < 4) throw new Error(`Only ${matches.length} reliable landmarks found; choose more related images`);
    return {
      matches,
      field: buildFeatureMorphField(matches, {
        influence: Number(params.influence) || 0.18,
      }),
    };
  }

  trimCache() {
    while (this.entries.size > 6) this.entries.delete(this.entries.keys().next().value);
  }
}

export function featureMorphPersistentKey(pairKey, imageAFile = {}, imageBFile = {}) {
  return [CACHE_VERSION, pairKey, fileFingerprint(imageAFile), fileFingerprint(imageBFile)].join("|");
}

export function createSuperPointPersistentCache(database = globalThis.indexedDB) {
  return {
    async load(key) {
      if (!database || !key) return null;
      try {
        const store = await openCacheStore(database, "readonly");
        const record = await idbRequest(store.get(key));
        return normalizeCachedPair(record?.result);
      } catch {
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
      } catch {}
    },
  };
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
  if (pixels.length !== Math.round(field.width) * Math.round(field.height) * Math.max(1, Math.round(field.phases) || 1) * 4) return null;
  return { matches: result.matches, field: { ...field, pixels } };
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

async function getSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await import("../../../vendor/onnxruntime/ort.wasm.min.mjs");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    ort.env.wasm.wasmPaths = new URL("../../../vendor/onnxruntime/", import.meta.url).href;
    const [modelResponse, dataResponse] = await Promise.all([fetch(MODEL_URL), fetch(MODEL_DATA_URL)]);
    if (!modelResponse.ok || !dataResponse.ok) throw new Error("Unable to load the local SuperPoint model");
    const [model, externalData] = await Promise.all([modelResponse.arrayBuffer(), dataResponse.arrayBuffer()]);
    return ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
      externalData: [{ path: "superpoint_no_borders.onnx.data", data: new Uint8Array(externalData) }],
    });
  })();
  return sessionPromise;
}

async function detectFeatures(session, image, limit, fit) {
  const ort = await import("../../../vendor/onnxruntime/ort.wasm.min.mjs");
  const input = imageTensor(image, fit);
  const tensor = new ort.Tensor("float32", input, [1, 1, INPUT_HEIGHT, INPUT_WIDTH]);
  const output = await enqueueInference(() => session.run({ image: tensor }));
  const scores = (output.scores || output.where_2)?.data;
  const descriptors = (output.descriptors_dense || output.div)?.data;
  if (!scores || !descriptors) {
    const shapeSummary = Object.entries(output)
      .map(([name, tensor]) => `${name}[${tensor?.dims?.join("x") || "?"}]`)
      .join(", ");
    throw new Error(`Unexpected SuperPoint model output: ${shapeSummary}`);
  }
  const candidates = localScoreMaxima(scores, limit);
  return candidates.map(({ x, y, score }) => ({
    x: x / (INPUT_WIDTH - 1),
    y: y / (INPUT_HEIGHT - 1),
    score,
    descriptor: sampleDescriptor(descriptors, x / 8, y / 8),
  }));
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

function imageTensor(image, fit = "cover") {
  const canvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT)
    : Object.assign(document.createElement("canvas"), { width: INPUT_WIDTH, height: INPUT_HEIGHT });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "black";
  context.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  const drawable = image.canvas || image.elt || image;
  const sourceWidth = Math.max(1, image.width || drawable.width || 1);
  const sourceHeight = Math.max(1, image.height || drawable.height || 1);
  if (fit === "stretch") {
    context.drawImage(drawable, 0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  } else {
    const scale = fit === "contain"
      ? Math.min(INPUT_WIDTH / sourceWidth, INPUT_HEIGHT / sourceHeight)
      : Math.max(INPUT_WIDTH / sourceWidth, INPUT_HEIGHT / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.drawImage(drawable, (INPUT_WIDTH - width) * 0.5, (INPUT_HEIGHT - height) * 0.5, width, height);
  }
  const rgba = context.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data;
  const grayscale = new Float32Array(INPUT_WIDTH * INPUT_HEIGHT);
  for (let index = 0; index < grayscale.length; index++) {
    const offset = index * 4;
    grayscale[index] = (rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114) / 255;
  }
  return grayscale;
}

function localScoreMaxima(scores, limit) {
  const candidates = [];
  const border = 8;
  for (let y = border; y < INPUT_HEIGHT - border; y++) {
    for (let x = border; x < INPUT_WIDTH - border; x++) {
      const index = y * INPUT_WIDTH + x;
      const score = scores[index];
      if (score < 0.005) continue;
      if (score < scores[index - 1] || score < scores[index + 1] ||
          score < scores[index - INPUT_WIDTH] || score < scores[index + INPUT_WIDTH]) continue;
      candidates.push({ x, y, score });
    }
  }
  return candidates.sort((left, right) => right.score - left.score).slice(0, limit);
}

function sampleDescriptor(data, x, y) {
  const x0 = Math.max(0, Math.min(DESCRIPTOR_WIDTH - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(DESCRIPTOR_HEIGHT - 1, Math.floor(y)));
  const x1 = Math.min(DESCRIPTOR_WIDTH - 1, x0 + 1);
  const y1 = Math.min(DESCRIPTOR_HEIGHT - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const descriptor = new Float32Array(DESCRIPTOR_SIZE);
  let norm = 0;
  for (let channel = 0; channel < DESCRIPTOR_SIZE; channel++) {
    const base = channel * DESCRIPTOR_WIDTH * DESCRIPTOR_HEIGHT;
    const top = data[base + y0 * DESCRIPTOR_WIDTH + x0] * (1 - tx) + data[base + y0 * DESCRIPTOR_WIDTH + x1] * tx;
    const bottom = data[base + y1 * DESCRIPTOR_WIDTH + x0] * (1 - tx) + data[base + y1 * DESCRIPTOR_WIDTH + x1] * tx;
    const value = top * (1 - ty) + bottom * ty;
    descriptor[channel] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;
  for (let channel = 0; channel < descriptor.length; channel++) descriptor[channel] /= norm;
  return descriptor;
}
