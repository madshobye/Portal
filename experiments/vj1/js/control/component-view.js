import { BLEND_MODES, VJ1 } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { getGeneratorComponent } from "../graph/generator-registry.js?v=terrain-mesh-near-1";
import { getShaderComponent } from "../shaders/shader-registry.js?v=shader-component-catalog-extraction-1";
import { featureMorphMediaControlsTemplate } from "./feature-morph-view.js?v=mobilenet-morph-v2-47";
import { generatorImageMediaControlTemplate } from "./generator-media-view.js?v=tile-texture-40";
import { generatorIcon } from "./picker-view.js?v=terrain-mesh-near-1";
import { colorParamControlTemplate, paramControlsTemplate, paramCurrentValue, shaderParamControlsTemplate } from "./parameter-view.js?v=render-coordinate-scope-3";
import { MEDIA_FIT_MODES, MODEL_RENDER_MODES, MODEL_SURFACE_COLOR_PARAM, MODEL_WIRE_COLOR_PARAM } from "./source-control-schema.js?v=source-control-schema-extraction-1";
import { effectIcon, esc, icon, rangeTemplate, selectValuesTemplate, sourceTypeIcon } from "./template-utils.js?v=slider-values-70";
import { editableSectionTitleTemplate, enableToggleButton, textListItemTemplate } from "./view-primitives.js?v=view-primitives-extraction-1";

const SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS = false;

export function canvasInspectorTemplate(component, state) {
  const base = pathForComponent(state, component);
  const canvas = component.canvas || { width: VJ1.canvasWidth, height: VJ1.canvasHeight };
  return `
    <article class="sculpt-card">
      <div class="field-pair">
        <label class="field">Width <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.width" value="${canvas.width}" /></label>
        <label class="field">Height <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.height" value="${canvas.height}" /></label>
      </div>
      ${componentUnifiedChainTemplate(component, state, base)}
    </article>
  `;
}

