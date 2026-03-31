let bridge;
let mode = "idle";
let statusText = "Preparing service worker and push.";
let messages = [];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  textSize(16);

  await loadScript("portal/uiSlim2.js");
  await loadScript("webpush.js");

  bridge = new BrowserWebPushBridge({
    onEvent: handleBridgeEvent,
  });
  await bridge.init();
}

function draw() {
  background("#111317");
  drawBackgroundGlow();
  drawUi();
  drawMessages();
}

function drawUi() {
  const panelX = 20;
  const panelY = 20;
  const panelW = min(360, width - 40);

  uiText("Web Notifications", {
    x: panelX,
    y: panelY,
    width: panelW,
    height: 36,
    bgColor: "#f3f4f6",
    textColor: "#111111",
    hAlign: "center",
  });

  uiText(`Mode: ${mode}`, {
    x: panelX,
    y: panelY + 44,
    width: panelW,
    height: 30,
    bgColor: "#e5e7eb",
    textColor: "#111111",
  });

  uiText(statusText, {
    x: panelX,
    y: panelY + 82,
    width: panelW,
    height: 58,
    bgColor: "#dbeafe",
    textColor: "#111111",
  });

  const rowY = panelY + 150;
  if (uiButton("Server", {
    x: panelX,
    y: rowY,
    width: (panelW - 10) / 2,
    persist: false,
  }).clicked) {
    setMode("server");
  }

  if (uiButton("Client", {
    x: panelX + (panelW + 10) / 2,
    y: rowY,
    width: (panelW - 10) / 2,
    persist: false,
  }).clicked) {
    setMode("client");
  }

  let y = rowY + 44;

  if (mode === "client") {
    if (uiButton("Subscribe", {
      x: panelX,
      y,
      width: panelW,
      persist: false,
    }).clicked) {
      bridge.subscribeClient();
    }
    y += 44;

    if (uiButton("Allow Notifications", {
      x: panelX,
      y,
      width: panelW,
      persist: false,
    }).clicked) {
      bridge.requestNotificationPermission();
    }
    y += 44;

    if (uiButton("Clear Subscription", {
      x: panelX,
      y,
      width: panelW,
      persist: false,
    }).clicked) {
      bridge.clearSubscription();
    }
  }

  if (mode === "server") {
    if (uiButton("Send Push Trigger", {
      x: panelX,
      y,
      width: panelW,
      bgColor: "#22c55e",
      persist: false,
    }).clicked) {
      bridge.sendTrigger();
    }
  }

  y += 52;
  uiText("Messages", {
    x: panelX,
    y,
    width: panelW,
    height: 30,
    bgColor: "#f3f4f6",
    textColor: "#111111",
    hAlign: "center",
  });
}

function drawMessages() {
  const panelX = 20;
  const panelY = 320;
  const panelW = min(520, width - 40);
  const lineH = 28;

  for (let i = 0; i < min(messages.length, 8); i++) {
    const entry = messages[messages.length - 1 - i];
    const y = panelY + i * (lineH + 8);
    uiText(`${entry.kind}: ${entry.text}`, {
      x: panelX,
      y,
      width: panelW,
      height: lineH,
      bgColor: entry.kind === "trigger" ? "#dcfce7" : "#f3f4f6",
      textColor: "#111111",
    });
  }
}

function setMode(nextMode) {
  mode = nextMode;
  bridge.disconnect();
  bridge.connect(nextMode);
  statusText = nextMode === "server"
    ? "Server ready. Send a push trigger when a client has subscribed."
    : "Client ready. Grant notifications, then subscribe.";
}

function handleBridgeEvent(event) {
  if (event.type === "status" || event.type === "peer") {
    statusText = event.text;
    return;
  }

  if (event.type === "sent") {
    statusText = "Push trigger sent.";
    messages.push({ kind: "sent", text: event.text });
    return;
  }

  if (event.type === "trigger") {
    statusText = "Push trigger received.";
    messages.push({ kind: "trigger", text: event.text });
  }

  if (event.type === "subscribed") {
    statusText = "Client subscribed for push trigger.";
  }
}

function drawBackgroundGlow() {
  noStroke();
  fill(38, 99, 235, 55);
  circle(width * 0.18, height * 0.22, min(width, height) * 0.38);
  fill(16, 185, 129, 55);
  circle(width * 0.82, height * 0.76, min(width, height) * 0.44);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
