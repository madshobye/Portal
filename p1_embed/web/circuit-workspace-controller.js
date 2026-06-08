import {
  normalizeCircuitBoardType,
  upsertCircuitBoardPlacementComment,
} from "./circuit-code-comments.js?v=0.1.87-ui559";

function normalizeCircuitArtMode(mode) {
  return mode === "illustrations" ? "illustrations" : "symbols";
}

function normalizeCircuitRoutingMode(mode) {
  return mode === "embroidery" ? "embroidery" : "orthogonal";
}

export function createCircuitWorkspaceController({
  artModeButton,
  routingModeButton,
  boardSelect,
  downloadButton,
  storageKeys,
  getCircuitView,
  getCode,
  setCode,
  onCircuitLayoutInvalidated,
  onCircuitStatus,
  timestampForFilename,
  logLine,
} = {}) {
  function bind() {
    artModeButton?.addEventListener("click", toggleArtMode);
    routingModeButton?.addEventListener("click", toggleRoutingMode);
    boardSelect?.addEventListener("change", () => setBoardType(boardSelect.value));
    downloadButton?.addEventListener("click", downloadDiagram);
  }

  function restorePreferences() {
    setArtMode(normalizeCircuitArtMode(localStorage.getItem(storageKeys.artMode)), { persist: false });
    setRoutingMode(normalizeCircuitRoutingMode(localStorage.getItem(storageKeys.routingMode)), { persist: false });
    setBoardType(normalizeCircuitBoardType(localStorage.getItem(storageKeys.boardType)), { persist: false });
  }

  function toggleArtMode() {
    const current = normalizeCircuitArtMode(localStorage.getItem(storageKeys.artMode));
    setArtMode(current === "illustrations" ? "symbols" : "illustrations");
  }

  function setArtMode(mode, { persist = true } = {}) {
    const next = normalizeCircuitArtMode(mode);
    if (persist) localStorage.setItem(storageKeys.artMode, next);
    getCircuitView()?.setRenderMode?.(next);
    const illustrated = next === "illustrations";
    artModeButton?.classList.toggle("is-active", illustrated);
    artModeButton?.setAttribute("aria-pressed", illustrated ? "true" : "false");
    artModeButton?.setAttribute("title", illustrated ? "Circuit illustration mode" : "Circuit symbol mode");
    artModeButton?.querySelector(".material-symbols-rounded")?.replaceChildren(document.createTextNode(illustrated ? "image" : "category"));
  }

  function toggleRoutingMode() {
    const current = normalizeCircuitRoutingMode(localStorage.getItem(storageKeys.routingMode));
    setRoutingMode(current === "embroidery" ? "orthogonal" : "embroidery");
  }

  function setRoutingMode(mode, { persist = true } = {}) {
    const next = normalizeCircuitRoutingMode(mode);
    if (persist) localStorage.setItem(storageKeys.routingMode, next);
    getCircuitView()?.setRoutingMode?.(next);
    const experimental = next === "embroidery";
    routingModeButton?.classList.toggle("is-active", experimental);
    routingModeButton?.setAttribute("aria-pressed", experimental ? "true" : "false");
    routingModeButton?.setAttribute("title", experimental ? "Experimental embroidery routing" : "Orthogonal routing");
    routingModeButton?.querySelector(".material-symbols-rounded")?.replaceChildren(document.createTextNode(experimental ? "gesture" : "route"));
  }

  function setBoardType(type, { persist = true, updateCode = true } = {}) {
    const next = normalizeCircuitBoardType(type);
    if (persist) localStorage.setItem(storageKeys.boardType, next);
    if (boardSelect) boardSelect.value = next;
    getCircuitView()?.setBoardType?.(next);
    if (!persist || !updateCode) return;
    const current = getCode();
    const updated = upsertCircuitBoardPlacementComment(current, next);
    if (updated === current) return;
    setCode(updated);
    onCircuitLayoutInvalidated?.();
    onCircuitStatus?.("board type saved");
  }

  function downloadDiagram() {
    const ok = getCircuitView()?.downloadPng?.(`xobit-circuit-${timestampForFilename()}.png`);
    logLine(ok ? "info" : "warn", ok ? "circuit diagram downloaded" : "circuit diagram not ready");
  }

  return {
    bind,
    restorePreferences,
    setBoardType,
  };
}
