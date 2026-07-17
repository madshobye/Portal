import { clone, createSceneSurfaceSnapshot, syncLiveSnapshotFromScene, uid } from "./models.js?v=render-coordinate-scope-3";
import { componentFrameMetrics } from "./component-frame.js?v=adaptive-component-demand-29";
import { insertChainItemNearSelection } from "./chain-operations.js?v=adaptive-component-demand-29";

export const VJ1_CLIPBOARD_TYPE = "application/x-vj1-item";

export function clipboardPayloadForTarget(state = {}, target = {}) {
  if (target.kind === "component-list" || target.kind === "canvas-list") {
    const value = state.components?.find((item) => item.id === target.itemId);
    return value ? { kind: "component", value: clone(value) } : null;
  }
  if (target.kind === "chain-item") {
    const component = state.components?.find((item) => item.id === target.componentId);
    const value = findChainItem(component?.chain, target.itemId);
    return value ? { kind: "chain-item", value: clone(value) } : null;
  }
  if (target.kind === "scene-list") {
    const value = state.scenes?.find((item) => item.id === target.itemId);
    return value ? { kind: "scene", value: clone(value) } : null;
  }
  if (target.kind === "surface-list") {
    const value = state.surfaces?.find((item) => item.id === target.itemId && item.destination?.type !== "direct");
    return value ? { kind: "surface", value: clone(value) } : null;
  }
  if (target.kind === "media-item") {
    const value = state.media?.find((item) => item.id === target.itemId);
    return value ? { kind: "media", value: clone(value) } : null;
  }
  return null;
}

export function pasteClipboardPayload(draft = {}, payload = {}, target = {}) {
  if (!payload?.kind || !payload.value) return { pasted: false, reason: "empty" };
  if (payload.kind === "component") return pasteComponent(draft, payload.value, target);
  if (payload.kind === "chain-item") return pasteChainItem(draft, payload.value, target);
  if (payload.kind === "scene") return pasteScene(draft, payload.value, target);
  if (payload.kind === "surface") return pasteSurface(draft, payload.value, target);
  if (payload.kind === "media") return pasteMedia(draft, payload.value, target);
  return { pasted: false, reason: "unsupported" };
}

export function chainPasteTarget(state = {}, componentId = "", selectedItemId = "") {
  const component = state.components?.find((item) => item.id === componentId);
  if (!component) return { kind: "media-library" };
  const selected = findChainItem(component.chain, selectedItemId);
  return {
    kind: selected?.kind === "group" ? "group" : "chain",
    componentId: component.id,
    itemId: selected?.id || "",
  };
}

function pasteComponent(draft, source, target) {
  if (source.type !== "canvas" && target.kind === "canvas-list" && target.itemId) {
    target = { kind: "chain", componentId: target.itemId, itemId: "" };
  }
  if ((target.kind === "chain" || target.kind === "group") && source.type !== "canvas") {
    const component = targetComponent(draft, target);
    if (component?.type !== "canvas") return { pasted: false, reason: "components-only-in-canvas" };
    return insertIntoTarget(draft, target, createComponentReferenceLayer(draft, component, source));
  }
  if (target.kind !== "component-list" && target.kind !== "canvas-list") return { pasted: false, reason: "wrong-target" };
  if ((source.type === "canvas") !== (target.kind === "canvas-list")) return { pasted: false, reason: "wrong-list" };
  const copy = clone(source);
  copy.id = uid("component");
  copy.name = uniqueCopyName(source.name || (source.type === "canvas" ? "Canvas" : "Component"), draft.components || []);
  copy.thumbnail = "";
  delete copy.activity;
  copy.chain = (copy.chain || []).map(regenerateChainItemIds);
  if (copy.canvas) copy.canvas.frameThumbnails = {};
  draft.components ||= [];
  draft.components.push(copy);
  draft.ui.selectedComponentId = copy.id;
  draft.ui.selectedChainItemId = copy.chain?.[0]?.id || "";
  draft.ui.workspaceSelectionIds ||= { component: "", canvas: "" };
  draft.ui.workspaceSelectionIds[copy.type === "canvas" ? "canvas" : "component"] = copy.id;
  return { pasted: true, kind: "component", id: copy.id };
}

function pasteChainItem(draft, source, target) {
  target = componentListChainTarget(draft, target);
  if (target.kind !== "chain" && target.kind !== "group") return { pasted: false, reason: "wrong-target" };
  const component = targetComponent(draft, target);
  if (!component || (component.type !== "canvas" && containsComponentReference(source))) {
    return { pasted: false, reason: "components-only-in-canvas" };
  }
  return insertIntoTarget(draft, target, regenerateChainItemIds(clone(source)));
}

