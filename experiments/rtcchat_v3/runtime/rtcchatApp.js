const {
  VERSION: RTCCHAT_V3_VERSION,
  NETWORK_NAME,
  DEFAULT_ROOM_NAME,
  MQTT_TOPIC_PREFIX,
  ROOM_SIGNAL_CHANNEL,
  LOCAL_RESPONSE_CHANNEL,
  LOCAL_RESPONSE_KEY,
  ONBOARDER_ENABLED_KEY,
  MQTT_BROKER,
  DEBUG_TOPIC,
  ONBOARDER_DISCOVERY_TOPIC,
  ONBOARDER_REQUEST_TOPIC_PREFIX,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_RETRY_DELAY_MS,
  MESH_RETRY_DELAY_MS,
} = window.RtcChatV3Config;

const APP_MODEL = window.RtcChatV3State.createAppState({
  storage: window.localStorage,
  config: window.RtcChatV3Config,
  identity: window.RtcChatV3Identity,
});

const SELF_CLIENT_ID = APP_MODEL.network.selfClientId;
const SELF_PEER_ID = SELF_CLIENT_ID;
const SELF_USER = APP_MODEL.identity.currentUser;

let role = "idle";
let phase = "idle";
let statusText = "Connecting...";

let roomId = DEFAULT_ROOM_NAME;
let hostPeerId = "";
let activeInvite = null;
let qrCode = null;
let shareLink = "";

let connections = new Map();
let knownPeerIds = new Set([SELF_CLIENT_ID]);
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
let qrImageEl;

let chatMessages = [];
let canvasMode = "";
let lastStageSize = 0;
let localResponseChannel = null;
let appliedResponseSignatures = new Set();
let applyingResponseInviteIds = new Set();
let debugBus = null;
let onboarderMqttClient = null;
let onboarderRequestTopic = `${ONBOARDER_REQUEST_TOPIC_PREFIX}/${SELF_CLIENT_ID}`;
let onboarderReplyTopic = `${MQTT_TOPIC_PREFIX}/onboarder/reply/${SELF_CLIENT_ID}`;
let onboarderResponseTopic = `${MQTT_TOPIC_PREFIX}/onboarder/response/${SELF_CLIENT_ID}`;
let onboarderWaiters = new Map();
let mqttTopicHandlers = new Map();
let discoveredOnboarders = new Map();
let onboarderPresenceTimer = null;
let onboarderEnabled = APP_MODEL.toggles.onboarderEnabled;
const SELF_PROFILE = SELF_USER;
let topPanelVisible = APP_MODEL.toggles.infoVisible;
let reconnectTimer = null;
let reconnectAttemptInFlight = false;
let isShuttingDown = false;
let view = null;
let helpers = null;
let bundleCodec = null;
let meshProtocol = null;
let onboarding = null;

