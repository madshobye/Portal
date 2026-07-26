import test from "node:test";
import assert from "node:assert/strict";

import { createAppState } from "../js/app-state.js";
import {
  createComponentEffect,
  createComponentGroup,
  createComponentLayer,
  createSceneComponent,
  createDefaultComponent,
  createEmptyMappingFromState,
  createInitialState,
  createLiveRenderState,
  createLiveScenePreviewState,
  createMappingFromState,
  sceneSourceNodeId,
} from "../js/domain/models.js";
import { compileLiveProjectionProgram } from "../js/domain/live-projection-program.js";
import { liveSurfaceVisible } from "../js/domain/live-ui-state.js";
import { applyLiveRenderPatches, createLiveRenderPatch } from "../js/domain/live-render-patch.js";
import { compileComponentPatch } from "../js/graph/legacy-chain-render-projection.js";
import { planCompositorInputs, planPatchExecution } from "../js/graph/patch-planner.js";
import { DataStoreNode, ObservableDataStore } from "../js/libraries/data-store/data-store/index.js";
import { isMappingProjectionPresentation } from "../js/output/output-presentation-runtime.js";
import { signalLoadMeter } from "../js/metrics/signal-load-meter.js";

test("one structurally shared world root is published read-only per emission", () => {
  const store = createAppState(createInitialState());
  const before = store.getState();
  const firstSnapshots = [];
  const secondSnapshots = [];
  store.subscribe((state) => firstSnapshots.push(state));
  store.subscribe((state) => secondSnapshots.push(state));

  store.update((draft) => {
    draft.ui.selectedChainItemId = "shared-snapshot-test";
  }, "snapshot-test");

  const current = store.getState();
  assert.strictEqual(firstSnapshots.at(-1), secondSnapshots.at(-1));
  assert.strictEqual(firstSnapshots.at(-1), current);
  assert.notStrictEqual(current, before);
  assert.notStrictEqual(current.ui, before.ui);
  assert.strictEqual(current.components, before.components);
  assert.strictEqual(current.media, before.media);
  const snapshot = store.snapshotState();
  assert.deepEqual(snapshot, current);
  assert.notStrictEqual(snapshot, current);
  assert.deepEqual(structuredClone(current), current);
});

test("render patches collected inside a world transaction publish as plain data", () => {
  const store = createAppState(createInitialState());
  const renderPatches = [];
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => {
    observedEvent = event;
  });

  store.update((draft) => {
    const item = draft.components[0].chain[0];
    item.transform = { ...item.transform, x: 0.25, y: -0.5 };
    renderPatches.push({
      componentId: draft.components[0].id,
      path: "chain.0.transform",
      value: item.transform,
    });
  }, {
    reason: "scrub:chain-transform",
    renderPatches,
  });

  assert.deepEqual(observedEvent.renderPatches[0].value, {
    x: 0.25,
    y: -0.5,
    scale: 1,
    rotation: 0,
  });
  assert.doesNotThrow(() => structuredClone(observedEvent));
});

test("observable data store node owns shared snapshot publication", () => {
  const engine = new ObservableDataStore({ count: 0 });
  const first = [];
  const second = [];
  engine.subscribe((value) => first.push(value));
  engine.subscribe((value) => second.push(value));
  engine.update((draft) => { draft.count++; }, { reason: "increment" });

  assert.strictEqual(first.at(-1), second.at(-1));
  assert.deepEqual(first.at(-1), { count: 1 });
  assert.match(DataStoreNode.parts[0].source, /class ObservableDataStore/);
  assert.equal(DataStoreNode.capabilities.includes("data-store"), true);
});

test("UI-only updates preserve project data and emit an explicit UI scope", () => {
  const store = createAppState(createInitialState());
  const before = store.getState();
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => {
    observedEvent = event;
  });

  store.updateUi((ui) => {
    ui.debugPreview = !ui.debugPreview;
  }, "toggle-preview-test");

  const after = store.getState();
  assert.equal(observedEvent.reason, "toggle-preview-test");
  assert.equal(observedEvent.scope, "ui");
  assert.equal(after.ui.debugPreview, !before.ui.debugPreview);
  assert.deepEqual(after.components, before.components);
  assert.deepEqual(after.mappings, before.mappings);
  assert.deepEqual(after.surfaces, before.surfaces);
});

test("workspace navigation is a structurally shared UI command, not a project autosave", () => {
  const store = createAppState();
  const before = store.getState();
  let emitted = null;
  const unsubscribe = store.subscribe((state, reason, change) => {
    if (reason === "workspace") emitted = { state, change };
  });

  assert.equal(store.setWorkspace("scene"), true);
  unsubscribe();
  const after = store.getState();

  assert.equal(emitted?.change.scope, "ui");
  assert.equal(emitted?.change.history, "none");
  assert.equal(after.ui.workspace, "scene");
  assert.notStrictEqual(after.ui, before.ui);
  assert.deepEqual(after.components, before.components);
  assert.deepEqual(after.media, before.media);
  assert.deepEqual(after.mappings, before.mappings);
  assert.equal(store.setWorkspace("scene"), false, "selecting the active workspace is a no-op");
});

test("Mapping selection changes only the editor projection", () => {
  const initial = createInitialState();
  const mapping = createEmptyMappingFromState(initial, "Mapping 2");
  initial.mappings.push(mapping);
  const store = createAppState(initial);
  const authoredMappings = store.getState().mappings;
  let emitted = null;
  const unsubscribe = store.subscribe((_state, reason, change) => {
    if (reason === "select-mapping") emitted = change;
  });

  store.selectMapping(mapping.id);
  unsubscribe();

  assert.equal(store.getState().ui.selectedMappingId, mapping.id);
  assert.equal(emitted?.scope, "ui");
  assert.equal(emitted?.history, "none");
  assert.deepEqual(store.getState().mappings, authoredMappings);
});

test("Live projection inspection is UI-only and does not reroute the program", () => {
  const initial = createInitialState();
  const scene = createSceneComponent(0, initial.components[0].id);
  initial.components.push(scene);
  initial.ui.workspace = "live";
  initial.ui.live.selectedSceneId = scene.id;
  initial.ui.live.selectedComponentId = scene.id;
  const store = createAppState(initial);
  const before = store.getState();
  const surface = before.mappings[0].surfaces.find((item) => item.destination?.type !== "direct");
  store.updateUi((ui) => {
    ui.previewViewports.live = { zoom: 2.5, x: 120, y: -80, fit: "manual" };
  }, "test:manual-live-preview-view");
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => { observedEvent = event; });

  store.selectLivePreviewSurface(surface.id);

  const after = store.getState();
  assert.equal(observedEvent.reason, "live:preview-surface");
  assert.equal(observedEvent.scope, "ui");
  assert.equal(after.ui.live.previewSurfaceId, surface.id);
  assert.equal(after.ui.live.patchSourceId, "");
  assert.deepEqual(after.ui.previewViewports.live, { zoom: 1, x: 0, y: 0, fit: "frame" });
  assert.deepEqual(after.mappings, before.mappings);
  assert.deepEqual(compileLiveProjectionProgram(after).currentRoutes, compileLiveProjectionProgram(before).currentRoutes);
  assert.deepEqual(
    createLiveScenePreviewState(after).surfaces,
    compileLiveProjectionProgram(after).currentRoutes.surfaces,
    "an output selection presents the real compiled output program on the retained Preview canvas",
  );
  const preview = createLiveScenePreviewState(after);
  assert.equal(preview.livePreviewPresentation, "mapping");
  assert.equal(preview.ui.selectedSurfaceId, surface.id);
  assert.equal(isMappingProjectionPresentation({ mode: "live", state: preview }), true);
});

test("Live Scene and projection preferences restore atomically without history", () => {
  const initial = createInitialState();
  const firstScene = createSceneComponent(0, initial.components[0].id);
  const secondScene = createSceneComponent(1, initial.components[0].id);
  initial.components.push(firstScene, secondScene);
  initial.ui.live.selectedSceneId = firstScene.id;
  initial.ui.live.selectedComponentId = firstScene.id;
  initial.ui.live.previewSurfaceId = "__mapping__";
  const surface = initial.mappings[0].surfaces[0];
  const store = createAppState(initial);
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => {
    if (event.reason === "live:preference-restore") observedEvent = event;
  });

  store.restoreLivePreference({
    sceneId: secondScene.id,
    previewSurfaceId: surface.id,
  });

  assert.equal(store.getState().ui.live.selectedSceneId, secondScene.id);
  assert.equal(store.getState().ui.live.selectedComponentId, secondScene.id);
  assert.equal(store.getState().ui.live.previewSurfaceId, surface.id);
  assert.deepEqual(
    store.getState().ui.previewViewports.live,
    { zoom: 1, x: 0, y: 0, fit: "frame" },
  );
  assert.equal(observedEvent?.scope, "live");
  assert.equal(observedEvent?.history, "none");
});

test("Scene Mapping preview monitors its mounted source while guiding the compiled output matrix", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  state.components.push(scene);
  state.ui.workspace = "live";
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.selectedComponentId = scene.id;
  state.ui.live.previewSurfaceId = "__mapping__";
  const program = compileLiveProjectionProgram(state);
  const preview = createLiveScenePreviewState(state);

  assert.equal(preview.surfaces.length, 1, "Scene Mapping uses one retained source-monitor route");
  assert.equal(preview.surfaces[0].componentId, scene.id);
  assert.equal(preview.livePreviewPresentation, "scene");
  assert.equal(isMappingProjectionPresentation({ mode: "live", state: preview }), false);
  assert.deepEqual(
    preview.livePreviewGuideSurfaces,
    program.currentRoutes.surfaces,
    "the monitor guides come from the same compiled matrix used by Output",
  );
});

