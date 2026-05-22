// PeerJS transport for sending raw TSPL bytes to an ESP32 print host.
// Requires peerjs and labelPrinterProtocol.js.

class PeerLabelPrinter {
  constructor({
    protocol = "tspl",
    host = "0.peerjs.com",
    port = 443,
    path = "/",
    key = "peerjs",
    secure = true,
    localId = "",
    remoteId = "printhost",
    autoSuffixRemoteId = true,
    remoteIdSuffixes = ["a", "b", "c", "d", "e"],
    chunkSize = 180,
    chunkDelayMs = 1,
    progressCooldownMs = 0,
    connectTimeoutMs = 30000,
    dataChannelTimeoutMs = 60000,
    candidateRetryCount = 0,
    scanPauseMs = 250,
    connectedSettleMs = 500,
    heartbeatIntervalMs = 5000,
    heartbeatTimeoutMs = 30000,
    debug = false,
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.protocol = String(protocol || "tspl").toLowerCase();
    this.host = host;
    this.port = Number(port) || 443;
    this.path = path || "/";
    this.key = key || "peerjs";
    this.secure = secure !== false && secure !== "false";
    this.localId = localId || `portal-${Math.floor(Math.random() * 10000)}`;
    this.remoteId = remoteId || "printhost";
    this.autoSuffixRemoteId = autoSuffixRemoteId !== false;
    this.remoteIdSuffixes = Array.isArray(remoteIdSuffixes) ? remoteIdSuffixes.slice(0, 5) : ["a", "b", "c", "d", "e"];
    this.chunkSize = Math.max(64, Math.min(1024, Number(chunkSize) || 180));
    this.chunkDelayMs = Math.max(0, Number.isFinite(Number(chunkDelayMs)) ? Number(chunkDelayMs) : 1);
    this.progressCooldownMs = Math.max(0, Number.isFinite(Number(progressCooldownMs)) ? Number(progressCooldownMs) : 0);
    this.connectTimeoutMs = Math.max(2000, Number(connectTimeoutMs) || 30000);
    this.dataChannelTimeoutMs = Math.max(this.connectTimeoutMs, Number(dataChannelTimeoutMs) || 60000);
    this.candidateRetryCount = Math.max(0, Math.min(3, Number(candidateRetryCount) || 0));
    this.scanPauseMs = Math.max(0, Number(scanPauseMs) || 250);
    this.connectedSettleMs = Math.max(0, Number.isFinite(Number(connectedSettleMs)) ? Number(connectedSettleMs) : 500);
    this.heartbeatIntervalMs = Math.max(1000, Number(heartbeatIntervalMs) || 3000);
    this.heartbeatTimeoutMs = Math.max(this.heartbeatIntervalMs * 2, Number(heartbeatTimeoutMs) || 9000);
    this.debug = debug === true;

    this._onState = typeof onState === "function" ? onState : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";
    this.peer = null;
    this.connection = null;
    this.connectedRemoteId = "";
    this._connectToken = 0;
    this._writeQueue = Promise.resolve();
    this._encoder = new TextEncoder();
    this._protocol = null;
    this._heartbeatTimer = null;
    this._lastSeenAt = 0;
    this._pendingPrints = new Map();
    this._candidateResponded = false;
    this._peerResponseTrackerInstalled = false;
  }

  async init() {
    if (typeof Peer === "undefined" && typeof loadScript === "function") {
      await loadScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
    }
    if (typeof Peer === "undefined") {
      throw new Error("PeerLabelPrinter: PeerJS is not loaded");
    }
    if (!window.LabelPrinterProtocol) {
      throw new Error("PeerLabelPrinter: load portal/labelPrinterProtocol.js first");
    }
    this._protocol = new LabelPrinterProtocol();
    this.ready = true;
    this._setState("ready");
    return this;
  }

  async connect() {
    if (!this.ready) await this.init();
    if (this.connected) return true;
    if (this.connecting) return false;

    this.connecting = true;
    const token = ++this._connectToken;
    console.info(`[PeerLabelPrinter] connecting to PeerJS server ${this.host}:${this.port}`);
    this._setState("connecting_server");

    try {
      await this._openPeer(token);
      const candidates = this._buildRemoteCandidates(this.remoteId);
      for (const candidate of candidates) {
        if (token !== this._connectToken) return false;
        for (let attempt = 0; attempt <= this.candidateRetryCount; attempt++) {
          if (token !== this._connectToken) return false;
          const attemptText = attempt > 0 ? ` retry ${attempt}` : "";
          console.info(`[PeerLabelPrinter] trying ESP32 id ${candidate}${attemptText}`);
          this._setState("connecting_peer", { candidate, attempt });
          const result = await this._tryConnectCandidate(candidate, token);
          if (result === "connected") {
            this.connectedRemoteId = candidate;
            this.connected = true;
            this.connecting = false;
            this._attachConnectedHandlers(this.connection);
            this._startHeartbeat();
            this._setState("connected");
            console.info(`[PeerLabelPrinter] connected to ${candidate}`);
            this._onConnect?.();
            return true;
          }
          if (result === "responded") {
            if (attempt < this.candidateRetryCount) {
              console.warn(`[PeerLabelPrinter] ${candidate} answered signaling, retrying data channel`);
              await this._delay(this.scanPauseMs);
              continue;
            }
            console.error(`[PeerLabelPrinter] ${candidate} answered signaling but data channel did not open`);
            throw new Error(`ESP32 responded as ${candidate}, but the data channel did not open`);
          }
          console.info(`[PeerLabelPrinter] no connection for ${candidate}`);
          break;
        }
        await this._delay(this.scanPauseMs);
      }
      throw new Error(`Could not connect to ESP32 id ${this.remoteId}`);
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this._safeCloseConnection();
      this._safeDestroyPeer();
      this._setState("error", { error });
      console.error("[PeerLabelPrinter] connect failed", error);
      this._handleError(error);
      throw error;
    }
  }

  async disconnect() {
    this._connectToken++;
    this._stopHeartbeat();
    this._safeCloseConnection();
    this._safeDestroyPeer();
    this.connected = false;
    this.connecting = false;
    this.connectedRemoteId = "";
    this._setState("disconnected");
    this._onDisconnect?.();
  }

  async writeBytes(bytes, { onProgress = null } = {}) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!this.connected || !this.connection?.open) {
      throw new Error("PeerLabelPrinter: not connected");
    }

