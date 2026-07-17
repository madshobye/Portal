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
varying vec2 vTexCoord;

void main() {
  vec2 tileUv = fract(vTexCoord * repeatAmount + offsetAmount + scrollSpeed * time);
  gl_FragColor = texture2D(tileImage, tileUv);
}`;
