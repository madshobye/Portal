import { componentFrameMetrics } from "../domain/component-frame.js";
import { componentFromNodeDefinition, getGeneratorNodeComponent as getGeneratorComponent, getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js";
import { materializeProjectNodeDefinition } from "./node-editor-view.js";
import { generatorIcon, isIsfVisualComponent } from "./picker-view.js";
import { chainGeneralAnimationParameters, componentParamViews, paramCurrentValue, retainedParameterControlEligible } from "./parameter-view.js";
import { effectIcon, sourceTypeIcon, UI_ICONS, visibilityIcon } from "./ui-icons.js";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js";
import { mediaChoiceUiModel, mediaDisplayName } from "./media-view.js";
import {
  isAutomaticMediaSourceName,
  sourceBackedMediaId,
} from "../domain/models.js";
import { parameterAnimationUiModel } from "./animation-view.js";
import { dmxProbeComponentForState } from "../libraries/dmx-engine/index.js";
import {
  componentLayerProjection,
  selectedComponentLayer,
} from "../domain/component-layer-projection.js";


export function componentOverviewUiModel(component, state) {
  if (!component) return null;
  const base = pathForComponent(state, component);
  const resolution = Number(component.resolutionScale) || 1;
  const resolutionChoice = {
    id: "resolution",
    type: "choice",
    label: `${component.type === "scene" ? "Scene" : "Component"} resolution scale`,
    selectedId: String(resolution),
    items: [0.5, 1, 2].map((value) => ({ id: String(value), value, label: `${value}×` })),
    presentation: "component-resolution",
    stateAddress: `${base}.resolutionScale`,
    onSelect: { action: "project.set-value", address: `${base}.resolutionScale` },
    layout: { grow: 0, shrink: 0, basis: "auto" },
  };
  const children = component.type === "scene" ? [resolutionChoice] : componentFrameControlModels(component, state, base, resolutionChoice);
  return {
    id: "component-overview",
    type: "layout",
    orientation: "row",
    presentation: "component-quick-toolbar",
    label: `${component.name} quick settings`,
    layout: { grow: 0, shrink: 0, basis: "auto" },
    children,
  };
}

export function componentElementsUiModel(component, state) {
  if (!component) return null;
  return {
    id: "elements",
    type: "list",
    stateAddress: `projects/${uiStatePart(state.project?.folderName || state.project?.name || "project")}/components/${uiStatePart(component.id)}/elements`,
    label: `${component.name} elements`,
    items: componentElementListItems(componentLayerProjection(state, component), component, state),
    selectedId: state.ui?.selectedChainItemId || "",
    emptyText: "No elements",
    reorderable: true,
    pasteScope: `chain:${component.id}`,
    presentation: "element-list",
    layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
    onSelect: {
      action: "component.element-select",
      target: { componentId: component.id },
    },
    onAction: {
      action: "component.element-action",
      target: { componentId: component.id },
    },
    onReorder: {
      action: "component.element-reorder",
      target: { componentId: component.id },
    },
  };
}

function componentElementListItems(layers, component, state, depth = 0) {
  return (layers || []).flatMap((layer) => {
    const item = layer.item;
    const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(item.source)) || null;
    const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
    const label = chainItemLabel(item, media, referencedComponent, state);
    const descriptor = {
      id: layer.nodeId,
      label,
      depth,
      acceptsChildren: item.kind === "group",
      dropAfter: item.kind === "group",
      reorderable: true,
      presentation: item.kind === "group" ? "group-element-row" : "element-row",
      selectPresentation: "element-select",
      actions: [{
        id: "toggle-enabled",
        label: item.enabled === false ? "Enable" : "Disable",
        icon: chainItemToggleIcon(item),
        presentation: item.enabled !== false ? "enabled-toggle" : "disabled-toggle",
        position: "leading",
        payload: {
          operation: "toggle-enabled",
          path: `${layer.path}.enabled`,
          value: item.enabled === false,
        },
      }, ...referencedComponent ? [{
        id: "edit-component",
        label: `Edit ${referencedComponent.name}`,
        icon: "edit",
        presentation: "element-edit",
        payload: { operation: "edit-component", componentId: referencedComponent.id },
      }] : [], {
        id: "remove",
        label: `Remove ${label}`,
        icon: "close",
        presentation: "element-remove",
        payload: { operation: "remove", componentId: component.id, nodeId: layer.nodeId },
      }],
    };
    const children = item.kind === "group" && !item.collapsed
      ? componentElementListItems(layer.children, component, state, depth + 1)
      : [];
    return [descriptor, ...children];
  });
}

