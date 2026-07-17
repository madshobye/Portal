import { BLEND_MODES } from "../constants.js";
import { createLiveComponentView, sceneSourceNodes } from "../domain/models.js?v=render-coordinate-scope-3";
import { normalizeParamValue, RENDER_QUALITY_PARAM } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { getGeneratorComponent } from "../graph/generator-registry.js?v=terrain-mesh-near-1";
import { getShaderComponent } from "../shaders/shader-registry.js?v=shader-component-catalog-extraction-1";
import { componentCatalogToolsTemplate } from "./catalog-view.js?v=catalog-view-extraction-1";
import { isModelMediaSource, sourceChainItemDisplayName, sourceIcon } from "./component-view.js?v=terrain-mesh-near-1";
import { getLiveSelectedScene, getSceneSurfaceView, getSelectedScene, liveSceneComponents, liveSelectedSceneId, sceneFingerprintComponents } from "./control-selectors.js?v=control-selectors-extraction-1";
import { paramControlsTemplate, paramCurrentValue } from "./parameter-view.js?v=render-coordinate-scope-3";
import { MEDIA_FIT_PARAM, MODEL_SOURCE_PARAMS } from "./source-control-schema.js?v=source-control-schema-extraction-1";
import { effectIcon, emptyNote, esc, formatRangeValue, icon, rangeTemplate, selectValuesTemplate, thumbnailTemplate } from "./template-utils.js?v=slider-values-70";
import { componentCardBarTemplate, editableSectionTitleTemplate, enableToggleButton, panelTemplate, selectablePillTemplate } from "./view-primitives.js?v=view-primitives-extraction-1";

const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];

export function sceneSurfacePillTemplate(surface, state) {
  const sceneSurface = getSceneSurfaceView(surface, state);
  const component = state.components.find((item) => item.id === sceneSurface.componentId);
  const enabled = surface.enabled !== false;
  const direct = surface.destination?.type === "direct";
  return selectablePillTemplate({
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: enabled ? (direct ? "desktop_windows" : "crop_free") : "hide_source",
    label: surface.name,
    meta: component?.name || "None",
    togglePath: `${pathForSurface(state, surface)}.enabled`,
    toggleValue: enabled,
    removeAction: direct ? "" : "data-remove-surface",
    removeDisabled: false,
    reorderable: true,
  });
}

export function sceneSurfaceTemplate(surface, state, catalog = {}) {
  const scene = getSelectedScene(state);
  const surfaceBase = pathForSurface(state, surface);
  const sceneIndex = scene ? state.scenes.findIndex((item) => item.id === scene.id) : -1;
  const surfaceIndex = scene?.snapshot?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasSceneSurface = sceneIndex >= 0 && surfaceIndex >= 0;
  const sceneSurface = hasSceneSurface ? scene.snapshot.surfaces[surfaceIndex] : null;
  const sceneBase = `scenes.${sceneIndex}.snapshot.surfaces.${surfaceIndex}`;
  const direct = surface.destination?.type === "direct";
  return `
    <article class="sculpt-card">
      ${direct ? `<div class="soft-note">Direct output</div>` : ""}
      ${direct ? "" : `<div class="surface-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>`}
      ${rangeTemplate("Feather", `${surfaceBase}.feather`, surface.feather ?? 0, 0, 0.5, 0.005)}
      ${hasSceneSurface ? `
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        <label class="field">${direct ? "Fit" : "Projection fit"} ${selectValuesTemplate(`${sceneBase}.projectionFit`, PROJECTION_FIT_MODES, sceneSurface.projectionFit || (direct ? "contain" : "cover"))}</label>
        ${componentAssignmentTemplate(sceneBase, state, sceneSurface, catalog)}
      ` : `<div class="soft-note">Capture a scene to store component assignments for this surface.</div>`}
    </article>
  `;
}

export function sceneRailConfigTemplate(state) {
  const scene = getSelectedScene(state);
  if (!scene) {
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
        ${emptyNote("Capture a scene to edit scene settings.")}
      </div>
    `;
  }
  const base = pathForScene(state, scene);
  return `
    <div class="ui-section rail-section">
      ${editableSectionTitleTemplate("auto_awesome_motion", `${base}.name`, scene.name)}
    </div>
  `;
}

