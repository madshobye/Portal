import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import { MeshCollectionType } from "../../../mesh-engine/mesh-collection/index.js?v=mesh-collection-1";
import { GeometryProviderType } from "../../shared/specialized-compound-types.js";
import { createHeartMeshCollection } from "./heart-mesh-collection.js?v=canonical-primitives-3";
import { createHandMeshCollection } from "./hand-mesh-collection.js?v=canonical-primitives-2";
import { createArmMeshCollection } from "./arm-mesh-collection.js?v=canonical-limbs-1";
import { createLegMeshCollection } from "./leg-mesh-collection.js?v=canonical-limbs-1";
import { createBodyMeshCollection } from "./body-mesh-collection.js?v=canonical-limbs-1";
import { createFaceMeshCollection } from "./face-mesh-collection.js?v=canonical-face-1";

const ANATOMY_PARTS = ["face", "body", "hand", "arm", "leg", "heart"];

export const AnatomyGeometryProviderNode = defineNode({
  id: "core.visual.anatomy-geometry-provider",
  name: "Anatomy Geometry",
  version: "0.1.0",
  description: "Produces the specialized Anatomy descriptor and canonical multipart geometry for migrated Anatomy parts.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    providerId: { type: "string", defaultValue: "low-poly-anatomy" },
    settings: { type: "record", defaultValue: {} },
    part: {
      type: { type: "enum", values: ANATOMY_PARTS },
      defaultValue: "face",
      editor: { type: "select" },
    },
    detail: { type: "number", defaultValue: 8, allowedRange: [4, 14], clamp: true },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
    depth: { type: "number", defaultValue: 1, allowedRange: [0.2, 3], clamp: true },
    expression: { type: "number", defaultValue: 0, allowedRange: [-1, 1], clamp: true },
    mouthOpen: { type: "number", defaultValue: 0.1, allowedRange: [0, 1], clamp: true },
    brow: { type: "number", defaultValue: 0, allowedRange: [-1, 1], clamp: true },
    eyeSquint: { type: "number", defaultValue: 0.15, allowedRange: [0, 1], clamp: true },
    fingerBend: { type: "number", defaultValue: 0.35, allowedRange: [0, 1], clamp: true },
    limbBend: { type: "number", defaultValue: 0.25, allowedRange: [-1, 1], clamp: true },
    heartPulse: { type: "number", defaultValue: 0.35, allowedRange: [0, 1], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "low-poly-anatomy" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    geometry: { type: GeometryProviderType },
    collection: { type: MeshCollectionType, optional: true },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "geometry-provider",
    "mesh-collection-source",
    "scene-3d",
    "specialized-visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh", "scene-3d", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
  },
  process: anatomyGeometryProviderProcess,
});

export function anatomyGeometryProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = isRecord(inputs.settings) ? inputs.settings : {};
  const part = ANATOMY_PARTS.includes(settings.part)
    ? settings.part
    : ANATOMY_PARTS.includes(inputs.part) ? inputs.part : "face";
  const authoredDetail = finiteClamp(settings.detail ?? inputs.detail, 4, 14, 8);
  const renderQuality = finiteClamp(settings.renderQuality ?? inputs.renderQuality, 0, 1, 0.5);
  const detail = finiteClamp(
    authoredDetail * qualityMultiplier(renderQuality, 0.55, 1.35),
    4,
    14,
    8,
  );
  const depth = finiteClamp(settings.depth ?? inputs.depth, 0.2, 3, 1);
  const fingerBend = finiteClamp(settings.fingerBend ?? inputs.fingerBend, 0, 1, 0.35);
  const limbBend = finiteClamp(settings.limbBend ?? inputs.limbBend, -1, 1, 0.25);
  const expression = finiteClamp(settings.expression ?? inputs.expression, -1, 1, 0);
  const mouthOpen = finiteClamp(settings.mouthOpen ?? inputs.mouthOpen, 0, 1, 0.1);
  const brow = finiteClamp(settings.brow ?? inputs.brow, -1, 1, 0);
  const eyeSquint = finiteClamp(settings.eyeSquint ?? inputs.eyeSquint, 0, 1, 0.15);
  const collectionOptions = {
    part,
    detail,
    depth,
    fingerBend,
    limbBend,
    expression,
    mouthOpen,
    brow,
    eyeSquint,
  };
  const signature = collectionSignature(collectionOptions);
  if (signature && (state.signature !== signature || !state.collection)) {
    state.signature = signature;
    state.collection = createAnatomyMeshCollection(collectionOptions);
  } else if (!signature) {
    state.signature = "";
    state.collection = null;
  }

  const result = output || state.output || (state.output = {
    geometry: null,
    collection: null,
  });
  const geometry = result.geometry || (result.geometry = {});
  geometry.kind = "geometry";
  geometry.providerId = String(inputs.providerId || "low-poly-anatomy");
  geometry.settings = settings;
  geometry.enabled = inputs.enabled !== false;
  geometry.collection = state.collection;
  result.collection = state.collection;
  return result;
}

function createAnatomyMeshCollection(options) {
  if (options.part === "heart") return createHeartMeshCollection(options);
  if (options.part === "hand") return createHandMeshCollection(options);
  if (options.part === "arm") return createArmMeshCollection(options);
  if (options.part === "leg") return createLegMeshCollection(options);
  if (options.part === "body") return createBodyMeshCollection(options);
  if (options.part === "face") return createFaceMeshCollection(options);
  return null;
}

function collectionSignature({
  part,
  detail,
  depth,
  fingerBend,
  limbBend,
  expression,
  mouthOpen,
  brow,
  eyeSquint,
}) {
  if (part === "heart") return `heart:${Math.round(detail)}:${depth}`;
  if (part === "hand") return `hand:${Math.round(detail)}:${depth}:${fingerBend}`;
  if (part === "face") {
    return `face:${Math.round(detail)}:${depth}:${expression}:${mouthOpen}:${brow}:${eyeSquint}`;
  }
  if (part === "arm" || part === "leg" || part === "body") {
    return `${part}:${Math.round(detail)}:${depth}:${limbBend}`;
  }
  return "";
}

function finiteClamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function qualityMultiplier(quality, minimum, maximum) {
  if (quality <= 0.5) return minimum + (1 - minimum) * (quality / 0.5);
  return 1 + (maximum - 1) * ((quality - 0.5) / 0.5);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
