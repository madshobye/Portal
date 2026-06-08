export function createRevisionDraftStore({
  storageKey,
  schemaVersion,
  getState,
  normalizeSpecificationMode,
} = {}) {
  function read() {
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!draft) return null;
      if (draft.schemaVersion !== schemaVersion) {
        localStorage.removeItem(storageKey);
        return null;
      }
      return draft;
    } catch {
      return null;
    }
  }

  function write() {
    const state = getState?.() || {};
    if (!state.projectId || !state.revisionId) return;
    const code = String(state.code ?? "");
    const draft = {
      schemaVersion,
      projectId: state.projectId,
      revisionId: state.revisionId,
      code,
      specification: String(state.specification || ""),
      specificationMode: state.specificationMode,
      bytes: new Blob([code]).size,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey, JSON.stringify(draft));
  }

  function storedRevisionFor(project, revision) {
    const draft = read();
    if (!draft || draft.projectId !== project.id || draft.revisionId !== revision.id) return null;
    const code = String(draft.code ?? revision.code ?? "");
    return {
      ...revision,
      code,
      specification: String(draft.specification ?? revision.specification ?? ""),
      specificationMode: normalizeSpecificationMode(draft.specificationMode || revision.specificationMode),
      bytes: Number(draft.bytes) || new Blob([code]).size,
    };
  }

  function clear() {
    localStorage.removeItem(storageKey);
  }

  return {
    clear,
    read,
    storedRevisionFor,
    write,
  };
}
