import { BLEND_MODES } from "../constants.js";
import { createLiveComponentView, sceneSourceNodes } from "../domain/models.js?v=surface-relative-aspect-1";
import { liveProgramComponentIds } from "../domain/scene-routing.js?v=live-program-component-catalog-1";
import { normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { getGeneratorNodeComponent as getGeneratorComponent, getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js?v=node-catalog-14";
import { componentCatalogToolsTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { sourceChainItemDisplayName, sourceIcon } from "./component-view.js?v=isf-nodes-1";
import { getLiveSelectedTarget, getMappingSurfaceView, getSelectedMapping, liveSceneComponents, liveSelectedSceneId, mappingFingerprintComponents } from "./control-selectors.js?v=surface-relative-aspect-1";
import { CHAIN_COMPOSITE_PARAMS, CHAIN_TRANSFORM_PARAMS, chainGeneralControlsTemplate, chainParamViewDefinitions, componentParamViews, paramControlsTemplate, paramCurrentValue } from "./parameter-view.js?v=inspector-pending-node-1";
import { mediaSourceParams } from "./source-control-schema.js?v=source-param-schema-1";
import { effectIcon, emptyNote, esc, formatRangeValue, icon, rangeTemplate, selectValuesTemplate, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";
import { catalogMarkerButtonTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { componentCardBarTemplate, deepEditButtonTemplate, editableSectionTitleTemplate, emptyStateTemplate, enableToggleButton, panelTemplate, scrollRegionTemplate, selectablePillTemplate, textListItemTemplate } from "./view-primitives.js?v=uniform-section-hierarchy-1";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js?v=isf-coordinates-1";

const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];

export function mappingSurfacePillTemplate(surface, state) {
  const mappingSurface = getMappingSurfaceView(surface, state);
  const enabled = surface.enabled !== false;
  const direct = surface.destination?.type === "direct";
  return selectablePillTemplate({
    rowClass: "list-row compact-list-row",
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: enabled ? (direct ? "desktop_windows" : "crop_free") : "hide_source",
    label: surface.name,
    meta: "",
    togglePath: `${pathForSurface(state, surface)}.enabled`,
    toggleValue: enabled,
    removeAction: direct ? "" : "data-remove-surface",
    removeDisabled: false,
    reorderable: true,
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
      ${rangeTemplate("Feather", `${surfaceBase}.feather`, surface.feather ?? 0, 0, 0.5, 0.005)}
      ${hasMappingSurface ? `
        ${rangeTemplate("Presence", `${mappingBase}.opacity`, mappingSurface.opacity)}
        <label class="field">${direct ? "Fit" : "Projection fit"} ${selectValuesTemplate(`${mappingBase}.projectionFit`, PROJECTION_FIT_MODES, mappingSurface.projectionFit || (direct ? "contain" : "cover"))}</label>
      ` : `<div class="soft-note">This surface is not part of the selected Mapping.</div>`}
    </article>
  `;
}

export function mappingRailConfigTemplate(state) {
  const mapping = getSelectedMapping(state);
  if (!mapping) {
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Mapping</span></div>
        ${emptyNote("Create a mapping to edit surface routing.")}
      </div>
    `;
  }
  const base = pathForMapping(state, mapping);
  return `
    <div class="ui-section rail-section">
      ${editableSectionTitleTemplate("auto_awesome_motion", `${base}.name`, mapping.name)}
      <label class="field inline-param mapping-test-pattern-toggle">
        <span>Test pattern</span>
        <input type="checkbox" data-update="ui.mappingTestPattern" ${state.ui?.mappingTestPattern === false ? "" : "checked"} />
      </label>
    </div>
  `;
}

export function mappingPillTemplate(mapping, state) {
  const selected = state.ui.selectedMappingId === mapping.id;
  return `<div data-component-filter-card="${esc(mapping.name.toLowerCase())}">${textListItemTemplate({
    rowClass: "mapping-text-row compact-list-row",
    selected,
    leadingHtml: `<span class="text-list-static-icon" aria-hidden="true">${icon("display_settings")}</span>`,
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
  const sceneOverrides = state.ui?.live?.sceneOverrides?.[scene.id] || (selected ? state.ui?.live?.componentOverrides || {} : {});
  const hasOverrides = Object.keys(sceneOverrides).length > 0;
  return `
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(scene.name.toLowerCase())}">
      <button type="button" class="component-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
        ${thumbnailTemplate(scene.thumbnail, "dashboard_customize")}
        ${componentCardBarTemplate(scene.name)}
      </button>
      ${catalogMarkerButtonTemplate(scene, "scene")}
      ${hasOverrides ? `<button type="button" class="component-card-remove" data-reset-live-scene="${esc(scene.id)}" title="Reset temporary settings" aria-label="Reset temporary settings for ${esc(scene.name)}">${icon("restart_alt")}</button>` : ""}
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
    <div class="component-card-row has-catalog-marker" data-component-filter-card="${esc(component.name.toLowerCase())}">
      <button type="button" class="component-card live-component-picker ${selected ? "is-selected" : ""}" data-live-target-component="${esc(component.id)}">
        ${thumbnailTemplate(component.thumbnail, "account_tree")}
        ${componentCardBarTemplate(component.name)}
      </button>
      ${catalogMarkerButtonTemplate(component, "component")}
    </div>
  `;
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
      ${thumbnailTemplate(component.thumbnail)}
      ${componentCardBarTemplate(component.name)}
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

// The Live navigator represents the complete program, not only the currently
// selected matrix cell. Include the Overall source and every source currently
// routed to a Surface, then walk their component graphs. This keeps a custom
// Surface patch inspectable after the operator moves to another Surface.
export function liveProgramNavigableComponents(state) {
  const ids = liveProgramComponentIds(state);
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
    const relativePath = `${relativeBase}.${index}`;
    const updatePath = `${updateBase}.${index}`;
    const nested = item.kind === "group" ? significantChainControls(item.chain || [], {
      ...options,
      relativeBase: `${relativePath}.chain`,
      updateBase: `${updatePath}.chain`,
    }) : "";
    const significantTransforms = CHAIN_TRANSFORM_PARAMS.filter((param) => paths.has(`${relativePath}.transform.${param.id}`));
    const transformControls = significantTransforms.length ? paramControlsTemplate(significantTransforms, {
      pathFor: (param) => `${updatePath}.transform.${param.id}`,
      valueFor: (param) => normalizeParamValue(param, item.transform?.[param.id]),
      attrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    const significantComposite = CHAIN_COMPOSITE_PARAMS.filter((param) => paths.has(`${relativePath}.${param.id}`));
    const compositeControls = significantComposite.length ? paramControlsTemplate(significantComposite, {
      pathFor: (param) => `${updatePath}.${param.id}`,
      valueFor: (param) => normalizeParamValue(param, item?.[param.id]),
      attrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    if (item.kind === "group") {
      const own = transformControls || compositeControls
        ? `<div class="live-significant-group"><span>${esc(item.name || "Group")}</span>${compositeControls}${transformControls}</div>`
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
      attrs,
      isSignificant: () => attrs === "data-update",
    }) : "";
    return `<div class="live-significant-group"><span>${esc(item.name || item.componentId || sourceChainItemDisplayName(item, null, null, state))}</span>${contentControls}${compositeControls}${transformControls}</div>`;
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
  const publishedControlCount = component.significantParams?.length || 0;
  return `
    <article class="ui-section focus-panel live-component-card">
      <header class="ui-section-header panel-title live-component-head">
        ${thumbnailTemplate(component.thumbnail)}
        <strong>${esc(component.name)}</strong>
        ${deepEditButtonTemplate(component.id, { className: "header-edit-button", label: `Edit ${component.name}` })}
      </header>
      <div class="live-component-view-tabs" role="group" aria-label="Live Component view">
        <button type="button" class="live-component-view-tab ${componentView === "controls" ? "is-selected" : ""}" data-live-component-view="controls" aria-pressed="${componentView === "controls"}">${icon("tune")} Controls${publishedControlCount ? ` (${publishedControlCount})` : ""}</button>
        <button type="button" class="live-component-view-tab ${componentView === "elements" ? "is-selected" : ""}" data-live-component-view="elements" aria-pressed="${componentView === "elements"}">${icon("account_tree")} Elements</button>
      </div>
      ${componentView === "controls"
        ? liveComponentControlsTemplate(component, view, state)
        : liveChainOutlineTemplate(view?.chain || [], component.id, selectedElement?.item?.id, "chain", state)}
    </article>
  `;
}

function liveComponentControlsTemplate(component, view, state = {}) {
  const paths = new Set(component.significantParams || []);
  const published = paths.size ? significantChainControls(view?.chain || [], {
    componentId: component.id,
    relativeBase: "chain",
    updateBase: "chain",
    paths,
    attrs: liveParamAttrs(component.id),
    media: state.media || [],
  }) : "";
  return `
    <div class="live-component-controls inspector-control-surface" data-scroll-region data-scroll-key="live-controls:${esc(component.id)}">
      ${published ? `<div class="live-published-controls"><span class="live-control-group-label">Published controls</span>${published}</div>` : `<div class="soft-note">Mark element parameters as significant to publish them here.</div>`}
      <div class="live-component-transform-controls">
        <span class="live-control-group-label">Component placement</span>
        ${liveComponentPlacementControlsTemplate(view?.transform, component.id)}
      </div>
      ${liveRangeTemplate("Opacity", component.id, "opacity", view?.opacity ?? 1)}
      ${liveRangeTemplate("Speed", component.id, "speed", view?.speed ?? 1, 0, 4, 0.01)}
      <label class="field chain-param"><span>Blend</span>${liveSelectValuesTemplate(component.id, "blend", BLEND_MODES, view?.blend || "normal")}</label>
    </div>
  `;
}

function liveChainOutlineTemplate(chain, componentId, selectedItemId = "", pathBase = "chain", state = {}) {
  if (!chain?.length) return emptyNote("No elements");
  return `
    <div class="live-chain-outline" data-scroll-region data-scroll-key="live-elements:${esc(componentId)}" role="tree">
      ${chain.map((item, index) => liveChainOutlineItemTemplate(item, componentId, selectedItemId, `${pathBase}.${index}`, state)).join("")}
    </div>
  `;
}

function liveChainOutlineItemTemplate(item, componentId, selectedItemId, path, state) {
  const label = liveChainItemLabel(item, state);
  const iconName = item.kind === "effect" ? effectIcon(item.componentId) : item.kind === "group" ? "account_tree" : sourceIcon(item.source || {});
  const type = item.kind === "effect" ? "effect" : item.kind === "group" ? "group" : item.source?.type === "generator" ? "generator" : "source";
  return `
    <div class="live-chain-outline-branch" role="treeitem" aria-expanded="${item.kind === "group" ? "true" : "false"}">
      <div class="live-chain-outline-row ${item.id === selectedItemId ? "is-selected" : ""}">
        <button type="button" class="live-chain-outline-select" data-live-chain-item="${esc(item.id)}" data-live-component-id="${esc(componentId)}">
          ${icon(iconName)}<span>${esc(label)}</span><small>${esc(type)}</small>
        </button>
        ${enableToggleButton({ livePath: `${path}.enabled`, componentId, value: item.enabled !== false, iconName: item.enabled === false ? "visibility_off" : "visibility", label })}
      </div>
      ${item.kind === "group" && item.chain?.length ? `<div class="live-chain-outline-children">${item.chain.map((child, index) => liveChainOutlineItemTemplate(child, componentId, selectedItemId, `${path}.chain.${index}`, state)).join("")}</div>` : ""}
    </div>
  `;
}

function liveSelectedChainSettingsTemplate(selected, componentId, state) {
  const { item, path } = selected;
  const label = liveChainItemLabel(item, state);
  const iconName = item.kind === "effect" ? effectIcon(item.componentId) : item.kind === "group" ? "account_tree" : sourceIcon(item.source || {});
  const tabName = `live-chain-param-view-${String(componentId).replace(/[^a-z0-9_-]/gi, "-")}-${String(item.id).replace(/[^a-z0-9_-]/gi, "-")}`;
  const primary = liveChainItemContentTemplate(item, componentId, path, "primary", state);
  const details = liveChainItemContentTemplate(item, componentId, path, "details", state);
  const views = chainParamViewDefinitions(primary, details, chainGeneralControlsTemplate(item, path, {
    attrs: liveParamAttrs(componentId),
  }));
  return `
    <section class="ui-section focus-panel chain-settings-panel live-chain-settings" aria-label="Selected live element parameters">
      <header class="ui-section-header panel-title"><span class="material-symbols-rounded">${iconName}</span><span>${esc(label)}</span></header>
      <div class="chain-param-views" style="--param-view-count: ${views.length};">
        ${views.map((view, index) => `<div class="chain-param-view-option">
          <input class="chain-param-view-input" type="radio" name="${esc(tabName)}" id="${esc(tabName)}-${view.id}" ${index === 0 ? "checked" : ""} />
          <label class="chain-param-view-tab" for="${esc(tabName)}-${view.id}">${view.label}</label>
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
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const params = sourceLiveParams(item.source || {}, media, state);
  const viewParams = componentParamViews({ params })[paramView] || [];
  if (paramView === "details") return viewParams.length ? liveSourceParamControlsTemplate(item, componentId, path, viewParams) : "";
  return liveSourceParamControlsTemplate(item, componentId, path, viewParams);
}

function liveComponentPlacementControlsTemplate(transform = {}, componentId) {
  return `<div class="chain-param-list">${paramControlsTemplate(CHAIN_TRANSFORM_PARAMS, {
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
  if (item.kind === "effect") return visualEffectComponent(state, item.componentId)?.name || item.componentId;
  if (item.kind === "group") return item.name || "Group";
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
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
        attrs: liveParamAttrs(componentId),
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
        attrs: liveParamAttrs(componentId),
      })}
    </div>
  `;
}

function sourceLiveParams(source = {}, media = null, state = {}) {
  if (source.type === "generator") return visualGeneratorComponent(state, source.generatorId)?.params || [];
  if (source.type === "media") return mediaSourceParams(source, media);
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

function liveParamAttrs(componentId) {
  return `data-live-component-id="${esc(componentId)}" data-live-update`;
}

function liveRangeTemplate(label, componentId, path, value, min = 0, max = 1, step = 0.01) {
  return `
    <label class="field range-field chain-param">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, step)}</output>
      <input type="range" min="${min}" max="${max}" step="${step}" data-live-component-id="${esc(componentId)}" data-live-update="${path}" value="${value}" />
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
