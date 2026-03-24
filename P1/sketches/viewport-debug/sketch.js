function setup() {
  createCanvas(windowWidth, windowHeight);
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
  return [
    `canvas width/height: ${width} x ${height}`,
    `windowWidth/windowHeight: ${windowWidth} x ${windowHeight}`,
    `innerWidth/innerHeight: ${window.innerWidth} x ${window.innerHeight}`,
    `documentElement: ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}`,
    `body: ${document.body.clientWidth} x ${document.body.clientHeight}`,
    `visualViewport: ${window.visualViewport?.width || "-"} x ${window.visualViewport?.height || "-"}`,
    `screen: ${window.screen.width} x ${window.screen.height}`,
    `fullscreen element: ${!!document.fullscreenElement}`,
    `devicePixelRatio: ${window.devicePixelRatio}`,
  ];
}

function logViewport(label) {
  console.log(`[viewport-debug] ${label}`, {
    width,
    height,
    windowWidth,
    windowHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentElementClientWidth: document.documentElement.clientWidth,
    documentElementClientHeight: document.documentElement.clientHeight,
    bodyClientWidth: document.body.clientWidth,
    bodyClientHeight: document.body.clientHeight,
    visualViewportWidth: window.visualViewport?.width,
    visualViewportHeight: window.visualViewport?.height,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    fullscreenElement: !!document.fullscreenElement,
    devicePixelRatio: window.devicePixelRatio,
  });
}
