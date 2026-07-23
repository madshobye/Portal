import { FULL_RENDER_UV_RECT, normalizeRenderUvRect, renderView } from "../render-engine/render-view/index.js";

export function modelRotation(params = {}, componentTime = 0, importBasis = [0, 0, 0]) {
  return [
    (Number(importBasis[0]) || 0) + (Number(params.rotationX) || 0) + componentTime * (Number(params.spinX) || 0),
    (Number(importBasis[1]) || 0) + (Number(params.rotationY) || 0) + componentTime * (Number(params.spinY) || 0),
    (Number(importBasis[2]) || 0) + (Number(params.rotationZ) || 0) + componentTime * (Number(params.spinZ) || 0),
  ];
}

// STL has no camera/up-axis metadata. VJ1 therefore owns one documented
// import-basis adapter instead of scattering compensating rotations through
// raw WebGL, p5 geometry, previews, and output surfaces.
export function modelImportBasis(item = {}) {
  const path = String(item.file?.relativePath || item.file?.webkitRelativePath || item.file?.name || item.id || "");
  return /\.stl$/i.test(path) ? [0, 0, Math.PI] : [0, 0, 0];
}

export function modelWireThickness(params = {}) {
  return Math.max(0.5, Math.min(12, Number(params.wireThickness) || 1));
}

// Perceptual outlines describe the object's visual contour and need slightly
// more weight than construction wireframe edges at the same user setting.
export function modelOutlineThickness(params = {}) {
  return modelWireThickness(params) * 1.35;
}

// Perspective uses the vertical dimension of a 36x24 mm full-frame sensor.
// The 20.8 mm default reproduces VJ1's original 60-degree vertical field of view.
export function modelCameraFov(params = {}) {
  const requested = Number(params.focalLength);
  const focalLength = Math.max(8, Math.min(200, Number.isFinite(requested) ? requested : 20.7846096908));
  return 2 * Math.atan(12 / focalLength);
}

// Model coordinates, camera distance, and model scale all use the render
// height as their physical unit. Keep the clip volume in that same unit so a
// quality/resolution change cannot remove the back of an otherwise identical
// model. The ratios preserve the original 0.1..5000 volume at 200 px while
// keeping the same depth precision at every resolution.
export function modelCameraClipPlanes(height = 1) {
  const verticalUnit = Math.max(1, Number(height) || 1);
  return {
    near: verticalUnit * 0.0005,
    far: verticalUnit * 25,
  };
}

export function modelDepthCutoff(params = {}, bounds = null, modelMatrix = null) {
  const requestedDepth = Number(params.visibleDepth);
  const visibleDepth = Math.max(0.02, Math.min(1, Number.isFinite(requestedDepth) ? requestedDepth : 1));
  const range = transformedModelDepthRange(bounds, modelMatrix);
  if (visibleDepth >= 1) {
    // Full depth is a true no-slice state. Using the exact minimum as the
    // fragment threshold made the deepest faces depend on interpolator
    // precision, so STL/OBJ meshes could lose their backmost layer at 100%.
    const span = Math.max(1, range.max - range.min);
    return range.min - span * 0.0001;
  }
  return range.max - visibleDepth * (range.max - range.min);
}

export function modelDepthSliceEnabled(params = {}) {
  const requestedDepth = Number(params.visibleDepth);
  const visibleDepth = Math.max(0.02, Math.min(1, Number.isFinite(requestedDepth) ? requestedDepth : 1));
  return visibleDepth < 1;
}

export function transformedModelDepthRange(bounds = null, modelMatrix = null) {
  const min = validModelBound(bounds?.min, [-50, -50, -50]);
  const max = validModelBound(bounds?.max, [50, 50, 50]);
  const matrix = modelMatrix?.length === 16 ? modelMatrix : mat4Identity();
  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const depth = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        minDepth = Math.min(minDepth, depth);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
  }
  return Number.isFinite(minDepth) && Number.isFinite(maxDepth)
    ? { min: minDepth, max: maxDepth }
    : { min: -50, max: 50 };
}

export function modelViewportMetrics(target, request = {}) {
  const view = renderView(target, request);
  const width = view.width;
  const height = view.height;
  const logicalWidth = view.logicalWidth;
  const logicalHeight = view.logicalHeight;
  const verticalUnit = height;
  return {
    width,
    height,
    renderWidth: view.allocationWidth,
    renderHeight: view.allocationHeight,
    logicalWidth,
    logicalHeight,
    uvRect: view.uvRect,
    cameraZ: verticalUnit * 0.92,
    unitScale: verticalUnit * 0.0065,
  };
}

