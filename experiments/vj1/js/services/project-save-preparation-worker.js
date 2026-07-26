import {
  inspectProjectTextForSave,
  prepareProjectPayload,
  prepareProjectSave,
} from "./project-save-preparation.js?v=project-save-worker-ready-1";

globalThis.onmessage = (event) => {
  const request = event?.data || {};
  try {
    let result;
    if (request.kind === "prepare-state") result = prepareProjectSave(request.state, request.savedAt);
    else if (request.kind === "prepare-payload") result = prepareProjectPayload(request.payload);
    else if (request.kind === "inspect-text") result = inspectProjectTextForSave(request.text);
    else throw new Error(`VJ1_PROJECT_SAVE_PREPARATION_UNKNOWN:${request.kind || "missing"}`);
    globalThis.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    globalThis.postMessage({
      id: request.id,
      ok: false,
      message: error?.message || String(error),
    });
  }
};

// Module workers may spend time loading their dependency graph before this
// handler exists. The host must not send save work until this message arrives:
// an early DedicatedWorker message is not reliably replayed by Chrome.
globalThis.postMessage({ type: "ready" });