test("Live output matrix presentation remains fixed across row selection and Scene changes", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  state.components.push(firstScene, secondScene);
  state.ui.workspace = "live";
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.selectedComponentId = firstScene.id;
  state.ui.live.previewSurfaceId = "__mapping__";
  const store = createAppState(state);
  const mapping = store.getState().mappings[0];
  const direct = mapping.surfaces.find((surface) => surface.destination?.type === "direct");
  const projected = mapping.surfaces.find((surface) => surface.destination?.type !== "direct");

  const assertFlatSceneMapping = (sceneId) => {
    const preview = createLiveScenePreviewState(store.getState());
    assert.equal(preview.livePreviewPresentation, "scene");
    assert.equal(preview.surfaces.length, 1);
    assert.equal(preview.surfaces[0].destination?.type, "direct");
    assert.equal(preview.surfaces[0].componentId, sceneId);
    assert.equal(preview.ui.selectedSurfaceId, "");
    assert.equal(isMappingProjectionPresentation({ mode: "live", state: preview }), false);
    if (preview.liveTransition) {
      assert.equal(preview.liveTransition.fromState.livePreviewPresentation, "scene");
      assert.equal(preview.liveTransition.fromState.surfaces.length, 1);
    }
  };
  const assertProjectedOutput = (surfaceId) => {
    const authored = store.getState();
    const preview = createLiveScenePreviewState(authored);
    assert.equal(preview.livePreviewPresentation, "mapping");
    assert.deepEqual(preview.surfaces, compileLiveProjectionProgram(authored).currentRoutes.surfaces);
    assert.equal(preview.ui.selectedSurfaceId, surfaceId);
    assert.equal(isMappingProjectionPresentation({ mode: "live", state: preview }), true);
  };

  assertFlatSceneMapping(firstScene.id);
  store.selectLivePreviewSurface(direct.id);
  assertProjectedOutput(direct.id);
  store.selectLivePreviewSurface(projected.id);
  assertProjectedOutput(projected.id);
  store.selectLivePreviewSurface("__mapping__");
  assertFlatSceneMapping(firstScene.id);

  store.selectLiveScene(secondScene.id);
  assert.equal(store.getState().ui.live.previewSurfaceId, "__mapping__");
  assertFlatSceneMapping(secondScene.id);

  store.selectLivePreviewSurface(projected.id);
  assertProjectedOutput(projected.id);
  store.selectLivePreviewSurface(direct.id);
  assertProjectedOutput(direct.id);
});

test("Live source selection targets exactly the selected output-matrix row", () => {
  const state = createInitialState();
  const overallScene = createSceneComponent(0, state.components[0].id);
  const directScene = createSceneComponent(1, state.components[0].id);
  const directComponent = createDefaultComponent(2);
  state.components.push(overallScene, directScene, directComponent);
  state.ui.live.selectedSceneId = overallScene.id;
  state.ui.live.selectedComponentId = overallScene.id;
  state.ui.live.previewSurfaceId = "__mapping__";
  const store = createAppState(state);
  const mapping = store.getState().mappings[0];
  const selectedSurface = mapping.surfaces.find((surface) => surface.destination?.type !== "direct");
  const fallbackSurface = mapping.surfaces.find((surface) =>
    surface.id !== selectedSurface.id && surface.destination?.type !== "direct"
  );

  store.selectLivePreviewSurface(selectedSurface.id);
  store.selectLiveComponent(directComponent.id);
  let current = store.getState();
  let routes = compileLiveProjectionProgram(current).currentRoutes.surfaces;
  assert.equal(current.ui.live.selectedComponentId, overallScene.id);
  assert.equal(current.ui.live.surfacePatches[selectedSurface.id], directComponent.id);
  assert.equal(routes.find((route) => route.id === selectedSurface.id).componentId, directComponent.id);
  assert.equal(routes.find((route) => route.id === fallbackSurface.id).componentId, overallScene.id);

  store.selectLiveScene(directScene.id);
  current = store.getState();
  routes = compileLiveProjectionProgram(current).currentRoutes.surfaces;
  assert.equal(current.ui.live.selectedComponentId, overallScene.id);
  assert.equal(current.ui.live.surfacePatches[selectedSurface.id], directScene.id);
  assert.equal(routes.find((route) => route.id === selectedSurface.id).componentId, directScene.id);
  assert.equal(routes.find((route) => route.id === fallbackSurface.id).componentId, overallScene.id);

  store.selectLivePreviewSurface("__mapping__");
  store.selectLiveComponent(directComponent.id);
  current = store.getState();
  routes = compileLiveProjectionProgram(current).currentRoutes.surfaces;
  assert.equal(current.ui.live.selectedComponentId, directComponent.id);
  assert.equal(current.ui.live.surfacePatches[selectedSurface.id], directScene.id);
  assert.equal(routes.find((route) => route.id === selectedSurface.id).componentId, directScene.id);
  assert.equal(routes.find((route) => route.id === fallbackSurface.id).componentId, directComponent.id);
  assert.equal(routes.find((route) => route.id === fallbackSurface.id).sceneCrop, true);
});

test("Live Surface visibility changes only the routed program and survives source changes", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  state.components.push(firstScene, secondScene);
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.selectedComponentId = firstScene.id;
  const store = createAppState(state);
  const before = store.getState();
  const surface = before.mappings[0].surfaces.find((item) => item.destination?.type !== "direct");
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => { observedEvent = event; });

  assert.equal(store.toggleLiveSurfaceVisibility(surface.id), true);
  let after = store.getState();
  assert.equal(observedEvent.scope, "live");
  assert.equal(after.ui.live.surfaceVisibility[surface.id], false);
  assert.equal(compileLiveProjectionProgram(after).currentRoutes.surfaces.find((item) => item.id === surface.id).enabled, false);
  assert.equal(after.mappings[0].surfaces.find((item) => item.id === surface.id).enabled, before.mappings[0].surfaces.find((item) => item.id === surface.id).enabled);

  store.selectLiveScene(secondScene.id);
  after = store.getState();
  assert.equal(compileLiveProjectionProgram(after).currentRoutes.surfaces.find((item) => item.id === surface.id).enabled, false);
  assert.equal(createLiveRenderState(after).surfaces.find((item) => item.id === surface.id).enabled, false);
});

test("Scene Mapping visibility removes only fallback routes while preserving direct mounts and row state", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  const patchComponent = createDefaultComponent(2);
  state.components.push(scene, patchComponent);
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.selectedComponentId = scene.id;
  const store = createAppState(state);
  const mapping = store.getState().mappings[0];
  const patchedSurface = mapping.surfaces.find((item) => item.destination?.type !== "direct");

  store.selectLivePreviewSurface(patchedSurface.id);
  store.selectLiveComponent(patchComponent.id);
  store.selectLivePreviewSurface("__mapping__");
  const routesBefore = compileLiveProjectionProgram(store.getState()).currentRoutes;
  const visibilityBefore = structuredClone(store.getState().ui.live.surfaceVisibility);
  const patchesBefore = structuredClone(store.getState().ui.live.surfacePatches);
  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);

  let after = store.getState();
  assert.equal(after.ui.live.sceneMappingVisible, false);
  assert.deepEqual(after.ui.live.surfaceVisibility, visibilityBefore);
  assert.deepEqual(after.ui.live.surfacePatches, patchesBefore);
  assert.equal(after.ui.live.previewSurfaceId, "__mapping__", "route visibility does not change the selected Live output");
  assert.equal(after.ui.live.selectedComponentId, scene.id, "the overall source remains selected");
  assert.equal(after.ui.live.transition, null, "visibility changes do not create a transition snapshot");
  assert.equal(createLiveScenePreviewState(after).surfaces[0].componentId, "", "the Scene Mapping monitor is blank");
  const hiddenRoutes = compileLiveProjectionProgram(after).currentRoutes.surfaces;
  assert.equal(
    hiddenRoutes.find((item) => item.id === patchedSurface.id).componentId,
    patchComponent.id,
    "an explicitly mounted Surface remains independent of Scene Mapping",
  );
  assert.equal(
    hiddenRoutes.find((item) => item.id === patchedSurface.id).enabled,
    true,
    "the explicitly mounted Surface retains its own visibility",
  );
  assert.equal(
    hiddenRoutes
      .filter((item) => item.id !== patchedSurface.id)
      .every((item) => item.componentId === "" && item.sourceNodeId === ""),
    true,
    "every unpatched destination detaches the indirect Scene Mapping source",
  );
  assert.deepEqual(createLiveRenderState(after).surfaces, hiddenRoutes);

  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);
  after = store.getState();
  assert.equal(after.ui.live.sceneMappingVisible, true);
  assert.equal(after.ui.live.previewSurfaceId, "__mapping__");
  assert.deepEqual(compileLiveProjectionProgram(after).currentRoutes, routesBefore);
  assert.equal(createLiveScenePreviewState(after).surfaces[0].componentId, scene.id);
  assert.equal(createLiveRenderState(after).surfaces.some((item) => item.enabled !== false), true);
});

test("Scene Mapping and Surface visibility state are independent while fallback routing is gated", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  const patchComponent = createDefaultComponent(2);
  state.components.push(scene, patchComponent);
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.selectedComponentId = scene.id;
  const store = createAppState(state);
  store.update((draft) => {
    const direct = draft.mappings[0].surfaces.find((surface) => surface.destination?.type === "direct");
    direct.enabled = true;
  }, "test:enable-direct-output");
  const mapping = store.getState().mappings[0];
  const directOutput = mapping.surfaces.find((surface) => surface.destination?.type === "direct");

  assert.ok(directOutput);
  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);
  assert.equal(
    compileLiveProjectionProgram(store.getState()).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).enabled,
    true,
    "Scene Mapping is not a master switch for Direct Output",
  );
  assert.equal(
    compileLiveProjectionProgram(store.getState()).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).componentId,
    "",
    "an unpatched Direct Output loses the indirect Overall source",
  );

  assert.equal(store.toggleLiveSurfaceVisibility(directOutput.id), true);
  let after = store.getState();
  assert.equal(after.ui.live.sceneMappingVisible, false);
  assert.equal(after.ui.live.surfaceVisibility[directOutput.id], false);
  assert.equal(
    compileLiveProjectionProgram(after).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).enabled,
    false,
  );
  assert.equal(
    createLiveRenderState(after).surfaces.find((surface) => surface.id === directOutput.id).enabled,
    false,
  );

  assert.equal(store.toggleLiveSurfaceVisibility(directOutput.id), true);
  after = store.getState();
  assert.equal(after.ui.live.sceneMappingVisible, false);
  assert.equal(after.ui.live.surfaceVisibility[directOutput.id], true);
  assert.equal(
    createLiveRenderState(after).surfaces.find((surface) => surface.id === directOutput.id).enabled,
    true,
  );
  assert.equal(
    createLiveRenderState(after).surfaces.find((surface) => surface.id === directOutput.id).componentId,
    "",
    "re-enabling the row does not silently restore a disabled fallback source",
  );

  store.selectLivePreviewSurface(directOutput.id);
  store.selectLiveComponent(patchComponent.id);
  after = store.getState();
  assert.equal(
    compileLiveProjectionProgram(after).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).componentId,
    patchComponent.id,
    "an explicit direct-output patch remains independent of Scene Mapping",
  );

  assert.equal(store.clearLiveSurfacePatch(directOutput.id), true);
  after = store.getState();
  assert.equal(
    compileLiveProjectionProgram(after).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).componentId,
    "",
    "removing the explicit mount returns to transparent while Scene Mapping is disabled",
  );

  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);
  after = store.getState();
  assert.equal(
    compileLiveProjectionProgram(after).currentRoutes.surfaces.find((surface) => surface.id === directOutput.id).componentId,
    scene.id,
    "re-enabling Scene Mapping rematerializes the retained Overall source",
  );
});

