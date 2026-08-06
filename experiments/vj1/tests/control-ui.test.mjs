import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parameterUiNodes } from "../js/libraries/ui-engine/parameter-graph.js";
import { ButtonNode, RangeUiNode, SliderUiNode } from "../js/libraries/ui-engine/nodes/control-nodes.js";
import { CollectionNode, ListNode, ThumbnailButtonNode } from "../js/libraries/ui-engine/index.js";
import {
  elementMediaCategory,
  elementPickerUiModel,
  isIsfVisualComponent,
  mergeVisualCatalogEntries,
  sourceChoicePickerUiModel,
  visualPickerDisplayName,
} from "../js/control/picker-view.js";
import { normalizeSettingsTab, settingsUiModel } from "../js/control/settings-view.js";
import { createInitialState, createSceneComponent } from "../js/domain/models.js";
import { componentCatalogListItems, liveProjectionListModel } from "../js/control/project-rail-view.js";
import { hasActiveRendererTransition, previewFitSignature, previewModeChangeActivation, previewRasterDensity, retimeEmbeddedLiveTransition, shouldPrepareEmbeddedLiveState } from "../js/output/embedded-preview-app.js";
import { boundaryFromScaleInput, createInputController, isBoundaryScaleInput, isfEventTarget } from "../js/control/input-controller.js";
import { activeRenderCost, activeWorkMetric, artifactInspectorScope, createLiveTransitionExpiryScheduler, mergeControlRenderRequests, performanceHealthStep } from "../js/control/control-shell-controller.js";
import { sourceForCatalogMedia } from "../js/control/modal-controller.js";
import { nextCatalogFilter } from "../js/libraries/ui-engine/nodes/catalog-picker-node.js";
import { mediaDisplayName } from "../js/control/media-view.js";
import { componentElementsUiModel, componentSelectedChainSettingsModel, selectedChainParameterTabsModel } from "../js/control/component-view.js";
import { catalogSortIcon } from "../js/control/control-ui-program.js";
import { sameOrderedIds } from "../js/libraries/ui-engine/nodes/workspace-shell-node.js";
import { createControlCommandController, liveTimingPreferencePath } from "../js/control/control-command-controller.js";

