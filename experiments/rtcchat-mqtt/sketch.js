const RTCCHAT_MQTT_VERSION = 2;
const MQTT_BROKER = "wss://public:public@public.cloud.shiftr.io";
const TOPICS = {
  invitations: "portal/rtcchat/invitations",
  listRequest: "portal/rtcchat/list/request",
};

let mqttClient;
let myPeerId = `rtcmesh-${Math.random().toString(36).slice(2, 10)}`;
let myReplyTopic = `portal/rtcchat/list/response/${myPeerId}`;
let mySignalTopic = `portal/rtcchat/signal/${myPeerId}`;
let statusText = "Booting MQTT mesh...";
let knownPeers = new Map();
let peerConnections = new Map();
let chatMessages = [];
let invitationHeartbeat = null;
let mqttPollTimer = null;

let appEl;
let panelEl;
let statusCardEl;
let statusTextEl;
let actionsEl;
let chatCardEl;
let messagesEl;
let composerInputEl;
let sendBtnEl;

async function setup() {
  await loadScript("portal/mqtt.js");
  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");

  buildUi();
  renderUi();
  ensureMqttPolling();

  mqttClient = await new PortalMqtt({
    broker: MQTT_BROKER,
    clientId: myPeerId,
    autoConnect: false,
    onConnect: () => {
      statusText = "MQTT connected. Publishing invitation.";
      renderUi();
    },
    onDisconnect: () => {
      statusText = "MQTT disconnected.";
      renderUi();
    },
    onError: (error) => {
      statusText = `MQTT error: ${error?.message || error}`;
      renderUi();
    },
  }).init();

  await mqttClient.connect();
  await bootstrapMqttMesh();
}

function buildUi() {
  appEl = document.createElement("div");
  appEl.className = "rtcmesh-app";

  panelEl = document.createElement("div");
  panelEl.className = "rtcmesh-panel";

  statusCardEl = document.createElement("section");
  statusCardEl.className = "rtcmesh-card rtcmesh-status";

  statusTextEl = document.createElement("p");
  statusTextEl.className = "rtcmesh-text";
  statusCardEl.appendChild(statusTextEl);

  actionsEl = document.createElement("div");
  actionsEl.className = "rtcmesh-actions";
  statusCardEl.appendChild(actionsEl);

  chatCardEl = document.createElement("section");
  chatCardEl.className = "rtcmesh-card rtcmesh-chat";

  messagesEl = document.createElement("div");
  messagesEl.className = "rtcmesh-messages";
  chatCardEl.appendChild(messagesEl);

  const composer = document.createElement("div");
  composer.className = "rtcmesh-composer";

  composerInputEl = document.createElement("input");
  composerInputEl.className = "rtcmesh-input";
  composerInputEl.type = "text";
  composerInputEl.placeholder = "Type a message to all peers…";
  composerInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessageToAll();
  });
  composer.appendChild(composerInputEl);

  sendBtnEl = document.createElement("button");
  sendBtnEl.className = "rtcmesh-btn";
  sendBtnEl.textContent = "Send";
  sendBtnEl.addEventListener("click", sendMessageToAll);
  composer.appendChild(sendBtnEl);

  chatCardEl.appendChild(composer);

  panelEl.appendChild(statusCardEl);
  panelEl.appendChild(chatCardEl);
  appEl.appendChild(panelEl);
  document.body.appendChild(appEl);
}

function renderUi() {
  if (!statusTextEl || !actionsEl) return;

  const connectedPeers = [...peerConnections.values()].filter((entry) => entry.state === "connected").length;
  statusTextEl.textContent =
    `v${RTCCHAT_MQTT_VERSION}  ${statusText}  Peer: ${myPeerId}  MQTT: ${mqttClient?.connected ? "connected" : "connecting"}  Known: ${knownPeers.size}  Connected: ${connectedPeers}`;

  actionsEl.innerHTML = "";
  appendAction("Republish Invitation", publishInvitation);
  appendAction("Request List", requestInvitationList);
  appendAction("Reconnect Mesh", reconnectMesh, true);
}

function appendAction(label, onClick, secondary = false) {
  const button = document.createElement("button");
  button.className = secondary ? "rtcmesh-btn secondary" : "rtcmesh-btn";
  button.textContent = label;
  button.addEventListener("click", () => {
    onClick?.();
  });
  actionsEl.appendChild(button);
}

function processIncomingMqtt() {
  while (mqttClient?.hasNewResult()) {
    const { result } = mqttClient.consumeNew();
    if (!result) return;

    let payload = null;
    try {
      payload = JSON.parse(result.message);
    } catch {
      continue;
    }

    if (result.topic === TOPICS.invitations) {
      registerPeer(payload);
      continue;
    }

    if (result.topic === TOPICS.listRequest) {
      const replyTopic = payload?.replyTopic;
      if (replyTopic) {
        publishInvitationList(replyTopic);
      }
      continue;
    }

    if (result.topic === myReplyTopic) {
      for (const invite of payload?.invitations || []) {
        registerPeer(invite);
      }
      continue;
    }

    if (result.topic === mySignalTopic) {
      handleSignal(payload);
    }
  }
}

