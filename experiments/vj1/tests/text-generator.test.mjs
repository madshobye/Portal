import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createGeneratorSource,
  getGeneratorNodeComponent as getGeneratorComponent,
  TextMaskProviderNode,
  TextMaskToImageNode,
} from "../js/libraries/visual-nodes/index.js";
import { compileVisualRenderPlan } from "../js/libraries/composition-engine/index.js";
import { RenderDemandNode, renderDemandProcess } from "../js/libraries/render-engine/index.js";
import {
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
import {
  graphNodeFromDefinition,
  NODE_GRAPH_AUTHORING_TARGETS,
  nodeDefinitionPlaceableInGraph,
} from "../js/control/node-graph-canvas.js";
import { createTextMask, parseTextMarkdown, TEXT_GENERATOR_FRAGMENT_SHADER, textMaskDimensions, textMaskSignature } from "../js/output/specialized/text-generator-renderer.js";
import { textNodeRuntimeModule, textNodeShaderSource } from "../js/output/specialized/specialized-source-runtime.js";

test("text generator exposes portable typography and persistent style parameters", () => {
  const component = getGeneratorComponent("text");
  const definition = component.nodeDefinition;
  assert.equal(component.category, "typography");
  assert.equal(component.runtime.timeDependent({}), false);
  assert.ok(component.params.some((param) => param.id === "text" && param.type === "text" && param.ui === "markdown"));
  assert.ok(component.params.some((param) => param.id === "layout"));
  assert.ok(component.params.some((param) => param.id === "fillColor"));
  assert.ok(component.params.some((param) => param.id === "outlineWidth"));
  assert.ok(component.params.some((param) => param.id === "bold" && param.type === "boolean"));
  assert.ok(component.params.some((param) => param.id === "fillEnabled" && param.defaultValue === true));
  assert.ok(component.params.some((param) => param.id === "outlineEnabled" && param.defaultValue === false));
  assert.equal(createGeneratorSource("text", { text: 42 }).params.text, "42");
  assert.equal(definition.metadata.nativeRenderer, "");
  assert.equal(definition.implementation.executionModel, "compiled-graph");
  assert.equal(definition.presentation.expandable, true);
  assert.deepEqual(definition.parts.filter((part) =>
    part.kind === NODE_PART_KINDS.JAVASCRIPT || part.kind === NODE_PART_KINDS.SHADER
  ), [], "the outer Text Group has no hidden editable implementation");
  assert.equal(typeof TextMaskProviderNode.moduleExports.createTextMask, "function");
  assert.match(createTextMask.toString(), /willReadFrequently: true/);
  assert.equal(typeof TextMaskProviderNode.moduleExports.textMaskDimensions, "function");
  assert.equal(typeof TextMaskProviderNode.moduleExports.textMaskSignature, "function");
  assert.ok(TextMaskProviderNode.parts.some((part) => part.id === "text-layout-module" && part.kind === "javascript"));
  assert.equal(TextMaskToImageNode.metadata.nodeOwnedNativeModule, true);
  assert.ok(TextMaskToImageNode.parts.some((part) => part.id === "vertex-shader" && part.stage === "vertex"));
  assert.ok(TextMaskToImageNode.parts.some((part) => part.id === "fragment-shader" && part.stage === "fragment"));
});

test("Text demand, mask, and retained image kernel are ordinary visual-editor nodes", () => {
  for (const definition of [
    RenderDemandNode,
    TextMaskProviderNode,
    TextMaskToImageNode,
  ]) {
    assert.equal(
      nodeDefinitionPlaceableInGraph(
        definition,
        NODE_GRAPH_AUTHORING_TARGETS.VISUAL,
      ),
      true,
      `${definition.id} must be placeable in an authored visual Group`,
    );
  }
  assert.equal(
    graphNodeFromDefinition(TextMaskProviderNode, {
      id: "mask",
      visualProgram: true,
    }).role,
    "value",
  );
  const render = graphNodeFromDefinition(TextMaskToImageNode, {
    id: "render",
    visualProgram: true,
  });
  assert.equal(render.role, "source");
  assert.equal(render.compilerHook.id, "vj1.visual.native-source");
});

test("Text compiles a connected reusable mask provider and retained image kernel", () => {
  const definition = getGeneratorComponent("text").nodeDefinition;
  const definitions = new Map([
    [RenderDemandNode.id, RenderDemandNode],
    [TextMaskProviderNode.id, TextMaskProviderNode],
    [TextMaskToImageNode.id, TextMaskToImageNode],
  ]);
  const outer = graphNodeFromDefinition(definition, {
    id: "text",
    visualProgram: true,
  });
  outer.configuration.source.params.text = "NODE";
  outer.configuration.source.params.fillColor = "#ff0000ff";
  const plan = compileVisualRenderPlan({
    id: "text-test",
    nodes: [outer],
    connections: [{ from: "text.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === definition.id ? definition : definitions.get(node.nodeId),
  });
  const operation = plan.operations[0];
  const render = operation.operations[0];
  const graph = definition.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH);

  assert.deepEqual(operation.valueProgram.steps.map((step) => step.instanceId), ["demand", "mask"]);
  assert.ok(graph.connections.some((edge) =>
    edge.from === "demand.domainWidth" && edge.to === "mask.width"));
  assert.ok(graph.connections.some((edge) =>
    edge.from === "demand.domainHeight" && edge.to === "mask.height"));
  assert.equal(operation.valueProgram.bindings.length, 1);
  assert.deepEqual(
    {
      source: `${operation.valueProgram.bindings[0].sourceStepId.split("/").at(-1)}.${operation.valueProgram.bindings[0].sourcePortId}`,
      target: `${render.id}.${operation.valueProgram.bindings[0].targetPortId}`,
    },
    { source: "mask.mask", target: "render.mask" },
  );
  assert.equal(operation.valueProgram.steps[1].parameters.text, "NODE");
  assert.equal(operation.valueProgram.steps[1].parameters.fillColor, undefined);
  assert.equal(render.configuration.source.params.fillColor, "#ff0000ff");
  assert.equal(render.renderer, "output/specialized:text");
  assert.match(render.nodeShaders.fragment, /uniform sampler2D textMask/);
  const inspection = plan.inspect();
  assert.equal(inspection.dynamics.hasValueProgram, true);
  assert.equal(inspection.valuePrograms.length, 1);
  assert.equal(inspection.valuePrograms[0].executionModel, "retained-typed-values");
  assert.deepEqual(
    inspection.valuePrograms[0].steps.map((step) => step.nodeId),
    [RenderDemandNode.id, TextMaskProviderNode.id],
  );
  assert.equal(inspection.valuePrograms[0].bindings[0].sourceType, "text-mask-provider");
  assert.equal(inspection.valuePrograms[0].bindings[0].targetType, "text-mask-provider");
  plan.dispose();
});

test("Text child layout and shader implementations are independently forkable", () => {
  const layoutFork = createProjectNodeFork(TextMaskProviderNode, {
    forkId: "text-mask-layout-project",
    overrides: {
      parts: TextMaskProviderNode.parts.map((part) => part.id === "text-layout-module"
        ? {
            ...part,
            source: [
              "function createTextMask(_params, _width, _height, existing) { return existing || { forked: true }; }",
              "function textMaskDimensions(width, height) { return { width, height }; }",
              "function textMaskSignature() { return 'forked-layout'; }",
              "function parseTextMarkdown() { return []; }",
            ].join("\n"),
          }
        : part),
    },
  });
  const shaderFork = createProjectNodeFork(TextMaskToImageNode, {
    forkId: "text-mask-shader-project",
    overrides: {
      parts: TextMaskToImageNode.parts.map((part) => part.id === "fragment-shader"
        ? { ...part, source: `${part.source}\n// project text shader` }
        : part),
    },
  });
  const layout = materializeProjectNodeFork(TextMaskProviderNode, layoutFork);
  const shader = materializeProjectNodeFork(TextMaskToImageNode, shaderFork);

  assert.equal(layout.moduleExports.textMaskSignature(), "forked-layout");
  assert.deepEqual(layout.moduleExports.createTextMask({}, 1, 1), { forked: true });
  assert.match(shader.parts.find((part) => part.id === "fragment-shader").source, /project text shader/);
});

test("text mask uses a stable bounded full-boundary raster instead of ROI dimensions", () => {
  const full = renderDemandProcess({}, {
    renderRequest: {
      width: 1920,
      height: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      uvRect: [0, 0, 1, 1],
    },
  });
  const clipped = renderDemandProcess({}, {
    renderRequest: {
      width: 480,
      height: 1080,
      logicalWidth: 1920,
      logicalHeight: 1080,
      uvRect: [0.75, 0, 0.25, 1],
    },
  });
  assert.deepEqual(
    { width: clipped.width, height: clipped.height },
    { width: 480, height: 1080 },
    "ROI allocation retains only visible pixels",
  );
  assert.deepEqual(
    { width: clipped.domainWidth, height: clipped.domainHeight },
    { width: full.domainWidth, height: full.domainHeight },
    "partial visibility cannot become a new Text layout domain",
  );
  assert.deepEqual(
    textMaskDimensions(clipped.domainWidth, clipped.domainHeight),
    textMaskDimensions(full.domainWidth, full.domainHeight),
  );
  assert.deepEqual(textMaskDimensions(1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(textMaskDimensions(11760, 6615), { width: 4096, height: 2304 });
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /renderUvRect\.xy \+ vTexCoord \* renderUvRect\.zw/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /contentUvMatrix \* vec3\(boundaryUv, 1\.0\)/);
});

test("text markdown parser retains structure but strips legacy inline style syntax", () => {
  const [heading, body] = parseTextMarkdown("# Main **title**\nSoft *motion* and <u>line</u>");
  assert.equal(heading.headingLevel, 1);
  assert.equal(heading.runs[0].text, "Main title");
  assert.equal(body.runs[0].text, "Soft motion and line");
  assert.equal(heading.runs[0].bold, undefined);
});

test("text mask cache ignores shader-only colors but follows layout state", () => {
  const base = { text: "Hello", layout: "fit lines", fillColor: "#ffffffff" };
  assert.equal(
    textMaskSignature(base, 800, 600),
    textMaskSignature({ ...base, fillColor: "#ff0000ff", outlineColor: "#00ff00ff" }, 800, 600),
  );
  assert.notEqual(textMaskSignature(base, 800, 600), textMaskSignature({ ...base, text: "World" }, 800, 600));
  assert.notEqual(textMaskSignature(base, 800, 600), textMaskSignature({ ...base, bold: true }, 800, 600));
  assert.notEqual(textMaskSignature(base, 800, 600), textMaskSignature(base, 1920, 1080));
});

test("text shader performs GPU fill and outline composition", () => {
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /uniform sampler2D textMask/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /uniform vec4 fillColor/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /uniform vec4 outlineColor/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /uniform float fillEnabled/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /uniform float outlineEnabled/);
  assert.match(TEXT_GENERATOR_FRAGMENT_SHADER, /for \(int ring = 1; ring <= 3; ring\+\+\)/);
});

test("Text host adapter consumes the compiler-supplied node module and shaders", () => {
  const createTextMask = () => "mask";
  const signature = () => "signature";
  const operation = {
    nodeModule: { createTextMask, textMaskSignature: signature },
    nodeShaders: { vertex: "node vertex", fragment: "node fragment" },
  };

  assert.strictEqual(textNodeRuntimeModule(operation).createTextMask, createTextMask);
  assert.strictEqual(textNodeRuntimeModule(operation).textMaskSignature, signature);
  assert.equal(textNodeShaderSource(operation, "vertex"), "node vertex");
  assert.equal(textNodeShaderSource(operation, "fragment"), "node fragment");
  assert.match(textNodeShaderSource({}, "fragment"), /uniform sampler2D textMask/);
});

test("text generator uses an ordinary retained-value graph and generic retained Markdown editor", async () => {
  const component = getGeneratorComponent("text");
  const [renderer, sourceRuntime, specialized, textRuntime, artifacts, parameterView, inputController, markdownNode, uiProgram] = await Promise.all([
    readFile(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/specialized/text-render-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/specialized/specialized-node-artifacts.js", import.meta.url), "utf8"),
    readFile(new URL("../js/control/parameter-view.js", import.meta.url), "utf8"),
    readFile(new URL("../js/control/input-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../js/libraries/ui-engine/nodes/markdown-node.js", import.meta.url), "utf8"),
    readFile(new URL("../js/control/control-ui-program.js", import.meta.url), "utf8"),
  ]);
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  assert.doesNotMatch(sourceRuntime, /NATIVE_SOURCE_HOST_METHODS/);
  assert.match(specialized, /registerNativeRenderer\(\s*"output\/specialized:text"/);
  assert.doesNotMatch(renderer, /this\.specializedSources\.drawText/);
  assert.match(textRuntime, /^  draw\(/m);
  assert.match(textRuntime, /operation\?\.runtimeValueInputs\?\.get\?\.\("mask"\)/);
  assert.match(textRuntime, /!maskValue\?\.canvas/);
  assert.match(artifacts, /operation\?\.nodeShaders\?\.\[id\]/);
  assert.match(artifacts, /TEXT_COMPILED_SHADER_MISSING/);
  assert.match(textRuntime, /nodeShaderRevision/);
  assert.match(textRuntime, /textMaskImage\(canvas, mask\?\.image/);
  assert.match(textRuntime, /setUniform\("textMask", mask\.image\)/);
  assert.doesNotMatch(parameterView, /data-markdown-editor|markdownParamControlTemplate/);
  assert.doesNotMatch(inputController, /bindMarkdownEditors|data-markdown/);
  assert.match(markdownNode, /core\.ui\.markdown-input/);
  assert.match(markdownNode, /emit\("style"/);
  assert.match(uiProgram, /project\.set-related-value/);
});