test("restored hidden Scene Mapping cannot make an unpatched Surface eye inherit route transparency", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  state.components.push(scene);
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.selectedComponentId = scene.id;
  state.ui.live.sceneMappingVisible = false;
  const store = createAppState(state);
  const surface = store.getState().mappings[0].surfaces
    .find((candidate) => candidate.destination?.type !== "direct" && candidate.enabled !== false);

  assert.ok(surface);
  assert.equal(
    compileLiveProjectionProgram(store.getState()).currentRoutes.surfaces
      .find((route) => route.id === surface.id).enabled,
    false,
    "the indirect route is transparent",
  );
  assert.equal(store.getState().ui.live.surfaceVisibility[surface.id], undefined);
  assert.equal(
    liveSurfaceVisible(surface, store.getState().ui.live),
    true,
    "the row eye still follows its Mapping default after refresh",
  );

  assert.equal(store.toggleLiveSurfaceVisibility(surface.id), true);
  assert.equal(
    store.getState().ui.live.surfaceVisibility[surface.id],
    false,
    "the first click after refresh hides the row instead of recreating an already-visible override",
  );
});

test("hiding Scene Mapping suppresses its fallback routes and Overall transition", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  state.components.push(firstScene, secondScene);
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.selectedComponentId = firstScene.id;
  state.ui.live.transitionDuration = 1;
  const store = createAppState(state);

  store.selectLiveScene(secondScene.id);
  assert.ok(compileLiveProjectionProgram(store.getState()).transition);
  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);

  const program = compileLiveProjectionProgram(store.getState());
  assert.equal(program.transition, null);
  assert.equal(program.previewTransition, null);
  assert.equal(
    program.currentRoutes.surfaces
      .filter((surface) => !store.getState().ui.live.surfacePatches?.[surface.id])
      .every((surface) => surface.componentId === "" && surface.sourceNodeId === ""),
    true,
  );
});

test("Scene Mapping defaults to the first Surface when excluded but remains explicitly selectable in Live", () => {
  const state = createAppState(createInitialState()).getState();
  const firstEnabledSurface = state.mappings[0].surfaces.find((surface) => surface.destination?.type === "direct");
  for (const surface of state.mappings[0].surfaces) surface.enabled = false;
  firstEnabledSurface.enabled = true;
  state.ui.live.sceneMappingInLive = false;
  delete state.ui.live.sceneMappingVisible;
  state.ui.live.previewSurfaceId = "";

  const store = createAppState(state);
  let normalized = store.getState();
  assert.equal(normalized.ui.live.previewSurfaceId, firstEnabledSurface.id);
  assert.equal(normalized.ui.live.sceneMappingVisible, false, "the absent session override follows Mapping's persisted default");

  store.selectLivePreviewSurface("__mapping__");
  normalized = store.getState();
  assert.equal(normalized.ui.live.previewSurfaceId, "__mapping__");
  assert.equal(normalized.ui.live.sceneMappingInLive, false);
});

test("Mapping sets the Scene Mapping default while Live can override its current visibility", () => {
  const store = createAppState(createInitialState());
  const directSurface = store.getState().mappings[0].surfaces.find((surface) => surface.destination?.type === "direct");
  store.update((draft) => {
    draft.mappings[0].surfaces.find((surface) => surface.id === directSurface.id).enabled = true;
  }, "test:enable-direct-output");

  assert.equal(store.setSceneMappingInLive(false), true);
  let state = store.getState();
  assert.equal(state.ui.live.sceneMappingInLive, false);
  assert.equal(state.ui.live.sceneMappingVisible, false);
  assert.equal(
    state.ui.live.previewSurfaceId,
    directSurface.id,
    "when the fallback source is disabled, Live selects an independently visible destination",
  );

  assert.equal(store.toggleLiveSurfaceVisibility("__mapping__"), true);
  state = store.getState();
  assert.equal(state.ui.live.sceneMappingInLive, false, "Live does not rewrite the persisted Mapping default");
  assert.equal(state.ui.live.sceneMappingVisible, true);
});

test("Live Surface patch assignment and removal use the configured transition", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  const patchComponent = createDefaultComponent(2);
  state.components.push(scene, patchComponent);
  const authoredSurface = state.mappings[0].surfaces.find((item) => item.destination?.type !== "direct");
  authoredSurface.projectionFit = "contain";
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  state.ui.live.transitionId = "org.vj1.transition.soft-wipe";
  state.ui.live.transitionParameters = { softness: 0.2 };
  state.ui.live.transitionDuration = 1.25;
  const store = createAppState(state);

  store.selectLiveScene(scene.id);
  const surface = store.getState().mappings[0].surfaces.find((item) => item.destination?.type !== "direct");
  store.selectLivePreviewSurface(surface.id);
  store.selectLiveComponent(patchComponent.id);

  let after = store.getState();
  let previousRoute = after.ui.live.transition.fromSurfaceRoutes.surfaces.find((item) => item.id === surface.id);
  let currentRoute = compileLiveProjectionProgram(after).currentRoutes.surfaces.find((item) => item.id === surface.id);
  assert.equal(after.ui.live.transition.durationMs, 1250);
  assert.equal(previousRoute.componentId, scene.id);
  assert.equal(previousRoute.projectionFit, "contain");
  assert.equal(currentRoute.componentId, patchComponent.id);
  assert.equal(currentRoute.projectionFit, "contain");
  assert.equal(currentRoute.sceneCrop, false);
  assert.equal(currentRoute.sourceFitActive, false);
  const transitionRenderState = createLiveRenderState(after);
  assert.equal(transitionRenderState.liveTransition.transitionId, "org.vj1.transition.soft-wipe");
  assert.deepEqual(transitionRenderState.liveTransition.transitionParameters, { softness: 0.2 });
  assert.equal(
    transitionRenderState.liveTransition.fromState.surfaces.find((item) => item.id === surface.id).projectionFit,
    "contain",
    "progress zero retains the fit visible immediately before the patch"
  );
  assert.equal(
    transitionRenderState.surfaces.find((item) => item.id === surface.id).projectionFit,
    "contain",
    "the incoming patch keeps the selected Surface's authored fit"
  );

  store.selectLivePreviewSurface("__mapping__");
  assert.equal(store.clearLiveSurfacePatch(surface.id), true);
  after = store.getState();
  previousRoute = after.ui.live.transition.fromSurfaceRoutes.surfaces.find((item) => item.id === surface.id);
  currentRoute = compileLiveProjectionProgram(after).currentRoutes.surfaces.find((item) => item.id === surface.id);
  assert.equal(after.ui.live.transition.durationMs, 1250);
  assert.equal(previousRoute.componentId, patchComponent.id);
  assert.equal(currentRoute.componentId, scene.id);
  assert.equal(after.ui.live.transition.surfaceId, surface.id);
  assert.equal(createLiveScenePreviewState(after).liveTransition, undefined, "Overall preview ignores a Surface-only transition");
});

test("Live Surface patches can be removed while Overall is explicitly empty", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  const patchComponent = createDefaultComponent(2);
  state.components.push(scene, patchComponent);
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  const store = createAppState(state);

  store.selectLiveScene(scene.id);
  const surface = store.getState().mappings[0].surfaces.find((item) => item.destination?.type !== "direct");
  store.selectLivePreviewSurface(surface.id);
  store.selectLiveComponent(patchComponent.id);
  store.selectLivePreviewSurface("__mapping__");
  assert.equal(store.clearLiveOverallComponent(), true);

  let current = store.getState();
  assert.equal(current.ui.live.overallSourceCleared, true);
  assert.equal(current.ui.live.surfacePatches[surface.id], patchComponent.id);
  assert.equal(store.clearLiveSurfacePatch(surface.id), true);

  current = store.getState();
  assert.equal(current.ui.live.surfacePatches[surface.id], undefined);
  assert.equal(compileLiveProjectionProgram(current).currentRoutes.surfaces.find((route) => route.id === surface.id).componentId, "");
});

test("Overall Scene and Component changes share the configured transition policy", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  const liveComponent = createDefaultComponent(2);
  state.components.push(firstScene, secondScene, liveComponent);
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  state.ui.live.transitionDuration = 0.9;
  const store = createAppState(state);

  store.selectLiveScene(firstScene.id);
  store.selectLiveScene(secondScene.id);
  let after = store.getState();
  assert.equal(after.ui.live.transition.durationMs, 900);
  assert.equal(after.ui.live.transition.fromTargetId, firstScene.id);

  store.selectLiveComponent(liveComponent.id);
  after = store.getState();
  assert.equal(after.ui.live.transition.durationMs, 900);
  assert.equal(after.ui.live.transition.fromTargetId, secondScene.id);
});

test("Live Overall keeps Scene presentation geometry while covering an ordinary Component", () => {
  const state = createInitialState();
  state.render.sceneAspectRatio = 16 / 9;
  const portrait = createDefaultComponent(2);
  portrait.frameShape = "portrait";
  state.components.push(portrait);
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = portrait.id;
  const preview = createLiveScenePreviewState(state);

  assert.equal(preview.render.outputs.length, 1);
  assert.equal(preview.render.outputs[0].aspectRatio, 16 / 9);
  assert.equal(preview.surfaces[0].componentId, portrait.id);
  assert.equal(preview.surfaces[0].sourceFit, "cover");
  assert.equal(preview.surfaces[0].sourceFitActive, true);
  assert.notEqual(preview.surfaces[0].sourceAspect, 16 / 9);
});

test("mixed-aspect Overall transitions keep both endpoints inside one temporary Scene", () => {
  const state = createInitialState();
  state.render.sceneAspectRatio = 16 / 9;
  state.ui.live.transitionDuration = 1;
  state.ui.live.previewSurfaceId = "__mapping__";
  const scene = createSceneComponent(0, state.components[0].id);
  const portrait = createDefaultComponent(2);
  portrait.frameShape = "portrait";
  state.components.push(scene, portrait);
  const store = createAppState(state);

  store.selectLiveScene(scene.id);
  store.selectLiveComponent(portrait.id);
  const preview = createLiveScenePreviewState(store.getState());

  assert.equal(preview.livePreviewPresentation, "scene");
  assert.equal(preview.render.outputs[0].aspectRatio, 16 / 9);
  assert.equal(preview.surfaces.length, 1);
  assert.equal(preview.surfaces[0].componentId, portrait.id);
  assert.equal(preview.surfaces[0].sourceFit, "cover");
  assert.equal(preview.surfaces[0].sourceFitActive, true);
  assert.ok(preview.liveTransition);
  assert.equal(preview.liveTransition.fromState.livePreviewPresentation, "scene");
  assert.equal(preview.liveTransition.fromState.render.outputs[0].aspectRatio, 16 / 9);
  assert.equal(preview.liveTransition.fromState.surfaces.length, 1);
  assert.equal(preview.liveTransition.fromState.surfaces[0].componentId, scene.id);
});

