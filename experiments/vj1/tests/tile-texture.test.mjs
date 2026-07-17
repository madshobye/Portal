import test from "node:test";
import assert from "node:assert/strict";
import { createGeneratorSource, getGeneratorComponent } from "../js/graph/generator-registry.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { TILE_TEXTURE_FRAGMENT_SHADER } from "../js/output/specialized/tile-texture-shader.js";
import { generatorImageMediaControlTemplate } from "../js/control/generator-media-view.js";

test("Tile Texture exposes repeat offset and optional scrolling controls", () => {
  const component = getGeneratorComponent("tileTexture");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  assert.equal(component.category, "texture");
  assert.equal(params.repeat.min, 0.001);
  assert.equal(params.repeat.max, 64);
  assert.equal(params.repeat.defaultValue, 1);
  assert.equal(params.repeatX, undefined);
  assert.equal(params.repeatY, undefined);
  assert.equal(component.runtime.timeDependent({ scrollX: 0, scrollY: 0 }), false);
  assert.equal(component.runtime.timeDependent({ scrollX: 0.1, scrollY: 0 }), true);
});

test("Tile Texture repeats its selected image with wrapped shader coordinates", () => {
  const source = createGeneratorSource("tileTexture", { imageId: "tiles.png", repeat: 8 });
  assert.equal(source.params.imageId, "tiles.png");
  assert.match(TILE_TEXTURE_FRAGMENT_SHADER, /contentUvMatrix \* vec3\(vTexCoord, 1\.0\)/);
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
