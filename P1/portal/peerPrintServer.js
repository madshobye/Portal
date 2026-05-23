// Browser-side PeerJS print server for LabelMaker2.
// Accepts the same raw print protocol used by PeerLabelPrinter and queues jobs
// into a local LabelPrinterTransport.

class PeerPrintServer {
  constructor({
    host = "0.peerjs.com",
    port = 443,
    path = "/",
    key = "peerjs",
    secure = true,
    chunkProgressBytes = 8192,
    onState = null,
    onError = null,
  } = {}) {
    this.host = host;
    this.port = Number(port) || 443;
    this.path = path || "/";
    this.key = key || "peerjs";
    this.secure = secure !== false && secure !== "false";
    this.chunkProgressBytes = Math.max(1024, Number(chunkProgressBytes) || 8192);
    this._onState = typeof onState === "function" ? onState : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.peer = null;
    this.id = "";
    this.running = false;
    this.starting = false;
    this.connections = new Map();
    this.queue = [];
    this.processing = false;
    this.transport = null;
  }

  async init() {
    if (typeof Peer === "undefined" && typeof loadScript === "function") {
      await loadScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
    }
    if (typeof Peer === "undefined") {
      throw new Error("PeerPrintServer: PeerJS is not loaded");
    }
    this._setState("ready");
    return this;
  }

