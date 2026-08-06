// The authored UI state is the sole editor-selection authority. Lists and the
// Preview may initiate a selection, but both apply this same transition and
// the Preview subsequently renders the store's UI projection.
//
// Component view has only element selection. Scene view has two selectable
// domains, so its selection is deliberately exclusive: selecting an element
// clears the selected Surface and selecting a Surface clears the selected
// element. `sceneInspectorTarget` remains a compatibility projection for
// saved UI state; it is derived here rather than independently controlled.
export function applyEditorSelection(ui, kind, id = "") {
  if (!ui || typeof ui !== "object") return ui;
  const selectionId = String(id || "");
  if (kind === "surface") {
    ui.selectedSurfaceId = selectionId;
    if (ui.workspace === "scene") {
      ui.selectedChainItemId = "";
      ui.sceneInspectorTarget = "surface";
    }
    return ui;
  }
  if (kind === "element") {
    ui.selectedChainItemId = selectionId;
    if (ui.workspace === "scene") {
      ui.selectedSurfaceId = "";
      ui.sceneInspectorTarget = "element";
    }
  }
  return ui;
}

// `selectedChainItemId` is the active inspector projection. This map preserves
// the last element selection owned by each Component or Scene so navigation
// can restore it without treating one artifact's node id as a global choice.
export function applyArtifactElementSelection(ui, artifactId, id = "") {
  applyEditorSelection(ui, "element", id);
  if (!ui || typeof ui !== "object" || !artifactId) return ui;
  ui.selectedChainItemIds ||= {};
  const selectionId = String(id || "");
  if (selectionId) ui.selectedChainItemIds[String(artifactId)] = selectionId;
  else delete ui.selectedChainItemIds[String(artifactId)];
  return ui;
}

export function editorSelectionChangedPaths(ui, kind) {
  if (ui?.workspace !== "scene") {
    return kind === "surface"
      ? ["ui.selectedSurfaceId"]
      : ["ui.selectedChainItemId"];
  }
  return kind === "surface"
    ? ["ui.selectedSurfaceId", "ui.selectedChainItemId"]
    : ["ui.selectedChainItemId", "ui.selectedSurfaceId"];
}
