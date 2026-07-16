import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";

test("range params render as label plus slider without numeric value text", () => {
  const sharedRange = rangeTemplate("Opacity", "components.0.opacity", 0.42);
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(sharedRange.includes('<span>Opacity</span>'));
  assert.ok(!sharedRange.includes("<strong>"));
  assert.ok(!controllerSource.includes("formatParamValue("));
  assert.ok(!controllerSource.includes("updateRangeLabel("));
  assert.ok(!controllerSource.includes("data-color-alpha-label"));
  assert.ok(styleSource.includes("--param-slider-width: 176px;"));
  assert.ok(styleSource.includes("grid-template-columns: minmax(0, 1fr) minmax(128px, var(--param-slider-width));"));
  assert.ok(styleSource.includes(".live-chain-pass > .chain-param-list"));
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('data-set-path="${base}.frameShape"'));
  assert.ok(controllerSource.includes('data-set-path="${base}.resolutionScale"'));
  assert.ok(controllerSource.includes('["landscape", "Landscape"]'));
  assert.ok(controllerSource.includes('["portrait", "Portrait"]'));
  assert.ok(controllerSource.includes('["square", "Square"]'));
  assert.ok(controllerSource.includes("const scaleOptions = [0.5, 1, 2];"));
  assert.ok(controllerSource.includes("component-frame-summary"));
  assert.ok(styleSource.includes(".component-option-grid"));
});

test("scene surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
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
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("state.ui?.catalogSortModes?.[scope]"));
  assert.ok(source.includes('draft.ui.catalogSortModes ||= { component: "recent", scene: "recent" }'));
  assert.ok(source.includes("draft.ui.catalogSortModes[catalog] = mode"));
  assert.ok(source.includes('catalogSortMode(state, "component")'));
  assert.ok(source.includes('catalogSortMode(state, "scene")'));
  assert.ok(source.includes("if (viewKey === activeCatalogViewKey) return"));
  assert.ok(source.includes("captureCatalogOrder(workspace, state)"));
  assert.ok(source.includes('data-catalog-sort="${nextMode}"'));
  assert.ok(source.includes("(activeIndex + 1) % modes.length"));
  assert.ok(source.includes("Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}"));
  assert.ok(!source.includes('role="group" aria-label="Sort components"'));
  assert.ok(source.includes('["recent", "name", "created"]'));
  assert.ok(style.includes(".component-sort-toggle"));
});

test("Live scene cards expose reset only for retained temporary overrides", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("data-reset-live-scene"));
  assert.ok(source.includes("state.ui?.live?.sceneOverrides"));
  assert.ok(source.includes("store.resetLiveScene"));
});

test("Live scenes expose an opt-in transition duration that defaults to zero", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const models = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('data-update="ui.live.transitionDuration"'));
  assert.ok(source.includes('min="0" max="10" step="0.1"'));
  assert.ok(models.includes("transitionDuration: 0"));
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

