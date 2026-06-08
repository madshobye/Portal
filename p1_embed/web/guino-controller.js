import { initGuinoView } from "./guino.js?v=0.1.87-ui563";

export function createGuinoController({
  canvas,
  isConnected,
  sendCommand,
  logLine,
} = {}) {
  let view = null;

  function init() {
    view = initGuinoView({
      canvas,
      sendInput,
      requestRefresh: () => requestRefresh({ quiet: false }),
    });
    return view;
  }

  async function sendInput({ id, type, value }) {
    if (!isConnected()) throw new Error("UI is not connected");
    const channel = `ui.${String(id || "system").trim() || "system"}`;
    const message = type === "set" ? `set:${Math.round(Number(value) || 0)}` : String(type || "press");
    await sendCommand("script.input", { channel, message }, { timeoutMs: 5000, quiet: true });
  }

  async function requestRefresh({ quiet = false } = {}) {
    if (!isConnected()) return;
    try {
      await sendCommand("script.input", { channel: "ui.system", message: "hello" }, { timeoutMs: 5000, quiet: true });
      if (!quiet) logLine("info", "asked sketch to redraw UI");
    } catch (error) {
      if (!quiet) logLine("warn", `UI refresh failed: ${error.message}`);
    }
  }

  function acceptEvent(name, data) {
    view?.acceptEvent(name, data);
  }

  function clear() {
    view?.clear?.();
  }

  function clearForUploadEvent(data = {}) {
    const state = String(data.state || "").toLowerCase();
    const phase = String(data.phase || "").toLowerCase();
    if (state === "queued" || state === "compiling" || phase === "compile") clear();
  }

  function resize() {
    view?.resize?.();
  }

  function syncConnectionState(connected) {
    canvas?.setAttribute("aria-disabled", connected ? "false" : "true");
    view?.setConnected(connected);
  }

  return {
    acceptEvent,
    clear,
    clearForUploadEvent,
    init,
    requestRefresh,
    resize,
    sendInput,
    syncConnectionState,
  };
}
