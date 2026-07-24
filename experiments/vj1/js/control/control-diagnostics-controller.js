import { setClass, setText } from "./dom-utils.js?v=scroll-region-1";
import { esc, icon } from "./template-utils.js?v=power-flicker-1";

export function createControlDiagnosticsController({
  diagnostics,
  getRefs,
  replaceHtmlIfChanged,
  setStatus = () => {},
} = {}) {
  let open = false;
  let snapshot = diagnostics?.summary?.() || emptyDiagnosticsSummary();

  function mount() {
    diagnostics?.subscribe?.((nextSnapshot) => {
      snapshot = nextSnapshot || emptyDiagnosticsSummary();
      render();
    });
  }

  function toggle() {
    open = !open;
    render();
  }

  function close() {
    if (!open) return;
    open = false;
    render();
  }

  function render() {
    const refs = getRefs?.() || {};
    if (!refs.diagnosticsToggle || !refs.diagnosticsSummaryContent) return;
    const current = snapshot || emptyDiagnosticsSummary();
    const level = current.level || "ok";
    const iconName = level === "error" ? "error" : level === "warning" ? "warning" : level === "info" ? "info" : "check_circle";
    const count = (current.counts?.info || 0) + (current.counts?.warning || 0) + (current.counts?.error || 0);
    const errorCount = Math.max(0, Number(current.counts?.error) || 0);
    const warningCount = Math.max(0, Number(current.counts?.warning) || 0);
    const displayedCount = errorCount > 0 ? errorCount : warningCount;
    setText(refs.diagnosticsIcon, iconName);
    setText(refs.diagnosticsCount, String(Math.min(999, displayedCount)));
    setClass(refs.diagnosticsCount, "is-hidden", displayedCount === 0);
    refs.diagnosticsToggle.classList.remove("is-ok", "is-info", "is-warning", "is-error");
    refs.diagnosticsToggle.classList.add(`is-${level}`);
    refs.diagnosticsToggle.title = level === "ok" ? "Diagnostics: OK" : `Diagnostics: ${count} entr${count === 1 ? "y" : "ies"}`;
    refs.diagnosticsToggle.setAttribute("aria-label", level === "ok" ? "Open diagnostics, status OK" : `Open diagnostics, ${count} entries, status ${level}`);
    refs.diagnosticsToggle.setAttribute("aria-expanded", open ? "true" : "false");
    setClass(refs.diagnosticsSummary, "is-hidden", !open);
    if (!open) return;
    const entries = current.entries || [];
    replaceHtmlIfChanged(refs.diagnosticsSummaryContent, `
      <div class="diagnostics-summary-header">
        <span><strong>Diagnostics</strong><small>${entries.length ? `${count} captured entr${count === 1 ? "y" : "ies"}` : "No relevant console entries"}</small></span>
        <span class="diagnostics-state is-${esc(level)}">${icon(iconName)} ${esc(level === "ok" ? "OK" : level)}</span>
      </div>
      <ol class="diagnostics-entry-list" data-scroll-region data-scroll-key="diagnostics-entries">
        ${entries.length ? entries.slice().reverse().map(diagnosticEntryTemplate).join("") : `<li class="diagnostics-empty">${icon("check_circle")} Everything looks OK.</li>`}
      </ol>
      <div class="diagnostics-actions">
        <button type="button" data-diagnostics-clear ${entries.length ? "" : "disabled"}>${icon("delete_sweep")} Clear</button>
        <button type="button" data-diagnostics-copy ${entries.length ? "" : "disabled"}>${icon("content_copy")} Copy</button>
      </div>`);
  }

  async function handleClick(event) {
    event.stopPropagation();
    if (event.target.closest("[data-diagnostics-clear]")) {
      diagnostics?.clear?.();
      return;
    }
    if (!event.target.closest("[data-diagnostics-copy]")) return;
    const text = diagnostics?.copyText?.() || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Diagnostics copied");
    } catch (error) {
      setStatus(`Could not copy diagnostics: ${error?.message || error}`);
    }
  }

  return { close, handleClick, mount, render, toggle };
}

function emptyDiagnosticsSummary() {
  return { level: "ok", counts: { info: 0, warning: 0, error: 0 }, entries: [] };
}

function diagnosticEntryTemplate(entry) {
  const time = new Date(entry.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const count = entry.count > 1 ? `<span class="diagnostics-repeat">×${entry.count}</span>` : "";
  const source = entry.source ? `<span class="diagnostics-source">${esc(entry.source)}</span>` : "";
  return `<li class="is-${esc(entry.level)}"><header><span>${icon(diagnosticIcon(entry.level))}<strong>${esc(entry.level)}</strong>${source}</span><span>${esc(time)} ${count}</span></header><pre>${esc(entry.message)}</pre></li>`;
}

function diagnosticIcon(level) {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "info";
}
