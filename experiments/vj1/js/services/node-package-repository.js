import {
  defineNodePackage,
  importNodePackage,
  nodePackageContentIntegrity,
  resolveProjectNodePackages,
  serializeNodePackage,
} from "../libraries/node-engine/node-package.js";
import { createIsfNodeDefinition } from "../libraries/isf-engine/index.js";

export const NODE_PACKAGE_LIBRARY_ROOT = "libraries";
export const NODE_PACKAGE_MANIFEST_NAME = "node-package.json";

export async function loadReferencedNodePackages(directory, references = []) {
  const enabled = (references || []).filter((reference) => reference?.enabled !== false);
  if (!enabled.length) return Object.freeze([]);
  return resolveReferencedNodePackages(references, await loadNodePackageRepository(directory));
}

export async function loadNodePackageRepository(directory) {
  const manifests = await collectNodePackageManifests(directory);
  const packages = [];
  const keys = new Set();
  for (const entry of manifests) {
    let nodePackage;
    try {
      const manifestPackage = importNodePackage(JSON.parse(await (await entry.handle.getFile()).text()));
      nodePackage = await attachRepositoryContentIntegrity(manifestPackage, entry.directory, entry.path);
      nodePackage = await hydrateFileBackedIsfDefinitions(nodePackage, entry.directory, entry.path);
    } catch (error) {
      throw new Error(`NODE_PACKAGE_MANIFEST_INVALID:${entry.path}:${error.message || error}`);
    }
    const key = `${nodePackage.id}@${nodePackage.version}`;
    if (keys.has(key)) throw new Error(`NODE_PACKAGE_REPOSITORY_DUPLICATE:${key}`);
    keys.add(key);
    packages.push(nodePackage);
  }
  return Object.freeze(packages.sort((left, right) =>
    left.id.localeCompare(right.id) || compareVersions(right.version, left.version)));
}

export function resolveReferencedNodePackages(references = [], availablePackages = [], packageLock = []) {
  const enabled = (references || []).filter((reference) => reference?.enabled !== false);
  if (!enabled.length) return Object.freeze([]);
  const lock = normalizePackageLock(packageLock);
  const lockedAvailable = lock.length
    ? availablePackages.filter((nodePackage) => lock.some((item) =>
      item.id === nodePackage.id && item.version === nodePackage.version))
    : availablePackages;
  const byKey = new Map(lockedAvailable.map((nodePackage) => [
    `${nodePackage.id}@${nodePackage.version}`,
    nodePackage,
  ]));
  for (const reference of enabled) {
    const key = `${reference.id}@${reference.version}`;
    if (!byKey.has(key)) throw new Error(`NODE_PROJECT_PACKAGE_UNAVAILABLE:${key}`);
  }
  const resolved = resolveProjectNodePackages({ packages: enabled }, lockedAvailable);
  if (lock.length) assertNodePackageLock(resolved, lock);
  return resolved;
}

export function createNodePackageLock(packages = []) {
  return Object.freeze((packages || []).map((nodePackage) => {
    const integrity = nodePackageContentIntegrity(nodePackage);
    if (!integrity) {
      throw new Error(`NODE_PACKAGE_CONTENT_INTEGRITY_MISSING:${nodePackage?.id || "missing"}@${nodePackage?.version || "missing"}`);
    }
    return Object.freeze({
      id: nodePackage.id,
      version: nodePackage.version,
      integrity,
    });
  }).sort((left, right) =>
    left.id.localeCompare(right.id) || left.version.localeCompare(right.version)));
}

export function assertNodePackageLock(packages = [], packageLock = []) {
  const lock = new Map(normalizePackageLock(packageLock)
    .map((item) => [`${item.id}@${item.version}`, item.integrity]));
  for (const nodePackage of packages || []) {
    const key = `${nodePackage.id}@${nodePackage.version}`;
    const expected = lock.get(key);
    if (!expected) throw new Error(`NODE_PACKAGE_LOCK_ENTRY_MISSING:${key}`);
    const actual = nodePackageContentIntegrity(nodePackage);
    if (!actual || actual !== expected) {
      throw new Error(`NODE_PACKAGE_CONTENT_INTEGRITY_MISMATCH:${key}`);
    }
  }
  return true;
}

