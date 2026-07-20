import test from "node:test";
import assert from "node:assert/strict";
import { createGeneratorSource, getGeneratorNodeComponent as getGeneratorComponent } from "../js/libraries/visual-nodes/index.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/index.js";
import { createProjectNodeFork, NODE_PART_KINDS } from "../js/libraries/node-engine/index.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { TILE_TEXTURE_FRAGMENT_SHADER, TILE_TEXTURE_VERTEX_SHADER } from "../js/output/specialized/tile-texture-shader.js";
import { generatorImageMediaControlTemplate } from "../js/control/generator-media-view.js";
import { tileRepeatAmount, tileTextureNodeRuntimeModule, tileTextureNodeShaderSource } from "../js/output/specialized/specialized-source-runtime.js";

test("Tile Texture exposes repeat offset and optional scrolling controls", () => {
  const component = getGeneratorComponent("tileTexture");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  assert.equal(component.category, "texture");
  assert.deepEqual(params.tileAxis.values, ["both", "horizontal", "vertical"]);
  assert.equal(params.tileAxis.defaultValue, "both");
  assert.equal(params.repeat.min, 0.001);
  assert.equal(params.repeat.max, 64);
  assert.equal(params.repeat.defaultValue, 1);
  assert.equal(params.repeatX, undefined);
  assert.equal(params.repeatY, undefined);
  assert.equal(component.runtime.timeDependent({ scrollX: 0, scrollY: 0 }), false);
  assert.equal(component.runtime.timeDependent({ scrollX: 0.1, scrollY: 0 }), true);
  assert.deepEqual(tileRepeatAmount({ repeat: 8, tileAxis: "both" }), [8, 8]);
  assert.deepEqual(tileRepeatAmount({ repeat: 8, tileAxis: "horizontal" }), [8, 1]);
  assert.deepEqual(tileRepeatAmount({ repeat: 8, tileAxis: "vertical" }), [1, 8]);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeModule, true);
  assert.equal(component.nodeDefinition.metadata.nodeOwnedNativeProcess, false);
  assert.deepEqual(component.nodeDefinition.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => part.id), [
    "tile-texture-vertex",
    "tile-texture-fragment",
  ]);
});

test("Tile Texture project forks supply the retained host with node-owned helpers and shaders", () => {
  const base = getGeneratorComponent("tileTexture").nodeDefinition;
  const fork = createProjectNodeFork(base, {
    forkId: "tile-texture-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "tile-repeat-module"
        ? { ...part, source: "function tileRepeatAmount() { return [3, 4]; }" }
        : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const resolved = resolver.definition(base.id);
  const operation = {
    nodeModule: resolved.moduleExports,
    nodeShaders: Object.fromEntries(resolved.parts.filter((part) => part.kind === NODE_PART_KINDS.SHADER).map((part) => [part.id, part.source])),
  };

  assert.deepEqual(tileTextureNodeRuntimeModule(operation).tileRepeatAmount({ repeat: 8 }), [3, 4]);
  assert.equal(tileTextureNodeShaderSource(operation, "vertex"), TILE_TEXTURE_VERTEX_SHADER);
  assert.equal(tileTextureNodeShaderSource(operation, "fragment"), TILE_TEXTURE_FRAGMENT_SHADER);
});

test("Tile Texture repeats its selected image with wrapped shader coordinates", () => {
  const source = createGeneratorSource("tileTexture", { imageId: "tiles.png", repeat: 8 });
  assert.equal(source.params.imageId, "tiles.png");
  assert.match(TILE_TEXTURE_FRAGMENT_SHADER, /renderUvRect\.xy \+ vTexCoord \* renderUvRect\.zw/);
  assert.match(TILE_TEXTURE_FRAGMENT_SHADER, /contentUvMatrix \* vec3\(boundaryUv, 1\.0\)/);
  assert.match(TILE_TEXTURE_FRAGMENT_SHADER, /fract\(compositionUv \* repeatAmount/);
  assert.match(TILE_TEXTURE_FRAGMENT_SHADER, /texture2D\(tileImage, tileUv\)/);
  const controls = generatorImageMediaControlTemplate("components.0.source", source, {
    media: [{ id: "tiles.png", name: "Tiles", path: "media/tiles.png" }],
  });
  assert.match(controls, /data-media-path="components\.0\.source\.params\.imageId"/);
  assert.match(controls, />Tiles</);
});

test("Tile Texture remains dynamic until its selected image is decoded", () => {
  const renderer = new OutputRenderer({ mode: "component" });
  const source = createGeneratorSource("tileTexture", { imageId: "tiles.png", scrollX: 0, scrollY: 0 });
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
  renderer.media.set("tiles.png", { ready: true });
  assert.equal(renderer.sourceIsFrameDynamic(source), false);
  source.params.scrollY = 0.5;
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
});
