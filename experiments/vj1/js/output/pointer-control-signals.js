export const POINTER_SIGNAL_KIND = "pointer";
const pointerDemandByState = new WeakMap();

export function projectUsesPointerSignals(state = {}) {
  if (!state || typeof state !== "object") return false;
  if (pointerDemandByState.has(state)) return pointerDemandByState.get(state);
  const usesPointer = (state.nodes?.groups || []).some((group) =>
    scopeUsesSignal(group, POINTER_SIGNAL_KIND)
  );
  pointerDemandByState.set(state, usesPointer);
  return usesPointer;
}

export function rendererUsesPointerSignals(renderer) {
  return renderer?.componentProgramRuntime?.requiresControlSignal?.(
    POINTER_SIGNAL_KIND,
  ) === true;
}

export function pointerSignalValues({
  x = 0,
  y = 0,
  width = 1,
  height = 1,
  down = false,
  inside = true,
  event = "",
} = {}) {
  const values = {
    x: clamp01(Number(x) / Math.max(1, Number(width) || 1)),
    y: clamp01(Number(y) / Math.max(1, Number(height) || 1)),
    down: down ? 1 : 0,
    inside: inside ? 1 : 0,
  };
  if (event) values[event] = 1;
  return values;
}

export function publishPointerSignals(renderer, payload = {}, meta = {}) {
  if (!rendererUsesPointerSignals(renderer)) return false;
  return renderer.controlSignalRuntime.publishBatch(
    POINTER_SIGNAL_KIND,
    pointerSignalValues(payload),
    meta,
  );
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function scopeUsesSignal(scope = {}, kind = "") {
  return (scope.nodes || []).some((node) =>
    (
      node?.role === "control" &&
      String(node.parameters?.kind || "") === kind
    ) ||
    (Array.isArray(node?.nodes) && scopeUsesSignal(node, kind))
  );
}
