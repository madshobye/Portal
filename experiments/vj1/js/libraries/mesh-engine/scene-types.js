import { listType, valueType } from "../node-engine/node-types.js";
import { isMesh } from "./mesh-types.js";

export const Material3dType = valueType("material3d", { contractVersion: 1 });
export const Object3dType = valueType("object3d", { contractVersion: 1 });
export const Object3dListType = listType(Object3dType);
export const Camera3dType = valueType("camera3d", { contractVersion: 1 });
export const Scene3dType = valueType("scene3d", { contractVersion: 1 });

export const MATERIAL_3D_MODES = Object.freeze([
  "surface",
  "points",
  "wireframe",
  "surfaceWire",
  "outline",
  "surfaceOutline",
  "xrayOutline",
]);
const MATERIAL_UNIFORM_TYPES = new Set(["float", "int", "bool", "vec2", "vec3", "vec4"]);
const MATERIAL_RESERVED_UNIFORMS = new Set(["uColor", "uMvp", "uModel", "uNormalMatrix", "uDepthCutoff", "uDepthSliceEnabled"]);

export function createTransform3d(value = {}) {
  return Object.freeze({
    kind: "transform3d",
    position: vector(value.position, 3, [0, 0, 0]),
    rotation: vector(value.rotation, 3, [0, 0, 0]),
    scale: vector(value.scale, 3, [1, 1, 1], 0.0001),
  });
}

export function createMaterial3d(value = {}) {
  const id = String(value.id || "material");
  const renderMode = MATERIAL_3D_MODES.includes(value.renderMode) ? value.renderMode : "surface";
  const shaderSource = String(value.shader?.source || value.shaderSource || "").trim();
  if (shaderSource && !/\bvec4\s+vj1Surface\s*\(/.test(shaderSource)) {
    throw new Error(`MATERIAL_3D_SHADER_ENTRY_MISSING:${id}`);
  }
  const uniforms = Object.freeze(Object.fromEntries(
    Object.entries(value.shader?.uniforms || value.uniforms || {})
      .map(([name, spec]) => [name, validateMaterialUniform(id, name, spec)])
  ));
  return Object.freeze({
    kind: "material3d",
    contractVersion: 1,
    id,
    version: String(value.version || "0.1.0"),
    renderMode,
    surfaceColor: color(value.surfaceColor, [220, 225, 220, 255]),
    wireColor: color(value.wireColor, [20, 20, 20, 220]),
    wireThickness: finite(value.wireThickness, 1),
    pointBudget: Math.max(128, Math.round(finite(value.pointBudget, 4000))),
    visibleDepth: clamp(finite(value.visibleDepth, 1), 0.02, 1),
    shader: Object.freeze({
      source: shaderSource,
      uniforms,
    }),
    metadata: Object.freeze({ ...(value.metadata || {}) }),
  });
}

export function createObject3d(value = {}) {
  if (!isMesh(value.mesh)) throw new Error(`OBJECT_3D_MESH_INVALID:${value.id || "object"}`);
  return Object.freeze({
    kind: "object3d",
    contractVersion: 1,
    id: String(value.id || "object"),
    mesh: value.mesh,
    material: value.material?.kind === "material3d" ? value.material : createMaterial3d(value.material),
    transform: value.transform?.kind === "transform3d" ? value.transform : createTransform3d(value.transform),
    visible: value.visible !== false,
    metadata: Object.freeze({ ...(value.metadata || {}) }),
  });
}

export function createCamera3d(value = {}) {
  const projection = value.projection === "orthographic" ? "orthographic" : "perspective";
  return Object.freeze({
    kind: "camera3d",
    contractVersion: 1,
    projection,
    position: vector(value.position, 3, [0, 0, 0.92]),
    target: vector(value.target, 3, [0, 0, 0]),
    up: vector(value.up, 3, [0, 1, 0]),
    fieldOfView: clamp(finite(value.fieldOfView, Math.PI / 3), 0.05, Math.PI - 0.05),
    near: Math.max(0.00001, finite(value.near, 0.0005)),
    far: Math.max(0.001, finite(value.far, 25)),
    zoom: Math.max(0.0001, finite(value.zoom, 1)),
  });
}

export function createScene3d(value = {}) {
  const objects = (value.objects || []).map((object) => object?.kind === "object3d" ? object : createObject3d(object));
  const ids = new Set();
  for (const object of objects) {
    if (ids.has(object.id)) throw new Error(`SCENE_3D_OBJECT_DUPLICATE:${object.id}`);
    ids.add(object.id);
  }
  return Object.freeze({
    kind: "scene3d",
    contractVersion: 1,
    objects: Object.freeze(objects),
    camera: value.camera?.kind === "camera3d" ? value.camera : createCamera3d(value.camera),
    background: color(value.background, [0, 0, 0, 0]),
    lights: Object.freeze([...(value.lights || [])].map((light) => Object.freeze({ ...light }))),
    metadata: Object.freeze({ ...(value.metadata || {}) }),
  });
}

export function combineObjects3d(...values) {
  return Object.freeze(values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : []));
}

function vector(value, length, fallback, minMagnitude = -Infinity) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : fallback;
  return Object.freeze(Array.from({ length }, (_, index) => {
    const result = finite(source[index], fallback[index]);
    if (minMagnitude === -Infinity) return result;
    return Math.abs(result) < minMagnitude ? Math.sign(result || 1) * minMagnitude : result;
  }));
}

function color(value, fallback) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value) : fallback;
  return Object.freeze([0, 1, 2, 3].map((index) => clamp(finite(source[index], fallback[index]), 0, 255)));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue));
  if (value && typeof value === "object") return Object.freeze({ ...value });
  return value;
}

function validateMaterialUniform(materialId, name, specification = {}) {
  const id = String(name || "");
  const type = String(specification?.type || "float");
  if (!/^[A-Za-z_]\w*$/.test(id) || MATERIAL_RESERVED_UNIFORMS.has(id)) {
    throw new Error(`MATERIAL_3D_UNIFORM_INVALID:${materialId}:${id}`);
  }
  if (!MATERIAL_UNIFORM_TYPES.has(type)) {
    throw new Error(`MATERIAL_3D_UNIFORM_TYPE_UNKNOWN:${materialId}:${id}:${type}`);
  }
  return Object.freeze({
    type,
    value: cloneValue(specification?.value),
  });
}
