const MQTTDEBUG_VERSION = 1;
const MQTT_BROKER = "wss://public:public@public.cloud.shiftr.io";
const DEBUG_TOPIC = "portal/rtcchat/debug";

let mqttClient = null;
let statusText = "Booting debug console...";
let appEl;
let panelEl;
let statusCardEl;
let statusTextEl;
let actionsEl;
let consoleCardEl;
let consoleEl;
let lines = [];
let pollTimer = null;

async function setup() {
  noCanvas();
  await loadScript("portal/mqtt.js");
  buildUi();
  renderUi();

  mqttClient = await new PortalMqtt({
    broker: MQTT_BROKER,
    clientId: `mqttdebug-${Math.random().toString(36).slice(2, 10)}`,
    autoConnect: false,
    onConnect: () => {
      statusText = "MQTT connected. Listening for rtcchat debug.";
      renderUi();
    },
    onDisconnect: () => {
      statusText = "MQTT disconnected.";
      renderUi();
    },
    onError: (error) => {
      statusText = `MQTT error: ${error?.message || error}`;
      renderUi();
    },
  }).init();

  await mqttClient.connect();
  await mqttClient.subscribe(DEBUG_TOPIC);
  ensurePolling();
}

function buildUi() {
  appEl = document.createElement("div");
  appEl.className = "mqttdebug-app";

  panelEl = document.createElement("div");
  panelEl.className = "mqttdebug-panel";

  statusCardEl = document.createElement("section");
  statusCardEl.className = "mqttdebug-card mqttdebug-status";

  statusTextEl = document.createElement("p");
  statusTextEl.className = "mqttdebug-text";
  statusCardEl.appendChild(statusTextEl);

  actionsEl = document.createElement("div");
  actionsEl.className = "mqttdebug-actions";
  statusCardEl.appendChild(actionsEl);

  consoleCardEl = document.createElement("section");
  consoleCardEl.className = "mqttdebug-card mqttdebug-console";

  consoleEl = document.createElement("div");
  consoleCardEl.appendChild(consoleEl);

  panelEl.appendChild(statusCardEl);
  panelEl.appendChild(consoleCardEl);
  appEl.appendChild(panelEl);
  document.body.appendChild(appEl);
}

function renderUi() {
  if (!statusTextEl || !actionsEl) return;
  statusTextEl.textContent = `v${MQTTDEBUG_VERSION}  ${statusText}  Messages: ${lines.length}`;

  actionsEl.innerHTML = "";
  appendAction("Clear", clearMessages, true);
}

function appendAction(label, onClick, secondary = false) {
  const button = document.createElement("button");
  button.className = secondary ? "mqttdebug-btn secondary" : "mqttdebug-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actionsEl.appendChild(button);
}

function clearMessages() {
  lines = [];
  renderLines();
  renderUi();
}

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(processIncoming, 80);
}

function processIncoming() {
  while (mqttClient?.hasNewResult()) {
    const { result } = mqttClient.consumeNew();
    if (!result?.message) return;

    let payload;
    try {
      payload = JSON.parse(result.message);
    } catch {
      continue;
    }

    const line = [
      payload.t || new Date().toISOString(),
      payload.self || "-",
      payload.event || "-",
      payload.room || "-",
      stringifyCompact(payload),
    ].join("  ");

    lines.push(line);
    if (lines.length > 300) {
      lines = lines.slice(lines.length - 300);
    }
    renderLines();
    renderUi();
  }
}

function renderLines() {
  if (!consoleEl) return;
  consoleEl.innerHTML = "";
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "mqttdebug-line";
    row.textContent = line;
    consoleEl.appendChild(row);
  }
  consoleCardEl.scrollTop = consoleCardEl.scrollHeight;
}

function stringifyCompact(payload) {
  const rest = { ...payload };
  delete rest.t;
  delete rest.self;
  delete rest.event;
  delete rest.room;
  const entries = Object.entries(rest);
  return entries.map(([key, value]) => `${key}=${value}`).join(" ");
}
