import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanvasOwnership,
  claimPresentationCanvas,
  publishCanvasOwnershipDiagnostics,
} from "../js/output/canvas-ownership.js";

function fakeCanvas({ id = "defaultCanvas0", width = 1, height = 1 } = {}) {
  const attributes = new Map();
  return {
    tagName: "CANVAS",
    id,
    width,
    height,
    dataset: {},
    isConnected: true,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) || null; },
  };
}

function fakeRoot(canvases) {
  return {
    querySelectorAll(selector) {
      return selector === "canvas" ? canvases : [];
    },
  };
}

test("presentation and runtime auxiliary canvases publish explicit unique ownership", () => {
  const auxiliary = fakeCanvas();
  const presentation = fakeCanvas({ width: 1280, height: 720 });
  const root = fakeRoot([auxiliary, presentation]);

  claimPresentationCanvas(presentation, {
    ownerId: "output:main",
    host: root,
  });
  const snapshot = publishCanvasOwnershipDiagnostics(root, "output:main");

  assert.equal(presentation.id, "vj1-output-main-presentation-canvas");
  assert.deepEqual(snapshot.map(({ ownerId, kind, width, height }) => ({
    ownerId, kind, width, height,
  })), [
    { ownerId: "output:main", kind: "p5-auxiliary", width: 1, height: 1 },
    { ownerId: "output:main", kind: "presentation", width: 1280, height: 720 },
  ]);
});

test("canvas ownership rejects an unexplained full-resolution allocation", () => {
  const presentation = fakeCanvas({ width: 1280, height: 720 });
  const duplicate = fakeCanvas({ width: 1280, height: 720 });
  const root = fakeRoot([presentation, duplicate]);
  claimPresentationCanvas(presentation, { ownerId: "output:main", host: root });

  assert.throws(
    () => assertCanvasOwnership(root, "output:main"),
    /VJ1_CANVAS_OWNER_MISSING:1/,
  );
});