export function assertNodePackageUpdateSafe(projectState = {}, previousPackage, nextPackages = []) {
  if (!previousPackage) return true;
  const nextDefinitionKeys = new Set(nextPackages.flatMap((nodePackage) =>
    (nodePackage.definitions || []).map((definition) => `${definition.id}@${definition.version}`)));
  const referencedNodeKeys = collectExactNodeReferences(projectState.nodes || {});
  const missingNodes = (previousPackage.definitions || [])
    .map((definition) => `${definition.id}@${definition.version}`)
    .filter((key) => referencedNodeKeys.has(key) && !nextDefinitionKeys.has(key));
  if (missingNodes.length) {
    throw new Error(`NODE_PACKAGE_UPDATE_REQUIRES_NODE_MIGRATION:${previousPackage.id}:${missingNodes.join(",")}`);
  }

  const nextVisualIds = new Set(nextPackages.flatMap((nodePackage) =>
    (nodePackage.visualLibrary || []).map((artifact) => artifact.id)));
  const visualState = {
    components: projectState.components || [],
    mappings: projectState.mappings || [],
  };
  const missingVisuals = (previousPackage.visualLibrary || [])
    .map((artifact) => artifact.id)
    .filter((id) => !nextVisualIds.has(id) && containsExactString(visualState, id));
  if (missingVisuals.length) {
    throw new Error(`NODE_PACKAGE_UPDATE_REQUIRES_VISUAL_MIGRATION:${previousPackage.id}:${missingVisuals.join(",")}`);
  }
  return true;
}

export async function writeNodePackageManifest(directory, encodedPackage) {
  const nodePackage = importNodePackage(encodedPackage);
  const root = await directory.getDirectoryHandle(NODE_PACKAGE_LIBRARY_ROOT, { create: true });
  const packageDirectory = await root.getDirectoryHandle(nodePackage.id, { create: true });
  const versionDirectory = await packageDirectory.getDirectoryHandle(nodePackage.version, { create: true });
  if (await repositoryFileExists(versionDirectory, NODE_PACKAGE_MANIFEST_NAME)) {
    throw new Error(`NODE_PACKAGE_MANIFEST_ALREADY_EXISTS:${nodePackage.id}@${nodePackage.version}`);
  }
  const handle = await versionDirectory.getFileHandle(NODE_PACKAGE_MANIFEST_NAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(serializeNodePackage(nodePackage), null, 2));
  await writable.close();
  return `${NODE_PACKAGE_LIBRARY_ROOT}/${nodePackage.id}/${nodePackage.version}/${NODE_PACKAGE_MANIFEST_NAME}`;
}

export async function inspectNodePackageDirectory(directory) {
  let manifestFile;
  try {
    manifestFile = await (await directory.getFileHandle(NODE_PACKAGE_MANIFEST_NAME)).getFile();
  } catch (error) {
    throw new Error(`NODE_PACKAGE_IMPORT_MANIFEST_UNAVAILABLE:${error?.message || error}`);
  }
  let manifestPackage;
  try {
    manifestPackage = importNodePackage(JSON.parse(await manifestFile.text()));
  } catch (error) {
    throw new Error(`NODE_PACKAGE_IMPORT_MANIFEST_INVALID:${error?.message || error}`);
  }
  assertRepositorySegment(manifestPackage.id, "NODE_PACKAGE_IMPORT_ID_INVALID");
  assertRepositorySegment(manifestPackage.version, "NODE_PACKAGE_IMPORT_VERSION_INVALID");
  assertImportResourcePaths(manifestPackage.resources);

  const resources = [];
  for (const resource of manifestPackage.resources) {
    if (resource.url) {
      throw new Error(`NODE_PACKAGE_IMPORT_EXTERNAL_RESOURCE_UNSUPPORTED:${resource.id}:${resource.url}`);
    }
    const file = await resourceFile(directory, resource.path, NODE_PACKAGE_MANIFEST_NAME);
    await verifyResourceIntegrity(file, resource, NODE_PACKAGE_MANIFEST_NAME);
    resources.push(Object.freeze({ resource, file }));
  }
  // Hydration compiles portable ISF now, before any destination directory is
  // touched. A malformed visual therefore cannot become discoverable later.
  const nodePackage = await hydrateFileBackedIsfDefinitions(
    manifestPackage,
    directory,
    NODE_PACKAGE_MANIFEST_NAME,
  );
  return Object.freeze({
    nodePackage,
    manifestPackage,
    resources: Object.freeze(resources),
  });
}

