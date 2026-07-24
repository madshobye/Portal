import test from "node:test";
import assert from "node:assert/strict";

import {
  anatomyNodeRuntimeModule,
  featureMorphNodeRuntimeModule,
  featureMorphNodeShaderSource,
  terrainNodeRuntimeModule,
  terrainNodeShaderSource,
  textNodeRuntimeModule,
  textNodeShaderSource,
  tileTextureNodeRuntimeModule,
  tileTextureNodeShaderSource,
} from "../js/output/specialized/specialized-source-runtime.js";
import {
  meshPatternNodeRuntimeModule,
  meshPatternNodeShaderSource,
} from "../js/output/specialized/mesh-pattern-renderer.js";
import { createVj1NodePackage } from "../js/app-node-package.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";
import {
  TerrainBiomeMaterialProviderNode,
  TerrainHeightFieldGeometryProviderNode,
} from "../js/libraries/visual-nodes/index.js";

const compiled = Object.freeze({ nativeCompoundProgram: {} });

test("compiled specialized Groups never substitute host JavaScript for missing child modules", () => {
  assert.throws(
    () => anatomyNodeRuntimeModule(compiled),
    /ANATOMY_COMPILED_MODULE_MISSING:anatomyPartFitScale,drawProceduralAnatomy/,
  );
  assert.throws(
    () => textNodeRuntimeModule(compiled),
    /TEXT_COMPILED_MODULE_MISSING:createTextMask,textMaskSignature/,
  );
  assert.throws(
    () => tileTextureNodeRuntimeModule(compiled),
    /TILE_TEXTURE_COMPILED_MODULE_MISSING:tileRepeatAmount/,
  );
  assert.throws(
    () => featureMorphNodeRuntimeModule(compiled),
    /FEATURE_MORPH_COMPILED_MODULE_MISSING:imageFitUniform,buildFeatureMorphField,matchSuperPointFeatures/,
  );
  assert.throws(
    () => terrainNodeRuntimeModule(compiled),
    /TERRAIN_COMPILED_MODULE_MISSING:/,
  );
  assert.throws(
    () => meshPatternNodeRuntimeModule(compiled),
    /MESH_PATTERN_COMPILED_MODULE_MISSING:/,
  );
});

test("compiled specialized Groups never substitute host GLSL for missing child shaders", () => {
  assert.throws(
    () => textNodeShaderSource(compiled, "fragment"),
    /TEXT_COMPILED_SHADER_MISSING:fragment/,
  );
  assert.throws(
    () => tileTextureNodeShaderSource(compiled, "vertex"),
    /TILE_TEXTURE_COMPILED_SHADER_MISSING:tile-texture-vertex/,
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
    () => meshPatternNodeShaderSource(compiled, "mesh-pattern-wire-fragment"),
    /MESH_PATTERN_COMPILED_SHADER_MISSING:mesh-pattern-wire-fragment/,
  );
});

test("legacy direct hosts retain their explicit compatibility artifacts", () => {
  assert.equal(typeof anatomyNodeRuntimeModule({}).drawProceduralAnatomy, "function");
  assert.equal(typeof textNodeRuntimeModule({}).createTextMask, "function");
  assert.equal(typeof tileTextureNodeRuntimeModule({}).tileRepeatAmount, "function");
  assert.equal(typeof featureMorphNodeRuntimeModule({}).imageFitUniform, "function");
  assert.equal(typeof terrainNodeRuntimeModule({}).terrainGridSize, "function");
  assert.equal(typeof meshPatternNodeRuntimeModule({}).generateMeshPatternTopology, "function");
  assert.match(textNodeShaderSource({}, "fragment"), /uniform sampler2D textMask/);
  assert.match(tileTextureNodeShaderSource({}, "fragment"), /uniform sampler2D tileImage/);
  assert.match(featureMorphNodeShaderSource({}, "fragment"), /uniform sampler2D imageA/);
  assert.match(meshPatternNodeShaderSource({}, "mesh-pattern-fill-fragment"), /gl_FragColor/);
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
