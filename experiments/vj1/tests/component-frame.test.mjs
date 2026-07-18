import test from "node:test";
import assert from "node:assert/strict";

import {
  componentFrameMetrics,
  normalizeComponentFrameShape,
  normalizeComponentResolutionScale,
} from "../js/domain/component-frame.js";
import { createCanvasComponent, createCanvasFrame, createDefaultComponent, createDefaultSurface, createInitialState, createSceneFromState, directOutputSurfaceId, normalizeCameraSettings, normalizeComponentPipelineSettings, normalizeProjectionFit, normalizeSamplingSettings, resolveSceneSourceNode, sanitizeState, sceneSourceNodes } from "../js/domain/models.js";

const render = {
  componentTexture: { width: 1000, height: 700 },
  surfaceTexture: { mode: "auto", maxWidth: 100, maxHeight: 100 },
  pixelDensity: 0.5,
};

test("generated visual objects use compact default names", () => {
  assert.equal(createDefaultComponent(1).name, "Comp 2");
  assert.equal(createCanvasComponent(1).name, "Canv 2");
  assert.equal(createDefaultSurface(1).name, "Srf 2");
});

test("component frame shape derives landscape portrait and square from component dimensions", () => {
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 })),
    { baseWidth: 1000, baseHeight: 700, width: 500, height: 350 }
  );
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "portrait", resolutionScale: 1 })),
    { baseWidth: 700, baseHeight: 1000, width: 350, height: 500 }
  );
  assert.deepEqual(
    pickSize(componentFrameMetrics(render, { frameShape: "square", resolutionScale: 1 })),
    { baseWidth: 700, baseHeight: 700, width: 350, height: 350 }
  );
});

test("component resolution scale multiplies the global density", () => {
  const low = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 0.5 });
  const normal = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 });
  const high = componentFrameMetrics(render, { frameShape: "landscape", resolutionScale: 2 });

  assert.deepEqual([low.effectiveScale, low.width, low.height], [0.25, 250, 175]);
  assert.deepEqual([normal.effectiveScale, normal.width, normal.height], [0.5, 500, 350]);
  assert.deepEqual([high.effectiveScale, high.width, high.height], [1, 1000, 700]);
});

test("component frame settings normalize to backward-compatible defaults", () => {
  assert.equal(normalizeComponentFrameShape("wide"), "landscape");
  assert.equal(normalizeComponentResolutionScale(1.5), 1);

  const created = createDefaultComponent(0);
  assert.equal(created.frameShape, "landscape");
  assert.equal(created.resolutionScale, 1);
  assert.equal(created.syncInstances, true);

  const state = sanitizeState({
    components: [{ ...created, frameShape: "portrait", resolutionScale: 2 }],
  });
  assert.equal(state.components[0].frameShape, "portrait");
  assert.equal(state.components[0].resolutionScale, 2);
  assert.equal(state.components[0].syncInstances, true);

  const independent = sanitizeState({
    components: [{ ...created, syncInstances: false }],
  });
  assert.equal(independent.components[0].syncInstances, false);
});

test("global visual time stretch defaults to one and stays within its live range", () => {
  assert.equal(sanitizeState({}).global.timeStretch, 0);
  assert.equal(sanitizeState({ global: { timeStretch: -8 } }).global.timeStretch, -4);
  assert.equal(sanitizeState({ global: { timeStretch: 8 } }).global.timeStretch, 4);
  assert.equal(sanitizeState({ global: { timeScale: 4 } }).global.timeStretch, 2);
  assert.equal("timeScale" in sanitizeState({ global: { timeScale: 4 } }).global, false);
});

test("legacy fixed surface fields are removed and all projects enter automatic texture mode", () => {
  const state = sanitizeState({
    render: { frameWidth: 1280, frameHeight: 720, surfaceWidth: 320, surfaceHeight: 180 },
  });
  assert.deepEqual(state.render.surfaceTexture, { mode: "auto", maxWidth: 1280, maxHeight: 720 });
  assert.deepEqual(state.render.componentTexture, { width: 320, height: 180 });
  assert.equal(Object.hasOwn(state.render, "surfaceWidth"), false);
  assert.equal(Object.hasOwn(state.render, "surfaceHeight"), false);

  const manual = sanitizeState({
    render: {
      frameWidth: 1280,
      frameHeight: 720,
      surfaceTexture: { mode: "manual", maxWidth: 640, maxHeight: 360 },
    },
  });
  assert.deepEqual(manual.render.surfaceTexture, { mode: "manual", maxWidth: 640, maxHeight: 360 });
  assert.deepEqual(manual.render.componentTexture, { width: 640, height: 360 });
});

