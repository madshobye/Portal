import { chainPasteTarget, clipboardPayloadForTarget, VJ1_CLIPBOARD_TYPE } from "../domain/clipboard.js";
import { isTextEditingNode } from "./dom-utils.js";

const VJ1_CLIPBOARD_TEXT_PREFIX = "VJ1_CLIPBOARD:";

export function createClipboardController({ root, store, getState, getInspector, importFiles, setStatus }) {
  let target = { kind: "media-library" };
  let internalClipboard = null;

  function bindWindowEvents() {
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", handleDrop);
    // Draggable chain rows can suppress their eventual click. Capture the
    // pressed target first so Copy always follows the element the user chose.
    window.addEventListener("pointerdown", rememberTarget, true);
    window.addEventListener("click", rememberTarget);
    window.addEventListener("copy", copyFromCurrentTarget);
    window.addEventListener("cut", cutFromCurrentTarget);
    window.addEventListener("paste", pasteIntoCurrentTarget);
    window.addEventListener("keydown", handleDeleteKeydown);
  }

  function setChainItemTarget(componentId, itemId) {
    setTarget({ kind: "chain-item", componentId, itemId });
  }

  function setTarget(next) {
    if (!next) return;
    target = next;
    root.dataset.pasteTarget = next.kind;
  }

  function preventDefault(event) {
    event.preventDefault();
  }

  async function handleDrop(event) {
    event.preventDefault();
    const destination = resolveTarget(event.target) || target;
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    const files = droppedFiles.length ? droppedFiles : await imageFilesFromTransfer(event.dataTransfer, "drop");
    if (files.length) await importExternalMedia(files, pasteDestination(destination));
  }

  function rememberTarget(event) {
    setTarget(resolveTarget(event.target));
  }

  function resolveTarget(node) {
    const state = getState();
    const element = node?.closest ? node : node?.parentElement;
    if (!element?.closest) return null;
    const chainItem = element.closest("[data-select-chain-item]");
    if (chainItem) {
      const chainOwner = chainItem.closest("[data-chain-reorder-list]");
      return {
        kind: "chain-item",
        componentId: chainOwner?.dataset.componentId || state.ui.selectedComponentId,
        itemId: chainItem.dataset.selectChainItem,
      };
    }
    const componentButton = element.closest("[data-select-component]");
    if (componentButton) {
      const component = state.components.find((item) => item.id === componentButton.dataset.selectComponent);
      return { kind: component?.type === "scene" ? "scene-list" : "component-list", itemId: component?.id || "" };
    }
    const mappingButton = element.closest("[data-select-mapping]");
    if (mappingButton) return { kind: "mapping-list", itemId: mappingButton.dataset.selectMapping };
    const surfaceButton = element.closest("[data-select-surface]");
    if (surfaceButton) return { kind: "surface-list", itemId: surfaceButton.dataset.selectSurface };
    const mediaButton = element.closest("[data-pick-source-media], [data-add-element-media]");
    if (mediaButton) return {
      kind: "media-item",
      itemId: mediaButton.dataset.pickSourceMedia || mediaButton.dataset.addElementMedia || "",
    };
    const scope = element.closest("[data-paste-scope]");
    if (scope) return { kind: scope.dataset.pasteScope };
    const chainList = element.closest("[data-chain-reorder-list]");
    if (chainList) return chainPasteTarget(state, chainList.dataset.componentId, state.ui.selectedChainItemId);
    if (element.closest(".studio-stage") || getInspector()?.contains?.(element)) {
      if (state.ui.workspace === "component" || state.ui.workspace === "scene") {
        return state.ui.selectedChainItemId
          ? { kind: "chain-item", componentId: state.ui.selectedComponentId, itemId: state.ui.selectedChainItemId }
          : chainPasteTarget(state, state.ui.selectedComponentId, "");
      }
    }
    return null;
  }

  function pasteDestination(value = target) {
    if (value.kind !== "chain-item") return value;
    return chainPasteTarget(getState(), value.componentId, value.itemId);
  }

  function copyFromCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const payload = clipboardPayloadForTarget(getState(), target);
    if (!payload) return;
    writeClipboardPayload(event, payload);
    setStatus(`Copied ${payload.value.name || payload.kind}`);
  }

  function writeClipboardPayload(event, payload) {
    internalClipboard = payload;
    const serialized = JSON.stringify(payload);
    try {
      event.clipboardData?.setData(VJ1_CLIPBOARD_TYPE, serialized);
    } catch (error) {
      console.warn("[VJ1_CLIPBOARD_CUSTOM_FORMAT_FAILED]", { fallback: "plain-text VJ1 clipboard payload", message: error?.message || String(error) });
    }
    event.clipboardData?.setData("text/plain", `${VJ1_CLIPBOARD_TEXT_PREFIX}${serialized}`);
    event.preventDefault();
  }

  function cutFromCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const previous = { ...target };
    const payload = clipboardPayloadForTarget(getState(), previous);
    if (!payload) return;
    writeClipboardPayload(event, payload);
    const removed = deleteTarget(previous);
    setStatus(removed ? `Cut ${payload.value.name || payload.kind}` : `Copied ${payload.value.name || payload.kind}`);
  }

  function handleDeleteKeydown(event) {
    if (isTextEditingNode(event.target) || isTextEditingNode(document.activeElement)) return;
    if (event.metaKey || event.ctrlKey || event.altKey || (event.key !== "Delete" && event.key !== "Backspace")) return;
    const payload = clipboardPayloadForTarget(getState(), target);
    if (!payload || !deleteTarget({ ...target })) return;
    event.preventDefault();
    setStatus(`Deleted ${payload.value.name || payload.kind}`);
  }

  function deleteTarget(value) {
    const before = clipboardPayloadForTarget(store.getState(), value);
    if (!before) return false;
    if (value.kind === "chain-item") store.removeChainItem?.(value.componentId, value.itemId);
    else if (value.kind === "component-list" || value.kind === "scene-list") store.removeComponent?.(value.itemId);
    else if (value.kind === "mapping-list") store.deleteMapping?.(value.itemId);
    else if (value.kind === "surface-list") store.removeSurface?.(value.itemId);
    else return false;
    const state = store.getState();
    const removed = !clipboardPayloadForTarget(state, value);
    if (removed) setTarget(targetAfterDelete(state, value));
    return removed;
  }

  async function pasteIntoCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const destination = pasteDestination(target);
    const plainText = event.clipboardData?.getData("text/plain") || "";
    const serialized = event.clipboardData?.getData(VJ1_CLIPBOARD_TYPE) ||
      (plainText.startsWith(VJ1_CLIPBOARD_TEXT_PREFIX) ? plainText.slice(VJ1_CLIPBOARD_TEXT_PREFIX.length) : "");
    const hasExternalImage = Array.from(event.clipboardData?.files || []).some((file) => file?.type?.startsWith("image/")) ||
      !!imageUrlFromTransfer(event.clipboardData);
    if (hasExternalImage || serialized || internalClipboard) event.preventDefault();
    const files = await imageFilesFromTransfer(event.clipboardData, "paste");
    if (files.length) {
      await importExternalMedia(files, destination);
      return;
    }
    let payload = null;
    try {
      const externalText = (plainText && !plainText.startsWith(VJ1_CLIPBOARD_TEXT_PREFIX) ? plainText : "") || event.clipboardData?.getData("text/html") || "";
      payload = serialized ? JSON.parse(serialized) : externalText ? null : internalClipboard;
    } catch (error) {
      console.warn("[VJ1_CLIPBOARD_PAYLOAD_PARSE_FAILED]", { fallback: "most recent internal clipboard item", message: error?.message || String(error) });
      payload = internalClipboard;
    }
    if (!payload) return;
    const result = store.pasteClipboard?.(payload, destination);
    if (result?.pasted) {
      setTarget(targetAfterPaste(getState(), result, destination));
      setStatus(`Pasted ${payload.kind}`);
    } else {
      setStatus(pasteFailureMessage(result?.reason));
    }
  }

  async function importExternalMedia(files, destination) {
    const result = await importFiles(files);
    if (!result?.imported) return;
    for (const mediaId of result.mediaIds || []) {
      const media = getState().media?.find((item) => item.id === mediaId);
      if (media?.type !== "image") continue;
      const pasted = store.pasteClipboard?.({ kind: "media", value: media }, destination);
      if (pasted?.pasted && destination.kind === "chain") destination = targetAfterPaste(getState(), pasted, destination);
    }
  }

  async function imageFilesFromTransfer(transfer, source = "paste") {
    const seenFiles = new Set();
    const direct = [
      ...Array.from(transfer?.files || []),
      ...Array.from(transfer?.items || []).map((item) => item.kind === "file" ? item.getAsFile?.() : null),
    ].filter((file) => {
      if (!file?.type?.startsWith("image/")) return false;
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (seenFiles.has(signature)) return false;
      seenFiles.add(signature);
      return true;
    });
    if (direct.length) return source === "paste" ? direct.map(uniqueClipboardImageFile) : direct;
    const url = imageUrlFromTransfer(transfer);
    if (!url) return [];
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return [];
      return [new File([blob], clipboardImageName(blob.type), { type: blob.type })];
    } catch (error) {
      setStatus(`Could not import pasted image: ${error.message || error}`);
      return [];
    }
  }

  return {
    bindWindowEvents,
    resolveTarget,
    setChainItemTarget,
    setTarget,
  };
}

