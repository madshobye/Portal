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
  bodyPose.drawPoses(0, 0, null, null, {
    drawSkeleton: true,
    drawKeypoints: true,
    showLabels: false,
    ptSize: 6,
    minConfidence: 0.4,
    minPoseScore: 0,
  });

  const pose = bodyPose.getPosesScaled?.()[0];
  if (pose) {
    const rightWrist = pose.right_wrist;
  

    if (rightWrist) {
      fill("yellow");
      noStroke();
      ellipse(rightWrist.x, rightWrist.y, 22, 22);
    }
  }
}
