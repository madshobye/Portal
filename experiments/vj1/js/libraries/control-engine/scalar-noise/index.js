import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const ScalarNoiseControlNode = defineNode({
  id: "core.control.scalar-noise",
  name: "Scalar Noise",
  version: "0.1.0",
  description: "Produces bounded deterministic smooth scalar noise from component time.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { time: { type: "number", required: true } },
  parameters: {
    rate: { type: "number", defaultValue: 1, allowedRange: [0.01, 120], clamp: true },
    seed: { type: "number", defaultValue: 1 },
    detail: { type: "number", defaultValue: 2, allowedRange: [1, 4], clamp: true },
    roughness: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    value: { type: "number", expectedRange: [0, 1] },
    bipolar: { type: "number", expectedRange: [-1, 1] },
  },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["motion", "noise", "numeric-control", "graph-placeable", "live-fast-path"],
  presentation: {
    catalogs: ["controls", "graph", "motion"],
    placeableOn: ["control-canvas", "node-graph"],
    previewOutput: "value",
  },
  parts: [{
    id: "scalar-noise-process",
    name: "Scalar noise process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "scalarNoiseControlProcess",
    source: [
      scalarNoiseControlProcess,
      scalarValueNoise,
      scalarNoiseHash,
    ].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: scalarNoiseControlProcess,
});

export function scalarNoiseControlProcess(
  { time = 0, rate = 1, seed = 1, detail = 2, roughness = 0.5 } = {},
  { output = {} } = {},
) {
  const x = Math.max(0, Number(time) || 0) * Math.max(0.01, Number(rate) || 1);
  const octaves = Math.max(1, Math.min(4, Math.round(Number(detail) || 1)));
  const persistence = Math.max(0, Math.min(1, Number(roughness) || 0));
  let frequency = 1;
  let amplitude = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < 4; octave++) {
    if (octave >= octaves) break;
    total += scalarValueNoise(x * frequency, Number(seed) + octave * 1013) * amplitude;
    weight += amplitude;
    frequency *= 2;
    amplitude *= persistence;
  }
  output.value = weight > 0 ? total / weight : 0.5;
  output.bipolar = output.value * 2 - 1;
  return output;
}

export function scalarValueNoise(position = 0, seed = 1) {
  const left = Math.floor(position);
  const fraction = position - left;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  const a = scalarNoiseHash(left, seed);
  const b = scalarNoiseHash(left + 1, seed);
  return a + (b - a) * smooth;
}

export function scalarNoiseHash(index = 0, seed = 1) {
  let value = (Math.trunc(Number(index) || 0) ^ Math.trunc(Number(seed) || 1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}
