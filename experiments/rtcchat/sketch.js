let pc = null;
let dc = null;

let role = "idle";
let phase = "idle";
let statusText = "Choose Connect on one device or Scan Offer on the other.";
let localCandidates = [];
let remoteCandidatesAdded = 0;

let qrValue = "";
let qrCode = null;
let scannerVideo = null;
let qrReader = null;

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

let chatMessages = [];
let useSimpleTestQr = false;
const SIMPLE_TEST_QR = "RTCCHAT-TEST";
let scannerDebugText = "";
let canvasMode = "";
let lastStageSize = 0;

async function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvasEl = canvas.elt;
  textFont("monospace");
  textSize(16);

  await loadScript("https://unpkg.com/fflate@0.8.2/umd/index.js");
  await loadScript("portal/qrCodeGen.js");
  await loadScript("portal/QrReader.js");

  buildUi(canvas);
  renderUi();
}

function draw() {
  background("#0b0b0d");

  if (phase === "show-offer" || phase === "show-answer") {
    drawQrScreen();
  } else if (phase === "scan-offer" || phase === "scan-answer") {
    drawScannerScreen();
  } else if (phase === "connected" || phase === "connecting") {
    drawConnectedBackdrop();
  } else {
    drawIdleScreen();
  }
}

function windowResized() {
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
  titleEl.textContent = "RTC Chat";
  statusCardEl.appendChild(titleEl);

  statusTextEl = document.createElement("p");
  statusTextEl.className = "rtcchat-text";
  statusCardEl.appendChild(statusTextEl);

  actionsEl = document.createElement("div");
  actionsEl.className = "rtcchat-actions";
  statusCardEl.appendChild(actionsEl);

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
  composer.appendChild(composerInputEl);

  sendBtnEl = document.createElement("button");
  sendBtnEl.className = "rtcchat-btn";
  sendBtnEl.textContent = "Send";
  sendBtnEl.addEventListener("click", sendMessage);
  composer.appendChild(sendBtnEl);

  chatCardEl.appendChild(composer);

  panelEl.appendChild(statusCardEl);
  panelEl.appendChild(stageEl);
  panelEl.appendChild(chatCardEl);
  appEl.appendChild(panelEl);
  document.body.appendChild(appEl);
}

function renderUi() {
  if (!statusTextEl || !actionsEl || !chatCardEl || !panelEl || !statusCardEl || !titleEl || !stageEl) return;

  statusTextEl.textContent = `${statusText}  Role: ${role}  ICE: ${localCandidates.length}/${remoteCandidatesAdded}`;
  const qrMode = phase === "show-offer" || phase === "show-answer";
  const stageMode = qrMode || phase === "scan-offer" || phase === "scan-answer";

  panelEl.classList.toggle("qr-mode", qrMode);
  statusCardEl.classList.toggle("qr-mode", qrMode);
  titleEl.classList.toggle("qr-mode", qrMode);
  statusTextEl.classList.toggle("qr-mode", qrMode);
  actionsEl.classList.toggle("qr-mode", qrMode);
  stageEl.classList.toggle("active", stageMode);

  actionsEl.innerHTML = "";

  if (phase === "idle") {
    appendAction("Connect", startAsStarter);
    appendAction("Scan Offer", prepareJoinerScan);
  } else if (phase === "show-offer") {
    appendAction("Scan Answer", startScanAnswer);
    appendAction(useSimpleTestQr ? "Use Real QR" : "Use Simple Test QR", toggleSimpleQr, true);
    appendAction("Reset", resetConnection, true);
  } else if (phase === "scan-offer") {
    appendAction("Cancel Scan", resetScannerToIdle, true);
    appendAction("Reset", resetConnection, true);
  } else if (phase === "show-answer") {
    appendAction(useSimpleTestQr ? "Use Real QR" : "Use Simple Test QR", toggleSimpleQr, true);
    appendAction("Reset", resetConnection, true);
  } else if (phase === "scan-answer") {
    appendAction("Cancel Scan", cancelScanAnswer, true);
    appendAction("Reset", resetConnection, true);
  } else if (phase === "connecting") {
    appendAction("Reset", resetConnection, true);
  } else if (phase === "connected") {
    appendAction("Reset", resetConnection, true);
  }

  const connected = phase === "connected";
  chatCardEl.style.display = connected ? "flex" : "none";
  composerInputEl.disabled = !connected;
  sendBtnEl.disabled = !connected;
  if (canvasEl) {
    canvasEl.style.display = stageMode ? "block" : "none";
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

function drawScannerScreen() {
  background(0);
  if (qrReader) {
    const size = min(width, height) - 24;
    const x = (width - size) * 0.5;
    const y = (height - size) * 0.5;
    qrReader.scaleTo(size, size, x, y);
    qrReader.drawImage();
    qrReader.drawOverlay();
  }

  const guideSize = min(width, height) - 24;
  const guideX = (width - guideSize) * 0.5;
  const guideY = (height - guideSize) * 0.5;

  noFill();
  stroke(255, 255, 255, 220);
  strokeWeight(3);
  rect(guideX, guideY, guideSize, guideSize, 22);

  noStroke();
  fill(0, 150);
  rect(12, height - 76, width - 24, 64, 12);
  fill(255);
  textSize(13);
  text(`scanner: ${scannerVideo ? `${scannerVideo.width}x${scannerVideo.height}` : "-"}`, 24, height - 48);
  text(`last result: ${scannerDebugText || "none"}`, 24, height - 28, width - 48, 32);
}

function syncCanvasMode() {
  if (!canvasEl || !stageCardEl) return;

  const stageMode =
    phase === "show-offer" ||
    phase === "show-answer" ||
    phase === "scan-offer" ||
    phase === "scan-answer";

  if (stageMode) {
    const rect = stageCardEl.getBoundingClientRect();
    const stageSize = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
    if (canvasMode !== "stage" || Math.abs(stageSize - lastStageSize) > 1) {
      resizeCanvas(stageSize, stageSize);
      lastStageSize = stageSize;
      canvasMode = "stage";
    }
  } else if (canvasMode !== "window") {
    resizeCanvas(windowWidth, windowHeight);
    canvasMode = "window";
    lastStageSize = 0;
  }
}

function resetConnection() {
  stopQrScanner();
  stopCamera();
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
  statusText = "Choose Connect on one device or Scan Offer on the other.";
  localCandidates = [];
  remoteCandidatesAdded = 0;
  qrValue = "";
  qrCode = null;
  useSimpleTestQr = false;
  scannerDebugText = "";
  chatMessages = [];
  renderMessages();
  renderUi();
}

function resetScannerToIdle() {
  stopQrScanner();
  stopCamera();
  role = "idle";
  phase = "idle";
  statusText = "Choose Connect on one device or Scan Offer on the other.";
  renderUi();
}

function cancelScanAnswer() {
  stopQrScanner();
  stopCamera();
  phase = "show-offer";
  statusText = "Offer QR ready. Scan the answer when the other device shows it.";
  renderUi();
}

function toggleSimpleQr() {
  useSimpleTestQr = !useSimpleTestQr;
  rebuildDisplayedQr();
  renderUi();
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
      phase = "connected";
      statusText = "Connected. Chat is ready.";
      addSystemMessage("Peer connection established.");
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

async function startAsStarter() {
  if (pc) return;

  role = "starter";
  phase = "connecting";
  statusText = "Creating offer...";
  renderUi();

  newPeerConnection();
  wireDataChannel(pc.createDataChannel("rtcchat"));

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceReady(pc);

    const bundle = createQrBundle("OB", pc.localDescription.sdp, localCandidates);
    qrValue = toBundleString(bundle);
    rebuildDisplayedQr();
    logBundle("COPY OFFER", qrValue, bundle);

    phase = "show-offer";
    statusText = "Offer QR ready. The other device should scan it.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] starter error", error);
    statusText = `Starter error: ${error?.message || error}`;
    renderUi();
  }
}

async function prepareJoinerScan() {
  if (pc) return;
  role = "joiner";
  phase = "scan-offer";
  statusText = "Opening camera for offer QR...";
  renderUi();

  newPeerConnection();
  await startQrScanner(handleOfferScan);
}

async function startScanAnswer() {
  if (!pc || role !== "starter") return;
  phase = "scan-answer";
  statusText = "Opening camera for answer QR...";
  renderUi();
  await startQrScanner(handleAnswerScan);
}

async function handleOfferScan(qrText) {
  try {
    const bundle = fromBundleString(qrText);
    logParsedBundle("PASTED OFFER", qrText, bundle);
    phase = "connecting";
    statusText = "Offer scanned. Applying offer and building answer...";
    renderUi();
    stopQrScanner();
    stopCamera();

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
    rebuildDisplayedQr();
    logBundle("COPY ANSWER", qrValue, answerBundle);

    phase = "show-answer";
    statusText = "Answer QR ready. Show it to the starter device.";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] offer scan error", error);
    statusText = `Offer scan error: ${error?.message || error}`;
    renderUi();
  }
}

