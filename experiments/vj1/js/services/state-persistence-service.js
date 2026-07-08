import { VJ1 } from "../constants.js";

export function loadPersistedState() {
  clearPersistedState();
  return null;
}

export function persistState() {
  clearPersistedState();
}

export function clearPersistedState() {
  try {
    localStorage.removeItem(VJ1.localStateKey);
    localStorage.removeItem(VJ1.localViewKey);
  } catch {}
}
