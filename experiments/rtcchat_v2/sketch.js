const RTCCHAT_V2_VERSION = 2;

const SELF_PEER_ID = `peer-${Math.random().toString(36).slice(2, 10)}`;
const ROOM_SIGNAL_CHANNEL = "rtchat-v2-room";

let role = "idle";
let phase = "idle";
let statusText = "Starting room...";

let roomId = "";
let hostPeerId = "";
let activeInvite = null;
let qrCode = null;
let shareLink = "";

let connections = new Map();
let knownPeerIds = new Set([SELF_PEER_ID]);
let seenChatIds = new Set();

let appEl;
let panelEl;
let statusCardEl;
let titleEl;
let statusTextEl;
let peersTextEl;
let connectionsTextEl;
let actionsEl;
let stageEl;
let stageCardEl;
let chatCardEl;
let messagesEl;
let composerInputEl;
let sendBtnEl;
let canvasEl;
let linkCardEl;
let linkTopRowEl;
let linkTitleEl;
let linkAnchorEl;
let linkTextEl;
let linkCopyBtnEl;
let linkCloseBtnEl;
let responsePasteCardEl;
let responsePasteInputEl;
let responsePasteBtnEl;

let chatMessages = [];
let canvasMode = "";
let lastStageSize = 0;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvasEl = canvas.elt;
  textFont("monospace");
  textSize(16);

  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");
  await loadScript("portal/qrCodeGen.js");

  buildUi(canvas);
  installViewportTracking();
  renderMessages();
  renderUi();
  await handleIncomingLink();
}

function draw() {
  background("#0b0b0d");

  if ((phase === "show-invite" || phase === "show-response") && qrCode) {
    drawQrScreen();
  } else if (phase === "connected" || phase === "hosting" || phase === "joining") {
    drawConnectedBackdrop();
  } else {
    clear();
  }
}

function windowResized() {
  updateViewportHeight();
  syncCanvasMode();
}