export function componentTemplate(component, state) {
  const base = pathForComponent(state, component);
  if (component.type === "canvas") {
    return `
      <article class="sculpt-card">
        ${componentInstanceSyncTemplate(component, base)}
        <div class="soft-note">This Canvas uses the shared component chain. Add components as sources with the plus button, organize them in Groups when needed, and define recording frames.</div>
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

export function componentSelectedChainSettingsTemplate(component, state) {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return "";
  return `
    <section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">
      ${selectedChainItemTemplate(selected.item, component, state, selected.path)}
    </section>
  `;
}

export function sourceIcon(source = {}) {
  if (source.type === "component") return "account_tree";
  if (source.type === "generator") return generatorIcon(source.generatorId || "testPattern");
  if (source.type === "media") return isModelMediaSource(source) ? "deployed_code" : "perm_media";
  if (source.type === "camera") return "photo_camera";
  if (source.type === "black") return "radio_button_unchecked";
  return sourceTypeIcon(source.type || "generator");
}

export function sourceChainItemDisplayName(item = {}, media = null, component = null) {
  if (item.source?.type === "component") return sourceTitle(item.source, media, component);
  if (!item.name || isGenericLayerName(item.name) || item.name === item.source?.componentId) {
    return sourceTitle(item.source || {}, media, component);
  }
  return item.name;
}

export function isModelMediaSource(source = {}, media = null) {
  if (media?.type === "model") return true;
  return /\.(stl|obj)$/i.test(String(source.mediaId || ""));
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

function componentInstanceSyncTemplate(component, base, compact = false) {
  const enabled = component.syncInstances !== false;
  const button = `
    <button type="button" class="${enabled ? "is-selected" : ""}" data-toggle-path="${base}.syncInstances" data-toggle-value="${enabled ? "true" : "false"}" aria-pressed="${enabled}" title="On keeps this Component synchronized everywhere; off gives each Canvas placement and surface its own phase">
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
  const megapixels = (metrics.width * metrics.height / 1000000).toFixed(2);
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
      <div class="component-frame-summary">
        <span>${metrics.baseWidth} × ${metrics.baseHeight} frame</span>
        <strong>${metrics.width} × ${metrics.height}</strong>
        <small>${metrics.effectiveScale}× effective · ${megapixels} MP</small>
      </div>
    </section>
  `;
}

function componentUnifiedChainTemplate(component, state, ownerPath) {
  return `
    <div class="chain-column">
      <section class="chain-list-section" aria-label="Elements">
        <div class="component-chain-list" data-chain-reorder-list data-component-id="${esc(component.id)}">
          ${chainItemsTemplate(component.chain || [], component, state, `${ownerPath}.chain`, 0, true)}
        </div>
        <button type="button" class="chain-add-button" data-open-element-picker data-component-id="${esc(component.id)}" title="Add element" aria-label="Add element">${icon("add")}</button>
      </section>
    </div>
  `;
}

function chainItemsTemplate(chain, component, state, base, depth = 0, topLevel = false) {
  if (!chain?.length) return depth ? `<div class="soft-note chain-group-empty">Group is empty</div>` : "";
  return chain.map((item, index) => chainItemRowTemplate(item, component, state, index, `${base}.${index}`, depth, topLevel ? chain.length : null)).join("");
}

function chainItemRowTemplate(item, component, state, index, base, depth = 0, topLevelLength = null) {
  const selected = state.ui.selectedChainItemId === item.id;
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const label = chainItemLabel(item, media, referencedComponent);
  const iconName = chainItemIcon(item);
  const kindLabel = item.kind === "source" ? item.source?.type || "source" : item.kind === "group" ? `${item.chain?.length || 0} item group` : "effect";
  const canRemove = item.kind === "group" || depth > 0 || topLevelLength === null || topLevelLength > 1;
  const row = textListItemTemplate({
    rowClass: "chain-item-row",
    selected,
    reorderId: item.id,
    leadingHtml: enableToggleButton({
      path: `${base}.enabled`,
      value: item.enabled !== false,
      iconName,
      label,
    }),
    label,
    meta: kindLabel,
    mainClass: "chain-item-select",
    mainAction: "data-select-chain-item",
    mainActionId: item.id,
    removeClass: "chain-item-remove",
    removeAttributes: `data-component-id="${esc(component.id)}" data-remove-chain-item="${esc(item.id)}"`,
    removeDisabled: !canRemove,
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

function selectedChainItemTemplate(item, component, state, base) {
  if (item.kind === "source") return sourceChainItemTemplate(item, component, state, base);
  if (item.kind === "group") return groupChainItemTemplate(item, component, state, base);
  const effectComponent = getShaderComponent(item.componentId);
  return `
    <section class="chain-item-editor">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">${effectIcon(item.componentId)}</span><span>${esc(effectComponent?.name || item.componentId)}</span></div>
      ${shaderParamControlsTemplate(effectComponent, item, base)}
      ${effectComponent?.spatial && SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS ? effectTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function groupChainItemTemplate(item, component, state, base) {
  return `
    <section class="chain-item-editor">
      ${editableSectionTitleTemplate("account_tree", base + ".name", item.name || "Group")}
      <label class="field inline-param">
        <span>Collapsed</span>
        <input type="checkbox" data-update="${base}.collapsed" ${item.collapsed ? "checked" : ""} />
      </label>
      <div class="chain-composite-controls group-composite-controls">
        <label class="field"><span>Blend</span>${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend || "normal")}</label>
        ${rangeTemplate("Alpha", `${base}.opacity`, item.opacity ?? 1)}
      </div>
      <button type="button" class="chain-add-button" data-open-element-picker data-component-id="${esc(component.id)}" data-target-chain-item="${esc(item.id)}" title="Add element to group" aria-label="Add element to group">${icon("add")}</button>
      <div class="soft-note">Use the preview handles to move, scale, or rotate the group as one unit.</div>
    </section>
  `;
}

function sourceChainItemTemplate(item, ownerComponent, state, base) {
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const displayName = sourceChainItemDisplayName(item, media, referencedComponent);
  const isCanvasComponentPlacement = ownerComponent?.type === "canvas" && item.source?.type === "component";
  return `
    <section class="chain-item-editor">
      ${isCanvasComponentPlacement
        ? `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${sourceIcon(item.source)}</span><span>${esc(displayName)}</span></div>`
        : editableSectionTitleTemplate(sourceIcon(item.source), base + ".name", displayName)}
      ${item.source?.type === "component"
        ? (isCanvasComponentPlacement ? "" : `<label class="field">Component ${componentSelectTemplate(`${base}.source.componentId`, state, item.source.componentId)}</label>`)
        : sourcePickerTemplate(item, state, base)}
      <div class="chain-composite-controls">
        <label class="field"><span>Blend</span>${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend)}</label>
        ${rangeTemplate("Opacity", `${base}.opacity`, item.opacity)}
      </div>
      ${SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS ? sourceTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function componentSelectTemplate(path, state, value, excludeId = "") {
  const options = state.components.filter((component) => component.id !== excludeId && component.type !== "canvas");
  return `
    <select data-update="${esc(path)}">
      <option value="">None</option>
      ${options.map((component) => `<option value="${esc(component.id)}" ${component.id === value ? "selected" : ""}>${esc(component.name)}</option>`).join("")}
    </select>
  `;
}

function sourceTransformControlsTemplate(item, base) {
  return `
    <div class="field-pair">
      ${rangeTemplate("X", `${base}.transform.x`, item.transform?.x || 0, -1, 1, 0.01)}
      ${rangeTemplate("Y", `${base}.transform.y`, item.transform?.y || 0, -1, 1, 0.01)}
    </div>
    <div class="field-pair">
      ${rangeTemplate("Scale", `${base}.transform.scale`, item.transform?.scale ?? 1, 0.1, 3, 0.01)}
      ${rangeTemplate("Rotate", `${base}.transform.rotation`, item.transform?.rotation || 0, -3.14, 3.14, 0.01)}
    </div>
  `;
}

function effectTransformControlsTemplate(item, base) {
  return sourceTransformControlsTemplate(item, base);
}

function selectedChainItemSelection(component, state) {
  const base = `${pathForComponent(state, component)}.chain`;
  const selected = findChainItemSelection(component.chain || [], state.ui.selectedChainItemId, base);
  return selected || firstChainItemSelection(component.chain || [], base);
}

function sourcePickerTemplate(component, state, base) {
  const source = component.source || {};
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      ${source.type === "generator" ? "" : `<div class="field">
        <span>Source</span>
        <button type="button" class="source-choice-button" data-open-source-choice="${esc(`${base}.source`)}">
          ${icon(sourceIcon(source))}
          <span>
            <strong>${esc(sourceTitle(source, media))}</strong>
            <small>${esc(sourceSubtitle(source, media))}</small>
          </span>
          ${icon("chevron_right")}
        </button>
      </div>`}
      ${source.type === "generator" ? generatorParamControlsTemplate(`${base}.source`, source, state) : ""}
      ${source.type === "media" && !isModelMediaSource(source, media) ? mediaSourceFitControlsTemplate(`${base}.source`, source) : ""}
      ${source.type === "media" && isVideoMediaSource(source, media) ? videoSourceControlsTemplate(`${base}.source`, source, media) : ""}
      ${source.type === "media" && isModelMediaSource(source, media) ? modelSourceControlsTemplate(`${base}.source`, source) : ""}
      ${source.type === "camera" ? `<div class="soft-note">Using the portal camera feed.</div>` : ""}
      ${source.type === "black" ? `<div class="soft-note">Black source selected.</div>` : ""}
    </div>
  `;
}

function mediaSourceFitControlsTemplate(base, source = {}) {
  return `
    ${rangeTemplate("Render quality", `${base}.params.renderQuality`, source.params?.renderQuality ?? 0.5, 0, 1, 0.01)}
    <label class="field chain-param">Fit ${selectValuesTemplate(`${base}.params.fit`, MEDIA_FIT_MODES, source.params?.fit || "contain")}</label>
  `;
}

function sourceTitle(source = {}, media = null, component = null) {
  if (source.type === "component") return component?.name || source.componentId || "Component";
  if (source.type === "generator") return getGeneratorComponent(source.generatorId || "testPattern").label || getGeneratorComponent(source.generatorId || "testPattern").name;
  if (source.type === "media") return media?.name || source.mediaId || "Media";
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

function chainItemLabel(item = {}, media = null, component = null) {
  if (item.kind === "source") return sourceChainItemDisplayName(item, media, component);
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
      ${rangeTemplate("Movie speed", `${base}.speed`, source.speed ?? 1, 0, 4, 0.01)}
    </div>
  `;
}

function videoTrimTemplate(base, trim) {
  const startPercent = trim.max ? (trim.start / trim.max) * 100 : 0;
  const endPercent = trim.max ? (trim.end / trim.max) * 100 : 100;
  return `
    <div
      class="video-trim-control"
      data-video-trim
      data-video-trim-implicit-end="${trim.implicitEnd ? "true" : "false"}"
      style="--trim-start: ${startPercent.toFixed(3)}%; --trim-end: ${endPercent.toFixed(3)}%;"
    >
      <div class="video-trim-labels">
        <span>Start <strong data-video-trim-label="start">${formatTrimTime(trim.start)}</strong></span>
        <span>End <strong data-video-trim-label="end">${formatTrimTime(trim.end)}</strong></span>
      </div>
      <div class="video-trim-slider">
        <div class="video-trim-track" aria-hidden="true"></div>
        <input type="range" min="0" max="${trim.max}" step="0.01" value="${trim.start}" data-update="${base}.start" data-video-trim-input="start" aria-label="Movie segment start" />
        <input type="range" min="0" max="${trim.max}" step="0.01" value="${trim.end}" data-update="${base}.end" data-video-trim-input="end" aria-label="Movie segment end" />
      </div>
    </div>
  `;
}

function videoTrimValues(source = {}, media = null) {
  const duration = Number(media?.duration) > 0 ? Number(media.duration) : 0;
  const start = Math.max(0, Number(source.start) || 0);
  const explicitEnd = Math.max(0, Number(source.end) || 0);
  const max = Math.max(duration, explicitEnd, start, 60);
  const end = explicitEnd > start ? explicitEnd : max;
  return {
    start: roundTrimTime(Math.min(start, max)),
    end: roundTrimTime(Math.min(Math.max(end, start), max)),
    max: roundTrimTime(max),
    implicitEnd: !(explicitEnd > start),
  };
}

function isVideoMediaSource(source = {}, media = null) {
  if (media?.type === "video") return true;
  return /\.(mp4|m4v|mov|webm|ogv)$/i.test(String(source.mediaId || ""));
}

function modelSourceControlsTemplate(base, source = {}) {
  const params = source.params || {};
  return `
    <div class="model-source-controls">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">deployed_code</span><span>3D model</span></div>
      ${rangeTemplate("Render quality", `${base}.params.renderQuality`, params.renderQuality ?? 0.5, 0, 1, 0.01)}
      <label class="field chain-param">Draw mode ${selectValuesTemplate(`${base}.params.renderMode`, MODEL_RENDER_MODES, params.renderMode || "surface")}</label>
      ${colorParamControlTemplate(MODEL_SURFACE_COLOR_PARAM, `${base}.params.surfaceColor`, params.surfaceColor || MODEL_SURFACE_COLOR_PARAM.defaultValue)}
      ${colorParamControlTemplate(MODEL_WIRE_COLOR_PARAM, `${base}.params.wireColor`, params.wireColor || MODEL_WIRE_COLOR_PARAM.defaultValue)}
      <div class="model-param-list">
        ${rangeTemplate("Rotate X", `${base}.params.rotationX`, params.rotationX || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Rotate Y", `${base}.params.rotationY`, params.rotationY || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Rotate Z", `${base}.params.rotationZ`, params.rotationZ || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Scale", `${base}.params.modelScale`, params.modelScale ?? 1, 0.1, 5, 0.01)}
        ${rangeTemplate("Spin X", `${base}.params.spinX`, params.spinX || 0, -3, 3, 0.01)}
        ${rangeTemplate("Spin Y", `${base}.params.spinY`, params.spinY || 0, -3, 3, 0.01)}
        ${rangeTemplate("Spin Z", `${base}.params.spinZ`, params.spinZ || 0, -3, 3, 0.01)}
        ${rangeTemplate("Depth scale", `${base}.params.depth`, params.depth ?? 1, 0.2, 3, 0.01)}
        ${rangeTemplate("Visible depth", `${base}.params.visibleDepth`, params.visibleDepth ?? 1, 0.02, 1, 0.01)}
        ${rangeTemplate("Wire thickness", `${base}.params.wireThickness`, params.wireThickness ?? 1, 0.5, 12, 0.1)}
        ${rangeTemplate("Point budget", `${base}.params.pointBudget`, params.pointBudget ?? 4000, 500, 50000, 500)}
      </div>
    </div>
  `;
}

function generatorParamControlsTemplate(base, source = {}, state = {}) {
  const component = getGeneratorComponent(source.generatorId || "testPattern");
  if (!component?.params?.length) return "";
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
      ${mediaControls}
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${base}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, { params: source.params || {} }, param),
      })}
    </div>
  `;
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