function targetAfterDelete(state, target) {
  if (target.kind === "chain-item") {
    return state.ui.selectedChainItemId
      ? { kind: "chain-item", componentId: target.componentId, itemId: state.ui.selectedChainItemId }
      : { kind: "chain", componentId: target.componentId, itemId: "" };
  }
  if (target.kind === "component-list" || target.kind === "scene-list") {
    const component = state.components.find((item) => item.id === state.ui.selectedComponentId);
    return component ? { kind: component.type === "scene" ? "scene-list" : "component-list", itemId: component.id } : target;
  }
  if (target.kind === "mapping-list") return { kind: "mapping-list", itemId: state.ui.selectedMappingId || "" };
  if (target.kind === "surface-list") return { kind: "surface-list", itemId: state.ui.selectedSurfaceId || "" };
  return target;
}

function targetAfterPaste(state, result, previous) {
  if (result.kind === "chain-item") return previous.kind === "group"
    ? previous
    : { kind: "chain-item", componentId: previous.componentId || previous.itemId || "", itemId: result.id };
  if (result.kind === "component") {
    const component = state.components.find((item) => item.id === result.id);
    return { kind: component?.type === "scene" ? "scene-list" : "component-list", itemId: result.id };
  }
  if (result.kind === "mapping") return { kind: "mapping-list", itemId: result.id };
  if (result.kind === "surface") return { kind: "surface-list", itemId: result.id };
  return previous;
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

function uniqueClipboardImageFile(file) {
  const extension = String(file.name || "").match(/\.[a-z0-9]+$/i)?.[0] || imageExtension(file.type);
  return new File([file], `clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${extension}`, { type: file.type });
}

function clipboardImageName(type) {
  return `web-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${imageExtension(type)}`;
}

function imageExtension(type = "") {
  if (type.includes("jpeg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("svg")) return ".svg";
  return ".png";
}

function pasteFailureMessage(reason = "") {
  if (reason === "components-only-in-scene") return "Component references can only be pasted into a Scene";
  if (reason === "wrong-list") return "Paste into the matching Component or Scene list";
  if (reason === "library-only") return "Media kept in the library; click a Component or Scene preview to add it";
  return "This item cannot be pasted at the current target";
}
