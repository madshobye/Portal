import { getShaderComponent } from "./shader-registry.js?v=adaptive-component-demand-18";

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
      const fragmentSource = usesShadertoyInterface(component, code)
        ? shadertoyFragmentSource(code, component)
        : component?.type === "fragment" ? standaloneFragmentSource(code, component) : fragmentShaderSource(code, component);
      const shader = factory.createShader(vertexShaderSource(), fragmentSource);
      cache.set(key, shader);
      onStatus?.("Shader ready", "");
      return shader;
    } catch (error) {
      onStatus?.("Shader compile failed", error?.message || String(error));
      return null;
    }
  }

  function getFusedShader(jobs, target = null) {
    if (!Array.isArray(jobs) || jobs.length < 2) return jobs?.[0] ? getShader(jobs[0].pass, target) : null;
    const contextId = getContextId(target);
    const key = `${contextId}:fused:${jobs.map((job) => `${job.pass.id}:${job.component.code}`).join("|")}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const factory = typeof target?.createShader === "function" ? target : globalThis;
      const shader = factory.createShader(vertexShaderSource(), fusedFragmentShaderSource(jobs));
      cache.set(key, shader);
      onStatus?.("Fused shader ready", "");
      return shader;
    } catch (error) {
      onStatus?.("Fused shader compile failed", error?.message || String(error));
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

  return { getShader, getFusedShader, invalidateCustom, clear };
}

export function fusedUniformName(index, id) {
  return `f${index}_${id}`;
}

function usesShadertoyInterface(component, code = "") {
  if (component?.type === "shadertoy") return true;
  return /\bvoid\s+mainImage\s*\(/.test(code) && !/\bvoid\s+main\s*\(/.test(code);
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
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform float useContentTransform;
uniform mat3 contentUvMatrix;
varying vec2 vTexCoord;
void main() {
  vec2 transformedUv = (contentUvMatrix * vec3(aTexCoord, 1.0)).xy;
  vTexCoord = mix(aTexCoord, transformedUv, step(0.5, useContentTransform));
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
uniform mat3 effectUvMatrix;
uniform mat3 inverseEffectUvMatrix;
uniform sampler2D noiseTex;
uniform vec2 noiseTextureSize;
${paramUniformDeclarations(component)}
varying vec2 vTexCoord;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cachedNoise(vec2 p) {
  vec2 size = max(noiseTextureSize, vec2(1.0));
  return texture2D(noiseTex, fract((floor(p) + 0.5) / size)).r;
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
  return (effectUvMatrix * vec3(uv, 1.0)).xy;
}

vec2 inverseTransformEffectUv(vec2 uv) {
  return (inverseEffectUvMatrix * vec3(uv, 1.0)).xy;
}

float effectFieldMask(vec2 uv) {
  // Transforms change the effect coordinate field, not the component frame.
  // Keep the boundary fixed to the full component instead of a node rectangle.
  vec2 edge = abs(vTexCoord - vec2(0.5));
  return 1.0 - smoothstep(0.5, 0.535, max(edge.x, edge.y));
}

${effectCode}

void main() {
  vec2 uv = ${uvExpression};
  vec4 color = ${component?.requiresBaseSample === false ? "vec4(0.0)" : "sampleSource(uv)"};
  gl_FragColor = runEffect(uv, color);
}`;
}

function fusedFragmentShaderSource(jobs) {
  const declarations = [];
  const codeBlocks = [];
  const calls = [];
  jobs.forEach((job, index) => {
    const component = job.component;
    declarations.push(`uniform float ${fusedUniformName(index, "time")};`);
    for (const param of component.params || []) {
      declarations.push(`uniform ${uniformTypeForParam(param)} ${fusedUniformName(index, param.id)};`);
    }
    codeBlocks.push(namespaceEffectCode(component.code, component, index));
    calls.push(`color = ${fusedUniformName(index, "runEffect")}(vTexCoord, color);`);
  });
  return `
precision mediump float;
uniform sampler2D tex0;
uniform vec2 resolution;
uniform bool sourceFlipY;
uniform bool sourceForceOpaque;
uniform sampler2D noiseTex;
uniform vec2 noiseTextureSize;
${declarations.join("\n")}
varying vec2 vTexCoord;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cachedNoise(vec2 p) {
  vec2 size = max(noiseTextureSize, vec2(1.0));
  return texture2D(noiseTex, fract((floor(p) + 0.5) / size)).r;
}
vec2 sourceUv(vec2 uv) {
  vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
  return sourceFlipY ? vec2(safeUv.x, 1.0 - safeUv.y) : safeUv;
}
vec4 sampleSource(vec2 uv) {
  vec4 sampled = texture2D(tex0, sourceUv(uv));
  return sourceForceOpaque ? vec4(sampled.rgb, 1.0) : sampled;
}
${codeBlocks.join("\n")}
void main() {
  vec4 color = sampleSource(vTexCoord);
  ${calls.join("\n  ")}
  gl_FragColor = color;
}`;
}

function namespaceEffectCode(code, component, index) {
  const names = new Set(["runEffect", "time"]);
  for (const param of component.params || []) names.add(param.id);
  const functionPattern = /\b(?:float|vec[234]|mat[234]|bool|int)\s+([A-Za-z_]\w*)\s*\(/g;
  for (const match of String(code || "").matchAll(functionPattern)) names.add(match[1]);
  let namespaced = String(code || "");
  for (const name of Array.from(names).sort((a, b) => b.length - a.length)) {
    namespaced = namespaced.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"), fusedUniformName(index, name));
  }
  return namespaced;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function standaloneFragmentSource(code, component) {
  if (!hasRenderQualityParam(component) || /uniform\s+float\s+renderQuality\s*;/.test(code)) return code;
  const declaration = "uniform float renderQuality;";
  if (/precision\s+\w+\s+float\s*;/.test(code)) {
    return String(code).replace(/(precision\s+\w+\s+float\s*;)/, `$1\n${declaration}`);
  }
  return `precision mediump float;\n${declaration}\n${code}`;
}

function shadertoyFragmentSource(code, component) {
  const adaptedCode = String(code || "").replace(/\bmainImage\b/g, "vj1MainImage");
  const qualityUniform = hasRenderQualityParam(component) && !/uniform\s+float\s+renderQuality\s*;/.test(code)
    ? "uniform float renderQuality;"
    : "";
  return `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform float iFrameRate;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform float useContentTransform;
uniform mat3 contentUvMatrix;
${qualityUniform}

${adaptedCode}

void main() {
  vec4 fragColor = vec4(0.0);
  // Preserve the existing top-left Shadertoy orientation exactly, then apply
  // the same normalized source-coordinate transform used by native generators.
  vec2 baseUv = vec2(gl_FragCoord.x / iResolution.x, 1.0 - gl_FragCoord.y / iResolution.y);
  vec2 transformedUv = (contentUvMatrix * vec3(baseUv, 1.0)).xy;
  vec2 shaderUv = mix(baseUv, transformedUv, step(0.5, useContentTransform));
  vec2 shadertoyFragCoord = shaderUv * iResolution.xy;
  vj1MainImage(fragColor, shadertoyFragCoord);
  gl_FragColor = fragColor;
}`;
}

function hasRenderQualityParam(component) {
  return component?.params?.some((param) => param?.id === "renderQuality");
}

function paramUniformDeclarations(component) {
  const reserved = new Set(["tex0", "resolution", "sourceFlipY", "sourceForceOpaque", "time", "amount", "effectTransform", "effectUvMatrix", "inverseEffectUvMatrix", "noiseTex", "noiseTextureSize", "canvasSize", "texelSize"]);
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
