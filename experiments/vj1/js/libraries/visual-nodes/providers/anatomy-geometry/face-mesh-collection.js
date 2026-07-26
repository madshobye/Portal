import { createMeshCollection } from "../../../mesh-engine/mesh-collection/index.js";
import {
  createEllipsoidMesh,
  createProfileMesh,
  createTaperedSegmentMesh,
} from "../../../mesh-engine/procedural-mesh-primitives/index.js";

export function createFaceMeshCollection({
  detail = 8,
  depth = 1,
  expression = 0,
  mouthOpen = 0.1,
  brow = 0,
  eyeSquint = 0.15,
} = {}) {
  const segments = Math.max(4, Math.min(14, Math.round(finite(detail, 8))));
  const depthScale = clamp(finite(depth, 1), 0.2, 3);
  const expressionAmount = clamp(finite(expression, 0), -1, 1);
  const mouthAmount = clamp(finite(mouthOpen, 0.1), 0, 1);
  const browAmount = clamp(finite(brow, 0), -1, 1);
  const squintAmount = clamp(finite(eyeSquint, 0.15), 0, 1);
  const transform = { scale: [1, 1, depthScale] };
  const eyeHeight = Math.max(1.8, 7 * (1 - squintAmount * 0.8));
  const mouthY = 30;
  const cornerY = mouthY - expressionAmount * 7;
  const parts = [
    meshPart("head", createProfileMesh({
      profile: [
        { y: -102, z: -4, rx: 12, rz: 18 },
        { y: -88, z: -1, rx: 39, rz: 39 },
        { y: -52, z: 1, rx: 56, rz: 49 },
        { y: -14, z: 4, rx: 59, rz: 53 },
        { y: 20, z: 3, rx: 52, rz: 49 },
        { y: 50, z: 0, rx: 40, rz: 40 },
        { y: 68, z: -2, rx: 24, rz: 29 },
      ],
      segments,
      transform,
    }), "surface"),
    meshPart("left-ear", ellipsoid([-56, -12, 0], [11, 23, 8], [0, 0, -0.12], segments, transform), "surface"),
    meshPart("right-ear", ellipsoid([56, -12, 0], [11, 23, 8], [0, 0, 0.12], segments, transform), "surface"),
    meshPart("nose", tapered({
      start: [0, -20, 40],
      end: [0, 8, 76],
      startRadius: 11,
      middleRadius: 9,
      endRadius: 4.5,
      depthScale: 0.78,
      segments,
      transform,
    }), "surface"),
    ...[-1, 1].flatMap((side) => {
      const x = side * 25;
      const detailSegments = Math.max(5, segments - 1);
      return [
        meshPart(
          side < 0 ? "left-eye" : "right-eye",
          ellipsoid(
            [x, -28, 48],
            [16, eyeHeight, 4.5],
            [0, side * -0.08, side * 0.03],
            detailSegments,
            transform,
          ),
          "eye",
        ),
        meshPart(
          side < 0 ? "left-pupil" : "right-pupil",
          ellipsoid(
            [x, -28, 52],
            [4.2, Math.max(2.4, eyeHeight * 0.62), 2.2],
            [0, 0, 0],
            Math.max(5, segments - 2),
            transform,
          ),
          "pupil",
        ),
        meshPart(
          side < 0 ? "left-brow" : "right-brow",
          tapered({
            start: [side * 9, -48 + browAmount * 5, 48],
            end: [side * 42, -46 - browAmount * 6, 42],
            startRadius: 2.3,
            middleRadius: 3.2,
            endRadius: 1.8,
            depthScale: 0.65,
            segments: Math.max(4, segments - 2),
            transform,
          }),
          "feature",
        ),
      ];
    }),
    ...(mouthAmount > 0.02 ? [
      meshPart("mouth-opening", ellipsoid(
        [0, mouthY + 2, 47],
        [23, 2.5 + mouthAmount * 8, 3],
        [0, 0, 0],
        Math.max(5, segments - 2),
        transform,
      ), "pupil"),
    ] : []),
    meshPart("left-lip", tapered({
      start: [-27, cornerY, 47],
      end: [0, mouthY - 1, 51],
      startRadius: 1.8,
      middleRadius: 3,
      endRadius: 2.3,
      depthScale: 0.62,
      segments: Math.max(4, segments - 2),
      transform,
    }), "lip"),
    meshPart("right-lip", tapered({
      start: [0, mouthY - 1, 51],
      end: [27, cornerY, 47],
      startRadius: 2.3,
      middleRadius: 3,
      endRadius: 1.8,
      depthScale: 0.62,
      segments: Math.max(4, segments - 2),
      transform,
    }), "lip"),
    meshPart("chin", ellipsoid(
      [0, 49, 30],
      [30, 12, 18],
      [0.08 + expressionAmount * 0.08, 0, 0],
      segments,
      transform,
    ), "surface"),
    meshPart("neck", tapered({
      start: [0, 61, -1],
      end: [0, 108, 0],
      startRadius: 22,
      middleRadius: 24,
      endRadius: 27,
      depthScale: 0.86,
      segments,
      transform,
    }), "surface"),
  ];
  return createMeshCollection({
    id: "anatomy-face",
    parts,
    metadata: {
      anatomyPart: "face",
      fitScale: 0.72,
      detail: segments,
      depth: depthScale,
      expression: expressionAmount,
      mouthOpen: mouthAmount,
      brow: browAmount,
      eyeSquint: squintAmount,
      materialContract: "surface feature lip eye and pupil are independent bindable material slots",
    },
  });
}

function ellipsoid(center, radii, rotation, segments, transform) {
  return createEllipsoidMesh({
    center,
    radii,
    rotation,
    segments,
    latitudeSegments: segments,
    transform,
  });
}

function tapered(options) {
  return createTaperedSegmentMesh(options);
}

function meshPart(id, mesh, materialSlot) {
  return { id, mesh, materialSlot };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
