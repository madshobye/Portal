// Show a QR containing qr2. Portal manages the camera view and 3D layer.
let anchor;
let message = 'Starting camera…';

async function setup() {
  createCanvas(windowWidth, windowHeight);
  try {
    await loadScript('portal/QrAnchor.js');
    const video = await setupWebcamera(false, 1280, 720, false);
    anchor = await QrAnchor.create({ video, target: 'qr2' });
  } catch (error) {
    message = error.message || String(error);
  }
}

function draw() {
  if (anchor) {
    anchor.render(drawScene);
  } else {
    background(20);
    fill(255);
    textSize(18);
    text(message, 20, 30, width - 40, height - 40);
  }
}

// One unit equals the QR's width. Positive Z comes out of the QR.
function drawScene(g) {
  g.noStroke();
  g.ambientLight(100);
  g.directionalLight(255, 255, 255, 0, 0, -1);

  g.push();
  g.translate(0, 0, 0.5);
  g.rotateZ(millis() * 0.001);
  g.fill('hotpink');
  g.box(0.6);
  g.pop();

  g.push();
  g.translate(0.8, 0, 0.3);
  g.fill('skyblue');
  g.sphere(0.3);
  g.pop();
}
