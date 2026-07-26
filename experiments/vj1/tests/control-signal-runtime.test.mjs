import test from "node:test";
import assert from "node:assert/strict";

import {
  ControlSignalRuntime,
  decodeMidiMessage,
  decodeOscPacket,
  decodeOscPayload,
} from "../js/output/control-signal-runtime.js";

test("Application control signals retain explicit event sequences without external resources", () => {
  const invalidations = [];
  const runtime = new ControlSignalRuntime({
    onInvalidate: (reason) => invalidations.push(reason),
    clock: () => 1234,
  });
  assert.equal(runtime.status("control", "animation:test").state, "ready");
  assert.equal(runtime.resolve("control", "animation:test"), undefined);
  const unrelatedBefore = runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "control",
    address: "animation:other",
  }]);
  assert.equal(runtime.publish("control", "animation:test", 1, {
    sequence: 41,
    timestamp: 1200,
  }), true);
  assert.deepEqual(runtime.resolve("control", "animation:test"), {
    value: 1,
    sequence: 41,
    timestamp: 1200,
  });
  assert.match(runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "control",
    address: "animation:test",
  }]), /animation:test:0\.41/);
  assert.equal(runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "control",
    address: "animation:other",
  }]), unrelatedBefore);
  assert.deepEqual(invalidations, ["control-signal"]);
  runtime.dispose();
});

function midiInput(id = "device-a") {
  return {
    id,
    state: "connected",
    onmidimessage: null,
    openCalls: 0,
    closeCalls: 0,
    open() {
      this.openCalls++;
      return Promise.resolve();
    },
    close() {
      this.closeCalls++;
      return Promise.resolve();
    },
  };
}

function audioFixture(deviceId = "microphone-a") {
  const track = {
    id: deviceId,
    readyState: "live",
    onended: null,
    stopCalls: 0,
    getSettings: () => ({ deviceId }),
    stop() {
      this.stopCalls++;
      this.readyState = "ended";
    },
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  const analyser = {
    fftSize: 32,
    frequencyBinCount: 16,
    smoothingTimeConstant: 0,
    disconnected: false,
    getByteTimeDomainData(target) {
      target.fill(128);
      target[0] = 255;
      target[1] = 0;
    },
    getByteFrequencyData(target) {
      for (let index = 0; index < target.length; index++) {
        target[index] = Math.min(255, 32 + index * 8);
      }
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  const source = {
    connected: null,
    disconnected: false,
    connect(target) {
      this.connected = target;
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  const context = {
    state: "suspended",
    sampleRate: 48000,
    resumeCalls: 0,
    closeCalls: 0,
    async resume() {
      this.resumeCalls++;
      this.state = "running";
    },
    createAnalyser: () => analyser,
    createMediaStreamSource: () => source,
    close() {
      this.closeCalls++;
      this.state = "closed";
      return Promise.resolve();
    },
  };
  return { track, stream, analyser, source, context };
}

function oscMessage(address, typeTags, values) {
  const chunks = [oscString(address), oscString(`,${typeTags}`)];
  for (let index = 0; index < typeTags.length; index++) {
    const type = typeTags[index];
    const value = values[index];
    if (type === "f") {
      const bytes = Buffer.alloc(4);
      bytes.writeFloatBE(value);
      chunks.push(bytes);
    } else if (type === "i") {
      const bytes = Buffer.alloc(4);
      bytes.writeInt32BE(value);
      chunks.push(bytes);
    } else if (type === "s") {
      chunks.push(oscString(value));
    }
  }
  const bytes = Buffer.concat(chunks);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function oscString(value) {
  const source = Buffer.from(String(value), "utf8");
  const length = Math.ceil((source.length + 1) / 4) * 4;
  const bytes = Buffer.alloc(length);
  source.copy(bytes);
  return bytes;
}

test("MIDI adapter requests permission lazily and retains normalized device signals", async () => {
  const input = midiInput();
  const access = {
    inputs: new Map([[input.id, input]]),
    onstatechange: null,
  };
  const invalidations = [];
  let accessRequests = 0;
  const runtime = new ControlSignalRuntime({
    requestMidiAccess: async () => {
      accessRequests++;
      return access;
    },
    onInvalidate: (reason) => invalidations.push(reason),
  });

  assert.equal(accessRequests, 0);
  const idleRevision = runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "midi",
    address: "1:cc:7",
  }]);
  assert.equal(runtime.resolve("midi", "1:cc:7"), undefined);
  await runtime.whenReady("midi");
  assert.equal(accessRequests, 1);
  assert.equal(input.openCalls, 1);
  assert.equal(typeof input.onmidimessage, "function");
  const readyRevision = runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "midi",
    address: "1:cc:7",
  }]);
  assert.notEqual(readyRevision, idleRevision);

  input.onmidimessage({
    data: new Uint8Array([0xb0, 7, 64]),
    receivedTime: 12,
  });
  const signal = runtime.resolve("midi", "1:cc:7");
  assert.equal(signal.value, 64 / 127);
  assert.equal(signal.sequence, 1);
  assert.equal(signal.timestamp, 12);
  assert.deepEqual(runtime.resolve("midi", `${input.id}/1:cc:7`), signal);
  assert.notEqual(runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "midi",
    address: "1:cc:7",
  }]), readyRevision);

  input.onmidimessage({
    data: new Uint8Array([0xb0, 7, 127]),
    receivedTime: 20,
  });
  assert.strictEqual(runtime.resolve("midi", "1:cc:7"), signal);
  assert.deepEqual(signal, { value: 1, sequence: 2, timestamp: 20 });
  assert.equal(invalidations.includes("midi-signal"), true);

  runtime.dispose();
  assert.equal(input.onmidimessage, null);
  assert.equal(input.closeCalls > 0, true);
});

