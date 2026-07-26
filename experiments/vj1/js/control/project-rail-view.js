import { catalogMarkerButtonTemplate, componentCatalogSearchText, componentCatalogToolsTemplate, componentFilterTemplate } from "./catalog-view.js";
import { getLiveSourceTarget, sceneComponents, ordinaryComponents } from "./control-selectors.js";
import { liveComponentPillTemplate, liveProgramNavigableComponents, liveScenePillTemplate, liveTargetComponentPillTemplate, mappingPillTemplate, mappingSurfacePillTemplate, mappingSurfaceSectionTemplate } from "./mapping-live-view.js";
import { componentCardBarTemplate, railListSectionTemplate, textListItemTemplate } from "./view-primitives.js";
import { esc, icon, thumbnailTemplate } from "./template-utils.js";
import { liveSurfaceVisible } from "../domain/live-ui-state.js";
import { listProjectIsfTransitions } from "../libraries/isf-engine/index.js";
import {
  DefaultBuiltInTransition,
  listBuiltInTransitionEntries,
} from "../libraries/visual-nodes/catalog.js";
import { createTransitionCatalog } from "../libraries/transition-engine/index.js";
import { componentTypeIcon, UI_ICONS } from "./ui-icons.js";

export function projectRailTemplate(state, {
  workspace = "mapping",
  catalogItems = (_scope, items) => items,
  catalogSortMode = () => "recent",
  transitionEntries = null,
  renderSelection = true,
} = {}) {
  if (workspace === "component") return componentToolsTemplate(state, catalogItems, catalogSortMode, renderSelection);
  if (workspace === "scene") return sceneToolsTemplate(state, catalogItems, catalogSortMode, renderSelection);
  if (workspace === "mapping") return mappingToolsTemplate(state, catalogItems, catalogSortMode, renderSelection);
  if (workspace === "live") {
    return liveToolsTemplate(
      state,
      catalogItems,
      catalogSortMode,
      transitionEntries,
    );
  }
  return "";
}

export function liveProjectionRailTemplate(state) {
  const mapping = state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  const sceneMappingVisible = state.ui?.live?.sceneMappingVisible !== false;
  const surfaces = mapping?.surfaces || [];
  const requestedSelectedId = String(state.ui?.live?.previewSurfaceId || "__mapping__");
  const selectedId = requestedSelectedId;
  const sourceTarget = getLiveSourceTarget(state);
  const overallTarget = state.components?.find((component) =>
    !component.systemRole && String(component.id) === String(state.ui?.live?.selectedComponentId || "")
  ) || state.components?.find((component) =>
    component.type === "scene" && String(component.id) === String(state.ui?.live?.selectedSceneId || "")
  );
  const overallHasSource = state.ui?.live?.overallSourceCleared !== true && Boolean(overallTarget);
  const components = liveProgramNavigableComponents(state);
  const item = ({ id, iconName, label, leadingHtml = "", removeAction = "", removeTitle = "Remove", selectable = true }) => textListItemTemplate({
    rowClass: `live-projection-row compact-list-row${selectable ? "" : " is-disabled"}`,
    selected: selectedId === id,
    leadingHtml: leadingHtml || `<span class="text-list-static-icon" aria-hidden="true">${icon(iconName)}</span>`,
    label,
    mainClass: "list-select",
    mainAction: selectable ? "data-live-preview-surface" : "",
    mainActionId: id,
    removeAction,
    removeActionId: id,
    removeTitle,
  });
  const projectionItems = `${item({
          id: "__mapping__",
          iconName: "crop_free",
          label: "Scene Mapping",
          leadingHtml: `<button type="button" class="enable-toggle ${sceneMappingVisible ? "is-enabled" : ""}" data-live-surface-visibility="__mapping__" title="${sceneMappingVisible ? "Hide" : "Show"} Scene Mapping" aria-label="${sceneMappingVisible ? "Hide" : "Show"} Scene Mapping">${icon(sceneMappingVisible ? "crop_free" : "hide_source")}</button>`,
          removeAction: sceneMappingVisible && overallHasSource ? "data-clear-live-overall-component" : "",
          removeTitle: "Clear Overall source",
        })}${surfaces.map((surface) => {
          const direct = surface.destination?.type === "direct";
          const visible = liveSurfaceVisible(surface, state.ui?.live);
          const patched = Boolean(state.ui?.live?.surfacePatches?.[surface.id]);
          return item({
            id: String(surface.id),
            iconName: visible ? (direct ? "desktop_windows" : "crop_free") : "hide_source",
            label: surface.name || "Surface",
            leadingHtml: `<button type="button" class="enable-toggle ${visible ? "is-enabled" : ""}" data-live-surface-visibility="${esc(surface.id)}" title="${visible ? "Hide" : "Show"} ${esc(surface.name || "Surface")}" aria-label="${visible ? "Hide" : "Show"} ${esc(surface.name || "Surface")}">${icon(visible ? (direct ? "desktop_windows" : "crop_free") : "hide_source")}</button>`,
            removeAction: patched ? "data-clear-live-surface-patch" : "",
            removeTitle: "Clear custom source",
          });
        }).join("")}`;
  return `${railListSectionTemplate({
    iconName: "view_column",
    title: "Output",
    content: projectionItems,
    emptyText: "No output surfaces",
    className: "live-projection-section",
    listClassName: "live-projection-list",
    scrollKey: "live-projection-targets",
  })}${railListSectionTemplate({
    iconName: UI_ICONS.component,
    title: "Components",
    content: components.map((component) => liveComponentPillTemplate(component, state)).join(""),
    emptyText: "No Components",
    className: "live-component-rail-section",
    listClassName: "scene-card-list live-component-list",
    scrollKey: `live-scene-components:${sourceTarget?.id || "none"}`,
  })}`;
}

