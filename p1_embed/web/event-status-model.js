export function createEventLogFilter({ getBusyLabel } = {}) {
  let lastConsoleEventSignature = "";
  let lastConsoleEventAt = 0;
  let lastWifiConsoleKey = "";
  let lastWifiConsoleAt = 0;

  function shouldLogEvent(name, data = {}, message = "") {
    if (name === "wifi.status") {
      return shouldLogWifiEvent(data);
    }

    if (name === "script.state") {
      const state = data.state || data.scriptState || "";
      if (getBusyLabel?.() === "uploading" && (state === "stopped" || state === "compiled")) return false;
    }

    if (name === "ui.value" || name === "ui.text") return false;

    const signature = `${name}:${message}`;
    const now = Date.now();
    if (signature === lastConsoleEventSignature && now - lastConsoleEventAt < 2500) return false;
    lastConsoleEventSignature = signature;
    lastConsoleEventAt = now;
    return true;
  }

  function shouldLogWifiEvent(data = {}) {
    const wifi = wifiConsoleState(data);
    const now = Date.now();
    const changed = wifi.key !== lastWifiConsoleKey;
    const canRepeat = wifi.repeatMs > 0 && now - lastWifiConsoleAt >= wifi.repeatMs;
    if (!changed && !canRepeat) return false;
    lastWifiConsoleKey = wifi.key;
    lastWifiConsoleAt = now;
    return true;
  }

  return { shouldLogEvent, shouldLogWifiEvent };
}

export function eventLogLevel(name = "", data = {}) {
  if (name?.startsWith("ui.")) return "debug";
  if (data.consoleLevel) return data.consoleLevel;
  if (data.level === "system") return "debug";
  if (data.level) return data.level;
  if (name?.includes("error")) return "error";
  if (name === "script.upload") {
    const state = String(data.state || data.phase || "").toLowerCase();
    return state === "error" ? "error" : "debug";
  }
  if (name?.startsWith("webrtc.")) {
    const state = String(data.state || data.status || "").toLowerCase();
    if (state.includes("fail") || state.includes("error")) return "error";
    return "debug";
  }
  return "info";
}

export function eventMessage(name, data = {}) {
  if (name === "script.state") {
    return [
      data.state || data.scriptState || "unknown",
      data.source ? `source ${data.source}` : "",
      data.autorun ? String(data.autorun).replaceAll("_", " ") : "",
      data.bootReason ? String(data.bootReason).replaceAll("_", " ") : "",
    ].filter(Boolean).join(" / ");
  }

  if (name === "wifi.status") {
    return wifiConsoleState(data).message;
  }

  if (name === "led.status") {
    return data.status || data.message || data.code || "updated";
  }

  if (name === "script.upload") {
    return [
      data.state || "upload",
      data.phase ? `phase ${data.phase}` : "",
      data.scriptBytes ? `${data.scriptBytes} bytes` : "",
      data.message || "",
    ].filter(Boolean).join(" / ");
  }

  if (name === "ui.item") {
    return [data.type || "item", data.id || "", data.label || ""].filter(Boolean).join(" / ");
  }

  if (name === "ui.value") {
    return [data.id || "", data.value ?? ""].filter((part) => part !== "").join(" = ");
  }

  return data.message || data.code || data.status || data.state || name;
}

export function wifiConsoleState(data = {}) {
  const rawStatus = String(data.status || data.state || "").toLowerCase();
  const ssid = String(data.ssid || "").trim();
  const ip = String(data.ip || "").trim();
  const connected = data.connected === true || rawStatus === "connected";
  let group = rawStatus || "unknown";
  let label = rawStatus || "unknown";
  let repeatMs = 0;

  if (connected) {
    group = "connected";
    label = "connected";
  } else if (rawStatus.includes("connecting") || rawStatus === "reconnecting") {
    group = "connecting";
    label = "connecting";
    repeatMs = 30000;
  } else if (rawStatus.includes("fail")) {
    group = "failed";
    label = "connect failed";
  } else if (["disconnected", "no_ssid", "idle", "off"].includes(rawStatus)) {
    group = "disconnected";
    label = "disconnected";
  }

  const parts = [label, ssid, connected && ip && ip !== "0.0.0.0" ? ip : ""].filter(Boolean);
  return {
    key: `wifi:${group}:${ssid}:${connected ? ip : ""}`,
    message: parts.join(" / "),
    repeatMs,
  };
}

export function mergeStatusSnapshot(previous = {}, next = {}) {
  const merged = { ...(previous || {}), ...(next || {}) };
  for (const key of ["wifi", "web", "webrtc", "led", "memory", "lastError", "wrenchRuntime"]) {
    if (!Object.prototype.hasOwnProperty.call(next, key) && previous?.[key]) {
      merged[key] = previous[key];
    }
  }
  return merged;
}

export function nextScriptErrorReport(error = {}, lastLoggedCount = 0) {
  const count = Number(error?.count);
  if (!error?.hasError || !Number.isFinite(count) || count <= lastLoggedCount) return null;
  return {
    count,
    message: error.message || error.code || "script error",
  };
}
