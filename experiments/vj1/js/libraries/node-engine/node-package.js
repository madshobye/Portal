import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "./node-definition.js";
import { defineNodeArtifact } from "./node-artifact.js";
import { compileJavaScriptNodeModule } from "./node-editor.js";
import {
  defineVisualArtifact,
  defineVisualLibraryLayer,
  VISUAL_IMPLEMENTATION_FORMATS,
  VISUAL_LIBRARY_LAYER_KINDS,
} from "../visual-library/index.js";
import {
  installNodePackageReference,
  normalizeNodeProjectData,
  pinNodeVersion,
  serializeNodeArtifact,
  serializeNodeDefinition,
} from "./node-project.js";

export const NODE_PACKAGE_FORMAT_VERSION = 3;

export const NODE_PACKAGE_RESOURCE_KINDS = Object.freeze({
  SHADER: "shader",
  MEDIA: "media",
  PREVIEW: "preview",
  PRESET: "preset",
  DATA: "data",
  OTHER: "other",
});

export function defineNodePackage({
  id,
  name = id,
  version = "0.1.0",
  description = "Node package",
  dependencies = [],
  nodeDependencies = [],
  definitions = [],
  artifacts = [],
  groups = [],
  forks = [],
  resources = [],
  visualLibrary = [],
  metadata = {},
} = {}) {
  const packageId = requiredText(id, "NODE_PACKAGE_MISSING_ID");
  assertVersion(version, `NODE_PACKAGE_VERSION_INVALID:${packageId}`);
  const normalizedDependencies = dependencies.map(normalizePackageDependency);
  assertUnique(normalizedDependencies, (dependency) => dependency.id, `NODE_PACKAGE_DEPENDENCY_DUPLICATE:${packageId}`);
  const normalizedNodeDependencies = nodeDependencies.map(normalizeNodeRequirement);
  assertUnique(normalizedNodeDependencies, (dependency) => dependency.id, `NODE_PACKAGE_NODE_DEPENDENCY_DUPLICATE:${packageId}`);
  const normalizedDefinitions = definitions.map((definition) => (
    attachSerializedCompiler(defineNode(definition), definition?.compiler)
  ));
  const normalizedArtifacts = artifacts.map((artifact) => defineNodeArtifact(artifact));
  const normalizedGroups = groups.map(normalizePackageGroup);
  const normalizedForks = forks.map(normalizePackageFork);
  const normalizedResources = resources.map(normalizePackageResource);
  const normalizedVisualLibrary = visualLibrary.map((artifact) => defineVisualArtifact(artifact));
  const definitionKeys = new Set();
  for (const definition of normalizedDefinitions) {
    const key = `${definition.id}@${definition.version}`;
    if (definitionKeys.has(key)) throw new Error(`NODE_PACKAGE_DEFINITION_DUPLICATE:${packageId}:${key}`);
    definitionKeys.add(key);
  }
  assertUnique(normalizedArtifacts, (artifact) => artifact.id, `NODE_PACKAGE_ARTIFACT_DUPLICATE:${packageId}`);
  assertUnique(normalizedGroups, (group) => group.id, `NODE_PACKAGE_GROUP_DUPLICATE:${packageId}`);
  assertUnique(normalizedForks, (fork) => fork.id, `NODE_PACKAGE_FORK_DUPLICATE:${packageId}`);
  assertUnique(normalizedResources, (resource) => resource.id, `NODE_PACKAGE_RESOURCE_DUPLICATE:${packageId}`);
  assertUnique(normalizedVisualLibrary, (artifact) => artifact.id, `NODE_PACKAGE_VISUAL_ARTIFACT_DUPLICATE:${packageId}`);
  assertVisualLibraryReferences(
    normalizedVisualLibrary,
    normalizedResources,
    normalizedDefinitions,
    normalizedNodeDependencies,
    packageId
  );
  return Object.freeze({
    formatVersion: NODE_PACKAGE_FORMAT_VERSION,
    id: packageId,
    name: String(name || packageId),
    version: String(version),
    description: String(description || ""),
    dependencies: Object.freeze(normalizedDependencies),
    nodeDependencies: Object.freeze(normalizedNodeDependencies),
    definitions: Object.freeze(normalizedDefinitions),
    artifacts: Object.freeze(normalizedArtifacts),
    groups: Object.freeze(normalizedGroups),
    forks: Object.freeze(normalizedForks),
    resources: Object.freeze(normalizedResources),
    visualLibrary: Object.freeze(normalizedVisualLibrary),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function serializeNodePackage(nodePackage) {
  const source = defineNodePackage(nodePackage);
  return {
    formatVersion: NODE_PACKAGE_FORMAT_VERSION,
    id: source.id,
    name: source.name,
    version: source.version,
    description: source.description,
    dependencies: source.dependencies.map((dependency) => ({ ...dependency })),
    nodeDependencies: source.nodeDependencies.map((dependency) => ({ ...dependency })),
    definitions: source.definitions.map(serializePackageNodeDefinition),
    artifacts: source.artifacts.map(serializeNodeArtifact),
    groups: source.groups.map(jsonData),
    forks: source.forks.map(jsonData),
    resources: source.resources.map(jsonData),
    visualLibrary: source.visualLibrary.map(jsonData),
    metadata: jsonData(source.metadata),
  };
}

export function nodePackageContentIntegrity(nodePackage) {
  const integrity = String(nodePackage?.metadata?.repositoryContentIntegrity || "").toLowerCase();
  return /^sha256-[0-9a-f]{64}$/.test(integrity) ? integrity : "";
}

export function assertNodePackageTransportLock(packages = [], packageLock = []) {
  const lock = new Map((packageLock || []).map((item) => [
    `${String(item?.id || "")}@${String(item?.version || "")}`,
    String(item?.integrity || "").toLowerCase(),
  ]));
  if (lock.size !== (packages || []).length) {
    throw new Error("NODE_PACKAGE_TRANSPORT_LOCK_SIZE_MISMATCH");
  }
  for (const nodePackage of packages || []) {
    const key = `${nodePackage.id}@${nodePackage.version}`;
    const actual = nodePackageContentIntegrity(nodePackage);
    if (!actual || lock.get(key) !== actual) {
      throw new Error(`NODE_PACKAGE_TRANSPORT_INTEGRITY_MISMATCH:${key}`);
    }
  }
  return true;
}

export function exportNodePackage(nodePackage, { pretty = true } = {}) {
  return JSON.stringify(serializeNodePackage(nodePackage), null, pretty ? 2 : 0);
}

export function importNodePackage(value, {
  moduleBindings = {},
  processFactories = {},
} = {}) {
  const source = typeof value === "string" ? JSON.parse(value) : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("NODE_PACKAGE_INVALID");
  const formatVersion = Number(source.formatVersion);
  if (![1, 2, NODE_PACKAGE_FORMAT_VERSION].includes(formatVersion)) {
    throw new Error(`NODE_PACKAGE_FORMAT_UNSUPPORTED:${source.formatVersion || "missing"}`);
  }
  const definitions = (source.definitions || []).map((definition) => hydrateImportedNodeDefinition({
    ...definition,
    migrations: (definition.migrations || []).map((migration) => hydrateImportedNodeMigration(migration, definition.id)),
  }, {
    bindings: moduleBindings[definition.id] || {},
    processFactory: processFactories[definition.id],
  }));
  const artifacts = (source.artifacts || []).map((artifact) => defineNodeArtifact(artifact));
  return defineNodePackage({
    ...source,
    formatVersion: NODE_PACKAGE_FORMAT_VERSION,
    nodeDependencies: source.nodeDependencies || [],
    groups: source.groups || [],
    forks: source.forks || [],
    resources: source.resources || [],
    visualLibrary: source.visualLibrary || [],
    definitions,
    artifacts,
  });
}

export function installNodePackage(nodePackage, { registry, artifactCatalog = null } = {}) {
  if (!registry?.register) throw new Error("NODE_PACKAGE_REGISTRY_REQUIRED");
  preflightRuntimePackageInstall(nodePackage, { registry, artifactCatalog });
  const installedDefinitions = [];
  for (const definition of nodePackage.definitions || []) {
    if (!registry.has(definition.id, definition.version)) installedDefinitions.push(registry.register(definition));
  }
  const installedArtifacts = [];
  for (const artifact of nodePackage.artifacts || []) {
    if (!artifactCatalog?.register) break;
    if (!artifactCatalogHas(artifactCatalog, artifact.id)) installedArtifacts.push(artifactCatalog.register(artifact));
  }
  return Object.freeze({
    definitions: Object.freeze(installedDefinitions),
    artifacts: Object.freeze(installedArtifacts),
    resources: nodePackage.resources,
    visualLibrary: nodePackage.visualLibrary,
  });
}

// Project groups are persisted executable topology, not runtime wrappers. A
// reusable package therefore transports the selected group records alongside
// their node definitions and declares every referenced external node version.
export function createNodePackageFromProject(projectData, manifest = {}) {
  const project = normalizeNodeProjectData(projectData);
  const selectedGroups = selectProjectRecords(project.groups, manifest.groupIds, "NODE_PACKAGE_PROJECT_GROUP_MISSING");
  const selectedArtifacts = selectProjectRecords(project.artifacts, manifest.artifactIds, "NODE_PACKAGE_PROJECT_ARTIFACT_MISSING");
  const selectedForks = selectProjectRecords(project.forks, manifest.forkIds, "NODE_PACKAGE_PROJECT_FORK_MISSING");
  const definitionRefs = normalizeDefinitionSelections(manifest.nodeIds || []);

  for (const group of selectedGroups) {
    const ownId = String(group.nodeId || group.id || "");
    if (ownId && project.definitions.some((definition) => definition.id === ownId)) {
      definitionRefs.push({ id: ownId, version: String(group.nodeVersion || "") });
    }
  }
  for (const artifact of selectedArtifacts) {
    const ownId = String(artifact.implementation?.nodeType || "");
    if (ownId && project.definitions.some((definition) => definition.id === ownId)) {
      definitionRefs.push({ id: ownId, version: String(artifact.implementation?.nodeVersion || "") });
    }
  }

  const definitions = [...new Map(uniqueDefinitionSelections(definitionRefs)
    .map((reference) => projectDefinitionForReference(project, reference))
    .map((definition) => [`${definition.id}@${definition.version}`, definition])).values()];
  const includedKeys = new Set(definitions.map((definition) => `${definition.id}@${definition.version}`));
  const requirements = [];
  for (const group of selectedGroups) {
    for (const reference of groupNodeReferences(group)) {
      if (!includedKeys.has(`${reference.id}@${reference.version}`)) requirements.push(reference);
    }
  }
  for (const definition of definitions) {
    for (const dependency of definition.dependencies || []) requirements.push({
      id: dependency.id,
      range: dependency.range || "*",
      optional: dependency.optional === true,
    });
    for (const graph of (definition.parts || []).filter((part) => part.kind === "graph")) {
      for (const reference of groupNodeReferences(graph)) {
        if (!includedKeys.has(`${reference.id}@${reference.version}`)) requirements.push(reference);
      }
    }
  }
  for (const artifact of selectedArtifacts) {
    const id = String(artifact.implementation?.nodeType || "");
    const version = String(artifact.implementation?.nodeVersion || "");
    if (id && !includedKeys.has(`${id}@${version}`)) requirements.push({ id, range: version || "*" });
  }
  for (const fork of selectedForks) {
    requirements.push({ id: fork.base.id, range: fork.base.version });
    for (const graph of (fork.definition?.parts || []).filter((part) => part.kind === "graph")) {
      for (const reference of groupNodeReferences(graph)) {
        if (!includedKeys.has(`${reference.id}@${reference.version}`)) requirements.push(reference);
      }
    }
  }

  return defineNodePackage({
    ...manifest,
    nodeDependencies: mergeNodeRequirements(manifest.nodeDependencies || [], requirements, includedKeys),
    definitions,
    artifacts: selectedArtifacts.map(defineNodeArtifact),
    groups: selectedGroups,
    forks: selectedForks,
    resources: manifest.resources || [],
    visualLibrary: manifest.visualLibrary || [],
  });
}

export function installNodePackageIntoProject(nodePackage, projectData, {
  replace = false,
  pinVersions = false,
  upgradeForks = false,
  allowBreakingForkUpgrades = false,
} = {}) {
  const project = normalizeNodeProjectData(projectData);
  const source = nodePackage?.formatVersion === NODE_PACKAGE_FORMAT_VERSION
    ? nodePackage
    : importNodePackage(nodePackage);
  preflightProjectPackageInstall(source, project, { replace });

  const definitionRecords = source.definitions.map(serializeNodeDefinition);
  const artifactRecords = source.artifacts.map(serializeNodeArtifact);
  const forkUpgrades = upgradeForks
    ? upgradedProjectForks(project, source.definitions, {
      excludedForkIds: new Set(source.forks.map((fork) => fork.id)),
      allowBreaking: allowBreakingForkUpgrades,
    })
    : { forks: project.forks, upgraded: [] };
  const result = {
    ...project,
    definitions: mergeProjectRecords(project.definitions, definitionRecords, (item) => `${item.id}@${item.version}`, replace),
    artifacts: mergeProjectRecords(project.artifacts, artifactRecords, (item) => item.id, replace),
    groups: mergeProjectRecords(project.groups, source.groups, (item) => item.id, replace),
    forks: mergeProjectRecords(forkUpgrades.forks, source.forks, (item) => item.id, replace),
    packages: installNodePackageReference(project.packages, source.id, source.version),
  };
  if (pinVersions) {
    result.pins = definitionRecords.reduce(
      (pins, definition) => pinNodeVersion(pins, definition.id, definition.version),
      project.pins
    );
  }
  return Object.freeze({
    project: normalizeNodeProjectData(result),
    installed: Object.freeze({
      packageId: source.id,
      packageVersion: source.version,
      definitions: Object.freeze(definitionRecords.map((definition) => `${definition.id}@${definition.version}`)),
      artifacts: Object.freeze(artifactRecords.map((artifact) => artifact.id)),
      groups: Object.freeze(source.groups.map((group) => group.id)),
      forks: Object.freeze(source.forks.map((fork) => fork.id)),
      resources: source.resources,
      visualLibrary: source.visualLibrary,
      upgradedForks: Object.freeze(forkUpgrades.upgraded),
    }),
  });
}

export function createNodePackageVisualLibraryLayer(nodePackage, { priority = 100 } = {}) {
  const source = nodePackage?.formatVersion === NODE_PACKAGE_FORMAT_VERSION
    ? nodePackage
    : importNodePackage(nodePackage);
  return defineVisualLibraryLayer({
    id: source.id,
    kind: VISUAL_LIBRARY_LAYER_KINDS.INSTALLED,
    priority,
    artifacts: source.visualLibrary,
    metadata: {
      packageId: source.id,
      packageVersion: source.version,
      resources: Object.freeze(source.resources.map((resource) => Object.freeze({ ...resource }))),
    },
  });
}

export function resolveProjectNodePackages(projectData = {}, availablePackages = []) {
  const project = normalizeNodeProjectData(projectData);
  const available = (availablePackages || []).map((nodePackage) =>
    nodePackage?.formatVersion === NODE_PACKAGE_FORMAT_VERSION ? nodePackage : importNodePackage(nodePackage));
  const availableByKey = new Map(available.map((nodePackage) => [
    `${nodePackage.id}@${nodePackage.version}`,
    nodePackage,
  ]));
  const resolvedById = new Map();
  const ordered = [];
  for (const reference of project.packages.filter((item) => item.enabled !== false)) {
    const root = availableByKey.get(`${reference.id}@${reference.version}`);
    if (!root) throw new Error(`NODE_PROJECT_PACKAGE_UNAVAILABLE:${reference.id}@${reference.version}`);
    for (const nodePackage of resolveNodePackageDependencies(root, available)) {
      const current = resolvedById.get(nodePackage.id);
      if (current && current.version !== nodePackage.version) {
        throw new Error(`NODE_PROJECT_PACKAGE_VERSION_CONFLICT:${nodePackage.id}:${current.version}:${nodePackage.version}`);
      }
      if (current) continue;
      resolvedById.set(nodePackage.id, nodePackage);
      ordered.push(nodePackage);
    }
  }
  return Object.freeze(ordered);
}

export function projectNodePackageVisualLibraryLayers(projectData = {}, availablePackages = []) {
  return Object.freeze(resolveProjectNodePackages(projectData, availablePackages)
    .map((nodePackage, index) => createNodePackageVisualLibraryLayer(nodePackage, {
      priority: 100 + index,
    })));
}

export function resolveNodeVersion(registry, nodeId, { range = "*", pins = [] } = {}) {
  const id = String(nodeId || "");
  const pin = (pins || []).find((item) => item.nodeId === id);
  if (pin) {
    if (!satisfiesNodeVersion(pin.version, range)) throw new Error(`NODE_PIN_RANGE_CONFLICT:${id}:${pin.version}:${range}`);
    return registry.get(id, pin.version);
  }
  const matches = (registry.listVersions?.(id) || []).filter((definition) => satisfiesNodeVersion(definition.version, range));
  if (!matches.length) throw new Error(`NODE_DEPENDENCY_UNRESOLVED:${id}:${range}`);
  return matches.sort((left, right) => compareNodeVersions(right.version, left.version))[0];
}

export function resolveNodeDependencies(definition, registry, { pins = [] } = {}) {
  const resolved = new Map();
  const visiting = new Set();
  const visit = (current) => {
    const key = `${current.id}@${current.version}`;
    if (visiting.has(key)) throw new Error(`NODE_DEPENDENCY_CYCLE:${[...visiting, key].join("->")}`);
    if (resolved.has(key)) return;
    visiting.add(key);
    for (const dependency of current.dependencies || []) {
      try {
        const target = resolveNodeVersion(registry, dependency.id, { range: dependency.range, pins });
        visit(target);
      } catch (error) {
        if (!dependency.optional) throw error;
      }
    }
    visiting.delete(key);
    resolved.set(key, current);
  };
  visit(definition);
  return Object.freeze([...resolved.values()]);
}

export function resolveNodePackageDependencies(nodePackage, availablePackages = []) {
  const byId = new Map();
  for (const candidate of availablePackages || []) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, []);
    byId.get(candidate.id).push(candidate);
  }
  const result = new Map();
  const visit = (current, stack = []) => {
    const key = `${current.id}@${current.version}`;
    if (stack.includes(key)) throw new Error(`NODE_PACKAGE_DEPENDENCY_CYCLE:${[...stack, key].join("->")}`);
    if (result.has(key)) return;
    for (const dependency of current.dependencies || []) {
      const match = (byId.get(dependency.id) || [])
        .filter((candidate) => satisfiesNodeVersion(candidate.version, dependency.range))
        .sort((left, right) => compareNodeVersions(right.version, left.version))[0];
      if (!match) {
        if (dependency.optional) continue;
        throw new Error(`NODE_PACKAGE_DEPENDENCY_UNRESOLVED:${current.id}:${dependency.id}:${dependency.range}`);
      }
      visit(match, [...stack, key]);
    }
    result.set(key, current);
  };
  visit(nodePackage);
  return Object.freeze([...result.values()]);
}

export function checkNodeCompatibility(previous, next) {
  if (previous.id !== next.id) throw new Error(`NODE_COMPATIBILITY_ID_MISMATCH:${previous.id}:${next.id}`);
  const issues = [];
  comparePortCollections("inlet", previous.inlets, next.inlets, issues);
  comparePortCollections("outlet", previous.outlets, next.outlets, issues);
  comparePortCollections("parameter", previous.parameters, next.parameters, issues);
  const nextParts = new Set((next.parts || []).map((part) => part.id));
  for (const part of previous.parts || []) {
    if (!nextParts.has(part.id)) issues.push(issue("part-removed", `part:${part.id}`, true));
  }
  if (parseVersion(previous.version).major !== parseVersion(next.version).major) {
    issues.push(issue("major-version-change", "version", true));
  }
  return Object.freeze({
    compatible: !issues.some((item) => item.breaking),
    previous: previous.version,
    next: next.version,
    issues: Object.freeze(issues),
  });
}

export function migrateNodeData(value, fromVersion, targetDefinition) {
  let version = String(fromVersion || "");
  let data = jsonData(value);
  const migrations = [...(targetDefinition.migrations || [])];
  const applied = [];
  while (version !== targetDefinition.version) {
    const migration = migrations.find((item) => item.from === version && typeof item.migrate === "function");
    if (!migration) throw new Error(`NODE_MIGRATION_MISSING:${targetDefinition.id}:${version}:${targetDefinition.version}`);
    data = migration.migrate(data);
    version = String(migration.to || "");
    assertVersion(version, `NODE_MIGRATION_TARGET_INVALID:${targetDefinition.id}`);
    applied.push(`${migration.from}->${version}`);
    if (applied.length > migrations.length) throw new Error(`NODE_MIGRATION_CYCLE:${targetDefinition.id}`);
  }
  return Object.freeze({ data: jsonData(data), version, applied: Object.freeze(applied) });
}

export function upgradeProjectNodeFork(fork, previousDefinition, nextDefinition, { allowBreaking = false } = {}) {
  if (fork?.base?.id !== previousDefinition.id || fork?.base?.version !== previousDefinition.version) {
    throw new Error(`NODE_FORK_BASE_MISMATCH:${fork?.id || "missing"}`);
  }
  const compatibility = checkNodeCompatibility(previousDefinition, nextDefinition);
  let definition = jsonData(fork.definition || {});
  let applied = [];
  if (previousDefinition.version !== nextDefinition.version) {
    try {
      const migrated = migrateNodeData(definition, previousDefinition.version, nextDefinition);
      definition = migrated.data;
      applied = migrated.applied;
    } catch (error) {
      const missingIdentityMigration = compatibility.compatible && String(error?.message || "").startsWith("NODE_MIGRATION_MISSING:");
      if (!missingIdentityMigration && !allowBreaking) throw error;
    }
  }
  if (!compatibility.compatible && !allowBreaking && !applied.length) {
    throw new Error(`NODE_FORK_UPGRADE_INCOMPATIBLE:${previousDefinition.id}:${previousDefinition.version}:${nextDefinition.version}`);
  }
  return Object.freeze({
    fork: Object.freeze({
      ...fork,
      base: Object.freeze({ id: nextDefinition.id, version: nextDefinition.version }),
      definition: Object.freeze(definition),
      upgradedFrom: Object.freeze({ version: previousDefinition.version, applied }),
    }),
    compatibility,
  });
}

export function satisfiesNodeVersion(version, range = "*") {
  const candidate = parseVersion(version);
  const expression = String(range || "*").trim();
  if (!expression || expression === "*") return true;
  return expression.split(/\s+/).every((term) => {
    if (term.startsWith("^")) {
      const base = parseVersion(term.slice(1));
      return compareParsed(candidate, base) >= 0 && candidate.major === base.major;
    }
    if (term.startsWith("~")) {
      const base = parseVersion(term.slice(1));
      return compareParsed(candidate, base) >= 0 && candidate.major === base.major && candidate.minor === base.minor;
    }
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(term);
    const base = parseVersion(match[2]);
    const comparison = compareParsed(candidate, base);
    return match[1] === ">=" ? comparison >= 0
      : match[1] === "<=" ? comparison <= 0
      : match[1] === ">" ? comparison > 0
      : match[1] === "<" ? comparison < 0
      : comparison === 0;
  });
}

export function compareNodeVersions(left, right) {
  return compareParsed(parseVersion(left), parseVersion(right));
}

function preflightRuntimePackageInstall(nodePackage, { registry, artifactCatalog }) {
  const available = runtimeDefinitionCandidates(nodePackage, registry);
  assertNodeRequirements(nodePackage.nodeDependencies || [], available, nodePackage.id);
  assertDefinitionDependencies(nodePackage.definitions || [], available, nodePackage.id);
  assertGroupReferences(nodePackage.groups || [], available, nodePackage.id);
  assertArtifactReferences(nodePackage.artifacts || [], available, nodePackage.id);

  for (const definition of nodePackage.definitions || []) {
    if (!registry.has(definition.id, definition.version)) continue;
    const existing = registry.get(definition.id, definition.version);
    if (!sameJson(serializeNodeDefinition(existing), serializeNodeDefinition(definition))) {
      throw new Error(`NODE_PACKAGE_DEFINITION_CONFLICT:${nodePackage.id}:${definition.id}@${definition.version}`);
    }
  }
  if (!artifactCatalog) return;
  for (const artifact of nodePackage.artifacts || []) {
    const existing = artifactCatalogRecord(artifactCatalog, artifact.id);
    if (existing && !sameJson(serializeNodeArtifact(existing), serializeNodeArtifact(artifact))) {
      throw new Error(`NODE_PACKAGE_ARTIFACT_CONFLICT:${nodePackage.id}:${artifact.id}`);
    }
  }
}

function preflightProjectPackageInstall(nodePackage, project, { replace }) {
  const available = [...project.definitions, ...(nodePackage.definitions || [])];
  assertNodeRequirements(nodePackage.nodeDependencies || [], available, nodePackage.id);
  assertDefinitionDependencies(nodePackage.definitions || [], available, nodePackage.id);
  assertGroupReferences(nodePackage.groups || [], available, nodePackage.id);
  assertArtifactReferences(nodePackage.artifacts || [], available, nodePackage.id);
  assertProjectRecordConflicts(
    project.definitions,
    nodePackage.definitions || [],
    (item) => `${item.id}@${item.version}`,
    `NODE_PACKAGE_DEFINITION_CONFLICT:${nodePackage.id}`,
    replace
  );
  assertProjectRecordConflicts(
    project.artifacts,
    nodePackage.artifacts || [],
    (item) => item.id,
    `NODE_PACKAGE_ARTIFACT_CONFLICT:${nodePackage.id}`,
    replace
  );
  assertProjectRecordConflicts(
    project.groups,
    nodePackage.groups || [],
    (item) => item.id,
    `NODE_PACKAGE_GROUP_CONFLICT:${nodePackage.id}`,
    replace
  );
  assertProjectRecordConflicts(
    project.forks,
    nodePackage.forks || [],
    (item) => item.id,
    `NODE_PACKAGE_FORK_CONFLICT:${nodePackage.id}`,
    replace
  );
}

function upgradedProjectForks(project, incomingDefinitions, { excludedForkIds, allowBreaking }) {
  const projectDefinitions = new Map(project.definitions.map((definition) => [
    `${definition.id}@${definition.version}`,
    defineNode(definition),
  ]));
  const incomingById = new Map();
  for (const definition of incomingDefinitions || []) {
    if (!incomingById.has(definition.id)) incomingById.set(definition.id, []);
    incomingById.get(definition.id).push(definition);
  }
  const upgraded = [];
  const forks = project.forks.map((fork) => {
    if (excludedForkIds.has(fork.id)) return fork;
    const previous = projectDefinitions.get(`${fork.base?.id}@${fork.base?.version}`);
    if (!previous) return fork;
    const next = (incomingById.get(previous.id) || [])
      .filter((definition) => compareNodeVersions(definition.version, previous.version) > 0)
      .sort((left, right) => compareNodeVersions(right.version, left.version))[0];
    if (!next) return fork;
    const result = upgradeProjectNodeFork(fork, previous, next, { allowBreaking });
    upgraded.push(Object.freeze({
      id: fork.id,
      nodeId: previous.id,
      from: previous.version,
      to: next.version,
      compatible: result.compatibility.compatible,
      migrations: Object.freeze([...(result.fork.upgradedFrom?.applied || [])]),
    }));
    return result.fork;
  });
  return { forks, upgraded };
}

function assertNodeRequirements(requirements, definitions, ownerId) {
  for (const requirement of requirements || []) {
    const match = definitions.some((definition) =>
      definition.id === requirement.id && satisfiesNodeVersion(definition.version, requirement.range)
    );
    if (!match && !requirement.optional) {
      throw new Error(`NODE_PACKAGE_NODE_DEPENDENCY_UNRESOLVED:${ownerId}:${requirement.id}:${requirement.range}`);
    }
  }
}

function assertDefinitionDependencies(definitions, available, ownerId) {
  for (const definition of definitions || []) {
    assertNodeRequirements(definition.dependencies || [], available, `${ownerId}:${definition.id}@${definition.version}`);
  }
}

function assertGroupReferences(groups, definitions, ownerId) {
  for (const group of groups || []) {
    for (const reference of groupNodeReferences(group)) {
      const match = definitions.some((definition) =>
        definition.id === reference.id && satisfiesNodeVersion(definition.version, reference.range)
      );
      if (!match) throw new Error(`NODE_PACKAGE_GROUP_NODE_UNRESOLVED:${ownerId}:${group.id}:${reference.id}:${reference.range}`);
    }
  }
}

function assertArtifactReferences(artifacts, definitions, ownerId) {
  for (const artifact of artifacts || []) {
    const id = String(artifact.implementation?.nodeType || "");
    const range = String(artifact.implementation?.nodeVersion || "*") || "*";
    if (!definitions.some((definition) => definition.id === id && satisfiesNodeVersion(definition.version, range))) {
      throw new Error(`NODE_PACKAGE_ARTIFACT_NODE_UNRESOLVED:${ownerId}:${artifact.id}:${id}:${range}`);
    }
  }
}

function runtimeDefinitionCandidates(nodePackage, registry) {
  const definitions = nodePackage.definitions || [];
  const ids = new Set([
    ...definitions.map((definition) => definition.id),
    ...definitions.flatMap((definition) => (definition.dependencies || []).map((dependency) => dependency.id)),
    ...(nodePackage.nodeDependencies || []).map((dependency) => dependency.id),
    ...(nodePackage.groups || []).flatMap((group) => groupNodeReferences(group).map((reference) => reference.id)),
    ...(nodePackage.artifacts || []).map((artifact) => artifact.implementation?.nodeType).filter(Boolean),
  ]);
  const candidates = [...definitions];
  for (const id of ids) candidates.push(...(registry.listVersions?.(id) || []));
  return candidates;
}

function selectProjectRecords(records, ids, missingCode) {
  const selectedIds = Array.isArray(ids) ? ids.map((id) => String(id || "")).filter(Boolean) : [];
  if (!selectedIds.length) return [];
  const byId = new Map((records || []).map((record) => [String(record.id || ""), record]));
  return selectedIds.map((id) => {
    const record = byId.get(id);
    if (!record) throw new Error(`${missingCode}:${id}`);
    return record;
  });
}

function normalizeDefinitionSelections(values) {
  return (values || []).map((value) => {
    if (value && typeof value === "object") return {
      id: requiredText(value.id || value.nodeId, "NODE_PACKAGE_PROJECT_DEFINITION_MISSING_ID"),
      version: String(value.version || value.nodeVersion || ""),
    };
    return { id: requiredText(value, "NODE_PACKAGE_PROJECT_DEFINITION_MISSING_ID"), version: "" };
  });
}

function uniqueDefinitionSelections(references) {
  const result = new Map();
  for (const reference of references) {
    const key = `${reference.id}@${reference.version || "latest"}`;
    if (!result.has(key)) result.set(key, reference);
  }
  return [...result.values()];
}

function projectDefinitionForReference(project, reference) {
  const pinned = project.pins.find((pin) => pin.nodeId === reference.id)?.version || "";
  const version = reference.version || pinned;
  const candidates = project.definitions.filter((definition) =>
    definition.id === reference.id && (!version || definition.version === version)
  );
  if (!candidates.length) {
    throw new Error(`NODE_PACKAGE_PROJECT_DEFINITION_MISSING:${reference.id}@${version || "latest"}`);
  }
  const selected = [...candidates].sort((left, right) => compareNodeVersions(right.version, left.version))[0];
  return defineNode(selected);
}

function groupNodeReferences(group) {
  const references = [];
  const visit = (nodes) => {
    for (const node of nodes || []) {
      const id = String(node.nodeId || "");
      const version = String(node.nodeVersion || "");
      if (id) references.push({ id, version, range: version || "*", optional: false });
      visit(node.nodes);
    }
  };
  visit(group?.nodes);
  return references;
}

function mergeNodeRequirements(declared, discovered, includedKeys) {
  const requirements = new Map();
  for (const value of [...declared, ...discovered]) {
    const requirement = normalizeNodeRequirement(value);
    const included = [...includedKeys].some((key) => {
      const split = key.lastIndexOf("@");
      return key.slice(0, split) === requirement.id && satisfiesNodeVersion(key.slice(split + 1), requirement.range);
    });
    if (included) continue;
    const current = requirements.get(requirement.id);
    if (current) {
      const range = intersectNodeRequirementRanges(current.range, requirement.range);
      if (!range) {
        throw new Error(`NODE_PACKAGE_NODE_DEPENDENCY_CONFLICT:${requirement.id}:${current.range}:${requirement.range}`);
      }
      requirements.set(requirement.id, Object.freeze({
        id: requirement.id,
        range,
        optional: current.optional && requirement.optional,
      }));
      continue;
    }
    requirements.set(requirement.id, requirement);
  }
  return [...requirements.values()];
}

function intersectNodeRequirementRanges(left, right) {
  if (left === right) return left;
  if (isExactVersionRange(left) && satisfiesNodeVersion(left, right)) return left;
  if (isExactVersionRange(right) && satisfiesNodeVersion(right, left)) return right;
  return "";
}

function isExactVersionRange(value) {
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(value || ""));
}

