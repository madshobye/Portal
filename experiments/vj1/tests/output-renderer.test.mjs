import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { averageGpuQueryNanoseconds, cameraCaptureSettings, cameraSettingsSignature, sceneComponentPlacementRect, sceneFrameBorderHit, sceneMaxRasterSize, scenePreviewRenderRequest, chainTransformDragScale, compiledNativeSourceRenderer, compiledVisualSourceRenderer, componentAdaptiveRasterLimit, componentInstanceTime, componentLogicalPreviewRect, componentPipelineSourceRequest, componentPreviewRenderRequest, componentReferenceCount, componentReferencePlacement, componentReferencePrefersSharedTexture, componentReferenceRegionRequest, componentReferenceRenderRequest, componentRenderInstanceKey, componentSourceView, directFitRects, effectNeedsComposite, eyeballFrameUniforms, fittedThumbnailSize, GpuTimerTracker, moveSceneFrameRect, OutputRenderer, pointInTransformedRect, qualityScaledRenderRequest, resizeSceneFrameRect, sharedComponentRenderRequests, visualOperationRenderItem } from "../js/output/output-renderer.js";
import { createPlacedRenderResult, directPlacementKind, transformedPlacementDemandRect } from "../js/graph/placed-render-result.js";
import { defaultProjectSurfaceMapping, outputFrameForId, outputFrames, renderRequestKey, worldSize } from "../js/output/render-geometry.js";
import { mapperFragmentShaderSource, VjMapper } from "../js/libraries/mapping-engine/mapping-engine/index.js";
import { ComponentPreviewInteraction, stateWithSceneFrameRect, stateWithChainItemBoundary, stateWithChainItemTransform } from "../js/output/component-preview-interaction.js";
import { compileOutputGroupTopology, compileMappingGroupTopology } from "../js/libraries/composition-engine/index.js";

test("effect opacity and blend request a separate generic composite", () => {
  assert.equal(effectNeedsComposite({}), false);
  assert.equal(effectNeedsComposite({ opacity: 1, blend: "normal" }), false);
  assert.equal(effectNeedsComposite({ opacity: 0.5, blend: "normal" }), true);
  assert.equal(effectNeedsComposite({ opacity: 1, blend: "screen" }), true);
});

test("native source dispatch follows the compiled node hook instead of generator-name branching", () => {
  const operation = {
    backend: "native-specialized",
    renderer: "output/specialized:terrainFlyover",
  };
  const source = { type: "generator", generatorId: "renamed-terrain-node" };
  assert.equal(compiledNativeSourceRenderer(operation, source), "output/specialized:terrainFlyover");
  assert.equal(compiledNativeSourceRenderer({ backend: "native-specialized" }, source, {
    nodeDefinition: { metadata: { nativeRenderer: "output/specialized:text" } },
  }), "output/specialized:text");

  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.doesNotMatch(rendererSource, /source\.generatorId === "terrainFlyover"/);
  assert.doesNotMatch(rendererSource, /source\.generatorId === "text"/);
  assert.match(rendererSource, /NATIVE_SOURCE_HOST_METHODS\[rendererId\]/);
});

test("ordinary source dispatch follows the compiled node hook with a legacy source fallback", () => {
  assert.equal(compiledVisualSourceRenderer({
    backend: "source-runtime",
    renderer: "output/source:media",
  }, { type: "camera" }), "output/source:media");
  assert.equal(compiledVisualSourceRenderer({}, { type: "camera" }), "output/source:camera");
});
import { createInitialState } from "../js/domain/models.js";

function pickRequestSize(request) {
  return { width: request.width, height: request.height };
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test("local transform overlays path-copy store-owned component and frame state", () => {
  const child = { id: "child", kind: "source", transform: { x: 0, y: 0, scale: 1, rotation: 0 } };
  const group = { id: "group", kind: "group", chain: [child] };
  const component = { id: "component", chain: [group] };
  const frame = { id: "frame", x: 0, y: 0, width: 100, height: 100 };
  const state = { components: [component], frames: [frame] };

  const transformed = stateWithChainItemTransform(state, component.id, child.id, { x: 0.5 });
  const bounded = stateWithChainItemBoundary(transformed, component.id, child.id, { width: 0.5, height: 0.5, rotation: 0.3 });
  const framed = stateWithSceneFrameRect(bounded, frame.id, { y: 24 });

  assert.equal(child.transform.x, 0, "the store-owned nested item is not mutated");
  assert.equal(frame.y, 0, "the store-owned recording frame is not mutated");
  assert.equal(framed.components[0].chain[0].chain[0].transform.x, 0.5);
  assert.equal(framed.components[0].chain[0].chain[0].boundary.rotation, 0.3);
  assert.equal(framed.components[0].chain[0].chain[0].boundary.width, 0.5);
  assert.equal(framed.frames[0].y, 24);
  assert.equal(framed.components[0].chain[0].id, group.id);
});

test("local drag overlays refresh only the changed lookup entry", () => {
  const component = { id: "component", chain: [{ id: "item", kind: "source", transform: {} }] };
  const frame = { id: "frame", x: 0, y: 0, width: 100, height: 100 };
  const renderer = new OutputRenderer({ mode: "component" });
  renderer.state = { components: [component], frames: [frame], surfaces: [], render: {}, ui: {} };
  renderer.rebuildRouteLookups();
  let patchedProgramItem = null;
  renderer.componentPrograms.set(component.id, {
    replaceChainItem(itemId, item) {
      assert.equal(itemId, "item");
      patchedProgramItem = item;
      return true;
    },
  });
  let fullRebuilds = 0;
  renderer.rebuildRouteLookups = () => { fullRebuilds++; };
  const interaction = new ComponentPreviewInteraction(renderer);

  interaction.applyLocalChainTransform(component.id, "item", { x: 0.25 });
  interaction.applyLocalSceneFrame(frame.id, { y: 20 });

  assert.equal(fullRebuilds, 0);
  assert.equal(renderer.componentById.get(component.id).chain[0].transform.x, 0.25);
  assert.equal(patchedProgramItem.transform.x, 0.25, "the rendered program follows the local preview overlay immediately");
  assert.equal(renderer.recordingFrameById.get(frame.id).y, 20);
});

test("compiled Output topology gates the existing Mapping route program", () => {
  const state = createInitialState();
  state.surfaces[0].enabled = true;
  state.surfaces[0].componentId = state.components[0].id;
  const sceneGroup = compileMappingGroupTopology({ id: "", name: "Working Mapping" }, state.surfaces);
  const outputGroup = compileOutputGroupTopology();
  state.nodes = { groups: [sceneGroup, outputGroup] };
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = state;
  renderer.rebuildMappingPrograms();

  assert.equal(renderer.outputProgram.enabled, true);
  assert.deepEqual(
    renderer.mappingProgramSurfaces().map((surface) => surface.id),
    state.surfaces.map((surface) => surface.id)
  );

  outputGroup.connections = outputGroup.connections.filter((edge) => edge.to !== "$out.output");
  renderer.rebuildMappingPrograms();
  assert.equal(renderer.outputProgram.enabled, false);
  assert.deepEqual(renderer.mappingProgramSurfaces(), []);
});

test("preview transform ownership survives stale state until an exact acknowledgement", () => {
  const transform = { x: 0.4, y: -0.2, scale: 1.5, rotation: 0.3 };
  const rect = { x: 30, y: 40, width: 120, height: 80 };
  const stale = {
    components: [{ id: "component", chain: [{ id: "item", kind: "source", transform: { x: 0, y: 0, scale: 1, rotation: 0 } }] }],
    frames: [{ id: "frame", x: 0, y: 0, width: 100, height: 100 }],
    ui: { selectedChainItemId: "" },
  };
  const interaction = new ComponentPreviewInteraction({});
  interaction.pendingChainTransform = { componentId: "component", itemId: "item", transform };
  interaction.pendingSceneFrame = { frameId: "frame", rect };

  const reconciled = interaction.reconcileIncomingState(stale);
  assert.deepEqual(stale.components[0].chain[0].transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(stale.frames[0].x, 0);
  assert.deepEqual(reconciled.components[0].chain[0].transform, transform);
  assert.deepEqual(reconciled.frames[0], { id: "frame", ...rect });
  assert.equal(reconciled.ui.selectedChainItemId, "item");
  assert.ok(interaction.pendingChainTransform);
  assert.ok(interaction.pendingSceneFrame);

  const acknowledged = stateWithSceneFrameRect(
    stateWithChainItemTransform(stale, "component", "item", transform),
    "frame",
    rect
  );
  assert.equal(interaction.reconcileIncomingState(acknowledged), acknowledged);
  assert.equal(interaction.pendingChainTransform, null);
  assert.equal(interaction.pendingSceneFrame, null);
});

test("selected element handles take priority over overlapping Canvas recording frames", () => {
  const calls = [];
  const interaction = new ComponentPreviewInteraction({ mode: "component" });
  interaction.startChainTransformDrag = (_x, _y, options) => {
    calls.push(["chain", options]);
    return true;
  };
  interaction.startSceneFrameDrag = () => {
    calls.push(["frame"]);
    return true;
  };

  interaction.mousePressed(40, 50);

  assert.deepEqual(calls, [["chain", { handlesOnly: true }]]);
});

test("Canvas recording frames receive the pointer when no selected handle is hit", () => {
  const calls = [];
  const interaction = new ComponentPreviewInteraction({ mode: "component" });
  interaction.startChainTransformDrag = () => {
    calls.push(["chain"]);
    return false;
  };
  interaction.startSceneFrameDrag = () => {
    calls.push(["frame"]);
    return true;
  };

  interaction.mousePressed(40, 50);

  assert.deepEqual(calls, [["chain"], ["frame"]]);
});

test("element scale dragging uses a softened bounded response", () => {
  assert.equal(chainTransformDragScale(1, 40, 160), 2);
  assert.equal(chainTransformDragScale(1, 40, 10), 0.5);
  assert.equal(chainTransformDragScale(6, 40, 160), 8);
});

test("transformed physical bounds support translated scaled and rotated picking", () => {
  const frame = { x: 0, y: 0, width: 200, height: 100 };
  const rect = { x: 50, y: 25, width: 100, height: 50 };
  assert.equal(pointInTransformedRect(100, 50, frame, rect, {}), true);
  assert.equal(pointInTransformedRect(25, 50, frame, rect, {}), false);
  assert.equal(pointInTransformedRect(150, 50, frame, rect, { x: 0.5, scale: 0.5, rotation: Math.PI / 2 }), true);
  assert.equal(pointInTransformedRect(100, 50, frame, rect, { x: 0.5, scale: 0.5, rotation: Math.PI / 2 }), false);
});

test("preview picking selects physical sources, spatial effects, and containing groups", () => {
  const selected = [];
  const renderer = new OutputRenderer({ mode: "component", onChainItemSelect: (id) => selected.push(id) });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const groupedSource = { id: "source-b", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "media", mediaId: "image-a" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [groupedSource] };
  const ordinaryEffect = { id: "effect-a", kind: "effect", componentId: "labelChromatic", enabled: true, opacity: 1, transform: {} };
  const component = { id: "component-a", type: "chain", chain: [source, group, ordinaryEffect] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: "" } };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  assert.equal(renderer.selectChainItemAtPoint(100, 50)?.id, group.id);
  assert.equal(renderer.state.ui.selectedChainItemId, group.id);
  assert.deepEqual(selected, [group.id]);

  component.chain.push({ id: "effect-spatial", kind: "effect", componentId: "ripple", enabled: true, opacity: 1, transform: {} });
  renderer.state.ui.selectedChainItemId = "";
  assert.equal(renderer.selectChainItemAtPoint(100, 50)?.id, "effect-spatial");
});

test("preview body picking follows current boundaries and visual stacking rather than selection", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const left = {
    id: "left",
    kind: "source",
    enabled: true,
    opacity: 1,
    boundary: { x: -0.5, y: 0, width: 0.5, height: 1, rotation: 0 },
    source: { type: "generator", generatorId: "noise" },
  };
  const right = {
    id: "right",
    kind: "source",
    enabled: true,
    opacity: 1,
    boundary: { x: 0.5, y: 0, width: 0.5, height: 1, rotation: 0 },
    source: { type: "generator", generatorId: "plasma" },
  };
  const component = { id: "component-a", type: "chain", chain: [left, right] };
  renderer.state = {
    components: [component],
    render: {},
    ui: { selectedComponentId: component.id, selectedChainItemId: left.id },
  };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  assert.equal(renderer.chainItemAtPoint(50, 50), left);
  assert.equal(renderer.chainItemAtPoint(150, 50), right);

  right.boundary = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };
  assert.equal(renderer.chainItemAtPoint(50, 50), right, "the top item wins an overlapping body hit");
});

