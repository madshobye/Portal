export function createCodeEditorShellController({
  documentRef,
  fields,
  storage,
  createCodeView,
  setCircuitChatLayout,
  scheduleCircuitUpdate,
  updateCurrentSketchDirty,
  writeRevisionDraft,
  updateEnabledState,
  logLine,
} = {}) {
  let codeView = null;

  function view() {
    if (codeView) return codeView;
    codeView = createCodeView({
      aceHost: fields.aceHost,
      codeInput: fields.code,
      themeButton: fields.appTheme,
      codeStorageKey: storage.code,
      themeStorageKey: storage.appTheme,
      documentRef,
      onInput: handleInput,
      onValueSet: handleValueSet,
      onLog: logLine,
    });
    return codeView;
  }

  function init() {
    view().init();
  }

  function handleInput() {
    setCircuitChatLayout(null);
    scheduleCircuitUpdate();
    updateCurrentSketchDirty();
    writeRevisionDraft();
    updateEnabledState();
  }

  function handleValueSet() {
    scheduleCircuitUpdate();
    updateCurrentSketchDirty();
    updateEnabledState();
  }

  function getValue() {
    return view().getValue();
  }

  function setValueRaw(value, { persist = true } = {}) {
    view().setValueRaw(value, { persist });
  }

  async function formatCode() {
    return await view().formatCode();
  }

  function toggleTheme() {
    view().toggleTheme();
  }

  return {
    formatCode,
    getValue,
    init,
    setValueRaw,
    toggleTheme,
    view,
  };
}
