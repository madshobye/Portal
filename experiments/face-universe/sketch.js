let canvas;
let cam;
let faceTracker;
let universe;
let statusElement;
let previewCanvas;
let previewContext;
let debugToggle;

const LOW_RES_WIDTH = 1280;
const LOW_RES_HEIGHT = 720;
const WINDOW_Z = 120;
const WINDOW_CENTER_Y = -95;
const WINDOW_HALF_HEIGHT = 210;
const WINDOW_HALF_WIDTH = WINDOW_HALF_HEIGHT * (LOW_RES_WIDTH / LOW_RES_HEIGHT);
const CAMERA_NEAR = 10;
const CAMERA_FAR = 4000;

const view = {
  x: 0,
  y: 0,
  zoom: 1,
  yaw: 0,
  pitch: 0,
  roll: 0,
  tracked: false,
};

let trackingMessage = "NO FACE";
let blocks = [];
let neutralFace = null;

function setup() {
  canvas = createCanvas(LOW_RES_WIDTH, LOW_RES_HEIGHT, WEBGL);
  setAttributes("antialias", true);
  pixelDensity(1);
  noSmooth();
  universe = window;
  createUniverse();

  statusElement = document.querySelector("#tracking-status");
  previewCanvas = document.querySelector("#face-preview");
  previewContext = previewCanvas?.getContext("2d");
  debugToggle = document.querySelector("#debug-toggle");
  debugToggle?.addEventListener("click", toggleFaceDebug);

  startFaceTracking();
}

async function startFaceTracking() {
  await loadScript("portal/faceTracker.js");

  try {
    cam = await setupWebcamera(true, 640, 480, true);
    faceTracker = await new FaceTracker({
      video: cam,
      videoIsFlipped: true,
      maxFaces: 1,
      targetFps: 30,
      smoothing: 0.5,
    }).init();

    await faceTracker.start();
    trackingMessage = "NO FACE";
  } catch (error) {
    console.error(error);
    trackingMessage = "NO FACE";
  }
}

function draw() {
  updateViewFromFace();
  drawUniverse(universe);
  drawWindowFrame();
  drawWebcamPreview();
}

function drawWebcamPreview() {
  if (!previewCanvas || !previewContext || previewCanvas.classList.contains("is-hidden")) return;

  const previewWidth = previewCanvas.width;
  const previewHeight = previewCanvas.height;
  const video = cam?.elt;

  previewContext.fillStyle = "#01040d";
  previewContext.fillRect(0, 0, previewWidth, previewHeight);

  if (!video || video.readyState < 2) return;

  // Mirror the complete camera frame to match the tracker coordinates.
  previewContext.save();
  previewContext.translate(previewWidth, 0);
  previewContext.scale(-1, 1);
  previewContext.drawImage(video, 0, 0, previewWidth, previewHeight);
  previewContext.restore();

  const faces = faceTracker?.getFacesInRect?.(0, 0, previewWidth, previewHeight) || [];
  previewContext.lineWidth = 2;
  previewContext.font = "bold 11px monospace";

  for (const face of faces) {
    previewContext.strokeStyle = "#54ffbd";
    previewContext.strokeRect(face.box.x, face.box.y, face.box.width, face.box.height);

    for (const point of face.keypoints || []) {
      previewContext.beginPath();
      previewContext.arc(point.x, point.y, point.name === "noseTip" ? 4 : 3, 0, TWO_PI);
      previewContext.fillStyle = point.name === "noseTip" ? "#ff52ce" : "#67e2ff";
      previewContext.fill();
      previewContext.strokeStyle = "rgba(1, 4, 13, 0.8)";
      previewContext.stroke();
    }

    previewContext.fillStyle = "#54ffbd";
    previewContext.fillText(
      `${round(face.score * 100)}%`,
      face.box.x + 4,
      max(12, face.box.y - 5),
    );
  }
}

function toggleFaceDebug() {
  if (!previewCanvas || !debugToggle) return;
  const willOpen = previewCanvas.classList.contains("is-hidden");
  previewCanvas.classList.toggle("is-hidden", !willOpen);
  debugToggle.setAttribute("aria-expanded", String(willOpen));
}

