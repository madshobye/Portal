import test from "node:test";
import assert from "node:assert/strict";
import {
  createAkaiMidiMixProfile,
  midiAnimationSources,
} from "../js/libraries/control-engine/midi-input-profile/index.js";
import {
  activeMidiLiveTargetId,
  bankAssignments,
  createMidiInputService,
  sortMidiTargets,
} from "../js/services/midi-input-service.js";
import { dominantAccentFromPixels } from "../js/services/thumbnail-accent-color.js";

function projectState(components = []) {
  return {
    inputs: { midi: { profiles: [createAkaiMidiMixProfile()] } },
    components,
    ui: { live: { selectedSceneId: "", selectedComponentId: "" } },
  };
}

test("MIDImix exposes named general animation controls and button triggers", () => {
  const inputs = projectState().inputs;
  const sources = midiAnimationSources(inputs);
  const triggers = midiAnimationSources(inputs, { triggers: true });
  assert.equal(sources.length, 49);
  assert.equal(triggers.length, 16);
  assert.ok(sources.some((source) =>
    source.label === "Akai MIDImix · Fader 1" &&
    source.address === "profile:midi-akai-midimix/fader/1"
  ));
  assert.ok(triggers.some((source) => source.label === "Akai MIDImix · Scene button 1 pressed"));
});

test("MIDImix banks use the same marker and active ordering as the Live catalog", () => {
  const items = [
    { id: "recent", name: "Recent", catalogMarker: 0, activity: { updatedAt: "2026-01-03" } },
    { id: "old", name: "Old", catalogMarker: 0, activity: { updatedAt: "2026-01-01" } },
    { id: "star", name: "Star", catalogMarker: 1, activity: { updatedAt: "2026-01-01" } },
    { id: "heart", name: "Heart", catalogMarker: 2, activity: { updatedAt: "2026-01-01" } },
    { id: "pin", name: "Pin", catalogMarker: 3, activity: { updatedAt: "2026-01-01" } },
  ];
  assert.deepEqual(sortMidiTargets(items).map((item) => item.id), [
    "pin", "recent", "heart", "old", "star",
  ]);
  assert.deepEqual(sortMidiTargets(items, "marker").map((item) => item.id), [
    "pin", "heart", "star", "recent", "old",
  ]);
  const state = projectState(items.map((item) => ({ ...item, type: "chain" })));
  state.ui.catalogSortModes = { live: "marker" };
  const assignments = bankAssignments(state);
  assert.equal(assignments.components[0].id, "pin");
  assert.equal(assignments.components[4].id, "old");
  assert.equal("marker" in assignments.components[0], false);
});

