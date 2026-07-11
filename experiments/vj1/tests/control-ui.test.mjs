import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { rangeTemplate } from "../js/control/template-utils.js";

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

test("scrub changes are sent to live output on the next animation frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
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
  assert.ok(modelControls.includes("Wire thickness"));
  assert.ok(!modelControls.includes("field-pair"));
  assert.ok(styleSource.includes(".model-param-list"));
});