export async function importNodePackageDirectory(projectDirectory, sourceDirectory) {
  // Keep the complete source package in memory/handle leases while validating
  // it. The repository manifest is published last, making partial resource
  // writes invisible to discovery if a filesystem write fails.
  const inspected = await inspectNodePackageDirectory(sourceDirectory);
  const root = await projectDirectory.getDirectoryHandle(NODE_PACKAGE_LIBRARY_ROOT, { create: true });
  const published = await publishInspectedNodePackage(root, inspected, "IMPORT");
  return Object.freeze({
    id: published.id,
    version: published.version,
    path: `${NODE_PACKAGE_LIBRARY_ROOT}/${published.path}`,
  });
}

export async function exportNodePackageDirectory(
  projectDirectory,
  destinationDirectory,
  packageId,
  version,
) {
  assertRepositorySegment(packageId, "NODE_PACKAGE_EXPORT_ID_INVALID");
  assertRepositorySegment(version, "NODE_PACKAGE_EXPORT_VERSION_INVALID");
  let sourceDirectory;
  try {
    const root = await projectDirectory.getDirectoryHandle(NODE_PACKAGE_LIBRARY_ROOT);
    const packageDirectory = await root.getDirectoryHandle(packageId);
    sourceDirectory = await packageDirectory.getDirectoryHandle(version);
  } catch (error) {
    throw new Error(`NODE_PACKAGE_EXPORT_SOURCE_UNAVAILABLE:${packageId}@${version}:${error?.message || error}`);
  }
  const inspected = await inspectNodePackageDirectory(sourceDirectory);
  if (inspected.manifestPackage.id !== packageId || inspected.manifestPackage.version !== version) {
    throw new Error(
      `NODE_PACKAGE_EXPORT_SOURCE_IDENTITY_MISMATCH:${packageId}@${version}:`
      + `${inspected.manifestPackage.id}@${inspected.manifestPackage.version}`,
    );
  }
  return publishInspectedNodePackage(destinationDirectory, inspected, "EXPORT");
}

