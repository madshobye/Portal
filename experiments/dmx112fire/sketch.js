const SEGMENTS = 28;
const DMX_CHANNELS = SEGMENTS * 4;
const SOURCE_W = 448;
const SOURCE_H = 192;
let fire, worker, connectButton;
let workerReady = false, previewPending = false, serialAvailable = false;
let connected = false, connecting = false, dmxStatus = "Loading…", shaderError = "";
let lastSettings = "";
let testColor = 0;
let mode = 0, paused = false, blackout = false, reversed = false;
let speed = 0.7, brightness = 0.8, wind = 0.15, sampleHeight = 0.4, whiteMix = 0;
const output = new Array(DMX_CHANNELS).fill(0);
const colors = Array.from({ length: SEGMENTS }, () => [0, 0, 0, 0]);

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  frameRate(30);
  textFont("monospace");
  fire = createImage(SOURCE_W, SOURCE_H);
  connectButton = createButton("Connect DMX");
  connectButton.class("dmx-connect");
  connectButton.elt.addEventListener("click", connectDmx);
  connectButton.elt.disabled = true;
  try {
    worker = new Worker("fire-worker.js");
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        workerReady = true;
        serialAvailable = data.serialAvailable;
        connectButton.elt.disabled = !serialAvailable;
        publishSettings();
      } else if (data.type === "status") {
        dmxStatus = data.status;
        connected = data.connected;
        connecting = data.status === "Connecting…";
        connectButton.elt.disabled = !workerReady || !serialAvailable || connected || connecting;
      } else if (data.type === "preview") {
        previewPending = false;
        fire.loadPixels();
        fire.pixels.set(data.pixels);
        fire.updatePixels();
        for (let i = 0; i < DMX_CHANNELS; i++) output[i] = data.output[i];
        for (let i = 0; i < SEGMENTS; i++) colors[i] = output.slice(i * 4, i * 4 + 4);
      } else if (data.type === "connection-error") {
        console.error("DMX:", data.message);
      } else if (data.type === "fatal") {
        workerFailed(data.message);
      }
    };
    worker.onerror = event => workerFailed(event.message || "Background worker failed");
    // Let the latest settings reach the worker before the page goes into the background.
    document.addEventListener("visibilitychange", publishSettings);
  } catch (err) { workerFailed(err.message); }
}

function workerFailed(message) {
  shaderError = message;
  workerReady = false;
  connected = false;
  connecting = false;
  previewPending = false;
  connectButton.elt.disabled = true;
  worker?.terminate();
}

async function connectDmx() {
  if (!workerReady || !serialAvailable || connected || connecting) return;
  connecting = true;
  dmxStatus = "Connecting…";
  connectButton.elt.disabled = true;
  try {
    // Permission must be requested by the page's user gesture. The worker opens it.
    const port = await navigator.serial.requestPort();
    worker.postMessage({ type: "connect", info: port.getInfo() });
  } catch (err) {
    connecting = false;
    dmxStatus = err.name === "NotFoundError" ? "Not connected" : "Connection failed";
    connectButton.elt.disabled = false;
  }
}

function publishSettings() {
  if (!workerReady) return;
  const settings = { mode, paused, blackout, reversed, testColor, speed, brightness, wind, sampleHeight, whiteMix };
  const signature = JSON.stringify(settings);
  if (signature === lastSettings) return;
  lastSettings = signature;
  worker.postMessage({ type: "settings", settings });
}

function draw() {
  background("#100c0b");
  noStroke();
  const pad = 20;
  const w = width - pad * 2;
  fill("#ffe9cc"); textSize(21);
  text("FIRE / 28", pad, 32);
  textSize(11); fill("#bca68e");
  text("112 CH · RGBW · fixture A001 / 112H", pad, 53);

  renderControls(pad, w);
  const y = 238;
  const h = Math.max(80, height - y - 145);
  image(fire, pad, y, w, h);
  publishSettings();
  if (workerReady && !previewPending && !document.hidden) {
    previewPending = true;
    worker.postMessage({ type: "preview" });
  }

  // Mark the exact band whose pixels are averaged into the fixture sections.
  const band = samplingBand();
  const bandY = y + band.top / SOURCE_H * h;
  const bandH = (band.bottom - band.top) / SOURCE_H * h;
  stroke(255, 210, 155, 110); strokeWeight(1);
  for (let i = 0; i <= SEGMENTS; i++) {
    const x = pad + i * w / SEGMENTS;
    line(x, bandY, x, bandY + bandH);
  }
  noFill(); stroke("#ffe6bc"); rect(pad, bandY, w, bandH);
  noStroke(); fill("#bca68e"); textSize(11);
  text("SHADER → average each outlined section → RGBW", pad, y - 10);
  renderOutput(pad, y + h + 26, w);
  fill(shaderError || dmxStatus.includes("failed") ? "#ff9b80" : "#bca68e");
  textSize(11);
  text(shaderError || dmxStatus, pad, y + h + 109, w, 35);
}

