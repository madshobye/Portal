const COLORS = {
  background: "#090b10",
  panel: "#141820",
  panelHover: "#1c2330",
  line: "#29303c",
  text: "#f6f7fb",
  muted: "#8f98a8",
  blue: "#5c7cfa",
  blueHover: "#708cff",
  green: "#42d392",
  red: "#ff647c",
  black: "#050609",
};

let screenSharing;
let role = "master";
let masterId = "";
let clientName = "";
let statusText = "Starting…";
let errorText = "";

let clientUrl = "";
let qrCode = null;
let showQr = false;
let qrBounds = null;
let dropdownOpen = false;
let selectedPeerId = null;
let nameInputActive = false;
let busy = false;
let toastText = "";
let toastUntil = 0;

let controls = {};
let dropdownRows = [];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(min(2, window.devicePixelRatio || 1));
  textFont("Inter, system-ui, -apple-system, sans-serif");

  const params = new URLSearchParams(window.location.search);
  masterId = String(params.get("master") || "").trim();
  role = masterId ? "client" : "master";

  try {
    await loadScript("portal/screenSharing.js");
    await loadScript("portal/qrCodeGen.js");

    if (role === "master") {
      const requestedId = String(params.get("id") || getSessionMasterId()).trim();
      screenSharing = await new PortalScreenSharing({
        mode: "receiver",
        peerId: requestedId,
        onEvent: handleSharingEvent,
        lowLatency: {
          jitterBufferTarget: 0,
          statsIntervalMs: 750,
        },
      }).init();
      masterId = screenSharing.peerId;
      clientUrl = screenSharing.buildClientUrl();
      qrCode = createQRCode(clientUrl);
      statusText = "Receiver ready";
    } else {
      clientName = localStorage.getItem("portal.screenSharing.clientName") || "";
      screenSharing = await new PortalScreenSharing({
        mode: "sender",
        name: clientName || "Guest",
        onEvent: handleSharingEvent,
        capture: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          audio: false,
        },
        lowLatency: {
          contentHint: "detail",
          maxBitrate: 10000000,
          maxFramerate: 30,
          degradationPreference: "maintain-resolution",
        },
      }).init();
      statusText = clientName ? "Ready to connect" : "Enter your name";
      nameInputActive = !clientName;
    }
  } catch (error) {
    showError(error);
  }
}

function draw() {
  background(COLORS.background);
  controls = {};
  dropdownRows = [];
  cursor(ARROW);

  if (role === "master") drawMaster();
  else drawClient();

  drawToast();
}

function drawMaster() {
  const clients = screenSharing?.getClients?.() || [];
  reconcileSelection(clients);
  const selected = clients.find((client) => client.peerId === selectedPeerId) || null;

  if (selected?.sharing && selected.video) {
    drawVideoCover(selected.video, 0, 0, width, height);
    drawVideoShade();
  } else {
    drawEmptyMasterState(clients, selected);
  }

  drawTopBar("MASTER RECEIVER", screenSharing?.open ? "LIVE" : "CONNECTING");
  drawMasterControls(clients, selected);
  drawSelectedClientInfo(selected);

  if (dropdownOpen) drawClientDropdown(clients);
  if (showQr) drawQrOverlay();
}

function drawClient() {
  const latest = screenSharing?.getLatest?.() || {};

  if (latest.sharing && latest.previewVideo) {
    drawVideoContain(latest.previewVideo, 0, 0, width, height);
    drawVideoShade(45);
  } else {
    drawClientBackdrop();
  }

  drawTopBar("SCREEN SHARING", latest.connected ? "CONNECTED" : "CLIENT");

  if (!latest.connected) drawConnectCard();
  else drawSharingControls(latest);
}

