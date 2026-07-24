export function createProfileMesh(options = {}) {
  const segments = normalizedSegments(options.segments);
  const profile = normalizedProfile(options.profile);
  if (profile.length < 2) throw new Error("PROFILE_MESH_REQUIRES_TWO_SLICES");
  const transform = normalizedTransform(options.transform);
  const rings = profile.map((slice) => unitRing(segments).map(([cosine, sine]) =>
    transformPoint([
      slice.x + cosine * slice.radiusX,
      slice.y,
      slice.z + sine * slice.radiusZ,
    ], transform)
  ));
  return createRingsMesh(rings, {
    capStart: options.capStart !== false,
    capEnd: options.capEnd !== false,
    metadata: {
      generator: "core.scene3d.profile-mesh",
      segments,
      slices: profile.length,
    },
  });
}

export function createPathTubeMesh(options = {}) {
  const segments = normalizedSegments(options.segments);
  const path = normalizedPath(options.path);
  if (path.length < 2) throw new Error("PATH_TUBE_MESH_REQUIRES_TWO_POINTS");
  const transform = normalizedTransform(options.transform);
  const ring = unitRing(segments);
  const rings = path.map((slice, index) => {
    const previous = path[Math.max(0, index - 1)].point;
    const next = path[Math.min(path.length - 1, index + 1)].point;
    const direction = normalize(subtract(next, previous));
    const reference = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const axisA = normalize(cross(direction, reference));
    const axisB = normalize(cross(direction, axisA));
    return ring.map(([cosine, sine]) => transformPoint([
      slice.point[0] + axisA[0] * cosine * slice.radius +
        axisB[0] * sine * slice.radius * slice.depthScale,
      slice.point[1] + axisA[1] * cosine * slice.radius +
        axisB[1] * sine * slice.radius * slice.depthScale,
      slice.point[2] + axisA[2] * cosine * slice.radius +
        axisB[2] * sine * slice.radius * slice.depthScale,
    ], transform));
  });
  return createRingsMesh(rings, {
    capStart: options.capStart !== false,
    capEnd: options.capEnd !== false,
    metadata: {
      generator: "core.scene3d.path-tube-mesh",
      segments,
      pathPoints: path.length,
    },
  });
}

export function createTaperedSegmentMesh(options = {}) {
  const start = vector(options.start, [0, -1, 0]);
  const end = vector(options.end, [0, 1, 0]);
  const startRadius = positive(options.startRadius, 1);
  const middleRadius = positive(options.middleRadius, startRadius);
  const endRadius = positive(options.endRadius, middleRadius);
  const depthScale = positive(options.depthScale, 0.82);
  return createPathTubeMesh({
    path: [
      { point: start, radius: startRadius, depthScale },
      { point: mixPoint(start, end, 0.34), radius: middleRadius, depthScale },
      {
        point: mixPoint(start, end, 0.72),
        radius: middleRadius * 0.9 + endRadius * 0.1,
        depthScale,
      },
      { point: end, radius: endRadius, depthScale },
    ],
    segments: options.segments,
    capStart: options.capStart,
    capEnd: options.capEnd,
    transform: options.transform,
  });
}

export function createEllipsoidMesh(options = {}) {
  const segments = normalizedSegments(options.segments);
  const latitudeSegments = Math.max(3, Math.min(128,
    Math.round(finite(options.latitudeSegments, segments))));
  const center = vector(options.center, [0, 0, 0]);
  const radii = vector(options.radii, [1, 1, 1]).map((value) => Math.max(0.0001, Math.abs(value)));
  const rotation = vector(options.rotation, [0, 0, 0]);
  const transform = normalizedTransform(options.transform);
  const rings = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const phi = -Math.PI * 0.5 + latitude * Math.PI / latitudeSegments;
    const ringRadius = Math.cos(phi);
    const y = Math.sin(phi);
    rings.push(unitRing(segments).map(([cosine, sine]) => {
      const local = rotatePoint([
        cosine * radii[0] * ringRadius,
        y * radii[1],
        sine * radii[2] * ringRadius,
      ], rotation);
      return transformPoint([
        center[0] + local[0],
        center[1] + local[1],
        center[2] + local[2],
      ], transform);
    }));
  }
  return createRingsMesh(rings, {
    capStart: false,
    capEnd: false,
    metadata: {
      generator: "core.scene3d.ellipsoid-mesh",
      segments,
      latitudeSegments,
    },
  });
}

export function proceduralMeshSignature(value = {}) {
  return JSON.stringify(normalizeSignatureValue(value));
}

