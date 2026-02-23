let osn;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/simplexNoise.js");
  osn = new OpenSimplexNoise(Date.now());
  noStroke();
}

function draw() {
  background(0);
  const t = millis() * 0.0004;
  const step = 8;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const n = osn.noise3D(x * 0.01, y * 0.01, t); // -1..1
      const v = map(n, -1, 1, 0, 255);
      fill(v);
      rect(x, y, step + 1, step + 1);
    }
  }

  fill(255);
  textSize(16);
  text("OpenSimplexNoise", 18, 28);
}
