let cam;
let bodyPose;
let newPoseEvent = false;
let lastDetected = "";

let posY = 400;
let dirY = 1;
let dotColor = "white";
let sentence = "";

let candidateLabel = "";
let candidateFrames = 0;
let stableLabel = "";
let noneFrames = 0;
let lastEventMs = 0;

const HOLD_FRAMES = 6;
const NONE_RESET_FRAMES = 8;
const EVENT_COOLDOWN_MS = 900;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/bodyPose.js");

  cam = await setupWebcamera(false, 640, 480, true);

  bodyPose = await new BodyPose({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await bodyPose.start();

  textSize(18);
  fill(255);
}

function draw() {
  background(0);

  handleBodyPose();

  // interactive code
  if (newPoseEvent) {
    sentence = (sentence + " " + lastDetected).trim();
  }

  if (lastDetected === "up") dirY = -1;
  if (lastDetected === "down") dirY = 1;
  if (lastDetected === "left") dotColor = "cyan";
  if (lastDetected === "right") dotColor = "magenta";

  posY += dirY;
  posY = constrain(posY, 120, height - 120);

  noStroke();
  fill(dotColor);
  ellipse(width - 120, posY, 30, 30);

  fill(255);
  textSize(36);
  text(sentence, 300, 100, width - 340, 200);
  // interactive code end
}

function handleBodyPose() {
  newPoseEvent = false;

  bodyPose.scaleTo(width, height);
  bodyPose.drawImage();
  bodyPose.drawPoses(0, 0, null, null, {
    drawSkeleton: true,
    drawKeypoints: true,
    showLabels: false,
    ptSize: 6,
    minConfidence: 0.4,
    minPoseScore: 0,
  });

  const poses = bodyPose.getPosesScaled?.() || [];
  const pose = poses[0];

  let predictionLabel = "";

  if (pose) {
    const nose = pose.nose;
    const leftWrist = pose.left_wrist;
    const rightWrist = pose.right_wrist;
    const leftShoulder = pose.left_shoulder;
    const rightShoulder = pose.right_shoulder;
    const leftHip = pose.left_hip;
    const rightHip = pose.right_hip;

    if (leftWrist) {
      fill("yellow");
      noStroke();
      ellipse(leftWrist.x, leftWrist.y, 20, 20);
    }
    if (rightWrist) {
      fill("orange");
      noStroke();
      ellipse(rightWrist.x, rightWrist.y, 20, 20);
    }

    if (nose && leftWrist && rightWrist && leftHip && rightHip && leftShoulder && rightShoulder) {
      const bothAboveHead = leftWrist.y < nose.y - 20 && rightWrist.y < nose.y - 20;
      const bothBelowHip = leftWrist.y > leftHip.y + 20 && rightWrist.y > rightHip.y + 20;
      const leftOut = leftWrist.x < leftShoulder.x - 50;
      const rightOut = rightWrist.x > rightShoulder.x + 50;

      if (bothAboveHead) predictionLabel = "up";
      else if (bothBelowHip) predictionLabel = "down";
      else if (leftOut) predictionLabel = "left";
      else if (rightOut) predictionLabel = "right";
    }
  }

  updatePoseEvents(predictionLabel);

  fill(255);
  textSize(20);
  text("Prediction: " + (predictionLabel || "(none)"), 24, height - 86);
  text("Last new gesture: " + (lastDetected || "(none)"), 24, height - 60);
  text("Detected people: " + poses.length, 24, height - 34);
}

function updatePoseEvents(label) {
  if (!label) {
    noneFrames++;
    if (noneFrames >= NONE_RESET_FRAMES) {
      stableLabel = "";
      candidateLabel = "";
      candidateFrames = 0;
    }
    return;
  }

  noneFrames = 0;

  if (label === candidateLabel) {
    candidateFrames++;
  } else {
    candidateLabel = label;
    candidateFrames = 1;
  }

  const ready = candidateFrames >= HOLD_FRAMES;
  const cooldownOk = millis() - lastEventMs >= EVENT_COOLDOWN_MS;

  if (ready && cooldownOk && label !== stableLabel) {
    stableLabel = label;
    lastDetected = label;
    newPoseEvent = true;
    lastEventMs = millis();
  }
}
