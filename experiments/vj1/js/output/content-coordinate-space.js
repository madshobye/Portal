import {
  markRenderTargetOrientation,
  renderTargetNeedsPresentationFlip,
  RENDER_TEXTURE_ORIENTATION,
} from "./render-target-contract.js";

// Canonical chain-content coordinates are screen oriented everywhere. A
// source transform changes the coordinates evaluated inside the Composition
// frame; it never changes that frame's rectangle or allocation.
// +x moves right, +y moves down, and positive rotation is clockwise.
// Renderers must convert at their boundary instead of reinterpreting stored
// transforms in generator, UV, camera, or clip-space coordinates.
export const CONTENT_COORDINATE_CONVENTION = Object.freeze({
  x: "right",
  y: "down",
  rotation: "clockwise",
});

export const RENDER_TARGET_ORIENTATION = Object.freeze({
  composition: RENDER_TEXTURE_ORIENTATION.topLeft,
  rawWebGL: RENDER_TEXTURE_ORIENTATION.bottomLeft,
});

export { markRenderTargetOrientation, renderTargetNeedsPresentationFlip };

export function normalizedContentTransform(transform = {}) {
  return {
    x: normalizedPosition(transform.x),
    y: normalizedPosition(transform.y),
    scale: Math.max(0.0001, Number(transform.scale) || 1),
    rotation: Number(transform.rotation) || 0,
  };
}

export function isIdentityTransform(transform = {}) {
  const value = normalizedContentTransform(transform);
  return Math.abs(value.x - 0.5) < 0.000001
    && Math.abs(value.y - 0.5) < 0.000001
    && !Number(transform.rotation)
    && (transform.scale === undefined || Number(transform.scale) === 1);
}

export function combineContentTransforms(parent = {}, child = {}) {
  const outer = normalizedContentTransform(parent);
  const inner = normalizedContentTransform(child);
  const cosine = Math.cos(outer.rotation);
  const sine = Math.sin(outer.rotation);
  const outerX = outer.x - 0.5;
  const outerY = outer.y - 0.5;
  const childX = (inner.x - 0.5) * outer.scale;
  const childY = (inner.y - 0.5) * outer.scale;
  return {
    x: 0.5 + outerX + childX * cosine - childY * sine,
    y: 0.5 + outerY + childX * sine + childY * cosine,
    scale: outer.scale * inner.scale,
    rotation: outer.rotation + inner.rotation,
  };
}

export function contentTransformCanvasPlacement(transform = {}, width = 1, height = 1) {
  const value = normalizedContentTransform(transform);
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  return {
    ...value,
    centerX: safeWidth * value.x,
    centerY: safeHeight * value.y,
  };
}

// Shader transforms sample the source through the inverse of the visible
// screen-space transform: the destination center after moving right/down maps
// back to the source center. Matrices are returned column-major for WebGL.
export function contentTransformUvMatrices(transform = {}, output = null) {
  const reusable = output?.value && output?.sampling?.length >= 9 && output?.placement?.length >= 9;
  const result = reusable ? output : {
    value: { x: 0, y: 0, scale: 1, rotation: 0 },
    sampling: new Array(9),
    placement: new Array(9),
  };
  const value = result.value;
  value.x = normalizedPosition(transform.x);
  value.y = normalizedPosition(transform.y);
  value.scale = Math.max(0.0001, Number(transform.scale) || 1);
  value.rotation = Number(transform.rotation) || 0;
  const centerX = value.x;
  const centerY = value.y;
  const cosine = Math.cos(-value.rotation);
  const sine = Math.sin(-value.rotation);
  const a = cosine / value.scale;
  const b = -sine / value.scale;
  const d = sine / value.scale;
  const e = cosine / value.scale;
  const tx = 0.5 - a * centerX - b * centerY;
  const ty = 0.5 - d * centerX - e * centerY;

  const inverseCosine = Math.cos(value.rotation) * value.scale;
  const inverseSine = Math.sin(value.rotation) * value.scale;
  const ia = inverseCosine;
  const ib = -inverseSine;
  const id = inverseSine;
  const ie = inverseCosine;
  const itx = centerX - ia * 0.5 - ib * 0.5;
  const ity = centerY - id * 0.5 - ie * 0.5;
  const sampling = result.sampling;
  sampling[0] = a;
  sampling[1] = d;
  sampling[2] = 0;
  sampling[3] = b;
  sampling[4] = e;
  sampling[5] = 0;
  sampling[6] = tx;
  sampling[7] = ty;
  sampling[8] = 1;
  const placement = result.placement;
  placement[0] = ia;
  placement[1] = id;
  placement[2] = 0;
  placement[3] = ib;
  placement[4] = ie;
  placement[5] = 0;
  placement[6] = itx;
  placement[7] = ity;
  placement[8] = 1;
  return result;
}

export function localContentDragDelta(dx = 0, dy = 0, parentTransform = {}, frameWidth = 1, frameHeight = 1) {
  const parent = normalizedContentTransform(parentTransform);
  const cosine = Math.cos(-parent.rotation);
  const sine = Math.sin(-parent.rotation);
  const scaledX = Number(dx) / Math.max(0.01, parent.scale);
  const scaledY = Number(dy) / Math.max(0.01, parent.scale);
  return {
    x: (scaledX * cosine - scaledY * sine) / Math.max(1, Number(frameWidth)),
    y: (scaledX * sine + scaledY * cosine) / Math.max(1, Number(frameHeight)),
  };
}

// Raw WebGL model coordinates are Y-up and rotate counter-clockwise. Convert
// the persisted screen-oriented transform exactly once at that boundary.
export function contentTransformRawWebglPlacement(transform = {}, width = 1, height = 1) {
  const value = normalizedContentTransform(transform);
  return {
    x: (value.x - 0.5) * Math.max(1, Number(width) || 1),
    y: -(value.y - 0.5) * Math.max(1, Number(height) || 1),
    scale: value.scale,
    rotation: -value.rotation,
  };
}

function normalizedPosition(value) {
  const number = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0.5));
}
