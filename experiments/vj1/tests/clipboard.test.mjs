import test from "node:test";
import assert from "node:assert/strict";

import { chainPasteTarget, clipboardPayloadForTarget, copyComponentAsCanvas, pasteClipboardPayload } from "../js/domain/clipboard.js";
import { createCanvasComponent, createComponentGroup, createComponentLayer, createDefaultComponent, createDefaultSurface, createInitialState, createSceneFromState } from "../js/domain/models.js";

test("Component list paste creates an independent copy with fresh nested ids", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const group = createComponentGroup(0);
  group.chain.push(createComponentLayer(1, { type: "generator", generatorId: "noise" }));
  component.chain = [group];
  state.components = [component];
  const payload = clipboardPayloadForTarget(state, { kind: "component-list", itemId: component.id });

  const result = pasteClipboardPayload(state, payload, { kind: "component-list" });
  const copy = state.components[1];

  assert.equal(result.pasted, true);
  assert.equal(copy.name, `${component.name} Copy`);
  assert.notEqual(copy.id, component.id);
  assert.notEqual(copy.chain[0].id, component.chain[0].id);
  assert.notEqual(copy.chain[0].chain[0].id, component.chain[0].chain[0].id);
});

test("a Component converts to an independent Canvas copy in the shared Canvas coordinate space", () => {
  const state = createInitialState();
  state.render.width = 1200;
  state.render.height = 800;
  state.render.componentTexture = { width: 1200, height: 800 };
  const component = createDefaultComponent(0);
  component.name = "Portrait";
  component.frameShape = "portrait";
  const group = createComponentGroup(0);
  group.chain.push(createComponentLayer(1, { type: "generator", generatorId: "noise" }));
  component.chain = [group];
  state.components = [component];

  const result = copyComponentAsCanvas(state, component.id);
  const canvas = state.components.find((item) => item.id === result.id);

  assert.equal(result.converted, true);
  assert.equal(state.components[0], component);
  assert.equal(canvas.type, "canvas");
  assert.equal(canvas.name, "Portrait Canvas");
  assert.equal(Object.hasOwn(canvas.canvas, "width"), false);
  assert.equal(Object.hasOwn(canvas.canvas, "height"), false);
  assert.equal(state.render.canvasAspectRatio, 16 / 9);
  assert.equal(Object.hasOwn(state.render, "canvasSize"), false);
  assert.equal(canvas.thumbnail, "");
  assert.notEqual(canvas.id, component.id);
  assert.notEqual(canvas.chain[0].id, component.chain[0].id);
  assert.notEqual(canvas.chain[0].chain[0].id, component.chain[0].chain[0].id);
  assert.equal(state.ui.workspaceSelectionIds.canvas, canvas.id);
});

test("copied Components become references when pasted into a Canvas", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const canvas = createCanvasComponent(0);
  state.components = [component, canvas];

  const result = pasteClipboardPayload(
    state,
    { kind: "component", value: component },
    { kind: "chain", componentId: canvas.id }
  );

  assert.equal(result.pasted, true);
  assert.equal(canvas.chain[0].source.type, "component");
  assert.equal(canvas.chain[0].source.componentId, component.id);
  assert.ok(canvas.chain[0].source.placement.scale > 0);
});

test("pasted elements also start disabled when their Canvas has a connected Live output", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const canvas = createCanvasComponent(0);
  state.components = [component, canvas];
  state.surfaces[0].enabled = true;
  state.surfaces[0].componentId = canvas.id;
  const scene = createSceneFromState(state, "Program");
  state.scenes = [scene];
  state.ui.live.selectedSceneId = scene.id;
  state.ui.live.sceneSnapshot = structuredClone(scene.snapshot);
  state.metrics.clients = 1;
  state.metrics.outputs = { "output-main": 1 };

  const result = pasteClipboardPayload(
    state,
    { kind: "component", value: component },
    { kind: "chain", componentId: canvas.id }
  );

  assert.equal(result.pasted, true);
  assert.equal(canvas.chain[0].source.componentId, component.id);
  assert.equal(canvas.chain[0].enabled, false);
});

