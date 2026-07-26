import { createMeshCollection } from "../../../mesh-engine/mesh-collection/index.js";
import {
  createPathTubeMesh,
  createProfileMesh,
  createTaperedSegmentMesh,
} from "../../../mesh-engine/procedural-mesh-primitives/index.js";

export function createHandMeshCollection({ detail = 8, depth = 1, fingerBend = 0.35 } = {}) {
  const segments = Math.max(4, Math.min(14, Math.round(finite(detail, 8))));
  const depthScale = Math.max(0.2, Math.min(3, finite(depth, 1)));
  const bend = clamp(finite(fingerBend, 0.35), 0, 1);
  const transform = { scale: [1, 1, depthScale] };
  const fingerLengths = [55, 68, 65, 55];
  const fingerXs = [-29, -10, 10, 29];
  const parts = [
    meshPart("wrist", createTaperedSegmentMesh({
      start: [0, 99, 0],
      end: [0, 65, 0],
      startRadius: 17,
      middleRadius: 19,
      endRadius: 20,
      depthScale: 0.74,
      segments,
      transform,
    })),
    meshPart("palm", createProfileMesh({
      profile: [
        { y: 69, rx: 19, rz: 13 },
        { y: 48, rx: 30, rz: 16 },
        { y: 15, rx: 38, rz: 18 },
        { y: -5, rx: 35, rz: 15 },
      ],
      segments,
      transform,
    })),
    ...fingerXs.map((x, index) => meshPart(`finger-${index + 1}`, createPathTubeMesh({
      path: fingerPath(
        index,
        [x, 5 - Math.abs(index - 1.5) * 1.5, 0],
        fingerLengths[index],
        bend,
      ),
      segments,
      transform,
    }))),
    meshPart("thumb", createPathTubeMesh({
      path: thumbPath(bend),
      segments,
      transform,
    })),
  ];
  return createMeshCollection({
    id: "anatomy-hand",
    parts,
    metadata: {
      anatomyPart: "hand",
      fitScale: 0.78,
      detail: segments,
      depth: depthScale,
      fingerBend: bend,
      animationContract: "finger bend changes retained geometry on input change, never on frame ticks",
    },
  });
}

function fingerPath(index, start, totalLength, bend) {
  const segmentRatios = [0.43, 0.33, 0.24];
  const curl = 0.12 + bend * 1.45;
  const splay = (index - 1.5) * 0.034;
  const curlFactors = [0.16, 0.56, 0.98];
  let point = start;
  let radius = 6.6 - Math.abs(index - 1.5) * 0.35;
  const path = [{ point, radius, depthScale: 0.78 }];
  for (let segment = 0; segment < segmentRatios.length; segment += 1) {
    const length = totalLength * segmentRatios[segment];
    const angle = curl * curlFactors[segment];
    const next = [
      point[0] + splay * length,
      point[1] - Math.cos(angle) * length,
      point[2] + Math.sin(angle) * length,
    ];
    const nextRadius = Math.max(2.6, radius - 1.15);
    path.push({
      point: mixPoint(point, next, 0.5),
      radius: radius * 1.03,
      depthScale: 0.78,
    });
    path.push({
      point: next,
      radius: nextRadius * (segment < 2 ? 1.12 : 1),
      depthScale: 0.78,
    });
    point = next;
    radius = nextRadius;
  }
  return path;
}

function thumbPath(bend) {
  const start = [-28, 36, 1];
  const middle = [-51, 17, 4 + bend * 5];
  return [
    { point: start, radius: 10, depthScale: 0.8 },
    { point: mixPoint(start, middle, 0.5), radius: 11, depthScale: 0.8 },
    { point: middle, radius: 8, depthScale: 0.78 },
    { point: [-66, -7, 7 + bend * 13], radius: 5.5, depthScale: 0.76 },
  ];
}

function meshPart(id, mesh) {
  return { id, mesh, materialSlot: "surface" };
}

function mixPoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
