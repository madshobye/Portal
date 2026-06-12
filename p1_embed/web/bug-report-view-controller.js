function clearElement(element) {
  if (!element) return;
  element.replaceChildren();
}

function textValue(value, fallback = "missing") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function codeBlock(value) {
  if (Array.isArray(value)) return value.map((item) => textValue(item, "")).filter(Boolean).join("\n");
  return textValue(value, "");
}

function byteCount(value = "") {
  return new Blob([String(value || "")]).size;
}

function revisionFrom(report = {}) {
  const revision = report.project?.revision || report.revision || null;
  return revision && typeof revision === "object" ? revision : {};
}

function chatText(chat = []) {
  if (!Array.isArray(chat)) return codeBlock(chat);
  return chat
    .map((entry) => {
      const role = entry?.role || entry?.type || "message";
      const content = entry?.content ?? entry?.text ?? entry?.message ?? entry;
      return `${role}: ${textValue(content, "")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function metric(label, value) {
  const article = document.createElement("article");
  article.className = "bug-report-stat";
  const key = document.createElement("span");
  key.textContent = label;
  const data = document.createElement("strong");
  data.textContent = textValue(value);
  article.append(key, data);
  return article;
}

function section(title, value, { className = "" } = {}) {
  const article = document.createElement("article");
  article.className = `bug-report-section ${className}`.trim();
  const heading = document.createElement("h2");
  heading.textContent = title;
  const pre = document.createElement("pre");
  pre.textContent = codeBlock(value) || "missing";
  article.append(heading, pre);
  return article;
}

function compactStatus(status = {}) {
  if (!status || typeof status !== "object") return "";
  return {
    deviceName: status.deviceName,
    deviceId: status.deviceId,
    scriptState: status.scriptState,
    runState: status.scriptRunState,
    fps: status.wrenchLoopFps,
    freeHeap: status.freeHeap,
    mqtt: status.mqtt ? {
      enabled: status.mqtt.enabled,
      configured: status.mqtt.configured,
      connected: status.mqtt.connected,
      authRequired: status.mqtt.authRequired,
      onlineAuthUsers: status.mqtt.onlineAuthUsers,
      anonymousUi: status.mqtt.anonymousUi,
      anonymousScript: status.mqtt.anonymousScript,
    } : null,
  };
}

export function createBugReportViewController({
  dropZone,
  fileInput,
  summary,
  content,
  logLine,
} = {}) {
  let bound = false;

  function bind() {
    if (bound) return;
    bound = true;
    dropZone?.addEventListener("dragover", handleDragOver);
    dropZone?.addEventListener("dragleave", handleDragLeave);
    dropZone?.addEventListener("drop", handleDrop);
    fileInput?.addEventListener("change", handleFileInput);
  }

  function handleDragOver(event) {
    event.preventDefault();
    dropZone?.classList.add("is-dragging");
  }

  function handleDragLeave() {
    dropZone?.classList.remove("is-dragging");
  }

  function handleDrop(event) {
    event.preventDefault();
    dropZone?.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0] || null;
    if (file) loadFile(file);
  }

  function handleFileInput() {
    const file = fileInput?.files?.[0] || null;
    if (file) loadFile(file);
    if (fileInput) fileInput.value = "";
  }

  async function loadFile(file) {
    try {
      const text = await file.text();
      renderReport(JSON.parse(text));
      logLine?.("info", `bug report loaded: ${file.name}`);
    } catch (error) {
      renderError(error);
      logLine?.("error", `bug report load failed: ${error?.message || error}`);
    }
  }

  function renderError(error) {
    clearElement(summary);
    clearElement(content);
    content?.append(section("Could not read report", error?.message || String(error)));
  }

  function renderReport(report = {}) {
    const revision = revisionFrom(report);
    const logs = Array.isArray(report.logs) ? report.logs : [];
    const code = revision.code || "";
    const specification = revision.specification || revision.spec || "";
    const chat = revision.chat || revision.chatTranscript || [];
    clearElement(summary);
    clearElement(content);
    summary?.append(
      metric("Created", report.createdAt || "unknown"),
      metric("Web", report.app?.webVersion || "unknown"),
      metric("MQTT", report.app?.mqttVersion || "unknown"),
      metric("View", report.ui?.activeView || "unknown"),
      metric("Transport", report.connection?.transport?.kind || report.connection?.transport || "none"),
      metric("Logs", logs.length),
      metric("Code", `${byteCount(code)} bytes`),
      metric("Spec", `${String(specification).length} chars`),
      metric("Chat", Array.isArray(chat) ? chat.length : "present"),
    );
    content?.append(
      section("Description", report.description || "No description was included."),
      section("Current revision", {
        project: report.project?.name || report.project?.id || "",
        revision: revision.name || revision.id || "",
        codeBytes: byteCount(code),
        specificationChars: String(specification || "").length,
        chatMessages: Array.isArray(chat) ? chat.length : 0,
      }),
      section("App state", {
        app: report.app || {},
        ui: report.ui || {},
        connection: {
          busy: report.connection?.busy,
          verified: report.connection?.verified,
          hasClient: report.connection?.hasClient,
          transport: report.connection?.transport || null,
        },
      }),
      section("Device status", compactStatus(report.connection?.status)),
      section("Log", logs),
      section("Code", code, { className: "bug-report-code" }),
      section("Specification", specification),
      section("Chat", chatText(chat)),
    );
  }

  return {
    bind,
    renderReport,
  };
}