test("pasting a Component onto a Canvas list row targets that Canvas chain", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const canvas = createCanvasComponent(0);
  state.components = [component, canvas];

  const result = pasteClipboardPayload(
    state,
    { kind: "component", value: component },
    { kind: "canvas-list", itemId: canvas.id }
  );

  assert.equal(result.pasted, true);
  assert.equal(canvas.chain[0].source.componentId, component.id);
});

test("chain paste inserts after an element or inside the selected Group", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const first = component.chain[0];
  const group = createComponentGroup(0);
  component.chain.push(group);
  state.components = [component];
  const copied = { kind: "chain-item", value: createComponentLayer(1, { type: "generator", generatorId: "gradient" }) };

  const after = pasteClipboardPayload(state, copied, { kind: "chain", componentId: component.id, itemId: first.id });
  const inside = pasteClipboardPayload(state, copied, { kind: "group", componentId: component.id, itemId: group.id });

  assert.equal(after.pasted, true);
  assert.equal(inside.pasted, true);
  assert.equal(component.chain[1].source.generatorId, "gradient");
  assert.equal(group.chain.length, 1);
  assert.notEqual(component.chain[1].id, group.chain[0].id);
  assert.deepEqual(chainPasteTarget(state, component.id, group.id), { kind: "group", componentId: component.id, itemId: group.id });
});

test("a Canvas element copied into a Component remains a chain element", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  const canvas = createCanvasComponent(0);
  const canvasElement = createComponentLayer(1, { type: "generator", generatorId: "gradient" });
  canvas.chain = [canvasElement];
  state.components = [component, canvas];
  const payload = clipboardPayloadForTarget(state, {
    kind: "chain-item",
    componentId: canvas.id,
    itemId: canvasElement.id,
  });

  const result = pasteClipboardPayload(state, payload, {
    kind: "component-list",
    itemId: component.id,
  });

  assert.equal(payload.kind, "chain-item");
  assert.equal(result.pasted, true);
  assert.equal(result.kind, "chain-item");
  assert.equal(state.components.length, 2);
  assert.equal(component.chain.at(-1).source.generatorId, "gradient");
  assert.notEqual(component.chain.at(-1).id, canvasElement.id);
});

test("Scenes and mapped surfaces duplicate only into their matching lists", () => {
  const state = createInitialState();
  const scene = createSceneFromState(state, "Scene A");
  const surface = { ...createDefaultSurface(2), id: "surface-a", mappingId: "surface-a", name: "Surface A" };
  state.scenes = [scene];
  state.surfaces = [surface];
  state.mappings = { local: { surfaces: [{ name: surface.id, corners: [{ x: 1, y: 2 }] }] } };

  const sceneResult = pasteClipboardPayload(state, { kind: "scene", value: scene }, { kind: "scene-list" });
  const surfaceResult = pasteClipboardPayload(state, { kind: "surface", value: surface }, { kind: "surface-list" });

  assert.equal(sceneResult.pasted, true);
  assert.equal(state.scenes[1].name, "Scene A Copy");
  assert.notEqual(state.scenes[1].id, scene.id);
  assert.equal(surfaceResult.pasted, true);
  assert.equal(state.surfaces[1].name, "Surface A Copy");
  assert.notEqual(state.surfaces[1].id, surface.id);
  assert.equal(state.scenes[0].snapshot.surfaces.some((item) => item.id === state.surfaces[1].id), true);
  assert.deepEqual(state.mappings.local.surfaces[1], { name: state.surfaces[1].id, corners: [{ x: 1, y: 2 }] });
});

test("pasted media becomes a source only for chain destinations", () => {
  const state = createInitialState();
  const component = createDefaultComponent(0);
  state.components = [component];

  const library = pasteClipboardPayload(state, { kind: "media", value: { id: "media/image.png" } }, { kind: "media-library" });
  const chain = pasteClipboardPayload(state, { kind: "media", value: { id: "media/image.png" } }, { kind: "chain", componentId: component.id });

  assert.equal(library.pasted, false);
  assert.equal(component.chain.length, 2);
  assert.equal(chain.pasted, true);
  assert.equal(component.chain[1].source.mediaId, "media/image.png");

  const listTarget = pasteClipboardPayload(
    state,
    { kind: "media", value: { id: "media/second.png" } },
    { kind: "component-list", itemId: component.id }
  );
  assert.equal(listTarget.pasted, true);
  assert.equal(component.chain[2].source.mediaId, "media/second.png");
});
