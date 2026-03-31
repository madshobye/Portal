const RTCCHAT_V2_VERSION = 4;

const SELF_PEER_ID = `peer-${Math.random().toString(36).slice(2, 10)}`;
const ROOM_SIGNAL_CHANNEL = "rtchat-v2-room";
const LOCAL_RESPONSE_CHANNEL = "rtcchat-v2-local-response";
const LOCAL_RESPONSE_KEY = "rtcchat-v2-local-response";
const ONBOARDER_ENABLED_KEY = "rtcchat-v2-onboarder-enabled";
const MQTT_BROKER = "wss://public:public@public.cloud.shiftr.io";
const DEBUG_TOPIC = "portal/rtcchat/debug";
const ONBOARDER_REQUEST_TOPIC = "portal/rtcchat_v2/onboarder/request";

const NAME_ADJECTIVES = [
  "Amber", "Brisk", "Calm", "Daring", "Echo", "Frost", "Golden", "Harbor",
  "Indigo", "Jolly", "Kind", "Lively", "Mellow", "North", "Opal", "Pine",
  "Quiet", "River", "Solar", "Tidal",
];

const NAME_NOUNS = [
  "Badger", "Comet", "Drift", "Falcon", "Field", "Finch", "Forest", "Harbor",
  "Leaf", "Lynx", "Meadow", "Otter", "Peak", "Quartz", "Reef", "Sparrow",
  "Stone", "Vale", "Willow", "Wren",
];

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
let topToggleEl;
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
let linkNextBtnEl;
let linkCloseBtnEl;
let responsePasteCardEl;
let responsePasteInputEl;
let responsePasteBtnEl;

let chatMessages = [];
let canvasMode = "";
let lastStageSize = 0;
let localResponseChannel = null;
let appliedResponseSignatures = new Set();
let applyingResponseInviteIds = new Set();
let debugMqttClient = null;
let onboarderMqttClient = null;
let onboarderReplyTopic = `portal/rtcchat_v2/onboarder/reply/${SELF_PEER_ID}`;
let onboarderResponseTopic = `portal/rtcchat_v2/onboarder/response/${SELF_PEER_ID}`;
let onboarderWaiters = new Map();
let onboarderEnabled = localStorage.getItem(ONBOARDER_ENABLED_KEY) === "1";
const SELF_PROFILE = getPeerProfile(SELF_PEER_ID);
let topPanelVisible = false;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvasEl = canvas.elt;
  textFont("monospace");
  textSize(16);

  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");
  await loadScript("portal/qrCodeGen.js");
  await loadScript("portal/mqtt.js");

  initLocalResponseRelay();
  buildUi(canvas);
  installViewportTracking();
  renderMessages();
  renderUi();
  await initDebugMqtt();
  await initOnboarderMqtt();
  installDisconnectHandlers();
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

  topToggleEl = document.createElement("button");
  topToggleEl.className = "rtcchat-top-toggle";
  topToggleEl.type = "button";
  topToggleEl.addEventListener("click", () => {
    topPanelVisible = !topPanelVisible;
    renderUi();
  });
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

  linkNextBtnEl = document.createElement("button");
  linkNextBtnEl.className = "rtcchat-btn secondary";
  linkNextBtnEl.textContent = "Next";
  linkNextBtnEl.addEventListener("click", advanceInviteFlow);
  linkCardEl.appendChild(linkNextBtnEl);

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

  panelEl.appendChild(topToggleEl);
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

  topToggleEl.textContent = topPanelVisible ? "Hide Info" : "Show Info";
  statusCardEl.style.display = topPanelVisible ? "block" : "none";

  titleEl.textContent = `${SELF_PROFILE.name}`;
  titleEl.style.color = SELF_PROFILE.color;
  statusTextEl.textContent =
    `v${RTCCHAT_V2_VERSION}  ${statusText}  Role: ${role}  Name: ${SELF_PROFILE.name}  Room: ${roomId || "-"}`;
  const knownList = [SELF_PEER_ID, ...[...knownPeerIds].filter((id) => id !== SELF_PEER_ID)];
  peersTextEl.textContent = `Known peers (${knownList.length}): ${formatPeerList(knownList)}`;
  connectionsTextEl.textContent = `Connected peers (${connectedPeers.length}): ${connectedPeers.length ? formatPeerList(connectedPeers) : "-"}`;

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
  linkNextBtnEl.disabled = !shareLink;

  chatCardEl.style.display = connectedPeers.length > 0 ? "flex" : "none";
  composerInputEl.disabled = connectedPeers.length === 0;
  sendBtnEl.disabled = connectedPeers.length === 0;

  if (canvasEl) {
    canvasEl.style.display = hasRoomUi ? "block" : "none";
  }

  actionsEl.innerHTML = "";
  appendAction(onboarderEnabled ? "Onboarder: On" : "Onboarder: Off", toggleOnboarderMode, true);
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
  const responseValue = params.get("response");
  const room = params.get("room");
  const inviteId = params.get("invite");
  const host = params.get("host");

  if (connectValue && inviteId && host) {
    await startAsJoinerFromLink(connectValue, room, inviteId, host);
    return;
  }

  if (responseValue && inviteId) {
    forwardResponseToLocalInviter({
      type: "rtcchat-v2-response",
      inviteId,
      responseValue,
      roomId: room || "",
      sentAt: Date.now(),
    });
    return;
  }

  statusText = "Checking onboarder...";
  renderUi();
  if (await tryJoinViaOnboarder()) {
    return;
  }

  statusText = "Starting room...";
  renderUi();
  await initializeHostRoom();
}

