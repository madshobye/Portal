import { createCodeView } from "./code-view.js?v=0.1.87-ui745";
import { createCodeEditorShellController } from "./code-editor-shell-controller.js?v=0.1.87-ui745";
import { createCodeDropController } from "./code-drop-controller.js?v=0.1.87-ui745";
import { createSpecificationEditorController } from "./specification-editor-controller.js?v=0.1.87-ui745";

export function createEditorRegistry({
  documentRef,
  fields,
  getConnectionUiStateController,
  getConsoleController,
  getCurrentRevisionSession,
  getProjectController,
  getRevisionDraftStore,
  getSpecificationMode,
  markdownToSpecificationHtml,
  normalizeSpecificationMode,
  scheduleCircuitUpdate,
  setCurrentProjectDescription,
  setCurrentProjectDescriptionSource,
  setCurrentProjectSpecificationMode,
  setCurrentProjectSpecificationModeSource,
  setCircuitChatLayout,
  specificationHtmlToMarkdown,
  specificationNodesToMarkdown,
  storage,
} = {}) {
  let codeEditorShellController = null;
  let specificationEditorController = null;
  let codeDropController = null;

  function getCodeEditorShellController() {
    if (codeEditorShellController) return codeEditorShellController;
    codeEditorShellController = createCodeEditorShellController({
      documentRef,
      fields,
      storage,
      createCodeView,
      setCircuitChatLayout,
      scheduleCircuitUpdate,
      updateCurrentSketchDirty: () => getCurrentRevisionSession().updateCurrentSketchDirty(),
      writeRevisionDraft: () => getRevisionDraftStore().write(),
      updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return codeEditorShellController;
  }

  function getSpecificationEditorController() {
    if (specificationEditorController) return specificationEditorController;
    specificationEditorController = createSpecificationEditorController({
      fields,
      documentRef,
      normalizeSpecificationMode,
      markdownToSpecificationHtml,
      specificationHtmlToMarkdown,
      specificationNodesToMarkdown,
      setDescription: setCurrentProjectDescription,
      getMode: getSpecificationMode,
      setMode: setCurrentProjectSpecificationMode,
      setSavedState: (description, mode) => {
        setCurrentProjectDescriptionSource(description);
        setCurrentProjectSpecificationModeSource(mode);
      },
      updateCurrentSketchDirty: () => getCurrentRevisionSession().updateCurrentSketchDirty(),
      scheduleCurrentRevisionDraftSave: () => getRevisionDraftStore().write(),
      updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
    });
    return specificationEditorController;
  }

  function bindCodeDrop() {
    if (codeDropController) return;
    codeDropController = createCodeDropController({
      dropTarget: fields.editorWrap,
      onDropText: (options) => getProjectController().handleDroppedCodeText(options),
    });
    codeDropController.bind();
  }

  return {
    bindCodeDrop,
    getCodeEditorShellController,
    getSpecificationEditorController,
  };
}
