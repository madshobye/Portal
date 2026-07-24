import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import {
  getGeneratorNodeComponent,
  GazeBlinkControllerNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import { standaloneFragmentSource } from "../js/shaders/shader-builder.js";

test("Eyeball is an ordinary compiled control-to-shader Group", () => {
  const component = getGeneratorNodeComponent("eyeball");
  const definition = component.nodeDefinition;
  const graph = definition.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH);

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.equal(definition.metadata.nativeRenderer, "");
  assert.equal(definition.metadata.renderAuthority, "compiled-graph");
  assert.deepEqual(definition.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Eyeball Group has no hidden implementation");
  assert.deepEqual(graph.nodes.map(({ id, nodeId, role }) => ({ id, nodeId, role })), [
    { id: "time", nodeId: "core.control.component-time", role: "control" },
    { id: "motion", nodeId: GazeBlinkControllerNode.id, role: "control" },
    { id: "render", nodeId: "vj1.visual.generator.eyeballRender", role: "source" },
  ]);
  assert.deepEqual(graph.connections.slice(0, 2), [
    { from: "time.time", to: "motion.componentTime", type: "number" },
    { from: "motion.gazeX", to: "render.$parameter.gazeX", type: "number" },
  ]);
  assert.deepEqual(graph.connections.at(-1), {
    from: "render.texture",
    to: "$out.texture",
    type: "texture",
  });
});

test("Gaze controller publishes retained packet and scalar control outputs", () => {
  const output = {};
  const state = {};
  const first = GazeBlinkControllerNode.process({
    componentTime: 2,
    gazeRange: 1,
    blinkRate: 1,
  }, { state, output });
  const uniforms = first.uniforms;
  const second = GazeBlinkControllerNode.process({
    componentTime: 3,
    gazeRange: 1,
    blinkRate: 1,
  }, { state, output });

  assert.strictEqual(second, first);
  assert.strictEqual(second.uniforms, uniforms);
  assert.deepEqual(
    [second.gazeX, second.gazeY, second.gazeZ],
    second.uniforms.gazeDir,
  );
  assert.deepEqual(
    [second.irisRightX, second.irisRightY, second.irisRightZ],
    second.uniforms.irisRight,
  );
  assert.deepEqual(
    [second.irisUpX, second.irisUpY, second.irisUpZ],
    second.uniforms.irisUp,
  );
  assert.equal(second.blink, second.uniforms.blink);
});

test("ordinary Eyeball shader consumes the shared generator coordinate contract once", () => {
  const component = getGeneratorNodeComponent("eyeballRender");
  const source = standaloneFragmentSource(component.code, component);

  assert.equal([...source.matchAll(/uniform mat3 contentUvMatrix;/g)].length, 1);
  assert.equal([...source.matchAll(/uniform vec4 renderUvRect;/g)].length, 1);
  assert.match(source, /vec2 uv = vj1CompositionUv\(\);/);
  assert.doesNotMatch(component.code, /uniform mat3 contentUvMatrix|uniform vec4 renderUvRect/);
});

test("Gaze controller and ordinary Eyeball shader are independently forkable", () => {
  const renderer = getGeneratorNodeComponent("eyeballRender").nodeDefinition;
  const controllerFork = createProjectNodeFork(GazeBlinkControllerNode, {
    forkId: "project-gaze-controller",
    overrides: {
      parts: GazeBlinkControllerNode.parts.map((part) => ({
        ...part,
        source: [
          "function gazeBlinkControllerProcess(_inputs = {}, { output = {} } = {}) {",
          "  output.uniforms = { gazeDir: [1, 0, 0], irisRight: [0, 0, 1], irisUp: [0, 1, 0], blink: 0.25 };",
          "  output.gazeX = 1; output.gazeY = 0; output.gazeZ = 0; output.blink = 0.25;",
          "  return output;",
          "}",
        ].join("\n"),
      })),
    },
  });
  const rendererFork = createProjectNodeFork(renderer, {
    forkId: "project-eyeball-renderer",
    overrides: {
      parts: renderer.parts.map((part) =>
        part.kind === NODE_PART_KINDS.SHADER
          ? { ...part, source: part.source.replace("float eyeBlink = blink;", "float eyeBlink = 1.0;") }
          : part),
    },
  });
  const controller = materializeProjectNodeFork(GazeBlinkControllerNode, controllerFork);
  const forkedRenderer = materializeProjectNodeFork(renderer, rendererFork);

  assert.equal(controller.process({}, { output: {} }).gazeX, 1);
  assert.match(
    forkedRenderer.parts.find((part) => part.kind === NODE_PART_KINDS.SHADER).source,
    /float eyeBlink = 1\.0;/,
  );
});

test("compiled Eyeball lowers its controls into one ordinary shader operation", async () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "eyeball-component",
    type: "component",
    chain: [{
      id: "eyeball-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "eyeball",
        params: { gazeRange: 1, blinkRate: 1, irisSize: 1.2 },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
  const specializedSource = await readFile(
    new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url),
    "utf8",
  );

  assert.equal(operation.backend, "compiled-visual-group");
  assert.deepEqual(operation.operations.map(({ backend, nodeId }) => ({ backend, nodeId })), [{
    backend: "shader-generator",
    nodeId: "vj1.visual.generator.eyeballRender",
  }]);
  assert.deepEqual(operation.controlProgram.steps.map((step) => step.nodeId), [
    "core.control.component-time",
    GazeBlinkControllerNode.id,
  ]);
  assert.equal(operation.controlProgram.bindings.length, 10);
  const renderParams = operation.operations[0].configuration.source.params;
  const restore = operation.controlProgram.apply({ componentTime: 2 });
  assert.equal(renderParams.irisSize, 1.2);
  assert.ok(Number.isFinite(renderParams.gazeX));
  assert.ok(Number.isFinite(renderParams.irisUpZ));
  assert.ok(renderParams.blink >= 0 && renderParams.blink <= 1);
  restore();
  assert.equal(renderParams.gazeX, 0, "temporary control values restore after retained evaluation");
  assert.doesNotMatch(specializedSource, /output\/specialized:controlledShader|drawControlledShader/);
});
