let video;
let qrReader;
let lastResult = null;
let lastQr3Time = -Infinity;
let urlToSketch = "https://editor.p5js.org/hobye/full/rT9bobum_";

const HOLD_MS = 750;

async function setup() {
  createCanvas(windowWidth, windowHeight);

  // Temporary until the updated Portal module is published.
  await loadScript(
    "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js"
  );
  await loadScript("portal/QrReader.js");

  video = await setupWebcamera(false, 640, 480, false);
  qrReader = await new QrReader({ video }).init();
  await qrReader.start();
}

function draw() {
  const { text, result } = qrReader?.getLatest() || {};

  if (result && result !== lastResult) {
    lastResult = result;
    if (text === "qr3") lastQr3Time = millis();
  }

  const showPink = millis() - lastQr3Time < HOLD_MS;
  background(showPink ? "pink" : "black");

  if (!showPink && video) {
    image(video, 0, 0, width, height);
  }
}