function drawTopBar(title, badge) {
  noStroke();
  fill(8, 10, 15, 225);
  rect(0, 0, width, 72);
  stroke(COLORS.line);
  line(0, 72, width, 72);

  noStroke();
  fill(COLORS.text);
  textStyle(BOLD);
  textSize(16);
  text(title, 22, 31);
  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(10);
  text(`PEER  ${role === "master" ? masterId || "…" : screenSharing?.peerId || "…"}`, 22, 50);

  const connected = badge === "LIVE" || badge === "CONNECTED";
  const badgeWidth = textWidth(badge) + 35;
  const badgeX = width - badgeWidth - 20;
  fill(connected ? "#17382d" : COLORS.panel);
  rect(badgeX, 20, badgeWidth, 30, 15);
  fill(connected ? COLORS.green : COLORS.muted);
  circle(badgeX + 15, 35, 7);
  textStyle(BOLD);
  textSize(10);
  text(badge, badgeX + 25, 39);
}

function drawEmptyMasterState(clients, selected) {
  const centerY = height * 0.48;
  noFill();
  stroke(COLORS.line);
  strokeWeight(2);
  circle(width * 0.5, centerY - 34, 88);
  drawScreenIcon(width * 0.5, centerY - 34, 37, COLORS.muted);

  noStroke();
  fill(COLORS.text);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(22);
  const heading = selected
    ? `${selected.name} is not sharing yet`
    : clients.length
      ? "Choose a connected client"
      : "Waiting for a client";
  text(heading, width * 0.5, centerY + 42);

  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(13);
  text(
    clients.length
      ? `${clients.length} client${clients.length === 1 ? "" : "s"} connected`
      : "Open the QR code to invite someone",
    width * 0.5,
    centerY + 70
  );
  textAlign(LEFT, BASELINE);
}

function drawMasterControls(clients, selected) {
  const y = 88;
  controls.qrButton = { x: 20, y, w: 132, h: 42 };
  drawButton(controls.qrButton, showQr ? "Hide QR" : "Show QR", "secondary", true);

  const dropdownWidth = min(300, max(190, width * 0.32));
  controls.dropdown = { x: width - dropdownWidth - 20, y, w: dropdownWidth, h: 42 };
  const label = selected
    ? `${selected.name}${selected.sharing ? "  • sharing" : ""}`
    : clients.length
      ? "Select client"
      : "No clients";
  drawDropdownButton(controls.dropdown, label, clients.length > 0);
}

function drawSelectedClientInfo(client) {
  if (!client) return;
  const stats = client.stats;
  const parts = [];
  if (stats?.frameWidth) parts.push(`${stats.frameWidth}×${stats.frameHeight}`);
  if (stats?.framesPerSecond) parts.push(`${round(stats.framesPerSecond)} FPS`);
  if (Number.isFinite(stats?.jitterBufferMs)) {
    parts.push(`${round(stats.jitterBufferMs)} ms buffer`);
  }
  if (Number.isFinite(stats?.framesDropped)) parts.push(`${stats.framesDropped} dropped`);

  const label = parts.length ? parts.join("  ·  ") : client.sharing ? "Receiving stream…" : "Connected";
  const w = min(width - 40, textWidth(label) + 32);
  noStroke();
  fill(5, 7, 11, 205);
  rect(20, height - 54, w, 34, 17);
  fill(client.sharing ? COLORS.green : COLORS.muted);
  textStyle(NORMAL);
  textSize(10);
  text(label, 36, height - 32);
}

