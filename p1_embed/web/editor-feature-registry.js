import { createEditorRegistry } from "./editor-registry.js?v=0.1.87-ui725";
import {
  markdownToSpecificationHtml,
  specificationHtmlToMarkdown,
  specificationNodesToMarkdown,
} from "./specification-format.js?v=0.1.87-ui725";

export function createEditorFeatureRegistry({
  documentRef,
  fields,
  getConnectionUiStateController,
  getConsoleController,
  getCurrentRevisionSession,
  getCurrentProjectSpecificationMode,
  getProjectController,
  getRevisionDraftStore,
  normalizeSpecificationMode,
  scheduleCircuitUpdate,
  setCircuitChatLayout,
  setCurrentProjectDescription,
  setCurrentProjectDescriptionSource,
  setCurrentProjectSpecificationMode,
  setCurrentProjectSpecificationModeSource,
  storage,
} = {}) {
  let editorRegistry = null;

  function getEditorRegistry() {
    if (editorRegistry) return editorRegistry;
    editorRegistry = createEditorRegistry({
      documentRef,
      fields,
      getConnectionUiStateController,
      getConsoleController,
      getCurrentRevisionSession,
      getProjectController,
      getRevisionDraftStore,
      getSpecificationMode: getCurrentProjectSpecificationMode,
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
    });
    return editorRegistry;
  }

  return {
    bindCodeDrop: () => getEditorRegistry().bindCodeDrop(),
    getCodeEditorShellController: () => getEditorRegistry().getCodeEditorShellController(),
    getEditorRegistry,
    getSpecificationEditorController: () => getEditorRegistry().getSpecificationEditorController(),
  };
}