export function scenePillTemplate(scene, state) {
  const selected = state.ui.selectedSceneId === scene.id;
  const components = sceneFingerprintComponents(scene, state);
  return `
    <div class="component-card-row">
      <button type="button" class="component-card scene-card ${selected ? "is-selected" : ""}" data-select-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(components)}
        ${componentCardBarTemplate(scene.name)}
      </button>
      <button type="button" class="component-card-remove" data-delete-scene="${esc(scene.id)}" title="Remove" aria-label="Remove ${esc(scene.name)}">${icon("close")}</button>
    </div>
  `;
}

export function liveScenePillTemplate(scene, state) {
  const selected = liveSelectedSceneId(state) === scene.id;
  const components = sceneFingerprintComponents(scene, state);
  const sceneOverrides = state.ui?.live?.sceneOverrides?.[scene.id] || (selected ? state.ui?.live?.componentOverrides || {} : {});
  const hasOverrides = Object.keys(sceneOverrides).length > 0;
  return `
    <div class="component-card-row">
      <button type="button" class="component-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(components)}
        ${componentCardBarTemplate(scene.name)}
      </button>
      <button type="button" class="component-card-remove" data-reset-live-scene="${esc(scene.id)}" title="Reset temporary settings" aria-label="Reset temporary settings for ${esc(scene.name)}" ${hasOverrides ? "" : "disabled"}>${icon("restart_alt")}</button>
    </div>
  `;
}

export function liveInspectorTemplate(state) {
  const scene = getLiveSelectedScene(state);
  if (!scene) return panelTemplate("tune", "Live", emptyNote("No scenes"));
  const components = liveSceneComponents(scene, state);
  return components.map((component) => liveComponentTemplate(component, state)).join("")
    || panelTemplate("tune", scene.name, emptyNote("No components"));
}

function liveComponentTemplate(component, state) {
  const view = createLiveComponentView(component, state);
  return `
    <article class="ui-section focus-panel live-component-card">
      <header class="ui-section-header panel-title live-component-head">
        ${thumbnailTemplate(component.thumbnail)}
        <strong>${esc(component.name)}</strong>
      </header>
      ${liveUnifiedChainTemplate(view.chain, component.id, state, new Set([component.id]))}
    </article>
  `;
}

function liveUnifiedChainTemplate(chain, componentId, state, ancestry = new Set([componentId])) {
  if (!chain?.length) return "";
  return `
    <div class="live-chain-list">
      ${chain.map((item, index) => liveChainItemTemplate(item, componentId, index, `chain.${index}`, state, ancestry)).join("")}
    </div>
  `;
}

function liveChainItemTemplate(item, componentId, index, path = `chain.${index}`, state = {}, ancestry = new Set([componentId])) {
  if (item.kind === "effect") {
    const component = getShaderComponent(item.componentId);
    const label = component?.name || item.componentId;
    return `
      <div class="live-chain-pass">
        <div class="live-chain-title">
          ${enableToggleButton({ livePath: `${path}.enabled`, componentId, value: item.enabled !== false, iconName: effectIcon(item.componentId), label })}
          <span>${esc(label)}</span>
        </div>
        ${liveShaderParamControlsTemplate(component, item, componentId, path)}
      </div>
    `;
  }
  if (item.kind === "group") {
    const label = item.name || "Group";
    return `
      <div class="live-chain-pass live-chain-group">
        <div class="live-chain-title">
          ${enableToggleButton({ livePath: `${path}.enabled`, componentId, value: item.enabled !== false, iconName: "account_tree", label })}
          <span>${esc(label)}</span>
        </div>
        ${liveRangeTemplate("Alpha", componentId, `${path}.opacity`, item.opacity ?? 1)}
        <label class="field chain-param">Blend ${liveSelectValuesTemplate(componentId, `${path}.blend`, BLEND_MODES, item.blend || "normal")}</label>
        ${item.chain?.length ? `<div class="live-chain-list">${item.chain.map((child, childIndex) => liveChainItemTemplate(child, componentId, childIndex, `${path}.chain.${childIndex}`, state, ancestry)).join("")}</div>` : ""}
      </div>
    `;
  }
  const referencedComponent = item.source?.type === "component"
    ? state.components?.find((component) => component.id === item.source.componentId)
    : null;
  const label = sourceChainItemDisplayName(item, null, referencedComponent);
  const iconName = sourceIcon(item.source || {});
  let referencedElements = "";
  if (referencedComponent && !ancestry.has(referencedComponent.id)) {
    const referencedView = createLiveComponentView(referencedComponent, state);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(referencedComponent.id);
    referencedElements = `
      <div class="live-referenced-component">
        <div class="live-referenced-title">${icon("account_tree")}<span>${esc(referencedComponent.name)} elements</span></div>
        ${liveUnifiedChainTemplate(referencedView.chain, referencedComponent.id, state, nextAncestry)}
      </div>
    `;
  }
  return `
    <div class="live-chain-pass">
      <div class="live-chain-title">
        ${enableToggleButton({ livePath: `${path}.enabled`, componentId, value: item.enabled !== false, iconName, label })}
        <span>${esc(label)}</span>
      </div>
      ${liveRangeTemplate("Opacity", componentId, `${path}.opacity`, item.opacity ?? 1)}
      <label class="field chain-param">Blend ${liveSelectValuesTemplate(componentId, `${path}.blend`, BLEND_MODES, item.blend || "normal")}</label>
      ${liveSourceParamControlsTemplate(item, componentId, path)}
      ${referencedElements}
    </div>
  `;
}

