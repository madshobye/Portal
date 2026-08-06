import { createLiveComponentView, sceneSourceNodes, sourceBackedMediaId } from "../domain/models.js";
import {
  currentLiveProgramComponentIds,
  liveProgramComponentIds,
} from "../domain/scene-routing.js";
import { getGeneratorNodeComponent as getGeneratorComponent, getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js";
import { chainItemToggleIcon, effectChainItemDisplayName, sourceChainItemDisplayName, sourceIcon } from "./component-view.js";
import { getLiveSelectedTarget, liveSceneComponents, mappingFingerprintComponents } from "./control-selectors.js";
import { CHAIN_COMPOSITE_PARAMS, CHAIN_TRANSFORM_PARAMS, chainBoundaryPositionParams, chainTransformParams, componentParamViews, retainedParameterControlEligible } from "./parameter-view.js";
import { effectIcon, UI_ICONS } from "./ui-icons.js";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js";
import { parameterAnimationTracks } from "../libraries/composition-engine/shared/parameter-animation-tracks.js";
import { getByPath } from "./path-input-utils.js";
import { dmxProbeComponentForState } from "../libraries/dmx-engine/index.js";
import { liveParameterDiffBank } from "../domain/live-parameter-diffs.js";
import { mediaChoiceUiModel } from "./media-view.js";
import {
  componentLayerProjection,
  componentParameterAddress,
  liveComponentLayerProjection,
} from "../domain/component-layer-projection.js";

const LIVE_ELEMENT_PARAMETER_SECTION_LAYOUT = Object.freeze({
  fill: true,
  grow: 0,
  shrink: 0,
  basis: "40%",
  overflow: "hidden",
});

export function selectedLiveInspectorModel(state) {
  const component = getLiveSelectedTarget(state);
  if (!component) return {
    targetId: "",
    title: "Live",
    icon: UI_ICONS.component,
    emptyText: "No sources",
    contentChildren: [],
    secondaryChildren: [],
  };
  const layers = liveComponentLayerProjection(state, component);
  const selectedElement = selectedLiveLayer(layers, component.id, state);
  const showElement = state.ui?.live?.componentView === "elements" && selectedElement;
  return {
    targetId: component.id,
    title: "Parameters",
    icon: "tune",
    media: null,
    headerAction: {
      action: "inspector.edit-component",
      label: `Edit ${component.name}`,
      icon: "edit",
    },
    contentChildren: [{
      id: "live-component-views",
      type: "layout",
      orientation: "column",
      presentation: "artifact-content",
      label: `${component.name} live controls and elements`,
    }],
    secondaryLayout: showElement ? LIVE_ELEMENT_PARAMETER_SECTION_LAYOUT : undefined,
    secondaryChildren: showElement
      ? liveSelectedChainSettingsModel(selectedElement, state)
      : [],
  };
}

export function selectedLiveComponentViewModel(state) {
  const component = getLiveSelectedTarget(state);
  if (!component) return null;
  const view = createLiveComponentView(component, state);
  const layers = liveComponentLayerProjection(state, component);
  const selectedElement = selectedLiveLayer(layers, component.id, state);
  return {
    state,
    component,
    view,
    state,
    selectedId: state.ui?.live?.componentView === "elements" ? "elements" : "controls",
    stateAddress: `projects/${encodeURIComponent(String(state.project?.folderName || state.project?.name || "unopened"))}/live/${encodeURIComponent(String(component.id))}/view`,
    views: [{ id: "controls", label: "Controls" }, { id: "elements", label: "Elements" }],
    elements: liveLayerOutlineItems(layers, component.id, selectedElement?.nodeId, state),
  };
}

export function liveNavigableComponents(scene, state) {
  const result = [];
  const seen = new Set();
  const visit = (component) => {
    if (!component || seen.has(component.id)) return;
    seen.add(component.id);
    result.push(component);
    for (const { item } of nestedLayers(componentLayerProjection(state, component))) {
      if (item.kind !== "source" || item.source?.type !== "component") continue;
      visit(state.components?.find((candidate) => candidate.id === item.source.componentId));
    }
  };
  for (const component of liveSceneComponents(scene, state)) visit(component);
  return result;
}

export function liveSignificantParameterAssignments(state = {}, limit = 8) {
  const assignments = [];
  const seenParameters = new Set();
  const ids = currentLiveProgramComponentIds(state);
  for (const componentId of ids) {
    if (assignments.length >= limit) break;
    const component = state.components?.find((candidate) =>
      String(candidate.id) === String(componentId)
    );
    if (!component || component.systemRole) continue;
    for (const assignment of componentSignificantParameterAssignments(component, state)) {
      const key = assignment.id || `${assignment.componentId}:${assignment.path}`;
      if (seenParameters.has(key)) continue;
      seenParameters.add(key);
      assignments.push(assignment);
      if (assignments.length >= limit) break;
    }
  }
  return assignments;
}

export function liveSignificantAssignmentValue(assignment, component, state) {
  if (assignment.kind === "animation") {
    const override = liveParameterDiffBank(state.ui?.live)?.[component.id]
      ?.animation?.[assignment.trackId]?.fields?.[assignment.field];
    if (override !== undefined) return override;
    return parameterAnimationTracks(
      state.nodes,
      component.id,
      assignment.targetNodeId,
    ).find((track) => track.id === assignment.trackId)?.[assignment.field];
  }
  if (assignment.nodeId) {
    const layer = findLayer(liveComponentLayerProjection(state, component), assignment.nodeId);
    return getByPath(layer?.item, assignment.path);
  }
  return getByPath(createLiveComponentView(component, state), assignment.path);
}

export function significantParameterValueFromUnit(assignment = {}, unitValue = 0) {
  const minimum = Number(assignment.min);
  const maximum = Number(assignment.max);
  const normalized = Math.min(1, Math.max(0, Number(unitValue) || 0));
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
    return normalized;
  }
  const logarithmic = assignment.scale === "log" && minimum > 0;
  let value = logarithmic
    ? minimum * Math.pow(maximum / minimum, normalized)
    : minimum + ((maximum - minimum) * normalized);
  const step = Number(assignment.step);
  if (Number.isFinite(step) && step > 0) {
    value = minimum + (Math.round((value - minimum) / step) * step);
  }
  return Number(Math.min(maximum, Math.max(minimum, value)).toFixed(12));
}

