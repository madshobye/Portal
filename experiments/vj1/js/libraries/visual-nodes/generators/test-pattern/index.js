import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { compileSdf2dProgram } from "../../../procedural-2d/compiler.js";
import { createSdf2dProgram, sdfExpr } from "../../../procedural-2d/program.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";
import { renderView as resolveRenderView } from "../../../render-engine/render-view/index.js";

const manifest = Object.freeze({
  id: "testPattern",
  name: "Test Pattern",
  category: "utility",
  runtime: ALWAYS_TIME_RUNTIME,
});

// This is ordinary JavaScript authoring code, but it runs only when the node
// definition is built. Its p5-like calls produce a serializable drawing
// structure which is compiled into one fragment shader below.
export function defineTestPatternProgram(p) {
  const dark = "#050607";
  const light = "#f7f7f2";
  const circle = { circle: [0.5, 0.505, 0.445] };

  p.background("#8b8d8f");
  p.grid(24, 12, 0.0022, "#f4f5ef");
  p.edgeChecks(24, 0.025, dark, light);
  p.circle(0.5, 0.505, 0.445, light);
  p.ring(0.5, 0.505, 0.445, 0.004, dark);

  p.colorBars(0.25, 0.355, 0.5, 0.17,
    ["#d4cf00", "#0fc4c7", "#00c719", "#c100c9", "#c70009", "#0808bf"], { clip: circle });
  p.stripes(0.275, 0.27, 0.45, 0.085, 16, dark, "#d8d9d7", { clip: circle });
  p.rect(0.25, 0.525, 0.5, 0.095, dark, { clip: circle });
  for (let index = 0; index <= 12; index += 1) {
    const x = 0.27 + 0.46 * index / 12;
    p.line(x, 0.525, x, index % 2 ? 0.575 : 0.6, 0.0025, light, { clip: circle });
  }
  p.stripes(0.29, 0.62, 0.42, 0.12, pixelStripeCount(0.42, "x", 1), light, dark, { clip: circle });
  p.grayScale(0.33, 0.745, 0.34, 0.075, 9, { clip: circle });

  // Resolution wedges are tied to the source pixel grid. They deliberately
  // expose one- and two-pixel sampling on both axes so scaling or filtering
  // becomes visible instead of producing an arbitrary normalized pattern.
  p.stripes(0.065, 0.36, 0.06, 0.28, pixelStripeCount(0.28, "y", 1), light, dark, { direction: "horizontal" });
  p.stripes(0.135, 0.36, 0.06, 0.28, pixelStripeCount(0.28, "y", 2), light, dark, { direction: "horizontal" });
  p.stripes(0.795, 0.36, 0.06, 0.28, pixelStripeCount(0.06, "x", 2), light, dark);
  p.stripes(0.865, 0.36, 0.06, 0.28, pixelStripeCount(0.06, "x", 1), light, dark);

  p.ring(0.5, 0.505, 0.3382, 0.004, dark);
  p.ring(0.5, 0.505, 0.1068, 0.003, dark);
  p.line(0.5 - 0.445, 0.505, 0.5 + 0.445, 0.505, 0.002, dark);
  p.line(0.5, sdfExpr("0.505-0.445*unitPx/resolution.y"), 0.5,
    sdfExpr("0.505+0.445*unitPx/resolution.y"), 0.002, dark);
  p.rect(0.415, 0.105, 0.17, 0.07, dark);
  p.rect(0.38, 0.82, 0.24, 0.075, light);

  p.circle(0.065, 0.105, 0.028, "#ff4f4f");
  p.circle(0.935, 0.105, 0.028, "#59e36d");
  p.circle(0.065, 0.895, 0.028, "#4d75ff");
  p.circle(0.935, 0.895, 0.028, "#ffe45e");
  p.line(0.5, 0.205, 0.5, 0.105, 0.004, dark);
  p.line(0.5, 0.105, sdfExpr("0.5-0.03*unitPx/resolution.x"), 0.145, 0.004, dark);
  p.line(0.5, 0.105, sdfExpr("0.5+0.03*unitPx/resolution.x"), 0.145, 0.004, dark);

  // Smooth and stepped motion expose cadence and antialiasing without CPU
  // animation state. All coordinates remain relative to the node boundary.
  p.circle(
    sdfExpr("0.5+cos(time*2.35619449)*0.27145*unitPx/resolution.x"),
    sdfExpr("0.505+sin(time*2.35619449)*0.27145*unitPx/resolution.y"),
    0.012, "#ffe45e");
  p.circle(
    sdfExpr("0.5+cos(floor(time*12.0)/12.0*2.35619449)*0.3026*unitPx/resolution.x"),
    sdfExpr("0.505+sin(floor(time*12.0)/12.0*2.35619449)*0.3026*unitPx/resolution.y"),
    0.008, "#ff4f9a");
  const runnerX = sdfExpr("0.39+(0.5+0.5*sin(time*1.94778745))*0.22");
  p.line(runnerX, 0.825, runnerX, 0.887, 0.0015, dark);
  p.line(0.5, 0.14,
    sdfExpr("0.5+cos(-time*3.06305284)*0.026*unitPx/resolution.x"),
    sdfExpr("0.14+sin(-time*3.06305284)*0.026*unitPx/resolution.y"),
    0.0024, light);
}