test("component resolution follows its independent texture dimensions", () => {
  const metrics = componentFrameMetrics({
    outputs: [{ id: "main", width: 1920, height: 1080 }],
    componentTexture: { width: 1920, height: 1080 },
    surfaceTexture: { mode: "auto", maxWidth: 320, maxHeight: 180 },
    pixelDensity: 1,
  }, { frameShape: "landscape", resolutionScale: 1 });
  assert.deepEqual(pickSize(metrics), { baseWidth: 1920, baseHeight: 1080, width: 1920, height: 1080 });
});

test("adaptive sampling settings remain independent and accept half scale", () => {
  assert.deepEqual(normalizeSamplingSettings({}), {
    surfaceOverscan: 1,
    recordingFrameScale: 1,
    limitCanvasToLogicalSize: true,
  });
  assert.deepEqual(normalizeSamplingSettings({ surfaceOverscan: 0.5, recordingFrameScale: 0.5 }), {
    surfaceOverscan: 0.5,
    recordingFrameScale: 0.5,
    limitCanvasToLogicalSize: true,
  });
  assert.deepEqual(normalizeSamplingSettings({ surfaceOverscan: 0.1, recordingFrameScale: 8, limitCanvasToLogicalSize: false }), {
    surfaceOverscan: 0.5,
    recordingFrameScale: 2,
    limitCanvasToLogicalSize: false,
  });
});

test("component upscale and post settings normalize with neutral defaults", () => {
  assert.deepEqual(normalizeComponentPipelineSettings({}), {
    upscaling: { enabled: false, amount: 0.67 },
    postProcessing: {
      noiseEnabled: false,
      noiseAmount: 0.035,
      grayscaleEnabled: false,
      grayscaleAmount: 1,
    },
  });

  const state = sanitizeState({
    render: {
      upscaling: { enabled: true, amount: 0.1 },
      postProcessing: {
        noiseEnabled: true,
        noiseAmount: 4,
        grayscaleEnabled: true,
        grayscaleAmount: 0.4,
      },
    },
  });
  assert.deepEqual(state.render.upscaling, { enabled: true, amount: 0.35 });
  assert.deepEqual(state.render.postProcessing, {
    noiseEnabled: true,
    noiseAmount: 0.2,
    grayscaleEnabled: true,
    grayscaleAmount: 0.4,
  });
});

test("legacy frame settings migrate to one output and multiple outputs persist", () => {
  const legacy = sanitizeState({ render: { frameWidth: 1280, frameHeight: 720 } });
  assert.deepEqual(legacy.render.outputs, [{ id: "output-main", name: "Main output", width: 1280, height: 720 }]);

  const multi = sanitizeState({
    render: {
      outputs: [
        { id: "left", name: "Left projector", width: 1920, height: 1080 },
        { id: "right", name: "Right projector", width: 1280, height: 800 },
      ],
    },
  });
  assert.equal(multi.render.outputs.length, 2);
  assert.equal(multi.render.frameWidth, 1920);
  assert.equal(multi.render.worldWidth, 4160);
  assert.equal(multi.render.worldHeight, 1620);
});

