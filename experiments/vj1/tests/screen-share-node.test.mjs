import test from "node:test";
import assert from "node:assert/strict";

import { compileJavaScriptNodeModule, createProjectNodeFork } from "../js/libraries/node-engine/index.js";
import { createProjectVisualNodeResolver, getGeneratorNodeComponent } from "../js/libraries/visual-nodes/index.js";

function screenTarget() {
  return {
    width: 640,
    height: 360,
    calls: [],
    push() { this.calls.push(["push"]); },
    pop() { this.calls.push(["pop"]); },
    translate(...values) { this.calls.push(["translate", ...values]); },
    scale(...values) { this.calls.push(["scale", ...values]); },
  };
}

test("Screen Share compiles sampling, fit, mirroring, and unavailable behavior as node code", () => {
  const definition = getGeneratorNodeComponent("screenShare").nodeDefinition;
  const compiled = compileJavaScriptNodeModule(definition.parts, definition);
  const target = screenTarget();
  const screen = { readyState: 4 };
  const mediaCalls = [];

  compiled.process({ source: { params: { inputId: "display-1", fit: "cover", mirrored: true } } }, {
    target,
    acquireScreenInput: (id) => id === "display-1" ? screen : null,
    screenInputError: () => "",
    isDrawableMedia: () => true,
    drawMediaFit: (...args) => mediaCalls.push(args),
    drawStandby() {},
  });

  assert.equal(definition.metadata.nodeOwnedNativeProcess, true);
  assert.deepEqual(definition.parts.map((part) => part.id), ["screen-share-draw-algorithm", "screen-share-process"]);
  assert.deepEqual(target.calls, [["push"], ["translate", 640, 0], ["scale", -1, 1], ["pop"]]);
  assert.deepEqual(mediaCalls[0], [target, screen, 0, 0, 640, 360, "cover"]);
});

test("Screen Share project forks replace its actual draw algorithm", () => {
  const base = getGeneratorNodeComponent("screenShare").nodeDefinition;
  const fork = createProjectNodeFork(base, {
    forkId: "screen-share-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "screen-share-draw-algorithm" ? {
        ...part,
        source: "function drawScreenShareNode(target, _screen, params) { target.calls.push(['forked', params.fit]); }",
      } : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const target = screenTarget();

  resolver.definition(base.id).process({ source: { params: { inputId: "display-1", fit: "stretch" } } }, {
    target,
    acquireScreenInput: () => ({}),
    screenInputError: () => "",
    isDrawableMedia: () => true,
    drawMediaFit() {},
    drawStandby() {},
  });

  assert.deepEqual(target.calls, [["forked", "stretch"]]);
});

test("Screen Share node delegates only session acquisition and diagnostics to host capabilities", () => {
  const definition = getGeneratorNodeComponent("screenShare").nodeDefinition;
  const compiled = compileJavaScriptNodeModule(definition.parts, definition);
  const standby = [];

  compiled.process({ source: { params: { inputId: "missing" } } }, {
    target: screenTarget(),
    acquireScreenInput: () => null,
    screenInputError: () => "selected shared input is unavailable",
    isDrawableMedia: () => false,
    drawMediaFit() {},
    drawStandby: (...args) => standby.push(args),
  });

  assert.equal(standby[0][1], "selected shared input is unavailable");
  assert.deepEqual(standby[0][2], { forceVisible: true });
});
