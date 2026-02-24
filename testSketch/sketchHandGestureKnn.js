let cam;
let gestureKnn;

let gestures = ["ok", "no", "up", "down", "other"];
let lastDetected = "";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/handGestureKnn.js");

  cam = await setupWebcamera(false, 640, 480, true);

  gestureKnn = await new HandGestureKnn({
    video: cam,
    videoIsFlipped: true,
    backend: "webgl",
    gestureLabels: gestures,
    includeOtherLabel: true,
    otherLabel: "other",
    storageKey: "portal_hand_gesture_knn_demo",
    predictionThreshold: 0.62,
    cooldownMs: 1200,
    noGestureHoldMs: 220,
    trainMirrored: true,
    treatOtherAsNoGesture: true,
  }).init();

  await gestureKnn.start();

  textSize(18);
  fill(255);
}

function draw() {
  background(0);

  gestureKnn.scaleTo(width, height);
  gestureKnn.drawImage();
  gestureKnn.drawHands();

  const ui = gestureKnn.drawUI({ labels: gestures });

  const prediction = gestureKnn.getPrediction();
  fill(255);
  text(
    "Prediction: " +
      (prediction?.label || "(none)") +
      " (" +
      nf(prediction?.confidence || 0, 1, 2) +
      ")",
    24,
    height - 86
  );
  text("Last new gesture: " + (lastDetected || "(none)"), 24, height - 60);
  text("Samples: " + gestureKnn.sampleCount(), 24, height - 34);

  // Simple if-pattern for reacting to new gestures.
  if (gestureKnn.hasNewResult()) {
    const { result } = gestureKnn.consumeNew();
    if (result?.label) {
      lastDetected = result.label;
    }
  }
  fill(255);
  text("Mode: " + ui.mode, 24, 182);
  text("Selected: " + ui.selectedLabel, 24, 206);
  text(ui.statusText, 24, 230);
}
