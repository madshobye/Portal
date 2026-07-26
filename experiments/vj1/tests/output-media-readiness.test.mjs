import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  collectComponentReadiness,
  collectOutputReadiness,
} from "../js/output/output-readiness-collector.js";

test("output readiness traverses nested components groups and generator media", () => {
  const child = {
    id: "child",
    chain: [{
      id: "morph",
      kind: "source",
      enabled: true,
      source: { type: "generator", generatorId: "featureMorph", params: { imageAId: "ready", imageBId: "missing" } },
    }],
  };
  const parent = {
    id: "parent",
    chain: [{
      id: "group",
      kind: "group",
      enabled: true,
      chain: [{ id: "child-ref", kind: "source", enabled: true, source: { type: "component", componentId: "child" } }],
    }],
  };
  const status = collectOutputReadiness({
    mode: "output",
    state: { components: [parent, child], surfaces: [{ enabled: true, componentId: "parent" }] },
    media: new Map([["ready", { ready: true }]]),
    programs: new Map([
      ["parent", {
        inspect: () => ({
          mediaDemand: { ids: [] },
          dependencies: { components: ["child"] },
        }),
      }],
      ["child", {
        inspect: () => ({
          mediaDemand: { ids: ["ready", "missing"] },
          dependencies: { components: [] },
        }),
      }],
    ]),
  });

  assert.equal(status.total, 2);
  assert.deepEqual([...status.missingIds], ["missing"]);
  assert.equal(status.blocked, true);
});

test("an explicit empty chain does not preload a hidden legacy source", () => {
  const component = {
    id: "empty",
    chain: [],
    source: { type: "media", mediaId: "legacy-hidden.png" },
  };
  const status = collectOutputReadiness({
    mode: "output",
    state: { components: [component], surfaces: [{ enabled: true, componentId: component.id }] },
    media: new Map(),
    programs: new Map([["empty", {
      inspect: () => ({
        mediaDemand: { ids: [] },
        dependencies: { components: [] },
      }),
    }]]),
  });

  assert.equal(status.total, 0);
  assert.equal(status.blocked, false);
  assert.deepEqual([...status.missingIds], []);
});

test("output readiness reports declared control-host lifecycle without blocking optional controls", () => {
  const component = { id: "controlled", chain: [] };
  const activations = [];
  const controlSignals = {
    activate: (kind, requirement) =>
      activations.push([kind, requirement.endpoint || ""]),
    status: (_kind, address) => ({
      state: "ready",
      error: "",
      inputCount: 1,
      signalAvailable: address === "1:cc:7",
    }),
  };
  const status = collectOutputReadiness({
    mode: "output",
    state: {
      components: [component],
      surfaces: [{ enabled: true, componentId: component.id }],
    },
    programs: new Map([[component.id, {
      inspect: () => ({
        mediaDemand: { ids: [] },
        dependencies: { components: [] },
        readiness: {
          requirements: [
            {
              kind: "control-signal",
              signalKind: "midi",
              address: "1:cc:7",
              required: false,
            },
            {
              kind: "control-signal",
              signalKind: "midi",
              address: "1:cc:8",
              required: true,
            },
            {
              kind: "control-signal",
              signalKind: "osc",
              endpoint: "ws://osc.example/control",
              address: "/vj1/value",
              required: false,
            },
          ],
        },
      }),
    }]]),
    controlSignals,
  });

  assert.deepEqual(activations, [
    ["midi", ""],
    ["midi", ""],
    ["osc", "ws://osc.example/control"],
  ]);
  assert.equal(status.controlSignals.get("midi:1:cc:7").state, "ready");
  assert.equal(status.controlSignals.get("midi:1:cc:7").signalAvailable, true);
  assert.deepEqual([...status.requiredControlSignalIds], ["midi:1:cc:8"]);
  assert.equal(
    status.controlSignals.get(
      "osc:ws://osc.example/control:/vj1/value",
    ).endpoint,
    "ws://osc.example/control",
  );
  assert.equal(status.blocked, true);
});

test("compiled camera and screen requirements share typed resource readiness", () => {
  const component = { id: "inputs", chain: [] };
  const requirements = [
    { kind: "camera", id: "default" },
    { kind: "screen-input", id: "display-1" },
  ];
  const resolved = [];
  const status = collectComponentReadiness({
    component,
    components: [component],
    programs: new Map([[component.id, {
      inspect: () => ({
        mediaDemand: { ids: [] },
        dependencies: { components: [] },
        readiness: { requirements },
      }),
    }]]),
    resourceReadiness(requirement) {
      resolved.push(`${requirement.kind}:${requirement.id}`);
      if (requirement.kind === "camera") {
        return { ...requirement, state: "pending", error: "" };
      }
      return {
        ...requirement,
        state: "error",
        error: "selected shared input is unavailable",
      };
    },
  });

  assert.deepEqual(resolved, ["camera:default", "screen-input:display-1"]);
  assert.equal(status.resources.get("camera:default").state, "pending");
  assert.equal(status.resources.get("screen-input:display-1").state, "error");
  assert.deepEqual([...status.pendingResourceIds], ["camera:default"]);
  assert.deepEqual([...status.errorResourceIds], ["screen-input:display-1"]);
  assert.deepEqual([...status.errorIds], ["screen-input:display-1"]);
  assert.equal(status.blocked, true);
});

test("declared external capabilities gate readiness only through their owner", () => {
  const component = { id: "analysis", chain: [] };
  const program = {
    inspect: () => ({
      mediaDemand: { ids: [] },
      dependencies: { components: [] },
      readiness: {
        requirements: [{
          kind: "capability",
          id: "feature-morph-analysis",
          lifecycle: "retained-request",
          asynchronous: true,
        }],
      },
    }),
  };
  const status = collectComponentReadiness({
    component,
    components: [component],
    programs: new Map([[component.id, program]]),
    capabilityReadiness(requirement, context) {
      assert.equal(requirement.id, "feature-morph-analysis");
      assert.equal(context.program, program);
      return {
        kind: "capability",
        id: requirement.id,
        state: "pending",
        error: "",
      };
    },
  });

  assert.equal(
    status.resources.get("capability:feature-morph-analysis:analysis").state,
    "pending",
  );
  assert.equal(status.blocked, true);
});

test("output readiness fails closed when an enabled Component has no compiled program", () => {
  assert.throws(() => collectOutputReadiness({
    mode: "output",
    state: {
      components: [{ id: "uncompiled", chain: [] }],
      surfaces: [{ enabled: true, componentId: "uncompiled" }],
    },
    programs: new Map(),
  }), /VJ1_COMPONENT_PROGRAM_MISSING:uncompiled/);
});

test("output renderer delegates loading and blackout traversal", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const readinessSource = readFileSync(new URL("../js/output/output-readiness-collector.js", import.meta.url), "utf8");
  const runtimeSource = readFileSync(new URL("../js/output/output-readiness-runtime.js", import.meta.url), "utf8");

  assert.match(runtimeSource, /from "\.\/output-readiness-collector\.js"/);
  assert.doesNotMatch(rendererSource, /collectComponentMediaReadiness\(/);
  assert.doesNotMatch(rendererSource, /collectChainMediaReadiness\(/);
  assert.doesNotMatch(readinessSource, /collectChainMediaReadiness|component\.chain/);
  assert.match(readinessSource, /VJ1_COMPONENT_PROGRAM_MISSING/);
  assert.match(runtimeSource, /collectComponentReadiness/);
  assert.ok(runtimeSource.includes("this.host.mediaRuntime.requestMissingMediaBatch(Array.from(status.missingIds))"));
});
