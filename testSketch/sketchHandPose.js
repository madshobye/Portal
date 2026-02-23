let canvas;
let cam, handPose;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/handPose.js");

  cam = await setupWebcamera(false, 640, 480, true);

  handPose = await new HandPose({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await handPose.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);


  handPose.scaleTo(width, height);
  handPose.drawImage();
  handPose.drawHands();

  if (handPose?.hasResult()) {
    const firstHand = handPose.getFirstHand();
    const secondHand = handPose.getSecondHand();

    const tipFirst = firstHand?.index_finger_tip;
    if (tipFirst) {
      fill("yellow");
      ellipse(tipFirst.x, tipFirst.y, 20, 20);
    }

    const tipSecond = secondHand?.index_finger_tip;
    if (tipSecond) {
      fill("cyan");
      ellipse(tipSecond.x, tipSecond.y, 16, 16);
    }
  }
}
