import test from "node:test";
import assert from "node:assert/strict";

import { createAppState } from "../js/app-state.js";
import {
  createComponentEffect,
  createComponentGroup,
  createComponentLayer,
  createCanvasComponent,
  createDefaultComponent,
  createInitialState,
  createSceneFromState,
  sceneSourceNodeId,
  syncLiveSnapshotFromScene,
} from "../js/domain/models.js?v=world-frame-27";
import { compileComponentPatch } from "../js/graph/render-scheduler.js?v=world-frame-27";
import { planCompositorInputs, planPatchExecution } from "../js/graph/patch-planner.js";

test("render state uses selected scene in scene workspace and live scene in live workspace", () => {
  const state = createInitialState();
  const sceneComponent = createDefaultComponent(0);
  sceneComponent.id = "component-scene";
  sceneComponent.name = "Scene Component";
  const liveComponent = createDefaultComponent(1);
  liveComponent.id = "component-live";
  liveComponent.name = "Live Component";
  state.components = [sceneComponent, liveComponent];

  state.surfaces[0].componentId = sceneComponent.id;
  const sceneSnapshot = createSceneFromState(state, "Scene Selected");
  state.surfaces[0].componentId = liveComponent.id;
  const liveSnapshot = createSceneFromState(state, "Live Selected");
  state.scenes = [sceneSnapshot, liveSnapshot];
  state.ui.workspace = "scene";
  state.ui.selectedSceneId = sceneSnapshot.id;
  state.ui.live.selectedSceneId = liveSnapshot.id;

  const store = createAppState(state);
  assert.equal(store.getRenderState().surfaces[0].componentId, sceneComponent.id);

  store.setWorkspace("live");
  assert.equal(store.getRenderState().surfaces[0].componentId, liveComponent.id);
});

test("edits refresh the scene selected by Live without changing Live's scene selection", () => {
  const state = createInitialState();
  const first = createDefaultComponent(0);
  first.id = "component-first";
  const second = createDefaultComponent(1);
  second.id = "component-second";
  state.components = [first, second];
  state.surfaces[0].componentId = first.id;
  const firstScene = createSceneFromState(state, "First");
  state.surfaces[0].componentId = second.id;
  const secondScene = createSceneFromState(state, "Second");
  state.scenes = [firstScene, secondScene];
  state.ui.live.selectedSceneId = firstScene.id;
  state.ui.live.sceneSnapshot = structuredClone(secondScene.snapshot);

  const store = createAppState(state);
  assert.equal(store.getLiveRenderState().surfaces[0].componentId, first.id);

  store.update((draft) => {
    draft.scenes[0].snapshot.surfaces[0].sourceNodeId = sceneSourceNodeId(second.id);
    draft.scenes[0].snapshot.surfaces[0].componentId = second.id;
  }, "scene-edit");
  assert.equal(store.getState().ui.live.selectedSceneId, firstScene.id);
  assert.equal(store.getLiveRenderState().surfaces[0].componentId, second.id);

  store.selectLiveScene(secondScene.id);
  assert.equal(store.getLiveRenderState().surfaces[0].componentId, second.id);
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
  const componentId = state.components[0].id;
  const store = createAppState(state);

  store.update((draft) => {
    draft.ui.live.componentOverrides[componentId] = { opacity: 0.25 };
  }, "live:update");
  store.selectLiveScene(secondScene.id);
  assert.deepEqual(store.getState().ui.live.componentOverrides, {});

  store.update((draft) => {
    draft.ui.live.componentOverrides[componentId] = { speed: 2 };
  }, "live:update");
  store.selectLiveScene(firstScene.id);
  assert.equal(store.getState().ui.live.componentOverrides[componentId].opacity, 0.25);

  store.resetLiveScene(firstScene.id);
  assert.deepEqual(store.getState().ui.live.componentOverrides, {});
  store.selectLiveScene(secondScene.id);
  assert.equal(store.getState().ui.live.componentOverrides[componentId].speed, 2);
});

