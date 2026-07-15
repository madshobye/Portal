import test from "node:test";
import assert from "node:assert/strict";

import { createAppState } from "../js/app-state.js";
import {
  createCompositionEffect,
  createCompositionGroup,
  createCompositionLayer,
  createCanvasComposition,
  createDefaultComposition,
  createInitialState,
  createSceneFromState,
  syncLiveSnapshotFromScene,
} from "../js/domain/models.js?v=world-frame-27";
import { compileCompositionPatch } from "../js/graph/render-scheduler.js?v=world-frame-27";
import { planCompositorInputs, planPatchExecution } from "../js/graph/patch-planner.js";

test("render state uses selected scene in scene workspace and live scene in live workspace", () => {
  const state = createInitialState();
  const sceneComposition = createDefaultComposition(0);
  sceneComposition.id = "composition-scene";
  sceneComposition.name = "Scene Composition";
  const liveComposition = createDefaultComposition(1);
  liveComposition.id = "composition-live";
  liveComposition.name = "Live Composition";
  state.compositions = [sceneComposition, liveComposition];

  state.surfaces[0].compositionId = sceneComposition.id;
  const sceneSnapshot = createSceneFromState(state, "Scene Selected");
  state.surfaces[0].compositionId = liveComposition.id;
  const liveSnapshot = createSceneFromState(state, "Live Selected");
  state.scenes = [sceneSnapshot, liveSnapshot];
  state.ui.workspace = "scene";
  state.ui.selectedSceneId = sceneSnapshot.id;
  state.ui.live.selectedSceneId = liveSnapshot.id;

  const store = createAppState(state);
  assert.equal(store.getRenderState().surfaces[0].compositionId, sceneComposition.id);

  store.setWorkspace("live");
  assert.equal(store.getRenderState().surfaces[0].compositionId, liveComposition.id);
});

test("edits refresh the scene selected by Live without changing Live's scene selection", () => {
  const state = createInitialState();
  const first = createDefaultComposition(0);
  first.id = "composition-first";
  const second = createDefaultComposition(1);
  second.id = "composition-second";
  state.compositions = [first, second];
  state.surfaces[0].compositionId = first.id;
  const firstScene = createSceneFromState(state, "First");
  state.surfaces[0].compositionId = second.id;
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.sceneSnapshot = structuredClone(secondScene.snapshot);

  const store = createAppState(state);
  assert.equal(store.getLiveRenderState().surfaces[0].compositionId, first.id);

  store.update((draft) => {
    draft.scenes[0].snapshot.surfaces[0].compositionId = second.id;
  }, "scene-edit");
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.equal(store.getLiveRenderState().surfaces[0].compositionId, second.id);

  store.selectLiveScene(secondScene.id);
  assert.equal(store.getLiveRenderState().surfaces[0].compositionId, second.id);
});

test("an empty Live selection initializes independently from the Scene selection", () => {
  const state = createInitialState();
  const firstScene = createSceneFromState(state, "First");
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.selectedSceneId = secondScene.id;
  state.ui.live.selectedSceneId = "";
  state.ui.live.sceneSnapshot = null;

  const store = createAppState(state);
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);

  store.setWorkspace("live");
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.notEqual(store.getState().ui.live.selectedSceneId, store.getState().ui.selectedSceneId);
});

test("Live scene transitions default to an immediate cut with no transition render state", () => {
  const state = createInitialState();
  const firstScene = createSceneFromState(state, "First");
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.sceneSnapshot = structuredClone(firstScene.snapshot);
  const store = createAppState(state);

  store.selectLiveScene(secondScene.id);

  assert.equal(store.getState().ui.live.transitionDuration, 0);
  assert.equal(store.getState().ui.live.transition, null);
  assert.equal(store.getLiveRenderState().liveTransition, undefined);
  assert.equal(store.getState().ui.live.selectedSceneId, secondScene.id);
});

