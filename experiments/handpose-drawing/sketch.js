let video;
let handPose;
let drawingLayer;
let statusText = "Starting camera…";

let previousBrushPoint = null;
let smoothedBrushPoint = null;
let isDrawing = false;
let brushSize = 18;
let colorIndex = 0;

const COLORS = [
  [255, 79, 112],
  [255, 197, 61],
  [95, 224, 146],
  [77, 190, 255],
  [173, 119, 255],
  [255, 255, 255],
];

const SMOOTHING = 0.42;
const MIN_PINCH_DISTANCE = 24;
const PINCH_TO_PALM_RATIO = 0.38;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  drawingLayer = createGraphics(width, height);
  drawingLayer.pixelDensity(1);

  try {
    assertCameraAvailable();
    video = await setupWebcamera(true, 640, 480, true);
    await loadScript("portal/handPose.js");

    handPose = await new HandPose({
      video,
      videoIsFlipped: true,
      backend: "webgl",
    }).init();

    await handPose.start();
    statusText = "Show one hand, then pinch to draw";
  } catch (error) {
    statusText = getCameraErrorMessage(error);
    console.error(error);
  }
}

function assertCameraAvailable() {
  if (!window.isSecureContext) {
    throw new Error("camera-insecure-context");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("camera-api-unavailable");
  }
}

function getCameraErrorMessage(error) {
  const message = String(error?.message || error || "");

  if (message.includes("camera-insecure-context")) {
    return "Camera blocked — open this sketch via HTTPS or localhost";
  }

  if (
    message.includes("camera-api-unavailable") ||
    message.includes("getUserMedia is not implemented")
  ) {
    return "Camera unavailable — open the sketch in Chrome or Safari";
  }

  if (message.includes("NotAllowedError") || message.includes("Permission")) {
    return "Camera permission denied — allow camera access and reload";
  }

  return `Could not start camera: ${message}`;
}

function draw() {
  background(9, 11, 16);

  if (video) {
    image(video, 0, 0, width, height);
    drawCameraShade();
  }

  const hands = handPose?.getHandsInRect?.(0, 0, width, height) || [];
  const brush = getBrushFromHand(hands[0]);
  updateDrawing(brush);

  image(drawingLayer, 0, 0);
  drawBrushCursor(brush);
  drawInterface(hands.length);
}

function getBrushFromHand(hand) {
  const indexTip = hand?.index_finger_tip || hand?.index_tip;
  const thumbTip = hand?.thumb_tip;
  const indexBase = hand?.index_finger_mcp;
  const pinkyBase = hand?.pinky_finger_mcp;

  if (!indexTip || !thumbTip) return null;

  const rawPoint = {
    x: (indexTip.x + thumbTip.x) * 0.5,
    y: (indexTip.y + thumbTip.y) * 0.5,
  };

  if (!smoothedBrushPoint) smoothedBrushPoint = { ...rawPoint };
  smoothedBrushPoint.x = lerp(smoothedBrushPoint.x, rawPoint.x, SMOOTHING);
  smoothedBrushPoint.y = lerp(smoothedBrushPoint.y, rawPoint.y, SMOOTHING);

  const pinchDistance = dist(indexTip.x, indexTip.y, thumbTip.x, thumbTip.y);
  const palmWidth =
    indexBase && pinkyBase
      ? dist(indexBase.x, indexBase.y, pinkyBase.x, pinkyBase.y)
      : 100;
  const pinchThreshold = max(MIN_PINCH_DISTANCE, palmWidth * PINCH_TO_PALM_RATIO);

  return {
    x: smoothedBrushPoint.x,
    y: smoothedBrushPoint.y,
    pinching: pinchDistance < pinchThreshold,
    pinchAmount: constrain(1 - pinchDistance / pinchThreshold, 0, 1),
  };
}