async function appSetup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvasEl = canvas.elt;
  textFont("monospace");
  textSize(16);

  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");
  await loadScript("portal/qrCodeGen.js");
  await loadScript("portal/mqtt.js");
  if (!window.RtcChatV3DebugBus) {
    await loadScript("debug/debugBus.js");
  }
  if (!window.RtcChatV3DomUi) {
    await loadScript("ui/domUi.js");
  }
  if (!window.RtcChatV3View) {
    await loadScript("ui/rtcchatView.js");
  }
  if (!window.RtcChatV3Helpers) {
    await loadScript("runtime/helpers.js");
  }
  if (!window.RtcChatV3BundleCodec) {
    await loadScript("runtime/bundleCodec.js");
  }
  if (!window.RtcChatV3MeshProtocol) {
    await loadScript("runtime/meshProtocol.js");
  }
  if (!window.RtcChatV3Onboarding) {
    await loadScript("runtime/onboarding.js");
  }

  helpers = window.RtcChatV3Helpers.createHelpers({
    selfPeerId: SELF_PEER_ID,
    identity: window.RtcChatV3Identity,
  });
  bundleCodec = window.RtcChatV3BundleCodec;

  meshProtocol = window.RtcChatV3MeshProtocol.createMeshProtocol({
    SELF_PEER_ID,
    MESH_RETRY_DELAY_MS,
    getState: () => ({
      role,
      phase,
      statusText,
      roomId,
      hostPeerId,
      activeInvite,
      shareLink,
      qrCode,
      connections,
      knownPeerIds,
      onboarderMqttClient,
      isShuttingDown,
    }),
    setState: (patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "role")) role = patch.role;
      if (Object.prototype.hasOwnProperty.call(patch, "phase")) phase = patch.phase;
      if (Object.prototype.hasOwnProperty.call(patch, "statusText")) statusText = patch.statusText;
      if (Object.prototype.hasOwnProperty.call(patch, "activeInvite")) activeInvite = patch.activeInvite;
      if (Object.prototype.hasOwnProperty.call(patch, "shareLink")) shareLink = patch.shareLink;
      if (Object.prototype.hasOwnProperty.call(patch, "qrCode")) qrCode = patch.qrCode;
    },
    renderUi,
    debugLog,
    stopReconnectLoop,
    updateOnboarderSubscription,
    scheduleReconnectAttempt,
    clearActiveInviteForEntry,
    cleanupEntryMqttSignal,
    publishOnboarderPresence,
    createSignalBundle,
    buildSdpFromBundle,
    candidateToInit,
    sendJson,
    addSystemMessage,
    handleIncomingChat,
  });

  onboarding = window.RtcChatV3Onboarding.createOnboardingRuntime({
    DEFAULT_ROOM_NAME,
    RECONNECT_RETRY_DELAY_MS,
    LOCAL_RESPONSE_CHANNEL,
    LOCAL_RESPONSE_KEY,
    getState: () => ({
      SELF_PEER_ID,
      role,
      phase,
      statusText,
      roomId,
      hostPeerId,
      activeInvite,
      qrCode,
      shareLink,
      connections,
      knownPeerIds,
      appliedResponseSignatures,
      applyingResponseInviteIds,
      onboarderMqttClient,
      onboarderReplyTopic,
      onboarderWaiters,
      onboarderEnabled,
      localResponseChannel,
      responsePasteInputEl,
    }),
    setState: (patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "role")) role = patch.role;
      if (Object.prototype.hasOwnProperty.call(patch, "phase")) phase = patch.phase;
      if (Object.prototype.hasOwnProperty.call(patch, "statusText")) statusText = patch.statusText;
      if (Object.prototype.hasOwnProperty.call(patch, "roomId")) roomId = patch.roomId;
      if (Object.prototype.hasOwnProperty.call(patch, "hostPeerId")) hostPeerId = patch.hostPeerId;
      if (Object.prototype.hasOwnProperty.call(patch, "activeInvite")) activeInvite = patch.activeInvite;
      if (Object.prototype.hasOwnProperty.call(patch, "qrCode")) qrCode = patch.qrCode;
      if (Object.prototype.hasOwnProperty.call(patch, "shareLink")) shareLink = patch.shareLink;
      if (Object.prototype.hasOwnProperty.call(patch, "knownPeerIds")) knownPeerIds = patch.knownPeerIds;
      if (Object.prototype.hasOwnProperty.call(patch, "localResponseChannel")) localResponseChannel = patch.localResponseChannel;
    },
    renderUi,
    renderMessages,
    debugLog,
    scheduleReconnectAttempt,
    stopReconnectLoop,
    clearDiscoveredOnboarders,
    waitForAvailableOnboarder,
    publishOnboarderPresence,
    updateOnboarderSubscription,
    getConnectedPeerIds,
    closeAllConnections,
    createConnectionEntry,
    wireDataChannel,
    cleanupEntryMqttSignal,
    clearActiveInviteForEntry,
    waitForIceReady,
    waitForInitialCandidates,
    createSignalBundle,
    toBundleString,
    fromBundleString,
    buildSdpFromBundle,
    logBundle,
    logParsedBundle,
    tryCreateQrCode,
    makeInviteId,
    subscribeMqttTopic,
    addInitialMqttCandidates,
    extractResponseValue,
    buildInviteLink,
    buildResponseLink,
    clearIncomingParams,
    handleInviteMqttSignal,
  });

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

function appDraw() {
  background("#0b0b0d");

  if (phase === "connected" || phase === "hosting" || phase === "joining" || phase === "reconnecting") {
    drawConnectedBackdrop();
  } else {
    clear();
  }
}

function appWindowResized() {
  updateViewportHeight();
  syncCanvasMode();
}

function buildUi(canvas) {
  view = window.RtcChatV3View.createRtcChatView({
    canvasEl: canvas.elt,
    defaultRoomName: DEFAULT_ROOM_NAME,
    onToggleInfo: () => {
      topPanelVisible = !topPanelVisible;
      APP_MODEL.toggles.infoVisible = topPanelVisible;
      renderUi();
    },
    onClearInvite: clearInviteView,
    onCopyLink: copyShareLink,
    onAdvanceInvite: advanceInviteFlow,
    onApplyResponse: applyPastedResponseLink,
    onSendMessage: sendMessage,
  });

  ({
    appEl,
    panelEl,
    topToggleEl,
    statusCardEl,
    titleEl,
    statusTextEl,
    peersTextEl,
    connectionsTextEl,
    actionsEl,
    stageEl,
    stageCardEl,
    chatCardEl,
    messagesEl,
    composerInputEl,
    sendBtnEl,
    linkCardEl,
    linkTopRowEl,
    linkTitleEl,
    linkAnchorEl,
    linkTextEl,
    linkCopyBtnEl,
    linkNextBtnEl,
    linkCloseBtnEl,
    responsePasteCardEl,
    responsePasteInputEl,
    responsePasteBtnEl,
    qrImageEl,
  } = view.refs);

  composerInputEl.addEventListener("focus", () => {
    requestViewportRefresh();
  });
}

