export function createUiActionRunner({
  getBusy,
  setBusy,
  getBusyLabel,
  setBusyLabel,
  updateEnabledState,
  logLine,
} = {}) {
  async function run(action, label = "busy") {
    if (getBusy()) {
      logLine("warn", `busy: ${getBusyLabel() || "working"}`);
      return false;
    }
    setBusy(true);
    setBusyLabel(label);
    updateEnabledState();
    try {
      await action();
      return true;
    } catch (error) {
      logLine("error", error.message || String(error));
      return false;
    } finally {
      setBusy(false);
      setBusyLabel("");
      updateEnabledState();
    }
  }

  return {
    run,
  };
}
