import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createInitialState,
  createStartupProjectTemplate,
  directOutputSurfaceId,
  sanitizeState,
} from "../js/domain/models.js";

test("startup project provides a built-in procedural composition tour", () => {
  const template = createStartupProjectTemplate();
  const components = template.components.filter((component) => component.type !== "scene");
  const scenes = template.components.filter((component) => component.type === "scene");

  assert.deepEqual(components.map((component) => component.name), ["Comp 1", "Comp 2", "Comp 3"]);
  assert.deepEqual(scenes.map((component) => component.name), ["Scene 1", "Scene 2"]);
  assert.deepEqual(
    components.map((component) => component.chain.map((item) => item.source?.generatorId || item.componentId)),
    [["testPattern"], ["plasma"], ["text", "heartbeatPulse"]]
  );
  assert.equal(components[1].chain[0].source.params.speed, 0.65);
  assert.equal(components[1].chain[0].source.params.motionMode, undefined);
  assert.equal(components[2].chain[0].source.params.text, "# VJ1\nLIVE TEXT");
  assert.equal(components[2].chain[1].params.amount, 0.35);

  assert.deepEqual(
    scenes.map((scene) => scene.chain.map((item) => item.source.componentId)),
    [[components[1].id, components[2].id], [components[1].id]]
  );
  assert.ok(scenes.every((scene) => scene.chain.every((item) => item.source.type === "component")));
  assert.deepEqual(template.mapping.surfaces.map((surface) => surface.name), ["Srf 1"]);
  assert.deepEqual(
    template.mapping.surfaces.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [{ x: 0.423, y: 0.297, width: 0.154, height: 0.407 }]
  );
  assert.equal(template.selectedComponentId, components[0].id);
  assert.equal(template.selectedSceneId, scenes[0].id);
});

test("startup project derives Output 1 beside its authored projection Surface", () => {
  const state = sanitizeState(createInitialState({ startupTemplate: true }));
  const mapping = state.mappings.find((candidate) => candidate.id === state.ui.selectedMappingId);
  const direct = mapping.surfaces.filter((surface) => surface.destination?.type === "direct");
  const mapped = mapping.surfaces.filter((surface) => surface.destination?.type !== "direct");

  assert.deepEqual(direct.map((surface) => surface.id), [directOutputSurfaceId("output-main")]);
  assert.equal(direct[0].enabled, false);
  assert.deepEqual(mapped.map((surface) => surface.name), ["Srf 1"]);
  assert.equal(state.ui.workspaceSelectionIds.component, state.components[0].id);
  assert.equal(state.ui.workspaceSelectionIds.scene, state.components[3].id);
  assert.equal(state.ui.live.selectedSceneId, state.components[3].id);
  assert.equal(state.ui.live.transitionDuration, 1.2);
  assert.equal(state.ui.live.paramFadeDuration, 0.9);
  assert.equal(state.ui.mappingTestPattern, false);
});

test("empty-folder loading explicitly seeds a fresh startup state", () => {
  const source = readFileSync(
    new URL("../js/services/project-folder-service.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /createInitialState\(\{ startupTemplate: true \}\)/);
});
