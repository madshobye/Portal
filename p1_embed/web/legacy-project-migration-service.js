export function createLegacyProjectMigrationService({
  storage,
  storageArea,
  projectLimit,
  projectStore,
  readProjectsFallback,
  writeProjectsFallbackBestEffort,
  saveProject,
  setProjectCache,
  logLine,
  createProjectId,
  normalizeProjectName,
  normalizeProjectRecord,
  projectWithRequiredRevision,
  revisionNameRoot,
  groupLegacySketchEntries,
  legacyEntriesToRevisions,
  legacySketchConverted,
  legacySketchConvertedCopy,
  legacySketchStoredCopy,
  legacySketchWithSource,
} = {}) {
  async function migrateLegacySketchesToProjects() {
    const legacy = await readLegacySketchEntries({ includeConverted: false });
    if (!legacy.length) return;
    await saveLegacySketchGroups(legacy, { reason: "migrated legacy sketches" });
  }

  async function recoverMissingLegacySketches() {
    const existing = (await readRawProjectRecords()).map((project) => normalizeProjectRecord(project)).filter((project) => project.revisions.length);
    const fallback = readProjectsFallback();
    let projects = existing;
    if (fallback.length) {
      const byId = new Map(projects.map((project) => [project.id, project]));
      fallback.forEach((project) => {
        if (!byId.has(project.id)) byId.set(project.id, projectWithRequiredRevision(project));
      });
      projects = [...byId.values()];
      await writeRawProjectRecords(projects);
    }

    const legacy = await readLegacySketchEntries({ includeConverted: true });
    const knownCodes = new Set();
    projects.forEach((project) => {
      project.revisions.forEach((revision) => {
        const code = String(revision.code || "");
        if (code.trim()) knownCodes.add(code);
      });
    });
    const missingLegacy = legacy.filter((item) => {
      const code = String(item.code || "");
      return code.trim() && !knownCodes.has(code);
    });
    await saveLegacySketchGroups(missingLegacy, { reason: "recovered missing legacy sketches" });
  }

  async function recoverLegacySketchesWhenProjectListEmpty() {
    const legacy = await readLegacySketchEntries({ includeConverted: true });
    const count = await saveLegacySketchGroups(legacy, { reason: "recovered legacy sketches because project list was empty" });
    if (count) logLine("warn", `recovered ${count} legacy sketches because project list was empty`);
  }

  async function readRawProjectRecords() {
    return await projectStore.readRawProjectRecords();
  }

  async function writeRawProjectRecords(projects = []) {
    const normalized = projects.map((project) => projectWithRequiredRevision(project)).filter((project) => project.revisions.length);
    if (!normalized.length) return;
    await projectStore.writeRawProjectRecords(normalized);
    const nextCache = normalized.slice(0, projectLimit);
    setProjectCache(nextCache);
    writeProjectsFallbackBestEffort(nextCache);
  }

  async function readLegacySketchEntries({ includeConverted = false } = {}) {
    const legacy = [];
    try {
      const value = JSON.parse(storageArea.getItem(storage.sketchHistory) || "[]");
      if (Array.isArray(value)) {
        legacy.push(...value
          .map((item, index) => legacySketchWithSource(item, { source: "localStorage", index }))
          .filter((item) => typeof item?.code === "string" && (includeConverted || !legacySketchConverted(item))));
      }
    } catch {
    }
    try {
      const items = await projectStore.readLegacySketchRecords();
      legacy.push(...items
        .map((item) => legacySketchWithSource(item, { source: "indexedDb", id: item.id }))
        .filter((item) => typeof item?.code === "string" && (includeConverted || !legacySketchConverted(item))));
    } catch {
    }
    return legacy;
  }

  async function markLegacySketchEntriesConverted(entries = [], project = {}) {
    if (!entries.length || !project?.id) return;
    const revisionsByCode = new Map();
    (project.revisions || []).forEach((revision) => {
      const code = String(revision.code || "");
      if (code.trim() && !revisionsByCode.has(code)) revisionsByCode.set(code, revision);
    });
    const convertedAt = new Date().toISOString();
    await markLocalStorageLegacySketchesConverted(entries, project, revisionsByCode, convertedAt);
    await markIndexedDbLegacySketchesConverted(entries, project, revisionsByCode, convertedAt);
  }

  async function markLocalStorageLegacySketchesConverted(entries, project, revisionsByCode, convertedAt) {
    const localEntries = entries.filter((item) => item?._legacySource?.source === "localStorage");
    if (!localEntries.length) return;
    try {
      const value = JSON.parse(storageArea.getItem(storage.sketchHistory) || "[]");
      if (!Array.isArray(value)) return;
      localEntries.forEach((entry) => {
        const index = entry._legacySource.index;
        if (!Number.isInteger(index) || !value[index]) return;
        const revision = revisionsByCode.get(String(entry.code || ""));
        if (!revision) return;
        value[index] = legacySketchConvertedCopy(value[index], project, revision, convertedAt);
      });
      storageArea.setItem(storage.sketchHistory, JSON.stringify(value));
    } catch {
    }
  }

  async function markIndexedDbLegacySketchesConverted(entries, project, revisionsByCode, convertedAt) {
    const idbEntries = entries.filter((item) => item?._legacySource?.source === "indexedDb");
    if (!idbEntries.length) return;
    try {
      const records = [];
      idbEntries.forEach((entry) => {
        const revision = revisionsByCode.get(String(entry.code || ""));
        if (!revision) return;
        records.push(legacySketchConvertedCopy(legacySketchStoredCopy(entry), project, revision, convertedAt));
      });
      await projectStore.writeLegacySketchRecords(records);
    } catch {
    }
  }

  async function saveLegacySketchGroups(entries = [], { reason = "migrated legacy sketches" } = {}) {
    const groups = groupLegacySketchEntries(entries);
    if (!groups.size) return 0;
    const existingProjects = (await readRawProjectRecords())
      .map((project) => normalizeProjectRecord(project))
      .filter((project) => project.revisions.length)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const byName = new Map();
    const byRoot = new Map();
    existingProjects.forEach((project) => {
      const nameKey = normalizeProjectName(project.name).toLowerCase();
      const rootKey = revisionNameRoot(project.name).toLowerCase();
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, project);
      if (rootKey && !byRoot.has(rootKey)) byRoot.set(rootKey, project);
    });

    let convertedCount = 0;
    for (const [name, group] of groups.entries()) {
      const revisions = legacyEntriesToRevisions(group);
      if (!revisions.length) continue;
      const nameKey = normalizeProjectName(name).toLowerCase();
      const rootKey = revisionNameRoot(name).toLowerCase();
      let project = byName.get(nameKey) || byRoot.get(rootKey) || null;
      if (!project) {
        project = normalizeProjectRecord({
          id: createProjectId(),
          name,
          revisions: [],
          activeRevisionId: "",
          chat: [],
        });
      }

      const knownCodes = new Set(project.revisions.map((revision) => String(revision.code || "")).filter((code) => code.trim()));
      const newRevisions = revisions.filter((revision) => {
        const code = String(revision.code || "");
        if (!code.trim() || knownCodes.has(code)) return false;
        knownCodes.add(code);
        return true;
      });
      if (newRevisions.length) {
        project = normalizeProjectRecord({
          ...project,
          revisions: [...project.revisions, ...newRevisions],
          activeRevisionId: project.activeRevisionId || newRevisions[0].id,
        });
      }
      const saved = await saveProject(project, { makeActive: false });
      await markLegacySketchEntriesConverted(group, saved);
      byName.set(normalizeProjectName(saved.name).toLowerCase(), saved);
      byRoot.set(revisionNameRoot(saved.name).toLowerCase(), saved);
      convertedCount += group.length;
    }
    if (convertedCount) logLine("warn", `${reason}: ${convertedCount} sketches grouped into ${groups.size} projects`);
    return convertedCount;
  }

  async function projectFromLegacySketchEntries(name = "Imported Sketches", entries = null) {
    const legacy = entries || await readLegacySketchEntries();
    if (!legacy.length) return null;
    const revisions = legacyEntriesToRevisions(legacy);
    if (!revisions.length) return null;
    return normalizeProjectRecord({
      id: createProjectId(),
      name,
      revisions,
      activeRevisionId: revisions[0].id,
      chat: [],
    });
  }

  return {
    migrateLegacySketchesToProjects,
    recoverLegacySketchesWhenProjectListEmpty,
    recoverMissingLegacySketches,
    readLegacySketchEntries,
    markLegacySketchEntriesConverted,
    projectFromLegacySketchEntries,
    readRawProjectRecords,
    saveLegacySketchGroups,
    writeRawProjectRecords,
  };
}
