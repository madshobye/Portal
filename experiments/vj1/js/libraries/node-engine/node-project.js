import { defineNodeGroup } from "./node-group.js";

export const NODE_PROJECT_FORMAT_VERSION = 1;

export function createProjectVisualGroupDefinition({
  id,
  name = "Visual Group",
  description = "A project-owned reusable visual graph compiled before rendering.",
} = {}) {
  const nodeId = String(id || "").trim();
  if (!nodeId) throw new Error("NODE_PROJECT_VISUAL_GROUP_ID_REQUIRED");
  const definition = defineNodeGroup({
    id: nodeId,
    name,
    version: "0.1.0",
    description,
    executionModel: "compiled-graph",
    authoring: {
      activation: "recompile",
      reason: "The authored texture graph compiles into nested optimized render operations.",
    },
    inlets: { texture: { type: "texture", optional: true } },
    outlets: { texture: { type: "texture" } },
    nodes: [],
    connections: [],
    capabilities: [
      "visual-node",
      "expandable-group",
      "compiled-fast-path",
      "project-owned",
      "graph-placeable",
    ],
    presentation: {
      catalogs: ["node-graph", "visual-source"],
      placeableOn: ["visual-graph", "node-graph"],
      expandable: true,
      previewOutput: "texture",
    },
    metadata: {
      visualCompilerHook: {
        id: "vj1.visual.compound",
        contract: {
          transform: { domain: "content" },
          roi: {
            mode: "local",
            coordinateSpace: "boundary",
            inputMapping: "identity",
            pixelEquivalentToFullFrame: true,
          },
          allocation: { mode: "retained" },
          alpha: { input: "premultiplied", output: "premultiplied" },
        },
      },
      projectOwned: true,
    },
  });
  return Object.freeze({
    ...serializeNodeDefinition(definition),
    persistence: "project",
  });
}

export function createProjectGroupDefinitionFromTemplate(template, {
  id,
  name = template?.name || "Project Group",
  description = template?.description || "A project-owned reusable compiled graph.",
} = {}) {
  const nodeId = String(id || "").trim();
  if (!nodeId) throw new Error("NODE_PROJECT_GROUP_ID_REQUIRED");
  if (template?.implementation?.kind !== "group") {
    throw new Error(`NODE_PROJECT_GROUP_TEMPLATE_INVALID:${template?.id || "missing"}`);
  }
  const graph = template.parts?.find((part) => part.kind === "graph");
  if (!graph) throw new Error(`NODE_PROJECT_GROUP_TEMPLATE_GRAPH_MISSING:${template.id}`);
  const definition = defineNodeGroup({
    ...template,
    id: nodeId,
    name,
    label: name,
    version: "0.1.0",
    description,
    compiler: template.compiler || null,
    program: null,
    nodes: graph.nodes || [],
    connections: graph.connections || [],
    publicInlets: graph.publicInlets || {},
    publicOutlets: graph.publicOutlets || {},
    parts: (template.parts || []).filter((part) => part.kind !== "graph"),
    capabilities: [...new Set([
      ...(template.capabilities || []),
      "project-owned",
      "expandable-group",
      "compiled-fast-path",
    ])],
    metadata: {
      ...(template.metadata || {}),
      projectOwned: true,
      projectTemplateBase: {
        id: template.id,
        version: template.version,
      },
    },
  });
  return Object.freeze({
    ...serializeNodeDefinition(definition),
    persistence: "project",
  });
}

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
    packages: [],
    packageLock: [],
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
    packages: normalizePackageReferences(source.packages),
    packageLock: normalizeNodePackageLock(source.packageLock),
    migrations: normalizeCollection(source.migrations),
  };
}

export function normalizeNodePackageLock(value = []) {
  if (!Array.isArray(value)) return [];
  const result = new Map();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = String(item.id || item.packageId || "").trim();
    const version = String(item.version || item.packageVersion || "").trim();
    const integrity = String(item.integrity || "").trim().toLowerCase();
    if (!id || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) continue;
    if (!/^sha256-[0-9a-f]{64}$/.test(integrity)) continue;
    result.set(`${id}@${version}`, { id, version, integrity });
  }
  return [...result.values()].sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}

export function serializeNodeProjectData(value = {}) {
  const normalized = normalizeNodeProjectData(value);
  return {
    ...normalized,
    definitions: persistableCollection(normalized.definitions),
    instances: persistableCollection(normalized.instances),
    groups: persistableCollection(normalized.groups),
    artifacts: persistableCollection(normalized.artifacts),
  };
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
    compiler: definition.compiler,
    inlets: definition.inlets,
    outlets: definition.outlets,
    parameters: definition.parameters,
    execution: definition.execution,
    authoring: definition.authoring,
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

export function installNodePackageReference(packages = [], packageId, version, {
  enabled = true,
} = {}) {
  const id = String(packageId || "").trim();
  const packageVersion = String(version || "").trim();
  if (!id || !packageVersion) throw new Error("NODE_PROJECT_PACKAGE_REFERENCE_INVALID");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new Error(`NODE_PROJECT_PACKAGE_VERSION_INVALID:${id}:${packageVersion}`);
  }
  return [
    ...normalizePackageReferences(packages).filter((item) => item.id !== id),
    { id, version: packageVersion, enabled: enabled !== false },
  ];
}

export function removeNodePackageReference(packages = [], packageId) {
  const id = String(packageId || "").trim();
  return normalizePackageReferences(packages).filter((item) => item.id !== id);
}

function normalizeCollection(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => jsonData(item))
    .filter(isRecord);
}

function normalizePackageReferences(value) {
  if (!Array.isArray(value)) return [];
  const result = new Map();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = String(item.id || item.packageId || "").trim();
    const version = String(item.version || item.packageVersion || "").trim();
    if (!id || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) continue;
    result.set(id, {
      id,
      version,
      enabled: item.enabled !== false,
    });
  }
  return [...result.values()];
}

function persistableCollection(value) {
  return normalizeCollection(value)
    .filter((item) => item.persistence !== "package" && item.persistence !== "derived")
    .map((item) => item.persistence === "compact" ? compactGeneratedGroup(item) : item)
    .map(({ persistence: _runtimePersistence, ...item }) => item);
}

function compactGeneratedGroup(group) {
  return {
    ...group,
    compactTopology: true,
    nodes: compactGeneratedNodes(group.nodes || []),
    connections: [],
  };
}

function compactGeneratedNodes(nodes) {
  return (nodes || [])
    .filter((node) => node.role !== "control")
    .map((node) => {
      const {
        compilerHook: _derivedCompilerHook,
        connections: _derivedConnections,
        nodes: nestedNodes,
        ...canonical
      } = node;
      return nestedNodes
        ? { ...canonical, nodes: compactGeneratedNodes(nestedNodes), connections: [] }
        : canonical;
    });
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
