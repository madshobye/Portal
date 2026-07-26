import { TerrainNodeModuleExports as FALLBACK_TERRAIN_NODE_MODULE } from "./terrain-mesh.js";
import {
  FEATURE_MORPH_FRAGMENT_SHADER,
  FEATURE_MORPH_VERTEX_SHADER,
  imageFitUniform as fallbackImageFitUniform,
} from "./feature-morph-shader.js";
import {
  buildFeatureMorphField as fallbackBuildFeatureMorphField,
  buildFeatureMorphMesh as fallbackBuildFeatureMorphMesh,
  matchSuperPointFeatures as fallbackMatchSuperPointFeatures,
} from "./feature-morph-field.js";
import {
  createTextMask as fallbackCreateTextMask,
  TEXT_GENERATOR_FRAGMENT_SHADER as FALLBACK_TEXT_FRAGMENT_SHADER,
  TEXT_GENERATOR_VERTEX_SHADER as FALLBACK_TEXT_VERTEX_SHADER,
  textMaskDimensions as fallbackTextMaskDimensions,
  textMaskSignature as fallbackTextMaskSignature,
} from "./text-generator-renderer.js";

const FALLBACK_TEXT_NODE_MODULE = Object.freeze({
  createTextMask: fallbackCreateTextMask,
  textMaskDimensions: fallbackTextMaskDimensions,
  textMaskSignature: fallbackTextMaskSignature,
});

const FALLBACK_FEATURE_MORPH_NODE_MODULE = Object.freeze({
  imageFitUniform: fallbackImageFitUniform,
  buildFeatureMorphField: fallbackBuildFeatureMorphField,
  buildFeatureMorphMesh: fallbackBuildFeatureMorphMesh,
  matchSuperPointFeatures: fallbackMatchSuperPointFeatures,
});

const TEXT_MODULE_FUNCTIONS = Object.freeze([
  "createTextMask",
  "textMaskSignature",
]);
const TERRAIN_MODULE_FUNCTIONS = Object.freeze([
  "normalizedTerrainIrregularity",
  "terrainExpandedGridWireVertices",
  "terrainGridSize",
  "terrainRowMetrics",
  "terrainSafeNearDistance",
  "terrainSurfaceGridVertices",
  "terrainSurfaceTriangleIndices",
  "terrainTessellationSize",
]);
const FEATURE_MORPH_RENDER_MODULE_FUNCTIONS = Object.freeze([
  "imageFitUniform",
]);
const FEATURE_MORPH_ANALYSIS_MODULE_FUNCTIONS = Object.freeze([
  "imageFitUniform",
  "buildFeatureMorphField",
  "matchSuperPointFeatures",
]);
const VALIDATED_COMPILED_MODULES = new WeakMap();
const VALIDATED_COMPILED_SHADERS = new WeakMap();

export function compiledSpecializedOperation(operation = {}) {
  return (
    operation?.backend === "native-specialized" ||
    operation?.compilerHook?.id === "vj1.visual.native-source"
  );
}

export function specializedResourceIdentity(
  operation = {},
  resource = null,
  field = "mediaId",
  legacyFallback = "",
) {
  const connectedValue = resource?.[field];
  if (compiledSpecializedOperation(operation)) {
    return String(connectedValue ?? "");
  }
  return String(connectedValue || legacyFallback || "");
}

export function textNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    TEXT_MODULE_FUNCTIONS,
    "TEXT_COMPILED_MODULE_MISSING",
  ) || FALLBACK_TEXT_NODE_MODULE;
}

export function textNodeShaderSource(operation = {}, stage = "fragment") {
  return compiledShaderSource(
    operation,
    stage,
    stage === "vertex"
      ? FALLBACK_TEXT_VERTEX_SHADER
      : FALLBACK_TEXT_FRAGMENT_SHADER,
    "TEXT_COMPILED_SHADER_MISSING",
  );
}

export function terrainNodeRuntimeModule(operation = {}) {
  return requireCompiledModuleFunctions(
    operation,
    TERRAIN_MODULE_FUNCTIONS,
    "TERRAIN_COMPILED_MODULE_MISSING",
  ) || FALLBACK_TERRAIN_NODE_MODULE;
}

export function terrainNodeShaderSource(operation = {}, id = "") {
  return compiledShaderSource(
    operation,
    id,
    null,
    "TERRAIN_COMPILED_SHADER_MISSING",
  );
}

export function featureMorphNodeRuntimeModule(
  operation = {},
  { requireAnalysis = true } = {},
) {
  return requireCompiledModuleFunctions(
    operation,
    requireAnalysis
      ? FEATURE_MORPH_ANALYSIS_MODULE_FUNCTIONS
      : FEATURE_MORPH_RENDER_MODULE_FUNCTIONS,
    "FEATURE_MORPH_COMPILED_MODULE_MISSING",
  ) || FALLBACK_FEATURE_MORPH_NODE_MODULE;
}

export function featureMorphNodeShaderSource(
  operation = {},
  stage = "fragment",
) {
  const id =
    stage === "vertex"
      ? "feature-morph-vertex"
      : "feature-morph-fragment";
  return compiledShaderSource(
    operation,
    id,
    stage === "vertex"
      ? FEATURE_MORPH_VERTEX_SHADER
      : FEATURE_MORPH_FRAGMENT_SHADER,
    "FEATURE_MORPH_COMPILED_SHADER_MISSING",
  );
}

function requireCompiledModuleFunctions(operation, functions, errorCode) {
  const module = operation?.nodeModule;
  if (compiledSpecializedOperation(operation)) {
    let validations = VALIDATED_COMPILED_MODULES.get(operation);
    if (validations?.has(errorCode)) return module;
    let missing = "";
    for (const name of functions) {
      if (typeof module?.[name] === "function") continue;
      missing += `${missing ? "," : ""}${name}`;
    }
    if (missing) throw new Error(`${errorCode}:${missing}`);
    if (!validations) {
      validations = new Set();
      VALIDATED_COMPILED_MODULES.set(operation, validations);
    }
    validations.add(errorCode);
    return module;
  }
  for (const name of functions) {
    if (typeof module?.[name] !== "function") return null;
  }
  return module;
}

function compiledShaderSource(operation, id, fallback, errorCode) {
  const source = operation?.nodeShaders?.[id];
  if (compiledSpecializedOperation(operation)) {
    let validations = VALIDATED_COMPILED_SHADERS.get(operation);
    if (validations?.has(id)) return source;
    if (typeof source !== "string" || !source.trim()) {
      throw new Error(`${errorCode}:${id}`);
    }
    if (!validations) {
      validations = new Set();
      VALIDATED_COMPILED_SHADERS.set(operation, validations);
    }
    validations.add(id);
    return source;
  }
  return typeof source === "string" && source.trim() ? source : fallback;
}
