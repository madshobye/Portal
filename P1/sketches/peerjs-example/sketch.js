let peerNet;
let myPeerId = "";
let myName = "";
let connectTarget = "";

let localValue = 0;
let remoteValue = null;
let remoteName = "";
let remotePeerId = "";
let statusText = "Starting...";
let lastSendAt = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");

  const params = new URLSearchParams(window.location.search);
  myPeerId = (params.get("id") || "").trim() || `peer-${Math.random().toString(36).slice(2, 8)}`;
  myName = (params.get("name") || "").trim() || myPeerId;
  connectTarget = (params.get("connect") || "").trim();

  await loadScript("portal/PeerJs.js");

  peerNet = await new PortalPeerJs({
    peerId: myPeerId,
    singleConnection: true,
    onOpen: (id) => {
      statusText = `Open as ${id}`;
      if (connectTarget) {
        connectToTarget();
      }
    },
    onConnection: (conn) => {
      remotePeerId = conn.peer;
      statusText = `Connected to ${conn.peer}`;
    },
    onData: (data, conn) => {
      if (typeof data === "string") {
        statusText = data;
        return;
      }
      remotePeerId = conn.peer;
      remoteName = data.name || conn.peer;
      remoteValue = Number.isFinite(data.value) ? data.value : null;
      statusText = `Receiving from ${remoteName}`;
    },
    onClose: () => {
      statusText = "Connection closed";
      remotePeerId = "";
      remoteName = "";
      remoteValue = null;
    },
    onError: (err) => {
      statusText = `Peer error: ${err?.type || err?.message || err}`;
    },
  }).init();
}

function draw() {
  background("#f4f0e8");

  localValue = floor(random(0, 1000));
  maybeSendRandomValue();

  drawPanel();
}

function drawPanel() {
  fill("#111");
  noStroke();
  textSize(18);
  text(`PeerJS Example`, 24, 34);

  textSize(14);
  text(`me: ${myName}`, 24, 64);
  text(`id: ${myPeerId}`, 24, 84);
  text(`connect target: ${connectTarget || "-"}`, 24, 104);
  text(`status: ${statusText}`, 24, 124);
  text(`connection open: ${peerNet?.isConnected() ? "yes" : "no"}`, 24, 144);

  drawValueCard(24, 190, width * 0.5 - 36, height - 220, "#0d6efd", myName, myPeerId, localValue);
  drawValueCard(width * 0.5 + 12, 190, width * 0.5 - 36, height - 220, "#d94f4f", remoteName || "Waiting…", remotePeerId || "-", remoteValue);

  textSize(12);
  fill(40);
  text("Use URL params like ?id=cc1&name=Alice&connect=cc2", 24, height - 28);
}

function drawValueCard(x, y, w, h, colorValue, title, id, value) {
  fill("#ffffff");
  stroke(20, 20, 20, 30);
  strokeWeight(1);
  rect(x, y, w, h, 18);

  noStroke();
  fill(colorValue);
  circle(x + w * 0.5, y + h * 0.42, min(w, h) * 0.45);

  fill("#111");
  textAlign(CENTER, CENTER);
  textSize(18);
  text(title, x + w * 0.5, y + 36);
  textSize(12);
  text(id, x + w * 0.5, y + 58);
  textSize(42);
  text(value == null ? "--" : value, x + w * 0.5, y + h * 0.42);
  textAlign(LEFT, BASELINE);
}

async function connectToTarget() {
  if (!peerNet || !connectTarget || peerNet.isConnected()) return;
  statusText = `Connecting to ${connectTarget}...`;
  try {
    const conn = await peerNet.connect(connectTarget);
    remotePeerId = conn.peer;
    statusText = `Connected to ${conn.peer}`;
  } catch (error) {
    statusText = `Connect failed: ${error?.message || error}`;
  }
}

function maybeSendRandomValue() {
  if (!peerNet?.isConnected()) return;
  if (millis() - lastSendAt < 800) return;
  lastSendAt = millis();
  peerNet.send({
    type: "random-value",
    name: myName,
    value: localValue,
  });
}

function mousePressed() {
  connectToTarget();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
