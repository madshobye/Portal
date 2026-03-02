let cam;
let faceMesh;
let learner;

let moods = ["neutral", "happy", "sad", "angry", "surprised", "other"];
let selectedMood = 0;
let learningMode = true;

let predictionBusy = false;
let lastPredictMs = 0;
let prediction = null;
let lastDetected = "";
let newMood = false;
let sentence = "";
let pendingLabel = "";
let pendingSinceMs = 0;
let lastCommitMs = 0;
let noFaceSinceMs = 0;

const STORAGE_KEY = "portal_face_mood_knn_demo";
const OTHER_LABEL = "other";
const predictionThreshold = 0.62;
const moodHoldMs = 220;
const cooldownMs = 1200;
const noMoodHoldMs = 220;
const noFaceGraceMs = 300;

// Subset of MediaPipe FaceMesh landmarks for expression shape.
const FACE_IDX = [
  10, 152, 234, 454, 33, 133, 362, 263, 1, 4,
  61, 291, 13, 14, 78, 308, 70, 300, 107, 336,
  159, 145, 386, 374
];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/faceMesh.js");
  await loadScript("portal/knnLearner.js");

  cam = await setupWebcamera(false, 640, 480, false);

  faceMesh = await new FaceMesh({
    video: cam,
    backend: "webgl",
    videoIsFlipped: false,
    options: { maxFaces: 1, refineLandmarks: true, flipHorizontal: false },
    onResults: () => {},
  }).init();

  await faceMesh.start();

  learner = await new KnnLearner({ backend: "webgl", k: 3 }).init();
  await learner.loadFromStorage(STORAGE_KEY, { replace: true }).catch(() => {});

  textSize(18);
  fill(255);
}

function draw() {
  background(0);
  handleMoodKnn();

  // interactive code (same style as hand gesture example)
  if (newMood) {
    sentence = (sentence + " " + lastDetected).trim();
  }

  textSize(44);
  fill(255);
  text(sentence, 300, 280, width - 320, 220);

  if (lastDetected === "happy") {
    fill("green");
    text("SMILE", 300, 180);
  } else if (lastDetected === "sad") {
    fill("deepskyblue");
    text("CALM", 300, 180);
  } else if (lastDetected === "angry") {
    fill("red");
    text("POWER", 300, 180);
  } else if (lastDetected === "surprised") {
    fill("orange");
    text("WOW", 300, 180);
  }
}

function handleMoodKnn() {
  newMood = false;

  faceMesh.scaleTo(width, height);
  faceMesh.drawImage();
  faceMesh.drawKeypoints(0, 0, null, null, {
    pointSize: 3,
    color: [0, 255, 0],
  });

  const vec = getFaceVector();

  if (vec && !learningMode && !predictionBusy && millis() - lastPredictMs > 110) {
    doPredict(vec);
  }
  if (!learningMode && !vec) handleNoFaceGap();

  drawUI(vec);

  if (learner?.hasNewResult()) {
    const { result } = learner.consumeNew();
    consumeStableMood(result);
  }
}

function drawUI(vec) {
  const modeLabel = learningMode ? "Learn" : "Run";
  const modeColor = learningMode ? "red" : "#888";
  const modeRes = uiButton(modeLabel, {
    x: 24,
    y: 24,
    width: 140,
    height: 42,
    fontSize: 20,
    bgColor: modeColor,
    hAlign: "center",
  });
  if (modeRes.clicked) learningMode = !learningMode;

  if (uiButton("Clear", {
    x: 174,
    y: 24,
    width: 120,
    height: 42,
    fontSize: 20,
    hAlign: "center",
    bgColor: "#222",
    textColor: "white",
  }).clicked) {
    learner?.clearData();
    localStorage.removeItem(STORAGE_KEY);
    prediction = null;
    lastDetected = "";
    sentence = "";
  }

  if (learningMode) {
    const labelCounts = learner?.getCountsByLabel?.() || {};
    for (let i = 0; i < moods.length; i++) {
      const y = 84 + i * 46;
      const isSel = i === selectedMood;
      const label = moods[i];
      const count = labelCounts[label] || 0;
      const res = uiButton(moods[i], {
        x: 24,
        y,
        width: 220,
        height: 40,
        fontSize: 18,
        hAlign: "left",
        bgColor: isSel ? "#444" : "#222",
        textColor: "white",
      });

      if (res.clicked) {
        selectedMood = i;
        if (vec) {
          learner.learn(vec, label);
          learner.saveToStorage(STORAGE_KEY);
        }
      }
      fill(255);
      textSize(16);
      textAlign(RIGHT, CENTER);
      text(String(count), 24 + 220 - 10, y + 20);
    }
    textAlign(LEFT, BASELINE);
  } else {
    for (let i = 0; i < moods.length; i++) {
      const y = 84 + i * 46;
      const label = moods[i];
      const isPredicted = prediction?.label === label;
      const isLast = lastDetected === label;
      const active = isPredicted || isLast;

      uiButton(label, {
        x: 24,
        y,
        width: 220,
        height: 40,
        fontSize: 18,
        hAlign: "left",
        bgColor: active ? "#1b7f3a" : "#222",
        textColor: "white",
      });
    }
  }

  const best = prediction?.label || "(none)";
  const conf = prediction?.confidence || 0;

  fill(255);
  textSize(20);
  text("Mode: " + modeLabel, 24, height - 120);
  text("Selected: " + moods[selectedMood], 24, height - 92);
  text("Prediction: " + best + " (" + nf(conf, 1, 2) + ")", 24, height - 64);
  text("Samples: " + (learner?.sampleCount?.() || 0), 24, height - 36);
}

async function doPredict(vec) {
  predictionBusy = true;
  lastPredictMs = millis();

  try {
    await learner.predict(vec);
    prediction = learner.getBestLabel();
  } catch (e) {
    console.warn("Face mood predict warning:", e);
  } finally {
    predictionBusy = false;
  }
}

function consumeStableMood(result) {
  const now = millis();
  const label = String(result?.label || "");
  const confs = result?.confidencesByLabel || {};
  const confidence = Number(confs[label] || 0);

  if (!label || !Number.isFinite(confidence) || confidence < predictionThreshold) {
    handleNoMood(now);
    return;
  }

  noFaceSinceMs = 0;
  if (pendingLabel !== label) {
    pendingLabel = label;
    pendingSinceMs = now;
    return;
  }

  if (now - pendingSinceMs < moodHoldMs) return;
  if (now - lastCommitMs < cooldownMs) return;
  if (label === lastDetected) return;

  lastDetected = label;
  lastCommitMs = now;
  pendingLabel = label;
  pendingSinceMs = now;
  newMood = label !== OTHER_LABEL;
}

function handleNoMood(now = millis()) {
  if (!pendingLabel) return;
  if (now - pendingSinceMs < noMoodHoldMs) return;
  pendingLabel = "";
  pendingSinceMs = 0;
}

function handleNoFaceGap() {
  const now = millis();
  if (!noFaceSinceMs) {
    noFaceSinceMs = now;
    return;
  }
  if (now - noFaceSinceMs < noFaceGraceMs) return;
  handleNoMood(now);
}

function getFaceVector() {
  const faces = faceMesh?.getFacesScaled?.() || [];
  const f = faces[0];
  if (!f?.keypoints?.length) return null;

  const pts = FACE_IDX
    .map((idx) => f.keypoints[idx])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

  if (pts.length < 8) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const s = max(1e-5, max(w, h));
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const v = [];
  for (const p of pts) {
    v.push((p.x - cx) / s);
    v.push((p.y - cy) / s);
  }

  return v;
}