test("MIDI adapter reconciles device reconnects without replacing the host runtime", async () => {
  const first = midiInput("first");
  const inputs = new Map([[first.id, first]]);
  const access = { inputs, onstatechange: null };
  const runtime = new ControlSignalRuntime({
    requestMidiAccess: () => Promise.resolve(access),
  });

  runtime.resolve("midi", "1:note:60");
  await runtime.whenReady("midi");
  const second = midiInput("second");
  inputs.delete(first.id);
  first.state = "disconnected";
  inputs.set(second.id, second);
  access.onstatechange();

  assert.equal(first.onmidimessage, null);
  assert.equal(second.openCalls, 1);
  second.onmidimessage({
    data: new Uint8Array([0x90, 60, 100]),
    receivedTime: 30,
  });
  assert.equal(runtime.resolve("midi", "1:note:60").value, 100 / 127);
  assert.equal(runtime.resolve("midi", "second/1:note:60").sequence, 1);
  runtime.dispose();
});

test("MIDI decoding exposes stable channel addresses and normalized values", () => {
  assert.deepEqual(decodeMidiMessage(new Uint8Array([0xb2, 12, 127])), {
    address: "3:cc:12",
    value: 1,
  });
  assert.deepEqual(decodeMidiMessage(new Uint8Array([0x81, 48, 90])), {
    address: "2:note:48",
    value: 0,
  });
  assert.deepEqual(decodeMidiMessage(new Uint8Array([0xe0, 0, 64])), {
    address: "1:pitch",
    value: 8192 / 16383,
  });
  assert.equal(decodeMidiMessage(new Uint8Array([0xf8])), null);
});

test("audio analysis owns lazy permission retained features device identity and reconnect", async () => {
  const first = audioFixture("microphone-a");
  const second = audioFixture("microphone-b");
  const fixtures = [first, second];
  const invalidations = [];
  const deviceListeners = new Map();
  let streamRequests = 0;
  let contextIndex = 0;
  let clock = 100;
  const runtime = new ControlSignalRuntime({
    requestAudioStream: async () => fixtures[streamRequests++].stream,
    createAudioContext: () => fixtures[contextIndex++].context,
    audioMediaDevices: {
      addEventListener: (type, listener) => deviceListeners.set(type, listener),
      removeEventListener: (type, listener) => {
        if (deviceListeners.get(type) === listener) deviceListeners.delete(type);
      },
    },
    onInvalidate: (reason) => invalidations.push(reason),
    clock: () => clock,
  });

  assert.equal(streamRequests, 0);
  assert.equal(runtime.resolve("audio", "level"), undefined);
  await runtime.whenReady("audio");
  assert.equal(streamRequests, 1);
  assert.equal(first.context.resumeCalls, 1);
  assert.strictEqual(first.source.connected, first.analyser);
  assert.equal(runtime.status("audio", "level").state, "ready");
  assert.equal(runtime.status("audio", "level").signalAvailable, false);

  const before = runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "audio",
    address: "level",
  }]);
  runtime.resolve("audio", "bin:2");
  runtime.beginFrame();
  const level = runtime.resolve("audio", "level");
  const peak = runtime.resolve("audio", "peak");
  assert.ok(level.value > 0 && level.value < 1);
  assert.ok(peak.value > 0.99);
  assert.equal(level.sequence, 1);
  assert.equal(level.timestamp, 100);
  assert.equal(runtime.resolve("audio", "bin:2").value, (32 + 2 * 8) / 255);
  assert.deepEqual(
    runtime.resolve("audio", "microphone-a/level"),
    level,
  );
  assert.notEqual(runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "audio",
    address: "level",
  }]), before);
  assert.equal(invalidations.includes("audio-ready"), true);

  const ended = first.track.onended;
  clock = 200;
  first.track.readyState = "ended";
  ended();
  await runtime.whenReady("audio");
  assert.equal(streamRequests, 2);
  assert.equal(first.track.stopCalls > 0, true);
  assert.equal(first.context.closeCalls, 1);
  assert.equal(runtime.status("audio").deviceId, "microphone-b");

  runtime.dispose();
  assert.equal(second.track.stopCalls, 1);
  assert.equal(second.context.closeCalls, 1);
  assert.equal(deviceListeners.size, 0);
});