test("configured outputs derive locked direct surfaces without enabling new routes", () => {
  const state = createInitialState();
  state.render.outputs = [
    { id: "output-main", name: "Main output", width: 1920, height: 1080 },
    { id: "output-2", name: "Output 2", width: 1920, height: 1080 },
  ];
  const normalized = sanitizeState(state);
  const direct = normalized.surfaces.filter((surface) => surface.destination?.type === "direct");
  assert.deepEqual(direct.map((surface) => surface.id), [
    directOutputSurfaceId("all"),
    directOutputSurfaceId("output-main"),
    directOutputSurfaceId("output-2"),
  ]);
  assert.ok(direct.every((surface) => surface.enabled === false));
  assert.deepEqual(direct[0].destination.outputIds, ["output-main", "output-2"]);
  assert.equal(direct[0].projectionFit, "contain");
  assert.equal(direct[0].calibrationLocked, true);

  direct[1].enabled = true;
  direct[1].feather = 0.2;
  const reduced = sanitizeState({
    ...normalized,
    surfaces: normalized.surfaces,
    render: { ...normalized.render, outputs: [normalized.render.outputs[0]] },
  });
  const reducedDirect = reduced.surfaces.filter((surface) => surface.destination?.type === "direct");
  assert.deepEqual(reducedDirect.map((surface) => surface.id), [directOutputSurfaceId("output-main")]);
  assert.equal(reducedDirect[0].enabled, true);
  assert.equal(reducedDirect[0].feather, 0.2);
});

test("camera capture settings normalize resolution direction mirror and maximum mode", () => {
  assert.deepEqual(normalizeCameraSettings({}, 1280, 720), {
    width: 1280,
    height: 720,
    facingMode: "user",
    mirrored: false,
    maxResolution: false,
  });
  assert.deepEqual(normalizeCameraSettings({
    width: 1920,
    height: 1080,
    facingMode: "environment",
    mirrored: true,
    maxResolution: true,
  }), {
    width: 1920,
    height: 1080,
    facingMode: "environment",
    mirrored: true,
    maxResolution: true,
  });
});

test("surface projection fit defaults to cover and persists in scene snapshots", () => {
  assert.equal(createDefaultSurface(0).projectionFit, "cover");
  assert.equal(createDefaultSurface(0).feather, 0);
  assert.equal(normalizeProjectionFit("contain"), "contain");
  assert.equal(normalizeProjectionFit("stretch"), "stretch");
  assert.equal(normalizeProjectionFit("invalid"), "cover");

  const state = sanitizeState({ surfaces: [{ id: "surface-a", projectionFit: "contain" }] });
  const scene = createSceneFromState(state, "Fit scene");
  assert.equal(state.surfaces[0].projectionFit, "contain");
  assert.equal(scene.snapshot.surfaces[0].projectionFit, "contain");
});

test("surface feather is a physical surface property and is clamped", () => {
  const state = sanitizeState({ surfaces: [{ id: "surface-a", feather: 0.75 }] });
  assert.equal(state.surfaces[0].feather, 0.5);
  const scene = createSceneFromState(state, "Feather scene");
  assert.equal("feather" in scene.snapshot.surfaces[0], false);
});

test("legacy canvas layers migrate into ordinary Groups without retaining a parallel layer model", () => {
  const source = createDefaultComponent(0);
  source.id = "component-source";
  const state = sanitizeState({
    components: [source, {
      id: "legacy-canvas",
      type: "canvas",
      name: "Legacy Canvas",
      chain: [],
      canvas: {
        width: 2000,
        height: 1000,
        layers: [{
          id: "legacy-layer",
          componentId: source.id,
          name: "Hero",
          x: 120,
          y: 80,
          width: 640,
          height: 360,
          opacity: 0.7,
          blend: "screen",
        }],
      },
    }],
  });
  const canvas = state.components.find((component) => component.id === "legacy-canvas");
  assert.equal("layers" in canvas.canvas, false);
  assert.equal(canvas.chain.length, 1);
  assert.equal(canvas.chain[0].role, "group");
  assert.equal("layout" in canvas.chain[0], false);
  assert.equal(canvas.chain[0].opacity, 0.7);
  assert.equal(canvas.chain[0].blend, "screen");
  assert.equal(canvas.chain[0].chain[0].source.componentId, source.id);
  assert.deepEqual(canvas.chain[0].chain[0].source.placement, {
    scale: state.render.componentTexture.width / canvas.canvas.width,
  });
});

