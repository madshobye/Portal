import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms, compileVisualRenderPlan } from "../js/libraries/composition-engine/index.js";
import {
  getGeneratorNodeComponent,
  CameraInputResourceNode,
  MediaImageResourceNode,
  MediaResourceToImageNode,
  ProjectMediaResourceNode,
  ScreenInputResourceNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  mediaResourceToImageProcess,
} from "../js/libraries/visual-nodes/renderers/media-resource-to-image/index.js";
import {
  mediaImageResourceProcess,
} from "../js/libraries/visual-nodes/providers/media-image-resource/index.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/project-visual-node-resolver.js";
import {
  graphNodeFromDefinition,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";
import {
  createProjectVisualGroupDefinition,
  createProjectNodeFork,
  materializeProjectNodeFork,
  NodeRegistry,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import {
  SourceRenderRuntime,
  sourceOperationUsesRuntimeClock,
} from "../js/output/source-render-runtime.js";
import { OutputMediaRuntime } from "../js/output/output-media-runtime.js";
import { withProjectNodeGraph } from "../js/control/node-editor-view.js";

function screenTarget() {
  return {
    width: 640,
    height: 360,
    calls: [],
    push() { this.calls.push(["push"]); },
    pop() { this.calls.push(["pop"]); },
    translate(...values) { this.calls.push(["translate", ...values]); },
    scale(...values) { this.calls.push(["scale", ...values]); },
    image(...values) { this.calls.push(["image", ...values]); },
  };
}

test("Live Camera is a reusable Camera Input to Media Resource Image Group", () => {
  const component = getGeneratorNodeComponent("cameraInput");
  const definition = component.nodeDefinition;
  const definitions = new Map([
    [CameraInputResourceNode.id, CameraInputResourceNode],
    [MediaResourceToImageNode.id, MediaResourceToImageNode],
  ]);
  const outer = graphNodeFromDefinition(definition, {
    id: "camera-input",
    visualProgram: true,
  });
  outer.configuration.source.params.fit = "contain";
  const plan = compileVisualRenderPlan({
    id: "camera-input-test",
    nodes: [outer],
    connections: [{ from: "camera-input.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === definition.id ? definition : definitions.get(node.nodeId),
  });
  const operation = plan.operations[0];
  const render = operation.operations[0];
  operation.valueProgram.evaluate();

  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.valueProgram.steps[0].nodeId, CameraInputResourceNode.id);
  assert.deepEqual(render.runtimeValueInputs.get("resource"), {
    kind: "camera-input-resource",
    inputId: "default",
    ready: true,
  });
  assert.equal(render.backend, "source-runtime");
  assert.equal(typeof render.nodeProcess, "function");
  assert.equal(render.configuration.source.params.fit, "contain");
  assert.equal(render.renderInvalidation.mode, "frame");
  assert.equal(sourceOperationUsesRuntimeClock(render), true);
  const inspection = plan.introspection.snapshot();
  assert.equal(inspection.mediaDemand.camera, true);
  assert.deepEqual(
    inspection.readiness.requirements.filter(({ kind }) => kind === "camera"),
    [{ kind: "camera", id: "default" }],
  );
  assert.equal(
    inspection.references.some(({ kind, id }) => kind === "camera" && id === "default"),
    true,
  );
  plan.dispose();
});

test("compiled visual Groups publish their child-definition closure to the shared resolver", () => {
  const camera = getGeneratorNodeComponent("cameraInput");
  assert.deepEqual(
    camera.childNodeDefinitions.map(({ id }) => id),
    [CameraInputResourceNode.id, MediaResourceToImageNode.id],
  );

  const resolver = createProjectVisualNodeResolver({}, { coreDefinitions: [] });
  assert.strictEqual(
    resolver.definition(CameraInputResourceNode.id),
    CameraInputResourceNode,
  );
  assert.strictEqual(
    resolver.definition(MediaResourceToImageNode.id),
    MediaResourceToImageNode,
  );

  const outer = graphNodeFromDefinition(camera.nodeDefinition, {
    id: "self-describing-camera",
    visualProgram: true,
  });
  const plan = compileVisualRenderPlan({
    id: "self-describing-camera-test",
    nodes: [outer],
    connections: [{
      from: "self-describing-camera.texture",
      to: "$out.texture",
      type: "texture",
    }],
  }, {}, {
    resolveDefinition: (node) => resolver.definition(node.nodeId),
  });
  assert.equal(plan.operations[0].valueProgram.steps[0].nodeId, CameraInputResourceNode.id);
  plan.dispose();
});

test("Screen Share is a connected Screen Input to Media Resource Image Group", () => {
  const component = getGeneratorNodeComponent("screenShare");
  const definition = component.nodeDefinition;
  const definitions = new Map([
    [ScreenInputResourceNode.id, ScreenInputResourceNode],
    [MediaResourceToImageNode.id, MediaResourceToImageNode],
  ]);
  const outer = graphNodeFromDefinition(definition, {
    id: "screen-share",
    visualProgram: true,
  });
  outer.configuration.source.params.inputId = "display-1";
  outer.configuration.source.params.fit = "cover";
  outer.configuration.source.params.mirrored = true;
  const plan = compileVisualRenderPlan({
    id: "screen-share-test",
    nodes: [outer],
    connections: [{ from: "screen-share.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === definition.id ? definition : definitions.get(node.nodeId),
  });
  const operation = plan.operations[0];
  const render = operation.operations[0];
  operation.valueProgram.evaluate();
  const resource = render.runtimeValueInputs.get("resource");

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.deepEqual(definition.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Screen Share Group has no hidden implementation");
  assert.deepEqual(operation.valueProgram.steps.map(({ instanceId, nodeId }) => ({ id: instanceId, nodeId })), [
    { id: "input", nodeId: ScreenInputResourceNode.id },
  ]);
  assert.deepEqual(resource, {
    kind: "screen-input-resource",
    inputId: "display-1",
    ready: true,
  });
  assert.equal(render.configuration.source.params.fit, "cover");
  assert.equal(render.configuration.source.params.mirrored, true);
  assert.equal(render.renderInvalidation.mode, "frame");
  assert.equal(sourceOperationUsesRuntimeClock(render), true);
  assert.equal(
    render.runtimeValueIdentityInputs.get("resource"),
    "drawable-media-resource:screen-input-resource@signal-1",
    "frame-driven resource providers publish temporal identity while their retained descriptor object stays allocation-stable",
  );
  assert.equal(operation.valueProgram.inspect().bindings[0].targetOperationId, "render");
  const inspection = plan.introspection.snapshot();
  assert.deepEqual(inspection.mediaDemand.screenInputs, ["display-1"]);
  assert.deepEqual(
    inspection.readiness.requirements.filter(({ kind }) => kind === "screen-input"),
    [{ kind: "screen-input", id: "display-1" }],
  );
  plan.dispose();
});

test("Project Media is an editable Project Media Resource to Image Group", () => {
  const component = getGeneratorNodeComponent("mediaImage");
  const definition = component.nodeDefinition;
  const definitions = new Map([
    [ProjectMediaResourceNode.id, ProjectMediaResourceNode],
    [MediaResourceToImageNode.id, MediaResourceToImageNode],
  ]);
  const outer = graphNodeFromDefinition(definition, {
    id: "project-media",
    visualProgram: true,
  });
  Object.assign(outer.configuration.source.params, {
    mediaId: "media/video/loop.webm",
    start: 1.25,
    end: 4.5,
    speed: 0.75,
    fit: "cover",
    mirrored: true,
  });
  const plan = compileVisualRenderPlan({
    id: "project-media-test",
    nodes: [outer],
    connections: [{ from: "project-media.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === definition.id ? definition : definitions.get(node.nodeId),
  });
  const operation = plan.operations[0];
  const render = operation.operations[0];
  operation.valueProgram.evaluate();

  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.deepEqual(
    definition.parts.filter((part) =>
      part.kind === NODE_PART_KINDS.JAVASCRIPT ||
      part.kind === NODE_PART_KINDS.SHADER
    ),
    [],
    "the outer Project Media Group cannot retain a parallel decoder or renderer",
  );
  assert.deepEqual(
    operation.valueProgram.steps.map(({ instanceId, nodeId }) => ({
      id: instanceId,
      nodeId,
    })),
    [{ id: "media", nodeId: ProjectMediaResourceNode.id }],
  );
  assert.deepEqual(render.runtimeValueInputs.get("resource"), {
    kind: "project-media-resource",
    mediaKind: "any",
    mediaId: "media/video/loop.webm",
    start: 1.25,
    end: 4.5,
    speed: 0.75,
    ready: true,
    resourceIdentity: "project-media:media/video/loop.webm",
    resourceRevision: "media/video/loop.webm",
  });
  assert.equal(render.configuration.source.params.fit, "cover");
  assert.equal(render.configuration.source.params.mirrored, true);
  assert.equal(render.backend, "source-runtime");
  assert.equal(render.renderInvalidation.mode, "revision");
  assert.equal(sourceOperationUsesRuntimeClock(render), false);
  assert.deepEqual(render.directPlacement, {
    kind: "drawable-resource",
    input: "resource",
    fitParameter: "fit",
    mirrorParameter: "mirrored",
    retainProjectVideoFrame: true,
  });
  const inspection = plan.inspect();
  assert.equal(
    inspection.operations.find((item) =>
      item.id === render.id)?.directPlacement?.kind,
    "drawable-resource",
  );
  assert.deepEqual(inspection.mediaDemand.ids, ["media/video/loop.webm"]);
  assert.deepEqual(inspection.readiness.requirements, [{
    kind: "media",
    id: "media/video/loop.webm",
  }]);
  assert.equal(inspection.dynamics.invalidation.mediaRevisionDependent, true);
  plan.dispose();
});

test("typed media providers and renderer can be combined in an ordinary visual editor graph", () => {
  const screen = graphNodeFromDefinition(ScreenInputResourceNode, {
    id: "screen",
    visualProgram: true,
  });
  const image = graphNodeFromDefinition(MediaImageResourceNode, {
    id: "image",
    visualProgram: true,
  });
  const render = graphNodeFromDefinition(MediaResourceToImageNode, {
    id: "render",
    visualProgram: true,
  });

  assert.equal(nodeDefinitionPlaceableInGraph(ScreenInputResourceNode, "visual-graph"), true);
  assert.equal(nodeDefinitionPlaceableInGraph(MediaImageResourceNode, "visual-graph"), true);
  assert.equal(nodeDefinitionPlaceableInGraph(MediaResourceToImageNode, "visual-graph"), true);
  assert.equal(screen.role, "value");
  assert.equal(image.role, "value");
  assert.equal(render.role, "source");
  assert.equal(render.compilerHook.id, "vj1.visual.source");
  assert.equal(
    MediaImageResourceNode.outlets.resource.type.type,
    MediaResourceToImageNode.inlets.resource.type.type,
  );
  const projectImage = mediaImageResourceProcess({ mediaId: "media/image.png" });
  assert.strictEqual(projectImage.image, projectImage.resource);
  assert.deepEqual(projectImage.resource, {
    kind: "project-media-resource",
    mediaKind: "image",
    mediaId: "media/image.png",
    start: 0,
    end: 0,
    speed: 0,
    ready: true,
    resourceIdentity: "project-media:media/image.png",
    resourceRevision: "media/image.png",
  });

  const serialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.editable-screen-media",
    name: "Editable Screen Media",
  });
  const registry = new NodeRegistry([
    ScreenInputResourceNode,
    MediaResourceToImageNode,
    serialized,
  ]);
  const base = registry.get(serialized.id);
  const project = withProjectNodeGraph({}, base, {
    ...base.parts.find((part) => part.kind === "graph"),
    nodes: [screen, render],
    connections: [
      { from: "screen.resource", to: "render.resource", type: "drawable-media-resource" },
      { from: "render.texture", to: "$out.texture", type: "texture" },
    ],
  });
  const group = materializeProjectNodeFork(base, project.forks[0]);
  const outer = graphNodeFromDefinition(group, {
    id: "editable-screen-media",
    visualProgram: true,
  });
  const plan = compileVisualRenderPlan({
    id: "editable-screen-media-graph",
    nodes: [outer],
    connections: [{ from: "editable-screen-media.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === group.id
        ? group
        : registry.get(node.nodeId),
  });
  const compiled = plan.operations[0];
  assert.equal(compiled.backend, "compiled-visual-group");
  assert.equal(compiled.operations[0].backend, "source-runtime");
  assert.equal(typeof compiled.operations[0].nodeProcess, "function");
  assert.equal(compiled.operations[0].renderInvalidation.mode, "frame");
  assert.equal(compiled.valueProgram.steps[0].nodeId, ScreenInputResourceNode.id);
  assert.equal(compiled.valueProgram.inspect().bindings[0].targetOperationId, "render");
  assert.equal(compiled.valueProgram.inspect().dynamics.frameDependent, true);
  assert.equal(plan.inspect().dynamics.invalidation.mode, "frame");
  plan.dispose();

  const imageSerialized = createProjectVisualGroupDefinition({
    id: "org.vj1.project.editable-image-media",
    name: "Editable Image Media",
  });
  const imageRegistry = new NodeRegistry([
    MediaImageResourceNode,
    MediaResourceToImageNode,
    imageSerialized,
  ]);
  const imageBase = imageRegistry.get(imageSerialized.id);
  const imageProject = withProjectNodeGraph({}, imageBase, {
    ...imageBase.parts.find((part) => part.kind === "graph"),
    nodes: [image, render],
    connections: [
      { from: "image.resource", to: "render.resource", type: "drawable-media-resource" },
      { from: "render.texture", to: "$out.texture", type: "texture" },
    ],
  });
  const imageGroup = materializeProjectNodeFork(
    imageBase,
    imageProject.forks[0],
  );
  const imageOuter = graphNodeFromDefinition(imageGroup, {
    id: "editable-image-media",
    visualProgram: true,
  });
  const imagePlan = compileVisualRenderPlan({
    id: "editable-image-media-graph",
    nodes: [imageOuter],
    connections: [{ from: "editable-image-media.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === imageGroup.id
        ? imageGroup
        : imageRegistry.get(node.nodeId),
  });
  assert.equal(
    imagePlan.operations[0].valueProgram.inspect().dynamics.frameDependent,
    false,
  );
  assert.equal(
    imagePlan.operations[0].operations[0].renderInvalidation.mode,
    "revision",
  );
  assert.equal(imagePlan.inspect().dynamics.invalidation.mode, "revision");
  imagePlan.dispose();
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

test("Media Resource to Image consumes a retained typed resource through its direct node process", () => {
  const target = screenTarget();
  const screen = { readyState: 4 };
  const mediaCalls = [];
  const acquired = [];
  const resource = {
    kind: "screen-input-resource",
    inputId: "display-1",
    ready: true,
  };

  const result = mediaResourceToImageProcess({
    params: { fit: "stretch", mirrored: false },
    runtimeValues: new Map([["resource", resource]]),
  }, {
    target,
    renderView: target,
    acquireDrawableResource(descriptor) {
      acquired.push(descriptor.inputId);
      return screen;
    },
    drawableResourceError: () => "",
    isDrawableMedia: () => true,
    drawMediaFit: (...args) => mediaCalls.push(args),
  });

  assert.strictEqual(result, target);
  assert.deepEqual(acquired, ["display-1"]);
  assert.deepEqual(mediaCalls[0], [target, screen, 0, 0, 640, 360, "stretch"]);

  const image = { naturalWidth: 1280, naturalHeight: 720 };
  mediaCalls.length = 0;
  mediaResourceToImageProcess({
    params: { fit: "contain", mirrored: false },
    resource: {
      kind: "project-media-resource",
      mediaKind: "image",
      mediaId: "media/image.png",
      ready: true,
    },
  }, {
    target,
    renderView: target,
    acquireDrawableResource: () => image,
    drawableResourceError: () => "",
    isDrawableMedia: () => true,
    drawMediaFit: (...args) => mediaCalls.push(args),
  });
  assert.deepEqual(mediaCalls[0], [target, image, 0, 0, 640, 360, "contain"]);

  const camera = { readyState: 4 };
  const cameraAcquisitions = [];
  mediaCalls.length = 0;
  mediaResourceToImageProcess({
    params: { fit: "cover" },
    resource: {
      kind: "camera-input-resource",
      inputId: "default",
      ready: true,
    },
  }, {
    target,
    renderView: target,
    acquireDrawableResource() {
      cameraAcquisitions.push("default");
      return camera;
    },
    drawableResourceError: () => "",
    isDrawableMedia: () => true,
    drawMediaFit: (...args) => mediaCalls.push(args),
  });
  assert.deepEqual(cameraAcquisitions, ["default"]);
  assert.deepEqual(mediaCalls[0], [target, camera, 0, 0, 640, 360, "cover"]);
});

test("project image and video resources resolve through the shared media owner", () => {
  const video = { elt: { tagName: "VIDEO" } };
  const item = { video };
  const acquisitions = [];
  const runtime = Object.create(OutputMediaRuntime.prototype);
  runtime.acquireMediaById = (mediaId, options) => {
    acquisitions.push({ mediaId, options });
    return item;
  };
  runtime.requestMissingMedia = () => {
    throw new Error("unexpected missing-media request");
  };

  const descriptor = {
    kind: "project-media-resource",
    mediaId: "media/video/loop.webm",
    start: 1,
    end: 4,
    speed: 0.5,
  };
  const first = runtime.acquireDrawableResource(descriptor, 1280, {
    playback: { start: 1, end: 4, speed: 0.25 },
  });
  const second = runtime.acquireDrawableResource(descriptor, 640, {
    playback: { start: 1, end: 4, speed: 0.25 },
  });

  assert.strictEqual(first, video);
  assert.strictEqual(second, video);
  assert.deepEqual(acquisitions, [
    {
      mediaId: "media/video/loop.webm",
      options: {
        width: 1280,
        playback: { start: 1, end: 4, speed: 0.25 },
      },
    },
    {
      mediaId: "media/video/loop.webm",
      options: {
        width: 640,
        playback: { start: 1, end: 4, speed: 0.25 },
      },
    },
  ]);
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
        ...(part.id === "media-resource-fit-module"
          ? {
              source: "function drawMediaResourceToImage(target, _media, params) { target.calls.push(['forked', params.fit]); }",
            }
          : {}),
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

test("compiled Screen Share process consumes typed child values and keeps capture lifecycle host-owned", async () => {
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
  const render = operation.operations[0];
  const [sourceRuntime, providerSource] = await Promise.all([
    readFile(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/libraries/visual-nodes/providers/screen-input-resource/index.js", import.meta.url), "utf8"),
  ]);

  assert.equal(operation.backend, "compiled-visual-group");
  assert.equal(operation.valueProgram.steps[0].nodeId, ScreenInputResourceNode.id);
  assert.equal(render.backend, "source-runtime");
  assert.equal(render.renderer, undefined);
  assert.equal(typeof render.nodeProcess, "function");
  assert.equal(typeof render.nodeModule.drawMediaResourceToImage, "function");
  assert.equal(typeof render.nodeModule.mediaResourceToImageProcess, "function");
  assert.match(sourceRuntime, /runtimeValues: operation\.runtimeValueInputs/);
  assert.match(sourceRuntime, /Object\.defineProperty\(invocation\.inputs, portId/);
  assert.match(sourceRuntime, /acquireDrawableResource:\s*\(descriptor, width\)/);
  assert.doesNotMatch(sourceRuntime, /acquireScreenInput:|acquireCameraInput:/);
  assert.doesNotMatch(sourceRuntime, /output\/specialized:screenShare/);
  assert.doesNotMatch(sourceRuntime, /drawScreenShareGenerator\(/);
  assert.doesNotMatch(providerSource, /getDisplayMedia|screenCaptureService|output\//);

  operation.valueProgram.evaluate();
  const target = screenTarget();
  const video = {
    tagName: "VIDEO",
    videoWidth: 1920,
    videoHeight: 1080,
    readyState: 4,
  };
  const acquired = [];
  const runtime = new SourceRenderRuntime({
    state: { ui: {} },
    frameRuntime: { frameIndex: 0 },
    mode: "preview",
  }, {
    mediaRuntime: {
      acquireMediaById() {
        return null;
      },
      requestMissingMedia() {},
      acquireDrawableResource(descriptor) {
        acquired.push(descriptor.inputId);
        return video;
      },
      drawableResourceError() {
        return "";
      },
    },
  });
  runtime.executeCompiledVisualNodeProcess(
    render,
    target,
    render.configuration.source,
    0,
    { width: target.width, height: target.height },
    target,
  );
  assert.deepEqual(acquired, ["display-1"]);
  assert.equal(target.calls.some(([kind]) => kind === "image"), true);
  runtime.dispose();
});
