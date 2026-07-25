import test from "node:test";
import assert from "node:assert/strict";

import {
  isDirectP5ImageSourceSafe,
  markRenderTargetOrientation,
  registerRenderTarget,
  renderTargetDescriptor,
  renderTargetNeedsPresentationFlip,
  renderTargetNeedsShaderSampleFlip,
  RENDER_TARGET_KIND,
  RENDER_TEXTURE_ORIENTATION,
  withRenderTarget2D,
} from "../js/output/render-target-contract.js?v=source-target-ownership-1";
import { contentTransformRawWebglPlacement } from "../js/output/content-coordinate-space.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import {
  boundedSampleRect,
  drawSampleRect,
  renderTargetImageGeometry,
} from "../js/output/render-draw-utils.js";

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

test("one orientation contract drives shader sampling and sampled p5 presentation", () => {
  const ordinary = { width: 100, height: 80 };
  assert.equal(
    renderTargetNeedsShaderSampleFlip(ordinary, false),
    true,
    "ordinary uploaded images retain the host texture upload inversion",
  );
  assert.equal(
    renderTargetNeedsShaderSampleFlip(ordinary, true),
    false,
    "top-left retained shader targets require no semantic inversion",
  );

  const raw = { width: 100, height: 80 };
  markRenderTargetOrientation(raw, RENDER_TEXTURE_ORIENTATION.bottomLeft);
  assert.equal(
    renderTargetNeedsShaderSampleFlip(raw, true),
    true,
    "raw WebGL storage is normalized when sampled by another shader",
  );
  assert.equal(
    renderTargetNeedsShaderSampleFlip(raw, false),
    false,
    "the semantic raw flip cancels an ordinary upload flip",
  );

  assert.deepEqual(
    renderTargetImageGeometry(
      raw,
      { x: 2, y: 3, width: 40, height: 60 },
      { x: 10, y: 5, width: 20, height: 30 },
    ),
    {
      flipped: true,
      destination: { x: 2, y: 63, width: 40, height: -60 },
      sample: { x: 10, y: 45, width: 20, height: 30 },
    },
  );

  const calls = [];
  drawSampleRect(
    {
      width: 40,
      height: 60,
      image: (...args) => calls.push(args),
    },
    raw,
    { x: 10, y: 5, width: 20, height: 30 },
    2,
    3,
    40,
    60,
  );
  assert.deepEqual(calls, [[raw, 2, 63, 40, -60, 10, 45, 20, 30]]);
});

test("immediate 2D target ownership is balanced around the final draw", () => {
  let depth = 0;
  const events = [];
  const target = {
    push() {
      events.push("begin");
      depth++;
    },
    pop() {
      events.push("end");
      depth--;
    },
  };

  const result = withRenderTarget2D(target, () => {
    events.push(`draw:${depth}`);
    return "complete";
  });

  assert.equal(result, "complete");
  assert.equal(depth, 0);
  assert.deepEqual(events, ["begin", "draw:1", "end"]);
  assert.throws(
    () => withRenderTarget2D(target, () => {
      throw new Error("draw failed");
    }),
    /draw failed/,
  );
  assert.equal(depth, 0, "a failed backend cannot leave its framebuffer active");
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
    const display = renderer.presentationGeometry.worldPointToDisplay(world);
    const restored = renderer.presentationGeometry.displayPointToWorld(display);
    assert.ok(Math.abs(restored.x - world.x) < 1e-9);
    assert.ok(Math.abs(restored.y - world.y) < 1e-9);
  } finally {
    globalThis.width = previousWidth;
    globalThis.height = previousHeight;
  }
});
