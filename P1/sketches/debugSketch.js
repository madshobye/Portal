let cam;
let gestureKnn;
let newGesture = false;
let gestures = ["ok", "no", "up", "down", "other"];
let lastDetectedHandFirst = "";
let lastDetectedHandSecond = "";
let posY = 400;
let dirY = 1;
let sentence = "";

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/handGestureKnn.js");

  cam = await setupWebcamera(false, 320, 240, true);

  gestureKnn = await new HandGestureKnn({
    video: cam,
    videoIsFlipped: true,
    backend: "webgl",
    gestureLabels: gestures,
    includeOtherLabel: true,
    otherLabel: "other",
    gestureHoldMs: 220,
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
  handleGestures();


  // interactive code

  if (newGesture == true) {
    //background("white");
  //  print(lastDetected);
   // sentence = sentence + " " + lastDetectedHandFirst;
   // print(sentence);
  }

  textSize(50);
  text(sentence, 300, 300);
  if (lastDetectedHandFirst == "ok") {
    fill("green");
    textSize(50);
    text("HEJ", 300, 300);
  }

  if (lastDetectedHandFirst == "no") {
    fill("red");
  }

  if (lastDetectedHandFirst == "up") {
    dirY = -1;
  }

  if (lastDetectedHandFirst == "down") {
    dirY = 1;
  }

  // bold elleipse
  posY = posY + dirY;
  ellipse(500, posY, 20, 20);

  // color ellipse
  noStroke();
  ellipse(width - 100, 100, 200, 200);

  // interactive code end
}

function handleGestures() {
  textSize(20);
  newGesture = false;

  const ui = gestureKnn.drawUI({ labels: gestures });

  const prediction = gestureKnn.getPrediction();
 // print(prediction);
  
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
  text("Last new gesture: " + (lastDetectedHandFirst || "(none)"), 24, height - 60);
  text("Samples: " + gestureKnn.sampleCount(), 24, height - 34);

  // Simple if-pattern for reacting to new gestures.
  if (gestureKnn.hasNewResult()) {
    const { result } = gestureKnn.consumeNew();
    if (result?.label) {
      if (result.hand === "first") {
        lastDetectedHandFirst = result.label;
      } else if (result.hand === "second") {
        lastDetectedHandSecond = result.label;
      }
      newGesture = true;
    }
  }
  fill(255);
  text("Mode: " + ui.mode, 24, 182);
  text("Selected: " + ui.selectedLabel, 24, 206);
  text(ui.statusText, 24, 230);
}
