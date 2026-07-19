import { clamp01 } from "../../domain/models.js?v=chain-only-authority-1";

function drawWithPolygonOffset(target, enabled, draw) {
  const gl = target?.drawingContext;
  if (!enabled || !gl?.polygonOffset || typeof draw !== "function") return draw?.();
  const wasEnabled = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
  const previousFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
  const previousUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 2);
  try {
    return draw();
  } finally {
    gl.polygonOffset(previousFactor, previousUnits);
    if (!wasEnabled) gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

const ANATOMY_RING_CACHE = new Map();

export function anatomyPartFitScale(part = "face") {
  return ({ face: 0.72, body: 0.4, hand: 0.78, arm: 0.65, leg: 0.61, heart: 0.64 })[part] || 0.72;
}

export function drawProceduralAnatomy(target, params = {}, componentTime = 0, renderMode = "surface", surfaceColor = [217, 212, 201, 255], wireColor = [75, 73, 68, 204], wireThickness = 1.6, detail = 8) {
  const part = params.part || "face";
  if (part === "body") return drawLowPolyBody(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "hand") return drawLowPolyHand(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "arm") return drawLowPolyArm(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "leg") return drawLowPolyLeg(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
  if (part === "heart") return drawLowPolyHeart(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail);
  return drawLowPolyFace(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail);
}

function drawAnatomyShape(target, renderMode, surfaceColor, wireColor, wireThickness, drawShape) {
  if (renderMode !== "wireframe" && renderMode !== "points") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", drawShape);
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire" || renderMode === "points") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(renderMode === "points" ? Math.max(2, wireThickness * 1.3) : wireThickness);
    drawShape();
  }
}

function anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  target.push();
  target.translate(x, y, z);
  target.rotateX(rx);
  target.rotateY(ry);
  target.rotateZ(rz);
  target.scale(sx, sy, sz);
  drawAnatomyShape(target, renderMode, surfaceColor, wireColor, wireThickness, () => target.sphere(1, detail, detail));
  target.pop();
}

function anatomyRing(detail) {
  const sides = Math.max(4, Math.min(14, Math.round(Number(detail) || 8)));
  let ring = ANATOMY_RING_CACHE.get(sides);
  if (!ring) {
    ring = Array.from({ length: sides }, (_, index) => {
      const angle = index * Math.PI * 2 / sides;
      return [Math.cos(angle), Math.sin(angle)];
    });
    ANATOMY_RING_CACHE.set(sides, ring);
  }
  return ring;
}

function anatomySubtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function anatomyCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function anatomyNormalize(vector) {
  const inverseLength = 1 / Math.max(0.000001, Math.hypot(vector[0], vector[1], vector[2]));
  return [vector[0] * inverseLength, vector[1] * inverseLength, vector[2] * inverseLength];
}

function anatomyTriangle(a, b, c) {
  return [a, b, c, anatomyNormalize(anatomyCross(anatomySubtract(b, a), anatomySubtract(c, a)))];
}

function drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings, capStart = true, capEnd = true) {
  if (!rings.length || !rings[0]?.length) return;
  const sides = rings[0].length;
  const triangles = [];
  for (let row = 0; row < rings.length - 1; row++) {
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      triangles.push(anatomyTriangle(rings[row][side], rings[row + 1][side], rings[row + 1][next]));
      triangles.push(anatomyTriangle(rings[row][side], rings[row + 1][next], rings[row][next]));
    }
  }
  const addCap = (ring, reverse) => {
    const center = ring.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
      .map((value) => value / ring.length);
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      triangles.push(reverse
        ? anatomyTriangle(center, ring[next], ring[side])
        : anatomyTriangle(center, ring[side], ring[next]));
    }
  };
  if (capStart) addCap(rings[0], true);
  if (capEnd) addCap(rings[rings.length - 1], false);

  const emitTriangles = () => {
    target.beginShape(TRIANGLES);
    for (const triangle of triangles) {
      for (let index = 0; index < 3; index++) {
        target.normal?.(...triangle[3]);
        target.vertex(...triangle[index]);
      }
    }
    target.endShape();
  };

  if (renderMode !== "wireframe" && renderMode !== "points") {
    target.noStroke();
    target.ambientMaterial?.(...surfaceColor);
    target.fill?.(...surfaceColor);
    drawWithPolygonOffset(target, renderMode === "surfaceWire", emitTriangles);
  }
  if (renderMode === "wireframe" || renderMode === "surfaceWire") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(wireThickness);
    emitTriangles();
  }
  if (renderMode === "points") {
    target.noFill();
    target.stroke(...wireColor);
    target.strokeWeight(Math.max(2, wireThickness * 1.3));
    target.beginShape(POINTS);
    for (const ring of rings) for (const point of ring) target.vertex(...point);
    target.endShape();
  }
}

function anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, profile) {
  const unitRing = anatomyRing(detail);
  const rings = profile.map((slice) => unitRing.map(([cosine, sine]) => [
    (Number(slice.x) || 0) + cosine * Math.max(0.5, Number(slice.rx) || 0.5),
    Number(slice.y) || 0,
    (Number(slice.z) || 0) + sine * Math.max(0.5, Number(slice.rz) || 0.5),
  ]));
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, start, end, startRadius, middleRadius, endRadius, depthScale = 0.82) {
  const direction = anatomyNormalize(anatomySubtract(end, start));
  const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const axisA = anatomyNormalize(anatomyCross(direction, reference));
  const axisB = anatomyNormalize(anatomyCross(direction, axisA));
  const unitRing = anatomyRing(detail);
  const slices = [
    [0, startRadius],
    [0.34, middleRadius],
    [0.72, middleRadius * 0.9 + endRadius * 0.1],
    [1, endRadius],
  ];
  const rings = slices.map(([amount, radius]) => {
    const center = [
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ];
    return unitRing.map(([cosine, sine]) => [
      center[0] + axisA[0] * cosine * radius + axisB[0] * sine * radius * depthScale,
      center[1] + axisA[1] * cosine * radius + axisB[1] * sine * radius * depthScale,
      center[2] + axisA[2] * cosine * radius + axisB[2] * sine * radius * depthScale,
    ]);
  });
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyMixPoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, path) {
  if (!Array.isArray(path) || path.length < 2) return;
  const unitRing = anatomyRing(detail);
  const rings = path.map((slice, index) => {
    const previous = path[Math.max(0, index - 1)].point;
    const next = path[Math.min(path.length - 1, index + 1)].point;
    const direction = anatomyNormalize(anatomySubtract(next, previous));
    const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const axisA = anatomyNormalize(anatomyCross(direction, reference));
    const axisB = anatomyNormalize(anatomyCross(direction, axisA));
    const radius = Math.max(0.5, Number(slice.radius) || 0.5);
    const depthScale = Math.max(0.2, Number(slice.depthScale) || 0.82);
    return unitRing.map(([cosine, sine]) => [
      slice.point[0] + axisA[0] * cosine * radius + axisB[0] * sine * radius * depthScale,
      slice.point[1] + axisA[1] * cosine * radius + axisB[1] * sine * radius * depthScale,
      slice.point[2] + axisA[2] * cosine * radius + axisB[2] * sine * radius * depthScale,
    ]);
  });
  drawAnatomyMesh(target, renderMode, surfaceColor, wireColor, wireThickness, rings);
}

function anatomyShade(color, brightness = 1, alpha = 1) {
  return [
    Math.max(0, Math.min(255, Math.round((Number(color[0]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[1]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[2]) || 0) * brightness))),
    Math.max(0, Math.min(255, Math.round((Number(color[3]) || 255) * alpha))),
  ];
}

function anatomyAdvanceDown(point, angle, length) {
  return [point[0] + Math.sin(angle) * length, point[1] + Math.cos(angle) * length, point[2]];
}

