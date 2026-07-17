export const FEATURE_MORPH_VERTEX_SHADER = `
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

export const FEATURE_MORPH_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D imageA;
uniform sampler2D imageB;
uniform sampler2D flowField;
uniform float morph;
uniform float warpStrength;
uniform float maxFlow;
uniform vec2 flowSize;
uniform float flowPhases;
uniform float flowLayers;
uniform float morphStrategy;
uniform vec4 fitA;
uniform vec4 fitB;
uniform mat3 contentUvMatrix;
varying vec2 vTexCoord;

vec2 fittedUv(vec2 uv, vec4 fit) {
  return (uv - vec2(0.5)) * fit.xy + vec2(0.5) + fit.zw;
}

vec4 morphField(vec2 uv, float layer) {
  float phasePosition = morph * (flowPhases - 1.0);
  float phaseA = floor(phasePosition);
  float phaseB = min(flowPhases - 1.0, phaseA + 1.0);
  float fieldBands = flowPhases * flowLayers;
  vec2 fieldXy = vec2(
    (clamp(uv.x, 0.0, 1.0) * (flowSize.x - 1.0) + 0.5) / flowSize.x,
    (clamp(uv.y, 0.0, 1.0) * (flowSize.y - 1.0) + 0.5) / (flowSize.y * fieldBands)
  );
  vec2 phaseOffset = vec2(0.0, 1.0 / fieldBands);
  vec2 layerOffset = vec2(0.0, layer * flowPhases / fieldBands);
  return mix(
    texture2D(flowField, fieldXy + layerOffset + phaseOffset * phaseA),
    texture2D(flowField, fieldXy + layerOffset + phaseOffset * phaseB),
    fract(phasePosition)
  );
}

vec2 decodeFlow(vec2 encoded) {
  return (encoded * 2.0 - 1.0) * maxFlow;
}

void main() {
  vec2 uv = (contentUvMatrix * vec3(vTexCoord, 1.0)).xy;
  vec2 warpedA = uv;
  vec2 warpedB = uv;
  if (morphStrategy > 0.5 && morphStrategy < 1.5) {
    float safeStrength = warpStrength / (1.0 + 0.35 * max(0.0, warpStrength - 1.0));
    warpedA += decodeFlow(morphField(uv, 0.0).rg) * safeStrength;
    warpedB += decodeFlow(morphField(uv, 1.0).rg) * safeStrength;
  } else if (morphStrategy >= 1.5) {
    const float steps = 5.0;
    for (int stepIndex = 0; stepIndex < 5; stepIndex++) {
      warpedA -= decodeFlow(morphField(warpedA, 0.0).rg) * morph * warpStrength / steps;
      warpedB += decodeFlow(morphField(warpedB, 0.0).rg) * (1.0 - morph) * warpStrength / steps;
    }
  } else {
    vec2 flow = decodeFlow(morphField(uv, 0.0).rg) * warpStrength;
    warpedA -= flow * morph;
    warpedB += flow * (1.0 - morph);
  }
  vec2 uvA = fittedUv(warpedA, fitA);
  vec2 uvB = fittedUv(warpedB, fitB);
  float insideA = step(0.0, uvA.x) * step(uvA.x, 1.0) * step(0.0, uvA.y) * step(uvA.y, 1.0);
  float insideB = step(0.0, uvB.x) * step(uvB.x, 1.0) * step(0.0, uvB.y) * step(uvB.y, 1.0);
  vec4 a = texture2D(imageA, clamp(uvA, 0.0, 1.0)) * insideA;
  vec4 b = texture2D(imageB, clamp(uvB, 0.0, 1.0)) * insideB;
  gl_FragColor = mix(a, b, morph);
}`;

export function imageFitUniform(image, targetWidth, targetHeight, fit = "cover") {
  const sourceWidth = Math.max(1, image?.width || image?.canvas?.width || 1);
  const sourceHeight = Math.max(1, image?.height || image?.canvas?.height || 1);
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = Math.max(1, targetWidth) / Math.max(1, targetHeight);
  let scaleX = 1;
  let scaleY = 1;
  if (fit === "contain") {
    if (sourceAspect > targetAspect) scaleY = targetAspect / sourceAspect;
    else scaleX = sourceAspect / targetAspect;
  } else if (sourceAspect > targetAspect) {
    scaleX = targetAspect / sourceAspect;
  } else {
    scaleY = sourceAspect / targetAspect;
  }
  return [1 / scaleX, 1 / scaleY, 0, 0];
}