function buildUi(canvas) {
  appEl = document.createElement("div");
  appEl.className = "rtcchat-app";

  panelEl = document.createElement("div");
  panelEl.className = "rtcchat-panel";

  statusCardEl = document.createElement("section");
  statusCardEl.className = "rtcchat-card rtcchat-status";

  titleEl = document.createElement("h1");
  titleEl.className = "rtcchat-title";
  titleEl.textContent = "";
  statusCardEl.appendChild(titleEl);

  statusTextEl = document.createElement("p");
  statusTextEl.className = "rtcchat-text";
  statusCardEl.appendChild(statusTextEl);

  peersTextEl = document.createElement("p");
  peersTextEl.className = "rtcchat-text";
  statusCardEl.appendChild(peersTextEl);

  connectionsTextEl = document.createElement("p");
  connectionsTextEl.className = "rtcchat-text";
  statusCardEl.appendChild(connectionsTextEl);

  actionsEl = document.createElement("div");
  actionsEl.className = "rtcchat-actions";
  statusCardEl.appendChild(actionsEl);

  linkCardEl = document.createElement("section");
  linkCardEl.className = "rtcchat-card rtcchat-link-card";

  linkTopRowEl = document.createElement("div");
  linkTopRowEl.className = "rtcchat-link-toprow";
  linkCardEl.appendChild(linkTopRowEl);

  linkTitleEl = document.createElement("div");
  linkTitleEl.className = "rtcchat-link-title";
  linkTopRowEl.appendChild(linkTitleEl);

  linkAnchorEl = document.createElement("a");
  linkAnchorEl.className = "rtcchat-share-anchor";
  linkAnchorEl.href = "#";
  linkAnchorEl.target = "_blank";
  linkAnchorEl.rel = "noreferrer";
  linkTopRowEl.appendChild(linkAnchorEl);

  linkCloseBtnEl = document.createElement("button");
  linkCloseBtnEl.className = "rtcchat-link-close";
  linkCloseBtnEl.type = "button";
  linkCloseBtnEl.textContent = "×";
  linkCloseBtnEl.setAttribute("aria-label", "Close link panel");
  linkCloseBtnEl.addEventListener("click", clearInviteView);
  linkTopRowEl.appendChild(linkCloseBtnEl);

  linkTextEl = document.createElement("input");
  linkTextEl.className = "rtcchat-link";
  linkTextEl.type = "text";
  linkTextEl.readOnly = true;
  linkTextEl.spellcheck = false;
  linkCardEl.appendChild(linkTextEl);

  linkCopyBtnEl = document.createElement("button");
  linkCopyBtnEl.className = "rtcchat-btn";
  linkCopyBtnEl.textContent = "Copy Link";
  linkCopyBtnEl.addEventListener("click", copyShareLink);
  linkCardEl.appendChild(linkCopyBtnEl);

  responsePasteCardEl = document.createElement("section");
  responsePasteCardEl.className = "rtcchat-card rtcchat-link-card rtcchat-response-card";

  responsePasteInputEl = document.createElement("input");
  responsePasteInputEl.className = "rtcchat-link";
  responsePasteInputEl.type = "text";
  responsePasteInputEl.placeholder = "Paste response link here…";
  responsePasteInputEl.spellcheck = false;
  responsePasteInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyPastedResponseLink();
  });
  responsePasteCardEl.appendChild(responsePasteInputEl);

  responsePasteBtnEl = document.createElement("button");
  responsePasteBtnEl.className = "rtcchat-btn";
  responsePasteBtnEl.textContent = "Apply Response";
  responsePasteBtnEl.addEventListener("click", applyPastedResponseLink);
  responsePasteCardEl.appendChild(responsePasteBtnEl);

  stageEl = document.createElement("section");
  stageEl.className = "rtcchat-stage";

  stageCardEl = document.createElement("div");
  stageCardEl.className = "rtcchat-stage-card";
  stageCardEl.appendChild(canvas.elt);
  stageEl.appendChild(stageCardEl);

  chatCardEl = document.createElement("section");
  chatCardEl.className = "rtcchat-card rtcchat-chat";

  messagesEl = document.createElement("div");
  messagesEl.className = "rtcchat-messages";
  chatCardEl.appendChild(messagesEl);

  const composer = document.createElement("div");
  composer.className = "rtcchat-composer";

  composerInputEl = document.createElement("input");
  composerInputEl.className = "rtcchat-input";
  composerInputEl.type = "text";
  composerInputEl.placeholder = "Type a room message…";
  composerInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
  });
  composerInputEl.addEventListener("focus", () => {
    requestViewportRefresh();
  });
  composer.appendChild(composerInputEl);

  sendBtnEl = document.createElement("button");
  sendBtnEl.className = "rtcchat-btn";
  sendBtnEl.textContent = "Send";
  sendBtnEl.addEventListener("click", sendMessage);
  composer.appendChild(sendBtnEl);

  chatCardEl.appendChild(composer);

  panelEl.appendChild(statusCardEl);
  panelEl.appendChild(linkCardEl);
  panelEl.appendChild(responsePasteCardEl);
  panelEl.appendChild(stageEl);
  panelEl.appendChild(chatCardEl);
  appEl.appendChild(panelEl);
  document.body.appendChild(appEl);
}

function renderUi() {
  if (!statusTextEl || !actionsEl || !chatCardEl || !panelEl || !statusCardEl || !titleEl || !stageEl) return;

  const connectedPeers = getConnectedPeerIds();
  const hasRoomUi = (phase === "show-invite" || phase === "show-response") && !!qrCode;
  const showInviteLink = phase === "show-invite" || phase === "show-response";
  const showResponsePaste = !!activeInvite && phase === "awaiting-response";

  statusTextEl.textContent =
    `v${RTCCHAT_V2_VERSION}  ${statusText}  Role: ${role}  Self: ${SELF_PEER_ID}  Room: ${roomId || "-"}`;
  const knownList = [SELF_PEER_ID, ...[...knownPeerIds].filter((id) => id !== SELF_PEER_ID)];
  peersTextEl.textContent = `Known peers (${knownList.length}): ${knownList.join(", ")}`;
  connectionsTextEl.textContent = `Connected peers (${connectedPeers.length}): ${connectedPeers.length ? connectedPeers.join(", ") : "-"}`;

  panelEl.classList.toggle("qr-mode", hasRoomUi);
  statusCardEl.classList.toggle("qr-mode", hasRoomUi);
  titleEl.classList.toggle("qr-mode", hasRoomUi);
  statusTextEl.classList.toggle("qr-mode", hasRoomUi);
  actionsEl.classList.toggle("qr-mode", hasRoomUi);

  linkCardEl.style.display = showInviteLink && shareLink ? "flex" : "none";
  responsePasteCardEl.style.display = showResponsePaste ? "flex" : "none";
  stageEl.classList.toggle("active", hasRoomUi);

  linkTitleEl.style.display = "none";
  linkAnchorEl.style.display = "none";
  linkTextEl.value = shareLink || "";
  linkAnchorEl.href = shareLink || "#";
  linkCopyBtnEl.disabled = !shareLink;

  chatCardEl.style.display = connectedPeers.length > 0 ? "flex" : "none";
  composerInputEl.disabled = connectedPeers.length === 0;
  sendBtnEl.disabled = connectedPeers.length === 0;

  if (canvasEl) {
    canvasEl.style.display = hasRoomUi ? "block" : "none";
  }

  actionsEl.innerHTML = "";
  if (role === "host") {
    if (connectedPeers.length > 0 && !activeInvite) {
      appendAction("+", createHostInvite);
    }
  } else if (role === "peer") {
    if (connectedPeers.length > 0 && !activeInvite) {
      appendAction("+", createHostInvite);
    }
  }

  syncCanvasMode();
}

