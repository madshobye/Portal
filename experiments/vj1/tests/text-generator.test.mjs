import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  compileSpecializedCompoundProgram,
  createGeneratorSource,
  getGeneratorNodeComponent as getGeneratorComponent,
  TextMaskProviderNode,
  TextMaskToImageNode,
} from "../js/libraries/visual-nodes/index.js";
import {
  createProjectNodeFork,
  materializeProjectNodeFork,
  NODE_PART_KINDS,
} from "../js/libraries/node-engine/index.js";
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
  assert.equal(definition.metadata.nodeOwnedNativeModule, true);
  assert.equal(definition.metadata.nodeOwnedNativeProcess, false);
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
  assert.ok(TextMaskToImageNode.parts.some((part) => part.id === "vertex-shader" && part.stage === "vertex"));
  assert.ok(TextMaskToImageNode.parts.some((part) => part.id === "fragment-shader" && part.stage === "fragment"));
});

test("Text compiles a connected reusable mask provider and retained image kernel", () => {
  const definition = getGeneratorComponent("text").nodeDefinition;
  const definitions = new Map([
    [TextMaskProviderNode.id, TextMaskProviderNode],
    [TextMaskToImageNode.id, TextMaskToImageNode],
  ]);
  const program = compileSpecializedCompoundProgram(definition, {
    resolveDefinition: ({ nodeId }) => definitions.get(nodeId),
  });
  const kernel = program.nativeKernel("text-mask");

  assert.deepEqual(program.stages.map((stage) => stage.id), ["mask", "render"]);
  assert.deepEqual(program.executableStages, ["mask"]);
  assert.equal(kernel.id, "render");
  assert.deepEqual(kernel.inputBindings.mask, { stageId: "mask", portId: "mask" });
  assert.equal(program.output, "render.texture");
  assert.equal(program.stageParameterView("mask", { text: "NODE", fillColor: "#ff0000ff" }).text, "NODE");
  assert.equal(program.stageParameterView("mask", { text: "NODE", fillColor: "#ff0000ff" }).fillColor, undefined);
  assert.equal(program.stageParameterView("render", { text: "NODE", fillColor: "#ff0000ff" }).fillColor, "#ff0000ff");
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

test("text generator is routed through specialized cached rendering and compact editor", async () => {
  const component = getGeneratorComponent("text");
  const [renderer, sourceRuntime, specialized, parameterView, inputController] = await Promise.all([
    readFile(new URL("../js/output/output-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/source-render-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8"),
    readFile(new URL("../js/control/parameter-view.js", import.meta.url), "utf8"),
    readFile(new URL("../js/control/input-controller.js", import.meta.url), "utf8"),
  ]);
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "output/specialized:text");
  assert.doesNotMatch(sourceRuntime, /NATIVE_SOURCE_HOST_METHODS/);
  assert.match(specialized, /registerNativeRenderer\(\s*"output\/specialized:text"/);
  assert.match(renderer, /this\.specializedSources\.drawText/);
  assert.match(specialized, /specializedCompoundNativeKernel\(operation, "text-mask"\)/);
  assert.match(specialized, /evaluateSpecializedCompoundGraph/);
  assert.match(specialized, /graph\?\.stageInput\(renderStageId, "mask"\)/);
  assert.match(specialized, /maskValue\?\.canvas/);
  assert.match(specialized, /Compatibility-only direct host calls/);
  assert.match(specialized, /operation\?\.nodeShaders\?\.\[id\]/);
  assert.match(specialized, /TEXT_COMPILED_SHADER_MISSING/);
  assert.match(specialized, /nodeCodeRevision/);
  assert.match(specialized, /nodeShaderRevision/);
  assert.match(specialized, /this\.textMasks\.get\(instanceId\)/);
  assert.match(specialized, /mask\.providerRevision !== providerRevision/);
  assert.match(specialized, /textMaskImage\(canvas, mask\?\.image/);
  assert.match(specialized, /willReadFrequently: true/);
  assert.match(specialized, /setUniform\("textMask", mask\.image\)/);
  assert.match(parameterView, /data-markdown-editor/);
  assert.match(inputController, /bindMarkdownEditors\(scope\)/);
});
