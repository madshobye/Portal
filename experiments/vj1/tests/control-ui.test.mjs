import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";
import { elementMediaCategory, elementPickerTemplate, sourceChoicePickerTemplate } from "../js/control/picker-view.js";
import { settingsModalTemplate } from "../js/control/settings-view.js";
import { createInitialState } from "../js/domain/models.js";
import { previewFitSignature, previewRasterDensity, retimeEmbeddedLiveTransition, shouldPrepareEmbeddedLiveState } from "../js/output/embedded-preview-app.js";
import { isPointerInteractionNode, rememberScrollPositions, restoreScrollPositions } from "../js/control/dom-utils.js";
import { scrollRegionTemplate } from "../js/control/view-primitives.js";
import { applyOptimisticToggleIntent } from "../js/control/input-controller.js";
import { activeRenderCost, activeWorkMetric, performanceHealthStep, rememberParamViewSelections, restoreParamViewSelections } from "../js/control/control-shell-controller.js";
import { mediaSourceParams } from "../js/control/source-control-schema.js";

test("inspector parameter views survive template replacement", () => {
  const selections = new Map();
  const selectedDetails = { name: "chain-param-view-item-1", id: "chain-param-view-item-1-details", checked: true };
  rememberParamViewSelections({
    querySelectorAll(selector) {
      return selector === ".chain-param-view-input:checked" ? [selectedDetails] : [];
    },
  }, selections);

  const replacementPrimary = { name: selectedDetails.name, id: "chain-param-view-item-1-content", checked: true };
  const replacementDetails = { name: selectedDetails.name, id: selectedDetails.id, checked: false };
  restoreParamViewSelections({
    querySelectorAll(selector) {
      return selector === ".chain-param-view-input" ? [replacementPrimary, replacementDetails] : [];
    },
  }, selections);

  assert.equal(selections.get(selectedDetails.name), selectedDetails.id);
  assert.equal(replacementDetails.checked, true);
});

test("keyed list scroll survives template replacement without entering project state", () => {
  const positions = new Map();
  const componentList = { dataset: { scrollRegion: "", scrollKey: "component-catalog" }, scrollTop: 184, scrollLeft: 3 };
  const frameList = { dataset: { scrollRegion: "", scrollKey: "recording-frames" }, scrollTop: 72, scrollLeft: 0 };
  const scope = {
    matches: () => false,
    querySelectorAll: () => [componentList, frameList],
  };

  rememberScrollPositions(scope, positions);
  componentList.scrollTop = 0;
  componentList.scrollLeft = 0;
  frameList.scrollTop = 0;
  restoreScrollPositions(scope, positions);

  assert.deepEqual(positions.get("component-catalog"), { top: 184, left: 3 });
  assert.equal(componentList.scrollTop, 184);
  assert.equal(componentList.scrollLeft, 3);
  assert.equal(frameList.scrollTop, 72);
});

test("rapid toggles preserve commanded user truth before render acknowledgement", () => {
  const classes = new Set(["is-enabled"]);
  const attributes = {};
  const button = {
    dataset: { toggleValue: "true" },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    setAttribute(name, value) { attributes[name] = value; },
  };
  assert.equal(applyOptimisticToggleIntent(button), false);
  assert.equal(button.dataset.toggleValue, "false");
  assert.equal(classes.has("is-enabled"), false);
  assert.equal(attributes["aria-pressed"], "false");
  assert.equal(applyOptimisticToggleIntent(button), true);
  assert.equal(button.dataset.toggleValue, "true");
  assert.equal(classes.has("is-enabled"), true);
});

test("preview presses defer UI rebuilding and draggable chain rows select on press", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const previewTarget = {
    closest(selector) {
      return selector === "[data-embedded-preview-stage]" ? this : null;
    },
  };
  const passiveTarget = { closest() { return null; } };

  assert.equal(isPointerInteractionNode(previewTarget), true);
  assert.equal(isPointerInteractionNode(passiveTarget), false);
  assert.ok(controllerSource.includes("if (!isPointerInteractionNode(event.target)) return;"));
  assert.match(inputSource, /querySelectorAll\("\[data-select-chain-item\]"\)[\s\S]*?addEventListener\("pointerdown"/);
  assert.ok(inputSource.includes('button.addEventListener("click", select);'));
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.ok(previewSource.includes('element.setPointerCapture?.(event.pointerId);'));
  assert.ok(previewSource.includes('element.addEventListener("pointermove", onPointerMove);'));
  assert.ok(!previewSource.includes("canvas.mousePressed("));
});

test("media pickers defer image video and model resources until cards approach the viewport", () => {
  let previewAcquisitions = 0;
  const media = Array.from({ length: 100 }, (_, index) => ({
    id: `media/clip-${index}.mp4`,
    name: `clip-${index}.mp4`,
    path: `media/clip-${index}.mp4`,
    type: "video",
  }));
  const html = elementPickerTemplate({
    media,
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
  }, { componentId: "owner" }, {
    getFile: () => ({}),
    acquirePreviewUrl() {
      previewAcquisitions++;
      return "blob:should-not-be-created-during-template-render";
    },
  });
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");

  assert.equal(previewAcquisitions, 0, "template construction remains metadata-only");
  assert.equal((html.match(/data-media-preview-id=/g) || []).length, 100);
  assert.equal((html.match(/preload="none"/g) || []).length, 100);
  assert.ok(!html.includes("blob:should-not-be-created"));
  assert.match(modalSource, /new IntersectionObserver/);
  assert.match(modalSource, /rootMargin: "360px 0px"/);
  assert.match(modalSource, /mediaLibrary\.releasePreviewUrl\?\.\(mediaId\)/);
  assert.match(modalSource, /mediaPreviewActivationTokens/);
  assert.match(modalSource, /maxRetainedMediaPreviews = 500/);
  assert.match(modalSource, /visibleMediaPreviews\.has\(preview\)/);
  assert.doesNotMatch(modalSource, /scheduleMediaPreviewUnload|mediaPreviewUnloadTimers/);
  assert.match(html, /class="media-preview-frame"/);
  assert.match(modalSource, /\[VJ1_MEDIA_PREVIEW_OBSERVER_UNAVAILABLE\]/);
});