function appendAction(label, onClick, secondary = false) {
  const button = document.createElement("button");
  button.className = secondary ? "rtcchat-btn secondary" : "rtcchat-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actionsEl.appendChild(button);
}

function drawConnectedBackdrop() {
  clear();
  background("#111217");
  noStroke();
  fill(40, 64, 140, 80);
  circle(width * 0.22, height * 0.28, width * 0.4);
  fill(20, 140, 120, 80);
  circle(width * 0.78, height * 0.72, width * 0.46);
}

function drawQrScreen() {
  background("#f6f7fb");
  if (qrCode) {
    const size = min(width, height) - 24;
    const x = (width - size) * 0.5;
    const y = (height - size) * 0.5;
    drawQRCode(qrCode, x, y, size);
  } else {
    fill(180, 40, 40);
    noStroke();
    textSize(18);
    textAlign(CENTER, CENTER);
    text("QR not available", width * 0.5, height * 0.5);
    textAlign(LEFT, BASELINE);
  }
}

function syncCanvasMode() {
  if (!canvasEl || !stageCardEl) return;
  const stageMode = !!shareLink;

  if (stageMode) {
    const rect = stageCardEl.getBoundingClientRect();
    const availableHeight = window.innerHeight - rect.top - 12;
    const panelWidth = stageEl?.getBoundingClientRect?.().width || rect.width;
    const stageSize = Math.max(1, Math.round(Math.min(panelWidth, availableHeight, 560)));
    stageCardEl.style.width = `${stageSize}px`;
    stageCardEl.style.height = `${stageSize}px`;
    if (canvasMode !== "stage" || Math.abs(stageSize - lastStageSize) > 1) {
      resizeCanvas(stageSize, stageSize);
      lastStageSize = stageSize;
      canvasMode = "stage";
    }
  } else if (canvasMode !== "window") {
    stageCardEl.style.width = "";
    stageCardEl.style.height = "";
    resizeCanvas(windowWidth, windowHeight);
    canvasMode = "window";
    lastStageSize = 0;
  }
}

async function handleIncomingLink() {
  const params = new URLSearchParams(window.location.search);
  const connectValue = params.get("connect");
  const room = params.get("room");
  const inviteId = params.get("invite");
  const host = params.get("host");

  if (connectValue && inviteId && host) {
    await startAsJoinerFromLink(connectValue, room, inviteId, host);
    return;
  }

  await initializeHostRoom();
}

async function initializeHostRoom() {
  closeAllConnections();
  connections.clear();
  knownPeerIds = new Set([SELF_PEER_ID]);
  role = "host";
  phase = "hosting";
  roomId = makeRoomId();
  hostPeerId = SELF_PEER_ID;
  shareLink = "";
  qrCode = null;
  activeInvite = null;
  statusText = "Creating room invite...";
  renderMessages();
  renderUi();
  await createHostInvite();
}

function closeAllConnections() {
  for (const entry of connections.values()) {
    try {
      entry.dc?.close?.();
    } catch {}
    try {
      entry.pc?.close?.();
    } catch {}
  }
}

function clearInviteView() {
  shareLink = "";
  qrCode = null;
  if (activeInvite) {
    phase = activeInvite ? "awaiting-response" : getConnectedPeerIds().length > 0 ? "connected" : "hosting";
    statusText = activeInvite ? "Awaiting peer response..." : "Room ready.";
  } else if (role === "peer") {
    phase = "joining";
    statusText = "Waiting for host to accept response.";
  }
  renderUi();
}