test("nonzero Live transition duration retains the source scene for synchronized rendering", () => {
  const state = createInitialState();
  const firstScene = createSceneFromState(state, "First");
  state.surfaces[0].opacity = 0.25;
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.sceneSnapshot = structuredClone(firstScene.snapshot);
  state.ui.live.transitionDuration = 1.5;
  const store = createAppState(state);

  store.selectLiveScene(secondScene.id);

  const renderState = store.getLiveRenderState();
  assert.equal(renderState.liveTransition.durationMs, 1500);
  assert.equal(renderState.liveTransition.fromState.surfaces[0].opacity, firstScene.snapshot.surfaces[0].opacity);
  assert.equal(renderState.surfaces[0].opacity, secondScene.snapshot.surfaces[0].opacity);
  assert.ok(renderState.liveTransition.startedAtMs > Date.now());
});

test("Live temporary overrides persist per scene until explicitly reset", () => {
  const state = createInitialState();
  const firstScene = createSceneFromState(state, "First");
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.sceneSnapshot = structuredClone(firstScene.snapshot);
  const compositionId = state.compositions[0].id;
  const store = createAppState(state);

  store.update((draft) => {
    draft.ui.live.compositionOverrides[compositionId] = { opacity: 0.25 };
  }, "live:update");
  store.selectLiveScene(secondScene.id);
  assert.deepEqual(store.getState().ui.live.compositionOverrides, {});

  store.update((draft) => {
    draft.ui.live.compositionOverrides[compositionId] = { speed: 2 };
  }, "live:update");
  store.selectLiveScene(firstScene.id);
  assert.equal(store.getState().ui.live.compositionOverrides[compositionId].opacity, 0.25);

  store.resetLiveScene(firstScene.id);
  assert.deepEqual(store.getState().ui.live.compositionOverrides, {});
  store.selectLiveScene(secondScene.id);
  assert.equal(store.getState().ui.live.compositionOverrides[compositionId].speed, 2);
});

test("persistent composition edits overwrite conflicting Live params but retain unrelated temporary params", () => {
  const state = createInitialState();
  const scene = createSceneFromState(state, "Live scene");
  state.scenes = [scene];
  state.ui.live.selectedSceneId = scene.id;
  const compositionId = state.compositions[0].id;
  const source = state.compositions[0].chain[0];
  source.params = { modelScale: 1, depth: 1 };
  state.ui.live.compositionOverrides = {
    [compositionId]: {
      chain: [{ params: { modelScale: 2, depth: 3 } }],
    },
  };
  state.ui.live.sceneOverrides = {
    [scene.id]: structuredClone(state.ui.live.compositionOverrides),
  };
  const store = createAppState(state);

  store.update((draft) => {
    draft.compositions[0].chain[0].params.modelScale = 1.5;
  }, "update:compositions.0.chain.0.params.modelScale");

  const overrides = store.getState().ui.live.compositionOverrides[compositionId];
  assert.equal(overrides.chain[0].params.modelScale, undefined);
  assert.equal(overrides.chain[0].params.depth, 3);
  assert.equal(store.getLiveRenderState().compositions[0].chain[0].params.modelScale, 1.5);
  assert.equal(store.getLiveRenderState().compositions[0].chain[0].params.depth, 3);
});

test("ordinary compositions reject nested composition sources while Canvas accepts them", () => {
  const state = createInitialState();
  const source = createDefaultComposition(1);
  const canvas = createCanvasComposition(0);
  state.compositions.push(source, canvas);
  const store = createAppState(state);
  const ordinary = store.getState().compositions[0];
  const ordinaryLength = ordinary.chain.length;

  store.addChainSource(ordinary.id, { type: "composition", compositionId: source.id });
  assert.equal(store.getState().compositions.find((item) => item.id === ordinary.id).chain.length, ordinaryLength);

  store.addChainSource(canvas.id, { type: "composition", compositionId: source.id });
  assert.equal(store.getState().compositions.find((item) => item.id === canvas.id).chain.at(-1).source.compositionId, source.id);
});

test("surface reorder updates active surfaces and scene snapshots", () => {
  const state = createInitialState();
  state.scenes = [createSceneFromState(state, "Scene 1")];
  const [firstSurface, secondSurface] = state.surfaces;
  const store = createAppState(state);

  store.reorderSurfaces(secondSurface.id, firstSurface.id);
  const next = store.getState();

  assert.equal(next.surfaces[0].id, secondSurface.id);
  assert.equal(next.surfaces[1].id, firstSurface.id);
  assert.equal(next.scenes[0].snapshot.surfaces[0].id, secondSurface.id);
  assert.equal(next.scenes[0].snapshot.surfaces[1].id, firstSurface.id);
});

