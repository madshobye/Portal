import test from "node:test";
import assert from "node:assert/strict";

import {
  SpecializedSourceRuntime,
  featureMorphNodeRuntimeModule,
  featureMorphNodeShaderSource,
  terrainNodeRuntimeModule,
  terrainNodeShaderSource,
  specializedResourceIdentity,
  textNodeRuntimeModule,
  textNodeShaderSource,
} from "../js/output/specialized/specialized-source-runtime.js";
import { meshPatternNodeShaderSource } from "../js/output/specialized/mesh-pattern-renderer.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import {
  specializedCompoundEvaluatedStageSettings,
  TerrainBiomeMaterialProviderNode,
  TerrainHeightFieldGeometryProviderNode,
} from "../js/libraries/visual-nodes/index.js";

const compiled = Object.freeze({ nativeCompoundProgram: {} });

test("compiled specialized Groups never substitute host JavaScript for missing child modules", () => {
  assert.throws(
    () => textNodeRuntimeModule(compiled),
    /TEXT_COMPILED_MODULE_MISSING:createTextMask,textMaskSignature/,
  );
  assert.throws(
    () => featureMorphNodeRuntimeModule(compiled),
    /FEATURE_MORPH_COMPILED_MODULE_MISSING:imageFitUniform,buildFeatureMorphField,matchSuperPointFeatures/,
  );
  assert.throws(
    () => terrainNodeRuntimeModule(compiled),
    /TERRAIN_COMPILED_MODULE_MISSING:/,
  );
});

test("compiled specialized Groups never substitute host GLSL for missing child shaders", () => {
  assert.throws(
    () => textNodeShaderSource(compiled, "fragment"),
    /TEXT_COMPILED_SHADER_MISSING:fragment/,
  );
  assert.throws(
    () => featureMorphNodeShaderSource(compiled, "fragment"),
    /FEATURE_MORPH_COMPILED_SHADER_MISSING:feature-morph-fragment/,
  );
  assert.throws(
    () => terrainNodeShaderSource(compiled, "terrain-surface-fragment"),
    /TERRAIN_COMPILED_SHADER_MISSING:terrain-surface-fragment/,
  );
  assert.throws(
    () => meshPatternNodeShaderSource(
      { renderer: "output/specialized:meshPatternWire", nodeShaders: {} },
      "mesh-pattern-wire-fragment",
    ),
    /MESH_PATTERN_COMPILED_SHADER_MISSING:mesh-pattern-wire-fragment/,
  );
});

test("legacy direct hosts retain their explicit compatibility artifacts", () => {
  assert.equal(typeof textNodeRuntimeModule({}).createTextMask, "function");
  assert.equal(typeof featureMorphNodeRuntimeModule({}).imageFitUniform, "function");
  assert.equal(typeof terrainNodeRuntimeModule({}).terrainGridSize, "function");
  assert.match(textNodeShaderSource({}, "fragment"), /uniform sampler2D textMask/);
  assert.match(featureMorphNodeShaderSource({}, "fragment"), /uniform sampler2D imageA/);
});

test("compiled resource providers remain authoritative over outer compatibility parameters", () => {
  const compiledOperation = { nativeCompoundProgram: {} };
  const legacyOperation = {};

  assert.equal(
    specializedResourceIdentity(compiledOperation, { mediaId: "" }, "mediaId", "outer.png"),
    "",
    "an intentionally empty connected value cannot be replaced by the outer generator",
  );
  assert.equal(
    specializedResourceIdentity(compiledOperation, { mediaId: "connected.png" }, "mediaId", "outer.png"),
    "connected.png",
  );
  assert.equal(
    specializedResourceIdentity(legacyOperation, null, "mediaId", "outer.png"),
    "outer.png",
    "uncompiled compatibility calls retain their explicit authored fallback",
  );
});

test("compiled stage settings come only from the evaluated graph", () => {
  assert.throws(
    () => specializedCompoundEvaluatedStageSettings(
      { nativeCompoundProgram: {} },
      { stageInputs: () => null },
      "render",
      { amount: 0.75 },
    ),
    /SPECIALIZED_COMPOUND_STAGE_SETTINGS_MISSING:render/,
  );
  assert.deepEqual(
    specializedCompoundEvaluatedStageSettings(
      {},
      null,
      "render",
      { amount: 0.75 },
    ),
    { amount: 0.75 },
  );
});

test("compiled Feature Morph requires settings from its connected analysis provider", () => {
  const runtime = new SpecializedSourceRuntime();
  const operation = {
    nativeCompoundProgram: {
      stages: [
        { id: "image-a", parameters: {} },
        { id: "image-b", parameters: {} },
        { id: "analysis", parameters: {} },
        { id: "render", parameters: {} },
      ],
      nativeKernel() {
        return {
          id: "render",
          inputBindings: {
            imageA: { stageId: "image-a", portId: "image" },
            imageB: { stageId: "image-b", portId: "image" },
            analysis: { stageId: "analysis", portId: "analysis" },
          },
        };
      },
      evaluateGraph() {
        return {
          stageInput(_stageId, portId) {
            if (portId === "imageA") return { kind: "media-image-resource", mediaId: "a.png" };
            if (portId === "imageB") return { kind: "media-image-resource", mediaId: "b.png" };
            if (portId === "analysis") return { kind: "feature-morph-analysis", providerId: "superpoint" };
            return null;
          },
          stageInputs() {
            return { settings: {} };
          },
        };
      },
    },
  };

  assert.throws(
    () => runtime.drawFeatureMorph({}, { params: { imageAId: "outer-a.png", imageBId: "outer-b.png" } }, 0, {}, operation),
    /FEATURE_MORPH_ANALYSIS_SETTINGS_MISSING:analysis/,
  );
  runtime.dispose();
});

test("specialized Group compilation rejects missing child artifacts before rendering", () => {
  const compileTerrain = (replaceDefinition) => {
    const packageRoot = createVj1NodePackage();
    const component = {
      id: "artifact-authority-terrain",
      name: "Artifact authority Terrain",
      type: "component",
      chain: [{
        id: "terrain-source",
        kind: "source",
        source: { type: "generator", generatorId: "terrainFlyover", params: {} },
      }],
    };
    const state = packageRoot.prepareProjectState({ components: [component], nodes: {} });
    return compileComponentRenderPrograms(state.components, state.nodes.groups, {
      resolveNodeDefinition: (node) => {
        const definition = packageRoot.registry.get(node.nodeId, node.nodeVersion);
        return replaceDefinition(definition);
      },
    });
  };

  assert.throws(
    () => compileTerrain((definition) => definition.id === TerrainHeightFieldGeometryProviderNode.id
      ? {
          ...definition,
          moduleExports: {
            ...definition.moduleExports,
            terrainGridSize: undefined,
          },
        }
      : definition),
    /VISUAL_NATIVE_MODULE_EXPORT_REQUIRED:.*terrainGridSize/,
  );

  assert.throws(
    () => compileTerrain((definition) => definition.id === TerrainBiomeMaterialProviderNode.id
      ? {
          ...definition,
          parts: definition.parts.filter((part) => part.id !== "terrain-surface-fragment"),
        }
      : definition),
    /VISUAL_NATIVE_SHADER_REQUIRED:.*terrain-surface-fragment/,
  );
});
