precision highp float;
varying vec2 vTexCoord;
uniform float uTime;
uniform float uWind;
uniform float uMode;

// 2D simplex noise, Ashima Arts / Stefan Gustavson (MIT).
// https://github.com/ashima/webgl-noise
vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x / 289.0) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = x0.x > x0.y ? vec2(1., 0.) : vec2(0., 1.);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0., i1.y, 1.))
                                + i.x + vec3(0., i1.x, 1.));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                         dot(x12.zw,x12.zw)), 0.);
  m = m*m; m = m*m;
  vec3 x = 2. * fract(p * C.www) - 1.;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130. * dot(m, g);
}
float fbm(vec2 p) {
  float n = 0.;
  float amplitude = 0.55;
  for (int i = 0; i < 4; i++) {
    n += amplitude * snoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return n;
}
void main() {
  // Offscreen WebGL texture coordinates have v=0 at the bottom.
  float h = vTexCoord.y;
  vec2 p = vec2(vTexCoord.x * 7.0 - uWind * h * 1.8, h * 3.4);
  p.x += 0.38 * snoise(vec2(p.y - uTime * 0.65, uTime * 0.17));
  float turbulence = fbm(p - vec2(uWind * uTime * 0.15, uTime * 1.4));
  float tongues = snoise(vec2(p.x * 0.8, uTime * 0.35));
  float heat = clamp(1.0 - h * 1.32 + turbulence * 0.62 + tongues * 0.18, 0., 1.);
  if (uMode > 0.5 && uMode < 1.5) {
    heat = clamp(heat * 0.65 + 0.16 * snoise(p * 4. - uTime * 0.3), 0., 1.);
  }
  vec3 c = mix(vec3(0.015, 0.001, 0.), vec3(0.8, 0.035, 0.001), smoothstep(0.05, 0.45, heat));
  c = mix(c, vec3(1., 0.4, 0.012), smoothstep(0.4, 0.72, heat));
  c = mix(c, vec3(1., 0.94, 0.55), smoothstep(0.7, 1., heat));
  if (uMode > 1.5) {
    c = mix(vec3(0.005, 0., 0.04), vec3(0.08, 0.15, 1.), smoothstep(0.05, 0.55, heat));
    c = mix(c, vec3(0.4, 0.95, 1.), smoothstep(0.5, 0.95, heat));
  }
  c *= smoothstep(0.02, 0.24, heat);
  gl_FragColor = vec4(c, 1.);
}
