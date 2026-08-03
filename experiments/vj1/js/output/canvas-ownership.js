const CANVAS_OWNER_ATTRIBUTE = "data-vj1-canvas-owner";
const CANVAS_KIND_ATTRIBUTE = "data-vj1-canvas-kind";

export function claimPresentationCanvas(canvasHandle, {
  ownerId,
  host = null,
} = {}) {
  const canvas = canvasHandle?.elt || canvasHandle?.canvas || canvasHandle;
  const owner = String(ownerId || "presentation");
  if (!canvas || String(canvas.tagName || "").toLowerCase() !== "canvas") {
    throw new TypeError(`VJ1_PRESENTATION_CANVAS_REQUIRED:${owner}`);
  }
  claimCanvas(canvas, { ownerId: owner, kind: "presentation" });
  canvas.id = `vj1-${domId(owner)}-presentation-canvas`;

  // p5 WebGL may attach a tiny internal canvas beside the presentation
  // element. Keep it explicit in lifecycle diagnostics without treating it as
  // another presentation or full-resolution render allocation.
  for (const candidate of host?.querySelectorAll?.("canvas") || []) {
    if (candidate === canvas || canvasOwner(candidate)) continue;
    if (Number(candidate.width) <= 1 && Number(candidate.height) <= 1) {
      claimCanvas(candidate, { ownerId: owner, kind: "p5-auxiliary" });
    }
  }
  return canvas;
}

export function claimCanvas(canvas, { ownerId, kind = "resource" } = {}) {
  if (!canvas) return null;
  const owner = String(ownerId || "unassigned");
  canvas.dataset ||= {};
  canvas.dataset.vj1CanvasOwner = owner;
  canvas.dataset.vj1CanvasKind = String(kind || "resource");
  canvas.setAttribute?.(CANVAS_OWNER_ATTRIBUTE, owner);
  canvas.setAttribute?.(CANVAS_KIND_ATTRIBUTE, String(kind || "resource"));
  return canvas;
}

export function canvasOwnershipSnapshot(root = globalThis.document) {
  return Object.freeze(Array.from(root?.querySelectorAll?.("canvas") || [], (canvas) => Object.freeze({
    id: String(canvas.id || ""),
    ownerId: canvasOwner(canvas),
    kind: canvasKind(canvas),
    width: Math.max(0, Number(canvas.width) || 0),
    height: Math.max(0, Number(canvas.height) || 0),
    connected: canvas.isConnected !== false,
  })));
}

export function assertCanvasOwnership(root = globalThis.document, ownerId = "") {
  const snapshot = canvasOwnershipSnapshot(root);
  const owner = String(ownerId || "");
  const presentations = snapshot.filter((entry) =>
    entry.kind === "presentation" && (!owner || entry.ownerId === owner)
  );
  if (presentations.length !== 1) {
    throw new Error(`VJ1_PRESENTATION_CANVAS_COUNT:${owner || "any"}:${presentations.length}`);
  }
  const unexplainedFullResolution = snapshot.filter((entry) =>
    !entry.ownerId && entry.width > 1 && entry.height > 1
  );
  if (unexplainedFullResolution.length) {
    throw new Error(`VJ1_CANVAS_OWNER_MISSING:${unexplainedFullResolution.length}`);
  }
  return snapshot;
}

export function publishCanvasOwnershipDiagnostics(root = globalThis.document, ownerId = "") {
  for (const canvas of root?.querySelectorAll?.("canvas") || []) {
    if (canvasOwner(canvas)) continue;
    if (Number(canvas.width) <= 1 && Number(canvas.height) <= 1) {
      claimCanvas(canvas, {
        ownerId: String(ownerId || "presentation"),
        kind: "runtime-auxiliary",
      });
    }
  }
  const snapshot = assertCanvasOwnership(root, ownerId);
  globalThis.__vj1CanvasOwnership = snapshot;
  return snapshot;
}

function canvasOwner(canvas) {
  return String(
    canvas?.dataset?.vj1CanvasOwner ||
    canvas?.getAttribute?.(CANVAS_OWNER_ATTRIBUTE) ||
    ""
  );
}

function canvasKind(canvas) {
  return String(
    canvas?.dataset?.vj1CanvasKind ||
    canvas?.getAttribute?.(CANVAS_KIND_ATTRIBUTE) ||
    ""
  );
}

function domId(value) {
  return String(value || "canvas")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "canvas";
}
