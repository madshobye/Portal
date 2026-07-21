import test from "node:test";
import assert from "node:assert/strict";

import {
  compileIsfFragmentSource,
  createIsfNodeDefinition,
  createIsfVisualComponent,
  evaluateIsfDimension,
  parseIsfDocument,
} from "../js/libraries/isf-engine/index.js";
import { serializeNodeProjectData } from "../js/libraries/node-engine/node-project.js";
import { createProjectNodeFork } from "../js/libraries/node-engine/node-editor.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/project-visual-node-resolver.js";
import { compileComponentPatch } from "../js/graph/render-scheduler.js";

const FILTER = `/*{
  "ISFVSN": "2.0",
  "LABEL": "Tint",
  "DESCRIPTION": "Test filter",
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "level", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0, "MAX": 1 },
    { "NAME": "center", "TYPE": "point2D", "DEFAULT": [0.25, 0.75] }
  ]
}*/
void main() {
  gl_FragColor = IMG_THIS_NORM_PIXEL(inputImage) * vec4(level, center.x, center.y, 1.0);
}`;

test("ISF parser validates metadata and identifies filters", () => {
  const document = parseIsfDocument(FILTER, { path: "shaders/tint.fs" });
  assert.equal(document.kind, "effect");
  assert.equal(document.name, "Tint");
  assert.equal(document.inputs.length, 3);
  assert.equal(document.passes.length, 1);
  assert.equal(document.roiSafe, true);
});

test("ISF compiler owns standard declarations without redeclaring shader uniforms", () => {
  const document = parseIsfDocument(FILTER.replace("void main()", "uniform float TIME;\nvoid main()"));
  const source = compileIsfFragmentSource(document);
  assert.equal((source.match(/uniform float TIME;/g) || []).length, 1);
  assert.match(source, /uniform sampler2D inputImage;/);
  assert.match(source, /void vj1IsfUserMain\(/);
  assert.match(source, /mix\(IMG_THIS_NORM_PIXEL\(inputImage\), gl_FragColor/);
  assert.match(source, /uniform bool vj1IsfFinalPass/);
});

test("ISF fragment coordinates remain semantic when the physical preview size changes", () => {
  const source = FILTER.replace(
    "gl_FragColor = IMG_THIS_NORM_PIXEL(inputImage) * vec4(level, center.x, center.y, 1.0);",
    "vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;\n  gl_FragColor = vec4(uv, 0.0, 1.0);",
  );
  const compiled = compileIsfFragmentSource(parseIsfDocument(source));
  assert.match(compiled, /vec2 uv = vj1IsfFragCoord\.xy \/ RENDERSIZE\.xy/);
  assert.match(compiled, /#define vj1IsfFragCoord vec4\(vj1IsfBoundaryUv\(\) \* RENDERSIZE/);
  assert.match(compiled, /return vec2\(topLeftUv\.x, 1\.0 - topLeftUv\.y\)/);
});

test("ISF files materialize as typed project visual nodes", () => {
  const component = createIsfVisualComponent({ path: "shaders/tint.fs", source: FILTER });
  assert.equal(component.kind, "effect");
  assert.equal(component.type, "isf");
  assert.equal(component.nodeDefinition.metadata.projectAssetPath, "shaders/tint.fs");
  assert.equal(component.params.find((param) => param.id === "level").defaultValue, 0.5);
  assert.equal(component.params.find((param) => param.id === "centerX").defaultValue, 0.25);
  assert.equal(component.fusible, false);
});

test("ISF pass dimensions stay relative to current render demand", () => {
  assert.equal(evaluateIsfDimension("$WIDTH / 4", { WIDTH: 1920 }), 480);
  assert.equal(evaluateIsfDimension("$HEIGHT * 0.5", { HEIGHT: 1080 }), 540);
  assert.throws(() => evaluateIsfDimension("globalThis.alert(1)", { WIDTH: 10 }), /VJ1_ISF_PASS_SIZE_INVALID/);
});

test("multipass ISF exposes named persistent targets without duplicating them", () => {
  const source = FILTER.replace(
    '"DESCRIPTION": "Test filter",',
    '"DESCRIPTION": "Test filter",\n  "PASSES": [{ "TARGET": "history", "PERSISTENT": true, "WIDTH": "$WIDTH / 2" }, {}],'
  );
  const document = parseIsfDocument(source);
  const compiled = compileIsfFragmentSource(document);
  assert.equal(document.passes.length, 2);
  assert.equal(document.passes[0].persistent, true);
  assert.equal(document.roiSafe, false);
  assert.equal((compiled.match(/uniform sampler2D history;/g) || []).length, 1);
  assert.throws(() => parseIsfDocument(source.replace('{ "TARGET": "history", "PERSISTENT": true, "WIDTH": "$WIDTH / 2" }', '{}')), /VJ1_ISF_PASS_ORDER_INVALID/);
});

test("project ISF bases stay file-backed while an edited fork recompiles", () => {
  const definition = createIsfNodeDefinition({ path: "shaders/tint.fs", source: FILTER });
  const persisted = serializeNodeProjectData({ definitions: [definition] });
  assert.deepEqual(persisted.definitions, []);
  const editedSource = FILTER.replace("* vec4(level, center.x, center.y, 1.0)", "* vec4(1.0, level, center.y, 1.0)");
  const fork = createProjectNodeFork(definition, {
    forkId: "edited-isf",
    overrides: { parts: [{ ...definition.parts[0], source: editedSource }] },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [definition], forks: [fork] } });
  assert.match(resolver.effect(definition.metadata.visualId).code, /vec4\(1\.0, level/);
});

test("ISF parser rejects unsupported versions and malformed ports", () => {
  assert.throws(() => parseIsfDocument(FILTER.replace('"2.0"', '"3.0"')), /VJ1_ISF_VERSION_UNSUPPORTED/);
  assert.throws(() => parseIsfDocument(FILTER.replace('"level"', '"bad name"')), /VJ1_ISF_INPUT_NAME_INVALID/);
});

test("project visual resolution tolerates file-backed definitions that are still pending", () => {
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [] } });
  assert.equal(resolver.generator("isf-shaders-pending"), null);
  assert.equal(resolver.generatorShader("isf-shaders-pending"), null);
  assert.equal(resolver.effect("isf-shaders-pending"), null);
});

test("component graph compilation treats pending visual files as transparent or pass-through", () => {
  const patch = compileComponentPatch({
    id: "pending-component",
    chain: [
      { id: "source", kind: "source", source: { type: "generator", generatorId: "isf-pending-generator" } },
      { id: "effect", kind: "effect", componentId: "isf-pending-effect", amount: 1 },
    ],
  }, {}, {
    getGeneratorComponent: () => null,
    getEffectComponent: () => null,
  });
  assert.deepEqual(patch.nodes.map((node) => node.role), ["output"]);
  assert.deepEqual(patch.edges, []);
});

test("component graph compilation activates a pending ISF source when its definition arrives", () => {
  const definition = createIsfNodeDefinition({ path: "shaders/tint.fs", source: FILTER.replace('"inputImage", "TYPE": "image"', '"unused", "TYPE": "float"') });
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [definition] } });
  const patch = compileComponentPatch({
    id: "loaded-component",
    chain: [{ id: "source", kind: "source", source: { type: "generator", generatorId: definition.metadata.visualId } }],
  }, {}, {
    getGeneratorComponent: resolver.generator,
    getEffectComponent: resolver.effect,
  });
  assert.deepEqual(patch.nodes.map((node) => node.role), ["source", "output"]);
});