function ensureMqttPolling() {
  if (mqttPollTimer) return;
  mqttPollTimer = setInterval(() => {
    processIncomingMqtt();
  }, 80);
}

async function bootstrapMqttMesh() {
  await mqttClient.subscribe(TOPICS.invitations);
  await mqttClient.subscribe(TOPICS.listRequest);
  await mqttClient.subscribe(myReplyTopic);
  await mqttClient.subscribe(mySignalTopic);
  await publishInvitation();
  await requestInvitationList();
  ensureHeartbeat();
}

function registerPeer(payload) {
  const peerId = String(payload?.peerId || payload?.sessionId || "").trim();
  if (!peerId || peerId === myPeerId) return;

  knownPeers.set(peerId, {
    peerId,
    label: payload?.label || peerId,
    seenAt: Date.now(),
  });

  if (!peerConnections.has(peerId) && myPeerId < peerId) {
    startOfferToPeer(peerId);
  }

  statusText = `Known peers updated.`;
  renderUi();
}

async function publishInvitation() {
  if (!mqttClient?.connected) return;
  const payload = {
    type: "rtcchat-invitation",
    peerId: myPeerId,
    label: myPeerId,
    seenAt: Date.now(),
  };
  await mqttClient.publish(TOPICS.invitations, JSON.stringify(payload));
}

async function requestInvitationList() {
  if (!mqttClient?.connected) return;
  const payload = {
    type: "rtcchat-list-request",
    replyTopic: myReplyTopic,
    requester: myPeerId,
  };
  await mqttClient.publish(TOPICS.listRequest, JSON.stringify(payload));
}

async function publishInvitationList(replyTopic) {
  if (!mqttClient?.connected) return;
  const invitations = [...knownPeers.values()].map((peer) => ({
    peerId: peer.peerId,
    label: peer.label,
    seenAt: peer.seenAt,
  }));
  invitations.push({
    peerId: myPeerId,
    label: myPeerId,
    seenAt: Date.now(),
  });
  await mqttClient.publish(replyTopic, JSON.stringify({
    type: "rtcchat-invitation-list",
    invitations,
  }));
}

function ensureHeartbeat() {
  if (invitationHeartbeat) return;
  invitationHeartbeat = setInterval(() => {
    publishInvitation();
  }, 15000);
}

function makePeerEntry(peerId) {
  const entry = {
    peerId,
    pc: new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    }),
    dc: null,
    localCandidates: [],
    remoteCandidatesAdded: 0,
    state: "new",
  };

  entry.pc.onicecandidate = (event) => {
    if (event.candidate?.candidate) {
      entry.localCandidates.push(event.candidate.candidate);
    }
  };

  entry.pc.ondatachannel = (event) => {
    wirePeerDataChannel(entry, event.channel);
  };

  entry.pc.onconnectionstatechange = () => {
    entry.state = entry.pc.connectionState || "unknown";
    if (entry.state === "connected") {
      addSystemMessage(`Connected to ${peerId}.`);
    } else if (entry.state === "failed") {
      addSystemMessage(`Connection failed for ${peerId}.`);
    }
    renderUi();
  };

  return entry;
}

async function startOfferToPeer(peerId) {
  if (peerConnections.has(peerId)) return;

  const entry = makePeerEntry(peerId);
  peerConnections.set(peerId, entry);

  const dc = entry.pc.createDataChannel(`rtcmesh-${peerId}`);
  wirePeerDataChannel(entry, dc);

  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await waitForIceReady(entry);

    const bundle = createBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
    await sendSignal(peerId, {
      type: "offer",
      from: myPeerId,
      bundle,
    });
    entry.state = "offer-sent";
    statusText = `Offer sent to ${peerId}.`;
    renderUi();
  } catch (error) {
    console.error("[rtcchat-mqtt] offer error", error);
    statusText = `Offer error for ${peerId}: ${error?.message || error}`;
    renderUi();
  }
}

async function handleSignal(payload) {
  const from = String(payload?.from || "").trim();
  if (!from || from === myPeerId) return;

  if (payload.type === "offer") {
    let entry = peerConnections.get(from);
    if (!entry) {
      entry = makePeerEntry(from);
      peerConnections.set(from, entry);
    }

    try {
      await entry.pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(payload.bundle) });
      for (const candidate of payload.bundle.c || []) {
        await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      }

      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await waitForIceReady(entry);

      const bundle = createBundle("AB", entry.pc.localDescription.sdp, entry.localCandidates);
      await sendSignal(from, {
        type: "answer",
        from: myPeerId,
        bundle,
      });
      entry.state = "answer-sent";
      statusText = `Answer sent to ${from}.`;
      renderUi();
    } catch (error) {
      console.error("[rtcchat-mqtt] incoming offer error", error);
    }
    return;
  }

  if (payload.type === "answer") {
    const entry = peerConnections.get(from);
    if (!entry) return;

    try {
      await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(payload.bundle) });
      for (const candidate of payload.bundle.c || []) {
        await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
        entry.remoteCandidatesAdded += 1;
      }
      statusText = `Answer applied from ${from}.`;
      renderUi();
    } catch (error) {
      console.error("[rtcchat-mqtt] answer error", error);
    }
  }
}

