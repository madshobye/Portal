const IMAGE_FOLDER = "assets/images";
const HEARTBEAT_AUDIO = "assets/heartbeat.mp3";
const IMAGE_SKIP = new Set([25, 32]);
const IMAGE_COUNT = 33;

const STEP_MIN = 30;
const STEP_MAX = 110;
const PULSE_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_TRIGGER_OFFSET_SEC = 0.01;
const USE_SILENT_BLUETOOTH_KEEPALIVE = true;
let heartRate;
let heartRateStatus = "idle";
let bpm = 0;
let effectiveBpm = 0;
let rr = [];

let pulseSound = null;
let pulseImages = [];
let sceneLayer;
let imagesReady = false;
let invertFilterEnabled = false;

let autoPulseEnabled = false;
let heartbeatEnabled = true;
let currentImageIndex = 0;
let previousImageIndex = -1;
let rotationValue = 0;
let stepCounter = 0;
let numSteps = 50;
let timer = 0;
let pulseGateOpen = true;
let bpmOffset = 0;
let audioUnlocked = false;
let heartbeatVolume = 0.8;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(30);
  noStroke();
  imageMode(CENTER);

  loadGoogleFont("Roboto Mono");
  textFont("Roboto Mono");

  sceneLayer = createGraphics(windowWidth, windowHeight);
  sceneLayer.imageMode(CENTER);

  await loadScript("portal/heartRateBLE.js");

  heartRate = await new HeartRateBLE({
    autoReconnect: true,
    autoReconnectOnRefresh: true,
    onState: (state) => {
      heartRateStatus = state;
    },
  }).init();

  pulseSound = await loadSoundFile(HEARTBEAT_AUDIO).catch(() => null);
  if (pulseSound) pulseSound.triggerOffsetSec = HEARTBEAT_TRIGGER_OFFSET_SEC;
  setupAudioUnlock();
  pulseImages = await loadPulseImages();
  imagesReady = pulseImages.length > 0;
  currentImageIndex = floor(random(max(1, pulseImages.length)));
  heartbeatEnabled = !!uiGetState("pulse.heartbeat", heartbeatEnabled);
  numSteps = round(uiGetState("pulse.steps", numSteps));
  invertFilterEnabled = !!uiGetState("pulse.invert", invertFilterEnabled);
  bpmOffset = round(uiGetState("pulse.bpmOffset", bpmOffset));
  heartbeatVolume = Number(uiGetState("pulse.volume", heartbeatVolume));
  if (pulseSound) pulseSound.setVolume(heartbeatVolume);

  resetPulseClock();
}

function draw() {
  consumeHeartRate();
  updatePulseEngine();
  renderScene();
  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderUi();
    uiEndUseGraphics();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  sceneLayer = createGraphics(windowWidth, windowHeight);
  sceneLayer.imageMode(CENTER);
}

function keyReleased() {
  if (key === "f" || key === "F") {
    fullScreenToggle();
  }
  if (key === " ") {
    resetPulseClock();
    stepCounter = 0;
  }
}

async function loadPulseImages() {
  const out = [];
  for (let i = 1; i <= IMAGE_COUNT; i++) {
    if (IMAGE_SKIP.has(i)) continue;
    const path = `${IMAGE_FOLDER}/Animation (${i}).png`;
    try {
      const img = await loadImage(path);
      if (img) out.push(img);
    } catch {}
  }
  return out;
}

function consumeHeartRate() {
  if (!heartRate?.hasNewResult()) return;
  const { result } = heartRate.consumeNew();
  bpm = Number(result?.heartRate || 0);
  rr = Array.isArray(result?.rrIntervals) ? result.rrIntervals : [];
  if (bpm > 0) {
    effectiveBpm = max(1, round(bpm + bpmOffset));
    const oldSteps = max(1, numSteps);
    const oldStepLength = PULSE_INTERVAL_MS / oldSteps;
    const elapsedInCurrentStep = constrain(millis() - timer, 0, oldStepLength);
    const stepProgress = elapsedInCurrentStep / oldStepLength;
    const nextSteps = max(1, effectiveBpm);
    if (nextSteps !== numSteps) {
      const progress = stepCounter / max(1, numSteps);
      numSteps = nextSteps;
      stepCounter = floor(progress * numSteps) % max(1, numSteps);
      const newStepLength = PULSE_INTERVAL_MS / max(1, numSteps);
      timer = millis() - stepProgress * newStepLength;
    } else {
      numSteps = nextSteps;
    }
    uiSet("pulse.steps", numSteps);
  } else {
    effectiveBpm = 0;
  }
}