    this._writeQueue = this._writeQueue.then(() => this._sendPrintJob(data, { onProgress }));
    return await this._writeQueue;
  }

  async print(data, { protocol = this.protocol } = {}) {
    const encoded = this._protocol.encode(data, { protocol });
    await this.writeBytes(encoded);
  }

  async printTspl(tspl) {
    await this.print(tspl, { protocol: "tspl" });
  }

  async printTsplBitmap(imageData, options = {}) {
    const bytes = LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder);
    await this.writeBytes(bytes);
  }

  getConnectionState() {
    return {
      ready: this.ready,
      connected: this.connected,
      connecting: this.connecting,
      state: this.state,
      transport: "peer",
      peerId: this.peer?.id || this.localId,
      remoteId: this.connectedRemoteId || this.remoteId,
      candidate: this._candidate || "",
      suggestedOutputMode: "label",
    };
  }

  getSuggestedOutputMode() {
    return "label";
  }

  async _openPeer(token) {
    this._safeDestroyPeer();
    const peerOptions = {
      host: this.host,
      port: this.port,
      path: this.path,
      key: this.key,
      secure: this.secure,
      debug: this.debug ? 2 : 0,
    };

    this.peer = new Peer(this.localId, peerOptions);
    const openingPeer = this.peer;
    await new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("PeerJS server connection timed out"));
      }, this.connectTimeoutMs);
      const onOpen = () => {
        if (settled) return;
        opened = true;
        settled = true;
        clearTimeout(timer);
        console.info(`[PeerLabelPrinter] browser peer open as ${this.peer?.id || this.localId}`);
        resolve();
      };
      const onError = (error) => {
        const message = error?.message || String(error || "");
        if (opened || message.includes("Could not connect to peer")) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error("[PeerLabelPrinter] PeerJS server error", error);
        reject(error);
      };
      this.peer.once("open", onOpen);
      this.peer.once("error", onError);
      this.peer.once("disconnected", () => {
        if (this.peer === openingPeer && this.connecting && token === this._connectToken && !this.connected) {
          console.warn("[PeerLabelPrinter] PeerJS server disconnected while connecting");
          this._setState("server_disconnected");
        }
      });
    });
    this._installPeerResponseTracker();
    this._setState("server_ready");
  }

  _tryConnectCandidate(candidate, token) {
    return new Promise((resolve) => {
      let settled = false;
      this._candidateResponded = false;
      const conn = this.peer.connect(candidate, {
        label: "portal",
        reliable: true,
        serialization: "raw",
      });
      this._candidate = candidate;
      this.connection = conn;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(dataChannelTimer);
        conn.off?.("open", onOpen);
        conn.off?.("data", onData);
        conn.off?.("error", onError);
        conn.off?.("close", onClose);
        if (result !== "connected") {
          try {
            conn.close();
          } catch {}
          if (this.connection === conn) this.connection = null;
        }
        this.peer?.off?.("error", onPeerError);
        resolve(result);
      };

      const markResponded = () => {
        if (this._candidateResponded) return;
        this._candidateResponded = true;
        this._lastSeenAt = Date.now();
        this._setState("connecting_peer", { candidate, responded: true });
      };
      const waitForDataChannel = () => {
        if (!this._candidateResponded) {
          finish("failed");
          return;
        }
        console.info(`[PeerLabelPrinter] ${candidate} responded, staying on this id`);
        this._setState("connecting_peer", { candidate, responded: true });
        dataChannelTimer = setTimeout(() => finish("responded"), this.dataChannelTimeoutMs);
      };
      const finishConnectedIfOpen = () => {
        clearTimeout(dataChannelTimer);
        dataChannelTimer = setTimeout(() => {
          finish(conn.open ? "connected" : "responded");
        }, this.connectedSettleMs);
      };
      const onOpen = () => {
        markResponded();
        finishConnectedIfOpen();
      };
      const onData = () => {
        markResponded();
        if (conn.open) finish("connected");
      };
      const onError = () => finish(this._candidateResponded ? "responded" : "failed");
      const onPeerError = (error) => {
        const message = error?.message || String(error || "");
        if (message.includes("Could not connect to peer") || message.includes(candidate)) {
          if (!this._candidateResponded) finish("failed");
        }
      };
      const onClose = () => {
        if (this.connected && this.connection === conn) {
          this._rejectPendingPrints(new Error("PeerLabelPrinter: data channel closed"));
          this.connected = false;
          this.connectedRemoteId = "";
          this._setState("disconnected");
          this._onDisconnect?.();
        } else {
          finish(this._candidateResponded ? "responded" : "failed");
        }
      };
      let dataChannelTimer = null;
      const timer = setTimeout(waitForDataChannel, this.connectTimeoutMs);

      conn.on("open", onOpen);
      conn.on("data", onData);
      conn.on("error", onError);
      conn.on("close", onClose);
      this.peer?.on?.("error", onPeerError);
    });
  }

  _installPeerResponseTracker() {
    if (!this.peer || this._peerResponseTrackerInstalled || typeof this.peer._handleMessage !== "function") return;
    this._peerResponseTrackerInstalled = true;
    const handleMessage = this.peer._handleMessage.bind(this.peer);
    this.peer._handleMessage = (message) => {
      if (
        this.connecting &&
        !this.connected &&
        this._candidate &&
        message &&
        message.src === this._candidate &&
        (message.type === "ANSWER" || message.type === "CANDIDATE")
      ) {
        this._candidateResponded = true;
        this._lastSeenAt = Date.now();
        this._setState("connecting_peer", { candidate: this._candidate, responded: true });
        if (message.type === "ANSWER") {
          console.info(`[PeerLabelPrinter] ${this._candidate} answered signaling`);
        }
      }

      return handleMessage(message);
    };
  }

  _attachConnectedHandlers(conn) {
    this._lastSeenAt = Date.now();
    conn.on("data", (data) => this._handleIncomingData(data));
    conn.on("close", () => this._markDisconnected("disconnected"));
    conn.on("error", (error) => {
      this._handleError(error);
      this._markDisconnected("error");
    });
  }

  _handleIncomingData(data) {
    this._lastSeenAt = Date.now();
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data.text()
        .then((message) => this._handleIncomingMessage(message))
        .catch((error) => this._handleError(error));
      return;
    }

    let message = "";
    if (typeof data === "string") {
      message = data;
    } else if (data instanceof ArrayBuffer) {
      message = new TextDecoder().decode(new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      message = new TextDecoder().decode(data);
    }

    if (!message) return;
    this._handleIncomingMessage(message);
  }

  _handleIncomingMessage(message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed?.cmd === "peer:pong") {
        this._setState("connected");
      } else if (parsed?.type === "print") {
        if (this.debug && parsed.state !== "progress") console.log("[PeerLabelPrinter] print", parsed);
        this._handlePrintStatus(parsed);
      }
    } catch {
      if (this.debug) console.log("[PeerLabelPrinter] data", message);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._lastSeenAt = Date.now();
    this._heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.connection?.open) {
        this._markDisconnected("disconnected");
        return;
      }

      if (Date.now() - this._lastSeenAt > this.heartbeatTimeoutMs) {
        this._markDisconnected("timeout");
        return;
      }

      try {
        this._sendJson({ cmd: "peer:ping", at: Date.now() });
      } catch (error) {
        this._handleError(error);
        this._markDisconnected("error");
      }
    }, this.heartbeatIntervalMs);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _markDisconnected(state = "disconnected") {
    if (!this.connected && !this.connecting) return;
    this._rejectPendingPrints(new Error(`PeerLabelPrinter: ${state}`));
    this._stopHeartbeat();
    this.connected = false;
    this.connecting = false;
    this.connectedRemoteId = "";
    this._safeCloseConnection();
    this._setState(state);
    this._onDisconnect?.();
  }

  async _sendPrintJob(bytes, { onProgress = null } = {}) {
    const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
    const totalChunks = Math.ceil(bytes.length / this.chunkSize);
    const startedPromise = this._waitForPrintState(id, "started", 10000);
    const donePromise = this._waitForPrintDone(id);
    const progressStepBytes = 8192;
    let nextProgressBytes = progressStepBytes;
    this._stopHeartbeat();
    try {
      this._sendJson({ cmd: "print:start", id, protocol: this.protocol, bytes: bytes.length, chunks: totalChunks });
      await startedPromise;
      await this._delay(50);

      for (let seq = 0; seq < totalChunks; seq++) {
        const start = seq * this.chunkSize;
        const end = Math.min(start + this.chunkSize, bytes.length);
        const chunk = bytes.subarray(start, end);
        let progressPromise = null;
        let expectedProgressBytes = 0;
        if (end >= nextProgressBytes && end < bytes.length) {
          expectedProgressBytes = end;
          progressPromise = this._waitForPrintBytes(id, expectedProgressBytes, 30000);
          while (nextProgressBytes <= end) {
            nextProgressBytes += progressStepBytes;
          }
        }
        this._sendBytes(chunk);
        await this._waitForBufferedAmount();
        if (this.chunkDelayMs > 0) {
          await this._delay(this.chunkDelayMs);
        }
        if (progressPromise) {
          const status = await progressPromise;
          const ackBytes = Math.min(Number(status?.bytes) || expectedProgressBytes, bytes.length);
          onProgress?.({ ratio: ackBytes / bytes.length, sentBytes: ackBytes, totalBytes: bytes.length });
          if (this.progressCooldownMs > 0) {
            await this._delay(this.progressCooldownMs);
          }
        } else {
          const ratio = end >= bytes.length ? 0.99 : end / bytes.length;
          onProgress?.({ ratio, sentBytes: end, totalBytes: bytes.length });
        }
      }

      this._sendJson({ cmd: "print:end", id, bytes: bytes.length, chunks: totalChunks });
      await donePromise;
      onProgress?.({ ratio: 1, sentBytes: bytes.length, totalBytes: bytes.length });
    } finally {
      if (this.connected && this.connection?.open) {
        this._startHeartbeat();
      }
    }
  }

  _waitForPrintDone(id) {
    return this._waitForPrintState(id, "done", 30000);
  }

  _waitForPrintBytes(id, bytes, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removePendingPrint(id, waiter);
        reject(new Error(`PeerLabelPrinter: ESP32 did not acknowledge ${bytes} bytes`));
      }, timeoutMs);
      const waiter = { state: "progress", bytes, resolve, reject, timer };
      const waiters = this._pendingPrints.get(id) || [];
      waiters.push(waiter);
      this._pendingPrints.set(id, waiters);
    });
  }

  _waitForPrintState(id, state, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._removePendingPrint(id, waiter);
        reject(new Error(`PeerLabelPrinter: ESP32 did not acknowledge print ${state}`));
      }, timeoutMs);
      const waiter = { state, resolve, reject, timer };
      const waiters = this._pendingPrints.get(id) || [];
      waiters.push(waiter);
      this._pendingPrints.set(id, waiters);
    });
  }

  _handlePrintStatus(status) {
    const waiters = this._pendingPrints.get(status.id);
    if (!waiters?.length) return;
    if (status.state === "done") {
      this._resolvePendingPrintState(status.id, "done", status);
    } else if (status.state === "error" || status.state === "incomplete") {
      const reason = status.reason ? ` (${status.reason})` : "";
      this._rejectPendingPrints(new Error(`ESP32 print ${status.state}${reason}: ${status.bytes || 0} bytes, ${status.chunks || 0} chunks`), status.id);
    } else if (status.state === "progress") {
      this._resolvePendingPrintProgress(status.id, Number(status.bytes) || 0, status);
    } else {
      this._resolvePendingPrintState(status.id, status.state, status);
    }
  }

  _resolvePendingPrintState(id, state, status) {
    const waiters = this._pendingPrints.get(id) || [];
    for (const waiter of [...waiters]) {
      if (waiter.state !== state) continue;
      clearTimeout(waiter.timer);
      waiter.resolve(status);
      this._removePendingPrint(id, waiter);
    }
  }

  _resolvePendingPrintProgress(id, bytes, status) {
    const waiters = this._pendingPrints.get(id) || [];
    for (const waiter of [...waiters]) {
      if (waiter.state !== "progress") continue;
      if (bytes < waiter.bytes) continue;
      clearTimeout(waiter.timer);
      waiter.resolve(status);
      this._removePendingPrint(id, waiter);
    }
  }

  _removePendingPrint(id, waiter) {
    const waiters = this._pendingPrints.get(id) || [];
    const next = waiters.filter((item) => item !== waiter);
    if (next.length) {
      this._pendingPrints.set(id, next);
    } else {
      this._pendingPrints.delete(id);
    }
  }

  _rejectPendingPrints(error, onlyId = null) {
    for (const [id, waiters] of this._pendingPrints) {
      if (onlyId && id !== onlyId) continue;
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this._pendingPrints.delete(id);
    }
  }

  _sendJson(value) {
    this.connection.send(JSON.stringify(value));
  }

  _sendBytes(bytes) {
    this.connection.send(bytes);
  }

  async _waitForBufferedAmount(maxBufferedBytes = 16384) {
    const dataChannel = this.connection?.dataChannel || this.connection?._dc;
    while (dataChannel && dataChannel.bufferedAmount > maxBufferedBytes) {
      await this._delay(10);
    }
  }

  _bytesToBase64(bytes) {
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  }

  _buildRemoteCandidates(remoteId) {
    const baseId = String(remoteId || "").trim();
    if (!baseId || !this.autoSuffixRemoteId) return baseId ? [baseId] : [];
    const candidates = [baseId];
    for (const suffix of this.remoteIdSuffixes) {
      candidates.push(`${baseId}${suffix}`);
    }
    return candidates;
  }

  _safeCloseConnection() {
    this._stopHeartbeat();
    try {
      this.connection?.close?.();
    } catch {}
    this.connection = null;
  }

  _safeDestroyPeer() {
    try {
      this.peer?.destroy?.();
    } catch {}
    this.peer = null;
    this._peerResponseTrackerInstalled = false;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _setState(state, extra = {}) {
    this.state = state;
    this._onState?.({ ...this.getConnectionState(), ...extra });
  }

  _handleError(error) {
    if (this.debug) console.error("[PeerLabelPrinter]", error);
    this._onError?.(error);
  }
}

window.PeerLabelPrinter = PeerLabelPrinter;