test("Live transition snapshots retain source routes but use current Surface geometry", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  state.components.push(firstScene, secondScene);
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  state.ui.live.transitionDuration = 1;
  const store = createAppState(state);

  store.selectLiveScene(firstScene.id);
  store.selectLiveScene(secondScene.id);
  const current = store.getState();
  const authored = compileLiveProjectionProgram(current).currentRoutes.surfaces.find((surface) => surface.destination?.type !== "direct");
  const stale = current.ui.live.transition.fromSurfaceRoutes.surfaces.find((surface) => surface.id === authored.id);
  stale.x = authored.x + 0.25;
  stale.width = authored.width * 0.5;

  const rendered = createLiveRenderState(current);
  const fromSurface = rendered.liveTransition.fromState.surfaces.find((surface) => surface.id === authored.id);
  assert.equal(fromSurface.x, authored.x);
  assert.equal(fromSurface.width, authored.width);
  assert.equal(fromSurface.componentId, firstScene.id);
  assert.equal(rendered.surfaces.find((surface) => surface.id === authored.id).componentId, secondScene.id);
});

test("Live Scene selection structurally shares authored project collections", () => {
  const initial = createInitialState();
  const nextScene = createSceneComponent("Second Scene");
  initial.components.push(nextScene);
  let preparationCount = 0;
  const store = createAppState(initial, {
    prepareState(value) {
      preparationCount++;
      return value;
    },
  });
  const events = [];
  store.subscribe((_state, reason, event) => events.push({ reason, event }));

  store.selectLiveScene(nextScene.id);

  assert.equal(events.at(-1).reason, "live:scene");
  assert.equal(events.at(-1).event.scope, "live");
  assert.equal(preparationCount, 1, "Live selection bypasses whole-project normalization and package preparation");
  assert.equal(store.getState().ui.live.selectedSceneId, nextScene.id);
});

test("Live transition endpoints clone mutable render branches without cloning unrelated project collections", () => {
  const state = createInitialState();
  const firstScene = createSceneComponent(0, state.components[0].id);
  const secondScene = createSceneComponent(1, state.components[0].id);
  state.components.push(firstScene, secondScene);
  state.media.push({ id: "media/large.mov", name: "large.mov", type: "video", duration: 10 });
  state.ui.live.transitionDuration = 1;
  const store = createAppState(state);

  store.selectLiveScene(firstScene.id);
  store.selectLiveScene(secondScene.id);
  const current = store.getState();
  const rendered = createLiveScenePreviewState(current);

  assert.strictEqual(rendered.media, current.media);
  assert.strictEqual(rendered.nodes, current.nodes);
  assert.strictEqual(rendered.mappings, current.mappings);
  assert.notStrictEqual(rendered.components, current.components);
  assert.notStrictEqual(rendered.components[0].chain, current.components[0].chain);
  assert.ok(rendered.liveTransition?.fromState);
  assert.strictEqual(rendered.liveTransition.fromState.media, current.media);
  assert.strictEqual(rendered.liveTransition.fromState.nodes, current.nodes);
  assert.notStrictEqual(rendered.liveTransition.fromState.components, current.components);

  rendered.components[0].chain[0].source.params.renderQuality = 0.25;
  assert.notEqual(current.components[0].chain[0].source.params.renderQuality, 0.25);
});

test("removing an Overall source transitions to an explicitly empty program", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  const liveComponent = createDefaultComponent(2);
  state.components.push(scene, liveComponent);
  state.ui.live.selectedSceneId = "";
  state.ui.live.selectedComponentId = "";
  state.ui.live.transitionDuration = 0.75;
  const store = createAppState(state);

  store.selectLiveScene(scene.id);
  store.selectLiveComponent(liveComponent.id);
  assert.equal(store.clearLiveOverallComponent(), true);

  let after = store.getState();
  assert.equal(after.ui.live.overallSourceCleared, true);
  assert.equal(after.ui.live.selectedSceneId, "");
  assert.equal(after.ui.live.selectedComponentId, "");
  assert.equal(after.ui.live.transition.durationMs, 750);
  assert.equal(after.ui.live.transition.fromTargetId, liveComponent.id);
  assert.equal(compileLiveProjectionProgram(after).currentRoutes.surfaces.every((surface) => !surface.componentId), true);
  const renderState = createLiveRenderState(after);
  const previewState = createLiveScenePreviewState(after);
  assert.equal(renderState.surfaces.every((surface) => !surface.componentId), true);
  assert.equal(previewState.surfaces.every((surface) => !surface.componentId), true);
  assert.equal(previewState.liveTransition.fromState.surfaces.some((surface) => surface.componentId === liveComponent.id), true);

  store.selectLiveScene(scene.id);
  assert.equal(store.clearLiveOverallComponent(), true);
  after = store.getState();
  assert.equal(after.ui.live.overallSourceCleared, true);
  assert.equal(after.ui.live.transition.fromTargetId, scene.id);

  const sceneOnlyState = createInitialState();
  const sceneOnly = createSceneComponent(0, sceneOnlyState.components[0].id);
  sceneOnlyState.components.push(sceneOnly);
  sceneOnlyState.ui.live.selectedSceneId = sceneOnly.id;
  sceneOnlyState.ui.live.selectedComponentId = "";
  const sceneOnlyStore = createAppState(sceneOnlyState);
  assert.equal(sceneOnlyStore.clearLiveOverallComponent(), true);
  assert.equal(sceneOnlyStore.getState().ui.live.overallSourceCleared, true);
});

test("catalog markers cycle through star heart and pin across authored catalogs", () => {
  const state = createInitialState();
  const component = state.components[0];
  const mapping = createEmptyMappingFromState(state, "Marked mapping");
  const media = { id: "media/photo.png", name: "photo.png", type: "image", catalogMarker: 0 };
  state.mappings = [mapping];
  state.media = [media];
  const store = createAppState(state);

  for (const [kind, id, collection] of [
    ["component", component.id, "components"],
    ["mapping", mapping.id, "mappings"],
    ["media", media.id, "media"],
  ]) {
    assert.equal(store.cycleCatalogMarker(kind, id), true);
    assert.equal(store.getState()[collection].find((item) => item.id === id).catalogMarker, 1);
    store.cycleCatalogMarker(kind, id);
    assert.equal(store.getState()[collection].find((item) => item.id === id).catalogMarker, 2);
    store.cycleCatalogMarker(kind, id);
    assert.equal(store.getState()[collection].find((item) => item.id === id).catalogMarker, 3);
    store.cycleCatalogMarker(kind, id);
    assert.equal(store.getState()[collection].find((item) => item.id === id).catalogMarker, 0);
  }
});

test("component selection updates recent-use metadata through the local fast path", () => {
  const initial = createInitialState();
  const second = createDefaultComponent(1);
  initial.components.push(second);
  const store = createAppState(initial);
  const before = store.getState();
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => {
    observedEvent = event;
  });

  store.selectComponent(second.id);

  const after = store.getState();
  assert.equal(after.ui.selectedComponentId, second.id);
  assert.ok(after.components.find((component) => component.id === second.id).activity.lastUsedAt);
  assert.deepEqual(
    after.components.find((component) => component.id === before.components[0].id),
    before.components[0]
  );
  assert.equal(observedEvent.reason, "select-component");
  assert.equal(observedEvent.scope, "ui");
});

test("new Mappings begin with only the required disabled direct Surfaces", () => {
  const initial = createInitialState();
  const component = initial.components[0];
  initial.mappingCalibration = { surfaces: [{ id: initial.surfaces[0].id, x: 0.25 }] };
  const previousPhysicalSurfaceIds = initial.surfaces
    .filter((surface) => surface.destination?.type !== "direct")
    .map((surface) => surface.id);
  for (const surface of initial.surfaces) {
    surface.enabled = true;
    surface.componentId = component.id;
    surface.sourceNodeId = sceneSourceNodeId(component.id);
  }

  const empty = createEmptyMappingFromState(initial, "Blank");
  assert.ok(empty.surfaces.length > 0);
  assert.ok(empty.surfaces.every((surface) => surface.enabled === false));
  assert.ok(empty.surfaces.every((surface) => !Object.hasOwn(surface, "componentId")));
  assert.ok(empty.surfaces.every((surface) => !Object.hasOwn(surface, "sourceNodeId")));
  assert.ok(empty.surfaces.every((surface) => surface.destination?.type === "direct"));
  assert.ok(empty.surfaces.every((surface) => !previousPhysicalSurfaceIds.includes(surface.id)));
  assert.deepEqual(empty.calibration, {});

  const store = createAppState(initial);
  store.addMapping("Blank");
  const next = store.getState();
  const mapping = next.mappings.at(-1);
  assert.equal(mapping.name, "Blank");
  assert.equal(next.ui.selectedMappingId, mapping.id);
  assert.ok(next.surfaces.every((surface) => surface.enabled === false));
  assert.ok(next.surfaces.every((surface) => !Object.hasOwn(surface, "componentId")));
  assert.ok(next.surfaces.every((surface) => surface.destination?.type === "direct"));
  assert.deepEqual(mapping.calibration, {});
});

test("creating a Component never implicitly assigns it to empty Surfaces", () => {
  const store = createAppState(createInitialState());
  assert.ok(store.getState().surfaces.every((surface) => !surface.componentId));

  store.addComponent();

  assert.ok(store.getState().surfaces.every((surface) => !surface.componentId));
});

test("new Components start empty only after the visible Component list exceeds ten items", () => {
  const tenState = createInitialState();
  tenState.components = Array.from({ length: 10 }, (_, index) => createDefaultComponent(index));
  const tenStore = createAppState(tenState);
  tenStore.addComponent();
  assert.equal(tenStore.getState().components.at(-1).chain[0]?.source?.generatorId, "testPattern");

  const elevenState = createInitialState();
  elevenState.components = [
    ...Array.from({ length: 11 }, (_, index) => createDefaultComponent(index)),
    ...Array.from({ length: 3 }, (_, index) => createSceneComponent(index)),
  ];
  const elevenStore = createAppState(elevenState);
  elevenStore.addComponent();
  const added = elevenStore.getState().components.at(-1);
  assert.deepEqual(added.chain, []);
  assert.equal("source" in added, false);
  assert.equal("shaderChain" in added, false);
  assert.equal(elevenStore.getState().ui.selectedChainItemId, "");
});

