let learner;
let mode = "classification"; // "classification" | "regression"

let statusTxt = "loading...";
let lastPredictionTxt = "-";
let predictBusy = false;
let lastPredictMs = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/neuralLearner.js");
  await createLearner(mode);
}

async function createLearner(task) {
  statusTxt = `setting up ${task}...`;

  learner = await new NeuralLearner({
    task,
    backend: "webgl",
    autoTrain: true,
    retrainDebounceMs: 250,
    trainingOptions: { epochs: 35, batchSize: 12 },
  }).init();

  lastPredictionTxt = "-";
  statusTxt = `${task} ready`;
}

function draw() {
  background(18);

  fill(255);
  textSize(22);
  text("NeuralLearner demo", 24, 38);

  textSize(16);
  text(`Mode: ${mode}`, 24, 68);
  text(`Samples: ${learner ? learner.sampleCount() : 0}`, 24, 92);
  text(`Training: ${learner?.training ? "yes" : "no"}`, 24, 116);
  text(`Trained: ${learner?.isTrained() ? "yes" : "no"}`, 24, 140);
  text(`Status: ${statusTxt}`, 24, 164);
  text(`Prediction: ${lastPredictionTxt}`, 24, 188);

  textSize(14);
  if (mode === "classification") {
    text("Click LEFT half to learn label 'left', RIGHT half to learn label 'right'", 24, 220);
  } else {
    text("Click to learn mapping x -> y (regression)", 24, 220);
  }
  text("Press M to switch mode, C to clear data", 24, 242);

  // Visual helper areas
  noFill();
  stroke(255, 70);
  rect(0, 0, width / 2, height);
  rect(width / 2, 0, width / 2, height);

  // Show current mouse sample
  noStroke();
  fill(255, 120, 0);
  circle(mouseX, mouseY, 14);

  // Poll prediction every ~120ms when trained
  if (learner?.isTrained() && !predictBusy && millis() - lastPredictMs > 120) {
    doPredict();
  }
}

async function doPredict() {
  if (!learner || !learner.isTrained()) return;

  predictBusy = true;
  lastPredictMs = millis();

  try {
    if (mode === "classification") {
      const x = mouseX / width;
      const y = mouseY / height;
      await learner.predict([x, y]);

      const best = learner.getBestLabel();
      lastPredictionTxt = best ? `${best.label} (${Math.round(best.confidence * 100)}%)` : "-";
    } else {
      const x = mouseX / width;
      await learner.predict([x]);

      const val = learner.getValue();
      if (val != null) {
        const py = constrain(val * height, 0, height);
        fill(0, 200, 255);
        circle(mouseX, py, 16);
        lastPredictionTxt = `y≈${val.toFixed(3)}`;
      } else {
        lastPredictionTxt = "-";
      }
    }
  } catch (e) {
    statusTxt = `predict error: ${e?.message || e}`;
  } finally {
    predictBusy = false;
  }
}

function mousePressed() {
  if (!learner) return;

  if (mode === "classification") {
    const label = mouseX < width / 2 ? "left" : "right";
    learner.learn([mouseX / width, mouseY / height], label);
    statusTxt = `learned: ${label}`;
  } else {
    learner.learn([mouseX / width], mouseY / height);
    statusTxt = "learned: x -> y";
  }
}

async function keyReleased() {
  if (key === "m" || key === "M") {
    mode = mode === "classification" ? "regression" : "classification";
    await createLearner(mode);
  }

  if (key === "c" || key === "C") {
    learner?.clearData();
    statusTxt = "data cleared";
    lastPredictionTxt = "-";
  }

}
