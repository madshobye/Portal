// Reusable low-latency screen sharing for Portal sketches.
//
// Receiver:
//   const sharing = await new PortalScreenSharing({ mode: "receiver", peerId: "my-screen" }).init();
//   const clients = sharing.getClients();
//
// Sender:
//   const sharing = await new PortalScreenSharing({ mode: "sender", name: "Mads" }).init();
//   await sharing.connect("my-screen");
//   await sharing.startScreenShare(); // must be called from a user gesture

class PortalScreenSharing {
  constructor({
    mode = "sender",
    peerId = null,
    peerOptions = {},
    name = "Guest",
    capture = {},
    lowLatency = {},
    onEvent = null,
  } = {}) {
    this.mode = mode === "receiver" ? "receiver" : "sender";
    this.peerId = peerId || null;
    this.peerOptions = { ...peerOptions };
    this.name = this._cleanName(name);
    this.captureOptions = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      audio: false,
      preferCurrentTab: false,
      ...capture,
    };
    this.lowLatencyOptions = {
      contentHint: "detail",
      maxBitrate: 10000000,
      maxFramerate: 30,
      degradationPreference: "maintain-resolution",
      jitterBufferTarget: 0,
      statsIntervalMs: 1000,
      ...lowLatency,
    };
    this._onEvent = typeof onEvent === "function" ? onEvent : null;

    this.peer = null;
    this.ready = false;
    this.open = false;
    this.connected = false;
    this.targetPeerId = null;
    this.dataConnection = null;
    this.mediaCall = null;
    this.localStream = null;
    this.previewVideo = null;
    this.clients = new Map();
    this.localStats = null;
    this.error = "";