export function componentSelectedChainSettingsModel(component, state) {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return null;
  const header = selectedChainItemHeaderModel(selected.item, component, state, selected.path);
  return {
    id: "selected-element-panel",
    type: "panel",
    layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
    title: header.title,
    icon: header.icon,
    titleBinding: header.titleBinding,
    headerActions: header.headerActions,
    presentation: "component-inspector-panel",
    children: [{
      id: "chain-parameter-tabs",
      type: "layout",
      orientation: "column",
      presentation: "chain-parameter-tabs-host",
      label: "Selected element parameters",
    }],
  };
}

export function selectedChainParameterTabsModel(component, state, { nodeEditorModel = null } = {}) {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return null;
  return {
    state,
    component,
    item: selected.item,
    path: selected.path,
    stateAddress: `projects/${uiStatePart(state.project?.folderName || state.project?.name || "project")}/components/${uiStatePart(component.id)}/elements/${uiStatePart(selected.item.id)}/parameter-tabs`,
    views: selectedChainParameterViews(selected.item, component, state, selected.path, nodeEditorModel),
  };
}

export function sourceIcon(source = {}) {
  if (source.type === "component") return UI_ICONS.component;
  if (source.type === "generator") {
    if (source.generatorId === "modelMedia") return "deployed_code";
    if (source.generatorId === "mediaImage") return "perm_media";
    return generatorIcon(source.generatorId);
  }
  return sourceTypeIcon(source.type || "generator");
}

export function chainItemIcon(item = {}) {
  if (item.kind === "source") return sourceIcon(item.source || {});
  if (item.kind === "group") return UI_ICONS.group;
  return effectIcon(item.componentId);
}

export function chainItemToggleIcon(item = {}) {
  return item.enabled === false ? visibilityIcon(false) : chainItemIcon(item);
}

export function sourceChainItemDisplayName(item = {}, media = null, component = null, state = null) {
  if (item.source?.type === "component") return sourceTitle(item.source, media, component, state);
  if (sourceBackedMediaId(item.source) && isAutomaticMediaSourceName(item.name, item.source)) {
    return sourceTitle(item.source, media, component, state);
  }
  if (item.source?.type === "generator") {
    const generator = visualGeneratorComponent(state, item.source.generatorId);
    if (isAutomaticVisualPlacementName(item.name, item.source.generatorId)) {
      return visualPlacementDefaultName(generator, item.source.generatorId);
    }
  }
  if (!item.name || isGenericLayerName(item.name) || item.name === item.source?.componentId) {
    return sourceTitle(item.source || {}, media, component, state);
  }
  return item.name;
}

export function effectChainItemDisplayName(item = {}, state = null) {
  const effect = visualEffectComponent(state, item.componentId);
  if (isAutomaticVisualPlacementName(item.name, item.componentId)) {
    return visualPlacementDefaultName(effect, item.componentId || "Effect");
  }
  return item.name;
}