async function createHostInvite() {
  if (role !== "host" && role !== "peer") return;
  if (activeInvite?.entryKey) {
    const stale = connections.get(activeInvite.entryKey);
    if (stale && !stale.connectedIdentity) {
      try {
        stale.dc?.close?.();
      } catch {}
      try {
        stale.pc?.close?.();
      } catch {}
      connections.delete(activeInvite.entryKey);
    }
  }

  const inviteId = makeInviteId();
  const entryKey = `invite:${inviteId}`;
  const entry = createConnectionEntry({
    key: entryKey,
    peerId: entryKey,
    kind: "bootstrap",
    initiator: true,
  });
  entry.inviteId = inviteId;
  entry.dc = entry.pc.createDataChannel("rtchat-room");
  wireDataChannel(entry, entry.dc);
  connections.set(entryKey, entry);
  activeInvite = { inviteId, entryKey };

  phase = "hosting";
  statusText = "Creating invite link...";
  renderUi();

  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await waitForIceReady(entry);

    const bundle = createSignalBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
    const bundleString = toBundleString(bundle);
    shareLink = buildInviteLink(bundleString, roomId, inviteId, SELF_PEER_ID);
    qrCode = tryCreateQrCode(shareLink);
    logBundle("HOST INVITE", bundleString, bundle);

    phase = "show-invite";
    statusText = qrCode
      ? "Invite ready. Share it with the next peer."
      : "Invite ready. QR unavailable for this link, use copy/share.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] host invite error", error);
    statusText = `Invite error: ${error?.message || error}`;
    renderUi();
  }
}

async function startAsJoinerFromLink(linkValue, room, inviteId, hostId) {
  closeAllConnections();
  connections.clear();
  knownPeerIds = new Set([SELF_PEER_ID, hostId]);
  role = "peer";
  phase = "joining";
  roomId = room || "";
  hostPeerId = hostId;
  shareLink = "";
  qrCode = null;
  activeInvite = null;
  statusText = "Applying invite link and building response...";
  renderMessages();
  renderUi();

  const hostEntry = createConnectionEntry({
    key: hostPeerId,
    peerId: hostPeerId,
    kind: "host",
    initiator: false,
  });
  connections.set(hostPeerId, hostEntry);

  try {
    const bundle = fromBundleString(linkValue);
    logParsedBundle("JOIN OFFER", linkValue, bundle);

    await hostEntry.pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(bundle) });
    for (const candidate of bundle.c || []) {
      await hostEntry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      hostEntry.remoteCandidatesAdded += 1;
    }

    const answer = await hostEntry.pc.createAnswer();
    await hostEntry.pc.setLocalDescription(answer);
    await waitForIceReady(hostEntry);

    const answerBundle = createSignalBundle("AB", hostEntry.pc.localDescription.sdp, hostEntry.localCandidates);
    const answerString = toBundleString(answerBundle);
    shareLink = buildResponseLink(answerString, roomId, inviteId, hostPeerId);
    qrCode = tryCreateQrCode(shareLink);
    logBundle("JOIN ANSWER", answerString, answerBundle);

    phase = "show-response";
    statusText = qrCode
      ? "Response ready. Paste it into the host tab."
      : "Response ready. QR unavailable for this link, use copy/share.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] join error", error);
    statusText = `Join error: ${error?.message || error}`;
    renderUi();
  }
}

async function applyPastedResponseLink() {
  if (!activeInvite) return;
  const raw = String(responsePasteInputEl?.value || "").trim();
  if (!raw) {
    statusText = "Paste a response link first.";
    renderUi();
    return;
  }

  const responseValue = extractBundleFromPossibleUrl(raw, "response");
  const entry = connections.get(activeInvite.entryKey);
  if (!entry) {
    statusText = "No pending invite is waiting for a response.";
    renderUi();
    return;
  }

  try {
    const bundle = fromBundleString(responseValue);
    logParsedBundle("HOST RESPONSE", responseValue, bundle);

    statusText = "Applying response...";
    renderUi();

    await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(bundle) });
    entry.remoteCandidatesAdded = 0;
    for (const candidate of bundle.c || []) {
      await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      entry.remoteCandidatesAdded += 1;
    }

    responsePasteInputEl.value = "";
    shareLink = "";
    qrCode = null;
    phase = "joining";
    statusText = "Response accepted. Waiting for peer hello...";
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] apply response error", error);
    statusText = `Response error: ${error?.message || error}`;
    renderUi();
  }
}

