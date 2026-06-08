export function createProjectToolbarController({
  toolbars = [],
  projectSelects = [],
  revisionSelects = [],
  formatBytes,
  normalizeSketchName,
  onProjectSelect,
  onRevisionSelect,
  onRenderedRevisionSelectors = () => {},
} = {}) {
  const connectButtons = () => toolbars.map((toolbar) => toolbar.connect).filter(Boolean);
  const downloadButtons = () => toolbars.map((toolbar) => toolbar.download).filter(Boolean);
  const scriptButtons = () => toolbars.flatMap((toolbar) => [toolbar.run, toolbar.stop]).filter(Boolean);
  const runButtons = () => toolbars.map((toolbar) => toolbar.run).filter(Boolean);
  const newProjectButtons = () => toolbars.map((toolbar) => toolbar.newProject).filter(Boolean);
  const busyDisabledNewRevisionButtons = () => toolbars
    .filter((toolbar) => toolbar.disableNewRevisionWhenBusy)
    .map((toolbar) => toolbar.newRevision)
    .filter(Boolean);

  function bind() {
    projectSelects.filter(Boolean).forEach((select) => {
      select.addEventListener("input", () => onProjectSelect?.(select.value));
      select.addEventListener("change", () => onProjectSelect?.(select.value));
    });
    revisionSelects.filter(Boolean).forEach((select) => {
      select.addEventListener("input", () => onRevisionSelect?.(select.value));
      select.addEventListener("change", () => onRevisionSelect?.(select.value));
    });
  }

  function renderProjectSelectors(projects = [], { currentProjectId = "", currentRevisionId = "" } = {}) {
    const options = [new Option("project", "")];
    projects.forEach((project) => {
      options.push(new Option(project.name || "Untitled Project", project.id));
    });
    projectSelects.filter(Boolean).forEach((select) => {
      select.replaceChildren(...options.map((option) => new Option(option.textContent, option.value)));
      select.value = currentProjectId || "";
      select.disabled = projects.length === 0;
    });
    const project = projects.find((item) => item.id === currentProjectId) || null;
    renderRevisionSelectors(project, { currentRevisionId });
  }

  function renderRevisionSelectors(project = null, { currentRevisionId = "" } = {}) {
    const revisions = project?.revisions || [];
    const options = [];
    revisions.forEach((revision) => {
      const name = normalizeSketchName(revision.name || "");
      const size = formatBytes(revision.bytes || revision.code.length);
      const label = name ? `${name} / ${size}` : size;
      options.push(new Option(label, revision.id));
    });
    revisionSelects.filter(Boolean).forEach((select) => {
      select.replaceChildren(...options.map((option) => new Option(option.textContent, option.value)));
      select.value = currentRevisionId || "";
      select.disabled = revisions.length === 0;
    });
    onRenderedRevisionSelectors();
  }

  function setConnectionState({ connected = false, connecting = false, busy = false, canDisconnectOrCancel = false, hasTransport = false } = {}) {
    connectButtons().forEach((button) => {
      button.disabled = busy && !canDisconnectOrCancel;
      button.classList.toggle("primary", !connected && !busy);
      button.classList.remove("danger");
      button.classList.toggle("is-connecting", connecting);
      button.title = connecting ? "Cancel connection" : (connected || hasTransport ? "Disconnect" : "Connect");
      button.setAttribute("aria-label", button.title);
      const icon = button.querySelector(".material-symbols-rounded");
      if (icon) icon.textContent = connecting ? "sync" : (connected || hasTransport ? "link_off" : "link");
    });
  }

  function setDownloadEnabled(enabled = false) {
    downloadButtons().forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function setScriptControlsEnabled(enabled = false) {
    scriptButtons().forEach((button) => {
      button.disabled = !enabled;
    });
  }

  function setProjectCreationBusy(busy = false) {
    newProjectButtons().forEach((button) => {
      button.disabled = busy;
    });
    busyDisabledNewRevisionButtons().forEach((button) => {
      button.disabled = busy;
    });
  }

  function setRunWorking(working = false) {
    runButtons().forEach((button) => {
      const runIcon = button.querySelector(".material-symbols-rounded");
      if (!runIcon) return;
      runIcon.classList.toggle("is-spinning", working);
      runIcon.textContent = working ? "progress_activity" : "play_arrow";
    });
  }

  return {
    bind,
    renderProjectSelectors,
    renderRevisionSelectors,
    setConnectionState,
    setDownloadEnabled,
    setProjectCreationBusy,
    setRunWorking,
    setScriptControlsEnabled,
  };
}
