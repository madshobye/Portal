let canvas;
let cam;
let faceMesh;
let canvasHostEl;
let shellEl;
let adminEl;
let statusEl;
let infoEl;
let consoleEl;
let runBtn;
let toggleBtn;
let modelSelectEl;
let canvasHostResizeObserver = null;
window.PORTAL_CANVAS_RESIZE_MODE = "none";

let urlToSketch = "https://editor.p5js.org/hobye/sketches/XOYHX3qgV";

let apiKeyEncryptedGptTTL1 =
  "U2FsdGVkX1+1h+ZeFu9j7fGBkdqVKyectXaOzCqQgoJvQuqzPTLNFVmN9EQl9i8km+avSLQv5SPh+ILmAGfX78ydmzjRyfAjlv8zCz1PgqTAV/5VGf3eRkY74HFPjGJoYuOIxupYTOirJjHGYwl0OtrBKgBWse+TpYiTuV1ZwO/nhCKJIgtkCZUweNVGIhpRfUIDiPZ9kYycjONHZCddUWOIL8c+ZBBjgcMuLFdYjFMMnyWbM4LxN/genRUTvlO8";

let apiKey = "";
let gpt;
let res;
let requestInFlight = false;
let debugHidden = false;
let selectedModel = "gpt-5.1";
let facemeshDenseEdges = null;
let facemeshDenseEdgePointCount = 0;
let activeFaceFrame = null;
let appStatus = { mode: "detecting", label: "DETECTING" };
let blinkBaselineEar = null;
let blinkLastDetectedMs = 0;
let blinkArmed = true;
let scanSweepStartMs = 0;
let scanEffectUntilMs = 0;
let resultListItems = [];
let resultListAnimStartMs = 0;
let terminalFontFamily = "Share Tech Mono";

const DEBUG_HIDDEN_KEY = "ttl.debugHidden";
const MODEL_KEY = "ttl.selectedModel";
const DEBUG_LOG_LIMIT = 160;
const CAMERA_FLIPPED = true;
const SHOW_CANVAS_OVERLAY_UI = false;
const SHOW_FACEMESH_LINES = true;
const SHOW_FACEMESH_POINTS = false;
const FACEMESH_LINE_WEIGHT = 2.4;
const FACEMESH_LINE_COLOR = [90, 225, 255, 210];
const FACEMESH_POINT_COLOR = [90, 225, 255, 180];
const FACEMESH_POINT_SIZE = 2.4;
const SHOW_FACEMESH_DENSE_LINES = true;
const FACEMESH_DENSE_LINE_WEIGHT = 1.3;
const FACEMESH_DENSE_LINE_COLOR = [90, 225, 255, 120];
const FACEMESH_DENSE_NEIGHBORS = 5;
const FACEMESH_DENSE_MAX_DIST_RATIO = 0.18;
const SHOW_CENTER_FACE_CIRCLE = true;
const CENTER_FACE_CIRCLE_SCALE = 1.416;
const CENTER_FACE_CIRCLE_COLOR = [90, 225, 255, 170];
const CENTER_FACE_CIRCLE_RINGS = [
  { scale: 1.0, stroke: 3.1, alpha: 195 },
  { scale: 0.94, stroke: 1.8, alpha: 155 },
  { scale: 0.88, stroke: 1.0, alpha: 120 },
];
const APP_STATUS_MODES = {
  DETECTING: "detecting",
  CENTER_FACE: "center_face",
  LOCKED: "locked",
  ANALYSING: "analysing",
};
const APP_STATUS_LABELS = {
  [APP_STATUS_MODES.DETECTING]: "DETECTING",
  [APP_STATUS_MODES.CENTER_FACE]: "CENTER FACE",
  [APP_STATUS_MODES.LOCKED]: "LOCKED",
  [APP_STATUS_MODES.ANALYSING]: "ANALYSING",
};
const APP_STATUS_TEXT_SIZE = 58;
const BLINK_LOG_COOLDOWN_MS = 260;
const BLINK_BASELINE_EMA = 0.14;
const BLINK_TRIGGER_RATIO = 0.82;
const BLINK_REARM_RATIO = 0.9;
const BLINK_MIN_OPEN_EAR = 0.18;
const BLINK_MIN_TRIGGER_EAR = 0.11;
const BLINK_MAX_TRIGGER_EAR = 0.34;
const BLINK_RING_MARGIN_PX = -10;
const SCAN_SWEEP_DURATION_MS = 1200;
const SCAN_EFFECT_HOLD_MS = 900;
const SCAN_VIBRATE_PX = 3.5;
const SCAN_GLOW_BAND_PX = 110;
const SCAN_GLOW_STROKE_BOOST = 1.7;
const SCAN_SNAPSHOT_SIZE = 896;
const RESULT_LIST_MAX_ITEMS = 14;
const RESULT_LIST_WIDTH = 460;
const RESULT_LIST_MARGIN = 26;
const RESULT_LIST_PANEL_IN_MS = 420;
const RESULT_LIST_ITEM_IN_MS = 260;
const RESULT_LIST_ITEM_STAGGER_MS = 55;
const RESULT_LIST_BG = [8, 18, 26, 175];
const RESULT_LIST_STROKE = [90, 225, 255, 120];
const RESULT_LIST_TEXT = [216, 245, 255, 230];
const RESULT_LIST_LABEL = [120, 225, 255, 235];
const ANALYSIS_CALLOUT_BOX_W = 174;
const ANALYSIS_CALLOUT_BOX_H = 62;
const ANALYSIS_CALLOUT_MARGIN = 18;
const ANALYSIS_CALLOUT_RADIUS_X_EXTRA = 200;
const ANALYSIS_CALLOUT_RADIUS_Y_EXTRA = 150;
const ANALYSIS_CALLOUT_BG = [8, 18, 26, 175];
const ANALYSIS_CALLOUT_STROKE = [90, 225, 255, 120];
const ANALYSIS_CALLOUT_CONNECTOR = [90, 225, 255, 165];
const ANALYSIS_CALLOUT_LABEL = [126, 255, 140, 235];
const ANALYSIS_CALLOUT_VALUE = [255, 255, 255, 235];
const ANALYSIS_CALLOUT_ANCHOR_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 152,
];
const FACEMESH_LIP_INDICES = new Set([
  0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95,
  146, 178, 181, 185, 191, 267, 269, 270, 291, 308, 310, 311, 312, 314,
  317, 318, 321, 324, 375, 402, 405, 409, 415,
]);
const DYNAMIC_FACE_FRAMING = true;
const FACE_FRAME_SMOOTHING = 0.18;
const FACE_FRAME_ZOOM_SMOOTHING = FACE_FRAME_SMOOTHING / 3;
const FACE_FRAME_WIDTH_FILL = 0.42;
const FACE_FRAME_HEIGHT_FILL = 0.5;
const FACE_FRAME_PADDING = 1.15;
const FACE_FRAME_MIN_ZOOM = 1.05;
const FACE_FRAME_MAX_ZOOM = 2.8;
const FACEMESH_CONNECTION_PATHS = [
  {
    closed: true,
    indices: [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
      397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
      172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
    ],
  },
  {
    closed: true,
    indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  {
    closed: true,
    indices: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  },
  {
    closed: false,
    indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  },
  {
    closed: false,
    indices: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  },
  {
    closed: true,
    indices: [
      61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
      324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37, 0,
      267, 269, 270, 409, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78,
    ],
  },
  {
    closed: true,
    indices: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
  },
  {
    closed: false,
    indices: [168, 6, 197, 195, 5, 4],
  },
  {
    closed: true,
    indices: [2, 97, 326, 327, 98],
  },
];
const MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "gpt-4o",
];

