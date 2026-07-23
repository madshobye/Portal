export const TRANSITION_KERNEL_FORMAT_VERSION = 1;

export const TRANSITION_IMPLEMENTATION_FORMATS = Object.freeze({
  GLSL: "glsl",
  ISF: "isf",
  NODE: "node",
});

export const TRANSITION_ALPHA_MODES = Object.freeze({
  PREMULTIPLIED: "premultiplied",
  STRAIGHT: "straight",
});

const GLSL_TYPES = new Set(["float", "int", "bool", "vec2", "vec3", "vec4"]);
const RESERVED_UNIFORMS = new Set([
  "fromTex",
  "toTex",
  "uTransition",
  "uCanvasSize",
  "uHinv",
]);

export function defineTransitionKernel({
  id,
  version = "0.1.0",
  name = id,
  description = "",
  implementation = TRANSITION_IMPLEMENTATION_FORMATS.GLSL,
  source = "",
  uniforms = {},
  defaults = {},
  alpha = TRANSITION_ALPHA_MODES.PREMULTIPLIED,
  metadata = {},
} = {}) {
  const kernelId = requiredText(id, "TRANSITION_KERNEL_MISSING_ID");
  const kernelVersion = String(version || "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(kernelVersion)) {
    throw new Error(`TRANSITION_KERNEL_VERSION_INVALID:${kernelId}:${kernelVersion}`);
  }
  const format = String(implementation || "");
  if (!Object.values(TRANSITION_IMPLEMENTATION_FORMATS).includes(format)) {
    throw new Error(`TRANSITION_KERNEL_IMPLEMENTATION_UNKNOWN:${kernelId}:${format}`);
  }
  const fragmentSource = String(source || "").trim();
  if (!/\bvec4\s+vj1Transition\s*\(\s*vec4\b[\s\S]*\bfloat\b[\s\S]*\)/.test(fragmentSource)) {
    throw new Error(`TRANSITION_KERNEL_ENTRY_MISSING:${kernelId}`);
  }
  const normalizedUniforms = Object.fromEntries(Object.entries(uniforms || {}).map(([uniformId, specification]) => {
    const type = typeof specification === "string" ? specification : specification?.type;
    if (!/^[A-Za-z_]\w*$/.test(uniformId) || RESERVED_UNIFORMS.has(uniformId)) {
      throw new Error(`TRANSITION_KERNEL_UNIFORM_INVALID:${kernelId}:${uniformId}`);
    }
    if (!GLSL_TYPES.has(type)) throw new Error(`TRANSITION_KERNEL_UNIFORM_TYPE_UNKNOWN:${kernelId}:${uniformId}:${type || "missing"}`);
    return [uniformId, Object.freeze({
      type,
      parameter: String(specification?.parameter || uniformId),
      host: String(specification?.host || ""),
      defaultValue: cloneValue(specification?.defaultValue ?? defaults?.[uniformId]),
    })];
  }));
  return Object.freeze({
    formatVersion: TRANSITION_KERNEL_FORMAT_VERSION,
    id: kernelId,
    version: kernelVersion,
    name: String(name || kernelId),
    description: String(description || ""),
    implementation: format,
    source: transitionUniformDeclarations(normalizedUniforms) + fragmentSource,
    uniforms: Object.freeze(normalizedUniforms),
    alpha: Object.values(TRANSITION_ALPHA_MODES).includes(alpha)
      ? alpha
      : TRANSITION_ALPHA_MODES.PREMULTIPLIED,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function transitionKernelCacheKey(kernel = null) {
  if (!kernel) return "builtin:dissolve";
  return `${kernel.id}@${kernel.version}:${stableHash(kernel.source)}`;
}

export function transitionKernelUniformValues(kernel, parameters = {}, hostValues = {}) {
  if (!kernel) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(kernel.uniforms || {}).map(([id, specification]) => [
    id,
    cloneValue(
      (specification.host ? hostValues[specification.host] : undefined)
      ?? parameters[specification.parameter]
      ?? specification.defaultValue
    ),
  ])));
}

// Catalog parameter descriptors use editor-friendly values while WebGL
// uniforms require exact scalar/vector values. Normalize once at the renderer
// boundary so neither the mapper nor the frame loop carries UI conventions.
export function transitionParameterValues(entry = {}, authored = {}) {
  const result = {};
  const parameters = Array.isArray(entry.parameters) ? entry.parameters : [];
  for (const parameter of parameters) {
    const uniformId = String(parameter.isfUniform || parameter.id || "");
    if (!uniformId) continue;
    if (Number.isInteger(parameter.isfVectorIndex)) {
      const specification = entry.kernel?.uniforms?.[uniformId];
      const current = Array.isArray(result[uniformId])
        ? result[uniformId]
        : Array.isArray(authored[uniformId])
          ? [...authored[uniformId]]
          : Array.isArray(specification?.defaultValue)
            ? [...specification.defaultValue]
            : [0, 0];
      current[parameter.isfVectorIndex] = finiteNumber(
        authored[parameter.id],
        finiteNumber(parameter.defaultValue, current[parameter.isfVectorIndex] || 0)
      );
      result[uniformId] = current;
      continue;
    }
    const value = authored[parameter.id] ?? authored[uniformId] ?? parameter.defaultValue;
    if (parameter.isfUniformType === "color" || parameter.type === "color") {
      result[uniformId] = normalizedColor(value);
    } else if (parameter.isfUniformType === "long" && Array.isArray(parameter.isfValues)) {
      const index = parameter.values?.indexOf?.(value);
      result[uniformId] = index >= 0
        ? parameter.isfValues[index]
        : Math.round(finiteNumber(value, parameter.isfValues[0] ?? 0));
    } else if (parameter.isfUniformType === "bool" || parameter.isfUniformType === "event" || parameter.type === "boolean") {
      result[uniformId] = value === true;
    } else {
      result[uniformId] = finiteNumber(value, finiteNumber(parameter.defaultValue, 0));
    }
  }
  // Native transition kernels may expose uniforms without editor descriptors.
  for (const specification of Object.values(entry.kernel?.uniforms || {})) {
    const id = String(specification.parameter || "");
    if (id && result[id] === undefined && authored[id] !== undefined) result[id] = authored[id];
  }
  return Object.freeze(result);
}

export const DissolveTransitionKernel = defineTransitionKernel({
  id: "vj1.transition.dissolve",
  version: "1.0.0",
  name: "Dissolve",
  description: "Premultiplied linear dissolve between two prepared endpoint views.",
  source: `
vec4 vj1Transition(vec4 startColor, vec4 endColor, vec2 uv, float progress) {
  return mix(startColor, endColor, clamp(progress, 0.0, 1.0));
}`,
  metadata: {
    directMapperPass: true,
    roi: "prepared-endpoints",
  },
});

export function textureTransitionFragmentShaderSource(transitionKernel = DissolveTransitionKernel) {
  const kernel = transitionKernel || DissolveTransitionKernel;
  return `
precision highp float;
uniform sampler2D fromTex;
uniform sampler2D toTex;
uniform vec4 uFromSourceRect;
uniform vec4 uToSourceRect;
uniform float uFromOpacity;
uniform float uToOpacity;
uniform float uTransition;
varying vec2 vTexCoord;
${kernel.source}
void main() {
  vec2 uv = clamp(vTexCoord, vec2(0.0), vec2(1.0));
  vec4 startColor = texture2D(fromTex, uFromSourceRect.xy + uv * uFromSourceRect.zw) * uFromOpacity;
  vec4 endColor = texture2D(toTex, uToSourceRect.xy + uv * uToSourceRect.zw) * uToOpacity;
  vec4 color = vj1Transition(startColor, endColor, uv, clamp(uTransition, 0.0, 1.0));
  ${kernel.alpha === TRANSITION_ALPHA_MODES.STRAIGHT ? "color.rgb *= color.a;" : ""}
  gl_FragColor = color;
}`.trim();
}

export class TransitionCatalog {
  constructor(entries = []) {
    this.entries = new Map();
    this.diagnostics = [];
    this.add({
      id: DissolveTransitionKernel.id,
      version: DissolveTransitionKernel.version,
      name: DissolveTransitionKernel.name,
      description: DissolveTransitionKernel.description,
      parameters: [],
      kernel: DissolveTransitionKernel,
      origin: { kind: "built-in", id: "vj1.built-in.transitions" },
    });
    for (const entry of entries || []) this.add(entry);
    this.diagnostics = Object.freeze(this.diagnostics);
  }

  add(entry = {}) {
    const id = String(entry.id || entry.kernel?.id || "");
    if (!id || !entry.kernel) return;
    if (this.entries.has(id)) {
      const current = this.entries.get(id);
      const replacements = new Set((entry.replaces || []).map(String));
      if (replacements.has(id) || replacements.has(`${id}@${current.version || current.kernel?.version || ""}`)) {
        this.entries.set(id, Object.freeze({ ...entry, id }));
        this.diagnostics.push(Object.freeze({ code: "explicit-override", id }));
        return;
      }
      this.diagnostics.push(Object.freeze({ code: "id-collision", id }));
      return;
    }
    this.entries.set(id, Object.freeze({ ...entry, id }));
  }

  get(id = "") {
    return this.entries.get(String(id || "")) || this.entries.get(DissolveTransitionKernel.id);
  }

  list() {
    return [...this.entries.values()];
  }
}

export function createTransitionCatalog(entries = []) {
  return new TransitionCatalog(entries);
}

function transitionUniformDeclarations(uniforms) {
  const declarations = Object.entries(uniforms).map(([id, specification]) => `uniform ${specification.type} ${id};`);
  return declarations.length ? `${declarations.join("\n")}\n` : "";
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function cloneValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue));
  if (value && typeof value === "object") return Object.freeze({ ...value });
  return value;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedColor(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const channels = Array.from(value).slice(0, 4);
    while (channels.length < 4) channels.push(1);
    const scale = channels.some((channel) => Number(channel) > 1) ? 255 : 1;
    return channels.map((channel, index) =>
      Math.max(0, Math.min(1, finiteNumber(channel, index === 3 ? scale : 0) / scale))
    );
  }
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value || ""));
  if (!match) return [1, 1, 1, 1];
  const hex = match[1].length === 6 ? `${match[1]}ff` : match[1];
  return [0, 2, 4, 6].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index++) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
