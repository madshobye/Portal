const DEFAULT_MQTT_ROOT = "p1e-webrtc-v1";
export const MQTT_WEBRTC_TRANSPORT_VERSION = "0.1.87-ui344";

console.info(`[P1E mqtt-webrtc] loaded ${MQTT_WEBRTC_TRANSPORT_VERSION}`);

export class MqttWebRtcTransport extends EventTarget {
  constructor({
    mqttUrl = "wss://public.cloud.shiftr.io",
    username = "public",
    password = "public",
    root = DEFAULT_MQTT_ROOT,
    stunUrl = "stun:stun.l.google.com:19302",
    localId = "",
    remoteId = "",
    connectTimeoutMs = 60000,
  } = {}) {
    super();
    this.mqttUrl = mqttUrl;
    this.username = username;
    this.password = password;
    this.root = root;
    this.stunUrl = stunUrl;
    this.localId = normalizePeerId(localId) || `p1e-web-mqtt-${Math.floor(Math.random() * 100000)}`;
    this.remoteId = normalizePeerId(remoteId);
    this.connectTimeoutMs = connectTimeoutMs;
    this.connectionId = `mqtt_${Math.floor(Math.random() * 100000000)}`;
    this.client = null;
    this.pc = null;
    this.channel = null;
    this.connected = false;
    this.state = "idle";
    this._settled = false;
    this._closed = false;
    this._debug = isDebugEnabled();
    this._lastLocalCandidate = "";
    this._lastRemoteCandidate = "";
    this._offerSent = false;
    this._pendingCandidates = [];
    this._candidateReadyResolve = null;
    this._localCandidateSummaries = [];
    this._remoteCandidateSummaries = [];
    this._lastStatsDiagnostic = "";
    this._rtcFailureTimer = null;
    this.supportsJson = false;
    this.supportsMsgPack = true;
  }

  get available() {
    return typeof window !== "undefined" && "RTCPeerConnection" in window && "mqtt" in window;
  }

  async connect({ remoteId = this.remoteId } = {}) {
    if (!("RTCPeerConnection" in window)) throw new Error("WebRTC is not available in this browser");
    if (!("mqtt" in window)) throw new Error("MQTT.js is not available");
    if (this.connected) return true;

    this.remoteId = normalizePeerId(remoteId);
    if (!this.remoteId) throw new Error("WebRTC device id is required");

    this._closed = false;
    this._settled = false;
    this._offerSent = false;
    this._pendingCandidates = [];
    this._localCandidateSummaries = [];
    this._remoteCandidateSummaries = [];
    this._lastStatsDiagnostic = "";
    this.clearRtcFailureTimer();
    this.setState("diagnostic", {
      message: `ua=${navigator.userAgent}`,
    });
    this.setState("signaling_connecting");

    await new Promise((resolve, reject) => {
      const finish = (ok, value) => {
        if (this._settled) return;
        this._settled = true;
        clearTimeout(openTimer);
        if (ok) resolve(value);
        else reject(value);
      };

      const openTimer = setTimeout(() => {
        this.disconnect();
        finish(false, new Error(`Timed out opening WebRTC connection for ${this.remoteId}`));
      }, this.connectTimeoutMs);

      try {
        this.startSignaling(finish).catch((error) => finish(false, error));
      } catch (error) {
        finish(false, error);
      }
    });

    return true;
  }

