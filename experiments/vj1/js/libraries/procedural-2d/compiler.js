import { createSdf2dProgram, sdfExpr } from "./program.js?v=procedural-2d-1";

// Compiles an edited sketch at authoring time. The returned source is the only
// artifact used by the render loop; sketch JavaScript is never run per frame.
export function compileSdf2dSketchSource(source, {
  exportName = "defineSdfSketch",
  id = "procedural-2d",
  name = "Procedural 2D",
} = {}) {
  const safeExportName = String(exportName || "");
  if (!/^[A-Za-z_$][\w$]*$/.test(safeExportName)) {
    throw new TypeError(`SDF2D_EXPORT_NAME_INVALID:${safeExportName || "missing"}`);
  }
  const code = String(source || "").trim();
  if (!code) throw new TypeError("SDF2D_SKETCH_SOURCE_EMPTY");
  let draw;
  try {
    draw = Function("sdfExpr", `"use strict";\n${code}\nreturn typeof ${safeExportName} === "function" ? ${safeExportName} : null;`)(sdfExpr);
  } catch (error) {
    throw new SyntaxError(`SDF2D_SKETCH_SOURCE_INVALID:${error.message}`);
  }
  if (typeof draw !== "function") throw new TypeError(`SDF2D_SKETCH_EXPORT_MISSING:${safeExportName}`);
  return compileSdf2dProgram(createSdf2dProgram({ id, name, draw }));
}

// Compiles a stored procedural-2D command structure into one fragment shader.
// Repeated geometry uses periodic fields (fract/floor), not unrolled shapes.
export function compileSdf2dProgram(program = {}) {
  const body = [];
  for (const [index, operation] of (program.commands || []).entries()) {
    body.push(compileOperation(operation, index));
  }
  return `
#ifdef GL_ES
precision highp float;
#endif
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float fillLinearField(float field) { return 1.0 - smoothstep(-1.0, 1.0, field); }

// Axis boxes avoid a length(); circles and lines compare squared distance and
// use a one-pixel field estimate. These approximations are cheaper than exact
// SDFs while retaining stable antialiasing at different render resolutions.
float boxMask(vec2 pointPx, vec2 centerPx, vec2 halfPx) {
  vec2 q = abs(pointPx - centerPx) - halfPx;
  return fillLinearField(max(q.x, q.y));
}
float circleMask(vec2 pointPx, vec2 centerPx, float radiusPx) {
  vec2 q = pointPx - centerPx;
  float field = dot(q,q) - radiusPx*radiusPx;
  float pixelField = max(radiusPx*2.0, 1.0);
  return 1.0 - smoothstep(-pixelField, pixelField, field);
}
float ringMask(vec2 pointPx, vec2 centerPx, float radiusPx, float weightPx) {
  vec2 q = pointPx - centerPx;
  float field = abs(dot(q,q) - radiusPx*radiusPx) - max(weightPx, 1.0) * radiusPx;
  float pixelField = max(radiusPx*2.0, 1.0);
  return 1.0 - smoothstep(-pixelField, pixelField, field);
}
float segmentMask(vec2 pointPx, vec2 aPx, vec2 bPx, float weightPx) {
  vec2 pa = pointPx - aPx;
  vec2 ba = bPx - aPx;
  float h = clamp(dot(pa,ba) / max(dot(ba,ba), 0.0001), 0.0, 1.0);
  vec2 q = pa - ba*h;
  float radius = max(weightPx*0.5, 0.5);
  float field = dot(q,q) - radius*radius;
  float pixelField = max(radius*2.0, 1.0);
  return 1.0 - smoothstep(-pixelField, pixelField, field);
}
void paint(inout vec4 destination, vec4 source, float coverage) {
  float alpha = clamp(source.a * coverage, 0.0, 1.0);
  destination = vec4(mix(destination.rgb, source.rgb, alpha), alpha + destination.a*(1.0-alpha));
}

void main() {
  vec2 uv = vTexCoord;
  vec2 px = uv * resolution;
  float unitPx = max(min(resolution.x, resolution.y), 1.0);
  vec4 color = vec4(0.0);
  ${body.join("\n  ")}
  gl_FragColor = vec4(color.rgb * color.a, color.a);
}`;
}

function compileOperation(op = {}, index = 0) {
  const mask = `mask${index}`;
  const clip = compileClip(op.clip);
  if (op.type === "background") return `paint(color, ${color(op.color)}, 1.0);`;
  if (op.type === "rect") return `float ${mask}=boxMask(px, vec2(${num(op.x)}+${num(op.width)}*.5,${num(op.y)}+${num(op.height)}*.5)*resolution, vec2(${num(op.width)},${num(op.height)})*resolution*.5)${clip}; paint(color,${color(op.color)},${mask});`;
  if (op.type === "circle") return `float ${mask}=circleMask(px,vec2(${num(op.x)},${num(op.y)})*resolution,${num(op.radius)}*unitPx)${clip}; paint(color,${color(op.color)},${mask});`;
  if (op.type === "ring") return `float ${mask}=ringMask(px,vec2(${num(op.x)},${num(op.y)})*resolution,${num(op.radius)}*unitPx,${num(op.weight)}*unitPx)${clip}; paint(color,${color(op.color)},${mask});`;
  if (op.type === "line") return `float ${mask}=segmentMask(px,vec2(${num(op.x1)},${num(op.y1)})*resolution,vec2(${num(op.x2)},${num(op.y2)})*resolution,${num(op.weight)}*unitPx)${clip}; paint(color,${color(op.color)},${mask});`;
  if (op.type === "grid") return compileGrid(op, mask, clip);
  if (op.type === "edgeChecks") return compileEdgeChecks(op, mask);
  if (op.type === "stripes") return compileStripes(op, mask, clip);
  if (op.type === "colorBars") return compileColorBars(op, mask, clip);
  if (op.type === "grayScale") return compileGrayScale(op, mask, clip);
  throw new Error(`SDF2D_OPERATION_UNSUPPORTED:${op.type}`);
}