test("OSC adapter owns endpoint-scoped WebSockets retained messages reconnect and disposal", async () => {
  const sockets = [];
  const scheduled = new Map();
  const cancelled = [];
  let nextTimer = 1;
  let clock = 100;
  const invalidations = [];
  const runtime = new ControlSignalRuntime({
    createWebSocket: (endpoint) => {
      const socket = {
        endpoint,
        binaryType: "",
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        closeCalls: [],
        close(...args) {
          this.closeCalls.push(args);
        },
      };
      sockets.push(socket);
      return socket;
    },
    schedule: (callback, delay) => {
      const id = nextTimer++;
      scheduled.set(id, { callback, delay });
      return id;
    },
    cancelSchedule: (id) => {
      cancelled.push(id);
      scheduled.delete(id);
    },
    onInvalidate: (reason) => invalidations.push(reason),
    clock: () => clock,
  });
  const endpoint = "ws://osc.example/control";

  assert.equal(runtime.resolve("osc", "/fader"), undefined);
  assert.equal(sockets.length, 0, "an unconfigured OSC node opens no transport");
  assert.equal(runtime.resolve("osc", "/fader", { endpoint }), undefined);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].binaryType, "arraybuffer");
  assert.equal(runtime.status("osc", "/fader", { endpoint }).state, "connecting");

  sockets[0].onopen();
  assert.equal(runtime.status("osc", "/fader", { endpoint }).state, "ready");
  sockets[0].onmessage({
    data: JSON.stringify({ address: "/fader", args: [{ type: "f", value: 0.75 }] }),
  });
  await Promise.resolve();
  await Promise.resolve();
  const signal = runtime.resolve("osc", "/fader", { endpoint });
  assert.deepEqual(signal, { value: 0.75, sequence: 1, timestamp: 100 });
  assert.equal(invalidations.includes("osc-signal"), true);
  const revision = runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "osc",
    endpoint,
    address: "/fader",
  }]);

  sockets[0].onmessage({
    data: oscMessage("/fader", "fi", [0.5, 7]),
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(runtime.resolve("osc", "/fader", { endpoint }).value, [
    0.5,
    7,
  ]);
  assert.notEqual(runtime.revisionFor([{
    kind: "control-signal",
    signalKind: "osc",
    endpoint,
    address: "/fader",
  }]), revision);

  sockets[0].onclose({ code: 1006, reason: "network" });
  assert.equal(runtime.status("osc", "/fader", { endpoint }).state, "error");
  assert.equal(scheduled.size, 1);
  const [timerId, retry] = [...scheduled.entries()][0];
  assert.equal(retry.delay, 3000);
  scheduled.delete(timerId);
  clock += 3000;
  retry.callback();
  assert.equal(sockets.length, 2);

  runtime.dispose();
  assert.deepEqual(sockets[1].closeCalls, [[1000, "VJ1 control runtime disposed"]]);
  assert.deepEqual(cancelled, []);
});

test("OSC decoding validates JSON and standard binary messages", async () => {
  assert.deepEqual(await decodeOscPayload(JSON.stringify({
    address: "/scene/opacity",
    args: [{ type: "f", value: 0.4 }],
  })), [{ address: "/scene/opacity", value: 0.4 }]);
  const decoded = decodeOscPacket(
    oscMessage("/scene/value", "fis", [0.25, 9, "go"]),
  );
  assert.equal(decoded[0].address, "/scene/value");
  assert.ok(Math.abs(decoded[0].value[0] - 0.25) < 1e-7);
  assert.deepEqual(decoded[0].value.slice(1), [9, "go"]);
  await assert.rejects(
    () => decodeOscPayload(JSON.stringify({ address: "not-an-osc-address", value: 1 })),
    /OSC address is invalid/,
  );
});
