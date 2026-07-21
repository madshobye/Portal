import { catalogMarkerButtonTemplate, componentCatalogToolsTemplate, componentFilterTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { sceneComponents, ordinaryComponents, selectedSceneComponent } from "./control-selectors.js?v=scene-mapping-1";
import { liveScenePillTemplate, liveTargetComponentPillTemplate, mappingPillTemplate, mappingRailConfigTemplate, mappingSurfacePillTemplate } from "./mapping-live-view.js?v=live-source-target-1";
import { componentCardBarTemplate, textListItemTemplate } from "./view-primitives.js?v=scroll-region-1";
import { emptyNote, esc, icon, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";

export function projectRailTemplate(state, {
  workspace = "mapping",
  catalogItems = (_scope, items) => items,
  catalogSortMode = () => "recent",
} = {}) {
  if (workspace === "component") return componentToolsTemplate(state, catalogItems, catalogSortMode);
  if (workspace === "scene") return sceneToolsTemplate(state, catalogItems, catalogSortMode);
  if (workspace === "mapping") return mappingToolsTemplate(state, catalogItems, catalogSortMode);
  if (workspace === "live") return liveToolsTemplate(state, catalogItems, catalogSortMode);
  return "";
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

function sceneToolsTemplate(state, catalogItems, catalogSortMode) {
  const scenes = catalogItems("scene", sceneComponents(state));
  const selectedScene = selectedSceneComponent(state);
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      ${addableRailTitleTemplate("dashboard_customize", "Scenes", "data-add-scene", "Add scene")}
      ${componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes")}
      <div class="component-card-list rail-scroll-list" data-scroll-region data-scroll-key="scene-catalog" data-paste-scope="scene-list">
        ${scenes.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create a scene")}
      </div>
    </div>
    <div class="ui-section rail-section rail-list-section scene-frame-rail-section">
      ${addableRailTitleTemplate("select_all", "Frames", `data-add-frame data-scene-id="${esc(selectedScene?.id || "")}" ${selectedScene ? "" : "disabled"}`, "Add frame")}
      <div class="recording-frame-pills rail-scroll-list" data-scroll-region data-scroll-key="recording-frames">
        ${(state.frames || []).map((frame, index) => framePillTemplate(frame, index, selectedScene, state)).join("") || emptyNote("Add a frame")}
      </div>
    </div>`;
}

function mappingToolsTemplate(state, catalogItems, catalogSortMode) {
  const mappings = catalogItems("mapping", state.mappings || []);
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      ${addableRailTitleTemplate("auto_awesome_motion", "Mappings", "data-add-mapping", "Add mapping")}
      ${componentCatalogToolsTemplate("mapping", catalogSortMode("mapping"), "Filter mappings")}
      <div class="mapping-text-list rail-scroll-list" data-scroll-region data-scroll-key="mapping-catalog" data-paste-scope="mapping-list">
        ${mappings.map((mapping) => mappingPillTemplate(mapping, state)).join("") || emptyNote("Add a mapping")}
      </div>
    </div>
    ${mappingRailConfigTemplate(state)}
    <div class="ui-section rail-section rail-list-section mapping-surface-rail-section">
      ${addableRailTitleTemplate("select_all", "Surfaces", "data-add-surface", "Add surface")}
      <div class="surface-pills rail-scroll-list" data-scroll-region data-scroll-key="mapping-surfaces" data-surface-reorder-list data-paste-scope="surface-list">
        ${state.surfaces.map((surface) => mappingSurfacePillTemplate(surface, state)).join("")}
      </div>
    </div>`;
}

function liveToolsTemplate(state, catalogItems, catalogSortMode) {
  const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
  const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
  const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
  const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch;
  const performanceScenes = sceneComponents(state);
  const sourceKind = state.ui?.live?.sourceKind === "component" ? "component" : "scene";
  const sources = sourceKind === "scene"
    ? catalogItems("scene", performanceScenes)
    : catalogItems("component", ordinaryComponents(state));
  const cards = sourceKind === "scene"
    ? sources.map((scene) => liveScenePillTemplate(scene, state)).join("")
    : sources.map((component) => liveTargetComponentPillTemplate(component, state)).join("");
  return `
    <div class="ui-section rail-section rail-list-section" data-component-filter-scope>
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live sources</span></div>
      <div class="live-component-view-tabs live-source-kind-tabs" role="group" aria-label="Live source type">
        <button type="button" class="live-component-view-tab ${sourceKind === "scene" ? "is-selected" : ""}" data-live-source-kind="scene" aria-pressed="${sourceKind === "scene"}">${icon("dashboard_customize")} Scenes</button>
        <button type="button" class="live-component-view-tab ${sourceKind === "component" ? "is-selected" : ""}" data-live-source-kind="component" aria-pressed="${sourceKind === "component"}">${icon("account_tree")} Components</button>
      </div>
      ${componentCatalogToolsTemplate(sourceKind, catalogSortMode(sourceKind), `Filter ${sourceKind}s`)}
      <div class="scene-card-list live-scene-list rail-scroll-list" data-scroll-region data-scroll-key="live-sources:${sourceKind}">
        ${cards || emptyNote(sourceKind === "scene" ? "Create scenes first" : "Create components first")}
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

function componentPillTemplate(component, state) {
  const selected = state.ui.selectedComponentId === component.id;
  const fallbackIcon = component.type === "scene" ? "dashboard_customize" : "account_tree";
  const removeDisabled = component.type !== "scene"
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

function framePillTemplate(frame, index, component, state) {
  const label = frame.name || `Frame ${index + 1}`;
  return textListItemTemplate({
    rowClass: "list-row compact-list-row",
    selected: state.ui.selectedFrameId === frame.id,
    leadingHtml: `<span class="text-list-static-icon" aria-hidden="true">${icon("select_all")}</span>`,
    label,
    meta: frame.kind === "output" ? "Output" : "User",
    mainClass: "list-select recording-frame-label",
    mainAction: "data-select-frame",
    mainActionId: frame.id,
    removeClass: frame.kind === "output" ? "" : "list-remove",
    removeAttributes: frame.kind === "output" ? "" : `data-scene-id="${esc(component?.id || "")}" data-remove-frame="${esc(frame.id)}"`,
    removeTitle: "Remove frame",
  });
}
