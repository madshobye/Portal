const DEFAULTS = {
  host: "0.peerjs.com",
  port: "443",
  path: "/",
  key: "peerjs",
  secure: "true",
  localId: `portal-${Math.floor(Math.random() * 10000)}`,
  remoteId: "printhost",
};

let peer = null;
let conn = null;
let peerReady = false;
let channelOpen = false;
let statusText = "idle";
let logLines = [];
let fields = {};
let connectButton;
let disconnectButton;
let pingButton;
let statusPill;
let logEl;
let connectionTimer = null;
let remoteCandidates = [];
let remoteCandidateIndex = 0;
let scanningRemoteIds = false;
let remoteCandidateResponded = false;

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Helvetica");
  buildUi();
  addLog("ready");
}

function draw() {
  background(channelOpen ? "#10231a" : peerReady ? "#1b2028" : "#131416");

  noStroke();
  fill(channelOpen ? "#75e3a3" : "#d65d5d");
  const pulse = 18 + sin(frameCount * 0.06) * 4;
  circle(width * 0.74, height * 0.42, pulse * 8);

  fill(247);
  textAlign(CENTER, CENTER);
  textSize(22);
  text(channelOpen ? "ESP32 data channel open" : peerReady ? "PeerJS ready" : "PeerJS offline", width * 0.74, height * 0.42);

  textSize(13);
  fill(247, 190);
  text(statusText, width * 0.74, height * 0.42 + 36);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function buildUi() {
  const panel = document.createElement("section");
  panel.className = "peer-panel";

  const configCard = document.createElement("section");
  configCard.className = "peer-card";

  const title = document.createElement("h1");
  title.className = "peer-title";
  title.textContent = "Portal PeerJS ESP32";
  configCard.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "peer-actions";
  configCard.appendChild(actions);

  connectButton = addButton(actions, "Connect to ESP32", connectPeer);
  disconnectButton = addButton(actions, "Disconnect", disconnectPeer, true);
  pingButton = addButton(actions, "Ping", sendPing, true);

  const grid = document.createElement("div");
  grid.className = "peer-grid";
  configCard.appendChild(grid);

  addField(grid, "remoteId", "ESP32 ID");
  addField(grid, "localId", "Browser ID");
  addField(grid, "host", "Host");
  addField(grid, "port", "Port");
  addField(grid, "path", "Path");
  addField(grid, "key", "Key");
  addField(grid, "secure", "Secure");

  const statusCard = document.createElement("section");
  statusCard.className = "peer-card peer-status";

  statusPill = document.createElement("div");
  statusPill.className = "peer-pill";
  statusPill.innerHTML = '<span class="peer-dot"></span><span>Disconnected</span>';
  statusCard.appendChild(statusPill);

  logEl = document.createElement("div");
  logEl.className = "peer-log";
  statusCard.appendChild(logEl);

  panel.appendChild(configCard);
  panel.appendChild(statusCard);
  document.body.appendChild(panel);
  updateUi();
}

function addField(parent, name, labelText) {
  const label = document.createElement("label");
  label.className = "peer-label";
  label.textContent = labelText;
  parent.appendChild(label);

  const input = document.createElement("input");
  input.className = "peer-input";
  input.value = getParam(name, DEFAULTS[name]);
  input.spellcheck = false;
  parent.appendChild(input);
  fields[name] = input;
}

function addButton(parent, label, onClick, secondary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary ? "peer-btn secondary" : "peer-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  parent.appendChild(button);
  return button;
}

function getConfig() {
  return {
    host: fields.host.value.trim(),
    port: Number(fields.port.value.trim()),
    path: fields.path.value.trim() || "/",
    key: fields.key.value.trim() || "peerjs",
    secure: fields.secure.value.trim().toLowerCase() === "true",
    localId: fields.localId.value.trim(),
    remoteId: fields.remoteId.value.trim(),
  };
}

function connectPeer() {
  disconnectPeer();

  const config = getConfig();
  addLog(`target ESP32 ID: ${config.remoteId}`);
  statusText = "connecting to PeerServer";
  peerReady = false;
  channelOpen = false;
  updateUi();

  peer = new Peer(config.localId, {
    host: config.host,
    port: config.port,
    path: config.path,
    key: config.key,
    secure: config.secure,
    debug: 2,
  });
  installPeerResponseTracker(peer);

  peer.on("open", (id) => {
    peerReady = true;
    statusText = `browser peer open as ${id}`;
    addLog(statusText);
    startRemoteScan(config.remoteId);
    updateUi();
  });

  peer.on("connection", attachConnection);
  peer.on("disconnected", () => {
    peerReady = false;
    channelOpen = false;
    statusText = "PeerServer disconnected";
    addLog(statusText);
    updateUi();
  });
  peer.on("close", () => {
    peerReady = false;
    channelOpen = false;
    statusText = "peer closed";
    addLog(statusText);
    updateUi();
  });
  peer.on("error", (error) => {
    statusText = error.message || String(error);
    addLog(`error: ${statusText}`);
    if (isMissingPeerError(statusText)) {
      tryNextRemoteCandidate();
    } else {
      markRemoteCandidateResponded("PeerJS got a response");
    }
    updateUi();
  });
}

function startRemoteScan(remoteId) {
  remoteCandidates = buildRemoteCandidates(remoteId);
  remoteCandidateIndex = 0;
  scanningRemoteIds = true;

  if (remoteCandidates.length === 0) {
    addLog("no ESP32 id set");
    return;
  }

  addLog(`trying ids: ${remoteCandidates.join(", ")}`);
  openDataConnection(remoteCandidates[remoteCandidateIndex]);
}

function buildRemoteCandidates(remoteId) {
  const baseId = remoteId.trim();
  if (!baseId) return [];

  const candidates = [baseId];
  for (let code = 97; code <= 122; code += 1) {
    candidates.push(`${baseId}${String.fromCharCode(code)}`);
  }
  return candidates;
}

function tryNextRemoteCandidate() {
  if (!scanningRemoteIds || channelOpen || remoteCandidateResponded) return;

  clearConnectionTimer();
  if (conn) {
    const previousConn = conn;
    conn = null;
    previousConn.close();
  }

  remoteCandidateIndex += 1;
  if (remoteCandidateIndex >= remoteCandidates.length) {
    scanningRemoteIds = false;
    statusText = "no ESP32 id matched";
    addLog(statusText);
    updateUi();
    return;
  }

  openDataConnection(remoteCandidates[remoteCandidateIndex]);
}

function currentRemoteCandidate() {
  return remoteCandidates[remoteCandidateIndex] || "";
}

function installPeerResponseTracker(nextPeer) {
  if (typeof nextPeer._handleMessage !== "function") return;

  const handleMessage = nextPeer._handleMessage.bind(nextPeer);
  nextPeer._handleMessage = (message) => {
    if (
      scanningRemoteIds &&
      !remoteCandidateResponded &&
      message &&
      message.src === currentRemoteCandidate() &&
      (message.type === "ANSWER" || message.type === "CANDIDATE")
    ) {
      markRemoteCandidateResponded(`ESP32 id responded with ${message.type}`);
    }

    return handleMessage(message);
  };
}

function openDataConnection(remoteId) {
  if (!peer || !remoteId) return;

  remoteCandidateResponded = false;
  statusText = `connecting to ${remoteId}`;
  addLog(statusText);
  attachConnection(peer.connect(remoteId, {
    serialization: "raw",
    reliable: true,
    label: "portal",
  }));
}

function attachConnection(nextConn) {
  if (conn && conn !== nextConn) {
    conn.close();
  }

  conn = nextConn;
  statusText = `data channel negotiating with ${conn.peer}`;
  addLog(statusText);
  clearConnectionTimer();
  connectionTimer = setTimeout(() => {
    if (conn === nextConn && !channelOpen) {
      if (remoteCandidateResponded) {
        addLog(`${nextConn.peer} responded, staying on this id`);
      } else {
        addLog(`no response from ${nextConn.peer} after 12s`);
        tryNextRemoteCandidate();
      }
    }
  }, 12000);
  updateUi();

  conn.on("open", () => {
    if (conn !== nextConn) return;
    clearConnectionTimer();
    channelOpen = true;
    scanningRemoteIds = false;
    remoteCandidateResponded = true;
    statusText = `connected to ${conn.peer}`;
    addLog(statusText);
    conn.send("portal connected");
    updateUi();
  });

  conn.on("data", (data) => {
    if (conn !== nextConn) return;
    addLog(`esp32: ${data}`);
  });

  conn.on("close", () => {
    if (conn !== nextConn) return;
    clearConnectionTimer();
    const wasScanning = scanningRemoteIds && !channelOpen;
    channelOpen = false;
    statusText = "data channel closed";
    addLog(statusText);
    if (wasScanning && !remoteCandidateResponded) {
      tryNextRemoteCandidate();
    }
    updateUi();
  });

  conn.on("error", (error) => {
    if (conn !== nextConn) return;
    clearConnectionTimer();
    channelOpen = false;
    statusText = error.message || String(error);
    addLog(`connection error: ${statusText}`);
    if (isMissingPeerError(statusText)) {
      tryNextRemoteCandidate();
    } else {
      markRemoteCandidateResponded("ESP32 id responded");
    }
    updateUi();
  });
}

function isMissingPeerError(message) {
  return /Could not connect to peer/.test(message);
}

function markRemoteCandidateResponded(reason) {
  if (!scanningRemoteIds || channelOpen || remoteCandidateResponded) return;

  remoteCandidateResponded = true;
  scanningRemoteIds = false;
  clearConnectionTimer();

  if (conn) {
    statusText = `${reason}: ${conn.peer}`;
  } else {
    statusText = reason;
  }

  addLog(statusText);
}

function sendPing() {
  if (!conn || !channelOpen) return;

  const message = `ping ${new Date().toLocaleTimeString()}`;
  conn.send(message);
  addLog(`browser: ${message}`);
}

function disconnectPeer() {
  clearConnectionTimer();
  if (conn) {
    conn.close();
    conn = null;
  }
  if (peer) {
    peer.destroy();
    peer = null;
  }

  peerReady = false;
  channelOpen = false;
  scanningRemoteIds = false;
  remoteCandidateResponded = false;
  remoteCandidates = [];
  remoteCandidateIndex = 0;
  statusText = "idle";
  updateUi();
}

function clearConnectionTimer() {
  if (connectionTimer) {
    clearTimeout(connectionTimer);
    connectionTimer = null;
  }
}

function updateUi() {
  if (!statusPill) return;

  statusPill.classList.toggle("connected", channelOpen);
  statusPill.querySelector("span:last-child").textContent = channelOpen ? "Connected" : peerReady ? "PeerJS Ready" : "Disconnected";
  if (pingButton) pingButton.disabled = !channelOpen;
  if (disconnectButton) disconnectButton.disabled = !peer;
}

function addLog(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logLines.push(line);
  if (logLines.length > 80) logLines.shift();
  if (logEl) {
    logEl.textContent = logLines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function getParam(name, fallback) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value || fallback;
}