function componentSignificantParameterAssignments(component, state) {
  const registry = new Map();
  collectSignificantParameterDefinitions(componentLayerProjection(state, component), {
    component,
    state,
    registry,
  });
  const chainAssignments = (component.significantParams || [])
    .map((path) => registry.get(path))
    .filter(Boolean);
  return [
    ...chainAssignments,
    ...componentSignificantAnimationAssignments(component, state),
  ];
}

function componentSignificantAnimationAssignments(component, state) {
  return (component.significantAnimationParams || []).flatMap((entry) => {
    const track = parameterAnimationTracks(
      state.nodes,
      component.id,
      entry.targetNodeId,
    ).find((candidate) => candidate.id === entry.trackId && candidate.kind !== "event");
    if (!track || !Number.isFinite(Number(track[entry.field]))) return [];
    return [{
      id: `${component.id}:animation:${entry.trackId}:${entry.field}`,
      kind: "animation",
      name: `${component.name} · ${entry.label || entry.field}`,
      detail: track.parameterId,
      componentId: component.id,
      targetNodeId: entry.targetNodeId,
      trackId: entry.trackId,
      field: entry.field,
      min: Number(entry.min),
      max: Number(entry.max),
      step: Number(entry.step) || 0,
      scale: entry.scale === "log" ? "log" : "linear",
    }];
  });
}

