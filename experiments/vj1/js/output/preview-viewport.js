import { fittedCssRect, frameSize, outputFrames, worldSize } from "./render-geometry.js?v=adaptive-component-demand-18";

export function fitPreviewCanvasElement({ canvas, mode, stageSize, logicalSize, viewport, render }) {
  const elt = canvas?.elt || canvas;
  if (!elt) return;
  const canNavigate = isNavigablePreviewMode(mode);
  const resolvedViewport = resolveViewportForFit({ mode, stageSize, viewport, render });
  const zoom = canNavigate ? clampNumber(resolvedViewport?.zoom, 0.1, 6, 1) : 1;
  const pan = canNavigate ? resolvedViewport : {};
  const rect = fittedCssRect(stageSize, logicalSize, zoom, pan);
  elt.style.position = "absolute";
  elt.style.left = "50%";
  elt.style.top = "50%";
  elt.style.width = `${rect.width}px`;
  elt.style.height = `${rect.height}px`;
  elt.style.transform = `translate(${Number(pan?.x) || 0}px, ${Number(pan?.y) || 0}px) translate(-50%, -50%)`;
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
    store.update((draft) => {
      draft.ui.previewViewport = zoomViewport(draft.ui.previewViewport, factor);
    }, "scrub:preview-zoom");
  }, { passive: false });

  add("pointerdown", (event) => {
    if (!isNavigablePreviewMode(getMode?.()) || (!event.altKey && event.button !== 1)) return;
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
    store.update((draft) => {
      draft.ui.previewViewport = {
        ...(draft.ui.previewViewport || {}),
        fit: "manual",
        x: panDrag.x + event.clientX - panDrag.startX,
        y: panDrag.y + event.clientY - panDrag.startY,
      };
    }, "scrub:preview-pan");
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

function isNavigablePreviewMode(mode) {
  return mode === "preview" || mode === "component";
}

export function zoomViewport(viewport = {}, multiplier = 1) {
  const current = clampNumber(viewport.zoom, 0.1, 6, 1);
  return {
    ...viewport,
    fit: "manual",
    zoom: clampNumber(current * multiplier, 0.1, 6, 1),
  };
}

export function resetViewport() {
  return { zoom: 1, x: 0, y: 0, fit: "world" };
}

export function frameFitViewport({ stageSize, render }) {
  const frames = outputFrames(render);
  const frame = frames.length ? {
    width: Math.max(...frames.map((item) => item.x + item.width)) - Math.min(...frames.map((item) => item.x)),
    height: Math.max(...frames.map((item) => item.y + item.height)) - Math.min(...frames.map((item) => item.y)),
  } : frameSize(render);
  const world = worldSize(render);
  const stage = {
    width: Math.max(1, Number(stageSize?.width) || frame.width),
    height: Math.max(1, Number(stageSize?.height) || frame.height),
  };
  const worldFit = fittedCssRect(stage, world, 1);
  const frameFit = fittedCssRect(stage, frame, 1);
  return {
    zoom: clampNumber(frameFit.scale / Math.max(0.0001, worldFit.scale), 0.1, 6, 1),
    x: 0,
    y: 0,
    fit: "frame",
  };
}

export function resolveViewportForFit({ mode, stageSize, viewport = {}, render = {} }) {
  if (viewport.fit !== "manual" && mode === "component") {
    return { ...viewport, zoom: 1, x: 0, y: 0 };
  }
  if (mode === "preview" && viewport.fit === "frame") {
    return frameFitViewport({ stageSize, render });
  }
  if (mode === "preview" && viewport.fit === "world") {
    return { ...viewport, zoom: 1, x: 0, y: 0 };
  }
  return viewport;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
