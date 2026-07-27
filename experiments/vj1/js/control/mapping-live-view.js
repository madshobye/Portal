import { BLEND_MODES } from "../constants.js";
import { createLiveComponentView, sceneSourceNodes, sourceBackedMediaId } from "../domain/models.js";
import {
  currentLiveProgramComponentIds,
  liveProgramComponentIds,
} from "../domain/scene-routing.js";
import { normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { getGeneratorNodeComponent as getGeneratorComponent, getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js";
import { catalogMarkerButtonTemplate, componentCatalogSearchText, componentCatalogToolsTemplate } from "./catalog-view.js";
import { effectChainItemDisplayName, sourceChainItemDisplayName, sourceIcon } from "./component-view.js";
import { getLiveSelectedTarget, getMappingSurfaceView, getSelectedMapping, liveSceneComponents, liveSelectedSceneId, mappingFingerprintComponents } from "./control-selectors.js";
import { CHAIN_COMPOSITE_PARAMS, CHAIN_TRANSFORM_PARAMS, chainBoundaryPositionParams, chainGeneralControlsTemplate, chainParamViewDefinitions, chainTransformParams, componentParamViews, parameterGroupTemplate, paramControlTemplate, paramControlsTemplate, paramCurrentValue } from "./parameter-view.js";
import { effectIcon, emptyNote, esc, icon, rangeTemplate, selectValuesTemplate, thumbnailTemplate } from "./template-utils.js";
import { componentCardBarTemplate, deepEditButtonTemplate, elementListTemplate, emptyStateTemplate, enableToggleButton, panelTemplate, railListSectionTemplate, scrollRegionTemplate, selectablePillTemplate, textListItemTemplate, titleInputTemplate } from "./view-primitives.js";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js";
import { UI_ICONS } from "./ui-icons.js";
import { parameterAnimationTracks } from "../libraries/composition-engine/shared/parameter-animation-tracks.js";
import { getByPath } from "./path-input-utils.js";

const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];

export function mappingSurfacePillTemplate(surface, state, {
  selected = state.ui.selectedSurfaceId === surface.id,
} = {}) {
  // A caller may hold an executable Surface projection from `state.surfaces`.
  // That projection can be disabled because Scene Mapping is not currently
  // routed, but the eye in an authoring rail belongs exclusively to the
  // selected Mapping's Surface. Never derive this UI authority from routing.
  const authoredSurface = getMappingSurfaceView(surface, state);
  const enabled = authoredSurface.enabled !== false;
  const direct = authoredSurface.destination?.type === "direct";
  return selectablePillTemplate({
    rowClass: "list-row compact-list-row",
    selected,
    action: "data-select-surface",
    id: authoredSurface.id,
    // `selectablePillTemplate` derives the displayed disabled icon from
    // `toggleValue`; this remains the icon restored when the Surface is shown.
    iconName: direct ? "desktop_windows" : "crop_free",
    label: authoredSurface.name,
    meta: "",
    togglePath: `${pathForSurface(state, authoredSurface)}.enabled`,
    toggleValue: enabled,
    removeAction: direct ? "" : "data-remove-surface",
    removeDisabled: false,
    reorderable: true,
  });
}

export function sceneMappingOutputPillTemplate(state) {
  const included = state.ui?.live?.sceneMappingInLive !== false;
  return textListItemTemplate({
    rowClass: "mapping-scene-output-row compact-list-row",
    leadingHtml: `
      <button type="button" class="enable-toggle ${included ? "is-enabled" : ""}" data-scene-mapping-in-live="${included ? "true" : "false"}" title="${included ? "Disable" : "Enable"} Scene Mapping" aria-label="${included ? "Disable" : "Enable"} Scene Mapping">
        ${icon(included ? "crop_free" : "hide_source")}
      </button>
    `,
    label: "Scene Mapping",
  });
}

export function mappingSurfaceTemplate(surface, state, catalog = {}) {
  const mapping = getSelectedMapping(state);
  const surfaceBase = pathForSurface(state, surface);
  const mappingIndex = mapping ? state.mappings.findIndex((item) => item.id === mapping.id) : -1;
  const surfaceIndex = mapping?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasMappingSurface = mappingIndex >= 0 && surfaceIndex >= 0;
  const mappingSurface = hasMappingSurface ? mapping.surfaces[surfaceIndex] : null;
  const mappingBase = `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
  const direct = surface.destination?.type === "direct";
  return `
    <article class="sculpt-card inspector-control-surface">
      ${direct ? `<div class="soft-note">Direct output</div>` : ""}
      ${direct ? "" : `<div class="surface-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>`}
      ${rangeTemplate("Feather", `${surfaceBase}.feather`, surface.feather ?? 0, 0, 0.5, 0.005, 0)}
      ${hasMappingSurface ? `
        ${rangeTemplate("Presence", `${mappingBase}.opacity`, mappingSurface.opacity, 0, 1, 0.01, 1)}
        <label class="field"><span>${direct ? "Fit" : "Projection fit"}</span>${selectValuesTemplate(`${mappingBase}.projectionFit`, PROJECTION_FIT_MODES, mappingSurface.projectionFit || (direct ? "contain" : "cover"))}</label>
      ` : `<div class="soft-note">This surface is not part of the selected Mapping.</div>`}
    </article>
  `;
}

export function mappingSurfaceSectionTemplate(state, { renderSelection = true } = {}) {
  const mapping = getSelectedMapping(state);
  if (!mapping) {
    return railListSectionTemplate({
      iconName: UI_ICONS.surface,
      title: "Mapping",
      emptyText: "Create a mapping to edit its Surfaces.",
      className: "mapping-surface-rail-section",
      scrollKey: "mapping-surfaces",
    });
  }
  const base = pathForMapping(state, mapping);
  return railListSectionTemplate({
    headerHtml: `<div class="ui-section-header rail-title">
      <span class="material-symbols-rounded">select_all</span>
      ${titleInputTemplate(`${base}.name`, mapping.name)}
      <button class="rail-title-add" type="button" data-add-surface title="Add surface" aria-label="Add surface">${icon("add")}</button>
    </div>`,
    beforeListHtml: `<div class="mapping-test-pattern-toggle">
      ${enableToggleButton({
        path: "ui.mappingTestPattern",
        value: state.ui?.mappingTestPattern !== false,
        iconName: "grid_on",
        disabledIconName: "grid_on",
        label: "Test pattern",
        showLabel: true,
        className: "mapping-test-pattern-button",
      })}
    </div>`,
    // Mapping owns its authored Surface collection. `state.surfaces` is a
    // compatibility projection containing the executable preview routes and
    // must never decide which rows belong to the selected Mapping.
    content: `${sceneMappingOutputPillTemplate(state)}${mapping.surfaces.map((surface) => mappingSurfacePillTemplate(surface, state, {
      selected: renderSelection && state.ui.selectedSurfaceId === surface.id,
    })).join("")}`,
    emptyText: "Add a surface",
    className: "mapping-surface-rail-section",
    listClassName: "surface-pills",
    scrollKey: "mapping-surfaces",
    listAttributes: 'data-surface-reorder-list data-paste-scope="surface-list"',
  });
}

export function mappingPillTemplate(mapping, state, {
  selected = state.ui.selectedMappingId === mapping.id,
} = {}) {
  return `<div data-component-filter-card="${esc(mapping.name.toLowerCase())}">${textListItemTemplate({
    rowClass: "mapping-text-row compact-list-row",
    selected,
    leadingHtml: `<span class="text-list-static-icon" aria-hidden="true">${icon(UI_ICONS.mapping)}</span>`,
    label: mapping.name,
    mainClass: "list-select",
    mainAction: "data-select-mapping",
    mainActionId: mapping.id,
    removeClass: "list-remove",
    removeAction: "data-delete-mapping",
    removeActionId: mapping.id,
    removeTitle: "Remove mapping",
  })}</div>`;
}

export function liveScenePillTemplate(scene, state) {
  const live = state.ui?.live || {};
  const selectedTargetId = String(live.previewSurfaceId && live.previewSurfaceId !== "__mapping__"
    ? live.patchSourceId || ""
    : (live.overallSourceCleared === true ? "" : live.selectedComponentId || liveSelectedSceneId(state)));
  const selected = selectedTargetId === String(scene.id);
  return `
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(componentCatalogSearchText(scene))}">
      <button type="button" class="component-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
        ${thumbnailTemplate(scene.thumbnail, UI_ICONS.scene, scene.id)}
        ${componentCardBarTemplate(scene.name, UI_ICONS.scene)}
      </button>
      ${catalogMarkerButtonTemplate(scene, "scene")}
      ${liveTargetResetButtonTemplate(scene, state)}
    </div>
  `;
}

export function liveTargetComponentPillTemplate(component, state) {
  const live = state.ui?.live || {};
  const selectedId = live.previewSurfaceId && live.previewSurfaceId !== "__mapping__"
    ? live.patchSourceId || ""
    : live.selectedComponentId || "";
  const selected = String(selectedId) === String(component.id);
  return `
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(componentCatalogSearchText(component))}">
      <button type="button" class="component-card live-component-picker ${selected ? "is-selected" : ""}" data-live-target-component="${esc(component.id)}">
        ${thumbnailTemplate(component.thumbnail, UI_ICONS.component, component.id)}
        ${componentCardBarTemplate(component.name, UI_ICONS.component)}
      </button>
      ${catalogMarkerButtonTemplate(component, "component")}
      ${liveTargetResetButtonTemplate(component, state)}
    </div>
  `;
}

function liveTargetResetButtonTemplate(target, state) {
  const live = state.ui?.live || {};
  // `sceneOverrides` is the retained override bank for every Live target,
  // including Parts. The legacy name is persisted for project compatibility.
  const retainedOverrides = live.sceneOverrides?.[target.id] || {};
  const activeTargetId = String(live.selectedComponentId || live.selectedSceneId || "");
  const activeOverrides = activeTargetId === String(target.id) ? live.componentOverrides || {} : {};
  const hasOverrides =
    Object.keys(retainedOverrides).length > 0 ||
    Object.keys(activeOverrides).length > 0;
  if (!hasOverrides) return "";
  return `<button type="button" class="component-card-remove" data-reset-live-target="${esc(target.id)}" title="Reset temporary settings" aria-label="Reset temporary settings for ${esc(target.name)}">${icon("restart_alt")}</button>`;
}

export function liveInspectorTemplate(state) {
  const selected = getLiveSelectedTarget(state);
  if (!selected) return panelTemplate("tune", "Live", emptyStateTemplate("No sources"), { empty: true });
  const selectedView = selected ? createLiveComponentView(selected, state) : null;
  const selectedElement = selected ? selectedLiveChainItem(selectedView?.chain || [], selected.id, state) : null;
  const componentView = state.ui?.live?.componentView === "elements" ? "elements" : "controls";
  return `${selected ? liveComponentTemplate(selected, selectedView, selectedElement, state, componentView) : ""}${componentView === "elements" && selectedElement ? liveSelectedChainSettingsTemplate(selectedElement, selected.id, state) : ""}`
    || panelTemplate("tune", selected.name, emptyStateTemplate("No controls"));
}

export function liveComponentPillTemplate(component, state) {
  const selected = (state.ui?.live?.inspectedComponentId || "") === component.id;
  return `
    <button type="button" class="component-card live-component-picker ${selected ? "is-selected" : ""}" data-live-component="${esc(component.id)}">
      ${thumbnailTemplate(component.thumbnail, UI_ICONS.component, component.id)}
      ${componentCardBarTemplate(component.name, UI_ICONS.component)}
    </button>
  `;
}

export function liveNavigableComponents(scene, state) {
  const result = [];
  const seen = new Set();
  const visit = (component) => {
    if (!component || seen.has(component.id)) return;
    seen.add(component.id);
    result.push(component);
    for (const item of nestedChainItems(component.chain || [])) {
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

export function liveProgramSignificantControlsTemplate(state = {}) {
  const assignments = liveSignificantParameterAssignments(
    state,
    Number.MAX_SAFE_INTEGER,
  );
  return assignments.map((assignment) => {
    const component = state.components?.find((candidate) =>
      String(candidate.id) === String(assignment.componentId)
    );
    if (!component) return "";
    const value = liveSignificantAssignmentValue(assignment, component, state);
    if (!Number.isFinite(Number(value))) return "";
    const attrs = assignment.kind === "animation"
      ? [
          `data-live-component-id="${esc(component.id)}"`,
          `data-live-animation-target-node-id="${esc(assignment.targetNodeId)}"`,
          `data-live-animation-track-id="${esc(assignment.trackId)}"`,
          "data-live-animation-update",
        ].join(" ")
      : liveParamAttrs(component.id, assignment.itemId);
    return paramControlTemplate({
      id: assignment.field || assignment.path,
      label: assignment.name,
      type: "number",
      min: assignment.min,
      max: assignment.max,
      step: assignment.step || 0.01,
      scale: assignment.scale,
      defaultValue: value,
    }, assignment.field || assignment.path, value, attrs, { context: false });
  }).join("");
}

function liveSignificantAssignmentValue(assignment, component, state) {
  if (assignment.kind === "animation") {
    const override = state.ui?.live?.componentOverrides?.[component.id]
      ?.animation?.[assignment.trackId]?.fields?.[assignment.field];
    if (override !== undefined) return override;
    return parameterAnimationTracks(
      state.nodes,
      component.id,
      assignment.targetNodeId,
    ).find((track) => track.id === assignment.trackId)?.[assignment.field];
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
  collectSignificantParameterDefinitions(component.chain || [], {
    component,
    state,
    registry,
    relativeBase: "chain",
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

function collectSignificantParameterDefinitions(chain, {
  component,
  state,
  registry,
  relativeBase,
}) {
  for (let index = 0; index < (chain || []).length; index++) {
    const item = chain[index];
    const relativePath = `${relativeBase}.${index}`;
    const itemLabel = item?.name || item?.id || `Element ${index + 1}`;
    const register = (markedPath, updatePath, param) => {
      if (param?.type !== "number") return;
      const min = Number(param.min);
      const max = Number(param.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
      registry.set(markedPath, {
        id: `${component.id}:${updatePath}`,
        name: `${component.name} · ${param.label || param.id}`,
        detail: itemLabel,
        componentId: component.id,
        itemId: String(item?.id || ""),
        path: updatePath,
        min,
        max,
        step: Number(param.step) || 0,
        scale: param.scale === "log" ? "log" : "linear",
      });
    };

    for (const param of CHAIN_COMPOSITE_PARAMS) {
      register(`${relativePath}.${param.id}`, `${relativePath}.${param.id}`, param);
    }
    for (const param of chainTransformParams(item?.transform)) {
      register(
        `${relativePath}.transform.${param.id}`,
        `${relativePath}.transform.${param.id}`,
        param,
      );
    }
    for (const param of chainBoundaryPositionParams(item?.boundary)) {
      register(
        `${relativePath}.boundary.${param.id}`,
        `${relativePath}.boundary.${param.id}`,
        param,
      );
    }
    if (item?.kind === "group") {
      collectSignificantParameterDefinitions(item.chain || [], {
        component,
        state,
        registry,
        relativeBase: `${relativePath}.chain`,
      });
      continue;
    }
    const definitions = item?.kind === "effect"
      ? visualEffectComponent(state, item.componentId)?.params || []
      : sourceLiveParams(item?.source || {}, null, state);
    for (const param of definitions) {
      const updatePath = item?.kind === "source"
        ? `${relativePath}.source.params.${param.id}`
        : `${relativePath}.params.${param.id}`;
      register(updatePath, updatePath, param);
      if (item?.kind === "source") {
        register(`${relativePath}.params.${param.id}`, updatePath, param);
      }
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

export function sceneSignificantComponentTemplate(component, state) {
  const paths = new Set(component?.significantParams || []);
  const componentIndex = state.components?.findIndex((candidate) => candidate.id === component?.id) ?? -1;
  if (!component || componentIndex < 0 || !paths.size) return "";
  const controls = significantChainControls(component.chain || [], {
    componentId: component.id,
    relativeBase: "chain",
    updateBase: `components.${componentIndex}.chain`,
    paths,
    attrs: "data-update",
    media: state.media || [],
    state,
  });
  if (!controls) return "";
  return `<section class="ui-section focus-panel scene-significant-panel"><header class="ui-section-header panel-title"><span class="material-symbols-rounded">star</span><span>Significant · ${esc(component.name)}</span>${deepEditButtonTemplate(component.id, { className: "header-edit-button", label: `Edit ${component.name}` })}</header>${controls}</section>`;
}

function significantChainControls(chain, options) {
  const { componentId, relativeBase, updateBase, paths, attrs, media = [], state = {} } = options;
  return (chain || []).map((item, index) => {
    const controlAttrs = attrs.includes("data-live-update")
      ? liveParamAttrs(componentId, item.id)
      : attrs;
    const relativePath = `${relativeBase}.${index}`;
    const updatePath = `${updateBase}.${index}`;
    const nested = item.kind === "group" ? significantChainControls(item.chain || [], {
      ...options,
      relativeBase: `${relativePath}.chain`,
      updateBase: `${updatePath}.chain`,
    }) : "";
    const significantTransforms = chainTransformParams(item.transform)
      .filter((param) => paths.has(`${relativePath}.transform.${param.id}`));
    const transformControls = significantTransforms.length ? paramControlsTemplate(significantTransforms, {
      pathFor: (param) => `${updatePath}.transform.${param.id}`,
      valueFor: (param) => normalizeParamValue(param, item.transform?.[param.id]),
      attrs: controlAttrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    const significantComposite = CHAIN_COMPOSITE_PARAMS.filter((param) => paths.has(`${relativePath}.${param.id}`));
    const compositeControls = significantComposite.length ? paramControlsTemplate(significantComposite, {
      pathFor: (param) => `${updatePath}.${param.id}`,
      valueFor: (param) => normalizeParamValue(param, item?.[param.id]),
      attrs: controlAttrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    if (item.kind === "group") {
      const own = transformControls || compositeControls
        ? parameterGroupTemplate(item.name || "Group", `${compositeControls}${transformControls}`)
        : "";
      return `${own}${nested}`;
    }
    const definitions = item.kind === "effect"
      ? visualEffectComponent(state, item.componentId)?.params || []
      : sourceLiveParams(item.source || {}, media.find((entry) => entry.id === item.source?.mediaId), state);
    const significant = definitions.filter((param) => significantParamPath(
      paths,
      relativePath,
      param.id,
      item.kind === "source"
    ));
    if (!significant.length && !transformControls && !compositeControls) return "";
    const values = item.kind === "effect"
      ? item
      : { params: { ...(item.source?.params || {}) } };
    const contentControls = significant.length ? paramControlsTemplate(significant, {
      pathFor: (param) => significantParamUpdatePath({
        attrs,
        paths,
        relativePath,
        updatePath,
        paramId: param.id,
        source: item.kind === "source",
      }),
      valueFor: (param) => item.kind === "effect"
        ? paramCurrentValue(visualEffectComponent(state, item.componentId), values, param)
        : normalizeParamValue(param, values.params[param.id]),
      attrs: controlAttrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    const mediaItem = media.find((entry) => entry.id === item.source?.mediaId) || null;
    const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
    const label = item.kind === "source"
      ? sourceChainItemDisplayName(item, mediaItem, referencedComponent, state)
      : effectChainItemDisplayName(item, state);
    return parameterGroupTemplate(label, `${contentControls}${compositeControls}${transformControls}`);
  }).join("");
}

function significantParamPath(paths, relativePath, paramId, source = false) {
  if (paths.has(`${relativePath}.params.${paramId}`)) return true;
  return source && paths.has(`${relativePath}.source.params.${paramId}`);
}

function significantParamUpdatePath({ attrs, paths, relativePath, updatePath, paramId, source }) {
  const persistedSourcePath = `${relativePath}.source.params.${paramId}`;
  if (source) return `${updatePath}.source.params.${paramId}`;
  return `${updatePath}.params.${paramId}`;
}

function* nestedChainItems(chain = []) {
  for (const item of chain || []) {
    yield item;
    if (item?.kind === "group") yield* nestedChainItems(item.chain || []);
  }
}

function liveComponentTemplate(component, view, selectedElement, state, componentView = "controls") {
  return `
    <article class="ui-section focus-panel live-component-card">
      <header class="ui-section-header panel-title live-component-head">
        ${thumbnailTemplate(component.thumbnail, UI_ICONS.component, component.id)}
        <strong>${esc(component.name)}</strong>
        ${deepEditButtonTemplate(component.id, { className: "header-edit-button", label: `Edit ${component.name}` })}
      </header>
      <div class="live-component-view-tabs" role="group" aria-label="Live Component view">
        <button type="button" class="live-component-view-tab inspector-view-option ${componentView === "controls" ? "is-selected" : ""}" data-live-component-view="controls" aria-pressed="${componentView === "controls"}">${icon("tune")} Controls</button>
        <button type="button" class="live-component-view-tab inspector-view-option ${componentView === "elements" ? "is-selected" : ""}" data-live-component-view="elements" aria-pressed="${componentView === "elements"}">${icon(UI_ICONS.group)} Elements</button>
      </div>
      ${componentView === "controls"
        ? liveComponentControlsTemplate(component, view, state)
        : liveChainOutlineTemplate(view?.chain || [], component.id, selectedElement?.item?.id, "chain", state)}
    </article>
  `;
}

function liveComponentControlsTemplate(component, view, state = {}) {
  // A Scene is the composition root. Placement belongs to each element inside
  // that Scene; only an ordinary Component can itself be placed as content.
  const placementControls = component.type === "scene" ? "" : `
      <div class="live-component-transform-controls">
        <span class="live-control-group-label">Component placement</span>
        ${liveComponentPlacementControlsTemplate(view?.transform, component.id)}
      </div>`;
  return `
    <div class="live-component-controls inspector-control-surface" data-scroll-region data-scroll-key="live-controls:${esc(component.id)}">
      ${placementControls}
      ${liveRangeTemplate("Opacity", component.id, "opacity", view?.opacity ?? 1)}
      ${liveRangeTemplate("Speed", component.id, "speed", view?.speed ?? 1, 0, 4, 0.01)}
      <label class="field chain-param"><span>Blend</span>${liveSelectValuesTemplate(component.id, "blend", BLEND_MODES, view?.blend || "normal")}</label>
    </div>
  `;
}

function liveChainOutlineTemplate(chain, componentId, selectedItemId = "", pathBase = "chain", state = {}) {
  if (!chain?.length) return emptyNote("No elements");
  return elementListTemplate(
    `live-elements:${componentId}`,
    chain.map((item, index) => liveChainOutlineItemTemplate(item, componentId, selectedItemId, `${pathBase}.${index}`, state)).join(""),
    {
      className: "live-element-list-surface",
      listClassName: "live-chain-outline",
      listAttributes: 'role="tree"',
      tagName: "div",
    }
  );
}

function liveChainOutlineItemTemplate(item, componentId, selectedItemId, path, state) {
  const label = liveChainItemLabel(item, state);
  const iconName = item.kind === "effect" ? effectIcon(item.componentId) : item.kind === "group" ? UI_ICONS.group : sourceIcon(item.source || {});
  const type = item.kind === "effect" ? "effect" : item.kind === "group" ? "group" : item.source?.type === "generator" ? "generator" : "source";
  const row = textListItemTemplate({
    rowClass: "live-chain-outline-row compact-list-row",
    selected: item.id === selectedItemId,
    leadingHtml: enableToggleButton({
      livePath: `${path}.enabled`,
      componentId,
      itemId: item.id,
      value: item.enabled !== false,
      iconName,
      label,
    }),
    label,
    meta: type,
    mainClass: "live-chain-outline-select",
    mainAction: "data-live-chain-item",
    mainActionId: item.id,
    mainAttributes: `data-live-component-id="${esc(componentId)}"`,
  });
  return `
    <div class="live-chain-outline-branch" role="treeitem" aria-expanded="${item.kind === "group" ? "true" : "false"}">
      ${row}
      ${item.kind === "group" && item.chain?.length ? `<div class="live-chain-outline-children">${item.chain.map((child, index) => liveChainOutlineItemTemplate(child, componentId, selectedItemId, `${path}.chain.${index}`, state)).join("")}</div>` : ""}
    </div>
  `;
}

function liveSelectedChainSettingsTemplate(selected, componentId, state) {
  const { item, path } = selected;
  const label = liveChainItemLabel(item, state);
  const iconName = item.kind === "effect" ? effectIcon(item.componentId) : item.kind === "group" ? UI_ICONS.group : sourceIcon(item.source || {});
  const tabName = `live-chain-param-view-${String(componentId).replace(/[^a-z0-9_-]/gi, "-")}-${String(item.id).replace(/[^a-z0-9_-]/gi, "-")}`;
  const primary = liveChainItemContentTemplate(item, componentId, path, "primary", state);
  const details = liveChainItemContentTemplate(item, componentId, path, "details", state);
  const views = chainParamViewDefinitions(primary, details, chainGeneralControlsTemplate(item, path, {
    attrs: liveParamAttrs(componentId, item.id),
  }));
  return `
    <section class="ui-section focus-panel chain-settings-panel live-chain-settings" aria-label="Selected live element parameters">
      <header class="ui-section-header panel-title"><span class="material-symbols-rounded">${iconName}</span><span>${esc(label)}</span></header>
      <div class="chain-param-views" style="--param-view-count: ${views.length};">
        ${views.map((view, index) => `<div class="chain-param-view-option">
          <input class="chain-param-view-input" type="radio" name="${esc(tabName)}" id="${esc(tabName)}-${view.id}" ${index === 0 ? "checked" : ""} />
          <label class="chain-param-view-tab inspector-view-option" for="${esc(tabName)}-${view.id}">${view.label}</label>
          ${scrollRegionTemplate(`live-chain-params:${componentId}:${item.id}:${view.id}`, view.html, { className: `chain-param-view-panel chain-param-view-${view.id}` })}
        </div>`).join("")}
      </div>
    </section>
  `;
}

function liveChainItemContentTemplate(item, componentId, path, paramView = "primary", state = {}) {
  if (item.kind === "effect") {
    const component = visualEffectComponent(state, item.componentId);
    const params = (componentParamViews(component)[paramView] || []).map(effectDisplayParam);
    return params.length ? liveShaderParamControlsTemplate(component, item, componentId, path, params) : "";
  }
  if (item.kind === "group") return "";
  const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(item.source)) || null;
  const params = sourceLiveParams(item.source || {}, media, state);
  const viewParams = componentParamViews({ params })[paramView] || [];
  if (paramView === "details") return viewParams.length ? liveSourceParamControlsTemplate(item, componentId, path, viewParams) : "";
  return liveSourceParamControlsTemplate(item, componentId, path, viewParams);
}

function liveComponentPlacementControlsTemplate(transform = {}, componentId) {
  return `<div class="chain-param-list">${paramControlsTemplate(chainTransformParams(transform), {
    pathFor: (param) => `transform.${param.id}`,
    valueFor: (param) => normalizeParamValue(param, transform?.[param.id]),
    attrs: liveParamAttrs(componentId),
  })}</div>`;
}

function effectDisplayParam(param) {
  return param?.id === "amount" ? { ...param, label: "Effect strength" } : param;
}

function selectedLiveChainItem(chain, componentId, state) {
  const selectedByComponent = state.ui?.live?.selectedChainItemIds?.[componentId];
  const selectedId = selectedByComponent || state.ui?.live?.selectedChainItemId || "";
  return findLiveChainItem(chain, selectedId) || firstLiveChainItem(chain);
}

function findLiveChainItem(chain, id, base = "chain") {
  for (let index = 0; index < (chain || []).length; index++) {
    const item = chain[index];
    const path = `${base}.${index}`;
    if (item.id === id) return { item, path };
    if (item.kind === "group") {
      const nested = findLiveChainItem(item.chain || [], id, `${path}.chain`);
      if (nested) return nested;
    }
  }
  return null;
}

function firstLiveChainItem(chain, base = "chain") {
  const item = chain?.[0];
  return item ? { item, path: `${base}.0` } : null;
}

function liveChainItemLabel(item, state = {}) {
  if (item.kind === "effect") return effectChainItemDisplayName(item, state);
  if (item.kind === "group") return item.name || "Group";
  const media = state.media?.find((entry) => entry.id === sourceBackedMediaId(item.source)) || null;
  const component = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  return sourceChainItemDisplayName(item, media, component, state);
}

function liveShaderParamControlsTemplate(component, item, componentId, itemPath, params = component?.params || []) {
  if (!params.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, item, param),
        attrs: liveParamAttrs(componentId, item.id),
      })}
    </div>
  `;
}

