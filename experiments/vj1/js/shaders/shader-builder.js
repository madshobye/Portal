import { getShaderComponent } from "./shader-registry.js?v=photo-grade-invert-1";

export function createShaderBuilder({ getCustomCode, onStatus }) {
  const cache = new Map();

  function getShader(pass, target = null) {
    const component = pass.component || getShaderComponent(pass.id);
    const code = pass.id === "custom" ? getCustomCode() : component?.code;
    if (!code) return null;
    const contextId = getContextId(target);
    const paramsKey = (component?.params || []).map((param) => `${param.type}:${param.id}`).join(",");
    const transformMode = component?.transformSource === false ? "field-transform" : "source-transform";
    const key = `${contextId}:${pass.id}:${component?.type || "effect"}:${transformMode}:${paramsKey}:${code}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const factory = typeof target?.createShader === "function" ? target : globalThis;
      const fragmentSource = component?.type === "fragment" ? code : fragmentShaderSource(code, component);
      const shader = factory.createShader(vertexShaderSource(), fragmentSource);
      cache.set(key, shader);
      onStatus?.("Shader ready", "");
      return shader;
    } catch (error) {
      onStatus?.("Shader compile failed", error?.message || String(error));
      return null;
    }
  }

  function invalidateCustom() {
    for (const key of Array.from(cache.keys())) {
      if (key.includes(":custom:")) cache.delete(key);
    }
  }

  function clear() {
    cache.clear();
  }

  return { getShader, invalidateCustom, clear };
}

let nextContextId = 1;

function getContextId(target) {
  if (!target) return "global";
  if (!target.__vj1ShaderContextId) {
    Object.defineProperty(target, "__vj1ShaderContextId", {
      value: `ctx${nextContextId++}`,
      configurable: false,
    });
  }
  return target.__vj1ShaderContextId;
}

function vertexShaderSource() {
  return `
precision mediump float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;
}

function fragmentShaderSource(effectCode, component = null) {
  const uvExpression = component?.transformSource === false ? "vTexCoord" : "transformEffectUv(vTexCoord)";
  return `
precision mediump float;
uniform sampler2D tex0;
uniform vec2 resolution;
uniform bool sourceFlipY;
uniform bool sourceForceOpaque;
uniform float time;
uniform float amount;
uniform vec4 effectTransform;
${paramUniformDeclarations(component)}
varying vec2 vTexCoord;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 sourceUv(vec2 uv) {
  vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
  return sourceFlipY ? vec2(safeUv.x, 1.0 - safeUv.y) : safeUv;
}

vec4 sampleSource(vec2 uv) {
  vec4 sampled = texture2D(tex0, sourceUv(uv));
  return sourceForceOpaque ? vec4(sampled.rgb, 1.0) : sampled;
}

vec2 effectScreenUv() {
  return vec2(vTexCoord.x, 1.0 - vTexCoord.y);
}

vec2 textureUvFromEffectScreenUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

vec2 transformEffectUv(vec2 uv) {
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float scale = max(effectTransform.z, 0.0001);
  float rotation = effectTransform.w;
  vec2 p = uv - center;
  float c = cos(-rotation);
  float s = sin(-rotation);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) / scale;
  return p + vec2(0.5);
}

vec2 inverseTransformEffectUv(vec2 uv) {
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float scale = max(effectTransform.z, 0.0001);
  float rotation = effectTransform.w;
  vec2 p = (uv - vec2(0.5)) * scale;
  float c = cos(rotation);
  float s = sin(rotation);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  return p + center;
}

float effectFieldMask(vec2 uv) {
  vec2 edge = abs(uv - vec2(0.5));
  return 1.0 - smoothstep(0.5, 0.535, max(edge.x, edge.y));
}

${effectCode}

void main() {
  vec2 uv = ${uvExpression};
  vec4 color = sampleSource(uv);
  gl_FragColor = runEffect(uv, color);
}`;
}

function paramUniformDeclarations(component) {
  const reserved = new Set(["tex0", "resolution", "sourceFlipY", "sourceForceOpaque", "time", "amount", "effectTransform", "canvasSize", "texelSize"]);
  return (component?.params || [])
    .filter((param) => param?.id && !reserved.has(param.id))
    .map((param) => `uniform ${uniformTypeForParam(param)} ${param.id};`)
    .join("\n");
}

function uniformTypeForParam(param) {
  if (param.type === "boolean") return "bool";
  if (param.type === "color") return "vec4";
  return "float";
}
