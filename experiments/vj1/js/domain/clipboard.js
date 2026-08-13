import { clone, createSceneComponent, createMappingSurface, uid } from "./models.js";
import { componentFrameMetrics } from "./component-frame.js";
import { sceneLogicalSize } from "./render-settings.js";
import { initializeLiveChainInsertion } from "./scene-routing.js";
import { applyArtifactElementSelection, applyEditorSelection } from "./editor-selection.js";
import { componentLayerProjection } from "./component-layer-projection.js";
import {
  applyComponentGraphCommand,
  componentGraphNode,
  COMPONENT_GRAPH_COMMANDS,
} from "./component-graph-commands.js";
import {
  canonicalizeAuthoredVisualChain,
  canonicalizeAuthoredVisualSource,
  createAuthoredMediaSource,
} from "./authored-visual-source.js";

export const VJ1_CLIPBOARD_TYPE = "application/x-vj1-item";

export function clipboardPayloadForTarget(state = {}, target = {}) {
  if (target.kind === "component-list" || target.kind === "scene-list") {
    const value = state.components?.find((item) => item.id === target.itemId);
    return value ? { kind: "component", value: clone(componentWithProjectedLayers(state, value)) } : null;
  }
  if (target.kind === "chain-item") {
    const component = state.components?.find((item) => item.id === target.componentId);
    const value = projectedLayerItem(findProjectedLayer(
      componentLayerProjection(state, component),
      target.itemId,
    ));
    return value ? { kind: "chain-item", value: clone(value) } : null;
  }
  if (target.kind === "mapping-list") {
    const value = state.mappings?.find((item) => item.id === target.itemId);
    return value ? { kind: "mapping", value: clone(value) } : null;
  }
  if (target.kind === "surface-list") {
    const mapping = state.mappings?.find((item) => item.id === state.ui?.selectedMappingId);
    const value = mapping?.surfaces?.find((item) => item.id === target.itemId && item.destination?.type !== "direct");
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
  if (payload.kind === "mapping") return pasteMapping(draft, payload.value, target);
  if (payload.kind === "surface") return pasteSurface(draft, payload.value, target);
  if (payload.kind === "media") return pasteMedia(draft, payload.value, target);
  return { pasted: false, reason: "unsupported" };
}

export function copyComponentAsScene(draft = {}, componentId = "") {
  const storedSource = draft.components?.find((item) => item.id === componentId && item.type !== "scene");
  const source = storedSource ? componentWithProjectedLayers(draft, storedSource) : null;
  if (!source) return { converted: false, reason: "missing-component" };

  const sceneCount = (draft.components || []).filter((item) => item.type === "scene").length;
  const defaults = createSceneComponent(sceneCount);
  const copy = {
    ...clone(source),
    id: defaults.id,
    type: "scene",
    name: uniqueDerivedName(`${source.name || "Component"} Scene`, draft.components || []),
    thumbnail: "",
    chain: (source.chain || []).map(regenerateChainItemIds),
    activity: defaults.activity,
    scene: defaults.scene,
  };

  draft.components ||= [];
  draft.components.push(copy);
  draft.ui ||= {};
  draft.ui.selectedComponentId = copy.id;
  applyArtifactElementSelection(draft.ui, copy.id, copy.chain[0]?.id || "");
  draft.ui.workspaceSelectionIds ||= { component: "", scene: "" };
  draft.ui.workspaceSelectionIds.scene = copy.id;
  return { converted: true, kind: "scene", id: copy.id };
}

export function chainPasteTarget(state = {}, componentId = "", selectedItemId = "") {
  const component = state.components?.find((item) => item.id === componentId);
  if (!component) return { kind: "media-library" };
  const selected = findProjectedLayer(componentLayerProjection(state, component), selectedItemId)?.item;
  return {
    kind: selected?.kind === "group" ? "group" : "chain",
    componentId: component.id,
    itemId: selected?.id || "",
  };
}

function pasteComponent(draft, source, target) {
  if (source.type !== "scene" && target.kind === "scene-list" && target.itemId) {
    target = { kind: "chain", componentId: target.itemId, itemId: "" };
  }
  if ((target.kind === "chain" || target.kind === "group") && source.type !== "scene") {
    const component = targetComponent(draft, target);
    if (component?.type !== "scene") return { pasted: false, reason: "components-only-in-scene" };
    return insertIntoTarget(draft, target, createComponentReferenceLayer(draft, component, source));
  }
  if (target.kind !== "component-list" && target.kind !== "scene-list") return { pasted: false, reason: "wrong-target" };
  if ((source.type === "scene") !== (target.kind === "scene-list")) return { pasted: false, reason: "wrong-list" };
  const copy = clone(source);
  copy.id = uid("component");
  copy.name = uniqueCopyName(source.name || (source.type === "scene" ? "Scene" : "Component"), draft.components || []);
  copy.thumbnail = "";
  delete copy.activity;
  copy.chain = canonicalizeAuthoredVisualChain(
    (copy.chain || []).map(regenerateChainItemIds),
    draft.media || [],
  );
  if (copy.scene) copy.scene.surfaceThumbnails = {};
  draft.components ||= [];
  draft.components.push(copy);
  draft.ui.selectedComponentId = copy.id;
  applyArtifactElementSelection(draft.ui, copy.id, copy.chain?.[0]?.id || "");
  draft.ui.workspaceSelectionIds ||= { component: "", scene: "" };
  draft.ui.workspaceSelectionIds[copy.type === "scene" ? "scene" : "component"] = copy.id;
  return { pasted: true, kind: "component", id: copy.id };
}

function pasteChainItem(draft, source, target) {
  target = componentListChainTarget(draft, target);
  if (target.kind !== "chain" && target.kind !== "group") return { pasted: false, reason: "wrong-target" };
  const component = targetComponent(draft, target);
  if (!component || (component.type !== "scene" && containsComponentReference(source))) {
    return { pasted: false, reason: "components-only-in-scene" };
  }
  const copy = regenerateChainItemIds(clone(source));
  if (copy.kind === "group") {
    copy.chain = canonicalizeAuthoredVisualChain(copy.chain || [], draft.media || []);
  } else if (copy.kind === "source") {
    copy.source = canonicalizeAuthoredVisualSource(copy.source, draft.media || []);
  }
  return insertIntoTarget(draft, target, copy);
}

function pasteMapping(draft, source, target) {
  if (target.kind !== "mapping-list") return { pasted: false, reason: "wrong-target" };
  const copy = clone(source);
  copy.id = uid("mapping");
  copy.name = uniqueCopyName(source.name || "Mapping", draft.mappings || []);
  draft.mappings ||= [];
  draft.mappings.push(copy);
  draft.ui.selectedMappingId = copy.id;
  return { pasted: true, kind: "mapping", id: copy.id };
}

function pasteSurface(draft, source, target) {
  if (target.kind !== "surface-list" || source.destination?.type === "direct") return { pasted: false, reason: "wrong-target" };
  const mapping = draft.mappings?.find((item) => item.id === draft.ui?.selectedMappingId);
  if (!mapping) return { pasted: false, reason: "missing-mapping" };
  const copy = clone(source);
  copy.id = uid("surface");
  copy.mappingId = copy.id;
  copy.name = uniqueCopyName(source.name || "Surface", (mapping.surfaces || []).filter((item) => item.destination?.type !== "direct"));
  copy.finalShaderChain = (copy.finalShaderChain || []).map((pass) => ({ ...pass, id: uid("shader") }));
  mapping.surfaces ||= [];
  mapping.surfaces.push(createMappingSurface(copy));
  if (Array.isArray(mapping.calibration?.surfaces)) {
    const calibrated = mapping.calibration.surfaces.find((item) => item.name === source.id || item.id === source.id);
    if (calibrated) mapping.calibration.surfaces.push({ ...clone(calibrated), id: copy.id, name: copy.id });
  }
  applyEditorSelection(draft.ui, "surface", copy.id);
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
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    source: createAuthoredMediaSource(source.id, source),
  }));
}