function renderUi() {
  if (!view || !statusTextEl || !actionsEl || !chatCardEl || !panelEl || !statusCardEl || !titleEl || !stageEl) return;

  const connectedPeers = getConnectedPeerIds();
  const hasRoomUi = (phase === "show-invite" || phase === "show-response") && !!qrCode;
  const showInviteLink = phase === "show-invite" || phase === "show-response";
  const showResponsePaste = !!activeInvite && phase === "awaiting-response";
  const knownList = [SELF_PEER_ID, ...[...knownPeerIds].filter((id) => id !== SELF_PEER_ID)];
  const qrImageSrc = hasRoomUi ? bundleCodec.qrCodeToSvgDataUrl(qrCode) : "";

  const actions = [
    { label: onboarderEnabled ? "Onboarder: On" : "Onboarder: Off", onClick: toggleOnboarderMode, secondary: true },
  ];
  if ((role === "idle" || phase === "reconnecting") && connectedPeers.length === 0 && !activeInvite) {
    actions.push({ label: "Use QR", onClick: useQrMode, secondary: true });
  }
  if (role === "host") {
    if (connectedPeers.length > 0 && !activeInvite) {
      actions.push({ label: "+", onClick: createHostInvite });
    }
  } else if (role === "peer") {
    if (connectedPeers.length > 0 && !activeInvite) {
      actions.push({ label: "+", onClick: createHostInvite });
    }
  }

  view.renderChrome({
    topPanelVisible,
    topToggleLabel: topPanelVisible ? "Hide Info" : getInfoToggleLabel(connectedPeers.length, knownList.length),
    titleText: `${SELF_PROFILE.displayName}`,
    titleColor: SELF_PROFILE.color,
    statusText: `v${RTCCHAT_V3_VERSION}  ${statusText}  Role: ${role}  Name: ${SELF_PROFILE.displayName}  Net: ${NETWORK_NAME}  Lounge: ${roomId || DEFAULT_ROOM_NAME}`,
    peersText: `Known peers (${knownList.length}): ${formatPeerList(knownList)}`,
    connectionsText: `Connected peers (${connectedPeers.length}): ${connectedPeers.length ? formatPeerList(connectedPeers) : "-"}`,
    qrMode: hasRoomUi,
    showInviteLink,
    shareLink,
    showResponsePaste,
    showChat: connectedPeers.length > 0,
    showCanvas: false,
    showQrImage: hasRoomUi,
    qrImageSrc,
    actions,
  });

  syncCanvasMode();
}

function getInfoToggleLabel(connectedPeerCount, knownPeerCount) {
  if (phase === "awaiting-response") return "Waiting for QR Response";
  if (phase === "show-invite") return "QR Invite Ready";
  if (phase === "show-response") return "QR Response Ready";
  if (phase === "reconnecting") return "Disconnected";
  if (phase === "joining") return "Connecting";

  if (connectedPeerCount > 0) {
    const otherKnownPeers = Math.max(knownPeerCount - 1, connectedPeerCount);
    return `${connectedPeerCount}/${otherKnownPeers} Connected`;
  }

  if (role === "host" || phase === "hosting") return "Waiting for Peers";
  return "Connection";
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
    if (!qrCode && (canvasMode !== "stage" || Math.abs(stageSize - lastStageSize) > 1)) {
      resizeCanvas(stageSize, stageSize);
      lastStageSize = stageSize;
    }
    canvasMode = "stage";
  } else if (canvasMode !== "window") {
    stageCardEl.style.width = "";
    stageCardEl.style.height = "";
    resizeCanvas(windowWidth, windowHeight);
    canvasMode = "window";
    lastStageSize = 0;
  }
}

async function handleIncomingLink() {
  return onboarding.handleIncomingLink();
}

async function tryJoinViaOnboarder(timeoutMs = 4000) {
  return onboarding.tryJoinViaOnboarder(timeoutMs);
}

async function initializeHostRoom(options = {}) {
  return onboarding.initializeHostRoom(options);
}

function closeAllConnections() {
  for (const entry of connections.values()) {
    clearActiveInviteForEntry(entry, "reset");
    cleanupEntryMqttSignal(entry);
    try {
      entry.dc?.close?.();
    } catch {}
    try {
      entry.pc?.close?.();
    } catch {}
  }
}