test("one preview press selects a physical element and begins moving it", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const component = { id: "component-a", type: "chain", chain: [source] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: "" } };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(80, 40);

  assert.equal(renderer.state.ui.selectedChainItemId, source.id);
  assert.equal(renderer.chainTransformDrag?.itemId, source.id);
  assert.equal(renderer.chainTransformDrag?.mode, "boundary-move");
});

test("an already selected child inside a group owns the next preview drag", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const child = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [child] };
  const component = { id: "component-a", type: "chain", chain: [group] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: child.id } };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);

  assert.equal(renderer.state.ui.selectedChainItemId, child.id);
  assert.equal(renderer.chainTransformDrag?.itemId, child.id);
  assert.equal(renderer.chainTransformDrag?.mode, "boundary-move");
  assert.equal(renderer.state.components[0].chain[0].chain[0].boundary.x, 0.2);
  assert.deepEqual(child.transform, {}, "dragging does not mutate the store-owned fixture");
  assert.deepEqual(group.transform, {});
});

test("a selected Canvas Group cannot be picked outside the union of its placed children", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const childComponent = { id: "child-component", type: "chain", initialWidth: 100, initialHeight: 100, chain: [] };
  const child = {
    id: "child",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: {},
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const group = { id: "group", kind: "group", enabled: true, opacity: 1, transform: {}, chain: [child] };
  const canvas = { id: "canvas", type: "scene", canvas: { width: 400, height: 400 }, chain: [group] };
  renderer.state = {
    components: [canvas, childComponent],
    render: { canvasSize: { width: 400, height: 400 } },
    ui: { selectedComponentId: canvas.id, selectedChainItemId: group.id },
  };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 400, height: 400 });

  assert.equal(renderer.chainItemAtPoint(200, 200), group);
  assert.equal(renderer.chainItemAtPoint(20, 20), null);
});

test("default Canvas Component references pick their placement instead of the whole Canvas", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const childComponent = { id: "child-component", type: "chain", frameShape: "landscape", chain: [] };
  const left = {
    id: "left",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: { x: -0.5, y: 0, scale: 1, rotation: 0 },
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const right = {
    id: "right",
    kind: "source",
    enabled: true,
    opacity: 1,
    transform: { x: 0.5, y: 0, scale: 1, rotation: 0 },
    source: { type: "component", componentId: childComponent.id, placement: { scale: 0.25 } },
  };
  const canvas = { id: "canvas", type: "scene", chain: [left, right] };
  renderer.state = {
    components: [canvas, childComponent],
    render: { sceneAspectRatio: 1, componentAspectRatio: 1 },
    ui: { selectedComponentId: canvas.id, selectedChainItemId: left.id },
  };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 400, height: 400 });

  assert.equal(renderer.chainItemAtPoint(100, 200), left);
  assert.equal(renderer.chainItemAtPoint(300, 200), right);
  assert.equal(renderer.chainItemAtPoint(20, 20), null);
});

test("child preview dragging is converted through its parent oriented boundary", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const child = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const group = { id: "group-a", kind: "group", enabled: true, opacity: 1, transform: {}, boundary: { x: 0, y: 0, width: 2, height: 2, rotation: Math.PI / 2 }, chain: [child] };
  const component = { id: "component-a", type: "chain", chain: [group] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: child.id } };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);

  const renderedChild = renderer.state.components[0].chain[0].chain[0];
  assert.ok(Math.abs(renderedChild.boundary.x) < 1e-12);
  assert.equal(renderedChild.boundary.y, -0.2);
  assert.deepEqual(child.transform, {}, "nested dragging path-copies instead of mutating its source state");
  assert.deepEqual(group.boundary, { x: 0, y: 0, width: 2, height: 2, rotation: Math.PI / 2 });
});

test("releasing a direct element drag commits one undoable boundary change", () => {
  const changes = [];
  const renderer = new OutputRenderer({
    mode: "component",
    sendChainBoundary: (componentId, itemId, boundary, meta) => changes.push({ componentId, itemId, boundary, meta }),
  });
  const source = { id: "source-a", kind: "source", enabled: true, opacity: 1, transform: {}, source: { type: "generator", generatorId: "noise" } };
  const component = { id: "component-a", type: "chain", chain: [source] };
  renderer.state = { components: [component], render: {}, ui: { selectedComponentId: component.id, selectedChainItemId: source.id } };
  renderer.componentPreviewRect = () => ({ x: 0, y: 0, width: 200, height: 100 });

  renderer.mousePressed(100, 50);
  renderer.mouseDragged(120, 50);
  renderer.mouseReleased();

  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].meta, { commit: false });
  assert.deepEqual(changes[1].meta, { commit: true });
  assert.deepEqual(changes[1].boundary, changes[0].boundary);
});

test("global time stretch changes output clock rate without changing its phase", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = {
    global: { playing: true, timeStretch: -1 },
    components: [{ id: "component-a", speed: 1 }],
  };
  renderer.lastTickMs = 1000;

  renderer.tickClock(1100);
  assert.equal(renderer.visualTime, 0.05);
  assert.equal(renderer.componentTimes.get("component-a"), 0.05);

  renderer.state.global.timeStretch = 1;
  renderer.tickClock(1200);
  assert.equal(renderer.visualTime, 0.25);
  assert.equal(renderer.componentTimes.get("component-a"), 0.25);

  renderer.state.global.playing = false;
  renderer.tickClock(1300);
  assert.equal(renderer.visualTime, 0.25);
  assert.equal(renderer.visualDeltaSeconds, 0);

  renderer.state.global = { playing: true };
  renderer.tickClock(1400);
  assert.equal(renderer.visualTime, 0.35);

  renderer.state.global.timeStretch = -4;
  renderer.tickClock(1500);
  assert.equal(renderer.visualTime, 0.35);
  assert.equal(renderer.visualDeltaSeconds, 0);

  renderer.state.global.timeStretch = 4;
  renderer.tickClock(1600);
  assert.ok(Math.abs(renderer.visualTime - 1.95) < 1e-12);
});

test("camera capture settings map project preferences to the Portal camera contract", () => {
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 960, height: 540, mode: "preview", outputId: "" },
    camera: {
      facingMode: "environment",
      mirrored: true,
      maxResolution: true,
    },
  };
  assert.deepEqual(cameraCaptureSettings(render), {
    width: 960,
    height: 540,
    front: false,
    mirrored: true,
    maxResolution: true,
  });
  assert.equal(cameraSettingsSignature(render), "960x540:rear:mirror:max");
});

test("projection corner drags emit live mapping updates before release", () => {
  const changes = [];
  const mapper = new VjMapper({
    onConfigChange: (mapping, meta) => changes.push({ mapping, reason: meta.reason }),
  });
  mapper.addSurface({
    id: "surface-main",
    name: "Main",
    width: 100,
    height: 100,
    corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  });
  mapper._dragSurf = 0;
  mapper._dragCorner = 0;
  mapper._dragMode = "corner";

  mapper.mouseDragged(12, 18);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, "drag");
  assert.deepEqual(changes[0].mapping.surfaces[0].corners[0], { x: 12, y: 18 });

  mapper.mouseReleased();
  assert.equal(changes[1].reason, "autosave");
});

test("local surface mappings remain authoritative until their exact acknowledgement", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  const local = { surfaces: [{ id: "surface-main", corners: [{ x: 12, y: 18 }] }] };
  const stale = { surfaces: [{ id: "surface-main", corners: [{ x: 0, y: 0 }] }] };

  renderer.markLocalMapping(local);
  assert.equal(renderer.shouldIgnoreIncomingMapping(JSON.stringify(stale)), true);
  assert.equal(renderer.pendingMappingSignature, JSON.stringify(local));
  assert.equal(renderer.shouldIgnoreIncomingMapping(JSON.stringify(local)), false);
  assert.equal(renderer.pendingMappingSignature, "");

  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (mappingInteractionActive) this.surfaceRebuildPending = true"));
  assert.ok(source.includes("this.rebuildSurfaces({ preferExistingMapping: true })"));
  assert.ok(source.includes("preferExistingMapping && existingProjectCorners?.length === 4"));
  assert.ok(!source.includes("localMappingProtectedUntil"));
});

