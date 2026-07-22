import { outputSpanFitScale, worldSize } from "./render-geometry.js?v=shared-preview-viewport-1";

export function previewCanvasLogicalSize({ mode = "preview", workspace = "component", render = {} } = {}) {
  // Every embedded workspace owns the same full-stage canvas. Component,
  // Scene, Mapping, and Live differ only in what the renderer presents inside
  // that world; they must not select different host-canvas sizing rules.
  // Output windows remain a separate presentation host and never call this.
  return worldSize(render);
}

export function fitPreviewCanvasElement({ canvas, mode, workspace, stageSize, logicalSize, viewport, render }) {
  const elt = canvas?.elt || canvas;
  if (!elt) return;
  // The HTML/p5 canvas is the invariant preview viewport. Navigation belongs
  // to the final p5 presentation transform, never to CSS sizing; otherwise
  // the reported canvas geometry and visible viewport become different things.
  elt.style.position = "absolute";
  elt.style.left = "0";
  elt.style.top = "0";
  elt.style.width = "100%";
  elt.style.height = "100%";
  elt.style.transform = "none";
}

export function createPreviewViewportController({ stage, store, getMode, getViewport, onPanStart }) {
  let panDrag = null;
  const cleanup = [];
  if (!stage) return { destroy() {} };

  const add = (type, handler, options) => {
    stage.addEventListener(type, handler, options);
    cleanup.push(() => stage.removeEventListener(type, handler, options));
  };

  add("wheel", (event) => {
    if (!isNavigablePreviewMode(getMode?.())) return;
    event.preventDefault();
    const factor = Math.pow(1.0025, -event.deltaY);
    const rect = stage.getBoundingClientRect?.() || {};
    const anchor = {
      x: event.clientX - (Number(rect.left) || 0),
      y: event.clientY - (Number(rect.top) || 0),
      centerX: (Number(rect.width) || stage.clientWidth || 1) * 0.5,
      centerY: (Number(rect.height) || stage.clientHeight || 1) * 0.5,
    };
    const displayedViewport = getViewport?.() || {};
    updateStoredUi(store, (ui) => {
      updatePreviewViewportForUi(ui, (viewport) => zoomViewport(
        viewport.fit === "manual" ? viewport : displayedViewport,
        factor,
        anchor
      ));
    }, "preview-zoom");
  }, { passive: false });

  add("pointerdown", (event) => {
    if (!isNavigablePreviewMode(getMode?.()) || !isPreviewPanGesture(event)) return;
    event.preventDefault();
    onPanStart?.();
    const viewport = getViewport?.() || {};
    panDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
    };
    stage.setPointerCapture?.(event.pointerId);
  }, true);

  add("pointermove", (event) => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateStoredUi(store, (ui) => {
      updatePreviewViewportForUi(ui, (viewport) => ({
        ...viewport,
        fit: "manual",
        x: panDrag.x + event.clientX - panDrag.startX,
        y: panDrag.y + event.clientY - panDrag.startY,
      }));
    }, "preview-pan");
  }, true);

  const endPan = (event) => {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return;
    panDrag = null;
    stage.releasePointerCapture?.(event.pointerId);
  };
  add("pointerup", endPan, true);
  add("pointercancel", endPan, true);

  return {
    destroy() {
      cleanup.splice(0).forEach((fn) => fn());
      panDrag = null;
    },
  };
}

export function isPreviewPanGesture(event = {}) {
  return event.shiftKey === true || event.altKey === true || Number(event.button) === 1;
}

function updateStoredUi(store, recipe, reason) {
  if (typeof store?.updateUi === "function") {
    store.updateUi(recipe, reason);
    return;
  }
  store?.update?.((draft) => recipe(draft.ui), reason);
}

export function previewViewportKey(workspace = "component") {
  return ["component", "scene", "mapping", "live"].includes(workspace) ? workspace : "component";
}

export function previewViewportForUi(ui = {}) {
  const key = previewViewportKey(ui.workspace);
  return ui.previewViewports?.[key] || resetViewport();
}

export function updatePreviewViewportForUi(ui = {}, update) {
  const key = previewViewportKey(ui.workspace);
  const current = previewViewportForUi(ui);
  const next = typeof update === "function" ? update(current) : update;
  ui.previewViewports ||= {};
  ui.previewViewports[key] = next || current;
  return ui.previewViewports[key];
}

function isNavigablePreviewMode(mode) {
  return mode !== "output";
}

export function zoomViewport(viewport = {}, multiplier = 1, anchor = null) {
  const current = clampNumber(viewport.zoom, 0.1, 6, 1);
  const zoom = clampNumber(current * multiplier, 0.1, 6, 1);
  const ratio = zoom / current;
  const currentX = Number(viewport.x) || 0;
  const currentY = Number(viewport.y) || 0;
  const anchorX = Number(anchor?.x);
  const anchorY = Number(anchor?.y);
  const centerX = Number(anchor?.centerX);
  const centerY = Number(anchor?.centerY);
  const anchored = [anchorX, anchorY, centerX, centerY].every(Number.isFinite);
  return {
    ...viewport,
    fit: "manual",
    zoom,
    x: anchored ? currentX + (anchorX - centerX - currentX) * (1 - ratio) : currentX,
    y: anchored ? currentY + (anchorY - centerY - currentY) * (1 - ratio) : currentY,
  };
}

export function resetViewport() {
  return { zoom: 1, x: 0, y: 0, fit: "world" };
}

export function fitPreviewViewport({ workspace = "component", stageSize, render }) {
  // An ordinary Component is already contained directly in the full-stage
  // canvas, so its natural frame fit is 1:1. Scene, Mapping, and Live fit the
  // inset authored Output span within that same project world.
  if (workspace === "component") return { zoom: 1, x: 0, y: 0, fit: "frame" };
  return {
    zoom: clampNumber(outputSpanFitScale({
      ...(render || {}),
      hostViewport: {
        width: Math.max(1, Number(stageSize?.width) || worldSize(render).width),
        height: Math.max(1, Number(stageSize?.height) || worldSize(render).height),
        mode: "preview",
        outputId: "",
      },
    }), 0.1, 6, 1),
    x: 0,
    y: 0,
    fit: "frame",
  };
}

export function resolveViewportForFit({ mode, workspace = "component", stageSize, viewport = {}, render = {} }) {
  if (mode !== "output" && viewport.fit === "frame") {
    return fitPreviewViewport({ workspace, stageSize, render });
  }
  if (mode !== "output" && viewport.fit === "world") {
    return { ...viewport, zoom: 1, x: 0, y: 0 };
  }
  return viewport;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
