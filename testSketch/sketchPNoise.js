async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/pNoise.js");
  pSetNoiseSeed("portal-noise");
  pSetNoiseRange(0, 255);
  noStroke();
}

function draw() {
  background(0);
  const t = millis() * 0.0003;
  const step = 8;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const v = pNoise3D(x * 0.01, y * 0.01, t);
      fill(v);
      rect(x, y, step + 1, step + 1);
    }
  }

  fill(255);
  textSize(16);
  text("pNoise", 18, 28);
}