function insertIntoTarget(draft, target, item) {
  const component = targetComponent(draft, target);
  if (!component || !item) return { pasted: false, reason: "missing-target" };
  initializeLiveChainInsertion(draft, component.id, item);
  if (target.kind === "group" && componentGraphNode(draft, component.id, target.itemId)?.role !== "group") {
    return { pasted: false, reason: "missing-group" };
  }
  const result = applyComponentGraphCommand(draft, {
    type: COMPONENT_GRAPH_COMMANDS.INSERT,
    componentId: component.id,
    afterNodeId: target.itemId || "",
    item,
  });
  if (!result.changed) return { pasted: false, reason: "missing-target" };
  draft.ui.selectedComponentId = component.id;
  applyArtifactElementSelection(draft.ui, component.id, item.id);
  return { pasted: true, kind: "chain-item", id: item.id };
}

function createComponentReferenceLayer(draft, scene, source) {
  const sceneWidth = sceneLogicalSize(draft.render).width;
  const metrics = componentFrameMetrics(draft.render || {}, source);
  return regenerateChainItemIds({
    id: uid("chain"),
    kind: "source",
    enabled: true,
    opacity: 1,
    blend: "normal",
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    source: {
      type: "component",
      componentId: source.id,
      placement: { scale: metrics.baseWidth / sceneWidth },
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
  if ((target.kind !== "component-list" && target.kind !== "scene-list") || !target.itemId) return target;
  const component = draft.components?.find((item) => item.id === target.itemId);
  return component ? { kind: "chain", componentId: component.id, itemId: "" } : target;
}

function componentWithProjectedLayers(state, component) {
  return {
    ...component,
    chain: componentLayerProjection(state, component).map(projectedLayerItem),
  };
}

function projectedLayerItem(layer) {
  if (!layer) return null;
  return {
    ...layer.item,
    ...(layer.item.kind === "group"
      ? { chain: layer.children.map(projectedLayerItem) }
      : {}),
  };
}

function findProjectedLayer(layers = [], nodeId = "") {
  for (const layer of layers) {
    if (layer.nodeId === nodeId) return layer;
    const nested = findProjectedLayer(layer.children, nodeId);
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

function uniqueDerivedName(name, items) {
  const base = String(name || "Scene");
  const used = new Set((items || []).map((item) => item.name));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
