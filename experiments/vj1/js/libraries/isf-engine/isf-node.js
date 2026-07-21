import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../node-engine/index.js";
import {
  createBooleanParam,
  createColorParam,
  createEnumParam,
  createNumberParam,
  defineVisualComponent,
  textureInlet,
  textureOutlet,
} from "../visual-nodes/shared/component-schema.js";
import { componentFromNodeDefinition } from "../visual-nodes/shared/visual-node-factory.js";
import { compileIsfFragmentSource } from "./isf-compiler.js?v=isf-coordinates-1";
import { parseIsfDocument, sourceHash } from "./isf-document.js?v=isf-coordinates-1";

const projectComponentCache = new WeakMap();

export function createIsfVisualComponent({ path = "", source = "" } = {}) {
  return materializeIsfNodeDefinition(createIsfNodeDefinition({ path, source }));
}

export function createIsfNodeDefinition({ path = "", source = "" } = {}) {
  const document = parseIsfDocument(source, { path });
  const visualKind = document.kind === "transition" ? "effect" : document.kind;
  const visualId = `isf-${slug(path || document.name)}-${sourceHash(path || document.name)}`;
  const params = isfParameters(document, visualKind);
  const inlets = document.inputs.filter((input) => ["image", "audio", "audioFFT"].includes(input.type))
    .map((input) => textureInlet(input.name, input.label));
  if (visualKind === "effect" && !inlets.some((inlet) => inlet.id === "inputImage")) {
    inlets.unshift(textureInlet("inputImage", "Input Image"));
  }
  const runtime = {
    cacheable: !document.dynamic,
    timeDependent: () => document.dynamic,
    roi: document.roiSafe
      ? { mode: "local", halo: 0, coordinateSpace: "boundary" }
      : { mode: "full", halo: 0, coordinateSpace: "boundary", reason: "isf-multipass" },
  };
  const base = defineVisualComponent({
    id: visualId,
    kind: visualKind,
    family: "isf",
    name: document.name,
    description: document.description,
    category: document.categories[0] || "ISF",
    processor: "isf",
    scheduler: "frame",
    type: "isf",
    code: document.fragmentSource,
    runtime,
    fusible: false,
    inlets,
    outlets: [textureOutlet("texture", "Texture")],
    params,
  });
  const definition = defineNode({
    ...base.nodeDefinition,
    implementation: { kind: NODE_IMPLEMENTATION_KINDS.SHADER, language: "isf" },
    parts: [{
      id: "isf-source",
      name: document.name,
      kind: NODE_PART_KINDS.SHADER,
      language: "isf",
      stage: "fragment",
      editable: true,
      source: String(source),
    }],
    metadata: {
      ...base.nodeDefinition.metadata,
      visualId,
      visualKind,
      visualFamily: "isf",
      visualType: "isf",
      processor: "isf",
      shaderInterface: "isf",
      nodeOwnedShader: true,
      isf: isfMetadata(document),
      projectAssetPath: String(path || ""),
      projectLocalDefinition: true,
    },
  });
  // The .fs/.frag file is the base authority. project.json stores only
  // references and authored forks, never a second copy of the ISF source.
  return Object.freeze({ ...definition, persistence: "derived" });
}

export function materializeIsfNodeDefinition(definition = {}) {
  const sourcePart = (definition.parts || []).find((part) => part.language === "isf" || part.id === "isf-source");
  if (!sourcePart) throw new Error(`VJ1_ISF_SOURCE_PART_MISSING:${definition.id || "unknown"}`);
  const path = definition.metadata?.projectAssetPath || definition.metadata?.isf?.path || "";
  const document = parseIsfDocument(sourcePart.source, { path });
  assertComponentInputSupport(document);
  const visualKind = document.kind === "transition" ? "effect" : document.kind;
  const params = isfParameters(document, visualKind);
  const base = {
    id: definition.metadata?.visualId || definition.id,
    kind: visualKind,
    family: "isf",
    name: definition.name || document.name,
    label: definition.label || definition.name || document.name,
    category: document.categories[0] || "ISF",
    processor: "isf",
    scheduler: "frame",
    runtime: {
      cacheable: !document.dynamic,
      timeDependent: () => document.dynamic,
      roi: document.roiSafe
        ? { mode: "local", halo: 0, coordinateSpace: "boundary" }
        : { mode: "full", halo: 0, coordinateSpace: "boundary", reason: "isf-multipass" },
    },
    spatial: false,
    transformSource: true,
    sampling: "neighborhood",
    requiresBaseSample: visualKind === "effect",
    fusible: false,
    inlets: Object.values(definition.inlets || {}).map((port, index) => ({ id: Object.keys(definition.inlets || {})[index], ...port })),
    outlets: Object.values(definition.outlets || {}).map((port, index) => ({ id: Object.keys(definition.outlets || {})[index], ...port })),
    params,
    type: "isf",
    code: document.fragmentSource,
    nodeDefinition: definition,
  };
  return componentFromNodeDefinition(base, definition, {
    code: compileIsfFragmentSource(document, { kind: visualKind }),
    type: "isf",
    shaderInterface: "isf",
    isf: document,
    renderAuthority: "project-isf-node",
  });
}

export function isIsfNodeDefinition(definition = {}) {
  return definition?.metadata?.visualFamily === "isf" || definition?.metadata?.isf?.format === "isf@2";
}