test("an empty newly created Component accepts its first element immediately", () => {
  const initial = createInitialState();
  initial.components = Array.from({ length: 11 }, (_, index) => createDefaultComponent(index));
  const store = createAppState(initial);

  store.addComponent();
  const componentId = store.getState().ui.selectedComponentId;
  store.addChainSource(componentId, { type: "generator", generatorId: "gradient" });

  const added = store.getState().components.find((component) => component.id === componentId);
  assert.equal(added.chain.length, 1);
  assert.equal(added.chain[0].source.generatorId, "gradient");
  assert.equal("source" in added, false);
  assert.equal(store.getState().ui.selectedChainItemId, added.chain[0].id);
  const patch = compileComponentPatch(added);
  assert.equal(patch.nodes.filter((node) => node.role === "source").length, 1);
});

test("new media elements keep their catalog-derived name out of project properties", () => {
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const store = createAppState(initial);

  store.addChainSource(component.id, {
    type: "media",
    mediaId: "media/collections/projector/plate.png",
  });

  const added = store.getState().components
    .find((item) => item.id === component.id)
    .chain.find((item) => item.source?.params?.mediaId === "media/collections/projector/plate.png");
  assert.equal(added.name, "");
  assert.equal(added.source.generatorId, "mediaImage");
  assert.equal(added.source.type, "generator");
});

test("state normalization keeps Camera and Black as semantic visual generators", () => {
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const store = createAppState(initial);

  store.addChainSource(component.id, {
    type: "camera",
    instanceId: "camera-instance",
    params: { fit: "cover" },
  });
  store.addChainSource(component.id, {
    type: "black",
    instanceId: "black-instance",
  });

  const sources = store.getState().components
    .find((item) => item.id === component.id)
    .chain.map((item) => item.source);
  assert.equal(sources.at(-2).type, "generator");
  assert.equal(sources.at(-2).generatorId, "cameraInput");
  assert.equal(sources.at(-2).params.fit, "cover");
  assert.equal(sources.at(-1).type, "generator");
  assert.equal(sources.at(-1).generatorId, "black");
  assert.equal(sources.some((source) => ["camera", "black"].includes(source?.type)), false);
});

test("runtime metrics update without passing through project state normalization", () => {
  const store = createAppState(createInitialState());
  const before = store.getState();
  let observedEvent = null;
  store.subscribe((_state, _reason, event) => {
    observedEvent = event;
  });

  store.updateRuntime((metrics) => {
    metrics.clients = 2;
    metrics.fps = 60;
  }, "output-metrics");

  assert.deepEqual(store.getMetrics(), { ...before.metrics, clients: 2, fps: 60 });
  assert.deepEqual(store.getState().components, before.components);
  assert.equal(observedEvent.reason, "output-metrics");
  assert.equal(observedEvent.scope, "runtime");
});

test("Live slider updates use the lightweight live-only state path", () => {
  const store = createAppState();
  const componentId = store.getState().components[0].id;
  let change = null;
  store.subscribe((_state, _reason, event) => {
    if (event.reason === "scrub:live") change = event;
  });

  const livePatches = [
    { componentId, path: "opacity", value: 0.35 },
    { componentId, path: "transform.x", value: 0.4 },
    { componentId, path: "transform.scale", value: 1.5 },
  ];
  store.updateLive((draft) => {
    draft.ui.live.componentOverrides[componentId] = {
      opacity: 0.35,
      transform: { x: 0.4, scale: 1.5 },
    };
  }, { reason: "scrub:live", livePatches });

  assert.equal(change?.phase, "scrub");
  assert.deepEqual(change?.livePatches, livePatches);
  assert.equal(change?.scope, "live");
  const liveComponent = store.getLiveRenderState().components.find((item) => item.id === componentId);
  assert.equal(liveComponent.opacity, 0.35);
  assert.deepEqual(liveComponent.transform, { x: 0.4, y: 0, scale: 1.5, rotation: 0 });
});

test("Live render baseline materializes every optional slider patch target", () => {
  const state = createInitialState();
  const component = state.components[0];
  delete component.transform;
  component.chain.push(createComponentEffect("hsvAlphaKey"));
  component.chain.push(createComponentLayer(2, { type: "media", mediaId: "still.png" }));

  const baseline = createLiveRenderState(state);
  const result = applyLiveRenderPatches(baseline, [
    createLiveRenderPatch(component.id, "transform.scale", 1.25),
    createLiveRenderPatch(component.id, "chain.1.params.hueMin", 170),
    createLiveRenderPatch(component.id, "chain.2.source.params.alphaCut", 4),
  ]);

  assert.equal(result.applied, true);
  assert.equal(baseline.components[0].transform.scale, 1.25);
  assert.equal(baseline.components[0].chain[1].params.hueMin, 170);
  assert.equal(baseline.components[0].chain[2].source.params.alphaCut, 4);
  assert.equal(applyLiveRenderPatches(baseline, [
    createLiveRenderPatch(component.id, "transform.typo", 1),
  ]).applied, false, "unknown structural leaves remain invalid");
});

test("persistent scrubs retain one baseline and reconcile Live truth on commit", () => {
  const state = createInitialState();
  const component = state.components[0];
  component.opacity = 1;
  state.ui.live.componentOverrides[component.id] = { opacity: 0.25 };
  state.ui.live.sceneOverrides[state.ui.live.selectedSceneId] = state.ui.live.componentOverrides;
  const store = createAppState(state);

  store.update((draft) => { draft.components[0].opacity = 0.8; }, "scrub:components.0.opacity");
  store.update((draft) => { draft.components[0].opacity = 0.6; }, "scrub:components.0.opacity");
  assert.equal(store.getState().components[0].opacity, 0.6);
  assert.equal(store.getState().ui.live.componentOverrides[component.id].opacity, 0.25);

  store.update((draft) => { draft.components[0].opacity = 0.6; }, "update:components.0.opacity");
  assert.equal(store.getState().components[0].opacity, 0.6);
  assert.equal(store.getState().ui.live.componentOverrides[component.id]?.opacity, undefined);
});

test("render state uses the selected Mapping in Mapping workspace and selected Scene in Live", () => {
  const state = createInitialState();
  const mappingComponent = createDefaultComponent(0);
  mappingComponent.id = "component-mapping";
  const liveComponent = createDefaultComponent(1);
  liveComponent.id = "component-live";
  const liveScene = createSceneComponent(0, liveComponent.id);
  liveScene.id = "scene-live";
  state.components = [mappingComponent, liveComponent, liveScene];

  state.surfaces[0].componentId = mappingComponent.id;
  state.surfaces[0].sourceNodeId = sceneSourceNodeId(mappingComponent.id);
  const mapping = createMappingFromState(state, "Selected Mapping");
  state.mappings = [mapping];
  state.ui.workspace = "mapping";
  state.ui.selectedMappingId = mapping.id;
  state.ui.live.selectedSceneId = liveScene.id;

  const store = createAppState(state);
  assert.equal(store.getRenderState().surfaces[0].componentId, "vj1-system-mapping-test-pattern");

  store.setWorkspace("live");
  assert.equal(store.getRenderState().surfaces[0].componentId, liveScene.id);
});

function liveSceneMappingFixture() {
  const state = createInitialState();
  const source = state.components[0];
  const firstScene = createSceneComponent(0, source.id);
  const secondScene = createSceneComponent(1, source.id);
  state.components.push(firstScene, secondScene);
  const mapping = createMappingFromState(state, "Mapping 1");
  mapping.surfaces[0].projectionFit = "contain";
  state.mappings = [mapping];
  state.ui.selectedMappingId = mapping.id;
  state.ui.live.selectedSceneId = firstScene.id;
  return { state, source, firstScene, secondScene, mapping };
}

test("Mapping edits refresh Live without changing the selected Live Scene", () => {
  const { state, firstScene, mapping } = liveSceneMappingFixture();
  const store = createAppState(state);
  store.update((draft) => {
    draft.mappings[0].surfaces[0].opacity = 0.37;
  }, "mapping-edit");
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.equal(store.getState().ui.selectedMappingId, mapping.id);
  assert.equal(store.getLiveRenderState().surfaces[0].opacity, 0.37);
});

test("an empty Live selection initializes to the first authored Scene independently from Mapping", () => {
  const { state, firstScene, mapping } = liveSceneMappingFixture();
  state.ui.live.selectedSceneId = "";
  const store = createAppState(state);
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.equal(store.getState().ui.selectedMappingId, mapping.id);
});

test("Live Scene cuts restore and timed transitions keep the selected Mapping", () => {
  const { state, firstScene, secondScene, mapping } = liveSceneMappingFixture();
  const store = createAppState(state);
  store.selectLiveScene(secondScene.id);
  assert.equal(store.getState().ui.live.transition, null);
  assert.equal(store.getLiveRenderState().liveTransition, undefined);
  assert.equal(store.getState().ui.selectedMappingId, mapping.id);

  let observedEvent = null;
  store.subscribe((_snapshot, _reason, event) => {
    if (event.reason === "live:scene-restore") observedEvent = event;
  });
  store.restoreLiveScene(firstScene.id);
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.equal(observedEvent.scope, "live");
  assert.equal(observedEvent.history, "none");

  store.update((draft) => { draft.ui.live.transitionDuration = 1.5; }, "transition-duration");
  const activationStartedAt = Date.now();
  store.selectLiveScene(secondScene.id);
  const renderState = store.getLiveRenderState();
  assert.equal(renderState.liveTransition.durationMs, 1500);
  assert.equal(renderState.liveTransition.fromState.surfaces[0].projectionFit, "contain");
  assert.equal(renderState.surfaces[0].projectionFit, "contain");
  assert.ok(renderState.liveTransition.startedAtMs >= activationStartedAt + 50);
});

test("Live temporary overrides persist per authored Scene until explicitly reset", () => {
  const { state, source, firstScene, secondScene } = liveSceneMappingFixture();
  const store = createAppState(state);
  store.update((draft) => {
    draft.ui.live.componentOverrides[source.id] = { opacity: 0.25 };
  }, "live:update");
  store.selectLiveScene(secondScene.id);
  assert.deepEqual(store.getState().ui.live.componentOverrides, {});
  store.update((draft) => {
    draft.ui.live.componentOverrides[source.id] = { speed: 2 };
  }, "live:update");
  store.selectLiveScene(firstScene.id);
  assert.equal(store.getState().ui.live.componentOverrides[source.id].opacity, 0.25);
  store.resetLiveScene(firstScene.id);
  assert.deepEqual(store.getState().ui.live.componentOverrides, {});
  store.selectLiveScene(secondScene.id);
  assert.equal(store.getState().ui.live.componentOverrides[source.id].speed, 2);
});

