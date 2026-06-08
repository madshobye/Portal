export function createSpecificationEditorController({
  fields,
  documentRef,
  normalizeSpecificationMode,
  markdownToSpecificationHtml,
  specificationHtmlToMarkdown,
  specificationNodesToMarkdown,
  setDescription,
  getMode,
  setMode,
  setSavedState,
  updateCurrentSketchDirty,
  scheduleCurrentRevisionDraftSave,
  updateEnabledState,
} = {}) {
  function handleInput() {
    const description = readMarkdown();
    setDescription(description);
    if (fields.specification) fields.specification.value = description;
    updateCurrentSketchDirty();
    scheduleCurrentRevisionDraftSave();
    updateEnabledState();
  }

  function handlePaste(event) {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html") || "";
    const text = event.clipboardData?.getData("text/plain") || "";
    const markdown = html ? specificationHtmlToMarkdown(html) : text;
    insertMarkdown(markdown || text);
    handleInput();
  }

  function insertMarkdown(markdown = "") {
    const text = String(markdown || "");
    if (!text.trim()) return;
    documentRef.execCommand("insertHTML", false, markdownToSpecificationHtml(text));
  }

  function applyFormat(format = "") {
    fields.specificationEditor?.focus();
    const command = {
      normal: ["formatBlock", "P"],
      h1: ["formatBlock", "H1"],
      h2: ["formatBlock", "H2"],
      h3: ["formatBlock", "H3"],
      h4: ["formatBlock", "H4"],
      bold: ["bold"],
      italic: ["italic"],
      underline: ["underline"],
      bullet: ["insertUnorderedList"],
      number: ["insertOrderedList"],
    }[format];
    if (!command) return;
    documentRef.execCommand(command[0], false, command[1] || null);
    handleInput();
  }

  function handleModeChange() {
    const mode = normalizeSpecificationMode(fields.specificationMode.value);
    setMode(mode);
    fields.specificationMode.value = mode;
    updateCurrentSketchDirty();
    scheduleCurrentRevisionDraftSave();
  }

  function setProjectSpecification(text = "", mode = getMode(), { markSaved = false } = {}) {
    const description = String(text || "");
    const normalizedMode = normalizeSpecificationMode(mode);
    setDescription(description);
    setMode(normalizedMode);
    if (markSaved) setSavedState(description, normalizedMode);
    if (fields.specification) fields.specification.value = description;
    if (fields.specificationEditor) fields.specificationEditor.innerHTML = markdownToSpecificationHtml(description);
    if (fields.specificationMode) fields.specificationMode.value = normalizedMode;
    updateEnabledState();
  }

  function readMarkdown() {
    if (!fields.specificationEditor) return fields.specification?.value || "";
    return specificationNodesToMarkdown([...fields.specificationEditor.childNodes]).trim();
  }

  return {
    applyFormat,
    handleInput,
    handleModeChange,
    handlePaste,
    readMarkdown,
    setProjectSpecification,
  };
}
