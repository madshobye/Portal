import test from "node:test";
import assert from "node:assert/strict";

import { createAppState } from "../js/app-state.js";
import {
  createCompositionEffect,
  createCompositionGroup,
  createCompositionLayer,
  createDefaultComposition,
  createInitialState,
  createSceneFromState,
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
