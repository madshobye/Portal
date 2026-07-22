import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createInitialState,
  createStartupProjectTemplate,
  directOutputSurfaceId,
  sanitizeState,
} from "../js/domain/models.js";

test("startup project provides three Components, two Scenes, and one user Surface", () => {
  const template = createStartupProjectTemplate();
  const components = template.components.filter((component) => component.type !== "scene");
  const scenes = template.components.filter((component) => component.type === "scene");

  assert.deepEqual(components.map((component) => component.name), ["Comp 1", "Comp 2", "Comp 3"]);
  assert.deepEqual(scenes.map((component) => component.name), ["Scene 1", "Scene 2"]);
  assert.equal(components[0].chain.length, 1);
  assert.ok([...components.slice(1), ...scenes].every((component) => component.chain.length === 0));
  assert.deepEqual(template.mapping.surfaces.map((surface) => surface.name), ["Srf 1"]);
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
});

test("empty-folder loading explicitly seeds a fresh startup state", () => {
  const source = readFileSync(
    new URL("../js/services/project-folder-service.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /createInitialState\(\{ startupTemplate: true \}\)/);
});
