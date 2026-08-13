import test from "node:test";
import assert from "node:assert/strict";

import { createVj1NodePackage } from "../js/app-node-package.js";
import {
  createComponentEffect,
  createInitialState,
  sanitizeState,
} from "../js/domain/models.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/shared/component-program-compiler.js";
import { addParameterAnimationTrack } from "../js/libraries/composition-engine/shared/parameter-animation-tracks.js";
import {
  createDmxFixture,
  dmxFixtureChannelParameterId,
  dmxPatchWarnings,
  dmxProbeComponentForState,
  dmxProbeFixtureValues,
  dmxProbeSampleResolution,
  normalizeDmxDeviceSettings,
  writeDmxFixtureValues,
} from "../js/libraries/dmx-engine/index.js";
import DmxProbe from "../js/libraries/visual-nodes/effects/dmx-probe/index.js";
import { createDmxOutputService } from "../js/services/dmx-output-service.js";
import { buildProjectPayload } from "../js/services/project-serializer.js";
import { SharedFramebufferTarget } from "../js/output/shared-framebuffer-target.js";
import { ProbeRuntime } from "../js/output/probe-runtime.js";
import { componentChainProjection } from "../js/domain/component-layer-projection.js";

test("DMX fixture profiles normalize semantic channels and include the editable U’King 11CH profile", () => {
  const settings = normalizeDmxDeviceSettings();
  const uking = settings.profiles.find((entry) => entry.id === "dmx-uking-zq01003-11ch");
  assert.equal(uking.channels.length, 11);
  assert.deepEqual(uking.sampleResolution, { width: 2, height: 1 });
  assert.deepEqual(
    uking.channels.map((entry) => entry.name),
    [
      "Master dimmer",
      "Strobe",
      "Built-in program",
      "Program speed / sound sensitivity",
      "Main LED red",
      "Main LED green",
      "Main LED blue",
      "Main LED white",
      "Outer ring red",
      "Outer ring green",
      "Outer ring blue",
    ],
  );
  assert.deepEqual(uking.channels[8].sampleCell, { x: 1, y: 0 });
  assert.equal(uking.channels[4].zone, "spot-rgb");
  assert.equal(uking.channels[7].zone, "spot-white");
  assert.equal(uking.channels[8].zone, "outer-ring");
  assert.deepEqual(dmxProbeSampleResolution({ params: { zone: "spot-rgb" } }, uking), {
    width: 1,
    height: 1,
  });
  assert.deepEqual(dmxProbeSampleResolution({ params: { zone: "all" } }, uking), {
    width: 2,
    height: 1,
  });
  const spotValues = dmxProbeFixtureValues(
    { params: { mode: "canvas", zone: "spot-rgb" } },
    uking,
    [{ r: 0.8, g: 0.4, b: 0.2, brightness: 0.5 }],
  );
  assert.equal(spotValues["main-red"], 0.8);
  assert.equal(Object.hasOwn(spotValues, "main-white"), false);
  assert.equal(Object.hasOwn(spotValues, "ring-red"), false);
  const whiteValues = dmxProbeFixtureValues(
    { params: { mode: "canvas", zone: "spot-white" } },
    uking,
    [{ r: 0.8, g: 0.4, b: 0.2, brightness: 0.5 }],
  );
  assert.equal(Object.hasOwn(whiteValues, "main-red"), false);
  assert.equal(whiteValues["main-white"], 0.5);
  assert.equal(Object.hasOwn(whiteValues, "ring-red"), false);

  const persistedBeforeZones = {
    ...uking,
    zones: undefined,
    channels: uking.channels.map(({ zone: _zone, ...entry }) => (
      entry.id === "main-red" ? { ...entry, name: "Edited red" } : entry
    )),
  };
  const upgraded = normalizeDmxDeviceSettings({
    profiles: [persistedBeforeZones],
  }).profiles[0];
  assert.deepEqual(
    upgraded.zones.map((entry) => entry.id),
    ["spot-rgb", "spot-white", "outer-ring"],
  );
  assert.equal(upgraded.channels.find((entry) => entry.id === "main-red").zone, "spot-rgb");
  assert.equal(upgraded.channels.find((entry) => entry.id === "main-red").name, "Edited red");

  const normalized = normalizeDmxDeviceSettings({
    profiles: [{
      id: "pixels",
      name: "Two pixels",
      sampleResolution: { width: 2, height: 1 },
      channels: [
        { id: "left-red", role: "red", sampleCell: { x: 0, y: 0 } },
        { id: "right-blue", role: "blue", sampleCell: { x: 1, y: 0 } },
      ],
    }],
    fixtures: [{ id: "fixture-a", profileId: "pixels", startChannel: 10 }],
  });
  assert.deepEqual(normalized.profiles[0].sampleResolution, { width: 2, height: 1 });
  assert.equal(normalized.fixtures[0].startChannel, 10);
});

