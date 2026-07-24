export function createArmPath({
  shoulder = [0, -96, 0],
  mirror = 1,
  scale = 1,
  bend = 0.25,
  includeHand = true,
} = {}) {
  const side = finite(mirror, 1) < 0 ? -1 : 1;
  const size = Math.max(0.0001, Math.abs(finite(scale, 1)));
  const amount = clamp(finite(bend, 0.25), -1, 1);
  const root = vector(shoulder, [0, -96, 0]);
  const upperAngle = side * (0.08 + amount * 0.12);
  const forearmAngle = upperAngle - side * amount * 0.72;
  const elbow = advanceDown(root, upperAngle, 82 * size);
  const wrist = advanceDown(elbow, forearmAngle, 78 * size);
  const hand = advanceDown(wrist, forearmAngle * 0.86, 25 * size);
  const fingertips = advanceDown(hand, forearmAngle * 0.72, 17 * size);
  return [
    slice(root, 23 * size, 0.88),
    slice(mixPoint(root, elbow, 0.2), 22 * size, 0.86),
    slice(mixPoint(root, elbow, 0.48), 23.5 * size, 0.84),
    slice(mixPoint(root, elbow, 0.84), 15.5 * size, 0.82),
    slice(elbow, 14 * size, 0.86),
    slice(mixPoint(elbow, wrist, 0.2), 15 * size, 0.82),
    slice(mixPoint(elbow, wrist, 0.48), 16.5 * size, 0.78),
    slice(mixPoint(elbow, wrist, 0.82), 10 * size, 0.76),
    slice(wrist, 8.5 * size, 0.74),
    ...(includeHand ? [
      slice(hand, 12 * size, 0.62),
      slice(fingertips, 5.5 * size, 0.56),
    ] : []),
  ];
}

export function createLegPath({
  hip = [0, -105, 0],
  mirror = 1,
  scale = 1,
  bend = 0.25,
} = {}) {
  const side = finite(mirror, 1) < 0 ? -1 : 1;
  const size = Math.max(0.0001, Math.abs(finite(scale, 1)));
  const amount = clamp(finite(bend, 0.25), -1, 1);
  const root = vector(hip, [0, -105, 0]);
  const thighAngle = side * (0.025 + amount * 0.08);
  const shinAngle = thighAngle - side * amount * 0.58;
  const knee = advanceDown(root, thighAngle, 88 * size);
  const ankle = advanceDown(knee, shinAngle, 86 * size);
  const toe = [
    ankle[0] + side * 5 * size,
    ankle[1] + 19 * size,
    ankle[2] + 50 * size,
  ];
  return [
    slice(root, 27 * size, 0.9),
    slice(mixPoint(root, knee, 0.2), 26 * size, 0.88),
    slice(mixPoint(root, knee, 0.5), 28 * size, 0.86),
    slice(mixPoint(root, knee, 0.84), 19 * size, 0.84),
    slice(knee, 17 * size, 0.88),
    slice(mixPoint(knee, ankle, 0.2), 20 * size, 0.84),
    slice(mixPoint(knee, ankle, 0.48), 21 * size, 0.8),
    slice(mixPoint(knee, ankle, 0.84), 11 * size, 0.76),
    slice(ankle, 9 * size, 0.74),
    slice(mixPoint(ankle, toe, 0.56), 18 * size, 0.68),
    slice(toe, 7 * size, 0.62),
  ];
}

function slice(point, radius, depthScale) {
  return { point, radius, depthScale };
}

function advanceDown(point, angle, length) {
  return [
    point[0] + Math.sin(angle) * length,
    point[1] + Math.cos(angle) * length,
    point[2],
  ];
}

function mixPoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function vector(value, fallback) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : fallback;
  return [0, 1, 2].map((index) => finite(source[index], fallback[index]));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
