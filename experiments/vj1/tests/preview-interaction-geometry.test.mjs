import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canvasPointerToLogicalPoint,
  findChainItemTransformContext,
  groupLocalBounds,
  hitTestChainItems,
  isPhysicalChainItem,
  logicalPixelsPerCssPixel,
  resolveChainTransformDrag,
  transformHandleLayout,
} from "../js/output/preview-interaction-geometry.js";

test("spatial effects participate in the same preview handle contract as sources", () => {
  assert.equal(isPhysicalChainItem({ kind: "effect", componentId: "alphaVignette" }), true);
  assert.equal(isPhysicalChainItem({ kind: "effect", componentId: "blur" }), false);
});

test("nested chain transform context composes parent translation and scale", () => {
  const child = { id: "child", kind: "source", source: { type: "media" }, transform: { x: 0.25, scale: 0.5 } };
  const group = { id: "group", kind: "group", transform: { x: 0.5, scale: 2 }, chain: [child] };
  const context = findChainItemTransformContext([group], child.id);

  assert.deepEqual(context.parentTransform, { x: 0.5, y: 0, scale: 2, rotation: 0 });
  assert.deepEqual(context.transform, { x: 1, y: 0, scale: 1, rotation: 0 });
});

test("preview hit policy returns the containing group for nested physical children", () => {
  const child = { id: "child", kind: "source", source: { type: "media", mediaId: "image" } };
  const group = { id: "group", kind: "group", chain: [child] };
  const frame = { x: 0, y: 0, width: 100, height: 100 };
  const hit = hitTestChainItems({ chain: [group], component: {}, frame, x: 50, y: 50 });

  assert.equal(hit, group);
  group.enabled = false;
  assert.equal(hitTestChainItems({ chain: [group], component: {}, frame, x: 50, y: 50 }), null);
});

test("move scale and rotation drag calculations live outside the renderer", () => {
  const move = resolveChainTransformDrag({
    mode: "move",
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    parentTransform: { scale: 2 },
    startX: 0,
    startY: 0,
    frameWidth: 100,
    frameHeight: 100,
  }, 10, 0);
  const scale = resolveChainTransformDrag({
    mode: "scale",
    transform: { scale: 1 },
    centerX: 0,
    centerY: 0,
    startDistance: 10,
  }, 40, 0);
  const rotate = resolveChainTransformDrag({
    mode: "rotate",
    transform: { rotation: 0 },
    centerX: 0,
    centerY: 0,
    startAngle: 0,
  }, 0, 1);
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.equal(move.x, 0.1);
  assert.equal(move.y, 0);
  assert.equal(scale.scale, 2);
  assert.equal(rotate.rotation, Math.PI / 2);
  assert.match(renderer, /from "\.\/preview-interaction-geometry\.js\?v=power-flicker-1"/);
  assert.doesNotMatch(renderer, /function findChainItemTransformContext\(/);
  assert.doesNotMatch(renderer, /function chainTransformDragScale\(/);
});

test("transform controls retain the established near-center cluster", () => {
  assert.deepEqual(transformHandleLayout({ width: 200, height: 100 }, 1), {
    boxWidth: 200,
    boxHeight: 100,
    scaleHandleX: 52,
    scaleHandleY: 0,
    rotateHandleX: 0,
    rotateHandleY: -52,
  });
});

test("editor controls retain a usable CSS-pixel target on fitted high-resolution canvases", () => {
  assert.equal(logicalPixelsPerCssPixel(3840, 2160, 960, 540), 4);
  assert.equal(logicalPixelsPerCssPixel(640, 360, 1280, 720), 0.5);
});

test("pointer conversion uses logical p5 dimensions rather than DOM backing pixels", () => {
  assert.deepEqual(canvasPointerToLogicalPoint(580, 320, {
    left: 100,
    top: 50,
    width: 960,
    height: 540,
  }, {
    width: 1920,
    height: 1080,
  }), { x: 960, y: 540 });
});

test("a Group boundary is the union of its physical children rather than the whole Composition", () => {
  const group = {
    kind: "group",
    chain: [
      { id: "left", kind: "source", source: { type: "component" }, transform: { x: -0.5 } },
      { id: "right", kind: "source", source: { type: "component" }, transform: { x: 0.5 } },
    ],
  };
  const bounds = groupLocalBounds({
    group,
    frame: { width: 200, height: 100 },
    baseRectForItem: () => ({ x: 75, y: 25, width: 50, height: 50 }),
  });

  assert.deepEqual(bounds, { x: 25, y: 25, width: 150, height: 50 });
});
