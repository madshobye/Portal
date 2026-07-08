import { getShaderComponent } from "./shader-registry.js";

export function createShaderBuilder({ getCustomCode, onStatus }) {
  const cache = new Map();

  function getShader(pass, target = null) {
    const component = getShaderComponent(pass.id);
    const code = pass.id === "custom" ? getCustomCode() : component?.code;
    if (!code) return null;
    const contextId = getContextId(target);
    const key = `${contextId}:${pass.id}:${code}`;
    if (cache.has(key)) return cache.get(key);
    try {
      const factory = typeof target?.createShader === "function" ? target : globalThis;
      const shader = factory.createShader(vertexShaderSource(), fragmentShaderSource(code));
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
      if (key.startsWith("custom:")) cache.delete(key);
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

function fragmentShaderSource(effectCode) {
  return `
precision mediump float;
uniform sampler2D tex0;
uniform vec2 resolution;
uniform float time;
uniform float amount;
varying vec2 vTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

${effectCode}

void main() {
  vec2 uv = vTexCoord;
  vec4 color = texture2D(tex0, vec2(uv.x, 1.0 - uv.y));
  gl_FragColor = runEffect(uv, color);
}`;
}
