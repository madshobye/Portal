const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const PLANE_COUNT_STORAGE_KEY = "multitouchlight:planeCount";
const DEFAULT_SIZE_STORAGE_KEY = "multitouchlight.defaultSize";
const DEFAULT_RADIUS = 140;
const MIN_RADIUS = 30;
const MAX_RADIUS = 900;

let mapper;
let multiTouch;
let planes = [];
let touchStates = new Map();
let resizeGestures = new Map();
let circleIdCounter = 1;
let defaultSpotRadius = DEFAULT_RADIUS;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(60);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/multiTouch.js");
  await loadScript("portal/mapper.js");

  multiTouch = await new MultiTouch({ preventDefault: true }).init();
  await multiTouch.start();
  uiUseMultiTouch(multiTouch);

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

  defaultSpotRadius = Number(uiGetState(DEFAULT_SIZE_STORAGE_KEY, defaultSpotRadius));
  defaultSpotRadius = constrain(defaultSpotRadius, MIN_RADIUS, MAX_RADIUS);
}

function draw() {
  background(0);
  updateTouchModel();
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
  return `multitouchlight_surface_${index + 1}`;
}

function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const name = planeName(planes.length);
  const surface = mapper.add(SURFACE_W, SURFACE_H, name);
  surface.imageMode(CORNER);
  planes.push({ name, surface, circles: [] });
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function removePlane(persist = true) {
  if (!mapper || planes.length <= MIN_PLANES) return false;
  mapper.removeLastSurface({ clearStorage: true });
  const removedIndex = planes.length - 1;
  planes.pop();
  dropTouchStatesForPlane(removedIndex);
  if (persist) setStoredPlaneCount(planes.length);
  return true;
}

function dropTouchStatesForPlane(planeIndex) {
  for (const [touchId, state] of touchStates.entries()) {
    if (state.planeIndex === planeIndex) touchStates.delete(touchId);
  }
  for (const key of resizeGestures.keys()) {
    if (String(key).startsWith(`${planeIndex}:`)) resizeGestures.delete(key);
  }
}

function updateTouchModel() {
  if (!mapper || mapper.isActive()) return;
  if (typeof uiIsDebugOverlayVisible === "function" && uiIsDebugOverlayVisible()) return;

  const pointers = getInputPointers();
  const activeIds = new Set(pointers.map((pointer) => pointer.id));

  for (const touchId of Array.from(touchStates.keys())) {
    if (!activeIds.has(touchId)) finalizeTouchState(touchId);
  }

  for (const pointer of pointers) {
    let state = touchStates.get(pointer.id);
    if (!state) {
      state = beginTouchState(pointer);
      if (state) touchStates.set(pointer.id, state);
    }
    if (!state) continue;

    updateTouchState(state, pointer);
  }

  applyTouchStatesToCircles();
}

function getInputPointers() {
  const touches = multiTouch?.getTouches() || [];
  const pointers = touches.map((touch) => ({
    id: `t${touch.id}`,
    x: touch.x,
    y: touch.y,
  }));

  if (!pointers.length && mouseIsPressed) {
    const pointer = getMouseScreenPointer();
    pointers.push({ id: "mouse", x: pointer.x, y: pointer.y });
  }

  return pointers;
}

function getMouseScreenPointer() {
  const hasUiPointer =
    typeof uiMX !== "undefined" &&
    typeof uiMY !== "undefined" &&
    Number.isFinite(uiMX) &&
    Number.isFinite(uiMY);

  if (hasUiPointer) {
    return { x: uiMX, y: uiMY };
  }

  return {
    x: Number(mouseX) + width * 0.5,
    y: Number(mouseY) + height * 0.5,
  };
}

function beginTouchState(pointer) {
  const hit = mapper.screenToSurface(pointer.x, pointer.y);
  if (!hit) return null;

  const plane = planes[hit.surfaceIndex];
  if (!plane) return null;

  let circle = findCircleAtPoint(plane, hit.x, hit.y);
  if (!circle) {
    circle = {
      id: circleIdCounter++,
      x: hit.x,
      y: hit.y,
      radius: defaultSpotRadius,
    };
    plane.circles.push(circle);
  }

  return {
    planeIndex: hit.surfaceIndex,
    circleId: circle.id,
    localX: hit.x,
    localY: hit.y,
    isOffPlane: false,
  };
}

function updateTouchState(state, pointer) {
  const hit = mapper.screenToSurface(pointer.x, pointer.y, { padding: 0.15 });
  if (!hit) {
    state.isOffPlane = true;
    return;
  }

  state.isOffPlane = false;
  state.localX = hit.x;
  state.localY = hit.y;

  if (state.planeIndex !== hit.surfaceIndex) {
    moveCircleToPlane(state.circleId, state.planeIndex, hit.surfaceIndex);
    state.planeIndex = hit.surfaceIndex;
  }
}

function findCircleAtPoint(plane, x, y) {
  for (let i = plane.circles.length - 1; i >= 0; i--) {
    const circle = plane.circles[i];
    if (dist(x, y, circle.x, circle.y) <= circle.radius) return circle;
  }
  return null;
}