test("shared GPU targets expose pixel readback required by canvas probes", () => {
  let reads = 0;
  const pixels = new Uint8Array([255, 64, 32, 255]);
  const target = new SharedFramebufferTarget({
    width: 1,
    height: 1,
    pixels,
    renderer: { GL: null },
    loadPixels() {
      reads += 1;
    },
  });
  target.loadPixels();
  assert.equal(reads, 1);
  assert.equal(target.pixels, pixels);
});

test("DMX Probe exposes only the selected fixture profile channels", () => {
  const fixture = createDmxFixture("dmx-rgb", 0);
  fixture.id = "rgb-a";
  const state = {
    devices: {
      dmx: {
        enabled: true,
        profiles: normalizeDmxDeviceSettings().profiles,
        fixtures: [fixture],
      },
    },
  };
  const component = dmxProbeComponentForState(DmxProbe, state, {
    params: { fixtureId: "rgb-a" },
  });
  assert.deepEqual(
    component.params.slice(0, 4).map((entry) => entry.id),
    [
      "fixtureId",
      dmxFixtureChannelParameterId("red"),
      dmxFixtureChannelParameterId("green"),
      dmxFixtureChannelParameterId("blue"),
    ],
  );
  assert.equal(component.params.some((entry) => entry.id === "dmx_white"), false);

  const ukingFixture = createDmxFixture("dmx-uking-zq01003-11ch", 0);
  ukingFixture.id = "uking-a";
  const ukingComponent = dmxProbeComponentForState(DmxProbe, {
    devices: {
      dmx: {
        enabled: true,
        profiles: normalizeDmxDeviceSettings().profiles,
        fixtures: [ukingFixture],
      },
    },
  }, {
    params: { fixtureId: "uking-a", zone: "spot-rgb" },
  });
  const zone = ukingComponent.params.find((entry) => entry.id === "zone");
  assert.deepEqual(zone.values, ["all", "spot-rgb", "spot-white", "outer-ring"]);
  assert.equal(zone.optionLabels.get("spot-white"), "Spot white");
});

test("DMX Probe maps a fixture-defined sample grid or authored control values", () => {
  const profile = normalizeDmxDeviceSettings({
    profiles: [{
      id: "split",
      sampleResolution: { width: 2, height: 1 },
      channels: [
        { id: "left", role: "red", sampleFeature: "r", sampleCell: { x: 0, y: 0 } },
        { id: "right", role: "blue", sampleFeature: "b", sampleCell: { x: 1, y: 0 } },
      ],
    }],
  }).profiles[0];
  const samples = [{ r: 0.2, b: 0.1 }, { r: 0.4, b: 0.8 }];
  assert.deepEqual(dmxProbeFixtureValues({ params: { mode: "canvas" } }, profile, samples), {
    left: 0.2,
    right: 0.8,
  });
  assert.deepEqual(dmxProbeFixtureValues({
    params: {
      mode: "control",
      [dmxFixtureChannelParameterId("left")]: 0.6,
      [dmxFixtureChannelParameterId("right")]: 0.7,
    },
  }, profile, samples), {
    left: 0.6,
    right: 0.7,
  });
});