function wirePeerDataChannel(entry, channel) {
  entry.dc = channel;
  channel.onopen = () => {
    entry.state = "connected";
    renderUi();
  };
  channel.onmessage = (event) => {
    addChatMessage("peer", `${entry.peerId}: ${String(event.data || "")}`);
  };
  channel.onclose = () => {
    entry.state = "closed";
    renderUi();
  };
}

async function sendSignal(peerId, payload) {
  const topic = `portal/rtcchat/signal/${peerId}`;
  await mqttClient.publish(topic, JSON.stringify(payload));
}

function sendMessageToAll() {
  const text = String(composerInputEl?.value || "").trim();
  if (!text) return;

  let sentCount = 0;
  for (const entry of peerConnections.values()) {
    if (entry.dc?.readyState === "open") {
      entry.dc.send(text);
      sentCount += 1;
    }
  }

  if (sentCount > 0) {
    addChatMessage("self", text);
    composerInputEl.value = "";
    statusText = `Sent to ${sentCount} peers.`;
    renderUi();
  }
}

function reconnectMesh() {
  for (const entry of peerConnections.values()) {
    try {
      entry.dc?.close?.();
    } catch {}
    try {
      entry.pc?.close?.();
    } catch {}
  }
  peerConnections.clear();
  requestInvitationList();
  publishInvitation();
  for (const peerId of knownPeers.keys()) {
    if (myPeerId < peerId) {
      startOfferToPeer(peerId);
    }
  }
  statusText = "Reconnecting mesh.";
  renderUi();
}

function waitForIceReady(entry, timeoutMs = 1800, minCandidates = 2) {
  return new Promise((resolve) => {
    if (
      entry.pc.iceGatheringState === "complete" ||
      entry.localCandidates.length >= minCandidates
    ) {
      resolve();
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      entry.pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };

    const onChange = () => {
      if (
        entry.pc.iceGatheringState === "complete" ||
        entry.localCandidates.length >= minCandidates
      ) {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    entry.pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function addSystemMessage(text) {
  chatMessages.push({ type: "system", text });
  renderMessages();
}

function addChatMessage(type, text) {
  chatMessages.push({ type, text });
  renderMessages();
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = "";
  for (const msg of chatMessages) {
    const bubble = document.createElement("div");
    bubble.className = `rtcmesh-bubble ${msg.type}`;
    bubble.textContent = msg.text;
    messagesEl.appendChild(bubble);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createBundle(type, sdp, candidates) {
  const fields = extractNegotiationFields(sdp, type);
  return {
    t: type,
    u: fields.iceUfrag,
    p: fields.icePwd,
    f: fields.fingerprint,
    a: fields.setup,
    c: pickCandidates(candidates),
  };
}

function extractNegotiationFields(sdp, type) {
  const lines = String(sdp || "").split(/\r?\n/).filter(Boolean);
  const findValue = (prefix) => {
    const line = lines.find((entry) => entry.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : "";
  };
  return {
    iceUfrag: findValue("a=ice-ufrag:"),
    icePwd: findValue("a=ice-pwd:"),
    fingerprint: findValue("a=fingerprint:"),
    setup: findValue("a=setup:") || (type === "AB" ? "active" : "actpass"),
  };
}

function pickCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  return list.slice(0, 3);
}

function buildSdpFromBundle(bundle) {
  const type = bundle?.t === "AB" ? "AB" : "OB";
  const setup = bundle?.a || (type === "AB" ? "active" : "actpass");
  const sessionId = makeSessionId(type, bundle?.f || "", bundle?.u || "", bundle?.p || "");

  return [
    "v=0",
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 DTLS/SCTP 5000",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${bundle?.u || ""}`,
    `a=ice-pwd:${bundle?.p || ""}`,
    "a=ice-options:trickle",
    `a=fingerprint:${bundle?.f || ""}`,
    `a=setup:${setup}`,
    "a=mid:0",
    "a=sctpmap:5000 webrtc-datachannel 1024",
    "",
  ].join("\r\n");
}

function makeSessionId(type, fingerprint, iceUfrag, icePwd) {
  const seed = `${type}|${fingerprint}|${iceUfrag}|${icePwd}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return `1${String(hash).padStart(9, "0")}23456789`;
}
