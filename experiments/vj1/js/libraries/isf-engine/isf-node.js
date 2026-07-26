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
import {
  componentFromNodeDefinition,
  defineEffectNode,
  defineGeneratorNode,
} from "../visual-nodes/shared/visual-node-factory.js";
import {
  defineVisualLibraryLayer,
  VISUAL_IMPLEMENTATION_FORMATS,
  VISUAL_LIBRARY_LAYER_KINDS,
} from "../visual-library/index.js";
import {
  defineVisualNodeContract,
  VISUAL_TRANSFORM_DOMAINS,
} from "../render-engine/visual-node-contract.js";
import {
  compileIsfFragmentSource,
  compileIsfOptimizedFragmentSource,
  compileIsfTransitionKernel,
} from "./isf-compiler.js";
import { parseIsfDocument, sourceHash } from "./isf-document.js";

const projectComponentCache = new WeakMap();
const projectDefinitionCache = new Map();
const projectTransitionListCache = new WeakMap();
const projectTransitionDefinitionCache = new Map();
const PROJECT_DEFINITION_CACHE_LIMIT = 128;

export function createIsfVisualComponent({ path = "", source = "" } = {}) {
  return materializeIsfNodeDefinition(createIsfNodeDefinition({ path, source }));
}

export function createIsfNodeDefinition({
  path = "",
  source = "",
  origin = "project",
} = {}) {
  const document = parseIsfDocument(source, { path });
  const visualKind = document.kind;
  const declaredId = String(document.metadata?.VJ1?.ID || "").trim();
  const visualId = declaredId || `isf-${slug(path || document.name)}-${sourceHash(path || document.name)}`;
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
    sampling: "neighborhood",
    requiresBaseSample: visualKind === "effect",
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
      ...isfVisualExecutionMetadata(base),
      isf: isfMetadata(document),
      projectAssetPath: String(path || ""),
      projectLocalDefinition: origin === "project",
      builtInAssetDefinition: origin === "built-in",
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
  if (document.kind === "transition") {
    throw new Error(`VJ1_ISF_TRANSITION_NOT_COMPONENT:${document.path || document.name}`);
  }
  assertComponentInputSupport(document);
  const optimizedLowering = String(
    document.metadata?.VJ1?.LOWERING ||
    definition.metadata?.optimizedIsfLowering ||
    "",
  );
  if (optimizedLowering) {
    return materializeOptimizedIsfComponent(
      definition,
      document,
      optimizedLowering,
    );
  }
  const visualKind = document.kind;
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

function materializeOptimizedIsfComponent(
  definition,
  document,
  lowering,
) {
  const visualKind = document.kind;
  if (!["generator", "effect"].includes(visualKind)) {
    throw new Error(
      `VJ1_ISF_OPTIMIZED_KIND_UNSUPPORTED:${document.path || document.name}:${visualKind}`,
    );
  }
  const code = compileIsfOptimizedFragmentSource(document, { lowering });
  const manifest = {
    id: definition.metadata?.visualId || definition.id,
    name: definition.name || document.name,
    description: definition.description || document.description,
    category: document.categories[0] || "ISF",
    params: isfParameters(document, visualKind),
    runtime: {
      cacheable: !document.dynamic,
      timeDependent: () => document.dynamic,
      roi: { mode: "local", halo: 0, coordinateSpace: "boundary" },
    },
  };
  const optimized = visualKind === "effect"
    ? defineEffectNode({
      ...manifest,
      code,
      sampling: "local",
      spatial: false,
      transformSource: true,
      fusible: true,
      requiresBaseSample: true,
    })
    : defineGeneratorNode(manifest, {
      id: `${definition.id}.optimized`,
      name: `${document.name} optimized ISF lowering`,
      type: "fragment",
      code,
    });
  const loweredDefinition = defineNode({
    ...optimized.nodeDefinition,
    id: definition.id,
    version: definition.version,
    implementation: {
      kind: NODE_IMPLEMENTATION_KINDS.SHADER,
      language: "isf",
    },
    parts: definition.parts,
    metadata: {
      ...optimized.nodeDefinition.metadata,
      visualFamily: "isf",
      sourceFormat: "isf",
      optimizedIsfLowering: lowering,
      isf: definition.metadata?.isf,
      projectAssetPath: definition.metadata?.projectAssetPath || "",
      projectLocalDefinition:
        definition.metadata?.projectLocalDefinition === true,
      builtInAssetDefinition:
        definition.metadata?.builtInAssetDefinition === true,
    },
  });
  const persistentDefinition = Object.freeze({
    ...loweredDefinition,
    persistence: definition.persistence,
  });
  return Object.freeze({
    ...optimized,
    nodeDefinition: persistentDefinition,
    code,
    type: visualKind === "effect" ? "effect" : "fragment",
    shaderInterface: visualKind === "effect" ? "effect" : "fragment",
    isf: document,
    renderAuthority: definition.metadata?.builtInAssetDefinition
      ? "built-in-isf-lowered"
      : "project-isf-lowered",
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
    if (definition.metadata?.isf?.kind === "transition") continue;
    const cached = cachedProjectIsfComponent(definition);
    if (cached.component) {
      result.push(cached.component);
    } else if (cached.shouldWarn) {
      console.warn("[VJ1_ISF_DEFINITION_INVALID]", {
        nodeId: definition.id || "",
        path: definition.metadata?.projectAssetPath || "",
        fallback: "retain the definition but omit it from the active visual catalog",
        message: cached.message,
      });
    }
  }
  if (Array.isArray(definitions)) projectComponentCache.set(definitions, Object.freeze(result));
  return [...result];
}

export function listProjectIsfTransitions(state = {}) {
  const definitions = state?.nodes?.definitions;
  if (Array.isArray(definitions) && projectTransitionListCache.has(definitions)) {
    return [...projectTransitionListCache.get(definitions)];
  }
  const result = [];
  for (const definition of definitions || []) {
    if (!isIsfNodeDefinition(definition) || definition.metadata?.isf?.kind !== "transition") continue;
    const cached = cachedProjectIsfTransition(definition);
    if (cached.transition) {
      result.push(cached.transition);
    } else if (cached.shouldWarn) {
      console.warn("[VJ1_ISF_TRANSITION_INVALID]", {
        nodeId: definition.id || "",
        path: definition.metadata?.projectAssetPath || "",
        fallback: "omit the transition and retain Dissolve",
        message: cached.message,
      });
    }
  }
  if (Array.isArray(definitions)) projectTransitionListCache.set(definitions, Object.freeze(result));
  return result;
}

export function materializeIsfTransitionDefinition(definition = {}) {
  const cached = cachedProjectIsfTransition(definition);
  if (!cached.transition) {
    throw new Error(cached.message || `VJ1_ISF_TRANSITION_INVALID:${definition.id || "unknown"}`);
  }
  return cached.transition;
}

function cachedProjectIsfTransition(definition = {}) {
  const key = projectIsfDefinitionKey(definition);
  const previous = projectTransitionDefinitionCache.get(key);
  if (previous) return { ...previous, shouldWarn: false };
  let entry;
  try {
    const sourcePart = (definition.parts || []).find((part) => part.language === "isf" || part.id === "isf-source");
    if (!sourcePart) throw new Error(`VJ1_ISF_SOURCE_PART_MISSING:${definition.id || "unknown"}`);
    const path = definition.metadata?.projectAssetPath || definition.metadata?.isf?.path || "";
    const document = parseIsfDocument(sourcePart.source, { path });
    const id = String(document.metadata?.VJ1?.ID || definition.metadata?.visualId || definition.id);
    const version = String(document.metadata?.VJ1?.VERSION || definition.version || "0.1.0");
    const declaredReplaces = document.metadata?.VJ1?.REPLACES;
    entry = Object.freeze({
      transition: Object.freeze({
        id,
        version,
        name: document.name,
        description: document.description,
        category: document.categories[0] || "Transition",
        parameters: Object.freeze(isfParameters(document, "transition")),
        kernel: compileIsfTransitionKernel(document, { id, version }),
        replaces: Object.freeze(Array.isArray(declaredReplaces)
          ? declaredReplaces.map(String)
          : declaredReplaces ? [String(declaredReplaces)] : []),
        origin: Object.freeze({ kind: "project", path: String(path || "") }),
      }),
      message: "",
    });
  } catch (error) {
    entry = Object.freeze({ transition: null, message: error?.message || String(error) });
  }
  projectTransitionDefinitionCache.set(key, entry);
  while (projectTransitionDefinitionCache.size > PROJECT_DEFINITION_CACHE_LIMIT) {
    projectTransitionDefinitionCache.delete(projectTransitionDefinitionCache.keys().next().value);
  }
  return { ...entry, shouldWarn: !entry.transition };
}

export function createProjectIsfVisualLibraryLayer(state = {}) {
  const artifacts = [];
  for (const definition of state?.nodes?.definitions || []) {
    if (!isIsfNodeDefinition(definition)) continue;
    const sourcePart = (definition.parts || []).find((part) => part.language === "isf" || part.id === "isf-source");
    if (!sourcePart) continue;
    try {
      const path = definition.metadata?.projectAssetPath || definition.metadata?.isf?.path || "";
      const document = parseIsfDocument(sourcePart.source, { path });
      const id = String(document.metadata?.VJ1?.ID || definition.metadata?.visualId || definition.id);
      if (document.kind === "transition") {
        compileIsfTransitionKernel(document, {
          id,
          version: String(document.metadata?.VJ1?.VERSION || definition.version || "0.1.0"),
        });
      }
      const declaredReplaces = document.metadata?.VJ1?.REPLACES;
      artifacts.push({
        id,
        version: String(document.metadata?.VJ1?.VERSION || definition.version || "0.1.0"),
        name: document.name,
        description: document.description,
        artifactType: document.kind,
        implementation: {
          format: VISUAL_IMPLEMENTATION_FORMATS.ISF,
          nodeId: definition.id,
          visualId: definition.metadata?.visualId || id,
          resourceId: String(path || definition.id),
        },
        capabilities: [
          `visual-${document.kind}`,
          ...(document.kind === "transition" ? ["single-pass", "direct-mapper-pass"] : []),
        ],
        categories: document.categories,
        replaces: Array.isArray(declaredReplaces)
          ? declaredReplaces
          : declaredReplaces ? [declaredReplaces] : [],
        ports: {
          inlets: definition.inlets,
          outlets: definition.outlets,
        },
        attribution: document.credit ? { credit: document.credit } : {},
        origin: { kind: VISUAL_LIBRARY_LAYER_KINDS.PROJECT, path: String(path || "") },
      });
    } catch {
      // Invalid definitions remain editable in the node library, but cannot
      // enter the executable catalog until they compile again.
    }
  }
  return defineVisualLibraryLayer({
    id: "vj1.project.visuals",
    kind: VISUAL_LIBRARY_LAYER_KINDS.PROJECT,
    artifacts,
  });
}

function cachedProjectIsfComponent(definition = {}) {
  const key = projectIsfDefinitionKey(definition);
  const previous = projectDefinitionCache.get(key);
  if (previous) return { ...previous, shouldWarn: false };
  let entry;
  try {
    entry = Object.freeze({ component: materializeIsfNodeDefinition(definition), message: "" });
  } catch (error) {
    entry = Object.freeze({ component: null, message: error?.message || String(error) });
  }
  projectDefinitionCache.set(key, entry);
  while (projectDefinitionCache.size > PROJECT_DEFINITION_CACHE_LIMIT) {
    projectDefinitionCache.delete(projectDefinitionCache.keys().next().value);
  }
  return { ...entry, shouldWarn: !entry.component };
}

function projectIsfDefinitionKey(definition = {}) {
  const sourcePart = (definition.parts || []).find((part) => part.language === "isf" || part.id === "isf-source");
  const source = String(sourcePart?.source || "");
  return [
    String(definition.id || ""),
    String(definition.version || ""),
    String(definition.name || ""),
    String(definition.metadata?.visualId || ""),
    String(definition.metadata?.projectAssetPath || ""),
    sourceHash(source),
  ].join("\u0000");
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
  if (
    visualKind === "effect" &&
    !document.inputs.some((input) => input.name === "amount")
  ) {
    params.push(createNumberParam("amount", "Effect strength", {
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: 1,
    }));
  }
  for (const input of document.inputs) {
    if (["image", "audio", "audioFFT"].includes(input.type)) continue;
    if (visualKind === "transition" && input.name === "progress") continue;
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

function isfVisualExecutionMetadata(component = {}) {
  const effect = component.kind === "effect";
  const transformDomain = effect
    ? VISUAL_TRANSFORM_DOMAINS.COMPOSITION
    : VISUAL_TRANSFORM_DOMAINS.CONTENT;
  const roi = component.runtime?.roi || {
    mode: "full-frame",
    halo: 0,
    coordinateSpace: "full-frame",
  };
  const contract = defineVisualNodeContract({}, {
    transform: { domain: transformDomain },
    roi,
  });
  return {
    sampling: String(component.sampling || "unknown"),
    transformSource: component.transformSource !== false,
    requiresBaseSample: component.requiresBaseSample !== false,
    fusible: component.fusible === true,
    roi,
    renderInvalidation: Object.freeze({
      mode: component.runtime?.cacheable === false ? "frame" : "stable",
      reason: component.runtime?.cacheable === false ? "isf-time" : "isf-static",
    }),
    visualContract: contract,
    visualCompilerHook: Object.freeze({
      id: effect ? "vj1.visual.shader-effect" : "vj1.visual.shader-generator",
      shaderInterface: "isf",
      sampling: String(component.sampling || "unknown"),
      fusible: component.fusible === true,
      transformDomain,
      roi,
      contract,
    }),
  };
}

function assertComponentInputSupport(document) {
  const unsupported = document.inputs.filter((input) =>
    ["audio", "audioFFT"].includes(input.type)
  );
  if (!unsupported.length) return;
  const names = unsupported.map((input) => input.name).join(", ");
  // Named image ports are executable through the compiled texture DAG. Audio
  // textures still need their own typed resource/clock contract; transitions
  // remain first-class transition nodes rather than ordinary Components.
  throw new Error(`VJ1_ISF_AUDIO_TEXTURE_HOST_UNAVAILABLE:${document.path || document.name}:${names}`);
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
