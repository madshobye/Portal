import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMappingForEditing,
  createSceneComponent,
  createInitialState,
  createLiveRenderState,
  createLiveScenePreviewState,
  createMappingFromState,
  directOutputSurfaceId,
  sanitizeState,
} from "../js/domain/models.js";
import { createAppState } from "../js/app-state.js";

function sceneMappingFixture() {
  const state = createInitialState();
  const component = state.components[0];
  const first = createSceneComponent(0, component.id);
  const second = createSceneComponent(1, component.id);
  state.components.push(first, second);
  state.mappings = [createMappingFromState(state, "Mapping 1")];
  state.ui.selectedMappingId = state.mappings[0].id;
  const frameId = state.frames[0].id;
  state.mappings[0].surfaces[0].frameSlotId = frameId;
  state.mappings[0].surfaces[0].outputFrameId = frameId;
  state.ui.live.selectedSceneId = first.id;
  return sanitizeState(state);
}

test("Mapping preview prefers the Live Scene, then the Scene editor selection", () => {
  const state = createInitialState();
  const ordinary = state.components.find((component) => component.type !== "scene" && !component.systemRole);
  const scenes = [
    createSceneComponent(0, ordinary.id),
    createSceneComponent(1, ordinary.id),
  ];
  state.components.push(...scenes);
  state.mappings = [createMappingFromState(state, "Mapping 1")];
  state.ui.selectedMappingId = state.mappings[0].id;
  state.ui.mappingTestPattern = false;
  state.ui.workspaceSelectionIds.scene = scenes[1].id;

  state.ui.live.selectedSceneId = scenes[0].id;
  state.ui.live.selectedComponentId = scenes[0].id;
  let preview = applyMappingForEditing(state, state.mappings[0]);
  assert.equal(preview.surfaces[0].componentId, scenes[0].id);

  state.ui.live.selectedComponentId = ordinary.id;
  preview = applyMappingForEditing(state, state.mappings[0]);
  assert.equal(preview.surfaces[0].componentId, scenes[1].id);

  state.ui.live.overallSourceCleared = true;
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  preview = applyMappingForEditing(state, state.mappings[0]);
  assert.equal(preview.surfaces[0].componentId, scenes[1].id);
});

test("Live Scene selection resolves Mapping frame slots without mutating Mapping geometry", () => {
  const state = sceneMappingFixture();
  const mappingBefore = structuredClone(state.mappings[0].snapshot);
  const scenes = state.components.filter((component) => component.type === "scene");
  state.ui.live.selectedSceneId = scenes[1].id;
  const renderState = createLiveRenderState(state);
  assert.equal(renderState.surfaces[0].componentId, scenes[1].id);
  assert.equal(renderState.surfaces[0].outputFrameId, state.mappings[0].surfaces[0].frameSlotId);
  assert.equal(renderState.ui.selectedMappingId, state.mappings[0].id);
  assert.deepEqual(state.mappings[0].snapshot, mappingBefore);
});

test("each Scene owns Frame content and fit while Mapping retains the frame slot", () => {
  const state = sceneMappingFixture();
  const scene = state.components.find((component) => component.type === "scene");
  const component = state.components.find((candidate) => candidate.type !== "scene");
  const frame = scene.scene.frames.find((entry) => entry.frameId === state.mappings[0].surfaces[0].frameSlotId);
  frame.componentId = component.id;
  frame.fit = "contain";
  const renderState = createLiveRenderState(state);
  assert.equal(renderState.surfaces[0].componentId, component.id);
  assert.equal(renderState.surfaces[0].outputFrameId, "");
  assert.equal(renderState.surfaces[0].frameSlotId, frame.frameId);
  assert.equal(renderState.surfaces[0].frameFit, "contain");
  assert.equal(renderState.surfaces[0].frameFeather, undefined);
  assert.equal(renderState.surfaces[0].frameFitActive, true);
});

test("Live switches Scene compositions and keeps the selected Mapping", () => {
  const state = sceneMappingFixture();
  const store = createAppState(state);
  const scenes = store.getState().components.filter((component) => component.type === "scene");
  const mappingId = store.getState().ui.selectedMappingId;
  store.selectLiveScene(scenes[1].id);
  const current = store.getState();
  assert.equal(current.ui.live.selectedSceneId, scenes[1].id);
  assert.equal(current.ui.selectedMappingId, mappingId);
  assert.equal(store.getLiveRenderState().surfaces[0].componentId, scenes[1].id);
});

