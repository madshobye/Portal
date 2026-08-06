import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";

const CLIPBOARD_TYPE = "application/x-vj1-item+json";
const TEXT_PREFIX = "VJ1_CLIPBOARD:";

export const ClipboardNode = defineUiNode({
  id: "core.ui.clipboard",
  name: "Clipboard",
  version: "0.1.0",
  description: "Owns browser clipboard and external image-drop mechanics and emits semantic edit commands.",
  inlets: {
    target: { type: "record", optional: true },
    payload: { type: "record", optional: true },
  },
  outlets: {
    target: { type: "event", optional: true },
    cut: { type: "event", optional: true },
    delete: { type: "event", optional: true },
    paste: { type: "event", optional: true },
  },
  events: ["target", "cut", "delete", "paste"],
  capabilities: ["clipboard", "external-file-drop", "browser-resource-owner"],
  factory: createClipboardInstance,
});

export function createClipboardInstance({ inputs: initialInputs = {}, document, emit }) {
  let inputs = normalizeInputs(initialInputs);
  let internalPayload = null;

  function mount() {
    document.addEventListener("pointerdown", rememberTarget, true);
    document.addEventListener("click", rememberTarget, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCut, true);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("dragover", preventDefault, true);
    document.addEventListener("drop", onDrop, true);
  }

  function update(nextInputs = {}) {
    inputs = normalizeInputs(nextInputs);
  }

  function rememberTarget(event) {
    const location = locationFromTarget(event.target);
    if (location) emit("target", location, UI_COMMAND_PHASES.COMMIT);
  }

  function onCopy(event) {
    if (isTextEditingTarget(document.activeElement) || !inputs.payload) return;
    write(event, inputs.payload);
  }

  function onCut(event) {
    if (isTextEditingTarget(document.activeElement) || !inputs.payload) return;
    write(event, inputs.payload);
    emit("cut", {}, UI_COMMAND_PHASES.COMMIT);
  }

  function write(event, payload) {
    internalPayload = payload;
    const serialized = JSON.stringify(payload);
    try { event.clipboardData?.setData(CLIPBOARD_TYPE, serialized); } catch {}
    event.clipboardData?.setData("text/plain", `${TEXT_PREFIX}${serialized}`);
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (isTextEditingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!inputs.payload) return;
    event.preventDefault();
    emit("delete", {}, UI_COMMAND_PHASES.COMMIT);
  }

  async function onPaste(event) {
    if (isTextEditingTarget(document.activeElement)) return;
    const transfer = event.clipboardData;
    const data = transferPayload(transfer, internalPayload, true);
    if (!data.payload && !data.files.length && !data.imageUrl) return;
    event.preventDefault();
    emit("paste", data, UI_COMMAND_PHASES.COMMIT);
  }

  function preventDefault(event) {
    event.preventDefault();
  }

  function onDrop(event) {
    event.preventDefault();
    const location = locationFromTarget(event.target);
    if (location) emit("target", location, UI_COMMAND_PHASES.COMMIT);
    const data = transferPayload(event.dataTransfer, null, false);
    if (data.payload || data.files.length || data.imageUrl) emit("paste", data, UI_COMMAND_PHASES.COMMIT);
  }

  function dispose() {
    document.removeEventListener("pointerdown", rememberTarget, true);
    document.removeEventListener("click", rememberTarget, true);
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("cut", onCut, true);
    document.removeEventListener("paste", onPaste, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("dragover", preventDefault, true);
    document.removeEventListener("drop", onDrop, true);
  }

  return Object.freeze({ mount, update, dispose });
}

function normalizeInputs(inputs = {}) {
  return { target: inputs.target || null, payload: inputs.payload || null };
}

function locationFromTarget(node) {
  const element = node?.closest ? node : node?.parentElement;
  if (!element?.closest) return null;
  const item = element.closest("[data-ui-list-select]");
  const scope = item?.closest?.("[data-paste-scope]")?.dataset?.pasteScope || element.closest("[data-paste-scope]")?.dataset?.pasteScope || "";
  return scope ? { scope, itemId: String(item?.dataset?.uiListSelect || "") } : null;
}

function transferPayload(transfer, fallback, uniqueFiles) {
  const plain = transfer?.getData?.("text/plain") || "";
  const serialized = transfer?.getData?.(CLIPBOARD_TYPE) || (plain.startsWith(TEXT_PREFIX) ? plain.slice(TEXT_PREFIX.length) : "");
  let payload = fallback;
  try { if (serialized) payload = JSON.parse(serialized); } catch {}
  const seen = new Set();
  const files = [...Array.from(transfer?.files || []), ...Array.from(transfer?.items || []).map((item) => item.kind === "file" ? item.getAsFile?.() : null)]
    .filter((file) => {
      if (!file?.type?.startsWith("image/")) return false;
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((file) => uniqueFiles ? new File([file], `clipboard-${Date.now()}-${file.name || "image"}`, { type: file.type }) : file);
  return { payload, files, imageUrl: files.length ? "" : imageUrlFromTransfer(transfer) };
}

function imageUrlFromTransfer(transfer) {
  const html = transfer?.getData?.("text/html") || "";
  if (html && typeof DOMParser !== "undefined") {
    const src = new DOMParser().parseFromString(html, "text/html").querySelector("img")?.src;
    if (src) return src;
  }
  const text = (transfer?.getData?.("text/uri-list") || transfer?.getData?.("text/plain") || "").trim().split(/\r?\n/)[0];
  return /^(https?:|data:image\/)/i.test(text) ? text : "";
}

function isTextEditingTarget(node) {
  if (!node) return false;
  const tag = String(node.tagName || "").toLowerCase();
  return node.isContentEditable === true || tag === "textarea" || tag === "select" || (tag === "input" && !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(String(node.type || "text").toLowerCase()));
}
