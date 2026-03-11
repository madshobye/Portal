let learner;
let temp = 18;
let predictionTxt = "-";
let predicting = false;
let lastPredictMs = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  noScrolling();

  await loadScript("portal/neuralLearner.js");
  learner = await new NeuralLearner({
    task: "classification",
    autoTrain: true,
    retrainDebounceMs: 200,
    trainingOptions: { epochs: 50, batchSize: 8 },
  }).init();

  // Simple training examples: temp -> label
  learner.learn({ temp: -5 }, { label: "freezing" });
  learner.learn({ temp: 0 }, { label: "cold" });
  learner.learn({ temp: 8 }, { label: "cold" });
  learner.learn({ temp: 14 }, { label: "mild" });
  learner.learn({ temp: 20 }, { label: "nice" });
  learner.learn({ temp: 26 }, { label: "warm" });
  learner.learn({ temp: 32 }, { label: "hot" });
}

function draw() {
  background(18);

  fill(255);
  textSize(24);
  text("NeuralLearner classification", 30, 50);

  textSize(18);
  text(`Temp: ${temp} C`, 30, 90);
  text(`Prediction: ${predictionTxt}`, 30, 120);
  text(`Trained: ${learner?.isTrained() ? "yes" : "no"}`, 30, 150);
  text("Use LEFT/RIGHT arrow (or A/D)", 30, 180);

  if (learner?.isTrained() && !predicting && millis() - lastPredictMs > 150) {
    updatePrediction();
  }
}

async function updatePrediction() {
  predicting = true;
  lastPredictMs = millis();

  try {
    await learner.predict({ temp });
    const best = learner.getBestLabel();
    predictionTxt = best
      ? `${best.label} (${Math.round(best.confidence * 100)}%)`
      : "-";
  } catch (e) {
    predictionTxt = "predict error";
    print("predict error:", e);
  } finally {
    predicting = false;
  }
}

function keyPressed() {
  if (keyCode === LEFT_ARROW || key === "a" || key === "A") temp -= 1;
  if (keyCode === RIGHT_ARROW || key === "d" || key === "D") temp += 1;

  if (key === "f") fullScreenToggle();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function noScrolling() {
  document.addEventListener(
    "touchstart",
    function (event) {
      event.preventDefault();
    },
    { passive: false }
  );
}