async function tryJoinViaOnboarder(timeoutMs = 4000) {
  if (!onboarderMqttClient?.connected) return false;

  const requestId = `req-${Math.random().toString(36).slice(2, 10)}`;
  statusText = "Looking for onboarder...";
  renderUi();

  const response = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      onboarderWaiters.delete(requestId);
      resolve(null);
    }, timeoutMs);

    onboarderWaiters.set(requestId, (payload) => {
      clearTimeout(timer);
      onboarderWaiters.delete(requestId);
      resolve(payload);
    });

    onboarderMqttClient.publish(
      ONBOARDER_REQUEST_TOPIC,
      JSON.stringify({
        requesterId: SELF_PEER_ID,
        requestId,
        replyTopic: onboarderReplyTopic,
      })
    ).catch(() => {
      clearTimeout(timer);
      onboarderWaiters.delete(requestId);
      resolve(null);
    });
  });

  if (!response?.link) {
    statusText = "No onboarder answered. Falling back to manual invite.";
    renderUi();
    return false;
  }

  try {
    const url = new URL(response.link);
    const connectValue = url.searchParams.get("connect");
    const room = url.searchParams.get("room") || response.roomId || "";
    const inviteId = url.searchParams.get("invite") || response.inviteId || "";
    const host = url.searchParams.get("host") || response.hostId || "";
    if (!connectValue || !inviteId || !host) {
      throw new Error("Onboarder response was missing connect details.");
    }
    debugLog("onboarder_join", { hostId: host, inviteId, roomId: room });
    await startAsJoinerFromLink(connectValue, room, inviteId, host, {
      mqttResponseTopic: response.responseTopic || "",
      viaOnboarder: true,
    });
    return true;
  } catch (error) {
    debugLog("onboarder_join_error", { msg: String(error?.message || error) });
    statusText = `Onboarder error: ${error?.message || error}`;
    renderUi();
    return false;
  }
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
  appliedResponseSignatures.clear();
  applyingResponseInviteIds.clear();
  statusText = onboarderEnabled ? "Room ready. Waiting for MQTT onboarding..." : "Creating room invite...";
  renderMessages();
  renderUi();
  debugLog("room_init", { role, roomId });
  if (onboarderEnabled) {
    phase = "hosting";
    renderUi();
    return;
  }
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

