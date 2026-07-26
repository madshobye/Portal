import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const PORT_TYPES = Object.freeze({
  TEXTURE: "texture",
  NUMBER: "number",
  BOOLEAN: "boolean",
  EVENT: "event",
});

export const PARAM_TYPES = Object.freeze({
  NUMBER: "number",
  BOOLEAN: "boolean",
  ENUM: "enum",
  COLOR: "color",
  TEXT: "text",
});

export const RENDER_SIZE_POLICIES = Object.freeze({
  NONE: "none",
  REQUESTED: "requested",
  SOURCE: "source",
});

export const RENDER_QUALITY_PARAM_ID = "renderQuality";
export const RENDER_QUALITY_DEFAULT = 0.5;
export const RENDER_QUALITY_PARAM = Object.freeze(createNumberParam(
  RENDER_QUALITY_PARAM_ID,
  "Render quality",
  { min: 0, max: 1, step: 0.01, defaultValue: RENDER_QUALITY_DEFAULT }
));

export function textureRenderContract({
  input = RENDER_SIZE_POLICIES.REQUESTED,
  output = RENDER_SIZE_POLICIES.REQUESTED,
  preservesAspect = true,
} = {}) {
  return Object.freeze({
    input,
    output,
    preservesAspect: preservesAspect !== false,
  });
}

export function createNumberParam(id, label, {
  min = 0,
  max = 1,
  step = 0.01,
  defaultValue = 0,
  ui = "slider",
  scale = "linear",
  rangePair = "",
  rangeRole = "",
  rangeKind = "",
  rangeDisplay = "number",
  renderQualityScaling = null,
  suggestedAnimations = [],
} = {}) {
  return {
    id,
    label,
    type: PARAM_TYPES.NUMBER,
    min,
    max,
    step,
    defaultValue,
    ui,
    scale,
    ...(rangePair ? { rangePair } : {}),
    ...(rangeRole ? { rangeRole } : {}),
    ...(rangeKind ? { rangeKind } : {}),
    ...(rangeDisplay !== "number" ? { rangeDisplay } : {}),
    ...(renderQualityScaling ? {
      renderQualityScaling: Object.freeze({
        minimum: Math.max(0, Number(renderQualityScaling.minimum) || 0),
        maximum: Math.max(0, Number(renderQualityScaling.maximum) || 0),
      }),
    } : {}),
    ...(suggestedAnimations.length ? {
      suggestedAnimations: Object.freeze(suggestedAnimations.map((suggestion) =>
        Object.freeze({ ...suggestion })
      )),
    } : {}),
  };
}

export function createRangePairParams(id, label, {
  min = 0,
  max = 1,
  step = 0.01,
  defaultMin = min,
  defaultMax = max,
  kind = "",
  display = "number",
} = {}) {
  const shared = {
    min,
    max,
    step,
    ui: "range-pair",
    rangePair: id,
    rangeKind: kind,
    rangeDisplay: display,
  };
  return [
    createNumberParam(`${id}Min`, label, { ...shared, rangeRole: "min", defaultValue: defaultMin }),
    createNumberParam(`${id}Max`, label, { ...shared, rangeRole: "max", defaultValue: defaultMax }),
  ];
}

export function createBooleanParam(id, label, defaultValue = false) {
  return {
    id,
    label,
    type: PARAM_TYPES.BOOLEAN,
    defaultValue: !!defaultValue,
  };
}

export function createEnumParam(id, label, values, defaultValue = values?.[0] || "") {
  return {
    id,
    label,
    type: PARAM_TYPES.ENUM,
    values: Array.isArray(values) ? values : [],
    defaultValue,
  };
}

export function createColorParam(id, label, defaultValue = "#ffffffff") {
  return {
    id,
    label,
    type: PARAM_TYPES.COLOR,
    defaultValue,
  };
}

export function createTextParam(id, label, defaultValue = "", { ui = "text", rows = 3 } = {}) {
  return {
    id,
    label,
    type: PARAM_TYPES.TEXT,
    defaultValue: String(defaultValue ?? ""),
    ui,
    rows: Math.max(1, Math.round(Number(rows) || 3)),
  };
}

export function textureInlet(id = "input", label = "Input") {
  return { id, label, type: PORT_TYPES.TEXTURE };
}

export function textureOutlet(id = "output", label = "Output") {
  return { id, label, type: PORT_TYPES.TEXTURE };
}

export function eventInlet(id = "trigger", label = "Trigger") {
  return { id, label, type: PORT_TYPES.EVENT };
}