function drawLowPolyFace(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const expression = Math.max(-1, Math.min(1, Number(params.expression) || 0));
  const mouthOpen = clamp01(Number(params.mouthOpen) || 0);
  const brow = Math.max(-1, Math.min(1, Number(params.brow) || 0));
  const squint = clamp01(Number(params.eyeSquint) || 0);
  const featureColor = anatomyShade(wireColor, 0.62, 1);
  const lipColor = anatomyShade(surfaceColor, 0.46, 1);
  const eyeColor = [244, 243, 232, 255];
  const pupilColor = anatomyShade(wireColor, 0.22, 1);

  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: -102, z: -4, rx: 12, rz: 18 },
    { y: -88, z: -1, rx: 39, rz: 39 },
    { y: -52, z: 1, rx: 56, rz: 49 },
    { y: -14, z: 4, rx: 59, rz: 53 },
    { y: 20, z: 3, rx: 52, rz: 49 },
    { y: 50, z: 0, rx: 40, rz: 40 },
    { y: 68, z: -2, rx: 24, rz: 29 },
  ]);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, -56, -12, 0, 11, 23, 8, 0, 0, -0.12);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 56, -12, 0, 11, 23, 8, 0, 0, 0.12);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -20, 40], [0, 8, 76], 11, 9, 4.5, 0.78);

  const eyeHeight = Math.max(1.8, 7 * (1 - squint * 0.8));
  for (const side of [-1, 1]) {
    const x = side * 25;
    anatomyEllipsoid(target, renderMode, eyeColor, wireColor, wireThickness, Math.max(5, detail - 1), x, -28, 48, 16, eyeHeight, 4.5, 0, side * -0.08, side * 0.03);
    anatomyEllipsoid(target, renderMode, pupilColor, wireColor, wireThickness, Math.max(5, detail - 2), x, -28, 52, 4.2, Math.max(2.4, eyeHeight * 0.62), 2.2);
    anatomyTaperedSegment(target, renderMode, featureColor, wireColor, wireThickness, Math.max(4, detail - 2),
      [side * 9, -48 + brow * 5, 48], [side * 42, -46 - brow * 6, 42], 2.3, 3.2, 1.8, 0.65);
  }

  const mouthY = 30;
  const cornerY = mouthY - expression * 7;
  if (mouthOpen > 0.02) anatomyEllipsoid(target, renderMode, pupilColor, wireColor, wireThickness, Math.max(5, detail - 2), 0, mouthY + 2, 47, 23, 2.5 + mouthOpen * 8, 3);
  anatomyTaperedSegment(target, renderMode, lipColor, wireColor, wireThickness, Math.max(4, detail - 2), [-27, cornerY, 47], [0, mouthY - 1, 51], 1.8, 3, 2.3, 0.62);
  anatomyTaperedSegment(target, renderMode, lipColor, wireColor, wireThickness, Math.max(4, detail - 2), [0, mouthY - 1, 51], [27, cornerY, 47], 2.3, 3, 1.8, 0.62);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 0, 49, 30, 30, 12, 18, 0.08 + expression * 0.08, 0, 0);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, 61, -1], [0, 108, 0], 22, 24, 27, 0.86);
}

function drawLowPolyBody(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 0, -132, 0, 25, 31, 23);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -105, 0], [0, -84, 0], 12, 14, 17, 0.86);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: -91, rx: 42, rz: 24 },
    { y: -76, rx: 64, rz: 29 },
    { y: -38, rx: 56, rz: 31 },
    { y: 5, rx: 39, rz: 24 },
    { y: 34, rx: 46, rz: 28 },
    { y: 53, rx: 40, rz: 25 },
  ]);
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [-59, -73, 0], -1, 0.64, bend, true);
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [59, -73, 0], 1, 0.64, bend, true);
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [-25, 46, 0], -1, 0.7, bend);
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [25, 46, 0], 1, 0.7, bend);
}

