export const VJ1 = Object.freeze({
  channelName: "vj1-output-bridge",
  localWorkspaceKey: "vj1-workspace",
  renderWidth: 960,
  renderHeight: 540,
  surfaceWidth: 800,
  surfaceHeight: 450,
  p5Script: "https://cdn.jsdelivr.net/npm/p5@2.2.0/lib/p5.js",
  portalScript: "../../P1/portal/portal.js?v=vj1-camera-1",
  renderFont: "assets/RobotoMono-Regular.ttf",
});

export const WORKSPACES = Object.freeze(["compose", "scene", "mapping", "live"]);

export const BLEND_MODES = Object.freeze([
  "normal",
  "add",
  "screen",
  "multiply",
  "darkest",
  "lightest",
  "difference",
  "exclusion",
  "overlay",
  "remove",
]);

export const SOURCE_TYPES = Object.freeze([
  { id: "generator", label: "Generator" },
  { id: "media", label: "Media" },
  { id: "camera", label: "Camera" },
  { id: "black", label: "Black" },
]);

export function defaultCustomShaderCode() {
  return `vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = uv - 0.5;
  float scan = sin((uv.y + time * 0.12) * resolution.y * 0.9);
  float vignette = smoothstep(0.86, 0.16, length(p));
  vec3 tint = vec3(1.0, 0.86, 0.48);
  vec3 rgb = mix(color.rgb, color.rgb * tint + scan * 0.08, amount);
  return vec4(rgb * vignette, color.a);
}`;
}