function drawClientDropdown(clients) {
  const base = controls.dropdown;
  if (!base || !clients.length) return;
  const rowHeight = 44;
  const visible = clients.slice(0, 8);
  const panel = {
    x: base.x,
    y: base.y + base.h + 6,
    w: base.w,
    h: visible.length * rowHeight + 8,
  };

  noStroke();
  fill(COLORS.panel);
  rect(panel.x, panel.y, panel.w, panel.h, 10);
  stroke(COLORS.line);
  noFill();
  rect(panel.x, panel.y, panel.w, panel.h, 10);

  for (let index = 0; index < visible.length; index++) {
    const client = visible[index];
    const row = {
      x: panel.x + 4,
      y: panel.y + 4 + index * rowHeight,
      w: panel.w - 8,
      h: rowHeight,
      peerId: client.peerId,
    };
    dropdownRows.push(row);
    const hovered = pointInRect(mouseX, mouseY, row);
    if (hovered) {
      noStroke();
      fill(COLORS.panelHover);
      rect(row.x, row.y, row.w, row.h, 7);
      cursor(HAND);
    }

    noStroke();
    fill(client.sharing ? COLORS.green : COLORS.muted);
    circle(row.x + 16, row.y + row.h * 0.5, 8);
    fill(COLORS.text);
    textStyle(client.peerId === selectedPeerId ? BOLD : NORMAL);
    textSize(12);
    text(clipText(client.name, row.w - 68), row.x + 30, row.y + 20);
    fill(COLORS.muted);
    textStyle(NORMAL);
    textSize(9);
    text(client.sharing ? "SHARING" : "CONNECTED", row.x + 30, row.y + 34);
  }
}

function drawQrOverlay() {
  noStroke();
  fill(0, 0, 0, 205);
  rect(0, 0, width, height);

  const size = min(420, width - 64, height - 220);
  const cardWidth = size + 48;
  const cardHeight = size + 118;
  const cardX = (width - cardWidth) * 0.5;
  const cardY = max(24, (height - cardHeight) * 0.5);

  fill(COLORS.text);
  rect(cardX, cardY, cardWidth, cardHeight, 18);
  qrBounds = { x: cardX + 24, y: cardY + 24, w: size, h: size };

  if (qrCode) drawQRCode(qrCode, qrBounds.x, qrBounds.y, size);

  fill(COLORS.black);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(15);
  text("Scan to share a screen", width * 0.5, cardY + size + 52);
  fill("#56606f");
  textStyle(NORMAL);
  textSize(10);
  text("Click the QR code to copy the invitation URL", width * 0.5, cardY + size + 75);
  text(clipText(clientUrl, cardWidth - 60), width * 0.5, cardY + size + 94);
  textAlign(LEFT, BASELINE);
}

function drawClientBackdrop() {
  noStroke();
  fill("#10141b");
  rect(0, 72, width, height - 72);
  fill("#171d27");
  circle(width * 0.5, height * 0.45, min(width, height) * 0.48);
  drawScreenIcon(width * 0.5, height * 0.43, 54, COLORS.muted);
}

function drawConnectCard() {
  const cardWidth = min(470, width - 40);
  const cardHeight = 272;
  const cardX = (width - cardWidth) * 0.5;
  const cardY = max(96, (height - cardHeight) * 0.5);

  noStroke();
  fill(COLORS.panel);
  rect(cardX, cardY, cardWidth, cardHeight, 16);
  stroke(COLORS.line);
  noFill();
  rect(cardX, cardY, cardWidth, cardHeight, 16);

  noStroke();
  fill(COLORS.text);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(21);
  text("Join the receiver", width * 0.5, cardY + 38);
  fill(COLORS.muted);
  textStyle(NORMAL);
  textSize(11);
  text(`MASTER  ${masterId}`, width * 0.5, cardY + 66);
  textAlign(LEFT, BASELINE);

  const field = { x: cardX + 28, y: cardY + 92, w: cardWidth - 56, h: 54 };
  controls.nameInput = field;
  fill(nameInputActive ? COLORS.panelHover : COLORS.background);
  stroke(nameInputActive ? COLORS.blue : COLORS.line);
  strokeWeight(nameInputActive ? 2 : 1);
  rect(field.x, field.y, field.w, field.h, 9);
  noStroke();
  fill(COLORS.muted);
  textSize(9);
  textStyle(BOLD);
  text("YOUR NAME", field.x + 14, field.y + 17);
  fill(clientName ? COLORS.text : COLORS.muted);
  textStyle(NORMAL);
  textSize(15);
  text(clientName || "Type a name…", field.x + 14, field.y + 39);
  if (nameInputActive && frameCount % 60 < 32) {
    const caretX = field.x + 14 + textWidth(clientName);
    stroke(COLORS.blue);
    line(caretX, field.y + 25, caretX, field.y + 43);
  }

  controls.connectButton = {
    x: cardX + 28,
    y: cardY + 164,
    w: cardWidth - 56,
    h: 52,
  };
  drawButton(controls.connectButton, busy ? "Connecting…" : "Connect", "primary", !busy);

  fill(errorText ? COLORS.red : COLORS.muted);
  textAlign(CENTER, CENTER);
  textSize(10);
  text(
    errorText || statusText,
    width * 0.5,
    cardY + 242
  );
  textAlign(LEFT, BASELINE);
}

