import { createMeshCollection } from "../../../mesh-engine/mesh-collection/index.js";
import {
  createEllipsoidMesh,
  createPathTubeMesh,
  createProfileMesh,
  createTaperedSegmentMesh,
} from "../../../mesh-engine/procedural-mesh-primitives/index.js";
import { createArmPath, createLegPath } from "./limb-paths.js";

export function createBodyMeshCollection({ detail = 8, depth = 1, limbBend = 0.25 } = {}) {
  const segments = Math.max(4, Math.min(14, Math.round(finite(detail, 8))));
  const depthScale = Math.max(0.2, Math.min(3, finite(depth, 1)));
  const bend = Math.max(-1, Math.min(1, finite(limbBend, 0.25)));
  const transform = { scale: [1, 1, depthScale] };
  const parts = [
    meshPart("head", createEllipsoidMesh({
      center: [0, -132, 0],
      radii: [25, 31, 23],
      segments,
      latitudeSegments: segments,
      transform,
    })),
    meshPart("neck", createTaperedSegmentMesh({
      start: [0, -105, 0],
      end: [0, -84, 0],
      startRadius: 12,
      middleRadius: 14,
      endRadius: 17,
      depthScale: 0.86,
      segments,
      transform,
    })),
    meshPart("torso", createProfileMesh({
      profile: [
        { y: -91, rx: 42, rz: 24 },
        { y: -76, rx: 64, rz: 29 },
        { y: -38, rx: 56, rz: 31 },
        { y: 5, rx: 39, rz: 24 },
        { y: 34, rx: 46, rz: 28 },
        { y: 53, rx: 40, rz: 25 },
      ],
      segments,
      transform,
    })),
    meshPart("left-arm", createPathTubeMesh({
      path: createArmPath({
        shoulder: [-59, -73, 0],
        mirror: -1,
        scale: 0.64,
        bend,
        includeHand: true,
      }),
      segments,
      transform,
    })),
    meshPart("right-arm", createPathTubeMesh({
      path: createArmPath({
        shoulder: [59, -73, 0],
        mirror: 1,
        scale: 0.64,
        bend,
        includeHand: true,
      }),
      segments,
      transform,
    })),
    meshPart("left-leg", createPathTubeMesh({
      path: createLegPath({
        hip: [-25, 46, 0],
        mirror: -1,
        scale: 0.7,
        bend,
      }),
      segments,
      transform,
    })),
    meshPart("right-leg", createPathTubeMesh({
      path: createLegPath({
        hip: [25, 46, 0],
        mirror: 1,
        scale: 0.7,
        bend,
      }),
      segments,
      transform,
    })),
  ];
  return createMeshCollection({
    id: "anatomy-body",
    parts,
    metadata: {
      anatomyPart: "body",
      fitScale: 0.4,
      detail: segments,
      depth: depthScale,
      limbBend: bend,
      compositionContract: "head torso and limb geometry remain independent reusable Scene objects",
    },
  });
}

function meshPart(id, mesh) {
  return { id, mesh, materialSlot: "surface" };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