function updateViewFromFace() {
  const face = faceTracker?.getLatest?.().best;
  const points = face?.keypoints || [];
  const videoWidth = cam?.width || cam?.elt?.videoWidth || 640;
  const videoHeight = cam?.height || cam?.elt?.videoHeight || 480;

  if (points.length >= 3) {
    const bounds = face.box
      ? {
          minX: face.box.x,
          minY: face.box.y,
          maxX: face.box.x + face.box.width,
          maxY: face.box.y + face.box.height,
          centerX: face.center.x,
          centerY: face.center.y,
        }
      : getFaceBounds(points);
    const leftEye = face.leftEye || points[0];
    const rightEye = face.rightEye || points[1];
    const eyeCenter = leftEye && rightEye
      ? {
          x: (leftEye.x + rightEye.x) * 0.5,
          y: (leftEye.y + rightEye.y) * 0.5,
        }
      : { x: bounds.centerX, y: bounds.centerY };
    const rotation = face.rotation || { yaw: 0, pitch: 0, roll: 0 };

    const normalizedEyeX = eyeCenter.x / videoWidth;
    const normalizedEyeY = eyeCenter.y / videoHeight;
    const normalizedFaceHeight = (bounds.maxY - bounds.minY) / videoHeight;

    // Treat the first detected pose as the comfortable centered viewing position.
    if (!neutralFace) {
      neutralFace = {
        x: normalizedEyeX,
        y: normalizedEyeY,
        height: normalizedFaceHeight,
      };
    }

    // The eyes locate the viewer. Head rotation adds only a small correction.
    const positionX = (normalizedEyeX - neutralFace.x) / 0.18;
    const positionY = (normalizedEyeY - neutralFace.y) / 0.2;
    const relativeDistance = normalizedFaceHeight / max(0.01, neutralFace.height);

    view.yaw = lerp(view.yaw, rotation.yaw, 0.22);
    view.pitch = lerp(view.pitch, rotation.pitch, 0.2);
    view.roll = lerp(view.roll, rotation.roll, 0.2);
    view.x = lerp(view.x, constrain(positionX * 0.95, -1.25, 1.25), 0.24);
    view.y = lerp(view.y, constrain(positionY * 0.75 - rotation.pitch * 0.2, -1, 1), 0.22);
    view.zoom = lerp(
      view.zoom,
      1 / pow(max(0.05, relativeDistance), 0.65),
      0.18,
    );
    view.tracked = true;
    trackingMessage = "FACE LOCKED";
    return;
  }

  // Mouse control keeps the scene explorable while the camera is starting.
  const mouseViewX = map(mouseX, 0, max(1, width), -0.75, 0.75);
  const mouseViewY = map(mouseY, 0, max(1, height), -0.55, 0.55);
  view.x = lerp(view.x, mouseViewX, 0.025);
  view.y = lerp(view.y, mouseViewY, 0.025);
  view.zoom = lerp(view.zoom, 1, 0.035);
  view.yaw = lerp(view.yaw, 0, 0.04);
  view.pitch = lerp(view.pitch, 0, 0.04);
  view.roll = lerp(view.roll, 0, 0.04);
  view.tracked = false;

  trackingMessage = "NO FACE";
}

function getFaceBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    minX = min(minX, point.x);
    minY = min(minY, point.y);
    maxX = max(maxX, point.x);
    maxY = max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function createUniverse() {
  randomSeed(23);

  const colors = [
    [22, 225, 242],
    [255, 211, 54],
    [132, 94, 255],
    [55, 255, 164],
  ];

  const foregroundBlocks = [
    { x: -520, z: 45, size: 125, height: 165, lift: 0 },
    { x: 520, z: 20, size: 115, height: 145, lift: 0 },
    { x: -710, z: -170, size: 100, height: 120, lift: 0 },
    { x: 700, z: -210, size: 92, height: 112, lift: 0 },
    { x: -390, z: -190, size: 72, height: 88, lift: 65 },
    { x: 390, z: -235, size: 68, height: 82, lift: 90 },
  ];

  for (const block of foregroundBlocks) {
    blocks.push(makeBlock(block, colors));
  }

  // Keep enough physical space between objects to avoid accidental intersections.
  const occupied = [
    ...blocks.map((block) => ({ x: block.x, z: block.z, radius: block.size * 0.8 + 35 })),
    { x: 0, z: -380, radius: 205 },
    { x: -320, z: -550, radius: 135 },
    { x: 420, z: -820, radius: 165 },
  ];

  let attempts = 0;
  while (blocks.length < 30 && attempts < 1200) {
    attempts++;
    const size = random([28, 36, 46, 58, 72, 86]);
    const candidate = {
      x: random(-820, 820),
      z: random(-1380, -120),
      size,
      height: random([34, 48, 64, 82, 105]),
      lift: random([0, 0, 0, 35, 70, 115]),
    };
    const radius = size * 0.8 + 38;
    const hasRoom = occupied.every((other) =>
      dist(candidate.x, candidate.z, other.x, other.z) > radius + other.radius,
    );

    if (!hasRoom) continue;
    blocks.push(makeBlock(candidate, colors));
    occupied.push({ x: candidate.x, z: candidate.z, radius });
  }
}

function makeBlock(block, colors) {
  return {
    ...block,
    color: random(colors),
    spin: random(TWO_PI),
    speed: random(-0.004, 0.004),
  };
}

