import {
  createIsfNodeDefinition,
  materializeIsfTransitionDefinition,
  materializeIsfNodeDefinition,
} from "../isf-engine/isf-node.js";

const BUILT_IN_MANIFEST_URL = new URL(
  "../../../visual-library/visual-library.json",
  import.meta.url,
);
const BUILT_IN_RESOURCE_REVISION = "isf-compatible-library-2";

export async function loadBuiltInIsfRepository({
  manifestUrl = BUILT_IN_MANIFEST_URL,
  readText = readBuiltInResourceText,
} = {}) {
  const manifest = JSON.parse(await readText(versionedResourceUrl(manifestUrl)));
  if (Number(manifest?.formatVersion) !== 1) {
    throw new Error(
      `BUILT_IN_VISUAL_LIBRARY_VERSION_UNSUPPORTED:${manifest?.formatVersion ?? "missing"}`,
    );
  }
  const libraryId = requiredText(
    manifest.id,
    "BUILT_IN_VISUAL_LIBRARY_ID_MISSING",
  );
  const importedResources = normalizeImportedResourceManifest(
    manifest.resources,
  );
  const records = [];
  const ids = new Set();
  const visualIds = new Set();
  const resources = new Set();
  const artifacts = manifest.artifacts || [];
  const sources = await mapWithConcurrency(artifacts, 12, async (artifact) => {
    const resource = requiredText(
      artifact?.resource,
      `BUILT_IN_VISUAL_ARTIFACT_RESOURCE_MISSING:${artifact?.id || "unknown"}`,
    );
    return readText(versionedResourceUrl(new URL(resource, manifestUrl)));
  });
  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const id = requiredText(
      artifact?.id,
      "BUILT_IN_VISUAL_ARTIFACT_ID_MISSING",
    );
    const visualId = requiredText(
      artifact?.visualId,
      `BUILT_IN_VISUAL_ARTIFACT_VISUAL_ID_MISSING:${id}`,
    );
    const version = requiredText(
      artifact?.version,
      `BUILT_IN_VISUAL_ARTIFACT_VERSION_MISSING:${id}`,
    );
    const nodeId = requiredText(
      artifact?.nodeId || id,
      `BUILT_IN_VISUAL_ARTIFACT_NODE_ID_MISSING:${id}`,
    );
    const nodeVersion = requiredText(
      artifact?.nodeVersion || version,
      `BUILT_IN_VISUAL_ARTIFACT_NODE_VERSION_MISSING:${id}`,
    );
    const resource = requiredText(
      artifact?.resource,
      `BUILT_IN_VISUAL_ARTIFACT_RESOURCE_MISSING:${id}`,
    );
    if (ids.has(id)) throw new Error(`BUILT_IN_VISUAL_ARTIFACT_DUPLICATE:${id}`);
    if (visualIds.has(visualId)) {
      throw new Error(`BUILT_IN_VISUAL_ID_DUPLICATE:${visualId}`);
    }
    if (resources.has(resource)) {
      throw new Error(`BUILT_IN_VISUAL_RESOURCE_DUPLICATE:${resource}`);
    }
    ids.add(id);
    visualIds.add(visualId);
    resources.add(resource);
    const source = sources[artifactIndex];
    const definition = createIsfNodeDefinition({
      path: resource,
      source,
      origin: "built-in",
    });
    const resolvedImportedResources = resolveImportedResources(
      definition.metadata?.isf,
      artifact?.importedResources,
      importedResources,
      id,
    );
    if (definition.id !== nodeId) {
      throw new Error(
        `BUILT_IN_VISUAL_NODE_ID_MISMATCH:${nodeId}:${definition.id}`,
      );
    }
    if (definition.metadata?.visualId !== visualId) {
      throw new Error(
        `BUILT_IN_VISUAL_ID_MISMATCH:${visualId}:${definition.metadata?.visualId || "missing"}`,
      );
    }
    if (definition.version !== nodeVersion) {
      throw new Error(
        `BUILT_IN_VISUAL_NODE_VERSION_MISMATCH:${nodeId}:${nodeVersion}:${definition.version}`,
      );
    }
    const transition = artifact.artifactType === "transition"
      ? Object.freeze({
        ...materializeIsfTransitionDefinition(definition),
        name: String(artifact.name || definition.name),
        description: String(
          artifact.description || definition.description || "",
        ),
        definition,
        resource,
        isfImportedResources: resolvedImportedResources,
        origin: Object.freeze({ kind: "built-in", id: libraryId }),
      })
      : null;
    const materializedComponent = transition
      ? null
      : materializeIsfNodeDefinition(definition);
    const component = materializedComponent
      ? Object.freeze({
        ...materializedComponent,
        name: String(artifact.name || materializedComponent.name),
        label: String(artifact.name || materializedComponent.label),
        description: String(
          artifact.description || materializedComponent.description || "",
        ),
        isfImportedResources: resolvedImportedResources,
      })
      : null;
    const materializedKind = transition ? "transition" : component.kind;
    if (materializedKind !== artifact.artifactType) {
      throw new Error(
        `BUILT_IN_VISUAL_KIND_MISMATCH:${id}:${artifact.artifactType}:${materializedKind}`,
      );
    }
    if (transition && (transition.id !== id || transition.version !== version)) {
      throw new Error(
        `BUILT_IN_VISUAL_TRANSITION_IDENTITY_MISMATCH:${id}@${version}:${transition.id}@${transition.version}`,
      );
    }
    records.push(Object.freeze({
      ...artifact,
      id,
      version,
      nodeId,
      nodeVersion,
      visualId,
      resource,
      definition,
      component,
      transition,
    }));
  }
  return Object.freeze({
    formatVersion: 1,
    id: libraryId,
    version: String(manifest.version || "1.0.0"),
    manifestUrl: String(manifestUrl),
    resources: importedResources,
    records: Object.freeze(records),
    components: Object.freeze(
      records.map((record) => record.component).filter(Boolean),
    ),
    transitions: Object.freeze(
      records.map((record) => record.transition).filter(Boolean),
    ),
  });
}