function mergeProjectRecords(existing, incoming, keyOf, replace) {
  const result = [...existing];
  const indexes = new Map(result.map((record, index) => [keyOf(record), index]));
  for (const record of incoming) {
    const key = keyOf(record);
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, result.length);
      result.push(jsonData(record));
    } else if (replace) {
      result[index] = jsonData(record);
    }
  }
  return result;
}

function assertProjectRecordConflicts(existing, incoming, keyOf, errorPrefix, replace) {
  if (replace) return;
  const byKey = new Map(existing.map((record) => [keyOf(record), record]));
  for (const record of incoming) {
    const key = keyOf(record);
    const previous = byKey.get(key);
    if (previous && !sameJson(previous, record)) throw new Error(`${errorPrefix}:${key}`);
  }
}

function artifactCatalogHas(catalog, id) {
  return !!artifactCatalogRecord(catalog, id);
}

function artifactCatalogRecord(catalog, id) {
  return catalog.list?.().find((artifact) => artifact.id === id) || null;
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hydrateImportedNodeDefinition(source, { bindings, processFactory } = {}) {
  let definition = defineNode({ ...source, moduleBindings: bindings, process: null });
  let process = typeof processFactory === "function" ? processFactory(definition) : null;
  const javascriptParts = definition.parts.filter((part) => part.kind === NODE_PART_KINDS.JAVASCRIPT);
  const compiledModule = javascriptParts.some((part) => part.entry === "process")
    ? compileJavaScriptNodeModule(javascriptParts, definition)
    : null;
  if (!process && compiledModule) {
    process = compiledModule.process;
  }
  if (!process && definition.implementation.kind === NODE_IMPLEMENTATION_KINDS.SHADER) {
    process = (inputs, context) => {
      if (typeof context.renderVisualNode !== "function") throw new Error(`VISUAL_NODE_RENDER_HOST_MISSING:${definition.id}`);
      return { texture: context.renderVisualNode({ definition, inputs, context }) };
    };
  }
  if (process) definition = defineNode({
    ...source,
    moduleBindings: bindings,
    moduleExports: compiledModule?.exports || {},
    process,
  });
  return attachSerializedCompiler(definition, source.compiler);
}

function attachSerializedCompiler(definition, source) {
  if (!source || typeof source !== "object") return definition;
  const compiler = Object.freeze({
    id: String(source.id || ""),
    target: String(source.target || ""),
    strategy: String(source.strategy || ""),
  });
  if (!compiler.id) throw new Error(`NODE_PACKAGE_COMPILER_MISSING_ID:${definition.id}`);
  return Object.freeze({ ...definition, compiler });
}

function serializePackageNodeDefinition(definition) {
  const serialized = serializeNodeDefinition(definition);
  return {
    ...serialized,
    migrations: (definition.migrations || []).map((migration) => {
      const source = String(migration.source || migration.migrate?.toString?.() || "").trim();
      return jsonData({
        ...migration,
        ...(source ? { source } : {}),
      });
    }),
  };
}

function hydrateImportedNodeMigration(migration = {}, definitionId = "") {
  if (typeof migration.migrate === "function") return migration;
  const source = String(migration.source || "").trim();
  if (!source) return migration;
  let migrate;
  try {
    migrate = Function(`"use strict"; return (${source}\n);`)();
  } catch (error) {
    throw new SyntaxError(`NODE_PACKAGE_MIGRATION_SOURCE_INVALID:${definitionId}:${migration.from || "missing"}:${error.message}`);
  }
  if (typeof migrate !== "function") {
    throw new TypeError(`NODE_PACKAGE_MIGRATION_SOURCE_INVALID:${definitionId}:${migration.from || "missing"}`);
  }
  return Object.freeze({ ...migration, migrate });
}

function comparePortCollections(role, previous = {}, next = {}, issues) {
  for (const [id, port] of Object.entries(previous || {})) {
    const replacement = next?.[id];
    if (!replacement) {
      issues.push(issue(`${role}-removed`, `${role}:${id}`, port.required === true || role !== "inlet"));
      continue;
    }
    const beforeType = port.type?.type || port.type;
    const afterType = replacement.type?.type || replacement.type;
    if (beforeType !== afterType) issues.push(issue(`${role}-type-changed`, `${role}:${id}`, true));
  }
}

function normalizePackageDependency(value) {
  const source = typeof value === "string" ? { id: value } : value || {};
  return Object.freeze({
    id: requiredText(source.id, "NODE_PACKAGE_DEPENDENCY_MISSING_ID"),
    range: String(source.range || source.version || "*"),
    optional: source.optional === true,
  });
}

function normalizePackageGroup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NODE_PACKAGE_GROUP_INVALID");
  const id = requiredText(value.id, "NODE_PACKAGE_GROUP_MISSING_ID");
  return Object.freeze(jsonData({
    ...value,
    id,
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    connections: Array.isArray(value.connections) ? value.connections : [],
  }));
}

