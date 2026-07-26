import test from "node:test";
import assert from "node:assert/strict";

import { drawStandby } from "../js/output/generators.js";
import { SourceRenderRuntime } from "../js/output/source-render-runtime.js";
import { mediaResourceDiagnosticKind } from "../js/libraries/visual-nodes/renderers/media-resource-to-image/index.js";

function standbyTarget() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    width: 112,
    height: 112,
    push: record("push"),
    pop: record("pop"),
    resetMatrix: record("resetMatrix"),
    clear: record("clear"),
    noStroke: record("noStroke"),
    noFill: record("noFill"),
    stroke: record("stroke"),
    strokeWeight: record("strokeWeight"),
    fill: record("fill"),
    rect: record("rect"),
    line: record("line"),
    textAlign: record("textAlign"),
    textSize: record("textSize"),
    text: record("text"),
  };
}

test("transient standby stays transparent for one continuous second before showing diagnostics", () => {
  globalThis.CENTER = "center";
  const target = standbyTarget();

  drawStandby(target, "loading media", { frame: 1, graceMs: 1000, now: 0 });
  drawStandby(target, "loading media", { frame: 2, graceMs: 1000, now: 500 });
  assert.equal(target.calls.filter(([name]) => name === "rect").length, 0);

  drawStandby(target, "loading media", { frame: 3, graceMs: 1000, now: 1000 });
  assert.equal(target.calls.filter(([name]) => name === "rect").length, 1);
  assert.equal(target.calls.filter(([name]) => name === "text").length, 0);
});

test("a discontinuous loading episode receives a new grace period", () => {
  const target = standbyTarget();
  drawStandby(target, "loading media", { frame: 10, graceMs: 1000, now: 0 });
  drawStandby(target, "loading media", { frame: 30, graceMs: 1000, now: 2000 });

  assert.equal(target.calls.filter(([name]) => name === "rect").length, 0);
});

test("standby diagnostics own a target-local matrix instead of inheriting source transforms", () => {
  const target = standbyTarget();

  drawStandby(target, "media resource unavailable");

  const names = target.calls.map(([name]) => name);
  assert.ok(names.indexOf("resetMatrix") > names.indexOf("push"));
  assert.ok(names.indexOf("resetMatrix") < names.indexOf("rect"));
  assert.ok(names.lastIndexOf("pop") > names.indexOf("rect"));
});

test("standby detail is opt-in for progress-owning operations", () => {
  globalThis.CENTER = "center";
  const target = standbyTarget();

  drawStandby(target, "matching features", { detail: true });

  assert.equal(target.calls.filter(([name]) => name === "text").at(-1)[1], "matching features");
});

test("standby icon reflects the declared resource type without opaque backing", () => {
  const target = standbyTarget();

  drawStandby(target, "loading video", { icon: "video" });

  assert.equal(
    target.calls.filter(([name]) => name === "line").length,
    3,
    "video diagnostics use only the shared target's portable line primitive",
  );
  assert.equal(target.calls.filter(([name]) => name === "background").length, 0);
});

test("media standby type follows declared capability then stable file identity", () => {
  assert.equal(mediaResourceDiagnosticKind({ mediaKind: "video", mediaId: "media/a.png" }), "video");
  assert.equal(mediaResourceDiagnosticKind({ mediaId: "media/a.svg?revision=2" }), "image");
  assert.equal(mediaResourceDiagnosticKind({ mediaId: "media/a.glb" }), "model");
  assert.equal(mediaResourceDiagnosticKind({ mediaId: "media/unknown" }), "resource");
});

test("clean Output never renders editor standby diagnostics", () => {
  const target = standbyTarget();
  const runtime = new SourceRenderRuntime({
    mode: "output",
    state: { ui: { debugPreview: true } },
    frameRuntime: { frameIndex: 1 },
  });

  runtime.drawStandby(target, "media resource unavailable", {
    forceVisible: true,
  });

  assert.equal(target.calls.filter(([name]) => name === "rect").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "text").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "clear").length, 1);
  runtime.dispose();
});