test("new surfaces and route edits update the pending Live snapshot for the same scene", () => {
  const state = createInitialState();
  const second = createDefaultComposition(1);
  second.id = "composition-second";
  state.compositions.push(second);
  const scene = createSceneFromState(state, "Shared scene");
  state.scenes = [scene];
  state.ui.selectedSceneId = scene.id;
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.sceneSnapshot = structuredClone(scene.snapshot);

  const store = createAppState(state);
  store.addSurface();
  let next = store.getState();
  const added = next.surfaces.at(-1);
  assert.ok(next.ui.live.sceneSnapshot.surfaces.some((surface) => surface.id === added.id));

  const selectedScene = next.scenes.find((item) => item.id === scene.id);
  selectedScene.snapshot.surfaces.find((surface) => surface.id === added.id).compositionId = second.id;
  syncLiveSnapshotFromScene(next, selectedScene);
  store.replace(next, "scene-route-edit");

  assert.equal(
    store.getLiveRenderState().surfaces.find((surface) => surface.id === added.id).compositionId,
    second.id
  );
});

test("route edits in a different Scene do not replace Live's selected scene", () => {
  const state = createInitialState();
  const liveScene = createSceneFromState(state, "Live scene");
  const editedScene = createSceneFromState(state, "Edited scene");
  state.scenes = [liveScene, editedScene];
  state.ui.selectedSceneId = editedScene.id;
  state.ui.live.selectedSceneId = liveScene.id;
  state.ui.live.sceneSnapshot = structuredClone(liveScene.snapshot);
  const original = structuredClone(state.ui.live.sceneSnapshot);

  syncLiveSnapshotFromScene(state, editedScene);

  assert.deepEqual(state.ui.live.sceneSnapshot, original);
});

test("Canvas compositions use ordinary source and effect chain items", () => {
  const state = createInitialState();
  const source = createDefaultComposition(0);
  source.id = "source-composition";
  const canvas = createCanvasComposition(0, source.id);
  canvas.id = "canvas-composition";
  state.compositions = [source, canvas];
  state.ui.selectedCompositionId = canvas.id;
  state.ui.selectedChainItemId = canvas.chain[0].id;
  const store = createAppState(state);

  store.addChainEffect(canvas.id, "pixelate");
  const nextCanvas = store.getState().compositions.find((composition) => composition.id === canvas.id);
  assert.equal(nextCanvas.chain[0].kind, "source");
  assert.equal(nextCanvas.chain[0].source.type, "composition");
  assert.equal(nextCanvas.chain[0].source.compositionId, source.id);
  assert.equal(nextCanvas.chain[1].kind, "effect");
  assert.equal(nextCanvas.chain[1].componentId, "pixelate");
  assert.ok(!nextCanvas.chain.some((item) => item.role === "canvas-layer"));
});

test("new Canvas compositions start empty", () => {
  const state = createInitialState();
  state.compositions[0].name = "Loop A";
  const store = createAppState(state);

  store.addCanvasComposition();

  const canvas = store.getState().compositions.find((composition) => composition.type === "canvas");
  assert.ok(canvas);
  assert.deepEqual(canvas.chain, []);
  assert.equal(store.getState().ui.selectedCompositionId, canvas.id);
  assert.equal(store.getState().ui.selectedChainItemId, "");
});

test("Canvas workspace selects a Canvas and compositions are added as ordinary sources", () => {
  const state = createInitialState();
  const source = createDefaultComposition(0);
  source.id = "source-composition";
  const canvas = createCanvasComposition(0);
  canvas.id = "canvas-composition";
  canvas.canvas.width = 2000;
  canvas.canvas.height = 1000;
  state.compositions = [source, canvas];
  state.ui.selectedCompositionId = source.id;
  const store = createAppState(state);

  store.setWorkspace("canvas");
  store.addChainSource(canvas.id, { type: "composition", compositionId: source.id });
  const next = store.getState();
  const nextCanvas = next.compositions.find((composition) => composition.id === canvas.id);

  assert.equal(next.ui.selectedCompositionId, canvas.id);
  assert.equal(nextCanvas.chain[0].kind, "source");
  assert.equal(nextCanvas.chain[0].source.compositionId, source.id);
  assert.ok(!("layout" in nextCanvas.chain[0]));

  store.setWorkspace("compose");
  assert.equal(store.getState().ui.selectedCompositionId, source.id);
});

