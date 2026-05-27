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
    dataChannelTimeoutMs = 8000,
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
    this._iceDiagnostics = new WeakMap();
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
        clearTimeout(openTimer);
        this.installCandidateFilter(this.peer);
        this.setState("hub_open", { localId: this.localId });
        this.tryCurrentCandidate(finish);
      });

      this.peer.on("connection", (conn) => {
        this.attachConnection(conn, finish);
      });

      this.peer.on("disconnected", () => {
        this.connected = false;
        this.setState("hub_disconnected");
      });

      this.peer.on("close", () => {
        this.connected = false;
        this.setState("hub_closed");
      });

      this.peer.on("error", (error) => {
        this.setState("hub_error", { message: error?.message || String(error) });
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

    this.setState("trying_device", { remoteId, attempt: this._candidateIndex + 1, total: this._remoteCandidates.length });
    const conn = this.peer.connect(remoteId, {
      serialization: "raw",
      reliable: true,
      label: "p1e",
    });
    this.attachConnection(conn, finish);
    this.installRemoteDescriptionFilter(conn);
    this.attachIceDiagnostics(conn, remoteId);

    this.clearConnectionTimer();
    this._connectionTimer = setTimeout(() => {
      if (this.conn === conn && !this.connected) {
        this.setState("device_timeout", { remoteId });
        this.tryNextCandidate(finish);
      }
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
      this.setState(wasConnected ? "disconnected" : "device_closed", { remoteId: conn.peer || this.remoteId });
      if (!wasConnected && !this._settled) this.tryNextCandidate(finish);
    });

    conn.on("error", (error) => {
      if (this.conn !== conn) return;
      this.setState("device_error", { remoteId: conn.peer || this.remoteId, message: error?.message || String(error) });
      if (!this.connected && !this._settled && isMissingPeerError(error?.message || String(error))) {
        this.tryNextCandidate(finish);
        return;
      }
      if (this._settled) this.emit("error", { error });
      else finish(false, error);
    });
  }

  installCandidateFilter(peer) {
    const socket = peer?.socket;
    if (!socket || typeof socket.send !== "function" || socket._p1eCandidateFilter) return;
    const send = socket.send.bind(socket);
    socket._p1eCandidateFilter = true;
    socket.send = (message) => {
      const candidate = message?.payload?.candidate?.candidate || "";
      if (message?.type === "CANDIDATE" && this.shouldDropCandidate(candidate)) {
        this.setState("ice_candidate_dropped", { summary: summarizeIceCandidate(candidate) });
        return;
      }
      return send(message);
    };
  }

  shouldDropCandidate(candidate) {
    if (!candidate) return false;
    const protocol = candidate.match(/\s(udp|tcp)\s/i)?.[1]?.toLowerCase() || "";
    const type = candidate.match(/\styp\s+(\S+)/)?.[1] || "";
    const address = candidate.match(/\s(\S+)\s\d+\styp\s/)?.[1] || "";
    if (protocol === "tcp") return true;
    if (type === "host" && /\.local$/i.test(address)) return true;
    return false;
  }

  installRemoteDescriptionFilter(conn) {
    if (!conn || typeof conn.handleMessage !== "function" || conn._p1eRemoteDescriptionFilter) return;
    const handleMessage = conn.handleMessage.bind(conn);
    conn._p1eRemoteDescriptionFilter = true;
    conn.handleMessage = (message) => {
      if (message?.type === "ANSWER") {
        const sdp = message?.payload?.sdp;
        const sdpText = sdp?.sdp || "";
        const filteredSdp = stripTcpCandidatesFromSdp(sdpText);
        if (filteredSdp !== sdpText) {
          this.setState("ice_answer_filtered", { removed: countCandidateLines(sdpText) - countCandidateLines(filteredSdp) });
          message = {
            ...message,
            payload: {
              ...message.payload,
              sdp: { ...sdp, sdp: filteredSdp },
            },
          };
        }
      }
      return handleMessage(message);
    };
  }

  attachIceDiagnostics(conn, remoteId) {
    const pc = getConnectionPeerConnection(conn);
    if (!pc || typeof pc.addEventListener !== "function") {
      this.setState("ice_diag", { remoteId, message: "RTCPeerConnection unavailable" });
      return;
    }

    const logState = (source) => {
      this.setState("ice_diag", {
        remoteId,
        message: `${source} ice=${pc.iceConnectionState} gathering=${pc.iceGatheringState} signaling=${pc.signalingState}`,
      });
    };
    const onIceState = () => {
      logState("state");
      this.logIceStats(pc, remoteId);
    };
    const onGatheringState = () => logState("gathering");
    const onCandidate = (event) => {
      const candidate = event?.candidate?.candidate || "";
      this.setState("ice_candidate", {
        remoteId,
        summary: candidate ? summarizeIceCandidate(candidate) : "gathering complete",
      });
    };

    pc.addEventListener("iceconnectionstatechange", onIceState);
    pc.addEventListener("icegatheringstatechange", onGatheringState);
    pc.addEventListener("icecandidate", onCandidate);
    this._iceDiagnostics.set(conn, { pc, onIceState, onGatheringState, onCandidate });
    logState("attach");
  }

  detachIceDiagnostics(conn) {
    const diag = this._iceDiagnostics.get(conn);
    if (!diag) return;
    try {
      diag.pc.removeEventListener("iceconnectionstatechange", diag.onIceState);
      diag.pc.removeEventListener("icegatheringstatechange", diag.onGatheringState);
      diag.pc.removeEventListener("icecandidate", diag.onCandidate);
    } catch {}
    this._iceDiagnostics.delete(conn);
  }

  async logIceStats(pc, remoteId) {
    if (typeof pc.getStats !== "function") return;
    try {
      const stats = await pc.getStats();
      const localCandidates = new Map();
      const remoteCandidates = new Map();
      const pairs = [];
      let selectedPair = null;
      stats.forEach((report) => {
        if (report.type === "local-candidate") localCandidates.set(report.id, report);
        if (report.type === "remote-candidate") remoteCandidates.set(report.id, report);
        if (report.type === "candidate-pair") {
          pairs.push(report);
          if (report.selected) selectedPair = report;
        }
        if (report.type === "transport" && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId);
          if (pair) selectedPair = pair;
        }
      });
      const best = selectedPair || pairs.find((pair) => pair.state && pair.state !== "failed") || pairs[0];
      if (!best) return;
      const local = localCandidates.get(best.localCandidateId);
      const remote = remoteCandidates.get(best.remoteCandidateId);
      this.setState("ice_pair", {
        remoteId,
        message: `${formatCandidate(local)} -> ${formatCandidate(remote)} state=${best.state || "?"} requests=${best.requestsSent ?? "?"} responses=${best.responsesReceived ?? "?"}`,
      });
    } catch (error) {
      this.setState("ice_diag", { remoteId, message: `getStats failed: ${error?.message || String(error)}` });
    }
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
      this.detachIceDiagnostics(this.conn);
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  setState(state, detail = {}) {
    this.state = state;
    this.emit("state", { state, ...detail });
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
  return [base];
}

function summarizeIceCandidate(candidate) {
  const text = String(candidate || "");
  if (!text) return "";
  const protocol = text.match(/\s(udp|tcp)\s/i)?.[1]?.toLowerCase() || "?";
  const type = text.match(/\styp\s+(\S+)/)?.[1] || "?";
  const address = text.match(/\s(\S+)\s\d+\styp\s/)?.[1] || "?";
  const port = text.match(/\s(\d+)\styp\s/)?.[1] || "?";
  return `${type}/${protocol}/${address}:${port}`;
}

function stripTcpCandidatesFromSdp(sdp) {
  return String(sdp || "")
    .split(/\r?\n/)
    .filter((line) => !/^a=candidate:/i.test(line) || !/\stcp\s/i.test(line))
    .join("\r\n");
}

function countCandidateLines(sdp) {
  return String(sdp || "")
    .split(/\r?\n/)
    .filter((line) => /^a=candidate:/i.test(line))
    .length;
}

function getConnectionPeerConnection(conn) {
  return conn?.peerConnection || conn?._peerConnection || conn?._pc || conn?.pc || null;
}

function formatCandidate(candidate) {
  if (!candidate) return "?";
  const type = candidate.candidateType || candidate.type || "?";
  const protocol = String(candidate.protocol || "?").toLowerCase();
  const address = candidate.address || candidate.ip || candidate.relayProtocol || "?";
  const port = candidate.port || "?";
  return `${type}/${protocol}/${address}:${port}`;
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