test("element picker filters media and render elements by explicit category", () => {
  const owner = { id: "canvas", type: "canvas", name: "Canvas", chain: [] };
  const component = { id: "component", type: "chain", name: "Source", chain: [] };
  const html = elementPickerTemplate({
    components: [owner, component],
    media: [
      { id: "photo", name: "photo.png", path: "media/photo.png", type: "image" },
      { id: "clip", name: "clip.mp4", path: "media/clip.mp4", type: "video" },
      { id: "mesh", name: "mesh.obj", path: "media/mesh.obj", type: "model" },
    ],
  }, { componentId: owner.id, filter: "model" }, { getFile: () => null }, {
    components: [owner, component],
    sortMode: "recent",
  });
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");

  assert.equal(elementMediaCategory({ type: "image" }), "image");
  assert.equal(elementMediaCategory({ type: "video" }), "video");
  assert.equal(elementMediaCategory({ path: "media/shape.stl", type: "unknown" }), "model");
  assert.match(html, /data-element-filter="image"/);
  assert.match(html, /data-element-filter="video"/);
  assert.match(html, /class="is-active" data-element-filter="model"/);
  assert.match(html, /data-element-filter="generator"/);
  assert.match(html, /data-element-filter="effect"/);
  assert.match(html, /data-element-filter="component"/);
  assert.match(html, /data-element-category="image"[\s\S]*?data-add-element-media="photo"/);
  assert.match(html, /data-element-category="video"[\s\S]*?data-add-element-media="clip"/);
  assert.match(html, /data-element-category="model"[\s\S]*?data-add-element-media="mesh"/);
  assert.match(modalSource, /classList\.toggle\("is-filter-hidden"/);
  assert.match(modalSource, /filter !== "all" && category !== filter/);
});

test("source chooser exposes category filters and model sources lock it to 3D", () => {
  const state = {
    components: [],
    media: [
      { id: "photo", name: "photo.png", path: "media/photo.png", type: "image" },
      { id: "clip", name: "clip.mp4", path: "media/clip.mp4", type: "video" },
      { id: "mesh", name: "mesh.stl", path: "media/mesh.stl", type: "model" },
    ],
    target: { source: { type: "media", mediaId: "mesh" } },
  };
  const general = sourceChoicePickerTemplate(state, { path: "target.source" }, { getFile: () => null });
  assert.match(general, /data-element-filter="image"/);
  assert.match(general, /data-element-filter="video"/);
  assert.match(general, /data-element-filter="model"/);
  assert.match(general, /data-element-filter="generator"/);
  assert.match(general, /data-element-category="model" data-element-search-card=/);

  const modelOnly = sourceChoicePickerTemplate(state, {
    path: "target.source",
    allowedCategory: "model",
    filter: "model",
  }, { getFile: () => null });
  assert.match(modelOnly, /data-element-filter="model"[^>]*disabled/);
  assert.match(modelOnly, /placeholder="Search 3D objects"/);
  assert.match(modelOnly, /data-pick-source-media="mesh"/);
  assert.doesNotMatch(modelOnly, /data-pick-source-media="photo"/);
  assert.doesNotMatch(modelOnly, /data-pick-source-media="clip"/);
  assert.doesNotMatch(modelOnly, /data-pick-source-generator/);
  assert.doesNotMatch(modelOnly, /data-pick-source-camera/);

  const imageValueOnly = sourceChoicePickerTemplate({
    ...state,
    target: { imageId: "photo" },
  }, {
    path: "target.imageId",
    allowedCategory: "image",
    filter: "image",
    valueMode: "mediaId",
  }, { getFile: () => null });
  assert.match(imageValueOnly, />Choose image</);
  assert.match(imageValueOnly, /data-element-filter="image"[^>]*disabled/);
  assert.match(imageValueOnly, /data-pick-source-media="photo"/);
  assert.match(imageValueOnly, /media-element-card is-selected/);
  assert.doesNotMatch(imageValueOnly, /data-pick-source-media="clip"/);
  assert.doesNotMatch(imageValueOnly, /data-pick-source-media="mesh"/);
  assert.doesNotMatch(imageValueOnly, /data-pick-source-generator/);

  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(style, /\.element-modal\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\)/s);
  assert.match(index, /style\.css\?v=[^"']+/);
});

test("media refresh is explicit and never polls during rendering", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");

  assert.ok(pickerSource.includes("data-refresh-media"));
  assert.ok(modalSource.includes("await refreshMedia();"));
  assert.ok(modalSource.includes("[VJ1_MEDIA_REFRESH_FAILED]"));
  assert.ok(!appSource.includes("setInterval(() => projectService.refreshFolder(), 5000)"));
  assert.ok(!appSource.includes('addEventListener("focus"'));
  assert.ok(!appSource.includes('addEventListener("visibilitychange"'));
});

test("element picker releases editor focus before committing a chain insertion", () => {
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const addElement = modalSource.slice(
    modalSource.indexOf("  function addElement(kind, value)"),
    modalSource.indexOf("  function renderMediaPicker", modalSource.indexOf("  function addElement(kind, value)"))
  );

  assert.ok(addElement.indexOf("closeElementPicker();") < addElement.indexOf("store.addChainEffect"));
  assert.ok(addElement.includes("const target = elementPicker;"));
  assert.ok(addElement.includes("activateElementPickerTarget(target);"));
  assert.ok(addElement.includes("store.addChainSource(target.componentId, value)"));
  assert.ok(addElement.includes("store.addChainGroup(target.componentId)"));
});

test("range params render their label and value above a full-width slider", () => {
  const sharedRange = rangeTemplate("Opacity", "components.0.opacity", 0.42);
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(sharedRange.includes('<span>Opacity</span>'));
  assert.ok(sharedRange.includes('<output class="range-value" data-range-value>0.42</output>'));
  assert.ok(!controllerSource.includes("formatParamValue("));
  assert.ok(controllerSource.includes("syncRangeValue(input)"));
  assert.ok(!controllerSource.includes("data-color-alpha-label"));
  assert.ok(styleSource.includes("--param-slider-width: 176px;"));
  assert.ok(styleSource.includes("grid-template-columns: auto minmax(0, 1fr);"));
  assert.match(styleSource, /\.range-value::before \{[\s\S]*?content: "\(";/);
  assert.match(styleSource, /\.range-value::after \{[\s\S]*?content: "\)";/);
  assert.match(styleSource, /\.chain-param-view-tab \{[\s\S]*?grid-row: 1;/);
  assert.match(styleSource, /\.chain-param-view-tab \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?min-height: 24px;[\s\S]*?padding: 3px 7px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 1;/);
  assert.match(styleSource, /\.chain-param-list \{[\s\S]*?align-self: start;[\s\S]*?align-content: start;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?align-content: start;[\s\S]*?padding: var\(--section-inset\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(styleSource, /\.chain-param-views \{[\s\S]*?column-gap: 6px;/);
  assert.match(styleSource, /\.chain-param-view-input:checked \+ \.chain-param-view-tab \{[\s\S]*?background: var\(--accent-strong\);/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?grid-row: 2;/);
  assert.match(styleSource, /\.chain-settings-panel \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?gap: 0;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?margin-top: 6px;/);
  assert.match(styleSource, /\.chain-param-views \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?overflow-y: auto;/);
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
  assert.ok(styleSource.includes(".live-chain-settings .chain-param-view-content"));
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
});

test("Component Canvas and Live inspectors give range tracks their own full-width row", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("refs.inspector.dataset.workspace = currentWorkspace(state);"));
  assert.match(styleSource, /\.range-field input\[type="range"\] \{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styleSource, /\.studio-inspector:is\(\[data-workspace="component"\], \[data-workspace="canvas"\], \[data-workspace="live"\]\) \.param-range-pair \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.ok(!styleSource.includes(".live-chain-pass .range-field"));
  assert.ok(!styleSource.includes(".chain-pass .range-field"));
  assert.ok(!styleSource.includes(".live-chain-pass .chain-param-list"));
  assert.ok(styleSource.includes(".live-chain-settings .field:not(.range-field)"));
  assert.ok(styleSource.includes("--range-stack-gap: 7px;"));
  assert.match(styleSource, /\.chain-param-list \{[\s\S]*?gap: var\(--range-stack-gap\);/);
});

test("all renderable chain elements expose shared quality opacity blend and placement through General", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('createNumberParam("opacity", "Opacity"'));
  assert.ok(parameterSource.includes('createEnumParam("blend", "Blend", BLEND_MODES'));
  assert.ok(parameterSource.includes("[RENDER_QUALITY_PARAM, ...CHAIN_GENERAL_PARAMS]"));
  assert.ok(parameterSource.includes("chainRenderQualityTarget(item, basePath)"));
  assert.ok(parameterSource.includes('{ id: "general", label: "General", html: general }'));
  assert.ok(componentSource.includes("chainGeneralControlsTemplate(item, base"));
  assert.ok(sceneLiveSource.includes("chainGeneralControlsTemplate(item, path"));
  assert.doesNotMatch(componentSource, /rangeTemplate\("Alpha", `\$\{base\}\.opacity`/);
  assert.doesNotMatch(sceneLiveSource, /liveRangeTemplate\("Alpha", componentId, `\$\{path\}\.opacity`/);
});

test("paired HSV ranges render two accessible handles and shared range state", () => {
  const html = paramRangePairTemplate({
    minParam: { id: "hueMin", label: "Hue", min: 0, max: 360, step: 1, rangeKind: "hue", rangeDisplay: "degrees" },
    maxParam: { id: "hueMax", label: "Hue", min: 0, max: 360, step: 1, rangeKind: "hue", rangeDisplay: "degrees" },
    minPath: "components.0.chain.1.params.hueMin",
    maxPath: "components.0.chain.1.params.hueMax",
    minValue: 200,
    maxValue: 260,
  });
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(html.includes("data-param-range"));
  assert.ok(html.includes('data-param-range-input="min"'));
  assert.ok(html.includes('data-param-range-input="max"'));
  assert.ok(html.includes('aria-label="Hue minimum"'));
  assert.ok(html.includes('aria-label="Hue maximum"'));
  assert.ok(html.includes("200°"));
  assert.ok(html.includes("260°"));
  assert.ok(controllerSource.includes("bindParamRangeControl"));
  assert.ok(controllerSource.includes("updateParamRangeFromInputs"));
  assert.ok(controllerSource.includes("syncParamRangeControl"));
  assert.ok(styleSource.includes('.param-range-pair[data-range-kind="hue"]'));
});

test("component panel exposes frame shape and relative resolution controls", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(componentSource.includes('data-set-path="${base}.frameShape"'));
  assert.ok(componentSource.includes('data-set-path="${base}.resolutionScale"'));
  assert.ok(componentSource.includes('["landscape", "Landscape"]'));
  assert.ok(componentSource.includes('["portrait", "Portrait"]'));
  assert.ok(componentSource.includes('["square", "Square"]'));
  assert.ok(componentSource.includes("const scaleOptions = [0.5, 1, 2];"));
  assert.ok(!componentSource.includes("component-frame-summary"));
  assert.ok(styleSource.includes(".component-option-grid"));
});

test("control surfaces share one flat section module and concentric corner tokens", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('class="ui-section rail-section"'));
  assert.ok(primitivesSource.includes('class="ui-section focus-panel"'));
  assert.ok(pickerSource.includes('class="ui-section element-section"'));
  assert.ok(settingsSource.includes('class="ui-section element-section"'));
  assert.ok(styleSource.includes("--section-inset: 6px;"));
  assert.ok(styleSource.includes("--radius-section: 12px;"));
  assert.ok(styleSource.includes("--radius-section-inner: 6px;"));
  assert.match(styleSource, /\.ui-section \{[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section\);/);
  assert.match(styleSource, /\.ui-section-header,[\s\S]*?min-height: 30px;[\s\S]*?padding: 4px 8px;/);
  assert.ok(styleSource.includes(".section-toolbar"));
  assert.match(styleSource, /\.section-toolbar \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.ok(!styleSource.includes(".component-frame-summary"));
  assert.match(styleSource, /\.text-list-item \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.ok(componentSource.includes('class="section-toolbar component-quick-toolbar"'));
});

test("topbar identity stays neutral until interaction", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.brand-mark \{[\s\S]*?background: var\(--panel-soft\);[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.project-button \.material-symbols-rounded \{[\s\S]*?color: var\(--muted\);/);
});

test("collection workspaces keep controls fixed and scroll only their list bodies", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("refs.projectRail.dataset.workspace = workspace"));
  assert.match(styleSource, /\.project-rail:is\(\[data-workspace="component"\][\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /> \.rail-list-section \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;/);
  assert.match(styleSource, /\.project-rail\[data-workspace="live"\] > \.live-component-rail-section \{[\s\S]*?flex-grow: 0\.6;/);
  assert.match(controllerSource, /class="ui-section rail-section rail-list-section live-component-rail-section"[\s\S]*?<span>Scene components<\/span>/);
  assert.match(styleSource, /\.project-rail\[data-workspace="scene"\] > \.scene-surface-rail-section \{[\s\S]*?flex-grow: 0\.6;/);
  assert.match(controllerSource, /class="ui-section rail-section rail-list-section scene-surface-rail-section"[\s\S]*?"Surfaces"/);
  assert.match(styleSource, /\.project-rail\[data-workspace="canvas"\] > \.canvas-frame-rail-section \{[\s\S]*?flex-grow: 0\.6;/);
  assert.match(controllerSource, /class="ui-section rail-section rail-list-section canvas-frame-rail-section"[\s\S]*?"Frames"/);
  assert.match(styleSource, /\.rail-list-section > \.rail-scroll-list \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(styleSource, /\.studio-inspector:is\(\[data-workspace="component"\][\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.component-chain-list,[\s\S]*?align-content: start;[\s\S]*?overflow-y: auto;/);
  assert.match(controllerSource, /class="component-card-list rail-scroll-list"/);
  assert.match(controllerSource, /class="scene-card-list rail-scroll-list"/);
});

test("selection rerenders preserve every keyed catalog and chain viewport", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const domSource = readFileSync(new URL("../js/control/dom-utils.js", import.meta.url), "utf8");

  for (const key of ["component-catalog", "canvas-catalog", "recording-frames", "scene-catalog", "scene-surfaces", "live-scenes", "live-components", "mapping-components"]) {
    assert.ok(controllerSource.includes(`data-scroll-region data-scroll-key="${key}"`), `missing scroll region: ${key}`);
  }
  assert.ok(componentSource.includes("scrollRegionTemplate(`component-chain:${component.id}`"));
  assert.ok(componentSource.includes("scrollRegionTemplate(`chain-params:${component.id}:${item.id}:${view.id}`"));
  assert.ok(sceneSource.includes('data-scroll-region data-scroll-key="live-controls:${esc(component.id)}"'));
  assert.ok(sceneSource.includes('data-scroll-region data-scroll-key="live-elements:${esc(componentId)}"'));
  assert.ok(sceneSource.includes("scrollRegionTemplate(`live-chain-params:${componentId}:${item.id}:${view.id}`"));
  assert.ok(sceneSource.includes('data-scroll-region data-scroll-key="surface-sources:${esc(routeBase)}"'));
  assert.ok(pickerSource.includes('data-scroll-region data-scroll-key="source-picker-results"'));
  assert.ok(pickerSource.includes('data-scroll-region data-scroll-key="element-picker-results"'));
  assert.match(domSource, /rememberScrollPositions\(node, scrollPositions\);[\s\S]*?node\.innerHTML = next;[\s\S]*?restoreScrollPositions\(node, scrollPositions\);/);
});

test("scroll region primitive gives every rerendered viewport a stable identity", () => {
  const html = scrollRegionTemplate("component:one & two", "<span>content</span>", { className: "chain-param-view-panel", tagName: "section" });
  assert.match(html, /^<section class="chain-param-view-panel" data-scroll-region data-scroll-key="component:one &amp; two"/);
  assert.ok(html.includes("<span>content</span>"));
});

test("every workspace rail uses the same constrained first-column module", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styleSource, /\.rail-section \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(controllerSource, /addableRailTitleTemplate\("account_tree", "Components", "data-add-component"/);
  assert.match(controllerSource, /addableRailTitleTemplate\("dashboard_customize", "Canvases", "data-add-canvas-component"/);
  assert.match(controllerSource, /addableRailTitleTemplate\("auto_awesome_motion", "Scenes", "data-add-scene"/);
  assert.match(controllerSource, /addableRailTitleTemplate\("select_all", "Frames", `data-add-canvas-frame/);
  assert.match(controllerSource, /addableRailTitleTemplate\("select_all", "Surfaces", "data-add-surface"/);
  assert.match(styleSource, /\.rail-title-add \{[\s\S]*?width: 22px;[\s\S]*?margin-left: auto;/);
  assert.doesNotMatch(styleSource, /\.capture-row/);
});

test("render-chain, frame, and surface rows share the compact list density", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");

  assert.match(styleSource, /\.component-chain-list \{[\s\S]*?gap: 3px;[\s\S]*?align-content: start;/);
  assert.match(styleSource, /\.compact-list-row \{[\s\S]*?--text-list-leading-size: 27px;[\s\S]*?min-height: 34px;/);
  assert.match(styleSource, /\.compact-list-row \.enable-toggle,[\s\S]*?\.compact-list-row \.text-list-static-icon,[\s\S]*?height: 28px;[\s\S]*?min-height: 28px;/);
  assert.match(componentSource, /rowClass: "chain-item-row compact-list-row"/);
  assert.match(controllerSource, /function canvasFramePillTemplate[\s\S]*?rowClass: "list-row compact-list-row"/);
  assert.match(sceneSource, /function sceneSurfacePillTemplate[\s\S]*?rowClass: "list-row compact-list-row"/);
  assert.match(styleSource, /\.chain-group-drop-zone \{[\s\S]*?min-height: 14px;/);
});

test("the scrollbar lane replaces excess space between the two control columns", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.studio-layout \{[\s\S]*?column-gap: 4px;[\s\S]*?row-gap: 12px;/);
  assert.match(styleSource, /\.studio-main \{[\s\S]*?margin-left: 8px;/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.studio-main \{[\s\S]*?margin-left: 0;/);
});

test("editable element names live in their section headers beside the icon", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitivesSource.includes("function titleInputTemplate(path, value)"));
  assert.ok(primitivesSource.includes("function editableSectionTitleTemplate(iconName, path, value)"));
  assert.ok(primitivesSource.includes('class="section-title-input"'));
  assert.match(controllerSource, /from "\.\/view-primitives\.js\?v=[^"]+"/);
  assert.ok(!controllerSource.includes('class="sculpt-head"'));
  assert.ok(settingsSource.includes('class="section-title-input"'));
  assert.ok(!settingsSource.includes('<label class="field">Name <input'));
  assert.ok(styleSource.includes(".ui-section-header .section-title-input"));
  assert.match(styleSource, /\.ui-section-header,[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.ui-section-header \.section-title-input \{[\s\S]*?flex: 1 1 0;[\s\S]*?max-width: 100%;[\s\S]*?color: inherit;[\s\S]*?font-size: inherit;[\s\S]*?font-weight: inherit;[\s\S]*?letter-spacing: inherit;[\s\S]*?text-transform: inherit;/);
  assert.doesNotMatch(styleSource, /\.ui-section-header \.section-title-input \{[^}]*font-size: 14px;/);
});

test("thumbnail list items share a connected image and bottom label bar", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitivesSource.includes("function componentCardBarTemplate(label)"));
  assert.ok(primitivesSource.includes('class="component-card-bar"'));
  assert.match(styleSource, /\.component-card > \.component-thumbnail,[\s\S]*?border-radius: var\(--radius-section-inner\) var\(--radius-section-inner\) 0 0;/);
  assert.match(styleSource, /\.component-card-bar \{[\s\S]*?min-height: 26px;[\s\S]*?padding: 4px 8px;[\s\S]*?border-radius: 0 0 var\(--radius-section-inner\) var\(--radius-section-inner\);[\s\S]*?background: #000;/);
  assert.match(styleSource, /\.component-card-bar span \{[\s\S]*?color: var\(--muted\);/);
  assert.match(styleSource, /\.component-card\.is-selected \.component-card-bar span \{[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.component-card-remove \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/);
  assert.match(styleSource, /\.component-card-row:hover \.component-card-remove \{[\s\S]*?visibility: visible;[\s\S]*?transition-delay: 600ms, 0s, 0s, 600ms;/);
  assert.match(styleSource, /\.component-card-row:focus-within \.component-card-remove \{[\s\S]*?transition-delay: 0s;/);
});

test("ordinary sliders use the compact track and square active handle from the UI system", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(styleSource.includes("--accent-strong: #6f3300;"));
  assert.ok(styleSource.includes("--slider-track: #454545;"));
  assert.ok(styleSource.includes("--slider-thumb: #9a9997;"));
  assert.ok(styleSource.includes("--slider-text: #777674;"));
  assert.match(styleSource, /\.range-field > span \{[\s\S]*?color: var\(--slider-text\);/);
  assert.match(styleSource, /\.range-value \{[\s\S]*?color: var\(--slider-text\);/);
  assert.ok(styleSource.includes("--slider-height: 18px;"));
  assert.match(styleSource, /input\[type="range"\] \{[\s\S]*?height: 20px;/);
  assert.match(styleSource, /input\[type="range"\]::\-webkit-slider-thumb \{[\s\S]*?width: var\(--slider-height\);[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: 0;[\s\S]*?background: var\(--slider-thumb\);/);
  assert.match(styleSource, /input\[type="range"\]::\-webkit-slider-runnable-track \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--slider-track\);/);
  assert.match(styleSource, /\.param-range-track \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /input\[type="range"\]:active::\-webkit-slider-thumb,[\s\S]*?background: var\(--accent-strong\);/);
});

test("movie trim keeps two handles while sharing the ordinary slider geometry", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.video-trim-track \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /\.video-trim-slider input\[type="range"\]::\-webkit-slider-thumb \{[\s\S]*?width: var\(--slider-height\);[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: 0;/);
  assert.match(styleSource, /\.video-trim-slider input\[type="range"\]:active::\-webkit-slider-thumb,[\s\S]*?background: var\(--accent-strong\);/);
});

test("scene surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.ok(!source.includes("Scene assignment"));
  assert.ok(source.includes('const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"]'));
  assert.ok(source.includes("Projection fit"));
  assert.ok(source.includes("sceneBase}.projectionFit"));
  assert.ok(source.includes('rangeTemplate("Feather", `${surfaceBase}.feather`'));
  assert.ok(source.indexOf("Projection fit") < source.indexOf("componentAssignmentTemplate(sceneBase"));
});

test("component catalogs expose shared local filtering", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("componentFilterTemplate"));
  assert.ok(source.includes("data-component-filter-card"));
  assert.ok(source.includes("bindComponentFilters"));
  assert.ok(style.includes(".component-filter-field"));
  assert.ok(style.includes("[data-component-filter-card][hidden]"));
  assert.ok(style.includes("display: none !important;"));
});

test("the primary workspace is architecturally named Component", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  assert.ok(shell.includes('data-workspace="component"'));
  assert.ok(!shell.includes('data-workspace="compose"'));
  assert.ok(controller.includes('workspace === "component"'));
  assert.ok(controller.includes("componentToolsTemplate"));
  assert.ok(!controller.includes("compositionToolsTemplate"));
});

test("component catalogs expose stable per-view sorting modes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const catalogSource = readFileSync(new URL("../js/control/catalog-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("state.ui?.catalogSortModes?.[scope]"));
  assert.ok(source.includes('ui.catalogSortModes ||= { component: "recent", canvas: "recent", scene: "recent", source: "recent", media: "recent" }'));
  assert.ok(source.includes("ui.catalogSortModes[catalog] = mode"));
  assert.match(source, /if \(change\.projectRestore\) \{[\s\S]*?invalidateCatalogOrder\(\)/);
  assert.ok(source.includes('catalogSortMode(state, "component")'));
  assert.ok(source.includes('catalogSortMode(state, "canvas")'));
  assert.ok(source.includes('catalogSortMode(state, "scene")'));
  assert.ok(source.includes('catalogSortMode(state, "source")'));
  assert.match(source, /scope === "scene"\s*\? state\.scenes \|\| \[\]/);
  assert.match(source, /scope === "source"\s*\? sceneSourceNodes\(state\)/);
  assert.ok(source.includes('componentCatalogToolsTemplate("scene", catalogSortMode(state, "scene"), "Filter scenes")'));
  assert.ok(source.includes('sources: catalogItemsInSnapshot("source", sceneSourceNodes(state))'));
  assert.ok(source.includes("if (viewKey === activeCatalogViewKey) return"));
  assert.ok(source.includes("captureCatalogOrder(workspace, state)"));
  assert.ok(catalogSource.includes('data-catalog-sort="${nextMode}"'));
  assert.ok(catalogSource.includes("(activeIndex + 1) % modes.length"));
  assert.ok(catalogSource.includes('["marker", "Marked", "keep"]'));
  assert.ok(catalogSource.includes("data-cycle-catalog-marker"));
  assert.ok(catalogSource.includes("Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}"));
  assert.ok(!catalogSource.includes('role="group" aria-label="Sort components"'));
  assert.ok(source.includes('["recent", "marker", "name", "created"]'));
  assert.ok(style.includes(".component-sort-toggle"));
  assert.ok(source.includes('catalogItemsInSnapshot("canvas", canvasComponents(state))'));
  assert.ok(source.includes('componentCatalogToolsTemplate("canvas", catalogSortMode(state, "canvas"), "Filter canvases")'));
});

test("Live scene cards expose reset only for retained temporary overrides", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.ok(sceneLiveSource.includes("data-reset-live-scene"));
  assert.ok(sceneLiveSource.includes("state.ui?.live?.sceneOverrides"));
  assert.ok(source.includes("store.resetLiveScene"));
});

test("Live scenes expose separate scene-transition and parameter-fade durations", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const models = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('data-update="ui.live.transitionDuration"'));
  assert.ok(source.includes('data-update="ui.live.paramFadeDuration"'));
  assert.ok(source.includes('min="0" max="10" step="0.1"'));
  assert.ok(models.includes("transitionDuration: 0"));
  assert.ok(models.includes("paramFadeDuration: 0"));
  assert.ok(source.indexOf("live-param-fade-duration") > source.indexOf("live-transition-duration"));
});

test("Live exposes a phase-continuous global visual time stretch", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /function liveToolsTemplate[\s\S]*?Live Scenes[\s\S]*?scene-card-list live-scene-list[\s\S]*?Timing[\s\S]*?live-time-scale[\s\S]*?live-transition-duration[\s\S]*?live-param-fade-duration/);
  assert.ok(source.includes("Time stretch"));
  assert.ok(source.includes('data-update="global.timeStretch"'));
  assert.ok(source.includes('min="-4" max="4" step="0.01"'));
  assert.ok(source.includes("const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch"));
});

test("embedded preview retargets resize observation after workspace DOM replacement", () => {
  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("function observeCurrentStage()"));
  assert.ok(source.includes("resizeObserver.unobserve?.(observedStage)"));
  assert.ok(source.includes("function scheduleSettledResize("));
  assert.ok(source.includes("stableMeasurements < 1 && attempts < 8"));
  assert.ok(source.includes("hideCanvasUntilSettledDraw()"));
  assert.ok(source.includes("const stageChanged = !!canvas && stage !== nextStage"));
  assert.ok(source.includes("modeChanged || stageChanged || canvasElementIsHidden()"));
  assert.ok(source.includes("function cancelSettledResize()"));
  assert.match(source, /function pause\(\) \{[\s\S]*?cancelSettledResize\(\)/);
  assert.ok(source.includes("if (revealCanvasAfterDraw)"));
  assert.ok(controllerSource.includes('if (reason === "workspace")'));
  assert.ok(controllerSource.includes("render(state);"));
});

test("ordinary UI interactions do not wait through a fixed post-click quiet period", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(!source.includes("interactionQuietMs"));
  assert.ok(!source.includes("interactionHoldUntil"));
  assert.match(source, /function scheduleDeferredRenderFlush\(\) \{[\s\S]*?setTimeout\(flushDeferredRender, 0\);/);
  assert.match(source, /function shouldDeferRender\(\) \{[\s\S]*?return activePointerCount > 0 \|\| hasFocusedEditor\(\);/);
  assert.match(source, /return active\?\.tagName !== "SELECT" && isTextEditingNode\(active\);/);
});

test("deferred UI frames consume current user truth instead of captured snapshots", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*?deferRender\(latestState\)[\s\S]*?render\(latestState\)/);
  assert.match(source, /function flushDeferredRender\(\)[\s\S]*?scheduleRenderNow\(latestState\)/);
  assert.match(source, /if \(change\.structural\)[\s\S]*?scheduleRenderNow\(state, \{ force: true \}\)/);
  assert.match(source, /function scheduleRenderNow\(state, \{ force = false \} = \{\}\)[\s\S]*?if \(!force && shouldDeferRender\(\)\)/);
});

test("Live parameter commits preserve inspector DOM identity and preview-owned drags avoid state echo", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /if \(reason === "live:update"\) \{[\s\S]*?updatePreviewState\(state\);[\s\S]*?return;/);
  assert.match(source, /reason !== "scrub:chain-transform" && reason !== "scrub:canvas-frame"/);
});

test("Live source labels clip before their visibility control and General remains selectable", () => {
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(style, /\.live-chain-outline-row \{[\s\S]*?min-width: 0;[\s\S]*?overflow: hidden;/);
  assert.match(style, /\.live-chain-outline-select \{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;[\s\S]*?overflow: hidden;/);
  assert.match(style, /\.live-chain-outline-select > span:not\(\.material-symbols-rounded\) \{[\s\S]*?max-width: 100%;[\s\S]*?text-overflow: ellipsis;/);
  assert.doesNotMatch(style, /\.live-chain-settings \.chain-param-view-general \{\s*display: none;/);
});

test("local UI controls use the UI-only state path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const projectService = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(controller, /function updateUi\(recipe, reason\)[\s\S]*?store\.updateUi\(recipe, reason\)/);
  assert.match(controller, /updateUi\(\(ui\) => \{[\s\S]*?updatePreviewViewportForUi\(ui, \(viewport\) => zoomViewport/);
  assert.match(controller, /ui\.catalogSortModes\[catalog\] = mode/);
  assert.match(app, /\["live", "runtime", "derived"\]\.includes\(change\.scope\)[\s\S]*?projectService\.scheduleAutoSave\(change\);[\s\S]*?change\.scope === "ui"/);
  assert.match(projectService, /if \(event\.phase === "edit" \|\| event\.phase === "scrub"\) return;/);
  assert.ok(!projectService.includes('event.scope === "ui"'));
});

test("output metrics use a targeted runtime state path", () => {
  const bridge = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(bridge.includes("store.getMetrics?.() || store.getState().metrics"));
  assert.ok(bridge.includes("store.updateRuntime ||"));
  assert.ok(!bridge.includes("store.getState().metrics.clients"));
  assert.ok(!bridge.includes("store.getState().metrics.outputs"));
});

test("canvas uses the shared chain and exposes recording frames as scene routes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const selectorsSource = readFileSync(new URL("../js/control/control-selectors.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(!source.includes("Build a larger visual with the same sources"));
  assert.ok(!source.includes("<span>Sampling</span>"));
  assert.match(source, /function canvasToolsTemplate[\s\S]*?Canvases[\s\S]*?addableRailTitleTemplate\("select_all", "Frames"/);
  assert.ok(source.includes('class="recording-frame-pills rail-scroll-list"'));
  assert.ok(!source.includes('class="canvas-inspector-section"'));
  assert.ok(componentSource.includes("componentUnifiedChainTemplate(component, state, base)"));
  assert.match(componentSource, /function componentUnifiedChainTemplate[\s\S]*?<section class="chain-list-section" aria-label="Elements">/);
  assert.doesNotMatch(componentSource, /function componentUnifiedChainTemplate[\s\S]*?<span>Chain<\/span>/);
  const unifiedChainSource = componentSource.slice(
    componentSource.indexOf("function componentUnifiedChainTemplate"),
    componentSource.indexOf("function chainItemsTemplate")
  );
  assert.ok(!unifiedChainSource.includes("chain-add-button"));
  assert.match(componentSource, /export function componentHeaderAddButtonTemplate[\s\S]*?class="rail-title-add"[\s\S]*?data-open-element-picker/);
  assert.match(source, /currentWorkspace\(state\) === "component"[\s\S]*?headerActionHtml: componentHeaderAddButtonTemplate\(selectedComponent\)/);
  assert.match(source, /currentWorkspace\(state\) === "canvas"[\s\S]*?headerActionHtml: componentHeaderAddButtonTemplate\(selectedCanvas\)/);
  assert.match(style, /\.chain-list-section \{[\s\S]*?padding: var\(--section-inset\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(componentSource, /function componentSelectedChainSettingsTemplate[\s\S]*?<section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">/);
  assert.match(source, /currentWorkspace\(state\) === "component"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedComponent, state\)/);
  assert.match(source, /currentWorkspace\(state\) === "canvas"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedCanvas, state\)/);
  assert.ok(!source.includes('emptyNote("Select a chain item")'));
  assert.match(style, /\.chain-item-editor \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;/);
  assert.ok(source.includes('workspace === "component" || workspace === "canvas" ? "component"'));
  assert.ok(modalSource.includes("data-add-element-component"));
  assert.ok(modalSource.includes('type: "component"'));
  assert.ok(componentSource.includes('component?.type === "canvas" && item.source?.type === "component"'));
  assert.ok(componentSource.includes('isCanvasComponentPlacement ? "" : `<label class="field">Component'));
  assert.ok(componentSource.includes('if (item.source?.type === "component") return sourceTitle'));
  assert.ok(source.includes("data-preview-quality"));
  assert.ok(source.includes("data-preview-quality-label"));
  assert.ok(source.includes('quality === "auto" ? "low" : quality === "low" ? "full" : "auto"'));
  assert.ok(source.includes("internal Canvas raster follows the visible preview size"));
  assert.ok(source.includes('workspace === "scene" || workspace === "live"'));
  assert.ok(source.includes("draft.ui.previewQualities[workspace]"));
  assert.ok(!source.includes('data-update="${base}.canvas.previewQuality"'));
  assert.ok(source.includes("data-add-canvas-frame"));
  assert.ok(inputSource.includes("data-set-route-source-node"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.ok(source.includes('catalogItemsInSnapshot("component", ordinaryComponents(state))'));
  assert.ok(selectorsSource.includes('filter((component) => component.type !== "canvas")'));
  assert.ok(!source.includes("data-set-route-frame"));
  assert.ok(source.includes("state.recordingFrames || []"));
  assert.ok(!source.includes("component.canvas?.frames"));
  assert.ok(!source.includes("Surface sample rects"));
  assert.ok(!source.includes("Canvas sample rect"));
  assert.ok(!source.includes("data-add-canvas-layer"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(!source.includes('data-update="${base}.x"'));
});

test("Scene and Live preview resolution supports automatic low and full demand", () => {
  const options = { configuredDensity: 1.5, displayScale: 0.5, deviceScale: 2 };
  assert.equal(previewRasterDensity({ ...options, quality: "auto" }), 1);
  assert.equal(previewRasterDensity({ ...options, quality: "low" }), 0.5);
  assert.equal(previewRasterDensity({ ...options, quality: "full" }), 1.5);
});

test("preview resolution controls reserve invariant space while labels and metrics change", () => {
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(style, /\.preview-quality-tool \{[\s\S]*?flex: 0 0 48px;[\s\S]*?min-width: 48px;[\s\S]*?max-width: 48px;/);
  assert.match(style, /\.preview-fps \{[\s\S]*?flex: 0 0 174px;[\s\S]*?min-width: 174px;[\s\S]*?max-width: 174px;/);
});

test("compact text lists share one full-width item generator", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const primitives = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitives.includes("function textListItemTemplate("));
  assert.match(source, /function canvasFramePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(primitives, /function selectablePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(componentSource, /function chainItemRowTemplate[\s\S]*?const row = textListItemTemplate\(/);
  assert.ok(style.includes(".text-list-item {"));
  assert.match(style, /\.text-list-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?border: 1px solid var\(--line\);/);
  assert.match(style, /\.text-list-item\.has-leading\.has-remove \{[\s\S]*?var\(--text-list-leading-size\)[\s\S]*?var\(--text-list-remove-size\)/);
  assert.match(style, /\.text-list-item \.text-list-remove \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(style, /\.text-list-item \.text-list-remove \{[\s\S]*?justify-content: center;/);
  assert.match(style, /\.text-list-item:hover \{[\s\S]*?background:/);
  assert.match(style, /button\.text-list-main:hover \{[\s\S]*?background: transparent;/);
  assert.ok(!style.includes(".surface-pills .list-select.is-selected"));
  assert.match(style, /\.chain-item-row \.enable-toggle\.is-enabled \{[\s\S]*?background: rgba\(255, 255, 255, 0\.055\);[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.chain-item-row\.is-selected \.enable-toggle\.is-enabled \{[\s\S]*?color: var\(--ink\);/);
  assert.match(style, /\.chain-group-children \{[\s\S]*?padding-left: 6px;[\s\S]*?border-left: 2px solid var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone \{[\s\S]*?border: 1px dashed var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone\.is-drop-target \{[\s\S]*?border-color: rgba\(255, 255, 255, 0\.55\);[\s\S]*?background: rgba\(255, 255, 255, 0\.06\);/);
});

test("Live navigates referenced components separately and edits one selected nested element", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.match(controllerSource, /currentWorkspace\(state\) === "live"[\s\S]*?html = liveInspectorTemplate\(state\);/);
  assert.match(sceneLiveSource, /function liveComponentTemplate[\s\S]*?<article class="ui-section focus-panel live-component-card">[\s\S]*?<header class="ui-section-header panel-title live-component-head">/);
  assert.ok(!sceneLiveSource.includes('class="live-panel"'));
  assert.ok(sceneLiveSource.includes("visit(state.components?.find"));
  assert.ok(sceneLiveSource.includes("liveChainOutlineTemplate"));
  assert.ok(sceneLiveSource.includes("liveSelectedChainSettingsTemplate"));
  assert.ok(sceneLiveSource.includes("live-chain-outline-children"));
  assert.ok(sceneLiveSource.includes("chainGeneralControlsTemplate"));
  assert.ok(sceneLiveSource.includes('data-live-component-view="controls"'));
  assert.ok(sceneLiveSource.includes('data-live-component-view="elements"'));
  assert.ok(sceneLiveSource.includes('liveRangeTemplate("Opacity", component.id, "opacity"'));
  assert.ok(sceneLiveSource.includes('liveRangeTemplate("Speed", component.id, "speed"'));
  assert.ok(controllerSource.includes("ui.live.componentView = button.dataset.liveComponentView"));
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(style, /\.live-component-head \{[\s\S]*?grid-template-columns: 72px minmax\(0, 1fr\) 22px;/);
});

test("preview fitting is invalidated only by layout viewport or output geometry", () => {
  const base = {
    mode: "preview",
    size: { width: 900, height: 600 },
    logical: { width: 1920, height: 1080 },
    viewport: { fit: "manual", zoom: 1.2, x: 4, y: 8 },
    render: { outputs: [{ id: "main", width: 1920, height: 1080 }] },
  };
  assert.equal(previewFitSignature(base), previewFitSignature({ ...base, unrelatedRenderState: { slider: 0.5 } }));
  assert.notEqual(previewFitSignature(base), previewFitSignature({ ...base, viewport: { ...base.viewport, zoom: 1.3 } }));
  assert.notEqual(previewFitSignature(base), previewFitSignature({ ...base, render: { outputs: [{ id: "main", width: 1280, height: 720 }] } }));
});

test("Live preview holds a new Scene and retimes its transition until media preparation completes", () => {
  const current = { ui: { workspace: "live", selectedSceneId: "scene-being-edited", live: { selectedSceneId: "scene-a" } } };
  const incoming = {
    ui: { workspace: "live", selectedSceneId: "another-editor-scene", live: { selectedSceneId: "scene-b" } },
    liveTransition: { startedAtMs: 100, durationMs: 1000, fromState: current },
  };
  assert.equal(shouldPrepareEmbeddedLiveState(incoming, current), true);
  assert.equal(
    shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, selectedSceneId: "scene-a" } }, current),
    true,
    "editor Scene selection must not alter Live preview routing"
  );
  assert.equal(
    shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, live: { selectedSceneId: "scene-a" } } }, current),
    false
  );
  assert.equal(shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, workspace: "scene" } }, current), false);
  const retimed = retimeEmbeddedLiveTransition(incoming, 2500);
  assert.equal(retimed.liveTransition.startedAtMs, 2500);
  assert.equal(incoming.liveTransition.startedAtMs, 100, "preparation must not mutate commanded state");
});

test("narrow layouts retain both control columns and disable the preview first", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?--project-rail-width: 220px;[\s\S]*?--inspector-width: 330px;[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\) minmax\(0, 1fr\);[\s\S]*?overflow-x: auto;/);
  assert.match(styleSource, /@media \(max-width: 1100px\)[\s\S]*?\.studio-layout \{[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\);[\s\S]*?\.studio-main \{[\s\S]*?display: none;/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?display: grid;/);
  assert.ok(controller.includes('window.matchMedia("(max-width: 1100px)")'));
  assert.ok(controller.includes("previewLayoutQuery?.matches"));
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.studio-inspector \{[\s\S]*?display: grid;/);
});

test("the application shell cannot become a vertically scrolled document", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(styleSource, /html,[\s\S]*?body \{[\s\S]*?position: fixed;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /#app \{[\s\S]*?position: fixed;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /\.studio-app \{[\s\S]*?height: 100%;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/);
  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?overflow-y: scroll;/);
  assert.match(styleSource, /\.chain-param-views \{[\s\S]*?position: relative;/);
  assert.match(styleSource, /\.chain-param-view-input \{[\s\S]*?position: absolute;[\s\S]*?inset-block-start: 0;[\s\S]*?inset-inline-start: 0;[\s\S]*?clip-path: inset\(50%\);/);
});

test("project settings expose component upscaling and native-resolution post filters", () => {
  const controllerSource = settingsModalTemplate(createInitialState());

  for (const path of [
    "render.upscaling.enabled",
    "render.upscaling.amount",
    "render.postProcessing.grayscaleEnabled",
    "render.postProcessing.grayscaleAmount",
    "render.postProcessing.noiseEnabled",
    "render.postProcessing.noiseAmount",
  ]) {
    assert.ok(controllerSource.includes(`data-settings-update="${path}"`));
  }
  assert.ok(controllerSource.includes("These filters run at the component’s full target resolution after upscaling."));
});

test("project settings expose one adaptive surface texture policy", () => {
  const source = settingsModalTemplate(createInitialState());
  assert.ok(source.includes('data-settings-update="render.componentTexture.width"'));
  assert.ok(source.includes('data-settings-update="render.componentTexture.height"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.mode"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxWidth"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxHeight"'));
  assert.ok(source.includes('data-settings-update="render.sampling.surfaceOverscan"'));
  assert.ok(source.includes('data-settings-update="render.sampling.recordingFrameScale"'));
  assert.ok(source.includes('data-settings-update="render.sampling.limitCanvasToLogicalSize"'));
  assert.equal(source.includes('data-settings-update="render.edgeSoftness"'), false);
  assert.ok(source.includes("Auto · projected pixel demand"));
  assert.ok(source.includes("it never changes component dimensions"));
  assert.ok(!source.includes('data-settings-update="render.surfaceWidth"'));
  assert.ok(!source.includes('data-settings-update="render.surfaceHeight"'));
});

test("project settings expose common WXGA and WUXGA projector presets", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState())}`;
  assert.ok(source.includes('data-render-preset="wxga" title="1280 x 800"'));
  assert.ok(source.includes('data-render-preset="wuxga" title="1920 x 1200"'));
  assert.ok(source.includes("wxga: [1280, 800]"));
  assert.ok(source.includes("wuxga: [1920, 1200]"));
});

test("project settings expose camera capture preferences", () => {
  const source = settingsModalTemplate(createInitialState(), "camera");
  assert.ok(source.includes("data-camera-preset"));
  assert.ok(source.includes('data-settings-update="render.camera.width"'));
  assert.ok(source.includes('data-settings-update="render.camera.height"'));
  assert.ok(source.includes('data-settings-update="render.camera.facingMode"'));
  assert.ok(source.includes('data-settings-update="render.camera.mirrored"'));
  assert.ok(source.includes('data-settings-update="render.camera.maxResolution"'));
});

test("project settings own one session-persistent screen share without target dimensions", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState(), "screen")}`;
  assert.ok(source.includes('data-settings-tab="screen"'));
  assert.ok(source.includes('data-settings-update="render.screenCapture.frameRate"'));
  assert.ok(source.includes('data-settings-update="render.screenCapture.cursor"'));
  assert.ok(source.includes("data-start-screen-capture"));
  assert.ok(source.includes("data-stop-screen-capture"));
  assert.ok(source.includes("startScreenCapture(settings)"));
  assert.equal(source.includes('render.screenCapture.width'), false);
  assert.equal(source.includes('render.screenCapture.height'), false);
});

test("project settings keep one modal DOM and patch tab values in place", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState())}`;
  assert.ok(source.includes('if (!host.querySelector("[data-settings-modal]"))'));
  assert.ok(source.includes("function syncSettingsModal(host, state)"));
  assert.ok(source.includes("function bindSettingsModalControls(host)"));
  assert.ok(source.includes('data-settings-tab="outputs"'));
  assert.ok(source.includes('data-settings-tab="camera"'));
  assert.ok(source.includes('data-settings-tab="screen"'));
  assert.ok(source.includes('data-settings-tab="rendering"'));
  assert.ok(source.includes('data-settings-update="render.maxFrameRate"'));
  assert.ok(source.includes('data-configured-output-list'));
  assert.ok(!source.includes("settingsScroll"));
});

test("Scene plus control creates an empty Scene instead of capturing current assignments", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("data-add-scene"));
  assert.ok(source.includes("store.addScene(name)"));
  assert.ok(!source.includes("data-scene-name"));
  assert.ok(!source.includes('data-save-scene title="Capture scene"'));
});

test("scrub changes send coalesced param patches without waiting for a preview frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const stateSource = readFileSync(new URL("../js/app-state.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(appSource.includes('["live", "runtime", "derived"].includes(change.scope)'));
  assert.ok(bridgeSource.includes('if (change.scope !== "live") return;'));
  assert.ok(bridgeSource.includes("scheduleLivePatches();"));
  assert.ok(bridgeSource.includes("flushLivePatches();"));
  assert.ok(bridgeSource.includes('typeof queueMicrotask === "function"'));
  assert.ok(bridgeSource.includes('type: "live-patch"'));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
  assert.ok(stateSource.includes("function updateLive(recipe"));
  assert.ok(inputSource.includes('typeof store.updateLive === "function"'));
  assert.ok(inputSource.includes("createLiveRenderPatch"));
  assert.ok(previewSource.includes("pendingState?.ui?.outputWindowOpen"));
  assert.ok(!previewSource.includes('outputWindowOpen && pendingState?.ui?.workspace !== "live"'));
  assert.ok(previewSource.includes('renderer.setState(previewSizedState(), { normalized: true });'));
  assert.ok(rendererSource.includes('setState(nextState, { normalized = false } = {})'));
  assert.ok(outputSource.includes('renderer?.setState(state, { normalized: true });'));
  assert.ok(outputSource.includes("renderer.applyLivePatches(patches)"));
  assert.ok(previewSource.includes("renderer?.applyLivePatches(patches)"));
});

test("parameter context menus are delegated across inspector replacements", () => {
  const source = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("const paramContextScopes = new WeakSet()"));
  assert.ok(source.includes('scope.addEventListener("contextmenu"'));
  assert.ok(source.includes('event.target?.closest?.("[data-param-context-path]")'));
  assert.ok(!source.includes('scope.querySelectorAll("[data-param-context-path]").forEach'));
});

test("opening an output never changes the Live Scene", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('buildOutputUrl("output", { outputId: output.id })'));
  assert.ok(!controllerSource.includes("store.selectLiveScene(state.ui.selectedSceneId);"));
  assert.ok(controllerSource.includes("Opening a display is infrastructure, not a Live performance command"));
  assert.ok(!controllerSource.includes("const initialSceneId ="));
  assert.ok(controllerSource.includes("store.selectLiveScene(button.dataset.liveScene)"));
  assert.ok(bridgeSource.includes("store.getLiveRenderState?.()"));
  assert.ok(bridgeSource.includes("targetClientId"));
  assert.ok(!bridgeSource.includes("initialSceneAccepted"));
  assert.ok(!bridgeSource.includes("initialSceneId"));
  assert.ok(appSource.includes('state.ui.workspace === "scene"'));
  assert.ok(appSource.includes('bridge.command("sync-mapping"'));
  assert.ok(appSource.includes("bridge.sendState();"));
  assert.ok(!appSource.includes("isSceneSurfaceOutputChange(reason)"));
  assert.ok(!appSource.includes("bridge.sendState(store.getRenderState())"));
  assert.ok(!appSource.includes('if (state.ui.workspace === "scene") return;'));
  assert.ok(!controllerSource.includes("setTimeout(() => bridge.sendState(), 350)"));
});

test("multiple configured outputs have individual popup actions", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const settingsHtml = settingsModalTemplate(createInitialState());

  assert.ok(shellSource.includes('id="output-menu"'));
  assert.ok(controllerSource.includes("data-open-output-id"));
  assert.ok(!controllerSource.includes("data-open-all-outputs"));
  assert.ok(controllerSource.includes("outputs.length === 1"));
  assert.ok(controllerSource.includes("dataset.outputsSignature"));
  assert.ok(settingsHtml.includes("render.outputs.0.width"));
  assert.ok(settingsHtml.includes("data-add-output"));
});

test("topbar combines renderer health and fixed-width output fps", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const gpuTimerSource = readFileSync(new URL("../js/output/gpu-timer-tracker.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="render-cost" class="performance-health-button"'));
  assert.ok(shellSource.includes('id="render-cost-dot"'));
  assert.ok(shellSource.includes('id="cpu-time-dot"'));
  assert.ok(shellSource.includes('id="gpu-time-dot"'));
  assert.ok(shellSource.includes('id="output-status-text">-</span>'));
  assert.ok(!shellSource.includes('id="cpu-time-text"'));
  assert.ok(!shellSource.includes('id="gpu-time-text"'));
  assert.ok(controllerSource.includes("activeWorkMetric(state, outputFps)"));
  assert.ok(controllerSource.includes("state.ui?.debugPreview && previewFps > 0"));
  assert.ok(controllerSource.includes('source: "preview"'));
  assert.ok(controllerSource.includes("state.metrics.previewFrameMs"));
  assert.ok(controllerSource.includes("state.metrics.previewGpuMs"));
  assert.ok(controllerSource.includes("1000 / value"));
  assert.ok(controllerSource.includes("profile?.componentWallMs ?? profile?.componentMs"));
  assert.ok(controllerSource.includes("CPU render work:"));
  assert.ok(controllerSource.includes("GPU render work:"));
  assert.ok(!controllerSource.includes('`CPU ${formatTimeMs'));
  assert.ok(!controllerSource.includes('`GPU ${formatTimeMs'));
  assert.ok(controllerSource.includes('sample?.type === "component"'));
  assert.ok(controllerSource.includes("cache hit"));
  assert.ok(controllerSource.includes("stage reuse"));
  assert.ok(controllerSource.includes("setPerformanceHealthDot(refs.renderCostDot"));
  assert.ok(controllerSource.includes("setPerformanceHealthDot(refs.cpuTimeDot"));
  assert.ok(controllerSource.includes("setPerformanceHealthDot(refs.gpuTimeDot"));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("speed", "Overall"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("timer", "CPU"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("memory", "GPU"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("open_in_new", "Output"'));
  assert.match(styleSource, /\.performance-health-readouts \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?margin-bottom: 10px;/);
  assert.ok(controllerSource.includes('performanceReadoutTemplate("cached", "Cache reuse"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("refresh", "Renders"'));
  assert.ok(!controllerSource.includes("Hot now"));
  assert.ok(controllerSource.includes('smoothed.totalsBySource[item.runtimeSource || "renderer"]'));
  assert.ok(!controllerSource.includes("combined sampled CPU"));
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query_webgl2")'));
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query")'));
  assert.ok(rendererSource.includes("this.pruneRenderCaches();\n    this.gpuTimer.sealFrame"));
  assert.ok(rendererSource.includes("gpuSupported: this.gpuTimer.supported"));
  assert.ok(previewSource.includes("draft.metrics.previewGpuMs = metrics.gpuMs || 0"));
  assert.ok(shellSource.includes('id="performance-summary"'));
  assert.ok(shellSource.includes('id="performance-analyze"'));
  assert.ok(controllerSource.includes("performanceProfileDurationMs = 10000"));
  assert.ok(controllerSource.includes("createRuntimeHotspotSmoother"));
  assert.ok(controllerSource.includes("summarizeRuntimeHotPasses(profiles, 16)"));
  assert.ok(!controllerSource.includes("running average of recent samples"));
  assert.ok(!controllerSource.includes("CPU rows can overlap because a component includes its child passes"));
  assert.ok(controllerSource.includes('PerformanceObserver.supportedEntryTypes?.includes("longtask")'));
  assert.ok(controllerSource.includes("performanceProfile.host.uiRenderMs"));
  assert.ok(controllerSource.includes("analyzeVj1Project(latestState, { runtimeSamples: session.samples })"));
  assert.ok(controllerSource.includes("globalThis.__vj1LastProfileReport = report"));
  assert.ok(controllerSource.includes("downloadPerformanceProfile(report"));
  assert.ok(controllerSource.includes("showPerformanceResults(report)"));
});

test("connected output and embedded preview metrics are combined", () => {
  const state = {
    ui: { debugPreview: true },
    metrics: {
      clients: 1,
      fps: 30,
      frameMs: 7,
      gpuMs: 9,
      gpuSupported: true,
      renderCost: 0.42,
      profile: { passSamples: [{ type: "component", componentId: "output-component", ms: 5 }] },
      previewFps: 60,
      previewFrameMs: 2,
      previewGpuMs: 1,
      previewGpuSupported: true,
      previewRenderCost: 0.12,
      previewProfile: { passSamples: [{ type: "component", componentId: "preview-component", ms: 1 }] },
    },
  };
  const metric = activeWorkMetric(state, state.metrics.fps);
  assert.equal(metric.source, "output + preview");
  assert.equal(metric.cpuMs, 9);
  assert.equal(metric.gpuMs, 10);
  assert.equal(metric.renderers.length, 2);
  assert.equal(metric.renderers[0].profile.passSamples[0].componentId, "output-component");
  assert.equal(metric.renderers[1].profile.passSamples[0].componentId, "preview-component");
  assert.equal(activeRenderCost(state), 0.54);

  state.metrics.clients = 0;
  assert.equal(activeWorkMetric(state, 0).source, "preview");
  assert.equal(activeRenderCost(state), 0.12);
});

test("topbar metric readouts reserve stable widths", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(source, /\.performance-health-button \{[\s\S]*?width: 76px;[\s\S]*?flex: 0 0 76px;/);
  assert.ok(source.includes("#output-status-text {\n  display: inline-block;\n  width: 3ch;"));
  assert.ok(source.includes("font-variant-numeric: tabular-nums;"));
  assert.equal(performanceHealthStep(0), 0);
  assert.equal(performanceHealthStep(0.5), 3);
  assert.equal(performanceHealthStep(1), 8);
  assert.equal(performanceHealthStep(10), 8);
});

test("list thumbnails crop to fill without changing their colors", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const templates = readFileSync(new URL("../js/control/template-utils.js", import.meta.url), "utf8");
  assert.ok(templates.includes('<div class="component-thumbnail"><img'));
  assert.match(source, /\.component-thumbnail,\n\.component-card-empty \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?overflow: hidden;/);
  assert.match(source, /\.component-thumbnail img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.doesNotMatch(source, /\.component-card[^}]*filter:\s*grayscale/s);
  assert.doesNotMatch(source, /\.media-element-card[^}]*filter:\s*grayscale/s);
});

test("media cards use one full-width text column without the generic icon inset", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".media-element-card {\n  grid-template-columns: minmax(0, 1fr);"));
  assert.match(source, /\.media-element-card > \.component-thumbnail,\n\.media-element-card > \.media-picker-placeholder \{\n  grid-column: 1;\n  grid-row: 3;/);
});

test("component picker cards use the same thumbnail layout as media cards", () => {
  const source = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  assert.match(source, /Components[\s\S]*?<div class="element-grid media-element-grid">[\s\S]*?class="element-card media-element-card" data-add-element-component=/);
});

test("component selection modal exposes the shared persisted catalog sorting", () => {
  const state = {
    media: [],
    components: [
      { id: "canvas", name: "Canvas", type: "canvas" },
      { id: "beta", name: "Beta", type: "component" },
      { id: "alpha", name: "Alpha", type: "component" },
    ],
  };
  const html = elementPickerTemplate(state, { componentId: "canvas" }, null, {
    components: [state.components[2], state.components[1], state.components[0]],
    sortMode: "name",
  });
  const controller = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(html.indexOf("Alpha") < html.indexOf("Beta"));
  assert.match(html, /data-catalog-sort-scope="component" data-catalog-sort="created"/);
  assert.match(html, /Sorted by name; click to sort by created/);
  assert.ok(controller.includes("sortComponentCatalog(state.components || [], sortMode)"));
  assert.ok(controller.includes("bindCatalogSortControls(host)"));
  assert.match(style, /\.component-sort-toggle button\.is-active \{[\s\S]*?background: transparent;[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.component-sort-toggle button:active,[\s\S]*?background: var\(--accent-strong\);/);
  assert.match(style, /\.component-catalog-tools \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 30px;/);
  assert.match(style, /\.component-sort-toggle button \{[\s\S]*?width: 30px;[\s\S]*?padding: 0;/);
});

test("workspace view buttons are compact icons with accessible names", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  for (const label of ["Components", "Canvas", "Scenes", "Live"]) {
    assert.ok(shellSource.includes(`title="${label}" aria-label="${label}"`));
    assert.ok(!shellSource.includes(`<span>${label}</span>`));
  }
  assert.ok(!shellSource.includes('data-workspace="mapping"'));
  const projectButtonIndex = shellSource.indexOf('id="open-folder-main"');
  const viewSwitchIndex = shellSource.indexOf('class="workspace-switch workspace-view-switch"');
  const closeProjectIndex = shellSource.indexOf('id="close-project"');
  const topActionsIndex = shellSource.indexOf('class="top-actions"');
  const liveButtonIndex = shellSource.indexOf('data-workspace="live"');
  assert.ok(projectButtonIndex < closeProjectIndex && closeProjectIndex < viewSwitchIndex);
  assert.ok(viewSwitchIndex < liveButtonIndex && liveButtonIndex < topActionsIndex);
  assert.equal((shellSource.slice(viewSwitchIndex, topActionsIndex).match(/data-workspace=/g) || []).length, 4);
  assert.ok(shellSource.indexOf('data-workspace="scene"') < liveButtonIndex);
  assert.ok(shellSource.includes('class="project-title-control"'));
  assert.match(styleSource, /\.icon-buttonish\.close-project-button \{[\s\S]*?position: static;[\s\S]*?width: 26px;[\s\S]*?height: 26px;/);
  assert.match(styleSource, /\.close-project-button \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(styleSource, /\.workspace-switch button \{[\s\S]*?width: 36px;[\s\S]*?padding: 0;/);
});

test("referenced Components share one capture-phase deep edit command with a return path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const primitives = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitives.includes('data-edit-component="${esc(componentId)}"'));
  assert.ok(primitives.includes('data-edit-chain-item="${esc(chainItemId)}"'));
  assert.ok(shell.includes('id="return-from-deep-edit"'));
  assert.match(controller, /root\.addEventListener\("click",[\s\S]*?data-edit-component[\s\S]*?}, true\);/);
  assert.ok(controller.includes('switchWorkspace(component.type === "canvas" ? "canvas" : "component")'));
  assert.ok(controller.includes('openComponentEditor(button.dataset.editComponent, button.dataset.editChainItem || "")'));
  assert.ok(controller.includes("if (chainItemId) store.selectChainItem?.(chainItemId)"));
  assert.ok(controller.includes("function returnFromDeepEdit()"));
  assert.match(style, /\.header-edit-button \{[\s\S]*?margin-left: auto;/);
  assert.match(style, /\.deep-edit-button \{[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
});

test("performance overviews show the owning Component thumbnail without renderer-side image work", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controller.includes("function performanceComponentThumbnail(state, componentId, className)"));
  assert.ok(controller.includes('"performance-hotspot-thumbnail"'));
  assert.ok(controller.includes('"performance-analysis-thumbnail"'));
  assert.ok(controller.includes("chainItemId: item.chainItemId"));
  assert.ok(renderer.includes('chainItemId: pass.instanceId || ""'));
  assert.ok(renderer.includes('chainItemId: node.id || sourceState.instanceId || ""'));
  assert.ok(controller.includes('!refs.performanceSummary.classList.contains("is-hidden") && !shouldDeferRender()'));
  assert.match(style, /\.performance-hotspot-list li\.has-thumbnail\.has-edit \{[\s\S]*?40px minmax\(0, 1fr\) auto 22px;/);
  assert.match(style, /\.performance-pass-cell \{[\s\S]*?display: flex;/);
});

test("topbar diagnostics expose an event-driven bounded console with copy and clear actions", () => {
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(shell.includes('id="diagnostics-toggle"'));
  assert.ok(shell.includes('id="diagnostics-summary"'));
  assert.ok(controller.includes("diagnostics?.subscribe?."));
  assert.ok(controller.includes('data-diagnostics-copy'));
  assert.ok(controller.includes('data-diagnostics-clear'));
  assert.ok(app.includes("createDiagnosticsService"));
  assert.match(style, /\.diagnostics-summary\s*\{[\s\S]*position:\s*absolute/);
});

test("empty project start shows one folder action and disables project views", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="close-project"'));
  assert.ok(controllerSource.includes("No project open"));
  assert.ok(controllerSource.includes("button.disabled = !hasProject;"));
  assert.ok(controllerSource.includes("hasOpenProject(state)"));
  assert.ok(controllerSource.includes('class="studio-stage project-empty-stage"'));
  assert.ok(!controllerSource.includes("Project first"));
  assert.ok(!controllerSource.includes("data-import-files>${icon"));
  assert.ok(styleSource.includes(".no-project-open .studio-layout"));
  assert.ok(styleSource.includes(".no-project-open .project-rail"));
  assert.ok(styleSource.includes(".workspace-switch button:disabled"));
});

test("3d model controls use full-width slider rows", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const schemaSource = readFileSync(new URL("../js/control/source-control-schema.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const modelControls = componentSource.slice(
    componentSource.indexOf("function modelSourceControlsTemplate"),
    componentSource.indexOf("function generatorParamControlsTemplate")
  );

  assert.ok(modelControls.includes("model-param-list"));
  assert.ok(modelControls.includes("MODEL_SOURCE_PARAMS"));
  assert.ok(modelControls.includes("componentParamViews"));
  assert.ok(modelControls.includes("paramControlsTemplate"));
  assert.ok(schemaSource.includes("Depth scale"));
  assert.ok(schemaSource.includes("Visible depth"));
  assert.ok(schemaSource.includes("Focal length (mm)"));
  assert.ok(schemaSource.includes("Wire thickness"));
  assert.ok(schemaSource.includes("Edge angle"));
  assert.ok(schemaSource.includes("Edge budget"));
  assert.ok(!modelControls.includes("field-pair"));
  assert.ok(!modelControls.includes("<span>3D model</span>"));
  assert.ok(styleSource.includes(".model-param-list"));
  assert.doesNotMatch(
    styleSource,
    /\.video-source-controls,\s*\.model-source-controls\s*\{[^}]*padding:/s,
    "3d model controls must not inherit the video's nested card padding"
  );
  assert.match(styleSource, /\.model-param-list\s*\{[^}]*min-width:\s*0;/s);
});

test("seed params stay internal and are not rendered as sliders", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('param?.id !== "seed"'));
  assert.ok(parameterSource.includes("const visible = visibleParamControls(params);"));
  assert.ok(componentSource.includes("componentParamViews(component)"));
  assert.ok(parameterSource.includes('param?.id !== "seed" && param?.id !== RENDER_QUALITY_PARAM.id'));
  assert.ok(sceneLiveSource.includes("paramControlsTemplate(params"));
});

test("selected generators omit the redundant source chooser", () => {
  const source = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const picker = source.slice(source.indexOf("function sourcePickerTemplate("), source.indexOf("function mediaSourceControlsTemplate("));

  assert.match(picker, /source\.type === "generator" \|\| paramView !== "primary" \? "" : `<div class="field">/);
  assert.match(picker, /source\.type === "generator" \? generatorParamControlsTemplate/);
});

test("media source controls derive image-only alpha controls from the shared schema", () => {
  const source = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const mediaControls = source.slice(
    source.indexOf("function mediaSourceControlsTemplate("),
    source.indexOf("function sourceTitle(")
  );

  const imageIds = mediaSourceParams({ type: "media", mediaId: "still.png" }).map((param) => param.id);
  const videoIds = mediaSourceParams({ type: "media", mediaId: "clip.mp4" }).map((param) => param.id);
  assert.deepEqual(imageIds, ["renderQuality", "fit", "alphaCut", "alphaFeather"]);
  assert.deepEqual(videoIds, ["renderQuality", "fit"]);
  assert.match(mediaControls, /params: mediaSourceParams\(source, media\)/);
  assert.match(mediaControls, /pathFor: \(param\) => `\$\{base\}\.params\.\$\{param\.id\}`/);
});

test("inspector dropdowns share compact slider-like styling without an orange focus ring", () => {
  const source = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(source, /createNumberParam\("opacity", "Opacity"[\s\S]*?createEnumParam\("blend", "Blend", BLEND_MODES/);
  assert.match(style, /\.studio-inspector select \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--slider-track\);/);
  assert.match(style, /\.studio-inspector select:focus-visible \{[\s\S]*?outline: 1px solid var\(--slider-thumb\);/);
  assert.doesNotMatch(style, /\.studio-inspector select:focus-visible \{[^}]*var\(--accent/);
});

test("components expose persistent instance synchronization without changing component ids", () => {
  const controllerSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("function componentInstanceSyncTemplate"));
  assert.ok(controllerSource.includes("Sync instances"));
  assert.ok(controllerSource.includes(".syncInstances"));
  assert.ok(controllerSource.includes('data-toggle-path="${base}.syncInstances"'));
  assert.ok(controllerSource.includes("each Canvas placement and surface its own phase"));
});

test("global clipboard routing follows clicked lists chains Groups and external images", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const clipboardSource = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(source.includes("clipboard.bindWindowEvents()"));
  assert.ok(clipboardSource.includes('window.addEventListener("copy", copyFromCurrentTarget)'));
  assert.ok(clipboardSource.includes('window.addEventListener("paste", pasteIntoCurrentTarget)'));
  assert.ok(clipboardSource.includes('window.addEventListener("pointerdown", rememberTarget, true)'));
  assert.ok(clipboardSource.includes('chainItem.closest("[data-chain-reorder-list]")'));
  assert.ok(source.includes('data-paste-scope="component-list"'));
  assert.ok(source.includes('data-paste-scope="canvas-list"'));
  assert.ok(source.includes('data-paste-scope="scene-list"'));
  assert.ok(source.includes('data-paste-scope="surface-list"'));
  assert.ok(clipboardSource.includes("imageFilesFromTransfer"));
  assert.ok(clipboardSource.includes("imageUrlFromTransfer"));
  assert.ok(source.includes("onChainItemTarget: (componentId, itemId)"));
  assert.ok(previewSource.includes("onChainItemTarget?.(state.ui.selectedComponentId, itemId)"));
});

test("project undo and redo expose standard keyboard shortcuts", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes('window.addEventListener("keydown", handleHistoryKeydown)'));
  assert.ok(source.includes("event.metaKey || event.ctrlKey"));
  assert.ok(source.includes("if (event.shiftKey) redoProject()"));
  assert.ok(source.includes("else undoProject()"));
});

test("global selection supports cut and guarded delete shortcuts", () => {
  const source = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes('window.addEventListener("cut", cutFromCurrentTarget)'));
  assert.ok(source.includes('window.addEventListener("keydown", handleDeleteKeydown)'));
  assert.ok(source.includes("writeClipboardPayload(event, payload)"));
  assert.ok(source.includes('event.key !== "Delete" && event.key !== "Backspace"'));
  assert.ok(source.includes("store.removeChainItem?.(value.componentId, value.itemId)"));
});