test("canvas recording frames are shared across canvases and removed routes clear safely", () => {
  const state = createInitialState();
  const source = createDefaultComposition(0);
  const firstCanvas = createCanvasComposition(0, source.id);
  const secondCanvas = createCanvasComposition(1, source.id);
  state.compositions = [source, firstCanvas, secondCanvas];
  const frameId = state.recordingFrames[0].id;
  firstCanvas.canvas.frameThumbnails = { [frameId]: "first-crop" };
  secondCanvas.canvas.frameThumbnails = { [frameId]: "second-crop" };
  state.surfaces[0].compositionId = firstCanvas.id;
  state.surfaces[0].outputFrameId = frameId;
  state.surfaces[1].compositionId = secondCanvas.id;
  state.surfaces[1].outputFrameId = frameId;
  state.scenes = [createSceneFromState(state, "Canvas scene")];
  const store = createAppState(state);

  store.addCanvasFrame(firstCanvas.id);
  assert.equal(store.getState().recordingFrames.length, 2);
  assert.equal("frames" in store.getState().compositions.find((composition) => composition.id === firstCanvas.id).canvas, false);
  assert.equal("frames" in store.getState().compositions.find((composition) => composition.id === secondCanvas.id).canvas, false);

  store.removeCanvasFrame(firstCanvas.id, frameId);
  const next = store.getState();
  assert.equal(next.recordingFrames.some((frame) => frame.id === frameId), false);
  assert.equal(frameId in next.compositions.find((composition) => composition.id === firstCanvas.id).canvas.frameThumbnails, false);
  assert.equal(frameId in next.compositions.find((composition) => composition.id === secondCanvas.id).canvas.frameThumbnails, false);
  assert.equal(next.surfaces[0].outputFrameId, "");
  assert.equal(next.surfaces[1].outputFrameId, "");
  assert.equal(next.scenes[0].snapshot.surfaces[0].outputFrameId, "");
  assert.equal(next.scenes[0].snapshot.surfaces[1].outputFrameId, "");
});

test("composition chain preserves source elements and later effects", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const pixelate = createCompositionEffect("pixelate");
  const invert = createCompositionEffect("invert");
  const glitch = createCompositionEffect("glitchDistort");
  invert.enabled = false;
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "black" }),
    createCompositionLayer(1, { type: "generator", generatorId: "gradient" }),
    pixelate,
    invert,
    glitch,
  ];
  state.compositions = [composition];

  const store = createAppState(state);
  const chain = store.getState().compositions[0].chain;

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
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, { type: "media", mediaId: "models/head.stl" }),
    createCompositionEffect("pixelate"),
  ];
  state.compositions = [composition];
  state.ui.selectedCompositionId = composition.id;
  state.ui.selectedChainItemId = composition.chain[0].id;
  const store = createAppState(state);

  store.addChainSource(composition.id, { type: "generator", generatorId: "gradient" });
  const chain = store.getState().compositions[0].chain;

  assert.equal(chain.length, 3);
  assert.equal(chain[0].kind, "source");
  assert.equal(chain[0].source.mediaId, "models/head.stl");
  assert.equal(chain[1].kind, "source");
  assert.equal(chain[1].source.generatorId, "gradient");
  assert.equal(chain[1].source.params.colorA, "#ff4f92ff");
  assert.equal(chain[1].source.params.colorD, "#00000000");
  assert.equal(chain[2].componentId, "pixelate");
});

