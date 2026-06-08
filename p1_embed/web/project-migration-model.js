export function createProjectMigrationModel({
  buildRevision,
  normalizeChatMessages,
  normalizeCircuitLayout,
  normalizeProjectName,
  normalizeProjectRecord,
  revisionNameRoot,
  createRevisionId,
  fnv1aHex,
  autoProjectName,
  migrationId,
  migrationVersion,
  targetStoreName = "projects",
} = {}) {
  function migrateProjectRecordSchema(project = {}) {
    const normalized = normalizeProjectRecord(project);
    const projectChat = normalizeChatMessages(project.chat);
    const activeIndex = Math.max(0, normalized.revisions.findIndex((revision) => revision.id === normalized.activeRevisionId));
    const revisions = normalized.revisions.map((revision, index) => {
      const code = String(revision.code || "");
      const chat = revision.chat.length ? revision.chat : (index === activeIndex ? projectChat : []);
      return {
        ...revision,
        codeHash: fnv1aHex(code),
        chat: normalizeChatMessages(chat),
      };
    });
    return {
      ...normalized,
      chat: [],
      revisions,
      activeRevisionId: revisions[activeIndex]?.id || revisions[0]?.id || "",
    };
  }

  function projectWithRequiredRevision(project = {}) {
    const normalized = normalizeProjectRecord(project);
    if (normalized.revisions.length) return normalized;
    const revision = buildRevision({
      name: "Revision 1",
      code: "",
      specification: "",
      specificationMode: "middle",
      circuit: null,
      chat: [],
      source: "new-revision",
    });
    return {
      ...normalized,
      revisions: [revision],
      activeRevisionId: revision.id,
    };
  }

  function legacySketchWithSource(item, source) {
    if (!item || typeof item !== "object") return item;
    return { ...item, _legacySource: source };
  }

  function legacySketchConverted(item = {}) {
    const marker = recordMigrationMarker(item, migrationId)
      || item.p1eProjectMigration
      || item.projectMigration
      || {};
    return (String(marker.version) === migrationVersion || String(marker.version) === "project-v2")
      && (!marker.status || marker.status === "converted")
      && Boolean(marker.projectId)
      && Boolean(marker.revisionId);
  }

  function recordMigrationMarker(record = {}, markerMigrationId = "") {
    const migrations = record?.p1eMigrations;
    return migrations && typeof migrations === "object" ? migrations[markerMigrationId] || null : null;
  }

  function recordWithMigrationMarker(record = {}, markerMigrationId = "", marker = {}) {
    const migrations = record.p1eMigrations && typeof record.p1eMigrations === "object"
      ? { ...record.p1eMigrations }
      : {};
    migrations[markerMigrationId] = marker;
    return {
      ...record,
      p1eMigrations: migrations,
    };
  }

  function legacySketchStoredCopy(item = {}) {
    const copy = { ...item };
    delete copy._legacySource;
    return copy;
  }

  function legacySketchConvertedCopy(item, project, revision, convertedAt) {
    return recordWithMigrationMarker(item, migrationId, {
      version: migrationVersion,
      status: "converted",
      targetStore: targetStoreName,
      projectId: project.id,
      revisionId: revision.id,
      convertedAt,
    });
  }

  function groupLegacySketchEntries(entries = []) {
    const groups = new Map();
    entries.forEach((entry) => {
      if (!String(entry?.code || "").trim()) return;
      const name = legacySketchProjectName(entry);
      const key = normalizeProjectName(name).toLowerCase() || "imported sketches";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    const named = new Map();
    groups.forEach((items, key) => {
      named.set(normalizeProjectName(items[0] ? legacySketchProjectName(items[0]) : key) || "Imported Sketches", items);
    });
    return named;
  }

  function legacySketchProjectName(entry = {}) {
    const root = revisionNameRoot(entry.name || "");
    if (root && !isLegacyGenericProjectRoot(root)) return normalizeProjectName(root);
    return normalizeProjectName(autoProjectName(entry.code || "")) || "Imported Sketches";
  }

  function isLegacyGenericProjectRoot(root = "") {
    const clean = normalizeProjectName(root).toLowerCase();
    return !clean || ["revision", "initial revision", "imported revision", "new sketch"].includes(clean);
  }

  function legacyEntriesToRevisions(legacy = []) {
    const seen = new Set();
    return legacy
      .filter((item) => {
        const key = String(item.code || "");
        if (!key.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => buildRevision({
        id: createRevisionId(),
        name: item.name || "Imported revision",
        code: String(item.code || ""),
        specification: String(item.description || ""),
        specificationMode: item.specificationMode || "middle",
        circuit: normalizeCircuitLayout(item.circuit),
        source: "migration",
        createdAt: item.at || new Date().toISOString(),
      }));
  }

  return {
    groupLegacySketchEntries,
    legacyEntriesToRevisions,
    legacySketchConverted,
    legacySketchConvertedCopy,
    legacySketchStoredCopy,
    legacySketchWithSource,
    migrateProjectRecordSchema,
    projectWithRequiredRevision,
  };
}
