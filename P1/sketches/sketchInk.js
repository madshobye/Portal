let ink;
const INK_RECIPES = ["calligraphy", "fine_liner", "splatter_marker", "spray_paint"];

async function setup() {
  createCanvas(windowWidth, windowHeight);
  await loadScript("portal/ink.js");
  await loadScript("portal/multiTouch.js");

  ink = await new InkDrawing({
    recipe: INK_RECIPES[0],
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
  text(`recipe: ${ink.getRecipe()?.label || ""}`, 18, 28);
  text("keys: 1 calligraphy, 2 fine liner, 3 splatter, 4 spray, c clear", 18, 50);
}

function keyPressed() {
  if (key === "1") ink.setRecipe(INK_RECIPES[0]);
  if (key === "2") ink.setRecipe(INK_RECIPES[1]);
  if (key === "3") ink.setRecipe(INK_RECIPES[2]);
  if (key === "4") ink.setRecipe(INK_RECIPES[3]);
  if (key === "c" || key === "C") ink.clear();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  ink?.resize(windowWidth, windowHeight, true);
}