async function handleAnswerScan(qrText) {
  try {
    const bundle = fromBundleString(qrText);
    logParsedBundle("PASTED ANSWER", qrText, bundle);
    phase = "connecting";
    statusText = "Answer scanned. Applying answer...";
    renderUi();
    stopQrScanner();
    stopCamera();

    await pc.setRemoteDescription({ type: "answer", sdp: buildSdpFromBundle(bundle) });
    for (const candidate of bundle.c) {
      await pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
      remoteCandidatesAdded += 1;
    }

    phase = "connecting";
    statusText = "Answer accepted. Waiting for data channel...";
    renderUi();
  } catch (error) {
    console.error("[rtcchat] answer scan error", error);
    statusText = `Answer scan error: ${error?.message || error}`;
    renderUi();
  }
}

async function startQrScanner(onScan) {
  stopQrScanner();
  stopCamera();

  scannerVideo = await setupWebcamera(false, 1920, 1080, false, true);
  qrReader = await new QrReader({
    video: scannerVideo,
    videoIsFlipped: false,
    cooldownMs: 2000,
    onResult: (result) => {
      const text = result?.text || "";
      if (!text) return;
      scannerDebugText = text;
      onScan(text);
    },
  }).init();

  qrReader.start();
}

function stopQrScanner() {
  try {
    qrReader?.stop?.();
  } catch {}
  qrReader = null;
}

function stopCamera() {
  const videoEl = scannerVideo?.elt;
  try {
    const stream = videoEl?.srcObject;
    if (stream?.getTracks) {
      for (const track of stream.getTracks()) track.stop();
    }
  } catch {}
  try {
    scannerVideo?.remove?.();
  } catch {}
  scannerVideo = null;
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
  messagesEl.scrollTop = messagesEl.scrollHeight;
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

function getDisplayedQrValue() {
  return useSimpleTestQr ? SIMPLE_TEST_QR : qrValue;
}

function rebuildDisplayedQr() {
  const value = getDisplayedQrValue();
  try {
    qrCode = value ? createQRCode(value) : null;
    console.log(`[rtcchat] QR payload length: ${value.length}`);
  } catch (error) {
    console.error("[rtcchat] QR generation failed", error);
    qrCode = null;
    statusText = `QR generation failed: ${error?.message || error}`;
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