function pasteScene(draft, source, target) {
  if (target.kind !== "scene-list") return { pasted: false, reason: "wrong-target" };
  const copy = clone(source);
  copy.id = uid("scene");
  copy.name = uniqueCopyName(source.name || "Scene", draft.scenes || []);
  draft.scenes ||= [];
  draft.scenes.push(copy);
  draft.ui.selectedSceneId = copy.id;
  return { pasted: true, kind: "scene", id: copy.id };
}

function pasteSurface(draft, source, target) {
  if (target.kind !== "surface-list" || source.destination?.type === "direct") return { pasted: false, reason: "wrong-target" };
  const copy = clone(source);
  copy.id = uid("surface");
  copy.mappingId = copy.id;
  copy.name = uniqueCopyName(source.name || "Surface", (draft.surfaces || []).filter((item) => item.destination?.type !== "direct"));
  copy.finalShaderChain = (copy.finalShaderChain || []).map((pass) => ({ ...pass, id: uid("shader") }));
  draft.surfaces ||= [];
  draft.surfaces.push(copy);
  for (const mapping of Object.values(draft.mappings || {})) {
    if (!Array.isArray(mapping?.surfaces)) continue;
    const mapped = mapping.surfaces.find((item) => item.name === source.id || item.name === source.mappingId);
    if (mapped) mapping.surfaces.push({ ...clone(mapped), name: copy.id });
  }
  for (const scene of draft.scenes || []) {
    scene.snapshot ||= { surfaces: [] };
    scene.snapshot.surfaces ||= [];
    scene.snapshot.surfaces.push(createSceneSurfaceSnapshot(copy));
  }
  const liveScene = draft.scenes?.find((scene) => String(scene.id) === String(draft.ui.live?.selectedSceneId || ""));
  syncLiveSnapshotFromScene(draft, liveScene);
  draft.ui.selectedSurfaceId = copy.id;
  return { pasted: true, kind: "surface", id: copy.id };
}

function pasteMedia(draft, source, target) {
  target = componentListChainTarget(draft, target);
  if (target.kind !== "chain" && target.kind !== "group") return { pasted: false, reason: "library-only" };
  if (!source.id) return { pasted: false, reason: "missing-media" };
  return insertIntoTarget(draft, target, regenerateChainItemIds({
    id: uid("chain"),
    kind: "source",
    enabled: true,
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    params: {},
    source: { type: "media", mediaId: source.id },
  }));
}

function insertIntoTarget(draft, target, item) {
  const component = targetComponent(draft, target);
  if (!component || !item) return { pasted: false, reason: "missing-target" };
  component.chain ||= [];
  if (target.kind === "group") {
    const group = findChainItem(component.chain, target.itemId);
    if (!group || group.kind !== "group") return { pasted: false, reason: "missing-group" };
    group.chain ||= [];
    group.chain.push(item);
  } else {
    insertChainItemNearSelection(component.chain, target.itemId, item);
  }
  draft.ui.selectedComponentId = component.id;
  draft.ui.selectedChainItemId = item.id;
  return { pasted: true, kind: "chain-item", id: item.id };
}

function createComponentReferenceLayer(draft, canvas, source) {
  const canvasWidth = Math.max(1, Number(canvas.canvas?.width) || 1920);
  const metrics = componentFrameMetrics(draft.render || {}, source);
  return regenerateChainItemIds({
    id: uid("chain"),
    kind: "source",
    enabled: true,
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    params: {},
    source: {
      type: "component",
      componentId: source.id,
      placement: { scale: metrics.baseWidth / canvasWidth },
    },
  });
}

function regenerateChainItemIds(item = {}) {
  const copy = clone(item);
  copy.id = uid("chain");
  if (copy.kind === "group") copy.chain = (copy.chain || []).map(regenerateChainItemIds);
  return copy;
}

function containsComponentReference(item = {}) {
  if (item.kind === "source" && item.source?.type === "component") return true;
  return item.kind === "group" && (item.chain || []).some(containsComponentReference);
}

function targetComponent(draft, target) {
  return draft.components?.find((item) => item.id === target.componentId) || null;
}

function componentListChainTarget(draft, target) {
  if ((target.kind !== "component-list" && target.kind !== "canvas-list") || !target.itemId) return target;
  const component = draft.components?.find((item) => item.id === target.itemId);
  return component ? { kind: "chain", componentId: component.id, itemId: "" } : target;
}

function findChainItem(chain = [], id = "") {
  if (!id) return null;
  for (const item of chain || []) {
    if (item.id === id) return item;
    const nested = item.kind === "group" ? findChainItem(item.chain, id) : null;
    if (nested) return nested;
  }
  return null;
}

function uniqueCopyName(name, items) {
  const base = String(name || "Item").replace(/ Copy(?: \d+)?$/, "");
  const used = new Set((items || []).map((item) => item.name));
  if (!used.has(`${base} Copy`)) return `${base} Copy`;
  let suffix = 2;
  while (used.has(`${base} Copy ${suffix}`)) suffix++;
  return `${base} Copy ${suffix}`;
}
