import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import {
  compileSpecializedCompoundProgram,
  getGeneratorNodeComponent,
  MediaResourceToImageNode,
  ScreenInputResourceNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";

function screenTarget() {
  return {
    width: 640,
    height: 360,
    calls: [],
    push() { this.calls.push(["push"]); },
    pop() { this.calls.push(["pop"]); },
    translate(...values) { this.calls.push(["translate", ...values]); },
    scale(...values) { this.calls.push(["scale", ...values]); },
  };
}

test("Screen Share is a connected Screen Input to Media Resource Image Group", () => {
  const component = getGeneratorNodeComponent("screenShare");
  const definition = component.nodeDefinition;
  const definitions = new Map([
    [ScreenInputResourceNode.id, ScreenInputResourceNode],
    [MediaResourceToImageNode.id, MediaResourceToImageNode],
  ]);
  const program = compileSpecializedCompoundProgram(definition, {
    resolveDefinition: ({ nodeId }) => definitions.get(nodeId),
  });
  const graph = program.evaluateGraph({
    inputId: "display-1",
    fit: "cover",
    mirrored: true,
  }, { instanceId: "screen-share-test" });
  const resource = graph.stageInput("render", "resource");
  const renderSettings = graph.stageInputs("render").settings;

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.deepEqual(definition.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Screen Share Group has no hidden implementation");
  assert.deepEqual(program.stages.map(({ id, nodeId }) => ({ id, nodeId })), [
    { id: "input", nodeId: ScreenInputResourceNode.id },
    { id: "render", nodeId: MediaResourceToImageNode.id },
  ]);
  assert.deepEqual(program.nativeKernel("media-resource-fit").inputBindings.resource, {
    stageId: "input",
    portId: "resource",
  });
  assert.deepEqual(resource, {
    kind: "screen-input-resource",
    inputId: "display-1",
    ready: true,
  });
  assert.equal(renderSettings.fit, "cover");
  assert.equal(renderSettings.mirrored, true);
  program.dispose();
});

test("Media Resource to Image owns fit and mirroring independently from capture acquisition", () => {
  const target = screenTarget();
  const screen = { readyState: 4 };
  const mediaCalls = [];

  MediaResourceToImageNode.moduleExports.drawMediaResourceToImage(
    target,
    screen,
    { fit: "cover", mirrored: true },
    (...args) => mediaCalls.push(args),
  );

  assert.deepEqual(target.calls, [["push"], ["translate", 640, 0], ["scale", -1, 1], ["pop"]]);
  assert.deepEqual(mediaCalls[0], [target, screen, 0, 0, 640, 360, "cover"]);
});

test("Screen Input and Media Resource Image child implementations are independently forkable", () => {
  const resourceFork = createProjectNodeFork(ScreenInputResourceNode, {
    forkId: "screen-input-project",
    overrides: {
      parts: ScreenInputResourceNode.parts.map((part) => ({
        ...part,
        source: "function screenInputResourceProcess({ inputId = '' } = {}) { return { resource: { kind: 'screen-input-resource', inputId: `fork:${inputId}`, ready: true } }; }",
      })),
    },
  });
  const renderFork = createProjectNodeFork(MediaResourceToImageNode, {
    forkId: "media-resource-fit-project",
    overrides: {
      parts: MediaResourceToImageNode.parts.map((part) => ({
        ...part,
        source: "function drawMediaResourceToImage(target, _media, params) { target.calls.push(['forked', params.fit]); }",
      })),
    },
  });
  const resource = materializeProjectNodeFork(ScreenInputResourceNode, resourceFork);
  const render = materializeProjectNodeFork(MediaResourceToImageNode, renderFork);

  assert.equal(resource.process({ inputId: "display-1" }).resource.inputId, "fork:display-1");
  const target = screenTarget();
  render.moduleExports.drawMediaResourceToImage(target, {}, { fit: "stretch" });
  assert.deepEqual(target.calls, [["forked", "stretch"]]);
});

test("compiled Screen Share host consumes child module values and keeps capture lifecycle host-owned", async () => {
  const packageRoot = createVj1NodePackage();
  const component = {
    id: "screen-share-component",
    name: "Screen Share",
    type: "component",
    chain: [{
      id: "screen-share-source",
      kind: "source",
      source: {
        type: "generator",
        generatorId: "screenShare",
        params: { inputId: "display-1", fit: "contain", mirrored: false },
      },
    }],
  };
  const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
  const operation = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  }).get(component.id).plan.operations[0];
  const [sourceRuntime, providerSource] = await Promise.all([
    readFile(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/libraries/visual-nodes/providers/screen-input-resource/index.js", import.meta.url), "utf8"),
  ]);

  assert.equal(operation.backend, "native-specialized-compound");
  assert.equal(operation.renderer, "output/specialized:screenShare");
  assert.equal(typeof operation.nodeModule.drawMediaResourceToImage, "function");
  assert.match(sourceRuntime, /graph\?\.stageInput\(renderStageId, "resource"\)/);
  assert.match(sourceRuntime, /operation\?\.nodeModule\?\.drawMediaResourceToImage/);
  assert.match(sourceRuntime, /this\.host\.acquireScreenInput\(inputId\)/);
  assert.match(sourceRuntime, /this\.host\.screenError\(inputId\)/);
  assert.doesNotMatch(providerSource, /getDisplayMedia|screenCaptureService|output\//);
});
