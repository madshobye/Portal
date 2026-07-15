import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";

test("range params render as label plus slider without numeric value text", () => {
  const sharedRange = rangeTemplate("Opacity", "compositions.0.opacity", 0.42);
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
    minPath: "compositions.0.chain.1.params.hueMin",
    maxPath: "compositions.0.chain.1.params.hueMax",
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

test("composition panel exposes frame shape and relative resolution controls", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('data-set-path="${base}.frameShape"'));
  assert.ok(controllerSource.includes('data-set-path="${base}.resolutionScale"'));
  assert.ok(controllerSource.includes('["landscape", "Landscape"]'));
  assert.ok(controllerSource.includes('["portrait", "Portrait"]'));
  assert.ok(controllerSource.includes('["square", "Square"]'));
  assert.ok(controllerSource.includes("const scaleOptions = [0.5, 1, 2];"));
  assert.ok(controllerSource.includes("composition-frame-summary"));
  assert.ok(styleSource.includes(".composition-option-grid"));
});

test("scene surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes('const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"]'));
  assert.ok(source.includes("Projection fit"));
  assert.ok(source.includes("sceneBase}.projectionFit"));
  assert.ok(source.includes('rangeTemplate("Feather", `${surfaceBase}.feather`'));
  assert.ok(source.indexOf("Projection fit") < source.indexOf("compositionAssignmentTemplate(sceneBase"));
});

test("composition catalogs expose shared local filtering", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("compositionFilterTemplate"));
  assert.ok(source.includes("data-composition-filter-card"));
  assert.ok(source.includes("bindCompositionFilters"));
  assert.ok(style.includes(".composition-filter-field"));
  assert.ok(style.includes("[data-composition-filter-card][hidden]"));
  assert.ok(style.includes("display: none !important;"));
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
  assert.ok(source.includes("if (revealCanvasAfterDraw)"));
  assert.ok(controllerSource.includes('if (reason === "workspace")'));
  assert.ok(controllerSource.includes("render(state);"));
});

test("canvas uses the shared chain and exposes recording frames as scene routes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("compositionUnifiedChainTemplate(composition, state, base)"));
  assert.ok(source.includes('workspace === "compose" || workspace === "canvas" ? "composition"'));
  assert.ok(source.includes("data-add-element-composition"));
  assert.ok(source.includes('type: "composition"'));
  assert.ok(source.includes('ownerComposition?.type === "canvas" && item.source?.type === "composition"'));
  assert.ok(source.includes('isCanvasCompositionPlacement ? "" : `<label class="field">Composition'));
  assert.ok(source.includes('if (item.source?.type === "composition") return sourceTitle'));
  assert.ok(source.includes("canvas.previewQuality"));
  assert.ok(source.includes("Auto · preview size"));
  assert.ok(source.includes("data-add-canvas-frame"));
  assert.ok(source.includes("data-set-route-source-node"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.ok(source.includes("const compositions = ordinaryCompositions(state)"));
  assert.ok(source.includes('filter((composition) => composition.type !== "canvas")'));
  assert.ok(!source.includes("data-set-route-frame"));
  assert.ok(source.includes("state.recordingFrames || []"));
  assert.ok(!source.includes("composition.canvas?.frames"));
  assert.ok(!source.includes("Surface sample rects"));
  assert.ok(!source.includes("Canvas sample rect"));
  assert.ok(!source.includes("data-add-canvas-layer"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(!source.includes('data-update="${base}.x"'));
});

test("Live expands Canvas composition placements into referenced element controls", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("live-referenced-composition"));
  assert.ok(source.includes("createLiveCompositionView(referencedComposition, state)"));
  assert.ok(source.includes("liveUnifiedChainTemplate(referencedView.chain, referencedComposition.id, state, nextAncestry)"));
  assert.ok(source.includes("!ancestry.has(referencedComposition.id)"));
});

test("project settings expose composition upscaling and native-resolution post filters", () => {
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
  assert.ok(controllerSource.includes("These filters run at the composition’s full target resolution after upscaling."));
});

test("scrub changes are sent to live output on the next animation frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
});

test("popup outputs keep Live scene selection while accepting edits from every workspace", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('buildOutputUrl("output", { initialSceneId, outputId: output.id })'));
  assert.ok(controllerSource.includes("store.selectLiveScene(button.dataset.liveScene)"));
  assert.ok(bridgeSource.includes("store.getLiveRenderState?.()"));
  assert.ok(bridgeSource.includes("targetClientId"));
  assert.ok(bridgeSource.includes("initialSceneAccepted"));
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
  assert.ok(controllerSource.includes("data-open-all-outputs"));
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
  assert.ok(controllerSource.includes("profile?.compositionWallMs ?? profile?.compositionMs"));
  assert.ok(controllerSource.includes("CPU render work:"));
  assert.ok(controllerSource.includes("GPU render work:"));
  assert.ok(!controllerSource.includes('`CPU ${formatTimeMs'));
  assert.ok(!controllerSource.includes('`GPU ${formatTimeMs'));
  assert.ok(controllerSource.includes('sample?.type === "composition"'));
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
  assert.ok(templates.includes('<div class="composition-thumbnail"><img'));
  assert.match(source, /\.composition-thumbnail,\n\.composition-card-empty \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?overflow: hidden;/);
  assert.match(source, /\.composition-thumbnail img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.ok(source.includes("filter: grayscale(1) contrast(1.16) brightness(1.08);"));
});

test("media cards use one full-width text column without the generic icon inset", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".media-element-card {\n  grid-template-columns: minmax(0, 1fr);"));
  assert.match(source, /\.media-element-card > \.composition-thumbnail,\n\.media-element-card > \.media-picker-placeholder \{\n  grid-column: 1;\n  grid-row: 3;/);
});

test("composition picker cards use the same thumbnail layout as media cards", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.match(source, /Compositions[\s\S]*?<div class="element-grid media-element-grid">[\s\S]*?class="element-card media-element-card" data-add-element-composition=/);
});

test("workspace view buttons are compact icons with accessible names", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  for (const label of ["Compositions", "Canvas", "Scenes", "Live"]) {
    assert.ok(shellSource.includes(`title="${label}" aria-label="${label}"`));
    assert.ok(!shellSource.includes(`<span>${label}</span>`));
  }
  assert.ok(!shellSource.includes('data-workspace="mapping"'));
  const projectButtonIndex = shellSource.indexOf('id="open-folder-main"');
  const viewSwitchIndex = shellSource.indexOf('class="workspace-switch workspace-view-switch"');
  const closeProjectIndex = shellSource.indexOf('id="close-project"');
  const topActionsIndex = shellSource.indexOf('class="top-actions"');
  const liveButtonIndex = shellSource.indexOf('class="icon-buttonish workspace-live-button"');
  assert.ok(projectButtonIndex < viewSwitchIndex && viewSwitchIndex < closeProjectIndex);
  assert.ok(topActionsIndex < liveButtonIndex);
  assert.equal((shellSource.slice(viewSwitchIndex, closeProjectIndex).match(/data-workspace=/g) || []).length, 3);
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