test("an exact mapping echo acknowledges ownership while its drag is still active", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  const state = createInitialState();
  const local = {
    surfaces: state.surfaces.map((surface) => ({
      id: surface.id,
      name: surface.name,
      w: 100,
      h: 100,
      corners: [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 110 }, { x: 10, y: 110 }],
    })),
  };
  state.mappingCalibration = local;
  state.mappings[0].calibration = structuredClone(local);
  renderer.state = createInitialState();
  renderer.mapper = {
    isActive: () => true,
    setCalibrate() {},
    setOverlayMode() {},
  };
  renderer.mappingSignature = renderer.currentMappingSignature();
  renderer.markLocalMapping(local);

  renderer.setState(state);

  assert.equal(renderer.pendingMappingSignature, "");
});

test("standalone output permanently rejects calibration markers", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  let mapperCalibrating = true;
  renderer.state = { global: { calibrating: true } };
  renderer.mapper = {
    setCalibrate(value) {
      mapperCalibrating = value;
    },
    isCalibrating() {
      return mapperCalibrating;
    },
  };

  renderer.setCalibrate(true);

  assert.equal(renderer.state.global.calibrating, false);
  assert.equal(mapperCalibrating, false);
  assert.equal(renderer.isCalibrating(), false);
});

test("output diagnostics remain DOM-only and never add text to the GL surface path", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.equal(rendererSource.includes("renderOutputFrameOverlay"), false);
  assert.equal(rendererSource.includes("showLabels"), false);
  assert.ok(rendererSource.includes("this.renderResolutionLabel()"));
  assert.ok(appSource.includes('class="output-fps"'));
});

test("surface calibration keeps direct projection without materialized labels", () => {
  const renderer = new OutputRenderer({ mode: "preview" });
  renderer.state = {
    ui: { debugPreview: true },
    global: { showLabels: true },
  };
  renderer.mapper = { isCalibrating: () => true };

  assert.equal(renderer.canDirectProjectSurfaceRoute({ surface: { finalShaderChain: [] } }), true);
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  assert.equal(source.includes("drawSurfaceLabel"), false);
});

test("standalone outputs crop the shared mapping world to their configured viewport", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const renderer = new OutputRenderer({ mode: "output", outputId: "right" });
  renderer.state = {
    render: {
      outputs: [
        { id: "left", name: "Left", aspectRatio: 16 / 9 },
        { id: "right", name: "Right", aspectRatio: 8 / 5 },
      ],
      hostViewport: { width: 1280, height: 800, mode: "output", outputId: "right" },
    },
  };
  globalThis.width = 1280;
  globalThis.height = 800;

  try {
    assert.deepEqual(renderer.outputFrameSize(), { width: 1280, height: 800 });
    const frames = outputFrames(renderer.mappingProjectRender());
    const selected = frames.find((frame) => frame.id === "right");
    assert.deepEqual(renderer.outputFrameOffset(), { x: selected.x, y: selected.y });
    const mapped = renderer.mappingForRenderMode({
      surfaces: [{ id: "surface", corners: [
        { x: selected.x, y: selected.y },
        { x: selected.x + selected.width, y: selected.y },
        { x: selected.x + selected.width, y: selected.y + selected.height },
        { x: selected.x, y: selected.y + selected.height },
      ] }],
    });
    assertClose(mapped.surfaces[0].corners[0].x, 0);
    assertClose(mapped.surfaces[0].corners[0].y, 0);
    assertClose(mapped.surfaces[0].corners[2].x, 1280);
    assertClose(mapped.surfaces[0].corners[2].y, 800);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("output fallback surfaces derive from the same world mapping as preview", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [
      { id: "left", aspectRatio: 16 / 9 },
      { id: "right", aspectRatio: 8 / 5 },
    ],
    componentAspectRatio: 16 / 9,
    hostViewport: { width: 1280, height: 800, mode: "output", outputId: "right" },
  };
  const surface = { id: "mapped-surface", destination: { type: "mapped" } };
  const renderer = new OutputRenderer({ mode: "output", outputId: "right" });
  let added = null;
  renderer.state = {
    render,
    surfaces: [surface],
    mappings: { local: { surfaces: [] } },
  };
  renderer.mapper = {
    surfaces: [],
    clearSurfaces() {},
    addSurface(config) {
      added = config;
      return config;
    },
  };
  globalThis.width = 1280;
  globalThis.height = 800;

  try {
    renderer.rebuildSurfaces();
    const worldCorners = defaultProjectSurfaceMapping(renderer.mappingProjectRender(), [surface])[0].corners;
    assert.deepEqual(added.corners, worldCorners.map((corner) => renderer.worldPointToDisplay(corner)));
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("direct output presentation handles stretch contain and cover without homography", () => {
  const target = { x: 100, y: 50, width: 1000, height: 1000 };
  assert.deepEqual(directFitRects(2000, 1000, target, "stretch"), {
    source: { x: 0, y: 0, width: 2000, height: 1000 },
    destination: target,
  });
  assert.deepEqual(directFitRects(2000, 1000, target, "contain").destination, {
    x: 100, y: 300, width: 1000, height: 500,
  });
  assert.deepEqual(directFitRects(2000, 1000, target, "cover").source, {
    x: 500, y: 0, width: 1000, height: 1000,
  });
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  assert.ok(source.includes("else if (mapped.direct) this.drawDirectSurfaceTexture(target, route)"));
  assert.ok(source.includes("mapped.direct && Number(surface.feather) > 0"));
  assert.ok(plannerSource.includes("preserveFullFootprint: mapped.direct"));
});

test("GPU timing averages query samples instead of adding overlapping work", () => {
  assert.equal(averageGpuQueryNanoseconds([30_000_000, 10_000_000, 5_000_000]), 15_000_000);
  assert.equal(averageGpuQueryNanoseconds([]), 0);
});

test("GPU timing instrumentation bounds unresolved query backlog", () => {
  let nextQuery = 0;
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension(name) {
      return name === "EXT_disjoint_timer_query_webgl2" ? extension : null;
    },
    createQuery() { return { id: ++nextQuery }; },
    deleteQuery() {},
    beginQuery() {},
    endQuery() {},
    getQueryParameter(query, parameter) {
      return parameter === this.QUERY_RESULT_AVAILABLE ? false : 0;
    },
    getParameter() { return false; },
  };
  const timer = new GpuTimerTracker({ sampleInterval: 1, maxPending: 3, maxQueryAgeFrames: 4 });

  for (let frame = 1; frame <= 8; frame++) {
    const token = timer.begin(gl, frame);
    timer.end(token);
    timer.sealFrame(frame);
  }

  assert.equal(timer.pending.length, 3);
  assert.equal(nextQuery, 3);
  timer.poll(8);
  assert.equal(timer.pending.length, 0);
  assert.equal(timer.frames.size, 0);
});

test("GPU timing samples periodically instead of instrumenting every render frame", () => {
  const timer = new GpuTimerTracker();
  assert.equal(timer.begin({}, 1), null);
  assert.equal(timer.begin({}, 5), null);
});

test("stable component cache refreshes the exact GPU buffer usage key", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const lookup = source.slice(
    source.indexOf("    const stableGpuKey ="),
    source.indexOf("    if (component.type === \"canvas\")")
  );

  assert.ok(lookup.includes("this.componentGpuBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.componentBuffer.get(stableGpuKey)"));
  assert.ok(lookup.includes("this.renderCache.touch(\"gpu-buffer\", stableGpuKey, this.frameIndex)"));
  assert.ok(lookup.includes("this.renderCache.touch(\"buffer\", stableGpuKey, this.frameIndex)"));
});

test("render-cache maintenance follows resource expiry or hard pressure instead of a frame cadence", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const cacheSource = readFileSync(new URL("../js/libraries/cache-engine/render-cache/index.js", import.meta.url), "utf8");
  assert.match(cacheSource, /frameIndex < this\.nextIdlePruneFrame/);
  assert.match(cacheSource, /this\.gpuBufferUse\.size > COMPONENT_GPU_BUFFER_CACHE_LIMIT/);
  assert.match(cacheSource, /nextRenderCacheExpiry/);
  assert.match(rendererSource, /this\.pruneComponentTimes\(\);/);
  assert.doesNotMatch(rendererSource, /COMPONENT_TIME_MAINTENANCE_FRAMES/);
});

test("component pipeline lowers physical render pixels but preserves logical output dimensions", () => {
  const request = {
    role: "surface",
    width: 1200,
    height: 800,
    logicalWidth: 1200,
    logicalHeight: 800,
    renderIdentity: "component-a",
  };
  const scaled = componentPipelineSourceRequest(request, {
    upscaling: { enabled: true, amount: 0.65 },
  });

  assert.equal(scaled.width, 780);
  assert.equal(scaled.height, 520);
  assert.equal(scaled.logicalWidth, 1200);
  assert.equal(scaled.logicalHeight, 800);
  assert.equal(scaled.renderIdentity, "component-a");
  assert.equal(scaled.pipelineSource, true);
  assert.strictEqual(componentPipelineSourceRequest(request, {
    upscaling: { enabled: false, amount: 0.5 },
  }), request);
});

test("a nested regional Component allocates only its visible source fraction", () => {
  const request = componentReferenceRegionRequest({
    role: "texture",
    width: 3472,
    height: 3472,
    logicalWidth: 1500,
    logicalHeight: 1000,
    renderIdentity: "component-a",
  }, [0.25, 0.1, 0.5, 0.4], { reason: "test-region" });

  assert.equal(request.width, 1736);
  assert.equal(request.height, 1389);
  assert.equal(request.logicalWidth, 1500);
  assert.equal(request.logicalHeight, 1000);
  assert.equal(request.renderIdentity, "component-a");
  assert.equal(request.regionView, true);
  assert.deepEqual(request.uvRect, [0.25, 0.1, 0.5, 0.4]);
});

test("small repeated synchronized Component references converge on reusable resolution classes", () => {
  const render = { componentAspectRatio: 1, pixelDensity: 1 };
  const component = { id: "shared", type: "chain", frameShape: "square", syncInstances: true };
  const first = componentReferenceRenderRequest(render, component, { width: 300, height: 300 }, { sharedResolutionClass: true });
  const second = componentReferenceRenderRequest(render, component, { width: 320, height: 320 }, { sharedResolutionClass: true });

  assert.deepEqual(pickRequestSize(first), pickRequestSize(second));
  assert.ok(first.width >= 320 && first.width < 512);
  assert.equal(componentReferencePrefersSharedTexture(component, 5, first), true);
  assert.equal(componentReferencePrefersSharedTexture(component, 1, first), false);
  assert.equal(componentReferencePrefersSharedTexture({ ...component, syncInstances: false }, 5, first), false);
  assert.equal(componentReferencePrefersSharedTexture(component, 5, { width: 2048, height: 2048 }), false);
});