test("Live can select an ordinary Component as a cover-fitted Mapping target", () => {
  const state = sceneMappingFixture();
  const selectedSceneId = state.ui.live.selectedSceneId;
  state.ui.live.componentOverrides = { "scene-child": { opacity: 0.25 } };
  state.ui.live.sceneOverrides[selectedSceneId] = structuredClone(state.ui.live.componentOverrides);
  const store = createAppState(state);
  const component = store.getState().components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const mappingId = store.getState().ui.selectedMappingId;

  store.selectLiveComponent(component.id);

  const current = store.getState();
  const output = store.getLiveRenderState();
  const preview = createLiveScenePreviewState(current);
  assert.equal(current.ui.live.selectedComponentId, component.id);
  assert.deepEqual(current.ui.live.componentOverrides, {}, "Scene overrides do not leak into a standalone Component target");
  assert.deepEqual(current.ui.live.sceneOverrides[selectedSceneId], { "scene-child": { opacity: 0.25 } });
  assert.equal(current.ui.selectedMappingId, mappingId);
  assert.equal(output.surfaces[0].componentId, component.id);
  assert.equal(output.surfaces[0].frameFit, "cover");
  assert.equal(output.surfaces[0].frameFitActive, true);
  assert.equal(output.surfaces[0].outputFrameId, "");
  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.render.outputs.length, 1);
  assert.equal(preview.surfaces[0].id, directOutputSurfaceId(preview.render.outputs[0].id));
  assert.equal(preview.surfaces[0].componentId, component.id);
  assert.equal(preview.render.outputs[0].aspectRatio, 16 / 9);
});

test("Overall Component selection preserves explicit Surface patches and rebuilds every other route as cover", () => {
  const state = sceneMappingFixture();
  const store = createAppState(state);
  const initial = store.getState();
  const [patchedSurface, ordinarySurface] = initial.mappings[0].surfaces;
  const components = initial.components.filter((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const patchedComponent = {
    ...structuredClone(components[0]),
    id: "component-persisted-surface-patch",
    name: "Persisted Surface Patch",
  };
  store.update((draft) => draft.components.push(patchedComponent), "add-component");

  store.selectLivePreviewSurface(patchedSurface.id);
  store.selectLiveComponent(patchedComponent.id);
  store.selectLivePreviewSurface("__mapping__");
  store.selectLiveComponent(components[0].id);

  const live = store.getState().ui.live;
  const routes = live.surfaceRoutes.surfaces;
  assert.equal(live.surfacePatches[patchedSurface.id], patchedComponent.id);
  assert.equal(routes.find((surface) => surface.id === patchedSurface.id).componentId, patchedComponent.id);
  const ordinaryRoute = routes.find((surface) => surface.id === ordinarySurface.id);
  assert.equal(ordinaryRoute.componentId, components[0].id);
  assert.equal(ordinaryRoute.frameFit, "cover");
  assert.equal(ordinaryRoute.frameFitActive, true);
});

test("embedded Live Surface preview shows existing routes without applying the selected source", () => {
  const state = sceneMappingFixture();
  const surfaceId = state.mappings[0].surfaces[1].id;
  state.ui.live.previewSurfaceId = surfaceId;
  const before = structuredClone(state.ui.live.surfaceRoutes);

  const preview = createLiveScenePreviewState(state);

  assert.deepEqual(preview.surfaces, before.surfaces);
  assert.equal(preview.ui.selectedSurfaceId, surfaceId);
  assert.deepEqual(state.ui.live.surfaceRoutes, before);
});

test("Live patches only the chosen Surface and retains independent assignments", () => {
  const state = sceneMappingFixture();
  const store = createAppState(state);
  const initial = store.getState();
  const [firstSurface, secondSurface] = initial.mappings[0].surfaces;
  const component = initial.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const scenes = initial.components.filter((candidate) => candidate.type === "scene");
  const overallId = initial.ui.live.selectedComponentId || initial.ui.live.selectedSceneId;

  store.selectLivePreviewSurface(firstSurface.id);
  assert.equal(store.getState().ui.live.patchSourceId, "");
  store.selectLiveComponent(component.id);
  const afterFirstPatch = store.getState();
  assert.equal(afterFirstPatch.ui.live.selectedComponentId || afterFirstPatch.ui.live.selectedSceneId, overallId);
  assert.equal(afterFirstPatch.ui.live.surfacePatches[firstSurface.id], component.id);
  const firstPatchRoute = afterFirstPatch.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === firstSurface.id);
  assert.equal(firstPatchRoute.componentId, component.id);
  assert.equal(firstPatchRoute.outputFrameId, "", "an explicit Component patch must not inherit the Scene Frame crop");
  assert.equal(firstPatchRoute.frameFitActive, false);

  store.selectLivePreviewSurface(secondSurface.id);
  assert.equal(store.getState().ui.live.patchSourceId, "", "changing destination must not carry the previous source");
  store.selectLiveScene(scenes[1].id);
  const mixed = store.getState();
  assert.equal(mixed.ui.live.surfacePatches[firstSurface.id], component.id);
  assert.equal(mixed.ui.live.surfacePatches[secondSurface.id], scenes[1].id);
  assert.equal(mixed.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === firstSurface.id).componentId, component.id);
  const scenePatchRoute = mixed.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === secondSurface.id);
  assert.equal(scenePatchRoute.componentId, scenes[1].id);
  assert.equal(scenePatchRoute.outputFrameId, "", "an explicit Surface patch must not inherit the Scene Frame crop");
  assert.equal(scenePatchRoute.frameFitActive, false);
  assert.equal(createLiveRenderState(mixed).surfaces.find((surface) => surface.id === firstSurface.id).componentId, component.id);

  store.selectLivePreviewSurface("__mapping__");
  store.selectLiveScene(scenes[1].id);
  const overall = store.getState();
  assert.deepEqual(overall.ui.live.surfacePatches, {
    [firstSurface.id]: component.id,
    [secondSurface.id]: scenes[1].id,
  }, "Overall source changes must preserve explicit per-Surface assignments");
  assert.equal(overall.ui.live.selectedSceneId, scenes[1].id);
});