function applyTouchStatesToCircles() {
  const activeGroups = new Map();

  for (const [touchId, state] of touchStates.entries()) {
    if (state.isOffPlane) continue;
    const key = `${state.planeIndex}:${state.circleId}`;
    const group = activeGroups.get(key) || [];
    group.push({ touchId, ...state });
    activeGroups.set(key, group);
  }

  for (const [key, group] of activeGroups.entries()) {
    const [planeIndexText, circleIdText] = key.split(":");
    const planeIndex = Number(planeIndexText);
    const circleId = Number(circleIdText);
    const plane = planes[planeIndex];
    const circle = plane?.circles?.find((entry) => entry.id === circleId);
    if (!circle) continue;

    if (group.length >= 2) {
      const pair = group.slice(0, 2);
      const distanceNow = max(
        1,
        dist(pair[0].localX, pair[0].localY, pair[1].localX, pair[1].localY)
      );
      const touchPairKey = pair
        .map((entry) => entry.touchId)
        .sort()
        .join("|");

      let gesture = resizeGestures.get(key);
      if (!gesture || gesture.touchPairKey !== touchPairKey) {
        gesture = {
          touchPairKey,
          baseDistance: distanceNow,
          baseRadius: circle.radius,
        };
        resizeGestures.set(key, gesture);
      }

      circle.radius = constrain(
        gesture.baseRadius * (distanceNow / max(1, gesture.baseDistance)),
        MIN_RADIUS,
        MAX_RADIUS
      );
      circle.x = (pair[0].localX + pair[1].localX) * 0.5;
      circle.y = (pair[0].localY + pair[1].localY) * 0.5;
      continue;
    }

    resizeGestures.delete(key);
    circle.x = group[0].localX;
    circle.y = group[0].localY;
  }

  for (const key of Array.from(resizeGestures.keys())) {
    if (!activeGroups.has(key)) resizeGestures.delete(key);
  }
}

function renderPlanes() {
  for (const plane of planes) {
    plane.surface.push();
    plane.surface.clear();
    plane.surface.noStroke();
    plane.surface.blendMode(ADD);

    for (const circle of plane.circles) {
      drawLightCircle(plane.surface, circle);
    }

    plane.surface.blendMode(BLEND);
    plane.surface.pop();
  }
}

function drawLightCircle(target, circle) {
  target.fill(255);
  target.circle(circle.x, circle.y, circle.radius * 2);
}

function finalizeTouchState(touchId) {
  const state = touchStates.get(touchId);
  if (!state) return;

  touchStates.delete(touchId);

  if (state.isOffPlane && !hasOtherTouchForCircle(state.circleId, touchId)) {
    removeCircleById(state.circleId);
  }
}

function hasOtherTouchForCircle(circleId, ignoredTouchId = null) {
  for (const [touchId, state] of touchStates.entries()) {
    if (touchId === ignoredTouchId) continue;
    if (state.circleId === circleId) return true;
  }
  return false;
}

function moveCircleToPlane(circleId, fromPlaneIndex, toPlaneIndex) {
  if (fromPlaneIndex === toPlaneIndex) return;
  const fromPlane = planes[fromPlaneIndex];
  const toPlane = planes[toPlaneIndex];
  if (!fromPlane || !toPlane) return;

  const circleIndex = fromPlane.circles.findIndex((entry) => entry.id === circleId);
  if (circleIndex < 0) return;

  const [circle] = fromPlane.circles.splice(circleIndex, 1);
  toPlane.circles.push(circle);

  for (const state of touchStates.values()) {
    if (state.circleId === circleId) {
      state.planeIndex = toPlaneIndex;
    }
  }
}

function removeCircleById(circleId) {
  for (const plane of planes) {
    const index = plane.circles.findIndex((entry) => entry.id === circleId);
    if (index >= 0) {
      plane.circles.splice(index, 1);
      break;
    }
  }

  for (const [touchId, state] of touchStates.entries()) {
    if (state.circleId === circleId) touchStates.delete(touchId);
  }

  for (const key of Array.from(resizeGestures.keys())) {
    if (String(key).endsWith(`:${circleId}`)) resizeGestures.delete(key);
  }
}

function clearAllCircles() {
  for (const plane of planes) {
    plane.circles.length = 0;
  }
  touchStates.clear();
  resizeGestures.clear();
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
  uiText("Multitouch Light", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });

  if (uiButton("Clear Lights", compact).clicked) {
    clearAllCircles();
  }
  defaultSpotRadius = Number(
    uiSlider(DEFAULT_SIZE_STORAGE_KEY, "Default Size", {
      min: MIN_RADIUS,
      max: 400,
      init: defaultSpotRadius,
      ...compact,
    }).value
  );
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

  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    textFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    textFont(baseFont);
  }
  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`planes: ${planes.length}`, 270, 24);
  text(`touches: ${multiTouch?.getTouchCount?.() || 0}`, 270, 46);
  text(`lights: ${planes.reduce((sum, plane) => sum + plane.circles.length, 0)}`, 270, 68);
  text(`default size: ${nf(defaultSpotRadius, 1, 0)}`, 270, 90);
  text(
    `mapper: ${typeof uiIsDebugOverlayVisible === "function" && uiIsDebugOverlayVisible() ? "adjusting" : "locked"}`,
    270,
    112
  );
  text("tap empty space to create a light", 270, 134);
  text("drag one finger to move", 270, 156);
  text("two fingers inside one light to resize", 270, 178);
}