function liveShaderParamControlsTemplate(component, item, componentId, itemPath) {
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, item, param),
        attrs: liveParamAttrs(componentId),
      })}
    </div>
  `;
}

function liveSourceParamControlsTemplate(item, componentId, itemPath) {
  const params = sourceLiveParams(item.source || {});
  if (!params.length) return "";
  const values = {
    ...(item.source?.params && typeof item.source.params === "object" ? item.source.params : {}),
    ...(item.params && typeof item.params === "object" ? item.params : {}),
  };
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => normalizeParamValue(param, values[param.id]),
        attrs: liveParamAttrs(componentId),
      })}
    </div>
  `;
}

function sourceLiveParams(source = {}) {
  if (source.type === "generator") return getGeneratorComponent(source.generatorId || "testPattern").params || [];
  if (source.type === "media") {
    if (isModelMediaSource(source)) return MODEL_SOURCE_PARAMS;
    return [RENDER_QUALITY_PARAM, MEDIA_FIT_PARAM];
  }
  return [];
}

function liveParamAttrs(componentId) {
  return `data-live-component-id="${esc(componentId)}" data-live-update`;
}

function liveRangeTemplate(label, componentId, path, value) {
  return `
    <label class="field range-field chain-param">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, 0.01)}</output>
      <input type="range" min="0" max="1" step="0.01" data-live-component-id="${esc(componentId)}" data-live-update="${path}" value="${value}" />
    </label>
  `;
}

function liveSelectValuesTemplate(componentId, path, values, value) {
  return `
    <select data-live-component-id="${esc(componentId)}" data-live-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function sceneFingerprintTemplate(components) {
  if (!components.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  const withThumbs = components.filter((component) => component.thumbnail);
  if (!withThumbs.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  return `
    <div class="scene-fingerprint">
      ${withThumbs.slice(0, 5).map((component, index) => `
        <img src="${esc(component.thumbnail)}" alt="" loading="lazy" style="--fingerprint-index: ${index}; --fingerprint-count: ${withThumbs.length};" />
      `).join("")}
    </div>
  `;
}

function componentAssignmentTemplate(routeBase, state, route = {}, catalog = {}) {
  const options = [
    { id: "", type: "empty", name: "Empty", thumbnail: "", componentId: "", outputFrameId: "" },
    ...(catalog.sources || sceneSourceNodes(state)),
  ];
  return `
    <div class="field component-assignment-field" data-component-filter-scope>
      <span>Component</span>
      ${componentCatalogToolsTemplate("scene", catalog.sortMode || "recent", "Filter sources")}
      <div class="component-card-list assignment-card-list">
        ${options.map((node) => {
          const selected = node.id === route.sourceNodeId;
          return `
            <button type="button" class="component-card assignment-card ${selected ? "is-selected" : ""}" data-component-filter-card="${esc(node.name.toLowerCase())}" data-set-route-source-node="${esc(node.id)}" data-route-base="${esc(routeBase)}">
              ${thumbnailTemplate(node.thumbnail, node.type === "empty" ? "hide_image" : node.type === "recording-frame" ? "select_all" : "account_tree")}
              ${componentCardBarTemplate(node.name)}
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function pathForSurface(state, surface) {
  return `surfaces.${state.surfaces.findIndex((item) => item.id === surface.id)}`;
}

function pathForScene(state, scene) {
  return `scenes.${state.scenes.findIndex((item) => item.id === scene.id)}`;
}
