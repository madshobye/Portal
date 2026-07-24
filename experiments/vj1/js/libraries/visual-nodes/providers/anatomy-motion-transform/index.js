import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { MeshCollectionType, isMeshCollection } from "../../../mesh-engine/mesh-collection/index.js?v=mesh-collection-1";
import {
  createRetainedTransform3d,
  updateRetainedTransform3d,
} from "../../../mesh-engine/scene-types.js?v=retained-transform-signal-1";

export const AnatomyMotionTransform3dNode = defineNode({
  id: "core.visual.anatomy-motion-transform",
  name: "Anatomy Motion Transform",
  version: "0.1.0",
  description: "Combines authored rotation, spin, semantic mesh fit, and the Anatomy heart pulse into one reusable Transform3d.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    collection: { type: MeshCollectionType, required: true },
    componentTime: { type: "number", required: true },
    modelScale: { type: "number", defaultValue: 1 },
    rotationX: { type: "number", defaultValue: 0 },
    rotationY: { type: "number", defaultValue: 0 },
    rotationZ: { type: "number", defaultValue: 0 },
    spinX: { type: "number", defaultValue: 0 },
    spinY: { type: "number", defaultValue: 0 },
    spinZ: { type: "number", defaultValue: 0 },
    heartPulse: { type: "number", defaultValue: 0.35 },
  },
  outlets: { transform: { type: "transform3d" } },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["scene-3d", "transform", "controller", "motion", "graph-placeable", "live-fast-path"],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d", "motion"],
    placeableOn: ["node-graph"],
  },
  parts: [{
    id: "anatomy-motion-transform",
    name: "Anatomy motion transform",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "anatomyMotionTransform3dProcess",
    entry: "process",
    source: [
      anatomyMotionTransform3dProcess,
      boundsFitScale,
      clamp,
      finite,
    ].map(String).join("\n\n"),
  }],
  moduleBindings: {
    createRetainedTransform3d,
    isMeshCollection,
    updateRetainedTransform3d,
  },
  process: anatomyMotionTransform3dProcess,
});

export function anatomyMotionTransform3dProcess(inputs = {}, { state = {}, output = null } = {}) {
  const collection = inputs.collection;
  if (!isMeshCollection(collection)) throw new Error("ANATOMY_MOTION_COLLECTION_INVALID");
  const time = finite(inputs.componentTime, 0);
  const authoredScale = Math.max(0.0001, Math.abs(finite(inputs.modelScale, 1)));
  const semanticFit = finite(collection.metadata?.fitScale, boundsFitScale(collection.bounds));
  const pulseAmount = collection.metadata?.anatomyPart === "heart"
    ? clamp(finite(inputs.heartPulse, 0.35), 0, 1)
    : 0;
  const beat = pulseAmount * (
    0.045 +
    0.04 * Math.max(0, Math.sin(time * 5.4)) +
    0.025 * Math.max(0, Math.sin(time * 10.8 + 0.9))
  );
  const scale = authoredScale * semanticFit;
  const transform = state.transform || (state.transform = createRetainedTransform3d());
  updateRetainedTransform3d(transform, {
      rotation: [
        finite(inputs.rotationX, 0) + time * finite(inputs.spinX, 0),
        finite(inputs.rotationY, 0) + time * finite(inputs.spinY, 0),
        finite(inputs.rotationZ, 0) + time * finite(inputs.spinZ, 0),
      ],
      scale: [
        scale * (1 + beat),
        scale * (1 + beat * 0.72),
        scale * (1 + beat * 0.6),
      ],
  });
  const result = output || state.output || (state.output = { transform: null });
  result.transform = transform;
  return result;
}

function boundsFitScale(bounds = {}) {
  const extent = Math.max(
    Math.abs(finite(bounds?.max?.[0], 0) - finite(bounds?.min?.[0], 0)),
    Math.abs(finite(bounds?.max?.[1], 0) - finite(bounds?.min?.[1], 0)),
    Math.abs(finite(bounds?.max?.[2], 0) - finite(bounds?.min?.[2], 0)),
    1,
  );
  return 140 / extent;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
