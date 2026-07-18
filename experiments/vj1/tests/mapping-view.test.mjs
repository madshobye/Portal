import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createInitialState } from "../js/domain/models.js?v=render-coordinate-scope-3";
import { mappingInletsTemplate, mappingInspectorTemplate, mappingStudioTemplate } from "../js/control/mapping-view.js";

test("mapping view owns graph templates outside the control orchestrator", () => {
  const state = createInitialState();
  const component = state.components[0];
  const studio = mappingStudioTemplate(state);
  const inspector = mappingInspectorTemplate(component, state);
  const inlets = mappingInletsTemplate(component);
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(studio, /class="mapping-stage"/);
  assert.match(studio, /class="mapping-node/);
  assert.match(inspector, /class="sculpt-card mapping-inspector"/);
  assert.match(inspector, /Generators[\s\S]*Effects/);
  assert.match(inlets, /class="node-chip"/);
  assert.match(controller, /from "\.\/mapping-view\.js\?v=[^"]+"/);
  assert.doesNotMatch(controller, /function mappingStudioTemplate\(/);
  assert.doesNotMatch(controller, /function mappingInspectorTemplate\(/);
  assert.doesNotMatch(controller, /function mappingInletsTemplate\(/);
});
