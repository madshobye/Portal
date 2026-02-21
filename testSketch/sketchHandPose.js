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
    onResults: (hands) => {

      //    console.log(hands);

    },

  }).init();

  await handPose.start();
  textSize(20);
  fill(255);

}



function draw() {

  background(0);
  if (!cam) return;
  image(cam, 0, 0);
  handPose?.drawHands(0, 0);

  if (handPose?.hasResult()) {
    const leftHand = handPose.getLeftHand();
    const tipPos = leftHand?.index_finger_tip;
    if (tipPos) ellipse(tipPos.x, tipPos.y, 20, 20);
  }

}

