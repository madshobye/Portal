let canvas;
let cam;
let qrScanner;
let qrText = "";
let statusText = "Loading scanner...";

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  console.log("[QrScannerTest] setup start");
  await loadScript("portal/QrScannerNimiq.js");
  console.log("[QrScannerTest] module loaded");

  cam = await setupWebcamera(false, 1280, 720, false, true);
  console.log("[QrScannerTest] camera ready", {
    width: cam?.width,
    height: cam?.height,
    videoWidth: cam?.elt?.videoWidth,
    videoHeight: cam?.elt?.videoHeight,
  });
  statusText = "Camera ready. Initializing scanner...";

  qrScanner = await new QrScannerNimiq({
    video: cam,
    videoIsFlipped: false,
    preferredCamera: "environment",
    onResult: (result) => {
      qrText = result?.data || result?.text || "";
      console.log("[QrScannerTest] result", result);
      statusText = "QR detected.";
    },
  }).init();
  console.log("[QrScannerTest] scanner init complete");
  statusText = "Scanner initialized. Starting...";

  await qrScanner.start();
  console.log("[QrScannerTest] scanner started");
  statusText = "Scanner running. Point camera at a QR code.";
  textSize(20);
  fill(255);
}

function draw() {
  background(0);

  qrScanner.scaleTo(width, height);
  qrScanner.drawImage();
  qrScanner.drawOverlay();

  if (qrScanner.hasNewResult()) {
    const data = qrScanner.consumeNew();
    qrText = data?.text || qrText;
  }

  noStroke();
  fill(0, 180);
  rect(16, 16, width - 32, 84, 10);
  fill(255);
  text(statusText, 24, 42, width - 48, 28);
  text(qrText || "Point camera at a QR code", 24, 72, width - 48, 60);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