function clearActiveInviteForEntry(entry, reason = "cleared") {
  if (!entry || !activeInvite || activeInvite.entryKey !== entry.key) return;
  debugLog("invite_cleared", {
    inviteId: activeInvite.inviteId,
    reason,
    peerId: entry.peerId,
  });
  activeInvite = null;
  shareLink = "";
  qrCode = null;
  updateOnboarderSubscription();
  publishOnboarderPresence().catch(() => {});
}

function cleanupEntryMqttSignal(entry) {
  if (entry?.mqttSignal?.subscribeTopic) {
    unsubscribeMqttTopic(entry.mqttSignal.subscribeTopic);
  }
  entry.mqttSignal = null;
}

function canAdvertiseOnboarder() {
  if (!onboarderEnabled) return false;
  if (!roomId) return false;
  const connectedPeerIds = getConnectedPeerIds();
  return (
    role === "host" ||
    connectedPeerIds.length > 0 ||
    phase === "hosting" ||
    phase === "connected"
  );
}

function installDisconnectHandlers() {
  const handler = () => {
    gracefulDisconnect("page-close");
  };
  window.addEventListener("pagehide", handler);
  window.addEventListener("beforeunload", handler);
}

function gracefulDisconnect(reason = "manual") {
  isShuttingDown = true;
  stopReconnectLoop();
  clearAllMeshReconnects();
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

function stopReconnectLoop() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttemptInFlight = false;
}

function clearMeshReconnect(peerId) {
  if (!meshProtocol) return;
  meshProtocol.clearMeshReconnect(peerId);
}

function clearAllMeshReconnects() {
  if (!meshProtocol) return;
  meshProtocol.clearAllMeshReconnects();
}

function scheduleMeshReconnect(peerId, relayPeerId, shouldInitiate, reason = "mesh-failed", delayMs = MESH_RETRY_DELAY_MS) {
  if (!meshProtocol) return;
  meshProtocol.scheduleMeshReconnect(peerId, relayPeerId, shouldInitiate, reason, delayMs);
}

function shouldAutoReconnect() {
  if (isShuttingDown) return false;
  if (role !== "peer" && role !== "idle") return false;
  if (!onboarderMqttClient?.connected) return false;
  if (activeInvite) return false;
  return getConnectedPeerIds().length === 0;
}

function shouldSelfSeedNetwork() {
  if (isShuttingDown) return false;
  if (!onboarderEnabled) return false;
  if (role !== "idle") return false;
  if (activeInvite) return false;
  return getConnectedPeerIds().length === 0;
}

function scheduleReconnectAttempt(reason = "lost-peers", delayMs = RECONNECT_INITIAL_DELAY_MS) {
  if (!shouldAutoReconnect()) return;
  if (reconnectTimer || reconnectAttemptInFlight) return;

  phase = "reconnecting";
  statusText = "Connecting...";
  debugLog("reconnect_scheduled", { reason, delayMs });
  renderUi();

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!shouldAutoReconnect()) return;

    reconnectAttemptInFlight = true;
    clearDiscoveredOnboarders();
    phase = "reconnecting";
    statusText = "Connecting...";
    debugLog("reconnect_attempt", { reason });
    renderUi();

    try {
      const joined = await tryJoinViaOnboarder(RECONNECT_RETRY_DELAY_MS);
      if (joined) {
        stopReconnectLoop();
        debugLog("reconnect_success", { reason });
        return;
      }
      if (shouldSelfSeedNetwork()) {
        stopReconnectLoop();
        debugLog("network_seed_start", { reason });
        await initializeHostRoom();
        debugLog("network_seed_ready", { roomId });
        return;
      }
    } catch (error) {
      debugLog("reconnect_error", { reason, msg: String(error?.message || error) });
    } finally {
      reconnectAttemptInFlight = false;
    }

    if (shouldAutoReconnect()) {
      statusText = "Connecting...";
      renderUi();
      scheduleReconnectAttempt("retry", RECONNECT_RETRY_DELAY_MS);
    }
  }, delayMs);
}

function useQrMode() {
  statusText = "Preparing QR invite...";
  renderUi();
  initializeHostRoom({ forceManualInvite: true }).catch((error) => {
    debugLog("manual_qr_error", { msg: String(error?.message || error) });
    statusText = `QR error: ${error?.message || error}`;
    renderUi();
  });
}

function clearInviteView() {
  return onboarding.clearInviteView();
}

async function createHostInvite(options = {}) {
  return onboarding.createHostInvite(options);
}

async function startAsJoinerFromLink(linkValue, room, inviteId, hostId, options = {}) {
  return onboarding.startAsJoinerFromLink(linkValue, room, inviteId, hostId, options);
}

async function startAsJoinerViaMqtt(response) {
  return onboarding.startAsJoinerViaMqtt(response);
}

