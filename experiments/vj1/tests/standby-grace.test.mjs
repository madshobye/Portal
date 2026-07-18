import test from "node:test";
import assert from "node:assert/strict";

import { drawStandby } from "../js/output/generators.js";

function standbyTarget() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    width: 112,
    height: 112,
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