test("canvas uses the shared chain and exposes recording frames as scene routes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(!source.includes("Build a larger visual with the same sources"));
  assert.ok(!source.includes("<span>Sampling</span>"));
  assert.match(source, /function canvasToolsTemplate[\s\S]*?Canvas components[\s\S]*?Recording frames/);
  assert.ok(source.includes('class="recording-frame-pills"'));
  assert.ok(!source.includes('class="canvas-inspector-section"'));
  assert.ok(source.includes("componentUnifiedChainTemplate(component, state, base)"));
  assert.ok(source.includes('workspace === "component" || workspace === "canvas" ? "component"'));
  assert.ok(source.includes("data-add-element-component"));
  assert.ok(source.includes('type: "component"'));
  assert.ok(source.includes('ownerComponent?.type === "canvas" && item.source?.type === "component"'));
  assert.ok(source.includes('isCanvasComponentPlacement ? "" : `<label class="field">Component'));
  assert.ok(source.includes('if (item.source?.type === "component") return sourceTitle'));
  assert.ok(source.includes("data-canvas-preview-quality"));
  assert.ok(source.includes("data-preview-quality-label"));
  assert.ok(source.includes('quality === "auto" ? "low" : quality === "low" ? "full" : "auto"'));
  assert.ok(source.includes("internal Canvas raster follows the visible preview size"));
  assert.ok(!source.includes('data-update="${base}.canvas.previewQuality"'));
  assert.ok(source.includes("data-add-canvas-frame"));
  assert.ok(source.includes("data-set-route-source-node"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.ok(source.includes('catalogItemsInSnapshot("component", ordinaryComponents(state))'));
  assert.ok(source.includes('filter((component) => component.type !== "canvas")'));
  assert.ok(!source.includes("data-set-route-frame"));
  assert.ok(source.includes("state.recordingFrames || []"));
  assert.ok(!source.includes("component.canvas?.frames"));
  assert.ok(!source.includes("Surface sample rects"));
  assert.ok(!source.includes("Canvas sample rect"));
  assert.ok(!source.includes("data-add-canvas-layer"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(!source.includes('data-update="${base}.x"'));
});

test("compact text lists share one full-width item generator", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(source.includes("function textListItemTemplate("));
  assert.match(source, /function canvasFramePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(source, /function selectablePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(source, /function chainItemRowTemplate[\s\S]*?const row = textListItemTemplate\(/);
  assert.ok(style.includes(".text-list-item {"));
  assert.match(style, /\.text-list-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?border: 1px solid var\(--line\);/);
  assert.match(style, /\.text-list-item\.has-leading\.has-remove \{[\s\S]*?var\(--text-list-leading-size\)[\s\S]*?var\(--text-list-remove-size\)/);
  assert.match(style, /\.text-list-item \.text-list-remove \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(style, /\.text-list-item \.text-list-remove \{[\s\S]*?justify-content: center;/);
  assert.match(style, /\.text-list-item:hover \{[\s\S]*?background:/);
  assert.match(style, /button\.text-list-main:hover \{[\s\S]*?background: transparent;/);
  assert.ok(!style.includes(".surface-pills .list-select.is-selected"));
});

test("Live expands Canvas component placements into referenced element controls", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("live-referenced-component"));
  assert.ok(source.includes("createLiveComponentView(referencedComponent, state)"));
  assert.ok(source.includes("liveUnifiedChainTemplate(referencedView.chain, referencedComponent.id, state, nextAncestry)"));
  assert.ok(source.includes("!ancestry.has(referencedComponent.id)"));
});

test("project settings expose component upscaling and native-resolution post filters", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

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
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes('data-settings-update="render.componentTexture.width"'));
  assert.ok(source.includes('data-settings-update="render.componentTexture.height"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.mode"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxWidth"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxHeight"'));
  assert.ok(source.includes("Auto · projected pixel demand"));
  assert.ok(source.includes("it never changes component dimensions"));
  assert.ok(!source.includes('data-settings-update="render.surfaceWidth"'));
  assert.ok(!source.includes('data-settings-update="render.surfaceHeight"'));
});

test("project settings expose camera capture preferences", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("data-camera-preset"));
  assert.ok(source.includes('data-settings-update="render.camera.width"'));
  assert.ok(source.includes('data-settings-update="render.camera.height"'));
  assert.ok(source.includes('data-settings-update="render.camera.facingMode"'));
  assert.ok(source.includes('data-settings-update="render.camera.mirrored"'));
  assert.ok(source.includes('data-settings-update="render.camera.maxResolution"'));
});

test("project settings keep one modal DOM and patch tab values in place", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes('if (!host.querySelector("[data-settings-modal]"))'));
  assert.ok(source.includes("function syncSettingsModal(host, state)"));
  assert.ok(source.includes("function bindSettingsModalControls(host)"));
  assert.ok(source.includes('data-settings-tab="outputs"'));
  assert.ok(source.includes('data-settings-tab="camera"'));
  assert.ok(source.includes('data-settings-tab="rendering"'));
  assert.ok(source.includes('data-configured-output-list'));
  assert.ok(!source.includes("settingsScroll"));
});

test("scrub changes are sent to live output on the next animation frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
});

test("opening an output from Scene takes that Scene live before opening the Live-driven popup", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("store.selectLiveScene(state.ui.selectedSceneId);"));
  assert.ok(controllerSource.includes('buildOutputUrl("output", { outputId: output.id })'));
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

  assert.ok(shellSource.includes('id="output-menu"'));
  assert.ok(controllerSource.includes("data-open-output-id"));
  assert.ok(!controllerSource.includes("data-open-all-outputs"));
  assert.ok(controllerSource.includes("outputs.length === 1"));
  assert.ok(controllerSource.includes("dataset.outputsSignature"));
  assert.ok(controllerSource.includes("render.outputs.${index}.width"));
  assert.ok(controllerSource.includes("data-add-output"));
});