test("legacy canvas frames migrate to the shared registry and routes persist", () => {
  const source = createDefaultComponent(0);
  const canvas = createCanvasComponent(0, source.id);
  const frameId = "legacy-recording-frame";
  canvas.canvas.frames = [{ id: frameId, name: "Legacy frame", x: 10, y: 20, width: 640, height: 360 }];
  const state = sanitizeState({
    components: [source, canvas],
    surfaces: [{ id: "surface-a", componentId: canvas.id, outputFrameId: frameId }],
  });
  const scene = createSceneFromState(state, "Frame scene");
  assert.equal("frames" in state.components.find((component) => component.id === canvas.id).canvas, false);
  assert.equal(state.recordingFrames[0].id, frameId);
  assert.equal(state.surfaces[0].sourceNodeId, `recording-frame:${canvas.id}:${frameId}`);
  assert.equal(state.surfaces[0].outputFrameId, frameId);
  assert.equal(scene.snapshot.surfaces[0].outputFrameId, frameId);
});

test("ordinary components and recording frames share one Scene source-node abstraction", () => {
  const component = createDefaultComponent(0);
  component.id = "component-a";
  component.name = "Visual A";
  const canvas = createCanvasComponent(0, component.id);
  canvas.id = "canvas-a";
  canvas.name = "Wide Canvas";
  const state = sanitizeState({
    version: 18,
    components: [component, canvas],
    recordingFrames: [{ id: "frame-a", name: "Frame 1", x: 0, y: 0, width: 1920, height: 1080 }],
  });
  const nodes = sceneSourceNodes(state);
  assert.deepEqual(nodes.map((node) => ({ type: node.type, name: node.name })), [
    { type: "component", name: "Visual A" },
    { type: "component", name: "Wide Canvas" },
    { type: "recording-frame", name: "Wide Canvas · Frame 1" },
  ]);
  assert.equal(resolveSceneSourceNode(state, nodes[1].id).componentId, canvas.id);
  assert.equal(resolveSceneSourceNode(state, nodes[1].id).outputFrameId, "");
  assert.equal(resolveSceneSourceNode(state, nodes[2].id).outputFrameId, state.recordingFrames[0].id);
});

test("stable Scene source IDs are the only runtime routing authority", () => {
  const first = createDefaultComponent(0);
  first.id = "component-first";
  const second = createDefaultComponent(1);
  second.id = "component-second";
  const state = sanitizeState({ components: [first, second] });
  const selectedId = `component:${encodeURIComponent(second.id)}`;

  assert.equal(resolveSceneSourceNode(state, selectedId).componentId, second.id);
  assert.equal(resolveSceneSourceNode(state, "missing-source"), null);
});

test("recording-frame source nodes prefer their Canvas-specific cropped thumbnail", () => {
  const canvas = createCanvasComponent(0);
  const frame = createCanvasFrame(0);
  canvas.thumbnail = "whole-canvas";
  canvas.canvas.frameThumbnails = { [frame.id]: "cropped-frame" };
  const nodes = sceneSourceNodes({ components: [canvas], recordingFrames: [frame] });
  assert.equal(nodes.find((node) => node.type === "component").thumbnail, "whole-canvas");
  assert.equal(nodes.find((node) => node.type === "recording-frame").thumbnail, "cropped-frame");
});

test("recording-frame source recency combines only its Canvas and shared frame", () => {
  const nested = createDefaultComponent(0);
  nested.activity = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z", lastUsedAt: "" };
  const canvas = createCanvasComponent(0, nested.id);
  canvas.activity = { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", lastUsedAt: "" };
  const frame = createCanvasFrame(0);
  frame.activity = { createdAt: "2026-01-04T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z", lastUsedAt: "" };
  const node = sceneSourceNodes({ components: [nested, canvas], recordingFrames: [frame] })
    .find((item) => item.type === "recording-frame");

  assert.equal(node.createdAt, frame.activity.createdAt);
  assert.equal(node.recentAt, new Date(frame.activity.updatedAt).getTime());
});

test("an intentionally empty shared recording-frame registry stays empty", () => {
  const state = sanitizeState({
    components: [createCanvasComponent(0)],
    recordingFrames: [],
  });
  assert.deepEqual(state.recordingFrames, []);
});

function pickSize(metrics) {
  return {
    baseWidth: metrics.baseWidth,
    baseHeight: metrics.baseHeight,
    width: metrics.width,
    height: metrics.height,
  };
}
