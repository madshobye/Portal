import { VJ1 } from "../constants.js";
import { createOutputTransportProfiler, transportTimestampMs } from "./output-transport-profiler.js?v=output-transport-profile-1";
import { stateWithoutThumbnailUrls } from "./component-thumbnail-store.js?v=transport-derived-assets-1";

export function createControlBridge({ store, mediaLibrary }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const sessionId = `control-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clients = new Map();
  let livePatchScheduled = false;
  let livePatchScheduleToken = 0;
  let liveRevision = 0;
  const pendingLivePatches = new Map();
  const clientWatchdog = setInterval(() => {
    const count = activeClientCount(clients);
    const outputs = activeOutputClients(clients);
    const metrics = store.getMetrics?.() || store.getState().metrics;
    if (count === metrics.clients && JSON.stringify(outputs) === JSON.stringify(metrics.outputs || {})) return;
    const updateMetrics = store.updateRuntime || ((recipe, reason) => store.update((draft) => recipe(draft.metrics), reason));
    updateMetrics((next) => {
      next.clients = count;
      next.outputs = outputs;
      if (!count) next.message = "Output disconnected";
    }, "output-metrics");
  }, 1000);

  channel.onmessage = async (event) => {
    const messageStartedAt = performance.now();
    const msg = event.data || {};
    try {
      if (msg.type === "recovery-state" && !store.getState().project.folderName && msg.state?.project?.folderName) {
        if (msg.files?.length) await mediaLibrary.importFiles(msg.files);
        store.replace(stateWithoutThumbnailUrls(msg.state), "project-output-recovery");
        sendMediaFiles(mediaLibrary.getAllFiles());
        return;
      }
      if (msg.type === "hello") {
        const isNewClient = !clients.has(msg.clientId || "output");
        clients.set(msg.clientId || "output", { at: performance.now(), outputId: msg.outputId || "output-main" });
        if (isNewClient) {
          sendState(null, {
            targetClientId: msg.clientId || "",
          });
          sendKnownMediaFiles();
        }
      }
      if (msg.type === "request-media-files") sendKnownMediaFiles();
      if (msg.type === "request-state") {
        sendState(null, { targetClientId: msg.clientId || "" });
      }
      if (msg.type === "metrics") {
        clients.set(msg.clientId || "output", { at: performance.now(), outputId: msg.outputId || "output-main" });
        const updateMetrics = store.updateRuntime || ((recipe, reason) => store.update((draft) => recipe(draft.metrics), reason));
        updateMetrics((next) => {
          Object.assign(next, {
            ...msg.metrics,
            clients: activeClientCount(clients),
            outputs: activeOutputClients(clients),
            message: msg.metrics?.message || "Output connected",
          });
        }, "output-metrics");
      }
      if (msg.type === "mapping-state") {
        const reason = msg.live ? "scrub:mapping-state" : "mapping-state";
        if (typeof store.updateMapping === "function") {
          store.updateMapping(msg.mappingId || "default", msg.mapping, msg.status, reason);
        } else {
          store.update((draft) => {
            draft.mappings[msg.mappingId || "default"] = msg.mapping;
            draft.ui.mappingStatus = msg.status || "Mapping updated";
          }, reason);
        }
      }
    } finally {
      const elapsedMs = performance.now() - messageStartedAt;
      if (elapsedMs >= 100) console.warn("[VJ1_CONTROL_MESSAGE_SLOW]", {
        type: msg.type || "unknown",
        elapsedMs: Math.round(elapsedMs * 10) / 10,
      });
    }
  };

  channel.postMessage({ type: "control-hello", sessionId });

  const unsubscribeLiveState = store.subscribe?.((_state, _reason, change = {}) => {
    if (change.scope !== "live") return;
    if (!Array.isArray(change.livePatches) || !change.livePatches.length) {
      sendState();
      return;
    }
    queueLivePatches(change.livePatches);
    if (change.phase === "scrub") {
      scheduleLivePatches();
      return;
    }
    flushLivePatches();
  });

  function sendState(stateOverride = null, { targetClientId = "" } = {}) {
    if (!targetClientId) {
      cancelPendingLivePatches();
      liveRevision++;
    }
    channel.postMessage({
      type: "state",
      state: stateWithoutThumbnailUrls(stateOverride || store.getLiveRenderState?.() || store.getRenderState?.() || store.getState()),
      targetClientId,
      revision: liveRevision,
      sessionId,
      transport: { sentAtMs: transportTimestampMs() },
    });
  }

  function queueLivePatches(patches) {
    for (const patch of patches) {
      if (!patch?.componentId || !patch?.path) continue;
      pendingLivePatches.set(`${patch.componentId}:${patch.path}`, patch);
    }
  }

  function scheduleLivePatches() {
    if (livePatchScheduled) return;
    livePatchScheduled = true;
    const token = ++livePatchScheduleToken;
    const schedule = typeof queueMicrotask === "function"
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);
    schedule(() => {
      if (!livePatchScheduled || token !== livePatchScheduleToken) return;
      livePatchScheduled = false;
      flushLivePatches();
    });
  }

  function flushLivePatches() {
    if (livePatchScheduled) livePatchScheduleToken++;
    livePatchScheduled = false;
    if (!pendingLivePatches.size) return;
    const baseRevision = liveRevision;
    liveRevision++;
    channel.postMessage({
      type: "live-patch",
      baseRevision,
      revision: liveRevision,
      sessionId,
      patches: [...pendingLivePatches.values()],
      transport: { sentAtMs: transportTimestampMs() },
    });
    pendingLivePatches.clear();
  }

  function cancelPendingLivePatches() {
    if (livePatchScheduled) livePatchScheduleToken++;
    livePatchScheduled = false;
    pendingLivePatches.clear();
  }

  function sendRenderPatches(patches = [], { coalesce = false } = {}) {
    queueLivePatches(patches);
    if (coalesce) scheduleLivePatches();
    else flushLivePatches();
  }

  function sendMediaFiles(files) {
    // An empty list is an authoritative snapshot too: it clears media owned
    // by an output after project close or a folder refresh.
    channel.postMessage({ type: "media-files", files: files || [], sessionId });
  }

  function sendKnownMediaFiles() {
    const files = mediaLibrary.getAllFiles();
    const state = store.getState();
    // A newly refreshed controller has not restored its project yet. Silence
    // is intentional here: [] would be interpreted by the still-running
    // Output as authoritative deletion and unload its active media between
    // hello and recovery-state. Once a project is known, [] is legitimate.
    if (!state.project?.folderName && !files.length) return false;
    sendMediaFiles(files);
    return true;
  }

  function command(name, payload = {}) {
    channel.postMessage({ type: "command", command: name, payload, sessionId });
  }

  return {
    sendState,
    sendRenderPatches,
    sendMediaFiles,
    command,
    close: () => {
      cancelPendingLivePatches();
      unsubscribeLiveState?.();
      clearInterval(clientWatchdog);
      channel.close();
    },
  };
}

export function createOutputBridge({ onState, onLivePatch, onMediaFiles, onCommand, onControlHello, mode, outputId = "" }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const clientId = `${mode}-${outputId || "default"}-${Math.random().toString(36).slice(2)}`;
  const transportProfiler = createOutputTransportProfiler();
  let controlSessionId = "";
  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "control-hello") {
      const nextSessionId = String(msg.sessionId || "");
      const changed = !!nextSessionId && nextSessionId !== controlSessionId;
      if (nextSessionId) controlSessionId = nextSessionId;
      // A refreshed controller should not wait for the heartbeat before it
      // discovers this still-running Output.
      hello();
      onControlHello?.({ sessionId: controlSessionId, changed });
      return;
    }
    if (msg.sessionId && controlSessionId && msg.sessionId !== controlSessionId) return;
    if (msg.type === "state" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      const transport = transportProfiler.receive({
        kind: "state",
        revision: msg.revision,
        sentAtMs: msg.transport?.sentAtMs,
      });
      onState?.(msg.state, { revision: Number(msg.revision) || 0, sessionId: String(msg.sessionId || controlSessionId), transport });
    }
    if (msg.type === "live-patch") {
      const transport = transportProfiler.receive({
        kind: "patch",
        revision: msg.revision,
        patchCount: msg.patches?.length,
        sentAtMs: msg.transport?.sentAtMs,
      });
      onLivePatch?.(msg.patches || [], {
        baseRevision: Number(msg.baseRevision) || 0,
        revision: Number(msg.revision) || 0,
        sessionId: String(msg.sessionId || controlSessionId),
        transport,
      });
    }
    if (msg.type === "media-files") onMediaFiles?.(msg.files || []);
    if (msg.type === "command") onCommand?.(msg.command, msg.payload || {});
  };

  function hello() {
    channel.postMessage({ type: "hello", clientId, mode, outputId });
  }

  function metrics(metrics) {
    channel.postMessage({
      type: "metrics",
      clientId,
      outputId,
      metrics: { ...metrics, transport: transportProfiler.snapshot() },
    });
  }

  function mappingState(mappingId, mapping, status, meta = {}) {
    channel.postMessage({ type: "mapping-state", clientId, mappingId, mapping, status, live: meta.live === true });
  }

  function requestMediaFiles(mediaIds = []) {
    channel.postMessage({ type: "request-media-files", clientId, mode, mediaIds });
  }

  function requestState() {
    channel.postMessage({ type: "request-state", clientId, mode, outputId });
  }

  function recoveryState(state, files = []) {
    if (!state?.project?.folderName) return;
    channel.postMessage({ type: "recovery-state", state: stateWithoutThumbnailUrls(state), files });
  }

  hello();
  const helloInterval = setInterval(hello, 2000);
  return {
    hello,
    metrics,
    mappingState,
    requestMediaFiles,
    requestState,
    recoveryState,
    markTransportApplied: transportProfiler.applied,
    markTransportRendered: transportProfiler.rendered,
    recordTransportResync: transportProfiler.resync,
    close: () => {
      clearInterval(helloInterval);
      channel.close();
    },
    clientId,
  };
}

function activeClientCount(clients) {
  const now = performance.now();
  for (const [id, client] of clients) {
    if (now - Number(client?.at || client || 0) > 5000) clients.delete(id);
  }
  return clients.size;
}

function activeOutputClients(clients) {
  activeClientCount(clients);
  const outputs = {};
  for (const client of clients.values()) {
    const outputId = client?.outputId || "output-main";
    outputs[outputId] = (outputs[outputId] || 0) + 1;
  }
  return outputs;
}
