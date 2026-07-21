import test from "node:test";
import assert from "node:assert/strict";

import {
  isDirectP5ImageSourceSafe,
  markRenderTargetOrientation,
  registerRenderTarget,
  renderTargetDescriptor,
  renderTargetNeedsPresentationFlip,
  RENDER_TARGET_KIND,
  RENDER_TEXTURE_ORIENTATION,
} from "../js/output/render-target-contract.js";
import { contentTransformRawWebglPlacement } from "../js/output/content-coordinate-space.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { boundedSampleRect } from "../js/output/render-draw-utils.js";

test("render targets carry explicit logical size orientation and p5 safety", () => {
  const target = { width: 640, height: 360 };
  registerRenderTarget(target, {
    kind: RENDER_TARGET_KIND.rawWebgl,
    orientation: RENDER_TEXTURE_ORIENTATION.bottomLeft,
    logicalWidth: 1280,
    logicalHeight: 720,
    directP5ImageSafe: false,
  });
  assert.deepEqual(renderTargetDescriptor(target), {
    kind: RENDER_TARGET_KIND.rawWebgl,
    orientation: RENDER_TEXTURE_ORIENTATION.bottomLeft,
    logicalWidth: 1280,
    logicalHeight: 720,
    width: 640,
    height: 360,
    directP5ImageSafe: false,
  });
  assert.equal(renderTargetNeedsPresentationFlip(target), true);
  assert.equal(isDirectP5ImageSourceSafe(target), false);
  markRenderTargetOrientation(target, RENDER_TEXTURE_ORIENTATION.topLeft);
  assert.equal(renderTargetNeedsPresentationFlip(target), false);
});

test("screen-oriented transforms convert once at a raw WebGL model boundary", () => {
  assert.deepEqual(
    contentTransformRawWebglPlacement({ x: 0.5, y: 0.25, scale: 2, rotation: 0.4 }, 800, 600),
    { x: 200, y: -75, scale: 2, rotation: -0.4 }
  );
});

test("texture sample rectangles are bounded before a browser GPU copy", () => {
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const source = { width: 640, height: 360 };
    assert.deepEqual(
      boundedSampleRect(source, { x: -20, y: 350, width: 800, height: 80 }),
      { x: 0, y: 350, width: 640, height: 10 }
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], "[VJ1_SAMPLE_RECT_OUT_OF_BOUNDS]");
    boundedSampleRect(source, { x: -20, y: 350, width: 800, height: 80 });
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = previousWarn;
  }
});

test("mapped and direct surfaces share one reversible world-to-output transform", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  globalThis.width = 200;
  globalThis.height = 100;
  try {
    const renderer = new OutputRenderer({ mode: "output", outputId: "main" });
    renderer.state = {
      render: {
        outputs: [{ id: "main", aspectRatio: 1 }],
        hostViewport: { width: 200, height: 100, mode: "output", outputId: "main" },
      },
    };
    const world = { x: 82, y: 31 };
    const display = renderer.worldPointToDisplay(world);
    assert.deepEqual(renderer.displayPointToWorld(display), world);
  } finally {
    globalThis.width = previousWidth;
    globalThis.height = previousHeight;
  }
});
