import test from "node:test";
import assert from "node:assert/strict";
import {
  createSceneComponent,
  createInitialState,
  createLiveRenderState,
  createLiveScenePreviewState,
  createMappingFromState,
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
  assert.equal(preview.surfaces[0].componentId, component.id);
  assert.equal(preview.surfaces[0].projectionFit, "cover");
});

test("embedded Live monitors the selected Scene directly while Output retains Mapping", () => {
  const state = sceneMappingFixture();
  const scene = state.components.filter((component) => component.type === "scene")[1];
  state.ui.live.selectedSceneId = scene.id;

  const preview = createLiveScenePreviewState(state);
  const output = createLiveRenderState(state);

  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.surfaces[0].componentId, scene.id);
  assert.equal(preview.surfaces[0].destination.type, "direct");
  assert.equal(preview.surfaces[0].projectionFit, "cover");
  assert.equal(output.surfaces[0].frameSlotId, state.mappings[0].surfaces[0].frameSlotId);
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
  assert.equal(preview.surfaces[0].componentId, scenes[1].id);
});