function updatePulseEngine() {
  if (!autoPulseEnabled) return;

  const stepLength = PULSE_INTERVAL_MS / max(1, numSteps);
  if (pulseGateOpen && millis() - timer >= stepLength) {
    pulseGateOpen = false;
    timer += stepLength;
    triggerPulseStep();
    setTimeout(() => {
      nextStep();
    }, 300);
  }
}

function triggerPulseStep() {
  if (heartbeatEnabled && pulseSound && audioUnlocked) {
    try {
      pulseSound.trigger().catch(() => {});
    } catch {}
  }
}

async function ensureAudioUnlocked() {
  if (!pulseSound || audioUnlocked) return audioUnlocked;
  audioUnlocked = await pulseSound.unlock();
  if (audioUnlocked && USE_SILENT_BLUETOOTH_KEEPALIVE) {
    pulseSound.playNothingToKeepBlueToothAlive().catch(() => {});
  }
  return audioUnlocked;
}

function setupAudioUnlock() {
  const unlockAudio = async () => {
    if (!pulseSound || audioUnlocked) return;
    await ensureAudioUnlocked();
    if (audioUnlocked) {
      window.removeEventListener("pointerdown", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
      window.removeEventListener("touchstart", unlockAudio, true);
    }
  };

  window.addEventListener("pointerdown", unlockAudio, true);
  window.addEventListener("keydown", unlockAudio, true);
  window.addEventListener("touchstart", unlockAudio, true);
}

function nextStep() {
  const stepAngle = TWO_PI / max(1, numSteps);
  rotationValue += stepAngle;
  stepCounter = (stepCounter + 1) % max(1, numSteps);
  pulseGateOpen = true;

  if (stepCounter === 0) {
    rotationValue = rotationValue % TWO_PI;
    chooseNextImage();
  }
}

function chooseNextImage() {
  if (pulseImages.length <= 1) return;
  previousImageIndex = currentImageIndex;
  while (currentImageIndex === previousImageIndex) {
    currentImageIndex = floor(random(pulseImages.length));
  }
}

function resetPulseClock() {
  timer = millis();
  pulseGateOpen = true;
}

function renderScene() {
  sceneLayer.background(255);

  if (!imagesReady || !pulseImages.length) {
    background(invertFilterEnabled ? 0 : 255);
    fill(invertFilterEnabled ? 255 : 0);
    textAlign(CENTER, CENTER);
    textSize(22);
    text("Loading pulse drawings...", width * 0.5, height * 0.5);
    return;
  }

  const img = pulseImages[currentImageIndex];
  if (img) {
    const fitScale = min(
      sceneLayer.width / max(1, img.width),
      sceneLayer.height / max(1, img.height)
    );
    const drawW = img.width * fitScale;
    const drawH = img.height * fitScale;

    sceneLayer.push();
    sceneLayer.translate(sceneLayer.width * 0.5, sceneLayer.height * 0.5);
    sceneLayer.rotate(rotationValue);
    sceneLayer.image(img, 0, 0, drawW, drawH);
    sceneLayer.pop();
  }

  background(invertFilterEnabled ? 0 : 255);
  if (invertFilterEnabled) {
    const filtered = sceneLayer.get();
    filtered.filter(INVERT);
    image(filtered, width * 0.5, height * 0.5);
  } else {
    image(sceneLayer, width * 0.5, height * 0.5);
  }
}

function renderUi() {
  const connection = heartRate?.getConnectionState?.() || {};
  const isConnected = !!connection.connected;
  const isConnecting = !!connection.connecting;
  const canRefreshReconnect = typeof navigator?.bluetooth?.getDevices === "function";

  uiListStart({ x: 20, y: 20, width: 260, dir: "vertical" });
  uiText("Pulse Drawings", { fontSize: 20, hAlign: "center", bgColor: "#eaeaea" });

  const connectButton = uiButton("Connect Pulse");
  if (connectButton.clicked) {
    ensureAudioUnlocked().catch(() => {});
    heartRate.connect().catch((err) => {
      heartRateStatus = err?.message || "connect failed";
    });
  }

  if (isConnecting) {
    uiText("Pulse: connecting...", { bgColor: "#fff1cc", hAlign: "center" });
  } else if (isConnected) {
    uiText(`Pulse connected${connection.deviceName ? `: ${connection.deviceName}` : ""}`, {
      bgColor: "#dcefd9",
      hAlign: "center",
    });
  } else if (!canRefreshReconnect) {
    uiText("Refresh reconnect unsupported here", {
      bgColor: "#f2e3bf",
      hAlign: "center",
    });
  }

  const nextAutoPulseEnabled = uiToggle("pulse.autoPulse", "Start Pulse", {
    onBgColor: "#dcefd9",
    offBgColor: "#d0d0d0",
  }).value;
  if (nextAutoPulseEnabled !== autoPulseEnabled) {
    if (nextAutoPulseEnabled) ensureAudioUnlocked().catch(() => {});
    autoPulseEnabled = nextAutoPulseEnabled;
    resetPulseClock();
  }

  const pulseOnceButton = uiButton("Pulse Once");
  if (pulseOnceButton.clicked) {
    ensureAudioUnlocked().catch(() => {});
    triggerPulseStep();
    nextStep();
    resetPulseClock();
  }

  heartbeatEnabled = uiToggle("pulse.heartbeat", "Heartbeat Audio", {
    onBgColor: "#dcefd9",
    offBgColor: "#d0d0d0",
  }).value;

  heartbeatVolume = uiSlider("pulse.volume", "Volume", {
    min: 0,
    max: 1,
    init: heartbeatVolume,
  }).value;
  if (pulseSound) pulseSound.setVolume(heartbeatVolume);

  invertFilterEnabled = uiToggle("pulse.invert", "Invert Drawing", {
    onBgColor: "#d7e7ff",
    offBgColor: "#d0d0d0",
  }).value;

  bpmOffset = round(uiSlider("pulse.bpmOffset", "BPM Offset", {
    min: -20,
    max: 20,
    init: bpmOffset,
  }).value);

  numSteps = round(uiSlider("pulse.steps", "Steps", {
    min: STEP_MIN,
    max: STEP_MAX,
    init: numSteps,
  }).value);

  uiListEnd();

  fill(0);
  textSize(15);
  textAlign(LEFT, TOP);
  text(`status: ${heartRateStatus}`, 300, 20);
  text(`connection: ${isConnected ? "connected" : isConnecting ? "connecting" : "disconnected"}`, 300, 42);
  text(`refresh reconnect: ${canRefreshReconnect ? "available" : "not available"}`, 300, 64);
  text(`bpm: ${bpm || "-"}`, 300, 86);
  text(`effective bpm: ${effectiveBpm || "-"}`, 300, 108);
  text(`offset: ${bpmOffset >= 0 ? "+" : ""}${bpmOffset}`, 300, 130);
  text(`audio: ${audioUnlocked ? "unlocked" : "tap a control after refresh"}`, 300, 152);
  text(`volume: ${nf(heartbeatVolume, 1, 2)}`, 300, 174);
  text(`rr count: ${rr.length}`, 300, 196);
  text(`frame: ${currentImageIndex + 1}/${pulseImages.length}`, 300, 218);
  text(`step: ${stepCounter}/${numSteps}`, 300, 240);
  text(`invert: ${invertFilterEnabled ? "on" : "off"}`, 300, 262);
}
