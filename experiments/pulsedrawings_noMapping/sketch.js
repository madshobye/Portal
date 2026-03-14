const IMAGE_FOLDER = "assets/images";
const HEARTBEAT_AUDIO = "assets/heartbeat.mp3";
const IMAGE_SKIP = new Set([25, 32]);
const IMAGE_COUNT = 33;

const STEP_MIN = 30;
const STEP_MAX = 110;
const PULSE_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_TRIGGER_OFFSET_SEC = 0.01;
const USE_SILENT_BLUETOOTH_KEEPALIVE = true;
const SURFACE_W = 1920;
const SURFACE_H = 1080;
const PLANE_COUNT_STORAGE_KEY = "pulsedrawings:planeCount";
const MIN_PLANES = 1;
const MAX_PLANES = 1;

let heartRate;
let heartRateStatus = "idle";
let bpm = 0;
let effectiveBpm = 0;
let rr = [];

let pulseSound = null;
let pulseImages = [];
let planes = [];
let mapper;
let imagesReady = false;
let invertFilterEnabled = false;

let autoPulseEnabled = false;
let heartbeatEnabled = true;
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
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    textFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    textFont(baseFont);
  }

  await loadScript("portal/heartRateBLE.js");
  await loadScript("portal/noMappingMapper.js");

  mapper = new ProjectionMapper();
  mapper.followDebugOverlayVisibility(true);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }

  const storedPlaneCount = getStoredPlaneCount();
  for (let i = 0; i < storedPlaneCount; i++) addPlane(false);
  mapper.loadAll();

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
  randomizeAllPlaneImages();
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
  background(invertFilterEnabled ? 0 : 255);
  mapper?.render();
  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderUi();
    uiEndUseGraphics();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
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

function getStoredPlaneCount() {
  try {
    const raw = Number(localStorage.getItem(PLANE_COUNT_STORAGE_KEY));
    if (Number.isFinite(raw)) return constrain(round(raw), MIN_PLANES, MAX_PLANES);
  } catch {}
  return MIN_PLANES;
}

function setStoredPlaneCount(count) {
  try {
    localStorage.setItem(
      PLANE_COUNT_STORAGE_KEY,
      String(constrain(round(count), MIN_PLANES, MAX_PLANES))
    );
  } catch {}
}

function planeName(index) {
  return `pulse_drawings_surface_${index + 1}`;
}

function randomImageIndex() {
  return floor(random(max(1, pulseImages.length)));
}

function createPlane(index) {
  const surface = mapper.add(SURFACE_W, SURFACE_H, planeName(index));
  surface.imageMode(CENTER);
  const buffer = createGraphics(SURFACE_W, SURFACE_H);
  buffer.imageMode(CENTER);
  return {
    name: planeName(index),
    surface,
    buffer,
    currentImageIndex: randomImageIndex(),
    previousImageIndex: -1,
  };
}

function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const plane = createPlane(planes.length);
  planes.push(plane);
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function removePlane(persist = true) {
  if (!mapper || planes.length <= MIN_PLANES) return false;
  mapper.removeLastSurface({ clearStorage: true });
  planes.pop();
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function randomizeAllPlaneImages() {
  for (const plane of planes) {
    plane.currentImageIndex = randomImageIndex();
    plane.previousImageIndex = -1;
  }
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
    chooseNextImages();
  }
}

function chooseNextImages() {
  if (pulseImages.length <= 1) return;
  for (const plane of planes) {
    plane.previousImageIndex = plane.currentImageIndex;
    while (plane.currentImageIndex === plane.previousImageIndex) {
      plane.currentImageIndex = floor(random(pulseImages.length));
    }
  }
}

function resetPulseClock() {
  timer = millis();
  pulseGateOpen = true;
}

function renderScene() {
  if (!planes.length) return;

  for (const plane of planes) {
    plane.buffer.clear();

    if (!imagesReady || !pulseImages.length) {
      plane.buffer.push();
      plane.buffer.fill(0);
      plane.buffer.noStroke();
      plane.buffer.textAlign(CENTER, CENTER);
      plane.buffer.textSize(22);
      plane.buffer.text("Loading pulse drawings...", plane.buffer.width * 0.5, plane.buffer.height * 0.5);
      plane.buffer.pop();
      plane.surface.clear();
      if (invertFilterEnabled) {
        const filtered = plane.buffer.get();
        filtered.filter(INVERT);
        plane.surface.image(filtered, plane.surface.width * 0.5, plane.surface.height * 0.5);
      } else {
        plane.surface.image(plane.buffer, plane.surface.width * 0.5, plane.surface.height * 0.5);
      }
      continue;
    }

    const img = pulseImages[plane.currentImageIndex];
    if (img) {
      const fitScale = min(
        plane.buffer.width / max(1, img.width),
        plane.buffer.height / max(1, img.height)
      );
      const drawW = img.width * fitScale;
      const drawH = img.height * fitScale;

      plane.buffer.push();
      plane.buffer.translate(plane.buffer.width * 0.5, plane.buffer.height * 0.5);
      plane.buffer.rotate(rotationValue);
      plane.buffer.image(img, 0, 0, drawW, drawH);
      plane.buffer.pop();
    }

    plane.surface.clear();
    if (invertFilterEnabled) {
      const filtered = plane.buffer.get();
      filtered.filter(INVERT);
      plane.surface.image(filtered, plane.surface.width * 0.5, plane.surface.height * 0.5);
    } else {
      plane.surface.image(plane.buffer, plane.surface.width * 0.5, plane.surface.height * 0.5);
    }
  }
}

