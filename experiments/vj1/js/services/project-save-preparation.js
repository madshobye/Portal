import { buildProjectPayload } from "./project-serializer.js?v=project-media-contain-1";
import { projectHistorySignature } from "./project-history-policy.js?v=project-storage-1";

export function prepareProjectSave(state, savedAt = new Date().toISOString()) {
  return prepareProjectPayload(buildProjectPayload(state, savedAt));
}

export function prepareProjectPayload(payload = {}) {
  const savedAt = String(payload?.project?.savedAt || "");
  return Object.freeze({
    savedAt,
    json: JSON.stringify(payload, null, 2),
    signature: projectPayloadSignature(payload),
    historySignature: projectHistorySignature(payload),
  });
}

export function inspectProjectTextForSave(text = "") {
  try {
    const payload = JSON.parse(String(text || ""));
    return Object.freeze({
      valid: true,
      historySignature: projectHistorySignature(payload),
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      historySignature: "",
      message: error?.message || String(error),
    });
  }
}

export function projectPayloadSignature(payload = {}) {
  return JSON.stringify({
    ...payload,
    project: { ...payload.project, savedAt: "" },
  });
}

export function createProjectSavePreparer({
  WorkerClass = globalThis.Worker,
  workerUrl = new URL("./project-save-preparation-worker.js?v=autosave-worker-timeout-1", import.meta.url),
  onFallback = defaultFallbackWarning,
  requestTimeoutMs = 5000,
} = {}) {
  let worker = null;
  let nextRequestId = 0;
  let fallbackReported = false;
  const pending = new Map();

  function reportFallback(error) {
    if (fallbackReported) return;
    fallbackReported = true;
    onFallback?.(error);
  }

  function local(task) {
    if (task.kind === "prepare-state") return prepareProjectSave(task.state, task.savedAt);
    if (task.kind === "prepare-payload") return prepareProjectPayload(task.payload);
    if (task.kind === "inspect-text") return inspectProjectTextForSave(task.text);
    throw new Error(`VJ1_PROJECT_SAVE_PREPARATION_UNKNOWN:${task.kind || "missing"}`);
  }

  function retireWorker(error) {
    const active = worker;
    worker = null;
    try { active?.terminate?.(); } catch {}
    reportFallback(error);
    for (const request of pending.values()) {
      clearTimeout(request.timeoutId);
      try {
        request.resolve(local(request.task));
      } catch (fallbackError) {
        request.reject(fallbackError);
      }
    }
    pending.clear();
  }

  function ensureWorker() {
    if (worker || typeof WorkerClass !== "function") return worker;
    try {
      worker = new WorkerClass(workerUrl, {
        type: "module",
        name: "vj1-project-save-preparation",
      });
      worker.onmessage = (event) => {
        const response = event?.data || {};
        const request = pending.get(response.id);
        if (!request) return;
        pending.delete(response.id);
        clearTimeout(request.timeoutId);
        if (response.ok) request.resolve(response.result);
        else request.reject(new Error(response.message || "VJ1_PROJECT_SAVE_PREPARATION_FAILED"));
      };
      worker.onerror = (event) => retireWorker(event?.error || new Error(event?.message || "project save worker failed"));
      worker.onmessageerror = () => retireWorker(new Error("project save worker returned an unreadable response"));
    } catch (error) {
      worker = null;
      reportFallback(error);
    }
    return worker;
  }

  function request(task) {
    const active = ensureWorker();
    if (!active) {
      if (typeof WorkerClass !== "function") reportFallback(new Error("Web Worker unavailable"));
      return Promise.resolve().then(() => local(task));
    }
    const id = ++nextRequestId;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending.has(id)) return;
        retireWorker(new Error(`VJ1_PROJECT_SAVE_PREPARATION_TIMEOUT:${Math.max(0, Number(requestTimeoutMs) || 0)}`));
      }, Math.max(0, Number(requestTimeoutMs) || 0));
      pending.set(id, { resolve, reject, task, timeoutId });
      try {
        active.postMessage({ id, ...task });
      } catch (error) {
        const request = pending.get(id);
        pending.delete(id);
        clearTimeout(request?.timeoutId);
        reportFallback(error);
        try {
          resolve(local(task));
        } catch (fallbackError) {
          reject(fallbackError);
        }
      }
    });
  }

  return Object.freeze({
    prepareState: (state, savedAt) => request({ kind: "prepare-state", state, savedAt }),
    preparePayload: (payload) => request({ kind: "prepare-payload", payload }),
    inspectText: (text) => request({ kind: "inspect-text", text }),
    dispose() {
      const error = new Error("project save preparer disposed");
      for (const request of pending.values()) {
        clearTimeout(request.timeoutId);
        request.reject(error);
      }
      pending.clear();
      try { worker?.terminate?.(); } catch {}
      worker = null;
    },
  });
}

function defaultFallbackWarning(error) {
  console.warn("[VJ1_AUTOSAVE_WORKER_UNAVAILABLE]", {
    fallback: "prepare project saves on the main thread",
    message: error?.message || String(error || "Web Worker unavailable"),
  });
}
