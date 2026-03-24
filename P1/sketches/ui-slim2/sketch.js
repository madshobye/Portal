let clickCount = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  textSize(16);
}

function draw() {
  background(240);
  const compact = { height: 24, fontSize: 12, padding: 5, margin: 5 };

  uiListStart({ x: 24, y: 24, width: 300, dir: "vertical" });
  uiText("uiSlim2 demo", { fontSize: 20, hAlign: "center", bgColor: "#dfe8ff" });

  if (uiButton("Click me", compact).clicked) clickCount++;
  const speed = uiSlider("speed", "Speed", { min: 0, max: 100, init: 35, ...compact }).value;
  const enabled = uiToggle("enabled", "Enabled", compact).value;
  const name = uiPromptText("name", "Name").value;
  uiListEnd();

  fill(0);
  text("clicks: " + clickCount, 24, 260);
  text("speed: " + nf(speed, 1, 1), 24, 286);
  text("enabled: " + String(enabled), 24, 312);
  text("name: " + (name || "(none)"), 24, 338);
}