function normalizePackageFork(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NODE_PACKAGE_FORK_INVALID");
  const id = requiredText(value.id, "NODE_PACKAGE_FORK_MISSING_ID");
  const baseId = requiredText(value.base?.id, `NODE_PACKAGE_FORK_BASE_MISSING:${id}`);
  const baseVersion = requiredText(value.base?.version, `NODE_PACKAGE_FORK_BASE_MISSING:${id}`);
  assertVersion(baseVersion, `NODE_PACKAGE_FORK_BASE_VERSION_INVALID:${id}`);
  return Object.freeze(jsonData({
    ...value,
    id,
    projectLocal: true,
    base: { id: baseId, version: baseVersion },
    definition: value.definition || {},
  }));
}

function normalizePackageResource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("NODE_PACKAGE_RESOURCE_INVALID");
  const id = requiredText(value.id, "NODE_PACKAGE_RESOURCE_MISSING_ID");
  const kind = String(value.kind || NODE_PACKAGE_RESOURCE_KINDS.OTHER);
  if (!Object.values(NODE_PACKAGE_RESOURCE_KINDS).includes(kind)) {
    throw new Error(`NODE_PACKAGE_RESOURCE_KIND_UNKNOWN:${id}:${kind}`);
  }
  const path = String(value.path || "").trim();
  const url = String(value.url || "").trim();
  if (!path && !url) throw new Error(`NODE_PACKAGE_RESOURCE_LOCATION_MISSING:${id}`);
  if (path && url) throw new Error(`NODE_PACKAGE_RESOURCE_LOCATION_AMBIGUOUS:${id}`);
  if (path && !isSafePackagePath(path)) throw new Error(`NODE_PACKAGE_RESOURCE_PATH_INVALID:${id}:${path}`);
  return Object.freeze({
    id,
    kind,
    path,
    url,
    mediaType: String(value.mediaType || ""),
    integrity: String(value.integrity || ""),
    metadata: Object.freeze(jsonData(value.metadata || {})),
  });
}