  async start(id, transport) {
    const peerId = String(id || "").trim();
    if (!peerId) throw new Error("PeerPrintServer: peer id is required");
    await this.stop();
    this.transport = transport || null;
    this.id = peerId;
    this.starting = true;
    this._setState("starting");

    const peer = new Peer(peerId, {
      host: this.host,
      port: this.port,
      path: this.path,
      key: this.key,
      secure: this.secure,
      debug: 0,
    });
    this.peer = peer;

    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("PeerPrintServer: PeerJS open timed out"));
      }, 15000);

      peer.once("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      peer.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const message = error?.message || String(error || "");
        const type = error?.type || "";
        if (type === "unavailable-id" || message.includes("is taken") || message.includes("unavailable-id")) {
          reject(new Error(`PeerPrintServer: id "${peerId}" is already taken`));
        } else {
          reject(error || new Error("PeerPrintServer: PeerJS error"));
        }
      });
    }).catch((error) => {
      this.starting = false;
      this.running = false;
      this._safeDestroyPeer();
      this._setState("error", { error });
      throw error;
    });

    peer.on("connection", (conn) => this._handleConnection(conn));
    peer.on("disconnected", () => this._setState("server_disconnected"));
    peer.on("error", (error) => this._handleError(error));

    this.starting = false;
    this.running = true;
    this._setState("running");
    return true;
  }

  async stop() {
    this.starting = false;
    this.running = false;
    this._safeDestroyPeer();
    this.connections.clear();
    this._setState("stopped");
  }

  setTransport(transport) {
    this.transport = transport || null;
    this.processQueue();
  }

  getState() {
    return {
      running: this.running,
      starting: this.starting,
      id: this.id,
      connections: this.connections.size,
      queued: this.queue.length,
      processing: this.processing,
    };
  }

  processQueue() {
    if (this.processing) return;
    this._processQueue();
  }

  _handleConnection(conn) {
    const state = {
      conn,
      buffer: [],
      job: null,
      open: false,
    };
    this.connections.set(conn.connectionId || conn.peer || `${Date.now()}-${Math.random()}`, state);
    conn.on("open", () => {
      state.open = true;
      this._sendText(conn, "labelmaker2 printserver connected");
      this._setState("connection_open");
    });
    conn.on("data", (data) => this._handleData(state, data));
    conn.on("close", () => this._removeConnection(state));
    conn.on("error", (error) => {
      this._handleError(error);
      this._removeConnection(state);
    });
    this._setState("connection");
  }

  _removeConnection(state) {
    for (const [key, entry] of this.connections) {
      if (entry === state) {
        this.connections.delete(key);
      }
    }
    this._setState("connection_closed");
  }

  _handleData(state, data) {
    if (typeof data === "string") {
      this._handleTextMessage(state, data);
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data.arrayBuffer()
        .then((buffer) => this._handleBytes(state, new Uint8Array(buffer)))
        .catch((error) => this._handleError(error));
      return;
    }
    if (data instanceof ArrayBuffer) {
      this._handleBytes(state, new Uint8Array(data));
      return;
    }
    if (data instanceof Uint8Array) {
      this._handleBytes(state, data);
    }
  }

  _handleTextMessage(state, message) {
    let parsed = null;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (parsed?.cmd === "peer:ping") {
      this._sendJson(state.conn, { cmd: "peer:pong" });
      return;
    }
    if (parsed?.cmd === "print:start") {
      this._startJob(state, parsed);
      return;
    }
    if (parsed?.cmd === "print:end") {
      this._finishJob(state, parsed);
    }
  }

  _startJob(state, message) {
    const id = String(message.id || "");
    const bytes = Math.max(0, Number(message.bytes) || 0);
    const chunks = Math.max(0, Number(message.chunks) || 0);
    if (!id || !bytes) {
      this._sendPrintStatus(state.conn, "error", id, 0, 0, "invalid_start");
      return;
    }
    state.job = {
      id,
      expectedBytes: bytes,
      expectedChunks: chunks,
      receivedBytes: 0,
      receivedChunks: 0,
      nextProgressBytes: this.chunkProgressBytes,
      chunks: [],
    };
    this._sendPrintStatus(state.conn, "started", id, bytes, chunks);
  }

  _handleBytes(state, bytes) {
    const job = state.job;
    if (!job || bytes.length === 0) return;
    const remaining = Math.max(0, job.expectedBytes - job.receivedBytes);
    const slice = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes;
    if (slice.length === 0) return;
    job.chunks.push(new Uint8Array(slice));
    job.receivedBytes += slice.length;
    job.receivedChunks += 1;
    if (job.receivedBytes >= job.nextProgressBytes && job.receivedBytes < job.expectedBytes) {
      while (job.receivedBytes >= job.nextProgressBytes) {
        job.nextProgressBytes += this.chunkProgressBytes;
      }
      this._sendPrintStatus(state.conn, "progress", job.id, job.receivedBytes, job.receivedChunks);
    }
  }

  _finishJob(state, message) {
    const job = state.job;
    if (!job || message.id !== job.id) return;
    const complete = job.receivedBytes === job.expectedBytes &&
      (!job.expectedChunks || job.receivedChunks === job.expectedChunks);
    if (!complete) {
      this._sendPrintStatus(state.conn, "error", job.id, job.receivedBytes, job.receivedChunks, "incomplete");
      state.job = null;
      return;
    }

    const payload = new Uint8Array(job.receivedBytes);
    let offset = 0;
    for (const chunk of job.chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    this.queue.push({
      id: job.id,
      payload,
      conn: state.conn,
      bytes: job.receivedBytes,
      chunks: job.receivedChunks,
      createdAt: Date.now(),
    });
    state.job = null;
    this._sendPrintStatus(state.conn, "queued", job.id, job.receivedBytes, job.receivedChunks);
    this._setState("queued");
    this.processQueue();
  }

  async _processQueue() {
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        if (!this._transportReady()) {
          this._setState("waiting_for_printer");
          break;
        }
        const job = this.queue.shift();
        this._setState("printing");
        try {
          await this.transport.writeBytes(job.payload);
          this._sendPrintStatus(job.conn, "done", job.id, job.bytes, job.chunks);
        } catch (error) {
          this.queue.unshift(job);
          this._handleError(error);
          break;
        } finally {
          this._setState("queue");
        }
      }
    } finally {
      this.processing = false;
      this._setState("idle");
    }
  }

  _transportReady() {
    const state = this.transport?.getConnectionState?.();
    return !!state?.connected && typeof this.transport?.writeBytes === "function";
  }

  _sendPrintStatus(conn, state, id, bytes = 0, chunks = 0, reason = "") {
    this._sendJson(conn, {
      type: "print",
      state,
      id,
      bytes,
      chunks,
      ...(reason ? { reason } : {}),
    });
  }

  _sendJson(conn, value) {
    this._sendText(conn, JSON.stringify(value));
  }

  _sendText(conn, text) {
    try {
      if (conn?.open) conn.send(text);
    } catch (error) {
      this._handleError(error);
    }
  }

  _safeDestroyPeer() {
    try {
      this.peer?.destroy?.();
    } catch {}
    this.peer = null;
  }

  _setState(state, extra = {}) {
    this._onState?.({ state, ...this.getState(), ...extra });
  }

  _handleError(error) {
    this._onError?.(error);
    this._setState("error", { error });
  }
}

window.PeerPrintServer = PeerPrintServer;