function drawAnatomyFinger(target, renderMode, surfaceColor, wireColor, wireThickness, detail, index, start, totalLength, bend) {
  const segmentRatios = [0.43, 0.33, 0.24];
  const curl = 0.12 + bend * 1.45;
  const splay = (index - 1.5) * 0.034;
  const curlFactors = [0.16, 0.56, 0.98];
  let point = start;
  let radius = 6.6 - Math.abs(index - 1.5) * 0.35;
  const path = [{ point, radius, depthScale: 0.78 }];
  for (let segment = 0; segment < segmentRatios.length; segment++) {
    const length = totalLength * segmentRatios[segment];
    const angle = curl * curlFactors[segment];
    const next = [
      point[0] + splay * length,
      point[1] - Math.cos(angle) * length,
      point[2] + Math.sin(angle) * length,
    ];
    const nextRadius = Math.max(2.6, radius - 1.15);
    path.push({ point: anatomyMixPoint(point, next, 0.5), radius: radius * 1.03, depthScale: 0.78 });
    path.push({ point: next, radius: nextRadius * (segment < 2 ? 1.12 : 1), depthScale: 0.78 });
    point = next;
    radius = nextRadius;
  }
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, path);
}

function drawLowPolyHand(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = clamp01(Number(params.fingerBend) || 0);
  anatomyTaperedSegment(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, 99, 0], [0, 65, 0], 17, 19, 20, 0.74);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { y: 69, rx: 19, rz: 13 },
    { y: 48, rx: 30, rz: 16 },
    { y: 15, rx: 38, rz: 18 },
    { y: -5, rx: 35, rz: 15 },
  ]);
  const fingerLengths = [55, 68, 65, 55];
  const fingerXs = [-29, -10, 10, 29];
  for (let index = 0; index < fingerXs.length; index++) {
    drawAnatomyFinger(target, renderMode, surfaceColor, wireColor, wireThickness, detail, index,
      [fingerXs[index], 5 - Math.abs(index - 1.5) * 1.5, 0], fingerLengths[index], bend);
  }
  const thumbStart = [-28, 36, 1];
  const thumbMiddle = [-51, 17, 4 + bend * 5];
  const thumbEnd = [-66, -7, 7 + bend * 13];
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: thumbStart, radius: 10, depthScale: 0.8 },
    { point: anatomyMixPoint(thumbStart, thumbMiddle, 0.5), radius: 11, depthScale: 0.8 },
    { point: thumbMiddle, radius: 8, depthScale: 0.78 },
    { point: thumbEnd, radius: 5.5, depthScale: 0.76 },
  ]);
}

function drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, shoulder, mirror, scale, bend, includeHand) {
  const upperAngle = mirror * (0.08 + bend * 0.12);
  const forearmAngle = upperAngle - mirror * bend * 0.72;
  const elbow = anatomyAdvanceDown(shoulder, upperAngle, 82 * scale);
  const wrist = anatomyAdvanceDown(elbow, forearmAngle, 78 * scale);
  const hand = anatomyAdvanceDown(wrist, forearmAngle * 0.86, 25 * scale);
  const fingertips = anatomyAdvanceDown(hand, forearmAngle * 0.72, 17 * scale);
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: shoulder, radius: 23 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(shoulder, elbow, 0.2), radius: 22 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(shoulder, elbow, 0.48), radius: 23.5 * scale, depthScale: 0.84 },
    { point: anatomyMixPoint(shoulder, elbow, 0.84), radius: 15.5 * scale, depthScale: 0.82 },
    { point: elbow, radius: 14 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(elbow, wrist, 0.2), radius: 15 * scale, depthScale: 0.82 },
    { point: anatomyMixPoint(elbow, wrist, 0.48), radius: 16.5 * scale, depthScale: 0.78 },
    { point: anatomyMixPoint(elbow, wrist, 0.82), radius: 10 * scale, depthScale: 0.76 },
    { point: wrist, radius: 8.5 * scale, depthScale: 0.74 },
    ...(includeHand ? [
      { point: hand, radius: 12 * scale, depthScale: 0.62 },
      { point: fingertips, radius: 5.5 * scale, depthScale: 0.56 },
    ] : []),
  ]);
}

function drawLowPolyArm(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  drawAnatomyArmChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -96, 0], 1, 1, bend, true);
}

function drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, hip, mirror, scale, bend) {
  const thighAngle = mirror * (0.025 + bend * 0.08);
  const shinAngle = thighAngle - mirror * bend * 0.58;
  const knee = anatomyAdvanceDown(hip, thighAngle, 88 * scale);
  const ankle = anatomyAdvanceDown(knee, shinAngle, 86 * scale);
  const toe = [ankle[0] + mirror * 5 * scale, ankle[1] + 19 * scale, ankle[2] + 50 * scale];
  anatomyPathVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { point: hip, radius: 27 * scale, depthScale: 0.9 },
    { point: anatomyMixPoint(hip, knee, 0.2), radius: 26 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(hip, knee, 0.5), radius: 28 * scale, depthScale: 0.86 },
    { point: anatomyMixPoint(hip, knee, 0.84), radius: 19 * scale, depthScale: 0.84 },
    { point: knee, radius: 17 * scale, depthScale: 0.88 },
    { point: anatomyMixPoint(knee, ankle, 0.2), radius: 20 * scale, depthScale: 0.84 },
    { point: anatomyMixPoint(knee, ankle, 0.48), radius: 21 * scale, depthScale: 0.8 },
    { point: anatomyMixPoint(knee, ankle, 0.84), radius: 11 * scale, depthScale: 0.76 },
    { point: ankle, radius: 9 * scale, depthScale: 0.74 },
    { point: anatomyMixPoint(ankle, toe, 0.56), radius: 18 * scale, depthScale: 0.68 },
    { point: toe, radius: 7 * scale, depthScale: 0.62 },
  ]);
}

function drawLowPolyLeg(target, params, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const bend = Math.max(-1, Math.min(1, Number(params.limbBend) || 0));
  drawAnatomyLegChain(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [0, -105, 0], 1, 1, bend);
}

function drawLowPolyHeart(target, params, componentTime, renderMode, surfaceColor, wireColor, wireThickness, detail) {
  const pulse = clamp01(Number(params.heartPulse) || 0);
  const beat = pulse * (0.045 + 0.04 * Math.max(0, Math.sin(componentTime * 5.4)) + 0.025 * Math.max(0, Math.sin(componentTime * 10.8 + 0.9)));
  const vesselColor = anatomyShade(surfaceColor, 0.78, 1);
  const coronaryColor = anatomyShade(surfaceColor, 0.48, 1);
  target.push();
  target.rotateZ(0.09);
  target.scale(1 + beat, 1 + beat * 0.72, 1 + beat * 0.6);
  anatomyProfileVolume(target, renderMode, surfaceColor, wireColor, wireThickness, detail, [
    { x: -5, y: -58, z: 0, rx: 34, rz: 27 },
    { x: 1, y: -36, z: 2, rx: 53, rz: 35 },
    { x: 4, y: 0, z: 3, rx: 55, rz: 38 },
    { x: 2, y: 38, z: 1, rx: 43, rz: 32 },
    { x: -4, y: 73, z: -2, rx: 25, rz: 22 },
    { x: -9, y: 96, z: -4, rx: 6, rz: 8 },
  ]);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, -31, -48, 3, 29, 25, 24, 0, 0, -0.18);
  anatomyEllipsoid(target, renderMode, surfaceColor, wireColor, wireThickness, detail, 30, -45, 4, 27, 23, 23, 0, 0, 0.2);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-10, -55, 7], [-19, -102, 8], 13, 14, 11, 0.86);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-19, -102, 8], [18, -114, 5], 11, 12, 9, 0.86);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [18, -114, 5], [45, -88, 2], 9, 10, 7, 0.84);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [-17, -57, 0], [-57, -72, 1], 11, 10, 7, 0.82);
  anatomyTaperedSegment(target, renderMode, vesselColor, wireColor, wireThickness, detail, [28, -53, -1], [34, -103, -3], 12, 11, 8, 0.84);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [-7, -39, 36], [-20, 11, 39], 2.6, 2.4, 1.8, 0.62);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [-20, 11, 39], [-4, 62, 27], 1.8, 1.7, 1.2, 0.62);
  anatomyTaperedSegment(target, renderMode, coronaryColor, wireColor, Math.max(0.5, wireThickness * 0.72), Math.max(4, detail - 2), [12, -33, 38], [35, 8, 33], 2.2, 2, 1.3, 0.62);
  target.pop();
}