function createConnectionEntry({ key, peerId, kind, initiator }) {
  const entry = {
    key,
    peerId,
    kind,
    initiator,
    pc: new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    }),
    dc: null,
    localCandidates: [],
    remoteCandidatesAdded: 0,
    state: "new",
    connectedIdentity: kind !== "bootstrap",
    meshTargets: new Set(),
    introducedPeers: new Set(),
    inviteId: "",
    relayPeerId: "",
    meshWaitTimer: null,
  };

  entry.pc.onicecandidate = (event) => {
    if (event.candidate?.candidate) {
      entry.localCandidates.push(event.candidate.candidate);
    }
  };

  entry.pc.onconnectionstatechange = () => {
    entry.state = entry.pc.connectionState || "unknown";
    if (entry.state === "failed") {
      addSystemMessage(`Connection failed for ${entry.peerId}.`);
      statusText = `Connection failed for ${entry.peerId}.`;
      renderUi();
    } else if (entry.state === "connected") {
      if (entry.kind === "mesh") {
        statusText = `Mesh connected to ${entry.peerId}.`;
      } else if (entry.kind === "host" && role === "peer") {
        phase = "connected";
        statusText = "Connected to room host.";
      }
      renderUi();
    }
  };

  entry.pc.ondatachannel = (event) => {
    wireDataChannel(entry, event.channel);
  };

  return entry;
}

function wireDataChannel(entry, channel) {
  entry.dc = channel;
  channel.onopen = () => {
    if (role === "peer" && entry.peerId === hostPeerId && entry.kind === "host") {
      sendHelloToHost();
    }

    if (entry.kind === "mesh") {
      knownPeerIds.add(entry.peerId);
      addSystemMessage(`Direct room link open with ${entry.peerId}.`);
    }

    renderUi();
  };

  channel.onmessage = (event) => {
    handleChannelMessage(entry, event.data);
  };

  channel.onclose = () => {
    renderUi();
  };

  channel.onerror = (event) => {
    console.error("[rtcchat_v2] datachannel error", event);
  };
}

function sendHelloToHost() {
  const hostEntry = connections.get(hostPeerId);
  if (!hostEntry?.dc || hostEntry.dc.readyState !== "open") return;
  sendJson(hostEntry.dc, {
    type: "hello",
    peerId: SELF_PEER_ID,
    roomId,
  });
}

function handleChannelMessage(entry, raw) {
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === "hello" && entry.kind === "bootstrap") {
    finalizeBootstrapPeer(entry, message);
    return;
  }

  if (message.type === "room-peers") {
    handleRoomPeers(message.peers || [], entry.peerId);
    return;
  }

  if (message.type === "mesh-connect") {
    maybeStartMeshConnection(message.peerId, message.brokerPeerId || entry.peerId);
    return;
  }

  if (message.type === "relay-signal") {
    if (entry.kind === "host" || entry.kind === "bootstrap") {
      forwardRelaySignal(entry, message);
    } else {
      handleRelayedSignal(message);
    }
    return;
  }

  if (message.type === "chat") {
    handleIncomingChat(message);
  }
}

function finalizeBootstrapPeer(entry, message) {
  const peerId = String(message.peerId || "").trim();
  if (!peerId || peerId === SELF_PEER_ID) return;

  const oldKey = entry.key;
  connections.delete(oldKey);

  entry.key = peerId;
  entry.peerId = peerId;
  entry.kind = "host";
  entry.connectedIdentity = true;
  connections.set(peerId, entry);

  knownPeerIds.add(peerId);
  addSystemMessage(`${peerId} joined the room.`);

  const existingMeshPeers = [...connections.values()]
    .filter((candidate) => candidate.peerId !== peerId && candidate.peerId !== SELF_PEER_ID && candidate.kind !== "bootstrap")
    .map((candidate) => candidate.peerId);

  sendJson(entry.dc, {
    type: "room-peers",
    peers: existingMeshPeers,
  });

  for (const otherPeerId of existingMeshPeers) {
    const other = connections.get(otherPeerId);
    if (other?.dc?.readyState === "open") {
      sendJson(other.dc, {
        type: "mesh-connect",
        peerId,
        brokerPeerId: SELF_PEER_ID,
      });
    }
    if (entry.dc?.readyState === "open") {
      sendJson(entry.dc, {
        type: "mesh-connect",
        peerId: otherPeerId,
        brokerPeerId: SELF_PEER_ID,
      });
    }
  }

  if (activeInvite?.entryKey === oldKey) {
    activeInvite = null;
    shareLink = "";
    qrCode = null;
    phase = "connected";
    statusText = `Peer ${peerId} connected. Room is ready.`;
    renderUi();
  } else {
    renderUi();
  }
}

