export function getDomRefs(root = document) {
  const byId = (id) => root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
  return {
    app: byId("app"),
    projectName: byId("project-name"),
    projectMeta: byId("project-meta"),
    outputStatus: byId("output-status"),
    outputStatusText: byId("output-status-text"),
    openOutput: byId("open-output"),
    togglePreview: byId("toggle-preview"),
    openFolder: byId("open-folder-main"),
    saveProject: byId("save-project-main"),
    calibrate: byId("calibrate-main"),
    blackout: byId("blackout-main"),
    projectRail: byId("project-rail"),
    studio: byId("studio"),
    inspector: byId("inspector"),
    mixDock: byId("mix-dock"),
    lowerStatus: byId("lower-status"),
  };
}