test("fixture frames patch at their one-based start channel and report overlap", () => {
  const settings = normalizeDmxDeviceSettings({
    profiles: [{
      id: "rgb",
      channels: [
        { id: "red", role: "red" },
        { id: "green", role: "green" },
        { id: "blue", role: "blue" },
      ],
    }],
    fixtures: [
      { id: "a", name: "A", profileId: "rgb", startChannel: 4 },
      { id: "b", name: "B", profileId: "rgb", startChannel: 6 },
    ],
  });
  const frame = new Uint8Array(8);
  writeDmxFixtureValues(frame, settings.fixtures[0], settings.profiles[0], {
    red: 1,
    green: 0.5,
    blue: 0,
  });
  assert.deepEqual([...frame], [0, 0, 0, 255, 128, 0, 0, 0]);
  assert.deepEqual(dmxPatchWarnings(settings), ["B overlaps A at channel 6."]);
});

test("global DMX service sends a retained raw serial frame with start code and steady timer", async () => {
  const writes = [];
  const signals = [];
  const intervals = [];
  const writer = {
    async write(payload) {
      writes.push([...payload]);
    },
    releaseLock() {},
  };
  const port = {
    async open(options) {
      assert.deepEqual(options, {
        baudRate: 250000,
        dataBits: 8,
        stopBits: 2,
        parity: "none",
        flowControl: "none",
        bufferSize: 1024,
      });
    },
    writable: { getWriter: () => writer },
    async setSignals(value) {
      signals.push(value);
    },
    getInfo: () => ({ usbVendorId: 1, usbProductId: 2 }),
    async close() {},
  };
  const navigatorRef = {
    serial: {
      addEventListener() {},
      removeEventListener() {},
      requestPort: async () => port,
      getPorts: async () => [],
    },
  };
  let now = 0;
  const service = createDmxOutputService({
    navigatorRef,
    storage: { getItem: () => null, setItem() {} },
    clock: () => now,
    setIntervalFn(callback, interval) {
      intervals.push({ callback, interval });
      return intervals.length;
    },
    clearIntervalFn() {},
  });
  const base = normalizeDmxDeviceSettings();
  service.syncState({
    devices: {
      dmx: {
        enabled: true,
        refreshRate: 40,
        profiles: base.profiles,
        fixtures: [{
          id: "rgb-a",
          name: "RGB",
          profileId: "dmx-rgb",
          startChannel: 3,
          enabled: true,
        }],
      },
    },
    global: { blackout: false },
  });
  assert.equal(await service.connect(), true);
  assert.equal(intervals[0].interval, 25);
  service.receiveProbe({
    fixtureId: "rgb-a",
    values: { red: 1, green: 0.5, blue: 0.25 },
  });
  now = 25;
  await service.sendFrame();
  assert.deepEqual(writes.at(-1), [0, 0, 0, 255, 128, 64]);
  assert.deepEqual(signals.slice(-2), [{ break: true }, { break: false }]);
  assert.equal(service.snapshot().universeLength, 5);
  await service.disconnect();
});

test("DMX proposals merge by channel while Output overrides conflicting Preview channels", async () => {
  const writes = [];
  const writer = { async write(payload) { writes.push([...payload]); }, releaseLock() {} };
  const port = {
    async open() {},
    writable: { getWriter: () => writer },
    async setSignals() {},
    getInfo: () => ({}),
    async close() {},
  };
  const service = createDmxOutputService({
    navigatorRef: {
      serial: {
        addEventListener() {},
        removeEventListener() {},
        requestPort: async () => port,
        getPorts: async () => [],
      },
    },
    storage: { getItem: () => null, setItem() {} },
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });
  const base = normalizeDmxDeviceSettings();
  service.syncState({
    devices: { dmx: {
      enabled: true,
      profiles: base.profiles,
      fixtures: [{ id: "rgb-a", profileId: "dmx-rgb", startChannel: 1, enabled: true }],
    } },
  });
  await service.connect();
  service.receiveProbe({
    fixtureId: "rgb-a",
    values: { red: 0.25, green: 0.5 },
    source: { rendererId: "preview", mode: "preview", probeId: "preview-probe" },
  });
  service.receiveProbe({
    fixtureId: "rgb-a",
    values: { red: 1, blue: 0.75 },
    source: { rendererId: "output", mode: "output", probeId: "output-probe" },
  });
  await service.sendFrame();
  assert.deepEqual(writes.at(-1), [0, 255, 128, 191]);

  service.releaseProbeSources({ rendererId: "output" });
  await service.sendFrame();
  assert.deepEqual(writes.at(-1), [0, 64, 128, 0]);
  await service.disconnect();
});