test("Component reference counting follows enabled nested Canvas groups", () => {
  const component = { chain: [
    { kind: "source", source: { type: "component", componentId: "shared" } },
    { kind: "group", chain: [
      { kind: "source", source: { type: "component", componentId: "shared" } },
      { kind: "source", enabled: false, source: { type: "component", componentId: "shared" } },
    ] },
  ] };
  assert.equal(componentReferenceCount(component, "shared"), 2);
});

test("component post filters run after the upscale target", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const pipelineSource = source.slice(
    source.indexOf("  renderComponentOutputPipeline("),
    source.indexOf("  cacheComponentOutput(")
  );

  assert.ok(pipelineSource.indexOf('`${component.id}:upscale:') < pipelineSource.indexOf('`${component.id}:post:'));
  assert.ok(source.includes("COMPONENT_UPSCALE_FRAGMENT_SHADER"));
  assert.ok(source.includes("COMPONENT_POST_FRAGMENT_SHADER"));
  assert.ok(source.includes('shaderProgram.setUniform("noiseAmount"'));
  assert.ok(source.includes('shaderProgram.setUniform("grayscaleAmount"'));
});

test("Live Component transform is placed by its parent instead of cropped into its own texture", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");

  assert.ok(source.includes("return pipelined;"));
  assert.ok(!source.includes("renderComponentRootTransform("));
  assert.ok(source.includes("transform: component.transform"));
  assert.ok(source.includes("combineContentTransforms(source.contentTransform, dependency.transform)"));
  assert.ok(surfaceSource.includes("drawTransformedSampleRect("));
  assert.ok(surfaceSource.includes('surface.frameFitActive ? surface.frameFit : "stretch"'));
  assert.ok(surfaceSource.includes("isIdentityTransform(route.component?.transform)"));
});

test("output resize derives its backing geometry from the current host viewport", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1920, height: 1080, mode: "output", outputId: "output-main" },
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1920;
    globalThis.height = 1080;
    renderer.state = { render };

    assert.deepEqual(renderer.outputFrameSize(render), { width: 1920, height: 1080 });
    assert.deepEqual(renderer.displayCanvasSize(render), { width: 1920, height: 1080 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1920, height: 1080, density: 1 });
    assert.equal(renderer.renderResolutionLabel(render), "1920x1080");
    const projectFrame = outputFrameForId(renderer.mappingProjectRender(), "output-main");
    const topLeft = renderer.worldPointToDisplay({ x: projectFrame.x, y: projectFrame.y });
    const bottomRight = renderer.worldPointToDisplay({
      x: projectFrame.x + projectFrame.width,
      y: projectFrame.y + projectFrame.height,
    });
    assertClose(topLeft.x, 0);
    assertClose(topLeft.y, 0);
    assertClose(bottomRight.x, 1920);
    assertClose(bottomRight.y, 1080);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("standalone Output presentation covers a mismatched window without non-uniform surface scaling", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1200, height: 900, mode: "output", outputId: "output-main" },
  };
  const renderer = new OutputRenderer({ mode: "output", outputId: "output-main" });

  try {
    globalThis.width = 1200;
    globalThis.height = 900;
    renderer.state = { render };
    const transform = renderer.outputFrameTransform();
    const frame = outputFrames(renderer.mappingProjectRender())[0];
    assert.ok(Math.abs(transform.scale - (900 / frame.height)) < 1e-9);
    assert.ok(transform.x < 0);
    assert.ok(Math.abs(transform.y) < 1e-9);
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("standalone Output keeps relative Surface proportions across popup aspect changes", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const calibration = {
    coordinateSpace: "relative",
    surfaces: [{ id: "surface", corners: [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.7 },
      { x: 0.1, y: 0.7 },
    ] }],
  };
  const renderer = new OutputRenderer({ mode: "output", outputId: "output-main" });
  const aspectAt = (width, height) => {
    globalThis.width = width;
    globalThis.height = height;
    renderer.state = {
      render: {
        outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
        hostViewport: { width, height, mode: "output", outputId: "output-main" },
      },
      mappingCalibration: calibration,
    };
    const corners = renderer.projectMappingSurfaceCorners("surface").map((point) => renderer.worldPointToDisplay(point));
    return Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y)
      / Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  };

  try {
    assertClose(aspectAt(1445, 855), aspectAt(1327, 204));
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("embedded Live retains Scene project-world geometry instead of covering its HTML host", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  renderer.state = {
    render: {
      outputs: [{ id: "output-main", aspectRatio: 2 }],
      hostViewport: { width: 1000, height: 1000, mode: "preview", outputId: "" },
    },
  };

  assert.deepEqual(renderer.worldPointToDisplay({ x: 200, y: 300 }), { x: 200, y: 300 });
  assert.deepEqual(renderer.displayPointToWorld({ x: 200, y: 300 }), { x: 200, y: 300 });
});

test("hud render resolution reports GPU render pixels, not window size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    hostViewport: { width: 1280, height: 720, mode: "output", outputId: "output-main" },
    pixelDensity: 1.5,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1280;
    globalThis.height = 720;
    renderer.state = { render };

    assert.deepEqual(renderer.displayCanvasSize(render), { width: 1280, height: 720 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1920, height: 1080, density: 1.5 });
    assert.equal(renderer.renderResolutionLabel(render), "1920x1080 @1.5x");
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("Good embedded preview reports its final render-chain request at 2x", () => {
  const renderer = new OutputRenderer({ mode: "live" });
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
    pixelDensity: 1,
    previewRasterScale: 2,
  };
  renderer.state = { render };
  renderer.recordPresentedRenderRequest({ width: 2000, height: 1000 });
  assert.deepEqual(renderer.renderResolutionSize(render), { width: 2000, height: 1000, density: 2 });
  assert.equal(renderer.renderResolutionLabel(render), "2000x1000 @2x");
  assert.equal(renderer.previewViewportZoomLabel({ previewViewportZoom: 1.234 }), "1.23x view");
  const diagnostic = renderer.previewDiagnosticHudMarkup(60, {
    ...render,
    previewViewportZoom: 1.25,
    hostViewport: { width: 1000, height: 500 },
  });
  assert.match(diagnostic, /render 2000x1000 @2x/);
  assert.match(diagnostic, /1\.25x view/);
  assert.match(diagnostic, /p5 canvas/);
  assert.match(diagnostic, /windowWidth/);
  assert.match(diagnostic, /density param 1x/);
  assert.match(diagnostic, /p5 2x/);
});

test("terrain and parsed STL stay in the shared WebGL context while imported p5 models reuse a scratch target", () => {
  const previousCreateGraphics = globalThis.createGraphics;
  const previousCreateFramebuffer = globalThis.createFramebuffer;
  const previousNoStroke = globalThis.noStroke;
  const previousWebgl = globalThis.WEBGL;
  const created = [];
  const framebuffers = [];
  globalThis.WEBGL = "webgl";
  globalThis.noStroke = () => {};
  globalThis.createFramebuffer = ({ width, height, density, depth }) => {
    const framebuffer = {
      width,
      height,
      density,
      depth,
      renderer: { GL: {} },
      resize(nextWidth, nextHeight) {
        this.width = nextWidth;
        this.height = nextHeight;
        this.resizeCount = (this.resizeCount || 0) + 1;
      },
      remove() {},
    };
    framebuffers.push(framebuffer);
    return framebuffer;
  };
  globalThis.createGraphics = (width, height, mode) => {
    const target = {
      width,
      height,
      mode,
      appliedDensity: null,
      pixelDensity(value) {
        if (value !== undefined) this.appliedDensity = value;
        return this.appliedDensity;
      },
      resizeCanvas(nextWidth, nextHeight) {
        this.width = nextWidth;
        this.height = nextHeight;
        this.resizeCount = (this.resizeCount || 0) + 1;
      },
      noStroke() {},
    };
    created.push(target);
    return target;
  };

  const renderer = new OutputRenderer({ mode: "output" });
  renderer.state = { render: { pixelDensity: 0.5 } };

  try {
    const terrainLow = renderer.getTerrainTarget(1000, 563);
    const parsedModelLow = renderer.specializedSources.getRawModelTarget(1000, 563, 0.5);
    const modelLow = renderer.getModelTarget(1000, 563);
    assert.equal(terrainLow.__vj1SharedFramebuffer, true);
    assert.equal(parsedModelLow.__vj1SharedFramebuffer, true);
    assert.equal(terrainLow.pixelDensity(), 1);
    assert.equal(parsedModelLow.pixelDensity(), 1);
    assert.equal(terrainLow.framebuffer.depth, true);
    assert.equal(parsedModelLow.framebuffer.depth, true);
    assert.equal(modelLow.appliedDensity, 0.5);
    assert.equal(modelLow.mode, "webgl");

    renderer.state.render.pixelDensity = 1.5;
    const terrainHigh = renderer.getTerrainTarget(1000, 563);
    const parsedModelHigh = renderer.specializedSources.getRawModelTarget(1000, 563, 1.5);
    const modelHigh = renderer.getModelTarget(1000, 563);
    assert.equal(terrainHigh.__vj1PixelDensity, 1.5);
    assert.equal(parsedModelHigh.__vj1PixelDensity, 1.5);
    assert.equal(modelHigh.appliedDensity, 1.5);
    assert.strictEqual(terrainHigh, terrainLow);
    assert.strictEqual(parsedModelHigh, parsedModelLow);
    assert.strictEqual(modelHigh, modelLow);

    const terrainResolved = renderer.getTerrainTarget(500, 282, 1);
    const parsedModelResolved = renderer.specializedSources.getRawModelTarget(500, 282, 1);
    const modelResolved = renderer.getModelTarget(500, 282, 1);
    assert.equal(terrainResolved.__vj1PixelDensity, 1);
    assert.equal(parsedModelResolved.__vj1PixelDensity, 1);
    assert.equal(modelResolved.appliedDensity, 1);
    assert.strictEqual(terrainResolved, terrainLow);
    assert.strictEqual(parsedModelResolved, parsedModelLow);
    assert.strictEqual(modelResolved, modelLow);
    assert.equal(terrainResolved.framebuffer.resizeCount, 1);
    assert.equal(parsedModelResolved.framebuffer.resizeCount, 1);
    assert.equal(modelResolved.resizeCount, 1);
    assert.equal(renderer.specializedWebglTargets.size, 3);
    assert.equal(framebuffers.length, 2);
    assert.equal(created.length, 1);
  } finally {
    if (previousCreateGraphics === undefined) delete globalThis.createGraphics;
    else globalThis.createGraphics = previousCreateGraphics;
    if (previousCreateFramebuffer === undefined) delete globalThis.createFramebuffer;
    else globalThis.createFramebuffer = previousCreateFramebuffer;
    if (previousNoStroke === undefined) delete globalThis.noStroke;
    else globalThis.noStroke = previousNoStroke;
    if (previousWebgl === undefined) delete globalThis.WEBGL;
    else globalThis.WEBGL = previousWebgl;
  }
});