function collectSignificantParameterDefinitions(layers, {
  component,
  state,
  registry,
}) {
  for (let index = 0; index < (layers || []).length; index++) {
    const layer = layers[index];
    const item = layer.item;
    const itemLabel = item?.name || item?.id || `Element ${index + 1}`;
    const register = (configurationPath, param) => {
      if (param?.type !== "number") return;
      const min = Number(param.min);
      const max = Number(param.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
      registry.set(componentParameterAddress(layer.nodeId, configurationPath), {
        id: `${component.id}:${layer.nodeId}:${configurationPath}`,
        name: `${component.name} · ${param.label || param.id}`,
        detail: itemLabel,
        componentId: component.id,
        nodeId: layer.nodeId,
        path: configurationPath,
        min,
        max,
        step: Number(param.step) || 0,
        scale: param.scale === "log" ? "log" : "linear",
      });
    };

    for (const param of CHAIN_COMPOSITE_PARAMS) {
      register(param.id, param);
    }
    for (const param of chainTransformParams(item?.transform)) {
      register(`transform.${param.id}`, param);
    }
    for (const param of chainBoundaryPositionParams(item?.boundary)) {
      register(`boundary.${param.id}`, param);
    }
    if (item?.kind === "group") {
      collectSignificantParameterDefinitions(layer.children || [], {
        component,
        state,
        registry,
      });
      continue;
    }
    const definitions = item?.kind === "effect"
      ? visualEffectComponent(state, item.componentId, item)?.params || []
      : sourceLiveParams(item?.source || {}, null, state);
    for (const param of definitions) {
      const updatePath = item?.kind === "source"
        ? `source.params.${param.id}`
        : `params.${param.id}`;
      register(updatePath, param);
    }
  }
}

// The Live navigator represents the complete program, not only the currently
// selected matrix cell. Include the Overall source and every source currently
// routed to a Surface, then walk their component graphs. This keeps a custom
// Surface patch inspectable after the operator moves to another Surface.
export function liveProgramNavigableComponents(state, nowMs = Date.now()) {
  const ids = liveProgramComponentIds(state, nowMs);
  return [...ids]
    .map((id) => state.components?.find((component) => String(component.id) === String(id)))
    .filter((component) => component && !component.systemRole);
}

function* nestedLayers(layers = []) {
  for (const layer of layers || []) {
    yield layer;
    yield* nestedLayers(layer.children || []);
  }
}

function liveLayerOutlineItems(layers, componentId, selectedNodeId, state, depth = 0) {
  return (layers || []).flatMap((layer) => {
  const item = layer.item;
  const label = liveChainItemLabel(item, state);
  const descriptor = {
    id: layer.nodeId,
    label,
    depth,
    selected: layer.nodeId === selectedNodeId,
    presentation: item.kind === "group" ? "group-element-row" : "element-row",
    selectPresentation: "element-select",
    actions: [{
      id: "toggle-enabled",
      label: item.enabled === false ? `Enable ${label}` : `Disable ${label}`,
      icon: chainItemToggleIcon(item),
      presentation: item.enabled !== false ? "enabled-toggle" : "disabled-toggle",
      position: "leading",
      payload: {
        componentId,
        nodeId: layer.nodeId,
        path: "enabled",
        value: item.enabled === false,
      },
    }],
  };
  return [descriptor, ...liveLayerOutlineItems(layer.children, componentId, selectedNodeId, state, depth + 1)];
  });
}

function liveSelectedChainSettingsModel(selected, state) {
  const { item } = selected;
  const label = liveChainItemLabel(item, state);
  const iconName = item.kind === "effect" ? effectIcon(item.componentId) : item.kind === "group" ? UI_ICONS.group : sourceIcon(item.source || {});
  return [{
    id: "live-element-panel",
    type: "panel",
    layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
    title: label,
    icon: iconName,
    presentation: "live-inspector-panel",
    children: [{
      id: "live-chain-parameter-tabs",
      type: "layout",
      orientation: "column",
      presentation: "live-chain-parameter-tabs-host",
      label: "Selected live element parameters",
    }],
  }];
}

export function selectedLiveParameterTabsModel(state) {
  const component = getLiveSelectedTarget(state);
  if (!component) return null;
  const selected = selectedLiveLayer(liveComponentLayerProjection(state, component), component.id, state);
  if (!selected) return null;
  const definition = selectedLiveParameterDefinition(selected.item, state);
  const hasDetails = (componentParamViews(definition).details || []).length > 0;
  const views = [
    { id: "content", label: hasDetails ? "Primary" : "Content" },
    ...(hasDetails ? [{ id: "details", label: "Details" }] : []),
    { id: "general", label: "General" },
  ];
  for (const [viewId, paramView] of [["content", "primary"], ["details", "details"]]) {
    const parameterModel = selectedLiveRetainedParameterModel(state, paramView);
    const view = views.find((candidate) => candidate.id === viewId);
    if (view && parameterModel) view.liveParameterModel = parameterModel;
    if (view) view.models = selectedLiveSpecializedModels(state, component.id, selected, definition, paramView);
  }
  return {
    state,
    component,
    item: selected.item,
    nodeId: selected.nodeId,
    stateAddress: `projects/${uiStatePart(state.project?.folderName || state.project?.name || "project")}/live/components/${uiStatePart(component.id)}/elements/${uiStatePart(selected.nodeId)}/parameter-tabs`,
    views,
  };
}

function selectedLiveParameterDefinition(item, state) {
  if (item?.kind === "effect") return visualEffectComponent(state, item.componentId, item);
  if (item?.kind === "source" && item.source?.type === "generator") return visualGeneratorComponent(state, item.source.generatorId);
  return null;
}

function selectedLiveSpecializedModels(state, componentId, selected, definition, paramView) {
  if (paramView !== "primary" || !definition) return [];
  const values = selected.item.kind === "effect" ? selected.item.params || {} : selected.item.source?.params || {};
  const pathPrefix = selected.item.kind === "effect" ? "params" : "source.params";
  return (definition.params || []).filter((param) => param.ui === "media").map((param) => {
    const value = String(values[param.id] || param.defaultValue || "");
    const media = (state.media || []).find((entry) => String(entry.id || "") === value) || null;
    const model = mediaChoiceUiModel(media, {
      id: `resource-${param.id}`,
      label: param.label || param.id,
      mode: "value",
      accept: param.mediaCategory || "",
      emptyName: `Choose ${param.label || "media"}`,
      emptyDetail: param.mediaCategory === "model" ? "3D model" : "Media",
    });
    return {
      ...model,
      commandPayload: {
        componentId,
        nodeId: selected.nodeId,
        path: `${pathPrefix}.${param.id}`,
        accept: param.mediaCategory || "",
      },
      onActivate: { action: "picker.open-live-media" },
    };
  });
}

function uiStatePart(value) {
  return encodeURIComponent(String(value || "unknown")).replaceAll("%", "_");
}

export function selectedLiveRetainedParameterModel(state, paramView = "primary") {
  const component = getLiveSelectedTarget(state);
  if (!component) return null;
  const layers = liveComponentLayerProjection(state, component);
  const selected = selectedLiveLayer(layers, component.id, state);
  if (!selected) return null;
  const effect = selected.item.kind === "effect";
  const generator = selected.item.kind === "source" && selected.item.source?.type === "generator";
  if (!effect && !generator) return null;
  const definition = effect
    ? visualEffectComponent(state, selected.item.componentId, selected.item)
    : visualGeneratorComponent(state, selected.item.source.generatorId);
  const params = (componentParamViews(definition)[paramView] || [])
    .map(effectDisplayParam)
    .filter(retainedParameterControlEligible);
  if (!params.length) return null;
  return {
    state,
    component,
    item: selected.item,
    nodeId: selected.nodeId,
    paramView,
    params,
    allParams: (definition?.params || []).map(effectDisplayParam),
    values: effect ? selected.item.params || {} : selected.item.source.params || {},
    pathPrefix: effect ? "params" : "source.params",
  };
}

export function selectedLiveGeneralParameterModel(state) {
  const component = getLiveSelectedTarget(state);
  if (!component) return null;
  const selected = selectedLiveLayer(liveComponentLayerProjection(state, component), component.id, state);
  return selected ? {
    state,
    component,
    item: selected.item,
    nodeId: selected.nodeId,
  } : null;
}

function effectDisplayParam(param) {
  return param?.id === "amount" ? { ...param, label: "Effect strength" } : param;
}

function selectedLiveLayer(layers, componentId, state) {
  const selectedByComponent = state.ui?.live?.selectedChainItemIds?.[componentId];
  const selectedId = selectedByComponent || state.ui?.live?.selectedChainItemId || "";
  return findLayer(layers, selectedId) || layers?.[0] || null;
}

function findLayer(layers, id) {
  for (const layer of layers || []) {
    if (layer.nodeId === id) return layer;
    const nested = findLayer(layer.children, id);
    if (nested) return nested;
  }
  return null;
}

function liveChainItemLabel(item, state = {}) {
  if (item.kind === "effect") return effectChainItemDisplayName(item, state);
  if (item.kind === "group") return item.name || "Group";
  const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(item.source)) || null;
  const component = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  return sourceChainItemDisplayName(item, media, component, state);
}

function sourceLiveParams(source = {}, _media = null, state = {}) {
  if (source.type === "generator") return visualGeneratorComponent(state, source.generatorId)?.params || [];
  return [];
}

function visualGeneratorComponent(state, id) {
  const project = listProjectIsfVisualComponents(state).find((component) => component.kind === "generator" && component.id === id);
  if (project) return project;
  try { return getGeneratorComponent(id); } catch { return null; }
}

function visualEffectComponent(state, id, item = {}) {
  const component = listProjectIsfVisualComponents(state).find((entry) => entry.kind === "effect" && entry.id === id)
    || getShaderComponent(id);
  return dmxProbeComponentForState(component, state, item);
}