test("DMX Probe releases a proposal when its renderer no longer visits that active probe", () => {
  const messages = [];
  const settings = normalizeDmxDeviceSettings();
  const fixture = createDmxFixture("dmx-rgb", 0);
  fixture.id = "rgb-a";
  const runtime = new ProbeRuntime({
    mode: "output",
    outputId: "main",
    dmxRendererId: "output:main",
    state: { devices: { dmx: { enabled: true, profiles: settings.profiles, fixtures: [fixture] } } },
    sendDmxFixture: (payload) => messages.push(payload),
  });
  const component = { id: "component-a" };
  const renderedItem = {
    id: "probe-a",
    params: {
      fixtureId: "rgb-a",
      mode: "control",
      dmx_red: 0.8,
      dmx_green: 0.2,
      dmx_blue: 0.1,
    },
  };

  runtime.beginFrame();
  assert.equal(runtime.observeDmx(component, {}, renderedItem, {}, {}), true);
  runtime.endFrame();
  assert.equal(messages[0].source.mode, "output");
  assert.equal(messages[0].release, undefined);

  runtime.beginFrame();
  runtime.endFrame();
  assert.equal(messages.at(-1).release, true);
  assert.equal(messages.at(-1).fixtureId, "rgb-a");
  runtime.dispose();
});

test("DMX Probe lowers through the visual compiler as a passthrough hardware observer", () => {
  const packageRoot = createVj1NodePackage();
  let state = createInitialState();
  const component = state.components.find((entry) => entry.type !== "scene");
  component.chain.push(createComponentEffect("dmxProbe", {
    fixtureId: "fixture-a",
    mode: "control",
  }));
  state = packageRoot.prepareProjectState(state);
  const program = compileComponentRenderPrograms(
    state.components,
    state.nodes.groups,
    {
      resolveNodeDefinition: (node) =>
        packageRoot.registry.get(node.nodeId, node.nodeVersion),
    },
  ).get(component.id);
  const operation = program.plan.operations.find(({ backend }) => backend === "dmx-probe-observer");
  assert.equal(operation.opcode, "probe");
  assert.equal(operation.configuration.params.fixtureId, "fixture-a");
  assert.equal(operation.configuration.params.mode, "control");
});

test("fixture-specific DMX controls survive graph-authoritative project persistence", () => {
  const packageRoot = createVj1NodePackage();
  let state = createInitialState();
  const fixture = createDmxFixture("dmx-rgb", 0);
  fixture.id = "rgb-a";
  state.devices.dmx.fixtures = [fixture];
  const component = state.components.find((entry) => entry.type !== "scene");
  const redParameterId = dmxFixtureChannelParameterId("red");
  const probe = createComponentEffect("dmxProbe", {
    fixtureId: fixture.id,
    mode: "control",
    [redParameterId]: 0.73,
  });
  component.chain.push(probe);
  state = packageRoot.prepareProjectState(state);
  state.nodes = addParameterAnimationTrack(state.nodes, {
    componentId: component.id,
    targetNodeId: probe.id,
    parameterId: redParameterId,
    sourceKind: "timeline",
    baseValue: 0.73,
    targetRange: [0, 1],
    from: 0,
    to: 1,
  });

  const payload = JSON.parse(JSON.stringify(buildProjectPayload(
    state,
    "2026-07-27T00:00:00.000Z",
  )));
  const restored = packageRoot.prepareProjectState(sanitizeState(payload));
  const restoredComponent = restored.components.find((entry) => entry.id === component.id);
  const restoredProbe = componentChainProjection(restored, restoredComponent)
    .find((entry) => entry.id === probe.id);
  assert.equal(restoredProbe.params.fixtureId, fixture.id);
  assert.equal(restoredProbe.params[redParameterId], 0.73);
  assert.equal(restored.devices.dmx.fixtures[0].profileId, "dmx-rgb");
  assert.ok(
    restored.nodes.groups
      .find((entry) => entry.componentId === component.id)
      .nodes.some((entry) => entry.animationTrack?.parameterId === redParameterId),
  );
});
