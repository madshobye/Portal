import { createNumberParam, defineVisualComponent, textureInlet, textureOutlet } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { ALWAYS_TIME_RUNTIME } from "./shader-component-common.js?v=shader-component-catalog-extraction-1";
import { STYLIZE_SHADER_COMPONENTS } from "./shader-components-stylize.js?v=photo-grade-print-1";
import { IMAGE_SHADER_COMPONENTS } from "./shader-components-image.js?v=madstodo-4";
import { MOTION_SHADER_COMPONENTS } from "./shader-components-motion.js?v=shader-component-catalog-extraction-1";

const effectInlets = Object.freeze([textureInlet("texture", "Texture")]);
const effectOutlets = Object.freeze([textureOutlet("texture", "Texture")]);

export const SHADER_COMPONENTS = Object.freeze({
  ...STYLIZE_SHADER_COMPONENTS,
  ...IMAGE_SHADER_COMPONENTS,
  ...MOTION_SHADER_COMPONENTS,
});

export function getShaderComponent(id) {
  return normalizeShaderComponent(SHADER_COMPONENTS[id]);
}

export function listShaderComponents() {
  return Object.values(SHADER_COMPONENTS).map(normalizeShaderComponent).filter(Boolean);
}

function normalizeShaderComponent(component) {
  if (!component) return null;
  const sampling = component.sampling || inferSampling(component.code);
  return defineVisualComponent({
    ...component,
    sampling,
    requiresBaseSample: component.requiresBaseSample ?? effectUsesBaseColor(component.code),
    fusible: component.fusible ?? (
      sampling === "local" &&
      component.type !== "fragment" &&
      component.type !== "shadertoy" &&
      component.id !== "custom" &&
      component.transformSource !== false
    ),
    kind: "effect",
    family: "shader",
    processor: "shader",
    scheduler: "frame",
    runtime: component.runtime || (component.code?.includes("time") ? ALWAYS_TIME_RUNTIME : undefined),
    inlets: component.inlets || effectInlets,
    outlets: component.outlets || effectOutlets,
    params: component.params || [
      createNumberParam("amount", "Amount", {
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: component.defaultAmount ?? 0.35,
      }),
    ],
  });
}

function inferSampling(code = "") {
  const sourceSamples = (String(code).match(/\bsampleSource\s*\(/g) || []).length;
  return sourceSamples > 0 ? "neighborhood" : "local";
}

function effectUsesBaseColor(code = "") {
  const body = String(code).replace(/runEffect\s*\(\s*vec2\s+\w+\s*,\s*vec4\s+color\s*\)/, "runEffect()");
  return /\bcolor\b/.test(body);
}