function assertVisualLibraryReferences(artifacts, resources, definitions, nodeDependencies, packageId) {
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const nodeIds = new Set([
    ...definitions.map((definition) => definition.id),
    ...nodeDependencies.map((dependency) => dependency.id),
  ]);
  for (const artifact of artifacts) {
    for (const resourceId of visualArtifactResourceIds(artifact)) {
      if (!resourceIds.has(resourceId)) {
        throw new Error(`NODE_PACKAGE_VISUAL_RESOURCE_UNRESOLVED:${packageId}:${artifact.id}:${resourceId}`);
      }
    }
    if (![VISUAL_IMPLEMENTATION_FORMATS.NODE, VISUAL_IMPLEMENTATION_FORMATS.COMPOUND]
      .includes(artifact.implementation.format)) continue;
    const nodeId = String(artifact.implementation.nodeId || artifact.implementation.nodeType || "");
    if (nodeId && !nodeIds.has(nodeId)) {
      throw new Error(`NODE_PACKAGE_VISUAL_NODE_UNRESOLVED:${packageId}:${artifact.id}:${nodeId}`);
    }
  }
}

function visualArtifactResourceIds(artifact) {
  const values = [
    artifact.implementation.resourceId,
    artifact.implementation.vertexResourceId,
    artifact.implementation.sourceResourceId,
    ...(Array.isArray(artifact.implementation.resourceIds) ? artifact.implementation.resourceIds : []),
    artifact.preview.resourceId,
  ];
  return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
}

