import { UI_STATE_LIFETIMES } from "./ui-node.js";

// One scroll contract for every retained UI node. Positions are committed on
// the scroll event itself so a same-frame reconciliation cannot restore stale
// state. Delayed mount restoration is cancelled as soon as the user interacts.
export function createRetainedScrollController({
  state,
  address,
  lifetime = UI_STATE_LIFETIMES.SESSION,
  window = globalThis,
} = {}) {
  if (!state || !address) throw new Error("UI_SCROLL_STATE_REQUIRED");
  let element = null;
  let restoreFrames = [];
  let lastPosition = normalizeScrollPosition(state.get(address, { top: 0, left: 0 }, lifetime));

  function attach(nextElement, { restore = true } = {}) {
    if (!nextElement) throw new Error("UI_SCROLL_ELEMENT_REQUIRED");
    if (element === nextElement) return;
    if (element) detach({ persist: true });
    element = nextElement;
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onUserIntent, { passive: true, capture: true });
    element.addEventListener("touchstart", onUserIntent, { passive: true, capture: true });
    element.addEventListener("pointerdown", onUserIntent, { passive: true, capture: true });
    element.addEventListener("keydown", onUserIntent, true);
    if (restore) restoreFromState();
  }

  function detach({ persist = true } = {}) {
    if (!element) return;
    cancelRestore();
    if (persist) commit(lastPosition);
    element.removeEventListener("scroll", onScroll);
    element.removeEventListener("wheel", onUserIntent, true);
    element.removeEventListener("touchstart", onUserIntent, true);
    element.removeEventListener("pointerdown", onUserIntent, true);
    element.removeEventListener("keydown", onUserIntent, true);
    element = null;
  }

  function onScroll() {
    // This must remain synchronous. Retained graphs may reconcile again before
    // the next animation frame, and that new instance needs the latest value.
    commit();
  }

  function onUserIntent() {
    cancelRestore();
    // Selection commands commonly dispatch on pointerdown. Capture before that
    // command can reconcile or detach the current list hierarchy.
    commit(current());
  }

  function current() {
    return normalizeScrollPosition(element ? {
      top: element.scrollTop,
      left: element.scrollLeft,
    } : {});
  }

  function commit(position = current()) {
    if (!element) return position;
    const normalized = normalizeScrollPosition(position);
    lastPosition = normalized;
    state.set(address, normalized, lifetime);
    return normalized;
  }

  function restore(position = state.get(address, { top: 0, left: 0 }, lifetime), { retry = false } = {}) {
    if (!element) return;
    cancelRestore();
    const normalized = normalizeScrollPosition(position);
    lastPosition = normalized;
    apply(normalized);
    if (!retry) return;
    scheduleRestore(normalized);
  }

  function restoreFromState() {
    restore(state.get(address, { top: 0, left: 0 }, lifetime), { retry: true });
  }

  function scheduleRestore(position) {
    const schedule = window?.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 0));
    const first = schedule(() => {
      restoreFrames = restoreFrames.filter((frame) => frame !== first);
      if (!element) return;
      apply(position);
      const second = schedule(() => {
        restoreFrames = restoreFrames.filter((frame) => frame !== second);
        if (element) apply(position);
      });
      restoreFrames.push(second);
    });
    restoreFrames.push(first);
  }

  function apply(position) {
    if (!element) return;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  }

  function cancelRestore() {
    const cancel = window?.cancelAnimationFrame || globalThis.clearTimeout;
    for (const frame of restoreFrames) cancel?.(frame);
    restoreFrames = [];
  }

  function dispose() {
    detach({ persist: true });
  }

  return Object.freeze({ attach, detach, current, commit, restore, restoreFromState, cancelRestore, dispose });
}

export function normalizeScrollPosition(position = {}) {
  return Object.freeze({
    top: Math.max(0, Number(position?.top) || 0),
    left: Math.max(0, Number(position?.left) || 0),
  });
}
