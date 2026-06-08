export function createUploadStatusController({ statusRows, setRunWorking }) {
  let state = { phase: "", label: "", progress: 0 };
  let clearTimer = null;
  let localActiveUntil = 0;

  function markLocalActive(durationMs = 120000) {
    localActiveUntil = Date.now() + durationMs;
  }

  function updateFromEvent(data = {}) {
    if (Date.now() > localActiveUntil) return;
    const eventState = String(data.state || data.phase || "").toLowerCase();
    if (eventState === "queued") {
      setState("queued", "Upload received", 90);
    } else if (eventState === "compiling") {
      setState("compiling", "Compiling on board", 94);
    } else if (eventState === "running") {
      setState("running", "Running", 100, { autoClear: true });
    } else if (eventState === "saved" || eventState === "stored") {
      setState("saved", "Saved", 100, { autoClear: true });
    } else if (eventState === "error") {
      setState("error", errorLabel(data.message || data.code), 100, { autoClear: true });
    }
  }

  function errorLabel(message = "") {
    const text = String(message || "");
    if (/not enough contiguous heap|compile_memory_low|memory_low/i.test(text)) return "No Heap";
    return text || "Upload failed";
  }

  function setState(phase = "", label = "", progress = 0, { autoClear = false } = {}) {
    if (clearTimer) {
      window.clearTimeout(clearTimer);
      clearTimer = null;
    }

    state = {
      phase,
      label,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    };
    render();

    if (autoClear) {
      clearTimer = window.setTimeout(() => {
        clearTimer = null;
        state = { phase: "", label: "", progress: 0 };
        localActiveUntil = 0;
        render();
      }, phase === "error" ? 5200 : 2600);
    }
  }

  function render() {
    const active = Boolean(state.phase);
    const label = state.label || state.phase || "";
    const progress = state.progress || 0;
    statusRows.forEach(([wrap, labelEl, progressEl]) => {
      if (!wrap) return;
      const iconEl = wrap.querySelector(".upload-status-icon");
      wrap.classList.toggle("is-hidden", !active);
      wrap.classList.toggle("is-error", state.phase === "error");
      wrap.classList.toggle("is-complete", state.phase === "running" || state.phase === "saved");
      wrap.classList.toggle("is-active", active && state.phase !== "error");
      if (iconEl) {
        iconEl.textContent = state.phase === "error" ? "error" : (state.phase === "running" || state.phase === "saved" ? "check_circle" : "progress_activity");
      }
      if (labelEl) labelEl.textContent = label;
      if (progressEl) progressEl.value = progress;
    });

    setRunWorking(active && !["running", "saved", "error"].includes(state.phase));
  }

  return {
    markLocalActive,
    updateFromEvent,
    errorLabel,
    setState,
    render,
  };
}
