import { VJ1 } from "../constants.js";
import { createOutputTransportProfiler, transportTimestampMs } from "./output-transport-profiler.js";
import { stateWithoutThumbnailUrls } from "./component-thumbnail-store.js";
import { LivePatchSynchronizer } from "../libraries/synchronization-engine/live-patch-synchronizer/index.js";
import { resetSceneMappingSession } from "../domain/live-ui-state.js";
import { createRenderStatePatch } from "../domain/live-render-patch.js";
import { materializeStructuralTree } from "../libraries/data-store/data-store/index.js";

export const OUTPUT_BRIDGE_PROTOCOL_VERSION = 3;
const CONTROL_HEARTBEAT_MS = 1000;
const CONTROL_LEASE_MS = 6500;
const CONTROL_TAB_ID_KEY = "vj1-output-control-tab-id";

export function recoveredOutputProjectState(recoveredState = {}, localProject = {}) {
  const localWarnings = [...(localProject?.warnings || [])];
  const folderName = String(recoveredState.project?.folderName || "this project");
  return {
    ...recoveredState,
    project: {
      ...(recoveredState.project || {}),
      warnings: localWarnings.length
        ? localWarnings
        : [`Read-only recovery from Output. Click the folder button to restore access to ${folderName}.`],
    },
  };
}

function protocolMessage(message = {}) {
  return { ...message, protocolVersion: OUTPUT_BRIDGE_PROTOCOL_VERSION };
}

function postStateMessage(channel, message) {
  try {
    channel.postMessage(message);
  } catch (error) {
    if (error?.name !== "DataCloneError") throw error;
    // A structural edit can briefly retain a nested transaction Proxy inside
    // an otherwise plain render projection. BroadcastChannel rejects that
    // value before delivering anything. Retry the same revision after
    // materializing only the transport packet; genuine non-cloneable authored
    // values still fail on this second attempt.
    channel.postMessage(materializeStructuralTree(message));
  }
}

function hasCurrentProtocol(message) {
  return Number(message?.protocolVersion) === OUTPUT_BRIDGE_PROTOCOL_VERSION;
}

