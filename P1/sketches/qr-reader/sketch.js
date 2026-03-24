let canvas;
let cam, qrReader;
let qrText = "";

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await loadScript("portal/QrReader.js");

  cam = await setupWebcamera(false, 640, 480, true);

  qrReader = await new QrReader({
    video: cam,
    videoIsFlipped: true,
    onResult: (result) => {
      qrText = result?.text || "";
    },
  }).init();

  qrReader.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  qrReader.scaleTo(width,height);
  qrReader.drawImage();
  qrReader.drawOverlay();

  if (qrReader.hasNewResult()) {
    const data = qrReader.consumeNew();
    qrText = data?.text || qrText;
  }

  noStroke();
  fill(0, 170);
  rect(16, 16, width - 32, 44);
  fill(255);
  text(qrText || "Point camera at a QR code", 24, 46);
}