function updateDrawing(brush) {
  if (!brush) {
    stopStroke();
    smoothedBrushPoint = null;
    return;
  }

  if (!brush.pinching) {
    stopStroke();
    return;
  }

  const point = { x: brush.x, y: brush.y };
  const color = COLORS[colorIndex];

  drawingLayer.stroke(color[0], color[1], color[2], 235);
  drawingLayer.strokeWeight(brushSize);
  drawingLayer.strokeCap(ROUND);
  drawingLayer.strokeJoin(ROUND);

  if (previousBrushPoint) {
    drawingLayer.line(previousBrushPoint.x, previousBrushPoint.y, point.x, point.y);
  } else {
    drawingLayer.point(point.x, point.y);
  }

  previousBrushPoint = point;
  isDrawing = true;
}

function stopStroke() {
  previousBrushPoint = null;
  isDrawing = false;
}

function drawCameraShade() {
  noStroke();
  fill(4, 7, 14, 82);
  rect(0, 0, width, height);
}

function drawBrushCursor(brush) {
  if (!brush) return;

  const color = COLORS[colorIndex];
  const cursorSize = brushSize + 16;

  noFill();
  stroke(255, brush.pinching ? 245 : 150);
  strokeWeight(2);
  circle(brush.x, brush.y, cursorSize);

  noStroke();
  fill(color[0], color[1], color[2], brush.pinching ? 255 : 150);
  circle(brush.x, brush.y, max(7, brushSize * 0.42));

  if (brush.pinching) {
    noFill();
    stroke(color[0], color[1], color[2], 95);
    strokeWeight(3);
    circle(brush.x, brush.y, cursorSize + 10 + brush.pinchAmount * 10);
  }
}

function drawInterface(handCount) {
  const panelWidth = min(460, width - 32);

  noStroke();
  fill(5, 8, 14, 190);
  rect(16, 16, panelWidth, 116, 16);

  fill(255);
  textSize(19);
  textStyle(BOLD);
  text("AIR DRAWING", 32, 47);

  textStyle(NORMAL);
  textSize(13);
  fill(225);
  text(statusText, 32, 72);
  fill(180);
  text(
    `Pinch: paint   C: clear   1–6: color   [ / ]: brush (${brushSize}px)`,
    32,
    96
  );
  text(`Hands: ${handCount}   ${isDrawing ? "PAINTING" : "READY"}`, 32, 116);

  drawPalette();
}

function drawPalette() {
  const gap = 34;
  const y = height - 34;
  const paletteWidth = (COLORS.length - 1) * gap + 28;
  const startX = width * 0.5 - paletteWidth * 0.5;

  noStroke();
  fill(5, 8, 14, 185);
  rect(startX - 16, y - 24, paletteWidth + 32, 48, 24);

  for (let i = 0; i < COLORS.length; i++) {
    const x = startX + i * gap + 14;
    const color = COLORS[i];

    if (i === colorIndex) {
      noFill();
      stroke(255);
      strokeWeight(2);
      circle(x, y, 28);
    }

    noStroke();
    fill(color[0], color[1], color[2]);
    circle(x, y, i === colorIndex ? 19 : 15);
  }
}

function keyPressed() {
  if (key === "c" || key === "C" || key === "Backspace") {
    drawingLayer.clear();
    stopStroke();
    return false;
  }

  const number = Number(key);
  if (number >= 1 && number <= COLORS.length) {
    colorIndex = number - 1;
    stopStroke();
  }

  if (key === "[") brushSize = max(4, brushSize - 4);
  if (key === "]") brushSize = min(80, brushSize + 4);
}

function mousePressed() {
  const gap = 34;
  const paletteWidth = (COLORS.length - 1) * gap + 28;
  const startX = width * 0.5 - paletteWidth * 0.5;
  const y = height - 34;

  for (let i = 0; i < COLORS.length; i++) {
    const x = startX + i * gap + 14;
    if (dist(mouseX, mouseY, x, y) < 18) {
      colorIndex = i;
      stopStroke();
      return false;
    }
  }
}

function windowResized() {
  const oldLayer = drawingLayer;
  resizeCanvas(windowWidth, windowHeight);

  drawingLayer = createGraphics(width, height);
  drawingLayer.pixelDensity(1);
  if (oldLayer) drawingLayer.image(oldLayer, 0, 0, width, height);

  stopStroke();
  smoothedBrushPoint = null;
}
