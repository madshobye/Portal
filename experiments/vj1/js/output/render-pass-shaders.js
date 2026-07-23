export const RENDER_PASS_VERTEX_SHADER = `
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

export const OVERLAY_BLEND_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D baseTex;
uniform sampler2D layerTex;
uniform bool baseFlipY;
uniform bool layerFlipY;
uniform mat3 layerUvMatrix;
uniform float layerOpacity;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv, bool flipY) {
  return flipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

vec3 overlayColor(vec3 base, vec3 layer) {
  vec3 low = 2.0 * base * layer;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
  return mix(low, high, step(vec3(0.5), base));
}

void main() {
  vec4 base = texture2D(baseTex, sourceUv(vTexCoord, baseFlipY));
  vec2 layerUv = (layerUvMatrix * vec3(vTexCoord, 1.0)).xy;
  float inside = step(0.0, layerUv.x) * step(layerUv.x, 1.0) *
    step(0.0, layerUv.y) * step(layerUv.y, 1.0);
  vec4 layer = texture2D(layerTex, sourceUv(clamp(layerUv, 0.0, 1.0), layerFlipY));
  layer *= layerOpacity * inside;
  float baseAlpha = base.a;
  float layerAlpha = layer.a;
  vec3 baseStraight = baseAlpha > 0.0001 ? base.rgb / baseAlpha : vec3(0.0);
  vec3 layerStraight = layerAlpha > 0.0001 ? layer.rgb / layerAlpha : vec3(0.0);
  vec3 blended = overlayColor(baseStraight, layerStraight);
  float outAlpha = baseAlpha + layerAlpha - baseAlpha * layerAlpha;
  vec3 outRgb = base.rgb * (1.0 - layerAlpha) +
    layer.rgb * (1.0 - baseAlpha) + blended * baseAlpha * layerAlpha;
  gl_FragColor = vec4(outRgb, outAlpha);
}`;

export const LAYER_TRANSFORM_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform bool sourceFlipY;
uniform mat3 sourceUvMatrix;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

void main() {
  vec2 uv = (sourceUvMatrix * vec3(vTexCoord, 1.0)).xy;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) *
    step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 color = texture2D(sourceTex, sourceUv(clamp(uv, 0.0, 1.0)));
  gl_FragColor = color * inside;
}`;

export const TEXTURE_OPERATOR_FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D textureA;
uniform sampler2D textureB;
uniform bool flipA;
uniform bool flipB;
uniform int operation;
uniform int blendMode;
uniform float amount;
uniform bool maskLuminance;
uniform bool invertMask;
varying vec2 vTexCoord;

vec2 storedUv(vec2 uv, bool flipY) {
  return flipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

vec4 premultipliedBlend(vec4 a, vec4 b, int mode) {
  if (mode == 0) return b;
  float alpha = clamp(a.a + b.a, 0.0, 1.0);
  if (mode == 1) return vec4(min(a.rgb + b.rgb, vec3(alpha)), alpha);
  vec3 sa = a.a > 0.0001 ? a.rgb / a.a : vec3(0.0);
  vec3 sb = b.a > 0.0001 ? b.rgb / b.a : vec3(0.0);
  vec3 straight = mode == 2 ? sa * sb : 1.0 - (1.0 - sa) * (1.0 - sb);
  float combinedAlpha = a.a + b.a - a.a * b.a;
  return vec4(straight * combinedAlpha, combinedAlpha);
}

void main() {
  vec4 a = texture2D(textureA, storedUv(vTexCoord, flipA));
  vec4 b = texture2D(textureB, storedUv(vTexCoord, flipB));
  float t = clamp(amount, 0.0, 1.0);
  if (operation == 1) {
    float maskValue = maskLuminance
      ? dot(b.a > 0.0001 ? b.rgb / b.a : vec3(0.0), vec3(0.2126, 0.7152, 0.0722))
      : b.a;
    if (invertMask) maskValue = 1.0 - maskValue;
    gl_FragColor = a * mix(1.0, clamp(maskValue, 0.0, 1.0), t);
    return;
  }
  vec4 blended = premultipliedBlend(a, b, blendMode);
  gl_FragColor = mix(a, blended, t);
}`;

// Presentation only normalizes texture storage orientation. Source and Group
// transforms must already have affected the coordinates used during render.
export const GENERATED_TARGET_PRESENTATION_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform bool sourceFlipY;
varying vec2 vTexCoord;

vec2 storedSourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

void main() {
  gl_FragColor = texture2D(sourceTex, storedSourceUv(vTexCoord));
}`;

export const COMPONENT_UPSCALE_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform vec2 sourceResolution;
uniform bool sourceFlipY;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 texel = 1.0 / max(sourceResolution, vec2(1.0));
  vec2 uv = sourceUv(vTexCoord);
  vec4 center = texture2D(sourceTex, uv);
  vec4 left = texture2D(sourceTex, uv - vec2(texel.x, 0.0));
  vec4 right = texture2D(sourceTex, uv + vec2(texel.x, 0.0));
  vec4 up = texture2D(sourceTex, uv - vec2(0.0, texel.y));
  vec4 down = texture2D(sourceTex, uv + vec2(0.0, texel.y));
  vec4 neighborhood = (left + right + up + down) * 0.25;
  float edge = clamp(
    abs(luma(left.rgb) - luma(right.rgb)) +
    abs(luma(up.rgb) - luma(down.rgb)),
    0.0,
    1.0
  );
  float sharpen = mix(0.06, 0.18, edge);
  vec4 color = center + (center - neighborhood) * sharpen;
  color.a = clamp(color.a, 0.0, 1.0);
  color.rgb = clamp(color.rgb, vec3(0.0), vec3(color.a));
  gl_FragColor = color;
}`;

export const COMPONENT_POST_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D sourceTex;
uniform bool sourceFlipY;
uniform float time;
uniform float noiseAmount;
uniform float grayscaleAmount;
varying vec2 vTexCoord;

vec2 sourceUv(vec2 uv) {
  return sourceFlipY ? vec2(uv.x, 1.0 - uv.y) : uv;
}

float hash(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 color = texture2D(sourceTex, sourceUv(vTexCoord));
  if (color.a <= 0.0001) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 straight = color.rgb / color.a;
  float gray = dot(straight, vec3(0.2126, 0.7152, 0.0722));
  straight = mix(straight, vec3(gray), clamp(grayscaleAmount, 0.0, 1.0));
  vec2 noiseSeed = gl_FragCoord.xy + floor(time * 60.0) * vec2(37.0, 17.0);
  float grain = hash(noiseSeed) * 2.0 - 1.0;
  straight = clamp(straight + grain * noiseAmount, 0.0, 1.0);
  gl_FragColor = vec4(straight * color.a, color.a);
}`;
