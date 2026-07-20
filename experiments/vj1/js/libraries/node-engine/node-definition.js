import { normalizeValueSpec } from "./node-types.js";

export const NODE_FORMAT_VERSION = 1;

export const NODE_IMPLEMENTATION_KINDS = Object.freeze({
  CODE: "code",
  SHADER: "shader",
  GROUP: "group",
  DATA: "data",
  NATIVE: "native",
});

export const NODE_PART_KINDS = Object.freeze({
  JAVASCRIPT: "javascript",
  SHADER: "shader",
  GRAPH: "graph",
  ASSET: "asset",
  DOCUMENTATION: "documentation",
  TEST: "test",
  UI: "ui",
});

export const NODE_EXECUTION_CLASSES = Object.freeze({
  LIVE_FRAME: "live-frame",
  INTERACTIVE: "interactive",
  BOUNDED: "bounded",
  OFFLINE: "offline",
});

export function defineNode(definition = {}) {
  const id = requiredText(definition.id, "NODE_DEFINITION_MISSING_ID");
  const name = String(definition.name || definition.label || id);
  const description = requiredText(definition.description, `NODE_DEFINITION_MISSING_DESCRIPTION:${id}`);
  const version = normalizeVersion(definition.version || "0.1.0", id);
  const implementation = normalizeImplementation(definition.implementation || NODE_IMPLEMENTATION_KINDS.CODE);
  const inlets = normalizePortCollection(definition.inlets, "inlet");
  const outlets = normalizePortCollection(definition.outlets, "outlet");
  const parameters = normalizePortCollection(definition.parameters, "parameter");
  const parts = Object.freeze((definition.parts || []).map((part, index) => normalizePart(part, index)));
  const capabilities = Object.freeze(uniqueStrings(definition.capabilities));
  const dependencies = Object.freeze((definition.dependencies || []).map(normalizeNodeDependency));
  const presentation = freezeRecord({
    ...definition.presentation,
    catalogs: Object.freeze(uniqueStrings(definition.presentation?.catalogs)),
    placeableOn: Object.freeze(uniqueStrings(definition.presentation?.placeableOn)),
    hiddenFrom: Object.freeze(uniqueStrings(definition.presentation?.hiddenFrom)),
    expandable: definition.presentation?.expandable === true,
    previewOutput: String(definition.presentation?.previewOutput || ""),
  });
  const execution = freezeRecord({
    ...definition.execution,
    trigger: definition.execution?.trigger || "manual",
    domain: definition.execution?.domain || "main",
    pure: definition.execution?.pure === true,
    stateful: definition.execution?.stateful === true,
    asynchronous: definition.execution?.asynchronous === true,
    maxHz: positiveNumberOrZero(definition.execution?.maxHz),
    workload: Object.values(NODE_EXECUTION_CLASSES).includes(definition.execution?.workload)
      ? definition.execution.workload
      : NODE_EXECUTION_CLASSES.INTERACTIVE,
  });

  return Object.freeze({
    id,
    name,
    label: String(definition.label || name),
    version,
    formatVersion: Math.max(1, Math.round(Number(definition.formatVersion) || NODE_FORMAT_VERSION)),
    description,
    implementation,
    inlets,
    outlets,
    parameters,
    execution,
    parts,
    capabilities,
    dependencies,
    presentation,
    migrations: Object.freeze([...(definition.migrations || [])]),
    process: typeof definition.process === "function" ? definition.process : null,
    // Runtime-only imports supplied to editable JavaScript modules. They are
    // intentionally excluded by serializeNodeDefinition; projects persist the
    // node version and source edits, not live function objects.
    moduleBindings: freezeRecord(definition.moduleBindings || {}),
    // Runtime-only compiled helper exports. Visual compiler hooks can consume
    // these without moving helper logic back into a host switch statement.
    // Like bindings, function objects are deliberately never serialized.
    moduleExports: freezeRecord(definition.moduleExports || {}),
    metadata: freezeRecord(definition.metadata || {}),
  });
}

export function definePort(id, specification = {}, role = "inlet") {
  const source = typeof specification === "string" ? { type: specification } : specification || {};
  const portId = requiredText(id || source.id, `NODE_PORT_MISSING_ID:${role}`);
  const expectedRange = normalizeRange(source.expectedRange || finiteMinMax(source));
  const allowedRange = normalizeRange(source.allowedRange);
  const displayRange = normalizeRange(source.displayRange);
  return Object.freeze({
    id: portId,
    label: String(source.label || portId),
    role,
    type: normalizeValueSpec(source.type || "any"),
    required: source.required === true,
    optional: source.optional === true,
    defaultValue: source.defaultValue,
    expectedRange,
    allowedRange,
    displayRange,
    scale: source.scale || "linear",
    clamp: source.clamp === true,
    smoothing: normalizeSmoothing(source.smoothing),
    rate: normalizeRate(source.rate),
    editor: freezeRecord(source.editor || inferEditor(source)),
    description: String(source.description || ""),
    metadata: freezeRecord(source.metadata || {}),
  });
}