function installDisconnectHandlers() {
  const handler = () => {
    gracefulDisconnect("page-close");
  };
  window.addEventListener("pagehide", handler);
  window.addEventListener("beforeunload", handler);
}

function gracefulDisconnect(reason = "manual") {
  try {
    const payload = {
      type: "peer-leaving",
      peerId: SELF_PEER_ID,
      roomId,
      reason,
    };
    for (const entry of connections.values()) {
      if (entry.dc?.readyState === "open") {
        sendJson(entry.dc, payload);
      }
    }
    debugLog("peer_leaving", { reason, peers: getConnectedPeerIds().length });
  } catch {}
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

async function createHostInvite(options = {}) {
  const silent = !!options.silent;
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

  const previousPhase = phase;
  const previousStatus = statusText;

  if (!silent) {
    phase = "hosting";
    statusText = "Creating invite link...";
    renderUi();
  }

  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await waitForIceReady(entry);

    const bundle = createSignalBundle("OB", entry.pc.localDescription.sdp, entry.localCandidates);
    const bundleString = toBundleString(bundle);
    shareLink = buildInviteLink(bundleString, roomId, inviteId, SELF_PEER_ID);
    qrCode = tryCreateQrCode(shareLink);
    logBundle("HOST INVITE", bundleString, bundle);
    debugLog("invite_ready", {
      inviteId,
      roomId,
      role,
      len: shareLink.length,
      cand: bundle.c.length,
    });

    if (silent) {
      phase = previousPhase;
      statusText = "Onboarder invite ready.";
    } else {
      phase = "show-invite";
      statusText = qrCode
        ? "Invite ready. Share it with the next peer."
        : "Invite ready. QR unavailable for this link, use copy/share.";
    }
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] host invite error", error);
    debugLog("invite_error", { msg: String(error?.message || error) });
    statusText = silent ? previousStatus : `Invite error: ${error?.message || error}`;
    renderUi();
  }
}

async function startAsJoinerFromLink(linkValue, room, inviteId, hostId, options = {}) {
  const mqttResponseTopic = options.mqttResponseTopic || "";
  const viaOnboarder = !!options.viaOnboarder;
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
  debugLog("join_start", { inviteId, roomId, hostId });

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
    debugLog("response_ready", {
      inviteId,
      roomId,
      hostId,
      len: shareLink.length,
      cand: answerBundle.c.length,
    });

    if (mqttResponseTopic && onboarderMqttClient?.connected) {
      await onboarderMqttClient.publish(
        mqttResponseTopic,
        JSON.stringify({
          type: "rtcchat-v2-onboarder-response",
          inviteId,
          responseValue: answerString,
          roomId,
          fromPeerId: SELF_PEER_ID,
        })
      );
      shareLink = "";
      qrCode = null;
      phase = "joining";
      statusText = "Response sent to onboarder. Waiting for host...";
      debugLog("response_forwarded_mqtt", {
        inviteId,
        roomId,
        hostId,
        viaOnboarder,
      });
    } else {
      phase = "show-response";
      statusText = qrCode
        ? "Response ready. Paste it into the host tab."
        : "Response ready. QR unavailable for this link, use copy/share.";
    }
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] join error", error);
    debugLog("join_error", { inviteId, msg: String(error?.message || error) });
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

  const entry = connections.get(activeInvite.entryKey);
  if (!entry) {
    statusText = "No pending invite is waiting for a response.";
    renderUi();
    return;
  }

  try {
    const responseValue = extractResponseValue(raw);
    await applyInviteResponse(activeInvite.inviteId, responseValue);
    responsePasteInputEl.value = "";
  } catch (error) {
    console.error("[rtcchat_v2] apply response error", error);
    statusText = `Response error: ${error?.message || error}`;
    renderUi();
  }
}

