let mapper;
let surface;
let latestHit = null;

const SURFACE_NAME = "debug";

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  await loadScript("portal/mapper2.js");

  mapper = new ProjectionMapper();
  surface = mapper.add(1920, 1080, SURFACE_NAME);
  mapper.loadAll();
  mapper.setCalibrate(true);
}

function draw() {
  background(12);

  drawSurfaceContent();

  latestHit = mapper.screenToSurface(mouseX, mouseY, { surface: SURFACE_NAME });

  mapper.render();
}

function drawSurfaceContent() {
  const pg = surface;
  const cell = 120;

  pg.background("#111111");
  pg.noStroke();

  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      pg.fill(on ? "#f3efe4" : "#2b6cb0");
      pg.rect(x, y, cell, cell);
    }
  }

  pg.stroke("#ff3366");
  pg.strokeWeight(8);
  pg.line(0, pg.height / 2, pg.width, pg.height / 2);
  pg.line(pg.width / 2, 0, pg.width / 2, pg.height);

  pg.noStroke();
  pg.fill("#111111");
  pg.textSize(46);
  pg.textAlign(LEFT, TOP);
  pg.text("Mapper 2 Example", 32, 24);
  pg.textSize(28);
  pg.text("Drag corners directly. No sketch mouse handlers required.", 32, 86);

  if (latestHit) {
    pg.fill("#ffd400");
    pg.circle(latestHit.x, latestHit.y, 36);
    pg.fill("#111111");
    pg.text(
      `surface x/y: ${Math.round(latestHit.x)}, ${Math.round(latestHit.y)}`,
      32,
      132
    );
    pg.text(
      `u/v: ${latestHit.u.toFixed(3)}, ${latestHit.v.toFixed(3)}`,
      32,
      172
    );
  }
}

function keyPressed() {
  if (key === "s" || key === "S") {
    mapper.saveAll();
  }
  if (key === "l" || key === "L") {
    mapper.loadAll();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