export function createRingsMesh(rings, {
  capStart = true,
  capEnd = true,
  metadata = {},
} = {}) {
  if (!Array.isArray(rings) || rings.length < 2 || rings.some((ring) => !Array.isArray(ring))) {
    throw new Error("RINGS_MESH_INVALID");
  }
  const sides = rings[0].length;
  if (sides < 3 || rings.some((ring) => ring.length !== sides)) {
    throw new Error("RINGS_MESH_SIDE_COUNT_INVALID");
  }
  const triangles = [];
  for (let row = 0; row < rings.length - 1; row += 1) {
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      triangles.push([rings[row][side], rings[row + 1][side], rings[row + 1][next]]);
      triangles.push([rings[row][side], rings[row + 1][next], rings[row][next]]);
    }
  }
  if (capStart) addCap(triangles, rings[0], true);
  if (capEnd) addCap(triangles, rings[rings.length - 1], false);
  return createTriangleSoupMesh(triangles, metadata);
}

export function createTriangleSoupMesh(triangles, metadata = {}) {
  const positions = new Float32Array(triangles.length * 9);
  const faceNormals = new Float32Array(triangles.length * 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let positionOffset = 0;
  let normalOffset = 0;
  for (const triangle of triangles) {
    const normal = normalize(cross(
      subtract(triangle[1], triangle[0]),
      subtract(triangle[2], triangle[0]),
    ));
    for (const point of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        positions[positionOffset++] = point[axis];
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    faceNormals[normalOffset++] = normal[0];
    faceNormals[normalOffset++] = normal[1];
    faceNormals[normalOffset++] = normal[2];
  }
  const bounds = Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
  });
  return Object.freeze({
    kind: "mesh",
    representation: "triangle-soup",
    positions,
    faceNormals,
    triangleCount: triangles.length,
    bounds,
    sourceBounds: bounds,
    metadata: Object.freeze({ ...metadata }),
  });
}

function normalizedProfile(profile) {
  return (Array.isArray(profile) ? profile : []).map((slice) => ({
    x: finite(slice?.x, 0),
    y: finite(slice?.y, 0),
    z: finite(slice?.z, 0),
    radiusX: Math.max(0.0001, Math.abs(finite(slice?.radiusX ?? slice?.rx, 0.5))),
    radiusZ: Math.max(0.0001, Math.abs(finite(slice?.radiusZ ?? slice?.rz, 0.5))),
  }));
}

function normalizedPath(path) {
  return (Array.isArray(path) ? path : []).map((slice) => ({
    point: vector(slice?.point, [0, 0, 0]),
    radius: Math.max(0.0001, Math.abs(finite(slice?.radius, 0.5))),
    depthScale: Math.max(0.0001, Math.abs(finite(slice?.depthScale, 0.82))),
  }));
}

function normalizedSegments(value) {
  return Math.max(3, Math.min(256, Math.round(finite(value, 8))));
}

function normalizedTransform(value = {}) {
  return {
    position: vector(value?.position, [0, 0, 0]),
    rotation: vector(value?.rotation, [0, 0, 0]),
    scale: vector(value?.scale, [1, 1, 1]),
  };
}

function transformPoint(point, transform) {
  const rotated = rotatePoint([
    point[0] * transform.scale[0],
    point[1] * transform.scale[1],
    point[2] * transform.scale[2],
  ], transform.rotation);
  return [
    rotated[0] + transform.position[0],
    rotated[1] + transform.position[1],
    rotated[2] + transform.position[2],
  ];
}

function rotatePoint(point, rotation) {
  let [x, y, z] = point;
  const [rx, ry, rz] = rotation;
  if (rx) {
    const cosine = Math.cos(rx);
    const sine = Math.sin(rx);
    [y, z] = [y * cosine - z * sine, y * sine + z * cosine];
  }
  if (ry) {
    const cosine = Math.cos(ry);
    const sine = Math.sin(ry);
    [x, z] = [x * cosine + z * sine, -x * sine + z * cosine];
  }
  if (rz) {
    const cosine = Math.cos(rz);
    const sine = Math.sin(rz);
    [x, y] = [x * cosine - y * sine, x * sine + y * cosine];
  }
  return [x, y, z];
}

function addCap(triangles, ringPoints, reverse) {
  const center = ringPoints.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0],
  ).map((value) => value / ringPoints.length);
  for (let side = 0; side < ringPoints.length; side += 1) {
    const next = (side + 1) % ringPoints.length;
    triangles.push(reverse
      ? [center, ringPoints[next], ringPoints[side]]
      : [center, ringPoints[side], ringPoints[next]]);
  }
}

function unitRing(segments) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return [Math.cos(angle), Math.sin(angle)];
  });
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector) {
  const inverse = 1 / Math.max(0.000001, Math.hypot(vector[0], vector[1], vector[2]));
  return [vector[0] * inverse, vector[1] * inverse, vector[2] * inverse];
}

function vector(value, fallback) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : fallback;
  return [0, 1, 2].map((index) => finite(source[index], fallback[index]));
}

function mixPoint(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function positive(value, fallback) {
  return Math.max(0.0001, Math.abs(finite(value, fallback)));
}

function normalizeSignatureValue(value) {
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(normalizeSignatureValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, normalizeSignatureValue(value[key])]
    ));
  }
  return Number.isFinite(value) ? value : value ?? null;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
