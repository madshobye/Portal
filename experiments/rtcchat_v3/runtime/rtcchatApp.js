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
let globalChat = null;
let viewport = null;
let onboarderService = null;
let onboarding = null;

async function appSetup() {
  if (!window.RtcChatV3DebugBus || !window.RtcChatV3DomUi || !window.RtcChatV3View ||
    !window.RtcChatV3Viewport || !window.RtcChatV3GlobalChat || !window.RtcChatV3Helpers ||
    !window.RtcChatV3BundleCodec || !window.RtcChatV3MeshProtocol || !window.RtcChatV3OnboarderService ||
    !window.RtcChatV3Onboarding || !window.RtcChatV3MqttClient || !window.RtcChatV3Qr) {
    throw new Error("rtcchat_v3 dependencies are missing from index.html");
  }

  helpers = window.RtcChatV3Helpers.createHelpers({
    selfPeerId: SELF_PEER_ID,
    identity: window.RtcChatV3Identity,
  });
  bundleCodec = window.RtcChatV3BundleCodec;
  globalChat = window.RtcChatV3GlobalChat.createGlobalChatRuntime({
    SELF_PEER_ID,
    SELF_PROFILE,
    getState: () => ({
      connections,
      composerInputEl,
      setStatusText: (text) => { statusText = text; },
    }),
    renderMessages,
    renderUi,
    debugLog,
    makeMessageId,
    sendJson,
  });
  viewport = window.RtcChatV3Viewport.createViewportRuntime({
    getMessagesEl: () => messagesEl,
    onLayout: syncStageLayout,
  });

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

  onboarderService = window.RtcChatV3OnboarderService.createOnboarderService({
    SELF_PEER_ID,
    NETWORK_NAME,
    MQTT_TOPIC_PREFIX,
    ONBOARDER_DISCOVERY_TOPIC,
    MQTT_BROKER,
    getState: () => ({
      role,
      phase,
      roomId,
      hostPeerId,
      activeInvite,
      shareLink,
      qrCode,
      connections,
      onboarderMqttClient,
      onboarderReplyTopic,
      onboarderResponseTopic,
      onboarderRequestTopic,
      onboarderWaiters,
      discoveredOnboarders,
      mqttTopicHandlers,
      onboarderEnabled,
      onboarderPresenceTimer,
      applyInviteResponse,
      persistOnboarderEnabled: (value) => {
        APP_MODEL.toggles.onboarderEnabled = value;
        localStorage.setItem(ONBOARDER_ENABLED_KEY, value ? "1" : "0");
      },
    }),
    setState: (patch) => {
      if (Object.prototype.hasOwnProperty.call(patch, "statusText")) statusText = patch.statusText;
      if (Object.prototype.hasOwnProperty.call(patch, "phase")) phase = patch.phase;
      if (Object.prototype.hasOwnProperty.call(patch, "activeInvite")) activeInvite = patch.activeInvite;
      if (Object.prototype.hasOwnProperty.call(patch, "shareLink")) shareLink = patch.shareLink;
      if (Object.prototype.hasOwnProperty.call(patch, "qrCode")) qrCode = patch.qrCode;
      if (Object.prototype.hasOwnProperty.call(patch, "onboarderMqttClient")) onboarderMqttClient = patch.onboarderMqttClient;
      if (Object.prototype.hasOwnProperty.call(patch, "onboarderEnabled")) onboarderEnabled = patch.onboarderEnabled;
      if (Object.prototype.hasOwnProperty.call(patch, "onboarderPresenceTimer")) onboarderPresenceTimer = patch.onboarderPresenceTimer;
    },
    debugLog,
    renderUi,
    scheduleReconnectAttempt,
    clearInviteView,
    createConnectionEntry,
    wireDataChannel,
    cleanupEntryMqttSignal,
    clearActiveInviteForEntry,
    waitForInitialCandidatesRef: waitForInitialCandidates,
    subscribeMqttTopic,
    waitForIceReady,
    getConnectedPeerIds,
    makeInviteId,
    canAdvertiseOnboarder,
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
  buildUi();
  installViewportTracking();
  renderMessages();
  renderUi();
  await initDebugMqtt();
  await initOnboarderMqtt();
  installDisconnectHandlers();
  await handleIncomingLink();
}

function appDraw() {
  return;
}

function appWindowResized() {
  updateViewportHeight();
  syncStageLayout();
}

function buildUi() {
  view = window.RtcChatV3View.createRtcChatView({
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
    showQrImage: hasRoomUi,
    qrImageSrc,
    actions,
  });

  syncStageLayout();
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

function syncStageLayout() {
  if (!stageCardEl) return;
  const stageMode = !!shareLink;

  if (stageMode) {
    const rect = stageCardEl.getBoundingClientRect();
    const availableHeight = window.innerHeight - rect.top - 12;
    const panelWidth = stageEl?.getBoundingClientRect?.().width || rect.width;
    const stageSize = Math.max(1, Math.round(Math.min(panelWidth, availableHeight, 560)));
    stageCardEl.style.width = `${stageSize}px`;
    stageCardEl.style.height = `${stageSize}px`;
  } else {
    stageCardEl.style.width = "";
    stageCardEl.style.height = "";
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
  return globalChat.sendMessage();
}

function handleIncomingChat(message) {
  return globalChat.handleIncomingChat(message);
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
  return globalChat.addSystemMessage(text);
}

function addChatMessage(type, text, authorId = SELF_PEER_ID) {
  return globalChat.addChatMessage(type, text, authorId);
}

function renderMessages() {
  if (!view) return;
  view.renderMessages(globalChat.getMessages(), {
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
  return viewport.installViewportTracking();
}

function handleViewportChange() {
  return viewport.handleViewportChange();
}

function updateViewportHeight() {
  return viewport.updateViewportHeight();
}

function keepChatVisible() {
  return viewport.keepChatVisible();
}

function requestViewportRefresh() {
  return viewport.requestViewportRefresh();
}

async function initDebugMqtt() {
  debugBus = await window.RtcChatV3DebugBus.createDebugBus({
    MqttClient: window.RtcChatV3MqttClient,
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
  return onboarderService.initOnboarderMqtt();
}

function handleOnboarderMqttMessage(result) {
  return onboarderService.handleOnboarderMqttMessage(result);
}

function handleOnboarderPresenceMessage(result) {
  return onboarderService.handleOnboarderPresenceMessage(result);
}

function clearDiscoveredOnboarders() {
  return onboarderService.clearDiscoveredOnboarders();
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
  return onboarderService.handleOnboarderResponseMessage(result);
}

async function updateOnboarderSubscription() {
  return onboarderService.updateOnboarderSubscription();
}

function toggleOnboarderMode() {
  return onboarderService.toggleOnboarderMode();
}

function startOnboarderPresence() {
  return onboarderService.startOnboarderPresence();
}

function stopOnboarderPresence() {
  return onboarderService.stopOnboarderPresence();
}

async function publishOnboarderPresence() {
  return onboarderService.publishOnboarderPresence();
}

function pruneOnboarders() {
  return onboarderService.pruneOnboarders();
}

function getAvailableOnboarders() {
  return onboarderService.getAvailableOnboarders();
}

async function waitForAvailableOnboarder(timeoutMs = 2500) {
  return onboarderService.waitForAvailableOnboarder(timeoutMs);
}

async function answerOnboarderRequest(result) {
  return onboarderService.answerOnboarderRequest(result);
}

async function publishOnboarderReply(replyTopic, requestId, extra = {}) {
  return onboarderService.publishOnboarderReply(replyTopic, requestId, extra);
}

async function createMqttOnboarderInvite() {
  return onboarderService.createMqttOnboarderInvite();
}

function handleInviteMqttSignal(entry, result) {
  return onboarderService.handleInviteMqttSignal(entry, result);
}

async function applyMqttAnswerToEntry(entry, payload) {
  return onboarderService.applyMqttAnswerToEntry(entry, payload);
}

function candidateToInit(candidate) {
  return helpers.candidateToInit(candidate);
}

async function addInitialMqttCandidates(entry, candidates) {
  return onboarderService.addInitialMqttCandidates(entry, candidates);
}

async function addRemoteCandidateToEntry(entry, candidate) {
  return onboarderService.addRemoteCandidateToEntry(entry, candidate);
}

async function flushPendingRemoteCandidates(entry) {
  return onboarderService.flushPendingRemoteCandidates(entry);
}

function waitForInitialCandidates(entry, timeoutMs = 350, minCandidates = 1) {
  return onboarderService.waitForInitialCandidates(entry, timeoutMs, minCandidates);
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
