import test from "node:test";
import assert from "node:assert/strict";

import {
  compositionFrameMetrics,
  normalizeCompositionFrameShape,
  normalizeCompositionResolutionScale,
} from "../js/domain/composition-frame.js";
import { createCanvasComposition, createDefaultComposition, createDefaultSurface, createSceneFromState, normalizeCompositionPipelineSettings, normalizeProjectionFit, sanitizeState } from "../js/domain/models.js";

const render = {
  surfaceWidth: 1000,
  surfaceHeight: 700,
  pixelDensity: 0.5,
};

test("composition frame shape derives landscape portrait and square from the surface texture", () => {
  assert.deepEqual(
    pickSize(compositionFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 })),
    { baseWidth: 1000, baseHeight: 700, width: 500, height: 350 }
  );
  assert.deepEqual(
    pickSize(compositionFrameMetrics(render, { frameShape: "portrait", resolutionScale: 1 })),
    { baseWidth: 700, baseHeight: 1000, width: 350, height: 500 }
  );
  assert.deepEqual(
    pickSize(compositionFrameMetrics(render, { frameShape: "square", resolutionScale: 1 })),
    { baseWidth: 700, baseHeight: 700, width: 350, height: 350 }
  );
});

test("composition resolution scale multiplies the global density", () => {
  const low = compositionFrameMetrics(render, { frameShape: "landscape", resolutionScale: 0.5 });
  const normal = compositionFrameMetrics(render, { frameShape: "landscape", resolutionScale: 1 });
  const high = compositionFrameMetrics(render, { frameShape: "landscape", resolutionScale: 2 });

  assert.deepEqual([low.effectiveScale, low.width, low.height], [0.25, 250, 175]);
  assert.deepEqual([normal.effectiveScale, normal.width, normal.height], [0.5, 500, 350]);
  assert.deepEqual([high.effectiveScale, high.width, high.height], [1, 1000, 700]);
});

test("composition frame settings normalize to backward-compatible defaults", () => {
  assert.equal(normalizeCompositionFrameShape("wide"), "landscape");
  assert.equal(normalizeCompositionResolutionScale(1.5), 1);

  const created = createDefaultComposition(0);
  assert.equal(created.frameShape, "landscape");
  assert.equal(created.resolutionScale, 1);

  const state = sanitizeState({
    compositions: [{ ...created, frameShape: "portrait", resolutionScale: 2 }],
  });
  assert.equal(state.compositions[0].frameShape, "portrait");
  assert.equal(state.compositions[0].resolutionScale, 2);
});

test("composition upscale and post settings normalize with neutral defaults", () => {
  assert.deepEqual(normalizeCompositionPipelineSettings({}), {
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

test("surface projection fit defaults to cover and persists in scene snapshots", () => {
  assert.equal(createDefaultSurface(0).projectionFit, "cover");
  assert.equal(normalizeProjectionFit("contain"), "contain");
  assert.equal(normalizeProjectionFit("stretch"), "stretch");
  assert.equal(normalizeProjectionFit("invalid"), "cover");

  const state = sanitizeState({ surfaces: [{ id: "surface-a", projectionFit: "contain" }] });
  const scene = createSceneFromState(state, "Fit scene");
  assert.equal(state.surfaces[0].projectionFit, "contain");
  assert.equal(scene.snapshot.surfaces[0].projectionFit, "contain");
});

test("legacy canvas layers migrate into the shared chain without retaining a parallel layer model", () => {
  const source = createDefaultComposition(0);
  source.id = "composition-source";
  const state = sanitizeState({
    compositions: [source, {
      id: "legacy-canvas",
      type: "canvas",
      name: "Legacy Canvas",
      chain: [],
      canvas: {
        width: 2000,
        height: 1000,
        layers: [{
          id: "legacy-layer",
          compositionId: source.id,
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
  const canvas = state.compositions.find((composition) => composition.id === "legacy-canvas");
  assert.equal("layers" in canvas.canvas, false);
  assert.equal(canvas.chain.length, 1);
  assert.equal(canvas.chain[0].role, "canvas-layer");
  assert.deepEqual(canvas.chain[0].layout, { x: 120, y: 80, width: 640, height: 360 });
  assert.equal(canvas.chain[0].opacity, 0.7);
  assert.equal(canvas.chain[0].blend, "screen");
  assert.equal(canvas.chain[0].chain[0].source.compositionId, source.id);
});

test("canvas frame routes persist in active surfaces and scene snapshots", () => {
  const source = createDefaultComposition(0);
  const canvas = createCanvasComposition(0, source.id);
  const frameId = canvas.canvas.frames[0].id;
  const state = sanitizeState({
    compositions: [source, canvas],
    surfaces: [{ id: "surface-a", compositionId: canvas.id, outputFrameId: frameId }],
  });
  const scene = createSceneFromState(state, "Frame scene");
  assert.equal(state.surfaces[0].outputFrameId, frameId);
  assert.equal(scene.snapshot.surfaces[0].outputFrameId, frameId);
});

function pickSize(metrics) {
  return {
    baseWidth: metrics.baseWidth,
    baseHeight: metrics.baseHeight,
    width: metrics.width,
    height: metrics.height,
  };
}