async function publishInspectedNodePackage(root, inspected, operation) {
  const { manifestPackage, resources } = inspected;
  const packageDirectory = await root.getDirectoryHandle(manifestPackage.id, { create: true });
  let versionDirectory;
  try {
    versionDirectory = await packageDirectory.getDirectoryHandle(manifestPackage.version);
    if (await repositoryFileExists(versionDirectory, NODE_PACKAGE_MANIFEST_NAME)) {
      throw new Error(`NODE_PACKAGE_${operation}_ALREADY_EXISTS:${manifestPackage.id}@${manifestPackage.version}`);
    }
    if (typeof packageDirectory.removeEntry !== "function") {
      throw new Error(`NODE_PACKAGE_${operation}_INCOMPLETE_TARGET:${manifestPackage.id}@${manifestPackage.version}`);
    }
    await packageDirectory.removeEntry(manifestPackage.version, { recursive: true });
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
  versionDirectory = await packageDirectory.getDirectoryHandle(manifestPackage.version, { create: true });
  try {
    for (const { resource, file } of resources) {
      await writeRepositoryFile(versionDirectory, resource.path, file);
    }
    const manifestHandle = await versionDirectory.getFileHandle(NODE_PACKAGE_MANIFEST_NAME, { create: true });
    const writable = await manifestHandle.createWritable();
    await writable.write(JSON.stringify(serializeNodePackage(manifestPackage), null, 2));
    await writable.close();
  } catch (error) {
    if (typeof packageDirectory.removeEntry === "function") {
      try {
        await packageDirectory.removeEntry(manifestPackage.version, { recursive: true });
      } catch {}
    }
    throw new Error(`NODE_PACKAGE_${operation}_FAILED:${manifestPackage.id}@${manifestPackage.version}:${error?.message || error}`);
  }
  return Object.freeze({
    id: manifestPackage.id,
    version: manifestPackage.version,
    path: `${manifestPackage.id}/${manifestPackage.version}/${NODE_PACKAGE_MANIFEST_NAME}`,
  });
}

export async function collectNodePackageManifests(directory) {
  let root;
  try {
    root = await directory.getDirectoryHandle(NODE_PACKAGE_LIBRARY_ROOT);
  } catch (error) {
    if (error?.name === "NotFoundError") return [];
    throw error;
  }
  const result = [];
  await collectManifestDirectory(root, NODE_PACKAGE_LIBRARY_ROOT, result);
  return result;
}

async function collectManifestDirectory(directory, path, result) {
  for await (const [name, handle] of directory.entries()) {
    const childPath = `${path}/${name}`;
    if (handle.kind === "directory") {
      await collectManifestDirectory(handle, childPath, result);
    } else if (name === NODE_PACKAGE_MANIFEST_NAME) {
      result.push({ handle, directory, path: childPath });
    }
  }
}

async function hydrateFileBackedIsfDefinitions(nodePackage, directory, manifestPath) {
  const definitions = [...nodePackage.definitions];
  const definitionKeys = new Set(definitions.map((definition) => `${definition.id}@${definition.version}`));
  const resources = new Map(nodePackage.resources.map((resource) => [resource.id, resource]));
  const visualLibrary = [];
  for (const artifact of nodePackage.visualLibrary) {
    const resourceId = String(artifact.implementation?.resourceId || "");
    const resource = resources.get(resourceId);
    if (!resource) {
      visualLibrary.push(artifact);
      continue;
    }
    const file = await resourceFile(directory, resource.path, manifestPath);
    await verifyResourceIntegrity(file, resource, manifestPath);
    if (artifact.implementation.format !== "isf") {
      visualLibrary.push(artifact);
      continue;
    }
    const source = await file.text();
    const vertexResourceId = String(
      artifact.implementation?.vertexResourceId || "",
    );
    const vertexResource = vertexResourceId
      ? resources.get(vertexResourceId)
      : null;
    if (vertexResourceId && !vertexResource) {
      throw new Error(
        `NODE_PACKAGE_VISUAL_VERTEX_RESOURCE_MISSING:${artifact.id}:${vertexResourceId}`,
      );
    }
    const vertexFile = vertexResource
      ? await resourceFile(directory, vertexResource.path, manifestPath)
      : null;
    if (vertexFile) {
      await verifyResourceIntegrity(
        vertexFile,
        vertexResource,
        manifestPath,
      );
    }
    const definition = createIsfNodeDefinition({
      path: `${manifestPath.slice(0, -NODE_PACKAGE_MANIFEST_NAME.length)}${resource.path}`,
      source,
      vertexPath: vertexResource
        ? `${manifestPath.slice(0, -NODE_PACKAGE_MANIFEST_NAME.length)}${vertexResource.path}`
        : "",
      vertexSource: vertexFile ? await vertexFile.text() : "",
    });
    const kind = String(definition.metadata?.isf?.kind || "");
    if (kind !== artifact.artifactType) {
      throw new Error(`NODE_PACKAGE_VISUAL_KIND_MISMATCH:${artifact.id}:${artifact.artifactType}:${kind}`);
    }
    const declaredId = String(definition.metadata?.visualId || definition.id);
    if (declaredId !== artifact.id) {
      throw new Error(`NODE_PACKAGE_VISUAL_ID_MISMATCH:${artifact.id}:${declaredId}`);
    }
    const key = `${definition.id}@${definition.version}`;
    if (!definitionKeys.has(key)) {
      definitions.push(definition);
      definitionKeys.add(key);
    }
    visualLibrary.push({
      ...artifact,
      implementation: {
        ...artifact.implementation,
        nodeId: definition.id,
        nodeVersion: definition.version,
        visualId: declaredId,
      },
    });
  }
  return defineNodePackage({
    ...nodePackage,
    definitions,
    visualLibrary,
  });
}

async function attachRepositoryContentIntegrity(nodePackage, directory, manifestPath) {
  const resourceDigests = [];
  for (const resource of nodePackage.resources) {
    if (resource.url) {
      throw new Error(`NODE_PACKAGE_REPOSITORY_EXTERNAL_RESOURCE_UNSUPPORTED:${manifestPath}:${resource.id}`);
    }
    const file = await resourceFile(directory, resource.path, manifestPath);
    await verifyResourceIntegrity(file, resource, manifestPath);
    resourceDigests.push({
      id: resource.id,
      integrity: await sha256Integrity(await file.arrayBuffer(), resource.id),
    });
  }
  const serialized = serializeNodePackage(nodePackage);
  const metadata = { ...(serialized.metadata || {}) };
  delete metadata.repositoryContentIntegrity;
  serialized.metadata = metadata;
  const content = stableJson({
    manifest: serialized,
    resources: resourceDigests.sort((left, right) => left.id.localeCompare(right.id)),
  });
  const repositoryContentIntegrity = await sha256Integrity(
    new TextEncoder().encode(content),
    `${nodePackage.id}@${nodePackage.version}`,
  );
  return defineNodePackage({
    ...nodePackage,
    metadata: {
      ...metadata,
      repositoryContentIntegrity,
    },
  });
}

async function resourceFile(directory, path, manifestPath) {
  const parts = String(path || "").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`NODE_PACKAGE_RESOURCE_PATH_INVALID:${manifestPath}:${path || "missing"}`);
  }
  let current = directory;
  try {
    for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part);
    const handle = await current.getFileHandle(parts.at(-1));
    return await handle.getFile();
  } catch (error) {
    throw new Error(`NODE_PACKAGE_RESOURCE_UNAVAILABLE:${manifestPath}:${path}:${error.message || error}`);
  }
}