function persistentControlId() {
  const createId = () => `control-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const storage = globalThis.sessionStorage;
    if (!storage?.getItem || !storage?.setItem) return createId();
    const navigationType = String(
      globalThis.performance?.getEntriesByType?.("navigation")?.[0]?.type || "",
    );
    const existing = String(storage.getItem(CONTROL_TAB_ID_KEY) || "");
    // sessionStorage can be copied into a duplicated/new tab. Reuse the
    // identity only for a real reload/history restore; a new tab must be a
    // distinct contender for the single Output writer.
    if (existing && ["reload", "back_forward"].includes(navigationType)) return existing;
    const controlId = createId();
    storage.setItem(CONTROL_TAB_ID_KEY, controlId);
    return controlId;
  } catch {
    return createId();
  }
}

export function createControlBridge({
  store,
  mediaLibrary,
  diagnostics = null,
  subscribeStore = true,
  deferAnnouncement = false,
  controlHeartbeatMs = CONTROL_HEARTBEAT_MS,
  lifecycleTarget = globalThis,
  controlId = persistentControlId(),
  channelName = VJ1.channelName,
  onDmxFixture = null,
}) {
  const channel = new BroadcastChannel(channelName);
  const sessionId = `control-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const clients = new Map();
  const reportedConflicts = new Map();
  let announced = false;
  let released = false;
  let recoveryMediaFrame = 0;
  let recoveryMediaTimer = 0;
  let activeRecovery = null;
  let recoveryMediaBlocked = false;
  let pendingRecoveryState = null;
  let pendingRecoveryMedia = null;
  let knownNodePackages = [];
  const liveSynchronization = new LivePatchSynchronizer({
    onPatch(packet) {
      channel.postMessage(protocolMessage({
        type: "live-patch",
        ...packet,
        sessionId,
        transport: { sentAtMs: transportTimestampMs() },
      }));
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
      if (msg.type === "hello") {
        if (!announced || released) return;
        if (!hasCurrentProtocol(msg)) {
          rejectProtocol(msg);
          return;
        }
        const clientId = String(msg.clientId || "");
        if (!clientId) return;
        if (msg.sessionId !== sessionId) {
          clients.delete(clientId);
          if (!msg.controlId || msg.controlId === controlId) claimOutput(clientId);
          return;
        }
        sendControlHeartbeat(clientId);
        const isNewClient = !clients.has(clientId);
        clients.set(clientId, { at: performance.now(), outputId: msg.outputId || "output-main" });
        reportedConflicts.delete(clientId);
        if (isNewClient) {
          // State is the activation barrier for a newly connected Output.
          // Publish its dependency snapshots first so the receiver can install
          // resources before compiling the graph described by that state.
          sendKnownNodePackages();
          sendKnownMediaFiles();
          sendState(null, { targetClientId: clientId });
        }
        return;
      }
      if (!hasCurrentProtocol(msg)) {
        if (msg.clientId) rejectProtocol(msg);
        return;
      }
      if (msg.type === "control-conflict" && msg.targetSessionId === sessionId) {
        const clientId = String(msg.clientId || "");
        const ownerSessionId = String(msg.ownerSessionId || "");
        clients.delete(clientId);
        if (reportedConflicts.get(clientId) === ownerSessionId) return;
        reportedConflicts.set(clientId, ownerSessionId);
        diagnostics?.record?.("error", [{
          code: "VJ1_OUTPUT_CONTROL_CONFLICT",
          outputId: String(msg.outputId || "output-main"),
          message: "This Output is controlled by another VJ1 tab. Close that tab or wait for its connection to expire before taking control here.",
        }], "control · output bridge", 1);
        return;
      }
      const clientId = String(msg.clientId || "");
      if (!clientId || !clients.has(clientId)) return;
      if (msg.sessionId !== sessionId) return;
      clients.get(clientId).at = performance.now();
      if (msg.type === "recovery-state" && !store.getState().project.folderName && msg.state?.project?.folderName) {
        const recoveredState = resetRecoveredLiveSession(stateWithoutThumbnailUrls(msg.state));
        const recoveryId = String(msg.recoveryId || "");
        if (!recoveryId) return;
        activeRecovery = {
          id: recoveryId,
          folderName: String(recoveredState.project.folderName || ""),
          clientId,
        };
        if (recoveryMediaBlocked) {
          // Local project.json and its thumbnail cache are authoritative and
          // now load before media traversal. Keep Output recovery as fallback
          // instead of committing the same large project twice during boot.
          pendingRecoveryState = { state: recoveredState, recovery: activeRecovery };
        } else {
          store.replace(recoveredOutputProjectState(
            recoveredState,
            store.getState().project,
          ), "project-output-recovery");
        }
        return;
      }
      if (msg.type === "recovery-media-files" && activeRecovery) {
        const recovery = {
          id: String(msg.recoveryId || ""),
          folderName: String(msg.folderName || ""),
          clientId,
        };
        if (
          recovery.id === activeRecovery.id
          && recovery.folderName === activeRecovery.folderName
          && recovery.clientId === activeRecovery.clientId
        ) {
          scheduleRecoveryMedia(msg.files || [], recovery);
        }
        return;
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
          next.profileDiagnostic = msg.metrics?.profileDiagnostic || null;
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
      if (msg.type === "dmx-fixture") {
        onDmxFixture?.({
          ...(msg.payload || {}),
          source: {
            ...(msg.payload?.source || {}),
            rendererId: msg.clientId,
            mode: msg.mode === "output" ? "output" : "preview",
            outputId: String(msg.outputId || ""),
          },
        });
      }
      if (msg.type === "dmx-source-release") {
        onDmxFixture?.({
          releaseSources: true,
          source: { rendererId: msg.clientId },
        });
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
    released = false;
    clients.clear();
    claimOutput();
    return true;
  }

  function claimOutput(targetClientId = "") {
    if (!announced || released) return false;
    channel.postMessage(protocolMessage({
      type: "control-hello",
      controlId,
      sessionId,
      targetClientId,
    }));
    return true;
  }

  function sendControlHeartbeat(targetClientId = "") {
    if (!announced || released) return false;
    channel.postMessage(protocolMessage({
      type: "control-heartbeat",
      controlId,
      sessionId,
      targetClientId,
    }));
    return true;
  }

  function relinquishControl(reason = "close") {
    if (!announced || released) return false;
    released = true;
    clients.clear();
    channel.postMessage(protocolMessage({
      type: "control-goodbye",
      controlId,
      sessionId,
      reason,
    }));
    return true;
  }

  const handlePageHide = () => relinquishControl("pagehide");
  const handlePageShow = (event) => {
    if (!event?.persisted || !announced || !released) return;
    released = false;
    claimOutput();
  };
  lifecycleTarget?.addEventListener?.("pagehide", handlePageHide);
  lifecycleTarget?.addEventListener?.("pageshow", handlePageShow);
  const controlHeartbeat = setInterval(
    () => sendControlHeartbeat(),
    Math.max(250, Number(controlHeartbeatMs) || CONTROL_HEARTBEAT_MS),
  );

  function rejectProtocol(message) {
    const clientId = String(message?.clientId || "");
    diagnostics?.record?.("error", [{
      code: "VJ1_OUTPUT_PROTOCOL_MISMATCH",
      expected: OUTPUT_BRIDGE_PROTOCOL_VERSION,
      received: message?.protocolVersion ?? null,
      clientId,
    }], "control · output bridge", 1);
    channel.postMessage(protocolMessage({
      type: "protocol-mismatch",
      targetClientId: clientId,
      expected: OUTPUT_BRIDGE_PROTOCOL_VERSION,
      received: message?.protocolVersion ?? null,
      action: "reload",
      sessionId,
    }));
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
      // Output recovery is a useful read-only fallback, but it must never make
      // a failed local-folder restore look writable. Preserve the local
      // permission/load diagnostic until a directory really opens.
      store.replace(recoveredOutputProjectState(
        pendingState.state,
        store.getState().project,
      ), "project-output-recovery");
    }
    if (pending) scheduleRecoveryMedia(pending.files, pending.recovery);
  }

  function acceptStateChange(_state, reason, change = {}) {
    const outputEffect = change.effects?.output;
    if (!["live-patches", "state"].includes(outputEffect?.mode) || change.command?.domain !== "live") return;
    if (!Array.isArray(change.livePatches) || !change.livePatches.length) {
      if (reason === "live:surface-visibility") {
        // One eye can alter several fallback routes, so send the complete
        // derived Surface program as one revisioned value. Do not serialize
        // the complete project: Components, media, definitions, and resources
        // are unchanged and can be hundreds of times larger than this route
        // projection.
        const projected = store.getLiveRenderState?.() || _state || {};
        queueLivePatches([
          createRenderStatePatch("surfaces", projected.surfaces || []),
        ]);
        flushLivePatches();
      } else {
        sendState();
      }
      return;
    }
    queueLivePatches(change.livePatches);
    if (outputEffect.coalesce === true) {
      scheduleLivePatches();
      return;
    }
    flushLivePatches();
  }
  const unsubscribeLiveState = subscribeStore ? store.subscribe?.(acceptStateChange) : null;

  function sendState(stateOverride = null, {
    targetClientId = "",
    activation = "full",
  } = {}) {
    const scopedActivation = ["assets", "projection"].includes(activation)
      ? activation
      : "full";
    if (!targetClientId) {
      liveSynchronization.stateRevision({ broadcast: true });
    }
    postStateMessage(channel, protocolMessage({
      type: "state",
      state: stateWithoutThumbnailUrls(stateOverride || store.getLiveRenderState?.() || store.getRenderState?.() || store.getState()),
      targetClientId,
      activation: scopedActivation,
      revision: liveSynchronization.revision,
      sessionId,
      transport: { sentAtMs: transportTimestampMs() },
    }));
  }

  function queueLivePatches(patches) {
    // BroadcastChannel is a structured-clone boundary. Patches are small, so
    // detach only this transport packet—not the project—from any draft-backed
    // object a caller may have collected inside an authoring transaction.
    liveSynchronization.queue(materializeStructuralTree(patches));
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
    channel.postMessage(protocolMessage({ type: "media-files", files: files || [], sessionId }));
  }

  function sendNodePackages(packages = []) {
    knownNodePackages = Array.isArray(packages) ? packages : [];
    channel.postMessage(protocolMessage({
      type: "node-packages",
      packages: knownNodePackages,
      packageLock: transportedNodePackageLock(knownNodePackages),
      sessionId,
    }));
  }

  function sendKnownNodePackages() {
    channel.postMessage(protocolMessage({
      type: "node-packages",
      packages: knownNodePackages,
      packageLock: transportedNodePackageLock(knownNodePackages),
      sessionId,
    }));
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
    channel.postMessage(protocolMessage({ type: "command", command: name, payload, sessionId }));
  }

  return {
    sendState,
    sendRenderPatches,
    sendMediaFiles,
    sendNodePackages,
    acceptStateChange,
    announceControl,
    beginProjectRestore,
    finishProjectRestore,
    command,
    controlId,
    sessionId,
    close: () => {
      relinquishControl("close");
      cancelPendingLivePatches();
      cancelRecoveryMediaSchedule();
      activeRecovery = null;
      pendingRecoveryState = null;
      pendingRecoveryMedia = null;
      recoveryMediaBlocked = false;
      unsubscribeLiveState?.();
      clearInterval(clientWatchdog);
      clearInterval(controlHeartbeat);
      lifecycleTarget?.removeEventListener?.("pagehide", handlePageHide);
      lifecycleTarget?.removeEventListener?.("pageshow", handlePageShow);
      channel.close();
    },
  };
}

function resetRecoveredLiveSession(state = {}) {
  if (!state.ui?.live) return state;
  return {
    ...state,
    ui: {
      ...state.ui,
      live: resetSceneMappingSession(state.ui.live),
    },
  };
}

export function createOutputBridge({
  onState,
  onLivePatch,
  onMediaFiles,
  onNodePackages,
  onCommand,
  onControlHello,
  onProtocolMismatch,
  mode,
  outputId = "",
  controlLeaseMs = CONTROL_LEASE_MS,
  channelName = VJ1.channelName,
}) {
  const channel = new BroadcastChannel(channelName);
  const clientId = `${mode}-${outputId || "default"}-${Math.random().toString(36).slice(2)}`;
  const transportProfiler = createOutputTransportProfiler();
  const recoveryTimers = new Set();
  let controlSessionId = "";
  let controlOwnerId = "";
  let controlSessionSeenAt = 0;
  let pendingLivePatch = null;
  let livePatchScheduled = false;
  let livePatchScheduleToken = 0;
  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "protocol-mismatch" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      onProtocolMismatch?.({
        expected: Number(msg.expected) || OUTPUT_BRIDGE_PROTOCOL_VERSION,
        received: msg.received ?? null,
        action: String(msg.action || "reject"),
      });
      return;
    }
    if (msg.type === "control-hello" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      if (!hasCurrentProtocol(msg)) {
        onProtocolMismatch?.({
          expected: OUTPUT_BRIDGE_PROTOCOL_VERSION,
          received: msg.protocolVersion ?? null,
          action: "reload",
        });
        return;
      }
      const nextSessionId = String(msg.sessionId || "");
      const nextOwnerId = String(msg.controlId || nextSessionId);
      if (!nextSessionId) return;
      // Output is a single-writer resource. A second Control may observe it,
      // but may not reset its compiled state or revision stream while the
      // current tab's lease is alive.
      if (
        controlOwnerId
        && nextOwnerId !== controlOwnerId
        && !expireControlLease()
      ) {
        rejectCompetingControl(nextSessionId);
        return;
      }
      acceptControlSession(nextSessionId, nextOwnerId);
      return;
    }
    if (msg.type === "control-heartbeat" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      if (!hasCurrentProtocol(msg)) return;
      const nextSessionId = String(msg.sessionId || "");
      const nextOwnerId = String(msg.controlId || nextSessionId);
      if (!nextSessionId) return;
      if (nextOwnerId === controlOwnerId && nextSessionId === controlSessionId) {
        controlSessionSeenAt = performance.now();
      } else if (
        !controlOwnerId
        || nextOwnerId === controlOwnerId
        || expireControlLease()
      ) {
        acceptControlSession(nextSessionId, nextOwnerId);
      }
      return;
    }
    if (msg.type === "control-goodbye") {
      const goodbyeOwnerId = String(msg.controlId || msg.sessionId || "");
      if (
        !hasCurrentProtocol(msg)
        || goodbyeOwnerId !== controlOwnerId
        || msg.sessionId !== controlSessionId
      ) return;
      if (msg.reason === "pagehide") beginControlRefreshGrace();
      else releaseControlSession();
      hello();
      return;
    }
    if (!hasCurrentProtocol(msg)) return;
    if (authoritativeControlMessage(msg.type)) {
      if (!controlSessionId || msg.sessionId !== controlSessionId) return;
      controlSessionSeenAt = performance.now();
    } else if (msg.sessionId && controlSessionId && msg.sessionId !== controlSessionId) {
      return;
    }
    if (msg.type === "state" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      const pendingAfterState = takePendingLivePatch();
      const transport = transportProfiler.receive({
        kind: "state",
        revision: msg.revision,
        sentAtMs: msg.transport?.sentAtMs,
      });
      onState?.(msg.state, {
        revision: Number(msg.revision) || 0,
        sessionId: String(msg.sessionId || controlSessionId),
        activation: ["assets", "projection"].includes(msg.activation)
          ? msg.activation
          : "full",
        transport,
      });
      applyPendingLivePatchAfterState(pendingAfterState, Number(msg.revision) || 0);
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
    if (msg.type === "node-packages") onNodePackages?.(msg.packages || [], msg.packageLock || []);
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
          ? `component:${patch.componentId}${patch.nodeId ? `:node:${patch.nodeId}` : ""}`
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
    const pending = takePendingLivePatch();
    if (!pending?.patches.size) return;
    onLivePatch?.([...pending.patches.values()], {
      baseRevision: pending.baseRevision,
      revision: pending.revision,
      sessionId: pending.sessionId,
      transport: pending.transport,
    });
  }

  function takePendingLivePatch() {
    if (livePatchScheduled) livePatchScheduleToken++;
    livePatchScheduled = false;
    const pending = pendingLivePatch;
    pendingLivePatch = null;
    return pending;
  }

  function applyPendingLivePatchAfterState(pending, stateRevision) {
    if (!pending?.patches.size || pending.revision <= stateRevision) return;
    // Complete state is installed before later values. When it falls inside a
    // coalesced packet's revision range it already contains every earlier
    // revision, so the packet can continue exactly from that state instead of
    // producing a false startup gap and an unbounded resync loop.
    const baseRevision = pending.baseRevision <= stateRevision
      ? stateRevision
      : pending.baseRevision;
    onLivePatch?.([...pending.patches.values()], {
      baseRevision,
      revision: pending.revision,
      sessionId: pending.sessionId,
      transport: pending.transport,
    });
  }

  function cancelPendingLivePatch() {
    takePendingLivePatch();
  }

  function hello() {
    expireControlLease();
    channel.postMessage(protocolMessage({
      type: "hello",
      clientId,
      mode,
      outputId,
      controlId: controlOwnerId,
      sessionId: controlSessionId,
    }));
  }

  function acceptControlSession(nextSessionId, nextOwnerId) {
    cancelPendingLivePatch();
    const changed = nextSessionId !== controlSessionId;
    controlOwnerId = nextOwnerId;
    controlSessionId = nextSessionId;
    controlSessionSeenAt = performance.now();
    // A refreshed controller should not wait for the heartbeat before it
    // discovers this still-running Output.
    hello();
    onControlHello?.({ sessionId: controlSessionId, changed });
  }

  function rejectCompetingControl(nextSessionId) {
    channel.postMessage(protocolMessage({
      type: "control-conflict",
      clientId,
      outputId,
      targetSessionId: nextSessionId,
      ownerSessionId: controlSessionId,
    }));
  }

  function releaseControlSession() {
    cancelPendingLivePatch();
    controlOwnerId = "";
    controlSessionId = "";
    controlSessionSeenAt = 0;
  }

  function beginControlRefreshGrace() {
    cancelPendingLivePatch();
    // Closing and refreshing both dispatch pagehide. Keep the stable tab
    // identity reserved for one full lease: a refreshed page can reclaim it
    // immediately, while a genuinely closed tab still releases predictably.
    controlSessionSeenAt = performance.now();
  }

  function expireControlLease() {
    if (!controlOwnerId) return false;
    if (performance.now() - controlSessionSeenAt <= effectiveControlLeaseMs()) return false;
    releaseControlSession();
    return true;
  }

  function effectiveControlLeaseMs() {
    return Math.max(1, Number(controlLeaseMs) || CONTROL_LEASE_MS);
  }

  function metrics(metrics) {
    channel.postMessage(protocolMessage({
      type: "metrics",
      clientId,
      outputId,
      metrics: { ...metrics, transport: transportProfiler.snapshot() },
      sessionId: controlSessionId,
    }));
  }

  function diagnostic(entry) {
    if (!entry?.message) return;
    channel.postMessage(protocolMessage({
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
      sessionId: controlSessionId,
    }));
  }

  function mappingState(mappingId, mapping, status, meta = {}) {
    channel.postMessage(protocolMessage({
      type: "mapping-state",
      clientId,
      mappingId,
      mapping,
      status,
      live: meta.live === true,
      sessionId: controlSessionId,
    }));
  }

  function requestMediaFiles(mediaIds = []) {
    channel.postMessage(protocolMessage({
      type: "request-media-files",
      clientId,
      mode,
      mediaIds,
      sessionId: controlSessionId,
    }));
  }

  function requestState() {
    channel.postMessage(protocolMessage({
      type: "request-state",
      clientId,
      mode,
      outputId,
      sessionId: controlSessionId,
    }));
  }

  function recoveryState(state, files = []) {
    if (!state?.project?.folderName) return;
    const folderName = String(state.project.folderName || "");
    const recoveryId = `${clientId}-${Date.now().toString(36)}`;
    channel.postMessage(protocolMessage({
      type: "recovery-state",
      state: stateWithoutThumbnailUrls(state),
      recoveryId,
      folderName,
      clientId,
      sessionId: controlSessionId,
    }));
    if (!files.length) return;
    const timer = setTimeout(() => {
      recoveryTimers.delete(timer);
      channel.postMessage(protocolMessage({
        type: "recovery-media-files",
        folderName,
        files,
        recoveryId,
        clientId,
        sessionId: controlSessionId,
      }));
    }, 0);
    recoveryTimers.add(timer);
  }

  function dmxFixture(payload = {}) {
    channel.postMessage(protocolMessage({
      type: "dmx-fixture",
      clientId,
      mode,
      outputId,
      payload,
      sessionId: controlSessionId,
    }));
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
    dmxFixture,
    markTransportApplied: transportProfiler.applied,
    markTransportRendered: transportProfiler.rendered,
    recordTransportResync: transportProfiler.resync,
    close: () => {
      channel.postMessage(protocolMessage({
        type: "dmx-source-release",
        clientId,
        mode,
        outputId,
        sessionId: controlSessionId,
      }));
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

function authoritativeControlMessage(type) {
  return [
    "state",
    "live-patch",
    "media-files",
    "node-packages",
    "command",
  ].includes(type);
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

function transportedNodePackageLock(packages = []) {
  return (packages || []).map((nodePackage) => ({
    id: String(nodePackage?.id || ""),
    version: String(nodePackage?.version || ""),
    integrity: String(nodePackage?.metadata?.repositoryContentIntegrity || "").toLowerCase(),
  }));
}