function handleRoomPeers(peerIds, relayPeerId = hostPeerId) {
  for (const peerId of peerIds) {
    knownPeerIds.add(peerId);
    maybeStartMeshConnection(peerId, relayPeerId);
  }
  renderUi();
}

function maybeStartMeshConnection(peerId, relayPeerId = hostPeerId) {
  if (!peerId || peerId === SELF_PEER_ID || peerId === hostPeerId) return;
  knownPeerIds.add(peerId);
  let entry = connections.get(peerId);
  if (entry && entry.kind === "mesh") {
    if (relayPeerId) entry.relayPeerId = relayPeerId;
    return;
  }

  entry = createConnectionEntry({
    key: peerId,
    peerId,
    kind: "mesh",
    initiator: SELF_PEER_ID < peerId,
  });
  entry.relayPeerId = relayPeerId;
  connections.set(peerId, entry);

  if (entry.initiator) {
    startMeshOffer(entry);
  } else {
    scheduleMeshOfferFallback(entry);
    statusText = `Waiting for ${peerId} to initiate mesh link.`;
    renderUi();
  }
}

async function startMeshOffer(entry) {
  if (!entry || entry.dc) return;
  clearMeshOfferFallback(entry);
  entry.dc = entry.pc.createDataChannel(`mesh-${entry.peerId}`);
  wireDataChannel(entry, entry.dc);

  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await waitForIceReady(entry);

    const bundle = createSignalBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
    sendRelayToPeer(entry.peerId, {
      signalKind: "offer",
      bundle,
    }, entry.relayPeerId || hostPeerId);
    statusText = `Brokering offer to ${entry.peerId}.`;
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] mesh offer error", error);
    statusText = `Mesh offer error for ${entry.peerId}: ${error?.message || error}`;
    renderUi();
  }
}

function sendRelayToPeer(targetPeerId, signal, relayPeerId = hostPeerId) {
  const relayEntry = connections.get(relayPeerId);
  if (!relayEntry?.dc || relayEntry.dc.readyState !== "open") {
    throw new Error("Relay channel is not open");
  }
  sendJson(relayEntry.dc, {
    type: "relay-signal",
    targetPeerId,
    fromPeerId: SELF_PEER_ID,
    signalKind: signal.signalKind,
    bundle: signal.bundle,
    brokerPeerId: relayPeerId,
  });
}

function scheduleMeshOfferFallback(entry, delayMs = 1800) {
  clearMeshOfferFallback(entry);
  entry.meshWaitTimer = setTimeout(() => {
    entry.meshWaitTimer = null;
    if (!entry.dc && entry.pc?.signalingState === "stable") {
      statusText = `Fallback: initiating mesh link to ${entry.peerId}.`;
      renderUi();
      startMeshOffer(entry);
    }
  }, delayMs);
}

function clearMeshOfferFallback(entry) {
  if (entry?.meshWaitTimer) {
    clearTimeout(entry.meshWaitTimer);
    entry.meshWaitTimer = null;
  }
}

function forwardRelaySignal(fromEntry, message) {
  const targetPeerId = String(message.targetPeerId || "").trim();
  if (!targetPeerId) return;
  const targetEntry = connections.get(targetPeerId);
  if (!targetEntry?.dc || targetEntry.dc.readyState !== "open") return;

  sendJson(targetEntry.dc, {
    type: "relay-signal",
    fromPeerId: message.fromPeerId,
    signalKind: message.signalKind,
    bundle: message.bundle,
    brokerPeerId: SELF_PEER_ID,
  });

  knownPeerIds.add(targetPeerId);
  if (message.fromPeerId) {
    knownPeerIds.add(message.fromPeerId);
  }
  renderUi();
}

