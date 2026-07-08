import { VJ1 } from "../constants.js";

export function createControlBridge({ store, mediaLibrary }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const clients = new Map();

  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "hello") {
      clients.set(msg.clientId || "output", performance.now());
      sendState();
      sendMediaFiles(mediaLibrary.getAllFiles());
    }
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
      }, "mapping-state");
    }
  };

  function sendState() {
    channel.postMessage({ type: "state", state: store.getState() });
  }

  function sendMediaFiles(files) {
    if (!files?.length) return;
    channel.postMessage({ type: "media-files", files });
  }

  function command(name, payload = {}) {
    channel.postMessage({ type: "command", command: name, payload });
  }

  return { sendState, sendMediaFiles, command, close: () => channel.close() };
}

export function createOutputBridge({ onState, onMediaFiles, onCommand, mode }) {
  const channel = new BroadcastChannel(VJ1.channelName);
  const clientId = `${mode}-${Math.random().toString(36).slice(2)}`;

  channel.onmessage = (event) => {
    const msg = event.data || {};
    if (msg.type === "state") onState?.(msg.state);
    if (msg.type === "media-files") onMediaFiles?.(msg.files || []);
    if (msg.type === "command") onCommand?.(msg.command, msg.payload || {});
  };

  function hello() {
    channel.postMessage({ type: "hello", clientId, mode });
  }

  function metrics(metrics) {
    channel.postMessage({ type: "metrics", clientId, metrics });
  }

  function mappingState(mappingId, mapping, status) {
    channel.postMessage({ type: "mapping-state", clientId, mappingId, mapping, status });
  }

  hello();
  setInterval(hello, 2000);
  return { hello, metrics, mappingState, close: () => channel.close(), clientId };
}

function activeClientCount(clients) {
  const now = performance.now();
  for (const [id, lastSeen] of clients) {
    if (now - lastSeen > 5000) clients.delete(id);
  }
  return clients.size;
}