export function defineVisualComponent(definition = {}) {
  const declaredParams = [...(definition.params || [])];
  const params = declaredParams.some((param) => param?.id === RENDER_QUALITY_PARAM_ID)
    ? declaredParams
    : [RENDER_QUALITY_PARAM, ...declaredParams];
  const id = definition.id || "";
  const kind = definition.kind || "effect";
  const name = definition.name || definition.label || id || "Component";
  const nodeDefinition = defineNode({
    id: `vj1.visual.${kind}.${id || "component"}`,
    name,
    label: definition.label || name,
    version: definition.version || "0.1.0",
    description: definition.description || `${name} ${kind} node used by the VJ1 visual pipeline.`,
    implementation: definition.code ? NODE_IMPLEMENTATION_KINDS.SHADER : NODE_IMPLEMENTATION_KINDS.NATIVE,
    inlets: Object.fromEntries((definition.inlets || []).map((port) => [port.id, nodePortSpec(port)])),
    outlets: Object.fromEntries((definition.outlets || []).map((port) => [port.id, nodePortSpec(port)])),
    parameters: Object.fromEntries(params.map((param) => [param.id, nodeParameterSpec(param)])),
    execution: {
      trigger: definition.scheduler === "event" ? "input-change" : "frame",
      domain: definition.code ? "gpu" : "main",
      pure: definition.runtime?.cacheable !== false,
      stateful: definition.runtime?.cacheable === false,
      roi: definition.runtime?.roi,
    },
    parts: definition.code ? [{
      id: "fragment-shader",
      name: "Fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      editable: true,
      source: definition.code,
    }] : [],
    capabilities: [
      "visual-node",
      `visual-${kind}`,
      ...(definition.inlets || []).some((port) => port.type === PORT_TYPES.TEXTURE) ? ["consumes-image"] : [],
      ...(definition.outlets || []).some((port) => port.type === PORT_TYPES.TEXTURE) ? ["produces-image"] : [],
    ],
    presentation: {
      catalogs: ["graph", "visual-nodes"],
      placeableOn: ["visual-graph"],
      previewOutput: (definition.outlets || []).find((port) => port.type === PORT_TYPES.TEXTURE)?.id || "",
    },
    metadata: {
      visualId: id,
      family: definition.family || kind,
      category: definition.category || "misc",
    },
  });
  return Object.freeze({
    id,
    kind,
    family: definition.family || kind,
    name,
    label: definition.label || name,
    category: definition.category || "misc",
    processor: definition.processor || definition.kind || "effect",
    scheduler: definition.scheduler || "frame",
    runtime: normalizeRuntimePolicy(definition.runtime),
    spatial: !!definition.spatial,
    transformSource: definition.transformSource !== false,
    sampling: definition.sampling || "unknown",
    requiresBaseSample: definition.requiresBaseSample !== false,
    fusible: definition.fusible === true,
    inlets: Object.freeze([...(definition.inlets || [])]),
    outlets: Object.freeze([...(definition.outlets || [])]),
    params: Object.freeze(params),
    primaryParamIds: Object.freeze([...(definition.primaryParamIds || [])]),
    detailParamIds: Object.freeze([...(definition.detailParamIds || [])]),
    render: textureRenderContract(definition.render || {}),
    code: definition.code ?? null,
    type: definition.type || "effect",
    version: nodeDefinition.version,
    description: nodeDefinition.description,
    nodeDefinition,
  });
}

function nodePortSpec(port = {}) {
  return {
    ...port,
    type: port.type === PORT_TYPES.TEXTURE ? "texture" : port.type || "any",
  };
}

function nodeParameterSpec(param = {}) {
  const type = param.type === PARAM_TYPES.TEXT ? "string" : param.type || "any";
  return {
    ...param,
    type: type === PARAM_TYPES.ENUM ? { type: "enum", values: [...(param.values || [])] } : type,
    expectedRange: Number.isFinite(param.min) && Number.isFinite(param.max) ? [param.min, param.max] : null,
    allowedRange: Number.isFinite(param.min) && Number.isFinite(param.max) ? [param.min, param.max] : null,
    displayRange: Number.isFinite(param.min) && Number.isFinite(param.max) ? [param.min, param.max] : null,
    editor: { type: param.ui || (type === "number" ? "slider" : type === "boolean" ? "toggle" : type === "enum" ? "select" : "input") },
    metadata: {
      ...(param.metadata || {}),
      ...(param.suggestedAnimations?.length ? {
        suggestedAnimations: param.suggestedAnimations.map((suggestion) => ({ ...suggestion })),
      } : {}),
    },
  };
}

export function renderQualityValue(values = {}) {
  return normalizeParamValue(RENDER_QUALITY_PARAM, values?.[RENDER_QUALITY_PARAM_ID]);
}

export function renderQualityScale(values = {}, { minimum = 0.35 } = {}) {
  const quality = renderQualityValue(values);
  if (quality >= RENDER_QUALITY_DEFAULT) return 1;
  return minimum + (1 - minimum) * (quality / RENDER_QUALITY_DEFAULT);
}

