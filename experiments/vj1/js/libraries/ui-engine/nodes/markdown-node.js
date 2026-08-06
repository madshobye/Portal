import { defineUiNode, UI_COMMAND_PHASES, UI_STATE_LIFETIMES } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";
import { createRetainedScrollController } from "../scroll-state.js";

export const MarkdownInputNode = defineUiNode({
  id: "core.ui.markdown-input",
  name: "Markdown input",
  version: "0.1.0",
  description: "Retained block-Markdown editor with private contenteditable DOM, semantic style actions, and restorable scroll.",
  inlets: {
    value: { type: "string", optional: true },
    label: { type: "string", optional: true },
    disabled: { type: "boolean", optional: true },
    styleControls: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
    significant: { type: "boolean", optional: true },
  },
  outlets: {
    change: { type: "event", optional: true },
    style: { type: "event", optional: true },
    context: { type: "event", optional: true },
  },
  state: [
    { id: "scroll", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: { top: 0, left: 0 } },
  ],
  events: ["change", "style", "context"],
  control: "markdown",
  capabilities: ["ui-control", "ui-markdown", "block-editor", "scroll-restoration"],
  factory: createMarkdownInputInstance,
});

export function createMarkdownInputInstance({ id, host, inputs: initialInputs, stateAddress, state, document, emit }) {
  let inputs = normalizeMarkdownInputs(initialInputs);
  let root = null;
  let label = null;
  let toolbar = null;
  let editor = null;
  let editing = false;
  let lastCommittedValue = inputs.value;
  const styleButtons = new Map();
  const baseAddress = stateAddress || `nodes/${id}`;
  const scrollAddress = `${baseAddress}/scroll`;
  const scroll = createRetainedScrollController({
    state,
    address: scrollAddress,
    window: document?.defaultView || globalThis,
  });

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-control ui-node-markdown";
    root.dataset.uiNodeOwned = "markdown";
    if (stateAddress) root.dataset.uiStateAddress = stateAddress;
    label = document.createElement("span");
    label.className = "ui-node-control-label";
    toolbar = document.createElement("div");
    toolbar.className = "ui-node-markdown-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Text style");
    const heading = document.createElement("button");
    heading.type = "button";
    heading.dataset.uiMarkdownCommand = "h1";
    heading.title = "Heading";
    heading.textContent = "H";
    toolbar.append(heading);
    editor = document.createElement("div");
    editor.className = "ui-node-markdown-editor";
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.id = `ui-control-${id}`;
    root.append(label, toolbar, editor);
    root.addEventListener("contextmenu", onContextMenu);
    toolbar.addEventListener("pointerdown", onToolbarPointerDown);
    toolbar.addEventListener("click", onToolbarClick);
    editor.addEventListener("input", onInput);
    editor.addEventListener("blur", onBlur);
    editor.addEventListener("paste", onPaste);
    host.replaceChildren(root);
    update(inputs);
    scroll.attach(editor);
  }

  function update(nextInputs = {}) {
    inputs = normalizeMarkdownInputs(nextInputs);
    reconcileClassNames(root, inputs.presentation);
    label.textContent = inputs.label;
    root.classList.toggle("is-disabled", inputs.disabled);
    root.classList.toggle("is-significant", inputs.significant);
    if (inputs.presentation) root.dataset.uiPresentation = inputs.presentation;
    else delete root.dataset.uiPresentation;
    editor.contentEditable = inputs.disabled ? "false" : "true";
    editor.setAttribute("aria-label", inputs.label);
    reconcileStyleButtons();
    if (!editing && inputs.value !== lastCommittedValue) {
      editor.innerHTML = markdownToEditorHtml(inputs.value);
      lastCommittedValue = inputs.value;
    } else if (!editor.hasChildNodes()) {
      editor.innerHTML = markdownToEditorHtml(inputs.value);
    }
  }

  function reconcileStyleButtons() {
    const retained = new Set(inputs.styleControls.map((control) => control.id));
    for (const [controlId, button] of styleButtons) {
      if (retained.has(controlId)) continue;
      button.remove();
      styleButtons.delete(controlId);
    }
    inputs.styleControls.forEach((control, index) => {
      let button = styleButtons.get(control.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.uiMarkdownStyle = control.id;
        styleButtons.set(control.id, button);
      }
      button.textContent = control.label;
      button.title = control.title;
      button.disabled = inputs.disabled || control.disabled;
      button.setAttribute("aria-pressed", String(control.value));
      button.classList.toggle("is-enabled", control.value);
      button.classList.toggle(`is-${safeClass(control.id)}`, true);
      const position = index + 1;
      if (toolbar.children[position] !== button) toolbar.insertBefore(button, toolbar.children[position] || null);
    });
    toolbar.querySelector("[data-ui-markdown-command]").disabled = inputs.disabled;
  }

  function onToolbarPointerDown(event) {
    if (event.target.closest?.("button")) event.preventDefault();
  }

  function onToolbarClick(event) {
    const command = event.target.closest?.("[data-ui-markdown-command]");
    if (command && !command.disabled) {
      editor.focus();
      editor.ownerDocument.execCommand("formatBlock", false, command.dataset.uiMarkdownCommand.toUpperCase());
      commitEditorValue();
      return;
    }
    const style = event.target.closest?.("[data-ui-markdown-style]");
    if (!style || style.disabled) return;
    const descriptor = inputs.styleControls.find((control) => control.id === style.dataset.uiMarkdownStyle);
    if (descriptor) emit("style", { id: descriptor.id, value: !descriptor.value }, UI_COMMAND_PHASES.COMMIT);
  }

  function onInput() {
    editing = true;
    emit("change", { value: currentValue() }, UI_COMMAND_PHASES.CHANGE);
  }

  function onBlur() {
    commitEditorValue();
    editing = false;
  }

  function onPaste(event) {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    editor.ownerDocument.execCommand("insertText", false, text);
    onInput();
  }

  function commitEditorValue() {
    const value = currentValue();
    if (value === lastCommittedValue) return;
    lastCommittedValue = value;
    emit("change", { value }, UI_COMMAND_PHASES.COMMIT);
  }

  function currentValue() {
    return editorHtmlToMarkdown(editor.innerHTML, editor.ownerDocument);
  }

  function onContextMenu(event) {
    if (event.target.closest?.("button")) return;
    event.preventDefault();
    emit("context", { x: event.clientX, y: event.clientY });
  }

  function dispose() {
    scroll.dispose();
    root?.removeEventListener("contextmenu", onContextMenu);
    toolbar?.removeEventListener("pointerdown", onToolbarPointerDown);
    toolbar?.removeEventListener("click", onToolbarClick);
    editor?.removeEventListener("input", onInput);
    editor?.removeEventListener("blur", onBlur);
    editor?.removeEventListener("paste", onPaste);
    root?.remove();
    styleButtons.clear();
    root = null;
    label = null;
    toolbar = null;
    editor = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

export function markdownToEditorHtml(markdown = "") {
  return String(markdown || "").split(/\r?\n/).map((line) => {
    const heading = line.trim().match(/^(#{1,4})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`;
    return `<div>${inlineMarkdownToHtml(line) || "<br>"}</div>`;
  }).join("");
}

export function editorHtmlToMarkdown(html = "", documentRef = document) {
  const root = documentRef.createElement("div");
  root.innerHTML = String(html || "");
  return [...root.childNodes].map(blockNodeToMarkdown).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function blockNodeToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  if (/^h[1-4]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${inlineNodeToMarkdown(node).trim()}`;
  if (tag === "br") return "";
  return inlineNodeToMarkdown(node).replace(/\n+$/g, "");
}

function inlineNodeToMarkdown(node) {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  if (node.tagName.toLowerCase() === "br") return "\n";
  return [...node.childNodes].map(inlineNodeToMarkdown).join("");
}

function inlineMarkdownToHtml(text = "") {
  return escapeHtml(String(text || ""))
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function escapeHtml(text = "") {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizeMarkdownInputs(source = {}) {
  return {
    value: String(source.value || ""),
    label: String(source.label || "Text"),
    disabled: source.disabled === true,
    presentation: String(source.presentation || ""),
    significant: source.significant === true,
    styleControls: Object.freeze((source.styleControls || []).map((control) => Object.freeze({
      id: String(control?.id || ""),
      label: String(control?.label || control?.id || "Style"),
      title: String(control?.title || control?.label || control?.id || "Style"),
      value: control?.value === true,
      disabled: control?.disabled === true,
    })).filter((control) => control.id)),
  };
}

function reconcileClassNames(root, presentation) {
  root.className = ["ui-node-control", "ui-node-markdown", ...presentationClassNames(presentation)].join(" ");
}

function safeClass(value) {
  return String(value || "style").replace(/[^a-zA-Z0-9_-]+/g, "-");
}