async function applyPastedResponseLink() {
  return onboarding.applyPastedResponseLink();
}

function initLocalResponseRelay() {
  return onboarding.initLocalResponseRelay();
}

function forwardResponseToLocalInviter(payload) {
  return onboarding.forwardResponseToLocalInviter(payload);
}

async function handleLocalResponseSignal(data) {
  return onboarding.handleLocalResponseSignal(data);
}

async function applyInviteResponse(inviteId, responseValue) {
  return onboarding.applyInviteResponse(inviteId, responseValue);
}

function createConnectionEntry({ key, peerId, kind, initiator }) {
  return meshProtocol.createConnectionEntry({ key, peerId, kind, initiator });
}

function wireDataChannel(entry, channel) {
  return meshProtocol.wireDataChannel(entry, channel);
}

function sendHelloToHost() {
  return meshProtocol.sendHelloToHost();
}

function handleChannelMessage(entry, raw) {
  return meshProtocol.handleChannelMessage(entry, raw);
}

function handlePeerLeaving(entry, message) {
  return meshProtocol.handlePeerLeaving(entry, message);
}

function removePeer(peerId, reason = "left") {
  return meshProtocol.removePeer(peerId, reason);
}

function finalizeBootstrapPeer(entry, message) {
  return meshProtocol.finalizeBootstrapPeer(entry, message);
}

function handleRoomPeers(peerIds, relayPeerId = hostPeerId) {
  return meshProtocol.handleRoomPeers(peerIds, relayPeerId);
}

function maybeStartMeshConnection(peerId, relayPeerId = hostPeerId, shouldInitiate = null) {
  return meshProtocol.maybeStartMeshConnection(peerId, relayPeerId, shouldInitiate);
}

async function startMeshOffer(entry) {
  return meshProtocol.startMeshOffer(entry);
}

function sendRelayToPeer(targetPeerId, signal, relayPeerId = hostPeerId) {
  return meshProtocol.sendRelayToPeer(targetPeerId, signal, relayPeerId);
}

function forwardRelaySignal(fromEntry, message) {
  return meshProtocol.forwardRelaySignal(fromEntry, message);
}

async function handleRelayedSignal(message) {
  return meshProtocol.handleRelayedSignal(message);
}

function sendMessage() {
  const text = String(composerInputEl.value || "").trim();
  if (!text) return;

  const msg = {
    type: "chat",
    id: makeMessageId(),
    from: SELF_PEER_ID,
    fromName: SELF_PROFILE.displayName,
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
  return helpers.sendJson(channel, value);
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
  if (!view) return;
  view.renderMessages(chatMessages, {
    getPeerProfile: (authorId) => getPeerProfile(authorId || SELF_PEER_ID),
    getPeerInitial,
    onRendered: keepChatVisible,
  });
}

function formatPeerList(peerIds) {
  return helpers.formatPeerList(peerIds);
}

function getPeerInitial(name) {
  return helpers.getPeerInitial(name);
}

function getPeerProfile(peerId) {
  return helpers.getPeerProfile(peerId);
}

function waitForIceReady(entry, timeoutMs = 1800, minCandidates = 2) {
  return meshProtocol.waitForIceReady(entry, timeoutMs, minCandidates);
}

function createSignalBundle(type, sdp, candidates) {
  return bundleCodec.createSignalBundle(type, sdp, candidates);
}

function buildSdpFromBundle(bundle) {
  return bundleCodec.buildSdpFromBundle(bundle);
}

function toBundleString(bundle) {
  return bundleCodec.toBundleString(bundle);
}

function fromBundleString(value) {
  return bundleCodec.fromBundleString(value);
}

function buildInviteLink(bundleString, room, inviteId, hostId) {
  return bundleCodec.buildInviteLink(bundleString, room, inviteId, hostId);
}

function buildResponseLink(bundleString, room, inviteId, hostId) {
  return bundleCodec.buildResponseLink(bundleString, room, inviteId, hostId);
}

function tryCreateQrCode(value) {
  return bundleCodec.tryCreateQrCode(value);
}

function extractBundleFromPossibleUrl(raw, paramName) {
  return bundleCodec.extractBundleFromPossibleUrl(raw, paramName);
}

function extractResponseValue(raw) {
  return bundleCodec.extractResponseValue(raw);
}

function resetRoom() {
  clearIncomingParams();
  initializeHostRoom();
}

function clearIncomingParams() {
  return bundleCodec.clearIncomingParams();
}

function copyShareLink() {
  return onboarding.copyShareLink();
}

function advanceInviteFlow(fromCopy = false) {
  return onboarding.advanceInviteFlow(fromCopy);
}

function logBundle(label, payload, bundle) {
  return bundleCodec.logBundle(label, payload, bundle);
}

function logParsedBundle(label, payload, bundle) {
  return bundleCodec.logParsedBundle(label, payload, bundle);
}

function makeInviteId() {
  return helpers.makeInviteId();
}

function makeMessageId() {
  return helpers.makeMessageId();
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
  debugBus = await window.RtcChatV3DebugBus.createDebugBus({
    PortalMqtt,
    broker: MQTT_BROKER,
    topic: DEBUG_TOPIC,
    clientId: `${SELF_PEER_ID}-debug`,
    contextProvider: () => ({
      self: SELF_PEER_ID,
      role,
      network: NETWORK_NAME,
      room: roomId || DEFAULT_ROOM_NAME,
    }),
  });
  await debugBus.init();
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
    await subscribeMqttTopic(ONBOARDER_DISCOVERY_TOPIC, handleOnboarderPresenceMessage);
    await subscribeMqttTopic(onboarderReplyTopic, (result) => {
      let payload;
      try {
        payload = JSON.parse(result.message);
      } catch {
        return;
      }
      const waiter = onboarderWaiters.get(payload.requestId);
      if (waiter) waiter(payload);
    });
    await subscribeMqttTopic(onboarderResponseTopic, handleOnboarderResponseMessage);
    await updateOnboarderSubscription();
  } catch (error) {
    console.warn("[rtcchat_v3] onboarder mqtt unavailable", error);
  }
}

