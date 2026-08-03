const DEFAULT_DURATION_MS = 10000;
const TICK_INTERVAL_MS = 250;

// Owns the lifetime and bounded host instrumentation for one performance run.
// The shell supplies VJ-specific metric selection and report analysis, keeping
// DOM presentation independent from timers and PerformanceObserver resources.
export function createControlPerformanceSession({
  getState,
  metricForState,
  signalForState,
  diagnosticForState,
  analyze,
  onTick = () => {},
  onComplete = () => {},
  onActiveChange = () => {},
  durationMs = DEFAULT_DURATION_MS,
} = {}) {
  let session = null;
  let timer = 0;
  let longTaskObserver = null;

  function isActive() {
    return !!session;
  }

  function remainingSeconds() {
    return session ? Math.max(1, Math.ceil((session.endsAt - performance.now()) / 1000)) : 0;
  }

  function start() {
    if (session) return false;
    const startedAt = performance.now();
    session = {
      startedAt,
      startedAtIso: new Date().toISOString(),
      endsAt: startedAt + durationMs,
      samples: [],
      timeline: [],
      diagnosticHistory: new Map(),
      host: {
        uiRenderMs: [],
        longTasks: [],
        eventLoopLagMs: [],
        stateEvents: {},
        signalSamples: [],
        expectedTickAt: startedAt + TICK_INTERVAL_MS,
        memoryStartBytes: performanceMemoryBytes(),
      },
    };
    notifyActiveChange(true);
    startLongTaskObserver();
    captureSample(getState?.());
    captureSignal(getState?.());
    onTick();
    timer = globalThis.setInterval(() => {
      if (session) {
        const now = performance.now();
        pushBounded(session.host.eventLoopLagMs, Math.max(0, now - session.host.expectedTickAt), 80);
        session.host.expectedTickAt = now + TICK_INTERVAL_MS;
      }
      if (!session || performance.now() >= session.endsAt) {
        finish();
        return;
      }
      onTick();
      captureSignal(getState?.());
    }, TICK_INTERVAL_MS);
    return true;
  }

  function recordStateEvent(reason, state = getState?.(), change = null) {
    if (!captureWindowOpen()) return;
    const key = String(reason || "unknown");
    session.host.stateEvents[key] = (session.host.stateEvents[key] || 0) + 1;
    pushBounded(session.timeline, {
      sampledAt: new Date().toISOString(),
      reason: key,
      control: captureDiagnostic(state, { kind: "event", reason: key, change }),
    }, 240);
  }

  function recordUiRender(duration) {
    if (!captureWindowOpen()) return;
    pushBounded(session.host.uiRenderMs, Math.max(0, Number(duration) || 0), 240);
  }

  function recordInteraction(kind, payload = {}) {
    if (!captureWindowOpen()) return;
    pushBounded(session.timeline, {
      sampledAt: new Date().toISOString(),
      interaction: {
        kind: String(kind || "interaction"),
        payload: structuredCloneSafe(payload),
      },
    }, 240);
  }

  function captureSignal(state) {
    if (!captureWindowOpen()) return;
    const snapshot = signalForState?.(state);
    if (snapshot) pushBounded(session.host.signalSamples, structuredCloneSafe(snapshot), 80);
  }

  function captureSample(state, reason = "active") {
    if (!captureWindowOpen() || !state) return false;
    const metric = metricForState?.(state, reason);
    if (!(metric?.fps > 0)) return false;
    const controlDiagnostic = captureDiagnostic(state, { kind: "sample", reason });
    const rendererDiagnostic = metric.diagnostic ? structuredCloneSafe(metric.diagnostic) : null;
    session.samples.push({
      sampledAt: new Date().toISOString(),
      source: metric.source,
      fps: metric.fps,
      frameMs: metric.cpuMs,
      gpuMs: metric.gpuMs,
      gpuSupported: metric.gpuSupported,
      renderCost: metric.renderCost,
      profile: metric.profile ? structuredCloneSafe(metric.profile) : null,
      transport: metric.transport ? structuredCloneSafe(metric.transport) : null,
      control: deduplicateDiagnostic(session, "control", controlDiagnostic),
      renderer: deduplicateDiagnostic(session, "renderer", rendererDiagnostic),
    });
    return true;
  }

  function finish() {
    if (!session) return null;
    clearResources();
    const completed = session;
    session = null;
    notifyActiveChange(false);
    const state = getState?.();
    const report = {
      kind: "vj1-runtime-profile",
      durationMs,
      startedAt: completed.startedAtIso,
      completedAt: new Date().toISOString(),
      runtimeSamples: completed.samples,
      timeline: completed.timeline,
      analysis: analyze?.(state, completed.samples) || null,
      host: summarizePerformanceHost(completed.host),
    };
    onComplete(report, completed.samples.length);
    return report;
  }

  function dispose() {
    const wasActive = !!session;
    clearResources();
    session = null;
    if (wasActive) notifyActiveChange(false);
  }

  function captureWindowOpen() {
    return !!session && performance.now() <= session.endsAt;
  }

  function notifyActiveChange(active) {
    try {
      onActiveChange(active);
    } catch (error) {
      console.warn("[VJ1_PROFILE_DIAGNOSTIC_GATE_FAILED]", { active, message: error?.message || String(error) });
    }
  }

  function captureDiagnostic(state, context = {}) {
    try {
      const diagnostic = diagnosticForState?.(state, context);
      return diagnostic ? structuredCloneSafe(diagnostic) : null;
    } catch (error) {
      return { captureError: error?.message || String(error) };
    }
  }

  function startLongTaskObserver() {
    if (typeof PerformanceObserver !== "function" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        if (!session) return;
        for (const entry of list.getEntries()) {
          pushBounded(session.host.longTasks, {
            durationMs: Number(entry.duration) || 0,
            name: entry.name || "main-thread task",
            startedAtMs: Number(entry.startTime) || 0,
          }, 120);
        }
      });
      longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch (error) {
      console.warn("[VJ1_HOST_PROFILE_OBSERVER_FAILED]", { message: error?.message || String(error) });
      longTaskObserver = null;
    }
  }

  function clearResources() {
    if (timer) globalThis.clearInterval(timer);
    timer = 0;
    longTaskObserver?.disconnect?.();
    longTaskObserver = null;
  }

  return {
    captureSample,
    dispose,
    finish,
    isActive,
    recordInteraction,
    recordStateEvent,
    recordUiRender,
    remainingSeconds,
    start,
  };
}

