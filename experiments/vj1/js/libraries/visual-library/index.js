export const VISUAL_LIBRARY_FORMAT_VERSION = 1;

export const VISUAL_LIBRARY_LAYER_KINDS = Object.freeze({
  BUILT_IN: "built-in",
  INSTALLED: "installed",
  PROJECT: "project",
});

export const VISUAL_IMPLEMENTATION_FORMATS = Object.freeze({
  ISF: "isf",
  NODE: "node",
  MEDIA: "media",
  COMPOUND: "compound",
  NATIVE: "native",
});

export function defineVisualArtifact(value = {}) {
  const id = requiredText(value.id, "VISUAL_ARTIFACT_MISSING_ID");
  const version = normalizeVersion(value.version || "0.1.0", id);
  const implementation = normalizeImplementation(value.implementation, id);
  const origin = normalizeOrigin(value.origin);
  return Object.freeze({
    formatVersion: VISUAL_LIBRARY_FORMAT_VERSION,
    id,
    version,
    name: String(value.name || value.label || id),
    description: String(value.description || ""),
    artifactType: String(value.artifactType || value.kind || "node"),
    implementation,
    origin,
    capabilities: Object.freeze(uniqueStrings(value.capabilities)),
    categories: Object.freeze(uniqueStrings(value.categories)),
    tags: Object.freeze(uniqueStrings(value.tags)),
    replaces: Object.freeze(uniqueStrings(value.replaces)),
    ports: Object.freeze({
      inlets: freezeRecord(value.ports?.inlets || {}),
      outlets: freezeRecord(value.ports?.outlets || {}),
    }),
    attribution: freezeRecord(value.attribution || {}),
    preview: freezeRecord(value.preview || {}),
    presentation: freezeRecord(value.presentation || {}),
    metadata: freezeRecord(value.metadata || {}),
  });
}

export function defineVisualLibraryLayer({
  id,
  kind = VISUAL_LIBRARY_LAYER_KINDS.INSTALLED,
  priority = defaultLayerPriority(kind),
  artifacts = [],
  metadata = {},
} = {}) {
  const layerId = requiredText(id, "VISUAL_LIBRARY_LAYER_MISSING_ID");
  const layerKind = Object.values(VISUAL_LIBRARY_LAYER_KINDS).includes(kind)
    ? kind
    : VISUAL_LIBRARY_LAYER_KINDS.INSTALLED;
  const normalized = artifacts.map((artifact) => defineVisualArtifact({
    ...artifact,
    origin: {
      ...artifact.origin,
      kind: layerKind,
      id: layerId,
    },
  }));
  assertUnique(normalized, (artifact) => artifact.id, `VISUAL_LIBRARY_ARTIFACT_DUPLICATE:${layerId}`);
  return Object.freeze({
    formatVersion: VISUAL_LIBRARY_FORMAT_VERSION,
    id: layerId,
    kind: layerKind,
    priority: finiteNumber(priority, defaultLayerPriority(layerKind)),
    artifacts: Object.freeze(normalized),
    metadata: freezeRecord(metadata),
  });
}

export class ResolvedVisualLibrary {
  constructor(layers = []) {
    this.layers = Object.freeze([...layers]
      .map((layer) => layer?.formatVersion === VISUAL_LIBRARY_FORMAT_VERSION
        ? layer
        : defineVisualLibraryLayer(layer))
      .sort((left, right) => left.priority - right.priority));
    this.artifacts = new Map();
    this.diagnostics = [];
    for (const layer of this.layers) {
      for (const artifact of layer.artifacts) this.resolveArtifact(artifact, layer);
    }
    this.diagnostics = Object.freeze(this.diagnostics);
  }

  resolveArtifact(candidate, layer) {
    const current = this.artifacts.get(candidate.id);
    if (!current) {
      this.artifacts.set(candidate.id, candidate);
      return;
    }
    if (sameOrigin(current, candidate) && compareVersions(candidate.version, current.version) > 0) {
      this.artifacts.set(candidate.id, candidate);
      this.diagnostics.push(diagnostic("version-upgrade", candidate, current, layer));
      return;
    }
    if (declaresReplacement(candidate, current)) {
      this.artifacts.set(candidate.id, candidate);
      this.diagnostics.push(diagnostic("explicit-override", candidate, current, layer));
      return;
    }
    this.diagnostics.push(diagnostic("id-collision", candidate, current, layer));
  }

  get(id) {
    const artifact = this.artifacts.get(String(id || ""));
    if (!artifact) throw new Error(`VISUAL_ARTIFACT_UNKNOWN:${String(id || "")}`);
    return artifact;
  }

  has(id) {
    return this.artifacts.has(String(id || ""));
  }

  list({
    artifactType = "",
    capability = "",
    category = "",
    tag = "",
    implementation = "",
    origin = "",
  } = {}) {
    return [...this.artifacts.values()].filter((artifact) =>
      (!artifactType || artifact.artifactType === artifactType)
      && (!capability || artifact.capabilities.includes(capability))
      && (!category || artifact.categories.includes(category))
      && (!tag || artifact.tags.includes(tag))
      && (!implementation || artifact.implementation.format === implementation)
      && (!origin || artifact.origin.id === origin)
    );
  }
}

export function resolveVisualLibrary(layers = []) {
  return new ResolvedVisualLibrary(layers);
}

function declaresReplacement(candidate, current) {
  return candidate.replaces.includes(current.id)
    || candidate.replaces.includes(`${current.id}@${current.version}`);
}

function sameOrigin(left, right) {
  return left.origin.kind === right.origin.kind && left.origin.id === right.origin.id;
}

function diagnostic(code, candidate, current, layer) {
  return Object.freeze({
    code,
    id: candidate.id,
    candidate: Object.freeze({
      version: candidate.version,
      origin: candidate.origin,
    }),
    current: Object.freeze({
      version: current.version,
      origin: current.origin,
    }),
    layerId: layer.id,
  });
}

function normalizeImplementation(value, id) {
  const source = value && typeof value === "object" ? value : {};
  const format = String(source.format || "");
  if (!Object.values(VISUAL_IMPLEMENTATION_FORMATS).includes(format)) {
    throw new Error(`VISUAL_ARTIFACT_IMPLEMENTATION_UNKNOWN:${id}:${format || "missing"}`);
  }
  return freezeRecord({ ...source, format });
}

function normalizeOrigin(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const kind = Object.values(VISUAL_LIBRARY_LAYER_KINDS).includes(source.kind)
    ? source.kind
    : VISUAL_LIBRARY_LAYER_KINDS.PROJECT;
  return Object.freeze({
    kind,
    id: String(source.id || kind),
    path: String(source.path || ""),
    url: String(source.url || ""),
  });
}

function defaultLayerPriority(kind) {
  if (kind === VISUAL_LIBRARY_LAYER_KINDS.BUILT_IN) return 0;
  if (kind === VISUAL_LIBRARY_LAYER_KINDS.INSTALLED) return 100;
  return 200;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return String(left).localeCompare(String(right));
}

function versionParts(value) {
  return String(value || "").split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
}

function normalizeVersion(value, id) {
  const version = String(value || "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`VISUAL_ARTIFACT_VERSION_INVALID:${id}:${version}`);
  }
  return version;
}

function freezeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze({ ...value });
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function assertUnique(items, keyOf, error) {
  const keys = new Set();
  for (const item of items) {
    const key = keyOf(item);
    if (keys.has(key)) throw new Error(`${error}:${key}`);
    keys.add(key);
  }
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