test("Terrain node helper and shader forks invalidate only their retained GPU resources", () => {
  const runtimeSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const terrainSource = readFileSync(new URL("../js/output/specialized/terrain-renderer.js", import.meta.url), "utf8");

  assert.match(runtimeSource, /const terrainModule = terrainNodeRuntimeModule\(operation\)/);
  assert.match(runtimeSource, /operation\?\.nodeCodeRevision \|\| operation\?\.nodeModuleRevision \|\| "legacy"/);
  assert.match(runtimeSource, /operation\?\.nodeShaderRevision \|\| operation\?\.nodeModuleRevision \|\| "legacy"/);
  assert.match(runtimeSource, /operation\?\.nodeShaderProgramRevisions\?\.surface \|\| shaderRevision/);
  assert.match(runtimeSource, /operation\?\.nodeShaderProgramRevisions\?\.wire \|\| shaderRevision/);
  assert.match(runtimeSource, /drawTerrainSurface\([^;]+terrainModule, codeRevision, nodeShaders, surfaceShaderRevision\)/);
  assert.match(runtimeSource, /drawTerrainWireframe\([^;]+terrainModule, codeRevision, nodeShaders, wireShaderRevision\)/);
  assert.match(terrainSource, /const sizeKey = `\$\{moduleRevision\}:\$\{widthCells\}:\$\{depthCells\}`/);
  assert.match(terrainSource, /const meshKey = `\$\{moduleRevision\}:\$\{widthCells\}:\$\{depthCells\}`/);
  assert.match(terrainSource, /resources\.shaderRevision !== shaderRevision/);
  assert.match(terrainSource, /nodeShaders\?\.\["terrain-surface-vertex"\]/);
  assert.match(terrainSource, /nodeShaders\?\.\["terrain-wire-vertex"\]/);
});

test("component thumbnails retain their aspect within the thumbnail bounds", () => {
  const source = readFileSync(new URL("../js/output/thumbnail-utils.js", import.meta.url), "utf8");

  assert.ok(source.includes("const COMPONENT_THUMBNAIL_WIDTH = 768;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_HEIGHT = 432;"));
  assert.ok(source.includes("const COMPONENT_THUMBNAIL_QUALITY = 0.92;"));
  assert.ok(source.includes('canvasToBlob(canvas, "image/webp", COMPONENT_THUMBNAIL_QUALITY)'));
  assert.ok(source.includes('canvasToBlob(canvas, "image/png")'));
  assert.deepEqual(fittedThumbnailSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1080, 1920), { width: 243, height: 432 });
  assert.deepEqual(fittedThumbnailSize(1000, 1000), { width: 432, height: 432 });
});

test("Canvas recording-frame thumbnails crop the rendered Canvas by logical frame geometry", () => {
  const source = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("component.scene?.frameThumbnails?.[frame.id]"));
  assert.ok(source.includes("sceneFrameCrop(output, state.render, state.frames, job.frameId)"));
  assert.ok(source.includes("job.frameId ? { frameId: job.frameId } : {}"));
  assert.ok(source.includes("const sample = boundedSampleRect(source, crop, sourceWidth, sourceHeight)"));
  assert.ok(source.includes("sample.x, sample.y, sample.width, sample.height"));
});

test("component thumbnails downsample on the GPU before a small readback", () => {
  const source = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("const needsComponentThumbnail = !component.thumbnail || this.signatures.get(component.id) !== signature;"));
  assert.ok(source.includes("const size = fittedThumbnailSize(sampleWidth, sampleHeight);"));
  assert.ok(source.includes("return target.get();"));
  assert.doesNotMatch(source, /\boutput\.get\(/);
  assert.ok(source.includes("this.pending.set(job.key, { ...job, generation: ++this.generation })"));
  assert.ok(source.includes("requestIdleCallback"));
});

test("sampled shader work retains its owning Component for deep performance links", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const profileSource = readFileSync(new URL("../js/output/output-render-profile.js", import.meta.url), "utf8");
  assert.ok(profileSource.includes("this.componentContext.push(meta)"));
  assert.ok(profileSource.includes("this.componentContext.pop()"));
  assert.ok(rendererSource.includes("...this.activeComponentProfileIdentity()"));
});

test("thumbnail capture is blocked while live preview rendering is disabled", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-thumbnail-runtime.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.ok(rendererSource.includes("if (!this.canCapture() || this.shouldUseThumbnailPreview()) return true;"));
  assert.ok(previewSource.includes("store.isDebugPreviewEnabled()"));
  assert.ok(previewSource.includes("if (!debugPreviewEnabled) return false;"));
});

test("paused previews contain thumbnails and canvas surface routes preserve sampling", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const source = `${rendererSource}\n${surfaceSource}`;
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.ok(source.includes('sceneEditorWorld: this.mode === "component" && this.state?.ui?.workspace === "scene"'));
  assert.ok(source.includes("thumbnail.img,"));
  assert.ok(source.includes('surface.frameFitActive ? surface.frameFit : "stretch"'));
  assert.ok(source.includes("renderer.mapper.drawTexture(target, mapped.mapperSurface, surface.projectionFit, surface.feather, {"));
  assert.ok(source.includes("opacity: surfaceRouteOpacity(route)"));
});

test("thumbnail preview uses a Canvas snapshot before component reconstruction and retains transform handles", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("captureThumbnailEditTransformBaselines()"));
  assert.ok(source.includes("renderSceneThumbnailSnapshotPreview(component)"));
  assert.ok(source.includes("renderSceneThumbnailEditPreview(component)"));
  assert.ok(source.indexOf("renderSceneThumbnailSnapshotPreview(component)") < source.indexOf("renderSceneThumbnailEditPreview(component)"));
  assert.ok(source.includes("combineContentTransforms(parentTransform, item.transform)"));
  assert.ok(source.includes("this.renderSelectedChainTransformOverlay();"));
  assert.ok(source.includes("if (this.shouldUseThumbnailPreview()) this.renderThumbnailComponents();"));
  assert.ok(source.includes("const rect = this.componentPreviewRect(component);"));
  assert.ok(source.includes("withScreenScissor(rect"));
  assert.ok(source.includes("drawImageCoverCrop(thumbnail.img"));
});