function drawSharingControls(latest) {
  const barWidth = min(560, width - 32);
  const barHeight = 82;
  const barX = (width - barWidth) * 0.5;
  const barY = height - barHeight - 22;

  noStroke();
  fill(7, 9, 14, 230);
  rect(barX, barY, barWidth, barHeight, 22);
  stroke(COLORS.line);
  noFill();
  rect(barX, barY, barWidth, barHeight, 22);

  controls.shareButton = {
    x: barX + 14,
    y: barY + 14,
    w: barWidth - 116,
    h: 54,
  };
  drawButton(
    controls.shareButton,
    busy ? "Opening picker…" : latest.sharing ? "Stop sharing" : "Share screen",
    latest.sharing ? "danger" : "primary",
    !busy
  );
  drawScreenIcon(
    controls.shareButton.x + 31,
    controls.shareButton.y + 27,
    19,
    COLORS.text
  );

  controls.disconnectButton = {
    x: barX + barWidth - 88,
    y: barY + 14,
    w: 74,
    h: 54,
  };
  drawButton(controls.disconnectButton, "Leave", "secondary", true);

  const message = errorText || (latest.sharing ? "You are sharing · low-latency mode" : "Connected · ready to share");
  fill(errorText ? COLORS.red : COLORS.text);
  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(11);
  text(message, width * 0.5, max(93, barY - 20));
  textAlign(LEFT, BASELINE);
}

function drawButton(bounds, label, kind = "primary", enabled = true) {
  const hovered = enabled && pointInRect(mouseX, mouseY, bounds);
  if (hovered) cursor(HAND);

  let color = COLORS.blue;
  if (kind === "secondary") color = hovered ? COLORS.panelHover : COLORS.panel;
  if (kind === "danger") color = hovered ? "#e95670" : COLORS.red;
  if (kind === "primary" && hovered) color = COLORS.blueHover;
  if (!enabled) color = COLORS.line;

  noStroke();
  fill(color);
  rect(bounds.x, bounds.y, bounds.w, bounds.h, 10);
  if (kind === "secondary") {
    stroke(COLORS.line);
    noFill();
    rect(bounds.x, bounds.y, bounds.w, bounds.h, 10);
  }

  noStroke();
  fill(enabled ? COLORS.text : COLORS.muted);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(12);
  text(label, bounds.x + bounds.w * 0.5, bounds.y + bounds.h * 0.5 + 1);
  textAlign(LEFT, BASELINE);
}

function drawDropdownButton(bounds, label, enabled) {
  const hovered = enabled && pointInRect(mouseX, mouseY, bounds);
  if (hovered) cursor(HAND);
  fill(hovered || dropdownOpen ? COLORS.panelHover : COLORS.panel);
  stroke(dropdownOpen ? COLORS.blue : COLORS.line);
  strokeWeight(1);
  rect(bounds.x, bounds.y, bounds.w, bounds.h, 10);

  noStroke();
  fill(enabled ? COLORS.text : COLORS.muted);
  textStyle(NORMAL);
  textSize(11);
  text(clipText(label, bounds.w - 50), bounds.x + 14, bounds.y + 26);
  drawChevron(bounds.x + bounds.w - 22, bounds.y + 21, dropdownOpen, enabled);
}