function compileGrid(op, mask, clip) {
  return `vec2 gridCell${mask}=fract(uv*vec2(${num(op.columns)},${num(op.rows)})); vec2 gridDistance${mask}=min(gridCell${mask},1.0-gridCell${mask})*resolution/vec2(${num(op.columns)},${num(op.rows)}); float ${mask}=(1.0-smoothstep(${num(op.weight)}*unitPx*.5,${num(op.weight)}*unitPx*.5+1.0,min(gridDistance${mask}.x,gridDistance${mask}.y)))${clip}; paint(color,${color(op.color)},${mask});`;
}

function compileEdgeChecks(op, mask) {
  return `float ${mask}=step(uv.y,${num(op.depth)})+step(1.0-${num(op.depth)},uv.y); float check${mask}=mod(floor(uv.x*${num(op.count)}),2.0); paint(color,mix(${color(op.colorA)},${color(op.colorB)},check${mask}),clamp(${mask},0.0,1.0));`;
}

function compileStripes(op, mask, clip) {
  const local = `local${mask}`;
  const axis = op.direction === "horizontal" ? `${local}.y` : `${local}.x`;
  return `vec2 ${local}=(uv-vec2(${num(op.x)},${num(op.y)}))/vec2(${num(op.width)},${num(op.height)}); float ${mask}=boxMask(px,vec2(${num(op.x)}+${num(op.width)}*.5,${num(op.y)}+${num(op.height)}*.5)*resolution,vec2(${num(op.width)},${num(op.height)})*resolution*.5)${clip}; float stripe${mask}=mod(floor(${axis}*${num(op.count)}),2.0); paint(color,mix(${color(op.colorA)},${color(op.colorB)},stripe${mask}),${mask});`;
}

function compileColorBars(op, mask, clip) {
  const colors = (op.colors || []).map(color);
  let branches = colors.at(-1) || "vec4(0.0)";
  for (let index = colors.length - 2; index >= 0; index -= 1) {
    branches = `(bar${mask}<${index + 1}.0?${colors[index]}:${branches})`;
  }
  return `vec2 barLocal${mask}=(uv-vec2(${num(op.x)},${num(op.y)}))/vec2(${num(op.width)},${num(op.height)}); float ${mask}=boxMask(px,vec2(${num(op.x)}+${num(op.width)}*.5,${num(op.y)}+${num(op.height)}*.5)*resolution,vec2(${num(op.width)},${num(op.height)})*resolution*.5)${clip}; float bar${mask}=floor(clamp(barLocal${mask}.x,0.0,.9999)*${Math.max(colors.length, 1)}.0); paint(color,${branches},${mask});`;
}

function compileGrayScale(op, mask, clip) {
  return `vec2 grayLocal${mask}=(uv-vec2(${num(op.x)},${num(op.y)}))/vec2(${num(op.width)},${num(op.height)}); float ${mask}=boxMask(px,vec2(${num(op.x)}+${num(op.width)}*.5,${num(op.y)}+${num(op.height)}*.5)*resolution,vec2(${num(op.width)},${num(op.height)})*resolution*.5)${clip}; float gray${mask}=floor(clamp(grayLocal${mask}.x,0.0,.9999)*${num(op.steps)})/max(${num(op.steps)}-1.0,1.0); paint(color,vec4(vec3(gray${mask}),1.0),${mask});`;
}

function compileClip(clip) {
  if (!clip?.circle) return "";
  const [x, y, radius] = clip.circle;
  return `*circleMask(px,vec2(${num(x)},${num(y)})*resolution,${num(radius)}*unitPx)`;
}

function num(value) {
  if (value && typeof value === "object" && "expression" in value) return `(${value.expression})`;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`SDF2D_NUMBER_INVALID:${value}`);
  return Number.isInteger(number) ? `${number}.0` : String(number);
}

function color(value) {
  if (Array.isArray(value)) {
    const [r = 0, g = 0, b = 0, a = 1] = value;
    return `vec4(${num(r)},${num(g)},${num(b)},${num(a)})`;
  }
  const source = String(value || "#000000ff").replace(/^#/, "");
  const full = source.length === 3 ? source.split("").map((part) => part + part).join("") + "ff"
    : source.length === 6 ? source + "ff" : source.padEnd(8, "f").slice(0, 8);
  const values = [0, 2, 4, 6].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
  return `vec4(${values.map((entry) => entry.toFixed(6)).join(",")})`;
}