test("persistent component edits overwrite conflicting Live params but retain unrelated temporary params", () => {
  const state = createInitialState();
  const scene = createMappingFromState(state, "Live scene");
  state.mappings = [scene];
  state.ui.live.selectedSceneId = scene.id;
  const componentId = state.components[0].id;
  const source = state.components[0].chain[0];
  source.source.params = { modelScale: 1, depth: 1 };
  state.ui.live.componentOverrides = {
    [componentId]: {
      chain: [{ source: { params: { modelScale: 2, depth: 3 } } }],
    },
  };
  state.ui.live.sceneOverrides = {
    [scene.id]: structuredClone(state.ui.live.componentOverrides),
  };
  const store = createAppState(state);

  store.update((draft) => {
    draft.components[0].chain[0].source.params.modelScale = 1.5;
  }, "update:components.0.chain.0.source.params.modelScale");

  const overrides = store.getState().ui.live.componentOverrides[componentId];
  assert.equal(overrides.chain[0].source.params.modelScale, undefined);
  assert.equal(overrides.chain[0].source.params.depth, 3);
  assert.equal(store.getLiveRenderState().components[0].chain[0].source.params.modelScale, 1.5);
  assert.equal(store.getLiveRenderState().components[0].chain[0].source.params.depth, 3);
});

test("ordinary components reject nested component sources while Canvas accepts them", () => {
  const state = createInitialState();
  const source = createDefaultComponent(1);
  const canvas = createSceneComponent(0);
  state.components.push(source, canvas);
  const store = createAppState(state);
  const ordinary = store.getState().components[0];
  const ordinaryLength = ordinary.chain.length;

  store.addChainSource(ordinary.id, { type: "component", componentId: source.id });
  assert.equal(store.getState().components.find((item) => item.id === ordinary.id).chain.length, ordinaryLength);

  store.addChainSource(canvas.id, { type: "component", componentId: source.id });
  const placed = store.getState().components.find((item) => item.id === canvas.id).chain.at(-1).source;
  assert.equal(placed.componentId, source.id);
  assert.deepEqual(placed.placement, { scale: 1 });
  const placementBeforeProportionChange = structuredClone(placed.placement);
  store.update((draft) => {
    draft.render.componentAspectRatio = 4 / 3;
  }, "update:render.componentAspectRatio");
  assert.deepEqual(
    store.getState().components.find((item) => item.id === canvas.id).chain.at(-1).source.placement,
    placementBeforeProportionChange,
    "texture resolution changes do not rewrite Canvas placement data"
  );
});

test("surface reorder updates active surfaces and scene snapshots", () => {
  const state = createInitialState();
  state.mappings = [createMappingFromState(state, "Scene 1")];
  const [firstSurface, secondSurface] = state.surfaces;
  const store = createAppState(state);

  store.reorderSurfaces(secondSurface.id, firstSurface.id);
  const next = store.getState();

  assert.equal(next.surfaces[0].id, secondSurface.id);
  assert.equal(next.surfaces[1].id, firstSurface.id);
  assert.equal(next.mappings[0].surfaces[0].id, secondSurface.id);
  assert.equal(next.mappings[0].surfaces[1].id, firstSurface.id);
});

test("all user-created projection surfaces can be removed", () => {
  const store = createAppState(createInitialState());
  const mappedIds = store.getState().surfaces
    .filter((surface) => surface.destination?.type !== "direct")
    .map((surface) => surface.id);
  for (const id of mappedIds) store.removeSurface(id);
  const next = store.getState();
  assert.equal(next.surfaces.filter((surface) => surface.destination?.type !== "direct").length, 0);
  assert.ok(next.surfaces.some((surface) => surface.destination?.type === "direct"));
});

test("new Surfaces join the selected Mapping and refresh its pending Live route", () => {
  const { state, firstScene, mapping } = liveSceneMappingFixture();
  const store = createAppState(state);
  store.addSurface();
  const added = store.getState().surfaces.at(-1);
  let route = store.getState().mappings[0].surfaces.find((surface) => surface.id === added.id);
  assert.equal(route.enabled, true);
  assert.ok(compileLiveProjectionProgram(store.getState()).currentRoutes.surfaces.some((surface) => surface.id === added.id));
  const rendered = store.getLiveRenderState().surfaces.find((surface) => surface.id === added.id);
  assert.equal(rendered.componentId, firstScene.id);
  assert.equal(store.getState().ui.selectedMappingId, mapping.id);
});

test("new Surfaces belong only to the selected Mapping", () => {
  const { state, firstScene, mapping } = liveSceneMappingFixture();
  const otherMapping = createMappingFromState(state, "Mapping 2");
  state.mappings.unshift(otherMapping);
  state.ui.selectedMappingId = mapping.id;
  const store = createAppState(state);
  store.addSurface();
  const next = store.getState();
  const added = next.surfaces.at(-1);
  const otherRoute = next.mappings.find((item) => item.id === otherMapping.id).surfaces.find((surface) => surface.id === added.id);
  const selectedRoute = next.mappings.find((item) => item.id === mapping.id).surfaces.find((surface) => surface.id === added.id);
  assert.equal(otherRoute, undefined);
  assert.equal(selectedRoute.enabled, true);
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
});

test("persistent Component edits cannot promote the editor Mapping or another Scene to Live", () => {
  const { state, source, firstScene, mapping } = liveSceneMappingFixture();
  const otherMapping = createMappingFromState(state, "Mapping 2");
  state.mappings.push(otherMapping);
  state.ui.selectedMappingId = otherMapping.id;
  const store = createAppState(state);
  store.update((draft) => {
    draft.components.find((component) => component.id === source.id).opacity = 0.37;
  }, "scrub:component-opacity");
  const persistent = store.getState();
  const rendered = store.getLiveRenderState();
  assert.equal(persistent.ui.selectedMappingId, otherMapping.id);
  assert.equal(persistent.ui.live.selectedSceneId, firstScene.id);
  assert.equal(rendered.ui.selectedMappingId, otherMapping.id);
  assert.equal(rendered.components.find((component) => component.id === source.id).opacity, 0.37);
  assert.notEqual(persistent.ui.selectedMappingId, mapping.id);
});

test("Canvas components use ordinary source and effect chain items", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  source.id = "source-component";
  const canvas = createSceneComponent(0, source.id);
  canvas.id = "canvas-component";
  state.components = [source, canvas];
  state.ui.selectedComponentId = canvas.id;
  state.ui.selectedChainItemId = canvas.chain[0].id;
  const store = createAppState(state);

  store.addChainEffect(canvas.id, "pixelate");
  const nextCanvas = store.getState().components.find((component) => component.id === canvas.id);
  assert.equal(nextCanvas.chain[0].kind, "source");
  assert.equal(nextCanvas.chain[0].source.type, "component");
  assert.equal(nextCanvas.chain[0].source.componentId, source.id);
  assert.equal(nextCanvas.chain[1].kind, "effect");
  assert.equal(nextCanvas.chain[1].componentId, "pixelate");
  assert.ok(!nextCanvas.chain.some((item) => item.role === "canvas-layer"));
});

test("new Scenes start empty", () => {
  const state = createInitialState();
  state.components[0].name = "Loop A";
  const store = createAppState(state);

  store.addScene();

  const canvas = store.getState().components.find((component) => component.type === "scene");
  assert.ok(canvas);
  assert.deepEqual(canvas.chain, []);
  assert.equal(store.getState().ui.selectedComponentId, canvas.id);
  assert.equal(store.getState().ui.selectedChainItemId, "");
});

test("copying a Component as Canvas preserves the original and opens the new Canvas", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.id = "source-component";
  component.name = "Source";
  state.components = [component];
  state.ui.workspace = "component";
  const store = createAppState(state);

  const result = store.copyComponentToScene(component.id);
  const next = store.getState();
  const canvas = next.components.find((item) => item.id === result.id);

  assert.equal(result.converted, true);
  assert.equal(next.components.find((item) => item.id === component.id).type, "chain");
  assert.equal(canvas.type, "scene");
  assert.equal(next.ui.workspace, "scene");
  assert.equal(next.ui.selectedComponentId, canvas.id);
  assert.equal(next.ui.workspaceSelectionIds.scene, canvas.id);
  assert.equal(next.global.calibrating, false);
});

test("Canvas workspace selects a Canvas and components are added as ordinary sources", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  source.id = "source-component";
  const canvas = createSceneComponent(0);
  canvas.id = "canvas-component";
  state.render.canvasSize = { width: 2000, height: 1000 };
  state.components = [source, canvas];
  state.ui.selectedComponentId = source.id;
  const store = createAppState(state);

  store.setWorkspace("scene");
  store.addChainSource(canvas.id, { type: "component", componentId: source.id });
  const next = store.getState();
  const nextCanvas = next.components.find((component) => component.id === canvas.id);

  assert.equal(next.ui.selectedComponentId, canvas.id);
  assert.equal(nextCanvas.chain[0].kind, "source");
  assert.equal(nextCanvas.chain[0].source.componentId, source.id);
  assert.ok(!("layout" in nextCanvas.chain[0]));

  store.setWorkspace("component");
  assert.equal(store.getState().ui.selectedComponentId, source.id);
});

test("Component and Canvas workspaces remember their own selected component", () => {
  const state = createInitialState();
  const firstComponent = createDefaultComponent(0);
  firstComponent.id = "component-first";
  const secondComponent = createDefaultComponent(1);
  secondComponent.id = "component-second";
  const firstCanvas = createSceneComponent(0);
  firstCanvas.id = "canvas-first";
  const secondCanvas = createSceneComponent(1);
  secondCanvas.id = "canvas-second";
  state.components = [firstComponent, secondComponent, firstCanvas, secondCanvas];
  state.ui.workspace = "component";
  state.ui.selectedComponentId = firstComponent.id;
  state.ui.workspaceSelectionIds = { component: firstComponent.id, scene: firstCanvas.id };
  const store = createAppState(state);

  store.selectComponent(secondComponent.id);
  store.setWorkspace("scene");
  assert.equal(store.getState().ui.selectedComponentId, firstCanvas.id);

  store.selectComponent(secondCanvas.id);
  store.setWorkspace("mapping");
  store.setWorkspace("component");
  assert.equal(store.getState().ui.selectedComponentId, secondComponent.id);

  store.setWorkspace("live");
  store.setWorkspace("scene");
  assert.equal(store.getState().ui.selectedComponentId, secondCanvas.id);
  assert.deepEqual(store.getState().ui.workspaceSelectionIds, {
    component: secondComponent.id,
    scene: secondCanvas.id,
  });
});

