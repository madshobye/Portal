export function createCircuitShellController({
  fields,
  windowRef,
  initCircuitView,
  inferCircuitLayout,
  getEditorValue,
  getCircuitChatLayout,
  getProjectCache,
  getCurrentProjectId,
  getCurrentRevisionId,
  getCurrentSketchName,
  setCircuitView,
  getCircuitView,
  getCircuitWorkspaceController,
  getCircuitEditorActions,
  normalizeProjectName,
  normalizeSketchName,
} = {}) {
  let updateTimer = null;

  function init() {
    setCircuitView(initCircuitView({
      mount: fields.circuitCanvas,
      componentList: fields.circuitComponents,
      assumptions: fields.circuitAssumptions,
      pinInfo: fields.circuitPinInfo,
      alternatives: fields.circuitAlternatives,
      onComponentOverride: applyComponentOverride,
      onComponentPlacement: applyComponentPlacement,
      onBoardPlacement: applyBoardPlacement,
      onViewportPlacement: applyViewportPlacement,
    }));
    getCircuitWorkspaceController().restorePreferences();
    update("inferred from code");
  }

  function setBoardType(type, { persist = true } = {}) {
    getCircuitWorkspaceController().setBoardType(type, { persist });
  }

  function scheduleUpdate() {
    windowRef.clearTimeout(updateTimer);
    updateTimer = windowRef.setTimeout(() => {
      update();
    }, 360);
  }

  function update(status = "") {
    const circuitView = getCircuitView();
    if (!circuitView) return;
    const currentProjectId = getCurrentProjectId();
    const currentRevisionId = getCurrentRevisionId();
    const currentSketchName = getCurrentSketchName();
    const model = inferCircuitLayout(getEditorValue(), getCircuitChatLayout());
    const project = getProjectCache().find((item) => item.id === currentProjectId) || null;
    const revision = project?.revisions?.find((item) => item.id === currentRevisionId) || null;
    model.projectTitle = normalizeProjectName(project?.name || "");
    model.revisionTitle = normalizeSketchName(currentSketchName || revision?.name || "");
    model.viewportKey = `${currentProjectId || ""}:${currentRevisionId || ""}:${currentSketchName || ""}`;
    circuitView.setModel(model);
    if (fields.circuitStatus) {
      const count = model.components?.length || 0;
      fields.circuitStatus.textContent = status || `${count} part${count === 1 ? "" : "s"} inferred`;
    }
  }

  function applyComponentOverride({ component, type, label } = {}) {
    getCircuitEditorActions().applyComponentOverride({ component, type, label });
  }

  function applyComponentPlacement({ component, side, x, y } = {}) {
    getCircuitEditorActions().applyComponentPlacement({ component, side, x, y });
  }

  function applyBoardPlacement({ type, cx, cy } = {}) {
    getCircuitEditorActions().applyBoardPlacement({ type, cx, cy });
  }

  function applyViewportPlacement({ zoom, panX, panY } = {}) {
    getCircuitEditorActions().applyViewportPlacement({ zoom, panX, panY });
  }

  function resetLayoutPositions() {
    getCircuitEditorActions().resetLayoutPositions();
  }

  return {
    applyBoardPlacement,
    applyComponentOverride,
    applyComponentPlacement,
    applyViewportPlacement,
    init,
    resetLayoutPositions,
    scheduleUpdate,
    setBoardType,
    update,
  };
}