  async startSignaling(finish) {
    const inbox = topicTo(this.root, this.localId);
    const remoteInbox = topicTo(this.root, this.remoteId);
    const rtcConfig = await createRtcConfig(this.stunUrl);

    this.client = window.mqtt.connect(this.mqttUrl, {
      clientId: this.localId,
      username: this.username,
      password: this.password,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: Math.min(this.connectTimeoutMs, 15000),
    });

    this.pc = new RTCPeerConnection(rtcConfig.config);
    this.setState("diagnostic", { message: `certificate=${rtcConfig.certificateLabel}` });
    this.channel = this.pc.createDataChannel("p1e", { ordered: true });

    const publish = (message) => {
      if (!this.client || this.client.disconnected) return;
      this.debug("mqtt publish", signalSummary(message));
      this.client.publish(remoteInbox, JSON.stringify(message));
    };

    this.client.on("connect", async () => {
      if (this._closed) return;
      this.setState("signaling_connected", { localId: this.localId });
      try {
        await subscribe(this.client, inbox);
        this.client.publish(topicPresence(this.root), JSON.stringify({ type: "WEB_ONLINE", src: this.localId, dst: this.remoteId }));
        await this.sendOffer(publish);
      } catch (error) {
        finish(false, error);
      }
    });

    this.client.on("message", (topic, payload) => {
      this.debug("mqtt message raw", { topic, bytes: payload?.byteLength ?? payload?.length ?? 0 });
      this.handleSignalMessage(topic, payload, finish);
    });

    this.client.on("error", (error) => {
      this.setState("signaling_error", { message: error?.message || String(error) });
      if (!this._settled) finish(false, error);
      else this.emit("error", { error });
    });

    this.client.on("close", () => {
      if (this._closed || this.connected) return;
      this.setState("signaling_closed");
    });

    this.pc.onicecandidate = (event) => {
      if (!event.candidate) {
        this.setState("ice_candidate", { summary: "gathering complete" });
        this.resolveCandidateReady();
        return;
      }
      const candidate = event.candidate.candidate || "";
      this._lastLocalCandidate = summarizeIceCandidate(candidate);
      this._localCandidateSummaries.push(this._lastLocalCandidate);
      this.setState("ice_candidate", { summary: this._lastLocalCandidate });
      this.resolveCandidateReady(candidate);
      const message = {
        type: "CANDIDATE",
        src: this.localId,
        dst: this.remoteId,
        payload: {
          candidate: {
            candidate,
            sdpMid: event.candidate.sdpMid || "0",
            sdpMLineIndex: event.candidate.sdpMLineIndex || 0,
          },
          type: "data",
          connectionId: this.connectionId,
        },
      };
      if (!this._offerSent) {
        this._pendingCandidates.push(message);
      } else {
        publish(message);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      this.setState(`ice_${this.pc.iceConnectionState || "unknown"}`);
      this.logStats("ice");
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState || "unknown";
      this.setState(`rtc_${state}`);
      this.logStats("rtc");
      if (state === "connected") {
        this.clearRtcFailureTimer();
      } else if ((state === "disconnected" || state === "failed" || state === "closed") && this.connected) {
        this.dropConnectedRtc(state);
      } else if ((state === "failed" || state === "closed") && !this._settled) {
        this.scheduleRtcFailure(finish, state);
      }
    };

    this.channel.onopen = () => {
      this.connected = true;
      this.setState("connected");
      this.stopSignaling();
      finish(true);
    };

    this.channel.binaryType = "arraybuffer";
    this.channel.onmessage = async (event) => {
      try {
        const message = await decodeDataMessage(event.data);
        if (message.kind === "frame" && message.data) this.emit("frame", { data: message.data });
      } catch (error) {
        this.emit("error", { error });
      }
    };

    this.channel.onerror = () => {
      const error = new Error("WebRTC data channel error");
      if (!this._settled) finish(false, error);
      else this.emit("error", { error });
    };

    this.channel.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.setState(wasConnected ? "disconnected" : "data_channel_closed");
    };
  }

  async sendOffer(publish) {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.setState("diagnostic", { message: `local ${sdpDiagnostics(offer.sdp)}` });
    publish({
      type: "OFFER",
      src: this.localId,
      dst: this.remoteId,
      payload: {
        sdp: { type: "offer", sdp: offer.sdp },
        type: "data",
        connectionId: this.connectionId,
        metadata: null,
        label: this.connectionId,
        reliable: false,
        serialization: "raw",
      },
    });
    this._offerSent = true;
    this._pendingCandidates.forEach((message) => publish(message));
    this._pendingCandidates = [];
    this.setState("offer_sent", { remoteId: this.remoteId });
  }

