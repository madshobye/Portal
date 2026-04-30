let cam;
let handPose;
let clickPoint = null;

const CLICK_THRESHOLD_PX = 42;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/handPose.js");

  cam = await setupWebcamera(false, 640, 480, true);

  handPose = await new HandPose({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await handPose.start();
}

function draw() {
  background(0);

  if (!handPose) return;

  handPose.scaleTo(width, height);
  handPose.drawImage();
  handPose.drawHands();

  clickPoint = detectClickPoint();
  if (clickPoint) {
    drawClickEllipse(clickPoint);
  }
}

function detectClickPoint() {
  const hands = handPose?.getHandsInRect?.(0, 0, width, height) || [];

  for (const hand of hands) {
    const indexTip = hand?.index_finger_tip || hand?.index_tip;
    const thumbTip = hand?.thumb_tip;
    if (!indexTip || !thumbTip) continue;

    const pinchDistance = dist(indexTip.x, indexTip.y, thumbTip.x, thumbTip.y);
    if (pinchDistance > CLICK_THRESHOLD_PX) continue;

    return {
      x: (indexTip.x + thumbTip.x) * 0.5,
      y: (indexTip.y + thumbTip.y) * 0.5,
    };
  }

  return null;
}

function drawClickEllipse(point) {
  noStroke();
  fill(64, 255, 120, 220);
  ellipse(point.x, point.y, 42, 42);

  noFill();
  stroke(255, 255, 255, 180);
  strokeWeight(2);
  ellipse(point.x, point.y, 60, 60);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function keyPressed() {
  if (key === "f") {
    fullScreenToggle();
  }
}