test("adding an element while a group is selected appends it inside the group", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const group = createCompositionGroup(0);
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
    createCompositionEffect("invert"),
  ];
  state.compositions = [composition];
  state.ui.selectedCompositionId = composition.id;
  state.ui.selectedChainItemId = group.id;
  const store = createAppState(state);

  store.addChainEffect(composition.id, "pixelate");
  const nextGroup = store.getState().compositions[0].chain[1];

  assert.equal(nextGroup.kind, "group");
  assert.equal(nextGroup.chain.length, 1);
  assert.equal(nextGroup.chain[0].componentId, "pixelate");
});

test("nested chain items remain selectable after state normalization", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const group = createCompositionGroup(0);
  const nested = createCompositionEffect("pixelate");
  group.chain = [nested];
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
  ];
  state.compositions = [composition];
  state.ui.selectedCompositionId = composition.id;
  state.ui.selectedChainItemId = nested.id;

  const store = createAppState(state);

  assert.equal(store.getState().ui.selectedChainItemId, nested.id);
});

test("existing chain item can move into a group by drag reorder", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const source = createCompositionLayer(0, { type: "generator", generatorId: "gradient" });
  const group = createCompositionGroup(0);
  const effect = createCompositionEffect("invert");
  composition.chain = [source, group, effect];
  state.compositions = [composition];
  const store = createAppState(state);

  store.reorderChain(composition.id, effect.id, group.id, "inside");
  const chain = store.getState().compositions[0].chain;

  assert.deepEqual(chain.map((item) => item.id), [source.id, group.id]);
  assert.equal(chain[1].chain.length, 1);
  assert.equal(chain[1].chain[0].id, effect.id);
});

test("nested chain item can move out below a group at the end", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const source = createCompositionLayer(0, { type: "generator", generatorId: "gradient" });
  const group = createCompositionGroup(0);
  const effect = createCompositionEffect("invert");
  group.chain = [effect];
  composition.chain = [source, group];
  state.compositions = [composition];
  const store = createAppState(state);

  store.reorderChain(composition.id, effect.id, group.id, "after");
  const chain = store.getState().compositions[0].chain;

  assert.deepEqual(chain.map((item) => item.id), [source.id, group.id, effect.id]);
  assert.equal(chain[1].chain.length, 0);
});

test("group transform survives normalization for preview handles", () => {
  const state = createInitialState();
  const composition = createDefaultComposition(0);
  const group = createCompositionGroup(0);
  group.transform = { x: 0.2, y: -0.1, scale: 0.7, rotation: 0.35 };
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
  ];
  state.compositions = [composition];

  const store = createAppState(state);
  const normalizedGroup = store.getState().compositions[0].chain[1];

  assert.deepEqual(normalizedGroup.transform, group.transform);
});

test("composition chain compiles as one accumulated image pipeline", () => {
  const composition = createDefaultComposition(0);
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "gradient" }),
    createCompositionLayer(1, { type: "generator", generatorId: "eyeball" }),
    createCompositionLayer(2, { type: "media", mediaId: "models/head.stl" }),
    createCompositionEffect("pixelate"),
  ];

  const patch = compileCompositionPatch(composition, { width: 1280, height: 720 });
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);

  assert.equal(patch.type, "linear-composition");
  assert.equal(compositor.inputs.length, 1);
  assert.deepEqual(
    compositor.inputs[0].effectComponentIds,
    ["eyeball", "source.media", "pixelate"]
  );
});

test("composition chain compiles groups as isolated structure nodes", () => {
  const composition = createDefaultComposition(0);
  const group = createCompositionGroup(0);
  group.chain = [
    createCompositionEffect("pixelate"),
    createCompositionEffect("invert"),
  ];
  composition.chain = [
    createCompositionLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
    createCompositionEffect("glitchDistort"),
  ];

  const patch = compileCompositionPatch(composition, { width: 1280, height: 720 });
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);

  assert.equal(patch.type, "linear-composition");
  assert.equal(compositor.inputs.length, 1);
  assert.deepEqual(
    compositor.inputs[0].effectComponentIds,
    ["structure.group", "glitchDistort"]
  );
  const groupNode = patch.nodes.find((node) => node.role === "group");
  assert.equal(groupNode?.state?.group?.name, "Group 1");
  assert.equal(groupNode?.params?.items, 2);
});
