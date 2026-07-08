import { VJ1 } from "../constants.js";
import { sanitizeState } from "../domain/models.js";

export function loadPersistedState() {
  try {
    const raw = localStorage.getItem(VJ1.localStateKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if ((parsed.version || 0) < 3) {
      delete parsed.render;
      parsed.version = 3;
    }
    return sanitizeState(parsed);
  } catch {
    return null;
  }
}

export function persistState(state) {
  try {
    const clean = {
      ...state,
      metrics: {
        fps: state.metrics?.fps || 0,
        frameMs: state.metrics?.frameMs || 0,
        clients: state.metrics?.clients || 0,
        message: state.metrics?.message || "",
      },
    };
    localStorage.setItem(VJ1.localStateKey, JSON.stringify(clean));
  } catch {}
}
