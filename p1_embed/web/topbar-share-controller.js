import { renderQrCanvas } from "./qr-renderer.js?v=0.1.87-ui755";

export function createTopbarShareController({
  fields,
  documentRef,
  URLRef = URL,
  shareLinks,
  buildBugReport,
  copyText,
  logLine,
} = {}) {
  let currentLinks = { ui: "", mqtt: "" };

  function bind() {
    fields.topbarShareButton?.addEventListener("click", open);
    fields.topbarShareUiCopy?.addEventListener("click", () => copyLink("ui"));
    fields.topbarShareMqttCopy?.addEventListener("click", () => copyLink("mqtt"));
    fields.bugReportDownload?.addEventListener("click", downloadBugReport);
  }

  function open() {
    fields.shareDialog?.showModal();
    refresh();
  }

  async function refresh() {
    renderPending();
    try {
      currentLinks = await shareLinks();
      renderLink("ui", currentLinks.ui);
      renderLink("mqtt", currentLinks.mqtt);
    } catch (error) {
      renderLink("ui", "");
      renderLink("mqtt", "");
      logLine("warn", `share links not ready: ${error.message || error}`);
    }
  }

  function renderPending() {
    renderLink("ui", "");
    renderLink("mqtt", "");
    setInput(fields.topbarShareUiLink, "building link...");
  }

  function renderLink(kind, url = "") {
    const isMqtt = kind === "mqtt";
    const card = isMqtt ? fields.topbarShareMqttCard : fields.topbarShareUiCard;
    const input = isMqtt ? fields.topbarShareMqttLink : fields.topbarShareUiLink;
    const qr = isMqtt ? fields.topbarShareMqttQr : fields.topbarShareUiQr;
    const copy = isMqtt ? fields.topbarShareMqttCopy : fields.topbarShareUiCopy;
    const value = String(url || "").trim();
    card?.classList.toggle("is-hidden", !value);
    copy.disabled = !value;
    setInput(input, value || "not available");
    qr?.replaceChildren(value ? renderQrCanvas(value, { targetSize: 116, fallbackClass: "topbar-share-fallback" }) : emptyQr());
  }

  async function copyLink(kind) {
    const url = currentLinks[kind] || "";
    if (!url) return;
    try {
      await copyText(url);
      logLine("info", `${shareKindLabel(kind)} copied`);
    } catch (error) {
      logLine("error", error.message || "copy failed");
    }
  }

  function shareKindLabel(kind) {
    return kind === "mqtt" ? "Admin link" : "UI link";
  }

  async function downloadBugReport() {
    if (!buildBugReport) return;
    fields.bugReportDownload.disabled = true;
    try {
      const report = await buildBugReport(fields.bugReportDescription?.value || "");
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URLRef.createObjectURL(blob);
      const link = documentRef.createElement("a");
      link.href = url;
      link.download = `xobit-bug-report-${filenameTimestamp()}.json`;
      documentRef.body.append(link);
      link.click();
      link.remove();
      URLRef.revokeObjectURL(url);
      logLine("info", "bug report downloaded");
    } catch (error) {
      logLine("error", error.message || "bug report failed");
    } finally {
      fields.bugReportDownload.disabled = false;
    }
  }

  function setInput(input, value) {
    if (!input) return;
    input.value = value;
    input.title = value;
  }

  function emptyQr() {
    const element = document.createElement("div");
    element.className = "topbar-share-fallback";
    element.textContent = "not available";
    return element;
  }

  function filenameTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
  }

  return {
    bind,
    open,
    refresh,
  };
}