test("clearing one Live Surface patch restores Overall routing without touching other patches", () => {
  const store = createAppState(sceneMappingFixture());
  const initial = store.getState();
  const [firstSurface, secondSurface] = initial.mappings[0].surfaces;
  const overallFirstRouteComponentId = initial.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === firstSurface.id).componentId;
  const component = initial.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const scenes = initial.components.filter((candidate) => candidate.type === "scene");

  store.selectLivePreviewSurface(firstSurface.id);
  store.selectLiveComponent(component.id);
  store.selectLivePreviewSurface(secondSurface.id);
  store.selectLiveScene(scenes[1].id);

  assert.equal(store.clearLiveSurfacePatch(firstSurface.id), true);
  const current = store.getState();
  assert.equal(current.ui.live.surfacePatches[firstSurface.id], undefined);
  assert.equal(current.ui.live.surfacePatches[secondSurface.id], scenes[1].id);
  assert.equal(
    current.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === firstSurface.id).componentId,
    overallFirstRouteComponentId,
    "the cleared Surface follows the current Overall target again"
  );
  assert.equal(
    current.ui.live.surfaceRoutes.surfaces.find((surface) => surface.id === secondSurface.id).componentId,
    scenes[1].id,
    "other explicit Surface patches remain independent"
  );
  assert.equal(store.clearLiveSurfacePatch(firstSurface.id), false, "an unpatched Surface has nothing to clear");
});

test("clearing the Overall Component restores its Scene and preserves Surface patches", () => {
  const store = createAppState(sceneMappingFixture());
  const initial = store.getState();
  const surface = initial.mappings[0].surfaces[0];
  const component = initial.components.find((candidate) => candidate.type !== "scene" && !candidate.systemRole);
  const scene = initial.components.find((candidate) => candidate.type === "scene");

  store.selectLivePreviewSurface(surface.id);
  store.selectLiveComponent(component.id);
  store.selectLivePreviewSurface("__mapping__");
  store.selectLiveComponent(component.id);
  assert.equal(store.clearLiveOverallComponent(), true);

  const current = store.getState();
  assert.equal(current.ui.live.selectedComponentId, scene.id);
  assert.equal(current.ui.live.surfacePatches[surface.id], component.id);
  assert.equal(current.ui.live.surfaceRoutes.surfaces.find((route) => route.id === surface.id).componentId, component.id);
  assert.equal(store.clearLiveOverallComponent(), false);
});

test("embedded Live Overall Mapping is an unprojected source preview", () => {
  const state = sceneMappingFixture();
  state.render.sceneAspectRatio = 4 / 3;
  state.render.outputs.push({ id: "output-2", name: "Output 2", aspectRatio: 9 / 16 });
  state.ui.live.previewSurfaceId = "__mapping__";
  const before = structuredClone(state.ui.live.surfaceRoutes);
  const preview = createLiveScenePreviewState(state);

  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.render.outputs.length, 1);
  assert.equal(preview.render.outputs[0].aspectRatio, preview.render.sceneAspectRatio);
  assert.equal(preview.surfaces[0].id, directOutputSurfaceId(preview.render.outputs[0].id));
  assert.equal(preview.surfaces[0].destination.type, "direct");
  const normalizedPreview = sanitizeState(preview);
  assert.equal(normalizedPreview.render.outputs.length, 1);
  assert.equal(normalizedPreview.surfaces.length, 1);
  assert.equal(normalizedPreview.surfaces[0].id, directOutputSurfaceId(normalizedPreview.render.outputs[0].id));
  assert.equal(normalizedPreview.surfaces[0].componentId, state.ui.live.selectedSceneId);
  assert.equal(state.render.outputs.length, 2, "the cloned monitor must not alter configured project outputs");
  assert.deepEqual(state.ui.live.surfaceRoutes, before);
  assert.equal(state.ui.live.previewSurfaceId, "__mapping__");
});

test("embedded Live retains the authored Scene transition on its direct monitor route", () => {
  const state = sceneMappingFixture();
  const scenes = state.components.filter((component) => component.type === "scene");
  state.ui.live.selectedSceneId = scenes[1].id;
  state.ui.live.transition = {
    id: "transition-a",
    fromSceneId: scenes[0].id,
    fromSurfaceRoutes: { surfaces: [] },
    fromComponentOverrides: {},
    startedAtMs: Date.now() - 10,
    durationMs: 1000,
  };

  const preview = createLiveScenePreviewState(state);
  assert.equal(preview.liveTransition?.id, "transition-a");
  assert.equal(preview.liveTransition?.fromState?.surfaces?.[0]?.componentId, scenes[0].id);
  assert.equal(preview.surfaces[0]?.componentId, scenes[1].id);
});
