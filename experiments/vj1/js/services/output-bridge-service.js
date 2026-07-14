import { VJ1 } from "../constants.js";

export function createControlBridge({ store, mediaLibrary }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const clients = new Map();
  const clientWatchdog = setInterval(() => {
    const count = activeClientCount(clients);
    if (count === store.getState().metrics.clients) return;
    store.update((draft) => {
      draft.metrics.clients = count;
      if (!count) draft.metrics.message = "Output disconnected";
    }, "output-metrics");
  }, 1000);

  channel.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type === "recovery-state" && !store.getState().project.folderName && msg.state?.project?.folderName) {
      if (msg.files?.length) await mediaLibrary.importFiles(msg.files);
      store.replace(msg.state, "project-output-recovery");
      sendMediaFiles(mediaLibrary.getAllFiles());
      return;
    }
    if (msg.type === "hello") {
      const isNewClient = !clients.has(msg.clientId || "output");
      clients.set(msg.clientId || "output", performance.now());
      if (isNewClient || msg.initialSceneId) {
        const initialState = msg.initialSceneId
          ? store.getSceneRenderState?.(msg.initialSceneId)
          : null;
        sendState(initialState, {
          targetClientId: msg.clientId || "",
          initialSceneAccepted: !!msg.initialSceneId,
        });
        sendMediaFiles(mediaLibrary.getAllFiles());
      }
    }
    if (msg.type === "request-media-files") sendMediaFiles(mediaLibrary.getAllFiles());
    if (msg.type === "metrics") {
      clients.set(msg.clientId || "output", performance.now());
      store.update((draft) => {
        draft.metrics = {
          ...draft.metrics,
          ...msg.metrics,
          clients: activeClientCount(clients),
          message: msg.metrics?.message || "Output connected",
        };
      }, "output-metrics");
    }
    if (msg.type === "mapping-state") {
      store.update((draft) => {
        draft.mappings[msg.mappingId || "default"] = msg.mapping;
        draft.ui.mappingStatus = msg.status || "Mapping updated";
      }, msg.live ? "scrub:mapping-state" : "mapping-state");
    }
  };

  channel.postMessage({ type: "control-hello" });

  function sendState(stateOverride = null, { targetClientId = "", initialSceneAccepted = false } = {}) {
    channel.postMessage({
      type: "state",
      state: stateOverride || store.getLiveRenderState?.() || store.getRenderState?.() || store.getState(),
      targetClientId,
      initialSceneAccepted,
    });
  }

  function sendMediaFiles(files) {
    if (!files?.length) return;
    channel.postMessage({ type: "media-files", files });
  }

  function command(name, payload = {}) {
    channel.postMessage({ type: "command", command: name, payload });
  }

  return {
    sendState,
    sendMediaFiles,
    command,
    close: () => {
      clearInterval(clientWatchdog);
      channel.close();
    },
  };
}

export function createOutputBridge({ onState, onMediaFiles, onCommand, onControlHello, mode, initialSceneId = "" }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const clientId = `${mode}-${Math.random().toString(36).slice(2)}`;
  let pendingInitialSceneId = initialSceneId;

  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "state" && (!msg.targetClientId || msg.targetClientId === clientId)) {
      if (msg.initialSceneAccepted) pendingInitialSceneId = "";
      onState?.(msg.state);
    }
    if (msg.type === "media-files") onMediaFiles?.(msg.files || []);
    if (msg.type === "command") onCommand?.(msg.command, msg.payload || {});
    if (msg.type === "control-hello") onControlHello?.();
  };

  function hello() {
    channel.postMessage({ type: "hello", clientId, mode, initialSceneId: pendingInitialSceneId });
  }

  function metrics(metrics) {
    channel.postMessage({ type: "metrics", clientId, metrics });
  }

  function mappingState(mappingId, mapping, status, meta = {}) {
    channel.postMessage({ type: "mapping-state", clientId, mappingId, mapping, status, live: meta.live === true });
  }

  function requestMediaFiles(mediaIds = []) {
    channel.postMessage({ type: "request-media-files", clientId, mode, mediaIds });
  }

  function recoveryState(state, files = []) {
    if (!state?.project?.folderName) return;
    channel.postMessage({ type: "recovery-state", state, files });
  }

  hello();
  setInterval(hello, 2000);
  return { hello, metrics, mappingState, requestMediaFiles, recoveryState, close: () => channel.close(), clientId };
}

function activeClientCount(clients) {
  const now = performance.now();
  for (const [id, lastSeen] of clients) {
    if (now - lastSeen > 5000) clients.delete(id);
  }
  return clients.size;
}
