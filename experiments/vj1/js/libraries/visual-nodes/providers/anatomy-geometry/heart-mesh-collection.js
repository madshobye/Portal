import { createMeshCollection } from "../../../mesh-engine/mesh-collection/index.js?v=mesh-collection-1";
import {
  createEllipsoidMesh,
  createPathTubeMesh,
  createProfileMesh,
} from "../../../mesh-engine/procedural-mesh-primitives/index.js?v=procedural-mesh-primitives-2";

export function createHeartMeshCollection({ detail = 8, depth = 1 } = {}) {
  const segments = Math.max(4, Math.min(14, Math.round(finite(detail, 8))));
  const depthScale = Math.max(0.2, Math.min(3, finite(depth, 1)));
  const parts = [
    meshPart("body", profileMesh([
      { x: -5, y: -58, z: 0, rx: 34, rz: 27 },
      { x: 1, y: -36, z: 2, rx: 53, rz: 35 },
      { x: 4, y: 0, z: 3, rx: 55, rz: 38 },
      { x: 2, y: 38, z: 1, rx: 43, rz: 32 },
      { x: -4, y: 73, z: -2, rx: 25, rz: 22 },
      { x: -9, y: 96, z: -4, rx: 6, rz: 8 },
    ], segments, depthScale), "surface"),
    meshPart("left-lobe", ellipsoidMesh([-31, -48, 3], [29, 25, 24], segments, depthScale), "surface"),
    meshPart("right-lobe", ellipsoidMesh([30, -45, 4], [27, 23, 23], segments, depthScale), "surface"),
    meshPart("aorta-base", tubeMesh([[-10, -55, 7], [-19, -102, 8]], [13, 11], segments, 0.86, depthScale), "vessel"),
    meshPart("aorta-arch", tubeMesh([[-19, -102, 8], [18, -114, 5]], [11, 9], segments, 0.86, depthScale), "vessel"),
    meshPart("aorta-outlet", tubeMesh([[18, -114, 5], [45, -88, 2]], [9, 7], segments, 0.84, depthScale), "vessel"),
    meshPart("left-vessel", tubeMesh([[-17, -57, 0], [-57, -72, 1]], [11, 7], segments, 0.82, depthScale), "vessel"),
    meshPart("right-vessel", tubeMesh([[28, -53, -1], [34, -103, -3]], [12, 8], segments, 0.84, depthScale), "vessel"),
    meshPart("coronary-left", tubeMesh([[-7, -39, 36], [-20, 11, 39], [-4, 62, 27]], [2.6, 1.8, 1.2], Math.max(4, segments - 2), 0.62, depthScale), "coronary"),
    meshPart("coronary-right", tubeMesh([[12, -33, 38], [35, 8, 33]], [2.2, 1.3], Math.max(4, segments - 2), 0.62, depthScale), "coronary"),
  ];
  return createMeshCollection({
    id: "anatomy-heart",
    parts,
    metadata: {
      anatomyPart: "heart",
      fitScale: 0.64,
      detail: segments,
      depth: depthScale,
      animationContract: "apply heart pulse as a reusable Transform3d/controller",
    },
  });
}

function meshPart(id, mesh, materialSlot) {
  return { id, mesh, materialSlot };
}

function profileMesh(profile, segments, depthScale) {
  return createProfileMesh({
    profile,
    segments,
    transform: heartTransform(depthScale),
  });
}

function ellipsoidMesh(center, radii, segments, depthScale) {
  return createEllipsoidMesh({
    center,
    radii,
    segments,
    latitudeSegments: segments,
    transform: heartTransform(depthScale),
  });
}

function tubeMesh(points, radii, segments, radialDepthScale, depthScale) {
  return createPathTubeMesh({
    path: points.map((point, index) => ({
      point,
      radius: Math.max(0.2, finite(radii[index], radii[radii.length - 1] || 1)),
      depthScale: radialDepthScale,
    })),
    segments,
    transform: heartTransform(depthScale),
  });
}

function heartTransform(depthScale) {
  return {
    rotation: [0, 0, 0.09],
    scale: [1, 1, depthScale],
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
