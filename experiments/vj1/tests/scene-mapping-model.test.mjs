import test from "node:test";
import assert from "node:assert/strict";

import {
  applyMappingForEditing,
  createInitialState,
  createLiveRenderState,
  createLiveScenePreviewState,
  createMappingFromState,
  createSceneComponent,
  directOutputSurfaceId,
  sanitizeState,
} from "../js/domain/models.js";
import { createAppState } from "../js/app-state.js";
import { compileLiveProjectionProgram } from "../js/domain/live-projection-program.js?v=live-projection-program-1";
import { materializeLiveProgramSurfaceRoutes } from "../js/domain/scene-routing.js";

function sceneMappingFixture() {
  const state = createInitialState();
  const source = state.components.find((component) => !component.systemRole && component.type !== "scene");
  const firstScene = createSceneComponent(0, source.id);
  const secondScene = createSceneComponent(1, source.id);
  state.components.push(firstScene, secondScene);
  state.mappings = [createMappingFromState(state, "Mapping 1")];
  state.ui.selectedMappingId = state.mappings[0].id;
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.selectedComponentId = firstScene.id;
  return sanitizeState(state);
}

test("Mapping preview chooses Live Scene without writing route bindings into Mapping", () => {
  const state = sceneMappingFixture();
  state.ui.mappingTestPattern = false;
  const mappingBefore = structuredClone(state.mappings[0]);

  const preview = applyMappingForEditing(state, state.mappings[0]);

  assert.ok(preview.surfaces.every((surface) => surface.componentId === state.ui.live.selectedSceneId));
  assert.deepEqual(state.mappings[0], mappingBefore);
  assert.ok(state.mappings[0].surfaces.every((surface) => !Object.hasOwn(surface, "componentId")));
  assert.ok(state.mappings[0].surfaces.every((surface) => !Object.hasOwn(surface, "sourceNodeId")));
});

test("Mapping test pattern is a compiled preview source rather than authored Surface data", () => {
  const state = sceneMappingFixture();
  state.ui.mappingTestPattern = true;
  const preview = applyMappingForEditing(state, state.mappings[0]);

  assert.ok(preview.surfaces.every((surface) => surface.componentId === "vj1-system-mapping-test-pattern"));
  assert.ok(preview.mappings[0].surfaces.every((surface) => !Object.hasOwn(surface, "componentId")));
});

test("Live Scene materialization keeps Mapping geometry as its authored authority", () => {
  const state = sceneMappingFixture();
  state.mappings[0].surfaces[0].x = 0.23;
  state.mappings[0].surfaces[0].width = 0.41;
  const mappingBefore = structuredClone(state.mappings[0]);

  const renderState = createLiveRenderState(state);

  assert.equal(renderState.surfaces[0].componentId, state.ui.live.selectedSceneId);
  assert.equal(renderState.surfaces[0].x, 0.23);
  assert.equal(renderState.surfaces[0].width, 0.41);
  assert.equal(renderState.surfaces[0].sceneCrop, true);
  assert.deepEqual(state.mappings[0], mappingBefore);
});

test("Live can put an ordinary Component over the shared Scene space", () => {
  const state = sceneMappingFixture();
  const component = state.components.find((candidate) => !candidate.systemRole && candidate.type !== "scene");
  state.ui.live.selectedComponentId = component.id;

  const output = createLiveRenderState(state);
  const preview = createLiveScenePreviewState(state);

  assert.ok(output.surfaces.every((surface) => surface.componentId === component.id));
  assert.ok(output.surfaces.every((surface) => surface.sceneCrop === true));
  assert.ok(output.surfaces.every((surface) => surface.sourceFit === "cover"));
  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.surfaces[0].componentId, component.id);
  assert.equal(preview.surfaces[0].id, directOutputSurfaceId(preview.render.outputs[0].id));
});

test("Live Surface patches replace only the chosen destination", () => {
  const store = createAppState(sceneMappingFixture());
  const initial = store.getState();
  const [firstSurface, secondSurface] = initial.mappings[0].surfaces;
  const component = initial.components.find((candidate) => !candidate.systemRole && candidate.type !== "scene");
  const overallId = initial.ui.live.selectedComponentId;

  store.selectLivePreviewSurface(firstSurface.id);
  store.selectLiveComponent(component.id);

  const current = store.getState();
  assert.equal(current.ui.live.selectedComponentId, overallId);
  assert.equal(current.ui.live.surfacePatches[firstSurface.id], component.id);
  assert.equal(current.ui.live.surfacePatches[secondSurface.id], undefined);
  const patched = compileLiveProjectionProgram(current).currentRoutes.surfaces.find((surface) => surface.id === firstSurface.id);
  assert.equal(patched.componentId, component.id);
  assert.equal(patched.sceneCrop, false);
  assert.equal(patched.projectionFit, "cover");
});

