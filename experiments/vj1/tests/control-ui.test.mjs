import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";
import { elementMediaCategory, elementPickerTemplate, sourceChoicePickerTemplate } from "../js/control/picker-view.js";
import { settingsModalTemplate } from "../js/control/settings-view.js";
import { createInitialState, createSceneComponent } from "../js/domain/models.js";
import { liveProjectionRailTemplate } from "../js/control/project-rail-view.js";
import { previewFitSignature, previewRasterDensity, retimeEmbeddedLiveTransition, shouldPrepareEmbeddedLiveState } from "../js/output/embedded-preview-app.js";
import {
  isPointerInteractionNode,
  rememberScrollPositions,
  rememberViewControlStates,
  restoreScrollPositions,
  restoreViewControlStates,
} from "../js/control/dom-utils.js";
import { panelTemplate, railListSectionTemplate, scrollRegionTemplate } from "../js/control/view-primitives.js";
import { applyOptimisticToggleIntent, boundaryFromScaleInput, isBoundaryScaleInput } from "../js/control/input-controller.js";
import { activeRenderCost, activeWorkMetric, performanceHealthStep, rememberParamViewSelections, restoreParamViewSelections } from "../js/control/control-shell-controller.js";
import { nextPickerFilter, sourceForCatalogMedia } from "../js/control/modal-controller.js";
import { mediaDisplayName, mediaPickerCardTemplate } from "../js/control/media-view.js";
import { componentSelectedChainSettingsTemplate } from "../js/control/component-view.js";
import { getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { componentCatalogSearchText } from "../js/control/catalog-view.js";
import {
  chainBoundaryPositionParams,
  chainTransformParams,
  placementAxisRange,
} from "../js/control/parameter-view.js";

test("catalog media enters Components through editable typed media Groups", () => {
  const state = {
    media: [
      { id: "media/skull.bin", type: "model" },
      { id: "media/photo.png", type: "image" },
    ],
  };
  assert.deepEqual(sourceForCatalogMedia("media/skull.bin", state), {
    type: "generator",
    generatorId: "modelMedia",
    params: { mediaId: "media/skull.bin" },
  });
  assert.deepEqual(sourceForCatalogMedia("media/direct.obj", state), {
    type: "generator",
    generatorId: "modelMedia",
    params: { mediaId: "media/direct.obj" },
  });
  assert.deepEqual(sourceForCatalogMedia("media/photo.png", state), {
    type: "generator",
    generatorId: "mediaImage",
    params: { mediaId: "media/photo.png" },
  });
});

test("Live exposes placement controls only for Components that own placement", () => {
  const source = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  assert.ok(source.includes("${liveComponentPlacementControlsTemplate(view?.transform, component.id)}"));
  assert.match(source, /const placementControls = component\.type === "scene" \? "" : `/);
});

test("Live Surface eyes render authored row visibility rather than fallback-route availability", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  state.components.push(scene);
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.selectedComponentId = scene.id;
  state.ui.live.sceneMappingVisible = false;
  const surface = state.mappings[0].surfaces
    .find((candidate) => candidate.destination?.type !== "direct" && candidate.enabled !== false);

  const html = liveProjectionRailTemplate(state);
  assert.ok(surface);
  assert.match(html, new RegExp(`aria-label="Hide ${surface.name}"`));
  assert.doesNotMatch(html, new RegExp(`aria-label="Show ${surface.name}"`));
});

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
  const frameList = { dataset: { scrollRegion: "", scrollKey: "scene-frames" }, scrollTop: 72, scrollLeft: 0 };
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

test("keyed ephemeral controls survive template replacement without entering project state", () => {
  const states = new Map();
  const componentFilter = {
    dataset: { viewStateKey: "catalog-filter:component" },
    value: "noise",
    checked: false,
  };
  const existingScope = {
    matches: () => false,
    querySelectorAll: () => [componentFilter],
  };
  rememberViewControlStates(existingScope, states);

  const replacementFilter = {
    dataset: { viewStateKey: "catalog-filter:component" },
    value: "",
    checked: false,
  };
  restoreViewControlStates({
    matches: () => false,
    querySelectorAll: () => [replacementFilter],
  }, states);

  assert.deepEqual(states.get("catalog-filter:component"), {
    value: "noise",
    checked: false,
  });
  assert.equal(replacementFilter.value, "noise");
});

test("rapid toggles preserve commanded user truth before render acknowledgement", () => {
  const classes = new Set(["is-enabled"]);
  const attributes = {};
  const iconElement = { textContent: "visibility" };
  const button = {
    dataset: {
      toggleValue: "true",
      toggleEnabledIcon: "visibility",
      toggleDisabledIcon: "hide_source",
      toggleLabel: "Surface",
    },
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    setAttribute(name, value) { attributes[name] = value; },
    querySelector(selector) {
      return selector === ".material-symbols-rounded" ? iconElement : null;
    },
  };
  assert.equal(applyOptimisticToggleIntent(button), false);
  assert.equal(button.dataset.toggleValue, "false");
  assert.equal(classes.has("is-enabled"), false);
  assert.equal(attributes["aria-pressed"], "false");
  assert.equal(iconElement.textContent, "hide_source");
  assert.equal(attributes.title, "Enable Surface");
  assert.equal(applyOptimisticToggleIntent(button), true);
  assert.equal(button.dataset.toggleValue, "true");
  assert.equal(classes.has("is-enabled"), true);
  assert.equal(iconElement.textContent, "visibility");
  assert.equal(attributes.title, "Disable Surface");
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

test("media presentation shows basenames while retaining paths only as picker metadata", () => {
  const media = {
    id: "media/sets/night/sky.png",
    name: "media/sets/night/sky.png",
    path: "media/sets/night/sky.png",
    type: "image",
  };
  const pickCard = mediaPickerCardTemplate(media, { getFile: () => null }, { action: "pick", selected: true });
  const addCard = mediaPickerCardTemplate(media, { getFile: () => null }, { action: "add" });

  assert.equal(mediaDisplayName(media), "sky.png");
  assert.match(pickCard, /data-pick-source-media="media\/sets\/night\/sky\.png"/);
  assert.match(addCard, /data-add-element-media="media\/sets\/night\/sky\.png"/);
  assert.match(pickCard, /title="sky\.png"/);
  assert.match(pickCard, /<strong>sky\.png<\/strong>/);
  assert.doesNotMatch(pickCard, /<small>/);
  assert.doesNotMatch(pickCard, /<strong>media\//);
  assert.doesNotMatch(pickCard, /title="media\//);
});

test("element picker filters media and render elements by explicit category", () => {
  const owner = { id: "canvas", type: "scene", name: "Canvas", chain: [] };
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
  assert.match(general, /role="tablist"/);
  assert.doesNotMatch(general, /data-element-filter="all"/);

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

test("new Live Camera elements enter through the reusable camera Group", () => {
  const state = {
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
    media: [],
  };
  const sourcePicker = sourceChoicePickerTemplate(
    state,
    { path: "target.source" },
    { getFile: () => null },
  );
  const elementPicker = elementPickerTemplate(
    state,
    { componentId: "owner" },
    { getFile: () => null },
  );
  const modalSource = readFileSync(
    new URL("../js/control/modal-controller.js", import.meta.url),
    "utf8",
  );

  assert.match(sourcePicker, /data-pick-source-camera/);
  assert.match(elementPicker, /data-add-element-camera/);
  assert.match(
    modalSource,
    /data-pick-source-camera[\s\S]*?type:\s*"generator",[\s\S]*?generatorId:\s*"cameraInput"/,
  );
  assert.match(
    modalSource,
    /data-add-element-camera[\s\S]*?type:\s*"generator",[\s\S]*?generatorId:\s*"cameraInput"/,
  );
  assert.doesNotMatch(
    modalSource,
    /data-(?:pick-source|add-element)-camera[\s\S]{0,180}?type:\s*"camera"/,
  );
});

test("picker filters behave as exclusive tabs and selecting the active tab restores the full list", () => {
  assert.equal(nextPickerFilter("all", "image"), "image");
  assert.equal(nextPickerFilter("image", "video"), "video");
  assert.equal(nextPickerFilter("image", "image"), "all");
});

test("media refresh is explicit and never polls during rendering", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const mediaViewSource = readFileSync(new URL("../js/control/media-view.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const state = {
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
    media: [],
  };
  const sourcePicker = sourceChoicePickerTemplate(state, { path: "target.source" }, { getFile: () => null });
  const elementPicker = elementPickerTemplate(state, { componentId: "owner" }, { getFile: () => null });

  assert.ok(mediaViewSource.includes("data-refresh-media"));
  assert.match(sourcePicker, />Refresh media</);
  assert.match(elementPicker, />Refresh media</);
  assert.equal((pickerSource.match(/mediaRefreshButtonTemplate\(\)/g) || []).length, 2);
  assert.equal((modalSource.match(/querySelector\("\[data-refresh-media\]"\)\?\.addEventListener/g) || []).length, 2);
  assert.ok(modalSource.includes("await refreshMedia();"));
  assert.ok(modalSource.includes("[VJ1_MEDIA_REFRESH_FAILED]"));
  assert.match(modalSource, /function openMediaPicker[\s\S]*?openChoicePicker\(/);
  assert.match(modalSource, /function openSourceChoicePicker[\s\S]*?openChoicePicker\(/);
  assert.ok(!appSource.includes("setInterval(() => projectService.refreshFolder(), 5000)"));
  assert.ok(!appSource.includes('addEventListener("focus"'));
  assert.ok(!appSource.includes('addEventListener("visibilitychange"'));
});

test("node resource parameters reuse the single media picker and return the selected stable media id", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");

  assert.match(controllerSource, /onMediaParameterRequest:\s*\(\{\s*accept,\s*apply\s*\}\)\s*=>\s*\{[\s\S]*?modals\.openMediaPicker\("",\s*accept,\s*apply\)/);
  assert.match(modalSource, /function openMediaPicker\(path,\s*accept = "",\s*onSelect = null\)/);
  assert.match(modalSource, /onSelect:\s*typeof onSelect === "function" \? onSelect : null/);
  assert.match(modalSource, /function setMediaValue[\s\S]*?target\.onSelect\(mediaId\)/);
});

test("browser workspace remains authoritative after project restoration", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(appSource, /restored = await projectService\.restoreStoredFolder\(\);[\s\S]*?if \(restored && store\.getState\(\)\.ui\.workspace !== initialWorkspace\) \{[\s\S]*?store\.setWorkspace\(initialWorkspace\);/);
});

test("Control publishes its first Output baseline only after local restore settles", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const restoreBranch = appSource.slice(
    appSource.indexOf("    bridge.beginProjectRestore();"),
    appSource.indexOf("    // The URL is the navigation authority.", appSource.indexOf("    bridge.beginProjectRestore();")),
  );
  assert.ok(
    restoreBranch.indexOf("await projectService.restoreStoredFolder()") <
      restoreBranch.indexOf("bridge.announceControl()"),
    "an existing Output must never receive an empty pre-restore state as its revision baseline",
  );
  assert.ok(
    restoreBranch.indexOf("bridge.finishProjectRestore(restored)") <
      restoreBranch.indexOf("bridge.announceControl()"),
    "Output recovery becomes available only after the local restore outcome is authoritative",
  );
});

test("Control startup remains visible and reports asynchronous initialization failures", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

  assert.match(appSource, /installControlApp\(\)\.catch\(showStartupFailure\)/);
  assert.match(appSource, /VJ1_CONTROL_STARTUP_FAILED/);
  assert.match(appSource, /showStartupStage\("Loading node library/);
  assert.match(appSource, /showStartupStage\("Initializing application services/);
  assert.match(appSource, /showStartupStage\("Restoring project folder/);
});

test("current-version project restore does not serialize a no-op migration autosave", () => {
  const source = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.ok(source.includes("storedProjectVersion !== CURRENT_PROJECT_VERSION"));
  assert.match(
    source,
    /if \(restored && !projectLoadBlocked && projectMigrationSaveRequired\) \{[\s\S]*?project-restore-migration/,
  );
  assert.ok(source.includes("projectMigrationSaveRequired = false;"));
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
  assert.match(styleSource, /\.inspector-view-option \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?min-height: 24px;[\s\S]*?padding: 3px 7px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 1;/);
  assert.match(styleSource, /\.chain-param-list \{[\s\S]*?align-self: start;[\s\S]*?align-content: start;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?align-content: start;[\s\S]*?padding: var\(--section-inset\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(styleSource, /:root \{[\s\S]*?--param-section-bottom-inset: 10px;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?padding-bottom: var\(--param-section-bottom-inset\);/);
  assert.match(styleSource, /\.parameter-surface \{[\s\S]*?padding-bottom: var\(--param-section-bottom-inset\);/);
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

test("Component Scene and Live inspectors give range tracks their own full-width row", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("refs.inspector.dataset.workspace = currentWorkspace(state);"));
  assert.match(styleSource, /\.range-field > input\[type="range"\],[\s\S]*?\.range-field > \.param-control-track \{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styleSource, /\.studio-inspector:is\(\[data-workspace="component"\], \[data-workspace="scene"\], \[data-workspace="live"\]\) \.param-range-pair \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.ok(!styleSource.includes(".live-chain-pass .range-field"));
  assert.ok(!styleSource.includes(".chain-pass .range-field"));
  assert.ok(!styleSource.includes(".live-chain-pass .chain-param-list"));
  assert.ok(styleSource.includes(".live-chain-settings .field:not(.range-field)"));
  assert.ok(styleSource.includes("--param-label-control-gap: 0px;"));
  assert.ok(styleSource.includes("--param-stack-gap: 7px;"));
  assert.match(styleSource, /\.field \{[\s\S]*?gap: var\(--param-label-control-gap\);/);
  assert.match(styleSource, /\.range-field \{[\s\S]*?gap: var\(--param-label-control-gap\) 4px;/);
  assert.match(styleSource, /\.chain-param-list \{[\s\S]*?gap: var\(--param-stack-gap\);/);
});

test("every Scene Surface exposes proportion locking and direct-output Surfaces remain interactive", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const interactionSource = readFileSync(new URL("../js/output/component-preview-interaction.js", import.meta.url), "utf8");
  assert.ok(componentSource.includes("Keep proportions"));
  assert.ok(componentSource.includes(".keepProportions"));
  assert.doesNotMatch(interactionSource, /frame\.kind === "output"/);
});

test("all renderable chain elements expose shared quality opacity blend and placement through General", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('createNumberParam("opacity", "Opacity"'));
  assert.ok(parameterSource.includes('createEnumParam("blend", "Blend", BLEND_MODES'));
  assert.ok(parameterSource.includes("[RENDER_QUALITY_PARAM, ...generalParams]"));
  assert.ok(parameterSource.includes("chainRenderQualityTarget(item, basePath)"));
  assert.ok(parameterSource.includes('{ id: "general", label: "General", html: general }'));
  assert.ok(parameterSource.includes('createNumberParam("x", "Boundary X"'));
  assert.ok(parameterSource.includes('createNumberParam("y", "Boundary Y"'));
  assert.ok(parameterSource.includes('createNumberParam("scale", "Boundary scale"'));
  assert.ok(parameterSource.includes('createNumberParam("rotation", "Boundary rotation"'));
  assert.equal(parameterSource.includes('"Content rotation"'), false);
  assert.equal(parameterSource.includes('"Boundary width"'), false);
  assert.equal(parameterSource.includes('"Boundary height"'), false);
  assert.ok(componentSource.includes("chainGeneralControlsTemplate(item, base"));
  assert.ok(sceneLiveSource.includes("chainGeneralControlsTemplate(item, path"));
  assert.doesNotMatch(componentSource, /rangeTemplate\("Alpha", `\$\{base\}\.opacity`/);
  assert.doesNotMatch(sceneLiveSource, /liveRangeTemplate\("Alpha", componentId, `\$\{path\}\.opacity`/);
});

test("boundary scale controls write one aspect-preserving ROI change", () => {
  const input = { dataset: { boundaryWidth: "0.8", boundaryHeight: "0.4" } };
  assert.equal(isBoundaryScaleInput(input, "components.0.chain.0.boundary.scale"), true);
  assert.deepEqual(boundaryFromScaleInput(input, Math.sqrt(0.32) * 2), {
    width: 1.6,
    height: 0.8,
  });
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  assert.ok(parameterSource.includes("context: true"), "the final Boundary scale slider participates in the shared context menu");
  assert.ok(controllerSource.includes("isBoundaryScaleInput(boundaryScaleInput, path)"), "reset translates Boundary scale into its canonical width and height fields");
});

test("placement controls scale their editor range without changing authored coordinates", () => {
  assert.equal(placementAxisRange(1, 0), 2, "a unit object retains the familiar ±2 range");
  assert.equal(placementAxisRange(4, 0), 5, "a four-frame object can travel fully beyond either parent edge");
  assert.equal(placementAxisRange(0.5, -3), 3, "an existing authored position remains reachable");

  const content = chainTransformParams({ x: 0.25, y: -0.5, scale: 3 });
  assert.deepEqual(
    content.filter((param) => param.id === "x" || param.id === "y")
      .map((param) => [param.min, param.max]),
    [[-4, 4], [-4, 4]],
  );
  assert.equal(content.find((param) => param.id === "scale")?.max, 8);

  const boundary = chainBoundaryPositionParams({
    x: 0.2,
    y: -0.3,
    width: 3,
    height: 0.5,
  });
  assert.deepEqual(
    boundary.map((param) => [param.id, param.min, param.max]),
    [
      ["x", -4, 4],
      ["y", -2, 2],
      ["rotation", -3.1416, 3.1416],
    ],
  );
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('class="ui-section rail-section"'));
  assert.ok(primitivesSource.includes('class="ui-section focus-panel${empty ? " is-empty"'));
  assert.ok(pickerSource.includes('class="ui-section element-section"'));
  assert.ok(settingsSource.includes('class="ui-section element-section parameter-surface settings-view-surface"'));
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("refs.projectRail.dataset.workspace = workspace"));
  assert.match(styleSource, /\.project-rail:is\(\[data-workspace="component"\][\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /> \.rail-list-section \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;/);
  assert.match(controllerSource, /title: "Sources"[\s\S]*?data-live-source-filter="scenes"[\s\S]*?data-live-source-filter="components"/);
  assert.match(controllerSource, /railListSectionTemplate\(\{[\s\S]*?"Surfaces"[\s\S]*?className: "mapping-surface-rail-section"/);
  assert.doesNotMatch(styleSource, /\.project-rail\[data-workspace="(?:mapping|scene)"\] > \.mapping-surface-rail-section/);
  assert.match(styleSource, /\.rail-list-section\.is-empty \{[\s\S]*?flex: 0 0 auto;/);
  assert.match(styleSource, /\.rail-list-section > \.rail-scroll-list \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(styleSource, /\.studio-inspector:is\(\[data-workspace="component"\][\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.studio-inspector\[data-workspace="scene"\] > \.scene-surface-panel,[\s\S]*?flex: 0 0 auto;[\s\S]*?grid-template-rows: auto auto;/);
  assert.match(styleSource, /\.component-chain-list,[\s\S]*?align-content: start;[\s\S]*?overflow-y: auto;/);
  assert.match(controllerSource, /listClassName: "component-card-list"/);
  assert.match(controllerSource, /listClassName: "scene-card-list live-scene-list"/);
  assert.match(controllerSource, /listClassName: "mapping-text-list"/);
});

test("selection rerenders preserve every keyed catalog and chain viewport", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const domSource = readFileSync(new URL("../js/control/dom-utils.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");

  for (const key of ["component-catalog", "scene-catalog", "scene-surfaces", "mapping-catalog", "mapping-surfaces"]) {
    assert.ok(controllerSource.includes(`scrollKey: "${key}"`), `missing scroll region: ${key}`);
  }
  assert.ok(controllerSource.includes('scrollKey: `live-sources:${showScenes ? "s" : ""}${showComponents ? "c" : ""}`'));
  assert.ok(componentSource.includes("elementListTemplate(\n        `component-chain:${component.id}`"));
  assert.match(primitivesSource, /function elementListTemplate[\s\S]*?scrollRegionTemplate\(scrollKey/);
  assert.ok(componentSource.includes("scrollRegionTemplate(`chain-params:${component.id}:${item.id}:${view.id}`"));
  assert.ok(sceneSource.includes('data-scroll-region data-scroll-key="live-controls:${esc(component.id)}"'));
  assert.ok(sceneSource.includes("elementListTemplate(\n    `live-elements:${componentId}`"));
  assert.ok(sceneSource.includes("scrollRegionTemplate(`live-chain-params:${componentId}:${item.id}:${view.id}`"));
  assert.ok(controllerSource.includes('scrollKey: "live-projection-targets"'));
  assert.ok(controllerSource.includes('scrollKey: `live-scene-components:${sourceTarget?.id || "none"}`'));
  assert.ok(pickerSource.includes('data-scroll-region data-scroll-key="source-picker-results"'));
  assert.ok(pickerSource.includes('data-scroll-region data-scroll-key="element-picker-results"'));
  assert.match(domSource, /rememberScrollPositions\(node, scrollPositions\);[\s\S]*?node\.innerHTML = next;[\s\S]*?restoreScrollPositions\(node, scrollPositions\);/);
  assert.match(domSource, /rememberViewControlStates\(node, viewControlStates\);[\s\S]*?node\.innerHTML = next;[\s\S]*?restoreViewControlStates\(node, viewControlStates\);/);
});

test("scroll region primitive gives every rerendered viewport a stable identity", () => {
  const html = scrollRegionTemplate("component:one & two", "<span>content</span>", { className: "chain-param-view-panel", tagName: "section" });
  assert.match(html, /^<section class="chain-param-view-panel" data-scroll-region data-scroll-key="component:one &amp; two"/);
  assert.ok(html.includes("<span>content</span>"));
});

test("rail lists share one structural primitive for populated and empty states", () => {
  const empty = railListSectionTemplate({ iconName: "list", title: "Items", emptyText: "No items", scrollKey: "items" });
  const populated = railListSectionTemplate({ iconName: "list", title: "Items", content: "<button>One</button>", scrollKey: "items" });

  for (const html of [empty, populated]) {
    assert.match(html, /ui-list-section/);
    assert.match(html, /ui-list-content rail-scroll-list/);
    assert.match(html, /data-scroll-key="items"/);
  }
  assert.match(empty, /ui-list-empty/);
  assert.match(empty, /ui-empty-state/);
  assert.match(empty, /is-empty/);
  assert.doesNotMatch(populated, /ui-list-empty/);
  assert.doesNotMatch(populated, /is-empty/);
});

test("empty panels expose the same intrinsic-size state as empty lists", () => {
  const empty = panelTemplate("tune", "Inspector", "<div>No selection</div>", { empty: true });
  const populated = panelTemplate("tune", "Inspector", "<div>Controls</div>");

  assert.match(empty, /focus-panel is-empty/);
  assert.doesNotMatch(populated, /is-empty/);
});

test("every workspace rail uses the same constrained first-column module", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styleSource, /\.rail-section \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(controllerSource, /addableRailTitleTemplate\(UI_ICONS\.component, "Components", "data-add-component"/);
  assert.match(controllerSource, /addableRailTitleTemplate\(UI_ICONS\.scene, "Scenes", "data-add-scene"/);
  assert.match(controllerSource, /addableRailTitleTemplate\(UI_ICONS\.mapping, "Mappings", "data-add-mapping"/);
  assert.match(controllerSource, /addableRailTitleTemplate\(UI_ICONS\.surface, "Surfaces", "data-add-surface"/);
  assert.match(controllerSource, /function mappingSurfaceSectionTemplate[\s\S]*?titleInputTemplate\(`\$\{base\}\.name`[\s\S]*?data-add-surface[\s\S]*?mapping-test-pattern-toggle[\s\S]*?path: "ui\.mappingTestPattern"[\s\S]*?iconName: "grid_on"[\s\S]*?disabledIconName: "grid_on"[\s\S]*?showLabel: true[\s\S]*?className: "mapping-test-pattern-button"[\s\S]*?mappingSurfacePillTemplate/);
  assert.match(styleSource, /\.mapping-test-pattern-button \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(styleSource, /\.rail-title-add \{[\s\S]*?width: 22px;[\s\S]*?margin-left: auto;/);
  assert.doesNotMatch(styleSource, /\.capture-row/);
});

test("render-chain and Surface rows share the compact list density", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(styleSource, /\.component-chain-list \{[\s\S]*?gap: 3px;[\s\S]*?align-content: start;/);
  assert.match(styleSource, /:root \{[\s\S]*?--text-list-row-height: 34px;[\s\S]*?--text-list-control-height: 28px;/);
  assert.match(styleSource, /\.text-list-item \{[\s\S]*?min-height: var\(--text-list-row-height\);/);
  assert.match(styleSource, /\.text-list-item \.enable-toggle,[\s\S]*?height: var\(--text-list-control-height\);[\s\S]*?min-height: var\(--text-list-control-height\);/);
  assert.match(styleSource, /\.compact-list-row \{[\s\S]*?--text-list-leading-size: 27px;/);
  assert.doesNotMatch(styleSource, /\.text-list-item \{[^}]*min-height: 42px;/);
  assert.doesNotMatch(styleSource, /\.compact-list-row \{[^}]*min-height: 34px;/);
  assert.match(componentSource, /rowClass: "chain-item-row compact-list-row"/);
  assert.match(sceneSource, /function mappingSurfacePillTemplate[\s\S]*?rowClass: "list-row compact-list-row"/);
  assert.match(controllerSource, /state\.surfaces[\s\S]*?mappingSurfacePillTemplate\(surface, state(?:,\s*\{[\s\S]*?\})?\)/);
  assert.match(styleSource, /\.chain-group-drop-zone \{[\s\S]*?min-height: 14px;/);
});

test("all workspaces share the compact column-to-preview gap", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /:root \{[\s\S]*?--workspace-content-gap: 6px;/);
  assert.match(styleSource, /:root \{[\s\S]*?--workspace-column-gap: 4px;/);
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?column-gap: var\(--workspace-column-gap\);[\s\S]*?row-gap: 12px;[\s\S]*?padding: var\(--workspace-content-gap\) 12px 12px;/);
  assert.doesNotMatch(styleSource, /\.studio-main \{[^}]*margin-left:/);
});

test("editable element names live in their section headers beside the icon", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitivesSource.includes("function titleInputTemplate(path, value)"));
  assert.ok(primitivesSource.includes("function editableSectionTitleTemplate(iconName, path, value)"));
  assert.ok(primitivesSource.includes('class="section-title-input"'));
  assert.match(controllerSource, /from "\.\/view-primitives\.js"/);
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

  assert.ok(primitivesSource.includes("function componentCardBarTemplate(label, iconName)"));
  assert.ok(primitivesSource.includes('class="component-card-bar"'));
  assert.ok(primitivesSource.includes('class="material-symbols-rounded component-card-type-icon"'));
  assert.ok(primitivesSource.includes('class="component-card-name"'));
  assert.match(styleSource, /\.component-card > \.component-thumbnail,[\s\S]*?border-radius: var\(--radius-section-inner\) var\(--radius-section-inner\) 0 0;/);
  assert.match(styleSource, /\.component-card-bar \{[\s\S]*?min-height: 26px;[\s\S]*?padding: 4px 8px;[\s\S]*?border-radius: 0 0 var\(--radius-section-inner\) var\(--radius-section-inner\);[\s\S]*?background: #000;/);
  assert.match(styleSource, /\.component-card-bar \.component-card-name \{[\s\S]*?color: var\(--muted\);/);
  assert.match(styleSource, /\.component-card-bar \.component-card-type-icon \{[\s\S]*?font-size: 12px;/);
  assert.match(styleSource, /\.component-card\.is-selected \.component-card-bar \.component-card-name,[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.component-card-remove \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(styleSource, /\.component-card-remove \{[\s\S]*?top: 3px;[\s\S]*?left: 3px;[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
  assert.doesNotMatch(styleSource, /\.component-card-row\.has-catalog-marker \.component-card-remove/);
  assert.match(styleSource, /\.component-card::before \{[\s\S]*?top: 3px;[\s\S]*?left: 3px;[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
  assert.match(styleSource, /:root \{[\s\S]*?--thumbnail-remove-hover-delay: 2s;/);
  assert.match(styleSource, /\.component-card-row:has\([\s\S]*?\.component-thumbnail:hover,[\s\S]*?\.component-card-bar:hover[\s\S]*?\) > \.component-card-remove:not\(:disabled\) \{[\s\S]*?animation: reveal-thumbnail-remove 120ms ease var\(--thumbnail-remove-hover-delay\) forwards;/);
  assert.match(styleSource, /@keyframes reveal-thumbnail-remove \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.match(styleSource, /\.component-card-remove:hover:not\(:disabled\),[\s\S]*?\.component-card-remove:focus-visible \{[\s\S]*?animation: none;[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.doesNotMatch(styleSource, /\.component-card-row:hover \.component-card-remove/);
  assert.doesNotMatch(styleSource, /\.component-card-row:focus-within \.component-card-remove/);
});

test("ordinary sliders use the compact track and square active handle from the UI system", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(styleSource.includes("--accent-strong: #8a3d00;"));
  assert.ok(styleSource.includes("--slider-track: #454545;"));
  assert.ok(styleSource.includes("--slider-thumb: #555555;"));
  assert.ok(styleSource.includes("--slider-thumb-hover: #9a9997;"));
  assert.ok(styleSource.includes("--slider-text: #777674;"));
  assert.match(styleSource, /\.range-field > span,[\s\S]*?\.field:has\(> \.param-select\) > span \{[\s\S]*?color: var\(--slider-text\);/);
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

test("Mapping surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  assert.ok(!source.includes("Scene assignment"));
  assert.ok(source.includes('const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"]'));
  assert.ok(source.includes("Projection fit"));
  assert.ok(source.includes("mappingBase}.projectionFit"));
  assert.ok(source.includes('rangeTemplate("Feather", `${surfaceBase}.feather`'));
  assert.ok(!source.includes("componentAssignmentTemplate"));
  assert.ok(source.includes("This surface is not part of the selected Mapping."));
});

test("component catalogs expose shared local filtering", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("componentFilterTemplate"));
  assert.ok(source.includes("data-component-filter-card"));
  assert.ok(source.includes("bindComponentFilters"));
  assert.ok(style.includes(".component-filter-field"));
  assert.ok(style.includes("[data-component-filter-card][hidden]"));
  assert.ok(style.includes("display: none !important;"));
});

test("component catalog search includes nested visual and media identities", () => {
  const search = componentCatalogSearchText({
    id: "component-1",
    name: "Portrait",
    chain: [
      {
        kind: "group",
        name: "Finishing",
        chain: [
          { kind: "effect", name: "Soft Blur", componentId: "blur" },
          {
            kind: "source",
            name: "",
            componentId: "mediaImage",
            source: {
              type: "generator",
              generatorId: "mediaImage",
              params: { mediaId: "media/people/heart.png" },
            },
          },
        ],
      },
    ],
  });

  assert.match(search, /portrait/);
  assert.match(search, /soft blur/);
  assert.match(search, /blur/);
  assert.match(search, /heart\.png/);
  assert.match(search, /mediaimage/);
});

test("the primary workspace is architecturally named Component", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  assert.ok(shell.includes('data-workspace="component"'));
  assert.ok(!shell.includes('data-workspace="compose"'));
  assert.ok(controller.includes('workspace === "component"'));
  assert.ok(controller.includes("componentToolsTemplate"));
  assert.ok(!controller.includes("compositionToolsTemplate"));
});

test("component catalogs expose stable per-view sorting modes", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const source = controllerSource + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const catalogSource = readFileSync(new URL("../js/control/catalog-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("state.ui?.catalogSortModes?.[scope]"));
  assert.ok(source.includes('ui.catalogSortModes ||= { component: "recent", scene: "recent", mapping: "recent", live: "recent", source: "recent", media: "recent" }'));
  assert.ok(source.includes("ui.catalogSortModes[catalog] = mode"));
  assert.match(source, /if \(change\.projectRestore\) \{[\s\S]*?invalidateCatalogOrder\(\)/);
  assert.ok(source.includes('catalogSortMode("component")'));
  assert.ok(source.includes('catalogSortMode("scene")'));
  assert.ok(source.includes('catalogSortMode("mapping")'));
  assert.ok(source.includes('catalogSortMode(state, "source")'));
  assert.match(source, /scope === "mapping"\s*\? state\.mappings \|\| \[\]/);
  assert.match(source, /scope === "source"\s*\? sceneSourceNodes\(state\)/);
  assert.ok(source.includes('componentCatalogToolsTemplate("mapping", catalogSortMode("mapping"), "Filter mappings")'));
  assert.ok(source.includes('sources: catalogItemsInSnapshot("source", sceneSourceNodes(state))'));
  assert.ok(source.includes("if (viewKey === activeCatalogViewKey) return"));
  assert.ok(source.includes("captureCatalogOrder(workspace, state)"));
  assert.match(controllerSource, /import \{[^}]*sceneComponents[^}]*\} from "\.\/control-selectors\.js/);
  assert.ok(catalogSource.includes('data-catalog-sort="${nextMode}"'));
  assert.ok(catalogSource.includes("(activeIndex + 1) % modes.length"));
  assert.ok(catalogSource.includes('["marker", "Marked", "keep"]'));
  assert.ok(catalogSource.includes("data-cycle-catalog-marker"));
  assert.ok(catalogSource.includes("Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}"));
  assert.ok(!catalogSource.includes('role="group" aria-label="Sort components"'));
  assert.ok(source.includes('["recent", "marker", "name", "created"]'));
  assert.ok(style.includes(".component-sort-toggle"));
  assert.ok(source.includes('catalogItems("scene", sceneComponents(state))'));
  assert.ok(source.includes('componentCatalogToolsTemplate("scene", catalogSortMode("scene"), "Filter scenes")'));
});

test("Live scene cards expose reset only for retained temporary overrides", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  assert.ok(sceneLiveSource.includes("data-reset-live-scene"));
  assert.ok(sceneLiveSource.includes("state.ui?.live?.sceneOverrides"));
  assert.ok(source.includes("store.resetLiveScene"));
});

test("Live scenes expose separate scene-transition and parameter-fade durations", () => {
  const source = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const models = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('data-update="ui.live.transitionDuration"'));
  assert.ok(source.includes('data-update="ui.live.paramFadeDuration"'));
  assert.ok(source.includes('data-update="ui.live.transitionId"'));
  assert.ok(source.includes("transitionParameterControls"));
  assert.ok(source.includes("listBuiltInTransitionEntries()"));
  assert.ok(source.includes("createTransitionCatalog("));
  assert.ok(source.includes("transitionEntries || ["));
  assert.ok(source.includes("DefaultBuiltInTransition.id"));
  assert.ok(!source.includes("DissolveTransitionKernel"));
  assert.ok(source.includes('min="0" max="10" step="0.1"'));
  assert.ok(models.includes("transitionDuration: startup ? 1.2 : 0"));
  assert.ok(models.includes("paramFadeDuration: startup ? 0.9 : 0"));
  assert.ok(source.indexOf("live-param-fade-duration") > source.indexOf("live-transition-duration"));
});

test("Live exposes a phase-continuous global visual time stretch", () => {
  const source = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");

  assert.match(source, /function liveToolsTemplate[\s\S]*?title: "Sources"[\s\S]*?data-live-source-filter="scenes"[\s\S]*?data-live-source-filter="components"[\s\S]*?scene-card-list live-scene-list[\s\S]*?Timing[\s\S]*?live-timing-params[\s\S]*?live-time-scale[\s\S]*?live-transition-duration[\s\S]*?live-param-fade-duration/);
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
  assert.ok(controllerSource.includes("scheduleRenderNow(state, { force: true, reason, change });"));
});

test("workspace navigation leaves complete shell work outside the click handler", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const appStateSource = readFileSync(new URL("../js/app-state.js", import.meta.url), "utf8");

  assert.match(
    controllerSource,
    /if \(reason === "workspace"\) \{[\s\S]*?scheduleRenderNow\(state, \{ force: true, reason, change \}\);[\s\S]*?return;/,
  );
  assert.doesNotMatch(
    controllerSource,
    /if \(reason === "workspace"\) \{[\s\S]{0,220}?render\(state,/,
  );
  assert.match(
    appStateSource,
    /setWorkspace\(workspace\) \{[\s\S]*?const draft = \{\s*\.\.\.state,\s*ui: clone\(state\.ui\),\s*global: \{ \.\.\.state\.global \},[\s\S]*?state = draft;[\s\S]*?emit\(\{ reason: "workspace", scope: "ui", history: "none" \}\);/,
  );
  assert.doesNotMatch(
    appStateSource,
    /setWorkspace\(workspace\) \{\s*update\(/,
  );
});

test("streamed derived thumbnails patch their owned images without rebuilding Preview or the shell", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const templates = readFileSync(new URL("../js/control/template-utils.js", import.meta.url), "utf8");
  assert.match(
    controllerSource,
    /change\.scope === "derived" && change\.projection\?\.kind === "component-thumbnails"[\s\S]*?patchComponentThumbnails\(change\.projection\.entries\);[\s\S]*?return;/,
  );
  assert.match(controllerSource, /function patchComponentThumbnails\(entries = \[\]\)/);
  assert.match(controllerSource, /root\.querySelectorAll\("\[data-component-thumbnail\]"\)/);
  assert.match(templates, /data-component-thumbnail=/);
});

test("thumbnail preview keeps the shared renderer cadence independent from its display mode", () => {
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.match(previewSource, /function applyPreviewFrameRate\(\)[\s\S]*?thumbnailPreview: false/);
  assert.doesNotMatch(previewSource, /thumbnailPreview: pendingState\?\.ui\?\.debugPreview === false/);
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

  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*?deferRender\(latestState, \{[\s\S]*?previewPatched,[\s\S]*?projection === "live-program"[\s\S]*?render\(latestState, \{ reason, change, previewPatched \}\)/);
  assert.match(source, /function flushDeferredRender\(\)[\s\S]*?const context = deferredRenderContext \|\| \{\}[\s\S]*?scheduleRenderNow\(latestState, \{[\s\S]*?\.\.\.context/);
  assert.match(source, /if \(change\.structural\)[\s\S]*?scheduleRenderNow\(state, \{ force: true, reason, change \}\)/);
  assert.match(source, /function scheduleRenderNow\(state, \{[\s\S]*?force = false,[\s\S]*?reason = "",[\s\S]*?change = null,[\s\S]*?projection = "shell",[\s\S]*?invalidation = null,[\s\S]*?previewPatched = false,[\s\S]*?\} = \{\}\)[\s\S]*?if \(!force && shouldDeferRender\(\)\)/);
});

test("Live transitions avoid a second full control-shell rebuild at expiry", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /liveProgramRenderReasons[\s\S]*?"live:scene"[\s\S]*?"live:target"/);
  assert.match(source, /live-transition-expired[\s\S]*?\["live-projection-rail"[\s\S]*?\["inspector"/);
  assert.match(source, /createControlRenderDiagnostics\(\{ diagnostics \}\)/);
});

test("Live program selection reconciles outside the originating click event", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(
    source,
    /currentWorkspace\(state\) === "live" && liveProgramRenderReasons\.has\(reason\)[\s\S]*?scheduleRenderNow\(state, \{ force: true, reason, change, projection: "live-program" \}\);[\s\S]*?return;/,
  );
  assert.match(
    source,
    /if \(projection === "live-program"\) renderLiveProgramChange\(latestState, \{ reason, change \}\);/,
  );
});

test("Live output-matrix selection and Mapping eyes use scoped projection activation", async () => {
  const { isMappingSurfaceVisibilityReason, previewActivationForContext } = await import(
    "../js/control/preview-state-activation.js"
  );

  assert.equal(
    isMappingSurfaceVisibilityReason("toggle:mappings.0.surfaces.2.enabled"),
    true,
  );
  assert.equal(
    previewActivationForContext({
      reason: "select-mapping",
      change: { scope: "ui" },
    }),
    "mapping",
    "Mapping selection replaces the derived route program and retained handles",
  );
  assert.equal(
    previewActivationForContext({
      reason: "toggle:mappings.0.surfaces.2.enabled",
      change: { scope: "project" },
    }),
    "mapping",
    "a Surface eye changes reachability but not visual programs or resources",
  );
  assert.equal(
    previewActivationForContext({
      reason: "live:preview-surface",
      change: { scope: "ui" },
    }),
    "projection",
    "Scene Mapping and projected output rows have different derived surface programs and reachability",
  );
  assert.equal(
    previewActivationForContext({
      reason: "preview-fit-frame",
      change: { scope: "ui" },
    }),
    "ui",
    "ordinary navigation must retain compiled Mapping geometry",
  );
  assert.equal(
    previewActivationForContext({
      reason: "live:scene",
      change: { scope: "live" },
    }),
    "full",
    "a Scene change still activates the newly compiled visual endpoint",
  );
});

test("Surface eyes commit visibility and selection once and rebuild only their projection", () => {
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.match(
    inputSource,
    /button\.dataset\.toggleSelectAction === "data-select-surface"[\s\S]*?draft\.ui\.selectedSurfaceId = button\.dataset\.toggleSelectId[\s\S]*?return;/,
  );
  assert.match(
    inputSource,
    /store\.setMappingSurfaceVisibility\(mapping\.id, surface\.id, nextValue, reason\)[\s\S]*?return;/,
  );
  assert.match(
    inputSource,
    /path\.startsWith\("components\."\)[\s\S]*?store\.setComponentValue\(path, nextValue,[\s\S]*?if \(handled\) return;/,
    "Component and Scene eyes must commit visibility and inspector selection in one scoped transaction",
  );
  assert.match(
    shellSource,
    /const controlInvalidation = change\.controlInvalidation[\s\S]*?projection: "control-invalidation"[\s\S]*?invalidation: controlInvalidation/,
  );
  assert.match(
    shellSource,
    /function renderControlInvalidation[\s\S]*?invalidation\.preview === "mapping"[\s\S]*?updatePreviewState\(state, "mapping"\)/,
  );
  assert.match(
    shellSource,
    /context\.reason === "live:surface-visibility"[\s\S]*?\["live-projection-rail"[\s\S]*?updatePreviewState\(state, "projection"\)/,
  );
  assert.match(
    bridgeSource,
    /reason === "live:surface-visibility"[\s\S]*?createRenderStatePatch\("surfaces", projected\.surfaces \|\| \[\]\)[\s\S]*?flushLivePatches\(\)/,
  );
  assert.match(
    outputSource,
    /activation === "projection"[\s\S]*?renderer\?\.setProjectionState\(runtimeState, \{ normalized: true \}\)/,
  );
});

test("Component and Scene controls retain the render plan and reconcile only their inspector", () => {
  const shellSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const commandSource = readFileSync(new URL("../js/libraries/state-engine/state-command/index.js", import.meta.url), "utf8");
  const activationSource = readFileSync(new URL("../js/control/preview-state-activation.js", import.meta.url), "utf8");
  const patchRuntimeSource = readFileSync(new URL("../js/output/live-render-patch-runtime.js", import.meta.url), "utf8");

  assert.match(
    activationSource,
    /isComponentElementVisibilityReason[\s\S]*?\^toggle:components\\\.\\d\+\\\.chain\\\..\+\\\.enabled\$/,
  );
  assert.match(
    commandSource,
    /function controlInvalidationForPaths[\s\S]*?\^components\\\.\\d\+\\\.[\s\S]*?regions\.add\("inspector"\)[\s\S]*?requiresRenderPatch = true/,
  );
  assert.match(
    shellSource,
    /controlInvalidation\.requiresRenderPatch \|\| patchedLivePreview \|\| patchedStudioPreview[\s\S]*?projection: "control-invalidation"/,
  );
  assert.match(
    shellSource,
    /function renderControlInvalidation[\s\S]*?"inspector": \(\) => renderInspector\(state\)/,
  );
  assert.match(
    patchRuntimeSource,
    /if \(itemField !== "source"\) return false;/,
    "enabled is configuration, not topology, so it must synchronize the retained program rather than rebuild it",
  );
});

test("Live parameter commits preserve inspector DOM identity and preview-owned drags avoid state echo", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /if \(reason === "live:update"\) \{[\s\S]*?updatePreviewState\(state\);[\s\S]*?return;/);
  assert.match(source, /reason !== "scrub:chain-transform" && reason !== "scrub:chain-boundary" && reason !== "scrub:scene-surface"/);
});

test("Live elements use the shared compact list row and leading visibility toggle", () => {
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(source, /const row = textListItemTemplate\(\{[\s\S]*?rowClass: "live-chain-outline-row compact-list-row"/);
  assert.match(source, /leadingHtml: enableToggleButton\(\{[\s\S]*?livePath: `\$\{path\}\.enabled`[\s\S]*?iconName,/);
  assert.match(source, /mainAttributes: `data-live-component-id="/);
  assert.doesNotMatch(source, /iconName: item\.enabled === false \? "visibility_off" : "visibility"/);
  assert.match(style, /\.live-chain-outline-select \{\s*cursor: grab;/);
  assert.doesNotMatch(style, /\.live-chain-settings \.chain-param-view-general \{\s*display: none;/);
});

test("local UI controls use the UI-only state path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const projectService = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(controller, /function updateUi\(recipe, reason\)[\s\S]*?store\.updateUi\(recipe, reason\)/);
  assert.match(controller, /updateUi\(\(ui\) => \{[\s\S]*?updatePreviewViewportForUi\(ui, \(viewport\) => zoomViewport/);
  assert.match(controller, /ui\.catalogSortModes\[catalog\] = mode/);
  assert.match(app, /application\.bindInput\("storage", "value", \(\{ state, change \}\) => \{[\s\S]*?\["live", "runtime", "derived"\]\.includes\(change\.scope\)[\s\S]*?projectService\.scheduleAutoSave\(change, \{ state \}\)/);
  assert.match(app, /application\.bindInput\("live-synchronization", "state", \(\{ state, reason, change \}\) => \{[\s\S]*?\["runtime", "derived", "ui"\]\.includes\(change\.scope\)/);
  assert.match(app, /application\.emit\("data-store", "snapshot", \{ state, reason, change \}\)/);
  assert.match(projectService, /if \(event\.phase === "edit" \|\| event\.phase === "scrub"\) return;/);
  assert.match(projectService, /event\.scope === "ui" && !immediate && !previewViewportCheckpoint/);
});

test("preview navigation bypasses full renderer state replacement and hover does not wake presentation", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const preview = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const viewportStart = preview.indexOf("  function setViewport(");
  const viewportEnd = preview.indexOf("\n  function setInstalledNodePackages(", viewportStart);
  const setViewportSource = preview.slice(viewportStart, viewportEnd);

  assert.match(controller, /change\.scope === "ui" && previewViewportReasons\.has\(reason\)[\s\S]*?embeddedPreview\.setViewport\(state\.ui\);[\s\S]*?return;/);
  assert.match(setViewportSource, /renderer\?\.presentationGeometry\?\.setViewport\(resolvedViewport\)/);
  assert.doesNotMatch(setViewportSource, /renderer\?\.setState/);
  assert.match(preview, /const onPointerMove = \(event\) => \{\s*if \(!pointerActive \|\| event\.pointerId !== activePointerId\) return;\s*wakePreviewPresentation\(\)/);
});

test("Mapping preview draws an editor-only output frame without another render target", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const presentation = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  assert.match(renderer, /this\.presentationRuntime = new OutputPresentationRuntime\(this\)/);
  assert.match(presentation, /renderMappingFrameOverlay\(\)/);
  assert.match(presentation, /isMappingProjectionPresentation\(host\)/);
  assert.match(
    presentation,
    /host\.mode === "live"[\s\S]*?host\.state\?\.livePreviewPresentation === "mapping"/,
    "Live Output and Surface rows reuse Mapping's projected output-frame presentation",
  );
  assert.match(presentation, /renderSelectedDirectOutputFrameOverlay\(surfaceId\)/);
  assert.match(presentation, /outputFramesForIds\(/);
  assert.match(presentation, /drawOutputFrameBoundaries\(\s*frames/);
  assert.doesNotMatch(presentation, /renderMappingFrameOverlay[\s\S]{0,900}createGraphics\(/);
});

test("Live Scene Mapping Surface guides are a route-patched zero-buffer node", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const surfaceRuntime = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const guideNode = readFileSync(new URL("../js/libraries/composition-engine/scene-surface-guides/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /renderLiveOverallFrameOverlay/);
  assert.match(surfaceRuntime, /drawSurfaceRouteView\(view, route\);[\s\S]*?drawLiveMonitorGuideNodes\(route\)/);
  assert.match(surfaceRuntime, /drawGuidePaths\(\[\[[\s\S]*?color: \[84, 228, 212, 184\]/);
  assert.match(surfaceRuntime, /SceneSurfaceGuideNode\.process/);
  assert.match(surfaceRuntime, /renderer\.mappingRuntime\.mapper\.drawGuidePaths\(paths, route\.mapped\.mapperSurface\)/);
  assert.doesNotMatch(surfaceRuntime, /route\.component\?\.type !== "scene"/);
  assert.match(guideNode, /Output Surfaces are useful authored guides/);
  assert.match(guideNode, /"zero-buffer"/);
  const guideRuntime = surfaceRuntime.slice(
    surfaceRuntime.indexOf("drawSceneSurfaceGuideNode(route = {})"),
    surfaceRuntime.indexOf("drawSurfaceRouteViewBatch")
  );
  assert.doesNotMatch(guideNode + guideRuntime, /createGraphics\(/);
});

test("output metrics use a targeted runtime state path", () => {
  const bridge = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(bridge.includes("store.getMetrics?.() || store.getState().metrics"));
  assert.ok(bridge.includes("store.updateRuntime ||"));
  assert.ok(!bridge.includes("store.getState().metrics.clients"));
  assert.ok(!bridge.includes("store.getState().metrics.outputs"));
});

test("Scene uses the shared chain and exposes authoritative Mapping Surfaces", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const selectorsSource = readFileSync(new URL("../js/control/control-selectors.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(!source.includes("Build a larger visual with the same sources"));
  assert.ok(!source.includes("<span>Sampling</span>"));
  assert.match(source, /function sceneToolsTemplate[\s\S]*?Scenes[\s\S]*?addableRailTitleTemplate\(UI_ICONS\.surface, "Surfaces", "data-add-surface"/);
  assert.ok(source.includes('listClassName: "surface-pills"'));
  assert.ok(!source.includes('class="canvas-inspector-section"'));
  assert.ok(componentSource.includes("componentUnifiedChainTemplate(component, state, base)"));
  assert.match(componentSource, /function componentUnifiedChainTemplate[\s\S]*?elementListTemplate\([\s\S]*?className: "chain-list-section"/);
  assert.doesNotMatch(componentSource, /function componentUnifiedChainTemplate[\s\S]*?<span>Chain<\/span>/);
  const unifiedChainSource = componentSource.slice(
    componentSource.indexOf("function componentUnifiedChainTemplate"),
    componentSource.indexOf("function chainItemsTemplate")
  );
  assert.ok(!unifiedChainSource.includes("chain-add-button"));
  assert.match(componentSource, /export function componentHeaderAddButtonTemplate[\s\S]*?class="rail-title-add"[\s\S]*?data-open-element-picker/);
  assert.match(source, /currentWorkspace\(state\) === "component"[\s\S]*?headerActionHtml: componentHeaderAddButtonTemplate\(selectedComponent\)/);
  assert.match(source, /currentWorkspace\(state\) === "scene"[\s\S]*?headerActionHtml: componentHeaderAddButtonTemplate\(selectedScene\)/);
  assert.match(style, /\.element-list-surface,[\s\S]*?padding: var\(--section-inset\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(componentSource, /function componentSelectedChainSettingsTemplate[\s\S]*?<section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">/);
  assert.match(source, /currentWorkspace\(state\) === "component"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedComponent, state, \{/);
  assert.match(source, /currentWorkspace\(state\) === "scene"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedScene, state, \{/);
  assert.ok(!source.includes('emptyNote("Select a chain item")'));
  assert.match(style, /\.chain-item-editor \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;/);
  assert.match(source, /workspace === "component" \|\| workspace === "scene"[\s\S]*?workspace === "live"[\s\S]*?"live"/);
  assert.ok(modalSource.includes("data-add-element-component"));
  assert.ok(modalSource.includes('type: "component"'));
  assert.ok(componentSource.includes('component?.type === "scene" && item.source?.type === "component"'));
  assert.ok(componentSource.includes('isSceneComponentPlacement ? "" : `<label class="field"><span>Component</span>'));
  assert.ok(componentSource.includes('if (item.source?.type === "component") return sourceTitle'));
  assert.ok(source.includes("data-preview-quality"));
  assert.ok(source.includes("data-preview-quality-label"));
  assert.ok(source.includes("data-preview-diagnostics"));
  assert.ok(source.includes("ui.previewDiagnostics = ui.previewDiagnostics !== true"));
  assert.ok(source.includes('quality === "auto" ? "good" : quality === "good" ? "low" : "auto"'));
  assert.ok(source.includes("matches the display's native density"));
  assert.ok(source.includes('["component", "scene", "mapping", "live"].includes(workspace)'));
  assert.ok(source.includes("draft.ui.previewQuality = nextPreviewQuality"));
  assert.ok(!source.includes('data-update="${base}.canvas.previewQuality"'));
  assert.ok(!source.includes("data-add-frame"));
  assert.ok(!source.includes("data-set-route-frame-id"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.ok(source.includes('catalogItems("component", ordinaryComponents(state))'));
  assert.ok(selectorsSource.includes('filter((component) => component.type !== "scene" && !component.systemRole)'));
  assert.ok(source.includes("state.surfaces || []"));
  assert.ok(!source.includes("state.frames || []"));
  assert.ok(!source.includes("component.scene?.frames"));
  assert.ok(!source.includes("Surface sample rects"));
  assert.ok(!source.includes("Canvas sample rect"));
  assert.ok(!source.includes("data-add-canvas-layer"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(!source.includes('data-update="${base}.x"'));
});

test("all embedded previews share automatic, native-density Good, and reduced Low demand", () => {
  const options = { configuredDensity: 1.5, displayScale: 0.5, deviceScale: 2 };
  assert.equal(previewRasterDensity({ ...options, quality: "auto" }), 1);
  assert.equal(previewRasterDensity({ ...options, quality: "low" }), 0.5);
  assert.equal(previewRasterDensity({ ...options, quality: "good" }), 2);
  assert.equal(previewRasterDensity({ ...options, quality: "high" }), 1);
  assert.equal(previewRasterDensity({
    configuredDensity: 4,
    displayScale: 1,
    deviceScale: 4,
    quality: "good",
  }), 4);
});

test("preview resolution controls reserve invariant space while labels and metrics change", () => {
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(style, /\.preview-quality-tool \{[\s\S]*?flex: 0 0 48px;[\s\S]*?min-width: 48px;[\s\S]*?max-width: 48px;/);
  assert.match(style, /\.preview-fps \{[\s\S]*?flex: 0 0 174px;[\s\S]*?min-width: 174px;[\s\S]*?max-width: 174px;/);
});

test("preview scaling diagnostics reuse the dormant geometry and detailed HUD probes", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const embedded = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const metrics = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(controller, /data-preview-diagnostics/);
  assert.match(embedded, /pendingState\?\.ui\?\.previewDiagnostics === true/);
  assert.match(embedded, /classList\?\.toggle\("is-geometry-diagnostic", enabled\)/);
  assert.match(metrics, /this\.previewDiagnosticMarkup\(fps\)/);
  assert.match(style, /\.embedded-preview-stage canvas\.is-geometry-diagnostic \{[\s\S]*?border: 2px solid #ff4fa3;/);
  assert.doesNotMatch(style, /\.output-stage canvas \{[\s\S]*?outline:/);
});

test("compact text lists share one full-width item generator", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const mappingSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const primitives = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitives.includes("function textListItemTemplate("));
  assert.match(mappingSource, /function mappingSurfacePillTemplate[\s\S]*?selectablePillTemplate\(/);
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
  assert.match(style, /\.chain-item-row \.enable-toggle\.is-enabled,[\s\S]*?\.live-chain-outline-row \.enable-toggle\.is-enabled \{[\s\S]*?background: rgba\(255, 255, 255, 0\.055\);[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.chain-item-row\.is-selected \.enable-toggle\.is-enabled,[\s\S]*?\.live-chain-outline-row\.is-selected \.enable-toggle\.is-enabled \{[\s\S]*?color: var\(--ink\);/);
  assert.match(style, /\.chain-group-children \{[\s\S]*?padding-left: 6px;[\s\S]*?border-left: 2px solid var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone \{[\s\S]*?border: 1px dashed var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone\.is-drop-target \{[\s\S]*?border-color: rgba\(255, 255, 255, 0\.55\);[\s\S]*?background: rgba\(255, 255, 255, 0\.06\);/);
});

test("Live and parameter inspector view tabs share one compact geometry contract", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const mappingSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const projectRailSource = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(componentSource, /class="chain-param-view-tab inspector-view-option"/);
  assert.match(mappingSource, /class="live-component-view-tab inspector-view-option/);
  assert.match(mappingSource, /class="chain-param-view-tab inspector-view-option"/);
  assert.match(projectRailSource, /class="live-component-view-tab inspector-view-option/);
  assert.match(
    style,
    /\.inspector-view-option \{[\s\S]*?min-height: 24px;[\s\S]*?padding: 3px 7px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 1;/,
  );
  assert.doesNotMatch(style, /\.live-component-view-tab \{[\s\S]*?min-height: 32px;/);
});

test("Component and Live compound controls share one parameter-group primitive", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const mappingSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(parameterSource, /export function parameterGroupTemplate\(/);
  assert.match(parameterSource, /class="parameter-control-group/);
  assert.match(componentSource, /parameterGroupTemplate\(\s*section\.label,/);
  assert.match(mappingSource, /parameterGroupTemplate\(item\.name \|\| "Group",/);
  assert.match(mappingSource, /parameterGroupTemplate\(label,/);
  assert.doesNotMatch(mappingSource, /live-significant-group/);
  assert.match(
    style,
    /\.parameter-control-group \{[\s\S]*?display: grid;[\s\S]*?gap: var\(--param-stack-gap\);/,
  );
});

test("Mapping and Output text lists share one darker inset section box", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(
    styleSource,
    /\.mapping-text-list,[\s\S]*?\.surface-pills,[\s\S]*?\.live-projection-list \{[\s\S]*?padding: var\(--section-inset\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--control\);/,
  );
});

test("Live navigates referenced components separately and edits one selected nested element", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
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
    render: { outputs: [{ id: "main", aspectRatio: 16 / 9 }] },
  };
  assert.equal(previewFitSignature(base), previewFitSignature({ ...base, unrelatedRenderState: { slider: 0.5 } }));
  assert.notEqual(previewFitSignature(base), previewFitSignature({ ...base, viewport: { ...base.viewport, zoom: 1.3 } }));
  assert.notEqual(previewFitSignature(base), previewFitSignature({ ...base, render: { outputs: [{ id: "main", aspectRatio: 4 / 3 }] } }));
});

test("embedded Live preview switches Scenes immediately without media-preparation staging", () => {
  const current = { ui: { workspace: "live", selectedSceneId: "scene-being-edited", live: { selectedSceneId: "scene-a" } } };
  const incoming = {
    ui: { workspace: "live", selectedSceneId: "another-editor-scene", live: { selectedSceneId: "scene-b" } },
    liveTransition: { startedAtMs: 100, durationMs: 1000, fromState: current },
  };
  assert.equal(shouldPrepareEmbeddedLiveState(incoming, current), false);
  assert.equal(
    shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, selectedSceneId: "scene-a" } }, current),
    false,
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

test("narrow layouts retain the preview until the compact breakpoint", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?--project-rail-width: 220px;[\s\S]*?--inspector-width: 330px;[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\) minmax\(0, 1fr\);[\s\S]*?overflow-x: auto;/);
  assert.match(styleSource, /@media \(max-width: 860px\)[\s\S]*?\.studio-layout \{[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\);[\s\S]*?\.studio-main \{[\s\S]*?display: none;/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.project-rail,\s*\.studio-inspector,\s*\.live-projection-rail\[data-workspace="live"\] \{[\s\S]*?display: grid;/);
  assert.ok(controller.includes('window.matchMedia("(max-width: 860px)")'));
  assert.ok(controller.includes("previewLayoutQuery?.matches"));
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

test("project settings expose proportions, an adaptive ceiling, and no authored pixel dimensions", () => {
  const source = settingsModalTemplate(createInitialState());
  assert.ok(source.includes('data-settings-update="render.sceneAspectRatio"'));
  assert.ok(source.includes('data-settings-update="render.componentAspectRatio"'));
  assert.ok(source.includes('data-settings-update="render.resolutionCeiling"'));
  assert.ok(source.includes('data-settings-update="render.sampling.surfaceOverscan"'));
  assert.ok(source.includes('data-settings-update="render.sampling.surfaceDetailScale"'));
  assert.ok(source.includes('data-settings-update="render.sampling.limitSceneToLogicalSize"'));
  assert.equal(source.includes('data-settings-update="render.edgeSoftness"'), false);
  assert.ok(source.includes("Auto · current window"));
  for (const projectorClass of ["VGA · 640 × 480", "XGA · 1024 × 768", "UXGA · 1600 × 1200", "WUXGA · 1920 × 1200"]) {
    assert.ok(source.includes(projectorClass));
  }
  assert.ok(source.includes("without authoring a width and height"));
  assert.ok(!source.includes("render.componentTexture"));
  assert.ok(!source.includes("render.surfaceTexture"));
  assert.ok(!source.includes('data-settings-update="render.surfaceWidth"'));
  assert.ok(!source.includes('data-settings-update="render.surfaceHeight"'));
});

test("project settings expose proportion presets instead of projector pixel presets", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState())}`;
  for (const ratio of ["16:9", "4:3", "16:10", "1:1", "9:16"]) {
    assert.ok(source.includes(`data-render-preset="${ratio}"`));
  }
  assert.ok(!source.includes('data-render-preset="wxga"'));
  assert.ok(!source.includes('data-render-preset="wuxga"'));
});

test("project settings expose camera capture preferences", () => {
  const source = settingsModalTemplate(createInitialState(), "camera");
  assert.ok(source.includes('data-settings-tab="inputs"'));
  assert.ok(source.includes('data-settings-tab="inputs" class="is-active"'));
  assert.ok(source.includes('data-settings-panel="inputs"'));
  assert.ok(!source.includes('data-settings-tab="camera"'));
  assert.ok(!source.includes('data-settings-panel="camera"'));
  assert.ok(!source.includes("data-camera-preset"));
  assert.ok(!source.includes('data-settings-update="render.camera.width"'));
  assert.ok(!source.includes('data-settings-update="render.camera.height"'));
  assert.ok(source.includes('data-settings-update="render.camera.facingMode"'));
  assert.ok(source.includes('data-settings-update="render.camera.mirrored"'));
  assert.ok(source.includes('data-settings-update="render.camera.maxResolution"'));
});

test("project settings own named session-persistent screen inputs without target dimensions", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState(), "screen")}`;
  assert.ok(source.includes('data-settings-tab="inputs"'));
  assert.ok(source.includes('data-settings-tab="inputs" class="is-active"'));
  assert.ok(!source.includes('data-settings-tab="screen"'));
  assert.ok(source.includes('data-settings-update="render.screenCapture.frameRate"'));
  assert.ok(source.includes('data-settings-update="render.screenCapture.cursor"'));
  assert.ok(source.includes("data-start-screen-capture"));
  assert.ok(source.includes("data-stop-screen-capture"));
  assert.ok(source.includes("data-screen-capture-list"));
  assert.ok(source.includes("data-screen-capture-name"));
  assert.ok(source.includes("data-stop-screen-capture-input"));
  assert.ok(source.includes("renameScreenCaptureInput"));
  assert.ok(source.includes("stopScreenCaptureInput"));
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
  assert.ok(source.includes('data-settings-tab="inputs"'));
  assert.ok(!source.includes('data-settings-tab="camera"'));
  assert.ok(!source.includes('data-settings-tab="screen"'));
  assert.ok(source.includes('data-settings-tab="rendering"'));
  assert.ok(source.includes('data-settings-update="render.maxFrameRate"'));
  assert.ok(source.includes('data-configured-output-list'));
  assert.equal(source.match(/parameter-surface settings-view-surface/g)?.length, 3);
  assert.match(readFileSync(new URL("../style.css", import.meta.url), "utf8"), /\.settings-tabs \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.ok(!source.includes("settingsScroll"));
});

test("Scene plus control creates an empty Scene instead of capturing current assignments", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("data-add-scene"));
  assert.ok(source.includes("store.addScene?.()"));
  assert.ok(!source.includes("data-scene-name"));
  assert.ok(!source.includes('data-save-scene title="Capture scene"'));
});

test("scrub changes send coalesced param patches without waiting for a preview frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const synchronizationSource = readFileSync(new URL("../js/libraries/synchronization-engine/live-patch-synchronizer/index.js", import.meta.url), "utf8");
  const stateSource = readFileSync(new URL("../js/app-state.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(appSource.includes('["live", "runtime", "derived"].includes(change.scope)'));
  assert.ok(bridgeSource.includes('if (change.scope !== "live") return;'));
  assert.ok(bridgeSource.includes("scheduleLivePatches();"));
  assert.ok(bridgeSource.includes("flushLivePatches();"));
  assert.ok(synchronizationSource.includes('typeof requestAnimationFrame === "function"'));
  assert.ok(bridgeSource.includes('type: "live-patch"'));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
  assert.ok(stateSource.includes("function updateLive(recipe"));
  assert.ok(inputSource.includes('typeof store.updateLive === "function"'));
  assert.ok(inputSource.includes("createLiveRenderPatch"));
  assert.ok(previewSource.includes("pendingState?.ui?.outputWindowOpen"));
  assert.ok(!previewSource.includes('outputWindowOpen && pendingState?.ui?.workspace !== "live"'));
  assert.ok(previewSource.includes('renderer.setState(previewSizedState(), { normalized: true });'));
  assert.ok(previewSource.includes('renderer.setUiState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setMappingState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setProjectionState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setAssetState(nextState, { normalized: true })'));
  const activationSource = readFileSync(new URL("../js/control/preview-state-activation.js", import.meta.url), "utf8");
  assert.ok(activationSource.includes('if (context.reason === "live:preview-surface") return "projection"'));
  assert.ok(activationSource.includes('if (context.change?.scope === "ui") return "ui"'));
  assert.ok(activationSource.includes('context.change?.scope === "assets"'));
  assert.ok(activationSource.includes('context.change?.projection?.kind === "asset-catalog"'));
  assert.ok(activationSource.includes('context.change?.topic === "scene-surface"'));
  assert.ok(rendererSource.includes('setState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setUiState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setProjectionState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setAssetState(nextState, { normalized = false } = {})'));
  assert.ok(appSource.includes('bridge.sendState(null, { activation: "assets" })'));
  assert.ok(outputSource.includes('renderer?.setState(runtimeState, { normalized: true });'));
  assert.ok(outputSource.includes('renderer?.setAssetState(runtimeState, { normalized: true });'));
  assert.ok(outputSource.includes("renderer.livePatchRuntime.applyLive(patches)"));
  assert.ok(previewSource.includes("renderer?.livePatchRuntime.applyLive(patches)"));
});

test("parameter context menus are delegated across inspector replacements", () => {
  const source = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("const paramContextScopes = new WeakSet()"));
  assert.ok(source.includes('scope.addEventListener("contextmenu"'));
  assert.ok(source.includes('event.target?.closest?.("[data-param-context-path]")'));
  assert.ok(source.includes('control.dataset.paramContextMode === "live"'));
  assert.ok(source.includes("setLiveOverride(draft, liveComponentId, path, value)"));
  assert.ok(source.includes('updateLiveAware(live, reset, live ? "live:reset-default"'));
  assert.ok(!source.includes('scope.querySelectorAll("[data-param-context-path]").forEach'));
});

test("opening an output never changes the Live Scene", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('buildOutputUrl("output", { outputId: output.id })'));
  assert.ok(!controllerSource.includes("store.selectLiveScene(state.ui.selectedMappingId);"));
  assert.ok(controllerSource.includes("Opening a display is infrastructure, not a Live performance command"));
  assert.ok(!controllerSource.includes("const initialSceneId ="));
  assert.ok(controllerSource.includes("store.selectLiveScene(button.dataset.liveScene)"));
  assert.ok(bridgeSource.includes("store.getLiveRenderState?.()"));
  assert.ok(bridgeSource.includes("targetClientId"));
  assert.ok(!bridgeSource.includes("initialSceneAccepted"));
  assert.ok(!bridgeSource.includes("initialSceneId"));
  assert.ok(appSource.includes('state.ui.workspace === "mapping"'));
  assert.ok(appSource.includes('createRenderStatePatch("mappingCalibration"'));
  assert.ok(!appSource.includes('bridge.command("sync-mapping"'));
  assert.ok(appSource.includes("bridge.sendState();"));
  assert.match(
    appSource,
    /if \(renderPatches\.length\) \{[\s\S]*?bridge\.sendRenderPatches\(renderPatches,[\s\S]*?return;[\s\S]*?bridge\.sendState\(\);/,
  );
  assert.ok(!appSource.includes("isSceneSurfaceOutputChange(reason)"));
  assert.ok(!appSource.includes("bridge.sendState(store.getRenderState())"));
  assert.ok(!appSource.includes('if (state.ui.workspace === "mapping") return;'));
  assert.ok(!controllerSource.includes("setTimeout(() => bridge.sendState(), 350)"));
});

test("studio scrubs patch previews without replacing their complete state", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("componentRenderPatchesForChange(state, change)"));
  assert.ok(controllerSource.includes("embeddedPreview.applyRenderPatches(renderPatches)?.applied"));
  assert.ok(controllerSource.includes("if (!patchedLivePreview && !patchedStudioPreview"));
  assert.ok(controllerSource.includes("previewPatched: patchedLivePreview || patchedStudioPreview"));
  assert.ok(controllerSource.includes("previewPatched = false"));
  assert.ok(controllerSource.includes("render(latestState, { reason, change, previewPatched })"));
  assert.ok(controllerSource.includes("deferRender(state, context)"));
  assert.ok(controllerSource.includes("if (!context.previewPatched) updatePreviewState(state)"));
  assert.ok(controllerSource.includes("const context = deferredRenderContext || {}"));
  assert.ok(controllerSource.includes("if (!context.previewPatched) renderPreview(state, context)"));
  assert.ok(controllerSource.includes('if (change.topic === "mapping-state")'));
  assert.ok(controllerSource.includes('if (change.phase !== "scrub") renderPreview(state, { reason, change })'));
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
  assert.ok(settingsHtml.includes("render.outputs.0.aspectRatio"));
  assert.ok(settingsHtml.includes("data-add-output"));
});

test("the debug button controls only the DOM output HUD, never surface labels", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const metricsSource = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  assert.ok(shellSource.includes('id="toggle-output-hud"'));
  assert.ok(controllerSource.includes('draft.global.showHud = draft.global.showHud === false'));
  assert.ok(metricsSource.includes('host.hud.classList.toggle("is-hidden", !host.state.global.showHud)'));
  assert.ok(metricsSource.includes("this.resolutionLabel()"));
  assert.ok(!rendererSource.includes("renderOutputFrameOverlay"));
  assert.ok(!controllerSource.includes("showLabels"));
});

test("topbar combines renderer health and fixed-width output fps", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  const presentationRuntimeSource = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const metricsSource = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  const gpuTimerSource = readFileSync(new URL("../js/output/gpu-timer-tracker.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const performanceSessionSource = readFileSync(new URL("../js/control/control-performance-session.js", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="render-cost" class="performance-health-button"'));
  assert.ok(shellSource.includes('id="render-cost-dot"'));
  assert.ok(shellSource.includes('id="cpu-time-dot"'));
  assert.ok(shellSource.includes('id="gpu-time-dot"'));
  assert.ok(shellSource.includes('id="signal-load-dot"'));
  assert.ok(shellSource.includes('id="output-status-text">-</span>'));
  assert.match(styleSource, /\.performance-health-button \{[\s\S]*?background: #171717;/);
  assert.match(styleSource, /\.performance-health-button\.is-active \{[\s\S]*?background: var\(--accent-strong\);/);
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
  assert.ok(controllerSource.includes("setPerformanceHealthDot(refs.signalLoadDot"));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("speed", "Overall"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("timer", "CPU"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("memory", "GPU"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("open_in_new", "Output"'));
  assert.match(styleSource, /\.performance-health-readouts \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?margin-bottom: 10px;/);
  assert.ok(controllerSource.includes('performanceReadoutTemplate("cached", "Cache reuse"'));
  assert.ok(controllerSource.includes('performanceReadoutTemplate("refresh", "Renders"'));
  assert.ok(controllerSource.includes('"Signal load"'));
  assert.ok(controllerSource.includes('"Authored transactions"'));
  assert.ok(controllerSource.includes('"Render wakeups"'));
  assert.ok(controllerSource.includes('"Graph compiles"'));
  assert.ok(controllerSource.includes('"Resource revisions"'));
  assert.ok(controllerSource.includes('"Cache invalidations"'));
  assert.ok(controllerSource.includes('"Preview presentations"'));
  assert.ok(controllerSource.includes('"Output presentations"'));
  assert.ok(!controllerSource.includes("Hot now"));
  assert.ok(controllerSource.includes('smoothed.totalsBySource[item.runtimeSource || "renderer"]'));
  assert.ok(!controllerSource.includes("combined sampled CPU"));
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query_webgl2")'));
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query")'));
  assert.doesNotMatch(frameRuntimeSource, /gpuTimer/);
  assert.ok(presentationRuntimeSource.includes("this.gpuTimer.poll(host.frameRuntime.frameIndex)"));
  assert.ok(presentationRuntimeSource.includes("this.gpuTimer.sealFrame(host.frameRuntime.frameIndex)"));
  assert.ok(metricsSource.includes("gpuSupported: gpuTimer.supported"));
  assert.ok(previewSource.includes("runtimeMetrics.previewGpuMs = metrics.gpuMs || 0"));
  assert.ok(shellSource.includes('id="performance-summary"'));
  assert.ok(shellSource.includes('id="performance-analyze"'));
  assert.ok(performanceSessionSource.includes("DEFAULT_DURATION_MS = 10000"));
  assert.ok(controllerSource.includes("createRuntimeHotspotSmoother"));
  assert.ok(controllerSource.includes("summarizeRuntimeHotPasses(profiles, 16)"));
  assert.ok(!controllerSource.includes("running average of recent samples"));
  assert.ok(!controllerSource.includes("CPU rows can overlap because a component includes its child passes"));
  assert.ok(performanceSessionSource.includes('PerformanceObserver.supportedEntryTypes?.includes("longtask")'));
  assert.ok(performanceSessionSource.includes("session.host.uiRenderMs"));
  assert.ok(controllerSource.includes("resolveNodeDefinition: (node) =>"));
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
  assert.match(templates, /<div class="component-thumbnail"\$\{owner\}><img/);
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
      { id: "canvas", name: "Canvas", type: "scene" },
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
  const iconSource = readFileSync(new URL("../js/control/ui-icons.js", import.meta.url), "utf8");
  const projectRailSource = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(iconSource, /component: "extension"[\s\S]*?scene: "landscape"[\s\S]*?mapping: "select_all"/);
  assert.ok(shellSource.includes('from "./ui-icons.js"'));
  assert.ok(projectRailSource.includes('from "./ui-icons.js"'));
  assert.ok(componentSource.includes('from "./ui-icons.js"'));
  for (const label of ["Components", "Scenes", "Mapping", "Nodes", "Live"]) {
    assert.ok(shellSource.includes(`title="${label}" aria-label="${label}"`));
    assert.ok(!shellSource.includes(`<span>${label}</span>`));
  }
  assert.ok(shellSource.includes('data-workspace="mapping"'));
  assert.match(shellSource, /data-workspace="mapping"[^>]*>[^<]*\$\{icon\(UI_ICONS\.mapping\)\}/);
  const projectButtonIndex = shellSource.indexOf('id="open-folder-main"');
  const viewSwitchIndex = shellSource.indexOf('class="workspace-switch workspace-view-switch"');
  const closeProjectIndex = shellSource.indexOf('id="close-project"');
  const topActionsIndex = shellSource.indexOf('class="top-actions"');
  const liveButtonIndex = shellSource.indexOf('data-workspace="live"');
  const technicalSwitchIndex = shellSource.indexOf('class="workspace-switch workspace-tool-switch"');
  const previewButtonIndex = shellSource.indexOf('id="toggle-preview"');
  const debugButtonIndex = shellSource.indexOf('id="toggle-output-hud"');
  const playbackButton = shellSource.match(/<button id="toggle-output-playback"[^>]*>/)?.[0] || "";
  const outputButton = shellSource.match(/<button id="blackout-main"[^>]*>/)?.[0] || "";
  assert.ok(projectButtonIndex < closeProjectIndex && closeProjectIndex < viewSwitchIndex);
  assert.ok(viewSwitchIndex < liveButtonIndex && liveButtonIndex < topActionsIndex);
  assert.equal((shellSource.slice(viewSwitchIndex, topActionsIndex).match(/data-workspace=/g) || []).length, 3);
  assert.equal((shellSource.slice(technicalSwitchIndex).match(/data-workspace=/g) || []).length, 2);
  assert.ok(technicalSwitchIndex < previewButtonIndex && previewButtonIndex < debugButtonIndex);
  assert.ok(playbackButton && !playbackButton.includes("disabled"));
  assert.ok(outputButton.includes("is-output-enabled"));
  assert.match(styleSource, /\.icon-buttonish\.is-output-enabled \{[\s\S]*?background: var\(--panel-soft\);[\s\S]*?color: var\(--ink\);/);
  assert.ok(technicalSwitchIndex < shellSource.indexOf('data-workspace="mapping"'));
  assert.ok(shellSource.indexOf('data-workspace="mapping"') < shellSource.indexOf('data-workspace="nodes"'));
  assert.ok(shellSource.indexOf('data-workspace="scene"') < liveButtonIndex);
  assert.ok(shellSource.includes('class="project-title-control"'));
  assert.match(styleSource, /\.icon-buttonish\.close-project-button \{[\s\S]*?position: static;[\s\S]*?width: 26px;[\s\S]*?height: 26px;/);
  assert.match(styleSource, /\.close-project-button \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(styleSource, /\.workspace-switch button \{[\s\S]*?width: 36px;[\s\S]*?padding: 0;/);
});

test("Nodes is a reachable library workspace with structure and editing surfaces", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const view = readFileSync(new URL("../js/control/node-library-view.js", import.meta.url), "utf8");

  assert.match(controller, /workspace === "nodes"/);
  assert.match(controller, /nodeLibraryRailTemplate/);
  assert.match(controller, /nodeLibraryStudioTemplate/);
  assert.match(controller, /nodeLibraryInspectorTemplate/);
  assert.match(view, /data-select-node-definition/);
  assert.match(view, /nodeGraphCanvasTemplate/);
  assert.match(controller, /bindNodeGraphCanvas/);
  assert.match(view, /nodeDefinitionEditorTemplate/);
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
  assert.ok(controller.includes('switchWorkspace(component.type === "scene" ? "scene" : "component")'));
  assert.ok(controller.includes('openComponentEditor(button.dataset.editComponent, button.dataset.editChainItem || "")'));
  assert.ok(controller.includes("if (chainItemId) store.selectChainItem?.(chainItemId)"));
  assert.ok(controller.includes("function returnFromDeepEdit()"));
  assert.match(style, /\.header-edit-button \{[\s\S]*?margin-left: auto;/);
  assert.match(style, /\.deep-edit-button \{[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
});

test("performance overviews show the owning Component thumbnail without renderer-side image work", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const shaderRuntime = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controller.includes("function performanceComponentThumbnail(state, componentId, className)"));
  assert.ok(controller.includes('"performance-hotspot-thumbnail"'));
  assert.ok(controller.includes('"performance-analysis-thumbnail"'));
  assert.ok(controller.includes("chainItemId: item.chainItemId"));
  assert.ok(shaderRuntime.includes('chainItemId: pass.instanceId || ""'));
  assert.ok(sourceRuntime.includes('chainItemId: item.id || source.instanceId || ""'));
  assert.ok(controller.includes('!refs.performanceSummary.classList.contains("is-hidden") && !shouldDeferRender()'));
  assert.match(style, /\.performance-hotspot-list li\.has-thumbnail\.has-edit \{[\s\S]*?40px minmax\(0, 1fr\) auto 22px;/);
  assert.match(style, /\.performance-pass-cell \{[\s\S]*?display: flex;/);
});

test("topbar diagnostics expose an event-driven bounded console with copy and clear actions", () => {
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const diagnosticsController = readFileSync(new URL("../js/control/control-diagnostics-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(shell.includes('id="diagnostics-toggle"'));
  assert.ok(shell.includes('id="diagnostics-count"'));
  assert.ok(shell.includes('id="diagnostics-summary"'));
  assert.ok(diagnosticsController.includes("diagnostics?.subscribe?."));
  assert.ok(diagnosticsController.includes("errorCount > 0 ? errorCount : warningCount"));
  assert.ok(diagnosticsController.includes("Math.min(999, displayedCount)"));
  assert.ok(diagnosticsController.includes('data-diagnostics-copy'));
  assert.ok(diagnosticsController.includes('data-diagnostics-clear'));
  assert.ok(app.includes("createDiagnosticsService"));
  assert.match(style, /\.diagnostics-summary\s*\{[\s\S]*position:\s*absolute/);
  assert.match(style, /\.diagnostics-count \{[\s\S]*position: absolute;[\s\S]*min-width: 15px;/);
});

test("empty project start shows one folder action and disables project views", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="close-project"'));
  assert.ok(controllerSource.includes("No project open"));
  assert.ok(controllerSource.includes("button.disabled = !hasProject;"));
  assert.ok(controllerSource.includes("hasOpenProject(state)"));
  assert.match(controllerSource, /projectService\.hasOpenFolder\?\.\(\)/);
  assert.match(controllerSource, /Read-only recovery from Output/);
  assert.ok(controllerSource.includes('class="studio-stage project-empty-stage"'));
  assert.ok(!controllerSource.includes("Project first"));
  assert.ok(!controllerSource.includes("data-import-files>${icon"));
  assert.ok(styleSource.includes(".no-project-open .studio-layout"));
  assert.ok(styleSource.includes(".no-project-open .project-rail"));
  assert.ok(styleSource.includes(".workspace-switch button:disabled"));
});

test("3d model controls use full-width slider rows", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const item = component.chain[0];
  item.source = {
    type: "generator",
    generatorId: "modelMedia",
    params: { mediaId: "media/head.stl" },
  };
  state.media.push({ id: "media/head.stl", type: "model" });
  state.ui.selectedChainItemId = item.id;
  const modelControls = componentSelectedChainSettingsTemplate(component, state);

  assert.match(modelControls, /<span>Depth scale<\/span>/);
  assert.match(modelControls, /<span>Visible depth<\/span>/);
  assert.match(modelControls, /<span>Focal length \(mm\)<\/span>/);
  assert.match(modelControls, /<span>Wire thickness<\/span>/);
  assert.match(modelControls, /<span>Edge angle<\/span>/);
  assert.match(modelControls, /<span>Edge budget<\/span>/);
  assert.doesNotMatch(modelControls, /field-pair/);
  assert.ok(styleSource.includes(".model-param-list"));
  assert.doesNotMatch(
    styleSource,
    /\.video-source-controls,\s*\.model-source-controls\s*\{[^}]*padding:/s,
    "3d model controls must not inherit the video's nested card padding"
  );
  assert.doesNotMatch(
    styleSource,
    /\.video-source-controls\s*\{[^}]*(?:padding|background|border-radius):/s,
    "movie segment controls must not create a nested sub-panel"
  );
  assert.match(styleSource, /\.model-param-list\s*\{[^}]*min-width:\s*0;/s);
});

test("seed params stay internal and are not rendered as sliders", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('param?.id !== "seed"'));
  assert.ok(parameterSource.includes("const visible = visibleParamControls(params);"));
  assert.ok(componentSource.includes("componentParamViews(component)"));
  assert.ok(parameterSource.includes('param?.id !== "seed" && param?.id !== RENDER_QUALITY_PARAM.id'));
  assert.ok(sceneLiveSource.includes("paramControlsTemplate(params"));
});

test("selected generators omit the redundant source chooser", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  state.ui.selectedChainItemId = component.chain[0].id;
  const html = componentSelectedChainSettingsTemplate(component, state);

  assert.doesNotMatch(html, /Choose source/);
  assert.doesNotMatch(html, /data-open-source-picker/);
  assert.match(html, /chain-param-list/);
});

test("Project Media owns alpha controls in its semantic node definition", () => {
  const component = getGeneratorComponent("mediaImage");
  const ids = component.params.map((param) => param.id);
  assert.ok(ids.includes("alphaCut"));
  assert.ok(ids.includes("alphaFeather"));
  assert.equal(component.params.find((param) => param.id === "alphaCut").label, "Cut edge");
  assert.equal(component.params.find((param) => param.id === "alphaFeather").label, "Feather");
});

test("inspector dropdowns share compact slider-like styling without an orange focus ring", () => {
  const source = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(source, /createNumberParam\("opacity", "Opacity"[\s\S]*?createEnumParam\("blend", "Blend", BLEND_MODES/);
  assert.match(style, /\.param-select \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--slider-track\);[\s\S]*?color: var\(--ink\);/);
  assert.match(style, /\.param-select \{[\s\S]*?padding: 1px 30px 1px 5px;[\s\S]*?background-position: right 12px center;[\s\S]*?appearance: none;/);
  assert.match(style, /\.param-select:disabled \{[\s\S]*?color: var\(--muted\);[\s\S]*?opacity: 1;/);
  assert.match(style, /\.param-select option \{[\s\S]*?background: var\(--control\);[\s\S]*?color: var\(--ink\);/);
  assert.match(style, /\.param-select:focus-visible \{[\s\S]*?outline: 1px solid var\(--slider-thumb\);/);
  assert.match(style, /\.range-field > span,[\s\S]*?\.field:has\(> \.param-select\) > span \{[\s\S]*?color: var\(--slider-text\);/);
  assert.doesNotMatch(style, /\.param-select:focus-visible \{[^}]*var\(--accent/);
});

test("source picker buttons use the same compact neutral parameter styling", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.source-choice-button \{[\s\S]*?min-height: var\(--control-height\);[\s\S]*?padding: 4px 8px;[\s\S]*?background: var\(--slider-track\);[\s\S]*?color: var\(--muted\);/);
  assert.match(styleSource, /\.source-choice-button strong,[\s\S]*?\.source-choice-button small \{[\s\S]*?font-weight: 500;/);
});

test("components expose persistent instance synchronization without changing component ids", () => {
  const controllerSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("function componentInstanceSyncTemplate"));
  assert.ok(controllerSource.includes("Sync instances"));
  assert.ok(controllerSource.includes(".syncInstances"));
  assert.ok(controllerSource.includes('data-toggle-path="${base}.syncInstances"'));
  assert.ok(controllerSource.includes("each Scene placement and Surface its own phase"));
});

test("global clipboard routing follows clicked lists chains Groups and external images", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const clipboardSource = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(source.includes("clipboard.bindWindowEvents()"));
  assert.ok(clipboardSource.includes('window.addEventListener("copy", copyFromCurrentTarget)'));
  assert.ok(clipboardSource.includes('window.addEventListener("paste", pasteIntoCurrentTarget)'));
  assert.ok(clipboardSource.includes('window.addEventListener("pointerdown", rememberTarget, true)'));
  assert.ok(clipboardSource.includes('chainItem.closest("[data-chain-reorder-list]")'));
  assert.ok(source.includes('data-paste-scope="component-list"'));
  assert.ok(source.includes('data-paste-scope="scene-list"'));
  assert.ok(source.includes('data-paste-scope="mapping-list"'));
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

test("periodic preview metrics update only runtime state", () => {
  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const metricsPath = source.slice(source.indexOf("function updateMetrics("), source.indexOf("function updateMapping("));

  assert.ok(metricsPath.includes("store.updateRuntime((runtimeMetrics)"));
  assert.ok(!metricsPath.includes("store.updateDerived("));
});
