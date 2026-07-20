export const NODE_PROJECT_FORMAT_VERSION = 1;

export function createEmptyNodeProjectData() {
  return {
    formatVersion: NODE_PROJECT_FORMAT_VERSION,
    authority: "node-graph",
    definitions: [],
    pins: [],
    instances: [],
    groups: [],
    artifacts: [],
    forks: [],
    migrations: [],
  };
}

export function normalizeNodeProjectData(value = {}) {
  const source = isRecord(value) ? value : {};
  return {
    formatVersion: positiveInteger(source.formatVersion, NODE_PROJECT_FORMAT_VERSION),
    authority: source.authority === "node-graph" ? "node-graph" : "component-import",
    definitions: normalizeCollection(source.definitions),
    pins: normalizeCollection(source.pins),
    instances: normalizeCollection(source.instances),
    groups: normalizeCollection(source.groups),
    artifacts: normalizeCollection(source.artifacts),
    forks: normalizeCollection(source.forks),
    migrations: normalizeCollection(source.migrations),
  };
}

export function serializeNodeProjectData(value = {}) {
  return normalizeNodeProjectData(value);
}

export function serializeNodeDefinition(definition = {}) {
  if (!isRecord(definition)) return null;
  return jsonData({
    id: definition.id,
    name: definition.name,
    label: definition.label,
    version: definition.version,
    formatVersion: definition.formatVersion,
    description: definition.description,
    implementation: definition.implementation,
    inlets: definition.inlets,
    outlets: definition.outlets,
    parameters: definition.parameters,
    execution: definition.execution,
    parts: definition.parts,
    capabilities: definition.capabilities,
    dependencies: definition.dependencies,
    presentation: definition.presentation,
    migrations: definition.migrations,
    metadata: definition.metadata,
  });
}

export function serializeNodeArtifact(artifact = {}) {
  if (!isRecord(artifact)) return null;
  return jsonData(artifact);
}

export function pinNodeVersion(pins = [], nodeId, version) {
  const id = String(nodeId || "").trim();
  const pinnedVersion = String(version || "").trim();
  if (!id || !pinnedVersion) throw new Error("NODE_PROJECT_PIN_INVALID");
  return [
    ...normalizeCollection(pins).filter((pin) => pin.nodeId !== id),
    { nodeId: id, version: pinnedVersion },
  ];
}

function normalizeCollection(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => jsonData(item))
    .filter(isRecord);
}

// Project node data crosses the JSON storage boundary. Runtime callbacks and
// other non-data values intentionally stay in the registered in-memory node.
function jsonData(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonData).filter((item) => item !== undefined);
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = jsonData(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
