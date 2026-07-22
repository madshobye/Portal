import { catalogMarkerButtonTemplate, componentCatalogToolsTemplate, componentFilterTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { getLiveSourceTarget, sceneComponents, ordinaryComponents } from "./control-selectors.js?v=surface-relative-aspect-1";
import { liveComponentPillTemplate, liveProgramNavigableComponents, liveScenePillTemplate, liveTargetComponentPillTemplate, mappingPillTemplate, mappingRailConfigTemplate, mappingSurfacePillTemplate } from "./mapping-live-view.js?v=mapping-surface-section-1";
import { componentCardBarTemplate, railListSectionTemplate, textListItemTemplate } from "./view-primitives.js?v=uniform-section-hierarchy-1";
import { esc, icon, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";

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

export function liveProjectionRailTemplate(state) {
  const mapping = state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  const selectedId = String(state.ui?.live?.previewSurfaceId || "__mapping__");
  const surfaces = mapping?.surfaces || [];
  const sourceTarget = getLiveSourceTarget(state);
  const overallTarget = state.components?.find((component) =>
    !component.systemRole && String(component.id) === String(state.ui?.live?.selectedComponentId || "")
  ) || state.components?.find((component) =>
    component.type === "scene" && String(component.id) === String(state.ui?.live?.selectedSceneId || "")
  );
  const overallHasSource = state.ui?.live?.overallSourceCleared !== true && Boolean(overallTarget);
  const sceneMappingVisible = state.ui?.live?.sceneMappingVisible !== false;
  const components = liveProgramNavigableComponents(state);
  const item = ({ id, iconName, label, leadingHtml = "", removeAction = "", removeTitle = "Remove" }) => textListItemTemplate({
    rowClass: "live-projection-row compact-list-row",
    selected: selectedId === id,
    leadingHtml: leadingHtml || `<span class="text-list-static-icon" aria-hidden="true">${icon(iconName)}</span>`,
    label,
    mainClass: "list-select",
    mainAction: "data-live-preview-surface",
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
          removeAction: overallHasSource ? "data-clear-live-overall-component" : "",
          removeTitle: "Clear Overall source",
        })}${surfaces.map((surface) => {
          const direct = surface.destination?.type === "direct";
          const liveRoute = state.ui?.live?.surfaceRoutes?.surfaces?.find((candidate) => String(candidate.id) === String(surface.id));
          const visible = liveRoute ? liveRoute.enabled !== false : surface.enabled !== false;
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
    iconName: "account_tree",
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

function componentToolsTemplate(state, catalogItems, catalogSortMode) {
  const components = catalogItems("component", ordinaryComponents(state));
  return railListSectionTemplate({
    headerHtml: addableRailTitleTemplate("account_tree", "Components", "data-add-component", "Add component"),
    beforeListHtml: componentCatalogToolsTemplate("component", catalogSortMode("component"), "Filter components"),
    content: components.map((component) => componentPillTemplate(component, state)).join(""),
    emptyText: "Create visual recipes",
    listClassName: "component-card-list",
    scrollKey: "component-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="component-list"',
  });
}

function sceneToolsTemplate(state, catalogItems, catalogSortMode) {
  const scenes = catalogItems("scene", sceneComponents(state));
  return `${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate("dashboard_customize", "Scenes", "data-add-scene", "Add scene"),
    beforeListHtml: componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes"),
    content: scenes.map((component) => componentPillTemplate(component, state)).join(""),
    emptyText: "Create a scene",
    listClassName: "component-card-list",
    scrollKey: "scene-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="scene-list"',
  })}${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate("select_all", "Surfaces", "data-add-surface", "Add surface"),
    content: (state.surfaces || []).map((surface) => mappingSurfacePillTemplate(surface, state)).join(""),
    emptyText: "Add a surface",
    className: "mapping-surface-rail-section",
    listClassName: "surface-pills",
    scrollKey: "scene-surfaces",
    listAttributes: 'data-surface-reorder-list data-paste-scope="surface-list"',
  })}`;
}

function mappingToolsTemplate(state, catalogItems, catalogSortMode) {
  const mappings = catalogItems("mapping", state.mappings || []);
  return `${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate("auto_awesome_motion", "Mappings", "data-add-mapping", "Add mapping"),
    beforeListHtml: componentCatalogToolsTemplate("mapping", catalogSortMode("mapping"), "Filter mappings"),
    content: mappings.map((mapping) => mappingPillTemplate(mapping, state)).join(""),
    emptyText: "Add a mapping",
    listClassName: "mapping-text-list",
    scrollKey: "mapping-catalog",
    sectionAttributes: "data-component-filter-scope",
    listAttributes: 'data-paste-scope="mapping-list"',
  })}${mappingRailConfigTemplate(state)}${railListSectionTemplate({
    headerHtml: addableRailTitleTemplate("select_all", "Surfaces", "data-add-surface", "Add surface"),
    content: state.surfaces.map((surface) => mappingSurfacePillTemplate(surface, state)).join(""),
    emptyText: "Add a surface",
    className: "mapping-surface-rail-section",
    listClassName: "surface-pills",
    scrollKey: "mapping-surfaces",
    listAttributes: 'data-surface-reorder-list data-paste-scope="surface-list"',
  })}`;
}

function liveToolsTemplate(state, catalogItems, catalogSortMode) {
  const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
  const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
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
    iconName: "play_circle",
    title: "Sources",
    beforeListHtml: `<div class="ui-list-tools"><div class="live-component-view-tabs live-source-kind-tabs" role="group" aria-label="Live source type">
        <button type="button" class="live-component-view-tab ${showScenes ? "is-selected" : ""}" data-live-source-filter="scenes" aria-pressed="${showScenes}">${icon("dashboard_customize")} Scenes</button>
        <button type="button" class="live-component-view-tab ${showComponents ? "is-selected" : ""}" data-live-source-filter="components" aria-pressed="${showComponents}">${icon("account_tree")} Parts</button>
      </div>
      ${componentCatalogToolsTemplate("live", catalogSortMode("live"), "Filter sources")}</div>`,
    content: cards,
    emptyText: "Create a Scene or Part first",
    listClassName: "scene-card-list live-scene-list",
    scrollKey: `live-sources:${showScenes ? "s" : ""}${showComponents ? "c" : ""}`,
    sectionAttributes: "data-component-filter-scope",
  })}<div class="ui-section rail-section">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">tune</span><span>Timing</span></div>
      <div class="sculpt-card live-timing-params">
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