async function handleRelayedSignal(message) {
  const fromPeerId = String(message.fromPeerId || "").trim();
  if (!fromPeerId || fromPeerId === SELF_PEER_ID) return;
  knownPeerIds.add(fromPeerId);

  let entry = connections.get(fromPeerId);
  if (!entry) {
    entry = createConnectionEntry({
      key: fromPeerId,
      peerId: fromPeerId,
      kind: "mesh",
      initiator: false,
    });
    connections.set(fromPeerId, entry);
  }
  entry.relayPeerId = message.brokerPeerId || entry.relayPeerId || hostPeerId;
  clearMeshOfferFallback(entry);

  try {
    if (message.signalKind === "offer") {
      await entry.pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(message.bundle) });
      for (const candidate of message.bundle.c || []) {
        await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
        entry.remoteCandidatesAdded += 1;
      }

      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await waitForIceReady(entry);

      const bundle = createSignalBundle("AB", entry.pc.localDescription.sdp, entry.localCandidates);
      sendRelayToPeer(fromPeerId, {
        signalKind: "answer",
        bundle,
      }, entry.relayPeerId || hostPeerId);
      statusText = `Answer brokered back to ${fromPeerId}.`;
      renderUi();
      return;
    }

    if (message.signalKind === "answer") {
      await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(message.bundle) });
      for (const candidate of message.bundle.c || []) {
        await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
        entry.remoteCandidatesAdded += 1;
      }
      statusText = `Mesh answer applied from ${fromPeerId}.`;
      renderUi();
    }
  } catch (error) {
    console.error("[rtcchat_v2] relayed signal error", error);
    statusText = `Signal error with ${fromPeerId}: ${error?.message || error}`;
    renderUi();
  }
}

function sendMessage() {
  const text = String(composerInputEl.value || "").trim();
  if (!text) return;

  const msg = {
    type: "chat",
    id: makeMessageId(),
    from: SELF_PEER_ID,
    text,
  };

  let sent = 0;
  for (const entry of connections.values()) {
    if (entry.dc?.readyState === "open") {
      sendJson(entry.dc, msg);
      sent += 1;
    }
  }

  if (sent > 0) {
    seenChatIds.add(msg.id);
    addChatMessage("self", text);
    composerInputEl.value = "";
    statusText = `Sent to ${sent} peer${sent === 1 ? "" : "s"}.`;
    renderUi();
  }
}

function handleIncomingChat(message) {
  if (!message.id || seenChatIds.has(message.id)) return;
  seenChatIds.add(message.id);
  addChatMessage("peer", `${message.from}: ${message.text}`);
}

function sendJson(channel, value) {
  channel.send(JSON.stringify(value));
}

function getConnectedPeerIds() {
  return [...connections.values()]
    .filter((entry) => entry.dc?.readyState === "open" && entry.peerId !== SELF_PEER_ID)
    .map((entry) => entry.peerId);
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
    bubble.className = `rtcchat-bubble ${msg.type}`;
    bubble.textContent = msg.text;
    messagesEl.appendChild(bubble);
  }
  keepChatVisible();
}