export function formatTrimTime(value) {
  const safe = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export function roundTrimTime(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function componentFrameControlModels(component, state, base, resolutionChoice) {
  const metrics = componentFrameMetrics(state.render || {}, component);
  return [{
    id: "sync-instances",
    type: "toggle",
    label: "Sync instances",
    icon: "sync",
    iconOnly: true,
    value: component.syncInstances !== false,
    presentation: "component-sync",
    description: "On keeps this Component synchronized everywhere; off gives each Scene placement and Surface its own phase",
    stateAddress: `${base}.syncInstances`,
    onChange: { action: "project.set-value", address: `${base}.syncInstances` },
    layout: { grow: 0, shrink: 0, basis: "auto" },
  }, {
    id: "frame-shape",
    type: "choice",
    label: "Component frame shape",
    selectedId: metrics.frameShape,
    items: [
      { id: "landscape", label: "Landscape", icon: "crop_landscape", iconOnly: true },
      { id: "portrait", label: "Portrait", icon: "crop_portrait", iconOnly: true },
      { id: "square", label: "Square", icon: "crop_square", iconOnly: true },
    ],
    presentation: "component-frame-shape",
    stateAddress: `${base}.frameShape`,
    onSelect: { action: "project.set-value", address: `${base}.frameShape` },
    layout: { grow: 0, shrink: 0, basis: "auto" },
  }, resolutionChoice];
}

function selectedChainParameterViews(item, component, state, base, nodeEditorModel = null) {
  const hasDetails = selectedChainParamsForView(item, state, "details").length > 0;
  const views = [
    { id: "content", label: hasDetails ? "Primary" : "Content" },
    ...(hasDetails ? [{ id: "details", label: "Details" }] : []),
    { id: "animation", label: "Animation", animationModel: parameterAnimationUiModel({
    state,
    componentId: component.id,
    targetNodeId: item.id,
    parameters: selectedChainItemAnimationParameters(item, state),
    }) },
    { id: "general", label: "General" },
  ];
  const videoModel = selectedChainVideoControlsModel(component, state);
  if (videoModel) {
    const contentView = views.find((view) => view.id === "content");
    if (contentView) contentView.videoModel = videoModel;
  }
  for (const [viewId, paramView] of [["content", "primary"], ["details", "details"]]) {
    const parameterModel = selectedChainRetainedParameterModel(component, state, paramView);
    const view = views.find((candidate) => candidate.id === viewId);
    if (view && parameterModel) view.parameterModel = parameterModel;
    if (view) view.models = selectedChainSpecializedModels(item, component, state, base, paramView);
  }
  if (nodeEditorModel) views.push({ id: "node", label: "Node", nodeEditorModel });
  return views;
}

function selectedChainParamsForView(item, state, paramView) {
  if (item.kind === "effect") return componentParamViews(visualEffectComponent(state, item.componentId, item))[paramView] || [];
  if (item.kind === "source" && item.source?.type === "generator") {
    return componentParamViews(visualGeneratorComponent(state, item.source.generatorId))[paramView] || [];
  }
  return [];
}

function uiStatePart(value) {
  return encodeURIComponent(String(value || "unknown")).replaceAll("%", "_");
}

function selectedChainItemHeaderModel(item, component, state, base) {
  let iconName = "";
  let displayName = "";
  let editable = true;
  let referencedComponent = null;
  if (item.kind === "effect") {
    iconName = effectIcon(item.componentId);
    displayName = effectChainItemDisplayName(item, state);
  } else if (item.kind === "group") {
    iconName = UI_ICONS.group;
    displayName = item.name || "Group";
  } else {
    const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(item.source)) || null;
    referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
    displayName = sourceChainItemDisplayName(item, media, referencedComponent, state);
    iconName = sourceIcon(item.source);
    editable = !(component?.type === "scene" && item.source?.type === "component");
  }
  return {
    title: displayName,
    icon: iconName,
    titleBinding: editable ? {
      label: "Element name",
      value: displayName,
      address: `${base}.name`,
      stateAddress: `${base}.name`,
      action: "project.set-value",
      presentation: "artifact-title",
    } : null,
    headerActions: !editable && referencedComponent ? [{
      id: "edit-component",
      label: `Edit ${displayName}`,
      icon: "edit",
      action: "component.element-action",
      payload: { operation: "edit-component", componentId: referencedComponent.id },
    }] : [],
  };
}

function selectedChainSpecializedModels(item, component, state, base, paramView) {
  if (paramView !== "primary") return [];
  if (item.kind === "group") return [{
    id: "group-collapsed",
    type: "toggle",
    label: "Collapsed",
    value: item.collapsed === true,
    stateAddress: `${base}.collapsed`,
    onChange: { action: "project.set-value", address: `${base}.collapsed` },
  }, {
    id: "group-add-element",
    type: "button",
    label: "Add element to group",
    icon: "add",
    iconOnly: false,
    commandPayload: { componentId: component.id, targetChainItem: item.id },
    onActivate: { action: "picker.open-element" },
  }, {
    id: "group-note",
    type: "text",
    text: "Use the preview handles to move, scale, or rotate the group as one unit.",
    tone: "muted",
  }];
  if (item.kind === "source" && item.source?.type === "component") {
    if (component?.type === "scene") return [];
    return [{
      id: "component-source",
      type: "select",
      label: "Component",
      value: String(item.source.componentId || ""),
      options: [
        { value: "", label: "None" },
        ...(state.components || [])
          .filter((candidate) => candidate.type !== "scene" && candidate.id !== component.id)
          .map((candidate) => ({ value: candidate.id, label: candidate.name })),
      ],
      stateAddress: `${base}.source.componentId`,
      onChange: { action: "project.set-value", address: `${base}.source.componentId` },
    }];
  }
  return [
    ...generatorResourceControlModels(item, state, base),
    ...isfImageInputControlModels(item, component, state, base),
  ];
}

function generatorResourceControlModels(item, state, base) {
  if (item.kind !== "source" || item.source?.type !== "generator") return [];
  const definition = visualGeneratorComponent(state, item.source.generatorId);
  return (definition?.params || [])
    .filter((param) => param.ui === "media")
    .map((param) => {
    const path = `${base}.source.params.${param.id}`;
    const value = String(item.source.params?.[param.id] || param.defaultValue || "");
    const media = (state.media || []).find((entry) => String(entry.id || "") === value) || null;
    return mediaChoiceUiModel(media, {
      id: `resource-${param.id}`,
      label: param.label || param.id,
      mode: "value",
      path,
      accept: param.mediaCategory || "",
      emptyName: `Choose ${param.label || "media"}`,
      emptyDetail: param.mediaCategory === "model" ? "3D model" : "Media",
    });
  });
}

function selectedChainItemAnimationParameters(item, state) {
  let definition = null;
  let values = {};
  if (item.kind === "effect") {
    definition = visualEffectComponent(state, item.componentId, item);
    values = item.params || {};
  } else if (item.kind === "source" && item.source?.type === "generator") {
    definition = visualGeneratorComponent(state, item.source.generatorId);
    values = item.source.params || {};
  }
  return [
    ...(definition?.params || []).map((param) => ({
      ...param,
      value: paramCurrentValue(definition, { params: values }, param),
    })),
    ...chainGeneralAnimationParameters(item),
  ];
}

export function selectedChainRetainedParameterModel(component, state, paramView = "primary") {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return null;
  const effect = selected.item.kind === "effect";
  const generator = selected.item.kind === "source" && selected.item.source?.type === "generator";
  if (!effect && !generator) return null;
  const definition = effect
    ? visualEffectComponent(state, selected.item.componentId, selected.item)
    : visualGeneratorComponent(state, selected.item.source.generatorId);
  const params = (componentParamViews(definition)[paramView] || [])
    .map(effectDisplayParam)
    .filter((param) => !generator || definition.id !== "mediaImage" || !["start", "end", "speed"].includes(param.id))
    .filter(retainedParameterControlEligible);
  if (!params.length) return null;
  return {
    state,
    component,
    item: selected.item,
    nodeId: selected.item.id,
    basePath: effect ? selected.path : `${selected.path}.source`,
    paramView,
    params,
    allParams: (definition?.params || []).map(effectDisplayParam),
    values: effect ? selected.item.params || {} : selected.item.source.params || {},
  };
}

function effectDisplayParam(param) {
  return param?.id === "amount" ? { ...param, label: "Effect strength" } : param;
}

function selectedChainItemSelection(component, state) {
  const selected = selectedComponentLayer(state, component, state.ui.selectedChainItemId);
  return selected ? { item: selected.item, path: selected.path } : null;
}

function isfImageInputControlModels(item, ownerComponent, state, base) {
  const visualComponent = item.kind === "effect"
    ? visualEffectComponent(state, item.componentId, item)
    : item.source?.type === "generator"
      ? visualGeneratorComponent(state, item.source.generatorId)
      : null;
  const inputs = (visualComponent?.nodeDefinition?.metadata?.isf?.inputs || [])
    .filter((input) =>
      input.type === "image" &&
      !(visualComponent.kind === "effect" && input.name === "inputImage")
    );
  return inputs.map((input) => {
    const source = item.imageInputs?.[input.name] || null;
    const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(source)) || null;
    const selectedComponent = state.components?.find((entry) => entry.id === source?.componentId) || null;
    const title = source ? sourceTitle(source, media, selectedComponent, state) : "Choose image source";
    return {
      id: `image-input-${input.name}`,
      type: "resourceButton",
      label: input.label || input.name,
      valueLabel: title,
      detail: input.name,
      icon: source ? sourceIcon(source) : "image",
      presentation: "resource-choice",
      accessibleLabel: `${input.label || input.name}: ${title}`,
      commandPayload: {
        path: `${base}.imageInputs.${input.name}`,
        category: "",
        allowComponents: true,
        ownerComponentId: ownerComponent?.id || "",
      },
      onActivate: { action: "picker.open-source" },
    };
  });
}

