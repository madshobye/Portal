export function usbStartupOptions(extra = {}) {
  return {
    lightStartup: true,
    startupAttempts: 4,
    startupTimeoutMs: 6000,
    startupRetryDelayMs: 650,
    ...extra,
  };
}

export function isDroppedTransportState(state = "") {
  return [
    "disconnected",
    "hub_disconnected",
    "hub_closed",
    "device_closed",
    "data_channel_closed",
    "rtc_disconnected",
    "rtc_failed",
    "rtc_closed",
    "remote_left",
  ].includes(String(state || ""));
}

export function transportStateLogEntries(detail = {}, { kind = "", target = "device", isMqttKind = () => false } = {}) {
  const state = detail.state || "";
  const prefix = isMqttKind(kind) ? "MQTT" : "WebRTC";
  if (state === "signaling_connecting") {
    return [
      ["info", `Connecting to ${target}`],
      ["debug", isMqttKind(kind) ? "MQTT opening binary channel" : "WebRTC opening MQTT signaling"],
    ];
  }
  if (state === "signaling_connected") return [["debug", `${prefix} signaling connected`]];
  if (state === "offer_sent") return [["debug", `${prefix} trying ${target}`]];
  if (state === "answer_received") {
    return [
      ["info", `Got a path to ${target}`],
      ["debug", `${prefix} answer received`],
    ];
  }
  if (state === "diagnostic") return [["debug", `${prefix} ${detail.message || "diagnostic"}`]];
  if (state === "auth_required") return [["info", `Sign in to ${target}`]];
  if (state === "session_lost") return [["debug", `${prefix} session expired; signing in again`]];
  if (state === "session_restored") return [["debug", `${prefix} session restored`]];
  if (state === "device_timeout") return [["warn", `${prefix} timed out ${detail.remoteId || "device"}`]];
  if (state === "device_closed") return [["warn", `${prefix} closed ${detail.remoteId || "device"}`]];
  if (state === "device_error") return [["error", `${prefix} ${detail.remoteId || "device"}: ${detail.message || "connection error"}`]];
  if (state === "signaling_error" || state === "signal_error") return [["error", `${prefix} signaling: ${detail.message || "connection error"}`]];
  if (state === "connected") return [["debug", isMqttKind(kind) ? "MQTT binary channel open" : "WebRTC data channel open"]];
  if (state === "signaling_closed") return [["debug", `${prefix} signaling closed`]];
  if (state === "disconnected" || state === "rtc_disconnected" || state === "rtc_failed" || state === "rtc_closed") {
    return [["debug", `${prefix} disconnected`]];
  }
  return [];
}
