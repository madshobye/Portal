import { catalogMarkerButtonTemplate, componentCatalogToolsTemplate, componentFilterTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { canvasComponents, ordinaryComponents, selectedCanvasComponent } from "./control-selectors.js?v=control-selectors-extraction-1";
import { mappingInletsTemplate } from "./mapping-view.js?v=scroll-region-1";
import { liveComponentPillTemplate, liveNavigableComponents, liveScenePillTemplate, scenePillTemplate, sceneRailConfigTemplate, sceneSurfacePillTemplate } from "./scene-live-view.js?v=isf-nodes-1";
import { componentCardBarTemplate, textListItemTemplate } from "./view-primitives.js?v=scroll-region-1";
import { emptyNote, esc, icon, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";

export function projectRailTemplate(state, {
  workspace = "scene",
  catalogItems = (_scope, items) => items,
  catalogSortMode = () => "recent",
} = {}) {
  if (workspace === "component") return componentToolsTemplate(state, catalogItems, catalogSortMode);
  if (workspace === "canvas") return canvasToolsTemplate(state, catalogItems, catalogSortMode);
  if (workspace === "mapping") return mappingToolsTemplate(state);
  if (workspace === "live") return liveToolsTemplate(state, catalogItems, catalogSortMode);
  return sceneToolsTemplate(state, catalogItems, catalogSortMode);
}

function addableRailTitleTemplate(iconName, title, actionAttribute, actionLabel) {
  return `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${iconName}</span><span>${esc(title)}</span><button class="rail-title-add" type="button" ${actionAttribute} title="${esc(actionLabel)}" aria-label="${esc(actionLabel)}">${icon("add")}</button></div>`;
}

function componentToolsTemplate(state, catalogItems, catalogSortMode) {
  const components = catalogItems("component", ordinaryComponents(state));
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      ${addableRailTitleTemplate("account_tree", "Components", "data-add-component", "Add component")}
      ${componentCatalogToolsTemplate("component", catalogSortMode("component"), "Filter components")}
      <div class="component-card-list rail-scroll-list" data-scroll-region data-scroll-key="component-catalog" data-paste-scope="component-list">
        ${components.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create visual recipes")}
      </div>
    </div>`;
}

function canvasToolsTemplate(state, catalogItems, catalogSortMode) {
  const canvases = catalogItems("canvas", canvasComponents(state));
  const selectedCanvas = selectedCanvasComponent(state);
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      ${addableRailTitleTemplate("dashboard_customize", "Canvases", "data-add-canvas-component", "Add canvas")}
      ${componentCatalogToolsTemplate("canvas", catalogSortMode("canvas"), "Filter canvases")}
      <div class="component-card-list rail-scroll-list" data-scroll-region data-scroll-key="canvas-catalog" data-paste-scope="canvas-list">
        ${canvases.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create a canvas component")}
      </div>
    </div>
    <div class="ui-section rail-section rail-list-section canvas-frame-rail-section">
      ${addableRailTitleTemplate("select_all", "Frames", `data-add-canvas-frame data-canvas-component-id="${esc(selectedCanvas?.id || "")}" ${selectedCanvas ? "" : "disabled"}`, "Add recording frame")}
      <div class="recording-frame-pills rail-scroll-list" data-scroll-region data-scroll-key="recording-frames">
        ${(state.recordingFrames || []).map((frame, index) => canvasFramePillTemplate(frame, index, selectedCanvas)).join("") || emptyNote("Add a recording frame")}
      </div>
    </div>`;
}

function sceneToolsTemplate(state, catalogItems, catalogSortMode) {
  const scenes = catalogItems("scene", state.scenes || []);
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      ${addableRailTitleTemplate("auto_awesome_motion", "Scenes", "data-add-scene", "Add empty scene")}
      ${componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes")}
      <div class="scene-card-list rail-scroll-list" data-scroll-region data-scroll-key="scene-catalog" data-paste-scope="scene-list">
        ${scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Add a scene")}
      </div>
    </div>
    ${sceneRailConfigTemplate(state)}
    <div class="ui-section rail-section rail-list-section scene-surface-rail-section">
      ${addableRailTitleTemplate("select_all", "Surfaces", "data-add-surface", "Add surface")}
      <div class="surface-pills rail-scroll-list" data-scroll-region data-scroll-key="scene-surfaces" data-surface-reorder-list data-paste-scope="surface-list">
        ${state.surfaces.map((surface) => sceneSurfacePillTemplate(surface, state)).join("")}
      </div>
    </div>`;
}

function liveToolsTemplate(state, catalogItems, catalogSortMode) {
  const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
  const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
  const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
  const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch;
  const liveScene = state.scenes.find((scene) => scene.id === (state.ui?.live?.selectedSceneId || state.scenes[0]?.id));
  const components = liveNavigableComponents(liveScene, state);
  const scenes = catalogItems("scene", state.scenes || []);
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live Scenes</span></div>
      ${componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes")}
      <div class="scene-card-list live-scene-list rail-scroll-list" data-scroll-region data-scroll-key="live-scenes">
        ${scenes.map((scene) => liveScenePillTemplate(scene, state)).join("") || emptyNote("Capture scenes first")}
      </div>
    </div>
    <div class="ui-section rail-section rail-list-section live-component-rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Scene components</span></div>
      <div class="component-card-list live-component-picker-list rail-scroll-list" data-scroll-region data-scroll-key="live-components">
        ${components.map((component) => liveComponentPillTemplate(component, state)).join("") || emptyNote("No active components")}
      </div>
    </div>
    <div class="ui-section rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">tune</span><span>Timing</span></div>
      <label class="field range-field live-time-scale">
        <span>Time stretch</span>
        <output class="range-value" data-range-value>${timeStretch.toFixed(2)} · ${timeScale < 0.1 ? timeScale.toFixed(3) : timeScale.toFixed(2)}×</output>
        <input type="range" min="-4" max="4" step="0.01" data-range-format="time-stretch" data-update="global.timeStretch" value="${timeStretch}" />
      </label>
      <label class="field range-field live-transition-duration">
        <span>Transition</span>
        <output class="range-value" data-range-value>${transitionDuration.toFixed(1)} s</output>
        <input type="range" min="0" max="10" step="0.1" data-range-suffix=" s" data-update="ui.live.transitionDuration" value="${transitionDuration}" />
      </label>
      <label class="field range-field live-param-fade-duration">
        <span>Param fade</span>
        <output class="range-value" data-range-value>${paramFadeDuration.toFixed(2)} s</output>
        <input type="range" min="0" max="10" step="0.05" data-range-suffix=" s" data-update="ui.live.paramFadeDuration" value="${paramFadeDuration}" />
      </label>
    </div>`;
}

function mappingToolsTemplate(state) {
  const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
  return `
    <div class="ui-section rail-section" data-component-filter-scope>
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">schema</span><span>Node Patch</span></div>
      ${componentFilterTemplate()}
      <div class="component-card-list" data-scroll-region data-scroll-key="mapping-components">
        ${state.components.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create a component")}
      </div>
    </div>
    <div class="ui-section rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">input</span><span>Inlets</span></div>
      <div class="node-chip-list">${mappingInletsTemplate(selectedComponent)}</div>
    </div>
    <div class="ui-section rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">output</span><span>Outlets</span></div>
      <div class="node-chip-list">
        <div class="node-chip"><span>texture</span><small>component output</small></div>
        <div class="node-chip"><span>event</span><small>manual lane</small></div>
      </div>
    </div>`;
}

function componentPillTemplate(component, state) {
  const selected = state.ui.selectedComponentId === component.id;
  const fallbackIcon = component.type === "canvas" ? "dashboard_customize" : "account_tree";
  const removeDisabled = component.type !== "canvas"
    ? ordinaryComponents(state).length <= 1
    : state.components.length <= 1;
  return `
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(component.name.toLowerCase())}">
      <button type="button" class="component-card ${selected ? "is-selected" : ""}" data-select-component="${esc(component.id)}">
        ${thumbnailTemplate(component.thumbnail, fallbackIcon)}
        ${componentCardBarTemplate(component.name)}
      </button>
      ${catalogMarkerButtonTemplate(component, "component")}
      <button type="button" class="component-card-remove" data-remove-component="${esc(component.id)}" title="Remove" aria-label="Remove ${esc(component.name)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>
    </div>`;
}

function canvasFramePillTemplate(frame, index, component) {
  const label = frame.name || `Frame ${index + 1}`;
  return textListItemTemplate({
    rowClass: "list-row compact-list-row",
    leadingHtml: `<span class="text-list-static-icon" aria-hidden="true">${icon("select_all")}</span>`,
    label,
    meta: "Shared",
    mainClass: "list-select recording-frame-label",
    removeClass: "list-remove",
    removeAttributes: `data-canvas-component-id="${esc(component?.id || "")}" data-remove-canvas-frame="${esc(frame.id)}"`,
    removeTitle: "Remove recording frame",
  });
}
