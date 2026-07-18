import { parseObjMesh, parseStlMesh } from "./model-parsers.js?v=model-lod-1";
import { attachLegacyTriangleView, buildAutomaticModelLods } from "./model-lod.js?v=model-lod-1";

let worker = null;
let requestSerial = 0;
const pending = new Map();
let fallbackLogged = false;

export function processStlModelBuffer(buffer, options = {}) {
  return processModel({ type: "stl", buffer, levels: options.levels });
}

export function processObjModelText(text, options = {}) {
  return processModel({ type: "obj", text: String(text || ""), levels: options.levels });
}

function processModel(payload) {
  const runtimeWorker = ensureWorker();
  if (!runtimeWorker) {
    if (!fallbackLogged) {
      fallbackLogged = true;
      console.warn("[VJ1_MODEL_WORKER_FALLBACK]", { message: "Web Worker unavailable; model processing will use the main thread" });
    }
    return Promise.resolve().then(() => buildAutomaticModelLods(
      payload.type === "obj" ? parseObjMesh(payload.text) : parseStlMesh(payload.buffer),
      payload.levels
    ));
  }
  const requestId = ++requestSerial;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    if (payload.buffer instanceof ArrayBuffer) runtimeWorker.postMessage({ requestId, ...payload }, [payload.buffer]);
    else runtimeWorker.postMessage({ requestId, ...payload });
  });
}

function ensureWorker() {
  if (worker) return worker;
  if (typeof Worker !== "function") return null;
  try {
    worker = new Worker(new URL("./model-processing-worker.js?v=model-lod-1", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => {
      const { requestId, mesh, error } = event.data || {};
      const request = pending.get(requestId);
      if (!request) return;
      pending.delete(requestId);
      if (error) request.reject(new Error(error));
      else {
        for (const lod of mesh?.lods || [mesh]) attachLegacyTriangleView(lod);
        request.resolve(attachLegacyTriangleView(mesh));
      }
    });
    worker.addEventListener("error", (event) => {
      console.error("[VJ1_MODEL_WORKER_FAILED]", { message: event?.message || "model worker failed" });
      for (const request of pending.values()) request.reject(new Error(event?.message || "model worker failed"));
      pending.clear();
      worker?.terminate?.();
      worker = null;
    });
    return worker;
  } catch (error) {
    console.error("[VJ1_MODEL_WORKER_FAILED]", { message: error?.message || String(error) });
    worker = null;
    return null;
  }
}
