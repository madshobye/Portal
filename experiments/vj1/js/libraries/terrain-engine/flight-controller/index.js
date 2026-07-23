import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { valueType } from "../../node-engine/node-types.js";
import { advanceRateClock, advanceSpatialScale } from "../../timing-engine/index.js";

export const TerrainFlightStateType = valueType("terrain-flight-state", {
  contractVersion: 1,
  description: "Phase-continuous flight clock, camera anchor, and terrain sampling transform.",
});

export const TerrainFlightControllerNode = defineNode({
  id: "core.terrain.flight-controller",
  name: "Terrain Flight Controller",
  version: "0.1.0",
  description: "Produces phase-continuous flight and terrain sampling state independently from mesh rendering.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    componentTime: { type: "number", required: true },
    flightSpeed: { type: "number", defaultValue: 0.65 },
    turn: { type: "number", defaultValue: 0 },
    altitude: { type: "number", defaultValue: 2.5 },
    terrainScale: { type: "number", defaultValue: 0.62 },
  },
  outlets: { flight: { type: TerrainFlightStateType } },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["terrain", "timing", "motion", "controller", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "terrain", "motion"], placeableOn: ["node-graph"], previewOutput: "flight" },
  parts: [{
    id: "terrain-flight-controller",
    name: "Terrain flight controller",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "terrainFlightControllerProcess",
    source: [terrainCameraView, updateTerrainFlightState, terrainFlightControllerProcess]
      .map((value) => value.toString()).join("\n\n"),
  }],
  process: terrainFlightControllerProcess,
});

export function terrainFlightControllerProcess(inputs = {}, { state = {}, output = {} } = {}) {
  const clock = advanceRateClock(state.clock, inputs.componentTime, inputs.flightSpeed, state.clock);
  const view = terrainCameraView(inputs, clock.time, state.view);
  const scale = advanceSpatialScale(state.scale, inputs.terrainScale, view.cameraAnchor, state.scale);
  state.clock = clock;
  state.view = view;
  state.scale = scale;
  state.output = updateTerrainFlightState(state.output, clock.time, view, scale);
  output.flight = state.output;
  return output;
}

export function terrainCameraView(params = {}, flightTime = 0, output = null) {
  const turn = Math.max(-1, Math.min(1, Number(params.turn) || 0));
  const yaw = turn * 0.72;
  const view = output || { turn: 0, altitude: 2.5, cameraAnchor: [0, 0] };
  view.turn = turn;
  view.altitude = Math.max(0.2, Number(params.altitude) || 2.5);
  view.cameraAnchor[0] = Math.sin(yaw) * flightTime * 7;
  view.cameraAnchor[1] = Math.cos(yaw) * flightTime * 7;
  return view;
}

function updateTerrainFlightState(output, flightTime, view, scale) {
  const value = output || {
    kind: "terrain-flight-state",
    contractVersion: 1,
    flightTime: 0,
    turn: 0,
    altitude: 2.5,
    cameraAnchor: [0, 0],
    terrainScale: 0.62,
    terrainPhase: [0, 0],
  };
  value.flightTime = flightTime;
  value.turn = view.turn;
  value.altitude = view.altitude;
  value.cameraAnchor[0] = view.cameraAnchor[0];
  value.cameraAnchor[1] = view.cameraAnchor[1];
  value.terrainScale = scale.scale;
  value.terrainPhase[0] = scale.phase[0];
  value.terrainPhase[1] = scale.phase[1];
  return value;
}