function loadDebugHidden() {
  try {
    return window.localStorage.getItem(DEBUG_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDebugHidden() {
  try {
    window.localStorage.setItem(DEBUG_HIDDEN_KEY, debugHidden ? "1" : "0");
  } catch {}
}

function loadSelectedModel() {
  try {
    const value = window.localStorage.getItem(MODEL_KEY) || "";
    if (MODEL_OPTIONS.includes(value)) return value;
  } catch {}
  return "gpt-5.1";
}

function persistSelectedModel() {
  try {
    window.localStorage.setItem(MODEL_KEY, selectedModel || "");
  } catch {}
}

function buildUi() {
  const appRoot = createDiv("");
  appRoot.id("ttl-app");

  shellEl = createDiv("");
  shellEl.class("ttl-shell");
  shellEl.parent(appRoot);

  adminEl = createDiv("");
  adminEl.class("ttl-admin");
  adminEl.parent(shellEl);

  const header = createDiv("");
  header.class("ttl-header");
  header.parent(adminEl);

  const titleWrap = createDiv("");
  titleWrap.parent(header);

  const title = createDiv("TTL");
  title.class("ttl-title");
  title.parent(titleWrap);

  const subtitle = createDiv("Debug Panel");
  subtitle.class("ttl-subtitle");
  subtitle.parent(titleWrap);

  statusEl = createDiv("Starting...");
  statusEl.class("ttl-status");
  statusEl.parent(adminEl);

  const toolbar = createDiv("");
  toolbar.class("ttl-toolbar");
  toolbar.parent(adminEl);

  modelSelectEl = createSelect();
  modelSelectEl.class("ttl-select");
  modelSelectEl.parent(toolbar);

  for (const model of MODEL_OPTIONS) {
    modelSelectEl.option(model, model);
  }

  runBtn = createButton("Run");
  runBtn.class("ttl-btn");
  runBtn.parent(toolbar);
  runBtn.mousePressed(() => {
    requestAnalysis();
  });

  const clearBtn = createButton("Clear Log");
  clearBtn.class("ttl-btn");
  clearBtn.parent(toolbar);
  clearBtn.mousePressed(() => clearDebugLog());

  const copyBtn = createButton("Copy Log");
  copyBtn.class("ttl-btn");
  copyBtn.parent(toolbar);
  copyBtn.mousePressed(async () => copyDebugLog());

  infoEl = createDiv("");
  infoEl.class("ttl-info");
  infoEl.parent(adminEl);

  const consoleTitle = createDiv("Console");
  consoleTitle.class("ttl-console-title");
  consoleTitle.parent(adminEl);

  consoleEl = createDiv("");
  consoleEl.class("ttl-console");
  consoleEl.parent(adminEl);

  const mainEl = createDiv("");
  mainEl.class("ttl-main");
  mainEl.parent(shellEl);

  toggleBtn = createButton("•");
  toggleBtn.class("ttl-debug-toggle");
  toggleBtn.parent(mainEl);
  toggleBtn.mousePressed(() => {
    debugHidden = !debugHidden;
    persistDebugHidden();
    applyDebugVisibility();
    requestAnimationFrame(resizeCanvasToHost);
  });

  canvasHostEl = createDiv("");
  canvasHostEl.class("ttl-canvas-host");
  canvasHostEl.parent(mainEl);
}

function applyDebugVisibility() {
  if (!shellEl?.elt || !adminEl?.elt) return;
  shellEl.elt.classList.toggle("is-debug-hidden", !!debugHidden);
  adminEl.elt.classList.toggle("is-hidden", !!debugHidden);
  if (toggleBtn) toggleBtn.html(debugHidden ? "◂" : "▸");
}

function setStatus(text) {
  if (statusEl) statusEl.html(String(text || ""));
}

function appendDebugLog(text) {
  if (!consoleEl) return;
  const now = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const nextLine = `[${now}] ${String(text || "")}`;
  const lines = (consoleEl.html() || "").split("\n").filter(Boolean);
  lines.push(nextLine);
  const trimmed = lines.slice(-DEBUG_LOG_LIMIT);
  consoleEl.html(trimmed.join("\n"));
  consoleEl.elt.scrollTop = consoleEl.elt.scrollHeight;
}

function clearDebugLog() {
  if (consoleEl) consoleEl.html("");
}

async function copyDebugLog() {
  const content = consoleEl?.html?.() || "";
  try {
    await navigator.clipboard.writeText(content);
    appendDebugLog("Console copied");
  } catch {
    appendDebugLog("Copy failed");
  }
}

function updateInfo() {
  if (!infoEl) return;
  const faceCount = faceMesh?.getFaces?.()?.length || 0;
  const lines = [
    `Model: ${gpt?.model || "-"}`,
    `Camera: ${cam ? "ready" : "loading"}`,
    `FaceMesh: ${
      faceMesh
        ? faceMesh.running
          ? `running (${faceCount} faces)`
          : faceMesh.ready
            ? "ready"
            : "loading"
        : "disabled"
    }`,
    `Request: ${requestInFlight ? "in-flight" : "idle"}`,
    `Result: ${res ? "available" : "none"}`,
    `Status: ${appStatus?.label || "-"}`,
  ];
  infoEl.html(lines.join("\n"));
}

function createCanvasInHost() {
  const rect = canvasHostEl?.elt?.getBoundingClientRect?.() || {};
  const cw = Math.max(260, Math.floor(rect.width || windowWidth || 260));
  const ch = Math.max(260, Math.floor(rect.height || windowHeight || 260));
  canvas = createCanvas(cw, ch);
  if (canvasHostEl?.elt && canvas?.elt) {
    canvasHostEl.elt.appendChild(canvas.elt);
  }
}

function resizeCanvasToHost() {
  if (!canvasHostEl?.elt || typeof resizeCanvas !== "function") return;
  const rect = canvasHostEl.elt.getBoundingClientRect();
  const cw = Math.max(260, Math.floor(rect.width || windowWidth || width || 260));
  const ch = Math.max(260, Math.floor(rect.height || windowHeight || height || 260));
  if (cw === width && ch === height) return;
  resizeCanvas(cw, ch);
}

function installManualCanvasResizeSync() {
  if (!canvasHostEl?.elt) return;
  if (canvasHostResizeObserver) return;
  if (typeof ResizeObserver === "undefined") return;

  canvasHostResizeObserver = new ResizeObserver(() => {
    resizeCanvasToHost();
  });
  canvasHostResizeObserver.observe(canvasHostEl.elt);
}

async function setup() {
  debugHidden = loadDebugHidden();
  selectedModel = loadSelectedModel();
  buildUi();
  modelSelectEl.selected(selectedModel);
  modelSelectEl.changed(() => {
    selectedModel = modelSelectEl.value();
    persistSelectedModel();
    gpt = createClient();
    appendDebugLog(`model changed: ${selectedModel}`);
    setStatus("Ready");
    updateInfo();
  });
  applyDebugVisibility();
  createCanvasInHost();
  installManualCanvasResizeSync();

  setStatus("Loading...");
  appendDebugLog("setup:start");

  await loadScript("portal/GptClient.js");
  appendDebugLog("portal/GptClient.js loaded");
  await loadScript("portal/faceMesh.js");
  appendDebugLog("portal/faceMesh.js loaded");
  if (typeof loadGoogleFont === "function") {
    try {
      loadGoogleFont(terminalFontFamily);
      appendDebugLog(`font loaded: ${terminalFontFamily}`);
    } catch (error) {
      appendDebugLog(`font load failed: ${error?.message || error}`);
    }
  }

  cam = await setupWebcamera(false, 640, 480, false, false);
  if (typeof syncVideoDimensions === "function") {
    syncVideoDimensions(cam);
  }
  appendDebugLog("camera ready");

  try {
    faceMesh = await new FaceMesh({
      video: cam,
      backend: "webgl",
      videoIsFlipped: true,
      onResults: () => {},
    }).init();
    await faceMesh.start();
    appendDebugLog("facemesh started");
  } catch (error) {
    faceMesh = null;
    appendDebugLog(`facemesh disabled: ${error?.message || error}`);
  }

  apiKey = storedDecrypt({ apiKeyEncryptedGptTTL1 });
  appendDebugLog(`api key ${apiKey ? "loaded" : "missing"}`);

  gpt = createClient();

  fill(255);
  textFont(terminalFontFamily);
  setStatus("Ready");
  appendDebugLog("setup:done");
  updateInfo();
}

function createClient() {
  const functionSchemas = [
    {
      name: "image_response",
      description: "Return a concise, non-sensitive visual read of the image. Make your best gues. Do not write unclear or unknown.",
      parameters: {
             type: "object",

             properties: {
               mood: { type: "string" },
               country: { type: "string" },
               age: { type: "number" },
               gender: { type: "string" },
               ethnicity: { type: "string" },
               education_level: { type: "string" },
               lifespan: { type: "number" },
               political_position: { type: "string" },
               Religion: { type: "string" },
               professional_field: { type: "string" },
               kids: { type: "number" },
               exercise_regime: { type: "string" },
               diet: { type: "string" },
               nutrient_sufficiency:  { type: "string" },
               bmi: { type: "number" },
               civil_status: { type: "string" },
               demographic_challanges: { type: "string" },
               life_advice: { type: "string" },
             },

             required: ["mood", "country", "age", "gender", "education_level", "lifespan"],
           },
    },
  ];

  return new GptClient({
    apiKey,
    model: selectedModel,
    instructions:
      "Look carefully at the user's image and describe the overall situation. " +
      "Do your best guess with no expectation of a perfect result. " +
      "It is better to provide a useful estimate than to refuse. " +
      "Focus on visible, non-sensitive cues: scene, lighting, mood, colors, and context hints. " +
      "except for life advice only one word og number per element",
    functionSchemas,
    functionName: "image_response",
    temperature: 0.2,
  });
}

function draw() {
  background(0);

  if (faceMesh?.running) {
    syncAnalysisVisibilityWithFace(faceMesh);
    const analysisVisible = isAnalysisVisible(faceMesh);
    const renderFrame = DYNAMIC_FACE_FRAMING
      ? updateFaceFrame(faceMesh, cam, width, height)
      : null;
    processBlinkFromFaceMesh(faceMesh, renderFrame, analysisVisible);

    if (renderFrame) {
      drawCameraFrame(cam, renderFrame);
    } else {
      faceMesh.scaleTo(width, height);
      faceMesh.drawImage();
    }

    if (SHOW_FACEMESH_LINES) {
      drawFaceMeshConnections(faceMesh, renderFrame);
    }
    if (SHOW_FACEMESH_POINTS) {
      if (renderFrame) {
        drawFaceMeshPoints(faceMesh, renderFrame);
      } else {
        faceMesh.drawFaces(0, 0, null, null, {
          minConfidence: 0,
          pointSize: FACEMESH_POINT_SIZE,
          color: FACEMESH_POINT_COLOR,
        });
      }
    }
    if (SHOW_CENTER_FACE_CIRCLE && !analysisVisible) {
      const circleDiameter = drawCenterFaceCircle(faceMesh, renderFrame);
      updateAppStatusFromFace(faceMesh, renderFrame, circleDiameter);
      drawAppStatusLabel(circleDiameter);
    }
    drawAnalysisCallouts(faceMesh, renderFrame, analysisVisible);
  } else if (cam) {
    drawCameraCover(cam, 0, 0, width, height);
    setAppStatus(APP_STATUS_MODES.DETECTING);
    clearAnalysisResults();
    if (SHOW_CENTER_FACE_CIRCLE) {
      const circleDiameter = Math.min(width, height) * 0.64;
      drawAppStatusLabel(circleDiameter);
    }
  }

  if (SHOW_CANVAS_OVERLAY_UI) {
    const btnStyle = { fontSize: 50, x: 200, y: 20, width: 300, height: 300 };
    if (uiButton("læs", btnStyle).clicked) {
      requestAnalysis();
    }
    drawResultPanel();
  }
  updateInfo();
}

function processBlinkFromFaceMesh(mesh, renderFrame = null, analysisVisible = false) {
  if (!mesh) return;
  let faces = null;
  if (mesh?.hasNewResult?.()) {
    const packet = mesh.consumeNew();
    faces = packet?.faces || null;
  } else {
    faces = mesh?.getFacesRaw?.() || null;
  }
  if (requestInFlight || analysisVisible) {
    blinkArmed = true;
    return;
  }
  const face = Array.isArray(faces) ? faces[0] : null;
  if (!face) {
    blinkArmed = true;
    return;
  }

  if (!isFaceInsideScanRing(face, renderFrame)) {
    blinkArmed = true;
    return;
  }

  const ear = computeFaceEar(face);
  if (!Number.isFinite(ear)) return;

  if (blinkBaselineEar == null) {
    blinkBaselineEar = ear;
  } else if (ear >= BLINK_MIN_OPEN_EAR) {
    blinkBaselineEar = lerp(blinkBaselineEar, ear, BLINK_BASELINE_EMA);
  }

  const dynamicTrigger = constrain(
    (blinkBaselineEar || ear) * BLINK_TRIGGER_RATIO,
    BLINK_MIN_TRIGGER_EAR,
    BLINK_MAX_TRIGGER_EAR
  );
  const dynamicRearm = Math.max(dynamicTrigger + 0.015, (blinkBaselineEar || ear) * BLINK_REARM_RATIO);

  if (blinkArmed && ear < dynamicTrigger) {
    const now = millis();
    if (now - blinkLastDetectedMs > BLINK_LOG_COOLDOWN_MS) {
      blinkLastDetectedMs = now;
      blinkArmed = false;
      appendDebugLog(`blink detected ear=${ear.toFixed(3)} threshold=${dynamicTrigger.toFixed(3)}`);
      triggerBlinkAnalysis(renderFrame);
    }
  } else if (!blinkArmed && ear > dynamicRearm) {
    blinkArmed = true;
  }
}

function computeFaceEar(face) {
  const points = face?.keypoints || [];
  if (!points.length) return NaN;

  // MediaPipe FaceMesh eye landmarks (EAR style pairs)
  const leftEar = computeEyeEar(points, [33, 160, 158, 133, 153, 144]);
  const rightEar = computeEyeEar(points, [362, 385, 387, 263, 373, 380]);

  if (!Number.isFinite(leftEar) && !Number.isFinite(rightEar)) return NaN;
  if (!Number.isFinite(leftEar)) return rightEar;
  if (!Number.isFinite(rightEar)) return leftEar;
  return (leftEar + rightEar) * 0.5;
}

function computeEyeEar(points, ids) {
  const p1 = points[ids[0]];
  const p2 = points[ids[1]];
  const p3 = points[ids[2]];
  const p4 = points[ids[3]];
  const p5 = points[ids[4]];
  const p6 = points[ids[5]];
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return NaN;

  const d26 = pointDist(p2, p6);
  const d35 = pointDist(p3, p5);
  const d14 = pointDist(p1, p4);
  if (!Number.isFinite(d26) || !Number.isFinite(d35) || !Number.isFinite(d14) || d14 <= 1e-5) {
    return NaN;
  }
  return (d26 + d35) / (2 * d14);
}

function pointDist(a, b) {
  const ax = Number(a?.x ?? a?.[0]);
  const ay = Number(a?.y ?? a?.[1]);
  const bx = Number(b?.x ?? b?.[0]);
  const by = Number(b?.y ?? b?.[1]);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return NaN;
  }
  return Math.hypot(ax - bx, ay - by);
}

function isFaceInsideScanRing(face, renderFrame = null) {
  if (!face) return false;

  const sourceW = Math.max(1, Number(cam?.width) || Number(cam?.elt?.videoWidth) || 640);
  const sourceH = Math.max(1, Number(cam?.height) || Number(cam?.elt?.videoHeight) || 480);
  const frame = renderFrame || { sx: 0, sy: 0, sw: sourceW, sh: sourceH };
  const mappedFace = mapFacesToCanvas([face], frame)?.[0];
  const points = mappedFace?.keypoints || [];
  const bounds = getBoundsFromPoints(points);
  if (!bounds) return false;
  const circleDiameter = Math.min(width, height) * 0.64;
  return isBoundsInsideRing(bounds, circleDiameter, BLINK_RING_MARGIN_PX);
}

function triggerBlinkAnalysis(renderFrame = null) {
  if (requestInFlight || !gpt || !cam) return;
  scanSweepStartMs = millis();
  scanEffectUntilMs = scanSweepStartMs + SCAN_EFFECT_HOLD_MS;
  setAppStatus(APP_STATUS_MODES.ANALYSING);
  setStatus("Analysing...");
  appendDebugLog("blink action: capture + analyse");

  const snapshot = captureCurrentSnapshot(renderFrame);
  requestAnalysisWithImage(snapshot, "blink");
}

function captureCurrentSnapshot(renderFrame = null) {
  const sourceW = Math.max(1, Number(cam?.width) || Number(cam?.elt?.videoWidth) || 640);
  const sourceH = Math.max(1, Number(cam?.height) || Number(cam?.elt?.videoHeight) || 480);

  const frame = renderFrame
    ? { sx: renderFrame.sx, sy: renderFrame.sy, sw: renderFrame.sw, sh: renderFrame.sh }
    : activeFaceFrame
      ? { sx: activeFaceFrame.sx, sy: activeFaceFrame.sy, sw: activeFaceFrame.sw, sh: activeFaceFrame.sh }
    : { sx: 0, sy: 0, sw: sourceW, sh: sourceH };

  const frameAspect = frame.sw / Math.max(1, frame.sh);
  let targetW = SCAN_SNAPSHOT_SIZE;
  let targetH = Math.round(targetW / frameAspect);
  if (targetH > SCAN_SNAPSHOT_SIZE) {
    targetH = SCAN_SNAPSHOT_SIZE;
    targetW = Math.round(targetH * frameAspect);
  }
  targetW = Math.max(128, targetW);
  targetH = Math.max(128, targetH);

  const shot = createGraphics(targetW, targetH);
  shot.image(cam, 0, 0, targetW, targetH, frame.sx, frame.sy, frame.sw, frame.sh);
  return shot;
}

async function requestAnalysis() {
  if (!gpt || !cam || requestInFlight) return;
  await requestAnalysisWithImage(cam, "manual");
}

async function requestAnalysisWithImage(imageSource, reason = "manual") {
  if (!gpt || !imageSource || requestInFlight) return;
  requestInFlight = true;
  if (runBtn?.elt) runBtn.elt.disabled = true;
  if (reason === "blink") {
    setAppStatus(APP_STATUS_MODES.ANALYSING);
  }
  setStatus("Analysing...");
  appendDebugLog(`analysis:start (${reason})`);
  try {
    const prompt =
      "Analyse the image and give the best possible answer to the information fields in image_response. " +
      "It is more important to give a useful answer than to be perfectly correct. " +
      "Use only non-sensitive visible clues from the scene and background. " +
      "Keep values short (max 10 words each).";
    res = await gpt.ask(prompt, imageSource);

    if (res?.error === "Bad JSON in function_call") {
      appendDebugLog("analysis:retry due to bad function JSON");
      res = await gpt.ask(
        "Return image_response with very short values (max 6 words per field). Strictly fill all required fields.",
        imageSource
      );
    }

    if (res?.error) {
      setResultListFromResponse(null);
      appendDebugLog(`analysis:error ${res.error}`);
      console.error("GPT error:", res.error);
      setStatus("Error");
    } else {
      setResultListFromResponse(res);
      appendDebugLog("analysis:success");
      console.log("GPT result:", res);
      setStatus("Ready");
    }
  } catch (error) {
    res = { error: error?.message || String(error) };
    setResultListFromResponse(null);
    appendDebugLog(`analysis:exception ${res.error}`);
    console.error("Request failed:", error);
    setStatus("Error");
  } finally {
    requestInFlight = false;
    scanEffectUntilMs = Math.max(scanEffectUntilMs, millis() + 220);
    if (runBtn?.elt) runBtn.elt.disabled = false;
  }
}

function drawResultPanel() {
  const panelX = 200;
  const panelY = 360;
  const panelW = width - panelX - 40;
  const panelH = height - panelY - 40;

  noStroke();
  fill(20, 20, 20, 220);
  rect(panelX, panelY, panelW, panelH, 12);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(22);
  text("TTL", panelX + 16, panelY + 14);

  textSize(16);
  const status = requestInFlight ? "Analysing..." : "Ready";
  text(status, panelX + 16, panelY + 44);

  if (!res) return;

  const lines = [];
  if (res.error) {
    lines.push(`Error: ${res.error}`);
  } else {
    if (res.mood) lines.push(`Mood: ${res.mood}`);
    if (res.setting) lines.push(`Setting: ${res.setting}`);
    if (res.lighting) lines.push(`Lighting: ${res.lighting}`);
    if (res.dominant_colors) lines.push(`Colors: ${res.dominant_colors}`);
    if (res.visible_clues) lines.push(`Clues: ${res.visible_clues}`);
    if (res.likely_context) lines.push(`Context: ${res.likely_context}`);
    if (res.practical_advice) lines.push(`Advice: ${res.practical_advice}`);
  }

  textSize(18);
  text(lines.join("\n\n"), panelX + 16, panelY + 72, panelW - 32, panelH - 88);
}

function drawCameraCover(video, x, y, w, h) {
  const transform = getCameraCoverTransform(video, x, y, w, h);
  if (CAMERA_FLIPPED) {
    push();
    translate(transform.drawX + transform.drawW, transform.drawY);
    scale(-1, 1);
    image(video, 0, 0, transform.drawW, transform.drawH);
    pop();
    return;
  }

  image(video, transform.drawX, transform.drawY, transform.drawW, transform.drawH);
}

function getCameraCoverTransform(video, x, y, w, h) {
  const sourceW = Math.max(
    1,
    Number(video?.width) ||
      Number(video?.elt?.videoWidth) ||
      1
  );
  const sourceH = Math.max(
    1,
    Number(video?.height) ||
      Number(video?.elt?.videoHeight) ||
      1
  );
  const scale = Math.max(w / sourceW, h / sourceH);
  return {
    sourceW,
    sourceH,
    scale,
    drawW: sourceW * scale,
    drawH: sourceH * scale,
    drawX: x + (w - sourceW * scale) * 0.5,
    drawY: y + (h - sourceH * scale) * 0.5,
  };
}

function drawFaceMeshOverlay(mesh, video, x, y, w, h, options = {}) {
  const faces = mesh?.getFacesRaw?.() || [];
  if (!faces.length) return;

  const pointSize = Number(options.pointSize) || 2.8;
  const color = options.color || [255, 180, 40, 230];
  const transform = getCameraCoverTransform(video, x, y, w, h);
  const sourceW = transform.sourceW;
  const sourceH = transform.sourceH;

  push();
  noStroke();
  fill(color[0] ?? 255, color[1] ?? 180, color[2] ?? 40, color[3] ?? 230);

  for (const face of faces) {
    const points =
      (Array.isArray(face?.keypoints) && face.keypoints) ||
      (Array.isArray(face?.landmarks) && face.landmarks) ||
      [];

    for (const point of points) {
      let px = Number(point?.x ?? point?.[0]);
      let py = Number(point?.y ?? point?.[1]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

      const isNormalized =
        px >= 0 && px <= 1 && py >= 0 && py <= 1;
      if (isNormalized) {
        px *= sourceW;
        py *= sourceH;
      }

      if (CAMERA_FLIPPED) {
        px = sourceW - px;
      }

      const sx = transform.drawX + px * transform.scale;
      const sy = transform.drawY + py * transform.scale;
      circle(sx, sy, pointSize);
    }
  }

  pop();
}

function drawFaceMeshConnections(mesh, renderFrame = null) {
  const faces = getFacesInCanvasSpace(mesh, renderFrame);
  if (!faces.length) return;
  const scan = getScanSweepState();

  push();
  noFill();
  for (const face of faces) {
    const points = face?.keypoints || [];
    if (!points.length) continue;

    if (SHOW_FACEMESH_DENSE_LINES) {
      const denseEdges = getDenseEdges(points);
      stroke(
        FACEMESH_DENSE_LINE_COLOR[0] ?? 90,
        FACEMESH_DENSE_LINE_COLOR[1] ?? 225,
        FACEMESH_DENSE_LINE_COLOR[2] ?? 255,
        FACEMESH_DENSE_LINE_COLOR[3] ?? 120
      );
      strokeWeight(FACEMESH_DENSE_LINE_WEIGHT);

      for (const edge of denseEdges) {
        const a = points[edge[0]];
        const b = points[edge[1]];
        const ax = Number(a?.x);
        const ay = Number(a?.y);
        const bx = Number(b?.x);
        const by = Number(b?.y);
        if (
          !Number.isFinite(ax) || !Number.isFinite(ay) ||
          !Number.isFinite(bx) || !Number.isFinite(by)
        ) {
          continue;
        }
        drawMeshSegment(ax, ay, bx, by, {
          baseColor: FACEMESH_DENSE_LINE_COLOR,
          baseWeight: FACEMESH_DENSE_LINE_WEIGHT,
          scan,
        });
      }
    }

    for (const path of FACEMESH_CONNECTION_PATHS) {
      const indices = path?.indices || [];
      if (indices.length < 2) continue;

      for (let i = 0; i < indices.length - 1; i += 1) {
        const a = points[indices[i]];
        const b = points[indices[i + 1]];
        const ax = Number(a?.x);
        const ay = Number(a?.y);
        const bx = Number(b?.x);
        const by = Number(b?.y);
        if (
          !Number.isFinite(ax) || !Number.isFinite(ay) ||
          !Number.isFinite(bx) || !Number.isFinite(by)
        ) {
          continue;
        }
        drawMeshSegment(ax, ay, bx, by, {
          baseColor: FACEMESH_LINE_COLOR,
          baseWeight: FACEMESH_LINE_WEIGHT,
          scan,
        });
      }

      if (path.closed) {
        const a = points[indices[indices.length - 1]];
        const b = points[indices[0]];
        const ax = Number(a?.x);
        const ay = Number(a?.y);
        const bx = Number(b?.x);
        const by = Number(b?.y);
        if (
          Number.isFinite(ax) && Number.isFinite(ay) &&
          Number.isFinite(bx) && Number.isFinite(by)
        ) {
          drawMeshSegment(ax, ay, bx, by, {
            baseColor: FACEMESH_LINE_COLOR,
            baseWeight: FACEMESH_LINE_WEIGHT,
            scan,
          });
        }
      }
    }
  }

  pop();
}

function drawMeshSegment(ax, ay, bx, by, options = {}) {
  const baseColor = options.baseColor || FACEMESH_LINE_COLOR;
  const baseWeight = Number(options.baseWeight) || FACEMESH_LINE_WEIGHT;
  const scan = options.scan || null;

  stroke(
    baseColor[0] ?? 90,
    baseColor[1] ?? 225,
    baseColor[2] ?? 255,
    baseColor[3] ?? 185
  );
  strokeWeight(baseWeight);
  line(ax, ay, bx, by);

  if (!scan) return;
  const midY = (ay + by) * 0.5;
  const distance = Math.abs(midY - scan.y);
  if (distance > scan.band) return;

  const glow = 1 - distance / scan.band;
  stroke(
    FACEMESH_LINE_COLOR[0] ?? 90,
    FACEMESH_LINE_COLOR[1] ?? 225,
    FACEMESH_LINE_COLOR[2] ?? 255,
    Math.min(255, 110 + glow * 140)
  );
  strokeWeight(baseWeight + SCAN_GLOW_STROKE_BOOST * glow);
  line(ax, ay, bx, by);
}

function getScanSweepState() {
  if (!isScanActive()) return null;
  const elapsed = Math.max(0, millis() - scanSweepStartMs);
  const progress = (elapsed % SCAN_SWEEP_DURATION_MS) / SCAN_SWEEP_DURATION_MS;
  return {
    y: lerp(0, height, progress),
    band: SCAN_GLOW_BAND_PX,
  };
}

function drawFaceMeshPoints(mesh, renderFrame) {
  const faces = getFacesInCanvasSpace(mesh, renderFrame);
  if (!faces.length) return;

  push();
  noStroke();
  fill(
    FACEMESH_POINT_COLOR[0] ?? 90,
    FACEMESH_POINT_COLOR[1] ?? 225,
    FACEMESH_POINT_COLOR[2] ?? 255,
    FACEMESH_POINT_COLOR[3] ?? 180
  );

  for (const face of faces) {
    const points = face?.keypoints || [];
    for (const point of points) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      circle(x, y, FACEMESH_POINT_SIZE);
    }
  }

  pop();
}

function drawCenterFaceCircle(mesh, renderFrame = null) {
  const diameter = Math.min(width, height) * 0.64;
  if (!Number.isFinite(diameter) || diameter <= 0) return;
  const scanActive = isScanActive();
  const t = millis() * 0.03;

  push();
  noFill();
  for (let i = 0; i < CENTER_FACE_CIRCLE_RINGS.length; i += 1) {
    const ring = CENTER_FACE_CIRCLE_RINGS[i];
    const ringScale = Number(ring?.scale) || 1;
    const ringStroke = Number(ring?.stroke) || 1.5;
    const ringAlphaBase = Number(ring?.alpha) || (CENTER_FACE_CIRCLE_COLOR[3] ?? 170);
    const ringJitter = scanActive
      ? Math.sin(t + i * 1.35) * SCAN_VIBRATE_PX
      : 0;
    const ringAlpha = scanActive
      ? Math.min(255, ringAlphaBase + 20)
      : ringAlphaBase;
    stroke(
      CENTER_FACE_CIRCLE_COLOR[0] ?? 90,
      CENTER_FACE_CIRCLE_COLOR[1] ?? 225,
      CENTER_FACE_CIRCLE_COLOR[2] ?? 255,
      ringAlpha
    );
    strokeWeight(scanActive ? ringStroke + 0.4 : ringStroke);
    circle(width * 0.5, height * 0.5, diameter * ringScale + ringJitter);
  }
  pop();
  return diameter;
}

function setAppStatus(mode) {
  const safeMode = APP_STATUS_LABELS[mode] ? mode : APP_STATUS_MODES.DETECTING;
  appStatus = {
    mode: safeMode,
    label: APP_STATUS_LABELS[safeMode],
  };
}

function updateAppStatusFromFace(mesh, renderFrame, circleDiameter) {
  if (requestInFlight) {
    setAppStatus(APP_STATUS_MODES.ANALYSING);
    return;
  }

  const faces = getFacesInCanvasSpace(mesh, renderFrame);
  const points = faces?.[0]?.keypoints || [];
  const bounds = getBoundsFromPoints(points);
  if (!bounds) {
    setAppStatus(APP_STATUS_MODES.DETECTING);
    return;
  }
  if (isBoundsInsideRing(bounds, circleDiameter, 6)) {
    setAppStatus(APP_STATUS_MODES.LOCKED);
  } else {
    setAppStatus(APP_STATUS_MODES.CENTER_FACE);
  }
}

function isBoundsInsideRing(bounds, circleDiameter, ringMarginPx = 0) {
  if (!bounds) return false;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = (Number(circleDiameter) || Math.min(width, height) * 0.64) * 0.5 - ringMarginPx;
  if (!Number.isFinite(radius) || radius <= 0) return false;

  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.w;
  const y1 = bounds.y + bounds.h;
  const xm = (x0 + x1) * 0.5;
  const ym = (y0 + y1) * 0.5;

  const testPoints = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
    [xm, y0],
    [xm, y1],
    [x0, ym],
    [x1, ym],
  ];

  for (const point of testPoints) {
    const dx = point[0] - cx;
    const dy = point[1] - cy;
    if (Math.hypot(dx, dy) > radius) return false;
  }

  return true;
}

function drawAppStatusLabel(circleDiameter) {
  const diameter = Number(circleDiameter) || Math.min(width, height) * 0.64;
  const y = height * 0.5 + diameter * 0.5 + Math.max(42, APP_STATUS_TEXT_SIZE * 0.9);
  const color = CENTER_FACE_CIRCLE_COLOR;

  push();
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(APP_STATUS_TEXT_SIZE);
  fill(color[0] ?? 220, color[1] ?? 245, color[2] ?? 255, color[3] ?? 235);
  noStroke();
  text(appStatus?.label || APP_STATUS_LABELS[APP_STATUS_MODES.DETECTING], width * 0.5, y);
  pop();
}

function isScanActive() {
  return requestInFlight || millis() < scanEffectUntilMs;
}

function syncAnalysisVisibilityWithFace(mesh) {
  if (!resultListItems.length) return;
  const faceCount = mesh?.getFacesRaw?.()?.length || 0;
  if (faceCount <= 0) {
    clearAnalysisResults();
  }
}

function isAnalysisVisible(mesh) {
  if (!resultListItems.length) return false;
  const faceCount = mesh?.getFacesRaw?.()?.length || 0;
  return faceCount > 0;
}

function clearAnalysisResults() {
  resultListItems = [];
  resultListAnimStartMs = 0;
}

function setResultListFromResponse(response) {
  resultListItems = buildResultListItems(response);
  if (resultListItems.length > 0) {
    resultListAnimStartMs = millis();
  }
}

function buildResultListItems(response) {
  if (!response || typeof response !== "object" || response.error) return [];
  const entries = Object.entries(response)
    .filter(([_, value]) => value !== undefined && value !== null && `${value}`.trim() !== "")
    .slice(0, RESULT_LIST_MAX_ITEMS);

  return entries.map(([key, value]) => ({
    label: prettifyKeyLabel(key),
    value: formatResultValue(value),
  }));
}

function prettifyKeyLabel(key) {
  const source = String(key || "").replace(/_/g, " ").trim();
  if (!source) return "";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function formatResultValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((v) => `${v}`).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function drawAnalysisCallouts(mesh, renderFrame = null, analysisVisible = false) {
  if (!analysisVisible || !resultListItems.length) return;

  const faces = getFacesInCanvasSpace(mesh, renderFrame);
  const points = faces?.[0]?.keypoints || [];
  const bounds = getBoundsFromPoints(points);
  if (!bounds) return;

  const elapsed = Math.max(0, millis() - resultListAnimStartMs);
  const panelT = constrain(elapsed / RESULT_LIST_PANEL_IN_MS, 0, 1);
  const panelEase = 1 - Math.pow(1 - panelT, 3);
  const cx = bounds.x + bounds.w * 0.5;
  const cy = bounds.y + bounds.h * 0.5;
  const radiusX = bounds.w * 0.5 + ANALYSIS_CALLOUT_RADIUS_X_EXTRA;
  const radiusY = bounds.h * 0.5 + ANALYSIS_CALLOUT_RADIUS_Y_EXTRA;
  const maxItems = Math.min(resultListItems.length, RESULT_LIST_MAX_ITEMS);

  push();
  textAlign(LEFT, TOP);
  textStyle(NORMAL);
  textFont(terminalFontFamily);

  for (let i = 0; i < maxItems; i += 1) {
    const item = resultListItems[i];
    const itemElapsed = elapsed - i * RESULT_LIST_ITEM_STAGGER_MS;
    const itemT = constrain(itemElapsed / RESULT_LIST_ITEM_IN_MS, 0, 1);
    if (itemT <= 0) continue;
    const itemEase = 1 - Math.pow(1 - itemT, 2.4);
    const alpha = 245 * panelEase * itemEase;

    const angle = map(i, 0, Math.max(1, maxItems - 1), -155, 155);
    const tx = cx + Math.cos(radians(angle)) * radiusX;
    const ty = cy + Math.sin(radians(angle)) * radiusY;

    const boxW = ANALYSIS_CALLOUT_BOX_W;
    const boxH = ANALYSIS_CALLOUT_BOX_H;
    const boxX = constrain(tx - boxW * 0.5, ANALYSIS_CALLOUT_MARGIN, width - ANALYSIS_CALLOUT_MARGIN - boxW);
    const boxY = constrain(ty - boxH * 0.5, ANALYSIS_CALLOUT_MARGIN, height - ANALYSIS_CALLOUT_MARGIN - boxH);

    const anchorIndex = ANALYSIS_CALLOUT_ANCHOR_INDICES[i % ANALYSIS_CALLOUT_ANCHOR_INDICES.length];
    const anchorPoint = points[anchorIndex] || points[10] || points[0];
    const ax = Number(anchorPoint?.x);
    const ay = Number(anchorPoint?.y);
    if (Number.isFinite(ax) && Number.isFinite(ay)) {
      const edgeX = ax < boxX ? boxX : ax > boxX + boxW ? boxX + boxW : ax;
      const edgeY = constrain(ay, boxY + 8, boxY + boxH - 8);
      stroke(
        ANALYSIS_CALLOUT_CONNECTOR[0] ?? 90,
        ANALYSIS_CALLOUT_CONNECTOR[1] ?? 225,
        ANALYSIS_CALLOUT_CONNECTOR[2] ?? 255,
        (ANALYSIS_CALLOUT_CONNECTOR[3] ?? 165) * panelEase * itemEase
      );
      strokeWeight(1.4);
      line(ax, ay, edgeX, edgeY);
    }

    noStroke();
    fill(
      ANALYSIS_CALLOUT_BG[0] ?? 8,
      ANALYSIS_CALLOUT_BG[1] ?? 18,
      ANALYSIS_CALLOUT_BG[2] ?? 26,
      (ANALYSIS_CALLOUT_BG[3] ?? 175) * panelEase * itemEase
    );
    rect(boxX, boxY, boxW, boxH, 4);

    noStroke();
    fill(
      ANALYSIS_CALLOUT_LABEL[0] ?? 126,
      ANALYSIS_CALLOUT_LABEL[1] ?? 255,
      ANALYSIS_CALLOUT_LABEL[2] ?? 140,
      (ANALYSIS_CALLOUT_LABEL[3] ?? 235) * panelEase * itemEase
    );
    textStyle(BOLD);
    textSize(12);
    text(`${item.label}:`, boxX + 10, boxY + 7);

    fill(
      ANALYSIS_CALLOUT_VALUE[0] ?? 255,
      ANALYSIS_CALLOUT_VALUE[1] ?? 255,
      ANALYSIS_CALLOUT_VALUE[2] ?? 255,
      (ANALYSIS_CALLOUT_VALUE[3] ?? 235) * panelEase * itemEase
    );
    textStyle(NORMAL);
    textSize(12);
    text(item.value, boxX + 10, boxY + 24, boxW - 20, boxH - 30);
  }

  pop();
}

function getFacesInCanvasSpace(mesh, renderFrame = null) {
  if (!mesh) return [];
  if (!renderFrame) return mesh?.getFacesScaled?.() || [];
  const faces = mesh?.getFacesRaw?.() || [];
  if (!faces.length) return [];
  return mapFacesToCanvas(faces, renderFrame);
}

function drawCameraFrame(video, frame) {
  if (!video || !frame) return;
  if (CAMERA_FLIPPED) {
    push();
    translate(width, 0);
    scale(-1, 1);
    image(video, 0, 0, width, height, frame.sx, frame.sy, frame.sw, frame.sh);
    pop();
    return;
  }
  image(video, 0, 0, width, height, frame.sx, frame.sy, frame.sw, frame.sh);
}

function mapFacesToCanvas(faces, frame) {
  if (!Array.isArray(faces) || !faces.length || !frame) return [];
  const mappedFaces = [];

  for (const face of faces) {
    const sourcePoints =
      (Array.isArray(face?.keypoints) && face.keypoints) ||
      (Array.isArray(face?.landmarks) && face.landmarks) ||
      [];
    if (!sourcePoints.length) continue;

    const keypoints = [];
    for (const sourcePoint of sourcePoints) {
      const mapped = mapPointToCanvas(sourcePoint, frame);
      if (!mapped) {
        keypoints.push({ x: NaN, y: NaN, score: 0 });
      } else {
        keypoints.push({
          x: mapped.x,
          y: mapped.y,
          score: Number(sourcePoint?.score ?? sourcePoint?.confidence ?? 1),
        });
      }
    }

    mappedFaces.push({
      ...face,
      keypoints,
      landmarks: keypoints.map((p) => [p.x, p.y, 0]),
    });
  }

  return mappedFaces;
}

function mapPointToCanvas(point, frame) {
  if (!point || !frame) return null;
  const px = Number(point?.x ?? point?.[0]);
  const py = Number(point?.y ?? point?.[1]);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  let nx = (px - frame.sx) / frame.sw;
  const ny = (py - frame.sy) / frame.sh;
  if (CAMERA_FLIPPED) nx = 1 - nx;

  return {
    x: nx * width,
    y: ny * height,
  };
}

function updateFaceFrame(mesh, video, targetW, targetH) {
  if (!video || !targetW || !targetH) return null;

  const sourceW = Math.max(1, Number(video?.width) || Number(video?.elt?.videoWidth) || 640);
  const sourceH = Math.max(1, Number(video?.height) || Number(video?.elt?.videoHeight) || 480);
  const aspect = targetW / targetH;
  const fullFrame = makeClampedFrame(
    sourceW * 0.5,
    sourceH * 0.5,
    sourceW,
    sourceH,
    sourceW,
    sourceH,
    aspect
  );

  const faceBounds = getPrimaryFaceBounds(mesh);
  let targetFrame = fullFrame;

  if (faceBounds) {
    let cropW = (faceBounds.w / FACE_FRAME_WIDTH_FILL) * FACE_FRAME_PADDING;
    let cropH = (faceBounds.h / FACE_FRAME_HEIGHT_FILL) * FACE_FRAME_PADDING;

    if (cropW / cropH < aspect) {
      cropW = cropH * aspect;
    } else {
      cropH = cropW / aspect;
    }

    const zoom = constrain(sourceW / cropW, FACE_FRAME_MIN_ZOOM, FACE_FRAME_MAX_ZOOM);
    cropW = sourceW / zoom;
    cropH = cropW / aspect;

    targetFrame = makeClampedFrame(
      faceBounds.cx,
      faceBounds.cy,
      cropW,
      cropH,
      sourceW,
      sourceH,
      aspect
    );
  }

  if (!activeFaceFrame) {
    activeFaceFrame = { ...targetFrame };
  } else {
    activeFaceFrame.cx = lerp(activeFaceFrame.cx, targetFrame.cx, FACE_FRAME_SMOOTHING);
    activeFaceFrame.cy = lerp(activeFaceFrame.cy, targetFrame.cy, FACE_FRAME_SMOOTHING);
    activeFaceFrame.sw = lerp(activeFaceFrame.sw, targetFrame.sw, FACE_FRAME_ZOOM_SMOOTHING);
    activeFaceFrame.sh = lerp(activeFaceFrame.sh, targetFrame.sh, FACE_FRAME_ZOOM_SMOOTHING);
  }

  return finalizeFrame(activeFaceFrame, sourceW, sourceH, aspect);
}

function getPrimaryFaceBounds(mesh) {
  const faces = mesh?.getFacesRaw?.() || [];
  const face = faces[0];
  if (!face) return null;

  const points =
    (Array.isArray(face?.keypoints) && face.keypoints) ||
    (Array.isArray(face?.landmarks) && face.landmarks) ||
    [];
  if (!points.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    const x = Number(p?.x ?? p?.[0]);
    const y = Number(p?.y ?? p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    w: Math.max(16, maxX - minX),
    h: Math.max(16, maxY - minY),
  };
}

function getBoundsFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    const x = Number(p?.x ?? p?.[0]);
    const y = Number(p?.y ?? p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

function makeClampedFrame(cx, cy, sw, sh, sourceW, sourceH, aspect) {
  const minSw = sourceW / FACE_FRAME_MAX_ZOOM;
  const maxSw = sourceW / FACE_FRAME_MIN_ZOOM;
  const nextSw = constrain(sw, minSw, maxSw);
  const nextSh = nextSw / aspect;
  return finalizeFrame({ cx, cy, sw: nextSw, sh: nextSh }, sourceW, sourceH, aspect);
}

function finalizeFrame(frame, sourceW, sourceH, aspect) {
  let sw = constrain(frame.sw, 1, sourceW);
  let sh = sw / aspect;

  if (sh > sourceH) {
    sh = sourceH;
    sw = sh * aspect;
  }

  const halfW = sw * 0.5;
  const halfH = sh * 0.5;
  const cx = constrain(frame.cx, halfW, sourceW - halfW);
  const cy = constrain(frame.cy, halfH, sourceH - halfH);

  return {
    cx,
    cy,
    sw,
    sh,
    sx: cx - halfW,
    sy: cy - halfH,
  };
}

function getDenseEdges(points) {
  if (
    !Array.isArray(facemeshDenseEdges) ||
    facemeshDenseEdgePointCount !== points.length
  ) {
    facemeshDenseEdges = buildDenseEdges(points);
    facemeshDenseEdgePointCount = points.length;
  }
  return facemeshDenseEdges;
}

function buildDenseEdges(points) {
  if (!Array.isArray(points) || points.length < 4) return [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const diag = Math.sqrt(dx * dx + dy * dy);
  const maxDist = Math.max(8, diag * FACEMESH_DENSE_MAX_DIST_RATIO);

  const edgeSet = new Set();
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;

    const nearby = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const b = points[j];
      const bx = Number(b?.x);
      const by = Number(b?.y);
      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;
      const ddx = bx - ax;
      const ddy = by - ay;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist <= maxDist) {
        nearby.push({ j, dist });
      }
    }

    nearby.sort((u, v) => u.dist - v.dist);
    const limit = Math.min(FACEMESH_DENSE_NEIGHBORS, nearby.length);
    for (let k = 0; k < limit; k += 1) {
      const j = nearby[k].j;
      if (FACEMESH_LIP_INDICES.has(i) && FACEMESH_LIP_INDICES.has(j)) {
        continue;
      }
      const from = Math.min(i, j);
      const to = Math.max(i, j);
      edgeSet.add(`${from}:${to}`);
    }
  }

  return Array.from(edgeSet, (entry) => {
    const [from, to] = entry.split(":");
    return [Number(from), Number(to)];
  });
}

function keyPressed() {
  if (key === "f") {
    fullScreenToggle();
  }
}

function windowResized() {
  resizeCanvasToHost();
}
