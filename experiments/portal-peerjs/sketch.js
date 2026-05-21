const DEFAULTS = {
  host: "0.peerjs.com",
  port: "443",
  path: "/",
  key: "peerjs",
  secure: "true",
  localId: `portal-${Math.floor(Math.random() * 10000)}`,
  remoteId: "printhost-esp32",
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

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("Helvetica");
  buildUi();
  log("ready");
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

  const grid = document.createElement("div");
  grid.className = "peer-grid";
  configCard.appendChild(grid);

  addField(grid, "host", "Host");
  addField(grid, "port", "Port");
  addField(grid, "path", "Path");
  addField(grid, "key", "Key");
  addField(grid, "secure", "Secure");
  addField(grid, "localId", "Browser ID");
  addField(grid, "remoteId", "ESP32 ID");

  const actions = document.createElement("div");
  actions.className = "peer-actions";
  configCard.appendChild(actions);

  connectButton = addButton(actions, "Connect", connectPeer);
  disconnectButton = addButton(actions, "Disconnect", disconnectPeer, true);
  pingButton = addButton(actions, "Ping", sendPing, true);

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

  peer.on("open", (id) => {
    peerReady = true;
    statusText = `browser peer open as ${id}`;
    log(statusText);
    openDataConnection(config.remoteId);
    updateUi();
  });

  peer.on("connection", attachConnection);
  peer.on("disconnected", () => {
    peerReady = false;
    channelOpen = false;
    statusText = "PeerServer disconnected";
    log(statusText);
    updateUi();
  });
  peer.on("close", () => {
    peerReady = false;
    channelOpen = false;
    statusText = "peer closed";
    log(statusText);
    updateUi();
  });
  peer.on("error", (error) => {
    statusText = error.message || String(error);
    log(`error: ${statusText}`);
    updateUi();
  });
}

function openDataConnection(remoteId) {
  if (!peer || !remoteId) return;

  statusText = `connecting to ${remoteId}`;
  log(statusText);
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
  updateUi();

  conn.on("open", () => {
    channelOpen = true;
    statusText = `connected to ${conn.peer}`;
    log(statusText);
    conn.send("portal connected");
    updateUi();
  });

  conn.on("data", (data) => {
    log(`esp32: ${data}`);
  });

  conn.on("close", () => {
    channelOpen = false;
    statusText = "data channel closed";
    log(statusText);
    updateUi();
  });

  conn.on("error", (error) => {
    channelOpen = false;
    statusText = error.message || String(error);
    log(`connection error: ${statusText}`);
    updateUi();
  });
}

function sendPing() {
  if (!conn || !channelOpen) return;

  const message = `ping ${new Date().toLocaleTimeString()}`;
  conn.send(message);
  log(`browser: ${message}`);
}

function disconnectPeer() {
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
  statusText = "idle";
  updateUi();
}

function updateUi() {
  if (!statusPill) return;

  statusPill.classList.toggle("connected", channelOpen);
  statusPill.querySelector("span:last-child").textContent = channelOpen ? "Connected" : peerReady ? "PeerJS Ready" : "Disconnected";
  if (pingButton) pingButton.disabled = !channelOpen;
  if (disconnectButton) disconnectButton.disabled = !peer;
}

function log(message) {
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
