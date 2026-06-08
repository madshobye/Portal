export function createWorkspaceToolbarRegistry(fields) {
  let toolbars = null;

  function workspaceToolbars() {
    if (toolbars) return toolbars;
    toolbars = [
      {
        connect: fields.connect,
        newProject: fields.newSketch,
        newRevision: fields.newRevision,
        download: fields.downloadCode,
        projectSelect: fields.projectSelect,
        revisionSelect: fields.sketchHistory,
        run: fields.run,
        stop: fields.stop,
      },
      {
        connect: fields.chatConnect,
        newProject: fields.chatNewSketch,
        newRevision: fields.chatNewRevision,
        download: fields.chatDownloadCode,
        projectSelect: fields.generativeProjectSelect,
        revisionSelect: fields.generativeRevisionSelect,
        run: fields.chatRun,
        stop: fields.chatStop,
      },
      {
        connect: fields.circuitConnect,
        newProject: fields.circuitNewSketch,
        newRevision: fields.circuitNewRevision,
        disableNewRevisionWhenBusy: true,
        download: fields.circuitDownloadCode,
        projectSelect: fields.circuitProjectSelect,
        revisionSelect: fields.circuitRevisionSelect,
      },
      {
        connect: fields.uiConnect,
      },
    ];
    return toolbars;
  }

  function projectToolbars() {
    return workspaceToolbars().filter((toolbar) => toolbar.projectSelect || toolbar.revisionSelect);
  }

  function scriptToolbars() {
    return workspaceToolbars().filter((toolbar) => toolbar.run || toolbar.stop);
  }

  function projectSelectControls() {
    return projectToolbars().map((toolbar) => toolbar.projectSelect).filter(Boolean);
  }

  function revisionSelectControls() {
    return projectToolbars().map((toolbar) => toolbar.revisionSelect).filter(Boolean);
  }

  return {
    projectSelectControls,
    projectToolbars,
    revisionSelectControls,
    scriptToolbars,
    workspaceToolbars,
  };
}