test("persistent component edits overwrite conflicting Live params but retain unrelated temporary params", () => {
  const state = createInitialState();
  const scene = createSceneFromState(state, "Live scene");
  state.scenes = [scene];
  state.ui.live.selectedSceneId = scene.id;
  const componentId = state.components[0].id;
  const source = state.components[0].chain[0];
  source.params = { modelScale: 1, depth: 1 };
  state.ui.live.componentOverrides = {
    [componentId]: {
      chain: [{ params: { modelScale: 2, depth: 3 } }],
    },
  };
  state.ui.live.sceneOverrides = {
    [scene.id]: structuredClone(state.ui.live.componentOverrides),
  };
  const store = createAppState(state);

  store.update((draft) => {
    draft.components[0].chain[0].params.modelScale = 1.5;
  }, "update:components.0.chain.0.params.modelScale");

  const overrides = store.getState().ui.live.componentOverrides[componentId];
  assert.equal(overrides.chain[0].params.modelScale, undefined);
  assert.equal(overrides.chain[0].params.depth, 3);
  assert.equal(store.getLiveRenderState().components[0].chain[0].params.modelScale, 1.5);
  assert.equal(store.getLiveRenderState().components[0].chain[0].params.depth, 3);
});

test("ordinary components reject nested component sources while Canvas accepts them", () => {
  const state = createInitialState();
  const source = createDefaultComponent(1);
  const canvas = createCanvasComponent(0);
  state.components.push(source, canvas);
  const store = createAppState(state);
  const ordinary = store.getState().components[0];
  const ordinaryLength = ordinary.chain.length;

  store.addChainSource(ordinary.id, { type: "component", componentId: source.id });
  assert.equal(store.getState().components.find((item) => item.id === ordinary.id).chain.length, ordinaryLength);

  store.addChainSource(canvas.id, { type: "component", componentId: source.id });
  const placed = store.getState().components.find((item) => item.id === canvas.id).chain.at(-1).source;
  assert.equal(placed.componentId, source.id);
  assert.deepEqual(placed.placement, {
    scale: state.render.componentTexture.width / canvas.canvas.width,
  });
  const placementBeforeTextureChange = structuredClone(placed.placement);
  store.update((draft) => {
    draft.render.componentTexture.width *= 4;
    draft.render.componentTexture.height *= 4;
  }, "update:render.componentTexture");
  assert.deepEqual(
    store.getState().components.find((item) => item.id === canvas.id).chain.at(-1).source.placement,
    placementBeforeTextureChange,
    "texture resolution changes do not rewrite Canvas placement data"
  );
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

test("new surfaces and route edits update the pending Live snapshot for the same scene", () => {
  const state = createInitialState();
  const second = createDefaultComponent(1);
  second.id = "component-second";
  state.components.push(second);
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
  const selectedRoute = selectedScene.snapshot.surfaces.find((surface) => surface.id === added.id);
  selectedRoute.sourceNodeId = sceneSourceNodeId(second.id);
  selectedRoute.componentId = second.id;
  syncLiveSnapshotFromScene(next, selectedScene);
  store.replace(next, "scene-route-edit");

  assert.equal(
    store.getLiveRenderState().surfaces.find((surface) => surface.id === added.id).componentId,
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

test("Canvas components use ordinary source and effect chain items", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  source.id = "source-component";
  const canvas = createCanvasComponent(0, source.id);
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

test("new Canvas components start empty", () => {
  const state = createInitialState();
  state.components[0].name = "Loop A";
  const store = createAppState(state);

  store.addCanvasComponent();

  const canvas = store.getState().components.find((component) => component.type === "canvas");
  assert.ok(canvas);
  assert.deepEqual(canvas.chain, []);
  assert.equal(store.getState().ui.selectedComponentId, canvas.id);
  assert.equal(store.getState().ui.selectedChainItemId, "");
});

test("Canvas workspace selects a Canvas and components are added as ordinary sources", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  source.id = "source-component";
  const canvas = createCanvasComponent(0);
  canvas.id = "canvas-component";
  canvas.canvas.width = 2000;
  canvas.canvas.height = 1000;
  state.components = [source, canvas];
  state.ui.selectedComponentId = source.id;
  const store = createAppState(state);

  store.setWorkspace("canvas");
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
  const firstCanvas = createCanvasComponent(0);
  firstCanvas.id = "canvas-first";
  const secondCanvas = createCanvasComponent(1);
  secondCanvas.id = "canvas-second";
  state.components = [firstComponent, secondComponent, firstCanvas, secondCanvas];
  state.ui.workspace = "component";
  state.ui.selectedComponentId = firstComponent.id;
  state.ui.workspaceSelectionIds = { component: firstComponent.id, canvas: firstCanvas.id };
  const store = createAppState(state);

  store.selectComponent(secondComponent.id);
  store.setWorkspace("canvas");
  assert.equal(store.getState().ui.selectedComponentId, firstCanvas.id);

  store.selectComponent(secondCanvas.id);
  store.setWorkspace("scene");
  store.setWorkspace("component");
  assert.equal(store.getState().ui.selectedComponentId, secondComponent.id);

  store.setWorkspace("live");
  store.setWorkspace("canvas");
  assert.equal(store.getState().ui.selectedComponentId, secondCanvas.id);
  assert.deepEqual(store.getState().ui.workspaceSelectionIds, {
    component: secondComponent.id,
    canvas: secondCanvas.id,
  });
});

test("entering Scene view preserves a surface source across catalog reorder", () => {
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
  state.scenes = [createSceneFromState(state, "Stable assignment")];
  state.ui.selectedSceneId = state.scenes[0].id;
  state.ui.workspace = "component";
  state.ui.catalogSortModes.scene = "recent";
  const store = createAppState(state);

  store.setWorkspace("scene");
  const route = store.getState().scenes[0].snapshot.surfaces.find((surface) => surface.id === state.surfaces[0].id);
  assert.equal(route.sourceNodeId, `component:${encodeURIComponent(second.id)}`);
  assert.equal(route.componentId, second.id);
});

test("canvas recording frames are shared across canvases and removed routes clear safely", () => {
  const state = createInitialState();
  const source = createDefaultComponent(0);
  const firstCanvas = createCanvasComponent(0, source.id);
  const secondCanvas = createCanvasComponent(1, source.id);
  state.components = [source, firstCanvas, secondCanvas];
  const frameId = state.recordingFrames[0].id;
  firstCanvas.canvas.frameThumbnails = { [frameId]: "first-crop" };
  secondCanvas.canvas.frameThumbnails = { [frameId]: "second-crop" };
  state.surfaces[0].componentId = firstCanvas.id;
  state.surfaces[0].outputFrameId = frameId;
  state.surfaces[1].componentId = secondCanvas.id;
  state.surfaces[1].outputFrameId = frameId;
  state.scenes = [createSceneFromState(state, "Canvas scene")];
  const store = createAppState(state);

  store.addCanvasFrame(firstCanvas.id);
  assert.equal(store.getState().recordingFrames.length, 2);
  assert.equal("frames" in store.getState().components.find((component) => component.id === firstCanvas.id).canvas, false);
  assert.equal("frames" in store.getState().components.find((component) => component.id === secondCanvas.id).canvas, false);

  store.removeCanvasFrame(firstCanvas.id, frameId);
  const next = store.getState();
  assert.equal(next.recordingFrames.some((frame) => frame.id === frameId), false);
  assert.equal(frameId in next.components.find((component) => component.id === firstCanvas.id).canvas.frameThumbnails, false);
  assert.equal(frameId in next.components.find((component) => component.id === secondCanvas.id).canvas.frameThumbnails, false);
  assert.equal(next.surfaces[0].outputFrameId, "");
  assert.equal(next.surfaces[1].outputFrameId, "");
  assert.equal(next.scenes[0].snapshot.surfaces[0].outputFrameId, "");
  assert.equal(next.scenes[0].snapshot.surfaces[1].outputFrameId, "");
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
  assert.equal(chain[0].source.mediaId, "models/head.stl");
  assert.equal(chain[1].kind, "source");
  assert.equal(chain[1].source.generatorId, "gradient");
  assert.equal(chain[1].source.params.colorA, "#ff4f92ff");
  assert.equal(chain[1].source.params.colorD, "#00000000");
  assert.equal(chain[2].componentId, "pixelate");
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

test("group transform survives normalization for preview handles", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  group.transform = { x: 0.2, y: -0.1, scale: 0.7, rotation: 0.35 };
  component.chain = [
    createComponentLayer(0, { type: "generator", generatorId: "gradient" }),
    group,
  ];
  state.components = [component];

  const store = createAppState(state);
  const normalizedGroup = store.getState().components[0].chain[1];

  assert.deepEqual(normalizedGroup.transform, group.transform);
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
    ["eyeball", "source.media", "pixelate"]
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
