function normalizeEditorTheme(theme) {
  return String(theme || "").toLowerCase() === "xcode" ? "xcode" : "chaos";
}

export function createCodeView({
  aceHost,
  codeInput,
  themeButton,
  codeStorageKey,
  themeStorageKey,
  onInput = () => {},
  onValueSet = () => {},
  onLog = () => {},
} = {}) {
  let editor = null;
  let currentTheme = "chaos";
  let suppressPersist = false;
  let errorMarker = null;
  let errorGutterRow = null;

  function getStoredTheme() {
    return normalizeEditorTheme(localStorage.getItem(themeStorageKey));
  }

  function updateThemeButton(theme = currentTheme) {
    if (!themeButton) return;
    const normalized = normalizeEditorTheme(theme);
    const isXcode = normalized === "xcode";
    themeButton.classList.toggle("is-active", isXcode);
    themeButton.setAttribute("aria-pressed", isXcode ? "true" : "false");
    themeButton.title = isXcode ? "Use Chaos theme" : "Use Xcode theme";
    themeButton.setAttribute("aria-label", themeButton.title);
    const icon = themeButton.querySelector(".material-symbols-rounded");
    if (icon) icon.textContent = isXcode ? "dark_mode" : "light_mode";
  }

  function applyTheme(theme, { persist = false } = {}) {
    currentTheme = normalizeEditorTheme(theme);
    if (editor) editor.setTheme(`ace/theme/${currentTheme}`);
    if (persist) localStorage.setItem(themeStorageKey, currentTheme);
    updateThemeButton(currentTheme);
  }

  function toggleTheme() {
    applyTheme(currentTheme === "xcode" ? "chaos" : "xcode", { persist: true });
  }

  function handleInput() {
    clearError();
    if (suppressPersist) return;
    localStorage.setItem(codeStorageKey, getValue());
    onInput();
  }

  function init() {
    if (window.ace) {
      editor = window.ace.edit(aceHost);
      applyTheme(getStoredTheme());
      editor.session.setMode("ace/mode/javascript");
      editor.session.setUseWorker(false);
      editor.session.setUseWrapMode(true);
      editor.session.setTabSize(2);
      editor.session.setUseSoftTabs(true);
      editor.setOptions({
        fontSize: "13px",
        showPrintMargin: false,
        useWorker: false,
        wrap: false,
      });
      editor.session.on("change", handleInput);
      aceHost.classList.add("is-active");
      codeInput.classList.add("is-hidden");
      if (themeButton) themeButton.disabled = false;
      return;
    }

    if (themeButton) themeButton.disabled = true;
    codeInput.addEventListener("input", handleInput);
  }

  function getValue() {
    return editor ? editor.getValue() : codeInput.value;
  }

  function setValueRaw(value, { persist = true } = {}) {
    const nextValue = String(value ?? "");
    const previousSuppressPersist = suppressPersist;
    suppressPersist = true;
    try {
      if (editor) {
        if (editor.getValue() !== nextValue) {
          editor.setValue(nextValue, -1);
          editor.clearSelection();
          editor.scrollToLine(0, true, false, () => {});
        }
      }
      codeInput.value = nextValue;
    } finally {
      suppressPersist = previousSuppressPersist;
    }
    if (persist) localStorage.setItem(codeStorageKey, nextValue);
    onValueSet();
    resize();
  }

  async function formatCode() {
    const before = getValue();
    if (!before.trim()) return;

    const beautify = window.ace?.require?.("ace/ext/beautify");
    if (editor && typeof beautify?.beautify === "function") {
      beautify.beautify(editor.session);
      codeInput.value = editor.getValue();
      handleInput();
      onLog("info", "code formatted");
      return;
    }

    const after = before
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n*$/g, "\n");
    if (after === before) {
      onLog("info", "code already formatted");
      return;
    }
    setValueRaw(after);
    onLog("info", "code formatted");
  }

  function resize() {
    if (!editor) return;
    requestAnimationFrame(() => {
      editor.resize(true);
      editor.renderer?.updateFull?.();
    });
  }

  function markError(parsed) {
    if (!parsed) return;

    if (editor) {
      clearError();
      const row = Math.max(0, parsed.line - 1);
      editor.session.setAnnotations([{
        row,
        column: Math.max(0, parsed.column),
        text: parsed.text,
        type: "error",
      }]);
      errorMarker = editor.session.addMarker(
        new window.ace.Range(row, 0, row, 1),
        "wrench-error-line",
        "fullLine",
      );
      editor.session.addGutterDecoration(row, "wrench-error-gutter");
      errorGutterRow = row;
      editor.scrollToLine(row, true, true, () => {});
      resize();
      return;
    }

    codeInput.dataset.errorLine = String(parsed.line);
  }

  function clearError() {
    if (editor) {
      editor.session.clearAnnotations();
      if (errorMarker !== null) {
        editor.session.removeMarker(errorMarker);
        errorMarker = null;
      }
      if (errorGutterRow !== null) {
        editor.session.removeGutterDecoration(errorGutterRow, "wrench-error-gutter");
        errorGutterRow = null;
      }
    }
    delete codeInput.dataset.errorLine;
  }

  return {
    clearError,
    formatCode,
    getValue,
    init,
    markError,
    resize,
    setValueRaw,
    toggleTheme,
  };
}
