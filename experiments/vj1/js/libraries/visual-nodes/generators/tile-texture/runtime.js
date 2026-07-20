import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";

export const TILE_TEXTURE_VERTEX_SHADER = `
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

export const TILE_TEXTURE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D tileImage;
uniform vec2 repeatAmount;
uniform vec2 offsetAmount;
uniform vec2 scrollSpeed;
uniform float time;
uniform mat3 contentUvMatrix;
uniform vec4 renderUvRect;
varying vec2 vTexCoord;

void main() {
  vec2 boundaryUv = renderUvRect.xy + vTexCoord * renderUvRect.zw;
  vec2 compositionUv = (contentUvMatrix * vec3(boundaryUv, 1.0)).xy;
  vec2 tileUv = fract(compositionUv * repeatAmount + offsetAmount + scrollSpeed * time);
  gl_FragColor = texture2D(tileImage, tileUv);
}`;

export function tileRepeatAmount(params = {}) {
  const repeat = Math.max(0.001, Number(params.repeat) || 1);
  const tileAxis = ["horizontal", "vertical"].includes(params.tileAxis) ? params.tileAxis : "both";
  return [
    tileAxis === "vertical" ? 1 : repeat,
    tileAxis === "horizontal" ? 1 : repeat,
  ];
}

export function tileTextureNodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("TILE_TEXTURE_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function tileTextureNodeModuleParts() {
  return [
    {
      id: "tile-repeat-module",
      name: "Tile repeat and axis algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["tileRepeatAmount"],
      source: tileRepeatAmount.toString(),
    },
    {
      id: "tile-texture-process",
      name: "Tile Texture process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "tileTextureNodeProcess",
      entry: "process",
      dependsOn: ["tile-repeat-module"],
      source: tileTextureNodeProcess.toString(),
    },
    {
      id: "tile-texture-vertex",
      name: "Tile Texture vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "tile-texture",
      editable: true,
      source: TILE_TEXTURE_VERTEX_SHADER,
    },
    {
      id: "tile-texture-fragment",
      name: "Tile Texture fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "tile-texture",
      editable: true,
      source: TILE_TEXTURE_FRAGMENT_SHADER,
    },
  ];
}

export const TileTextureNodeModuleExports = Object.freeze({ tileRepeatAmount });