function renderUi() {
  const connection = heartRate?.getConnectionState?.() || {};
  const isConnected = !!connection.connected;
  const isConnecting = !!connection.connecting;
  const canRefreshReconnect = typeof navigator?.bluetooth?.getDevices === "function";
  const compactControlStyle = { height: 24, fontSize: 12, padding: 5, margin: 5, rounding: 4 };

  uiListStart({ x: 30, y: 40, width: 156, dir: "vertical" });

  const connectLabel = isConnecting
    ? "Pulse connecting..."
    : `Connect Pulse${isConnected ? " (con)" : ""}`;
  const connectButton = uiButton(connectLabel, {
    ...compactControlStyle,
    bgColor: isConnecting ? "#fff1cc" : (isConnected ? "#dcefd9" : "#d0d0d0"),
  });
  if (connectButton.clicked) {
    ensureAudioUnlocked().catch(() => {});
    heartRate.connect().catch((err) => {
      heartRateStatus = err?.message || "connect failed";
    });
  }

  const nextAutoPulseEnabled = uiToggle("pulse.autoPulse", "Play / Pause", {
    ...compactControlStyle,
    onBgColor: "#dcefd9",
    offBgColor: "#d0d0d0",
  }).value;
  if (nextAutoPulseEnabled !== autoPulseEnabled) {
    if (nextAutoPulseEnabled) ensureAudioUnlocked().catch(() => {});
    autoPulseEnabled = nextAutoPulseEnabled;
    resetPulseClock();
  }

  const addPlaneButton = uiButton("Add Plane", compactControlStyle);
  if (addPlaneButton.clicked) {
    addPlane(true);
  }

  const removePlaneButton = uiButton("Remove Plane", compactControlStyle);
  if (removePlaneButton.clicked) {
    removePlane(true);
  }

  const clearMappingButton = uiButton("Clear Mapping", compactControlStyle);
  if (clearMappingButton.clicked) {
    mapper?.resetAll();
  }

  heartbeatEnabled = uiToggle("pulse.heartbeat", "Heartbeat Audio", {
    ...compactControlStyle,
    onBgColor: "#dcefd9",
    offBgColor: "#d0d0d0",
  }).value;

  heartbeatVolume = uiSlider("pulse.volume", "Volume", {
    min: 0,
    max: 1,
    init: heartbeatVolume,
    ...compactControlStyle,
  }).value;
  if (pulseSound) pulseSound.setVolume(heartbeatVolume);

  invertFilterEnabled = uiToggle("pulse.invert", "Invert Drawing", {
    ...compactControlStyle,
    onBgColor: "#d7e7ff",
    offBgColor: "#d0d0d0",
  }).value;

  bpmOffset = round(uiSlider("pulse.bpmOffset", "BPM Offset", {
    min: -20,
    max: 20,
    init: bpmOffset,
    ...compactControlStyle,
  }).value);

  numSteps = round(uiSlider("pulse.steps", "Steps", {
    min: STEP_MIN,
    max: STEP_MAX,
    init: numSteps,
    ...compactControlStyle,
  }).value);

  uiListEnd();

  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`status: ${heartRateStatus}`, 300, 20);
  text(`connection: ${isConnected ? "connected" : isConnecting ? "connecting" : "disconnected"}`, 300, 42);
  text(`refresh reconnect: ${canRefreshReconnect ? "available" : "not available"}`, 300, 64);
  text(`bpm: ${bpm || "-"}`, 300, 86);
  text(`effective bpm: ${effectiveBpm || "-"}`, 300, 108);
  text(`offset: ${bpmOffset >= 0 ? "+" : ""}${bpmOffset}`, 300, 130);
  text(`audio: ${audioUnlocked ? "unlocked" : "tap a control after refresh"}`, 300, 152);
  text(`volume: ${nf(heartbeatVolume, 1, 2)}`, 300, 174);
  text(`mapper: ${typeof uiIsDebugOverlayVisible === "function" && uiIsDebugOverlayVisible() ? "adjusting" : "locked"}`, 300, 196);
  text(`planes: ${planes.length}`, 300, 218);
  text(`rr count: ${rr.length}`, 300, 240);
  text(`frame: ${planes[0] ? planes[0].currentImageIndex + 1 : "-"}${pulseImages.length ? `/${pulseImages.length}` : ""}`, 300, 262);
  text(`step: ${stepCounter}/${numSteps}`, 300, 284);
  text(`invert: ${invertFilterEnabled ? "on" : "off"}`, 300, 306);
}
