import test from "node:test";
import assert from "node:assert/strict";

import { compileVisualRenderPlan } from "../js/libraries/composition-engine/index.js";
import {
  createGeneratorSource,
  getEffectNodeComponent,
  getGeneratorNodeComponent,
  listEffectNodeComponents,
  listGeneratorNodeComponents,
} from "../js/libraries/visual-nodes/index.js";
import { NODE_PART_KINDS } from "../js/libraries/node-engine/index.js";
import { graphNodeFromDefinition } from "../js/control/node-graph-canvas.js";
import { generatorImageMediaControlTemplate } from "../js/control/generator-media-view.js";
import { mediaImageNodeProcess } from "../js/libraries/visual-nodes/generators/media-image/index.js";
import { OutputRenderer } from "../js/output/output-renderer.js";
import { SpecializedSourceRuntime } from "../js/output/specialized/specialized-source-runtime.js";

test("Tile Texture is an editable media-image plus shader-effect Group", () => {
  const component = getGeneratorNodeComponent("tileTexture");
  const params = Object.fromEntries(component.params.map((param) => [param.id, param]));
  const graph = component.nodeDefinition.parts.find((part) => part.kind === NODE_PART_KINDS.GRAPH);
  const definitions = new Map([
    ...listGeneratorNodeComponents(),
    ...listEffectNodeComponents(),
  ].map((visual) => [visual.nodeDefinition.id, visual.nodeDefinition]));
  const outer = graphNodeFromDefinition(component.nodeDefinition, {
    id: "tile-texture",
    visualProgram: true,
  });
  const plan = compileVisualRenderPlan({
    id: "tile-texture-test",
    nodes: [outer],
    connections: [{ from: "tile-texture.texture", to: "$out.texture", type: "texture" }],
  }, {}, {
    resolveDefinition: (node) =>
      node.nodeId === component.nodeDefinition.id
        ? component.nodeDefinition
        : definitions.get(node.nodeId),
  });

  assert.equal(component.category, "texture");
  assert.deepEqual(params.tileAxis.values, ["both", "horizontal", "vertical"]);
  assert.equal(params.repeat.min, 0.001);
  assert.equal(params.repeat.max, 64);
  assert.equal(component.runtime.timeDependent({ scrollX: 0, scrollY: 0 }), false);
  assert.equal(component.runtime.timeDependent({ scrollX: 0.1, scrollY: 0 }), true);
  assert.equal(component.renderAuthority, "compiled-graph");
  assert.equal(component.nodeDefinition.metadata.nativeRenderer, "");
  assert.deepEqual(graph.nodes.map((node) => node.type), [
    "vj1.visual.generator.mediaImage",
    "vj1.visual.effect.tileRepeat",
  ]);
  assert.deepEqual(graph.connections, [
    { from: "image.texture", to: "render.texture", type: "texture" },
    { from: "render.texture", to: "$out.texture", type: "texture" },
  ]);
  assert.deepEqual(plan.operations[0].operations.map((operation) => operation.backend), [
    "source-runtime",
    "shader-effect",
  ]);
  assert.equal(
    plan.operations[0].operations[1].contract.transform.domain,
    "group-field",
    "the Group transform belongs to the repeat field rather than a composition-wide post effect",
  );
  assert.deepEqual(plan.operations[0].operations[1].lowering.inputDemand, {
    mode: "full-frame",
    halo: 0,
    coordinateSpace: "full-frame",
    mapping: "periodic",
  });
  assert.equal(plan.operations[0].nativeCompoundProgram, undefined);
  assert.equal(
    new SpecializedSourceRuntime().hasNativeRenderer("output/specialized:tileTexture"),
    false,
  );
});

test("Tile Repeat is a reusable ordinary shader effect", () => {
  const effect = getEffectNodeComponent("tileRepeat");
  const shader = effect.nodeDefinition.parts.find((part) => part.kind === NODE_PART_KINDS.SHADER);
  assert.ok(shader);
  assert.match(shader.source, /fract\(/);
  assert.match(shader.source, /transformEffectUv\(effectScreenUv\(\)\)/);
  assert.match(shader.source, /inverseTransformEffectUv\(tileFieldUv\)/);
  assert.match(shader.source, /sampleSource\(sourceUv\)/);
  assert.equal(effect.nodeDefinition.metadata.nativeRenderer, undefined);
  assert.equal(effect.nodeDefinition.metadata.visualKind, "effect");
  assert.equal(effect.nodeDefinition.metadata.transformSource, false);
  assert.equal(effect.nodeDefinition.metadata.visualContract.roi.mode, "full-frame");
  assert.equal(effect.nodeDefinition.metadata.visualContract.roi.inputMapping, "periodic");
});

test("Media Image is a reusable retained texture source", () => {
  const calls = [];
  const image = { width: 64, height: 64 };
  mediaImageNodeProcess({ params: { mediaId: "tiles.png", fit: "stretch" } }, {
    target: { id: "target" },
    renderView: { width: 320, height: 180 },
    acquireMedia: (id, options) => {
      calls.push(["acquire", id, options]);
      return { image };
    },
    isDrawableMedia: (candidate) => candidate === image,
    drawMediaFit: (...args) => calls.push(["draw", ...args]),
  });
  assert.deepEqual(calls[0], ["acquire", "tiles.png", { width: 320 }]);
  assert.deepEqual(calls[1].slice(0, 3), ["draw", { id: "target" }, image]);
  assert.deepEqual(calls[1].slice(-5), [0, 0, 320, 180, "stretch"]);
});

test("Tile Texture retains its existing catalog controls and media dependency", () => {
  const source = createGeneratorSource("tileTexture", { imageId: "tiles.png", repeat: 8 });
  assert.equal(source.params.imageId, "tiles.png");
  const controls = generatorImageMediaControlTemplate("components.0.source", source, {
    media: [{ id: "tiles.png", name: "media/textures/Tiles.png", path: "media/textures/Tiles.png", type: "image" }],
  });
  assert.match(controls, /data-media-path="components\.0\.source\.params\.imageId"/);
  assert.match(controls, />Tiles\.png</);
  assert.doesNotMatch(controls, /<small>/);
  assert.doesNotMatch(controls, />media\/textures\//);

  const renderer = new OutputRenderer({ mode: "component" });
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
  assert.deepEqual(renderer.visualMediaResourceIds("tileTexture", source.params), ["tiles.png"]);
  renderer.media.set("tiles.png", { ready: true });
  assert.equal(renderer.sourceIsFrameDynamic(source), false);
  source.params.scrollY = 0.5;
  assert.equal(renderer.sourceIsFrameDynamic(source), true);
});