export function rawModelMatrices(
  width = 1,
  height = 1,
  scale = 1,
  depth = 1,
  rotation = [0, 0, 0],
  contentTransform = {},
  cameraFov = Math.PI / 3,
  uvRect = FULL_RENDER_UV_RECT,
  sceneTransform = null,
  sceneCamera = null
) {
  const verticalUnit = Math.max(1, Number(height) || 1);
  const clip = sceneCamera
    ? {
      near: Math.max(verticalUnit * 0.00001, Number(sceneCamera.near) * verticalUnit || verticalUnit * 0.0005),
      far: Math.max(verticalUnit * 0.001, Number(sceneCamera.far) * verticalUnit || verticalUnit * 25),
    }
    : modelCameraClipPlanes(height);
  const fieldOfView = Number(sceneCamera?.fieldOfView) || cameraFov;
  const aspect = width / Math.max(1, height);
  const projection = sceneCamera?.projection === "orthographic"
    ? mat4Orthographic(
      -aspect / Math.max(0.0001, Number(sceneCamera.zoom) || 1) * verticalUnit * 0.5,
      aspect / Math.max(0.0001, Number(sceneCamera.zoom) || 1) * verticalUnit * 0.5,
      -verticalUnit * 0.5 / Math.max(0.0001, Number(sceneCamera.zoom) || 1),
      verticalUnit * 0.5 / Math.max(0.0001, Number(sceneCamera.zoom) || 1),
      clip.near,
      clip.far
    )
    : mat4Perspective(fieldOfView, aspect, clip.near, clip.far);
  const cameraPosition = sceneCamera
    ? sceneCamera.position.map((value) => Number(value) * verticalUnit)
    : [0, 0, verticalUnit * 0.92];
  const cameraTarget = sceneCamera
    ? sceneCamera.target.map((value) => Number(value) * verticalUnit)
    : [0, 0, 0];
  const cameraUp = sceneCamera?.up || [0, 1, 0];
  const view = mat4LookAt(cameraPosition, cameraTarget, cameraUp);
  let model = mat4Identity();
  if (!isIdentityTransform(contentTransform)) {
    const content = contentTransformRawWebglPlacement(contentTransform, width, height);
    model = mat4Multiply(model, mat4Translation(content.x, content.y, 0));
    model = mat4Multiply(model, mat4RotationZ(content.rotation));
    model = mat4Multiply(model, mat4Scale(content.scale, content.scale, content.scale));
  }
  const objectPosition = sceneTransform?.position || [0, 0, 0];
  const objectRotation = sceneTransform?.rotation || [0, 0, 0];
  const objectScale = sceneTransform?.scale || [1, 1, 1];
  model = mat4Multiply(model, mat4Translation(
    (Number(objectPosition[0]) || 0) * verticalUnit,
    (Number(objectPosition[1]) || 0) * verticalUnit,
    (Number(objectPosition[2]) || 0) * verticalUnit
  ));
  model = mat4Multiply(model, mat4RotationX((rotation[0] || 0) + (Number(objectRotation[0]) || 0)));
  model = mat4Multiply(model, mat4RotationY((rotation[1] || 0) + (Number(objectRotation[1]) || 0)));
  model = mat4Multiply(model, mat4RotationZ((rotation[2] || 0) + (Number(objectRotation[2]) || 0)));
  model = mat4Multiply(model, mat4Scale(
    scale * (Number(objectScale[0]) || 1),
    scale * (Number(objectScale[1]) || 1),
    scale * depth * (Number(objectScale[2]) || 1)
  ));
  return {
    model,
    // Project in the complete boundary, then remap only the requested NDC
    // window onto the small ROI target. This is equivalent to cropping a full
    // model render but avoids allocating or shading the invisible pixels.
    mvp: mat4Multiply(mat4ViewportCrop(uvRect), mat4Multiply(mat4Multiply(projection, view), model)),
  };
}

export function applyModelViewportProjection(target, cameraFov = Math.PI / 3, viewport = {}) {
  const width = Math.max(1, Number(viewport.width) || Number(target?.width) || 1);
  const height = Math.max(1, Number(viewport.height) || Number(target?.height) || 1);
  const uv = normalizeRenderUvRect(viewport.uvRect);
  const { near, far } = modelCameraClipPlanes(height);
  if (isFullUvRect(uv) || typeof target?.frustum !== "function") {
    target?.perspective?.(cameraFov, width / height, near, far);
    return;
  }
  const top = near * Math.tan(cameraFov * 0.5);
  const bottom = -top;
  const right = top * width / height;
  const left = -right;
  const cropLeft = left + (right - left) * uv[0];
  const cropRight = left + (right - left) * (uv[0] + uv[2]);
  const cropTop = top + (bottom - top) * uv[1];
  const cropBottom = top + (bottom - top) * (uv[1] + uv[3]);
  target.frustum(cropLeft, cropRight, cropBottom, cropTop, near, far);
}

