export function createProjectDedupeService({
  projectLimit,
  projectStore,
  readActiveProjectId,
  writeActiveProjectId,
  writeProjectsFallbackBestEffort,
  logLine,
  normalizeProjectName,
  normalizeProjectRecord,
  revisionMergeKey,
} = {}) {
  async function mergeDuplicateBoardProjects(projects = []) {
    const normalized = projects.map((item) => normalizeProjectRecord(item)).filter((item) => item.revisions.length);
    const boardProjects = normalized.filter((item) => normalizeProjectName(item.name).toLowerCase() === "board project");
    if (boardProjects.length <= 1) return normalized;

    const primary = normalizeProjectRecord(boardProjects[0]);
    const duplicateIds = new Set(boardProjects.slice(1).map((item) => item.id));
    const seen = new Set(primary.revisions.map(revisionMergeKey));
    boardProjects.slice(1).forEach((project) => {
      project.revisions.forEach((revision) => {
        const key = revisionMergeKey(revision);
        if (seen.has(key)) return;
        seen.add(key);
        primary.revisions.push(revision);
      });
    });
    primary.updatedAt = new Date().toISOString();
    primary.activeRevisionId = primary.revisions.find((item) => item.id === primary.activeRevisionId)?.id
      || primary.revisions[0]?.id
      || "";

    const merged = [
      primary,
      ...normalized.filter((item) => normalizeProjectName(item.name).toLowerCase() !== "board project"),
    ].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, projectLimit);

    const updatedStore = await projectStore.replaceProjectAndDeleteDuplicates(primary, [...duplicateIds]);
    if (!updatedStore) {
      logLine("warn", "board project cleanup could not update IndexedDB");
    }

    if (duplicateIds.has(readActiveProjectId() || "")) {
      writeActiveProjectId(primary.id);
    }
    writeProjectsFallbackBestEffort(merged);
    logLine("warn", `merged ${duplicateIds.size} duplicate Board Project entries`);
    return merged;
  }

  return { mergeDuplicateBoardProjects };
}
