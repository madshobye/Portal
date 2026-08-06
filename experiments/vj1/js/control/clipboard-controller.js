import { chainPasteTarget, clipboardPayloadForTarget } from "../domain/clipboard.js";

export function createClipboardController({ store, getState, importFiles, setStatus, onTargetChange = () => {} }) {
  let target = { kind: "media-library" };

  function setChainItemTarget(componentId, itemId) {
    setTarget({ kind: "chain-item", componentId, itemId });
  }

  function setTarget(next) {
    if (!next?.kind) return;
    target = next;
    onTargetChange(snapshot());
  }

  function setLocation(location = {}) {
    const scope = String(location.scope || "");
    const itemId = String(location.itemId || "");
    const state = getState();
    if (scope.startsWith("chain:")) {
      setTarget({ kind: "chain-item", componentId: scope.slice("chain:".length) || state.ui.selectedComponentId, itemId });
    } else if (["component-list", "scene-list", "mapping-list", "surface-list"].includes(scope)) {
      setTarget({ kind: scope, itemId });
    } else if (scope) setTarget({ kind: scope, itemId });
  }

  function snapshot() {
    return {
      target,
      payload: clipboardPayloadForTarget(getState(), target),
    };
  }

  function pasteDestination(value = target) {
    if (value.kind !== "chain-item") return value;
    return chainPasteTarget(getState(), value.componentId, value.itemId);
  }

  function cut() {
    const payload = clipboardPayloadForTarget(getState(), target);
    if (!payload) return false;
    const removed = deleteTarget({ ...target });
    setStatus(removed ? `Cut ${payload.value.name || payload.kind}` : `Copied ${payload.value.name || payload.kind}`);
    return removed;
  }

  function remove() {
    const payload = clipboardPayloadForTarget(getState(), target);
    if (!payload || !deleteTarget({ ...target })) return false;
    setStatus(`Deleted ${payload.value.name || payload.kind}`);
    return true;
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

  async function paste({ payload = null, files = [], imageUrl = "" } = {}) {
    const destination = pasteDestination(target);
    if (files.length || imageUrl) {
      await importExternalMedia(files, imageUrl, destination);
      return true;
    }
    if (!payload) return false;
    const result = store.pasteClipboard?.(payload, destination);
    if (result?.pasted) {
      setTarget(targetAfterPaste(getState(), result, destination));
      setStatus(`Pasted ${payload.kind}`);
    } else setStatus(pasteFailureMessage(result?.reason));
    return result?.pasted === true;
  }

  async function importExternalMedia(files, imageUrl, destination) {
    let externalFiles = files;
    if (!externalFiles.length && imageUrl) {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const blob = await response.blob();
        if (blob.type.startsWith("image/")) externalFiles = [new File([blob], `web-image-${Date.now()}.${imageExtension(blob.type)}`, { type: blob.type })];
      } catch (error) {
        setStatus(`Could not import pasted image: ${error.message || error}`);
        return;
      }
    }
    const result = await importFiles(externalFiles);
    if (!result?.imported) return;
    for (const mediaId of result.mediaIds || []) {
      const media = getState().media?.find((item) => item.id === mediaId);
      if (media?.type !== "image") continue;
      const pasted = store.pasteClipboard?.({ kind: "media", value: media }, destination);
      if (pasted?.pasted && destination.kind === "chain") destination = targetAfterPaste(getState(), pasted, destination);
    }
  }

  return Object.freeze({ setChainItemTarget, setTarget, setLocation, snapshot, cut, remove, paste });
}

function targetAfterDelete(state, target) {
  if (target.kind === "chain-item") return state.ui.selectedChainItemId
    ? { kind: "chain-item", componentId: target.componentId, itemId: state.ui.selectedChainItemId }
    : { kind: "chain", componentId: target.componentId, itemId: "" };
  if (target.kind === "component-list" || target.kind === "scene-list") {
    const component = state.components.find((item) => item.id === state.ui.selectedComponentId);
    return component ? { kind: component.type === "scene" ? "scene-list" : "component-list", itemId: component.id } : target;
  }
  if (target.kind === "mapping-list") return { kind: "mapping-list", itemId: state.ui.selectedMappingId || "" };
  if (target.kind === "surface-list") return { kind: "surface-list", itemId: state.ui.selectedSurfaceId || "" };
  return target;
}

function targetAfterPaste(state, result, previous) {
  if (result.kind === "chain-item") return previous.kind === "group" ? previous : { kind: "chain-item", componentId: previous.componentId || previous.itemId || "", itemId: result.id };
  if (result.kind === "component") {
    const component = state.components.find((item) => item.id === result.id);
    return { kind: component?.type === "scene" ? "scene-list" : "component-list", itemId: result.id };
  }
  if (result.kind === "mapping") return { kind: "mapping-list", itemId: result.id };
  if (result.kind === "surface") return { kind: "surface-list", itemId: result.id };
  return previous;
}

function imageExtension(type = "") {
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  return "png";
}

function pasteFailureMessage(reason = "") {
  if (reason === "components-only-in-scene") return "Component references can only be pasted into a Scene";
  if (reason === "wrong-list") return "Paste into the matching Component or Scene list";
  if (reason === "library-only") return "Media kept in the library; click a Component or Scene preview to add it";
  return "This item cannot be pasted at the current target";
}