function samplingBand() {
  const center = Math.round((1 - sampleHeight) * SOURCE_H);
  return { top: Math.max(0, center - 10), bottom: Math.min(SOURCE_H, center + 10) };
}

function renderOutput(x, y, w) {
  fill("#ffe9cc"); textSize(11);
  text(`DMX VALUES · ${blackout ? "BLACKOUT" : testColor ? "SOLID TEST" : "FIRE"} · ${reversed ? "REVERSED" : "LEFT → RIGHT"}`, x, y - 8);
  for (let i = 0; i < SEGMENTS; i++) {
    const [r, g, b, white] = colors[i];
    fill(r + white, g + white, b + white);
    rect(x + i * w / SEGMENTS, y, w / SEGMENTS - 2, 35, 3);
    fill("#bca68e"); textSize(9);
    if (w > 700 || i % 4 === 0) text(i + 1, x + i * w / SEGMENTS, y + 49);
  }
  const selected = constrain(Math.floor((mouseX - x) / w * SEGMENTS), 0, SEGMENTS - 1);
  const [r, g, b, white] = colors[selected];
  fill("#bca68e"); textSize(11);
  text(`Section ${selected + 1} · CH ${selected * 4 + 1}–${selected * 4 + 4} · R ${r}  G ${g}  B ${b}  W ${white}`, x, y + 69);
}

function renderControls(x, w) {
  const buttonW = (w - 18) / 4;
  const button = (label, col, row, active = false) => uiButton(label, {
    x: x + col * (buttonW + 6), y: 66 + row * 34, width: buttonW, height: 28,
    fontSize: 11, rounding: 6, bgColor: active ? "#fca34b" : "#30241d",
    textColor: active ? "#160d07" : "#ffe9cc",
  }).clicked;
  ["Fire", "Embers", "Blue flame"].forEach((name, i) => {
    if (button(name, i, 0, mode === i)) mode = i;
  });
  connectButton?.position(x + 3 * (buttonW + 6), 66);
  connectButton?.size(buttonW, 28);
  connectButton?.html(connected ? "Connected" : connecting ? "Connecting…" : "Connect DMX");
  if (button(paused ? "Resume" : "Pause", 0, 1, paused)) paused = !paused;
  if (button("Reverse", 1, 1, reversed)) reversed = !reversed;
  if (button("Blackout", 2, 1, blackout)) blackout = !blackout;
  if (button("Disconnect", 3, 1) && workerReady && !connecting) {
    connecting = true;
    dmxStatus = "Disconnecting…";
    worker.postMessage({ type: "disconnect" });
  }
  const slider = (id, label, value, min, max, col, row) => Number(uiSlider(
    `dmx112fire.${id}`, label, { min, max, init: value }, {
      x: x + col * (w + 12) / 3, y: 140 + row * 36,
      width: (w - 24) / 3, height: 28, fontSize: 11, rounding: 5,
      trackColor: "#30241d", fillColor: "#a95121", textColor: "#ffe9cc",
    }).value);
  speed = slider("speed", "Speed", speed, 0.05, 2, 0, 0);
  brightness = slider("brightness", "Brightness", brightness, 0, 1, 1, 0);
  wind = slider("wind", "Wind", wind, -1, 1, 2, 0);
  sampleHeight = slider("height", "Sample height", sampleHeight, 0.06, 0.94, 0, 1);
  whiteMix = slider("white", "White mix", whiteMix, 0, 1, 1, 1);
  if (uiButton(["Test: off", "Test: red", "Test: green", "Test: blue", "Test: white"][testColor], {
    x: x + 2 * (w + 12) / 3, y: 176, width: (w - 24) / 3, height: 28,
    fontSize: 11, rounding: 5, bgColor: testColor ? "#fca34b" : "#30241d",
    textColor: testColor ? "#160d07" : "#ffe9cc",
  }).clicked) testColor = (testColor + 1) % 5;
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }
