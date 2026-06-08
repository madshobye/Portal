export function createConsoleController({
  consoleElement,
  debugLevel,
  maxLines = 500,
  timestampsEnabled,
  copyText,
  onLog,
} = {}) {
  let lines = [];

  function logLine(level, message) {
    if (!levelVisible(level)) return;
    const stamp = new Date().toLocaleTimeString();
    lines.push({ level, stamp, message: String(message) });
    if (lines.length > maxLines) lines = lines.slice(-maxLines);
    render();
  }

  function levelVisible(level) {
    const values = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
    const current = values[debugLevel?.value || "info"] ?? 2;
    const value = values[level] ?? 2;
    return value <= current;
  }

  function logJson(level, data) {
    if (level === "trace" && debugLevel?.value !== "trace") return;
    logLine(level, JSON.stringify(data));
  }

  function render() {
    consoleElement.replaceChildren(
      ...lines.map((line) => {
        const row = document.createElement("span");
        const icon = document.createElement("span");
        const time = document.createElement("span");
        const text = document.createElement("span");
        const visual = visualLine(line);

        row.className = `console-line line-${line.level}`;
        row.title = formatLine(line);
        icon.className = "material-symbols-rounded console-icon";
        icon.textContent = visual.icon;
        time.className = "console-time";
        time.textContent = timestampsEnabled() ? line.stamp || "" : "";
        text.className = "console-text";
        text.textContent = `${visual.text}\n`;
        row.append(icon, time, text);
        return row;
      }),
    );
    consoleElement.scrollTop = consoleElement.scrollHeight;
  }

  function visualLine(line) {
    const level = String(line.level || "info");
    const message = String(line.message || "");
    const icon = iconForLine(level, message);
    return { icon, text: simplifyMessage(level, message) };
  }

  function iconForLine(level, message) {
    if (level === "error") return "error";
    if (level === "warn") return "warning";
    if (level === "debug" || level === "trace") return "bug_report";
    if (message.startsWith("script.print:")) return "notes";
    if (message.startsWith("script.state:")) return "radio_button_checked";
    if (message.startsWith("wifi.status:")) return "wifi";
    if (message.startsWith("websocket.")) return "lan";
    if (message.startsWith("webrtc.")) return "hub";
    return "info";
  }

  function simplifyMessage(level, message) {
    const raw = String(message || "");
    const body = raw.replace(/^[^:]+:\s*/, "");

    if (raw.startsWith("script.state:")) return titleCaseFirst(body.split(" / ")[0] || body);
    if (raw.startsWith("script.print:")) return body;
    if (raw.startsWith("script.error:")) return `Script error: ${body}`;
    if (raw.startsWith("wifi.status:")) return `WiFi ${body}`;
    if (raw.startsWith("websocket.status:")) return `WebSocket ${body}`;
    if (raw.startsWith("websocket.client:")) return `WebSocket ${body}`;
    if (raw.startsWith("webrtc.")) return `WebRTC ${body}`;
    if (raw.startsWith("device.boot:")) return "Device boot";
    if (level === "error") return raw.startsWith("Error ") ? raw : `Error ${raw}`;
    if (level === "warn") return raw.startsWith("Warning ") ? raw : `Warning ${raw}`;
    return raw;
  }

  function titleCaseFirst(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return `${text[0].toUpperCase()}${text.slice(1)}`;
  }

  function formatLine(line) {
    if (line.text) return timestampsEnabled() ? line.text : line.text.replace(/^\[[^\]]+\]\s+/, "");
    const prefix = timestampsEnabled() ? `[${line.stamp}] ` : "";
    return `${prefix}${String(line.level || "info").toUpperCase()} ${line.message || ""}`;
  }

  function clear() {
    lines = [];
    render();
  }

  async function copy() {
    const text = lines.map((line) => formatLine(line)).join("\n");
    try {
      await copyText(text);
      onLog("info", "console copied");
    } catch (error) {
      onLog("error", error.message || "copy failed");
    }
  }

  function recentFormatted(limit = 100) {
    return lines.slice(-limit).map((line) => formatLine(line));
  }

  return {
    clear,
    copy,
    formatLine,
    levelVisible,
    logJson,
    logLine,
    recentFormatted,
    render,
  };
}
