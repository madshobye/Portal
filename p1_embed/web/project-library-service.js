export function createProjectLibraryService({
  storage,
  storageArea,
  projectLimit,
  projectStore,
  getProjectCache,
  setProjectCache,
  getCurrentProjectId,
  runProjectStartupStep,
  migrateLegacySketchesToProjects,
  recoverMissingLegacySketches,
  recoverLegacySketchesWhenProjectListEmpty,
  migrateProjectStorageSchema,
  mergeDuplicateBoardProjects,
  projectWithRequiredRevision,
  createProjectId,
  createRevisionId,
  normalizeProjectName,
  normalizeProjectRecord,
  revisionNameRoot,
  splitRevisionNumber,
  examplesProject = null,
  isExampleProject = () => false,
} = {}) {
  function userProjectsOnly(projects = []) {
    return projects.filter((project) => !isExampleProject(project));
  }

  function withExamplesProject(projects = []) {
    const userProjects = userProjectsOnly(projects);
    if (!examplesProject) return userProjects;
    return [normalizeProjectRecord(examplesProject), ...userProjects];
  }

  async function readProjects() {
    await runProjectStartupStep("legacy sketch migration", migrateLegacySketchesToProjects);
    await runProjectStartupStep("missing legacy recovery", recoverMissingLegacySketches);
    await runProjectStartupStep("project schema migration", migrateProjectStorageSchema);
    let projects = await readProjectsFromIndexedDb();
    if (!projects.length) {
      await recoverLegacySketchesWhenProjectListEmpty();
      projects = await readProjectsFromIndexedDb();
    }
    if (!projects.length) projects = readProjectsFallback();
    projects = await mergeDuplicateBoardProjects(userProjectsOnly(projects));
    projects = withExamplesProject(projects.slice(0, projectLimit));
    setProjectCache(projects);
    return projects;
  }

  function readProjectsFallback() {
    return projectStore.readProjectsFallback();
  }

  function writeProjectsFallbackBestEffort(projects = []) {
    projectStore.writeProjectsFallbackBestEffort(projects);
  }

  function tryWriteProjectsFallback(projects = []) {
    return projectStore.tryWriteProjectsFallback(projects);
  }

  function compactProjectFallbackRecord(project = {}) {
    return projectStore.compactProjectFallbackRecord(project);
  }

  async function readProjectsFromIndexedDb() {
    return await projectStore.readProjectsFromIndexedDb();
  }

  async function saveProject(project, { makeActive = true } = {}) {
    const normalized = projectWithRequiredRevision(project);
    normalized.updatedAt = new Date().toISOString();
    if (isExampleProject(normalized)) {
      const projects = withExamplesProject(getProjectCache());
      setProjectCache(projects);
      if (makeActive) storageArea.setItem(storage.projectId, normalized.id);
      return normalized;
    }
    const userProjects = [
      normalized,
      ...userProjectsOnly(getProjectCache()).filter((item) => item.id !== normalized.id),
    ].slice(0, projectLimit);
    const projects = withExamplesProject(userProjects);
    setProjectCache(projects);
    if (makeActive) storageArea.setItem(storage.projectId, normalized.id);
    const stored = await projectStore.putProjectRecord(normalized);
    if (!stored) {
      writeProjectsFallbackBestEffort(userProjects);
    }
    return normalized;
  }

  async function getActiveProject() {
    const cached = getProjectCache();
    const projects = cached.length ? cached : await readProjects();
    const id = getCurrentProjectId() || storageArea.getItem(storage.projectId) || "";
    return projects.find((project) => project.id === id) || null;
  }

  async function getProjectById(id) {
    const cached = getProjectCache();
    const projects = cached.length ? cached : await readProjects();
    return projects.find((project) => project.id === id) || null;
  }

  function forkImportedProjectIfNeeded(project) {
    const normalized = normalizeProjectRecord(project);
    const collides = getProjectCache().some((item) => item.id === normalized.id);
    if (!collides) return normalized;

    let activeRevisionId = "";
    const revisions = normalized.revisions.map((revision) => {
      const forkedId = createRevisionId();
      if (revision.id === normalized.activeRevisionId) activeRevisionId = forkedId;
      return {
        ...revision,
        id: forkedId,
        source: "import",
      };
    });

    return normalizeProjectRecord({
      ...normalized,
      id: createProjectId(),
      name: nextProjectImportName(normalized.name),
      revisions,
      activeRevisionId: activeRevisionId || revisions[0]?.id || "",
    });
  }

  function nextProjectImportName(name = "") {
    const root = revisionNameRoot(name) || normalizeProjectName(name) || "Imported Project";
    let maxVersion = 1;
    getProjectCache().forEach((project) => {
      const parsed = splitRevisionNumber(project?.name || "");
      if (parsed.root.toLowerCase() === root.toLowerCase()) {
        maxVersion = Math.max(maxVersion, parsed.version);
      }
    });
    return normalizeProjectName(`${root} ${maxVersion + 1}`);
  }

  return {
    compactProjectFallbackRecord,
    forkImportedProjectIfNeeded,
    getActiveProject,
    getProjectById,
    nextProjectImportName,
    readProjects,
    readProjectsFallback,
    readProjectsFromIndexedDb,
    saveProject,
    tryWriteProjectsFallback,
    writeProjectsFallbackBestEffort,
  };
}