function pixelStripeCount(span, axis = "x", pixelsPerStripe = 1) {
  const normalizedSpan = Math.max(0, Number(span) || 0);
  const pixelPeriod = Math.max(1, Math.round(Number(pixelsPerStripe) || 1));
  const resolutionAxis = axis === "y" ? "y" : "x";
  return sdfExpr(`${normalizedSpan}*resolution.${resolutionAxis}/${pixelPeriod}.0`);
}

export const TestPatternProgram = createSdf2dProgram({
  id: "test-pattern",
  name: "Test Pattern SDF program",
  draw: defineTestPatternProgram,
});

export const TestPatternShaderSource = compileSdf2dProgram(TestPatternProgram, {
  antialias: false,
});

const shader = Object.freeze({
  id: "generator.test-pattern",
  name: "Test Pattern SDF shader",
  type: "fragment",
  code: TestPatternShaderSource,
  generatedFrom: "sdf2d-program",
  parts: [{
    id: "sdf2d-program",
    name: "Procedural 2D program",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "defineTestPatternProgram",
    source: defineTestPatternProgram.toString(),
  }],
});

// Retained as pure geometry contracts for migration/tests; they do not draw or
// participate in the frame runtime.
export function testPatternLayout(view = {}) {
  const width = Number(view.width) || 1;
  const height = Number(view.height) || 1;
  const unit = Math.min(width, height);
  return { width, height, unit, centerX: width * 0.5, centerY: height * 0.505, circleRadius: unit * 0.445 };
}

export function circleClippedBarSlices(rect = {}, slicesPerBar = 32) {
  const count = Math.max(8, Math.round(Number(slicesPerBar) || 32));
  const x = Number(rect.x) || 0;
  const y = Number(rect.y) || 0;
  const width = Math.max(0, Number(rect.width) || 0);
  const height = Math.max(0, Number(rect.height) || 0);
  const centerX = Number(rect.centerX) || 0;
  const centerY = Number(rect.centerY) || 0;
  const radius = Math.max(0, Number(rect.radius) || 0);
  const sliceWidth = width / count;
  const slices = [];
  for (let index = 0; index < count; index += 1) {
    const sliceX = x + sliceWidth * index;
    const dx = sliceX + sliceWidth * 0.5 - centerX;
    if (Math.abs(dx) >= radius) continue;
    const halfSpan = Math.sqrt(Math.max(0, radius * radius - dx * dx));
    const top = Math.max(y, centerY - halfSpan);
    const bottom = Math.min(y + height, centerY + halfSpan);
    if (bottom > top) slices.push({ x: sliceX, y: top, width: sliceWidth, height: bottom - top });
  }
  return slices;
}

export function testPatternRenderView(pg, renderRequest = {}) {
  return resolveRenderView(pg, renderRequest);
}

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