function sourceTitle(source = {}, media = null, component = null, state = null) {
  if (source.type === "component") return component?.name || source.componentId || "Component";
  if (source.type === "generator") {
    if (source.generatorId === "modelMedia" || source.generatorId === "mediaImage") {
      return mediaDisplayName(media || { id: sourceBackedMediaId(source) });
    }
    const generator = visualGeneratorComponent(state, source.generatorId);
    return visualPlacementDefaultName(generator, source.generatorId);
  }
  return "Choose source";
}

function chainItemLabel(item = {}, media = null, component = null, state = null) {
  if (item.kind === "source") return sourceChainItemDisplayName(item, media, component, state);
  if (item.kind === "group") return item.name || "Group";
  return effectChainItemDisplayName(item, state);
}

function visualPlacementDefaultName(component = null, fallback = "Visual") {
  const name = component?.label || component?.name || fallback;
  return isIsfVisualComponent(component) && !/\(ISF\)$/i.test(name)
    ? `${name} (ISF)`
    : name;
}

function isAutomaticVisualPlacementName(name = "", identity = "") {
  const candidate = String(name || "").trim();
  if (!candidate) return true;
  const canonical = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return canonical(candidate) === canonical(identity);
}

function isGenericLayerName(value) {
  return /^Layer(?:\s+\d+)?$/i.test(String(value || "").trim());
}

