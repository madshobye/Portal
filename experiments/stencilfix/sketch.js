let photoMode = "none";
let textMode = "filled";
let inverted = false;

const photoModes = ["none", "below", "stencil", "hardblack"];
const textModes = ["filled", "outline", "filled outline"];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
}

function draw() {
  background(0);

  const label = getLabelRect();
  drawDemoLabel(label.x, label.y, label.w, label.h);
  drawControls(label);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function drawControls(label) {
  const y = label.y + label.h + 14;
  const buttonH = 42;
  const gap = 8;
  let x = label.x;

  const photoButton = uiButton(`Photo: ${photoMode}`, {
    x,
    y,
    width: 150,
    height: buttonH,
  });
  if (photoButton.clicked) {
    photoMode = nextValue(photoMode, photoModes);
  }
  x += 150 + gap;

  const textButton = uiButton(`Text: ${textMode}`, {
    x,
    y,
    width: 170,
    height: buttonH,
  });
  if (textButton.clicked) {
    textMode = nextValue(textMode, textModes);
  }
  x += 170 + gap;

  const invertButton = uiButton(inverted ? "White on black" : "Black on white", {
    x,
    y,
    width: 180,
    height: buttonH,
  });
  if (invertButton.clicked) {
    inverted = !inverted;
  }
}

function drawDemoLabel(x, y, w, h) {
  const g = createGraphics(w, h);
  const ink = inverted ? 255 : 0;
  const paper = inverted ? 0 : 255;

  g.background(paper);

  if (photoMode === "none") {
    drawTextAndQr(g, textMode, ink, paper, false);
  }

  if (photoMode === "below") {
    drawGradientPhoto(g, false);
    drawTextAndQr(g, textMode, ink, paper, true);
  }

  if (photoMode === "hardblack") {
    drawGradientPhoto(g, true);
    drawTextAndQr(g, textMode, ink, paper, true);
  }

  if (photoMode === "stencil") {
    const photoLayer = createGraphics(w, h);
    const paperLayer = createGraphics(w, h);

    drawGradientPhoto(photoLayer, false);

    paperLayer.background(paper);
    if (textMode === "filled") {
      paperLayer.blendMode(REMOVE);
      drawCutoutTextAndQr(paperLayer);
    } else if (textMode === "filled outline") {
      paperLayer.blendMode(REMOVE);
      drawCutoutOutlineAndQr(paperLayer);
    } else {
      paperLayer.blendMode(REMOVE);
      drawCutoutTextAndQr(paperLayer);
      paperLayer.blendMode(BLEND);
      drawTextOutlineOnLayer(paperLayer, ink);
    }
    paperLayer.blendMode(BLEND);

    g.image(photoLayer, 0, 0);
    g.image(paperLayer, 0, 0);
  }

  image(g, x, y);

  noFill();
  stroke(120);
  rect(x, y, w, h);
}

function drawGradientPhoto(g, hardBlack) {
  g.background(255);
  for (let x = 0; x < g.width; x += 8) {
    let v = map(x, 0, g.width, 40, 220);
    if (hardBlack) v = v < 135 ? 0 : 255;
    g.stroke(v);
    g.strokeWeight(8);
    g.line(x, 0, x, g.height);
  }
}

function drawTextAndQr(g, mode, ink, paper, photoActive = false) {
  g.textFont("Arial Black");
  g.textSize(g.height * 0.56);
  g.textStyle(BOLD);

  const x = g.width * 0.05;
  const y = g.height * 0.58;

  if (mode === "filled") {
    g.fill(ink);
    g.noStroke();
    g.text("HEST", x, y);
  }

  if (mode === "outline") {
    g.noFill();
    g.stroke(ink);
    g.strokeWeight(g.height * 0.055);
    g.text("HEST", x, y);
  }

  if (mode === "filled outline") {
    g.fill(photoActive ? ink : paper);
    g.noStroke();
    g.text("HEST", x, y);

    g.noFill();
    g.stroke(photoActive ? paper : ink);
    g.strokeWeight(g.height * 0.055);
    g.text("HEST", x, y);
  }

  drawFakeQr(g, g.width * 0.78, g.height * 0.28, g.height * 0.32, ink);
}

function drawCutoutTextAndQr(g) {
  g.textFont("Arial Black");
  g.textSize(g.height * 0.56);
  g.textStyle(BOLD);

  g.fill(255);
  g.noStroke();
  g.text("HEST", g.width * 0.05, g.height * 0.58);

  drawFakeQr(g, g.width * 0.78, g.height * 0.28, g.height * 0.32, 255);
}

function drawCutoutOutlineAndQr(g) {
  g.textFont("Arial Black");
  g.textSize(g.height * 0.56);
  g.textStyle(BOLD);

  g.noFill();
  g.stroke(255);
  g.strokeWeight(g.height * 0.055);
  g.text("HEST", g.width * 0.05, g.height * 0.58);

  drawFakeQr(g, g.width * 0.78, g.height * 0.28, g.height * 0.32, 255);
}

function drawTextOutlineOnLayer(g, ink) {
  g.textFont("Arial Black");
  g.textSize(g.height * 0.56);
  g.textStyle(BOLD);

  g.noFill();
  g.stroke(ink);
  g.strokeWeight(g.height * 0.055);
  g.text("HEST", g.width * 0.05, g.height * 0.58);
}

function drawFakeQr(g, x, y, size, colorValue) {
  const modules = [
    [1, 1, 1, 0, 1, 0, 1],
    [1, 0, 1, 1, 0, 0, 1],
    [1, 1, 1, 0, 1, 1, 0],
    [0, 1, 0, 1, 0, 1, 0],
    [1, 0, 1, 1, 1, 0, 1],
    [0, 1, 0, 0, 1, 1, 0],
    [1, 0, 1, 1, 0, 1, 1],
  ];

  const s = size / modules.length;
  g.noStroke();
  g.fill(colorValue);

  for (let yy = 0; yy < modules.length; yy++) {
    for (let xx = 0; xx < modules[yy].length; xx++) {
      if (modules[yy][xx]) {
        g.rect(x + xx * s, y + yy * s, s, s);
      }
    }
  }
}

function getLabelRect() {
  const margin = 32;
  const toolbarSpace = 76;
  const maxW = width - margin * 2;
  const maxH = height - margin * 2 - toolbarSpace;
  const aspect = 700 / 240;

  let w = maxW;
  let h = w / aspect;

  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }

  return {
    x: (width - w) / 2,
    y: margin,
    w,
    h,
  };
}

function nextValue(current, values) {
  return values[(values.indexOf(current) + 1) % values.length];
}