  async handleSignalMessage(topic, payload, finish) {
    let message = null;
    try {
      const text = decodeMqttPayload(payload);
      message = JSON.parse(text);
    } catch {
      return;
    }
    this.debug("mqtt message", signalSummary(message));

    if (message.dst && normalizePeerId(message.dst) !== this.localId) return;
    if (message.src && normalizePeerId(message.src) !== this.remoteId) {
      this.setState("signal_ignored", { from: normalizePeerId(message.src) });
      return;
    }

    const inner = message.payload || {};
    try {
      if (message.type === "ANSWER" && inner.sdp?.sdp) {
        const sdpCandidates = sdpCandidateSummaries(inner.sdp.sdp);
        this._remoteCandidateSummaries.push(...sdpCandidates);
        if (sdpCandidates[0]) this._lastRemoteCandidate = sdpCandidates[0];
        this.setState("diagnostic", {
          message: `remote ${sdpDiagnostics(inner.sdp.sdp)} bytes=${inner.sdp.sdp.length} candidates=${sdpCandidates.join("|") || "none"}`,
        });
        await this.pc.setRemoteDescription({ type: "answer", sdp: inner.sdp.sdp });
        this.setState("answer_received");
      } else if (message.type === "CANDIDATE" && inner.candidate?.candidate) {
        this._lastRemoteCandidate = summarizeIceCandidate(inner.candidate.candidate);
        this._remoteCandidateSummaries.push(this._lastRemoteCandidate);
        this.setState("remote_candidate", { summary: this._lastRemoteCandidate });
        await this.pc.addIceCandidate(inner.candidate);
      } else if (message.type === "LEAVE") {
        this.setState("remote_left");
        if (!this._settled) finish(false, new Error("WebRTC device left before data channel opened"));
      }
    } catch (error) {
      this.setState("signal_error", { message: error?.message || String(error) });
      if (!this._settled) finish(false, error);
      else this.emit("error", { error });
    }
  }

