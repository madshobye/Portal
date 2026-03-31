let pc = null;
let dc = null;

let role = "idle";
let phase = "idle";
let statusText = "Press Connect on one device. Open that link on the other device.";
let localCandidates = [];
let remoteCandidatesAdded = 0;

let qrValue = "";
let qrCode = null;
let shareLink = "";

let appEl;
let panelEl;
let statusCardEl;
let titleEl;
let statusTextEl;
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
const STARTER_SESSION_KEY = "rtcchat-starter-session";
const ANSWER_SIGNAL_KEY = "rtcchat-answer-signal";
const LOCAL_SIGNAL_CHANNEL = "rtcchat-local-answer";
let localSignalChannel = null;
let currentStarterSessionId = "";
let appliedAnswerSignature = "";
let autoReconnectTimer = null;
const AUTO_RECONNECT_DELAY_MS = 30000;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvasEl = canvas.elt;
  textFont("monospace");
  textSize(16);

  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");
  await loadScript("portal/qrCodeGen.js");

  initLocalAnswerRelay();
  buildUi(canvas);
  installViewportTracking();
  renderUi();
  await handleIncomingLink();
}

function draw() {
  background("#0b0b0d");

  if (phase === "show-offer" || phase === "show-answer") {
    drawQrScreen();
  } else if (phase === "connected" || phase === "connecting") {
    drawConnectedBackdrop();
  } else {
    drawIdleScreen();
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
  linkCloseBtnEl.addEventListener("click", resetConnection);
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
  composerInputEl.placeholder = "Type a message…";
  composerInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
  });
  composerInputEl.addEventListener("focus", () => {
    setTimeout(() => {
      keepChatVisible();
    }, 60);
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

  statusTextEl.textContent = `${statusText}  Role: ${role}  ICE: ${localCandidates.length}/${remoteCandidatesAdded}`;

  const qrMode = phase === "show-offer" || phase === "show-answer";
  const stageMode = qrMode;
  const showLink = phase === "show-offer" || phase === "show-answer";
  const showResponsePaste = phase === "awaiting-answer";
  const connected = phase === "connected";

  panelEl.classList.toggle("qr-mode", qrMode);
  statusCardEl.classList.toggle("qr-mode", qrMode);
  titleEl.classList.toggle("qr-mode", qrMode);
  statusTextEl.classList.toggle("qr-mode", qrMode);
  actionsEl.classList.toggle("qr-mode", qrMode);
  stageEl.classList.toggle("active", stageMode);
  linkCardEl.style.display = showLink ? "flex" : "none";
  responsePasteCardEl.style.display = showResponsePaste ? "flex" : "none";
  linkTopRowEl.style.display = showLink ? "flex" : "none";
  linkTitleEl.style.display = "none";
  linkAnchorEl.style.display = "none";

  linkTextEl.value = shareLink || "";
  linkAnchorEl.href = shareLink || "#";
  linkCopyBtnEl.disabled = !shareLink;
  chatCardEl.style.display = connected ? "flex" : "none";
  composerInputEl.disabled = !connected;
  sendBtnEl.disabled = !connected;
  if (canvasEl) {
    canvasEl.style.display = stageMode ? "block" : "none";
  }

  actionsEl.innerHTML = "";

  if (phase === "idle") {
    appendAction("Connect", startAsStarter);
  } else if (phase === "forwarded") {
  } else if (phase === "failed") {
    appendAction("Reconnect Now", reconnectNow);
    appendAction("Reset", resetConnection, true);
  } else if (phase === "show-offer") {
  } else if (phase === "show-answer") {
  } else if (phase === "awaiting-answer" || phase === "waiting-peer") {
    appendAction("Reset", resetConnection, true);
  } else if (phase === "connecting") {
    appendAction("Reset", resetConnection, true);
  } else if (phase === "connected") {
    appendAction("Reset", resetConnection, true);
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

function drawIdleScreen() {
  clear();
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
  const stageMode = phase === "show-offer" || phase === "show-answer";

  if (stageMode) {
    const rect = stageCardEl.getBoundingClientRect();
    const availableHeight = window.innerHeight - rect.top - 12;
    const panelWidth = stageEl?.getBoundingClientRect?.().width || rect.width;
    const stageSize = Math.max(
      1,
      Math.round(Math.min(panelWidth, availableHeight, 560))
    );
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

function resetConnection() {
  clearAutoReconnect();
  try {
    dc?.close?.();
  } catch {}
  try {
    pc?.close?.();
  } catch {}

  pc = null;
  dc = null;
  role = "idle";
  phase = "idle";
  statusText = "Press Connect on one device. Open that link on the other device.";
  localCandidates = [];
  remoteCandidatesAdded = 0;
  qrValue = "";
  qrCode = null;
  shareLink = "";
  chatMessages = [];
  currentStarterSessionId = "";
  appliedAnswerSignature = "";
  clearStarterSession();
  renderMessages();
  clearIncomingParams();
  renderUi();
}

async function startAsStarter() {
  if (pc) return;

  clearAutoReconnect();
  role = "starter";
  phase = "connecting";
  statusText = "Creating offer link...";
  renderUi();

  newPeerConnection();
  wireDataChannel(pc.createDataChannel("rtcchat"));

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceReady(pc);

    currentStarterSessionId = makeStarterSessionId();
    const bundle = createQrBundle("OB", pc.localDescription.sdp, localCandidates);
    qrValue = toBundleString(bundle);
    shareLink = buildShareLink("connect", qrValue, currentStarterSessionId);
    saveStarterSession({
      sessionId: currentStarterSessionId,
    });
    rebuildDisplayedQr();
    logBundle("COPY OFFER", qrValue, bundle);

    phase = "show-offer";
    statusText = "Offer ready.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] starter error", error);
    statusText = `Starter error: ${error?.message || error}`;
    renderUi();
  }
}

async function handleIncomingLink() {
  const params = new URLSearchParams(window.location.search);
  const connectValue = params.get("connect");
  const responseValue = params.get("response");
  const sessionId = params.get("sid");

  if (connectValue) {
    await startAsJoinerFromLink(connectValue, sessionId);
    return;
  }

  if (responseValue && sessionId) {
    await forwardResponseLinkToStarter(responseValue, sessionId);
  }
}

async function startAsJoinerFromLink(linkValue, sessionId) {
  if (pc) return;
  role = "joiner";
  phase = "connecting";
  statusText = "Applying connect link and building response link...";
  renderUi();

  newPeerConnection();

  try {
    const bundle = fromBundleString(linkValue);
    logParsedBundle("PASTED OFFER", linkValue, bundle);

    await pc.setRemoteDescription({ type: "offer", sdp: buildSdpFromBundle(bundle) });
    for (const candidate of bundle.c) {
      await pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      remoteCandidatesAdded += 1;
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceReady(pc);

    const answerBundle = createQrBundle("AB", pc.localDescription.sdp, localCandidates);
    qrValue = toBundleString(answerBundle);
    shareLink = buildShareLink("response", qrValue, sessionId);
    rebuildDisplayedQr();
    logBundle("COPY ANSWER", qrValue, answerBundle);

    phase = "show-answer";
    statusText = "Response link ready. Send it back to the original Connect tab.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] connect link error", error);
    statusText = `Connect link error: ${error?.message || error}`;
    renderUi();
  }
}

function copyShareLink() {
  if (!shareLink) return;
  navigator.clipboard?.writeText?.(shareLink).catch(() => {});
  if (phase === "show-offer") {
    phase = "awaiting-answer";
    statusText = "Awaiting connection...";
  } else if (phase === "show-answer") {
    phase = "waiting-peer";
    statusText = "Response copied. Open it on the original device/browser.";
  } else {
    statusText = "Link copied.";
  }
  renderUi();
}

async function reconnectNow() {
  clearAutoReconnect();

  if (role !== "starter") {
    resetConnection();
    return;
  }

  try {
    dc?.close?.();
  } catch {}
  try {
    pc?.close?.();
  } catch {}

  pc = null;
  dc = null;
  localCandidates = [];
  remoteCandidatesAdded = 0;
  qrValue = "";
  qrCode = null;
  shareLink = "";
  appliedAnswerSignature = "";
  currentStarterSessionId = "";

  phase = "connecting";
  statusText = "Reconnecting...";
  renderUi();
  await startAsStarter();
}

function scheduleAutoReconnect() {
  clearAutoReconnect();
  if (role !== "starter") return;

  autoReconnectTimer = setTimeout(() => {
    autoReconnectTimer = null;
    if (role === "starter" && phase === "failed") {
      reconnectNow();
    }
  }, AUTO_RECONNECT_DELAY_MS);
}

function clearAutoReconnect() {
  if (autoReconnectTimer) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
}

async function applyPastedResponseLink() {
  const raw = String(responsePasteInputEl?.value || "").trim();
  if (!raw) {
    statusText = "Paste a response link first.";
    renderUi();
    return;
  }

  const sessionId = currentStarterSessionId || loadStarterSession()?.sessionId || "";
  if (!sessionId) {
    statusText = "No pending starter session found.";
    renderUi();
    return;
  }

  const responseValue = extractBundleFromPossibleUrl(raw, "response");
  await handleLocalAnswerSignal({
    type: "rtc-answer",
    sessionId,
    responseValue,
    sentAt: Date.now(),
  });
}

function saveStarterSession(session) {
  try {
    localStorage.setItem(
      STARTER_SESSION_KEY,
      JSON.stringify({
        ...session,
        savedAt: Date.now(),
      })
    );
  } catch {}
}

function clearStarterSession() {
  try {
    localStorage.removeItem(STARTER_SESSION_KEY);
  } catch {}
}

function loadStarterSession() {
  try {
    const raw = localStorage.getItem(STARTER_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sendMessage() {
  const text = String(composerInputEl.value || "").trim();
  if (!text || !dc || dc.readyState !== "open") return;
  dc.send(text);
  addChatMessage("self", text);
  composerInputEl.value = "";
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

function newPeerConnection() {
  localCandidates = [];
  remoteCandidatesAdded = 0;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.onicecandidate = (event) => {
    if (event.candidate?.candidate) {
      localCandidates.push(event.candidate.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState || "unknown";
    if (state === "connected") {
      clearAutoReconnect();
      phase = "connected";
      statusText = "Connected. Chat is ready.";
      addSystemMessage("Peer connection established.");
      renderUi();
    } else if (state === "failed") {
      phase = "failed";
      statusText =
        role === "starter"
          ? "PeerConnection failed. Reconnecting in 30s..."
          : "PeerConnection failed.";
      addSystemMessage("Peer connection failed.");
      scheduleAutoReconnect();
      renderUi();
    } else if (phase !== "idle") {
      statusText = `PeerConnection: ${state}`;
      renderUi();
    }
  };

  pc.ondatachannel = (event) => {
    wireDataChannel(event.channel);
  };
}

function wireDataChannel(channel) {
  dc = channel;
  dc.onopen = () => {
    clearAutoReconnect();
    phase = "connected";
    statusText = "Data channel open.";
    addSystemMessage("Data channel open.");
    renderUi();
  };
  dc.onmessage = (event) => {
    addChatMessage("peer", String(event.data || ""));
  };
  dc.onclose = () => {
    if (phase !== "idle") {
      addSystemMessage("Data channel closed.");
      statusText = "Data channel closed.";
      renderUi();
    }
  };
  dc.onerror = (event) => {
    console.error("[rtcchat] datachannel error", event);
  };
}

function waitForIceReady(connection, timeoutMs = 1800, minCandidates = 2) {
  return new Promise((resolve) => {
    if (
      connection.iceGatheringState === "complete" ||
      localCandidates.length >= minCandidates
    ) {
      resolve();
      return;
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      connection.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };

    const onChange = () => {
      if (
        connection.iceGatheringState === "complete" ||
        localCandidates.length >= minCandidates
      ) {
        finish();
      }
    };

    const timer = setTimeout(() => {
      console.warn(
        `[rtcchat] ICE readiness timeout; continuing with ${localCandidates.length} candidates`
      );
      finish();
    }, timeoutMs);

    connection.addEventListener("icegatheringstatechange", onChange);
  });
}

function toBundleString(bundle) {
  const json = JSON.stringify(bundle);
  const { bytes, compressed } = encodeBundleBytes(json);
  const b64 = btoa(bytesToBinary(bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
  const json = decodeBundleBytes(bytes, compressed);
  const bundle = JSON.parse(json);
  if (bundle.t !== type) throw new Error("Bundle type mismatch");
  return bundle;
}

function bundleSummary(bundle) {
  const sdp = buildSdpFromBundle(bundle);
  return {
    type: bundle.t === "OB" ? "offer-bundle" : "answer-bundle",
    mode: "compact-minimal",
    payloadLength: JSON.stringify(bundle).length,
    sdpType: bundle.t === "OB" ? "offer" : "answer",
    sdpLength: sdp.length,
    candidateCount: Array.isArray(bundle.c) ? bundle.c.length : 0,
    candidates: Array.isArray(bundle.c) ? bundle.c : [],
    sdpPreview: sdp.split("\n").slice(0, 12),
  };
}

function logBundle(label, payload, bundle) {
  console.log(`[rtcchat] ${label} string`);
  console.log(payload);
  console.log(`[rtcchat] ${label} json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

function logParsedBundle(label, payload, bundle) {
  console.log(`[rtcchat] ${label} string`);
  console.log(payload);
  console.log(`[rtcchat] ${label} parsed json`);
  console.log(JSON.stringify(bundleSummary(bundle), null, 2));
}

function createQrBundle(type, sdp, candidates) {
  const fields = extractNegotiationFields(sdp, type);
  return {
    t: type,
    u: fields.iceUfrag,
    p: fields.icePwd,
    f: fields.fingerprint,
    a: fields.setup,
    c: candidatesForQr(candidates),
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
    setup: findValue("a=setup:") || defaultSetupForType(type),
  };
}

function candidatesForQr(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const selected = [];

  const host = list.find((candidate) => /\styp host(\s|$)/.test(candidate));
  if (host) selected.push(host);

  const srflx = list.find((candidate) => /\styp srflx(\s|$)/.test(candidate));
  if (srflx && !selected.includes(srflx)) selected.push(srflx);

  const relay = list.find((candidate) => /\styp relay(\s|$)/.test(candidate));
  if (relay && !selected.includes(relay)) selected.push(relay);

  for (const candidate of list) {
    if (selected.length >= 3) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected;
}

function buildSdpFromBundle(bundle) {
  const type = bundle?.t === "AB" ? "AB" : "OB";
  const setup = bundle?.a || defaultSetupForType(type);
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

function defaultSetupForType(type) {
  return type === "AB" ? "active" : "actpass";
}

function makeSessionId(type, fingerprint, iceUfrag, icePwd) {
  const seed = `${type}|${fingerprint}|${iceUfrag}|${icePwd}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return `1${String(hash).padStart(9, "0")}23456789`;
}

function rebuildDisplayedQr() {
  try {
    qrCode = shareLink ? createQRCode(shareLink) : null;
    console.log(`[rtcchat] QR payload length: ${shareLink.length}`);
  } catch (error) {
    console.error("[rtcchat] QR generation failed", error);
    qrCode = null;
    statusText = `QR generation failed: ${error?.message || error}`;
  }
}

function initLocalAnswerRelay() {
  if (typeof BroadcastChannel !== "undefined") {
    localSignalChannel = new BroadcastChannel(LOCAL_SIGNAL_CHANNEL);
    localSignalChannel.onmessage = (event) => {
      handleLocalAnswerSignal(event?.data);
    };
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== ANSWER_SIGNAL_KEY || !event.newValue) return;
    try {
      handleLocalAnswerSignal(JSON.parse(event.newValue));
    } catch {}
  });
}

async function forwardResponseLinkToStarter(responseValue, sessionId) {
  const payload = {
    type: "rtc-answer",
    sessionId,
    responseValue,
    sentAt: Date.now(),
  };

  try {
    localSignalChannel?.postMessage?.(payload);
  } catch {}

  try {
    localStorage.setItem(ANSWER_SIGNAL_KEY, JSON.stringify(payload));
    setTimeout(() => {
      try {
        localStorage.removeItem(ANSWER_SIGNAL_KEY);
      } catch {}
    }, 50);
  } catch {}

  role = "idle";
  phase = "forwarded";
  statusText = "Response forwarded to the original Connect tab. You can close this tab.";
  clearIncomingParams();
  renderUi();
}

async function handleLocalAnswerSignal(data) {
  if (!data || data.type !== "rtc-answer") return;
  if (!currentStarterSessionId || data.sessionId !== currentStarterSessionId) return;
  if (!pc || role !== "starter") return;

  try {
    const bundle = fromBundleString(data.responseValue);
    const answerSignature = JSON.stringify(bundle);
    if (answerSignature === appliedAnswerSignature) {
      return;
    }

    const signalingState = pc?.signalingState || "";
    if (signalingState !== "have-local-offer") {
      if (signalingState === "stable") {
        return;
      }
      throw new Error(`Starter is not waiting for an answer (state: ${signalingState})`);
    }

    logParsedBundle("PASTED ANSWER", data.responseValue, bundle);
    phase = "connecting";
    statusText = "Applying response link...";
    renderUi();

    await pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(bundle) });
    appliedAnswerSignature = answerSignature;
    remoteCandidatesAdded = 0;
    for (const candidate of bundle.c) {
      await pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      remoteCandidatesAdded += 1;
    }

    clearIncomingParams();
    clearStarterSession();
    statusText = "Response accepted. Waiting for data channel...";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] answer relay error", error);
    statusText = `Response relay error: ${error?.message || error}`;
    renderUi();
  }
}

function makeStarterSessionId() {
  return `rtc-${Math.random().toString(36).slice(2, 10)}`;
}

function buildShareLink(paramName, value, sessionId = "") {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(paramName, value);
  if (sessionId) {
    url.searchParams.set("sid", sessionId);
  }
  return url.toString();
}

function extractBundleFromPossibleUrl(raw, paramName) {
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    const value = url.searchParams.get(paramName);
    if (!value) {
      throw new Error(`Missing ${paramName} in link`);
    }
    return value;
  }
  return raw;
}

function clearIncomingParams() {
  const url = new URL(window.location.href);
  if (url.search) {
    url.search = "";
    window.history.replaceState({}, "", url.toString());
  }
}

function encodeBundleBytes(json) {
  const raw = new TextEncoder().encode(json);
  if (globalThis.fflate?.zlibSync) {
    return {
      bytes: globalThis.fflate.zlibSync(raw, { level: 9 }),
      compressed: true,
    };
  }
  return { bytes: raw, compressed: false };
}

function decodeBundleBytes(bytes, compressed) {
  const out =
    compressed && globalThis.fflate?.unzlibSync
      ? globalThis.fflate.unzlibSync(bytes)
      : bytes;
  return new TextDecoder().decode(out);
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
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--rtcchat-app-height", `${Math.round(height)}px`);
}

function keepChatVisible() {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
