import { createMeshCollection } from "../../../mesh-engine/mesh-collection/index.js";
import { createPathTubeMesh } from "../../../mesh-engine/procedural-mesh-primitives/index.js";
import { createArmPath } from "./limb-paths.js";

export function createArmMeshCollection({ detail = 8, depth = 1, limbBend = 0.25 } = {}) {
  const segments = normalizedDetail(detail);
  const depthScale = normalizedDepth(depth);
  const bend = normalizedBend(limbBend);
  return createMeshCollection({
    id: "anatomy-arm",
    parts: [{
      id: "arm",
      materialSlot: "surface",
      mesh: createPathTubeMesh({
        path: createArmPath({ bend, includeHand: true }),
        segments,
        transform: { scale: [1, 1, depthScale] },
      }),
    }],
    metadata: {
      anatomyPart: "arm",
      fitScale: 0.65,
      detail: segments,
      depth: depthScale,
      limbBend: bend,
      deformationContract: "limb bend rebuilds retained geometry only on input changes",
    },
  });
}

function normalizedDetail(value) {
  return Math.max(4, Math.min(14, Math.round(finite(value, 8))));
}

function normalizedDepth(value) {
  return Math.max(0.2, Math.min(3, finite(value, 1)));
}

function normalizedBend(value) {
  return Math.max(-1, Math.min(1, finite(value, 0.25)));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