function settingsPanelsSource(state, midiStatus = {}, dmxStatus = {}, sharedInputs = []) {
  return JSON.stringify(settingsUiModel(state, { midiStatus, dmxStatus, sharedInputs }));
}
import { getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { componentCatalogSearchText } from "../js/control/catalog-view.js";
import {
  chainBoundaryPositionParams,
  chainTransformParams,
  placementAxisRange,
} from "../js/control/parameter-view.js";
import { createChangeEvent } from "../js/libraries/state-engine/state-command/index.js";
import { createVj1NodePackage } from "../js/app-node-package.js";

const appNodePackage = createVj1NodePackage();

function vjStyleSource() {
  return [
    readFileSync(new URL("../style.css", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8"),
    readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8"),
  ].join("\n");
}

function preparedComponentSettings(component, state) {
  const prepared = appNodePackage.prepareProjectState(state);
  const preparedComponent = prepared.components.find((candidate) => candidate.id === component.id);
  const shell = componentSelectedChainSettingsModel(preparedComponent, prepared);
  const model = selectedChainParameterTabsModel(preparedComponent, prepared);
  return `${JSON.stringify(shell)}${(model?.views || []).map((view) => `${JSON.stringify(view.models || [])}${JSON.stringify(view.parameterModel || null)}${view.html}`).join("")}`;
}

test("ISF events render as transient trigger buttons and resolve their chain instance", () => {
  const control = parameterUiNodes({
    id: "isf-event",
    controls: [{
      id: "clear",
      label: "Clear",
      kind: "event",
      address: "components.0.chain.1.params.clear",
      action: "project.trigger-event",
    }],
  }).find((node) => node.id === "clear");
  assert.equal(control.type, ButtonNode.id);
  assert.equal(control.stateAddress, "components.0.chain.1.params.clear");
  assert.equal(control.commands.activate.action, "project.trigger-event");
  assert.deepEqual(isfEventTarget({
    components: [{
      chain: [
        { id: "source-a", source: { params: {} } },
        { id: "effect-a", params: {} },
      ],
    }],
  }, "components.0.chain.1.params.clear"), {
    target: "effect-a",
    parameterId: "clear",
  });
  assert.deepEqual(isfEventTarget({
    components: [{
      chain: [
        { id: "source-a", source: { params: {} } },
      ],
    }],
  }, "components.0.chain.0.source.params.restart"), {
    target: "source-a",
    parameterId: "restart",
  });
});

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

test("project ISF entries replace matching bundled catalog identities", () => {
  const bundled = [
    { id: "brick-pattern", name: "Brick Pattern", origin: "bundled" },
    { id: "radial-gradient", name: "Radial Gradient", origin: "bundled" },
  ];
  const project = [
    { id: "brick-pattern", name: "brick-pattern", origin: "project" },
    { id: "custom-project-shader", name: "Custom", origin: "project" },
  ];

  assert.deepEqual(mergeVisualCatalogEntries(bundled, project), [
    project[0],
    bundled[1],
    project[1],
  ]);
});

test("Live exposes placement controls only for Components that own placement", () => {
  const source = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(source.includes("export function liveComponentControlsUiGraph"));
  assert.ok(source.includes('if (component.type !== "scene")'));
  assert.ok(source.includes("chainTransformParams(view?.transform)"));
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

  const outputItem = liveProjectionListModel(state).outputItems.find((item) => item.id === surface.id);
  assert.ok(surface);
  assert.equal(outputItem.actions[0].label, `Hide ${surface.name}`);
});

test("inspector parameter views delegate retained selection and scroll restoration to TabsNode", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const program = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(controller.includes("reconcileChainParameterTabsUi"));
  assert.ok(controller.includes("reconcileLiveChainParameterTabsUi"));
  assert.ok(!controller.includes("rememberParamViewSelections"));
  assert.ok(!controller.includes("restoreParamViewSelections"));
  assert.ok(program.includes("export function parameterTabsUiGraph"));
});

test("list and collection state is retained by UI nodes rather than VJ DOM snapshots", () => {
  assert.ok(ListNode.metadata.uiNode.state.some((entry) => entry.id === "scroll"));
  assert.ok(ListNode.metadata.uiNode.state.some((entry) => entry.id === "selectedId"));
  assert.ok(CollectionNode.metadata.uiNode.state.some((entry) => entry.id === "search"));
});

test("preview presses defer UI rebuilding and draggable chain rows select on press", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const listSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/list-node.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/global-input-node.js", import.meta.url), "utf8");

  assert.match(inputSource, /emit\("interaction", \{ kind: "pointer", active: true \}/);
  assert.match(controllerSource, /command\.action === "global\.interaction"/);
  assert.match(listSource, /root\.addEventListener\("pointerdown", onPointerDown\)/);
  assert.match(listSource, /function onPointerDown[\s\S]*?select\(String\(item\.dataset\.uiListSelect/);
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
  const model = elementPickerUiModel({
    media,
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
  }, { componentId: "owner" }, {
    getFile: () => ({}),
    acquirePreviewUrl() {
      previewAcquisitions++;
      return "blob:should-not-be-created-during-template-render";
    },
  });
  const pickerNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");
  const thumbnailHandlerSource = readFileSync(new URL("../js/services/media-thumbnail-service.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const mediaItems = model.sections.find((section) => section.id === "media").items;
  const modelMedia = elementPickerUiModel({
    media: [{ id: "media/sculpture.stl", name: "sculpture.stl", type: "model" }],
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
  }, { componentId: "owner" }, { getFile: () => ({}) })
    .sections.find((section) => section.id === "media").items[0].media;

  assert.equal(previewAcquisitions, 0, "descriptor construction remains metadata-only");
  assert.equal(mediaItems.filter((item) => item.media?.key).length, 100);
  assert.equal(mediaItems.every((item) => item.media?.type === "image" && item.media?.load === "visible"), true);
  assert.equal(modelMedia.load, "visible", "cached model thumbnails load when their cards approach the viewport");
  assert.equal(modelMedia.type, "image", "all media-card previews use the still-thumbnail contract");
  assert.match(pickerNodeSource, /new document\.defaultView\.IntersectionObserver/);
  assert.match(pickerNodeSource, /rootMargin: "360px 0px"/);
  assert.match(pickerNodeSource, /element\.dataset\.uiCatalogMediaLoad !== "intent"/);
  assert.match(pickerNodeSource, /scheduleIntentMedia\(media\)[\s\S]*?300/);
  assert.doesNotMatch(pickerNodeSource, /if \(item\.media\.src\) media\.src = item\.media\.src/);
  assert.match(pickerNodeSource, /mediaPreview\.release\?\.\(key\)/);
  assert.match(pickerNodeSource, /dataset\.uiCatalogMediaReady = "false"/);
  assert.match(pickerNodeSource, /media\.tagName === "VIDEO" \? "loadeddata" : "load"/);
  assert.doesNotMatch(pickerNodeSource, /inputs\.(?:resolveMedia|releaseMedia)/);
  assert.doesNotMatch(JSON.stringify(model), /resolveMedia|releaseMedia/);
  assert.match(pickerNodeSource, /media\.slice\(0, 24\)\.forEach\(loadMedia\)/);
  assert.doesNotMatch(pickerNodeSource, /scheduleMediaPreviewUnload|mediaPreviewUnloadTimers/);
  assert.match(thumbnailHandlerSource, /createMediaThumbnailBlob/);
  assert.match(thumbnailHandlerSource, /kind === "video"/);
  assert.match(thumbnailHandlerSource, /kind === "model"/);
  assert.doesNotMatch(thumbnailHandlerSource, /createObjectUrl\(file\)/, "catalog media never displays a full source file as its thumbnail");
  assert.match(thumbnailHandlerSource, /maxConcurrentGenerations = 2/);
  assert.match(thumbnailHandlerSource, /generationQueue\.push/);
});

test("media presentation shows basenames while retaining paths only as picker metadata", () => {
  const media = {
    id: "media/sets/night/sky.png",
    name: "media/sets/night/sky.png",
    path: "media/sets/night/sky.png",
    type: "image",
  };
  const model = elementPickerUiModel({
    media: [media],
    components: [{ id: "owner", type: "component", name: "Owner" }],
  }, { componentId: "owner" }, { getFile: () => null });
  const card = model.sections.find((section) => section.id === "media").items[0];

  assert.equal(mediaDisplayName(media), "sky.png");
  assert.equal(card.label, "sky.png");
  assert.equal(card.id, "media:media/sets/night/sky.png");
  assert.match(card.searchText, /media\/sets\/night\/sky\.png/);
  assert.equal(card.value.kind, "source");
});

test("element picker filters media and render elements by explicit category", () => {
  const owner = { id: "canvas", type: "scene", name: "Canvas", chain: [] };
  const component = { id: "component", type: "chain", name: "Source", chain: [] };
  const model = elementPickerUiModel({
    components: [owner, component],
    media: [
      { id: "photo", name: "photo.png", path: "media/photo.png", type: "image" },
      { id: "clip", name: "clip.mp4", path: "media/clip.mp4", type: "video" },
      { id: "mesh", name: "mesh.obj", path: "media/mesh.obj", type: "model" },
    ],
  }, {
    componentId: owner.id,
    filter: "model",
    search: "radial",
  }, { getFile: () => null }, {
    components: [owner, component],
    sortMode: "recent",
  });
  const pickerNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");
  const filterIds = model.filters.map((filter) => filter.id);
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const items = model.sections.flatMap((section) => section.items);

  assert.equal(elementMediaCategory({ type: "image" }), "image");
  assert.equal(elementMediaCategory({ type: "video" }), "video");
  assert.equal(elementMediaCategory({ path: "media/shape.stl", type: "unknown" }), "model");
  for (const id of ["image", "video", "model", "generator", "effect", "isf", "component"]) assert.ok(filterIds.includes(id), id);
  assert.equal(model.activeFilter, "model");
  assert.equal(model.search, "radial");
  assert.equal(items.find((item) => item.id === "media:photo").categories, "image");
  assert.equal(items.find((item) => item.id === "media:clip").categories, "video");
  assert.equal(items.find((item) => item.id === "media:mesh").categories, "model");
  assert.match(pickerNodeSource, /filter === "all" \|\| categories\.includes\(filter\)/);
  assert.doesNotMatch(modalSource, /elementPickerMemory|sourceChoicePickerMemory|rememberUnrestrictedPicker/);
  assert.match(pickerNodeSource, /state\.set\(searchAddress, value/);
  assert.equal(isIsfVisualComponent({
    nodeDefinition: { metadata: { visualFamily: "isf" } },
  }), true);
  assert.equal(isIsfVisualComponent(null), false);
  assert.equal(visualPickerDisplayName({ name: "Dilate" }), "Dilate");
  assert.equal(
    visualPickerDisplayName({
      name: "Dilate",
      nodeDefinition: { metadata: { visualFamily: "isf" } },
    }),
    "Dilate (ISF)",
  );
  assert.ok(items.some((item) => item.label === "Dilate (ISF)"));
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
  const general = sourceChoicePickerUiModel(state, {
    path: "target.source",
    search: "brick",
  }, { getFile: () => null });
  for (const id of ["image", "video", "model", "generator", "isf"]) assert.ok(general.filters.some((filter) => filter.id === id), id);
  assert.equal(general.search, "brick");
  assert.ok(general.sections.flatMap((section) => section.items).some((item) => item.categories === "model"));
  assert.equal(general.filters.some((filter) => filter.id === "all"), false);

  const modelOnly = sourceChoicePickerUiModel(state, {
    path: "target.source",
    allowedCategory: "model",
    filter: "model",
  }, { getFile: () => null });
  assert.equal(modelOnly.lockedFilter, true);
  assert.equal(modelOnly.searchPlaceholder, "Search 3D objects");
  assert.deepEqual(modelOnly.sections.flatMap((section) => section.items).map((item) => item.id), ["media:mesh"]);

  const imageValueOnly = sourceChoicePickerUiModel({
    ...state,
    target: { imageId: "photo" },
  }, {
    path: "target.imageId",
    allowedCategory: "image",
    filter: "image",
    valueMode: "mediaId",
  }, { getFile: () => null });
  assert.equal(imageValueOnly.title, "Choose image");
  assert.equal(imageValueOnly.lockedFilter, true);
  assert.deepEqual(imageValueOnly.sections.flatMap((section) => section.items).map((item) => item.id), ["media:photo"]);
  assert.equal(imageValueOnly.sections.flatMap((section) => section.items)[0].selected, true);

  const style = vjStyleSource();
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const baseStyle = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(baseStyle, /\.ui-node-catalog-panel\s*\{[^}]*grid-template-rows:\s*auto auto auto minmax\(0, 1fr\)/s);
  assert.match(index, /style\.css\?v=[^"']+/);
});

test("new Live Camera elements enter through the reusable camera Group", () => {
  const state = {
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
    media: [],
  };
  const sourceModel = sourceChoicePickerUiModel(state, { path: "target.source" }, { getFile: () => null });
  const elementModel = elementPickerUiModel(state, { componentId: "owner" }, { getFile: () => null });
  const sourceCamera = sourceModel.sections.flatMap((section) => section.items).find((item) => item.id === "generator:cameraInput");
  const elementCamera = elementModel.sections.flatMap((section) => section.items).find((item) => item.id === "generator:cameraInput");

  assert.deepEqual(sourceCamera.value, { type: "generator", generatorId: "cameraInput" });
  assert.deepEqual(elementCamera.value, { kind: "source", value: { type: "generator", generatorId: "cameraInput" } });
});

test("picker filters behave as exclusive tabs and selecting the active tab restores the full list", () => {
  assert.equal(nextCatalogFilter("all", "image"), "image");
  assert.equal(nextCatalogFilter("image", "video"), "video");
  assert.equal(nextCatalogFilter("image", "image"), "all");
  assert.equal(nextCatalogFilter("model", "image", true), "model");
});

test("media refresh is explicit and never polls during rendering", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const state = {
    components: [{ id: "owner", type: "component", name: "Owner", chain: [] }],
    media: [],
  };
  const sourceModel = sourceChoicePickerUiModel(state, { path: "target.source" }, { getFile: () => null });
  const elementModel = elementPickerUiModel(state, { componentId: "owner" }, { getFile: () => null });

  assert.match(pickerSource, /actions: \[\{ id: "refresh", label: "Refresh media"/);
  assert.deepEqual(sourceModel.actions.map((action) => action.id), ["refresh"]);
  assert.deepEqual(elementModel.actions.map((action) => action.id), ["refresh"]);
  assert.match(modalSource, /action === "refresh"\) refreshMediaPicker\(\)/);
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
  const graphNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/node-graph-editor-node.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");

  assert.match(graphNodeSource, /emit\("media-request", \{ nodeId, parameterId, accept \}\)/);
  assert.match(controllerSource, /onMediaParameterRequest:\s*\(\{ nodeId, parameterId, accept \}\)[\s\S]*?modals\.openMediaPicker\("", accept/);
  assert.match(controllerSource, /graphWithNodeParameter\(graph, nodeId, parameterId/);
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
  const startupNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/startup-status-node.js", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const startupSource = readFileSync(new URL("../js/startup.js", import.meta.url), "utf8");

  assert.match(appSource, /installControlApp\(\)\.catch\(showStartupFailure\)/);
  assert.match(appSource, /VJ1_CONTROL_STARTUP_FAILED/);
  assert.match(appSource, /showStartupStage\("Loading node library/);
  assert.match(appSource, /showStartupStage\("Initializing application services/);
  assert.match(appSource, /showStartupStage\("Restoring project folder/);
  assert.match(appSource, /createStartupStatusUi/);
  assert.ok(
    appSource.indexOf("await projectService.restoreStoredFolder()") < appSource.lastIndexOf("startupUi.dispose()"),
    "the loading node must remain visible until stored-project restoration settles",
  );
  assert.ok(
    indexSource.indexOf("createVj1StartupUi()") < indexSource.indexOf("navigator.serviceWorker.register"),
    "source synchronization must never leave an empty pre-application frame",
  );
  assert.match(indexSource, /startupUi\.update\(\{ state: "loading", title: "VJ1", message: "Updating application sources…" \}\)/);
  assert.match(indexSource, /VJ1_SOURCE_COHERENCE_BLOCKED[\s\S]*?startupUi\.update\(\{[\s\S]*?state: "error"/);
  assert.match(startupSource, /createStartupStatusUi/);
  assert.doesNotMatch(appSource, /innerHTML|outerHTML|insertAdjacentHTML|createElement|replaceChildren|querySelector|classList|className|addEventListener|<section|<h1|<p>/);
  assert.match(startupNodeSource, /export const StartupStatusNode = defineUiNode/);
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
  const sharedRange = parameterUiNodes({
    id: "opacity",
    controls: [{ id: "opacity", label: "Opacity", kind: "number", address: "components.0.opacity", value: 0.42 }],
  }).find((node) => node.id === "opacity");
  const rangeNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/control-nodes.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.equal(sharedRange.type, SliderUiNode.id);
  assert.equal(sharedRange.inputs.label, "Opacity");
  assert.equal(sharedRange.inputs.value, 0.42);
  assert.ok(rangeNodeSource.includes("function sync(value)"));
  assert.ok(rangeNodeSource.includes('emit("change", { value, active }, phase)'));
  assert.ok(styleSource.includes("--param-slider-width: 176px;"));
  assert.ok(styleSource.includes("grid-template-columns: auto minmax(0, 1fr);"));
  assert.match(styleSource, /\.range-value::before \{[\s\S]*?content: "\(";/);
  assert.match(styleSource, /\.range-value::after \{[\s\S]*?content: "\)";/);
  assert.match(styleSource, /\.chain-param-view-tabs \{[\s\S]*?grid-auto-flow: column;/);
  assert.match(styleSource, /\.inspector-view-option \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?min-height: 24px;[\s\S]*?padding: 3px 7px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 1;/);
  assert.match(styleSource, /\.ui-parameter-layout > \.ui-node-layout-content \{[\s\S]*?align-content: start;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?align-content: start;[\s\S]*?padding: var\(--param-section-inset\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(styleSource, /:root \{[\s\S]*?--param-section-inset: 4px;[\s\S]*?--param-section-bottom-inset: 6px;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?padding-bottom: var\(--param-section-bottom-inset\);/);
  assert.doesNotMatch(styleSource, /\.chain-param-view-panel\.chain-param-view-animation\s*\{/);
  assert.match(styleSource, /\.ui-parameter-layout > \.ui-node-layout-content \{[\s\S]*?gap: var\(--ui-parameter-stack-gap\);/);
  assert.match(styleSource, /\.chain-param-view-tabs \{[\s\S]*?gap: 6px;/);
  assert.match(styleSource, /\.chain-param-view-tab\[aria-selected="true"\] \{[\s\S]*?background: var\(--accent-strong\);/);
  assert.match(styleSource, /\.chain-settings-panel \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?gap: 0;/);
  assert.match(styleSource, /\.chain-param-views \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?overflow-y: auto;/);
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
  assert.ok(styleSource.includes(".live-chain-settings .chain-param-view-content"));
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
});

test("Component Scene and Live inspectors give range tracks their own full-width row", () => {
  const workspaceShellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.ok(workspaceShellSource.includes("refs.workspace.dataset.workspace"));
  assert.match(styleSource, /\.ui-node-slider\[data-ui-presentation="parameter"\] > input\[type="range"\],[\s\S]*?\.ui-node-color\[data-ui-presentation="parameter"\][^\{]+\{[\s\S]*?width: 100%;/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] \{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.ok(!styleSource.includes(".live-chain-pass .range-field"));
  assert.ok(!styleSource.includes(".chain-pass .range-field"));
  assert.ok(!styleSource.includes(".live-chain-pass .chain-param-list"));
  assert.ok(styleSource.includes("--param-label-control-gap: 0px;"));
  assert.ok(styleSource.includes("--param-stack-gap: 7px;"));
  assert.match(styleSource, /\.ui-node-control\[data-ui-presentation="parameter"\] \{[\s\S]*?gap: var\(--ui-parameter-gap\);/);
  assert.match(styleSource, /\.ui-parameter-layout > \.ui-node-layout-content \{[\s\S]*?gap: var\(--ui-parameter-stack-gap\);/);
});

test("color parameters keep a visible picker beside the shared alpha slider", () => {
  const styleSource = vjStyleSource();
  const controlSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/control-nodes.js", import.meta.url), "utf8");
  assert.match(styleSource, /\.ui-node-slider\[data-ui-presentation="parameter"\] > \.ui-node-control-label,[\s\S]*?\.ui-node-select\[data-ui-presentation="parameter"\] > \.ui-node-control-label,[\s\S]*?\.ui-node-color\[data-ui-presentation="parameter"\] > \.ui-node-control-label \{[\s\S]*?color: var\(--ui-parameter-value\);[\s\S]*?font-weight: 400;/);
  assert.match(styleSource, /\.ui-node-color\[data-ui-presentation="parameter"\] > \.ui-node-color-inputs \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 32px;[\s\S]*?gap: 8px;/);
  assert.match(styleSource, /\.ui-node-color\[data-ui-presentation="parameter"\] > \.ui-node-color-inputs > input\[type="range"\] \{[\s\S]*?grid-column: 1;/);
  assert.match(styleSource, /\.ui-node-color\[data-ui-presentation="parameter"\] > \.ui-node-color-inputs > input\[type="color"\] \{[\s\S]*?grid-column: 2;[\s\S]*?width: 32px;[\s\S]*?height: var\(--ui-parameter-height\);[\s\S]*?padding: 0;[\s\S]*?appearance: none;/);
  assert.match(styleSource, /input\[type="color"\]::-webkit-color-swatch-wrapper \{\s*padding: 0;/);
  assert.match(styleSource, /input\[type="color"\]::-webkit-color-swatch \{\s*border: 0;/);
  assert.ok(controlSource.includes("row.append(alpha, control)"));
});

test("every Scene Surface exposes proportion locking and direct-output Surfaces remain interactive", () => {
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const interactionSource = readFileSync(new URL("../js/output/component-preview-interaction.js", import.meta.url), "utf8");
  for (const label of ["Scene X", "Scene Y", "Scene width", "Scene height"]) {
    assert.ok(programSource.includes(`label: "${label}"`));
  }
  assert.ok(programSource.includes('{ id: "keepProportions", type: "boolean", label: "Keep proportions" }'));
  assert.ok(programSource.includes('id: "scene-surface-controls"'));
  assert.ok(programSource.includes('{ id: "x", type: "number", label: "Scene X"'));
  assert.doesNotMatch(interactionSource, /frame\.kind === "output"/);
});

test("all renderable chain elements expose shared quality opacity blend and placement through General", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('createNumberParam("opacity", "Opacity"'));
  assert.ok(parameterSource.includes('createEnumParam("blend", "Blend", BLEND_MODES'));
  assert.ok(programSource.includes("param: RENDER_QUALITY_PARAM"));
  assert.ok(programSource.includes("const quality = chainRenderQualityTarget(item, basePath)"));
  assert.ok(componentSource.includes('{ id: "general", label: "General" }'));
  assert.ok(parameterSource.includes('createNumberParam("x", "Boundary X"'));
  assert.ok(parameterSource.includes('createNumberParam("y", "Boundary Y"'));
  assert.ok(parameterSource.includes('createNumberParam("scale", "Boundary scale"'));
  assert.ok(parameterSource.includes('createNumberParam("rotation", "Boundary rotation"'));
  assert.equal(parameterSource.includes('"Content rotation"'), false);
  assert.equal(parameterSource.includes('"Boundary width"'), false);
  assert.equal(parameterSource.includes('"Boundary height"'), false);
  assert.ok(!componentSource.includes("data-chain-general-parameter-ui"));
  assert.ok(programSource.includes("export function chainGeneralParameterUiGraph"));
  assert.ok(programSource.includes("export function chainGeneralParameterUiModel"));
  assert.ok(programSource.includes('changeAction: "project.set-value"'));
  assert.ok(!sceneLiveSource.includes("data-live-chain-general-parameter-ui"));
  assert.ok(programSource.includes("export function liveChainGeneralParameterUiGraph"));
  assert.ok(programSource.includes("export function liveChainGeneralParameterUiModel"));
  assert.ok(programSource.includes("chainGeneralParameterEntries"));
  assert.doesNotMatch(componentSource, /rangeTemplate\("Alpha", `\$\{base\}\.opacity`/);
  assert.doesNotMatch(sceneLiveSource, /liveRangeTemplate\("Alpha", componentId, `\$\{path\}\.opacity`/);
});

test("boundary scale controls write one aspect-preserving ROI change", () => {
  const target = { width: 0.8, height: 0.4 };
  assert.equal(isBoundaryScaleInput(target, "components.0.chain.0.boundary.scale"), true);
  assert.equal(
    isBoundaryScaleInput(target, "boundary.scale"),
    true,
    "Live graph-node controls use a node-relative path",
  );
  assert.deepEqual(boundaryFromScaleInput(target, Math.sqrt(0.32) * 2), {
    width: 1.6,
    height: 0.8,
  });
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-command-controller.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(programSource.includes("contextTarget: parameterContextTarget(entry.param, entry.path, component"), "the final Boundary scale slider participates in the shared context menu");
  assert.ok(controllerSource.includes("isBoundaryScaleTarget(target, path)"), "reset translates Boundary scale into its canonical width and height fields");
});

test("retained Boundary scale commands atomically write canonical width and height", () => {
  let committed = null;
  const controller = createInputController({
    store: {
      setComponentValues(entries, metadata) {
        committed = { entries, metadata };
        return true;
      },
    },
    getState: () => createInitialState(),
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updatePersistentBoundaryScale({
    path: "nodes.groups.0.nodes.1.configuration.boundary.scale",
    width: 0.8,
    height: 0.4,
  }, Math.sqrt(0.32) * 2, { phase: "change" }), true);
  assert.deepEqual(committed.entries.map((entry) => entry.path), [
    "nodes.groups.0.nodes.1.configuration.boundary.width",
    "nodes.groups.0.nodes.1.configuration.boundary.height",
  ]);
  assert.ok(Math.abs(committed.entries[0].value - 1.6) < 1e-12);
  assert.ok(Math.abs(committed.entries[1].value - 0.8) < 1e-12);
  assert.equal(committed.metadata.reason, "scrub:chain-boundary");
});

test("retained Markdown style commands resolve related authored paths without DOM authority", () => {
  let committed = null;
  const controller = createInputController({
    store: {
      setComponentValues(entries, metadata) {
        committed = { entries, metadata };
        return true;
      },
    },
    getState: () => createInitialState(),
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updatePersistentRelatedValue({
    controls: {
      bold: { path: "nodes.groups.0.nodes.1.configuration.source.params.bold" },
    },
  }, { id: "bold", value: true }), true);
  assert.deepEqual(committed.entries, [{
    path: "nodes.groups.0.nodes.1.configuration.source.params.bold",
    value: true,
  }]);
});

test("component and parameter context actions cross one retained Popup command boundary", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  let menu = null;
  let converted = "";
  let closed = 0;
  const controller = createInputController({
    store: {
      copyComponentToScene(id) { converted = id; },
      update(recipe) { recipe(state); },
    },
    getState: () => state,
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
    showContextMenu(model) { menu = model; return true; },
    closeContextMenu() { closed += 1; },
  });

  assert.equal(controller.openComponentContextMenu(component.id, { x: 42, y: 73 }), true);
  assert.deepEqual(menu.actions, [{ id: "convert-to-scene", label: "Convert to Scene" }]);
  assert.equal(controller.executeContextMenuAction("convert-to-scene"), true);
  assert.equal(converted, component.id);

  controller.openParameterContextMenu({
    path: "components.0.name",
    defaultValue: "Reset Component",
    resettable: true,
  }, { x: 10, y: 20 });
  assert.ok(menu.actions.some((action) => action.id === "reset"));
  assert.equal(controller.executeContextMenuAction("reset"), true);
  assert.equal(state.components[0].name, "Reset Component");
  assert.equal(closed, 2);
});

test("parameter context action toggles the canonical significant address", () => {
  const state = appNodePackage.prepareProjectState(createInitialState());
  const group = state.nodes.groups[0];
  const node = group.nodes.find((candidate) => candidate.configuration?.opacity !== undefined);
  const component = state.components.find((candidate) => candidate.id === group.componentId);
  let menu = null;
  const controller = createInputController({
    store: { update(recipe) { recipe(state); } },
    getState: () => state,
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
    showContextMenu(model) { menu = model; return true; },
    closeContextMenu() {},
  });
  const path = `nodes.groups.0.nodes.${group.nodes.indexOf(node)}.configuration.opacity`;

  assert.equal(controller.openParameterContextMenu({
    path,
    componentId: component.id,
    defaultValue: 1,
  }), true);
  assert.ok(menu.actions.some((action) => action.id === "significant"));
  assert.equal(controller.executeContextMenuAction("significant"), true);
  assert.deepEqual(component.significantParams, [`${node.id}::opacity`]);

  controller.openParameterContextMenu({ path, componentId: component.id, defaultValue: 1 });
  assert.equal(controller.executeContextMenuAction("significant"), true);
  assert.deepEqual(component.significantParams, []);
});

test("retained paired-range commands atomically write both authored endpoints", () => {
  let committed = null;
  const controller = createInputController({
    store: {
      setComponentValues(entries, metadata) {
        committed = { entries, metadata };
        return true;
      },
    },
    getState: () => createInitialState(),
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updatePersistentRange({
    minPath: "nodes.groups.0.nodes.1.configuration.params.hueMin",
    maxPath: "nodes.groups.0.nodes.1.configuration.params.hueMax",
  }, { min: 210, max: 275 }, { phase: "change" }), true);
  assert.deepEqual(committed.entries, [
    { path: "nodes.groups.0.nodes.1.configuration.params.hueMin", value: 210 },
    { path: "nodes.groups.0.nodes.1.configuration.params.hueMax", value: 275 },
  ]);
  assert.equal(committed.metadata.reason, "scrub:parameter-range");
});

test("retained movie trim preserves implicit-end semantics while committing one atomic pair", () => {
  let committed = null;
  const controller = createInputController({
    store: {
      setComponentValues(entries, metadata) {
        committed = { entries, metadata };
        return true;
      },
    },
    getState: () => createInitialState(),
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "component",
    refreshSelectedMappingProjection() {},
  });
  const target = {
    startPath: "nodes.groups.0.nodes.1.configuration.source.params.start",
    endPath: "nodes.groups.0.nodes.1.configuration.source.params.end",
    implicitEnd: true,
  };
  assert.equal(controller.updatePersistentVideoTrim(target, { min: 1.25, max: 8.5 }, "min", { phase: "change" }), true);
  assert.deepEqual(committed.entries.map((entry) => entry.value), [1.25, 0]);
  assert.equal(committed.metadata.reason, "scrub:video-trim");
  assert.equal(controller.updatePersistentVideoTrim(target, { min: 1.25, max: 8.5 }, "max", { phase: "commit" }), true);
  assert.deepEqual(committed.entries.map((entry) => entry.value), [1.25, 8.5]);
  assert.equal(committed.metadata.reason, "update:video-trim");
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
  const range = parameterUiNodes({
    id: "hue-range",
    controls: [{
      id: "hue",
      label: "Hue",
      kind: "range",
      value: { min: 200, max: 260 },
      min: 0,
      max: 360,
      step: 1,
      rangeKind: "hue",
      display: "degrees",
    }],
  }).find((node) => node.id === "hue");
  const rangeNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/control-nodes.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.equal(range.type, RangeUiNode.id);
  assert.deepEqual(range.inputs.value, { min: 200, max: 260 });
  assert.equal(range.inputs.display, "degrees");
  assert.equal(range.inputs.rangeKind, "hue");
  assert.ok(rangeNodeSource.includes("createRangeControlInstance"));
  assert.ok(rangeNodeSource.includes("if (min > max)"));
  assert.ok(rangeNodeSource.includes('root.style.setProperty("--ui-range-start"'));
  assert.ok(styleSource.includes('[data-ui-range-kind="hue"]'));
});

test("component panel exposes frame shape and relative resolution controls", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const choiceSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/choice-group-node.js", import.meta.url), "utf8");

  assert.ok(componentSource.includes('stateAddress: `${base}.frameShape`'));
  assert.ok(componentSource.includes('stateAddress: `${base}.resolutionScale`'));
  assert.ok(componentSource.includes('{ id: "landscape", label: "Landscape"'));
  assert.ok(componentSource.includes('{ id: "portrait", label: "Portrait"'));
  assert.ok(componentSource.includes('{ id: "square", label: "Square"'));
  assert.ok(componentSource.includes("[0.5, 1, 2].map"));
  assert.ok(!componentSource.includes("component-frame-summary"));
  assert.match(choiceSource, /export const ChoiceGroupNode = defineUiNode/);
});

test("control surfaces share one flat section module and concentric corner tokens", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const pickerNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");
  const baseStyleSource = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();
  const uiThemeSource = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  const catalogCompositionSource = readFileSync(new URL("../js/libraries/ui-engine/compositions/thumbnail-catalog.js", import.meta.url), "utf8");

  assert.ok(catalogCompositionSource.includes('presentation: "rail-catalog"'));
  assert.ok(controllerSource.includes('presentation: "artifact-inspector"'));
  assert.doesNotMatch(pickerSource, /class="ui-section element-section"|<section|<button/);
  assert.match(pickerNodeSource, /element\.dataset\.uiCatalogSection = section\.id/);
  assert.match(baseStyleSource, /\.ui-node-catalog-body > section > header/);
  assert.match(baseStyleSource, /\.ui-node-catalog-panel \{[\s\S]*?border-radius: var\(--ui-radius\);/);
  assert.ok(settingsSource.includes('type: "panel"'));
  assert.doesNotMatch(settingsSource, /className|class="|<section|<button/);
  assert.ok(styleSource.includes("--section-inset: 6px;"));
  assert.ok(styleSource.includes("--radius-section: 12px;"));
  assert.ok(styleSource.includes("--radius-section-inner: 6px;"));
  assert.match(styleSource, /\.ui-section \{[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section\);/);
  assert.match(styleSource, /\.ui-section-header,[\s\S]*?min-height: 30px;[\s\S]*?padding: 4px 8px;/);
  assert.doesNotMatch(styleSource, /\.section-toolbar/);
  assert.match(uiThemeSource, /data-ui-presentation="component-quick-toolbar"[\s\S]*?border-radius: var\(--ui-radius\);/);
  assert.match(uiThemeSource, /data-ui-presentation="component-quick-toolbar"[\s\S]*?flex-wrap: nowrap;/);
  assert.match(uiThemeSource, /data-ui-presentation="component-quick-toolbar"[\s\S]*?\.ui-node-layout-slot \{[\s\S]*?flex: 0 0 auto;/);
  assert.ok(!styleSource.includes(".component-frame-summary"));
  assert.match(styleSource, /\.text-list-item \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.ok(componentSource.includes('presentation: "component-quick-toolbar"'));
  assert.match(componentSource, /id: "frame-shape"[\s\S]*?iconOnly: true/);
  assert.doesNotMatch(componentSource, /class="section-toolbar component-quick-toolbar"/);
});

test("topbar identity stays neutral until interaction", () => {
  const styleSource = vjStyleSource();

  assert.match(styleSource, /\.brand-mark \{[\s\S]*?background: var\(--panel-soft\);[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.project-button \.material-symbols-rounded \{[\s\S]*?color: var\(--muted\);/);
});

test("collection workspaces keep controls fixed and scroll only their list bodies", () => {
  const styleSource = vjStyleSource();
  const workspaceShellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");

  assert.ok(workspaceShellSource.includes("refs.workspace.dataset.workspace"));
  assert.match(styleSource, /\.studio-layout:is\(\[data-workspace="component"\][\s\S]*?\.project-rail \{[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.studio-layout:is\(\[data-workspace="component"\][\s\S]*?\.project-rail \{[\s\S]*?padding-right: 0;[\s\S]*?scrollbar-gutter: auto;/);
  assert.match(styleSource, /> \.rail-list-section \{[\s\S]*?flex: 1 1 0;[\s\S]*?min-height: 0;/);
  assert.match(programSource, /liveRailUiGraph[\s\S]*?title: "Sources"[\s\S]*?id: "live-source-scenes"[\s\S]*?id: "live-source-components"/);
  assert.match(programSource, /sceneRailUiModel[\s\S]*?title: "Surfaces"[\s\S]*?presentation: "scene-surface-collection"/);
  assert.doesNotMatch(styleSource, /\.project-rail\[data-workspace="(?:mapping|scene)"\] > \.mapping-surface-rail-section/);
  assert.match(styleSource, /\.rail-list-section\.is-empty \{[\s\S]*?flex: 0 0 auto;/);
  assert.match(styleSource, /\.rail-list-section > \.rail-scroll-list \{[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(styleSource, /\.ui-node-list\[data-ui-presentation="thumbnail-grid"\] \{[\s\S]*?align-content: start;[\s\S]*?overflow-y: auto;/);
  assert.match(styleSource, /\.studio-layout:is\(\[data-workspace="component"\][\s\S]*?\.studio-inspector \{[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.studio-layout\[data-workspace="scene"\] \.studio-inspector \.scene-surface-inspector-host,[\s\S]*?height: auto;[\s\S]*?flex: 0 0 auto;[\s\S]*?grid-template-rows: auto auto;/);
  assert.doesNotMatch(styleSource, /data-scene-surface-inspector-host/);
  assert.match(styleSource, /\.component-chain-list,[\s\S]*?align-content: start;[\s\S]*?overflow-y: auto;/);
  const catalogCompositionSource = readFileSync(new URL("../js/libraries/ui-engine/compositions/thumbnail-catalog.js", import.meta.url), "utf8");
  assert.match(catalogCompositionSource, /itemNode: "thumbnail-button"/);
  assert.match(catalogCompositionSource, /listPresentation: "thumbnail-grid"/);
  assert.match(programSource, /createThumbnailCatalogGraphNode\(\{[\s\S]*?id: "live-source-collection"/);
  assert.match(programSource, /listPresentation: "mapping-list"/);
});

test("workspace hierarchies own separate retained inspector instances", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.equal(artifactInspectorScope("component"), "vj1.control.component-artifact-inspector");
  assert.equal(artifactInspectorScope("scene"), "vj1.control.scene-artifact-inspector");
  assert.equal(artifactInspectorScope("live"), "vj1.control.live-artifact-inspector");
  assert.equal(artifactInspectorScope("nodes"), "vj1.control.nodes-artifact-inspector");
  assert.equal(artifactInspectorScope("mapping"), "");
  assert.match(controllerSource, /deactivateArtifactInspectorScopes\(artifactInspectorScope\(workspace\)\)/);
  assert.match(controllerSource, /stateAddress: `workspaces\/\$\{workspace\}\/inspector`/);
  assert.doesNotMatch(controllerSource, /scope: "vj1\.control\.artifact-inspector"/);
});

test("selection rerenders preserve every keyed catalog and chain viewport", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const pickerNodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const tabsSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/container-nodes.js", import.meta.url), "utf8");
  const listSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/list-node.js", import.meta.url), "utf8");
  const scrollSource = readFileSync(new URL("../js/libraries/ui-engine/scroll-state.js", import.meta.url), "utf8");
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const elements = componentElementsUiModel(component, state);

  assert.match(programSource, /sceneRailUiModel[\s\S]*?\/scene-catalog`[\s\S]*?\/mappings\/\$\{encodeURIComponent\(selectedMappingId\)\}\/surfaces`/);
  assert.match(programSource, /mappingRailUiGraph[\s\S]*?\/mapping-catalog`[\s\S]*?\/mapping-surfaces`/);
  assert.match(programSource, /componentCatalogUiModel[\s\S]*?component-catalog/);
  assert.match(readFileSync(new URL("../js/libraries/ui-engine/nodes/collection-node.js", import.meta.url), "utf8"), /stateAddress: `\$\{baseAddress\}\/list`/);
  assert.match(programSource, /liveRailUiGraph[\s\S]*?\/live-sources`/);
  assert.equal(elements.stateAddress.endsWith(`/components/${component.id}/elements`), true);
  assert.equal(elements.selectedId, state.ui.selectedChainItemId || "");
  assert.match(listSource, /const scrollAddress = `\$\{baseAddress\}\/scroll`/);
  assert.match(listSource, /createRetainedScrollController/);
  assert.match(listSource, /reconcileRetainedChildren\(root, orderedHosts\)/);
  assert.match(tabsSource, /reconcileRetainedChildren\(content, descriptors\.map/);
  assert.match(scrollSource, /state\.get\(address/);
  assert.match(scrollSource, /state\.set\(address/);
  assert.match(scrollSource, /function onScroll\(\) \{[\s\S]*?commit\(\);/);
  assert.doesNotMatch(componentSource, /elementListTemplate\(/);
  assert.ok(programSource.includes('scrollKey: `${live ? "live-" : ""}chain-params:'));
  assert.match(tabsSource, /createRetainedScrollController/);
  assert.match(pickerNodeSource, /createRetainedScrollController/);
  assert.match(programSource, /liveComponentViewUiGraph[\s\S]*?stateAddress: `\$\{model\?\.stateAddress \|\| "live\/component\/view"\}\/elements`/);
  assert.match(programSource, /id: "live-component-elements"[\s\S]*?type: ListNode\.id/);
  assert.match(programSource, /liveProjectionRailUiGraph[\s\S]*?stateAddress: "live\/projection\/outputs"/);
  assert.ok(controllerSource.includes('componentStateAddress: `live-scene-components/${sourceTarget?.id || "none"}`'));
  assert.ok(pickerSource.includes('stateAddress: allowedCategory ? `picker/source/${allowedCategory}` : "picker/source/all"'));
  assert.ok(pickerSource.includes('stateAddress: `picker/element/${encodeURIComponent(picker.componentId || "unknown")}`'));
  assert.match(pickerNodeSource, /const scrollAddress = `\$\{baseAddress\}\/scroll`/);
  assert.match(pickerNodeSource, /address: scrollAddress/);
  assert.match(pickerNodeSource, /scroll\.attach\(body\)/);
  assert.match(scrollSource, /state\.set\(address, normalized, lifetime\)/);
  assert.match(scrollSource, /state\.get\(address, \{ top: 0, left: 0 \}, lifetime\)/);
  assert.doesNotMatch(controllerSource, /innerHTML|rememberScrollPositions|rememberViewControlStates/);
});

test("collections and lists own retained search selection and scroll state", () => {
  assert.equal(CollectionNode.id, "core.ui.collection");
  assert.ok(CollectionNode.capabilities.includes("scroll-restoration"));
  assert.ok(CollectionNode.capabilities.includes("searchable-collection"));
  assert.equal(ListNode.id, "core.ui.list");
  const listState = ListNode.metadata.uiNode.state;
  assert.ok(listState.some((entry) => entry.id === "scroll"));
  assert.ok(listState.some((entry) => entry.id === "selectedId"));
});

test("every workspace rail uses the same constrained first-column module", () => {
  const styleSource = vjStyleSource();
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");

  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styleSource, /\.rail-section \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(controllerSource, /componentCatalogUiModel[\s\S]*?items: componentCatalogListItems/);
  assert.match(readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8"), /addLabel: "Add component"/);
  assert.match(programSource, /sceneRailUiModel[\s\S]*?title: "Scenes"[\s\S]*?addLabel: "Add scene"/);
  assert.match(programSource, /mappingRailUiGraph[\s\S]*?title: "Mappings"[\s\S]*?label: "Add mapping"/);
  assert.match(programSource, /sceneRailUiModel[\s\S]*?title: "Surfaces"[\s\S]*?label: "Add surface"/);
  assert.match(programSource, /mappingRailUiGraph[\s\S]*?id: "mapping-name"[\s\S]*?stateAddress: `mappings\.\$\{mappingIndex\}\.name`[\s\S]*?id: "mapping-test-pattern"[\s\S]*?stateAddress: "ui\.mappingTestPattern"/);
  assert.match(styleSource, /\.mapping-test-pattern-button \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(styleSource, /\.ui-node-section-header-actions > button \{[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
  assert.doesNotMatch(styleSource, /\.capture-row/);
});

test("render-chain and Surface rows share the compact list density", () => {
  const styleSource = vjStyleSource();
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const sceneSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const elements = componentElementsUiModel(component, state);

  assert.match(styleSource, /\.component-chain-list \{[\s\S]*?gap: 3px;[\s\S]*?align-content: start;/);
  assert.match(styleSource, /:root \{[\s\S]*?--text-list-row-height: 34px;[\s\S]*?--text-list-control-height: 28px;/);
  assert.match(styleSource, /\.text-list-item \{[\s\S]*?min-height: var\(--text-list-row-height\);/);
  assert.match(styleSource, /\.text-list-item \.enable-toggle,[\s\S]*?height: var\(--text-list-control-height\);[\s\S]*?min-height: var\(--text-list-control-height\);/);
  assert.match(styleSource, /\.compact-list-row \{[\s\S]*?--text-list-leading-size: 27px;/);
  assert.doesNotMatch(styleSource, /\.text-list-item \{[^}]*min-height: 42px;/);
  assert.doesNotMatch(styleSource, /\.compact-list-row \{[^}]*min-height: 34px;/);
  assert.ok(elements.items.every((item) => ["element-row", "group-element-row"].includes(item.presentation)));
  assert.ok(elements.items.every((item) => !Object.hasOwn(item, "meta")));
  assert.match(programSource, /surfaceListItems[\s\S]*?presentation: direct \? "direct-surface-row" : "surface-row"/);
  assert.match(programSource, /sceneSurfaceListItems\(state\)[\s\S]*?state\.surfaces[\s\S]*?reorderable: true/);
  assert.match(styleSource, /\.ui-node-list-drop-zone \{[\s\S]*?min-height: 14px;/);
});

test("all workspaces share the compact column-to-preview gap", () => {
  const styleSource = vjStyleSource();

  assert.match(styleSource, /:root \{[\s\S]*?--workspace-content-gap: 6px;/);
  assert.match(styleSource, /:root \{[\s\S]*?--workspace-column-gap: 4px;/);
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?column-gap: var\(--workspace-column-gap\);[\s\S]*?row-gap: 12px;[\s\S]*?padding: var\(--workspace-content-gap\) 12px 12px;/);
  assert.doesNotMatch(styleSource, /\.studio-main \{[^}]*margin-left:/);
});

test("editable element names live in their section headers beside the icon", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const headerSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/section-header-node.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();
  const uiThemeSource = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");

  assert.doesNotMatch(controllerSource, /titleInputTemplate|editableSectionTitleTemplate|section-title-input/);
  assert.match(headerSource, /export const SectionHeaderNode = defineUiNode/);
  assert.ok(!controllerSource.includes('class="sculpt-head"'));
  assert.ok(settingsSource.includes("titleBinding"));
  assert.ok(settingsSource.includes('action: "settings.change"'));
  assert.doesNotMatch(settingsSource, /className|class="|<label|<input/);
  assert.doesNotMatch(styleSource, /section-title-input/);
  assert.match(styleSource, /\.ui-section-header,[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow: hidden;/);
  assert.match(uiThemeSource, /\.ui-node-section-header \.ui-node-control input,[\s\S]*?color: inherit;[\s\S]*?font: inherit;[\s\S]*?letter-spacing: inherit;[\s\S]*?text-transform: inherit;/);
});

test("thumbnail list items share a connected image and bottom label bar", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const thumbnailSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/thumbnail-button-node.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.equal(ThumbnailButtonNode.id, "core.ui.thumbnail-button");
  assert.match(thumbnailSource, /ui-node-thumbnail-media/);
  assert.match(thumbnailSource, /ui-node-thumbnail-copy/);
  assert.match(styleSource, /\.ui-node-thumbnail-media \{[\s\S]*?border-radius: var\(--radius-section-inner,[\s\S]*?0 0;/);
  assert.match(styleSource, /\.ui-node-thumbnail-copy \{[\s\S]*?min-height: 26px;[\s\S]*?padding: 4px 8px;[\s\S]*?border-radius: 0 0 var\(--radius-section-inner,[\s\S]*?background: #000;/);
  assert.match(styleSource, /\.ui-node-thumbnail-label \{[\s\S]*?color: var\(--ui-muted\);/);
  assert.match(styleSource, /\.ui-node-thumbnail-label-icon \{[\s\S]*?font-size: 12px;/);
  assert.match(styleSource, /\.ui-node-thumbnail-button\.is-selected :is\(\.ui-node-thumbnail-label, \.ui-node-thumbnail-label-icon\) \{[\s\S]*?color: var\(--ui-text\);/);
  assert.match(styleSource, /\.ui-node-thumbnail-action\[data-ui-action-variant="remove"\] \{[\s\S]*?left: 3px;[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(styleSource, /\.ui-node-thumbnail-action \{[\s\S]*?top: 3px;[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
  assert.doesNotMatch(styleSource, /--thumbnail-remove-hover-delay/);
  assert.match(styleSource, /\.ui-node-thumbnail-item\.has-revealed-destructive-actions \.ui-node-thumbnail-action\[data-ui-action-variant="remove"\]:not\(:disabled\),[\s\S]*?\.ui-node-thumbnail-action\[data-ui-action-variant="remove"\]:focus-visible \{[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/);
  assert.match(styleSource, /\.ui-node-thumbnail-action\[data-ui-action-variant="remove"\]:hover:not\(:disabled\) \{[\s\S]*?color: var\(--danger/);
  assert.doesNotMatch(styleSource, /\.component-card-(?:row|remove)/);
});

test("ordinary sliders use the compact track and square active handle from the UI system", () => {
  const styleSource = vjStyleSource();

  assert.ok(styleSource.includes("--accent-strong: #8a3d00;"));
  assert.ok(styleSource.includes("--slider-track: #454545;"));
  assert.ok(styleSource.includes("--slider-thumb: #555555;"));
  assert.ok(styleSource.includes("--slider-thumb-hover: #9a9997;"));
  assert.ok(styleSource.includes("--slider-text: #777674;"));
  assert.match(styleSource, /\.range-field > span,[\s\S]*?\.field:has\(> \.param-select\) > span \{[\s\S]*?color: var\(--slider-text\);/);
  assert.match(styleSource, /\.range-value \{[\s\S]*?color: var\(--slider-text\);/);
  assert.ok(styleSource.includes("--slider-height: 18px;"));
  assert.match(styleSource, /input\[type="range"\] \{[\s\S]*?height: 20px;/);
  assert.match(styleSource, /\.ui-node-slider\[data-ui-presentation="parameter"\] > input\[type="range"\]::\-webkit-slider-thumb,[\s\S]*?width: var\(--ui-parameter-height\);[\s\S]*?height: var\(--ui-parameter-height\);[\s\S]*?border-radius: 0;[\s\S]*?background: var\(--ui-parameter-thumb\);/);
  assert.match(styleSource, /\.ui-node-slider\[data-ui-presentation="parameter"\] > input\[type="range"\]::\-webkit-slider-runnable-track,[\s\S]*?height: var\(--ui-parameter-height\);[\s\S]*?border-radius: var\(--ui-radius\);[\s\S]*?background: var\(--ui-parameter-track\);/);
  assert.match(styleSource, /:is\(\.param-range-track, \.ui-node-range-track\) \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /\.ui-node-slider\[data-ui-presentation="parameter"\] > input\[type="range"\]:hover::\-webkit-slider-thumb,[\s\S]*?background: var\(--ui-parameter-thumb-hover\);/);
});

test("movie trim keeps two handles while sharing the ordinary slider geometry", () => {
  const styleSource = vjStyleSource();
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");

  assert.doesNotMatch(styleSource, /\.video-trim-control|\.ui-video-controls-layout/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] > \.ui-node-range-labels \{[\s\S]*?color: var\(--ui-parameter-value\);[\s\S]*?text-transform: none;/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] > \.ui-node-range-slider > \.ui-node-range-track \{[\s\S]*?height: var\(--ui-parameter-height\);[\s\S]*?border: 0;[\s\S]*?box-shadow: none;/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\]\[data-ui-range-kind="plain"\][\s\S]*?var\(--ui-parameter-thumb-hover\) var\(--ui-range-start\) var\(--ui-range-end\)/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] > \.ui-node-range-slider > input\[type="range"\] \{[\s\S]*?height: 20px;[\s\S]*?min-height: 0;[\s\S]*?border: 0;[\s\S]*?outline: none;/);
  assert.match(styleSource, /\.ui-node-range\[data-ui-presentation="parameter"\] > \.ui-node-range-slider > input\[type="range"\]::\-webkit-slider-thumb \{[\s\S]*?width: var\(--ui-parameter-height\);[\s\S]*?height: var\(--ui-parameter-height\);[\s\S]*?margin-top: 0;[\s\S]*?border-radius: 0;/);
  assert.ok(!componentSource.includes("data-chain-video-controls-ui"));
  assert.ok(componentSource.includes("contentView.videoModel = videoModel"));
  assert.ok(!componentSource.includes("data-video-trim-input"));
  assert.ok(!controllerSource.includes("bindVideoTrimControl"));
  assert.ok(!controllerSource.includes("updateVideoTrimFromInputs"));
});

test("Mapping surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(!source.includes("Scene assignment"));
  assert.ok(source.includes('const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"]'));
  assert.ok(source.includes("Projection fit"));
  assert.ok(source.includes("mappingBase}.projectionFit"));
  assert.ok(source.includes('type: SliderUiNode.id'));
  assert.ok(source.includes('address: `${mappingBase}.feather`'));
  assert.ok(source.includes('type: SelectUiNode.id'));
  assert.ok(!source.includes("componentAssignmentTemplate"));
  assert.ok(source.includes("mappingSurfaceInspectorUiGraph"));
});

test("component catalogs expose shared local filtering", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const style = vjStyleSource();
  const collection = readFileSync(new URL("../js/libraries/ui-engine/nodes/collection-node.js", import.meta.url), "utf8");
  const program = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.match(program, /componentCatalogUiModel[\s\S]*?searchPlaceholder: "Filter components"/);
  assert.match(collection, /state\.set\(searchAddress, value/);
  assert.match(collection, /list\.update\(listInputs\(inputs, value\)\)/);
  assert.match(collection, /function listInputs\(inputs, query\)[\s\S]*?filteredItems\(inputs\.items, query\)/);
  assert.doesNotMatch(source, /componentToolsTemplate/);
  assert.ok(style.includes(".component-collection .ui-node-collection-search input"));
});

test("Component and Scene catalogs delegate card DOM and actions to ListNode", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const [item] = componentCatalogListItems([component], state);
  assert.equal(item.id, component.id);
  assert.equal(item.thumbnail.key, `${component.id}:`);
  assert.equal(Object.hasOwn(item, "className"), false);
  assert.deepEqual(item.actions.map((action) => action.id), ["marker", "remove"]);

  const viewSource = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const collectionSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/collection-node.js", import.meta.url), "utf8");
  assert.match(programSource, /componentCatalogUiModel[\s\S]*?thumbnailCatalogUiModel/);
  assert.match(collectionSource, /createListNodeInstance/);
  assert.doesNotMatch(viewSource, /componentToolsTemplate|component-catalog-list/);
  assert.match(programSource, /sceneRailUiModel[\s\S]*?thumbnailCatalogUiModel\([\s\S]*?id: "scenes"/);
  assert.ok(!viewSource.includes("function componentPillTemplate"));
  assert.ok(!viewSource.includes("data-select-component"));
  assert.ok(programSource.includes('select: "component.select"'));
  assert.ok(programSource.includes('itemAction: "component.item-action"'));
});

test("component catalog search includes nested visual and media identities", () => {
  const component = {
    id: "component-1",
    name: "Portrait",
    type: "chain",
    chain: [
      {
        id: "finishing",
        kind: "group",
        name: "Finishing",
        chain: [
          { id: "blur", kind: "effect", name: "Soft Blur", componentId: "blur" },
          {
            id: "media",
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
  };
  const state = appNodePackage.prepareProjectState({
    ...createInitialState(),
    components: [component],
    nodes: {},
  });
  const search = componentCatalogSearchText(state.components[0], state);

  assert.match(search, /portrait/);
  assert.match(search, /soft blur/);
  assert.match(search, /blur/);
  assert.match(search, /heart\.png/);
  assert.match(search, /mediaimage/);
});

test("the primary workspace is architecturally named Component", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  assert.ok(controller.includes('{ id: "component", label: "Components"'));
  assert.ok(!controller.includes('id: "compose"'));
  assert.ok(controller.includes('workspace === "component"'));
  assert.ok(controller.includes("componentCatalogUiModel"));
  assert.ok(!controller.includes("componentToolsTemplate"));
  assert.ok(!controller.includes("compositionToolsTemplate"));
});

test("component catalogs expose stable per-view sorting modes", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const source = controllerSource + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(source.includes("state.ui?.catalogSortModes?.[scope]"));
  assert.ok(source.includes("ui.catalogSortModes ||= {}"));
  for (const scope of ["component", "scene", "mapping", "live"]) {
    assert.ok(source.includes(`ui.catalogSortModes.${scope} = mode`));
  }
  assert.match(source, /change\.effects\.lifecycle\.project === "restore"[\s\S]*?invalidateCatalogOrder\(\)/);
  assert.ok(source.includes('catalogSortMode(state, "component")'));
  assert.ok(source.includes('catalogSortMode(state, "scene")'));
  assert.ok(source.includes('catalogSortMode(state, "mapping")'));
  assert.match(source, /scope === "mapping"\s*\? state\.mappings \|\| \[\]/);
  assert.match(source, /scope === "source"\s*\? sceneSourceNodes\(state\)/);
  assert.match(source, /mappingRailUiGraph[\s\S]*?searchPlaceholder: "Filter mappings"/);
  assert.ok(source.includes("if (viewKey === activeCatalogViewKey) return"));
  assert.ok(source.includes("captureCatalogOrder(workspace, state)"));
  assert.match(controllerSource, /import \{[^}]*sceneComponents[^}]*\} from "\.\/control-selectors\.js/);
  assert.ok(programSource.includes("(activeIndex + 1) % modes.length"));
  assert.ok(programSource.includes('id: `sort:${nextSortMode}`'));
  assert.ok(programSource.includes('label: `Sorted by ${sortMode}; click to sort by ${nextSortMode}`'));
  assert.doesNotMatch(programSource, /data-catalog-sort|data-cycle-catalog-marker|<button/);
  assert.ok(source.includes('["recent", "marker", "name", "created"]'));
  assert.ok(source.includes('catalogItemsInSnapshot("scene", sceneComponents(state))'));
  assert.match(source, /sceneRailUiGraph[\s\S]*?searchPlaceholder: "Filter scenes"/);
  assert.deepEqual(
    ["recent", "marker", "name", "created"].map(catalogSortIcon),
    ["history", "keep", "sort_by_alpha", "add_circle"],
  );
  assert.equal(catalogSortIcon("unknown"), "history");
});

test("Live target cards share reset for retained temporary overrides", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  assert.ok(sceneLiveSource.includes('id: "reset"'));
  assert.ok(sceneLiveSource.includes("liveSourceHasParameterDiffs"));
  assert.ok(source.includes("store.resetLiveTarget"));
  assert.ok(source.includes("store.resetLiveParameters"));
});

test("semantic Live UI commands write the one sparse diff bank and render-patch path", () => {
  const state = createInitialState();
  const component = state.components[0];
  const nodeId = component.chain[0].id;
  state.ui.live.selectedComponentId = component.id;
  let updateMetadata = null;
  const store = {
    updateLive(recipe, metadata) {
      recipe(state);
      updateMetadata = metadata;
    },
  };
  const controller = createInputController({
    store,
    getState: () => state,
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "live",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updateLiveValue({
    componentId: component.id,
    nodeId,
    path: "transform.scale",
  }, 1.5, { phase: "change" }), true);
  assert.equal(state.ui.live.parameterDiffs[component.id][component.id].nodes[nodeId].transform.scale, 1.5);
  assert.equal(updateMetadata.reason, "scrub:live");
  assert.equal(updateMetadata.livePatches[0].nodeId, nodeId);
  assert.equal(updateMetadata.livePatches[0].path, "transform.scale");
  assert.equal(updateMetadata.livePatches[0].interpolation, "immediate");
});

test("retained Live Boundary scale writes one sparse diff with canonical width and height", () => {
  const state = createInitialState();
  const component = state.components[0];
  const nodeId = component.chain[0].id;
  state.ui.live.selectedComponentId = component.id;
  let updateMetadata = null;
  const controller = createInputController({
    store: {
      updateLive(recipe, metadata) {
        recipe(state);
        updateMetadata = metadata;
      },
    },
    getState: () => state,
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "live",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updateLiveBoundaryScale({
    componentId: component.id,
    nodeId,
    path: "boundary.scale",
    width: 0.8,
    height: 0.4,
  }, Math.sqrt(0.32) * 2, { phase: "change" }), true);
  const boundary = state.ui.live.parameterDiffs[component.id][component.id].nodes[nodeId].boundary;
  assert.ok(Math.abs(boundary.width - 1.6) < 1e-12);
  assert.ok(Math.abs(boundary.height - 0.8) < 1e-12);
  assert.equal(updateMetadata.reason, "scrub:live");
  assert.deepEqual(updateMetadata.livePatches.map((patch) => patch.path), [
    "boundary.width",
    "boundary.height",
  ]);
  assert.ok(updateMetadata.livePatches.every((patch) => patch.interpolation === "immediate"));
});

test("retained Live paired ranges write both endpoints into the one sparse diff bank", () => {
  const state = createInitialState();
  const component = state.components[0];
  const nodeId = component.chain[0].id;
  state.ui.live.selectedComponentId = component.id;
  let updateMetadata = null;
  const controller = createInputController({
    store: {
      updateLive(recipe, metadata) {
        recipe(state);
        updateMetadata = metadata;
      },
    },
    getState: () => state,
    modals: {},
    bindComponentFilters() {},
    bindCatalogSortControls() {},
    resetProjectMapping() {},
    currentWorkspace: () => "live",
    refreshSelectedMappingProjection() {},
  });
  assert.equal(controller.updateLiveRange({
    componentId: component.id,
    nodeId,
    minPath: "params.hueMin",
    maxPath: "params.hueMax",
  }, { min: 210, max: 275 }, { phase: "change" }), true);
  const params = state.ui.live.parameterDiffs[component.id][component.id].nodes[nodeId].params;
  assert.deepEqual({ hueMin: params.hueMin, hueMax: params.hueMax }, { hueMin: 210, hueMax: 275 });
  assert.equal(updateMetadata.reason, "scrub:live-range");
  assert.deepEqual(updateMetadata.livePatches.map((patch) => patch.path), ["params.hueMin", "params.hueMax"]);
  assert.ok(updateMetadata.livePatches.every((patch) => patch.interpolation === "immediate"));
});

test("Live scenes expose separate scene-transition and parameter-fade durations", () => {
  const source = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const models = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('address: "ui.live.transitionDuration"'));
  assert.ok(source.includes('address: "ui.live.paramFadeDuration"'));
  assert.ok(source.includes('address: "ui.live.transitionId"'));
  assert.ok(source.includes("transitionUiControlDescriptors"));
  assert.ok(source.includes("createTransitionCatalog("));
  assert.ok(source.includes("DefaultBuiltInTransition.id"));
  assert.ok(!source.includes("DissolveTransitionKernel"));
  assert.ok(source.includes("min: 0, max: 10, step: 0.1"));
  assert.ok(models.includes("transitionDuration: startup ? 1.2 : 0"));
  assert.ok(models.includes("paramFadeDuration: startup ? 0.9 : 0"));
  assert.ok(source.indexOf("live-param-fade-duration") > source.indexOf("live-transition-duration"));
});

test("Live timing gestures stay on the UI branch and persist only their commit", () => {
  const state = createInitialState();
  const changes = [];
  const store = {
    updateUi(recipe, change) {
      recipe(state.ui);
      changes.push(change);
    },
    update() {
      assert.fail("Live timing preferences must not enter the project render transaction");
    },
  };
  const controller = createControlCommandController({
    store,
    getState: () => state,
    currentWorkspace: () => "live",
    refreshSelectedMappingProjection() {},
  });

  assert.equal(liveTimingPreferencePath("ui.live.transitionDuration"), true);
  assert.equal(liveTimingPreferencePath("ui.live.transitionParameters.softness"), true);
  assert.equal(liveTimingPreferencePath("components.0.opacity"), false);
  controller.updatePersistentValue("ui.live.transitionDuration", 2.5, { phase: "change" });
  controller.updatePersistentValue("ui.live.transitionDuration", 2.5, { phase: "commit" });

  assert.equal(state.ui.live.transitionDuration, 2.5);
  assert.equal(changes[0].effects.preview.mode, "controls-only");
  assert.equal(changes[0].effects.output.mode, "none");
  assert.equal(changes[0].effects.persistence.mode, "none");
  assert.equal(changes[1].effects.persistence.mode, "autosave");
  assert.equal(changes[1].effects.control, null);
});

test("Live exposes a phase-continuous global visual time stretch", () => {
  const source = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");

  assert.match(source, /liveRailUiGraph[\s\S]*?title: "Sources"/);
  assert.match(source, /liveRailUiGraph[\s\S]*?createThumbnailCatalogGraphNode\(\{[\s\S]*?id: "live-source-collection"/);
  assert.match(source, /id: "live-source-scenes"[\s\S]*?id: "live-source-components"[\s\S]*?id: "live-timing-panel"[\s\S]*?id: "live-reset-session"/);
  assert.ok(source.includes("Time stretch"));
  assert.ok(source.includes('address: "global.timeStretch"'));
  assert.ok(source.includes("min: -4"));
  assert.ok(source.includes('kind: "power"'));
  assert.ok(source.includes("zeroAtMin: true"));
});

test("embedded preview retargets resize observation after workspace DOM replacement", () => {
  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../js/output/presentation-host-lifecycle.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("presentationHost.observe(stage)"));
  assert.ok(lifecycle.includes("observer?.unobserve?.(observedTarget)"));
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

test("workspace preview mode changes retain compiled programs and target only destination topology", () => {
  assert.equal(previewModeChangeActivation("live", "component", "ui"), "ui");
  assert.equal(previewModeChangeActivation("component", "live", "ui"), "projection");
  assert.equal(previewModeChangeActivation("component", "preview", "ui"), "mapping");
  assert.equal(previewModeChangeActivation("live", "component", "full"), "full");
  assert.equal(previewModeChangeActivation("component", "component", "ui"), "ui");

  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.match(
    source,
    /const resolvedActivation = previewModeChangeActivation\(pendingMode, mode, activation\)[\s\S]*?resizeToStage\(\{[\s\S]*?activation: resolvedActivation[\s\S]*?activateRendererState\(previewSizedState\(\), resolvedActivation\)/,
  );
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
    /setWorkspace\(workspace\) \{[\s\S]*?const draft = \{\s*\.\.\.state,\s*ui: clone\(state\.ui\),\s*global: \{ \.\.\.state\.global \},[\s\S]*?state = draft;[\s\S]*?emit\(\{ reason: "workspace", command: \{ domain: "ui" \} \}\);/,
  );
  assert.doesNotMatch(
    appStateSource,
    /setWorkspace\(workspace\) \{\s*update\(/,
  );
});

test("same-frame workspace navigation cannot be narrowed into a mixed editor projection", () => {
  const workspace = {
    force: true,
    reason: "workspace",
    change: { command: { topic: "workspace" } },
    projection: "shell",
    invalidation: null,
    previewPatched: false,
  };
  const selection = {
    force: true,
    reason: "select-component",
    change: { command: { topic: "select-component" } },
    projection: "control-invalidation",
    invalidation: {
      regions: ["project-rail", "inspector"],
      preview: "render",
    },
    previewPatched: false,
  };

  assert.deepEqual(mergeControlRenderRequests(workspace, selection), workspace);
  assert.deepEqual(
    mergeControlRenderRequests(selection, workspace),
    workspace,
    "a full workspace projection also supersedes an earlier targeted selection",
  );
});

test("same-frame targeted control work merges without forcing a full shell render", () => {
  const first = {
    force: true,
    reason: "select-component",
    change: { command: { topic: "select-component" } },
    projection: "control-invalidation",
    invalidation: { regions: ["project-rail"], preview: "render" },
    previewPatched: false,
  };
  const second = {
    force: false,
    reason: "select-chain-item",
    change: { command: { topic: "select-chain-item" } },
    projection: "control-invalidation",
    invalidation: { regions: ["inspector"], preview: "ui" },
    previewPatched: true,
  };

  assert.deepEqual(mergeControlRenderRequests(first, second), {
    ...second,
    force: true,
    previewPatched: false,
    invalidation: {
      regions: ["project-rail", "inspector"],
      preview: "render",
    },
  });
});

test("different same-frame targeted projections promote to one coherent shell render", () => {
  const liveProgram = {
    force: true,
    reason: "live:target",
    projection: "live-program",
    previewPatched: false,
  };
  const selection = {
    force: true,
    reason: "select-component",
    projection: "control-invalidation",
    invalidation: { regions: ["project-rail"] },
    previewPatched: false,
  };

  assert.equal(mergeControlRenderRequests(liveProgram, selection).projection, "shell");
});

test("streamed derived thumbnails patch their owned images without rebuilding Preview or the shell", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const thumbnailNode = readFileSync(new URL("../js/libraries/ui-engine/nodes/thumbnail-button-node.js", import.meta.url), "utf8");
  assert.match(
    controllerSource,
    /change\.effects\.preview\.mode === "thumbnails"[\s\S]*?retainedUi\.broadcast\("updateMedia", change\.projection\.entries\);[\s\S]*?return;/,
  );
  assert.doesNotMatch(controllerSource, /querySelector|createElement|replaceChildren/);
  assert.match(thumbnailNode, /function updateMedia\(entries = \[\]\)/);
  assert.match(thumbnailNode, /dataset\.uiMediaKey/);
});

test("thumbnail preview keeps the shared renderer cadence independent from its display mode", () => {
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.match(previewSource, /function applyPreviewFrameRate\(\)[\s\S]*?thumbnailPreview: false/);
  assert.doesNotMatch(previewSource, /thumbnailPreview: pendingState\?\.ui\?\.debugPreview === false/);
});

test("Preview GPU phase alignment follows Output cadence rather than its throttled duplicate cadence", () => {
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const frameRatePolicy = previewSource.slice(
    previewSource.indexOf("function applyPreviewFrameRate()"),
    previewSource.indexOf("function schedulePreviewPhaseShift", previewSource.indexOf("function applyPreviewFrameRate()")),
  );

  assert.match(frameRatePolicy, /const outputFrameRate = renderMaxFrameRate\(pendingState\?\.render\)/);
  assert.match(frameRatePolicy, /frameRate: outputFrameRate/);
  assert.match(frameRatePolicy, /schedulePreviewPhaseShift\(outputFrameRate\)/);
  assert.doesNotMatch(frameRatePolicy, /schedulePreviewPhaseShift\(target\)/);
});

test("ordinary UI interactions do not wait through a fixed post-click quiet period", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(!source.includes("interactionQuietMs"));
  assert.ok(!source.includes("interactionHoldUntil"));
  assert.match(source, /function scheduleDeferredRenderFlush\(\) \{[\s\S]*?setTimeout\(flushDeferredRender, 0\);/);
  assert.match(source, /function shouldDeferRender\(\) \{[\s\S]*?return activePointerCount > 0 \|\| activeEditor;/);
  assert.match(source, /command\.action === "global\.interaction"/);
});

test("deferred UI frames consume current user truth instead of captured snapshots", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /requestAnimationFrame\(\(\) => \{[\s\S]*?const request = scheduledRenderRequest \|\| \{\};[\s\S]*?scheduledRenderRequest = null;[\s\S]*?deferRender\(latestState, request\)[\s\S]*?request\.projection === "live-program"[\s\S]*?render\(latestState, request\)/);
  assert.match(source, /function flushDeferredRender\(\)[\s\S]*?const context = deferredRenderContext \|\| \{\}[\s\S]*?scheduleRenderNow\(latestState, \{[\s\S]*?\.\.\.context/);
  assert.match(source, /change\.effects\.graph\.mode === "recompile"[\s\S]*?scheduleRenderNow\(state, \{ force: true, reason, change \}\)/);
  assert.match(source, /function scheduleRenderNow\(state, \{[\s\S]*?force = false,[\s\S]*?reason = "",[\s\S]*?change = null,[\s\S]*?projection = "shell",[\s\S]*?invalidation = null,[\s\S]*?previewPatched = false,[\s\S]*?\} = \{\}\)[\s\S]*?if \(!request\.force && shouldDeferRender\(\)\)/);
});

test("Live transitions avoid a second full control-shell rebuild at expiry", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const commandSource = readFileSync(new URL("../js/libraries/state-engine/state-command/index.js", import.meta.url), "utf8");

  assert.match(commandSource, /LIVE_PROGRAM_PREVIEW_REASONS[\s\S]*?"live:scene"[\s\S]*?"live:target"/);
  assert.match(source, /live-transition-expired[\s\S]*?\["live-projection-rail"[\s\S]*?\["inspector"/);
  assert.match(source, /createControlRenderDiagnostics\(\{ diagnostics \}\)/);
});

test("Live transition expiry survives unrelated state traffic across its deadline", () => {
  let nowMs = 1000;
  let nextHandle = 1;
  const callbacks = new Map();
  const cancelled = [];
  let expirationCount = 0;
  const scheduler = createLiveTransitionExpiryScheduler({
    now: () => nowMs,
    schedule: (callback, delayMs) => {
      const handle = nextHandle++;
      callbacks.set(handle, { callback, delayMs });
      return handle;
    },
    cancel: (handle) => {
      cancelled.push(handle);
      callbacks.delete(handle);
    },
    onExpire: () => { expirationCount++; },
  });
  const transition = {
    id: "scene-to-component",
    startedAtMs: 1000,
    durationMs: 100,
  };

  assert.equal(scheduler.update(transition), true);
  assert.equal(callbacks.get(1).delayMs, 120);

  nowMs = 1095;
  assert.equal(scheduler.update(transition), false, "metrics before expiry retain the original timer");
  nowMs = 1105;
  assert.equal(scheduler.update(transition), false, "metrics inside the grace window cannot erase expiry");
  assert.deepEqual(cancelled, []);

  callbacks.get(1).callback();
  assert.equal(expirationCount, 1);
});

test("Live program selection reconciles outside the originating click event", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(
    source,
    /currentWorkspace\(state\) === "live" && change\.effects\.preview\.mode === "live-program"[\s\S]*?scheduleRenderNow\(state, \{ force: true, reason, change, projection: "live-program" \}\);[\s\S]*?return;/,
  );
  assert.match(
    source,
    /if \(request\.projection === "live-program"\) \{[\s\S]*?renderLiveProgramChange\(latestState, request\);/,
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
      change: createChangeEvent({ reason: "select-mapping", command: { domain: "ui" } }),
    }),
    "mapping",
    "Mapping selection replaces the derived route program and retained handles",
  );
  assert.equal(
    previewActivationForContext({
      reason: "toggle:mappings.0.surfaces.2.enabled",
      change: createChangeEvent("toggle:mappings.0.surfaces.2.enabled"),
    }),
    "mapping",
    "a Surface eye changes reachability but not visual programs or resources",
  );
  assert.equal(
    previewActivationForContext({
      reason: "live:preview-surface",
      change: createChangeEvent({ reason: "live:preview-surface", command: { domain: "ui" } }),
    }),
    "projection",
    "Scene Mapping and projected output rows have different derived surface programs and reachability",
  );
  assert.equal(
    previewActivationForContext({
      reason: "preview-fit-frame",
      change: createChangeEvent({ reason: "preview-fit-frame", command: { domain: "ui" } }),
    }),
    "ui",
    "ordinary navigation must retain compiled Mapping geometry",
  );
  assert.equal(
    previewActivationForContext({
      reason: "live:scene",
      change: createChangeEvent("live:scene"),
    }),
    "full",
    "a Scene change still activates the newly compiled visual endpoint",
  );
});

test("Surface eyes commit visibility through the shared selection contract and rebuild only their projection", () => {
  const shellSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.match(shellSource, /command\.payload\?\.action === "toggle-enabled"[\s\S]*?store\.setMappingSurfaceVisibility\([\s\S]*?surface\.enabled === false/);
  assert.match(shellSource, /command\.action === "component\.element-action"[\s\S]*?operation === "toggle-enabled"[\s\S]*?inputs\.updatePersistentValue/);
  assert.match(
    shellSource,
    /const controlInvalidation = change\.effects\.control[\s\S]*?projection: "control-invalidation"[\s\S]*?invalidation: controlInvalidation/,
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
  const patchRuntimeSource = readFileSync(new URL("../js/output/live-render-patch-runtime.js", import.meta.url), "utf8");

  assert.doesNotMatch(commandSource, /toggle:components\\\.\\d\+\\\.chain/);
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
  const style = vjStyleSource();
  const source = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");

  assert.match(source, /liveLayerOutlineItems[\s\S]*?presentation: item\.kind === "group" \? "group-element-row" : "element-row"/);
  assert.match(source, /id: "toggle-enabled"[\s\S]*?componentId,[\s\S]*?nodeId: layer\.nodeId,[\s\S]*?path: "enabled"/);
  assert.match(source, /icon: chainItemToggleIcon\(item\)/);
  assert.doesNotMatch(source, /textListItemTemplate|elementListTemplate/);
  assert.match(style, /\.chain-item-select \{\s*cursor: grab;/);
  assert.doesNotMatch(style, /\.live-chain-settings \.chain-param-view-general \{\s*display: none;/);
});

test("local UI controls use the UI-only state path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const projectService = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(controller, /function updateUi\(recipe, reason\)[\s\S]*?store\.updateUi\(recipe, reason\)/);
  assert.match(controller, /updateUi\(\(ui\) => \{[\s\S]*?updatePreviewViewportForUi\(ui, \(viewport\) => zoomViewport/);
  assert.match(controller, /ui\.catalogSortModes\.component = mode/);
  assert.match(controller, /ui\.catalogSortModes\.live = mode/);
  assert.match(app, /application\.bindInput\("storage", "value", \(\{ state, change \}\) => \{[\s\S]*?change\.effects\?\.persistence\?\.mode === "none"[\s\S]*?projectService\.scheduleAutoSave\(change, \{ state \}\)/);
  assert.match(app, /application\.bindInput\("live-synchronization", "state", \(\{ state, reason, change \}\) => \{[\s\S]*?const outputEffect = change\.effects\?\.output/);
  assert.match(app, /application\.emit\("data-store", "snapshot", \{ state, reason, change \}\)/);
  assert.match(projectService, /if \(persistence\.mode === "none"\) return;/);
  assert.match(projectService, /if \(persistence\.mode === "defer" && !immediate\) return;/);
});

test("preview navigation bypasses full renderer state replacement and drag wakes after pointer signal publication", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const preview = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const viewportStart = preview.indexOf("  function setViewport(");
  const viewportEnd = preview.indexOf("\n  function setInstalledNodePackages(", viewportStart);
  const setViewportSource = preview.slice(viewportStart, viewportEnd);

  assert.match(controller, /change\.effects\.preview\.mode === "viewport"[\s\S]*?embeddedPreview\.setViewport\(state\.ui\);[\s\S]*?return;/);
  assert.match(setViewportSource, /renderer\?\.presentationGeometry\?\.setViewport\(resolvedViewport\)/);
  assert.doesNotMatch(setViewportSource, /renderer\?\.setState/);
  assert.match(preview, /const onPointerMove = \(event\) => \{[\s\S]*?publishPointer\(position,[\s\S]*?if \(!pointerActive \|\| event\.pointerId !== activePointerId\) return;\s*wakePreviewPresentation\(\)/);
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
  const uiProgramSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const selectorsSource = readFileSync(new URL("../js/control/control-selectors.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const style = vjStyleSource();
  assert.ok(!source.includes("Build a larger visual with the same sources"));
  assert.ok(!source.includes("<span>Sampling</span>"));
  assert.match(uiProgramSource, /sceneRailUiModel[\s\S]*?title: "Scenes"[\s\S]*?title: "Surfaces"/);
  assert.match(uiProgramSource, /sceneSurfaceListItems[\s\S]*?getSelectedMapping\(state\)[\s\S]*?state\.surfaces/);
  assert.ok(uiProgramSource.includes('listPresentation: "surface-pills"'));
  assert.ok(!source.includes('class="canvas-inspector-section"'));
  assert.match(componentSource, /componentElementsUiModel[\s\S]*?componentLayerProjection\(state, component\)/);
  assert.match(componentSource, /onSelect:[\s\S]*?component\.element-select[\s\S]*?onReorder:[\s\S]*?component\.element-reorder/);
  assert.doesNotMatch(componentSource, /componentUnifiedChainTemplate|layerItemsTemplate/);
  assert.doesNotMatch(componentSource, /componentHeaderAddButtonTemplate/);
  assert.match(uiProgramSource, /artifactInspectorUiModel[\s\S]*?type: "panel"[\s\S]*?titleBinding[\s\S]*?headerActions/);
  assert.match(source, /workspace === "component"[\s\S]*?action: "inspector\.add-element"/);
  assert.match(source, /workspace === "component"[\s\S]*?renderInspectorPanel\(state/);
  assert.match(source, /workspace === "scene"[\s\S]*?renderInspectorPanel\(state/);
  assert.match(style, /\.element-list-surface,[\s\S]*?padding: var\(--section-inset\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(componentSource, /function componentSelectedChainSettingsModel[\s\S]*?type: "panel"[\s\S]*?titleBinding/);
  assert.match(source, /workspace === "component"[\s\S]*?componentSelectedChainSettingsModel\(selectedComponent, state\)/);
  assert.match(source, /workspace === "scene"[\s\S]*?componentSelectedChainSettingsModel\(selectedScene, state\)/);
  assert.match(source, /ELEMENT_PARAMETER_SECTION_LAYOUT[\s\S]*?basis: "40%"/);
  assert.match(source, /workspace === "component"[\s\S]*?secondaryLayout: selectedElementParameters \? ELEMENT_PARAMETER_SECTION_LAYOUT/);
  assert.match(source, /workspace === "scene"[\s\S]*?secondaryLayout: selectedSceneSurface[\s\S]*?SURFACE_INSPECTOR_SECTION_LAYOUT[\s\S]*?selectedSceneElementParameters \? ELEMENT_PARAMETER_SECTION_LAYOUT/);
  assert.ok(!source.includes('emptyNote("Select a chain item")'));
  assert.match(style, /\.chain-settings-panel \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?gap: 0;/);
  assert.match(source, /workspace === "component" \|\| workspace === "scene"[\s\S]*?workspace === "live"[\s\S]*?"live"/);
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  assert.ok(pickerSource.includes('value: { kind: "source", value: { type: "component"'));
  assert.match(componentSource, /item\.kind === "source" && item\.source\?\.type === "component"[\s\S]*?component\?\.type === "scene"[\s\S]*?type: "select"[\s\S]*?label: "Component"/);
  assert.doesNotMatch(componentSource, /componentSelectTemplate|data-update=.*source\.componentId/);
  assert.ok(componentSource.includes('if (item.source?.type === "component") return sourceTitle'));
  assert.match(uiProgramSource, /previewToolsUiGraph[\s\S]*?preview\.cycle-quality/);
  assert.match(uiProgramSource, /previewToolsUiGraph[\s\S]*?preview\.toggle-diagnostics/);
  assert.match(source, /retainedUi\.activate\(previewToolsUiGraph/);
  assert.doesNotMatch(source, /data-preview-quality|data-preview-diagnostics|bindPreviewViewportTools/);
  assert.ok(source.includes("ui.previewDiagnostics = ui.previewDiagnostics !== true"));
  assert.ok(source.includes('quality === "auto" ? "good" : quality === "good" ? "low" : "auto"'));
  assert.ok(uiProgramSource.includes('["component", "scene", "mapping", "live"].includes(workspace)'));
  assert.ok(source.includes("draft.ui.previewQuality = nextPreviewQuality"));
  assert.ok(!source.includes('data-update="${base}.canvas.previewQuality"'));
  assert.ok(!source.includes("data-add-frame"));
  assert.ok(!source.includes("data-set-route-frame-id"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.match(uiProgramSource, /componentCatalogUiGraph[\s\S]*?title: "Components"/);
  assert.ok(selectorsSource.includes('filter((component) => component.type !== "scene" && !component.systemRole)'));
  assert.ok(uiProgramSource.includes("state.surfaces || []"));
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
  const style = vjStyleSource();

  assert.match(style, /\.preview-tools \{[\s\S]*?width: max-content;[\s\S]*?height: max-content;[\s\S]*?align-self: end;[\s\S]*?justify-self: end;/);
  assert.match(style, /\.preview-tool \{[\s\S]*?width: 30px;[\s\S]*?height: 28px;[\s\S]*?overflow: hidden;/);
  assert.match(style, /\.preview-tool-node > button \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?width: auto;[\s\S]*?min-width: 0;[\s\S]*?height: auto;[\s\S]*?min-height: 0;[\s\S]*?place-self: stretch;/);
  assert.match(style, /\.preview-tool-node > button:hover:not\(:disabled\) \{[\s\S]*?background: transparent;[\s\S]*?color: inherit;/);
  assert.match(style, /\.preview-tool-node > button:focus-visible \{[\s\S]*?outline-offset: -2px;/);
  assert.match(style, /\.preview-quality-tool \{[\s\S]*?flex: 0 0 48px;[\s\S]*?min-width: 48px;[\s\S]*?max-width: 48px;/);
  assert.match(style, /\.preview-fps \{[\s\S]*?flex: 0 0 174px;[\s\S]*?min-width: 174px;[\s\S]*?max-width: 174px;/);
});

test("preview scaling diagnostics reuse the dormant geometry and detailed HUD probes", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const uiProgram = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const embedded = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const metrics = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  const style = vjStyleSource();

  assert.match(uiProgram, /button\("diagnostics", "Preview scaling diagnostics", "developer_mode", "preview\.toggle-diagnostics"/);
  assert.match(controller, /command\.action === "preview\.toggle-diagnostics"/);
  assert.doesNotMatch(controller, /data-preview-diagnostics|bindPreviewViewportTools/);
  assert.match(embedded, /pendingState\?\.ui\?\.previewDiagnostics === true/);
  assert.match(embedded, /classList\?\.toggle\("is-geometry-diagnostic", enabled\)/);
  assert.match(metrics, /this\.previewDiagnosticModel\(fps\)/);
  assert.match(style, /\.embedded-preview-stage canvas\.is-geometry-diagnostic \{[\s\S]*?border: 2px solid #ff4fa3;/);
  assert.doesNotMatch(style, /\.output-stage canvas\s*\{[^}]*outline:/);
});

test("compact text lists share one full-width item generator", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const uiProgramSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const listButton = readFileSync(new URL("../js/libraries/ui-engine/nodes/list-button-node.js", import.meta.url), "utf8");
  const style = vjStyleSource();
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  const elements = componentElementsUiModel(component, state);

  assert.match(listButton, /export const ListButtonNode = defineUiNode/);
  assert.match(uiProgramSource, /surfaceListItems[\s\S]*?actions: \[\{[\s\S]*?id: "toggle-enabled"/);
  assert.ok(elements.items.every((item) => item.id && item.label));
  assert.doesNotMatch(componentSource, /layerItemRowTemplate|textListItemTemplate\(/);
  assert.ok(style.includes(".text-list-item {"));
  assert.match(style, /\.text-list-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?border: 0;/);
  assert.match(style, /\.text-list-item\.has-leading\.has-remove \{[\s\S]*?var\(--text-list-leading-size\)[\s\S]*?var\(--text-list-remove-size\)/);
  assert.match(style, /\.text-list-item \.text-list-remove \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(style, /\.text-list-item \.text-list-remove \{[\s\S]*?justify-content: center;/);
  assert.match(style, /\.text-list-item:hover \{[\s\S]*?background:/);
  assert.match(style, /button\.text-list-main:hover \{[\s\S]*?background: transparent;/);
  assert.ok(!style.includes(".surface-pills .list-select.is-selected"));
  assert.match(style, /\.chain-item-row \.enable-toggle\.is-enabled \{[\s\S]*?background: rgba\(255, 255, 255, 0\.055\);[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.chain-item-row\.is-selected \.enable-toggle\.is-enabled \{[\s\S]*?color: var\(--ink\);/);
  assert.doesNotMatch(style, /live-chain-outline|live-element-list-surface/);
  assert.match(style, /\.ui-node-list-item \{[\s\S]*?margin-inline-start: calc\(var\(--ui-list-depth, 0\) \* 14px\);/);
  assert.match(style, /\.compact-list-row \{[\s\S]*?width: calc\(100% - calc\(var\(--ui-list-depth, 0\) \* 14px\)\);/);
  assert.match(style, /\.ui-node-list > \.ui-node-list-drop-zone\.is-structural \{[\s\S]*?position: relative;[\s\S]*?top: auto;[\s\S]*?width: calc\(100% - calc\(var\(--ui-list-depth, 0\) \* 14px\)\);/);
  assert.match(style, /\.ui-node-list\[data-ui-list-dragging\] > \.ui-node-list-drop-zone\.is-structural \{[\s\S]*?pointer-events: auto;/);
  assert.match(style, /\.ui-node-list-drop-zone \{[\s\S]*?border: 1px dashed transparent;/);
  assert.match(style, /\.ui-node-list-drop-zone:is\(\.is-inside, \.is-after\) \{[\s\S]*?border-color: var\(--line-strong, var\(--ui-border\)\);/);
  assert.match(style, /\.ui-node-list-drop-zone\.is-drop-target \{[\s\S]*?border-color: rgba\(255, 255, 255, 0\.55\);[\s\S]*?background: rgba\(255, 255, 255, 0\.06\);/);
});

test("Live and parameter inspector view tabs share one compact geometry contract", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const mappingSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const style = vjStyleSource();

  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.match(componentSource, /id: "chain-parameter-tabs"/);
  assert.match(programSource, /tabPresentation: "live-component-view-option"/);
  assert.match(mappingSource, /id: "live-chain-parameter-tabs"/);
  assert.match(programSource, /tabPresentation: "parameter-view-option"/);
  assert.match(programSource, /type: ToggleNode\.id[\s\S]*?presentation: "live-source-toggle"/);
  assert.match(
    style,
    /\.inspector-view-option \{[\s\S]*?min-height: 24px;[\s\S]*?padding: 3px 7px;[\s\S]*?font-size: 11px;[\s\S]*?line-height: 1;/,
  );
  assert.doesNotMatch(style, /\.live-component-view-tab \{[\s\S]*?min-height: 32px;/);
});

test("Component controls use one global descriptor-driven parameter renderer", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const mappingSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const programSource = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");

  assert.match(componentSource, /view\.parameterModel = parameterModel/);
  assert.match(programSource, /chainContentParameterUiModel\(view\.parameterModel,/);
  assert.doesNotMatch(componentSource, /selectedChainProjectionSections|parameterSections/);
  assert.doesNotMatch(programSource, /view\.parameterSections|presentation: "parameter-group"/);
  assert.doesNotMatch(componentSource, /parameterGroupTemplate/);
  assert.doesNotMatch(mappingSource, /parameterGroupTemplate/);
  assert.doesNotMatch(mappingSource, /live-significant-group/);
});

test("Mapping and Output text lists share one darker inset section box", () => {
  const styleSource = vjStyleSource();

  assert.match(
    styleSource,
    /\.mapping-text-list,[\s\S]*?\.surface-pills,[\s\S]*?\.live-projection-list \{[\s\S]*?padding: var\(--section-inset\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--control\);/,
  );
});

test("Live navigates referenced components separately and edits one selected nested element", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  assert.match(controllerSource, /currentWorkspace\(state\) === "live"[\s\S]*?renderInspectorPanel\(state, \{[\s\S]*?selectedLiveInspectorModel\(state\)/);
  assert.match(sceneLiveSource, /selectedLiveInspectorModel[\s\S]*?inspector\.edit-component/);
  assert.doesNotMatch(sceneLiveSource, /function liveComponentTemplate|liveInspectorTemplate/);
  assert.ok(!sceneLiveSource.includes('class="live-panel"'));
  assert.ok(sceneLiveSource.includes("visit(state.components?.find"));
  assert.ok(sceneLiveSource.includes("liveLayerOutlineItems"));
  assert.ok(sceneLiveSource.includes("liveSelectedChainSettingsModel"));
  assert.doesNotMatch(sceneLiveSource, /live-chain-outline-children|<div data-live-component-view-ui/);
  assert.ok(!sceneLiveSource.includes("data-live-chain-general-parameter-ui"));
  assert.ok(!controllerSource.includes("liveChainGeneralParameterUiGraph"));
  assert.ok(sceneLiveSource.includes("selectedLiveComponentViewModel"));
  assert.ok(controllerSource.includes("liveComponentViewUiGraph"));
  assert.match(controllerSource, /command\.action === "live\.element-select"/);
  assert.match(controllerSource, /command\.action === "live\.element-action"/);
  assert.ok(controllerSource.includes('command.action === "live.component-view-select"'));
  const uiTheme = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(uiTheme, /\.ui-node-section-header\[data-ui-presentation="media"\] \{[\s\S]*?grid-template-columns: 72px minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(uiTheme.match(/\.ui-node-section-header\[data-ui-presentation="media"\] \{([^}]*)\}/)?.[1] || "", /font|color|text-transform|letter-spacing/);
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

test("embedded Live preview arms timed transitions while keeping cuts immediate", () => {
  const current = { ui: { workspace: "live", selectedSceneId: "scene-being-edited", live: { selectedSceneId: "scene-a" } } };
  const incoming = {
    ui: { workspace: "live", selectedSceneId: "another-editor-scene", live: { selectedSceneId: "scene-b" } },
    liveTransition: { id: "scene-a-to-b", startedAtMs: 100, durationMs: 1000, fromTargetId: "scene-a" },
  };
  assert.equal(shouldPrepareEmbeddedLiveState(incoming, current), true);
  assert.equal(
    shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, selectedSceneId: "scene-a" } }, current),
    true,
    "editor Scene selection must not alter Live preview routing"
  );
  assert.equal(
    shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, live: { selectedSceneId: "scene-a" } } }, current),
    true
  );
  assert.equal(shouldPrepareEmbeddedLiveState({ ...incoming, ui: { ...incoming.ui, workspace: "scene" } }, current), false);
  assert.equal(shouldPrepareEmbeddedLiveState({ ...incoming, liveTransition: undefined }, current), false);
  assert.equal(shouldPrepareEmbeddedLiveState(incoming, { ...current, liveTransition: incoming.liveTransition }), false);
  assert.equal(hasActiveRendererTransition({
    surfaceRuntime: { hasActiveTransitions: () => true },
  }), true);
  assert.equal(hasActiveRendererTransition({
    surfaceRuntime: { hasActiveTransitions: () => false },
  }), false);
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.match(previewSource, /if \(hasActiveRendererTransition\(renderer\)\) return false/);
  assert.match(previewSource, /commandedTransition\.id[\s\S]*?activeRetimedTransition\.id/);
  const retimed = retimeEmbeddedLiveTransition(incoming, 2500);
  assert.equal(retimed.liveTransition.startedAtMs, 2500);
  assert.equal(incoming.liveTransition.startedAtMs, 100, "preparation must not mutate commanded state");
});

test("narrow layouts retain the preview until the compact breakpoint", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?--project-rail-width: 220px;[\s\S]*?--inspector-width: 330px;[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\) minmax\(0, 1fr\);[\s\S]*?overflow-x: auto;/);
  assert.match(styleSource, /@media \(max-width: 860px\)[\s\S]*?\.studio-layout \{[\s\S]*?grid-template-columns: var\(--project-rail-width\) var\(--inspector-width\);[\s\S]*?\.studio-main \{[\s\S]*?display: none;/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.project-rail,\s*\.studio-inspector,\s*\.studio-layout\[data-workspace="live"\] \.live-projection-rail \{[\s\S]*?display: grid;/);
  const globalInput = readFileSync(new URL("../js/libraries/ui-engine/nodes/global-input-node.js", import.meta.url), "utf8");
  assert.ok(globalInput.includes("document.defaultView?.matchMedia"));
  assert.ok(controller.includes("compactPreviewLayout"));
});

test("the application shell cannot become a vertically scrolled document", () => {
  const styleSource = vjStyleSource();
  assert.match(styleSource, /html,[\s\S]*?body \{[\s\S]*?position: fixed;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /#app \{[\s\S]*?position: fixed;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /\.studio-app \{[\s\S]*?height: 100%;[\s\S]*?overflow: hidden;[\s\S]*?overflow: clip;/);
  assert.match(styleSource, /\.studio-layout \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/);
  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?overflow-y: scroll;/);
  assert.match(styleSource, /\.chain-param-views \{[\s\S]*?position: relative;/);
  assert.match(styleSource, /\.chain-param-view-panels \{[\s\S]*?min-height: 0;/);
  assert.match(styleSource, /\.chain-param-view-panel \{[\s\S]*?overflow-y: auto;/);
});

test("project settings expose component upscaling and native-resolution post filters", () => {
  const controllerSource = settingsPanelsSource(createInitialState());

  for (const path of [
    "render.upscaling.enabled",
    "render.upscaling.amount",
    "render.postProcessing.grayscaleEnabled",
    "render.postProcessing.grayscaleAmount",
    "render.postProcessing.noiseEnabled",
    "render.postProcessing.noiseAmount",
  ]) {
    assert.ok(controllerSource.includes(`"address":"${path}"`));
  }
  assert.ok(controllerSource.includes("These filters run at the component’s full target resolution after upscaling."));
});

test("project settings expose proportions, an adaptive ceiling, and no authored pixel dimensions", () => {
  const source = settingsPanelsSource(createInitialState());
  assert.ok(source.includes('"address":"render.sceneAspectRatio"'));
  assert.ok(source.includes('"address":"render.componentAspectRatio"'));
  assert.ok(source.includes('"address":"render.resolutionCeiling"'));
  assert.ok(source.includes('"address":"render.sampling.surfaceOverscan"'));
  assert.ok(source.includes('"address":"render.sampling.surfaceDetailScale"'));
  assert.ok(source.includes('"address":"render.sampling.limitSceneToLogicalSize"'));
  assert.equal(source.includes('"address":"render.edgeSoftness"'), false);
  assert.ok(source.includes("Auto · current window"));
  for (const projectorClass of ["VGA · 640 × 480", "XGA · 1024 × 768", "UXGA · 1600 × 1200", "WUXGA · 1920 × 1200"]) {
    assert.ok(source.includes(projectorClass));
  }
  assert.ok(!source.includes("render.componentTexture"));
  assert.ok(!source.includes("render.surfaceTexture"));
  assert.ok(!source.includes('"address":"render.surfaceWidth"'));
  assert.ok(!source.includes('"address":"render.surfaceHeight"'));
});

test("project settings expose proportion presets instead of projector pixel presets", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsPanelsSource(createInitialState())}`;
  for (const ratio of ["16:9", "4:3", "16:10", "1:1", "9:16"]) {
    assert.ok(source.includes(`"preset":"${ratio}"`));
  }
  assert.ok(!source.includes('data-render-preset="wxga"'));
  assert.ok(!source.includes('data-render-preset="wuxga"'));
});

test("project settings expose camera capture preferences", () => {
  const source = settingsPanelsSource(createInitialState());
  assert.equal(normalizeSettingsTab("camera"), "inputs");
  assert.ok(source.includes('"id":"inputs"'));
  assert.ok(!source.includes('"id":"camera","label"'));
  assert.ok(!source.includes("data-camera-preset"));
  assert.ok(!source.includes('data-settings-update="render.camera.width"'));
  assert.ok(!source.includes('data-settings-update="render.camera.height"'));
  assert.ok(source.includes('"address":"render.camera.facingMode"'));
  assert.ok(source.includes('"address":"render.camera.mirrored"'));
  assert.ok(source.includes('"address":"render.camera.maxResolution"'));
});

test("project settings own named session-persistent screen inputs without target dimensions", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsPanelsSource(createInitialState())}`;
  assert.equal(normalizeSettingsTab("screen"), "inputs");
  assert.ok(source.includes('"address":"render.screenCapture.frameRate"'));
  assert.ok(source.includes('"address":"render.screenCapture.cursor"'));
  assert.ok(source.includes('"id":"start-screen-capture"'));
  assert.ok(source.includes('"id":"stop-screen-capture"'));
  assert.ok(source.includes("settings.screen-name"));
  assert.ok(source.includes("stop-screen-capture-input"));
  assert.ok(source.includes("screenCapture.rename"));
  assert.ok(source.includes("screenCapture.stop"));
  assert.ok(source.includes("screenCapture.start(settings)"));
  assert.ok(source.includes("SCREEN_CAPTURE_SERVICE_REQUIRED"));
  assert.equal(source.includes('render.screenCapture.width'), false);
  assert.equal(source.includes('render.screenCapture.height'), false);
});

test("project settings are a semantic retained modal and tab hierarchy", () => {
  const controller = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const program = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const source = `${controller}\n${program}\n${settingsPanelsSource(createInitialState())}`;
  assert.ok(controller.includes("retainedUi.activate(settingsModalUiGraph"));
  assert.doesNotMatch(controller, /innerHTML|createElement|querySelector|addEventListener|classList|className/);
  assert.ok(program.includes("compileUiModel(model"));
  assert.ok(source.includes('"type":"modal"'));
  assert.ok(source.includes('"type":"tabs"'));
  assert.ok(source.includes('"address":"render.maxFrameRate"'));
  assert.ok(source.includes('"id":"add-output"'));
  assert.ok(!source.includes("settingsScroll"));
});

test("project settings use a compact section header and edge-aligned tab content", () => {
  const source = vjStyleSource();
  assert.match(source, /\.settings-modal > \.ui-node-overlay-header \{[\s\S]*?background: var\(--section-header\)/);
  assert.match(source, /\.settings-modal > \.ui-node-overlay-header \.ui-node-overlay-heading > h2 \{[\s\S]*?text-transform: uppercase/);
  assert.match(source, /\.settings-tab-content \{\s*padding: 6px 0 0;/);
  assert.match(source, /\.settings-tabs \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;/);
});

test("Scene plus control creates an empty Scene instead of capturing current assignments", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.match(source, /sceneRailUiModel[\s\S]*?addLabel: "Add scene"/);
  assert.ok(source.includes("store.addScene?.()"));
  assert.ok(!source.includes("data-scene-name"));
  assert.ok(!source.includes('data-save-scene title="Capture scene"'));
});

test("scrub changes send coalesced param patches without waiting for a preview frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");
  const synchronizationSource = readFileSync(new URL("../js/libraries/synchronization-engine/live-patch-synchronizer/index.js", import.meta.url), "utf8");
  const stateSource = readFileSync(new URL("../js/app-state.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/control-command-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(appSource.includes('change.effects?.persistence?.mode === "none"'));
  assert.ok(bridgeSource.includes('change.command?.domain !== "live"'));
  assert.ok(bridgeSource.includes("scheduleLivePatches();"));
  assert.ok(bridgeSource.includes("flushLivePatches();"));
  assert.ok(synchronizationSource.includes('typeof requestAnimationFrame === "function"'));
  assert.ok(bridgeSource.includes('type: "live-patch"'));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
  assert.ok(stateSource.includes("function updateLive(recipe"));
  assert.ok(inputSource.includes('typeof store.updateLive === "function"'));
  assert.ok(inputSource.includes("createComponentRenderPatch"));
  assert.ok(inputSource.includes('nodeId = String(target.nodeId || "")'));
  assert.ok(previewSource.includes("pendingState?.ui?.outputWindowOpen"));
  assert.ok(!previewSource.includes('outputWindowOpen && pendingState?.ui?.workspace !== "live"'));
  assert.ok(previewSource.includes('activateRendererState(previewSizedState(), resolvedActivation)'));
  assert.ok(previewSource.includes('renderer.setUiState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setMappingState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setProjectionState(nextState, { normalized: true })'));
  assert.ok(previewSource.includes('renderer.setAssetState(nextState, { normalized: true })'));
  const activationSource = readFileSync(new URL("../js/control/preview-state-activation.js", import.meta.url), "utf8");
  assert.ok(activationSource.includes('context.change?.effects?.preview?.mode'));
  assert.ok(activationSource.includes('["projection", "mapping", "assets", "ui"].includes(mode)'));
  assert.ok(rendererSource.includes('setState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setUiState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setProjectionState(nextState, { normalized = false } = {})'));
  assert.ok(rendererSource.includes('setAssetState(nextState, { normalized = false } = {})'));
  assert.ok(appSource.includes('bridge.sendState(null, { activation: "assets" })'));
  assert.ok(outputSource.includes('renderer?.setState(runtimeState, { normalized: true });'));
  assert.ok(outputSource.includes('renderer?.setAssetState(runtimeState, { normalized: true });'));
  assert.match(outputSource, /renderer\.livePatchRuntime\.applyLive\(\s*patches,/);
  assert.ok(previewSource.includes("renderer.livePatchRuntime.applyLive(patches)"));
});

test("Live parameter commits refresh source-card reset actions immediately", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(
    controller,
    /if \(reason === "live:update"\)[\s\S]*?new Set\(change\.effects\.control\?\.regions \|\| \[\]\)[\s\S]*?projection: "control-invalidation"[\s\S]*?invalidation: \{ regions: \[\.\.\.regions\] \}/,
  );
});

test("the first Live scrub refreshes a newly resettable source card", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(
    controller,
    /if \(change\.command\.phase === "scrub"\)[\s\S]*?const scrubInvalidation = change\.effects\.control[\s\S]*?projection: "control-invalidation"[\s\S]*?invalidation: scrubInvalidation/,
  );
});

test("parameter context menus cross the semantic UI command boundary", () => {
  const source = readFileSync(new URL("../js/control/control-command-controller.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const program = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  assert.ok(source.includes('const live = target.mode === "live"'));
  assert.ok(source.includes("function openParameterContextMenu(target"));
  assert.ok(source.includes("setLiveOverride(draft, liveComponentId, path, value, liveNodeId)"));
  assert.ok(source.includes('updateLiveAware(live, recipe, live ? "live:reset-default"'));
  assert.match(shell, /createControlCommandController\(\{[\s\S]*?showContextMenu,[\s\S]*?closeContextMenu,/);
  assert.doesNotMatch(shell, /\bcycleCatalogMarker\(/);
  assert.match(shell, /store\.cycleCatalogMarker\?\.\(/);
  assert.ok(program.includes('contextAction: "parameter.open-context-menu"'));
  assert.doesNotMatch(source, /querySelector|addEventListener|dataset/);
});

test("opening an output never changes the Live Scene", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('buildOutputUrl("output", { outputId: output.id })'));
  assert.ok(!controllerSource.includes("store.selectLiveScene(state.ui.selectedMappingId);"));
  assert.ok(controllerSource.includes("Opening a display is infrastructure, not a Live performance command"));
  assert.ok(!controllerSource.includes("const initialSceneId ="));
  assert.match(controllerSource, /command\.action === "live\.source-select"[\s\S]*?target\.type === "scene"\) store\.selectLiveScene\(id\)/);
  assert.ok(bridgeSource.includes("store.getLiveRenderState?.()"));
  assert.ok(bridgeSource.includes("targetClientId"));
  assert.ok(!bridgeSource.includes("initialSceneAccepted"));
  assert.ok(!bridgeSource.includes("initialSceneId"));
  assert.ok(appSource.includes('state.ui.workspace === "mapping"'));
  assert.ok(appSource.includes('createRenderStatePatch("mappingCalibration"'));
  assert.ok(!appSource.includes('bridge.command("sync-mapping"'));
  assert.ok(appSource.includes("bridge.sendState();"));
  assert.ok(appSource.includes("outputRenderPatchesForChange(state, change)"));
  assert.ok(appSource.includes('if (outputEffect.mode === "none") return;'));
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
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("componentRenderPatchesForChange(state, change)"));
  assert.ok(controllerSource.includes("embeddedPreview.applyRenderPatches(renderPatches)?.applied"));
  assert.ok(controllerSource.includes("if (!patchedLivePreview && !patchedStudioPreview"));
  assert.ok(controllerSource.includes("previewPatched: patchedLivePreview || patchedStudioPreview"));
  assert.ok(controllerSource.includes("previewPatched = false"));
  assert.ok(controllerSource.includes("render(latestState, request)"));
  assert.ok(controllerSource.includes("deferRender(state, context)"));
  assert.ok(controllerSource.includes("if (!context.previewPatched) updatePreviewState(state)"));
  assert.ok(controllerSource.includes("const context = deferredRenderContext || {}"));
  assert.ok(controllerSource.includes("if (!context.previewPatched) renderPreview(state, context)"));
  assert.ok(controllerSource.includes('if (change.effects.preview.mode === "mapping")'));
  assert.ok(controllerSource.includes('if (change.command.phase !== "scrub") renderPreview(state, { reason, change })'));
  assert.ok(previewSource.includes("applyLiveRenderPatchesImmutable(pendingState, patches)"));
  assert.ok(previewSource.includes("pendingState = pendingResult.state"));
  assert.ok(previewSource.includes('applyRetainedPreviewPatches(patches, "live")'));
  assert.ok(previewSource.includes('applyRetainedPreviewPatches(patches, "render")'));
});

test("multiple configured outputs have individual popup actions", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const settingsHtml = settingsPanelsSource(createInitialState());

  assert.ok(shellSource.includes('"output-menu"'));
  assert.ok(controllerSource.includes('id.startsWith("output:")'));
  assert.ok(!controllerSource.includes("data-open-all-outputs"));
  assert.ok(controllerSource.includes("outputs.length === 1"));
  assert.ok(shellSource.includes("reconcileOutputs()"));
  assert.ok(settingsHtml.includes("render.outputs.0.aspectRatio"));
  assert.ok(settingsHtml.includes('"id":"add-output"'));
});

test("the debug button controls only the presentation HUD node, never surface labels", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const metricsSource = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  assert.ok(controllerSource.includes('{ id: "toggle-hud"'));
  assert.ok(controllerSource.includes('draft.global.showHud = draft.global.showHud === false'));
  assert.ok(metricsSource.includes("host.hud.present?.({"));
  assert.ok(metricsSource.includes("this.resolutionLabel()"));
  assert.ok(!rendererSource.includes("renderOutputFrameOverlay"));
  assert.ok(!controllerSource.includes("showLabels"));
});

test("topbar combines renderer health and fixed-width output fps", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const frameRuntimeSource = readFileSync(new URL("../js/output/output-frame-runtime.js", import.meta.url), "utf8");
  const presentationRuntimeSource = readFileSync(new URL("../js/output/output-presentation-runtime.js", import.meta.url), "utf8");
  const metricsSource = readFileSync(new URL("../js/output/output-presentation-metrics.js", import.meta.url), "utf8");
  const gpuTimerSource = readFileSync(new URL("../js/output/gpu-timer-tracker.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const performanceSessionSource = readFileSync(new URL("../js/control/control-performance-session.js", import.meta.url), "utf8");

  assert.ok(shellSource.includes('"performance-health-button"'));
  assert.ok(shellSource.includes("healthDotNodes"));
  assert.ok(shellSource.includes("outputStatusText"));
  assert.match(styleSource, /\.performance-health-button \{[\s\S]*?background: #171717;/);
  assert.match(styleSource, /\.performance-health-button\.is-active \{[\s\S]*?background: var\(--accent-strong\);/);
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
  assert.ok(controllerSource.includes("performanceHealthStep(renderCost)"));
  assert.ok(controllerSource.includes('{ icon: "speed", label: "Overall"'));
  assert.ok(controllerSource.includes('{ icon: "timer", label: "CPU"'));
  assert.ok(controllerSource.includes('{ icon: "memory", label: "GPU"'));
  assert.ok(controllerSource.includes('{ icon: "open_in_new", label: "Output"'));
  assert.match(styleSource, /\.ui-node-metrics-readouts \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/s);
  assert.ok(controllerSource.includes('{ icon: "cached", label: "Cache reuse"'));
  assert.ok(controllerSource.includes('{ icon: "refresh", label: "Renders"'));
  assert.ok(controllerSource.includes('"Signal load"'));
  assert.ok(controllerSource.includes("PERFORMANCE_SIGNAL_CATEGORIES.map"));
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
  assert.ok(shellSource.includes('"performance-summary"'));
  assert.ok(shellSource.includes('"performance-analyze"'));
  assert.ok(performanceSessionSource.includes("DEFAULT_DURATION_MS = 10000"));
  assert.ok(controllerSource.includes("createRuntimeHotspotSmoother"));
  assert.ok(controllerSource.includes("summarizeRuntimeHotPasses(profiles, 16)"));
  assert.ok(!controllerSource.includes("running average of recent samples"));
  assert.ok(!controllerSource.includes("CPU rows can overlap because a component includes its child passes"));
  assert.ok(performanceSessionSource.includes('PerformanceObserver.supportedEntryTypes?.includes("longtask")'));
  assert.ok(performanceSessionSource.includes("session.host.uiRenderMs"));
  assert.ok(controllerSource.includes("resolveNodeDefinition: (node) =>"));
  assert.ok(controllerSource.includes("globalThis.__vj1LastProfileReport = report"));
  assert.ok(controllerSource.includes('retainedUi.updateNode("file-download"'));
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
  const source = vjStyleSource();
  assert.match(source, /\.performance-health-button \{[\s\S]*?width: 76px;[\s\S]*?flex: 0 0 76px;/);
  assert.match(source, /\.performance-output-status \{[\s\S]*?flex: 0 0 3ch;/);
  assert.ok(source.includes("font-variant-numeric: tabular-nums;"));
  assert.equal(performanceHealthStep(0), 0);
  assert.equal(performanceHealthStep(0.5), 3);
  assert.equal(performanceHealthStep(1), 8);
  assert.equal(performanceHealthStep(10), 8);
});

test("list thumbnails crop to fill without changing their colors", () => {
  const source = vjStyleSource();
  const thumbnailNode = readFileSync(new URL("../js/libraries/ui-engine/nodes/thumbnail-button-node.js", import.meta.url), "utf8");
  assert.match(thumbnailNode, /image\.loading = "lazy"/);
  assert.match(source, /\.component-thumbnail,\n\.component-card-empty \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?overflow: hidden;/);
  assert.match(source, /\.component-thumbnail img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.doesNotMatch(source, /\.component-card[^}]*filter:\s*grayscale/s);
  assert.doesNotMatch(source, /\.media-element-card[^}]*filter:\s*grayscale/s);
});

test("media cards use one full-width text column without the generic icon inset", () => {
  const source = vjStyleSource();
  assert.match(source, /\.ui-node-catalog-card \{[\s\S]*?display: grid;[\s\S]*?min-width: 0;/);
  assert.match(source, /\.ui-node-catalog-card :is\(img, video\) \{[\s\S]*?width: 100%;[\s\S]*?object-fit: cover;/);
});

test("component picker cards use the same thumbnail layout as media cards", () => {
  const model = elementPickerUiModel({
    media: [{ id: "image", name: "image.png", type: "image" }],
    components: [
      { id: "scene", name: "Scene", type: "scene" },
      { id: "component", name: "Component", type: "component", thumbnail: "data:image/png;base64,AA==" },
    ],
  }, { componentId: "scene" }, { getFile: () => ({}) }, {
    components: [
      { id: "scene", name: "Scene", type: "scene" },
      { id: "component", name: "Component", type: "component", thumbnail: "data:image/png;base64,AA==" },
    ],
    sortMode: "recent",
  });
  const component = model.sections.find((section) => section.id === "components").items[0];
  const media = model.sections.find((section) => section.id === "media").items[0];
  const nodeSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/catalog-picker-node.js", import.meta.url), "utf8");

  assert.equal(component.media.src, "data:image/png;base64,AA==");
  assert.equal(media.media.key, "image");
  assert.match(nodeSource, /item\.media\?\.key \|\| item\.media\?\.src/);
  assert.match(nodeSource, /button\.append\(media\)/);
  assert.match(nodeSource, /glyph\.className = "ui-node-catalog-action-icon"/);
  assert.match(nodeSource, /--ui-catalog-action-index/);
  const baseStyle = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  const themeStyle = readFileSync(new URL("../js/libraries/ui-engine/themes/vj.css", import.meta.url), "utf8");
  assert.match(baseStyle, /\.ui-node-catalog-card-shell > \[data-ui-catalog-item-action\] \{[\s\S]*?position: absolute;[\s\S]*?place-items: center;/);
  assert.match(themeStyle, /\[data-ui-catalog-media-ready="false"\] \{[\s\S]*?visibility: hidden;/);
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
  const controller = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const model = elementPickerUiModel(state, { componentId: "canvas" }, { getFile: () => null }, {
    components: [state.components[2], state.components[1], state.components[0]],
    sortMode: "name",
  });
  const style = vjStyleSource();

  const componentItems = model.sections.find((section) => section.id === "components").items;
  assert.deepEqual(componentItems.map((item) => item.label), ["Alpha", "Beta"]);
  assert.ok(controller.includes("sortComponentCatalog(state.components || [], sortMode)"));
  assert.equal(model.sections.find((section) => section.id === "components").actions[0].id, "sort:component:created");
  assert.match(controller, /action\.startsWith\("sort:"\)/);
  assert.match(style, /\.ui-node-catalog-section-actions \{[\s\S]*?display: inline-flex;[\s\S]*?gap: 4px;/);
  assert.match(style, /\.ui-node-catalog-section-actions > button \{[\s\S]*?width: 30px;[\s\S]*?padding: 0;/);
  assert.doesNotMatch(style, /\.component-(?:sort-toggle|catalog-tools)/);
});

test("workspace view buttons are compact icons with accessible names", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const iconSource = readFileSync(new URL("../js/control/ui-icons.js", import.meta.url), "utf8");
  const projectRailSource = readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.match(iconSource, /component: "extension"[\s\S]*?scene: "landscape"[\s\S]*?mapping: "select_all"/);
  assert.ok(shellSource.includes("reconcileWorkspaceButtons"));
  assert.ok(projectRailSource.includes('from "./ui-icons.js"'));
  assert.ok(componentSource.includes('from "./ui-icons.js"'));
  for (const label of ["Components", "Scenes", "Mapping", "Nodes", "Live"]) {
    assert.ok(controllerSource.includes(`label: "${label}"`));
  }
  assert.ok(shellSource.includes("reconcileWorkspaceButtons(refs.primaryViews"));
  assert.ok(shellSource.includes("reconcileWorkspaceButtons(refs.technicalViews"));
  assert.ok(shellSource.includes("workspaceButtonLists"));
  assert.ok(shellSource.includes("updateRetainedButton"));
  assert.ok(shellSource.includes('classList.contains("is-active") !== active'));
  assert.ok(controllerSource.includes("onTick: () => renderTopbarHealth(latestState)"));
  assert.ok(controllerSource.includes("setInterval(() => renderTopbarHealth(latestState), 1000)"));
  assert.ok(shellSource.includes('button.getAttribute("aria-label") !== title'));
  assert.ok(shellSource.includes('button.setAttribute("aria-label", title)'));
  assert.ok(controllerSource.includes('group: "technical"'));
  assert.match(styleSource, /\.icon-buttonish\.is-output-enabled \{[\s\S]*?background: var\(--panel-soft\);[\s\S]*?color: var\(--ink\);/);
  assert.ok(shellSource.includes('"project-title-control"'));
  assert.match(styleSource, /\.icon-buttonish\.close-project-button \{[\s\S]*?position: static;[\s\S]*?width: 26px;[\s\S]*?height: 26px;/);
  assert.match(styleSource, /\.close-project-button \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(styleSource, /\.workspace-switch button \{[\s\S]*?width: 36px;[\s\S]*?padding: 0;/);
  assert.match(styleSource, /\.ui-node-workspace-shell-actions \{[\s\S]*?gap: 6px;/);
  assert.match(styleSource, /\.workspace-switch \{[\s\S]*?gap: 6px;/);
  assert.match(styleSource, /\.ui-node-workspace-shell-actions \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
});

test("generic lists fill their layout slot instead of shrinking to item content", () => {
  const baseStyle = readFileSync(new URL("../js/libraries/ui-engine/base.css", import.meta.url), "utf8");
  assert.match(baseStyle, /\.ui-node-list \{[\s\S]*?width: 100%;[\s\S]*?align-content: start;/);
});

test("workspace button structure changes only when its ordered semantic list changes", () => {
  assert.equal(sameOrderedIds(
    ["workspace:component", "workspace:scene", "workspace:live"],
    ["workspace:component", "workspace:scene", "workspace:live"],
  ), true);
  assert.equal(sameOrderedIds(
    ["workspace:component", "workspace:scene", "workspace:live"],
    ["workspace:scene", "workspace:component", "workspace:live"],
  ), false);
  assert.equal(sameOrderedIds(
    ["workspace:component", "workspace:scene"],
    ["workspace:component", "workspace:scene", "workspace:live"],
  ), false);
});

test("Nodes is a reachable library workspace with structure and editing surfaces", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const view = readFileSync(new URL("../js/control/node-library-view.js", import.meta.url), "utf8");
  const program = readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const graphNode = readFileSync(new URL("../js/libraries/ui-engine/nodes/node-graph-editor-node.js", import.meta.url), "utf8");

  assert.match(controller, /workspace === "nodes"/);
  assert.match(controller, /nodesRailUiGraph\(nodeLibraryRailModel/);
  assert.match(controller, /nodesWorkspaceStudioUiGraph\(model\)/);
  assert.match(controller, /nodeDefinitions: Object\.freeze\(\{/);
  assert.match(controller, /nodeLibraryInspectorModel/);
  assert.match(view, /export function nodeLibraryRailModel/);
  assert.match(program, /NodeDefinitionStudioNode[\s\S]*?NodeGraphEditorNode/);
  assert.match(graphNode, /export const NodeGraphEditorNode = defineUiNode/);
  assert.doesNotMatch(controller, /bindNodeGraphCanvas/);
  assert.match(view, /nodeDefinitionEditorModel/);
});

test("referenced Components share one capture-phase deep edit command with a return path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const style = vjStyleSource();

  assert.match(componentSource, /id: "edit-component"/);
  assert.ok(shell.includes('"return"'));
  assert.doesNotMatch(controller, /data-edit-component|root\.addEventListener/);
  assert.ok(controller.includes('switchWorkspace(component.type === "scene" ? "scene" : "component")'));
  assert.match(controller, /operation === "edit-component"[\s\S]*?openComponentEditor/);
  assert.ok(controller.includes("if (chainItemId) store.selectChainItem?.(chainItemId)"));
  assert.ok(controller.includes("function returnFromDeepEdit()"));
  assert.match(style, /\.ui-node-section-header-actions \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
  assert.match(style, /\.ui-node-section-header-action-slot \.ui-node-control,[\s\S]*?width: 22px;[\s\S]*?height: 22px;/);
});

test("performance overviews show the owning Component thumbnail without renderer-side image work", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const shaderRuntime = readFileSync(new URL("../js/output/shader-effect-runtime.js", import.meta.url), "utf8");
  const sourceRuntime = readFileSync(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8");
  const style = vjStyleSource();

  assert.ok(controller.includes("component?.thumbnail ? { src: component.thumbnail } : null"));
  assert.ok(controller.includes("chainItemId: item.chainItemId"));
  assert.ok(shaderRuntime.includes('chainItemId: pass.instanceId || ""'));
  assert.ok(sourceRuntime.includes('chainItemId: item.id || source.instanceId || ""'));
  assert.ok(controller.includes("performanceSummaryOpen && !shouldDeferRender()"));
  assert.match(style, /\.ui-node-metric-hotspot\.has-media \{[\s\S]*?grid-template-columns: 40px minmax\(0, 1fr\) minmax\(58px, auto\) 28px;/);
  assert.match(style, /\.ui-node-metric-hotspot > img \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/);
  assert.match(style, /\.ui-node-metrics-hotspots \{[\s\S]*?max-height: 310px;/);
  assert.match(style, /\.ui-node-metrics-categories \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.ok(controller.includes('categoryTitle: "Signal flow per second"'));
  assert.ok(controller.includes('iconOnly: true'));
});

test("topbar diagnostics expose an event-driven bounded console with copy and clear actions", () => {
  const shell = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const diagnosticsController = readFileSync(new URL("../js/libraries/ui-engine/nodes/diagnostics-node.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const style = vjStyleSource();
  assert.ok(shell.includes('"diagnostics-summary"'));
  assert.ok(controller.includes("diagnostics?.subscribe?."));
  assert.ok(diagnosticsController.includes('emit("copy")'));
  assert.ok(diagnosticsController.includes('emit("clear")'));
  assert.ok(app.includes("createDiagnosticsService"));
  assert.match(style, /\.diagnostics-summary\s*\{[\s\S]*position:\s*absolute/);
  assert.match(style, /\.diagnostics-summary\s*\{[\s\S]*max-height:\s*calc\(100vh - 84px\);[\s\S]*gap:\s*0;[\s\S]*padding:\s*0;[\s\S]*overflow:\s*hidden/);
  assert.match(style, /\.ui-node-diagnostics \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(style, /\.ui-node-diagnostics-state \{[\s\S]*?flex: 0 0 auto;/);
  assert.match(controller, /presentation: "diagnostics", level: diagnostic\.level/);
  assert.match(shell, /button\.classList\.toggle\(`is-\$\{level\}`/);
});

test("empty project start shows one folder action and disables project views", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/libraries/ui-engine/nodes/workspace-shell-node.js", import.meta.url), "utf8");
  const styleSource = vjStyleSource();

  assert.ok(shellSource.includes('"close-project"'));
  assert.ok(controllerSource.includes("No project open"));
  assert.ok(controllerSource.includes("disabled: !hasProject"));
  assert.ok(controllerSource.includes("hasOpenProject(state)"));
  assert.match(controllerSource, /projectService\.hasOpenFolder\?\.\(\)/);
  assert.match(controllerSource, /Read-only recovery from Output/);
  assert.ok(controllerSource.includes("previewSurfaceUiGraph({ empty: true"));
  assert.ok(!controllerSource.includes("Project first"));
  assert.ok(!controllerSource.includes("data-import-files>${icon"));
  assert.ok(styleSource.includes(".no-project-open .studio-layout"));
  assert.ok(styleSource.includes(".no-project-open .project-rail"));
  assert.ok(styleSource.includes(".workspace-switch button:disabled"));
});

test("3d model controls use full-width slider rows", () => {
  const styleSource = vjStyleSource();
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
  const modelControls = preparedComponentSettings(component, state);

  assert.match(modelControls, /"label":"Depth scale"/);
  assert.match(modelControls, /"label":"Visible depth"/);
  assert.match(modelControls, /"label":"Focal length \(mm\)"/);
  assert.match(modelControls, /"label":"Wire thickness"/);
  assert.match(modelControls, /"label":"Edge angle"/);
  assert.match(modelControls, /"label":"Edge budget"/);
  assert.doesNotMatch(modelControls, /field-pair/);
  assert.ok(styleSource.includes(".ui-parameter-layout"));
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
  assert.match(styleSource, /\.ui-parameter-layout > \.ui-node-layout-content \{[^}]*min-width:\s*0;/s);
});

test("seed params stay internal and are not rendered as sliders", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/mapping-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('param?.id !== "seed"'));
  assert.ok(componentSource.includes("componentParamViews(definition)"));
  assert.ok(parameterSource.includes('param?.id !== "seed" && param?.id !== RENDER_QUALITY_PARAM.id'));
  assert.ok(sceneLiveSource.includes("componentParamViews(definition)"));
});

test("selected generators omit the redundant source chooser", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  state.ui.selectedChainItemId = component.chain[0].id;
  const html = preparedComponentSettings(component, state);

  assert.doesNotMatch(html, /Choose source/);
  assert.doesNotMatch(html, /data-open-source-picker/);
  assert.doesNotMatch(html, /data-chain-general-parameter-ui/);
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
  const style = vjStyleSource();

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
  const styleSource = vjStyleSource();

  assert.match(styleSource, /\.ui-node-resource-button\[data-ui-presentation="resource-choice"\] > button \{[\s\S]*?min-height: var\(--ui-control-height\);[\s\S]*?padding: 5px 8px;[\s\S]*?background: var\(--ui-control\);/);
  assert.match(styleSource, /\.ui-node-resource-copy :is\(strong, small\) \{[\s\S]*?font-weight: 500;/);
});

test("components expose persistent instance synchronization without changing component ids", () => {
  const controllerSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("componentFrameControlModels"));
  assert.ok(controllerSource.includes("Sync instances"));
  assert.ok(controllerSource.includes(".syncInstances"));
  assert.ok(controllerSource.includes('stateAddress: `${base}.syncInstances`'));
  assert.ok(controllerSource.includes("each Scene placement and Surface its own phase"));
});

test("global clipboard routing follows clicked lists chains Groups and external images", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/project-rail-view.js", import.meta.url), "utf8")
    + readFileSync(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8");
  const clipboardSource = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");
  const clipboardNode = readFileSync(new URL("../js/libraries/ui-engine/nodes/clipboard-node.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.match(source, /command\.action === "clipboard\.target"/);
  assert.ok(clipboardNode.includes('document.addEventListener("copy", onCopy, true)'));
  assert.ok(clipboardNode.includes('document.addEventListener("paste", onPaste, true)'));
  assert.ok(clipboardNode.includes('document.addEventListener("pointerdown", rememberTarget, true)'));
  assert.ok(clipboardSource.includes('scope.startsWith("chain:")'));
  assert.match(clipboardSource, /kind: "chain-item"[\s\S]*?componentId: scope\.slice\("chain:"\.length\)[\s\S]*?itemId/);
  assert.match(source, /command\.action === "component\.select"[\s\S]*?clipboard\.setTarget/);
  assert.ok(source.includes('pasteScope: "scene-list"'));
  assert.ok(source.includes('pasteScope: "mapping-list"'));
  assert.ok(source.includes('pasteScope: "surface-list"'));
  assert.match(readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8"), /pasteScope: `chain:\$\{component\.id\}`/);
  assert.ok(clipboardNode.includes("transferPayload"));
  assert.ok(clipboardNode.includes("imageUrlFromTransfer"));
  assert.ok(source.includes("onChainItemTarget: (componentId, itemId)"));
  assert.ok(previewSource.includes("onChainItemTarget?.(state.ui.selectedComponentId, itemId)"));
});

test("project undo and redo expose standard keyboard shortcuts", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const input = readFileSync(new URL("../js/libraries/ui-engine/nodes/global-input-node.js", import.meta.url), "utf8");

  assert.ok(input.includes('document.addEventListener("keydown", onKeyDown, true)'));
  assert.ok(input.includes("event.metaKey || event.ctrlKey"));
  assert.ok(input.includes('event.shiftKey ? "redo" : "undo"'));
  assert.match(source, /command\.action === "global\.shortcut"[\s\S]*?redoProject\(\)[\s\S]*?undoProject\(\)/);
});

test("global selection supports cut and guarded delete shortcuts", () => {
  const source = readFileSync(new URL("../js/libraries/ui-engine/nodes/clipboard-node.js", import.meta.url), "utf8");
  const commands = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes('document.addEventListener("cut", onCut, true)'));
  assert.ok(source.includes('document.addEventListener("keydown", onKeyDown, true)'));
  assert.ok(source.includes("write(event, inputs.payload)"));
  assert.ok(source.includes('event.key !== "Delete" && event.key !== "Backspace"'));
  assert.ok(commands.includes("store.removeChainItem?.(value.componentId, value.itemId)"));
});

test("periodic preview metrics update only runtime state", () => {
  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const metricsPath = source.slice(source.indexOf("function updateMetrics("), source.indexOf("function updateMapping("));

  assert.ok(metricsPath.includes("store.updateRuntime((runtimeMetrics)"));
  assert.ok(!metricsPath.includes("store.updateDerived("));
});