function deduplicateDiagnostic(session, kind, diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object") return diagnostic;
  const signature = JSON.stringify(diagnostic, (key, value) =>
    ["capturedAtMs", "frameIndex", "progress"].includes(key) ? undefined : value
  );
  const previous = session.diagnosticHistory.get(kind);
  if (previous?.signature === signature) {
    return {
      schema: String(diagnostic.schema || ""),
      unchangedSinceSample: previous.sampleIndex,
    };
  }
  session.diagnosticHistory.set(kind, {
    signature,
    sampleIndex: session.samples.length,
  });
  return diagnostic;
}

export function summarizePerformanceHost(host = {}) {
  const uiRenderMs = numericValues(host.uiRenderMs);
  const eventLoopLagMs = numericValues(host.eventLoopLagMs);
  const longTasks = (host.longTasks || []).filter((item) => Number.isFinite(Number(item?.durationMs)));
  const stateEvents = Object.entries(host.stateEvents || {})
    .map(([reason, count]) => ({ reason, count: Math.max(0, Number(count) || 0) }))
    .sort((a, b) => b.count - a.count);
  const signalSamples = (host.signalSamples || []).filter(Boolean);
  const signalCategories = {};
  const signalReasons = {};
  for (const sample of signalSamples) {
    for (const [category, count] of Object.entries(sample.categories || {})) {
      signalCategories[category] = (signalCategories[category] || 0) + Math.max(0, Number(count) || 0);
    }
    for (const [reason, count] of Object.entries(sample.reasons || {})) {
      signalReasons[reason] = (signalReasons[reason] || 0) + Math.max(0, Number(count) || 0);
    }
  }
  const signalReasonsPerSecondAvg = Object.fromEntries(
    Object.entries(signalReasons).map(([reason, count]) => [
      reason,
      signalSamples.length ? count / signalSamples.length : 0,
    ]),
  );
  const signalTopPressureReasonsPerSecondAvg = Object.entries(signalReasonsPerSecondAvg)
    .filter(([reason]) => !/^(cacheHits|previewPresentations|outputPresentations):/.test(reason))
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const memoryEndBytes = performanceMemoryBytes();
  const memoryStartBytes = host.memoryStartBytes === null || host.memoryStartBytes === undefined
    ? null
    : Number(host.memoryStartBytes);
  return {
    uiRenderCount: uiRenderMs.length,
    uiRenderMsAvg: averageNumbers(uiRenderMs),
    uiRenderMsP95: percentileNumbers(uiRenderMs, 0.95),
    uiRenderMsMax: uiRenderMs.length ? Math.max(...uiRenderMs) : 0,
    eventLoopLagMsP95: percentileNumbers(eventLoopLagMs, 0.95),
    eventLoopLagMsMax: eventLoopLagMs.length ? Math.max(...eventLoopLagMs) : 0,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((sum, item) => sum + Number(item.durationMs), 0),
    longTaskMaxMs: longTasks.length ? Math.max(...longTasks.map((item) => Number(item.durationMs))) : 0,
    longTasks: longTasks.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    stateEventCount: stateEvents.reduce((sum, item) => sum + item.count, 0),
    topStateEvents: stateEvents.slice(0, 12),
    signalSampleCount: signalSamples.length,
    signalPerSecondAvg: averageNumbers(signalSamples.map((sample) => sample.totalPerSecond)),
    signalPressurePerSecondAvg: averageNumbers(signalSamples.map((sample) => sample.pressurePerSecond)),
    signalPressurePerSecondMax: signalSamples.length
      ? Math.max(...signalSamples.map((sample) => Math.max(0, Number(sample.pressurePerSecond) || 0)))
      : 0,
    signalCategoriesPerSecondAvg: Object.fromEntries(
      Object.entries(signalCategories).map(([category, count]) => [
        category,
        signalSamples.length ? count / signalSamples.length : 0,
      ]),
    ),
    signalReasonsPerSecondAvg,
    signalTopPressureReasonsPerSecondAvg,
    memoryStartBytes: Number.isFinite(memoryStartBytes) ? memoryStartBytes : null,
    memoryEndBytes,
    memoryDeltaBytes: Number.isFinite(memoryStartBytes) && Number.isFinite(memoryEndBytes) ? memoryEndBytes - memoryStartBytes : null,
  };
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function pushBounded(items, value, limit) {
  items.push(value);
  if (items.length > limit) items.splice(0, items.length - limit);
}

function performanceMemoryBytes() {
  const value = Number(globalThis.performance?.memory?.usedJSHeapSize);
  return Number.isFinite(value) ? value : null;
}

function numericValues(values = []) {
  return values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
}

function averageNumbers(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentileNumbers(values = [], percentile = 0.95) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1))];
}
