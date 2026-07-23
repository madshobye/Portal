export const CONTROL_UI_LONG_RENDER_MS = 50;

export function createControlRenderDiagnostics({
  diagnostics = null,
  thresholdMs = CONTROL_UI_LONG_RENDER_MS,
  cooldownMs = 5000,
  now = () => Date.now(),
} = {}) {
  const recent = new Map();

  function report({ durationMs = 0, phases = [], reason = "", topic = "", workspace = "" } = {}) {
    const duration = Math.max(0, Number(durationMs) || 0);
    if (duration < thresholdMs) return false;
    const dominant = dominantRenderPhase(phases);
    const durationBand = renderDurationBand(duration);
    const cause = String(reason || topic || "unspecified state update");
    const key = [cause, topic, workspace, dominant.name, durationBand].join("|");
    const timestamp = now();
    const previous = recent.get(key);
    if (previous && timestamp - previous.lastAt < cooldownMs) {
      previous.suppressed += 1;
      return false;
    }
    const occurrences = 1 + Math.max(0, Number(previous?.suppressed) || 0);
    recent.set(key, { lastAt: timestamp, suppressed: 0 });
    diagnostics?.record?.("warning", [{
      code: "VJ1_CONTROL_UI_LONG_RENDER",
      message: `Control UI rebuild exceeded the ${thresholdMs} ms main-thread budget.`,
      durationBand,
      cause,
      topic: String(topic || ""),
      workspace: String(workspace || ""),
      dominantPhase: dominant.name,
      dominantPhaseBand: renderDurationBand(dominant.durationMs),
      hint: "Use Performance profiling to inspect the named phase. Rendering output is separate from this control-DOM rebuild.",
    }], "control-ui", occurrences);
    return true;
  }

  function clear() {
    recent.clear();
  }

  return { clear, report };
}

export function dominantRenderPhase(phases = []) {
  let dominant = { name: "unknown", durationMs: 0 };
  for (const phase of phases || []) {
    const durationMs = Math.max(0, Number(phase?.durationMs) || 0);
    if (durationMs > dominant.durationMs) {
      dominant = { name: String(phase?.name || "unknown"), durationMs };
    }
  }
  return dominant;
}

export function renderDurationBand(durationMs = 0) {
  const duration = Math.max(0, Number(durationMs) || 0);
  if (duration < 50) return "<50 ms";
  if (duration < 100) return "50–99 ms";
  if (duration < 200) return "100–199 ms";
  if (duration < 500) return "200–499 ms";
  return "500+ ms";
}
