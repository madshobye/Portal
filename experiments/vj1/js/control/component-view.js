import { componentFrameMetrics } from "../domain/component-frame.js";
import { componentFromNodeDefinition, getGeneratorNodeComponent as getGeneratorComponent, getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js?v=general-group-controls-1";
import { materializeProjectNodeDefinition } from "./node-editor-view.js?v=project-group-authoring-public-group-ports-1";
import { featureMorphMediaControlsTemplate } from "./feature-morph-view.js?v=mobilenet-morph-v2-47";
import { generatorImageMediaControlTemplate } from "./generator-media-view.js?v=tile-texture-40";
import { generatorIcon } from "./picker-view.js?v=picker-filter-tabs-1";
import { chainGeneralControlsTemplate, chainParamViewDefinitions, componentParamViews, paramControlsTemplate, paramCurrentValue, shaderParamControlsTemplate } from "./parameter-view.js?v=param-reset-contract-1";
import { isModelMediaSource, isVideoMediaSource, mediaSourceParams, MODEL_SOURCE_PARAMS } from "./source-control-schema.js?v=source-param-schema-1";
import { effectIcon, esc, icon, rangeTemplate, selectValuesTemplate, sourceTypeIcon } from "./template-utils.js?v=param-reset-contract-1";
import { deepEditButtonTemplate, editableSectionTitleTemplate, enableToggleButton, scrollRegionTemplate, textListItemTemplate } from "./view-primitives.js?v=uniform-section-hierarchy-1";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js?v=named-image-inputs-1";
import { mediaChoiceButtonTemplate, mediaDisplayName } from "./media-view.js?v=media-name-presentation-1";


export function sceneInspectorTemplate(component, state) {
  const base = pathForComponent(state, component);
  return `
    <article class="sculpt-card">
      ${sceneResolutionControlsTemplate(component, base)}
      ${componentUnifiedChainTemplate(component, state, base)}
    </article>
  `;
}

export function sceneSurfaceInspectorTemplate(surface, state) {
  if (!surface) return "";
  const mappingIndex = state.mappings?.findIndex((mapping) => String(mapping.id) === String(state.ui?.selectedMappingId || "")) ?? -1;
  const surfaceIndex = mappingIndex >= 0
    ? state.mappings[mappingIndex].surfaces?.findIndex((entry) => String(entry.id) === String(surface.id)) ?? -1
    : -1;
  if (surfaceIndex < 0) return "";
  const base = `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
  return `<article class="sculpt-card scene-surface-inspector inspector-control-surface">
    <div class="soft-note">Surface · move and scale its 2D rectangle in the Scene preview; calibrate its projection in Mapping.</div>
    <label class="field inline-param"><span>Keep proportions</span><input type="checkbox" data-update="${base}.keepProportions" ${surface.keepProportions === false ? "" : "checked"} /></label>
    <label class="field">Fit ${selectValuesTemplate(`${base}.projectionFit`, ["cover", "contain", "stretch"], surface.projectionFit || "cover")}</label>
  </article>`;
}

function sceneResolutionControlsTemplate(component, base) {
  const scale = Number(component.resolutionScale) || 1;
  return `
    <div class="section-toolbar component-quick-toolbar" role="group" aria-label="Scene resolution scale">
      <div class="section-toolbar-group component-quick-group component-resolution-buttons">
        ${[0.5, 1, 2].map((value) => `<button type="button" class="${scale === value ? "is-selected" : ""}" data-set-path="${base}.resolutionScale" data-set-value="${value}" data-set-value-type="number" aria-pressed="${scale === value}" title="${value}× Scene resolution">${value}×</button>`).join("")}
      </div>
    </div>
  `;
}

export function componentTemplate(component, state) {
  const base = pathForComponent(state, component);
  if (component.type === "scene") {
    return `
      <article class="sculpt-card">
        ${componentInstanceSyncTemplate(component, base)}
        <div class="soft-note">This Scene arranges reusable Components. Mapping Surfaces define its 2D crop and physical projection.</div>
      </article>
    `;
  }
  return `
    <article class="sculpt-card">
      ${componentFrameControlsTemplate(component, state, base)}
      ${componentUnifiedChainTemplate(component, state, base)}
    </article>
  `;
}

export function componentHeaderAddButtonTemplate(component) {
  if (!component?.id) return "";
  return `<button type="button" class="rail-title-add" data-open-element-picker data-component-id="${esc(component.id)}" title="Add element" aria-label="Add element">${icon("add")}</button>`;
}

export function componentSelectedChainSettingsTemplate(component, state, { nodeEditorHtml = "" } = {}) {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return "";
  return `
    <section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">
      ${selectedChainItemTemplate(selected.item, component, state, selected.path, nodeEditorHtml)}
    </section>
  `;
}

export function sourceIcon(source = {}) {
  if (source.type === "component") return "account_tree";
  if (source.type === "generator") return generatorIcon(source.generatorId);
  if (source.type === "media") return isModelMediaSource(source) ? "deployed_code" : "perm_media";
  if (source.type === "camera") return "photo_camera";
  if (source.type === "black") return "radio_button_unchecked";
  return sourceTypeIcon(source.type || "generator");
}

export function sourceChainItemDisplayName(item = {}, media = null, component = null, state = null) {
  if (item.source?.type === "component") return sourceTitle(item.source, media, component, state);
  if (!item.name || isGenericLayerName(item.name) || item.name === item.source?.componentId) {
    return sourceTitle(item.source || {}, media, component, state);
  }
  return item.name;
}

export { isModelMediaSource } from "./source-control-schema.js?v=source-param-schema-1";

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

function componentInstanceSyncTemplate(component, base, compact = false) {
  const enabled = component.syncInstances !== false;
  const button = `
    <button type="button" class="${enabled ? "is-selected" : ""}" data-toggle-path="${base}.syncInstances" data-toggle-value="${enabled ? "true" : "false"}" aria-pressed="${enabled}" title="On keeps this Component synchronized everywhere; off gives each Scene placement and Surface its own phase">
      ${compact ? `${icon("sync")}<span class="visually-hidden">Sync instances</span>` : "Sync instances"}
    </button>
  `;
  if (compact) return button;
  return `
    <div class="segmented-pills component-option-grid" role="group" aria-label="Component instance timing">
      ${button}
    </div>
  `;
}

function componentFrameControlsTemplate(component, state, base) {
  const metrics = componentFrameMetrics(state.render || {}, component);
  const shapeOptions = [
    ["landscape", "Landscape"],
    ["portrait", "Portrait"],
    ["square", "Square"],
  ];
  const shapeIcons = { landscape: "crop_landscape", portrait: "crop_portrait", square: "crop_square" };
  const scaleOptions = [0.5, 1, 2];
  return `
    <section class="component-frame-controls">
      <div class="section-toolbar component-quick-toolbar" aria-label="Component quick settings">
        <div class="section-toolbar-group component-quick-group" role="group" aria-label="Component instance timing">
          ${componentInstanceSyncTemplate(component, base, true)}
        </div>
        <div class="section-toolbar-group component-quick-group" role="group" aria-label="Component frame shape">
        ${shapeOptions.map(([value, label]) => `
          <button type="button" class="${metrics.frameShape === value ? "is-selected" : ""}" data-set-path="${base}.frameShape" data-set-value="${value}" aria-pressed="${metrics.frameShape === value}" title="${label}">${icon(shapeIcons[value])}<span class="visually-hidden">${label}</span></button>
        `).join("")}
        </div>
        <div class="section-toolbar-group component-quick-group component-resolution-buttons" role="group" aria-label="Component resolution scale">
        ${scaleOptions.map((value) => `
          <button type="button" class="${metrics.resolutionScale === value ? "is-selected" : ""}" data-set-path="${base}.resolutionScale" data-set-value="${value}" data-set-value-type="number" aria-pressed="${metrics.resolutionScale === value}" title="${value}× resolution">${value}×</button>
        `).join("")}
        </div>
      </div>
    </section>
  `;
}

function componentUnifiedChainTemplate(component, state, ownerPath) {
  return `
    <div class="chain-column">
      <section class="chain-list-section" aria-label="Elements">
        ${scrollRegionTemplate(`component-chain:${component.id}`, chainItemsTemplate(component.chain || [], component, state, `${ownerPath}.chain`), {
          className: "component-chain-list",
          attributes: `data-chain-reorder-list data-component-id="${esc(component.id)}"`,
        })}
      </section>
    </div>
  `;
}

function chainItemsTemplate(chain, component, state, base, depth = 0) {
  if (!chain?.length) return depth ? `<div class="soft-note chain-group-empty">Group is empty</div>` : "";
  return chain.map((item, index) => chainItemRowTemplate(item, component, state, index, `${base}.${index}`, depth)).join("");
}

function chainItemRowTemplate(item, component, state, index, base, depth = 0) {
  const selected = state.ui.selectedChainItemId === item.id;
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const label = chainItemLabel(item, media, referencedComponent, state);
  const iconName = chainItemIcon(item);
  const kindLabel = item.kind === "source" ? item.source?.type || "source" : item.kind === "group" ? `${item.chain?.length || 0} item group` : "effect";
  const row = textListItemTemplate({
    rowClass: "chain-item-row compact-list-row",
    selected,
    reorderId: item.id,
    leadingHtml: enableToggleButton({
      path: `${base}.enabled`,
      value: item.enabled !== false,
      iconName,
      label,
      selectAction: "chain-item",
      selectId: item.id,
    }),
    label,
    meta: kindLabel,
    mainClass: "chain-item-select",
    mainAction: "data-select-chain-item",
    mainActionId: item.id,
    removeClass: "chain-item-remove",
    removeAttributes: `data-component-id="${esc(component.id)}" data-remove-chain-item="${esc(item.id)}"`,
    actionHtml: referencedComponent ? deepEditButtonTemplate(referencedComponent.id, {
      className: "text-list-edit",
      label: `Edit ${referencedComponent.name}`,
    }) : "",
  });
  return `
    <div class="chain-item-block ${item.kind === "group" ? "is-group" : ""}" style="--chain-depth: ${depth};">
      ${row}
      ${item.kind === "group" ? `
        <div class="chain-group-drop-zone" data-reorder-id="${esc(item.id)}" data-drop-position="inside" title="Drop inside ${esc(label)}" aria-label="Drop inside ${esc(label)}"></div>
        ${!item.collapsed ? `<div class="chain-group-children" data-reorder-id="${esc(item.id)}" data-drop-position="inside">${chainItemsTemplate(item.chain || [], component, state, `${base}.chain`, depth + 1)}</div>` : ""}
        <div class="chain-group-drop-zone is-after" data-reorder-id="${esc(item.id)}" data-drop-position="after" title="Drop after ${esc(label)}" aria-label="Drop after ${esc(label)}"></div>
      ` : ""}
    </div>
  `;
}

function selectedChainItemTemplate(item, component, state, base, nodeEditorHtml = "") {
  const title = selectedChainItemTitleTemplate(item, component, state, base);
  const content = selectedChainItemContentTemplate(item, component, state, base, "primary");
  const details = selectedChainItemContentTemplate(item, component, state, base, "details");
  const tabName = `chain-param-view-${item.id}`;
  const views = chainParamViewDefinitions(content, details, chainGeneralControlsTemplate(item, base, {
    isSignificant: (_param, path) => componentParamIsSignificant(component, state, path),
  }));
  if (nodeEditorHtml) views.push({ id: "node", label: "Node", html: nodeEditorHtml });
  return `
    ${title}
    <div class="chain-param-views" style="--param-view-count: ${views.length};">
      ${views.map((view, index) => `
        <div class="chain-param-view-option">
          <input class="chain-param-view-input" type="radio" name="${esc(tabName)}" id="${esc(tabName)}-${view.id}" ${index === 0 ? "checked" : ""} />
          <label class="chain-param-view-tab" for="${esc(tabName)}-${view.id}">${view.label}</label>
          ${scrollRegionTemplate(`chain-params:${component.id}:${item.id}:${view.id}`, view.html, { className: `chain-param-view-panel chain-param-view-${view.id}` })}
        </div>
      `).join("")}
    </div>`;
}

function selectedChainItemTitleTemplate(item, component, state, base) {
  if (item.kind === "effect") {
    const effectComponent = visualEffectComponent(state, item.componentId);
    return `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${effectIcon(item.componentId)}</span><span>${esc(effectComponent?.name || item.componentId)}</span></div>`;
  }
  if (item.kind === "group") return editableSectionTitleTemplate("account_tree", base + ".name", item.name || "Group");
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const displayName = sourceChainItemDisplayName(item, media, referencedComponent, state);
  const staticTitle = component?.type === "scene" && item.source?.type === "component";
  return staticTitle
    ? `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${sourceIcon(item.source)}</span><span>${esc(displayName)}</span>${deepEditButtonTemplate(referencedComponent?.id, { className: "header-edit-button", label: `Edit ${displayName}` })}</div>`
    : editableSectionTitleTemplate(sourceIcon(item.source), base + ".name", displayName);
}

function selectedChainItemContentTemplate(item, component, state, base, paramView) {
  if (item.kind === "source") return sourceChainItemTemplate(item, component, state, base, paramView);
  if (item.kind === "group") return paramView === "primary" ? groupChainItemTemplate(item, component, state, base) : "";
  return effectChainItemTemplate(item, component, state, base, paramView);
}

function effectChainItemTemplate(item, component, state, base, paramView = "primary") {
  const effectComponent = visualEffectComponent(state, item.componentId);
  const params = (componentParamViews(effectComponent)[paramView] || []).map(effectDisplayParam);
  if (!params.length) return "";
  return `
    <section class="chain-item-editor">
      ${shaderParamControlsTemplate(effectComponent, item, base, {
        params,
        isSignificant: (_param, path) => componentParamIsSignificant(component, state, path),
      })}
    </section>
  `;
}

function groupChainItemTemplate(item, component, state, base) {
  return `
    <section class="chain-item-editor">
      <label class="field inline-param">
        <span>Collapsed</span>
        <input type="checkbox" data-update="${base}.collapsed" ${item.collapsed ? "checked" : ""} />
      </label>
      <button type="button" class="chain-add-button" data-open-element-picker data-component-id="${esc(component.id)}" data-target-chain-item="${esc(item.id)}" title="Add element to group" aria-label="Add element to group">${icon("add")}</button>
      <div class="soft-note">Use the preview handles to move, scale, or rotate the group as one unit.</div>
    </section>
  `;
}

function sourceChainItemTemplate(item, ownerComponent, state, base, paramView = "primary") {
  const isSceneComponentPlacement = ownerComponent?.type === "scene" && item.source?.type === "component";
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  if (paramView === "details") {
    if (item.source?.type === "generator") {
      const generator = visualGeneratorComponent(state, item.source.generatorId);
      if (!componentParamViews(generator).details.length) return "";
    } else if (item.source?.type === "media") {
      if (!componentParamViews({ params: mediaSourceParams(item.source, media) }).details.length) return "";
    } else return "";
    return `<section class="chain-item-editor">${sourcePickerTemplate(item, state, base, "details")}</section>`;
  }
  return `
    <section class="chain-item-editor">
      ${item.source?.type === "component"
        ? (isSceneComponentPlacement ? "" : `<label class="field">Component ${componentSelectTemplate(`${base}.source.componentId`, state, item.source.componentId)}</label>`)
        : sourcePickerTemplate(item, state, base, paramView)}
      ${item.source?.type === "generator" && item.source.generatorId === "sdfSketch"
        ? sdfSketchContentEditorTemplate(state)
        : ""}
    </section>
  `;
}

function sdfSketchContentEditorTemplate(state) {
  const component = visualGeneratorComponent(state, "sdfSketch");
  const baseDefinition = component?.nodeDefinition;
  if (!baseDefinition) return "";
  const definition = materializeProjectNodeDefinition(baseDefinition, state);
  const compiler = baseDefinition.metadata?.sourceCompiler;
  const programPart = definition.parts?.find((part) => part.id === compiler?.programPartId);
  if (!programPart) return "";
  const hasFork = definition.id !== baseDefinition.id;
  return `
    <div class="node-editor-projection sdf-sketch-content-editor" data-node-editor data-node-base-id="${esc(baseDefinition.id)}" data-node-base-version="${esc(baseDefinition.version)}">
      <div class="ui-subsection-header"><span>${icon("code")}</span><span>SDF sketch</span></div>
      <p class="soft-note">Relative coordinates are 0–1. Save compiles this program into one GPU shader; it does not run JavaScript per frame.</p>
      <div class="node-editor-section node-editor-source is-open">
        <textarea aria-label="SDF sketch source" spellcheck="false" data-node-part-source="${esc(programPart.id)}">${esc(programPart.source || "")}</textarea>
      </div>
      <details class="node-editor-section sdf-sketch-api-help">
        <summary>Drawing API</summary>
        <code>background · rect · circle · ring · line · grid · edgeChecks · stripes · colorBars · grayScale · sdfExpr</code>
      </details>
      <div class="node-editor-actions">
        <button type="button" data-save-node-fork>${hasFork ? "Save sketch" : "Create project sketch"}</button>
        ${hasFork ? `<button type="button" class="secondary" data-reset-node-fork>Use built-in sketch</button>` : ""}
      </div>
    </div>`;
}

function effectDisplayParam(param) {
  return param?.id === "amount" ? { ...param, label: "Effect strength" } : param;
}

function componentSelectTemplate(path, state, value, excludeId = "") {
  const options = state.components.filter((component) => component.id !== excludeId && component.type !== "scene");
  return `
    <select data-update="${esc(path)}">
      <option value="">None</option>
      ${options.map((component) => `<option value="${esc(component.id)}" ${component.id === value ? "selected" : ""}>${esc(component.name)}</option>`).join("")}
    </select>
  `;
}

function selectedChainItemSelection(component, state) {
  const base = `${pathForComponent(state, component)}.chain`;
  const selected = findChainItemSelection(component.chain || [], state.ui.selectedChainItemId, base);
  return selected || firstChainItemSelection(component.chain || [], base);
}

function sourcePickerTemplate(item, state, base, paramView = "primary") {
  const source = item.source;
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      ${source.type === "generator" || paramView !== "primary" ? "" : `<div class="field">
        <span>Source</span>
        ${source.type === "media" ? mediaChoiceButtonTemplate(media || { id: source.mediaId }, {
          path: `${base}.source`,
        }) : `<button type="button" class="source-choice-button" data-open-source-choice="${esc(`${base}.source`)}">
          ${icon(sourceIcon(source))}
          <span>
            <strong>${esc(sourceTitle(source, media, null, state))}</strong>
            <small>${esc(sourceSubtitle(source, media))}</small>
          </span>
          ${icon("chevron_right")}
        </button>`}
      </div>`}
      ${source.type === "generator" ? generatorParamControlsTemplate(`${base}.source`, source, state, paramView) : ""}
      ${source.type === "media" && !isModelMediaSource(source, media) ? mediaSourceControlsTemplate(`${base}.source`, source, media, paramView) : ""}
      ${paramView === "primary" && source.type === "media" && isVideoMediaSource(source, media) ? videoSourceControlsTemplate(`${base}.source`, source, media) : ""}
      ${source.type === "media" && isModelMediaSource(source, media) ? modelSourceControlsTemplate(`${base}.source`, source, paramView) : ""}
      ${paramView === "primary" && source.type === "camera" ? `<div class="soft-note">Using the portal camera feed.</div>` : ""}
      ${paramView === "primary" && source.type === "black" ? `<div class="soft-note">Black source selected.</div>` : ""}
    </div>
  `;
}

function mediaSourceControlsTemplate(base, source = {}, media = null, paramView = "primary") {
  const definition = { params: mediaSourceParams(source, media) };
  const params = componentParamViews(definition)[paramView] || [];
  if (!params.length) return "";
  return `<div class="chain-param-list">${paramControlsTemplate(params, {
    pathFor: (param) => `${base}.params.${param.id}`,
    valueFor: (param) => paramCurrentValue(definition, { params: source.params || {} }, param),
  })}</div>`;
}

function sourceTitle(source = {}, media = null, component = null, state = null) {
  if (source.type === "component") return component?.name || source.componentId || "Component";
  if (source.type === "generator") {
    const generator = visualGeneratorComponent(state, source.generatorId);
    return generator?.label || generator?.name || source.generatorId;
  }
  if (source.type === "media") return mediaDisplayName(media || { id: source.mediaId });
  if (source.type === "camera") return "Live camera";
  if (source.type === "black") return "Black";
  return "Choose source";
}

function sourceSubtitle(source = {}, media = null) {
  if (source.type === "component") return "Component reference";
  if (source.type === "generator") return "Generator";
  if (source.type === "media") return media?.type === "model" || isModelMediaSource(source) ? "3D model" : media?.type ? `Media ${media.type}` : "Media";
  if (source.type === "camera") return "Portal camera feed";
  if (source.type === "black") return "Empty black source";
  return "Source";
}

function chainItemLabel(item = {}, media = null, component = null, state = null) {
  if (item.kind === "source") return sourceChainItemDisplayName(item, media, component, state);
  if (item.kind === "group") return item.name || "Group";
  return item.name || item.componentId || "Effect";
}

function chainItemIcon(item = {}) {
  if (item.kind === "source") return sourceIcon(item.source || {});
  if (item.kind === "group") return "account_tree";
  return effectIcon(item.componentId);
}

function findChainItemSelection(chain = [], id = "", base = "chain") {
  if (!Array.isArray(chain) || !id) return null;
  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];
    const path = `${base}.${index}`;
    if (item.id === id) return { item, path };
    const nested = item.kind === "group" ? findChainItemSelection(item.chain || [], id, `${path}.chain`) : null;
    if (nested) return nested;
  }
  return null;
}

