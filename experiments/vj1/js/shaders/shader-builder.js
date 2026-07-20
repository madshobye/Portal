import { getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js?v=node-catalog-14";

export function createShaderBuilder({ getCustomCode, onStatus, getComponent = getShaderComponent } = {}) {
  const cache = new Map();

  function getShader(pass, target = null) {
    const component = pass.component || getComponent(pass.id);
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
      console.error("[VJ1_SHADER_COMPILE_FAILED]", { shader: pass.id, message: error?.message || String(error) });
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
      console.error("[VJ1_FUSED_SHADER_COMPILE_FAILED]", {
        shaders: jobs.map((job) => job?.pass?.id || "unknown"),
        message: error?.message || String(error),
      });
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
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;
}

function fragmentShaderSource(effectCode, component = null) {
  return `
precision mediump float;
uniform sampler2D tex0;
uniform vec2 resolution;
uniform vec4 renderUvRect;
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
  vec2 extent = max(renderUvRect.zw, vec2(0.000001));
  vec2 safeUv = clamp((uv - renderUvRect.xy) / extent, vec2(0.0), vec2(1.0));
  return sourceFlipY ? vec2(safeUv.x, 1.0 - safeUv.y) : safeUv;
}

vec2 renderUvFromLocal(vec2 uv) {
  return renderUvRect.xy + uv * renderUvRect.zw;
}

vec4 sampleSource(vec2 uv) {
  vec4 sampled = texture2D(tex0, sourceUv(uv));
  return sourceForceOpaque ? vec4(sampled.rgb, 1.0) : sampled;
}

vec2 effectScreenUv() {
  vec2 uv = renderUvFromLocal(vTexCoord);
  return vec2(uv.x, 1.0 - uv.y);
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
  vec2 edge = abs(renderUvFromLocal(vTexCoord) - vec2(0.5));
  return 1.0 - smoothstep(0.5, 0.535, max(edge.x, edge.y));
}

${effectCode}

void main() {
  vec2 componentUv = renderUvFromLocal(vTexCoord);
  vec2 uv = ${component?.transformSource === false ? "componentUv" : "transformEffectUv(componentUv)"};
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
    calls.push(`color = ${fusedUniformName(index, "runEffect")}(componentUv, color);`);
  });
  return `
precision mediump float;
uniform sampler2D tex0;
uniform vec2 resolution;
uniform vec4 renderUvRect;
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
  vec2 extent = max(renderUvRect.zw, vec2(0.000001));
  vec2 safeUv = clamp((uv - renderUvRect.xy) / extent, vec2(0.0), vec2(1.0));
  return sourceFlipY ? vec2(safeUv.x, 1.0 - safeUv.y) : safeUv;
}
vec2 renderUvFromLocal(vec2 uv) {
  return renderUvRect.xy + uv * renderUvRect.zw;
}
vec4 sampleSource(vec2 uv) {
  vec4 sampled = texture2D(tex0, sourceUv(uv));
  return sourceForceOpaque ? vec4(sampled.rgb, 1.0) : sampled;
}
${codeBlocks.join("\n")}
void main() {
  vec2 componentUv = renderUvFromLocal(vTexCoord);
  vec4 color = sampleSource(componentUv);
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
  let adapted = String(code || "");
  const varyingPlaceholder = "__VJ1_COMPOSITION_UV_DECLARATION__";
  adapted = adapted.replace(/varying\s+vec2\s+vTexCoord\s*;/, varyingPlaceholder);
  adapted = adapted.replace(/\bvTexCoord\b/g, "vj1CompositionUv()");
  const coordinateContract = `
varying vec2 vTexCoord;
uniform float useContentTransform;
uniform mat3 contentUvMatrix;
uniform vec4 renderUvRect;

vec2 vj1CompositionUv() {
  // p5's aTexCoord varying is already top-left screen-oriented even though
  // WebGL texture storage is bottom-left. Storage orientation is handled at
  // target presentation, so content transforms apply directly in the shared
  // +x right, +y down Composition coordinate space.
  vec2 componentUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  vec2 transformedUv = (contentUvMatrix * vec3(componentUv, 1.0)).xy;
  return mix(componentUv, transformedUv, step(0.5, useContentTransform));
}`;
  adapted = adapted.replace(varyingPlaceholder, coordinateContract);
  if (hasRenderQualityParam(component) && !/uniform\s+float\s+renderQuality\s*;/.test(adapted)) {
    adapted = adapted.replace(/(precision\s+\w+\s+float\s*;)/, `$1\nuniform float renderQuality;`);
  }
  return adapted;
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
varying vec2 vTexCoord;
uniform float useContentTransform;
uniform mat3 contentUvMatrix;
uniform vec4 renderUvRect;
${qualityUniform}

${adaptedCode}

void main() {
  vec4 fragColor = vec4(0.0);
  // Use the same top-left Composition UV supplied to native generators.
  // Reconstructing it from gl_FragCoord couples movement to framebuffer
  // storage orientation and reverses vertical transforms on shared targets.
  vec2 baseUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  vec2 transformedUv = (contentUvMatrix * vec3(baseUv, 1.0)).xy;
  vec2 shaderUv = mix(baseUv, transformedUv, step(0.5, useContentTransform));
  // Shadertoy mainImage expects a bottom-left fragCoord. Keep the VJ1
  // transform in top-left Composition space and convert only at this API edge.
  vec2 shadertoyFragCoord = vec2(shaderUv.x, 1.0 - shaderUv.y) * iResolution.xy;
  vj1MainImage(fragColor, shadertoyFragCoord);
  gl_FragColor = fragColor;
}`;
}

function hasRenderQualityParam(component) {
  return component?.params?.some((param) => param?.id === "renderQuality");
}

function paramUniformDeclarations(component) {
  const reserved = new Set(["tex0", "resolution", "renderUvRect", "sourceFlipY", "sourceForceOpaque", "time", "amount", "effectTransform", "effectUvMatrix", "inverseEffectUvMatrix", "noiseTex", "noiseTextureSize", "canvasSize", "texelSize"]);
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
