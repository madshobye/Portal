let canvas;
let cam;
let qrScanner;
let qrText = "";
let statusText = "Starting camera...";

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  textSize(20);
  fill(255);
  await loadScript("portal/QrScannerNimiq.js");
  cam = await setupWebcamera(false, 640, 480, false);
  statusText = "Camera ready.";

  qrScanner = await new QrScannerNimiq({
    video: cam,
    videoIsFlipped: false,
    preferredCamera: "environment",
    onResult: (result) => {
      qrText = result?.data || result?.text || "";
      statusText = "QR detected.";
    },
  }).init();

  await qrScanner.start();
  statusText = "Scanner running.";
}

function draw() {
  background(0);

  if (cam) {
    drawVideoCover(cam, 0, 0, width, height);
  }

  if (qrScanner) {
    qrScanner.scaleTo(width, height);
    qrScanner.drawOverlay();
  }

  if (qrScanner?.hasNewResult()) {
    const data = qrScanner.consumeNew();
    qrText = data?.text || qrText;
  }

  if (!qrText && qrScanner?.hasResult()) {
    qrText = qrScanner.getText?.() || qrText;
  }

  noStroke();
  fill(0, 170);
  rect(16, 16, width - 32, 132);
  fill(255);
  text("QR Scanner Test", 24, 42, width - 48, 24);
  text(statusText, 24, 68, width - 48, 24);
  text(qrText || "Point camera at a QR code", 24, 96, width - 48, 44);

  fill(0, 255, 140);
  ellipse(width * 0.5, height * 0.5, 80, 80);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function drawVideoCover(video, x, y, w, h) {
  const vidEl = video?.elt;
  const vw = vidEl?.videoWidth || video?.width || w;
  const vh = vidEl?.videoHeight || video?.height || h;
  if (!(vw > 0 && vh > 0)) return;

  const scale = Math.max(w / vw, h / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = x + (w - drawW) * 0.5;
  const offsetY = y + (h - drawH) * 0.5;

  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(x, y, w, h);
  drawingContext.clip();
  image(video, offsetX, offsetY, drawW, drawH);
  drawingContext.restore();
  pop();
}