function normalizedRuntimeRoi(roi = {}, runtime = {}) {
  const candidate = roi && typeof roi === "object" ? roi : {};
  return Object.freeze({
    mode: ["local", "neighborhood", "full-frame", "projective"].includes(candidate.mode)
      ? candidate.mode
      : runtime?.cacheable === false ? "full-frame" : "local",
    halo: Math.max(0, Number(candidate.halo) || 0),
    coordinateSpace: ["boundary", "full-frame", "projective"].includes(candidate.coordinateSpace)
      ? candidate.coordinateSpace
      : "boundary",
    ...(candidate.inputMapping != null ? { inputMapping: String(candidate.inputMapping) } : {}),
    ...(candidate.pixelEquivalentToFullFrame != null
      ? { pixelEquivalentToFullFrame: candidate.pixelEquivalentToFullFrame !== false }
      : {}),
  });
}

function normalizeRuntimePolicy(runtime = {}) {
  const roi = runtime?.roi && typeof runtime.roi === "object" ? runtime.roi : {};
  return Object.freeze({
    cacheable: runtime?.cacheable !== false,
    timeDependent: typeof runtime?.timeDependent === "function"
      ? runtime.timeDependent
      : () => false,
    timeKey: typeof runtime?.timeKey === "function"
      ? runtime.timeKey
      : (_params, context = {}) => context.time,
    externalKey: typeof runtime?.externalKey === "function"
      ? runtime.externalKey
      : () => null,
    externalRevisionDependent:
      typeof runtime?.externalKey === "function",
    isNeutral: typeof runtime?.isNeutral === "function"
      ? runtime.isNeutral
      : () => false,
    rateParam: String(runtime?.rateParam || ""),
    roi: normalizedRuntimeRoi(roi, runtime),
    roiForParams: typeof runtime?.roiForParams === "function"
      ? runtime.roiForParams
      : null,
  });
}

// Static compiler contracts remain conservative. Runtime parameter values may
// narrow that contract only when a visual explicitly declares how its ROI
// behavior changes. This keeps parameter-dependent effects out of host-specific
// exception lists while allowing the renderer to retain regional execution.
export function runtimeRoiContract(runtimePolicy = {}, params = {}, context = {}) {
  const dynamic = typeof runtimePolicy?.roiForParams === "function"
    ? runtimePolicy.roiForParams(params, context)
    : null;
  return normalizedRuntimeRoi(dynamic || runtimePolicy?.roi || {}, runtimePolicy);
}

export function normalizeParamValues(component, values = {}) {
  const params = {};
  for (const param of component?.params || []) {
    params[param.id] = normalizeParamValue(param, values[param.id]);
  }
  for (const [key, value] of Object.entries(values || {})) {
    if (!(key in params)) params[key] = value;
  }
  return params;
}

export function defaultParamValues(component) {
  return normalizeParamValues(component, {});
}

export function normalizeParamValue(param, value) {
  if (!param) return value;
  if (param.type === PARAM_TYPES.BOOLEAN) return value === undefined ? !!param.defaultValue : value !== false;
  if (param.type === PARAM_TYPES.ENUM) {
    const fallback = param.defaultValue ?? param.values?.[0] ?? "";
    return param.values?.includes(value) ? value : fallback;
  }
  if (param.type === PARAM_TYPES.COLOR) return typeof value === "string" ? value : param.defaultValue || "#ffffff";
  if (param.type === PARAM_TYPES.TEXT) return value === undefined || value === null
    ? String(param.defaultValue ?? "")
    : String(value);
  const number = Number(value ?? param.defaultValue ?? 0);
  const min = Number.isFinite(param.min) ? param.min : -Infinity;
  const max = Number.isFinite(param.max) ? param.max : Infinity;
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : Number(param.defaultValue) || 0));
}

export function paramValue(component, values, id, fallback = 0) {
  const param = (component?.params || []).find((item) => item.id === id);
  if (!param) return values?.[id] ?? fallback;
  return normalizeParamValue(param, values?.[id]);
}

export function createVisualNode(component, {
  id,
  role = component?.kind || "node",
  enabled = true,
  params = {},
  state = {},
  render = {},
} = {}) {
  const normalizedParams = normalizeParamValues(component, params);
  return {
    id: id || `${component?.id || "node"}-${Math.random().toString(36).slice(2, 8)}`,
    componentId: component?.id || "",
    kind: component?.kind || role,
    role,
    enabled: enabled !== false,
    inlets: component?.inlets || [],
    outlets: component?.outlets || [],
    params: normalizedParams,
    render: {
      ...(component?.render || textureRenderContract()),
      ...render,
    },
    state: { ...state },
    scheduler: component?.scheduler || "frame",
  };
}