function drawUniverse(g) {
  g.background(2, 7, 25);

  const eyeX = view.x * 180;
  const eyeY = WINDOW_CENTER_Y + view.y * 75;
  const eyeToWindow = 400 / max(0.05, view.zoom);
  const eyeZ = WINDOW_Z + eyeToWindow;
  const nearPlane = min(CAMERA_NEAR, max(0.5, eyeToWindow * 0.25));
  const nearScale = nearPlane / eyeToWindow;
  const lookYaw = view.yaw * 0.35;
  const lookX = eyeX + sin(lookYaw);
  const lookZ = eyeZ - cos(lookYaw);
  const viewportRoll = -view.roll * 0.3;
  const upX = sin(viewportRoll);
  const upY = cos(viewportRoll);

  // Translation moves the viewport; yaw turns it and head tilt controls roll.
  g.camera(eyeX, eyeY, eyeZ, lookX, eyeY, lookZ, upX, upY, 0);

  // Shift every side of the frustum so its rays pass through the fixed window.
  const left = (-WINDOW_HALF_WIDTH - eyeX) * nearScale;
  const right = (WINDOW_HALF_WIDTH - eyeX) * nearScale;
  // p5's custom WebGL frustum uses the opposite vertical ordering here.
  const bottom = (WINDOW_CENTER_Y - WINDOW_HALF_HEIGHT - eyeY) * nearScale;
  const top = (WINDOW_CENTER_Y + WINDOW_HALF_HEIGHT - eyeY) * nearScale;
  g.frustum(left, right, bottom, top, nearPlane, CAMERA_FAR);

  drawSun(g);
  drawGrid(g, eyeZ, nearPlane);

  g.ambientLight(35, 45, 80);
  g.directionalLight(90, 245, 255, -0.5, 0.7, -1);
  g.directionalLight(255, 72, 193, 0.8, -0.2, -0.5);

  drawBlocks(g);
  drawCore(g);
  drawPlanets(g);
}

function drawSun(g) {
  g.push();
  g.translate(325, -245, -760);
  g.noStroke();
  g.emissiveMaterial(255, 205, 55);
  g.sphere(44, 8, 6);
  g.pop();
}

function drawGrid(g, eyeZ, nearPlane) {
  const gridNearZ = min(700, eyeZ - nearPlane * 3);

  g.push();
  g.translate(0, 115, 0);
  g.stroke(85, 195, 255, 165);
  g.strokeWeight(1);
  g.noFill();

  for (let x = -960; x <= 960; x += 60) {
    g.line(x, 0, gridNearZ, x, 0, -1600);
  }
  for (let z = floor(gridNearZ / 60) * 60; z >= -1600; z -= 60) {
    g.line(-960, 0, z, 960, 0, z);
  }
  g.pop();
}

function drawBlocks(g) {
  for (const block of blocks) {
    const bob = sin(frameCount * 0.018 + block.spin) * 7;
    g.push();
    g.translate(block.x, 115 - block.height * 0.5 - block.lift + bob, block.z);
    g.rotateY(block.spin + frameCount * block.speed);
    g.noStroke();
    g.ambientMaterial(block.color[0], block.color[1], block.color[2]);
    g.box(block.size, block.height, block.size);
    g.pop();
  }
}

function drawCore(g) {
  const pulse = 1 + sin(frameCount * 0.035) * 0.05;

  g.push();
  g.translate(0, -28, -380);
  g.scale(1.22 * pulse);
  g.rotateX(frameCount * 0.005);
  g.rotateY(frameCount * 0.009);
  g.noFill();
  g.stroke(91, 235, 255);
  g.strokeWeight(4);
  g.box(150);
  g.rotateX(PI / 4);
  g.rotateZ(PI / 4);
  g.stroke(150, 104, 255);
  g.box(112);
  g.rotateY(frameCount * -0.014);
  g.stroke(255, 75, 203);
  g.box(72);
  g.pop();

  g.push();
  g.translate(0, -28, -380);
  g.noStroke();
  g.emissiveMaterial(24, 229, 244);
  g.sphere(24 + sin(frameCount * 0.06) * 5, 6, 4);
  g.pop();
}

function drawPlanets(g) {
  g.push();
  g.translate(-320, -60, -550);
  g.noStroke();
  g.ambientMaterial(60, 245, 198);
  g.sphere(72, 8, 6);
  g.pop();

  g.push();
  g.translate(420, 40, -820);
  g.noStroke();
  g.ambientMaterial(255, 64, 179);
  g.sphere(92, 8, 6);
  g.rotateX(PI / 2.8);
  g.noFill();
  g.stroke(255, 222, 70);
  g.strokeWeight(7);
  g.torus(128, 4, 18, 5);
  g.pop();
}

function drawWindowFrame() {
  if (statusElement) {
    statusElement.textContent = trackingMessage;
    statusElement.classList.toggle("is-locked", view.tracked);
  }
}

function windowResized() {
  // The canvas stays at 1280 x 720 and CSS stretches it to the window.
}
