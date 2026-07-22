import { NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import { compileSdf2dProgram } from "../../../procedural-2d/compiler.js?v=procedural-2d-2";
import { createSdf2dProgram, sdfExpr } from "../../../procedural-2d/program.js?v=procedural-2d-1";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js?v=sdf-content-editor-1";
import { ALWAYS_TIME_RUNTIME } from "../../shared/shader-component-common.js";

const manifest = Object.freeze({
  id: "sdfSketch",
  name: "SDF Sketch",
  category: "utility",
  runtime: ALWAYS_TIME_RUNTIME,
});

// Edit this small p5-like program in the node editor. Coordinates are relative
// (0..1); radii and stroke weights use the shorter render dimension so circles
// remain circular at every aspect ratio.
export function defineExampleSdfSketch(p) {
  p.background("#080a0eff");
  p.grid(12, 8, 0.0015, "#263342ff");
  p.circle(0.5, 0.5, 0.28, "#162c3aff");
  p.ring(0.5, 0.5, 0.28, 0.008, "#52e2d4ff");
  p.rect(0.2, 0.46, 0.6, 0.08, "#ff4f92cc");
  p.line(0.18, 0.78, 0.82, 0.22, 0.008, "#ffe45eff");
  p.circle(
    sdfExpr("0.5+cos(time)*0.19*unitPx/resolution.x"),
    sdfExpr("0.5+sin(time)*0.19*unitPx/resolution.y"),
    0.035,
    "#f7f7f2ff",
  );
}

export const ExampleSdfProgram = createSdf2dProgram({
  id: "sdf-sketch-example",
  name: "SDF Sketch example",
  draw: defineExampleSdfSketch,
});

const shader = Object.freeze({
  id: "generator.sdf-sketch",
  name: "SDF Sketch shader",
  type: "fragment",
  generatedFrom: "sdf2d-program",
  compiler: {
    kind: "sdf2d",
    programPartId: "sdf2d-program",
    shaderPartId: "fragment-shader",
    exportName: "defineExampleSdfSketch",
    programId: "sdf-sketch-project",
    programName: "SDF Sketch project version",
  },
  code: compileSdf2dProgram(ExampleSdfProgram),
  parts: [{
    id: "sdf2d-program",
    name: "Procedural 2D program",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "defineExampleSdfSketch",
    source: defineExampleSdfSketch.toString(),
  }],
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