  waitForInitialCandidate(timeoutMs = 1800) {
    if (this._lastLocalCandidate && !this._lastLocalCandidate.includes("/tcp/")) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this._candidateReadyResolve = null;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this._candidateReadyResolve = () => {
        clearTimeout(timer);
        done();
      };
    });
  }

  resolveCandidateReady(candidate = "") {
    if (!this._candidateReadyResolve) return;
    if (!candidate || isUsefulCandidate(candidate)) {
      const resolve = this._candidateReadyResolve;
      this._candidateReadyResolve = null;
      resolve();
    }
  }

  sendLine(line) {
    void line;
    throw new Error("WebRTC data channel is binary-only");
  }

  sendBytes(data) {
    if (!this.channel || this.channel.readyState !== "open") throw new Error("WebRTC data channel is not open");
    this.channel.send(data);
  }

  async disconnect() {
    this._closed = true;
    this.connected = false;
    this.clearRtcFailureTimer();
    this.sendLeave();
    try {
      if (this.channel && this.channel.readyState !== "closed") this.channel.close();
    } catch {
    }
    try {
      if (this.pc && this.pc.connectionState !== "closed") this.pc.close();
    } catch {
    }
    this.stopSignaling();
    this.channel = null;
    this.pc = null;
    this.setState("disconnected");
  }

  stopSignaling() {
    if (!this.client) return;
    try {
      this.client.end(true);
    } catch {
    }
    this.client = null;
  }

  sendLeave() {
    if (!this.client || this.client.disconnected || !this.remoteId) return;
    try {
      this.client.publish(topicTo(this.root, this.remoteId), JSON.stringify({
        type: "LEAVE",
        src: this.localId,
        dst: this.remoteId,
        payload: {
          connectionId: this.connectionId,
          type: "data",
        },
      }));
    } catch {
    }
  }

  scheduleRtcFailure(finish, state) {
    if (this._rtcFailureTimer) return;
    this.setState("diagnostic", { message: `rtc ${state}; waiting 45s for data channel grace` });
    this._rtcFailureTimer = setTimeout(() => {
      this._rtcFailureTimer = null;
      if (!this._settled && !this.connected) {
        finish(false, new Error(this.failureSummary(state)));
      }
    }, 45000);
  }

  clearRtcFailureTimer() {
    if (!this._rtcFailureTimer) return;
    clearTimeout(this._rtcFailureTimer);
    this._rtcFailureTimer = null;
  }

  dropConnectedRtc(state) {
    if (!this.connected || this._closed) return;
    this.connected = false;
    this.setState("disconnected", { reason: `rtc_${state}` });
    this.disconnect();
  }

  failureSummary(state = "failed") {
    const ice = this.pc?.iceConnectionState || "unknown";
    const signaling = this.pc?.signalingState || "unknown";
    const local = this._lastLocalCandidate || "none";
    const remote = this._lastRemoteCandidate || "none";
    const locals = compactCandidates(this._localCandidateSummaries);
    const remotes = compactCandidates(this._remoteCandidateSummaries);
    const hint = failureHint(this._localCandidateSummaries, this._remoteCandidateSummaries);
    return `WebRTC ${state} (ice=${ice}, signaling=${signaling}, local=${local}, remote=${remote}, locals=${locals}, remotes=${remotes}${hint ? `, hint=${hint}` : ""})`;
  }

  async logStats(label = "stats") {
    if (!this._debug || !this.pc || typeof this.pc.getStats !== "function") return;
    try {
      const stats = await this.pc.getStats();
      const locals = new Map();
      const remotes = new Map();
      let selected = null;
      const pairs = [];
      stats.forEach((report) => {
        if (report.type === "local-candidate") locals.set(report.id, report);
        if (report.type === "remote-candidate") remotes.set(report.id, report);
        if (report.type === "candidate-pair") {
          pairs.push(report);
          if (report.selected) selected = report;
        }
        if (report.type === "transport" && report.selectedCandidatePairId) {
          const pair = stats.get(report.selectedCandidatePairId);
          if (pair) selected = pair;
        }
      });
      const pair = selected || pairs.find((item) => item.nominated) || pairs.find((item) => item.state === "succeeded") || pairs[0];
      if (!pair) return;
      const diagnostic = [
        `${label} pair=${pair.state || "?"}`,
        `nom=${pair.nominated ? "1" : "0"}`,
        `req=${pair.requestsSent || 0}`,
        `resp=${pair.responsesReceived || 0}`,
        `rtt=${pair.currentRoundTripTime || 0}`,
        `local=${formatStatsCandidate(locals.get(pair.localCandidateId))}`,
        `remote=${formatStatsCandidate(remotes.get(pair.remoteCandidateId))}`,
      ].join(" ");
      if (diagnostic !== this._lastStatsDiagnostic && shouldShowStatsDiagnostic(label, pair)) {
        this._lastStatsDiagnostic = diagnostic;
        this.setState("diagnostic", { message: diagnostic });
      }
      this.debug(label, {
        pairState: pair.state || "",
        nominated: Boolean(pair.nominated),
        requestsSent: pair.requestsSent || 0,
        responsesReceived: pair.responsesReceived || 0,
        currentRoundTripTime: pair.currentRoundTripTime || 0,
        local: formatStatsCandidate(locals.get(pair.localCandidateId)),
        remote: formatStatsCandidate(remotes.get(pair.remoteCandidateId)),
      });
    } catch (error) {
      this.debug(`${label} stats error`, { message: error?.message || String(error) });
    }
  }

  debug(message, data = undefined) {
    if (!this._debug) return;
    const payload = { at: new Date().toISOString(), ...(data || {}) };
    console.debug(`[P1E mqtt-webrtc] ${message}`, payload);
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit("state", { state, ...extra });
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function topicTo(root, id) {
  return `/${root}/to/${id}`;
}

function topicPresence(root) {
  return `/${root}/presence`;
}

function subscribe(client, topic) {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function normalizePeerId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function summarizeIceCandidate(candidate) {
  const text = String(candidate || "");
  const type = text.match(/\styp\s+(\S+)/)?.[1] || "?";
  const protocol = text.match(/\s(udp|tcp)\s/i)?.[1]?.toLowerCase() || "?";
  const address = text.match(/\s(\S+)\s\d+\styp\s/)?.[1] || "?";
  return `${type}/${protocol}/${address}`;
}

function shouldDropCandidate(candidate) {
  if (!candidate) return false;
  const protocol = candidate.match(/\s(udp|tcp)\s/i)?.[1]?.toLowerCase() || "";
  if (protocol === "tcp") return true;
  return false;
}

function isUsefulCandidate(candidate) {
  if (!candidate || shouldDropCandidate(candidate)) return false;
  const protocol = candidate.match(/\s(udp|tcp)\s/i)?.[1]?.toLowerCase() || "";
  return protocol === "udp";
}

function sdpCandidateSummaries(sdp) {
  return String(sdp || "")
    .split(/\r?\n/)
    .filter((line) => /^a=candidate:/i.test(line))
    .map((line) => summarizeIceCandidate(line.slice(2)));
}

function compactCandidates(candidates) {
  const unique = [...new Set(candidates.filter(Boolean))];
  if (!unique.length) return "none";
  return unique.slice(0, 6).join(",");
}

function failureHint(localCandidates, remoteCandidates) {
  const locals = localCandidates.map(parseCandidateSummary).filter(Boolean);
  const remotes = remoteCandidates.map(parseCandidateSummary).filter(Boolean);
  const hasRemotePublic = remotes.some((candidate) => candidate.type === "srflx" || candidate.type === "relay");
  const localPrivateHosts = locals.filter((candidate) => candidate.type === "host" && isPrivateIpv4(candidate.address));
  const remotePrivateHosts = remotes.filter((candidate) => candidate.type === "host" && isPrivateIpv4(candidate.address));
  const hasSharedPrivateLan = localPrivateHosts.some((local) =>
    remotePrivateHosts.some((remote) => samePrivateLan(local.address, remote.address))
  );

  if (!remoteCandidates.length) return "no remote candidates from device";
  if (!hasSharedPrivateLan && !hasRemotePublic) return "browser/device private IPs differ and device has no public/relay candidate";
  return "";
}

function parseCandidateSummary(summary) {
  const parts = String(summary || "").split("/");
  if (parts.length < 3) return null;
  return { type: parts[0], protocol: parts[1], address: parts.slice(2).join("/") };
}

function isPrivateIpv4(address) {
  const parts = String(address || "").split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function samePrivateLan(a, b) {
  const left = String(a || "").split(".");
  const right = String(b || "").split(".");
  if (left.length !== 4 || right.length !== 4) return false;
  if (left[0] === "10" && right[0] === "10") return left[1] === right[1];
  if (left[0] === "172" && right[0] === "172") return left[1] === right[1] && left[2] === right[2];
  if (left[0] === "192" && right[0] === "192") return left[1] === right[1] && left[2] === right[2];
  return false;
}

function signalSummary(message) {
  const payload = message?.payload || {};
  const sdp = payload.sdp?.sdp || "";
  const candidate = payload.candidate?.candidate || "";
  const sdpCandidates = sdpCandidateSummaries(sdp);
  return {
    type: message?.type || "",
    src: message?.src || "",
    dst: message?.dst || "",
    sdpType: payload.sdp?.type || "",
    sdpBytes: sdp.length || 0,
    sdpCandidates,
    candidate: candidate ? summarizeIceCandidate(candidate) : "",
  };
}

function sdpDiagnostics(sdp) {
  const text = String(sdp || "");
  const fingerprint = text.match(/^a=fingerprint:([^\r\n]+)/mi)?.[1] || "none";
  const setup = text.match(/^a=setup:([^\r\n]+)/mi)?.[1] || "none";
  const candidateCount = (text.match(/^a=candidate:/gmi) || []).length;
  return `sdp fingerprint=${fingerprint} setup=${setup} candidates=${candidateCount}`;
}

function formatStatsCandidate(candidate) {
  if (!candidate) return "?";
  return [
    candidate.candidateType || candidate.type || "?",
    String(candidate.protocol || "?").toLowerCase(),
    `${candidate.address || candidate.ip || "?"}:${candidate.port || "?"}`,
  ].join("/");
}

async function createRtcConfig(stunUrl) {
  const config = { iceServers: [{ urls: stunUrl }] };
  return { config, certificateLabel: "default" };
}

function shouldShowStatsDiagnostic(label, pair) {
  if (label === "rtc" || label === "ice") return true;
  return pair?.state === "failed" || pair?.state === "succeeded" || Boolean(pair?.selected);
}

function isDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

function decodeMqttPayload(payload) {
  if (typeof payload === "string") return payload;
  if (payload instanceof ArrayBuffer) return new TextDecoder().decode(payload);
  if (ArrayBuffer.isView(payload)) return new TextDecoder().decode(payload);
  return String(payload || "");
}

async function decodeDataMessage(data) {
  if (typeof data === "string") throw new Error("Unexpected text frame on binary WebRTC channel");
  if (data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    return decodeDataBytes(new Uint8Array(buffer));
  }
  if (data instanceof ArrayBuffer) return decodeDataBytes(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return decodeDataBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  throw new Error("Unsupported WebRTC data frame");
}

function decodeDataBytes(bytes) {
  return { kind: "frame", data: bytes };
}