function firstChainItemSelection(chain = [], base = "chain") {
  if (!Array.isArray(chain) || !chain.length) return null;
  return { item: chain[0], path: `${base}.0` };
}

function isGenericLayerName(value) {
  return /^Layer(?:\s+\d+)?$/i.test(String(value || "").trim());
}

function videoSourceControlsTemplate(base, source = {}, media = null) {
  const trim = videoTrimValues(source, media);
  return `
    <div class="video-source-controls">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">content_cut</span><span>Movie segment</span></div>
      ${videoTrimTemplate(base, trim)}
      ${rangeTemplate("Movie speed", `${base}.speed`, source.speed ?? 1, 0, 4, 0.01, 1)}
    </div>
  `;
}

function videoTrimTemplate(base, trim) {
  const startPercent = trim.max ? (trim.start / trim.max) * 100 : 0;
  const endPercent = trim.max ? (trim.end / trim.max) * 100 : 100;
  const disabled = trim.available ? "" : "disabled";
  return `
    <div
      class="video-trim-control"
      data-video-trim
      data-video-trim-implicit-end="${trim.implicitEnd ? "true" : "false"}"
      data-video-trim-available="${trim.available ? "true" : "false"}"
      style="--trim-start: ${startPercent.toFixed(3)}%; --trim-end: ${endPercent.toFixed(3)}%;"
    >
      <div class="video-trim-labels">
        <span>Start <strong data-video-trim-label="start">${trim.available ? formatTrimTime(trim.start) : "—"}</strong></span>
        <span>End <strong data-video-trim-label="end">${trim.available ? formatTrimTime(trim.end) : "—"}</strong></span>
      </div>
      <div class="video-trim-slider">
        <div class="video-trim-track" aria-hidden="true"></div>
        <input type="range" min="0" max="${trim.max}" step="0.01" value="${trim.start}" data-update="${base}.start" data-video-trim-input="start" aria-label="Movie segment start" ${disabled} />
        <input type="range" min="0" max="${trim.max}" step="0.01" value="${trim.end}" data-update="${base}.end" data-video-trim-input="end" aria-label="Movie segment end" ${disabled} />
      </div>
      ${trim.available ? "" : `<div class="soft-note">Video duration unavailable. Trim controls activate when metadata loads.</div>`}
    </div>
  `;
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

function modelSourceControlsTemplate(base, source = {}, paramView = "primary") {
  const params = source.params || {};
  const viewParams = componentParamViews({ params: MODEL_SOURCE_PARAMS })[paramView] || [];
  if (!viewParams.length) return "";
  return `
    <div class="model-source-controls">
      <div class="model-param-list">${paramControlsTemplate(viewParams, {
        pathFor: (param) => `${base}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue({ params: MODEL_SOURCE_PARAMS }, { params }, param),
      })}</div>
    </div>
  `;
}

function generatorParamControlsTemplate(base, source = {}, state = {}, paramView = "primary") {
  const component = visualGeneratorComponent(state, source.generatorId);
  if (!component?.params?.length) return "";
  const params = componentParamViews(component)[paramView] || [];
  if (!params.length) return "";
  const projectedControls = generatorControlProjectionTemplate(component, params, base, source, state);
  const mediaControls = component.id === "featureMorph" || component.id === "featureMorphV2"
    ? featureMorphMediaControlsTemplate(base, source, state, component.id === "featureMorphV2" ? {
        note: "MobileNet compares a grid of semantic image regions. Best with related subjects or layouts.",
        emptyDetail: "MobileNet input",
      } : {})
    : component.id === "tileTexture"
      ? generatorImageMediaControlTemplate(base, source, state, { emptyDetail: "Tileable texture" })
      : "";
  return `
    <div class="chain-param-list">
      ${paramView === "primary" ? mediaControls : ""}
      ${projectedControls || paramControlsTemplate(params, {
        pathFor: (param) => `${base}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, { params: source.params || {} }, param),
        isSignificant: (_param, path) => componentParamIsSignificant(
          state.components?.find((item) => path.startsWith(`components.${state.components.indexOf(item)}.`)),
          state,
          path
        ),
      })}
    </div>
  `;
}

function generatorControlProjectionTemplate(component, visibleParams, base, source, state) {
  const projection = component?.nodeDefinition?.metadata?.controlProjection;
  if (projection?.format !== "vj1.control-projection@1" || !projection.sections?.length) return "";
  const byId = new Map((visibleParams || []).map((parameter) => [parameter.id, parameter]));
  return projection.sections.map((section) => {
    const params = (section.controls || [])
      .map((control) => byId.get(control.parameterId))
      .filter(Boolean);
    if (!params.length) return "";
    return `
      <section class="compound-control-section" data-control-section="${esc(section.id)}">
        <div class="ui-subsection-header"><span>${esc(section.label)}</span></div>
        ${projectedGroupParamControlsTemplate(params, component, base, source, state)}
      </section>
    `;
  }).join("");
}

function projectedGroupParamControlsTemplate(params, component, base, source, state) {
  return params.map((param) => {
    const path = `${base}.params.${param.id}`;
    if (param.ui === "media") {
      const value = String(source.params?.[param.id] || param.defaultValue || "");
      const media = (state.media || []).find((item) => String(item.id || "") === value) || null;
      return mediaChoiceButtonTemplate(media, {
        mode: "value",
        path,
        accept: param.mediaCategory || "",
        emptyName: param.label || "Choose media",
        emptyDetail: param.mediaCategory === "model" ? "3D model" : "Media",
      });
    }
    return paramControlsTemplate([param], {
      pathFor: () => path,
      valueFor: () => paramCurrentValue(component, { params: source.params || {} }, param),
      isSignificant: (_param, controlPath) => componentParamIsSignificant(
        state.components?.find((item) => controlPath.startsWith(`components.${state.components.indexOf(item)}.`)),
        state,
        controlPath,
      ),
    });
  }).join("");
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

function visualEffectComponent(state, id) {
  return listProjectIsfVisualComponents(state).find((component) => component.kind === "effect" && component.id === id)
    || getShaderComponent(id);
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}

function componentParamIsSignificant(component, state, path) {
  if (!component) return false;
  const base = `${pathForComponent(state, component)}.`;
  const relativePath = String(path || "").startsWith(base) ? String(path).slice(base.length) : String(path || "");
  return (component.significantParams || []).includes(relativePath);
}
