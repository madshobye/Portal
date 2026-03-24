let canvas;
let cam, faceMesh;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/faceMesh.js");

  cam = await setupWebcamera(false, 640, 480, true);

  faceMesh = await new FaceMesh({
    video: cam,
    backend: "webgl",
    videoIsFlipped: true,
    onResults: () => {},
  }).init();

  await faceMesh.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  faceMesh.scaleTo(width, height);
  faceMesh.drawImage();
  faceMesh.drawFaces(0, 0, null, null, {
    minConfidence: 0,
    pointSize: 3,
    color: [0, 255, 0],
  });
}