export function listProjectIsfVisualComponents(state = {}) {
  const definitions = state?.nodes?.definitions;
  if (Array.isArray(definitions) && projectComponentCache.has(definitions)) return [...projectComponentCache.get(definitions)];
  const result = [];
  for (const definition of definitions || []) {
    if (!isIsfNodeDefinition(definition)) continue;
    try {
      result.push(materializeIsfNodeDefinition(definition));
    } catch (error) {
      console.warn("[VJ1_ISF_DEFINITION_INVALID]", {
        nodeId: definition.id || "",
        path: definition.metadata?.projectAssetPath || "",
        fallback: "retain the definition but omit it from the active visual catalog",
        message: error?.message || String(error),
      });
    }
  }
  if (Array.isArray(definitions)) projectComponentCache.set(definitions, Object.freeze(result));
  return [...result];
}

export function mergeProjectIsfDefinitions(nodes = {}, shaders = [], { authoritative = false } = {}) {
  const incoming = [];
  const failedPaths = new Set();
  for (const shader of shaders || []) {
    if (!looksLikeIsfSource(shader?.code)) continue;
    try {
      incoming.push(createIsfNodeDefinition({ path: shader.path || shader.name || "", source: shader.code || "" }));
    } catch (error) {
      failedPaths.add(String(shader.path || shader.name || ""));
      console.warn("[VJ1_ISF_IMPORT_FAILED]", {
        path: shader.path || shader.name || "",
        fallback: "keep the last valid imported node definition",
        message: error?.message || String(error),
      });
    }
  }
  const incomingPaths = new Set(incoming.map((definition) => String(definition.metadata?.projectAssetPath || "")));
  const retained = (nodes?.definitions || []).filter((definition) => {
    if (!isIsfNodeDefinition(definition)) return true;
    const path = String(definition.metadata?.projectAssetPath || "");
    if (incomingPaths.has(path)) return false;
    if (failedPaths.has(path)) return true;
    return !authoritative;
  });
  return {
    ...(nodes || {}),
    definitions: [...retained, ...incoming],
  };
}

export function looksLikeIsfSource(source = "") {
  return /\/\*\s*\{[\s\S]*?"(?:ISFVSN|INPUTS|PASSES)"[\s\S]*?\}\s*\*\//.test(String(source || ""));
}

function isfParameters(document, visualKind) {
  const params = [];
  if (visualKind === "effect") params.push(createNumberParam("amount", "Effect strength", { min: 0, max: 1, step: 0.01, defaultValue: 1 }));
  for (const input of document.inputs) {
    if (["image", "audio", "audioFFT"].includes(input.type)) continue;
    if (input.type === "point2D") {
      const defaults = arrayPair(input.defaultValue, [0, 0]);
      const min = arrayPair(input.min, [0, 0]);
      const max = arrayPair(input.max, [1, 1]);
      params.push({ ...createNumberParam(`${input.name}X`, `${input.label} X`, { min: min[0], max: max[0], defaultValue: defaults[0] }), isfUniform: input.name, isfVectorIndex: 0 });
      params.push({ ...createNumberParam(`${input.name}Y`, `${input.label} Y`, { min: min[1], max: max[1], defaultValue: defaults[1] }), isfUniform: input.name, isfVectorIndex: 1 });
    } else if (input.type === "color") {
      params.push({ ...createColorParam(input.name, input.label, colorHex(input.defaultValue)), isfUniformType: "color" });
    } else if (input.type === "bool" || input.type === "event") {
      params.push({ ...createBooleanParam(input.name, input.label, input.defaultValue === true), isfUniformType: input.type });
    } else if (input.type === "long" && input.values?.length) {
      const labels = input.labels?.length === input.values.length ? input.labels : input.values.map(String);
      const defaultIndex = Math.max(0, input.values.findIndex((value) => value === input.defaultValue));
      params.push({ ...createEnumParam(input.name, input.label, labels, labels[defaultIndex]), isfUniformType: "long", isfValues: input.values });
    } else {
      const fallbackMin = input.type === "long" ? 0 : 0;
      const fallbackMax = input.type === "long" ? 100 : 1;
      params.push({
        ...createNumberParam(input.name, input.label, {
          min: finite(input.min, fallbackMin),
          max: finite(input.max, fallbackMax),
          step: input.type === "long" ? 1 : 0.01,
          defaultValue: finite(input.defaultValue, fallbackMin),
        }),
        isfUniformType: input.type,
      });
    }
  }
  return params;
}

function isfMetadata(document) {
  return {
    format: document.format,
    path: document.path,
    version: document.version,
    kind: document.kind,
    credit: document.credit,
    passes: document.passes,
    inputs: document.inputs,
    sourceHash: document.sourceHash,
    dynamic: document.dynamic,
    roiSafe: document.roiSafe,
  };
}

function assertComponentInputSupport(document) {
  const unsupported = document.inputs.filter((input) =>
    ["audio", "audioFFT"].includes(input.type)
    || (input.type === "image" && input.name !== "inputImage")
  );
  if (!unsupported.length && document.kind !== "transition") return;
  const names = unsupported.map((input) => input.name).join(", ") || "startImage, endImage";
  // The ports remain represented in the node definition, but the current
  // Component chain has one image inlet. Do not silently bind the wrong media;
  // these nodes become executable when graph-level multi-input placement lands.
  throw new Error(`VJ1_ISF_MULTI_INPUT_REQUIRES_NODE_GRAPH:${document.path || document.name}:${names}`);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayPair(value, fallback) {
  return Array.isArray(value) && value.length >= 2 ? [finite(value[0], fallback[0]), finite(value[1], fallback[1])] : fallback;
}

function colorHex(value) {
  const channels = Array.isArray(value) ? value : [1, 1, 1, 1];
  return `#${[0, 1, 2, 3].map((index) => Math.round(Math.max(0, Math.min(1, finite(channels[index], index === 3 ? 1 : 1))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function slug(value) {
  return String(value || "shader").toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shader";
}