test("general MIDI service drives Live banks, semantic signals, paging, and LEDs", async () => {
  const input = {
    id: "input-a",
    name: "MIDI Mix",
    manufacturer: "Akai",
    state: "connected",
    onmidimessage: null,
    open: () => Promise.resolve(),
  };
  const sent = [];
  let outputOpenCalls = 0;
  const output = {
    id: "output-a",
    name: "MIDI Mix",
    manufacturer: "Akai",
    state: "connected",
    open: () => {
      outputOpenCalls++;
      return Promise.resolve();
    },
    send: (message) => sent.push(message),
  };
  const access = {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null,
  };
  const signals = [];
  const scenes = [];
  const components = [];
  const adjustedParameters = [];
  const scheduled = [];
  const service = createMidiInputService({
    requestAccess: async () => access,
    onSignal: (payload) => signals.push(payload),
    onSelectScene: (id) => scenes.push(id),
    onSelectComponent: (id) => components.push(id),
    resolveSignificantParameters: () => [{
      id: "component-1:chain.0.opacity",
      name: "Component 1 · Opacity",
      componentId: "component-1",
      itemId: "source-1",
      path: "chain.0.opacity",
      min: 0,
      max: 1,
    }],
    onAdjustSignificantParameter: (payload) => adjustedParameters.push(payload),
    schedule: (callback, delay) => delay === 0 ? scheduled.push(callback) : callback(),
  });
  const state = projectState([
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `scene-${index + 1}`,
      name: `Scene ${index + 1}`,
      type: "scene",
      activity: { updatedAt: `2026-01-${String(9 - index).padStart(2, "0")}` },
    })),
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `component-${index + 1}`,
      name: `Component ${index + 1}`,
      type: "chain",
      activity: { updatedAt: `2026-01-${String(9 - index).padStart(2, "0")}` },
    })),
  ]);
  service.syncState(state);
  await service.connect();
  await Promise.resolve();
  assert.equal(outputOpenCalls, 1);
  assert.equal(service.snapshot().feedbackOutputCount, 1);
  assert.equal(service.testLeds(), true);
  assert.ok(sent.some(([, , value]) => value === 127));

  input.onmidimessage({ data: new Uint8Array([0xb0, 19, 64]), receivedTime: 12 });
  assert.equal(signals.at(-1).values["profile:midi-akai-midimix/fader/1"], 64 / 127);
  input.onmidimessage({ data: new Uint8Array([0xb0, 18, 32]), receivedTime: 12.5 });
  assert.equal(adjustedParameters.at(-1).assignment.path, "chain.0.opacity");
  assert.equal(adjustedParameters.at(-1).unitValue, 32 / 127);
  input.onmidimessage({ data: new Uint8Array([0x90, 1, 127]), receivedTime: 13 });
  input.onmidimessage({ data: new Uint8Array([0x90, 3, 127]), receivedTime: 14 });
  assert.deepEqual(scenes, ["scene-1"]);
  assert.deepEqual(components, ["component-1"]);
  service.syncState({
    ...state,
    ui: { live: { selectedSceneId: "scene-1", selectedComponentId: "component-1" } },
  });
  const sendsBeforeRelease = sent.length;
  input.onmidimessage({ data: new Uint8Array([0x80, 3, 0]), receivedTime: 14.5 });
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.ok(sent.length > sendsBeforeRelease);
  assert.ok(sent.slice(sendsBeforeRelease).some(([, note, value]) => note === 3 && value === 127));
  assert.ok(sent.slice(sendsBeforeRelease).some(([, note, value]) => note === 1 && value === 0));

  input.onmidimessage({ data: new Uint8Array([0x90, 26, 127]), receivedTime: 15 });
  input.onmidimessage({ data: new Uint8Array([0x90, 1, 127]), receivedTime: 16 });
  assert.equal(service.snapshot().page, 1);
  assert.deepEqual(scenes, ["scene-1", "scene-9"]);

  service.syncState({
    ...state,
    ui: { live: { selectedSceneId: "scene-9", selectedComponentId: "component-9" } },
  });
  assert.ok(sent.some(([status, note, value]) => status === 0x90 && note === 1 && value === 127));
  assert.ok(sent.some(([status, note, value]) => status === 0x90 && note === 3 && value === 127));
  service.syncState({ ...state, inputs: { midi: { profiles: [] } } });
  assert.deepEqual(sent.slice(-16).every(([, , value]) => value === 0), true);
  service.disconnect();
  assert.equal(input.onmidimessage, null);
  assert.equal(service.snapshot().state, "idle");
});

test("MIDImix LEDs follow the active target for Overall and individual outputs", () => {
  const state = projectState();
  state.ui.live = {
    selectedSceneId: "scene-overall",
    selectedComponentId: "scene-overall",
    previewSurfaceId: "__mapping__",
    surfacePatches: {
      "output-1": "component-output",
      "output-2": "scene-output",
    },
  };

  assert.equal(activeMidiLiveTargetId(state), "scene-overall");

  state.ui.live.selectedComponentId = "component-overall";
  assert.equal(activeMidiLiveTargetId(state), "component-overall");

  state.ui.live.previewSurfaceId = "output-1";
  assert.equal(activeMidiLiveTargetId(state), "component-output");

  state.ui.live.previewSurfaceId = "output-2";
  state.ui.live.patchSourceId = "scene-pending";
  assert.equal(activeMidiLiveTargetId(state), "scene-pending");

  state.ui.live.patchSourceId = "";
  assert.equal(activeMidiLiveTargetId(state), "scene-output");

  state.ui.live.previewSurfaceId = "output-3";
  state.ui.live.overallSourceCleared = true;
  assert.equal(activeMidiLiveTargetId(state), "");
});

test("a saved MIDI profile reconnects automatically only with existing permission", async () => {
  let requestCount = 0;
  const access = {
    inputs: new Map(),
    outputs: new Map(),
    onstatechange: null,
  };
  const service = createMidiInputService({
    queryPermission: async () => "granted",
    requestAccess: async () => {
      requestCount++;
      return access;
    },
  });

  service.syncState(projectState());
  await service.autoConnect();
  assert.equal(requestCount, 1);
  assert.equal(service.snapshot().state, "ready");

  const promptService = createMidiInputService({
    queryPermission: async () => "prompt",
    requestAccess: async () => {
      requestCount++;
      return access;
    },
  });
  promptService.syncState(projectState());
  await promptService.autoConnect();
  assert.equal(requestCount, 1);
  assert.equal(promptService.snapshot().state, "idle");
});

test("thumbnail accent helper favors saturated visible pixels", () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 0, 0, 255,
    128, 128, 128, 255,
    0, 0, 0, 255,
  ]);
  assert.equal(dominantAccentFromPixels(pixels), "#ff0000");
});
