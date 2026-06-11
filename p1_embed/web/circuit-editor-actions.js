import {
  circuitComponentPin,
  circuitComponentPlacementKey,
  componentDisplayName,
  normalizeCircuitBoardType,
  persistGeneratedCircuitLayoutPositions,
  stripCircuitPlacementComments,
  upsertCircuitBoardPlacementComment,
  upsertCircuitHintComment,
  upsertCircuitPlacementComment,
  upsertCircuitViewportComment,
} from "./circuit-code-comments.js?v=0.1.87-ui559";

import { product } from "./app-config.js?v=0.1.87-ui747";

export function createCircuitEditorActions({
  getCode,
  setCode,
  inferLayout,
  setBoardType,
  onCircuitLayoutInvalidated,
  updateCircuitView,
  logLine,
} = {}) {
  function invalidateLayout() {
    onCircuitLayoutInvalidated?.();
  }

  function applyComponentOverride({ component, type, label } = {}) {
    const pin = circuitComponentPin(component);
    if (!pin || !type) return;
    const hint = `// ${product.circuitCommentPrefix}: IO${pin} ${type}`;
    const current = getCode();
    const next = upsertCircuitHintComment(current, pin, hint);
    if (next === current) return;
    setCode(next);
    invalidateLayout();
    updateCircuitView(`${label || type} hint saved`);
    logLine("info", `circuit hint saved: IO${pin} ${type}`);
  }

  function applyComponentPlacement({ component, side, x, y } = {}) {
    const key = circuitComponentPlacementKey(component);
    if (!key || (side !== "left" && side !== "right") || !Number.isFinite(y)) return;
    const type = component?.type || "unknown";
    const current = getCode();
    const next = upsertCircuitPlacementComment(current, key, type, side, x, y);
    if (next === current) return;
    setCode(next);
    invalidateLayout();
    updateCircuitView(`${componentDisplayName(component)} placement saved`);
    logLine("info", `circuit placement saved: ${key} ${side} ${Math.round(y)}%`);
  }

  function applyBoardPlacement({ type, cx, cy } = {}) {
    const boardType = normalizeCircuitBoardType(type);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const current = getCode();
    const next = upsertCircuitBoardPlacementComment(current, boardType, cx, cy);
    if (next === current) return;
    setCode(next);
    setBoardType(boardType, { persist: true, updateCode: false });
    invalidateLayout();
    updateCircuitView("board placement saved");
    logLine("info", `circuit board placement saved: ${boardType} ${Math.round(cx)}%, ${Math.round(cy)}%`);
  }

  function applyViewportPlacement({ zoom, panX, panY } = {}) {
    if (!Number.isFinite(zoom) || !Number.isFinite(panX) || !Number.isFinite(panY)) return;
    const current = getCode();
    const next = upsertCircuitViewportComment(current, zoom, panX, panY);
    if (next === current) return;
    setCode(next);
    invalidateLayout();
  }

  function resetLayoutPositions() {
    const current = getCode();
    const cleaned = stripCircuitPlacementComments(current);
    invalidateLayout();
    const model = inferLayout(cleaned, null);
    const next = persistGeneratedCircuitLayoutPositions(cleaned, model);
    setCode(next);
    updateCircuitView("positions regenerated");
    logLine("info", "circuit positions regenerated and saved to code");
  }

  return {
    applyBoardPlacement,
    applyComponentOverride,
    applyComponentPlacement,
    applyViewportPlacement,
    resetLayoutPositions,
  };
}