test("canvas rendering evaluates ordinary sources, Groups, effects, and shared route frames", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  const canvasRenderer = source.slice(
    source.indexOf("  renderSceneComponent("),
    source.indexOf("  renderComponentPatch(")
  );
  assert.ok(source.includes("this.renderComponentChainState("));
  assert.ok(source.includes("this.renderEffectNodeState(nodeId, state, renderedItem, componentTime, renderRequest)"));
  assert.ok(source.includes("this.renderDirectSourceNodeState(nodeId, state, component, renderedItem, componentTime, renderRequest)"));
  assert.ok(source.includes("this.renderLayerNodeState(nodeId, state, sourceState, { ...renderedItem, transform: {} }, renderRequest)"));
  assert.ok(source.includes("this.renderBoundedLayerNodeState(nodeId, state, groupState"));
  assert.ok(source.includes(": this.renderLayerNodeState(nodeId, state, groupState, { ...item, transform: {} }, renderRequest)"));
  assert.ok(source.includes("output.tint(255, 255 * clamp01(layer.opacity ?? 1))"));
  assert.ok(source.includes("applyBlend(output, layer.blend)"));
  assert.ok(source.includes('source.type === "component"'));
  assert.ok(source.includes("this.recordingFrameById"));
  assert.ok(source.includes("this.state?.frames || []"));
  assert.ok(source.includes("renderSceneFrames(component, source)"));
  assert.ok(source.includes("surface.outputFrameId"));
  assert.ok(plannerSource.includes("resolveRouteSourceNode(storedSurface)"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(canvasRenderer.includes("program.execute(this, component"));
  assert.ok(canvasRenderer.includes("VJ1_COMPONENT_PROGRAM_MISSING"));
  assert.ok(!canvasRenderer.includes("component.chain"));
  assert.ok(!canvasRenderer.includes('item.kind === "source"'));
});

test("Canvas recording-frame routes declare extra sampling demand without changing whole-Canvas routes", () => {
  const render = { sceneAspectRatio: 16 / 9 };
  const canvas = { type: "scene" };
  const frames = [{ id: "frame-a", x: 0.1, y: 0.2, width: 0.25, height: 0.25 }];
  const frameView = componentSourceView(render, canvas, { outputFrameId: "frame-a" }, frames);
  const wholeView = componentSourceView(render, canvas, {
    outputFrameId: "",
    sourceRect: { x: 0, y: 0, width: 0.25, height: 0.25 },
  }, frames);
  assert.equal(frameView.samplingScale, 1);
  assertClose(frameView.sampleRect.x, frameView.logicalSize.width * 0.1);
  assertClose(frameView.sampleRect.y, frameView.logicalSize.height * 0.2);
  assertClose(frameView.sampleRect.width, frameView.logicalSize.width * 0.25);
  assertClose(frameView.sampleRect.height, frameView.logicalSize.height * 0.25);
  assert.equal(wholeView.samplingScale, 1);
  assert.deepEqual(wholeView.sampleRect, { x: 0, y: 0, ...wholeView.logicalSize });

  const reducedFrameView = componentSourceView(
    { ...render, sampling: { recordingFrameScale: 0.5 } },
    canvas,
    { outputFrameId: "frame-a" },
    frames
  );
  assert.equal(reducedFrameView.samplingScale, 0.5);
});

test("multiple recording frames share one parent Canvas texture request", () => {
  const component = { id: "canvas-a", type: "scene" };
  const sourceView = {
    logicalSize: { width: 3840, height: 2160 },
    maxRasterSize: { width: 3840, height: 2160 },
  };
  const requests = sharedComponentRenderRequests([
    { component, sourceView, demand: { rasterScale: 0.25 } },
    { component, sourceView, demand: { rasterScale: 0.5 } },
  ], "to:");

  assert.equal(requests.size, 1);
  assert.deepEqual(pickRequestSize(requests.get("canvas-a")), { width: 1920, height: 1088 });
  assert.equal(requests.get("canvas-a").renderIdentity, "to:canvas-a");
  assert.equal(requests.get("canvas-a").demandScale, 0.5);
});

test("component instance sync controls surface render sharing without changing component ids", () => {
  const synced = { id: "component-a", syncInstances: true };
  assert.equal(componentRenderInstanceKey(synced, "surface-a"), "component-a");
  assert.equal(componentRenderInstanceKey(synced, "surface-b"), "component-a");
  assert.equal(componentInstanceTime(synced, 12, "surface-a"), 12);

  const independent = { id: "component-a", syncInstances: false };
  const firstKey = componentRenderInstanceKey(independent, "surface-a");
  const secondKey = componentRenderInstanceKey(independent, "surface-b");
  assert.equal(independent.id, "component-a");
  assert.notEqual(firstKey, secondKey);
  assert.notEqual(componentInstanceTime(independent, 12, "surface-a"), componentInstanceTime(independent, 12, "surface-b"));

  const sourceView = {
    logicalSize: { width: 640, height: 360 },
    maxRasterSize: { width: 640, height: 360 },
  };
  const requests = sharedComponentRenderRequests([
    { component: independent, surface: { id: "surface-a" }, sourceView, demand: { rasterScale: 1 } },
    { component: independent, surface: { id: "surface-b" }, sourceView, demand: { rasterScale: 1 } },
  ]);
  assert.equal(requests.size, 2);
  assert.ok(requests.has(firstKey));
  assert.ok(requests.has(secondKey));
});

test("Canvas frame fanout retains ROI only when nested component placements can be shared", () => {
  const independent = { id: "component-a", type: "chain", syncInstances: false, chain: [] };
  const synced = { id: "component-b", type: "chain", syncInstances: true, chain: [] };
  const canvas = {
    id: "canvas-a",
    type: "scene",
    chain: [
      { id: "source-a", kind: "source", source: { type: "component", componentId: independent.id } },
    ],
  };
  const renderer = new OutputRenderer({});
  renderer.state = { components: [canvas, independent, synced] };

  assert.equal(renderer.sceneComponentFrameFanoutSafe(canvas), false);
  canvas.chain[0].source.componentId = synced.id;
  assert.equal(renderer.sceneComponentFrameFanoutSafe(canvas), true);
});

test("surface route lookup indexes components, frames, and source nodes once per state", () => {
  const renderer = new OutputRenderer({});
  renderer.state = {
    components: [{ id: "scene-a", type: "scene", name: "Scene A", scene: {} }],
    frames: [{ id: "frame-a", name: "Frame A" }],
  };
  renderer.rebuildRouteLookups();

  const node = renderer.resolveRouteSourceNode({
    sourceNodeId: "recording-frame:scene-a:frame-a",
    componentId: "scene-a",
    outputFrameId: "frame-a",
  });
  assert.equal(renderer.componentById.get("scene-a").type, "scene");
  assert.equal(renderer.recordingFrameById.get("frame-a").name, "Frame A");
  assert.equal(node.componentId, "scene-a");
  assert.equal(node.outputFrameId, "frame-a");
  assert.equal(renderer.resolveRouteSourceNode({ sourceNodeId: "", componentId: "", outputFrameId: "" }), null);
  assert.equal(renderer.resolveRouteSourceNode({ sourceNodeId: "missing", componentId: "", outputFrameId: "" }), null);
});

test("Canvas demand is capped to logical size by default and can opt into supersampling", () => {
  assert.deepEqual(sceneMaxRasterSize({ pixelDensity: 1 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(sceneMaxRasterSize({ pixelDensity: 2 }, { width: 4000, height: 2000 }), {
    width: 4000,
    height: 2000,
  });
  assert.deepEqual(sceneMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitSceneToLogicalSize: false },
  }, { width: 4000, height: 2000 }), {
    width: 8000,
    height: 4000,
  });
  assert.deepEqual(sceneMaxRasterSize({
    pixelDensity: 2,
    sampling: { limitSceneToLogicalSize: false },
  }, { width: 5000, height: 5000 }), {
    width: 8192,
    height: 8192,
  });
});

test("Component initial dimensions define geometry without capping adaptive render demand", () => {
  const render = { componentAspectRatio: 2, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const view = componentSourceView(render, component);
  assert.deepEqual(view.logicalSize, { width: 2000, height: 1000 });
  assert.deepEqual(view.maxRasterSize, { width: 8192, height: 4096 });
  assert.deepEqual(componentAdaptiveRasterLimit(view.logicalSize), view.maxRasterSize);
  assert.deepEqual(
    pickRequestSize(componentReferenceRenderRequest(render, component, { width: 3000, height: 1500 })),
    { width: 3008, height: 1504 }
  );
});

test("Component preview raster follows visible demand instead of its initial dimensions", () => {
  const render = { componentAspectRatio: 2, pixelDensity: 1 };
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  assert.deepEqual(
    pickRequestSize(componentPreviewRenderRequest(render, component, 800, 600, 1)),
    { width: 800, height: 400 }
  );
});

test("Component preview geometry is independent from pixel density and raster dimensions", () => {
  const component = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const lowDensity = componentLogicalPreviewRect(
    { componentAspectRatio: 1.5, pixelDensity: 0.5 },
    component,
    900,
    700
  );
  const highDensity = componentLogicalPreviewRect(
    { componentAspectRatio: 1.5, pixelDensity: 2 },
    component,
    900,
    700
  );
  assert.deepEqual(lowDensity, highDensity);
  assert.deepEqual(highDensity, { x: 0, y: 50, width: 900, height: 600 });
});

test("Scene editor world leaves a stable margin around edge-aligned Frames", () => {
  const render = { sceneAspectRatio: 16 / 9, pixelDensity: 2 };
  const ordinary = componentLogicalPreviewRect(render, { type: "scene" }, 1000, 700);
  const editor = componentLogicalPreviewRect(render, { type: "scene" }, 1000, 700, { sceneEditorWorld: true });
  assert.ok(Math.abs(ordinary.x) < 1e-9);
  assert.ok(Math.abs(ordinary.y - 68.75) < 1e-9);
  assert.ok(Math.abs(ordinary.width - 1000) < 1e-9);
  assert.ok(Math.abs(ordinary.height - 562.5) < 1e-9);
  assert.ok(Math.abs(editor.x - 250) < 1e-9);
  assert.ok(Math.abs(editor.y - 209.375) < 1e-9);
  assert.ok(Math.abs(editor.width - 500) < 1e-9);
  assert.ok(Math.abs(editor.height - 281.25) < 1e-9);
});

test("Canvas recording frames move within bounds and corner resize changes both dimensions independently", () => {
  const moved = moveSceneFrameRect({ x: 100, y: 100, width: 400, height: 200 }, 900, 900, 1200, 800);
  assert.deepEqual(moved, { x: 800, y: 600, width: 400, height: 200 });

  const resized = resizeSceneFrameRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "se",
    200,
    20,
    1200,
    800
  );
  assert.deepEqual(resized, { x: 100, y: 100, width: 600, height: 220 });

  const northwest = resizeSceneFrameRect(
    { x: 100, y: 100, width: 400, height: 200 },
    "nw",
    -200,
    -300,
    1200,
    800
  );
  assert.deepEqual(northwest, { x: 0, y: 0, width: 500, height: 300 });
});

test("proportion-locked Frames scale from corners without changing their aspect", () => {
  const original = { x: 0.1, y: 0.2, width: 0.4, height: 0.2 };
  const resized = resizeSceneFrameRect(original, "se", 0.2, 0.02, 1, 1, { keepProportions: true });
  assert.equal(resized.x, original.x);
  assert.equal(resized.y, original.y);
  assert.ok(resized.width > original.width);
  assert.ok(Math.abs(resized.width / resized.height - original.width / original.height) < 1e-9);
});

test("Canvas recording frames drag only from their border so the interior passes through", () => {
  const frame = { x: 100, y: 100, width: 400, height: 200 };
  assert.equal(sceneFrameBorderHit(frame, 102, 180), true);
  assert.equal(sceneFrameBorderHit(frame, 300, 296), true);
  assert.equal(sceneFrameBorderHit(frame, 300, 200), false);
  assert.equal(sceneFrameBorderHit(frame, 50, 200), false);
});

test("Canvas component placements use a stable normalized footprint", () => {
  assert.deepEqual(
    sceneComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1080, baseHeight: 1920, width: 540, height: 960 },
      {},
      { scale: 1080 / 3840 }
    ),
    { x: 1380, y: 120, width: 1080, height: 1920 }
  );
  assert.deepEqual(
    sceneComponentPlacementRect(
      { width: 3840, height: 2160 },
      { baseWidth: 1920, baseHeight: 1080 },
      { width: 960, height: 540 },
      { scale: 1920 / 3840 }
    ),
    { x: 240, y: 135, width: 480, height: 270 }
  );
});

test("Canvas Component placement is independent from raster-density changes", () => {
  const canvas = { type: "scene" };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const placement = { scale: 0.325 };
  const target = { width: 1000, height: 500 };
  const low = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 0.5 },
    target,
    placement
  );
  const high = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 2 },
    target,
    placement
  );
  assert.deepEqual(high, low);
  assert.deepEqual(low, { x: 338, y: 125, width: 325, height: 250 });
});

test("Canvas placement follows changed Component aspect without stretching its old dimensions", () => {
  const canvas = { type: "scene" };
  const child = { type: "chain", frameShape: "landscape", resolutionScale: 1 };
  const target = { width: 1000, height: 500 };
  const placement = { scale: 0.325 };
  const original = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 1.3, pixelDensity: 1 },
    target,
    placement
  );
  const wider = componentReferencePlacement(
    canvas,
    child,
    { sceneAspectRatio: 2, componentAspectRatio: 2, pixelDensity: 1 },
    target,
    placement
  );
  assert.equal(wider.width, original.width);
  assert.equal(wider.height, Math.round(wider.width / 2));
  assert.ok(wider.height < original.height);
});

