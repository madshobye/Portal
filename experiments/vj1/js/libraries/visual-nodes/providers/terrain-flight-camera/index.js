import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  Camera3dType,
  createCamera3d,
} from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import { TerrainFlightStateType } from "../../../terrain-engine/flight-controller/index.js";
import { VisualCameraProviderType } from "../../shared/visual-stage-types.js";

export const TerrainFlightCameraProviderNode = defineNode({
  id: "core.visual.terrain-flight-camera",
  name: "Terrain Flight Camera",
  version: "0.1.0",
  description: "Produces Terrain's projection/follow-camera contract and a canonical Camera3d for ordinary Scene composition.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    providerId: { type: "string", defaultValue: "terrain-flight-camera" },
    settings: { type: "record", defaultValue: {} },
    flight: { type: TerrainFlightStateType, optional: true },
    pitch: { type: "number", defaultValue: 0.28, allowedRange: [-1.4, 1.4], clamp: true },
    fieldOfView: { type: "number", defaultValue: 60, allowedRange: [20, 120], clamp: true },
    nearClip: { type: "number", defaultValue: 0.1, allowedRange: [0.01, 20], clamp: true },
    farClip: { type: "number", defaultValue: 20000, allowedRange: [100, 50000], clamp: true },
    lookAhead: { type: "number", defaultValue: 14, allowedRange: [2, 60], clamp: true },
    noseFollow: { type: "number", defaultValue: 1, allowedRange: [0, 2], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "terrain-flight-camera" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    camera: { type: VisualCameraProviderType },
    sceneCamera: { type: Camera3dType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "camera",
    "terrain",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "camera", "terrain", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
  },
  process: terrainFlightCameraProviderProcess,
});

export function terrainFlightCameraProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = record(inputs.settings);
  const providerId = String(inputs.providerId || "terrain-flight-camera");
  const values = normalizedCameraValues(settings, inputs);
  const flight = normalizedFlight(inputs.flight);
  const signature = JSON.stringify([values, flight]);
  if (state.signature !== signature || !state.sceneCamera) {
    state.signature = signature;
    state.sceneCamera = terrainSceneCamera(values, flight);
  }
  const result = output || state.output || (state.output = { camera: null, sceneCamera: null });
  const descriptor = result.camera || (result.camera = {});
  descriptor.kind = "camera";
  descriptor.providerId = providerId;
  descriptor.settings = settings;
  descriptor.runtimeSettings = values;
  descriptor.enabled = inputs.enabled !== false;
  descriptor.sceneCamera = state.sceneCamera;
  result.sceneCamera = state.sceneCamera;
  return result;
}

function terrainSceneCamera(values, flight) {
  const yaw = flight.turn * 0.72;
  const horizontal = Math.cos(values.pitch);
  const distance = values.lookAhead;
  const position = [
    flight.cameraAnchor[0],
    flight.altitude,
    flight.cameraAnchor[1],
  ];
  return createCamera3d({
    projection: "perspective",
    position,
    target: [
      position[0] + Math.sin(yaw) * horizontal * distance,
      position[1] - Math.sin(values.pitch) * distance,
      position[2] + Math.cos(yaw) * horizontal * distance,
    ],
    up: [0, 1, 0],
    fieldOfView: values.fieldOfView * Math.PI / 180,
    near: values.nearClip,
    far: values.farClip,
  });
}

function normalizedCameraValues(settings, inputs) {
  const nearClip = bounded(setting(settings, inputs, "nearClip"), 0.01, 20, 0.1);
  return {
    projection: "perspective",
    pitch: bounded(setting(settings, inputs, "pitch"), -1.4, 1.4, 0.28),
    fieldOfView: bounded(setting(settings, inputs, "fieldOfView"), 20, 120, 60),
    nearClip,
    farClip: Math.max(
      nearClip + 0.001,
      bounded(setting(settings, inputs, "farClip"), 100, 50000, 20000),
    ),
    lookAhead: bounded(setting(settings, inputs, "lookAhead"), 2, 60, 14),
    noseFollow: bounded(setting(settings, inputs, "noseFollow"), 0, 2, 1),
  };
}

function normalizedFlight(value) {
  const flight = value?.kind === "terrain-flight-state" ? value : null;
  return {
    turn: bounded(flight?.turn, -1, 1, 0),
    altitude: bounded(flight?.altitude, 0.2, 10000, 2.5),
    cameraAnchor: [
      finite(flight?.cameraAnchor?.[0], 0),
      finite(flight?.cameraAnchor?.[1], 0),
    ],
  };
}

function setting(settings, inputs, id) {
  return settings[id] === undefined ? inputs[id] : settings[id];
}

function bounded(value, minimum, maximum, fallback) {
  return Math.max(minimum, Math.min(maximum, finite(value, fallback)));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
