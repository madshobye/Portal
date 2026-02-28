let mapper;
let surfacePoem;
let gpt;

let apiKeyEncryptedGpt12 =
  "U2FsdGVkX18ufo+Jv5eV1uiVVu23Jjvr8SaHfqG2rnsUq75hmr1av/B4KStyhTJtJwMgyyM6CP9gKXuUEu8F2m52Ey+wyLSiuI34pcMYOnPOVrngAAE3EMJg1Sx52sdns3JzqQHJgma6chold+TcfgeYqG/4O8wdRiKLz64Ic+v9uB+xDrzxJ2Cazu4En9yWPTKskgvccEn3ls0+zVGacW1zLaNyJXmzm+yHE0mkro+a/5lWzZFRT6UX6+HVEgqi";

let poemText = "Waiting for poem...";
let statusText = "Starting...";
let lastRequestMs = -999999;
let requestInFlight = false;
const REQUEST_INTERVAL_MS = 5000;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  ensureNoScrolling();
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    textFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    textFont(baseFont);
  }
  await loadScript("portal/mapper.js");
  await loadScript("portal/GptClient.js");

  mapper = new ProjectionMapper();
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }
  surfacePoem = mapper.add(1280*4, 720*4, "food_poem_surface");

  const apiKey = storedDecrypt({ apiKeyEncryptedGpt12 });
  gpt = new GptClient({
    apiKey,
    model: "gpt-4o-mini",
    instructions:
      "You write short, vivid poems for students. Use plain language and line breaks.",
    temperature: 0.9,
    max_tokens: 120,
  });

  await requestPoem();
}

function draw() {
  background(10);
  drawPoemSurface();

  if (mapper) mapper.render();
  drawHud();

  if (millis() - lastRequestMs >= REQUEST_INTERVAL_MS) {
    requestPoem();
  }
}

async function requestPoem() {
  if (requestInFlight || !gpt) return;
  requestInFlight = true;
  lastRequestMs = millis();
  statusText = "Requesting poem from ChatGPT...";

  try {
    const response = await gpt.ask(
      "Write a short 4-line poem about food. Keep it under 35 words."
    );

    if (response?.text) {
      poemText = response.text.trim();
      statusText = "Poem updated at " + new Date().toLocaleTimeString();
    } else if (gpt?.latestObject?.text) {
      poemText = String(gpt.latestObject.text).trim();
      statusText = "Poem updated at " + new Date().toLocaleTimeString();
    } else if (response?.error) {
      statusText = "GPT error: " + response.error;
    } else {
      statusText = "No text returned";
    }
  } catch (e) {
    statusText = "Request failed: " + (e?.message || e);
  } finally {
    requestInFlight = false;
  }
}

function drawPoemSurface() {
  if (!surfacePoem) return;

  surfacePoem.background(24, 18, 12);
  surfacePoem.fill(255, 230, 190);
  surfacePoem.noStroke();

  surfacePoem.textAlign(LEFT, TOP);
  surfacePoem.textSize(56);
  surfacePoem.text("Food Poem", 70, 60);

  surfacePoem.textSize(342);
  surfacePoem.fill(255);
  surfacePoem.text(poemText || "...", 70, 170, surfacePoem.width - 140, surfacePoem.height - 320);

  surfacePoem.fill(200, 180, 140);
  surfacePoem.textSize(24);
  surfacePoem.text(statusText, 70, surfacePoem.height - 80);
}

function drawHud() {
  push();
  translate(-width / 2, -height / 2);
  fill(255);
  noStroke();
  textSize(16);
  text("Mapper keys: c calibrate, s save, l load, r reset", 20, 24);
  text("Auto GPT refresh: every 5 seconds", 20, 46);
  pop();
}

function mousePressed() {
  mapper?.mousePressed(mouseX, mouseY);
}

function mouseDragged() {
  mapper?.mouseDragged(mouseX, mouseY);
}

function mouseReleased() {
  mapper?.mouseReleased();
}

function keyPressed() {
  mapper?.keyPressed(key);
  if (key === "f" || key === "F") {
    fullScreenToggle();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function ensureNoScrolling() {
  if (typeof noScrolling === "function") {
    noScrolling();
    return;
  }
  document.body.style.touchAction = "none";
  document.body.style.overflow = "hidden";
}
