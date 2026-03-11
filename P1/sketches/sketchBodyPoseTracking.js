let canvas;
let cam, bodyPose;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/bodyPose.js");

  cam = await setupWebcamera(false, 640, 480, true);

  bodyPose = await new BodyPose({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await bodyPose.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  bodyPose.scaleTo(width, height);
  bodyPose.drawImage();
  bodyPose.drawPoses();

  const poses = bodyPose.getPosesScaled?.() || [];
  const firstPose = poses[0];
  const secondPose = poses[1];

  const firstRightWrist = firstPose?.right_wrist;
  if (firstRightWrist) {
    fill("yellow");
    noStroke();
    ellipse(firstRightWrist.x, firstRightWrist.y, 20, 20);
  }

  const secondRightWrist = secondPose?.right_wrist;
  if (secondRightWrist) {
    fill("cyan");
    noStroke();
    ellipse(secondRightWrist.x, secondRightWrist.y, 16, 16);
  }
}