test("clearing a Surface patch restores Overall routing without changing Mapping", () => {
  const store = createAppState(sceneMappingFixture());
  const initial = store.getState();
  const surface = initial.mappings[0].surfaces[0];
  const component = initial.components.find((candidate) => !candidate.systemRole && candidate.type !== "scene");
  const mappingBefore = structuredClone(initial.mappings[0]);

  store.selectLivePreviewSurface(surface.id);
  store.selectLiveComponent(component.id);
  assert.equal(store.clearLiveSurfacePatch(surface.id), true);

  const current = store.getState();
  assert.equal(current.ui.live.surfacePatches[surface.id], undefined);
  assert.equal(
    compileLiveProjectionProgram(current).currentRoutes.surfaces.find((route) => route.id === surface.id).componentId,
    current.ui.live.selectedComponentId
  );
  assert.deepEqual(current.mappings[0], mappingBefore);
});

test("Overall Live monitor remains one unprojected direct route", () => {
  const state = sceneMappingFixture();
  state.render.sceneAspectRatio = 4 / 3;
  state.render.outputs.push({ id: "output-2", name: "Output 2", aspectRatio: 9 / 16 });
  state.ui.live.previewSurfaceId = "__mapping__";

  const preview = createLiveScenePreviewState(state);

  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.render.outputs.length, 1);
  assert.equal(preview.render.outputs[0].aspectRatio, 4 / 3);
  assert.equal(preview.surfaces[0].destination.type, "direct");
  assert.equal(state.render.outputs.length, 2);
});

test("surface transitions use current geometry at both endpoints", () => {
  const state = sceneMappingFixture();
  const [surface] = state.mappings[0].surfaces;
  const scenes = state.components.filter((component) => component.type === "scene");
  surface.x = 0.61;
  surface.y = 0.17;
  surface.width = 0.27;
  surface.height = 0.52;
  state.ui.live.selectedSceneId = scenes[1].id;
  state.ui.live.selectedComponentId = scenes[1].id;
  state.ui.live.previewSurfaceId = surface.id;
  const previousRoutes = materializeLiveProgramSurfaceRoutes(state, scenes[0], state.mappings[0]);
  previousRoutes.surfaces[0] = { ...previousRoutes.surfaces[0], x: 0.02, width: 0.9 };
  state.ui.live.transition = {
    id: "surface-transition",
    fromTargetId: scenes[0].id,
    fromSurfaceRoutes: previousRoutes,
    fromComponentOverrides: {},
    startedAtMs: Date.now() - 10,
    durationMs: 1000,
    surfaceId: surface.id,
  };

  const preview = createLiveScenePreviewState(state);
  const current = preview.surfaces.find((route) => route.id === surface.id);
  const previous = preview.liveTransition.fromState.surfaces.find((route) => route.id === surface.id);
  for (const key of ["x", "y", "width", "height"]) assert.equal(previous[key], current[key], key);
  assert.equal(previous.componentId, scenes[0].id);
  assert.equal(current.componentId, scenes[1].id);
});

test("Overall Scene transitions keep identical monitor geometry and presentation", () => {
  const state = sceneMappingFixture();
  const scenes = state.components.filter((component) => component.type === "scene");
  state.ui.live.selectedSceneId = scenes[1].id;
  state.ui.live.selectedComponentId = scenes[1].id;
  state.ui.live.previewSurfaceId = "__mapping__";
  state.ui.live.transition = {
    id: "overall-transition",
    fromTargetId: scenes[0].id,
    fromSurfaceRoutes: materializeLiveProgramSurfaceRoutes(state, scenes[0], state.mappings[0]),
    fromComponentOverrides: {},
    startedAtMs: Date.now() - 10,
    durationMs: 1000,
  };

  const preview = createLiveScenePreviewState(state);
  const current = preview.surfaces[0];
  const previous = preview.liveTransition.fromState.surfaces[0];
  for (const key of ["x", "y", "width", "height", "projectionFit"]) assert.equal(previous[key], current[key], key);
  assert.deepEqual(preview.liveTransition.fromState.render.outputs, preview.render.outputs);
  assert.equal(previous.componentId, scenes[0].id);
  assert.equal(current.componentId, scenes[1].id);
});
