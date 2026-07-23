import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const OscillatorControlNode = defineNode({
  id: "core.control.oscillator",
  name: "Oscillator",
  version: "0.1.0",
  description: "Produces reusable normalized and bipolar periodic modulation from an input time signal.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { time: { type: "number", required: true } },
  parameters: {
    waveform: {
      type: { type: "enum", values: ["sine", "triangle", "saw", "square"] },
      defaultValue: "sine",
      editor: { type: "select" },
    },
    frequency: { type: "number", defaultValue: 1, allowedRange: [-100, 100], editor: { type: "number" } },
    phase: { type: "number", defaultValue: 0, editor: { type: "number" } },
  },
  outlets: {
    value: { type: "number", expectedRange: [0, 1] },
    bipolar: { type: "number", expectedRange: [-1, 1] },
  },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["motion", "numeric-control", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph", "motion"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "value" },
  parts: [{
    id: "oscillator-process",
    name: "Oscillator process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "oscillatorControlProcess",
    source: oscillatorControlProcess.toString(),
  }],
  process: oscillatorControlProcess,
});

export function oscillatorControlProcess(
  { time = 0, waveform = "sine", frequency = 1, phase = 0 } = {},
  { output = {} } = {},
) {
  const cycle = Number(time) * Number(frequency) + Number(phase);
  const fraction = cycle - Math.floor(cycle);
  let bipolar;
  if (waveform === "triangle") bipolar = 1 - 4 * Math.abs(fraction - 0.5);
  else if (waveform === "saw") bipolar = fraction * 2 - 1;
  else if (waveform === "square") bipolar = fraction < 0.5 ? 1 : -1;
  else bipolar = Math.sin(cycle * Math.PI * 2);
  output.value = bipolar * 0.5 + 0.5;
  output.bipolar = bipolar;
  return output;
}
