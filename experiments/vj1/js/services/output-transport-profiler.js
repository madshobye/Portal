const SAMPLE_FIELDS = ["deliveryMs", "applyMs", "renderMs", "endToEndMs"];

export function transportTimestampMs() {
  if (typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin) && typeof performance.now === "function") {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

export function createOutputTransportProfiler({ now = transportTimestampMs } = {}) {
  const total = createCounts();
  let window = createWindow();
  const pendingRender = new Map();

  function receive({ kind = "state", revision = 0, patchCount = 0, sentAtMs = 0 } = {}) {
    const receivedAtMs = now();
    const meta = {
      kind: kind === "patch" ? "patch" : "state",
      revision: Math.max(0, Number(revision) || 0),
      patchCount: Math.max(0, Number(patchCount) || 0),
      sentAtMs: Number(sentAtMs) || 0,
      receivedAtMs,
    };
    incrementMessageCounts(total, meta);
    incrementMessageCounts(window, meta);
    addSample(window, "deliveryMs", elapsed(meta.sentAtMs, receivedAtMs));
    total.lastRevision = Math.max(total.lastRevision, meta.revision);
    window.lastRevision = Math.max(window.lastRevision, meta.revision);
    return meta;
  }

  function applied(meta) {
    if (!meta?.receivedAtMs || meta.appliedAtMs) return;
    const appliedAtMs = now();
    meta.appliedAtMs = appliedAtMs;
    addSample(window, "applyMs", elapsed(meta.receivedAtMs, appliedAtMs));
    pendingRender.set(meta.revision, meta);
    while (pendingRender.size > 120) pendingRender.delete(pendingRender.keys().next().value);
  }

  function rendered(revision) {
    const renderedRevision = Math.max(0, Number(revision) || 0);
    const renderedAtMs = now();
    for (const [pendingRevision, meta] of pendingRender) {
      if (pendingRevision > renderedRevision) continue;
      addSample(window, "renderMs", elapsed(meta.appliedAtMs, renderedAtMs));
      addSample(window, "endToEndMs", elapsed(meta.sentAtMs, renderedAtMs));
      pendingRender.delete(pendingRevision);
    }
  }

  function resync(reason = "unknown") {
    const key = reason === "revision" || reason === "path" ? reason : "other";
    total.resyncs[key]++;
    window.resyncs[key]++;
  }

  function snapshot({ reset = true } = {}) {
    const result = {
      stateMessages: window.stateMessages,
      patchMessages: window.patchMessages,
      patches: window.patches,
      lastRevision: Math.max(total.lastRevision, window.lastRevision),
      deliveryMsAvg: average(window.deliveryMs),
      deliveryMsMax: window.deliveryMs.max,
      applyMsAvg: average(window.applyMs),
      applyMsMax: window.applyMs.max,
      renderMsAvg: average(window.renderMs),
      renderMsMax: window.renderMs.max,
      endToEndMsAvg: average(window.endToEndMs),
      endToEndMsMax: window.endToEndMs.max,
      resyncs: { ...window.resyncs },
      totals: {
        stateMessages: total.stateMessages,
        patchMessages: total.patchMessages,
        patches: total.patches,
        resyncs: { ...total.resyncs },
      },
    };
    if (reset) window = createWindow();
    return result;
  }

  return { receive, applied, rendered, resync, snapshot };
}

function createCounts() {
  return { stateMessages: 0, patchMessages: 0, patches: 0, lastRevision: 0, resyncs: { revision: 0, path: 0, other: 0 } };
}

function createWindow() {
  const result = createCounts();
  for (const field of SAMPLE_FIELDS) result[field] = { sum: 0, count: 0, max: 0 };
  return result;
}

function incrementMessageCounts(target, meta) {
  if (meta.kind === "patch") {
    target.patchMessages++;
    target.patches += meta.patchCount;
  } else {
    target.stateMessages++;
  }
}

function addSample(target, field, value) {
  if (!Number.isFinite(value)) return;
  const sample = Math.max(0, value);
  target[field].sum += sample;
  target[field].count++;
  target[field].max = Math.max(target[field].max, sample);
}

function elapsed(from, to) {
  return Number.isFinite(from) && from > 0 && Number.isFinite(to) ? Math.max(0, to - from) : NaN;
}

function average(sample) {
  return sample.count ? sample.sum / sample.count : 0;
}
