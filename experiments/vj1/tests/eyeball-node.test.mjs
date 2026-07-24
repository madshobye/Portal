import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import {
  compileSpecializedCompoundProgram,
  EyeballToImageNode,
  GazeBlinkControllerNode,
  getGeneratorNodeComponent,
} from "../js/libraries/visual-nodes/index.js";
import {
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";

test("Eyeball is a connected Gaze and Blink Controller to shader image Group", () => {
  const definition = getGeneratorNodeComponent("eyeball").nodeDefinition;
  const definitions = new Map([
    [GazeBlinkControllerNode.id, GazeBlinkControllerNode],
    [EyeballToImageNode.id, EyeballToImageNode],
  ]);
  const program = compileSpecializedCompoundProgram(definition, {
    resolveDefinition: ({ nodeId }) => definitions.get(nodeId),
  });
  const first = program.evaluateGraph({
    gazeRange: 1,
    blinkRate: 1,
    irisSize: 1.2,
  }, { instanceId: "eye-a" }, {
    motion: { componentTime: 2 },
  });
  const firstUniforms = first.stageInput("render", "uniforms");
  const secondUniforms = program.evaluateGraph({
    gazeRange: 1,
    blinkRate: 1,
    irisSize: 1.2,
  }, { instanceId: "eye-a" }, {
    motion: { componentTime: 3 },
  }).stageInput("render", "uniforms");

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.equal(definition.metadata.visualCompilerHook.renderer, "output/specialized:controlledShader");
  assert.deepEqual(definition.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Eyeball Group has no hidden implementation");
  assert.deepEqual(program.stages.map(({ id, nodeId }) => ({ id, nodeId })), [
    { id: "motion", nodeId: GazeBlinkControllerNode.id },
    { id: "render", nodeId: EyeballToImageNode.id },
  ]);
  assert.deepEqual(program.nativeKernel("controlled-shader").inputBindings.uniforms, {
    stageId: "motion",
    portId: "uniforms",
  });
  assert.strictEqual(secondUniforms, firstUniforms, "the controller retains one output object per visual instance");
  assert.equal(firstUniforms.kind, "gaze-blink-uniforms");
  assert.equal(first.stageInputs("render").settings.irisSize, 1.2);
  program.dispose();
});

test("Gaze controller and Eyeball shader uniform binding are independently forkable", () => {
  const controllerFork = createProjectNodeFork(GazeBlinkControllerNode, {
    forkId: "project-gaze-controller",
    overrides: {
      parts: GazeBlinkControllerNode.parts.map((part) => ({
        ...part,
        source: [
          "function gazeBlinkControllerProcess(_inputs = {}, { output = {} } = {}) {",
          "  output.uniforms = gazeBlinkUniforms();",
          "  return output;",
          "}",
          "function gazeBlinkUniforms() {",
          "  return { kind: 'gaze-blink-uniforms', gazeDir: [1, 0, 0], irisRight: [0, 0, 1], irisUp: [0, 1, 0], blink: 0.25 };",
          "}",
        ].join("\n"),
      })),
    },
  });
  const rendererFork = createProjectNodeFork(EyeballToImageNode, {
    forkId: "project-eyeball-renderer",
    overrides: {
      parts: EyeballToImageNode.parts.map((part) =>
        part.kind === NODE_PART_KINDS.JAVASCRIPT
          ? {
              ...part,
              source: "function applyControlledShaderUniforms(shader) { shader.setUniform('projectFork', 1); }",
            }
          : part),
    },
  });
  const controller = materializeProjectNodeFork(GazeBlinkControllerNode, controllerFork);
  const renderer = materializeProjectNodeFork(EyeballToImageNode, rendererFork);
  const uniforms = controller.process({ componentTime: 0 }, { output: {} }).uniforms;
  const calls = [];
  renderer.moduleExports.applyControlledShaderUniforms({
    setUniform: (...args) => calls.push(args),
  }, uniforms, {});

  assert.deepEqual(uniforms.gazeDir, [1, 0, 0]);
  assert.equal(uniforms.blink, 0.25);
  assert.deepEqual(calls, [["projectFork", 1]]);
});

test("compiled Eyeball lowers to one controlled shader operation without renderer-side visual ID policy", async () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "eyeball-component",
    type: "component",
    chain: [{
      id: "eyeball-source",
      kind: "source",
      source: { type: "generator", generatorId: "eyeball", params: {} },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
  const [rendererSource, specializedSource] = await Promise.all([
    readFile(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
  ]);

  assert.equal(operation.backend, "native-specialized-compound");
  assert.equal(operation.renderer, "output/specialized:controlledShader");
  assert.equal(operation.nativeCompoundProgram.nativeKernels.length, 1);
  assert.equal(typeof operation.nodeModule.gazeBlinkUniforms, "function");
  assert.equal(typeof operation.nodeModule.applyControlledShaderUniforms, "function");
  assert.match(operation.nodeShaders.fragment, /uniform vec3 eyeGazeDir/);
  assert.match(operation.nodeShaders.fragment, /contentUvMatrix/);
  assert.doesNotMatch(rendererSource, /generatorId === "eyeball"|eyeballUniformFrames/);
  assert.match(specializedSource, /registerNativeRenderer\(\s*"output\/specialized:controlledShader"/);
});