function addableRailTitleTemplate(iconName, title, actionAttribute, actionLabel) {
  return `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${iconName}</span><span>${esc(title)}</span><button class="rail-title-add" type="button" ${actionAttribute} title="${esc(actionLabel)}" aria-label="${esc(actionLabel)}">${icon("add")}</button></div>`;
}

function componentToolsTemplate(state, catalogItems, catalogSortMode, renderSelection) {
  const components = catalogItems("component", ordinaryComponents(state));
  return railListSectionTemplate({
    headerHtml: addableRailTitleTemplate(UI_ICONS.component, "Components", "data-add-component", "Add component"),
    beforeListHtml: componentCatalogToolsTemplate("component", catalogSortMode("component"), "Filter components"),
    content: components.map((component) => componentPillTemplate(component, state, renderSelection)).join(""),
    emptyText: "Create visual recipes",
    listClassName: "component-card-list",
    scrollKey: "component-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="component-list"',
  });
}

function sceneToolsTemplate(state, catalogItems, catalogSortMode, renderSelection) {
  const scenes = catalogItems("scene", sceneComponents(state));
  return `${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate(UI_ICONS.scene, "Scenes", "data-add-scene", "Add scene"),
    beforeListHtml: componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes"),
    content: scenes.map((component) => componentPillTemplate(component, state, renderSelection)).join(""),
    emptyText: "Create a scene",
    listClassName: "component-card-list",
    scrollKey: "scene-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="scene-list"',
  })}${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate(UI_ICONS.surface, "Surfaces", "data-add-surface", "Add surface"),
    content: (state.surfaces || []).map((surface) => mappingSurfacePillTemplate(surface, state, {
      selected: renderSelection && state.ui.selectedSurfaceId === surface.id,
    })).join(""),
    emptyText: "Add a surface",
    className: "mapping-surface-rail-section",
    listClassName: "surface-pills",
    scrollKey: "scene-surfaces",
    listAttributes: 'data-surface-reorder-list data-paste-scope="surface-list"',
  })}`;
}

function mappingToolsTemplate(state, catalogItems, catalogSortMode, renderSelection) {
  const mappings = catalogItems("mapping", state.mappings || []);
  return `${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate(UI_ICONS.mapping, "Mappings", "data-add-mapping", "Add mapping"),
    beforeListHtml: componentCatalogToolsTemplate("mapping", catalogSortMode("mapping"), "Filter mappings"),
    content: mappings.map((mapping) => mappingPillTemplate(mapping, state, {
      selected: renderSelection && state.ui.selectedMappingId === mapping.id,
    })).join(""),
    emptyText: "Add a mapping",
    listClassName: "mapping-text-list",
    scrollKey: "mapping-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="mapping-list"',
  })}${mappingSurfaceSectionTemplate(state, { renderSelection })}`;
}

