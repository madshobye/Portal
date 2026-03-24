let canvasRef;

function setup() {
  canvasRef = createCanvas(windowWidth, windowHeight);
  textSize(18);
  logViewport("setup");
}

function draw() {
  background(235);
  fill(20);
  noStroke();

  const lines = collectViewportLines();
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], 20, 36 + i * 26);
  }

  drawDebugBadge();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  logViewport("windowResized");
  setTimeout(() => logViewport("windowResized + 80ms"), 80);
  setTimeout(() => logViewport("windowResized + 300ms"), 300);
}

function keyPressed() {
  if (key === "f" || key === "F") {
    const result = fullscreen(!fullscreen());
    logViewport("toggle fullscreen");
    if (result?.then) {
      result.then(() => logViewport("fullscreen promise resolved"));
    }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("fullscreenchange", () => {
    logViewport("document fullscreenchange");
  });
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    logViewport("visualViewport resize");
  });
}

function collectViewportLines() {
  const parent = canvasRef?.elt?.parentElement || null;
  const parentRect = parent?.getBoundingClientRect?.();
  const canvasRect = canvasRef?.elt?.getBoundingClientRect?.();

  return [
    `canvas width/height: ${width} x ${height}`,
    `canvas client rect: ${roundValue(canvasRect?.width)} x ${roundValue(canvasRect?.height)}`,
    `windowWidth/windowHeight: ${windowWidth} x ${windowHeight}`,
    `innerWidth/innerHeight: ${window.innerWidth} x ${window.innerHeight}`,
    `documentElement: ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}`,
    `body: ${document.body.clientWidth} x ${document.body.clientHeight}`,
    `visualViewport: ${window.visualViewport?.width || "-"} x ${window.visualViewport?.height || "-"}`,
    `canvas parent: ${parent?.tagName || "-"} ${roundValue(parentRect?.width)} x ${roundValue(parentRect?.height)}`,
    `PORTAL_CANVAS_RESIZE_MODE: ${window.PORTAL_CANVAS_RESIZE_MODE || "auto"}`,
    `screen: ${window.screen.width} x ${window.screen.height}`,
    `fullscreen element: ${!!document.fullscreenElement}`,
    `devicePixelRatio: ${window.devicePixelRatio}`,
  ];
}

function logViewport(label) {
  const canvasRect = canvasRef?.elt?.getBoundingClientRect?.();
  const parent = canvasRef?.elt?.parentElement || null;
  const parentRect = parent?.getBoundingClientRect?.();

  console.log(`[viewport-debug] ${label}`, {
    width,
    height,
    windowWidth,
    windowHeight,
    canvasClientWidth: canvasRect?.width,
    canvasClientHeight: canvasRect?.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentElementClientWidth: document.documentElement.clientWidth,
    documentElementClientHeight: document.documentElement.clientHeight,
    bodyClientWidth: document.body.clientWidth,
    bodyClientHeight: document.body.clientHeight,
    visualViewportWidth: window.visualViewport?.width,
    visualViewportHeight: window.visualViewport?.height,
    parentTagName: parent?.tagName,
    parentClientWidth: parentRect?.width,
    parentClientHeight: parentRect?.height,
    portalCanvasResizeMode: window.PORTAL_CANVAS_RESIZE_MODE || "auto",
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    fullscreenElement: !!document.fullscreenElement,
    devicePixelRatio: window.devicePixelRatio,
  });
}

function drawDebugBadge() {
  const mismatch = Math.abs(height - windowHeight) > 2;
  const label = mismatch ? "HEIGHT MISMATCH" : "HEIGHT OK";

  push();
  noStroke();
  fill(mismatch ? "#b00020" : "#18794e");
  rect(20, height - 60, 220, 34, 8);
  fill(255);
  text(label, 34, height - 38);
  pop();
}

function roundValue(value) {
  return Number.isFinite(value) ? Math.round(value) : "-";
}
