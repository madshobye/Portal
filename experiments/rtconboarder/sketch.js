const RTC_ONBOARDER_VERSION = 1;
const MQTT_BROKER = "wss://public:public@public.cloud.shiftr.io";

const TOPICS = {
  invitations: "portal/rtcchat/invitations",
  listRequest: "portal/rtcchat/list/request",
  listResponse: "portal/rtcchat/list/response",
};

let mqttClient;
let onboarderId = `rtconboarder-${Math.random().toString(36).slice(2, 10)}`;
let statusText = "Booting MQTT...";
let invitations = [];
let lastIncoming = "-";
let testCounter = 1;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  textSize(16);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/mqtt.js");

  mqttClient = await new PortalMqtt({
    broker: MQTT_BROKER,
    clientId: onboarderId,
    onConnect: () => {
      statusText = "Connected. Listening for RTC invitations.";
    },
    onDisconnect: () => {
      statusText = "Disconnected from MQTT.";
    },
    onError: (error) => {
      statusText = `MQTT error: ${error?.message || error}`;
    },
  }).init();

  await mqttClient.subscribe(TOPICS.invitations);
  await mqttClient.subscribe(TOPICS.listRequest);
}

function draw() {
  background("#0c1016");
  drawGlow();
  drawHeader();
  drawButtons();
  drawInvitations();
  processIncomingMqtt();
}

function drawHeader() {
  const x = 20;
  const y = 20;
  const w = min(width - 40, 760);

  uiText(`RTC Onboarder v${RTC_ONBOARDER_VERSION}`, {
    x,
    y,
    width: w,
    height: 34,
    bgColor: "#f3f4f6",
    textColor: "#111111",
    hAlign: "center",
  });

  uiText(statusText, {
    x,
    y: y + 42,
    width: w,
    height: 54,
    bgColor: "#dbeafe",
    textColor: "#111111",
  });

  uiText(`MQTT: ${mqttClient?.connected ? "connected" : "connecting"}   Last: ${lastIncoming}`, {
    x,
    y: y + 104,
    width: w,
    height: 34,
    bgColor: "#e5e7eb",
    textColor: "#111111",
  });
}

function drawButtons() {
  const x = 20;
  const y = 168;
  const w = min(width - 40, 760);

  const publishBtn = uiButton("Publish Test Invitation", {
    x,
    y,
    width: 240,
    height: 40,
    persist: false,
  });
  if (publishBtn.clicked) {
    publishTestInvitation();
  }

  const respondBtn = uiButton("Publish Current List", {
    x: x + 252,
    y,
    width: 220,
    height: 40,
    persist: false,
  });
  if (respondBtn.clicked) {
    publishInvitationList(TOPICS.listResponse);
  }

  const clearBtn = uiButton("Clear Local List", {
    x: x + 484,
    y,
    width: min(200, w - 484),
    height: 40,
    persist: false,
  });
  if (clearBtn.clicked) {
    invitations = [];
    statusText = "Local invitation list cleared.";
  }
}

function drawInvitations() {
  const x = 20;
  const startY = 228;
  const w = min(width - 40, 760);
  const rowH = 34;

  uiText(`Invitations (${invitations.length})`, {
    x,
    y: startY,
    width: w,
    height: 30,
    bgColor: "#f3f4f6",
    textColor: "#111111",
    hAlign: "center",
  });

  const visible = invitations.slice(-10).reverse();
  for (let i = 0; i < visible.length; i++) {
    const invite = visible[i];
    const y = startY + 40 + i * (rowH + 8);
    const when = new Date(invite.seenAt || Date.now()).toLocaleTimeString();
    uiText(
      `${invite.sessionId || "no-session"}  ${invite.label || invite.name || "unnamed"}  ${when}`,
      {
        x,
        y,
        width: w,
        height: rowH,
        bgColor: "#eef2ff",
        textColor: "#111111",
      }
    );
  }
}

function processIncomingMqtt() {
  while (mqttClient?.hasNewResult()) {
    const { result } = mqttClient.consumeNew();
    if (!result) return;

    lastIncoming = `${result.topic}`;
    let data = null;
    try {
      data = JSON.parse(result.message);
    } catch {
      data = { raw: result.message };
    }

    if (result.topic === TOPICS.invitations) {
      registerInvitation(data);
      continue;
    }

    if (result.topic === TOPICS.listRequest) {
      const replyTopic = data?.replyTopic || TOPICS.listResponse;
      publishInvitationList(replyTopic);
    }
  }
}

function registerInvitation(data) {
  const sessionId = String(data?.sessionId || data?.id || "").trim();
  if (!sessionId) {
    statusText = "Ignored invitation without sessionId.";
    return;
  }

  const existingIndex = invitations.findIndex((entry) => entry.sessionId === sessionId);
  const invite = {
    sessionId,
    label: data?.label || data?.name || "RTC session",
    payload: data,
    seenAt: Date.now(),
  };

  if (existingIndex >= 0) {
    invitations[existingIndex] = invite;
    statusText = `Updated invitation ${sessionId}.`;
  } else {
    invitations.push(invite);
    statusText = `Stored invitation ${sessionId}.`;
  }
}

async function publishInvitationList(replyTopic) {
  if (!mqttClient?.connected) {
    statusText = "MQTT not connected.";
    return;
  }

  const payload = {
    type: "rtcchat-invitation-list",
    onboarderId,
    invitations: invitations.map((entry) => ({
      sessionId: entry.sessionId,
      label: entry.label,
      seenAt: entry.seenAt,
    })),
    sentAt: Date.now(),
  };

  await mqttClient.publish(replyTopic, JSON.stringify(payload));
  statusText = `Published ${invitations.length} invitations to ${replyTopic}.`;
}

async function publishTestInvitation() {
  if (!mqttClient?.connected) {
    statusText = "MQTT not connected.";
    return;
  }

  const payload = {
    type: "rtcchat-invitation",
    sessionId: `test-${testCounter}`,
    label: `Test Session ${testCounter}`,
    sentAt: Date.now(),
    sender: onboarderId,
  };
  testCounter += 1;

  await mqttClient.publish(TOPICS.invitations, JSON.stringify(payload));
  statusText = `Published test invitation ${payload.sessionId}.`;
}

function drawGlow() {
  noStroke();
  fill(38, 99, 235, 45);
  circle(width * 0.18, height * 0.2, min(width, height) * 0.34);
  fill(16, 185, 129, 45);
  circle(width * 0.78, height * 0.74, min(width, height) * 0.42);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
