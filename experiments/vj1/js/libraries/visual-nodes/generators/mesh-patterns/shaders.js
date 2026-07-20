const SHARED_VERTEX_GLSL = `
uniform mat3 contentPlacementMatrix;
uniform float rotation;
uniform vec2 offset;
uniform float time;
uniform float speed;
uniform float motion;
uniform vec4 renderUvRect;

vec2 animatedMeshUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float phase = time * speed;
  float angle = rotation + phase * motion * 0.08;
  float cosine = cos(angle);
  float sine = sin(angle);
  centered = mat2(cosine, -sine, sine, cosine) * centered;
  centered *= 1.0 + sin(phase * 0.73) * motion * 0.018;
  return centered + 0.5 + offset * 0.12;
}

vec2 meshClip(vec2 uv) {
  vec3 placed = contentPlacementMatrix * vec3(animatedMeshUv(uv), 1.0);
  vec2 screenUv = placed.xy / max(abs(placed.z), 0.00001);
  vec2 roiUv = (screenUv - renderUvRect.xy) / max(renderUvRect.zw, vec2(0.000001));
  return vec2(roiUv.x * 2.0 - 1.0, 1.0 - roiUv.y * 2.0);
}
`;

export const MESH_PATTERN_FILL_VERTEX_SHADER = `
precision highp float;
attribute vec2 aPosition;
attribute float aColorSlot;
varying float vColorSlot;
${SHARED_VERTEX_GLSL}
void main() {
  vColorSlot = aColorSlot;
  gl_Position = vec4(meshClip(aPosition), 0.0, 1.0);
}
`;

export const MESH_PATTERN_FILL_FRAGMENT_SHADER = `
precision highp float;
uniform vec4 palette0;
uniform vec4 palette1;
uniform vec4 palette2;
uniform vec4 palette3;
uniform float fillOpacity;
uniform float amount;
varying float vColorSlot;
vec4 paletteColor(float slot) {
  if (slot < 0.5) return palette0;
  if (slot < 1.5) return palette1;
  if (slot < 2.5) return palette2;
  return palette3;
}
void main() {
  vec4 color = paletteColor(vColorSlot);
  float alpha = color.a * fillOpacity * amount;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}
`;

export const MESH_PATTERN_WIRE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aStart;
attribute vec2 aEnd;
attribute float aSide;
attribute float aAlong;
attribute float aColorSlot;
uniform vec2 resolution;
uniform float thickness;
varying float vColorSlot;
${SHARED_VERTEX_GLSL}
void main() {
  vec2 startClip = meshClip(aStart);
  vec2 endClip = meshClip(aEnd);
  vec2 direction = endClip - startClip;
  float magnitude = max(length(direction), 0.000001);
  vec2 normal = vec2(-direction.y, direction.x) / magnitude;
  vec2 pixelScale = vec2(2.0 / max(resolution.x, 1.0), 2.0 / max(resolution.y, 1.0));
  vec2 position = mix(startClip, endClip, aAlong) + normal * pixelScale * thickness * 0.5 * aSide;
  vColorSlot = aColorSlot;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const MESH_PATTERN_WIRE_FRAGMENT_SHADER = `
precision highp float;
uniform vec4 wireColor;
uniform float wireOpacity;
uniform float amount;
varying float vColorSlot;
void main() {
  float stressAccent = 0.82 + 0.06 * clamp(vColorSlot, 0.0, 3.0);
  float alpha = wireColor.a * wireOpacity * amount;
  gl_FragColor = vec4(wireColor.rgb * alpha * stressAccent, alpha);
}
`;
