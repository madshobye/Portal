const DEFAULT_REMOTE_SUFFIXES = ["a", "b", "c", "d", "e"];

export class PeerJsTransport extends EventTarget {
  constructor({
    host = "0.peerjs.com",
    port = 443,
    path = "/",
    key = "peerjs",
    secure = true,
    localId = "",
    remoteId = "",
    connectTimeoutMs = 30000,
    dataChannelTimeoutMs = 60000,
  } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.path = path;
    this.key = key;
    this.secure = secure;
    this.localId = localId || `p1e-web-${Math.floor(Math.random() * 100000)}`;
    this.remoteId = remoteId;
    this.connectTimeoutMs = connectTimeoutMs;
    this.dataChannelTimeoutMs = dataChannelTimeoutMs;
    this.peer = null;
    this.conn = null;
    this.connected = false;
    this.state = "idle";
    this._settled = false;
    this._remoteCandidates = [];
    this._candidateIndex = 0;
    this._connectionTimer = null;
  }

  get available() {
    return typeof window !== "undefined" && "Peer" in window;
  }

  async connect({ remoteId = this.remoteId } = {}) {
    if (!this.available) throw new Error("PeerJS is not available");
    if (this.connected) return true;

    this.remoteId = normalizePeerId(remoteId);
    if (!this.remoteId) throw new Error("PeerJS device id is required");

    this.setState("connecting");
    this._settled = false;
    this._remoteCandidates = buildRemoteCandidates(this.remoteId);
    this._candidateIndex = 0;

    await new Promise((resolve, reject) => {
      const finish = (ok, value) => {
        if (this._settled) return;
        this._settled = true;
        clearTimeout(openTimer);
        this.clearConnectionTimer();
        if (ok) resolve(value);
        else reject(value);
      };

      const openTimer = setTimeout(() => {
        this.destroyPeer();
        finish(false, new Error(`Timed out opening PeerJS connection for ${this.remoteId}`));
      }, this.connectTimeoutMs);

      try {
        this.peer = new window.Peer(this.localId, {
          host: this.host,
          port: this.port,
          path: this.path,
          key: this.key,
          secure: this.secure,
          debug: 0,
        });
      } catch (error) {
        finish(false, error);
        return;
      }

      this.peer.on("open", () => {
        this.tryCurrentCandidate(finish);
      });

      this.peer.on("connection", (conn) => {
        this.attachConnection(conn, finish);
      });

      this.peer.on("disconnected", () => {
        this.connected = false;
        this.setState("disconnected");
      });

      this.peer.on("close", () => {
        this.connected = false;
        this.setState("disconnected");
      });

      this.peer.on("error", (error) => {
        if (!this._settled && isMissingPeerError(error?.message || String(error))) {
          this.tryNextCandidate(finish);
          return;
        }
        if (this._settled) this.emit("error", { error });
        else finish(false, error);
      });
    });

    return true;
  }

  tryCurrentCandidate(finish) {
    const remoteId = this._remoteCandidates[this._candidateIndex];
    if (!remoteId) {
      finish(false, new Error(`No PeerJS device found for ${this.remoteId}`));
      return;
    }

    this.setState(`connecting:${remoteId}`);
    const conn = this.peer.connect(remoteId, {
      serialization: "raw",
      reliable: true,
      label: "p1e",
    });
    this.attachConnection(conn, finish);

    this.clearConnectionTimer();
    this._connectionTimer = setTimeout(() => {
      if (this.conn === conn && !this.connected) this.tryNextCandidate(finish);
    }, this.dataChannelTimeoutMs);
  }

  tryNextCandidate(finish) {
    this.clearConnectionTimer();
    if (this.conn) {
      const oldConn = this.conn;
      this.conn = null;
      oldConn.close();
    }
    this._candidateIndex += 1;
    this.tryCurrentCandidate(finish);
  }

  attachConnection(conn, finish) {
    if (!conn) return;
    if (this.conn && this.conn !== conn) this.conn.close();
    this.conn = conn;

    conn.on("open", () => {
      if (this.conn !== conn) return;
      this.clearConnectionTimer();
      this.connected = true;
      this.remoteId = conn.peer || this.remoteId;
      this.setState("connected");
      finish(true);
    });

    conn.on("data", (data) => {
      if (this.conn !== conn) return;
      decodePeerData(data)
        .then((line) => {
          if (line) this.emit("line", { line });
        })
        .catch((error) => this.emit("error", { error }));
    });

    conn.on("close", () => {
      if (this.conn !== conn) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.setState("disconnected");
      if (!wasConnected && !this._settled) this.tryNextCandidate(finish);
    });

    conn.on("error", (error) => {
      if (this.conn !== conn) return;
      if (!this.connected && !this._settled && isMissingPeerError(error?.message || String(error))) {
        this.tryNextCandidate(finish);
        return;
      }
      if (this._settled) this.emit("error", { error });
      else finish(false, error);
    });
  }

  async disconnect() {
    this.connected = false;
    this.clearConnectionTimer();
    this.destroyPeer();
    this.setState("disconnected");
  }

  async sendLine(line) {
    if (!this.connected || !this.conn || this.conn.open !== true) {
      throw new Error("PeerJS transport is not connected");
    }
    this.conn.send(line);
  }

  clearConnectionTimer() {
    if (!this._connectionTimer) return;
    clearTimeout(this._connectionTimer);
    this._connectionTimer = null;
  }

  destroyPeer() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  setState(state) {
    this.state = state;
    this.emit("state", { state });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function normalizePeerId(value) {
  return String(value || "").trim().toLowerCase();
}

function buildRemoteCandidates(remoteId) {
  const base = normalizePeerId(remoteId);
  if (!base) return [];
  return [
    base,
    ...DEFAULT_REMOTE_SUFFIXES.map((suffix) => `${base}-${suffix}`),
  ];
}

function isMissingPeerError(message) {
  return /Could not connect to peer|Lost connection to server/i.test(String(message || ""));
}

async function decodePeerData(data) {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return String(data || "");
}
