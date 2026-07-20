import {
  createNumberParam,
  defineVisualComponent,
  textureInlet,
  textureOutlet,
} from "./component-schema.js";
import { ALWAYS_TIME_RUNTIME } from "./shader-component-common.js";
import { materializeVisualNodeDefinition } from "./visual-node-materializer.js";

const generatorInlets = Object.freeze([textureInlet("image", "Image")]);
const generatorOutlets = Object.freeze([textureOutlet("texture", "Texture")]);
const effectInlets = Object.freeze([textureInlet("texture", "Texture")]);
const effectOutlets = Object.freeze([textureOutlet("texture", "Texture")]);

export function defineGeneratorNode(manifest = {}, shader = null) {
  const component = defineVisualComponent({
    ...manifest,
    kind: "generator",
    family: "source",
    processor: "generator",
    scheduler: "frame",
    inlets: manifest.inlets || generatorInlets,
    outlets: manifest.outlets || generatorOutlets,
    params: manifest.params || [],
  });
  return materializedComponent(component, shader, shader ? "" : `output/specialized:${manifest.id}`);
}

export function defineEffectNode(manifest = {}) {
  const sampling = manifest.sampling || inferSampling(manifest.code);
  const spatial = manifest.spatial === true;
  const transformSource = spatial ? false : manifest.transformSource !== false;
  const component = defineVisualComponent({
    ...manifest,
    spatial,
    transformSource,
    sampling,
    requiresBaseSample: manifest.requiresBaseSample ?? effectUsesBaseColor(manifest.code),
    fusible: spatial ? false : manifest.fusible ?? (
      sampling === "local" &&
      manifest.type !== "fragment" &&
      manifest.type !== "shadertoy" &&
      manifest.id !== "custom" &&
      transformSource !== false
    ),
    kind: "effect",
    family: "shader",
    processor: "shader",
    scheduler: "frame",
    runtime: manifest.runtime || (manifest.code?.includes("time") ? ALWAYS_TIME_RUNTIME : undefined),
    inlets: manifest.inlets || effectInlets,
    outlets: manifest.outlets || effectOutlets,
    params: manifest.params || [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: manifest.defaultAmount ?? 0.35 }),
    ],
  });
  return materializedComponent(component, { name: `${component.name} shader`, code: component.code, type: component.type });
}

function materializedComponent(manifest, shader = null, nativeRenderer = "") {
  const definition = materializeVisualNodeDefinition(manifest, { shader, nativeRenderer });
  return componentFromNodeDefinition(manifest, definition, { renderAuthority: "node-definition" });
}

export function componentFromNodeDefinition(base, definition, additions = {}) {
  const shaderPart = definition.parts.find((part) => part.kind === "shader");
  const originalParams = new Map((base.params || []).map((parameter) => [parameter.id, parameter]));
  const params = Object.values(definition.parameters || {}).map((parameter) => {
    const original = originalParams.get(parameter.id) || {};
    return Object.freeze({
      ...original,
      id: parameter.id,
      label: parameter.label,
      type: catalogParameterType(parameter),
      values: parameter.type?.values || original.values,
      min: parameter.allowedRange?.[0] ?? original.min,
      max: parameter.allowedRange?.[1] ?? original.max,
      defaultValue: parameter.defaultValue,
      scale: parameter.scale,
      ui: parameter.editor?.type || original.ui,
    });
  });
  return Object.freeze({
    ...base,
    id: definition.metadata?.visualId || base.id,
    name: definition.name,
    params: Object.freeze(params),
    code: shaderPart?.source || base.code,
    shaderInterface: definition.metadata?.shaderInterface || base.shaderInterface || base.type,
    nodeDefinition: definition,
    ...additions,
  });
}

function catalogParameterType(parameter) {
  const type = parameter.type?.type || parameter.type || "any";
  return type === "string" ? "text" : type;
}

function inferSampling(code = "") {
  return (String(code).match(/\bsampleSource\s*\(/g) || []).length > 0 ? "neighborhood" : "local";
}

function effectUsesBaseColor(code = "") {
  const body = String(code).replace(/runEffect\s*\(\s*vec2\s+\w+\s*,\s*vec4\s+color\s*\)/, "runEffect()");
  return /\bcolor\b/.test(body);
}