test("project restore selects the remembered Scene before the first Scene preview", () => {
  const component = createDefaultComponent(0);
  component.id = "restored-component";
  const scene = createSceneComponent(0);
  scene.id = "restored-scene";
  const state = createInitialState();
  state.components = [component, scene];
  state.ui.workspace = "scene";
  state.ui.selectedComponentId = component.id;
  state.ui.workspaceSelectionIds = { component: component.id, scene: scene.id };

  const store = createAppState(state);
  assert.equal(store.getState().ui.workspace, "scene");
  assert.equal(store.getState().ui.selectedComponentId, scene.id);
});

test("Mapping Surfaces discard catalog-derived source bindings across catalog reorder", () => {
  const state = createInitialState();
  const first = createDefaultComponent(0);
  first.id = "component-first";
  first.activity = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", lastUsedAt: "" };
  const second = createDefaultComponent(1);
  second.id = "component-second";
  second.activity = { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", lastUsedAt: "" };
  state.components = [first, second];
  state.surfaces[0].sourceNodeId = `component:${encodeURIComponent(second.id)}`;
  state.surfaces[0].componentId = first.id;
  state.mappings = [createMappingFromState(state, "Stable assignment")];
  state.ui.selectedMappingId = state.mappings[0].id;
  state.ui.workspace = "component";
  state.ui.catalogSortModes.scene = "recent";
  const store = createAppState(state);

  store.setWorkspace("mapping");
  const route = store.getState().mappings[0].surfaces.find((surface) => surface.id === state.surfaces[0].id);
  assert.equal(Object.hasOwn(route, "sourceNodeId"), false);
  assert.equal(Object.hasOwn(route, "componentId"), false);
});

test("Scenes do not regain authored Frame configuration during normalization", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  const firstCanvas = createSceneComponent(0, source.id);
  const secondCanvas = createSceneComponent(1, source.id);
  state.components = [source, firstCanvas, secondCanvas];
  state.mappings = [createMappingFromState(state, "Canvas scene")];
  const store = createAppState(state);
  const next = store.getState();
  assert.equal(Object.hasOwn(next, "frames"), false);
  assert.ok(next.components.filter((component) => component.type === "scene")
    .every((component) => !Array.isArray(component.scene?.frames)));
  assert.ok(next.mappings[0].surfaces.every((surface) => !Object.hasOwn(surface, "frameSlotId")));
  assert.ok(next.mappings[0].surfaces.every((surface) => !Object.hasOwn(surface, "outputFrameId")));
});

test("component chain preserves source elements and later effects", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const pixelate = createComponentEffect("pixelate");
  const invert = createComponentEffect("invert");
  const glitch = createComponentEffect("glitchDistort");
  invert.enabled = false;
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "black" }),
    createComponentLayer(1, { type: "generator", generatorId: "gradient" }),
    pixelate,
    invert,
    glitch,
  ];
  state.components = [component];

  const store = createAppState(state);
  const chain = store.getState().components[0].chain;

  assert.equal(chain.length, 5);
  assert.equal(chain[0].kind, "source");
  assert.equal(chain[0].source.generatorId, "black");
  assert.equal(chain[1].kind, "source");
  assert.equal(chain[1].source.generatorId, "gradient");
  assert.deepEqual(chain.slice(2).map((item) => item.componentId), ["pixelate", "invert", "glitchDistort"]);
  assert.equal(chain[3].enabled, false);
});

test("adding a generator inserts a visible chain element without replacing media", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, { type: "media", mediaId: "models/head.stl" }),
    createComponentEffect("pixelate"),
  ];
  state.components = [component];
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = component.chain[0].id;
  const store = createAppState(state);

  store.addChainSource(component.id, { type: "generator", generatorId: "gradient" });
  const chain = store.getState().components[0].chain;

  assert.equal(chain.length, 3);
  assert.equal(chain[0].kind, "source");
  assert.equal(chain[0].source.generatorId, "modelMedia");
  assert.equal(chain[0].source.params.mediaId, "models/head.stl");
  assert.equal(chain[1].kind, "source");
  assert.equal(chain[1].source.generatorId, "gradient");
  assert.equal(chain[1].source.params.colorA, "#ff4f92ff");
  assert.equal(chain[1].source.params.colorD, "#00000000");
  assert.equal(chain[2].componentId, "pixelate");
});

test("new elements stay enabled until their Component graph is connected to a Live output", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const canvas = createSceneComponent(0);
  canvas.chain = [createComponentLayer(0, { type: "component", componentId: component.id })];
  state.components = [component, canvas];
  state.surfaces[0].enabled = true;
  state.surfaces[0].componentId = canvas.id;
  state.surfaces[0].sourceNodeId = sceneSourceNodeId(canvas.id);
  const scene = createMappingFromState(state, "Program");
  state.mappings = [scene];
  state.ui.live.selectedSceneId = scene.id;
  const store = createAppState(state);

  store.addChainEffect(component.id, "invert");
  let next = store.getState();
  let nextComponent = next.components.find((item) => item.id === component.id);
  assert.equal(nextComponent.chain.at(-1).componentId, "invert");
  assert.equal(nextComponent.chain.at(-1).enabled, true);

  store.updateRuntime((metrics) => {
    metrics.clients = 1;
    metrics.outputs = { "output-main": 1 };
  }, "output-metrics");
  store.addChainEffect(component.id, "pixelate");
  store.addChainSource(canvas.id, { type: "generator", generatorId: "gradient" });
  store.addChainGroup(canvas.id);

  next = store.getState();
  nextComponent = next.components.find((item) => item.id === component.id);
  const nextCanvas = next.components.find((item) => item.id === canvas.id);
  assert.equal(nextComponent.chain.at(-1).componentId, "pixelate");
  assert.equal(nextComponent.chain.at(-1).enabled, false);
  assert.equal(nextCanvas.chain.find((item) => item.source?.generatorId === "gradient")?.enabled, false);
  assert.equal(nextCanvas.chain.find((item) => item.kind === "group")?.enabled, false);
});

test("adding an element while a group is selected appends it inside the group", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
    createComponentEffect("invert"),
  ];
  state.components = [component];
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = group.id;
  const store = createAppState(state);

  store.addChainEffect(component.id, "pixelate");
  const nextGroup = store.getState().components[0].chain[1];

  assert.equal(nextGroup.kind, "group");
  assert.equal(nextGroup.chain.length, 1);
  assert.equal(nextGroup.chain[0].componentId, "pixelate");
});

test("nested chain items remain selectable after state normalization", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  const nested = createComponentEffect("pixelate");
  group.chain = [nested];
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
  ];
  state.components = [component];
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = nested.id;

  const store = createAppState(state);

  assert.equal(store.getState().ui.selectedChainItemId, nested.id);

  store.selectChainItem(component.chain[0].id);
  assert.equal(store.getState().ui.selectedChainItemId, component.chain[0].id);

  store.selectChainItem(nested.id);
  assert.equal(store.getState().ui.selectedChainItemId, nested.id);

  store.selectChainItem("");
  assert.equal(store.getState().ui.selectedChainItemId, "");
});

test("Scene has one mutually exclusive Surface-or-element selection", () => {
  const state = createInitialState();
  const scene = createSceneComponent(0, state.components[0].id);
  state.components.push(scene);
  state.ui.workspace = "scene";
  state.ui.selectedComponentId = scene.id;
  state.ui.selectedChainItemId = scene.chain[0].id;
  state.ui.workspaceSelectionIds.scene = scene.id;
  const store = createAppState(state);
  const surface = store.getState().surfaces[0];

  store.selectSurface(surface.id);
  assert.equal(store.getState().ui.sceneInspectorTarget, "surface");
  assert.equal(store.getState().ui.selectedSurfaceId, surface.id);
  assert.equal(store.getState().ui.selectedChainItemId, "");

  store.selectChainItem(scene.chain[0].id);
  assert.equal(store.getState().ui.sceneInspectorTarget, "element");
  assert.equal(store.getState().ui.selectedChainItemId, scene.chain[0].id);
  assert.equal(store.getState().ui.selectedSurfaceId, "");

  store.selectSurface(surface.id);
  assert.equal(store.getState().ui.selectedChainItemId, "");
  store.selectComponent(scene.id);
  assert.equal(store.getState().ui.sceneInspectorTarget, "element");
  assert.equal(store.getState().ui.selectedChainItemId, scene.chain[0].id);
  assert.equal(store.getState().ui.selectedSurfaceId, "");
});

test("selected nested chain items can be removed through the shared store action", () => {
  const state = createInitialState();
  const component = state.components[0];
  const nested = createComponentLayer(0, { type: "generator", generatorId: "noise" });
  const group = createComponentGroup(0);
  group.chain = [nested];
  component.chain.push(group);
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = nested.id;
  const store = createAppState(state);

  store.removeChainItem(component.id, nested.id);

  const next = store.getState();
  assert.equal(next.components[0].chain.find((item) => item.id === group.id)?.chain.length, 0);
  assert.notEqual(next.ui.selectedChainItemId, nested.id);
});

test("the final element in an ordinary Component chain can be removed", () => {
  const state = createInitialState();
  const component = state.components.find((item) => item.type !== "scene");
  state.ui.selectedComponentId = component.id;
  state.ui.selectedChainItemId = component.chain[0].id;
  const store = createAppState(state);

  store.removeChainItem(component.id, component.chain[0].id);

  const next = store.getState();
  assert.deepEqual(next.components.find((item) => item.id === component.id).chain, []);
  assert.equal(next.ui.selectedChainItemId, "");
});

test("existing chain item can move into a group by drag reorder", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const source = createComponentLayer(0, { type: "generator", generatorId: "gradient" });
  const group = createComponentGroup(0);
  const effect = createComponentEffect("invert");
  component.chain = [source, group, effect];
  state.components = [component];
  const store = createAppState(state);

  store.reorderChain(component.id, effect.id, group.id, "inside");
  const chain = store.getState().components[0].chain;

  assert.deepEqual(chain.map((item) => item.id), [source.id, group.id]);
  assert.equal(chain[1].chain.length, 1);
  assert.equal(chain[1].chain[0].id, effect.id);
});