function initLocalResponseRelay() {
  if (typeof BroadcastChannel !== "undefined") {
    localResponseChannel = new BroadcastChannel(LOCAL_RESPONSE_CHANNEL);
    localResponseChannel.onmessage = (event) => {
      handleLocalResponseSignal(event?.data);
    };
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== LOCAL_RESPONSE_KEY || !event.newValue) return;
    try {
      handleLocalResponseSignal(JSON.parse(event.newValue));
    } catch {}
  });
}

function forwardResponseToLocalInviter(payload) {
  try {
    localResponseChannel?.postMessage?.(payload);
  } catch {}

  try {
    localStorage.setItem(LOCAL_RESPONSE_KEY, JSON.stringify(payload));
    setTimeout(() => {
      try {
        localStorage.removeItem(LOCAL_RESPONSE_KEY);
      } catch {}
    }, 50);
  } catch {}

  role = "peer";
  phase = "joining";
  statusText = "Response forwarded to the inviter tab. You can close this tab.";
  shareLink = "";
  qrCode = null;
  clearIncomingParams();
  debugLog("response_forwarded", { inviteId: payload.inviteId, roomId: payload.roomId || roomId });
  renderUi();
}

async function handleLocalResponseSignal(data) {
  if (!data || data.type !== "rtcchat-v2-response") return;
  if (!activeInvite || data.inviteId !== activeInvite.inviteId) return;

  try {
    await applyInviteResponse(data.inviteId, data.responseValue);
  } catch (error) {
    console.error("[rtcchat_v2] local response relay error", error);
    debugLog("response_relay_error", {
      inviteId: data.inviteId,
      msg: String(error?.message || error),
    });
    statusText = `Response relay error: ${error?.message || error}`;
    renderUi();
  }
}

async function applyInviteResponse(inviteId, responseValue) {
  if (!activeInvite || activeInvite.inviteId !== inviteId) {
    throw new Error("No matching pending invite for that response.");
  }
  if (applyingResponseInviteIds.has(inviteId)) {
    return;
  }

  const entry = connections.get(activeInvite.entryKey);
  if (!entry) {
    throw new Error("No pending invite is waiting for a response.");
  }

  const bundle = fromBundleString(responseValue);
  const responseSignature = `${inviteId}:${JSON.stringify(bundle)}`;
  if (appliedResponseSignatures.has(responseSignature)) {
    return;
  }
  logParsedBundle("HOST RESPONSE", responseValue, bundle);

  applyingResponseInviteIds.add(inviteId);

  statusText = "Applying response...";
  renderUi();

  const signalingState = entry.pc?.signalingState || "";
  if (signalingState !== "have-local-offer") {
    if (signalingState === "stable") {
      appliedResponseSignatures.add(responseSignature);
      applyingResponseInviteIds.delete(inviteId);
      return;
    }
    applyingResponseInviteIds.delete(inviteId);
    throw new Error(`Invite is not waiting for an answer (state: ${signalingState})`);
  }

  try {
    await entry.pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(bundle) });
    appliedResponseSignatures.add(responseSignature);
    entry.remoteCandidatesAdded = 0;
    for (const candidate of bundle.c || []) {
      await entry.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      entry.remoteCandidatesAdded += 1;
    }

    shareLink = "";
    qrCode = null;
    phase = "joining";
    statusText = "Response accepted. Waiting for peer hello...";
    debugLog("response_applied", {
      inviteId,
      peerId: entry.peerId,
      cand: entry.remoteCandidatesAdded,
    });
    renderUi();
  } finally {
    applyingResponseInviteIds.delete(inviteId);
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
      debugLog("pc_failed", { peerId: entry.peerId, kind: entry.kind });
      statusText = `Connection failed for ${entry.peerId}.`;
      renderUi();
    } else if (entry.state === "connected") {
      if (entry.kind === "mesh") {
        statusText = `Mesh connected to ${entry.peerId}.`;
        debugLog("mesh_connected", { peerId: entry.peerId });
      } else if (entry.kind === "host" && role === "peer") {
        phase = "connected";
        statusText = "Connected to room host.";
        debugLog("host_connected", { peerId: entry.peerId });
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
      debugLog("dc_open", { peerId: entry.peerId, kind: entry.kind });
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
  debugLog("hello_sent", { to: hostPeerId, roomId });
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
    debugLog("hello_recv", { from: message.peerId, via: entry.peerId });
    finalizeBootstrapPeer(entry, message);
    return;
  }

  if (message.type === "room-peers") {
    debugLog("room_peers_recv", {
      from: entry.peerId,
      count: (message.peers || []).length,
    });
    handleRoomPeers(message.peers || [], entry.peerId);
    return;
  }

  if (message.type === "mesh-connect") {
    debugLog("mesh_connect_recv", {
      from: entry.peerId,
      peerId: message.peerId,
      broker: message.brokerPeerId || entry.peerId,
      init: typeof message.shouldInitiate === "boolean" ? message.shouldInitiate : "auto",
    });
    maybeStartMeshConnection(
      message.peerId,
      message.brokerPeerId || entry.peerId,
      typeof message.shouldInitiate === "boolean" ? message.shouldInitiate : null
    );
    return;
  }

  if (message.type === "relay-signal") {
    if (message.targetPeerId) {
      forwardRelaySignal(entry, message);
    } else {
      handleRelayedSignal(message);
    }
    return;
  }

  if (message.type === "chat") {
    handleIncomingChat(message);
    return;
  }

  if (message.type === "peer-leaving") {
    handlePeerLeaving(entry, message);
  }
}

