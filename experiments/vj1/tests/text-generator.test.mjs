import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createGeneratorSource, getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { parseTextMarkdown, TEXT_GENERATOR_FRAGMENT_SHADER, textMaskDimensions, textMaskSignature } from "../js/output/specialized/text-generator-renderer.js";
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
  assert.equal(typeof definition.moduleExports.createTextMask, "function");
  assert.equal(typeof definition.moduleExports.textMaskDimensions, "function");
  assert.equal(typeof definition.moduleExports.textMaskSignature, "function");
  assert.ok(definition.parts.some((part) => part.id === "text-layout-module" && part.kind === "javascript"));
  assert.ok(definition.parts.some((part) => part.id === "vertex-shader" && part.stage === "vertex"));
  assert.ok(definition.parts.some((part) => part.id === "fragment-shader" && part.stage === "fragment"));
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
  assert.match(sourceRuntime, /"output\/specialized:text": "drawTextGenerator"/);
  assert.match(renderer, /this\.specializedSources\.drawText/);
  assert.match(specialized, /textMaskSignature/);
  assert.match(specialized, /operation\?\.nodeModule/);
  assert.match(specialized, /operation\?\.nodeShaders\?\.\[stage\]/);
  assert.match(specialized, /nodeCodeRevision/);
  assert.match(specialized, /nodeShaderRevision/);
  assert.match(specialized, /this\.textMasks\.get\(instanceId\)/);
  assert.match(specialized, /textMaskImage\(canvas, mask\?\.image/);
  assert.match(specialized, /setUniform\("textMask", mask\.image\)/);
  assert.match(parameterView, /data-markdown-editor/);
  assert.match(inputController, /bindMarkdownEditors\(scope\)/);
});