export function selectedChainVideoControlsModel(component, state) {
  const selected = selectedChainItemSelection(component, state);
  const source = selected?.item?.source;
  if (!selected || source?.type !== "generator") return null;
  const mediaId = String(source.params?.mediaId || "");
  const media = (state.media || []).find((item) => String(item.id || "") === mediaId) || null;
  if (media?.type !== "video" && !/\.(?:mp4|m4v|mov|webm|ogv)$/i.test(mediaId)) return null;
  return {
    component,
    item: selected.item,
    nodeId: selected.item.id,
    basePath: `${selected.path}.source.params`,
    trim: videoTrimValues(source.params || {}, media),
    speed: Number(source.params?.speed ?? 1),
  };
}

export function videoTrimValues(source = {}, media = null) {
  const duration = Number(media?.duration) > 0 ? Number(media.duration) : 0;
  const start = Math.max(0, Number(source.start) || 0);
  const explicitEnd = Math.max(0, Number(source.end) || 0);
  const available = duration > 0;
  // A one-second range is only inert markup while metadata is pending. Do not
  // silently invent a usable timeline (the old 60-second fallback did that).
  const max = available ? duration : 1;
  const end = explicitEnd > start ? explicitEnd : max;
  return {
    start: roundTrimTime(Math.min(start, max)),
    end: roundTrimTime(Math.min(Math.max(end, start), max)),
    max: roundTrimTime(max),
    implicitEnd: !(explicitEnd > start),
    available,
  };
}

function visualGeneratorComponent(state, id) {
  const project = state ? listProjectIsfVisualComponents(state).find((component) => component.kind === "generator" && component.id === id) : null;
  if (project) return project;
  const projectDefinition = (state?.nodes?.definitions || []).find((definition) =>
    definition?.persistence !== "package" &&
    (String(definition.id || "") === String(id || "") ||
      String(definition.metadata?.visualId || "") === String(id || "")));
  if (projectDefinition?.metadata?.visualCompilerHook?.id) {
    const definition = materializeProjectNodeDefinition(projectDefinition, state);
    const component = componentFromNodeDefinition({
      id: definition.metadata?.visualId || definition.id,
      kind: "generator",
      family: "project",
      name: definition.name,
      description: definition.description,
      category: "Project",
      processor: "node",
      scheduler: "frame",
      params: [],
    }, definition, {
      renderAuthority: "project-node-definition",
    });
    return Object.freeze({
      ...component,
      params: Object.freeze(component.params.map((param) => Object.freeze({
        ...param,
        mediaCategory: definition.parameters?.[param.id]?.editor?.category || "",
      }))),
    });
  }
  try { return getGeneratorComponent(id); } catch { return null; }
}

function visualEffectComponent(state, id, item = {}) {
  const component = listProjectIsfVisualComponents(state).find((entry) => entry.kind === "effect" && entry.id === id)
    || getShaderComponent(id);
  return dmxProbeComponentForState(component, state, item);
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
