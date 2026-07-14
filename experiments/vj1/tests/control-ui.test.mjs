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

test("scrub changes are sent to live output on the next animation frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
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

test("workspace view buttons are compact icons with accessible names", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  for (const label of ["Compositions", "Canvas", "Scenes", "Nodes", "Live"]) {
    assert.ok(shellSource.includes(`title="${label}" aria-label="${label}"`));
    assert.ok(!shellSource.includes(`<span>${label}</span>`));
  }
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
