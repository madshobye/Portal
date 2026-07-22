import { VJ1 } from "../constants.js";
import { createOutputTransportProfiler, transportTimestampMs } from "./output-transport-profiler.js?v=output-transport-profile-1";
import { stateWithoutThumbnailUrls } from "./component-thumbnail-store.js?v=transport-derived-assets-1";
import { LivePatchSynchronizer } from "../libraries/synchronization-engine/live-patch-synchronizer/index.js?v=render-patch-coalescing-1";

export function createControlBridge({ store, mediaLibrary, diagnostics = null, subscribeStore = true, deferAnnouncement = false }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const sessionId = `control-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clients = new Map();
  let announced = false;
  let recoveryMediaFrame = 0;
  let recoveryMediaTimer = 0;
  let activeRecovery = null;
  let recoveryMediaBlocked = false;
  let pendingRecoveryState = null;
  let pendingRecoveryMedia = null;
  const liveSynchronization = new LivePatchSynchronizer({
    onPatch(packet) {
      channel.postMessage({
        type: "live-patch",
        ...packet,
        sessionId,
        transport: { sentAtMs: transportTimestampMs() },
      });
    },
  });
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

  channel.onmessage = (event) => {
    const messageStartedAt = performance.now();
    const msg = event.data || {};
    try {
      if (msg.type === "recovery-state" && !store.getState().project.folderName && msg.state?.project?.folderName) {
        const recoveredState = stateWithoutThumbnailUrls(msg.state);
        activeRecovery = {
          id: String(msg.recoveryId || "legacy"),
          folderName: String(recoveredState.project.folderName || ""),
        };
        if (recoveryMediaBlocked) {
          // Local project.json and its thumbnail cache are authoritative and
          // now load before media traversal. Keep Output recovery as fallback
          // instead of committing the same large project twice during boot.
          pendingRecoveryState = { state: recoveredState, recovery: activeRecovery };
        } else {
          store.replace(recoveredState, "project-output-recovery");
        }
        // Older Output windows send state and files together. Retain protocol
        // compatibility while still moving the file work behind first paint.
        if (msg.files?.length) scheduleRecoveryMedia(msg.files, activeRecovery);
        return;
      }
      if (msg.type === "recovery-media-files" && activeRecovery) {
        const recovery = {
          id: String(msg.recoveryId || "legacy"),
          folderName: String(msg.folderName || ""),
        };
        if (recovery.id === activeRecovery.id && recovery.folderName === activeRecovery.folderName) {
          scheduleRecoveryMedia(msg.files || [], recovery);
        }
        return;
      }
      if (msg.type === "hello") {
        if (!announced) return;
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
        if (!announced) return;
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
      if (msg.type === "diagnostic") {
        const entry = msg.entry || {};
        const origin = diagnosticOrigin(msg);
        diagnostics?.record?.(entry.level, [entry.message], `${origin} · ${entry.source || "app"}`, entry.count);
      }
      if (msg.type === "mapping-state") {
        const reason = msg.live ? "scrub:mapping-state" : "mapping-state";
        if (typeof store.updateMapping === "function") {
          store.updateMapping(msg.mappingId || "default", msg.mapping, msg.status, reason);
        } else {
          store.update((draft) => {
            draft.mappingCalibration = msg.mapping;
            const selected = draft.mappings?.find((mapping) => mapping.id === draft.ui?.selectedMappingId);
            if (selected) selected.calibration = msg.mapping;
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

  function announceControl() {
    if (announced) return false;
    announced = true;
    clients.clear();
    channel.postMessage({ type: "control-hello", sessionId });
    return true;
  }

  if (!deferAnnouncement) announceControl();

  function scheduleRecoveryMedia(files, recovery) {
    if (recoveryMediaBlocked) {
      pendingRecoveryMedia = { files, recovery };
      return;
    }
    cancelRecoveryMediaSchedule();
    const run = () => {
      recoveryMediaFrame = 0;
      recoveryMediaTimer = setTimeout(() => {
        recoveryMediaTimer = 0;
        importRecoveryMedia(files, recovery);
      }, 0);
    };
    if (typeof requestAnimationFrame === "function") recoveryMediaFrame = requestAnimationFrame(run);
    else run();
  }

  async function importRecoveryMedia(files, recovery) {
    if (!recoveryStillApplies(recovery)) return;
    try {
      await mediaLibrary.importFiles(files);
      if (!recoveryStillApplies(recovery)) return;
      sendMediaFiles(mediaLibrary.getAllFiles());
      activeRecovery = null;
    } catch (error) {
      if (recoveryStillApplies(recovery)) activeRecovery = null;
      console.warn("[VJ1_OUTPUT_RECOVERY_MEDIA_FAILED]", {
        folderName: recovery.folderName,
        fallback: "continue with project-folder media when available",
        message: error?.message || String(error),
      });
    }
  }

  function recoveryStillApplies(recovery) {
    return activeRecovery?.id === recovery.id
      && activeRecovery.folderName === recovery.folderName
      && String(store.getState().project?.folderName || "") === recovery.folderName;
  }

  function cancelRecoveryMediaSchedule() {
    if (recoveryMediaFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(recoveryMediaFrame);
    if (recoveryMediaTimer) clearTimeout(recoveryMediaTimer);
    recoveryMediaFrame = 0;
    recoveryMediaTimer = 0;
  }

  function beginProjectRestore() {
    recoveryMediaBlocked = true;
    pendingRecoveryState = null;
    pendingRecoveryMedia = null;
    cancelRecoveryMediaSchedule();
  }

  function finishProjectRestore(restored) {
    recoveryMediaBlocked = false;
    if (restored) {
      pendingRecoveryState = null;
      pendingRecoveryMedia = null;
      activeRecovery = null;
      cancelRecoveryMediaSchedule();
      return;
    }
    const pendingState = pendingRecoveryState;
    const pending = pendingRecoveryMedia;
    pendingRecoveryState = null;
    pendingRecoveryMedia = null;
    if (pendingState && !store.getState().project?.folderName) {
      store.replace(pendingState.state, "project-output-recovery");
    }
    if (pending) scheduleRecoveryMedia(pending.files, pending.recovery);
  }

  function acceptStateChange(_state, _reason, change = {}) {
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
  }
  const unsubscribeLiveState = subscribeStore ? store.subscribe?.(acceptStateChange) : null;

  function sendState(stateOverride = null, { targetClientId = "" } = {}) {
    if (!targetClientId) {
      liveSynchronization.stateRevision({ broadcast: true });
    }
    channel.postMessage({
      type: "state",
      state: stateWithoutThumbnailUrls(stateOverride || store.getLiveRenderState?.() || store.getRenderState?.() || store.getState()),
      targetClientId,
      revision: liveSynchronization.revision,
      sessionId,
      transport: { sentAtMs: transportTimestampMs() },
    });
  }

  function queueLivePatches(patches) {
    liveSynchronization.queue(patches);
  }

  function scheduleLivePatches() {
    liveSynchronization.schedule();
  }

  function flushLivePatches() {
    liveSynchronization.flush();
  }

  function cancelPendingLivePatches() {
    liveSynchronization.cancelPending();
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
    acceptStateChange,
    announceControl,
    beginProjectRestore,
    finishProjectRestore,
    command,
    close: () => {
      cancelPendingLivePatches();
      cancelRecoveryMediaSchedule();
      activeRecovery = null;
      pendingRecoveryState = null;
      pendingRecoveryMedia = null;
      recoveryMediaBlocked = false;
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
  const recoveryTimers = new Set();
  let controlSessionId = "";
  let pendingLivePatch = null;
  let livePatchScheduled = false;
  let livePatchScheduleToken = 0;
  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "control-hello") {
      cancelPendingLivePatch();
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
      flushPendingLivePatch();
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
      queueIncomingLivePatch(msg.patches || [], {
        baseRevision: Number(msg.baseRevision) || 0,
        revision: Number(msg.revision) || 0,
        sessionId: String(msg.sessionId || controlSessionId),
        transport,
      });
    }
    if (msg.type === "media-files") onMediaFiles?.(msg.files || []);
    if (msg.type === "command") {
      flushPendingLivePatch();
      onCommand?.(msg.command, msg.payload || {});
    }
  };

  function queueIncomingLivePatch(patches, meta) {
    // BroadcastChannel preserves order, but applying each message in its event
    // handler makes a slow renderer accumulate visible historical movement.
    // Consume transport messages cheaply and present only the newest value for
    // each target path on the next output frame.
    if (pendingLivePatch && meta.baseRevision !== pendingLivePatch.revision) flushPendingLivePatch();
    if (!pendingLivePatch) {
      pendingLivePatch = {
        baseRevision: meta.baseRevision,
        revision: meta.revision,
        sessionId: meta.sessionId,
        transport: meta.transport,
        patches: new Map(),
      };
    }
    pendingLivePatch.revision = meta.revision;
    pendingLivePatch.transport = meta.transport;
    for (const patch of patches) {
      const targetKey = patch?.target === "state"
        ? "state"
        : patch?.componentId
          ? `component:${patch.componentId}`
          : "";
      if (targetKey && patch?.path) pendingLivePatch.patches.set(`${targetKey}:${patch.path}`, patch);
    }
    scheduleIncomingLivePatch();
  }

  function scheduleIncomingLivePatch() {
    if (livePatchScheduled) return;
    livePatchScheduled = true;
    const token = ++livePatchScheduleToken;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : typeof queueMicrotask === "function"
        ? queueMicrotask
        : (callback) => Promise.resolve().then(callback);
    schedule(() => {
      if (!livePatchScheduled || token !== livePatchScheduleToken) return;
      livePatchScheduled = false;
      flushPendingLivePatch();
    });
  }

  function flushPendingLivePatch() {
    if (livePatchScheduled) livePatchScheduleToken++;
    livePatchScheduled = false;
    const pending = pendingLivePatch;
    pendingLivePatch = null;
    if (!pending?.patches.size) return;
    onLivePatch?.([...pending.patches.values()], {
      baseRevision: pending.baseRevision,
      revision: pending.revision,
      sessionId: pending.sessionId,
      transport: pending.transport,
    });
  }

  function cancelPendingLivePatch() {
    if (livePatchScheduled) livePatchScheduleToken++;
    livePatchScheduled = false;
    pendingLivePatch = null;
  }

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

  function diagnostic(entry) {
    if (!entry?.message) return;
    channel.postMessage({
      type: "diagnostic",
      clientId,
      mode,
      outputId,
      entry: {
        level: entry.level,
        message: entry.message,
        source: entry.source,
        count: Math.max(1, Math.floor(Number(entry.count) || 1)),
      },
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
    const folderName = String(state.project.folderName || "");
    const recoveryId = `${clientId}-${Date.now().toString(36)}`;
    channel.postMessage({
      type: "recovery-state",
      state: stateWithoutThumbnailUrls(state),
      recoveryId,
    });
    if (!files.length) return;
    const timer = setTimeout(() => {
      recoveryTimers.delete(timer);
      channel.postMessage({ type: "recovery-media-files", folderName, files, recoveryId });
    }, 0);
    recoveryTimers.add(timer);
  }

  hello();
  const helloInterval = setInterval(hello, 2000);
  return {
    hello,
    metrics,
    diagnostic,
    mappingState,
    requestMediaFiles,
    requestState,
    recoveryState,
    markTransportApplied: transportProfiler.applied,
    markTransportRendered: transportProfiler.rendered,
    recordTransportResync: transportProfiler.resync,
    close: () => {
      cancelPendingLivePatch();
      clearInterval(helloInterval);
      for (const timer of recoveryTimers) clearTimeout(timer);
      recoveryTimers.clear();
      channel.close();
    },
    clientId,
  };
}

function diagnosticOrigin(message) {
  const mode = String(message?.mode || "output");
  const outputId = String(message?.outputId || "");
  return outputId ? `${mode} ${outputId}` : mode;
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
