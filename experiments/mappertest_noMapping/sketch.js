const SURFACE_W = 1280;
const SURFACE_H = 720;
const SURFACE_NAME = "mapper_test_surface_1";

let mapper;
let surface1;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  imageMode(CENTER);
  noStroke();

  await loadScript("portal/noMappingMapper.js");
  await loadScript("portal/uiSlim2.js");

  mapper = new ProjectionMapper();
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }

  surface1 = mapper.add(SURFACE_W, SURFACE_H, SURFACE_NAME);
  surface1.imageMode(CENTER);
  mapper.loadAll();
}

function draw() {
  background(0);
  drawSurfaceContent(surface1);
  mapper?.render();
  renderUi();
}

function drawSurfaceContent(pg) {
  if (!pg) return;

  pg.background(245);
  pg.noStroke();

  const cell = 80;
  for (let y = 0; y < pg.height; y += cell) {
    for (let x = 0; x < pg.width; x += cell) {
      const on = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0;
      pg.fill(on ? "#f2f2f2" : "#111111");
      pg.rect(x, y, cell, cell);
    }
  }

  pg.fill("#ff4d00");
  pg.rect(0, pg.height * 0.45, pg.width, pg.height * 0.1);

  pg.fill("#0057ff");
  pg.rect(pg.width * 0.45, 0, pg.width * 0.1, pg.height);

  const t = millis() * 0.001;
  const cx = pg.width * 0.5 + cos(t) * pg.width * 0.25;
  const cy = pg.height * 0.5 + sin(t * 1.3) * pg.height * 0.22;

  pg.fill("#00d084");
  pg.circle(cx, cy, 120);

  pg.fill(0);
  pg.circle(pg.width * 0.5, pg.height * 0.5, 24);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function renderUi() {
  if (typeof uiListStart !== "function") return;

  uiListStart({ x: 20, y: 20, width: 180, dir: "vertical" });
  uiText("Mapper Test", {
    bgColor: "#e8e8e8",
    hAlign: "center",
  });

  if (uiButton("Toggle Calibrate").clicked) {
    mapper?.toggleCalibrate();
  }
  if (uiButton("Save Mapping").clicked) {
    mapper?.saveAll();
  }
  if (uiButton("Load Mapping").clicked) {
    mapper?.loadAll();
  }
  if (uiButton("Reset Mapping").clicked) {
    mapper?.resetAll();
  }
  uiText(`calibrate: ${mapper?.isCalibrating() ? "on" : "off"}`, {
    bgColor: "#f2f2f2",
  });
  uiText(SURFACE_NAME, {
    bgColor: "#f2f2f2",
    hAlign: "center",
  });
  uiListEnd();
}
