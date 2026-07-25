import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const MidiControlInputNode = hostSignalNode({
  id: "core.control.midi-input",
  name: "MIDI Input",
  kind: "midi",
  address: "1:cc:1",
  description: "Reads a normalized MIDI value from the host control-signal adapter.",
  capabilities: ["midi-control"],
});

export const OscControlInputNode = hostSignalNode({
  id: "core.control.osc-input",
  name: "OSC Input",
  kind: "osc",
  address: "/vj1/value",
  endpoint: "",
  description: "Reads an OSC address from the host control-signal adapter.",
  capabilities: ["osc-control"],
});

export const AudioControlInputNode = hostSignalNode({
  id: "core.control.audio-input",
  name: "Audio Control Input",
  kind: "audio",
  address: "level",
  description: "Reads an analyzed audio feature such as level, beat, or a frequency band from the host adapter.",
  capabilities: ["audio-control"],
  frameDynamic: true,
});

export const HostControlInputNode = hostSignalNode({
  id: "core.control.host-input",
  name: "Host Control Input",
  kind: "control",
  address: "value",
  description: "Reads an application-defined value from the common host control-signal adapter.",
  capabilities: ["host-control"],
});

export function hostSignalControlProcess(
  {
    kind = "control",
    address = "value",
    endpoint = "",
    fallback = 0,
  } = {},
  { renderRequest = null, output = {}, state = {} } = {},
) {
  const signal = resolveHostControlSignal(
    renderRequest?.controlSignals,
    String(kind),
    String(address),
    { endpoint: String(endpoint || "") },
  );
  const available = signal !== undefined;
  const record = signal && typeof signal === "object" && !Array.isArray(signal) ? signal : null;
  const value = available ? (record && "value" in record ? record.value : signal) : fallback;
  const sequence = record && Number.isFinite(Number(record.sequence))
    ? Number(record.sequence)
    : state.sequence || 0;
  state.sequence = sequence;
  output.value = value;
  output.number = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  output.event = sequence > 0 ? sequence : null;
  output.available = available;
  return output;
}

export function resolveHostControlSignal(signals, kind, address, options = {}) {
  if (!signals) return undefined;
  if (typeof signals.resolve === "function") {
    return signals.resolve(kind, address, options);
  }
  const bank = signals instanceof Map ? signals.get(kind) : signals[kind];
  if (!bank) return undefined;
  if (bank instanceof Map) return bank.get(address);
  return typeof bank === "object" ? bank[address] : undefined;
}

function hostSignalNode({
  id,
  name,
  kind,
  address,
  description,
  capabilities = [],
  frameDynamic = false,
  endpoint,
}) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.CODE,
    parameters: {
      kind: {
        type: { type: "enum", values: ["midi", "osc", "audio", "control"] },
        defaultValue: kind,
        editor: { type: "select" },
      },
      address: { type: "string", defaultValue: address, editor: { type: "text" } },
      ...(endpoint !== undefined
        ? {
            endpoint: {
              type: "string",
              defaultValue: endpoint,
              editor: { type: "text" },
            },
          }
        : {}),
      fallback: { type: "any", defaultValue: 0, editor: { type: "input" } },
    },
    outlets: {
      value: { type: "any" },
      number: { type: "number" },
      event: { type: "event" },
      available: { type: "boolean" },
    },
    // MIDI, OSC, and application controls advance when their retained host
    // signal revision changes. Audio analysis is the deliberate exception:
    // its adapter produces a continuous feature stream on the frame clock.
    execution: {
      trigger: frameDynamic ? "frame" : "input-change",
      domain: "main",
      stateful: false,
      asynchronous: false,
    },
    capabilities: [...capabilities, "control-signal", "graph-placeable", "live-fast-path"],
    presentation: {
      catalogs: ["controls", "graph"],
      placeableOn: ["control-canvas", "node-graph"],
      previewOutput: "number",
    },
    metadata: {
      controlSignalDependency: {
        kindParameterId: "kind",
        addressParameterId: "address",
        ...(endpoint !== undefined
          ? { endpointParameterId: "endpoint" }
          : {}),
        required: false,
      },
    },
    parts: [{
      id: "host-signal-process",
      name: "Host signal adapter",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "hostSignalControlProcess",
      source: hostSignalControlProcess.toString(),
    }],
    process: hostSignalControlProcess,
  });
}
