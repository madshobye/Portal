import { CORE_GENERATOR_SHADER_COMPONENTS } from "./generator-shaders-core.js?v=madstodo-4";
import { SPATIAL_GENERATOR_SHADER_COMPONENTS } from "./generator-shaders-spatial.js?v=sun-rays-1";
import { ORGANIC_GENERATOR_SHADER_COMPONENTS } from "./generator-shaders-organic.js?v=generator-shader-catalog-extraction-1";
import { ATMOSPHERE_GENERATOR_SHADER_COMPONENTS } from "./generator-shaders-atmosphere.js?v=volumetric-clouds-1";

const GENERATOR_SHADER_COMPONENTS = Object.freeze({
  ...CORE_GENERATOR_SHADER_COMPONENTS,
  ...SPATIAL_GENERATOR_SHADER_COMPONENTS,
  ...ORGANIC_GENERATOR_SHADER_COMPONENTS,
  ...ATMOSPHERE_GENERATOR_SHADER_COMPONENTS,
});

export function getGeneratorShaderComponent(id) {
  return GENERATOR_SHADER_COMPONENTS[id] || null;
}

export function hasGeneratorShader(id) {
  return !!getGeneratorShaderComponent(id);
}
