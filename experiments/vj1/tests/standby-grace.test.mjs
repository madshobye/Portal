import test from "node:test";
import assert from "node:assert/strict";

import { drawStandby } from "../js/output/generators.js";
import { SourceRenderRuntime } from "../js/output/source-render-runtime.js";

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
    background: record("background"),
    noStroke: record("noStroke"),
    fill: record("fill"),
    rect: record("rect"),
    textAlign: record("textAlign"),
    textSize: record("textSize"),
    text: record("text"),
  };
}

test("transient standby stays black for one continuous second before showing diagnostics", () => {
  globalThis.CENTER = "center";
  const target = standbyTarget();

  drawStandby(target, "loading media", { frame: 1, graceMs: 1000, now: 0 });
  drawStandby(target, "loading media", { frame: 2, graceMs: 1000, now: 500 });
  assert.equal(target.calls.filter(([name]) => name === "text").length, 0);
  assert.deepEqual(target.calls.filter(([name]) => name === "background").map((call) => call[1]), ["#000000", "#000000"]);

  drawStandby(target, "loading media", { frame: 3, graceMs: 1000, now: 1000 });
  assert.equal(target.calls.filter(([name]) => name === "text").at(-1)[1], "loading media");
});

test("a discontinuous loading episode receives a new grace period", () => {
  const target = standbyTarget();
  drawStandby(target, "loading media", { frame: 10, graceMs: 1000, now: 0 });
  drawStandby(target, "loading media", { frame: 30, graceMs: 1000, now: 2000 });

  assert.equal(target.calls.filter(([name]) => name === "text").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "background").at(-1)[1], "#000000");
});

test("standby diagnostics own a target-local matrix instead of inheriting source transforms", () => {
  const target = standbyTarget();

  drawStandby(target, "media resource unavailable");

  const names = target.calls.map(([name]) => name);
  assert.ok(names.indexOf("resetMatrix") > names.indexOf("push"));
  assert.ok(names.indexOf("resetMatrix") < names.indexOf("rect"));
  assert.ok(names.indexOf("resetMatrix") < names.indexOf("text"));
  assert.ok(names.lastIndexOf("pop") > names.indexOf("text"));
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

  assert.equal(target.calls.filter(([name]) => name === "background").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "rect").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "text").length, 0);
  assert.equal(target.calls.filter(([name]) => name === "clear").length, 1);
  runtime.dispose();
});
