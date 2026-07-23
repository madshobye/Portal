import {
  inspectProjectTextForSave,
  prepareProjectPayload,
  prepareProjectSave,
} from "./project-save-preparation.js?v=autosave-worker-2";

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
