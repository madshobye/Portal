let learner;
let predictedMood = "-";
let temp = 20;
let predicting = false;
let lastPredictMs = 0;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  noScrolling();
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
  });
  await loadScript("portal/neuralLearner.js");

  learner = await new NeuralLearner({
    task: "regression",
    autoTrain: true,
    retrainDebounceMs: 200,
    trainingOptions: { epochs: 60, batchSize: 8 },
  }).init();

  // Simple training examples: temp -> mood (0..4)
  learner.learn({ temp: -5 ,rain: false}, { mood: 3.0 });
  learner.learn({ temp: 0 ,rain: false}, { mood: 3.0 });
  learner.learn({ temp: 8 ,rain: false}, { mood: 3.0 });
  learner.learn({ temp: 14,rain: true }, { mood: 0.0 });
  learner.learn({ temp: 20 ,rain: false}, { mood: 3.0 });
  learner.learn({ temp: 26, rain: false}, { mood: 3.8 });
  learner.learn({ temp: 32,rain: true }, { mood: 0.0 });
}

function draw() {
  background(20);

  fill(255);
  textSize(24);
  text("NeuralLearner: temp -> mood", 30, 50);

  textSize(18);
  text(`Temp: ${temp} C`, 30, 90);
  text(`Predicted mood: ${predictedMood}`, 30, 120);
  text("Use LEFT/RIGHT arrow (or A/D) to change temp", 30, 160);

  if (learner?.isTrained() && !predicting && millis() - lastPredictMs > 120) {
    updatePrediction();
  }
}

async function updatePrediction() {
  predicting = true;
  lastPredictMs = millis();
  try {
    await learner.predict({ temp, rain:false });
    const mood = learner.getValue("mood");
    if (mood != null) predictedMood = mood.toFixed(2);
  } catch (e) {
    predictedMood = "predict error";
    print("predict error:", e);
  } finally {
    predicting = false;
  }
}

function keyPressed() {
  if (keyCode === LEFT_ARROW || key === "a" || key === "A") temp -= 1;
  if (keyCode === RIGHT_ARROW || key === "d" || key === "D") temp += 1;
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