function handleOnboarderMqttMessage(result) {
  const topicHandler = mqttTopicHandlers.get(result?.topic);
  if (topicHandler) {
    topicHandler(result);
    return;
  }
  if (result?.topic === onboarderRequestTopic) {
    if (onboarderEnabled) {
      answerOnboarderRequest(result).catch((error) => {
        console.error("[rtcchat_v3] onboarder request error", error);
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
}

function handleOnboarderPresenceMessage(result) {
  if (!result?.message) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }
  if (role !== "idle" && phase !== "reconnecting") return;
  if (!payload?.peerId || payload.peerId === SELF_PEER_ID) return;
  discoveredOnboarders.set(payload.peerId, {
    ...payload,
    seenAt: Date.now(),
  });
  debugLog("onboarder_presence_seen", {
    onboarderId: payload.peerId,
    available: payload.available,
    roomId: payload.roomId,
  });
}

function clearDiscoveredOnboarders() {
  if (discoveredOnboarders.size === 0) return;
  discoveredOnboarders.clear();
  debugLog("onboarder_presence_cleared");
}

async function subscribeMqttTopic(topic, handler) {
  if (!topic || !onboarderMqttClient?.connected) return;
  mqttTopicHandlers.set(topic, handler);
  await onboarderMqttClient.subscribe(topic);
  debugLog("mqtt_topic_sub", { topic });
}

async function unsubscribeMqttTopic(topic) {
  if (!topic || !onboarderMqttClient?.connected) return;
  mqttTopicHandlers.delete(topic);
  try {
    await onboarderMqttClient.unsubscribe(topic);
    debugLog("mqtt_topic_unsub", { topic });
  } catch {}
}

function handleOnboarderResponseMessage(result) {
  if (!result?.message) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }
  if (payload?.type !== "rtcchat-v3-onboarder-response") return;
  applyInviteResponse(payload.inviteId, payload.responseValue).catch((error) => {
    console.error("[rtcchat_v3] onboarder response error", error);
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
  const shouldServe = canAdvertiseOnboarder();
  try {
    if (shouldServe) {
      await onboarderMqttClient.subscribe(onboarderRequestTopic);
      startOnboarderPresence();
      await publishOnboarderPresence();
      debugLog("onboarder_service_online", { topic: onboarderRequestTopic });
    } else {
      stopOnboarderPresence();
      await onboarderMqttClient.unsubscribe(onboarderRequestTopic);
      debugLog("onboarder_service_offline", { topic: onboarderRequestTopic });
    }
  } catch (error) {
    console.warn("[rtcchat_v3] onboarder subscription update failed", error);
  }
}

function toggleOnboarderMode() {
  onboarderEnabled = !onboarderEnabled;
  APP_MODEL.toggles.onboarderEnabled = onboarderEnabled;
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
  if (onboarderEnabled && role === "idle" && getConnectedPeerIds().length === 0 && !activeInvite) {
    scheduleReconnectAttempt("onboarder-enabled", 0);
  }
}

function startOnboarderPresence() {
  if (!canAdvertiseOnboarder()) return;
  stopOnboarderPresence();
  onboarderPresenceTimer = setInterval(() => {
    publishOnboarderPresence().catch(() => {});
  }, 3000);
}

function stopOnboarderPresence() {
  if (onboarderPresenceTimer) {
    clearInterval(onboarderPresenceTimer);
    onboarderPresenceTimer = null;
  }
}

async function publishOnboarderPresence() {
  if (!canAdvertiseOnboarder()) return;
  if (!onboarderMqttClient?.connected) return;
  const available = !(activeInvite && !shareLink);
  const payload = {
    type: "onboarder-presence",
    peerId: SELF_PEER_ID,
    network: NETWORK_NAME,
    roomId,
    available,
    requestTopic: onboarderRequestTopic,
    ts: Date.now(),
  };
  await onboarderMqttClient.publish(ONBOARDER_DISCOVERY_TOPIC, JSON.stringify(payload));
  debugLog("onboarder_presence_pub", { available, roomId, topic: onboarderRequestTopic });
}

function pruneOnboarders() {
  const now = Date.now();
  for (const [peerId, info] of discoveredOnboarders.entries()) {
    if (now - (info.seenAt || 0) > 10000) {
      discoveredOnboarders.delete(peerId);
    }
  }
}

function getAvailableOnboarders() {
  pruneOnboarders();
  return [...discoveredOnboarders.values()].filter((info) => info.available && info.requestTopic);
}

async function waitForAvailableOnboarder(timeoutMs = 2500) {
  const immediate = getAvailableOnboarders()[0];
  if (immediate) return immediate;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const candidate = getAvailableOnboarders()[0];
    if (candidate) return candidate;
  }
  return null;
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

  if (activeInvite && activeInvite.mqttOnly && activeInvite.offerSdp) {
    await publishOnboarderReply(replyTopic, requestId, {
      available: true,
      roomId,
      inviteId: activeInvite.inviteId,
      hostId: SELF_PEER_ID,
      responseTopic: onboarderResponseTopic,
      offerSdp: activeInvite.offerSdp,
      candidates: activeInvite.initialCandidates || [],
      peerSignalTopic: activeInvite.peerSignalTopic,
      hostSignalTopic: activeInvite.hostSignalTopic,
    });
    return;
  }

  statusText = "Preparing onboarder invite...";
  renderUi();
  const mqttInvite = await createMqttOnboarderInvite();

  if (!mqttInvite) {
    await publishOnboarderReply(replyTopic, requestId, {
      available: false,
      reason: "invite-unavailable",
      roomId,
    });
    return;
  }

  await publishOnboarderReply(replyTopic, requestId, {
    available: true,
    roomId,
    inviteId: mqttInvite.inviteId,
    hostId: SELF_PEER_ID,
    responseTopic: onboarderResponseTopic,
    offerSdp: mqttInvite.offerSdp,
    candidates: mqttInvite.initialCandidates,
    peerSignalTopic: mqttInvite.peerSignalTopic,
    hostSignalTopic: mqttInvite.hostSignalTopic,
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
    mode: extra.offerSdp ? "mqtt" : extra.link ? "link" : undefined,
  });
}

async function createMqttOnboarderInvite() {
  if (role !== "host" && role !== "peer") return null;
  if (activeInvite?.entryKey) {
    const stale = connections.get(activeInvite.entryKey);
    if (stale && !stale.connectedIdentity) {
      clearActiveInviteForEntry(stale, "replaced");
      cleanupEntryMqttSignal(stale);
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
  const hostSignalTopic = `${MQTT_TOPIC_PREFIX}/signal/${inviteId}/host`;
  const peerSignalTopic = `${MQTT_TOPIC_PREFIX}/signal/${inviteId}/peer`;

  const entry = createConnectionEntry({
    key: entryKey,
    peerId: entryKey,
    kind: "bootstrap",
    initiator: true,
  });
  entry.inviteId = inviteId;
  entry.mqttSignal = {
    role: "host",
    publishTopic: peerSignalTopic,
    subscribeTopic: hostSignalTopic,
  };
  entry.dc = entry.pc.createDataChannel("rtchat-room");
  wireDataChannel(entry, entry.dc);
  connections.set(entryKey, entry);
  activeInvite = {
    inviteId,
    entryKey,
    mqttOnly: true,
    hostSignalTopic,
    peerSignalTopic,
  };
  publishOnboarderPresence().catch(() => {});

  await subscribeMqttTopic(hostSignalTopic, (result) => handleInviteMqttSignal(entry, result));
  debugLog("mqtt_invite_topics_ready", {
    inviteId,
    hostTopic: hostSignalTopic,
    peerTopic: peerSignalTopic,
  });

  try {
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    await waitForInitialCandidates(entry, 350, 1);

    activeInvite.offerSdp = entry.pc.localDescription.sdp;
    activeInvite.initialCandidates = entry.localCandidateInits.slice();

    debugLog("invite_ready", {
      inviteId,
      roomId,
      role,
      mode: "mqtt",
      cand: activeInvite.initialCandidates.length,
      sdpLen: activeInvite.offerSdp.length,
    });

    return {
      inviteId,
      offerSdp: activeInvite.offerSdp,
      initialCandidates: activeInvite.initialCandidates,
      hostSignalTopic,
      peerSignalTopic,
    };
  } catch (error) {
    console.error("[rtcchat_v3] mqtt invite error", error);
    debugLog("invite_error", { mode: "mqtt", msg: String(error?.message || error) });
    cleanupEntryMqttSignal(entry);
    connections.delete(entryKey);
    activeInvite = null;
    return null;
  }
}

function handleInviteMqttSignal(entry, result) {
  if (!result?.message || !entry) return;
  let payload;
  try {
    payload = JSON.parse(result.message);
  } catch {
    return;
  }
  debugLog("mqtt_signal_recv", {
    inviteId: payload.inviteId || entry.inviteId,
    sig: payload.type,
    topic: result.topic,
    from: payload.fromPeerId,
    cand: payload.candidates?.length,
    hasSdp: !!payload.sdp,
  });

  if (payload.type === "answer" && entry.initiator) {
    applyMqttAnswerToEntry(entry, payload).catch((error) => {
      console.error("[rtcchat_v3] mqtt answer error", error);
      debugLog("response_relay_error", {
        inviteId: payload.inviteId,
        mode: "mqtt",
        msg: String(error?.message || error),
      });
    });
    return;
  }

  if (payload.type === "candidate") {
    addRemoteCandidateToEntry(entry, payload.candidate).catch(() => {});
  }
}

async function applyMqttAnswerToEntry(entry, payload) {
  if (!payload?.sdp) return;
  if (entry.pc.signalingState === "stable") return;
  debugLog("mqtt_answer_apply_start", {
    inviteId: payload.inviteId,
    from: payload.fromPeerId,
    cand: payload.candidates?.length || 0,
    sdpLen: payload.sdp.length,
  });
  await entry.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
  await flushPendingRemoteCandidates(entry);
  await addInitialMqttCandidates(entry, payload.candidates || []);

  shareLink = "";
  qrCode = null;
  phase = "joining";
  statusText = "Response accepted. Waiting for peer hello...";
  debugLog("response_applied", {
    inviteId: payload.inviteId,
    peerId: entry.peerId,
    mode: "mqtt",
    cand: entry.remoteCandidatesAdded,
  });
  renderUi();
}

function candidateToInit(candidate) {
  return helpers.candidateToInit(candidate);
}

async function addInitialMqttCandidates(entry, candidates) {
  if (candidates?.length) {
    debugLog("mqtt_initial_candidates", {
      inviteId: entry.inviteId,
      peerId: entry.peerId,
      count: candidates.length,
    });
  }
  for (const candidate of candidates || []) {
    await addRemoteCandidateToEntry(entry, candidate);
  }
}

async function addRemoteCandidateToEntry(entry, candidate) {
  if (!entry || !candidate?.candidate) return;
  const key = JSON.stringify(candidate);
  if (entry.seenRemoteCandidateKeys.has(key)) return;
  entry.seenRemoteCandidateKeys.add(key);

  if (!entry.pc.remoteDescription) {
    entry.pendingRemoteCandidates.push(candidate);
    debugLog("mqtt_candidate_queued", {
      inviteId: entry.inviteId,
      peerId: entry.peerId,
      pending: entry.pendingRemoteCandidates.length,
    });
    return;
  }

  await entry.pc.addIceCandidate(candidate);
  entry.remoteCandidatesAdded += 1;
  debugLog("mqtt_candidate_applied", {
    inviteId: entry.inviteId,
    peerId: entry.peerId,
    total: entry.remoteCandidatesAdded,
  });
}

async function flushPendingRemoteCandidates(entry) {
  if (!entry?.pc.remoteDescription || !entry.pendingRemoteCandidates.length) return;
  const pending = entry.pendingRemoteCandidates.splice(0);
  debugLog("mqtt_candidate_flush", {
    inviteId: entry.inviteId,
    peerId: entry.peerId,
    count: pending.length,
  });
  for (const candidate of pending) {
    await entry.pc.addIceCandidate(candidate);
    entry.remoteCandidatesAdded += 1;
  }
}

function waitForInitialCandidates(entry, timeoutMs = 350, minCandidates = 1) {
  return new Promise((resolve) => {
    if (entry.localCandidateInits.length >= minCandidates) {
      resolve();
      return;
    }
    setTimeout(resolve, timeoutMs);
  });
}

function debugLog(event, details = {}) {
  if (!debugBus) return;
  debugBus.publish(event, details);
}

window.RtcChatV3App = {
  setup: appSetup,
  draw: appDraw,
  windowResized: appWindowResized,
};