test("topbar shows separate active-renderer CPU and GPU work timers", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="cpu-time"'));
  assert.ok(shellSource.includes('id="gpu-time"'));
  assert.ok(shellSource.includes('id="cpu-time-text">0.0 ms'));
  assert.ok(shellSource.includes('id="gpu-time-text">--'));
  assert.ok(!shellSource.includes('id="cpu-time-text">CPU'));
  assert.ok(!shellSource.includes('id="gpu-time-text">GPU'));
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
  assert.match(styleSource, /\.work-time-pill #gpu-time-text[\s\S]*?white-space: nowrap;/);
  assert.ok(rendererSource.includes('getExtension("EXT_disjoint_timer_query_webgl2")'));
  assert.ok(rendererSource.includes('getExtension("EXT_disjoint_timer_query")'));
  assert.ok(rendererSource.includes("this.pruneRenderCaches();\n    this.gpuTimer.sealFrame"));
  assert.ok(rendererSource.includes("gpuSupported: this.gpuTimer.supported"));
  assert.ok(previewSource.includes("draft.metrics.previewGpuMs = metrics.gpuMs || 0"));
});

test("topbar metric readouts reserve stable widths", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".cost-pill #render-cost-text {\n  width: 4ch;"));
  assert.ok(source.includes(".work-time-pill #cpu-time-text,\n.work-time-pill #gpu-time-text {\n  width: 6ch;"));
  assert.ok(source.includes("#output-status-text {\n  display: inline-block;\n  width: 7ch;"));
  assert.ok(source.includes("font-variant-numeric: tabular-nums;"));
});

test("list thumbnails crop to fill and brighten their grayscale state", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const templates = readFileSync(new URL("../js/control/template-utils.js", import.meta.url), "utf8");
  assert.ok(templates.includes('<div class="component-thumbnail"><img'));
  assert.match(source, /\.component-thumbnail,\n\.component-card-empty \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?overflow: hidden;/);
  assert.match(source, /\.component-thumbnail img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.ok(source.includes("filter: grayscale(1) contrast(1.16) brightness(1.08);"));
});

test("media cards use one full-width text column without the generic icon inset", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".media-element-card {\n  grid-template-columns: minmax(0, 1fr);"));
  assert.match(source, /\.media-element-card > \.component-thumbnail,\n\.media-element-card > \.media-picker-placeholder \{\n  grid-column: 1;\n  grid-row: 3;/);
});

test("component picker cards use the same thumbnail layout as media cards", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(source, /Components[\s\S]*?<div class="element-grid media-element-grid">[\s\S]*?class="element-card media-element-card" data-add-element-component=/);
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
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const modelControls = controllerSource.slice(
    controllerSource.indexOf("function modelSourceControlsTemplate"),
    controllerSource.indexOf("function generatorParamControlsTemplate")
  );

  assert.ok(modelControls.includes("model-param-list"));
  assert.ok(modelControls.includes("Depth scale"));
  assert.ok(modelControls.includes("Visible depth"));
  assert.ok(modelControls.includes("params.visibleDepth"));
  assert.ok(modelControls.includes("Wire thickness"));
  assert.ok(!modelControls.includes("field-pair"));
  assert.ok(styleSource.includes(".model-param-list"));
});

test("seed params stay internal and are not rendered as sliders", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('param?.id !== "seed"'));
  assert.ok(controllerSource.includes("const visible = visibleParamControls(params);"));
  assert.ok(controllerSource.includes("paramControlsTemplate(component.params"));
  assert.ok(controllerSource.includes("paramControlsTemplate(params"));
});