function drawChevron(x, y, open, enabled) {
  stroke(enabled ? COLORS.text : COLORS.muted);
  strokeWeight(1.5);
  noFill();
  if (open) {
    line(x - 4, y + 2, x, y - 2);
    line(x, y - 2, x + 4, y + 2);
  } else {
    line(x - 4, y - 2, x, y + 2);
    line(x, y + 2, x + 4, y - 2);
  }
}

function drawScreenIcon(x, y, size, color) {
  push();
  rectMode(CENTER);
  noFill();
  stroke(color);
  strokeWeight(max(1.5, size * 0.06));
  rect(x, y - size * 0.08, size, size * 0.62, size * 0.08);
  line(x, y + size * 0.23, x, y + size * 0.39);
  line(x - size * 0.22, y + size * 0.39, x + size * 0.22, y + size * 0.39);
  pop();
}

function drawVideoShade(alpha = 85) {
  noStroke();
  fill(0, 0, 0, alpha);
  rect(0, 0, width, 142);
}

function drawVideoCover(video, x, y, w, h) {
  drawVideoFitted(video, x, y, w, h, true);
}

function drawVideoContain(video, x, y, w, h) {
  drawVideoFitted(video, x, y, w, h, false);
}

function drawVideoFitted(video, x, y, w, h, cover) {
  const element = video?.elt || video;
  const sourceWidth = element?.videoWidth || 0;
  const sourceHeight = element?.videoHeight || 0;
  if (!sourceWidth || !sourceHeight || element.readyState < 2) return false;

  const scale = cover
    ? max(w / sourceWidth, h / sourceHeight)
    : min(w / sourceWidth, h / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (w - drawWidth) * 0.5;
  const drawY = y + (h - drawHeight) * 0.5;

  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(x, y, w, h);
  drawingContext.clip();
  drawingContext.drawImage(element, drawX, drawY, drawWidth, drawHeight);
  drawingContext.restore();
  return true;
}

function reconcileSelection(clients) {
  const current = clients.find((client) => client.peerId === selectedPeerId);
  if (current) return;
  const best = clients.find((client) => client.sharing) || clients[0] || null;
  selectedPeerId = best?.peerId || null;
}

function handleSharingEvent(event) {
  const type = event?.type || "";
  if (type === "client-screen-started" && !selectedPeerId) {
    selectedPeerId = event.data.peerId;
  }
  if (type === "client-connected") statusText = `${event.data.name} connected`;
  if (type === "client-disconnected") statusText = `${event.data.name} disconnected`;
  if (type === "error") showError(event.data?.message || "Connection error");
}

async function connectClient() {
  if (busy || !screenSharing) return;
  const name = clientName.trim();
  if (!name) {
    nameInputActive = true;
    showError("Please enter your name");
    return;
  }

  busy = true;
  errorText = "";
  statusText = "Connecting…";
  localStorage.setItem("portal.screenSharing.clientName", name);
  try {
    await screenSharing.connect(masterId, { name });
    statusText = `Connected as ${name}`;
    nameInputActive = false;
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
  }
}

async function toggleScreenShare() {
  if (busy || !screenSharing) return;
  errorText = "";

  if (screenSharing.localStream) {
    screenSharing.stopScreenShare();
    statusText = "Screen sharing stopped";
    return;
  }

  busy = true;
  statusText = "Choose a screen or window…";
  try {
    await screenSharing.startScreenShare();
    statusText = "Sharing your screen";
  } catch (error) {
    if (error?.name === "NotAllowedError") {
      showError("Screen selection was cancelled or denied");
    } else {
      showError(error);
    }
  } finally {
    busy = false;
  }
}

function leaveMaster() {
  screenSharing?.disconnect?.();
  statusText = "Disconnected";
  errorText = "";
}

async function copyInvitationUrl() {
  if (!clientUrl) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(clientUrl);
    } else {
      fallbackCopy(clientUrl);
    }
    showToast("Invitation URL copied");
  } catch {
    try {
      fallbackCopy(clientUrl);
      showToast("Invitation URL copied");
    } catch {
      showToast("Could not copy URL");
    }
  }
}