function handlePeerLeaving(entry, message) {
  const peerId = String(message.peerId || entry.peerId || "").trim();
  if (!peerId || peerId === SELF_PEER_ID) return;
  removePeer(peerId, message.reason || "left");
  debugLog("peer_left", { peerId, reason: message.reason || "left" });
  statusText = `${peerId} left the room.`;
  renderUi();
}

function removePeer(peerId, reason = "left") {
  const entry = connections.get(peerId);
  if (entry) {
    try {
      entry.dc?.close?.();
    } catch {}
    try {
      entry.pc?.close?.();
    } catch {}
    connections.delete(peerId);
  }
  knownPeerIds.delete(peerId);
  addSystemMessage(`${peerId} ${reason}.`);
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

  debugLog("peer_joined", {
    peerId,
    existing: existingMeshPeers.length,
    broker: SELF_PEER_ID,
  });

  sendJson(entry.dc, {
    type: "room-peers",
    peers: existingMeshPeers,
  });
  debugLog("room_peers_sent", {
    to: peerId,
    count: existingMeshPeers.length,
  });

  for (const otherPeerId of existingMeshPeers) {
    if (entry.dc?.readyState === "open") {
      debugLog("mesh_connect_sent", {
        to: peerId,
        peerId: otherPeerId,
        broker: SELF_PEER_ID,
        init: true,
      });
      sendJson(entry.dc, {
        type: "mesh-connect",
        peerId: otherPeerId,
        brokerPeerId: SELF_PEER_ID,
        shouldInitiate: true,
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
    const entry = connections.get(peerId);
    if (entry && relayPeerId) {
      entry.relayPeerId = relayPeerId;
    }
  }
  renderUi();
}

function maybeStartMeshConnection(peerId, relayPeerId = hostPeerId, shouldInitiate = null) {
  if (!peerId || peerId === SELF_PEER_ID || peerId === hostPeerId) return;
  knownPeerIds.add(peerId);
  let entry = connections.get(peerId);
  if (entry && entry.kind === "mesh") {
    if (relayPeerId) entry.relayPeerId = relayPeerId;
    if (typeof shouldInitiate === "boolean") {
      entry.initiator = shouldInitiate;
      if (shouldInitiate && !entry.dc) {
        debugLog("mesh_plan", { peerId, broker: relayPeerId, init: true, existing: true });
        startMeshOffer(entry);
      }
    }
    return;
  }

  entry = createConnectionEntry({
    key: peerId,
    peerId,
    kind: "mesh",
    initiator: typeof shouldInitiate === "boolean" ? shouldInitiate : SELF_PEER_ID < peerId,
  });
  entry.relayPeerId = relayPeerId;
  connections.set(peerId, entry);

  if (entry.initiator) {
    debugLog("mesh_plan", { peerId, broker: relayPeerId, init: true, existing: false });
    startMeshOffer(entry);
  } else {
    debugLog("mesh_plan", { peerId, broker: relayPeerId, init: false, existing: false });
    statusText = `Waiting for ${peerId} to initiate mesh link.`;
    renderUi();
  }
}

async function startMeshOffer(entry) {
  if (!entry || entry.dc) return;
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
    debugLog("mesh_offer_sent", {
      peerId: entry.peerId,
      broker: entry.relayPeerId || hostPeerId,
      cand: bundle.c.length,
    });
    statusText = `Brokering offer to ${entry.peerId}.`;
    renderUi();
  } catch (error) {
    console.error("[rtcchat_v2] mesh offer error", error);
    debugLog("mesh_offer_error", { peerId: entry.peerId, msg: String(error?.message || error) });
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
      debugLog("mesh_answer_sent", {
        peerId: fromPeerId,
        broker: entry.relayPeerId || hostPeerId,
        cand: bundle.c.length,
      });
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
      debugLog("mesh_answer_applied", { peerId: fromPeerId, cand: entry.remoteCandidatesAdded });
      statusText = `Mesh answer applied from ${fromPeerId}.`;
      renderUi();
    }
  } catch (error) {
    console.error("[rtcchat_v2] relayed signal error", error);
    debugLog("mesh_signal_error", {
      peerId: fromPeerId,
      kind: message.signalKind,
      msg: String(error?.message || error),
    });
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
    fromName: SELF_PROFILE.name,
    fromColor: SELF_PROFILE.color,
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
    addChatMessage("self", text, SELF_PEER_ID);
    composerInputEl.value = "";
    debugLog("chat_send", { sent, len: text.length });
    statusText = `Sent to ${sent} peer${sent === 1 ? "" : "s"}.`;
    renderUi();
  }
}

function handleIncomingChat(message) {
  if (!message.id || seenChatIds.has(message.id)) return;
  seenChatIds.add(message.id);
  debugLog("chat_recv", { from: message.from, len: String(message.text || "").length });
  addChatMessage("peer", message.text, message.from);
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

function addChatMessage(type, text, authorId = SELF_PEER_ID) {
  chatMessages.push({ type, text, authorId });
  renderMessages();
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = "";
  for (const msg of chatMessages) {
    if (msg.type === "system") {
      const bubble = document.createElement("div");
      bubble.className = "rtcchat-bubble system";
      bubble.textContent = msg.text;
      messagesEl.appendChild(bubble);
      continue;
    }

    const profile = getPeerProfile(msg.authorId || SELF_PEER_ID);
    const row = document.createElement("div");
    row.className = `rtcchat-message ${msg.type}`;

    const avatar = document.createElement("div");
    avatar.className = "rtcchat-avatar";
    avatar.textContent = getPeerInitial(profile.name);
    avatar.style.background = profile.color;
    row.appendChild(avatar);

    const bubble = document.createElement("div");
    bubble.className = `rtcchat-bubble ${msg.type}`;

    const meta = document.createElement("div");
    meta.className = "rtcchat-meta";
    meta.textContent = `${profile.name}`;
    bubble.appendChild(meta);

    const body = document.createElement("div");
    body.textContent = msg.text;
    bubble.appendChild(body);

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  }
  keepChatVisible();
}

function formatPeerList(peerIds) {
  return peerIds.map((peerId) => {
    const profile = getPeerProfile(peerId);
    return `${profile.name}`;
  }).join(", ");
}

function getPeerInitial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function getPeerProfile(peerId) {
  const hash = hashString(peerId);
  const adjective = NAME_ADJECTIVES[hash % NAME_ADJECTIVES.length];
  const noun = NAME_NOUNS[Math.floor(hash / NAME_ADJECTIVES.length) % NAME_NOUNS.length];
  const hue = hash % 360;
  return {
    id: peerId,
    name: `${adjective} ${noun}`,
    color: `hsl(${hue} 72% 56%)`,
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
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

function extractResponseValue(raw) {
  if (!/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const url = new URL(raw);
  const responseValue = url.searchParams.get("response");
  if (responseValue) {
    return responseValue;
  }

  if (url.searchParams.get("connect")) {
    throw new Error("That looks like an invite link, not a response link.");
  }

  throw new Error("No response was found in that link.");
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
  advanceInviteFlow(true);
}

function advanceInviteFlow(fromCopy = false) {
  if (!shareLink) return;
  if (activeInvite) {
    phase = "awaiting-response";
    shareLink = "";
    qrCode = null;
    statusText = fromCopy
      ? "Invite copied. Waiting for peer response..."
      : "Waiting for peer response...";
  } else {
    phase = "joining";
    shareLink = "";
    qrCode = null;
    statusText = fromCopy
      ? "Response copied. Send it back to the host tab."
      : "Waiting for host to accept response.";
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

async function initDebugMqtt() {
  try {
    debugMqttClient = await new PortalMqtt({
      broker: MQTT_BROKER,
      clientId: `${SELF_PEER_ID}-debug`,
      autoConnect: false,
    }).init();
    await debugMqttClient.connect();
    debugLog("debug_online", { roomId, role });
  } catch (error) {
    console.warn("[rtcchat_v2] debug mqtt unavailable", error);
  }
}

async function initOnboarderMqtt() {
  try {
    onboarderMqttClient = await new PortalMqtt({
      broker: MQTT_BROKER,
      clientId: `${SELF_PEER_ID}-onboard`,
      autoConnect: false,
      onMessage: (result) => {
        handleOnboarderMqttMessage(result);
      },
    }).init();
    await onboarderMqttClient.connect();
    await onboarderMqttClient.subscribe(onboarderReplyTopic);
    await onboarderMqttClient.subscribe(onboarderResponseTopic);
    await updateOnboarderSubscription();
  } catch (error) {
    console.warn("[rtcchat_v2] onboarder mqtt unavailable", error);
  }
}

function handleOnboarderMqttMessage(result) {
  if (result?.topic === ONBOARDER_REQUEST_TOPIC) {
    if (onboarderEnabled) {
      answerOnboarderRequest(result).catch((error) => {
        console.error("[rtcchat_v2] onboarder request error", error);
        debugLog("onboarder_error", {
          msg: error?.message || String(error),
        });
      });
    }
    return;
  }
  if (result?.topic === onboarderResponseTopic) {
    handleOnboarderResponseMessage(result);
    return;
  }
  if (!result?.message) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }
  const waiter = onboarderWaiters.get(payload.requestId);
  if (waiter) {
    waiter(payload);
  }
}

function handleOnboarderResponseMessage(result) {
  if (!result?.message) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }
  if (payload?.type !== "rtcchat-v2-onboarder-response") return;
  applyInviteResponse(payload.inviteId, payload.responseValue).catch((error) => {
    console.error("[rtcchat_v2] onboarder response error", error);
    debugLog("onboarder_response_error", {
      inviteId: payload?.inviteId,
      from: payload?.fromPeerId,
      msg: String(error?.message || error),
    });
    statusText = `Onboarder response error: ${error?.message || error}`;
    renderUi();
  });
}

async function updateOnboarderSubscription() {
  if (!onboarderMqttClient?.connected) return;
  try {
    if (onboarderEnabled) {
      await onboarderMqttClient.subscribe(ONBOARDER_REQUEST_TOPIC);
      debugLog("onboarder_service_online", { topic: ONBOARDER_REQUEST_TOPIC });
    } else {
      await onboarderMqttClient.unsubscribe(ONBOARDER_REQUEST_TOPIC);
      debugLog("onboarder_service_offline", { topic: ONBOARDER_REQUEST_TOPIC });
    }
  } catch (error) {
    console.warn("[rtcchat_v2] onboarder subscription update failed", error);
  }
}

function toggleOnboarderMode() {
  onboarderEnabled = !onboarderEnabled;
  localStorage.setItem(ONBOARDER_ENABLED_KEY, onboarderEnabled ? "1" : "0");
  if (onboarderEnabled && activeInvite && phase === "show-invite") {
    clearInviteView();
    statusText = "Onboarder mode enabled. Waiting for MQTT onboarding...";
  } else {
    statusText = onboarderEnabled ? "Onboarder mode enabled." : "Onboarder mode disabled.";
  }
  debugLog(onboarderEnabled ? "onboarder_enabled" : "onboarder_disabled", {
    roomId,
    activeInvite: !!activeInvite,
  });
  renderUi();
  updateOnboarderSubscription();
}

async function answerOnboarderRequest(result) {
  if (!result?.message || !onboarderMqttClient?.connected) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }

  const requestId = payload?.requestId;
  const replyTopic = payload?.replyTopic;
  if (!requestId || !replyTopic) return;

  debugLog("onboarder_request", {
    requestId,
    from: payload.requesterId || "-",
    replyTopic,
  });

  if (!roomId) {
    await publishOnboarderReply(replyTopic, requestId, { available: false, reason: "no-room" });
    return;
  }

  const connectedPeerIds = getConnectedPeerIds();
  const canBroker =
    role === "host" ||
    connectedPeerIds.length > 0 ||
    phase === "hosting" ||
    phase === "connected";

  if (!canBroker) {
    await publishOnboarderReply(replyTopic, requestId, {
      available: false,
      reason: "not-connected",
      roomId,
    });
    return;
  }

  if (activeInvite && !shareLink) {
    await publishOnboarderReply(replyTopic, requestId, {
      available: false,
      reason: "busy",
      roomId,
      inviteId: activeInvite.inviteId,
    });
    return;
  }

  if (!activeInvite || !shareLink) {
    statusText = "Preparing onboarder invite...";
    renderUi();
    await createHostInvite({ silent: true });
  }

  if (!activeInvite || !shareLink) {
    await publishOnboarderReply(replyTopic, requestId, {
      available: false,
      reason: "invite-unavailable",
      roomId,
    });
    return;
  }

  await publishOnboarderReply(replyTopic, requestId, {
    available: true,
    link: shareLink,
    roomId,
    inviteId: activeInvite.inviteId,
    hostId: SELF_PEER_ID,
    responseTopic: onboarderResponseTopic,
  });
}

async function publishOnboarderReply(replyTopic, requestId, extra = {}) {
  const payload = {
    requestId,
    fromPeerId: SELF_PEER_ID,
    ...extra,
  };
  await onboarderMqttClient.publish(replyTopic, JSON.stringify(payload));
  debugLog(extra.available ? "onboarder_reply" : "onboarder_unavailable", {
    requestId,
    to: replyTopic,
    inviteId: extra.inviteId,
    roomId: extra.roomId,
    reason: extra.reason,
  });
}

function debugLog(event, details = {}) {
  const payload = {
    t: new Date().toISOString(),
    event,
    self: SELF_PEER_ID,
    role,
    room: roomId || "-",
    ...compactDebugDetails(details),
  };
  console.log("[rtcchat_v2:debug]", payload);
  if (!debugMqttClient?.connected) return;
  debugMqttClient.publish(DEBUG_TOPIC, JSON.stringify(payload)).catch(() => {});
}

function compactDebugDetails(details) {
  const compact = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null || value === "") continue;
    if (typeof value === "string" && value.length > 80) {
      compact[key] = value.slice(0, 77) + "...";
    } else {
      compact[key] = value;
    }
  }
  return compact;
}