test("Scene allocation aspect cannot override an embedded Component proportion", () => {
  const scene = { type: "scene" };
  const render = { sceneAspectRatio: 16 / 9, componentAspectRatio: 16 / 9, pixelDensity: 1 };
  const landscape = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "landscape" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );
  const portrait = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "portrait" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );
  const square = componentReferencePlacement(
    scene,
    { type: "chain", frameShape: "square" },
    render,
    { width: 900, height: 900 },
    { scale: 0.5 }
  );

  assertClose(landscape.width / landscape.height, 16 / 9, 0.01);
  assertClose(portrait.height / portrait.width, 16 / 9, 0.01);
  assert.equal(square.width, square.height);
});

test("nested components inherit physical demand from their placement for every parent type", () => {
  const render = { sceneAspectRatio: 10 / 7, componentAspectRatio: 10 / 7, pixelDensity: 1 };
  const child = { id: "child", type: "chain", frameShape: "landscape", resolutionScale: 2 };
  const canvasParent = { type: "scene" };
  const canvasPlacement = componentReferencePlacement(canvasParent, child, render, { width: 1000, height: 700 }, { scale: 0.25 });
  const regularPlacement = componentReferencePlacement({ type: "chain" }, child, render, { width: 640, height: 360 });
  const request = componentReferenceRenderRequest(render, child, canvasPlacement);

  assert.equal(canvasPlacement.x, Math.round((1000 - canvasPlacement.width) * 0.5));
  assert.equal(canvasPlacement.y, Math.round((700 - canvasPlacement.height) * 0.5));
  assert.ok(canvasPlacement.width < regularPlacement.width);
  assert.ok(canvasPlacement.height < regularPlacement.height);
  assert.deepEqual(regularPlacement, { x: 0, y: 0, width: 640, height: 360 });
  assert.ok(request.width <= canvasPlacement.width * 2 + 16);
  assert.ok(request.height <= canvasPlacement.height * 2 + 16);
  assert.ok(request.width >= canvasPlacement.width * 2 - 16);
  assert.ok(request.height >= canvasPlacement.height * 2 - 16);
  assertClose(request.logicalWidth / request.logicalHeight, 10 / 7);
});

test("placed render results separate texture pixels from parent-frame placement", () => {
  const texture = { width: 320, height: 180 };
  const placed = createPlacedRenderResult(texture, {
    destinationRect: { x: 40, y: 30, width: 640, height: 360 },
    transform: { x: 0.2, y: -0.1, scale: 1.5, rotation: 0.25 },
    fit: "contain",
  });

  assert.equal(placed.texture, texture);
  assert.deepEqual(placed.destinationRect, { x: 40, y: 30, width: 640, height: 360 });
  assert.deepEqual(transformedPlacementDemandRect(placed.destinationRect, placed.transform), {
    x: 40,
    y: 30,
    width: 960,
    height: 540,
  });
});

test("direct placement eligibility is shared by Canvas and ordinary component parents", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const dependency = { id: "child", type: "chain" };
  renderer.state = { components: [dependency] };
  renderer.media.set("image", { image: { width: 640, height: 360 } });
  renderer.media.set("model", { model: {}, image: { width: 640, height: 360 } });

  const reference = { kind: "source", source: { type: "component", componentId: dependency.id } };
  assert.equal(renderer.canDirectCompositeSource(reference), true);
  assert.equal(renderer.canDirectCompositeSource({ ...reference, blend: "overlay" }), false);
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "image" } }), true);
  renderer.state.media = [{ id: "image", type: "image" }];
  assert.equal(renderer.canDirectCompositeSource({
    kind: "source",
    source: { type: "media", mediaId: "image", params: { alphaCut: 2, alphaFeather: 4 } },
  }), false, "image alpha cleanup materializes only that source before compositing it");
  assert.equal(renderer.canDirectCompositeSource({ kind: "source", source: { type: "media", mediaId: "model" } }), false);
  assert.equal(directPlacementKind({ source: { type: "camera" }, cameraDrawable: true }), "camera-texture");
  assert.equal(directPlacementKind({ source: { type: "generator" } }), "");
});

test("direct placement composites texture geometry without a parent-sized source buffer", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const calls = [];
  const output = {
    width: 1000,
    height: 700,
    push: () => calls.push(["push"]),
    pop: () => calls.push(["pop"]),
    blendMode: (value) => calls.push(["blendMode", value]),
    tint: (...values) => calls.push(["tint", ...values]),
    noTint: () => calls.push(["noTint"]),
    translate: (...values) => calls.push(["translate", ...values]),
    rotate: (value) => calls.push(["rotate", value]),
    scale: (value) => calls.push(["scale", value]),
    image: (...values) => calls.push(["image", ...values]),
  };
  const texture = { width: 320, height: 180 };
  const previousBlend = globalThis.BLEND;
  globalThis.BLEND = "blend";
  try {
    renderer.drawPlacedSourceResult(output, createPlacedRenderResult(texture, {
      destinationRect: { x: 400, y: 300, width: 200, height: 100 },
      transform: { x: 0.2, y: -0.1, scale: 1.5, rotation: 0.25 },
    }), { opacity: 0.5, blend: "normal" });
  } finally {
    globalThis.BLEND = previousBlend;
  }

  assert.ok(calls.some((call) => call[0] === "translate" && call[1] === 600 && call[2] === 315));
  assert.ok(calls.some((call) => call[0] === "scale" && call[1] === 1.5));
  assert.ok(calls.some((call) => call[0] === "tint" && call[2] === 127.5));
  assert.ok(calls.some((call) => call[0] === "image" && call[1] === texture && call[2] === -100 && call[3] === -50 && call[4] === 200 && call[5] === 100));
});

test("direct surfaces map normal compositing to BLEND rather than the deprecated NORMAL constant", () => {
  const source = readFileSync(new URL("../js/output/component-render-layout.js", import.meta.url), "utf8");
  const helper = source.slice(
    source.indexOf("export function applyBlendGlobal("),
    source.indexOf("\n}\n\nexport function drawWebGLBuffer", source.indexOf("export function applyBlendGlobal("))
  );
  assert.ok(helper.includes('if (!blend || blend === "normal") blendMode(BLEND);'));
  assert.ok(helper.indexOf('blend === "normal"') < helper.indexOf("globalThis"));
});

test("output renderer imports the bounds helper used while rebuilding direct surfaces", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const layoutImport = source.slice(
    source.indexOf("import {\n  sceneMaxRasterSize"),
    source.indexOf("from \"./component-render-layout.js", source.indexOf("import {\n  sceneMaxRasterSize"))
  );

  assert.match(layoutImport, /\bcornersRect,/);
  assert.match(source, /const rect = cornersRect\(corners\);/);
});

test("Canvas preview requests match the visible backing density", () => {
  const fullSize = { sceneAspectRatio: 16 / 9, pixelDensity: 1, previewRasterScale: 1 };
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest(fullSize, { resolutionScale: 1 }, 1200, 800)),
    { width: 1200, height: 675 }
  );
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest({ ...fullSize, previewRasterScale: 2 }, { resolutionScale: 1 }, 1200, 800)),
    { width: 2400, height: 1350 }
  );
  assert.deepEqual(
    pickRequestSize(scenePreviewRenderRequest({ ...fullSize, previewRasterScale: 2 }, { resolutionScale: 0.5 }, 1200, 800)),
    { width: 1200, height: 675 }
  );
});

test("component groups render isolated from earlier parent layers", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const groupRenderSource = source.slice(
    source.indexOf("  renderComponentOperationsState("),
    source.indexOf("  renderThumbnailComponents()")
  );

  assert.ok(groupRenderSource.includes("let state = this.transparentChainState(component, renderRequest);"));
  assert.ok(groupRenderSource.includes("const groupState = this.renderComponentOperationsState("));
  assert.ok(groupRenderSource.includes("operation?.operations || item.chain || []"));
  assert.ok(groupRenderSource.includes("combineContentTransforms(inheritedTransform, item.transform || {})"));
  assert.ok(groupRenderSource.includes("this.renderBoundedLayerNodeState(nodeId, state, groupState"));
  assert.ok(groupRenderSource.includes(": this.renderLayerNodeState(nodeId, state, groupState, { ...item, transform: {} }, renderRequest);"));
  assert.ok(!groupRenderSource.includes("drawBuffer(groupState.buffer, state.buffer"));
});

test("Group transforms place physical content but never resample a composition-wide effect input", () => {
  const groupTransform = { x: 0.25, y: -0.1, scale: 0.5, rotation: 0.2 };
  const hsv = { id: "key", kind: "effect", componentId: "hsvAlphaKey", transform: {} };
  const field = { id: "ripple", kind: "effect", componentId: "ripple", transform: {} };
  const source = { id: "plasma", kind: "source", transform: {} };

  const compositionResult = visualOperationRenderItem(
    { opcode: "effect", transformDomain: "composition" },
    hsv,
    groupTransform
  );
  const fieldResult = visualOperationRenderItem(
    { opcode: "effect", transformDomain: "group-field" },
    field,
    groupTransform
  );
  const sourceResult = visualOperationRenderItem({ opcode: "source" }, source, groupTransform);

  assert.equal(compositionResult, hsv, "the hot path neither transforms nor allocates a composition effect item");
  assert.notEqual(fieldResult, field);
  assert.deepEqual(fieldResult.transform, groupTransform);
  assert.notEqual(sourceResult, source);
  assert.deepEqual(sourceResult.transform, groupTransform);
});

