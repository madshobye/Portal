let ink;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/ink.js");
  await loadScript("portal/multiTouch.js");

  ink = await new InkDrawing({
    mode: "flowy",
    background: 0,
    foreground: 255,
  }).init();

  window.multiTouch = await new MultiTouch({ preventDefault: true }).init();
  await window.multiTouch.start();
}

function draw() {
  background(0);

  const pointers = (window.multiTouch?.getTouches() || []).map((t) => ({
    id: `t${t.id}`,
    x: t.x,
    y: t.y,
  }));

  if (!pointers.length && mouseIsPressed) {
    pointers.push({ id: "mouse", x: mouseX, y: mouseY });
  }

  ink.updatePointers(pointers);
  ink.draw();

  fill(255);
  textSize(16);
  text(`mode: ${ink.mode}`, 18, 28);
  text("keys: 1 flowy, 2 inky, 3 marker, 4 wash, c clear", 18, 50);
}

function keyPressed() {
  if (key === "1") ink.setMode("flowy");
  if (key === "2") ink.setMode("inky");
  if (key === "3") ink.setMode("marker");
  if (key === "4") ink.setMode("wash");
  if (key === "c" || key === "C") ink.clear();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  ink?.resize(windowWidth, windowHeight, true);
}