// Raw WebGL model coordinates are Y-up and rotate counter-clockwise. This
// adapter stays with the render node so the live path does not depend on the
// application output coordinate module.
function contentTransformRawWebglPlacement(transform = {}, width = 1, height = 1) {
  const normalized = {
    x: Math.max(-2, Math.min(2, Number(transform.x) || 0)),
    y: Math.max(-2, Math.min(2, Number(transform.y) || 0)),
    scale: Math.max(0.05, Math.min(20, Number(transform.scale) || 1)),
    rotation: Number(transform.rotation) || 0,
  };
  return {
    x: normalized.x * Math.max(1, Number(width) || 1) * 0.5,
    y: -normalized.y * Math.max(1, Number(height) || 1) * 0.5,
    scale: normalized.scale,
    rotation: -normalized.rotation,
  };
}

export function modelNormalMatrix(modelMatrix) {
  if (!modelMatrix || modelMatrix.length !== 16) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const a = modelMatrix[0], b = modelMatrix[4], c = modelMatrix[8];
  const d = modelMatrix[1], e = modelMatrix[5], f = modelMatrix[9];
  const g = modelMatrix[2], h = modelMatrix[6], i = modelMatrix[10];
  const c00 = e * i - f * h;
  const c01 = f * g - d * i;
  const c02 = d * h - e * g;
  const c10 = c * h - b * i;
  const c11 = a * i - c * g;
  const c12 = b * g - a * h;
  const c20 = b * f - c * e;
  const c21 = c * d - a * f;
  const c22 = a * e - b * d;
  const determinant = a * c00 + b * c01 + c * c02;
  if (Math.abs(determinant) < 0.000000001) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const inverseDeterminant = 1 / determinant;
  return new Float32Array([
    c00 * inverseDeterminant, c10 * inverseDeterminant, c20 * inverseDeterminant,
    c01 * inverseDeterminant, c11 * inverseDeterminant, c21 * inverseDeterminant,
    c02 * inverseDeterminant, c12 * inverseDeterminant, c22 * inverseDeterminant,
  ]);
}

function validModelBound(value, fallback) {
  return Array.isArray(value) && value.length >= 3 && value.every((entry) => Number.isFinite(Number(entry)))
    ? value.slice(0, 3).map(Number)
    : fallback;
}

function normalizedContentTransform(transform = {}) {
  return {
    x: Math.max(-2, Math.min(2, Number(transform.x) || 0)),
    y: Math.max(-2, Math.min(2, Number(transform.y) || 0)),
    scale: Math.max(0.05, Math.min(20, Number(transform.scale) || 1)),
    rotation: Number(transform.rotation) || 0,
  };
}

function isIdentityTransform(transform = {}) {
  const normalized = normalizedContentTransform(transform);
  return Math.abs(normalized.x) < 0.000001
    && Math.abs(normalized.y) < 0.000001
    && Math.abs(normalized.scale - 1) < 0.000001
    && Math.abs(normalized.rotation) < 0.000001;
}

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0,
  ]);
}

function mat4Orthographic(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  return new Float32Array([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (left + right) * lr,
    (top + bottom) * bt,
    (far + near) * nf,
    1,
  ]);
}

function mat4ViewportCrop(value) {
  const uv = normalizeRenderUvRect(value);
  const scaleX = 1 / uv[2];
  const scaleY = 1 / uv[3];
  return new Float32Array([
    scaleX, 0, 0, 0,
    0, scaleY, 0, 0,
    0, 0, 1, 0,
    (1 - 2 * uv[0] - uv[2]) * scaleX,
    (2 * uv[1] + uv[3] - 1) * scaleY,
    0,
    1,
  ]);
}

function isFullUvRect(uv) {
  return Math.abs(uv[0]) < 1e-9 && Math.abs(uv[1]) < 1e-9 &&
    Math.abs(uv[2] - 1) < 1e-9 && Math.abs(uv[3] - 1) < 1e-9;
}

function mat4LookAt(eye, center, up) {
  const z = normalize3([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function mat4RotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Scale(x, y, z) {
  return new Float32Array([
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Translation(x, y, z) {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function normalize3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
