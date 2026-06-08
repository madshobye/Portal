export function createProjectActionsController({
  windowRef,
  promptProjectName,
  requestRevisionName,
  getProjectSelectTimer,
  setProjectSelectTimer,
  getRevisionSelectTimer,
  setRevisionSelectTimer,
  getProjectCache,
  getEditorValue,
  readProjects,
  getActiveProject,
  ensureProjectForWrite,
  shelveEditorSketchIfNeeded,
  saveProject,
  openRevision,
  renderProjectSelectors,
  clearEditorError,
  logLine,
  activeRevision,
  autoProjectName,
  buildRevision,
  createProjectId,
  nextRevisionName,
  normalizeProjectName,
  normalizeProjectRecord,
} = {}) {
  function scheduleProjectSelect(id) {
    windowRef.clearTimeout(getProjectSelectTimer());
    const timer = windowRef.setTimeout(() => {
      setProjectSelectTimer(null);
      void selectProject(id).catch((error) => logLine("error", `project open failed: ${error?.message || error}`));
    }, 0);
    setProjectSelectTimer(timer);
  }

  function scheduleRevisionSelect(id) {
    windowRef.clearTimeout(getRevisionSelectTimer());
    const timer = windowRef.setTimeout(() => {
      setRevisionSelectTimer(null);
      void selectRevision(id).catch((error) => logLine("error", `revision open failed: ${error?.message || error}`));
    }, 0);
    setRevisionSelectTimer(timer);
  }

  async function selectProject(id) {
    if (!id) {
      logLine("warn", "project open skipped: no project selected");
      renderProjectSelectors(getProjectCache());
      return;
    }
    const cached = getProjectCache();
    const projects = cached.length ? cached : await readProjects();
    const project = projects.find((item) => item.id === id);
    if (!project) {
      logLine("error", `project open failed: ${id} was not found`);
      renderProjectSelectors(projects);
      return;
    }
    const revision = activeRevision(project);
    if (!revision) {
      logLine("error", `project open failed: ${project.name || id} has no revision`);
      renderProjectSelectors(projects);
      return;
    }
    const opened = await openRevision(project, revision, { saveCurrent: true, reason: "project-select" });
    logLine("info", `opened project ${opened.project.name || "Untitled Project"} / ${opened.revision.name || "revision"} / spec ${opened.revision.specification.length} chars`);
  }

  async function selectRevision(id) {
    if (!id) {
      logLine("warn", "revision open skipped: no revision selected");
      renderProjectSelectors(getProjectCache());
      return;
    }
    const project = await getActiveProject();
    const revision = project?.revisions?.find((item) => item.id === id);
    if (!project || !revision) {
      logLine("error", `revision open failed: ${id} was not found`);
      renderProjectSelectors(getProjectCache());
      return;
    }
    const opened = await openRevision(project, revision, { saveCurrent: true, reason: "revision-select" });
    logLine("info", `opened revision ${opened.revision.name || "revision"} / spec ${opened.revision.specification.length} chars`);
  }

  async function createNewSketch() {
    const requested = promptProjectName();
    if (requested === null) return;
    await shelveEditorSketchIfNeeded();
    const name = normalizeProjectName(requested) || autoProjectName("");
    const code = newSketchTemplate();
    const revision = buildRevision({
      code,
      name: "Revision",
      specification: "",
      specificationMode: "middle",
      circuit: null,
      chat: [],
      source: "new",
    });
    const project = normalizeProjectRecord({
      id: createProjectId(),
      name,
      revisions: [revision],
      activeRevisionId: revision.id,
      chat: [],
    });
    const saved = await saveProject(project);
    await openRevision(saved, revision, { saveCurrent: false });
    clearEditorError();
    logLine("info", `new project ${saved.name}`);
  }

  async function createCleanRevision() {
    const activeProjectBeforeShelve = normalizeProjectRecord(await getActiveProject() || {});
    const defaultName = nextRevisionName(activeProjectBeforeShelve);
    const revisionName = await requestRevisionName(defaultName);
    if (revisionName === null) return;
    await shelveEditorSketchIfNeeded();
    let project = await getActiveProject();
    if (!project) {
      project = await ensureProjectForWrite({ code: "", nameHint: "Untitled Project" });
    }
    project = normalizeProjectRecord(project);
    const revision = buildRevision({
      code: "",
      name: revisionName,
      specification: "",
      specificationMode: "middle",
      circuit: null,
      chat: [],
      source: "new-revision",
    });
    project.revisions.unshift(revision);
    project.activeRevisionId = revision.id;
    const saved = await saveProject(project);
    await openRevision(saved, revision, { saveCurrent: false });
    clearEditorError();
    logLine("info", `new revision ${revision.name}`);
  }

  function newSketchTemplate() {
    return `// New P1.E sketch.
function setup() {
  println("new sketch ready");
}

function loop() {
  delay(20);
}
`;
  }

  return {
    createCleanRevision,
    createNewSketch,
    scheduleProjectSelect,
    scheduleRevisionSelect,
  };
}