async function verifyResourceIntegrity(file, resource, manifestPath) {
  const integrity = String(resource.integrity || "");
  if (!integrity) return;
  const match = /^sha256-([0-9a-f]{64})$/i.exec(integrity);
  if (!match) throw new Error(`NODE_PACKAGE_RESOURCE_INTEGRITY_INVALID:${manifestPath}:${resource.id}`);
  const actual = await sha256Integrity(await file.arrayBuffer(), resource.id);
  if (actual !== `sha256-${match[1].toLowerCase()}`) {
    throw new Error(`NODE_PACKAGE_RESOURCE_INTEGRITY_MISMATCH:${manifestPath}:${resource.id}`);
  }
}

async function sha256Integrity(value, identity) {
  if (!globalThis.crypto?.subtle) throw new Error(`NODE_PACKAGE_RESOURCE_INTEGRITY_UNAVAILABLE:${identity}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

function normalizePackageLock(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: String(item?.id || ""),
    version: String(item?.version || ""),
    integrity: String(item?.integrity || "").toLowerCase(),
  })).filter((item) =>
    item.id && item.version && /^sha256-[0-9a-f]{64}$/.test(item.integrity));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareVersions(left, right) {
  const parse = (value) => String(value || "").split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return String(left).localeCompare(String(right));
}

function collectExactNodeReferences(value, result = new Set(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (!Array.isArray(value)) {
    const id = String(value.nodeId || value.base?.id || "");
    const version = String(value.nodeVersion || value.base?.version || "");
    if (id && version) result.add(`${id}@${version}`);
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectExactNodeReferences(child, result, seen);
  }
  return result;
}

function containsExactString(value, target, seen = new Set()) {
  if (value === target) return true;
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return (Array.isArray(value) ? value : Object.values(value))
    .some((child) => containsExactString(child, target, seen));
}

async function repositoryFileExists(directory, filename) {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") return false;
    throw error;
  }
}

function assertRepositorySegment(value, errorCode) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(String(value || ""))) {
    throw new Error(`${errorCode}:${value || "missing"}`);
  }
}

function assertImportResourcePaths(resources = []) {
  const paths = resources.map((resource) => String(resource.path || ""));
  const normalized = new Set();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (!path || key === NODE_PACKAGE_MANIFEST_NAME || normalized.has(key)) {
      throw new Error(`NODE_PACKAGE_IMPORT_RESOURCE_PATH_CONFLICT:${path || "missing"}`);
    }
    normalized.add(key);
  }
  for (const path of normalized) {
    for (const other of normalized) {
      if (path !== other && other.startsWith(`${path}/`)) {
        throw new Error(`NODE_PACKAGE_IMPORT_RESOURCE_PATH_CONFLICT:${path}:${other}`);
      }
    }
  }
}

async function writeRepositoryFile(directory, path, file) {
  const parts = String(path || "").split("/").filter(Boolean);
  let current = directory;
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  const handle = await current.getFileHandle(parts.at(-1), { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
}