test("nested chain item can move out below a group at the end", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const source = createComponentLayer(0, { type: "generator", generatorId: "gradient" });
  const group = createComponentGroup(0);
  const effect = createComponentEffect("invert");
  group.chain = [effect];
  component.chain = [source, group];
  state.components = [component];
  const store = createAppState(state);

  store.reorderChain(component.id, effect.id, group.id, "after");
  const chain = store.getState().components[0].chain;

  assert.deepEqual(chain.map((item) => item.id), [source.id, group.id, effect.id]);
  assert.equal(chain[1].chain.length, 0);
});

test("group transform alpha and blend survive normalization", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  group.transform = { x: 0.2, y: -0.1, scale: 0.7, rotation: 0.35 };
  group.opacity = 0.42;
  group.blend = "screen";
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
  ];
  state.components = [component];

  const store = createAppState(state);
  const normalizedGroup = store.getState().components[0].chain[1];

  assert.deepEqual(normalizedGroup.transform, group.transform);
  assert.equal(normalizedGroup.opacity, 0.42);
  assert.equal(normalizedGroup.blend, "screen");
});

test("component chain compiles as one accumulated image pipeline", () => {
  const component = createDefaultComponent(0);
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    createComponentLayer(1, { type: "generator", generatorId: "eyeball" }),
    createComponentLayer(2, { type: "media", mediaId: "models/head.stl" }),
    createComponentEffect("pixelate"),
  ];

  const patch = compileComponentPatch(component, { width: 1280, height: 720 });
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);

  assert.equal(patch.type, "linear-component");
  assert.equal(compositor.inputs.length, 1);
  assert.deepEqual(
    compositor.inputs[0].effectComponentIds,
    ["eyeball", "modelMedia", "pixelate"]
  );
});

test("component chain compiles groups as isolated structure nodes", () => {
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  group.chain = [
    createComponentEffect("pixelate"),
    createComponentEffect("invert"),
  ];
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
    createComponentEffect("glitchDistort"),
  ];

  const patch = compileComponentPatch(component, { width: 1280, height: 720 });
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);

  assert.equal(patch.type, "linear-component");
  assert.equal(compositor.inputs.length, 1);
  assert.deepEqual(
    compositor.inputs[0].effectComponentIds,
    ["structure.group", "glitchDistort"]
  );
  const groupNode = patch.nodes.find((node) => node.role === "group");
  assert.equal(groupNode?.state?.group?.name, "Group 1");
  assert.equal(groupNode?.params?.items, 2);
});

test("app state stamps direct edits but preserves activity imported from disk", () => {
  const importedAt = "2020-01-01T00:00:00.000Z";
  const initial = createInitialState();
  initial.components[0].activity = { createdAt: importedAt, updatedAt: importedAt, lastUsedAt: "" };
  const store = createAppState(initial);
  const componentId = store.getState().components[0].id;

  store.update((draft) => {
    draft.components[0].name = "Changed";
  }, "update:component-name");
  assert.notEqual(store.getState().components[0].activity.updatedAt, importedAt);

  const loaded = store.getState();
  loaded.components[0].activity.updatedAt = importedAt;
  store.replace(loaded, "project-load");
  assert.equal(store.getState().components.find((item) => item.id === componentId).activity.updatedAt, importedAt);
});

test("one scrub gesture is one authored transaction while intermediate samples remain state events", () => {
  const meter = signalLoadMeter("control");
  meter.reset();
  const store = createAppState(createInitialState());
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));

  store.update((draft) => {
    draft.components[0].chain[0].boundary.x = 0.1;
  }, "scrub:chain-boundary");
  store.update((draft) => {
    draft.components[0].chain[0].boundary.x = 0.2;
  }, "scrub:chain-boundary");
  store.update((draft) => {
    draft.components[0].chain[0].boundary.x = 0.2;
  }, "update:chain-boundary");

  assert.deepEqual(events.slice(-3).map((event) => event.phase), ["scrub", "scrub", "commit"]);
  assert.equal(meter.snapshot().categories.transactions, 1);
  assert.deepEqual(meter.snapshot().topReasons[0], {
    reason: "transactions:update:chain-boundary",
    count: 1,
  });
  meter.reset();
});
test("derived cache updates do not become project transactions", () => {
  const store = createAppState(createInitialState());
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));
  const componentId = store.getState().components[0].id;
  store.updateDerived((draft) => {
    draft.components[0].thumbnail = "blob:thumb";
  }, "component-thumbnail");
  assert.equal(store.getState().components[0].thumbnail, "blob:thumb");
  assert.equal(events.at(-1).scope, "derived");
  assert.equal(events.at(-1).history, "none");
  assert.equal(store.getState().components[0].id, componentId);
});

test("derived cache updates preserve their targeted UI projection contract", () => {
  const store = createAppState(createInitialState());
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));
  const componentId = store.getState().components[0].id;
  const projection = {
    kind: "component-thumbnails",
    entries: [{ componentId, surfaceId: "", url: "blob:cached" }],
  };

  store.updateDerived((draft) => {
    draft.components[0].thumbnail = "blob:cached";
  }, { reason: "project-thumbnail-cache-batch", projection });

  assert.equal(events.at(-1).reason, "project-thumbnail-cache-batch");
  assert.equal(events.at(-1).scope, "derived");
  assert.equal(events.at(-1).history, "none");
  assert.deepEqual(events.at(-1).projection, projection);
});

test("thumbnail replacement publishes atomically without clearing the previous derived image", () => {
  const initial = createInitialState();
  initial.components[0].thumbnail = "blob:previous";
  const store = createAppState(initial);
  const componentId = store.getState().components[0].id;
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));

  assert.equal(store.getState().components[0].thumbnail, "blob:previous");
  const result = store.setComponentThumbnail(componentId, "", "blob:replacement");

  assert.deepEqual(result, { updated: true, previous: "blob:previous" });
  assert.equal(store.getState().components[0].thumbnail, "blob:replacement");
  assert.equal(events.at(-1).scope, "derived");
  assert.equal(events.at(-1).history, "none");
  assert.deepEqual(events.at(-1).projection, {
    kind: "component-thumbnails",
    entries: [{
      componentId,
      surfaceId: "",
      url: "blob:replacement",
    }],
  }, "runtime-generated thumbnails must carry the same narrow UI projection as restored thumbnail batches");
});

test("mapping feedback updates only the mapping slice while retaining project history semantics", () => {
  const store = createAppState(createInitialState());
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));
  const mapping = { surfaces: [{ id: "surface-a", corners: [{ x: 10, y: 20 }] }] };

  store.updateMapping("local", mapping, "Mapping saved", "mapping-state");
  mapping.surfaces[0].corners[0].x = 999;

  assert.equal(store.getState().mappingCalibration.surfaces[0].corners[0].x, 10);
  assert.equal(store.getState().mappings[0].calibration.surfaces[0].corners[0].x, 10);
  assert.equal(store.getState().ui.mappingStatus, "Mapping saved");
  assert.equal(events.at(-1).topic, "mapping-state");
  assert.equal(events.at(-1).history, "record");
});

test("Component and Scene visibility toggles are scoped project transactions", () => {
  const initial = createInitialState();
  const component = initial.components.find((item) => item.type !== "scene");
  const scene = createSceneComponent(0);
  scene.chain.push(createComponentLayer());
  initial.components.push(scene);
  component.activity.updatedAt = "2020-01-01T00:00:00.000Z";
  scene.activity.updatedAt = "2020-01-01T00:00:00.000Z";
  initial.ui.selectedChainItemId = "";
  let prepareCount = 0;
  const store = createAppState(initial, {
    prepareState(value) {
      prepareCount++;
      return value;
    },
  });
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));
  const componentIndex = store.getState().components.findIndex((item) => item.id === component.id);
  const sceneIndex = store.getState().components.findIndex((item) => item.id === scene.id);

  assert.equal(store.setComponentToggle(
    `components.${componentIndex}.chain.0.enabled`,
    false,
    {
      reason: `toggle:components.${componentIndex}.chain.0.enabled`,
      selectAction: "chain-item",
      selectId: component.chain[0].id,
    },
  ), true);
  assert.equal(store.setComponentToggle(
    `components.${sceneIndex}.chain.0.enabled`,
    false,
    {
      reason: `toggle:components.${sceneIndex}.chain.0.enabled`,
      selectAction: "chain-item",
      selectId: scene.chain[0].id,
    },
  ), true);

  const next = store.getState();
  assert.equal(next.components[componentIndex].chain[0].enabled, false);
  assert.equal(next.components[sceneIndex].chain[0].enabled, false);
  assert.equal(next.ui.selectedChainItemId, scene.chain[0].id);
  assert.notEqual(next.components[componentIndex].activity.updatedAt, "2020-01-01T00:00:00.000Z");
  assert.notEqual(next.components[sceneIndex].activity.updatedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(prepareCount, 1, "an already-normalized boolean toggle must not normalize the complete project again");
  assert.equal(events.at(-1).scope, "project");
  assert.equal(events.at(-1).history, "record");
  assert.equal(events.at(-1).topic, `components.${sceneIndex}.chain.0.enabled`);
});

test("Mapping Surface visibility commits one scoped route transaction", () => {
  const initial = createInitialState();
  const mapping = initial.mappings[0];
  const surface = mapping.surfaces[0];
  surface.activity.updatedAt = "2020-01-01T00:00:00.000Z";
  initial.ui.selectedMappingId = mapping.id;
  let prepareCount = 0;
  const store = createAppState(initial, {
    prepareState(value) {
      prepareCount++;
      return value;
    },
  });
  const sceneMappingInLive = store.getState().ui.live.sceneMappingInLive;
  const sceneMappingVisible = store.getState().ui.live.sceneMappingVisible;
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));

  assert.equal(store.setMappingSurfaceVisibility(mapping.id, surface.id, false), true);

  const next = store.getState();
  const authored = next.mappings[0].surfaces[0];
  assert.equal(authored.enabled, false);
  assert.equal(next.ui.selectedSurfaceId, surface.id);
  assert.equal(next.ui.live.sceneMappingInLive, sceneMappingInLive);
  assert.equal(next.ui.live.sceneMappingVisible, sceneMappingVisible);
  assert.notEqual(authored.activity.updatedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(prepareCount, 1);
  assert.equal(events.at(-1).scope, "project");
  assert.equal(events.at(-1).history, "record");
  assert.deepEqual(events.at(-1).renderPatches, [{
    target: "state",
    path: "surfaces",
    value: events.at(-1).renderPatches[0].value,
  }]);
  assert.equal(
    events.at(-1).renderPatches[0].value.find((item) => item.id === surface.id)?.enabled,
    false,
  );
});