test("rasterized sources own a full-frame coordinate transform before neutral layer compositing", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const specializedSource = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const shaderSource = readFileSync(new URL("../js/output/render-pass-shaders.js", import.meta.url), "utf8");
  const chainRenderSource = source.slice(
    source.indexOf("  renderComponentChainState("),
    source.indexOf("  transparentChainState(")
  );
  const layerRenderSource = source.slice(
    source.indexOf("  renderLayerNodeState("),
    source.indexOf("  renderOverlayLayerToTarget(")
  );
  const drawLayerSource = source.slice(
    source.indexOf("  drawChainLayer("),
    source.indexOf("  drawTransformedLayerFallback(")
  );

  const rasterSourceRender = source.slice(
    source.indexOf("  renderComponentSourceItemState("),
    source.indexOf("  sourceRuntimeTimeKey(")
  );
  assert.ok(rasterSourceRender.includes("contentTransform: item.transform || {}"));
  assert.ok(chainRenderSource.includes("this.renderLayerNodeState(nodeId, state, sourceState, { ...renderedItem, transform: {} }, renderRequest)"));
  assert.ok(layerRenderSource.includes("renderLayerContentTransformState("));
  assert.ok(layerRenderSource.includes('renderBufferKey(nodeId, "content-transform")'));
  assert.ok(shaderSource.includes("uniform mat3 sourceUvMatrix;"));
  assert.ok(shaderSource.includes("gl_FragColor = color * inside;"));
  assert.ok(drawLayerSource.includes("drawBuffer(output, source, 0, 0, output.width, output.height"));
  assert.ok(!drawLayerSource.includes("output.translate("));
  assert.ok(!drawLayerSource.includes("output.scale("));
  assert.ok(source.includes('setShaderUniformIfPresent(shader, "contentUvMatrix", contentMatrix)'));
  assert.ok(specializedSource.includes("presentGeneratedTarget(pg, target)"));
  assert.ok(specializedSource.includes("GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER"));
  assert.ok(specializedSource.includes("applyModelContentTransform(target, source.contentTransform"));
});

test("component preview always draws its overarching frame independently of selection", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const interactionSource = readFileSync(new URL("../js/output/component-preview-interaction.js", import.meta.url), "utf8");
  const previewSource = source.slice(
    source.indexOf("  renderComponentPreview()"),
    source.indexOf("  setCalibrate(on)")
  );

  assert.ok(previewSource.includes("this.renderComponentFrameOverlay(component, source)"));
  assert.ok(interactionSource.includes('if (renderer.mode !== "component" || !component) return'));
  assert.ok(interactionSource.includes("renderer.componentPreviewRect(component, source)"));
  assert.ok(interactionSource.includes("stroke(101, 224, 211, 235)"));
});

test("scene surfaces render components at their configured shape and relative resolution", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  const plannerSource = readFileSync(new URL("../js/libraries/composition-engine/surface-composition/index.js", import.meta.url), "utf8");
  const drawSurfaceRoute = runtimeSource.slice(
    runtimeSource.indexOf("  drawSurfaceRoute(target, route = {}, { compositeOpacity = 1 } = {})"),
    runtimeSource.indexOf("  drawSurfaceThumbnailRoute(target, surface")
  );
  const surfaceRenderPlan = plannerSource;

  assert.ok(surfaceRenderPlan.includes("sourceRenderDemand({"));
  assert.ok(surfaceRenderPlan.includes("componentSourceView("));
  assert.ok(surfaceRenderPlan.includes("componentById.get(surface.componentId)"));
  assert.ok(surfaceRenderPlan.includes("resolveRouteSourceNode(storedSurface)"));
  assert.ok(surfaceRenderPlan.includes("state.render?.sampling?.surfaceOverscan"));
  assert.ok(surfaceRenderPlan.includes("sharedComponentRenderRequests(routes"));
  assert.ok(surfaceRenderPlan.includes("route.componentRequest = componentRequests.get(renderInstanceKey)"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(drawSurfaceRoute.includes("scaledComponentSampleRect("));
  assert.ok(runtimeSource.includes("getSurfaceTexture(request)"));
  assert.ok(runtimeSource.includes("createGraphics(widthPx, heightPx)"));
});

test("element render quality scales physical component pixels without changing logical proportions", () => {
  const request = {
    role: "source",
    width: 2000,
    height: 1400,
    logicalWidth: 1000,
    logicalHeight: 700,
  };
  const scaled = qualityScaledRenderRequest(request, { renderQuality: 0 }, 0.5);

  assert.equal(scaled.width, 1000);
  assert.equal(scaled.height, 700);
  assert.equal(scaled.logicalWidth, 1000);
  assert.equal(scaled.logicalHeight, 700);
});

test("shader generators preserve the component render contract", () => {
  const renderer = new OutputRenderer({ mode: "output" });
  const request = {
    role: "surface",
    width: 1600,
    height: 2400,
    logicalWidth: 800,
    logicalHeight: 1200,
    pixelDensityApplied: true,
    frameShape: "portrait",
    resolutionScale: 2,
    renderIdentity: "component-eye",
  };
  const pg = {
    width: request.width,
    height: request.height,
    push() {},
    pop() {},
    clear() {},
    image() {},
    translate() {},
    scale() {},
  };
  const target = { width: request.width, height: request.height };
  let receivedRequest = null;
  renderer.renderShaderGeneratorSource = (_id, _time, nextRequest) => {
    receivedRequest = nextRequest;
    return target;
  };

  assert.equal(renderer.drawShaderGenerator(pg, "eyeball", 1.25, request), true);
  assert.deepEqual(receivedRequest, request);
});

test("shader generators draw directly into a shared source framebuffer", () => {
  const renderer = Object.create(OutputRenderer.prototype);
  const request = { width: 640, height: 360, logicalWidth: 640, logicalHeight: 360 };
  const pg = {
    __vj1SharedFramebuffer: true,
    width: request.width,
    height: request.height,
    push() { throw new Error("direct generator output must not be copied"); },
  };
  let receivedTarget = null;
  renderer.normalizeRenderRequest = (nextRequest) => nextRequest;
  renderer.renderShaderGeneratorSource = (_id, _time, _request, _params, _instanceId, _transform, outputTarget) => {
    receivedTarget = outputTarget;
    return outputTarget;
  };

  assert.equal(renderer.drawShaderGenerator(pg, "eyeball", 1.25, request), true);
  assert.equal(receivedTarget, pg);
});

test("eyeball computes frame-constant animation outside its fragment shader", () => {
  const frame = eyeballFrameUniforms(3.25, {
    gazeRange: 1,
    motionSpeed: 1,
    pauseAmount: 0.82,
    jitter: 0.35,
    blinkRate: 1,
  });
  for (const vector of [frame.gazeDir, frame.irisRight, frame.irisUp]) {
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.000001);
  }
  assert.ok(frame.blink >= 0 && frame.blink <= 1);
  assert.equal(eyeballFrameUniforms(3.25, { blinkRate: 0 }).blink, 0);
});

test("every compiled generator backend remains tied to the component source target", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const drawSource = source.slice(
    source.indexOf("  drawSourceToGraphics("),
    source.indexOf("  drawAnatomyGenerator(")
  );
  const drawShader = source.slice(
    source.indexOf("  drawShaderGenerator("),
    source.indexOf("  renderShaderGeneratorSource(")
  );

  assert.ok(drawSource.includes("this.drawCompiledNativeSource(nativeRenderer, pg, source, generatorTime, renderRequest, operation)"));
  assert.ok(drawSource.includes('typeof operation?.nodeProcess === "function"'));
  assert.ok(drawSource.includes("this.executeCompiledVisualNodeProcess(operation, pg, source, generatorTime, renderRequest, view)"));
  assert.ok(drawSource.includes("const method = NATIVE_SOURCE_HOST_METHODS[rendererId]"));
  assert.ok(drawSource.includes("this.drawShaderGenerator(pg, source, generatorTime, renderRequest)"));
  assert.ok(drawSource.includes("drawGenerator(pg, source.generatorId, generatorTime, source.params || {}, renderRequest, view)"));
  assert.ok(drawShader.includes("width: pg.width"));
  assert.ok(drawShader.includes("height: pg.height"));
});

test("window resize preserves the dedicated model context while final disposal releases it", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const createBuffers = source.slice(source.indexOf("  createBuffers()"), source.indexOf("  buffersMatchRenderSize()"));
  const disposeBuffers = source.slice(source.indexOf("  disposeBuffers({ preserveSpecialized = false } = {})"), source.indexOf("  getCachedNoiseTexture()"));
  assert.ok(createBuffers.includes("this.disposeBuffers({ preserveSpecialized: true })"));
  assert.ok(disposeBuffers.includes("if (!preserveSpecialized) this.specializedSources.dispose()"));
});

test("projection mapper uses actual texture size for surface sampling math", () => {
  const source = readFileSync(new URL("../js/libraries/mapping-engine/mapping-engine/index.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");

  assert.ok(source.includes("const sourceWidth = sourceRect[2] * Math.max(1, Number(texture.width) || 1);"));
  assert.ok(source.includes("const sourceHeight = sourceRect[3] * Math.max(1, Number(texture.height) || 1);"));
  assert.ok(source.includes('projectionFit = "cover"'));
  assert.ok(rendererSource.includes("renderer.mapper.drawTexture(target, mapped.mapperSurface, surface.projectionFit, surface.feather, {"));
  assert.ok(rendererSource.includes("opacity: surfaceRouteOpacity(route)"));
  assert.ok(rendererSource.includes("sourceRect: view.sourceRect"));
  assert.ok(rendererSource.includes("directSurfaceSamples"));
  assert.ok(source.includes("drawTextureBatch(items = [])"));
  assert.ok(source.includes("this._drawSurfaceQuad(cache.vertices)"));
  assert.ok(rendererSource.includes("drawSurfaceRouteViewBatch(batch, blend)"));
});

test("zero-duration Live output retains the original single-scene surface path", () => {
  const source = readFileSync(new URL("../js/output/output-surface-runtime.js", import.meta.url), "utf8");
  assert.ok(source.includes("if (transition) return this.renderTransitionSurfaces(transition);"));
  assert.ok(source.includes("this.renderMappingSurfaces();"));
  assert.ok(source.includes("this.releaseTransitionSurfaceTextures();"));
  assert.ok(source.includes("renderer.mapper.drawTransitionTextures("));
});

test("media renditions are saved without lossy jpeg compression", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const thumbnailSource = readFileSync(new URL("../js/output/thumbnail-utils.js", import.meta.url), "utf8");
  const renditionSource = readFileSync(new URL("../js/services/media-rendition-service.js", import.meta.url), "utf8");

  assert.ok(thumbnailSource.includes('canvas.toBlob(resolve, "image/png")'));
  assert.ok(!rendererSource.includes('"image/jpeg"'));
  assert.ok(!thumbnailSource.includes('"image/jpeg"'));
  assert.ok(renditionSource.includes(".png"));
  assert.ok(renditionSource.includes("png|jpe?g"));
});

test("projection mapper uses high precision for homography sampling", () => {
  const shaderSource = mapperFragmentShaderSource();

  assert.ok(shaderSource.includes("precision highp float;"));
  assert.ok(!shaderSource.includes("precision mediump float;"));
});