function waitForIceReady(entry, timeoutMs = 1800, minCandidates = 2) {
  return new Promise((resolve) => {
    if (entry.pc.iceGatheringState === "complete" || entry.localCandidates.length >= minCandidates) {
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
      if (entry.pc.iceGatheringState === "complete" || entry.localCandidates.length >= minCandidates) {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    entry.pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function createSignalBundle(type, sdp, candidates) {
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
  const selected = [];

  const host = list.find((candidate) => /\styp host(\s|$)/.test(candidate));
  if (host) selected.push(host);

  const srflx = list.find((candidate) => /\styp srflx(\s|$)/.test(candidate));
  if (srflx && !selected.includes(srflx)) selected.push(srflx);

  for (const candidate of list) {
    if (selected.length >= 3) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected;
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

function toBundleString(bundle) {
  const json = JSON.stringify(bundle);
  const raw = new TextEncoder().encode(json);
  const bytes = globalThis.fflate?.zlibSync ? globalThis.fflate.zlibSync(raw, { level: 9 }) : raw;
  const compressed = !!globalThis.fflate?.zlibSync;
  const b64 = btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${bundle.t}${compressed ? "Z" : ""}-` + b64;
}

function fromBundleString(value) {
  const trimmed = String(value || "").trim();
  const type = trimmed.slice(0, 2).toUpperCase();
  const compressionFlag = trimmed[2];
  let compressed = false;
  let offset = 3;

  if (type !== "OB" && type !== "AB") {
    throw new Error('Expected "OB-..." / "AB-..." or compressed "OBZ-..." / "ABZ-..."');
  }
  if (compressionFlag === "-") {
    compressed = false;
    offset = 3;
  } else if (compressionFlag === "Z" && trimmed[3] === "-") {
    compressed = true;
    offset = 4;
  } else {
    throw new Error('Expected "OB-..." / "AB-..." or compressed "OBZ-..." / "ABZ-..."');
  }

  const b64 = trimmed.slice(offset).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = binaryToBytes(atob(b64));
  const out = compressed && globalThis.fflate?.unzlibSync ? globalThis.fflate.unzlibSync(bytes) : bytes;
  const json = new TextDecoder().decode(out);
  const bundle = JSON.parse(json);
  if (bundle.t !== type) throw new Error("Bundle type mismatch");
  return bundle;
}

function buildInviteLink(bundleString, room, inviteId, hostId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("connect", bundleString);
  url.searchParams.set("room", room);
  url.searchParams.set("invite", inviteId);
  url.searchParams.set("host", hostId);
  return url.toString();
}

function buildResponseLink(bundleString, room, inviteId, hostId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("response", bundleString);
  url.searchParams.set("room", room);
  url.searchParams.set("invite", inviteId);
  url.searchParams.set("host", hostId);
  return url.toString();
}

function tryCreateQrCode(value) {
  try {
    return value ? createQRCode(value) : null;
  } catch (error) {
    console.warn("[rtcchat_v2] QR generation unavailable for current link", error);
    return null;
  }
}

function extractBundleFromPossibleUrl(raw, paramName) {
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    const value = url.searchParams.get(paramName);
    if (!value) throw new Error(`Missing ${paramName} in link`);
    return value;
  }
  return raw;
}

function resetRoom() {
  clearIncomingParams();
  initializeHostRoom();
}

function clearIncomingParams() {
  const url = new URL(window.location.href);
  if (url.search) {
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  }
}

function copyShareLink() {
  if (!shareLink) return;
  navigator.clipboard?.writeText?.(shareLink).catch(() => {});
  if (activeInvite) {
    phase = "awaiting-response";
    shareLink = "";
    qrCode = null;
    statusText = "Invite copied. Waiting for peer response...";
  } else {
    phase = "joining";
    shareLink = "";
    qrCode = null;
    statusText = "Response copied. Send it back to the host tab.";
  }
  renderUi();
}

function logBundle(label, payload, bundle) {
  console.log(`[rtcchat_v2] ${label} string`);
  console.log(payload);
  console.log(`[rtcchat_v2] ${label} json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

function logParsedBundle(label, payload, bundle) {
  console.log(`[rtcchat_v2] ${label} string`);
  console.log(payload);
  console.log(`[rtcchat_v2] ${label} parsed json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

function bundleSummary(bundle) {
  const sdp = buildSdpFromBundle(bundle);
  return {
    type: bundle.t === "OB" ? "offer-bundle" : "answer-bundle",
    mode: "compact-room",
    payloadLength: JSON.stringify(bundle).length,
    sdpType: bundle.t === "OB" ? "offer" : "answer",
    sdpLength: sdp.length,
    candidateCount: Array.isArray(bundle.c) ? bundle.c.length : 0,
    candidates: Array.isArray(bundle.c) ? bundle.c : [],
    sdpPreview: sdp.split("\n").slice(0, 12),
  };
}

function makeRoomId() {
  return `room-${Math.random().toString(36).slice(2, 8)}`;
}

function makeInviteId() {
  return `invite-${Math.random().toString(36).slice(2, 8)}`;
}

function makeMessageId() {
  return `${SELF_PEER_ID}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeSessionId(type, fingerprint, iceUfrag, icePwd) {
  const seed = `${type}|${fingerprint}|${iceUfrag}|${icePwd}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return `1${String(hash).padStart(9, "0")}23456789`;
}

function bytesToBinary(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return binary;
}

function binaryToBytes(binary) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function installViewportTracking() {
  updateViewportHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportChange);
    window.visualViewport.addEventListener("scroll", handleViewportChange);
  }
}

function handleViewportChange() {
  updateViewportHeight();
  keepChatVisible();
  syncCanvasMode();
}

function updateViewportHeight() {
  const top = window.visualViewport?.offsetTop || 0;
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--rtcchat-app-top", `${Math.round(top)}px`);
  document.documentElement.style.setProperty("--rtcchat-app-height", `${Math.round(height)}px`);
}

function keepChatVisible() {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function requestViewportRefresh() {
  const delays = [0, 80, 180, 320];
  for (const delay of delays) {
    setTimeout(() => {
      updateViewportHeight();
      keepChatVisible();
      syncCanvasMode();
    }, delay);
  }
}
