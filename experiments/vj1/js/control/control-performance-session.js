const DEFAULT_DURATION_MS = 10000;
const TICK_INTERVAL_MS = 250;

// Owns the lifetime and bounded host instrumentation for one performance run.
// The shell supplies VJ-specific metric selection and report analysis, keeping
// DOM presentation independent from timers and PerformanceObserver resources.
export function createControlPerformanceSession({
  getState,
  metricForState,
  analyze,
  onTick = () => {},
  onComplete = () => {},
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
      host: {
        uiRenderMs: [],
        longTasks: [],
        eventLoopLagMs: [],
        stateEvents: {},
        expectedTickAt: startedAt + TICK_INTERVAL_MS,
        memoryStartBytes: performanceMemoryBytes(),
      },
    };
    startLongTaskObserver();
    captureSample(getState?.());
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
    }, TICK_INTERVAL_MS);
    return true;
  }

  function recordStateEvent(reason) {
    if (!session) return;
    const key = String(reason || "unknown");
    session.host.stateEvents[key] = (session.host.stateEvents[key] || 0) + 1;
  }

  function recordUiRender(duration) {
    if (!session) return;
    pushBounded(session.host.uiRenderMs, Math.max(0, Number(duration) || 0), 240);
  }

  function captureSample(state, reason = "active") {
    if (!session || !state) return false;
    const metric = metricForState?.(state, reason);
    if (!(metric?.fps > 0)) return false;
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
    });
    return true;
  }

  function finish() {
    if (!session) return null;
    clearResources();
    const completed = session;
    session = null;
    const state = getState?.();
    const report = {
      kind: "vj1-runtime-profile",
      durationMs,
      startedAt: completed.startedAtIso,
      completedAt: new Date().toISOString(),
      runtimeSamples: completed.samples,
      analysis: analyze?.(state, completed.samples) || null,
      host: summarizePerformanceHost(completed.host),
    };
    onComplete(report, completed.samples.length);
    return report;
  }

  function dispose() {
    clearResources();
    session = null;
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

  return { captureSample, dispose, finish, isActive, recordStateEvent, recordUiRender, remainingSeconds, start };
}

export function summarizePerformanceHost(host = {}) {
  const uiRenderMs = numericValues(host.uiRenderMs);
  const eventLoopLagMs = numericValues(host.eventLoopLagMs);
  const longTasks = (host.longTasks || []).filter((item) => Number.isFinite(Number(item?.durationMs)));
  const stateEvents = Object.entries(host.stateEvents || {})
    .map(([reason, count]) => ({ reason, count: Math.max(0, Number(count) || 0) }))
    .sort((a, b) => b.count - a.count);
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
