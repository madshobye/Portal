export function createCurrentRevisionSession({
  getEditorValue,
  getCurrentSketchName,
  setCurrentSketchName,
  getCurrentSketchSource,
  setCurrentSketchSource,
  setCurrentSketchVersionName,
  getCurrentProjectDescription,
  setCurrentProjectDescription,
  getCurrentProjectDescriptionSource,
  setCurrentProjectDescriptionSource,
  getCurrentProjectSpecificationMode,
  setCurrentProjectSpecificationMode,
  getCurrentProjectSpecificationModeSource,
  setCurrentProjectSpecificationModeSource,
  setCurrentProjectCircuit,
  setCircuitChatLayout,
  setCurrentSketchDirty,
  setCurrentSketchSaved,
  setProjectSpecification,
  renderCurrentSketchLabel,
  nextRevisionName,
  normalizeCircuitLayout,
  normalizeSketchName,
  normalizeSpecificationMode,
} = {}) {
  let currentSketchDirty = false;

  function setCurrentSketchIdentity(name = "", code = "", project = null, revision = null) {
    setCurrentSketchName(normalizeSketchName(name));
    setCurrentSketchSource(String(code ?? ""));
    setCurrentSketchVersionName(project ? nextRevisionName(project) : "");
    currentSketchDirty = false;
    setCurrentSketchDirty(false);
    setCurrentSketchSaved(true);
    const description = String(revision?.specification || "");
    const mode = normalizeSpecificationMode(revision?.specificationMode || "middle");
    setCurrentProjectDescription(description);
    setCurrentProjectSpecificationMode(mode);
    setCurrentProjectDescriptionSource(description);
    setCurrentProjectSpecificationModeSource(mode);
    const circuit = normalizeCircuitLayout(revision?.circuit);
    setCurrentProjectCircuit(circuit);
    setCircuitChatLayout(circuit);
    setProjectSpecification(description, mode, { markSaved: true });
    renderCurrentSketchName();
  }

  function clearCurrentSketchIdentity() {
    setCurrentSketchName("");
    setCurrentSketchSource("");
    setCurrentSketchVersionName("");
    setCurrentProjectDescription("");
    setCurrentProjectDescriptionSource("");
    setCurrentProjectSpecificationMode("middle");
    setCurrentProjectSpecificationModeSource("middle");
    setCurrentProjectCircuit(null);
    setCircuitChatLayout(null);
    setProjectSpecification("", "middle", { markSaved: true });
    currentSketchDirty = Boolean(String(getEditorValue() || "").trim());
    setCurrentSketchDirty(currentSketchDirty);
    setCurrentSketchSaved(!currentSketchDirty);
    renderCurrentSketchName();
  }

  function updateCurrentSketchDirty() {
    const code = getEditorValue();
    const codeDirty = getCurrentSketchName()
      ? code !== getCurrentSketchSource()
      : Boolean(String(code || "").trim());
    const specDirty = getCurrentProjectDescription() !== getCurrentProjectDescriptionSource()
      || getCurrentProjectSpecificationMode() !== getCurrentProjectSpecificationModeSource();
    currentSketchDirty = codeDirty || specDirty;
    setCurrentSketchDirty(currentSketchDirty);
    setCurrentSketchSaved(!currentSketchDirty);
    renderCurrentSketchName();
  }

  function renderCurrentSketchName() {
    const label = sketchHistoryPlaceholderLabel();
    renderCurrentSketchLabel(getCurrentSketchName()
      ? `Current revision: ${label}`
      : "Revision");
  }

  function sketchHistoryPlaceholderLabel() {
    const name = getCurrentSketchName();
    if (!name) return currentSketchDirty ? "unsaved revision" : "revision";
    return currentSketchDirty ? `${name} *` : name;
  }

  return {
    clearCurrentSketchIdentity,
    renderCurrentSketchName,
    setCurrentSketchIdentity,
    sketchHistoryPlaceholderLabel,
    updateCurrentSketchDirty,
  };
}
