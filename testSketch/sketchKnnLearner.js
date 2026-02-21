let learner;
let statusTxt = "loading...";
let predictionTxt = "-";
let predictBusy = false;
let lastPredictMs = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/knnLearner.js");

  learner = await new KnnLearner({ backend: "webgl" }).init();
  statusTxt = "ready";
}

function draw() {
  background(16);

  fill(255);
  textSize(22);
  text("KnnLearner demo", 24, 38);

  textSize(16);
  text(`Labels: ${learner ? learner.labelCount() : 0}`, 24, 70);
  text(`Samples: ${learner ? learner.sampleCount() : 0}`, 24, 94);
  text(`Status: ${statusTxt}`, 24, 118);
  text(`Prediction: ${predictionTxt}`, 24, 142);

  textSize(14);
  text("Click LEFT half to learn 'left', RIGHT half to learn 'right'", 24, 172);
  text("Press P to predict, C to clear", 24, 194);

  noFill();
  stroke(255, 70);
  rect(0, 0, width / 2, height);
  rect(width / 2, 0, width / 2, height);

  noStroke();
  fill(255, 120, 0);
  circle(mouseX, mouseY, 14);

  if (learner && learner.labelCount() > 0 && !predictBusy && millis() - lastPredictMs > 120) {
    doPredict();
  }
}

async function doPredict() {
  predictBusy = true;
  lastPredictMs = millis();

  try {
    const x = mouseX / width;
    const y = mouseY / height;
    await learner.predict([x, y]);

    const best = learner.getBestLabel();
    predictionTxt = best ? `${best.label} (${Math.round(best.confidence * 100)}%)` : "-";
  } catch (e) {
    statusTxt = `predict error: ${e?.message || e}`;
  } finally {
    predictBusy = false;
  }
}

function mousePressed() {
  if (!learner) return;

  const label = mouseX < width / 2 ? "left" : "right";
  learner.learn([mouseX / width, mouseY / height], label);
  statusTxt = `learned: ${label}`;
}

function keyReleased() {
  if (key === "p" || key === "P") {
    doPredict();
  }

  if (key === "c" || key === "C") {
    learner?.clearData();
    predictionTxt = "-";
    statusTxt = "data cleared";
  }

  if (key === "f") {
    fullScreenToggle();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