export class NodeRegistry {
  constructor(definitions = []) {
    this.versions = new Map();
    this.latest = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const normalized = isNodeDefinition(definition) ? definition : defineNode(definition);
    const key = registryKey(normalized.id, normalized.version);
    if (this.versions.has(key)) throw new Error(`NODE_ALREADY_REGISTERED:${key}`);
    this.versions.set(key, normalized);
    const currentLatest = this.latest.get(normalized.id);
    if (!currentLatest || compareNormalizedVersions(normalized.version, currentLatest.version) > 0) {
      this.latest.set(normalized.id, normalized);
    }
    return normalized;
  }

  get(id, version = "") {
    const definition = version
      ? this.versions.get(registryKey(id, version))
      : this.latest.get(String(id || ""));
    if (!definition) throw new Error(`NODE_NOT_REGISTERED:${registryKey(id, version || "latest")}`);
    return definition;
  }

  has(id, version = "") {
    return version ? this.versions.has(registryKey(id, version)) : this.latest.has(String(id || ""));
  }

  list({ capability = "", implementation = "" } = {}) {
    return Array.from(this.latest.values()).filter((definition) =>
      (!capability || definition.capabilities.includes(capability)) &&
      (!implementation || definition.implementation.kind === implementation));
  }

  listVersions(id) {
    const nodeId = String(id || "");
    return Array.from(this.versions.values())
      .filter((definition) => definition.id === nodeId)
      .sort((left, right) => compareNormalizedVersions(left.version, right.version));
  }
}

export function isNodeDefinition(value) {
  return !!value && typeof value === "object" &&
    typeof value.id === "string" && typeof value.version === "string" &&
    Number.isFinite(value.formatVersion) && value.inlets && value.outlets && value.parameters;
}

function normalizePortCollection(collection, role) {
  const entries = Array.isArray(collection)
    ? collection.map((port) => [port?.id, port])
    : Object.entries(collection || {});
  const result = {};
  for (const [id, specification] of entries) {
    const port = definePort(id, specification, role);
    if (result[port.id]) throw new Error(`NODE_PORT_DUPLICATE:${role}:${port.id}`);
    result[port.id] = port;
  }
  return Object.freeze(result);
}

function normalizeImplementation(value) {
  const source = typeof value === "string" ? { kind: value } : value || {};
  const kind = String(source.kind || NODE_IMPLEMENTATION_KINDS.CODE);
  if (!Object.values(NODE_IMPLEMENTATION_KINDS).includes(kind)) throw new Error(`NODE_IMPLEMENTATION_UNKNOWN:${kind}`);
  return freezeRecord({ ...source, kind });
}

function normalizePart(part, index) {
  const kind = String(part?.kind || "");
  if (!Object.values(NODE_PART_KINDS).includes(kind)) throw new Error(`NODE_PART_UNKNOWN:${kind || index}`);
  return freezeRecord({
    id: String(part.id || `${kind}-${index + 1}`),
    name: String(part.name || part.label || part.id || kind),
    editable: part.editable !== false,
    ...part,
    kind,
  });
}

function normalizeSmoothing(value) {
  if (!value || value === "none") return Object.freeze({ mode: "none" });
  const source = typeof value === "string" ? { mode: value } : value;
  return freezeRecord({
    mode: source.mode || "exponential",
    timeConstantMs: positiveNumberOrZero(source.timeConstantMs),
    maxUnitsPerSecond: positiveNumberOrZero(source.maxUnitsPerSecond),
    ...source,
  });
}

function normalizeRate(value) {
  if (!value) return Object.freeze({ maxHz: 0, overflow: "latest" });
  const source = typeof value === "number" ? { maxHz: value } : value;
  const overflow = ["latest", "drop", "queue", "sample"].includes(source.overflow) ? source.overflow : "latest";
  return freezeRecord({ ...source, maxHz: positiveNumberOrZero(source.maxHz), overflow });
}

function inferEditor(source) {
  const type = typeof source.type === "string" ? source.type : source.type?.type;
  if (source.ui) return { type: source.ui };
  if (type === "number") return { type: "slider", step: source.step };
  if (type === "boolean") return { type: "toggle" };
  if (type === "enum") return { type: "select" };
  if (type === "color") return { type: "color" };
  return { type: "input" };
}

function normalizeRange(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) return null;
  return Object.freeze(first < second ? [first, second] : [second, first]);
}

function finiteMinMax(source) {
  return Number.isFinite(source.min) && Number.isFinite(source.max) ? [source.min, source.max] : null;
}

function normalizeVersion(version, id) {
  const value = String(version || "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) throw new Error(`NODE_VERSION_INVALID:${id}:${value}`);
  return value;
}

function registryKey(id, version) {
  return `${String(id || "")}@${String(version || "")}`;
}

function compareNormalizedVersions(left, right) {
  const leftParts = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(left).slice(1).map(Number);
  const rightParts = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(right).slice(1).map(Number);
  return leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2];
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function uniqueStrings(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeNodeDependency(value) {
  const source = typeof value === "string" ? { id: value } : value || {};
  const id = requiredText(source.id || source.nodeId, "NODE_DEPENDENCY_MISSING_ID");
  return Object.freeze({
    id,
    range: String(source.range || source.version || "*"),
    optional: source.optional === true,
  });
}

function positiveNumberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function freezeRecord(value) {
  return Object.freeze({ ...(value || {}) });
}