    this._hasResult = false;
    this._hasNew = false;
    this._lastEvent = null;
    this._statsTimer = null;
    this._destroyed = false;
  }

  async init() {
    if (typeof ensurePeerJsOnce !== "function") {
      await loadScript("portal/PeerJs.js");
    }
    await ensurePeerJsOnce();

    this.peer = new window.Peer(this.peerId, this.peerOptions);
    this._bindPeerEvents();
    await this._waitForPeerOpen();
    this.ready = true;
    this._startStats();
    return this;
  }

  _bindPeerEvents() {
    this.peer.on("open", (id) => {
      this.peerId = id;
      this.open = true;
      this.error = "";
      this._emit("peer-open", { peerId: id });
    });

    this.peer.on("connection", (connection) => {
      if (this.mode !== "receiver") {
        connection.on("open", () => connection.close());
        return;
      }
      this._attachReceiverDataConnection(connection);
    });

    this.peer.on("call", (call) => {
      if (this.mode !== "receiver") {
        call.close();
        return;
      }
      this._attachIncomingCall(call);
    });

    this.peer.on("disconnected", () => {
      this.open = false;
      this._emit("peer-disconnected", {});
      if (!this._destroyed) {
        try {
          this.peer.reconnect();
        } catch {}
      }
    });

    this.peer.on("close", () => {
      this.open = false;
      this.connected = false;
      this._emit("peer-close", {});
    });

    this.peer.on("error", (error) => this._setError(error));
  }

  _waitForPeerOpen(timeoutMs = 15000) {
    if (this.peer?.open) return Promise.resolve(this.peer.id);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        this.peer?.off?.("open", onOpen);
        this.peer?.off?.("error", onError);
        fn(value);
      };
      const onOpen = (id) => finish(resolve, id);
      const onError = (error) => finish(reject, error);
      const timeout = setTimeout(
        () => finish(reject, new Error("PeerJS connection timed out")),
        timeoutMs
      );
      this.peer.on("open", onOpen);
      this.peer.on("error", onError);
    });
  }

  async connect(targetPeerId, { name = this.name } = {}) {
    if (this.mode !== "sender") {
      throw new Error("PortalScreenSharing.connect() is only available in sender mode");
    }
    if (!this.ready || !this.peer) {
      throw new Error("PortalScreenSharing.connect(): call await init() first");
    }

    const target = String(targetPeerId || "").trim();
    if (!target) throw new Error("A receiver peer ID is required");

    this.disconnect({ keepPeer: true });
    this.targetPeerId = target;
    this.name = this._cleanName(name);

    const connection = this.peer.connect(target, {
      reliable: true,
      serialization: "json",
      metadata: { type: "portal-screen-client", name: this.name },
    });
    this.dataConnection = connection;
    this._attachSenderDataConnection(connection);

    await new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        connection.off?.("open", onOpen);
        connection.off?.("error", onError);
        fn(value);
      };
      const onOpen = () => finish(resolve, connection);
      const onError = (error) => finish(reject, error);
      const timeout = setTimeout(
        () => finish(reject, new Error(`Could not connect to ${target}`)),
        12000
      );
      connection.on("open", onOpen);
      connection.on("error", onError);
    });

    return connection;
  }

  _attachSenderDataConnection(connection) {
    connection.on("open", () => {
      if (this.dataConnection !== connection) return;
      this.connected = true;
      this.error = "";
      connection.send({ type: "hello", name: this.name });
      this._emit("connected", {
        peerId: connection.peer,
        name: this.name,
      });
    });

    connection.on("data", (data) => {
      this._emit("data", { peerId: connection.peer, data });
    });

    connection.on("close", () => {
      if (this.dataConnection !== connection) return;
      this.dataConnection = null;
      this.connected = false;
      this.stopScreenShare();
      this._emit("disconnected", { peerId: connection.peer });
    });

    connection.on("error", (error) => this._setError(error));
  }

  _attachReceiverDataConnection(connection) {
    const peerId = connection.peer;
    const initialName = connection.metadata?.name;
    const client = this._upsertClient(peerId, { name: initialName });
    client.connection = connection;

    connection.on("open", () => {
      const current = this._upsertClient(peerId, { name: initialName });
      current.connection = connection;
      current.connected = true;
      this._emit("client-connected", this._clientSnapshot(current));
    });

    connection.on("data", (data) => {
      const current = this._upsertClient(peerId);
      if (data?.type === "hello") {
        current.name = this._cleanName(data.name);
        current.connected = true;
        this._emit("client-updated", this._clientSnapshot(current));
      } else if (data?.type === "screen-stopped") {
        this._clearClientMedia(current, { closeCall: true });
        this._emit("client-screen-stopped", this._clientSnapshot(current));
      } else {
        this._emit("data", { peerId, data });
      }
    });

    connection.on("close", () => this._removeClient(peerId, "client-disconnected"));
    connection.on("error", (error) => this._setError(error));
  }

  async startScreenShare(options = {}) {
    if (this.mode !== "sender") {
      throw new Error("PortalScreenSharing.startScreenShare() is only available in sender mode");
    }
    if (!this.connected || !this.targetPeerId) {
      throw new Error("Connect to a receiver before sharing the screen");
    }
    const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
    if (typeof getDisplayMedia !== "function") {
      throw new Error("Screen sharing requires Chrome on HTTPS or localhost");
    }

    this.stopScreenShare({ notify: false });
    const settings = { ...this.captureOptions, ...options };
    let stream = null;

    try {
      stream = await getDisplayMedia.call(navigator.mediaDevices, {
        audio: settings.audio === true,
        video: {
          width: { ideal: Number(settings.width) || 1920 },
          height: { ideal: Number(settings.height) || 1080 },
          frameRate: {
            ideal: Number(settings.frameRate) || 30,
            max: Number(settings.frameRate) || 30,
          },
        },
        preferCurrentTab: settings.preferCurrentTab === true,
        selfBrowserSurface: settings.includeCurrentTab === false ? "exclude" : "include",
        surfaceSwitching: settings.surfaceSwitching === false ? "exclude" : "include",
      });

      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("No video track was selected");
      track.contentHint = this.lowLatencyOptions.contentHint || "detail";
      track.addEventListener(
        "ended",
        () => {
          if (this.localStream === stream) this.stopScreenShare();
        },
        { once: true }
      );

      this.localStream = stream;
      this.previewVideo = await this._makeVideo(stream);
      this.mediaCall = this.peer.call(this.targetPeerId, stream, {
        metadata: {
          type: "portal-screen-share",
          name: this.name,
          contentHint: track.contentHint,
        },
      });
      if (!this.mediaCall) throw new Error("Could not create the screen-sharing call");

      const activeCall = this.mediaCall;
      activeCall.on("close", () => {
        if (this.mediaCall === activeCall) this.stopScreenShare({ notify: false });
      });
      activeCall.on("error", (error) => this._setError(error));
      this._configureOutgoingCall(activeCall, track);
      this._emit("screen-started", {
        peerId: this.targetPeerId,
        stream,
        video: this.previewVideo,
      });
      return this.previewVideo;
    } catch (error) {
      this._stopStream(stream);
      this._setError(error);
      throw error;
    }
  }

  stopScreenShare({ notify = true } = {}) {
    const wasSharing = !!this.localStream;
    const call = this.mediaCall;
    this.mediaCall = null;
    if (call) {
      try {
        call.close();
      } catch {}
    }
    this._stopStream(this.localStream);
    this.localStream = null;
    const previewElement = this.previewVideo?.elt || this.previewVideo;
    if (previewElement) previewElement.srcObject = null;
    this.previewVideo?.remove?.();
    this.previewVideo = null;
    this.localStats = null;

    if (notify && this.dataConnection?.open) {
      try {
        this.dataConnection.send({ type: "screen-stopped" });
      } catch {}
    }
    if (wasSharing) this._emit("screen-stopped", { peerId: this.targetPeerId });
  }

  _attachIncomingCall(call) {
    const peerId = call.peer;
    const client = this._upsertClient(peerId, { name: call.metadata?.name });

    if (client.call && client.call !== call) {
      try {
        client.call.close();
      } catch {}
    }
    this._clearClientMedia(client, { closeCall: false });
    client.call = call;

    call.answer();
    call.on("stream", async (stream) => {
      const current = this.clients.get(peerId);
      if (!current || current.call !== call) return;
      current.stream = stream;
      current.video = await this._makeVideo(stream);
      current.sharing = true;
      this._configureIncomingCall(call);

      const track = stream.getVideoTracks()[0];
      track?.addEventListener?.(
        "ended",
        () => {
          const latest = this.clients.get(peerId);
          if (!latest || latest.stream !== stream) return;
          this._clearClientMedia(latest, { closeCall: false });
          this._emit("client-screen-stopped", this._clientSnapshot(latest));
        },
        { once: true }
      );

      this._emit("client-screen-started", this._clientSnapshot(current));
    });

    call.on("close", () => {
      const current = this.clients.get(peerId);
      if (!current || current.call !== call) return;
      this._clearClientMedia(current, { closeCall: false });
      this._emit("client-screen-stopped", this._clientSnapshot(current));
    });
    call.on("error", (error) => this._setError(error));
  }

  async _configureOutgoingCall(call, track, attempt = 0) {
    const pc = call?.peerConnection;
    const sender = pc?.getSenders?.().find((item) => item.track === track);
    if (!sender) {
      if (attempt < 4) {
        setTimeout(() => this._configureOutgoingCall(call, track, attempt + 1), 200);
      }
      return;
    }

    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      const encoding = parameters.encodings[0];
      const maxBitrate = Number(this.lowLatencyOptions.maxBitrate);
      const maxFramerate = Number(this.lowLatencyOptions.maxFramerate);
      if (maxBitrate > 0) encoding.maxBitrate = maxBitrate;
      if (maxFramerate > 0) encoding.maxFramerate = maxFramerate;
      parameters.degradationPreference =
        this.lowLatencyOptions.degradationPreference || "maintain-resolution";
      await sender.setParameters(parameters);
      this._emit("sender-configured", {
        maxBitrate: encoding.maxBitrate,
        maxFramerate: encoding.maxFramerate,
        degradationPreference: parameters.degradationPreference,
      });
    } catch (error) {
      console.warn("[PortalScreenSharing] Could not apply sender parameters", error);
    }
  }

  _configureIncomingCall(call, attempt = 0) {
    const pc = call?.peerConnection;
    const receivers = pc?.getReceivers?.() || [];
    const videoReceiver = receivers.find((receiver) => receiver.track?.kind === "video");
    if (!videoReceiver) {
      if (attempt < 4) {
        setTimeout(() => this._configureIncomingCall(call, attempt + 1), 200);
      }
      return;
    }

    if ("jitterBufferTarget" in videoReceiver) {
      try {
        videoReceiver.jitterBufferTarget = Math.max(
          0,
          Number(this.lowLatencyOptions.jitterBufferTarget) || 0
        );
      } catch (error) {
        console.warn("[PortalScreenSharing] Could not set jitterBufferTarget", error);
      }
    }
  }

  async _makeVideo(stream) {
    const media = typeof createVideo === "function" ? createVideo([]) : null;
    const video = media?.elt || document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    media?.hide?.();
    try {
      await video.play();
    } catch {}
    return media || video;
  }

  _upsertClient(peerId, values = {}) {
    let client = this.clients.get(peerId);
    if (!client) {
      client = {
        peerId,
        name: this._cleanName(values.name || peerId),
        connected: false,
        sharing: false,
        connection: null,
        call: null,
        stream: null,
        video: null,
        stats: null,
        _statsPrevious: null,
        connectedAt: Date.now(),
      };
      this.clients.set(peerId, client);
    } else if (values.name) {
      client.name = this._cleanName(values.name);
    }
    return client;
  }

  _removeClient(peerId, eventType = "client-disconnected") {
    const client = this.clients.get(peerId);
    if (!client) return;
    this.clients.delete(peerId);
    const snapshot = this._clientSnapshot(client);
    this._clearClientMedia(client, { closeCall: true });
    try {
      client.connection?.close?.();
    } catch {}
    this._emit(eventType, snapshot);
  }

  _clearClientMedia(client, { closeCall = false } = {}) {
    const call = client.call;
    client.call = null;
    if (closeCall && call) {
      try {
        call.close();
      } catch {}
    }
    this._stopStream(client.stream);
    client.stream = null;
    const videoElement = client.video?.elt || client.video;
    if (videoElement) videoElement.srcObject = null;
    client.video?.remove?.();
    client.video = null;
    client.sharing = false;
    client.stats = null;
    client._statsPrevious = null;
  }

  getClients() {
    return [...this.clients.values()]
      .map((client) => this._clientSnapshot(client))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getClient(peerId) {
    const client = this.clients.get(peerId);
    return client ? this._clientSnapshot(client) : null;
  }

  _clientSnapshot(client) {
    return {
      peerId: client.peerId,
      name: client.name,
      connected: !!client.connected,
      sharing: !!client.sharing,
      stream: client.stream,
      video: client.video,
      stats: client.stats ? { ...client.stats } : null,
      connectedAt: client.connectedAt,
    };
  }

  getLatest() {
    return {
      mode: this.mode,
      peerId: this.peerId,
      open: this.open,
      connected: this.connected,
      targetPeerId: this.targetPeerId,
      sharing: !!this.localStream,
      localStream: this.localStream,
      previewVideo: this.previewVideo,
      localStats: this.localStats ? { ...this.localStats } : null,
      clients: this.getClients(),
      error: this.error,
      event: this._lastEvent,
    };
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }

  resetNewFlag() {
    this._hasNew = false;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastEvent };
  }

  buildClientUrl(baseUrl = window.location.href) {
    const url = new URL(baseUrl, window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("master", this.peerId || "");
    return url.toString();
  }

  send(data, peerId = null) {
    if (this.mode === "sender") {
      if (!this.dataConnection?.open) return false;
      this.dataConnection.send(data);
      return true;
    }
    const connection = this.clients.get(peerId)?.connection;
    if (!connection?.open) return false;
    connection.send(data);
    return true;
  }

  disconnect({ keepPeer = true } = {}) {
    if (this.mode === "sender") {
      this.stopScreenShare({ notify: false });
      const connection = this.dataConnection;
      this.dataConnection = null;
      try {
        connection?.close?.();
      } catch {}
      this.connected = false;
      this.targetPeerId = null;
    } else {
      for (const peerId of [...this.clients.keys()]) this._removeClient(peerId);
    }
    if (!keepPeer) this.destroy();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearInterval(this._statsTimer);
    this.disconnect({ keepPeer: true });
    try {
      this.peer?.destroy?.();
    } catch {}
    this.peer = null;
    this.ready = false;
    this.open = false;
  }

  _startStats() {
    clearInterval(this._statsTimer);
    const interval = Math.max(250, Number(this.lowLatencyOptions.statsIntervalMs) || 1000);
    this._statsTimer = setInterval(() => this._collectStats(), interval);
  }

  async _collectStats() {
    if (this.mode === "sender") {
      this.localStats = await this._statsForCall(this.mediaCall, null, "outbound-rtp");
      return;
    }
    for (const client of this.clients.values()) {
      client.stats = await this._statsForCall(
        client.call,
        client._statsPrevious,
        "inbound-rtp"
      );
      if (client.stats?._cumulative) client._statsPrevious = client.stats._cumulative;
      if (client.stats) delete client.stats._cumulative;
    }
  }

  async _statsForCall(call, previous, direction) {
    const pc = call?.peerConnection;
    if (!pc?.getStats) return null;
    try {
      const report = await pc.getStats();
      let video = null;
      report.forEach((item) => {
        if (item.type === direction && (item.kind === "video" || item.mediaType === "video")) {
          video = item;
        }
      });
      if (!video) return null;

      const result = {
        framesPerSecond: Number(video.framesPerSecond) || 0,
        frameWidth: Number(video.frameWidth) || 0,
        frameHeight: Number(video.frameHeight) || 0,
        framesDropped: Number(video.framesDropped) || 0,
        packetsLost: Number(video.packetsLost) || 0,
        jitterMs: (Number(video.jitter) || 0) * 1000,
        qualityLimitationReason: video.qualityLimitationReason || "none",
        timestamp: Date.now(),
      };

      if (direction === "inbound-rtp") {
        const delay = Number(video.jitterBufferDelay) || 0;
        const count = Number(video.jitterBufferEmittedCount) || 0;
        if (previous && count > previous.count) {
          result.jitterBufferMs = ((delay - previous.delay) / (count - previous.count)) * 1000;
        } else {
          result.jitterBufferMs = count > 0 ? (delay / count) * 1000 : 0;
        }
        result._cumulative = { delay, count };
      }
      return result;
    } catch {
      return null;
    }
  }

  _emit(type, data) {
    this._lastEvent = { type, data, timestamp: Date.now() };
    this._hasResult = true;
    this._hasNew = true;
    if (this._onEvent) {
      try {
        this._onEvent(this._lastEvent);
      } catch (error) {
        console.warn("[PortalScreenSharing] onEvent callback error", error);
      }
    }
  }

  _setError(error) {
    this.error = String(error?.message || error || "Unknown screen-sharing error");
    this._emit("error", { message: this.error, error });
  }

  _stopStream(stream) {
    for (const track of stream?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {}
    }
  }

  _cleanName(value) {
    const name = String(value || "Guest").trim().replace(/\s+/g, " ");
    return (name || "Guest").slice(0, 40);
  }
}