function fallbackCopy(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy command failed");
}

function mousePressed() {
  if (role === "master") {
    if (showQr && qrBounds && pointInRect(mouseX, mouseY, qrBounds)) {
      copyInvitationUrl();
      return false;
    }
    if (showQr) {
      showQr = false;
      qrBounds = null;
      return false;
    }
    if (pointInRect(mouseX, mouseY, controls.qrButton)) {
      showQr = !showQr;
      dropdownOpen = false;
      return false;
    }
    if (pointInRect(mouseX, mouseY, controls.dropdown)) {
      const hasClients = (screenSharing?.getClients?.() || []).length > 0;
      if (hasClients) dropdownOpen = !dropdownOpen;
      return false;
    }
    const row = dropdownRows.find((item) => pointInRect(mouseX, mouseY, item));
    if (row) {
      selectedPeerId = row.peerId;
      dropdownOpen = false;
      return false;
    }
    dropdownOpen = false;
    return;
  }

  const latest = screenSharing?.getLatest?.() || {};
  if (!latest.connected) {
    if (pointInRect(mouseX, mouseY, controls.nameInput)) {
      nameInputActive = true;
      return false;
    }
    nameInputActive = false;
    if (pointInRect(mouseX, mouseY, controls.connectButton)) {
      connectClient();
      return false;
    }
  } else {
    if (pointInRect(mouseX, mouseY, controls.shareButton)) {
      toggleScreenShare();
      return false;
    }
    if (pointInRect(mouseX, mouseY, controls.disconnectButton)) {
      leaveMaster();
      return false;
    }
  }
}

function keyTyped() {
  if (role !== "client" || !nameInputActive || busy) return;
  if (key.length === 1 && key >= " " && key !== "\u007f" && clientName.length < 32) {
    clientName += key;
    errorText = "";
    return false;
  }
}

function keyPressed() {
  if (role !== "client" || !nameInputActive || busy) return;
  if (keyCode === BACKSPACE || keyCode === DELETE) {
    clientName = clientName.slice(0, -1);
    return false;
  }
  if (keyCode === ENTER || keyCode === RETURN) {
    connectClient();
    return false;
  }
}

function getSessionMasterId() {
  const storageKey = "portal.screenSharing.masterId";
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = `portal-screen-${randomId(8)}`;
    sessionStorage.setItem(storageKey, id);
  }
  return id;
}

function randomId(length) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}

function showError(error) {
  errorText = String(error?.message || error || "Unknown error");
  statusText = errorText;
  console.error(error);
}

function showToast(message) {
  toastText = message;
  toastUntil = millis() + 1800;
}

function drawToast() {
  if (!toastText || millis() >= toastUntil) return;
  textStyle(BOLD);
  textSize(11);
  const w = textWidth(toastText) + 38;
  const x = (width - w) * 0.5;
  const y = height - 128;
  noStroke();
  fill(COLORS.green);
  rect(x, y, w, 38, 19);
  fill(COLORS.black);
  textAlign(CENTER, CENTER);
  text(toastText, width * 0.5, y + 20);
  textAlign(LEFT, BASELINE);
}

function pointInRect(x, y, rectangle) {
  if (!rectangle) return false;
  return (
    x >= rectangle.x &&
    y >= rectangle.y &&
    x <= rectangle.x + rectangle.w &&
    y <= rectangle.y + rectangle.h
  );
}

function clipText(value, maxWidth) {
  const source = String(value || "");
  if (textWidth(source) <= maxWidth) return source;
  let output = source;
  while (output.length > 1 && textWidth(`${output}…`) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

window.addEventListener("pagehide", () => screenSharing?.destroy?.());
