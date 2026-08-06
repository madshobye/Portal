import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";

export const GlobalInputNode = defineUiNode({
  id: "core.ui.global-input",
  name: "Global input",
  version: "0.1.0",
  description: "Owns application-wide browser input and emits semantic UI commands.",
  inlets: {
    mediaQuery: { type: "string", optional: true },
  },
  outlets: {
    shortcut: { type: "event", optional: true },
    interaction: { type: "event", optional: true },
    viewport: { type: "event", optional: true },
    lifecycle: { type: "event", optional: true },
  },
  events: ["shortcut", "interaction", "viewport", "lifecycle"],
  capabilities: ["global-input", "keyboard-shortcuts", "interaction-lifecycle", "viewport-observer", "page-lifecycle"],
  factory: createGlobalInputInstance,
});

export function createGlobalInputInstance({ inputs: initialInputs = {}, document, emit }) {
  let inputs = normalizeInputs(initialInputs);
  let media = null;

  function mount() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.defaultView?.addEventListener?.("pagehide", onPageHide);
    observeMediaQuery();
  }

  function update(nextInputs = {}) {
    const next = normalizeInputs(nextInputs);
    if (next.mediaQuery !== inputs.mediaQuery) {
      inputs = next;
      observeMediaQuery();
      return;
    }
    inputs = next;
  }

  function onKeyDown(event) {
    if (isTextEditingTarget(event.target) || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (String(event.key || "").toLowerCase() !== "z") return;
    event.preventDefault();
    emit("shortcut", { id: event.shiftKey ? "redo" : "undo" }, UI_COMMAND_PHASES.COMMIT);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !isInteractiveTarget(event.target)) return;
    emit("interaction", { kind: "pointer", active: true }, UI_COMMAND_PHASES.BEGIN);
  }

  function onPointerEnd() {
    emit("interaction", { kind: "pointer", active: false }, UI_COMMAND_PHASES.COMMIT);
  }

  function onFocusIn(event) {
    if (!isTextEditingTarget(event.target) || event.target?.tagName === "SELECT") return;
    emit("interaction", { kind: "editor", active: true }, UI_COMMAND_PHASES.BEGIN);
  }

  function onFocusOut(event) {
    if (!isTextEditingTarget(event.target) || event.target?.tagName === "SELECT") return;
    emit("interaction", { kind: "editor", active: false }, UI_COMMAND_PHASES.COMMIT);
  }

  function observeMediaQuery() {
    media?.removeEventListener?.("change", onMediaChange);
    media = inputs.mediaQuery ? document.defaultView?.matchMedia?.(inputs.mediaQuery) || null : null;
    media?.addEventListener?.("change", onMediaChange);
    onMediaChange();
  }

  function onMediaChange() {
    emit("viewport", { matches: media?.matches === true }, UI_COMMAND_PHASES.COMMIT);
  }

  function onPageHide() {
    emit("lifecycle", { kind: "pagehide" }, UI_COMMAND_PHASES.COMMIT);
  }

  function dispose() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerEnd, true);
    document.removeEventListener("pointercancel", onPointerEnd, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.defaultView?.removeEventListener?.("pagehide", onPageHide);
    media?.removeEventListener?.("change", onMediaChange);
    media = null;
  }

  return Object.freeze({ mount, update, dispose });
}

function normalizeInputs(inputs = {}) {
  return { mediaQuery: String(inputs.mediaQuery || "") };
}

function isTextEditingTarget(node) {
  if (!node) return false;
  const tag = String(node.tagName || "").toLowerCase();
  return node.isContentEditable === true || tag === "textarea" || tag === "select" || (tag === "input" && !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(String(node.type || "text").toLowerCase()));
}

function isInteractiveTarget(node) {
  return Boolean(node?.closest?.("button, input, select, textarea, [contenteditable='true'], [role='button'], [role='slider'], [role='option']"));
}
