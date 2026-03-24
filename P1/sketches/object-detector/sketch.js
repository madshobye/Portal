let canvas;
let cam, objectDetector;
let bestLabel = "";

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/P5ObjectDetector.js");

  cam = await setupWebcamera(false, 640, 480, true);

  objectDetector = await new P5ObjectDetector({
    model: "cocossd",
    video: cam,
    videoIsFlipped: true,
    backend: "webgl",
    scoreThreshold: 0.5,
  }).init();

  objectDetector.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  objectDetector.scaleTo(width, height);
  objectDetector.drawImage();
  objectDetector.drawDetections();

  const best = objectDetector.getBest();
  bestLabel = best?.label || "";

  noStroke();
  fill(0, 170);
  rect(16, 16, width - 32, 44);
  fill(255);
  text(bestLabel || "Detecting objects...", 24, 46);
}