function liveToolsTemplate(
  state,
  catalogItems,
  catalogSortMode,
  transitionEntries,
) {
  const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
  const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
  const transitions = createTransitionCatalog(
    transitionEntries || [
      ...listBuiltInTransitionEntries(),
      ...listProjectIsfTransitions(state),
    ],
  ).list();
  const transitionId = String(
    state.ui?.live?.transitionId || DefaultBuiltInTransition.id,
  );
  const selectedTransition = transitions.find((item) => item.id === transitionId) || transitions[0];
  const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
  const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch;
  const performanceScenes = sceneComponents(state);
  const showScenes = state.ui?.live?.showScenes !== false;
  const showComponents = state.ui?.live?.showComponents === true;
  const sources = catalogItems("live", [
    ...(showScenes ? performanceScenes : []),
    ...(showComponents ? ordinaryComponents(state) : []),
  ]);
  const cards = sources.map((source) => source.type === "scene"
    ? liveScenePillTemplate(source, state)
    : liveTargetComponentPillTemplate(source, state)
  ).join("");
  return `${railListSectionTemplate({
    iconName: UI_ICONS.live,
    title: "Sources",
    beforeListHtml: `<div class="ui-list-tools"><div class="live-component-view-tabs live-source-kind-tabs" role="group" aria-label="Live source type">
        <button type="button" class="live-component-view-tab inspector-view-option ${showScenes ? "is-selected" : ""}" data-live-source-filter="scenes" aria-pressed="${showScenes}">${icon(UI_ICONS.scene)} Scenes</button>
        <button type="button" class="live-component-view-tab inspector-view-option ${showComponents ? "is-selected" : ""}" data-live-source-filter="components" aria-pressed="${showComponents}">${icon(UI_ICONS.component)} Parts</button>
      </div>
      ${componentCatalogToolsTemplate("live", catalogSortMode("live"), "Filter sources")}</div>`,
    content: cards,
    emptyText: "Create a Scene or Part first",
    listClassName: "scene-card-list live-scene-list",
    scrollKey: `live-sources:${showScenes ? "s" : ""}${showComponents ? "c" : ""}`,
    sectionAttributes: "data-component-filter-scope",
  })}<div class="ui-section rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">tune</span><span>Live</span><button class="rail-title-add" type="button" data-reset-live-session title="Reset Live output state" aria-label="Reset Live output state">${icon("restart_alt")}</button></div>
      <div class="sculpt-card parameter-surface live-timing-params">
      <label class="field">
        <span>Transition style</span>
        <select class="param-select" data-update="ui.live.transitionId">
          ${transitions.map((item) => `<option value="${esc(item.id)}" ${item.id === selectedTransition.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
        </select>
      </label>
      ${transitionParameterControls(selectedTransition, state.ui?.live?.transitionParameters || {})}
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
      </div>
    </div>`;
}

function transitionParameterControls(transition, values) {
  return (transition?.parameters || []).map((param) => {
    const path = `ui.live.transitionParameters.${param.id}`;
    const value = values[param.id] ?? param.defaultValue;
    if (param.type === "boolean") {
      return `<label class="field inline-param"><span>${esc(param.label || param.id)}</span><input type="checkbox" data-update="${esc(path)}" ${value ? "checked" : ""} /></label>`;
    }
    if (param.type === "enum") {
      return `<label class="field"><span>${esc(param.label || param.id)}</span><select class="param-select" data-update="${esc(path)}">${(param.values || []).map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    }
    if (param.type === "color") {
      return `<label class="field"><span>${esc(param.label || param.id)}</span><input type="color" data-update="${esc(path)}" value="${esc(value || "#ffffffff").slice(0, 7)}" /></label>`;
    }
    return `<label class="field range-field"><span>${esc(param.label || param.id)}</span><output class="range-value" data-range-value>${Number(value).toFixed(2)}</output><input type="range" min="${Number(param.min ?? 0)}" max="${Number(param.max ?? 1)}" step="${Number(param.step ?? 0.01)}" data-update="${esc(path)}" value="${Number(value)}" /></label>`;
  }).join("");
}

function componentPillTemplate(component, state, renderSelection = true) {
  const selected = renderSelection && state.ui.selectedComponentId === component.id;
  const fallbackIcon = componentTypeIcon(component);
  const removeDisabled = component.type !== "scene"
    ? ordinaryComponents(state).length <= 1
    : state.components.length <= 1;
  return `
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(componentCatalogSearchText(component))}">
      <button type="button" class="component-card ${selected ? "is-selected" : ""}" data-select-component="${esc(component.id)}">
        ${thumbnailTemplate(component.thumbnail, fallbackIcon, component.id)}
        ${componentCardBarTemplate(component.name, fallbackIcon)}
      </button>
      ${catalogMarkerButtonTemplate(component, "component")}
      <button type="button" class="component-card-remove" data-remove-component="${esc(component.id)}" title="Remove" aria-label="Remove ${esc(component.name)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>
    </div>`;
}