function liveSourceParamControlsTemplate(item, componentId, itemPath, params = []) {
  if (!params.length) return "";
  const values = item.source?.params && typeof item.source.params === "object" ? item.source.params : {};
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(params, {
        pathFor: (param) => `${itemPath}.source.params.${param.id}`,
        valueFor: (param) => normalizeParamValue(param, values[param.id]),
        attrs: liveParamAttrs(componentId, item.id),
      })}
    </div>
  `;
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

function visualEffectComponent(state, id) {
  return listProjectIsfVisualComponents(state).find((component) => component.kind === "effect" && component.id === id)
    || getShaderComponent(id);
}

function liveParamAttrs(componentId, itemId = "") {
  return `data-live-component-id="${esc(componentId)}" ${itemId ? `data-live-item-id="${esc(itemId)}" ` : ""}data-live-update`;
}

function liveRangeTemplate(label, componentId, path, value, min = 0, max = 1, step = 0.01) {
  return paramControlTemplate(
    { id: path, label, type: "number", min, max, step, defaultValue: 1 },
    path,
    value,
    liveParamAttrs(componentId)
  );
}

function liveSelectValuesTemplate(componentId, path, values, value) {
  return `
    <select class="param-select" data-live-component-id="${esc(componentId)}" data-live-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function sceneFingerprintTemplate(sources) {
  if (!sources.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  const withThumbs = sources.filter((source) => source.thumbnail);
  if (!withThumbs.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  return `
    <div class="scene-fingerprint">
      ${withThumbs.slice(0, 5).map((source, index) => `
        <img src="${esc(source.thumbnail)}" alt="" loading="lazy" style="--fingerprint-index: ${index}; --fingerprint-count: ${withThumbs.length};" />
      `).join("")}
    </div>
  `;
}

function sceneFingerprintSources(scene, state) {
  const sources = sceneSourceNodes(state);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const selected = [];
  const seen = new Set();
  for (const route of scene?.surfaces || []) {
    if (route.enabled === false) continue;
    const source = byId.get(route.sourceNodeId) || sources.find((candidate) =>
      candidate.componentId === route.componentId
    );
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    selected.push(source);
  }
  return selected;
}

function pathForSurface(state, surface) {
  const mappingIndex = state.mappings.findIndex((item) => item.id === state.ui.selectedMappingId);
  const surfaceIndex = state.mappings[mappingIndex]?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  return `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
}

function pathForMapping(state, mapping) {
  return `mappings.${state.mappings.findIndex((item) => item.id === mapping.id)}`;
}
