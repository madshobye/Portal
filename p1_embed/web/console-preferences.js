export function createConsolePreferences({
  logLevelKey,
  timestampsKey,
  timestampsButton,
} = {}) {
  function readLogLevel(fallback = "info") {
    return localStorage.getItem(logLevelKey) || fallback;
  }

  function writeLogLevel(level) {
    localStorage.setItem(logLevelKey, level);
  }

  function timestampsEnabled() {
    return localStorage.getItem(timestampsKey) !== "0";
  }

  function updateTimestampButton() {
    if (!timestampsButton) return;
    const enabled = timestampsEnabled();
    timestampsButton.classList.toggle("is-active", enabled);
    timestampsButton.title = enabled ? "Timestamps: on" : "Timestamps: off";
    timestampsButton.setAttribute("aria-label", timestampsButton.title);
  }

  function toggleTimestamps() {
    localStorage.setItem(timestampsKey, timestampsEnabled() ? "0" : "1");
    updateTimestampButton();
  }

  return {
    readLogLevel,
    timestampsEnabled,
    toggleTimestamps,
    updateTimestampButton,
    writeLogLevel,
  };
}
