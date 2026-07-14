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
  };
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
  return Object.freeze({
    id: definition.id || "",
    kind: definition.kind || "effect",
    family: definition.family || definition.kind || "effect",
    name: definition.name || definition.label || definition.id || "Component",
    label: definition.label || definition.name || definition.id || "Component",
    category: definition.category || "misc",
    processor: definition.processor || definition.kind || "effect",
    scheduler: definition.scheduler || "frame",
    runtime: normalizeRuntimePolicy(definition.runtime),
    spatial: !!definition.spatial,
    transformSource: definition.transformSource !== false,
    inlets: Object.freeze([...(definition.inlets || [])]),
    outlets: Object.freeze([...(definition.outlets || [])]),
    params: Object.freeze(params),
    render: textureRenderContract(definition.render || {}),
    code: definition.code ?? null,
    type: definition.type || "effect",
  });
}

export function renderQualityValue(values = {}) {
  return normalizeParamValue(RENDER_QUALITY_PARAM, values?.[RENDER_QUALITY_PARAM_ID]);
}

export function renderQualityScale(values = {}, { minimum = 0.35 } = {}) {
  const quality = renderQualityValue(values);
  if (quality >= RENDER_QUALITY_DEFAULT) return 1;
  return minimum + (1 - minimum) * (quality / RENDER_QUALITY_DEFAULT);
}

function normalizeRuntimePolicy(runtime = {}) {
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
  });
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
