let canvas;
let cam, imageClassifier;
let bestText = "";

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/P5ImageClassifier.js");

  cam = await setupWebcamera(false, 640, 480, true);

  imageClassifier = await new P5ImageClassifier({
    model: "MobileNet",
    video: cam,
    backend: "webgl",
    topK: 3,
  }).init();

  imageClassifier.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  imageClassifier.scaleTo(width, height);
  imageClassifier.drawImage();
  imageClassifier.drawResults(24, 40, 24);

  const best = imageClassifier.getBest();
  if (best) {
    const pct = round((best.confidence || 0) * 100);
    bestText = best.label + " (" + pct + "%)";
  }

  noStroke();
  fill(0, 170);
  rect(16, height - 60, width - 32, 40);
  fill(255);
  text(bestText || "Classifying...", 24, height - 32);
}
