const DMX_CHANNELS = 16;

let dmx;
let dmxState = "idle";
let dmxError = "";
let frameIntervalMs = 33;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(30);
  noStroke();

  await loadScript("portal/dmxSerial.js");

  dmx = await new DmxSerial({
    channels: DMX_CHANNELS,
    autoReconnect: true,
    autoReconnectOnRefresh: true,
    autoStream: true,
    frameIntervalMs,
    onState: (state) => {
      dmxState = state;
      dmxError = "";
    },
    onError: (err) => {
      dmxError = err?.message || String(err || "dmx error");
    },
  }).init();

  restorePersistedChannels();
  dmx.setFrameInterval(frameIntervalMs);
  dmx.startOutput();
}

function draw() {
  background("#000814");
  syncOutputState();
  renderChannels();
  renderConnectButton();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function restorePersistedChannels() {
  if (!dmx) return;
  for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
    const key = channelKey(ch);
    const value = Number(uiGetState(key, 0));
    dmx.setChannel(ch, constrain(round(value), 0, 255));
  }
}

function syncOutputState() {
  if (!dmx) return;
  dmx.setFrameInterval(frameIntervalMs);
  dmx.startOutput();
}

function renderChannels() {
  const pad = 18;
  const top = 58;
  const gap = 14;
  const cols = 8;
  const rows = 2;
  const cardW = (width - pad * 2 - gap * (cols - 1)) / cols;
  const cardH = (height - top - pad - gap * (rows - 1)) / rows;

  for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
    const index = ch - 1;
    const col = index % cols;
    const row = floor(index / cols);
    const x = pad + col * (cardW + gap);
    const y = top + row * (cardH + gap);
    renderChannelCard(ch, x, y, cardW, cardH);
  }
}

function renderChannelCard(ch, x, y, w, h) {
  const currentValue = Number(dmx?.getChannel?.(ch) || 0);
  const base = color("#001d3d");
  const accent = currentValue > 170
    ? color("#ffd60a")
    : currentValue > 70
      ? color("#ffc300")
      : color("#003566");
  const shell = lerpColor(base, color("#003566"), currentValue / 255);

  fill(shell);
  rect(x, y, w, h, 22);
  fill("#000814");
  rect(x + 8, y + 8, w - 16, h - 16, 18);

  const value = Number(
    uiSlider(channelKey(ch), ``, {
      min: 0,
      max: 255,
      init: dmx?.getChannel?.(ch) || 0,
    }, {
      x: x + 18,
      y: y + 18,
      width: w - 36,
      height: h - 36,
      vertical: true,
      hideText: true,
      rounding: 14,
      trackColor: "#001d3d",
      fillColor: accent,
    }).value
  );

  dmx?.setChannel(ch, value);
}

function renderConnectButton() {
  if (dmx?.connected || dmx?.connecting) return;

  const label = dmxState === "requesting_port" ? "Connecting" : "Connect";
  if (
    uiButton(label, {
      x: width - 104,
      y: 14,
      width: 88,
      height: 28,
      fontSize: 12,
      rounding: 9,
      bgColor: dmxError ? "#ffc300" : "#ffd60a",
      textColor: "#000814",
    }).clicked
  ) {
    dmx?.connect().catch((err) => {
      dmxError = err?.message || String(err || "connect failed");
    });
  }
}

function channelKey(ch) {
  return `dmx16touch.ch${ch}`;
}

function setChannelValue(ch, value) {
  const v = constrain(round(value), 0, 255);
  uiSetState(channelKey(ch), v);
  dmx?.setChannel(ch, v);
}

function setAllChannels(value) {
  for (let ch = 1; ch <= DMX_CHANNELS; ch++) {
    setChannelValue(ch, value);
  }
}
