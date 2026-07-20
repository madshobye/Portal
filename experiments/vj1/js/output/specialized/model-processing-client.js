import { attachLegacyTriangleView } from "../../libraries/mesh-engine/mesh-types.js";
import { prepare3dAsset } from "../../libraries/mesh-engine/prepare-3d-asset/index.js";
import {
  modelDerivedCacheKey,
  readDerivedModelCache,
  writeDerivedModelCache,
} from "./model-derived-cache.js?v=model-wire-detail-2";

let worker = null;
let requestSerial = 0;
const pending = new Map();
const inFlightByCacheKey = new Map();
let fallbackLogged = false;
const MODEL_PROCESSING_BASE_SLOW_MS = 120_000;
const MODEL_PROCESSING_MAX_SLOW_MS = 600_000;

export function processStlModelBuffer(buffer, options = {}) {
  return processModel({ type: "stl", buffer, levels: options.levels, cacheSourceKey: options.cacheKey });
}

export function processObjModelText(text, options = {}) {
  return processModel({ type: "obj", text: String(text || ""), levels: options.levels, cacheSourceKey: options.cacheKey });
}

export function processObjModelBuffer(buffer, options = {}) {
  return processModel({ type: "obj", buffer, levels: options.levels, cacheSourceKey: options.cacheKey });
}

function processModel(payload) {
  const cacheKey = payload.cacheSourceKey ? modelDerivedCacheKey({
    type: payload.type,
    sourceKey: payload.cacheSourceKey,
    levels: payload.levels,
  }) : "";
  if (!cacheKey) return processModelUncached(payload);
  const existing = inFlightByCacheKey.get(cacheKey);
  if (existing) return existing;
  const promise = processModelWithCache(payload, cacheKey);
  inFlightByCacheKey.set(cacheKey, promise);
  const release = () => {
    if (inFlightByCacheKey.get(cacheKey) === promise) inFlightByCacheKey.delete(cacheKey);
  };
  promise.then(release, release);
  return promise;
}

async function processModelWithCache(payload, cacheKey) {
  const cached = await readDerivedModelCache(cacheKey);
  if (cached) return attachMeshViews(cached);
  console.info("[VJ1_MODEL_CACHE_MISS]", {
    cacheKey,
    message: "No derived model cache exists yet; processing continues in the model worker",
  });
  const mesh = await processModelUncached(payload);
  void writeDerivedModelCache(cacheKey, mesh);
  return mesh;
}

function processModelUncached(payload) {
  const runtimeWorker = ensureWorker();
  if (!runtimeWorker) {
    if (!fallbackLogged) {
      fallbackLogged = true;
      console.warn("[VJ1_MODEL_WORKER_FALLBACK]", { message: "Web Worker unavailable; model processing will use the main thread" });
    }
    return Promise.resolve().then(async () => (await prepare3dAsset({
      source: payload.type === "obj" ? (payload.text ?? payload.buffer) : payload.buffer,
      format: payload.type,
      resolution: "automatic",
      levels: payload.levels,
    })).mesh);
  }
  const requestId = ++requestSerial;
  const requestType = payload.type;
  const slowAfterMs = modelProcessingSlowAfterMs(payload);
  return new Promise((resolve, reject) => {
    const slowWarning = setTimeout(() => {
      if (!pending.has(requestId)) return;
      console.warn("[VJ1_MODEL_PROCESSING_SLOW]", {
        requestId,
        type: requestType,
        elapsedMs: slowAfterMs,
        message: "Model processing is slow but still active; the requested model will continue processing",
      });
    }, slowAfterMs);
    pending.set(requestId, { resolve, reject, slowWarning });
    if (payload.buffer instanceof ArrayBuffer) runtimeWorker.postMessage({ requestId, ...payload }, [payload.buffer]);
    else runtimeWorker.postMessage({ requestId, ...payload });
  });
}

function modelProcessingSlowAfterMs(payload = {}) {
  const sourceBytes = payload.buffer instanceof ArrayBuffer
    ? payload.buffer.byteLength
    : String(payload.text || "").length * 2;
  // Parsing and welding large OBJ text is proportional to source bytes. It
  // runs off-thread, so allowing additional time is safer than converting a
  // slow but healthy import into a failed user command.
  return Math.min(
    MODEL_PROCESSING_MAX_SLOW_MS,
    MODEL_PROCESSING_BASE_SLOW_MS + Math.max(0, sourceBytes) * 4
  );
}

function ensureWorker() {
  if (worker) return worker;
  if (typeof Worker !== "function") return null;
  try {
    worker = new Worker(new URL("./model-processing-worker.js?v=model-wire-detail-2", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => {
      const { requestId, mesh, error } = event.data || {};
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      clearTimeout(request.slowWarning);
      if (error) request.reject(new Error(error));
      else request.resolve(attachMeshViews(mesh));
      releaseWorkerHeapWhenIdle();
    });
    worker.addEventListener("error", (event) => {
      const error = new Error(event?.message || "model worker failed");
      console.error("[VJ1_MODEL_WORKER_FAILED]", { message: error.message });
      failWorker(error);
    });
    return worker;
  } catch (error) {
    console.error("[VJ1_MODEL_WORKER_FAILED]", { message: error?.message || String(error) });
    worker = null;
    return null;
  }
}

function attachMeshViews(mesh) {
  for (const lod of mesh?.lods || [mesh]) attachLegacyTriangleView(lod);
  return attachLegacyTriangleView(mesh);
}

function failWorker(error) {
  for (const request of pending.values()) {
    clearTimeout(request.slowWarning);
    request.reject(error);
  }
  pending.clear();
  worker?.terminate?.();
  worker = null;
}

function releaseWorkerHeapWhenIdle() {
  if (pending.size || !worker) return;
  const completedWorker = worker;
  queueMicrotask(() => {
    if (worker !== completedWorker || pending.size) return;
    completedWorker.terminate();
    worker = null;
  });
}