function isSafePackagePath(value) {
  const path = String(value || "").replaceAll("\\", "/");
  return !path.startsWith("/")
    && !/^[A-Za-z]:\//.test(path)
    && !path.split("/").includes("..")
    && !path.includes("\0");
}

function normalizeNodeRequirement(value) {
  const source = typeof value === "string" ? { id: value } : value || {};
  return Object.freeze({
    id: requiredText(source.id || source.nodeId, "NODE_PACKAGE_NODE_DEPENDENCY_MISSING_ID"),
    range: String(source.range || source.version || source.nodeVersion || "*"),
    optional: source.optional === true,
  });
}

function assertUnique(values, keyOf, errorPrefix) {
  const keys = new Set();
  for (const value of values || []) {
    const key = String(keyOf(value) || "");
    if (keys.has(key)) throw new Error(`${errorPrefix}:${key}`);
    keys.add(key);
  }
}

function issue(code, path, breaking) {
  return Object.freeze({ code, path, breaking });
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || ""));
  if (!match) throw new Error(`NODE_VERSION_INVALID:${value || "missing"}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareParsed(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function assertVersion(value, error) {
  try { parseVersion(value); } catch { throw new Error(error); }
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function jsonData(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonData).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalized = jsonData(item);
    return normalized === undefined ? [] : [[key, normalized]];
  }));
}
