const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const PLANE_COUNT_STORAGE_KEY = "mappedwebcam:planeCount";

let mapper;
let cam;
let planes = [];
let cameraReady = false;
let cameraInfo = { width: 0, height: 0 };

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(60);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/mapper.js");

  mapper = new ProjectionMapper();
  mapper.followDebugOverlayVisibility(true);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
  }

  const storedPlaneCount = getStoredPlaneCount();
  for (let i = 0; i < storedPlaneCount; i++) addPlane(false);
  mapper.loadAll();

  window.addEventListener("portal:webcamera-ready", handleCameraReady);
  cam = await setupWebcamera(false, 1920, 1080, false, true);
}

function draw() {
  background(0);
  updateCameraState();
  renderPlanes();
  mapper?.render();

  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderUi();
    uiEndUseGraphics();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function getStoredPlaneCount() {
  try {
    const raw = Number(localStorage.getItem(PLANE_COUNT_STORAGE_KEY));
    if (Number.isFinite(raw)) return constrain(round(raw), MIN_PLANES, MAX_PLANES);
  } catch {}
  return MIN_PLANES;
}

function setStoredPlaneCount(count) {
  try {
    localStorage.setItem(
      PLANE_COUNT_STORAGE_KEY,
      String(constrain(round(count), MIN_PLANES, MAX_PLANES))
    );
  } catch {}
}

function planeName(index) {
  return `mappedwebcam_surface_${index + 1}`;
}

function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const name = planeName(planes.length);
  const surface = mapper.add(SURFACE_W, SURFACE_H, name);
  surface.imageMode(CORNER);
  planes.push({ name, surface });
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function removePlane(persist = true) {
  if (!mapper || planes.length <= MIN_PLANES) return false;
  mapper.removeLastSurface({ clearStorage: true });
  planes.pop();
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function updateCameraState() {
  if (!cam) {
    cameraReady = false;
    return;
  }

  if (typeof syncVideoDimensions === "function") {
    syncVideoDimensions(cam);
  }

  const videoEl = cam.elt;
  cameraReady = !!(
    videoEl &&
    videoEl.readyState >= 2 &&
    (videoEl.videoWidth || cam.width) > 0 &&
    (videoEl.videoHeight || cam.height) > 0
  );
  if (cameraReady) {
    cameraInfo.width = Number(videoEl.videoWidth || cam.width || 0);
    cameraInfo.height = Number(videoEl.videoHeight || cam.height || 0);
  }
}

function handleCameraReady(event) {
  const detail = event?.detail;
  if (!detail?.video) return;
  if (cam && detail.video !== cam) return;
  cameraInfo.width = Number(detail.width || 0);
  cameraInfo.height = Number(detail.height || 0);
  cameraReady = cameraInfo.width > 0 && cameraInfo.height > 0;
}

function renderPlanes() {
  for (const plane of planes) {
    plane.surface.push();
    plane.surface.clear();

    if (cameraReady) {
      drawCameraCover(plane.surface, cam, 0, 0, plane.surface.width, plane.surface.height);
    } else {
      drawCameraPlaceholder(plane.surface);
    }

    plane.surface.pop();
  }
}

function drawCameraCover(target, source, x, y, w, h) {
  const videoEl = source?.elt || source;
  const sw = Number(videoEl?.videoWidth || source?.width || 0);
  const sh = Number(videoEl?.videoHeight || source?.height || 0);
  if (!(sw > 0 && sh > 0)) {
    drawCameraPlaceholder(target);
    return;
  }

  const scale = max(w / sw, h / sh);
  const cropW = w / scale;
  const cropH = h / scale;
  const cropX = (sw - cropW) * 0.5;
  const cropY = (sh - cropH) * 0.5;

  target.image(source, x, y, w, h, cropX, cropY, cropW, cropH);
}

function drawCameraPlaceholder(target) {
  target.background(0);
  target.noStroke();
  target.fill(255);
  target.textAlign(CENTER, CENTER);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    target.textFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    target.textFont(baseFont);
  }
  target.textSize(42);
  target.text("Waiting for camera...", target.width * 0.5, target.height * 0.5);
}

function renderUi() {
  const compact = {
    width: 220,
    height: 22,
    fontSize: 11,
    padding: 5,
    margin: 3,
    rounding: 4,
    bgColor: "#d8d8d8",
  };

  uiListStart({ x: 24, y: 24, width: 220, dir: "vertical" });
  uiText("Mapped Webcam", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });

  if (uiButton("Add Plane", compact).clicked) {
    addPlane(true);
  }
  if (uiButton("Remove Plane", compact).clicked) {
    removePlane(true);
  }
  if (uiButton("Clear Mapping", compact).clicked) {
    mapper?.resetAll();
  }

  uiListEnd();

  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`planes: ${planes.length}`, 270, 24);
  text(`camera: ${cameraReady ? "live" : "waiting"}`, 270, 46);
  text(`resolution: ${cameraInfo.width || 0} x ${cameraInfo.height || 0}`, 270, 68);
  text(
    `mapper: ${typeof uiIsDebugOverlayVisible === "function" && uiIsDebugOverlayVisible() ? "adjusting" : "locked"}`,
    270,
    90
  );
  text("same centered crop is sent to every plane", 270, 112);
}