export const BuiltInIsfRepository = await loadBuiltInIsfRepository();

async function readBuiltInResourceText(url) {
  if (url.protocol === "file:") {
    const { readFile } = await import("node:fs/promises");
    const fileUrl = new URL(url);
    fileUrl.search = "";
    return readFile(fileUrl, "utf8");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `BUILT_IN_VISUAL_RESOURCE_FETCH_FAILED:${response.status}:${url.pathname}`,
    );
  }
  return response.text();
}

function versionedResourceUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(String(value));
  url.searchParams.set("v", BUILT_IN_RESOURCE_REVISION);
  return url;
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

async function mapWithConcurrency(values, concurrency, visit) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await visit(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function normalizeImportedResourceManifest(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BUILT_IN_VISUAL_RESOURCES_INVALID");
  }
  const normalized = {};
  for (const [id, descriptor] of Object.entries(value)) {
    const resourceId = requiredText(
      id,
      "BUILT_IN_VISUAL_RESOURCE_ID_MISSING",
    );
    const mediaType = requiredText(
      descriptor?.mediaType,
      `BUILT_IN_VISUAL_RESOURCE_MEDIA_TYPE_MISSING:${resourceId}`,
    );
    const encoding = String(descriptor?.encoding || "");
    const data = String(descriptor?.data || "");
    if (
      encoding !== "base64" ||
      !data ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new Error(
        `BUILT_IN_VISUAL_RESOURCE_DATA_INVALID:${resourceId}`,
      );
    }
    normalized[resourceId] = Object.freeze({
      id: resourceId,
      mediaType,
      encoding,
      data,
      url: `data:${mediaType};base64,${data}`,
      sha256: String(descriptor?.sha256 || ""),
    });
  }
  return Object.freeze(normalized);
}

function resolveImportedResources(
  isf = {},
  value,
  resources,
  artifactId,
) {
  const required = isf?.imported || [];
  const mappings = value === undefined ? {} : value;
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    throw new Error(
      `BUILT_IN_VISUAL_IMPORTED_RESOURCES_INVALID:${artifactId}`,
    );
  }
  const requiredPaths = new Set(required.map((entry) => entry.path));
  for (const path of Object.keys(mappings)) {
    if (!requiredPaths.has(path)) {
      throw new Error(
        `BUILT_IN_VISUAL_IMPORTED_RESOURCE_UNUSED:${artifactId}:${path}`,
      );
    }
  }
  const resolved = {};
  for (const imported of required) {
    const resourceId = requiredText(
      mappings[imported.path],
      `BUILT_IN_VISUAL_IMPORTED_RESOURCE_MISSING:${artifactId}:${imported.path}`,
    );
    const descriptor = resources[resourceId];
    if (!descriptor) {
      throw new Error(
        `BUILT_IN_VISUAL_IMPORTED_RESOURCE_UNKNOWN:${artifactId}:${resourceId}`,
      );
    }
    resolved[imported.name] = descriptor;
  }
  return Object.freeze(resolved);
}
