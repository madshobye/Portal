export function defineNodeArtifact(definition = {}) {
  const id = requiredText(definition.id, "NODE_ARTIFACT_MISSING_ID");
  const artifactType = requiredText(definition.artifactType, `NODE_ARTIFACT_MISSING_TYPE:${id}`);
  const nodeType = requiredText(definition.implementation?.nodeType, `NODE_ARTIFACT_MISSING_NODE:${id}`);
  return Object.freeze({
    id,
    name: String(definition.name || definition.label || id),
    description: String(definition.description || ""),
    version: String(definition.version || "0.1.0"),
    artifactType,
    implementation: Object.freeze({
      nodeType,
      nodeVersion: String(definition.implementation?.nodeVersion || ""),
    }),
    capabilities: Object.freeze(uniqueStrings(definition.capabilities)),
    presentation: Object.freeze({
      ...definition.presentation,
      catalogs: Object.freeze(uniqueStrings(definition.presentation?.catalogs)),
      placeableOn: Object.freeze(uniqueStrings(definition.presentation?.placeableOn)),
      hiddenFrom: Object.freeze(uniqueStrings(definition.presentation?.hiddenFrom)),
    }),
    metadata: Object.freeze({ ...(definition.metadata || {}) }),
  });
}

export class NodeArtifactCatalog {
  constructor(artifacts = []) {
    this.artifacts = new Map();
    for (const artifact of artifacts) this.register(artifact);
  }

  register(artifact) {
    const normalized = artifact?.artifactType ? defineNodeArtifact(artifact) : artifact;
    if (this.artifacts.has(normalized.id)) throw new Error(`NODE_ARTIFACT_ALREADY_REGISTERED:${normalized.id}`);
    this.artifacts.set(normalized.id, normalized);
    return normalized;
  }

  get(id) {
    const artifact = this.artifacts.get(String(id || ""));
    if (!artifact) throw new Error(`NODE_ARTIFACT_UNKNOWN:${String(id || "")}`);
    return artifact;
  }

  list({ artifactType = "", capability = "", catalog = "", placeableOn = "", view = "" } = {}) {
    return Array.from(this.artifacts.values()).filter((artifact) => {
      if (artifactType && artifact.artifactType !== artifactType) return false;
      if (capability && !artifact.capabilities.includes(capability)) return false;
      if (catalog && !artifact.presentation.catalogs.includes(catalog)) return false;
      if (placeableOn && !artifact.presentation.placeableOn.includes(placeableOn)) return false;
      if (view && artifact.presentation.hiddenFrom.includes(view)) return false;
      return true;
    });
  }
}

function requiredText(value, error) {
  const text = String(value || "").trim();
  if (!text) throw new Error(error);
  return text;
}

function uniqueStrings(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}
