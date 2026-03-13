const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const PLANE_COUNT_STORAGE_KEY = "drawSimple:planeCount";
const BRUSH_SIZE_KEY = "drawSimple.brushSize";
const BRUSH_OPACITY_KEY = "drawSimple.brushOpacity";
const FIREFLY_MODE_KEY = "drawSimple.fireflyMode";
const FIREFLY_COUNT_KEY = "drawSimple.fireflyCount";
const DEBUG_STEPS_KEY = "drawSimple.debugSteps";

let mapper;
let multiTouch;
let planes = [];
let brushSize = 80;
let brushOpacity = 0.35;
let fireflyMode = false;
let fireflyCount = 4;
let fireflyState = [];
let pointerTrail = new Map();
let debugSteps = false;
const POINTER_HISTORY_LIMIT = 28;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(60);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/multiTouch.js");
  await loadScript("portal/mapper.js");
  await loadScript("portal/simplexNoise.js");

  if (typeof simplexNoise === "undefined" && typeof OpenSimplexNoise !== "undefined") {
    window.simplexNoise = new OpenSimplexNoise(Date.now());
  }

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

  brushSize = Number(uiGetState(BRUSH_SIZE_KEY, brushSize));
  brushSize = constrain(brushSize, 8, 320);
  brushOpacity = Number(uiGetState(BRUSH_OPACITY_KEY, brushOpacity));
  brushOpacity = constrain(brushOpacity, 0.02, 1);
  fireflyMode = !!uiGetState(FIREFLY_MODE_KEY, fireflyMode);
  fireflyCount = Number(uiGetState(FIREFLY_COUNT_KEY, fireflyCount));
  fireflyCount = constrain(round(fireflyCount), 1, 24);
  debugSteps = !!uiGetState(DEBUG_STEPS_KEY, debugSteps);
  ensureFireflies();
}

function draw() {
  background(0);
  updateDrawing();
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

function updateDrawing() {
  if (!mapper || mapper.isActive()) return;
  if (fireflyMode) updateFireflies();

  const pointers = getInputPointers();
  const activePointerIds = new Set();
  for (const pointer of pointers) {
    const hit = mapper.screenToSurface(pointer.x, pointer.y);
    if (!hit) continue;
    const plane = planes[hit.surfaceIndex];
    if (!plane) continue;
    activePointerIds.add(pointer.id);

    const trail = pointerTrail.get(pointer.id);
    if (!trail || trail.planeIndex !== hit.surfaceIndex || !Array.isArray(trail.points)) {
      if (!debugSteps) {
        stampCircle(plane.surface, hit.x, hit.y);
      }
      pointerTrail.set(pointer.id, {
        planeIndex: hit.surfaceIndex,
        points: [{ x: hit.x, y: hit.y }],
      });
      continue;
    }

    const points = appendTrailPoint(trail.points, { x: hit.x, y: hit.y });
    drawTrailStroke(plane.surface, points);
    pointerTrail.set(pointer.id, {
      planeIndex: hit.surfaceIndex,
      points,
    });
  }

  for (const id of Array.from(pointerTrail.keys())) {
    if (!activePointerIds.has(id)) pointerTrail.delete(id);
  }
}

function getInputPointers() {
  const touches = multiTouch?.getTouches?.() || [];
  const pointers = touches.map((touch) => ({
    id: `t${touch.id}`,
    x: touch.x,
    y: touch.y,
  }));

  if (!pointers.length && mouseIsPressed) {
    pointers.push(getMousePointer());
  }

  return pointers;
}

function getMousePointer() {
  const hasUiPointer =
    typeof uiMX !== "undefined" &&
    typeof uiMY !== "undefined" &&
    Number.isFinite(uiMX) &&
    Number.isFinite(uiMY);

  if (hasUiPointer) {
    return { id: "mouse", x: uiMX, y: uiMY };
  }

  return {
    id: "mouse",
    x: Number(mouseX) + width * 0.5,
    y: Number(mouseY) + height * 0.5,
  };
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
  return `drawSimple_surface_${index + 1}`;
}

function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const name = planeName(planes.length);
  const surface = mapper.add(SURFACE_W, SURFACE_H, name);
  surface.imageMode(CORNER);
  surface.clear();
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

function clearAll() {
  for (const plane of planes) {
    plane.surface.clear();
  }
}

function stampCircle(surface, x, y, size = brushSize, opacity = brushOpacity) {
  const alpha = constrain(opacity, 0, 1) * 255;
  const radius = size * 0.5;
  const blurOffsets = [
    { dx: -radius * 0.06, dy: 0, scale: 0.92, alpha: 0.16 },
    { dx: radius * 0.06, dy: 0, scale: 0.92, alpha: 0.16 },
    { dx: 0, dy: -radius * 0.06, scale: 0.92, alpha: 0.16 },
    { dx: 0, dy: radius * 0.06, scale: 0.92, alpha: 0.16 },
  ];

  surface.noStroke();
  for (const pass of blurOffsets) {
    surface.fill(255, alpha * pass.alpha);
    drawBlobShape(surface, x + pass.dx, y + pass.dy, radius * pass.scale, 40);
  }

  surface.fill(255, alpha);
  drawBlobShape(surface, x, y, radius, 40);
}

function drawStretchedStroke(surface, x0, y0, x1, y1, size = brushSize, opacity = brushOpacity) {
  const alpha = constrain(opacity, 0, 1) * 255;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = dist(x0, y0, x1, y1);
  if (length < 0.5) {
    stampCircle(surface, x1, y1, size, opacity);
    return;
  }

  const radius = size * 0.5;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const stretch = min(length * 0.5, size * 1.8);
  const cx = (x0 + x1) * 0.5;
  const cy = (y0 + y1) * 0.5;
  const blurOffsets = [
    { dx: nx * radius * 0.08, dy: ny * radius * 0.08, alpha: 0.14, scale: 0.92 },
    { dx: -nx * radius * 0.08, dy: -ny * radius * 0.08, alpha: 0.14, scale: 0.92 },
    { dx: ux * radius * 0.06, dy: uy * radius * 0.06, alpha: 0.14, scale: 0.92 },
    { dx: -ux * radius * 0.06, dy: -uy * radius * 0.06, alpha: 0.14, scale: 0.92 },
  ];

  surface.noStroke();
  for (const pass of blurOffsets) {
    surface.fill(255, alpha * pass.alpha);
    drawStretchedBlobShape(
      surface,
      cx + pass.dx,
      cy + pass.dy,
      radius * pass.scale,
      stretch * pass.scale,
      ux,
      uy,
      nx,
      ny,
      40
    );
  }

  surface.fill(255, alpha);
  drawStretchedBlobShape(surface, cx, cy, radius, stretch, ux, uy, nx, ny, 40);
}

function drawTrailStroke(surface, points, size = brushSize, opacity = brushOpacity) {
  if (!Array.isArray(points) || points.length < 2) return;
  if (debugSteps) {
    drawDebugStepTrail(surface, points, size, opacity);
    return;
  }
  const recentPoints = points.slice(-10);
  if (recentPoints.length < 2) return;
  const radius = size * 0.5;
  drawRibbonShape(surface, recentPoints, radius, 0, opacity, true, false);
}

function drawDebugStepTrail(surface, points, size = brushSize, opacity = brushOpacity) {
  if (!Array.isArray(points) || points.length < 10) return;
  const blockSize = 10;
  const blockIndex = Math.floor((points.length - 1) / blockSize);
  if (blockIndex % 2 === 1) return;
  const latestBlockStart = blockIndex * blockSize;
  const latestBlock = points.slice(latestBlockStart, latestBlockStart + blockSize);
  if (latestBlock.length < blockSize) return;
  drawTangentRibbonShape(surface, latestBlock, size * 0.5, opacity);
}

function appendTrailPoint(points, point) {
  const list = Array.isArray(points) ? points.slice() : [];
  const prev = list[list.length - 1];
  if (!prev) {
    list.push(point);
    return list;
  }

  const d = dist(prev.x, prev.y, point.x, point.y);
  const spacing = max(1.5, brushSize * 0.1);
  if (d < spacing * 0.35) {
    list[list.length - 1] = point;
  } else {
    const steps = max(1, floor(d / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      list.push({
        x: lerp(prev.x, point.x, t),
        y: lerp(prev.y, point.y, t),
      });
    }
  }

  if (list.length > POINTER_HISTORY_LIMIT) {
    return list.slice(-POINTER_HISTORY_LIMIT);
  }
  return list;
}

function drawBlobShape(surface, cx, cy, radius, points = 40) {
  surface.beginShape();
  for (let i = 0; i < points; i++) {
    const angle = (TWO_PI * i) / points;
    const px = cx + cos(angle) * radius;
    const py = cy + sin(angle) * radius;
    surface.vertex(px, py);
  }
  surface.endShape(CLOSE);
}

function drawStretchedBlobShape(surface, cx, cy, radius, stretch, ux, uy, nx, ny, points = 40) {
  surface.beginShape();
  for (let i = 0; i < points; i++) {
    const angle = (TWO_PI * i) / points;
    const along = cos(angle) * (radius + stretch);
    const across = sin(angle) * radius;
    const px = cx + ux * along + nx * across;
    const py = cy + uy * along + ny * across;
    surface.vertex(px, py);
  }
  surface.endShape(CLOSE);
}

function drawRibbonShape(surface, points, radius, normalOffset = 0, opacity = brushOpacity, useBlur = true, smooth = true) {
  if (!Array.isArray(points) || points.length < 2) return;
  const smoothPoints = smooth ? smoothTrailPoints(points, 2) : points;
  if (smoothPoints.length < 2) return;

  if (useBlur) {
    const alpha = constrain(opacity, 0, 1) * 255;
    const blurPasses = [
      { scale: 0.94, alpha: 0.16, offset: radius * 0.05 },
      { scale: 0.94, alpha: 0.16, offset: -radius * 0.05 },
      { scale: 0.88, alpha: 0.1, offset: radius * 0.1 },
      { scale: 0.88, alpha: 0.1, offset: -radius * 0.1 },
    ];

    surface.noStroke();
    for (const pass of blurPasses) {
      surface.fill(255, alpha * pass.alpha);
      drawRibbonShape(surface, smoothPoints, radius * pass.scale, pass.offset, opacity, false, false);
    }
    surface.fill(255, alpha);
  } else {
    surface.noStroke();
    surface.fill(255, constrain(opacity, 0, 1) * 255);
  }
  drawTangentRibbonShape(surface, smoothPoints, radius + normalOffset, opacity, false);
}

function smoothTrailPoints(points, iterations = 1) {
  let current = points.map((p) => ({ x: p.x, y: p.y }));
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 2) break;
    const next = [{ x: current[0].x, y: current[0].y }];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push({
        x: lerp(a.x, b.x, 0.25),
        y: lerp(a.y, b.y, 0.25),
      });
      next.push({
        x: lerp(a.x, b.x, 0.75),
        y: lerp(a.y, b.y, 0.75),
      });
    }
    next.push({
      x: current[current.length - 1].x,
      y: current[current.length - 1].y,
    });
    current = next;
  }
  return current;
}

function buildCapPoints(leftPoint, rightPoint, center, radius, reverse = false) {
  const pts = [];
  const startAngle = atan2(leftPoint.y - center.y, leftPoint.x - center.x);
  const endAngle = atan2(rightPoint.y - center.y, rightPoint.x - center.x);
  const steps = 10;
  let delta = endAngle - startAngle;

  if (reverse) {
    if (delta > 0) delta -= TWO_PI;
  } else {
    if (delta < 0) delta += TWO_PI;
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + delta * t;
    pts.push({
      x: center.x + cos(angle) * radius,
      y: center.y + sin(angle) * radius,
    });
  }
  return pts;
}

function drawTangentRibbonShape(surface, points, radius, opacity = brushOpacity, setFill = true) {
  if (!Array.isArray(points) || points.length < 2) return;
  const halfW = Math.max(1, radius);
  const left = [];
  const right = [];
  const tangents = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];

    const inDir = normalizePoint(curr.x - prev.x, curr.y - prev.y);
    const outDir = normalizePoint(next.x - curr.x, next.y - curr.y);
    let tx = inDir.x + outDir.x;
    let ty = inDir.y + outDir.y;

    if (Math.hypot(tx, ty) < 1e-5) {
      tx = outDir.x || inDir.x || 1;
      ty = outDir.y || inDir.y || 0;
    }

    const tangent = normalizePoint(tx, ty);
    tangents.push(tangent);
    const normal = { x: -tangent.y, y: tangent.x };
    const refNormal = { x: -outDir.y, y: outDir.x };
    const align = Math.abs(normal.x * refNormal.x + normal.y * refNormal.y);
    const miterScale = 1 / Math.max(0.35, align || 1);
    const offset = Math.min(halfW * 1.8, halfW * miterScale);

    left.push({
      x: curr.x + normal.x * offset,
      y: curr.y + normal.y * offset,
    });
    right.push({
      x: curr.x - normal.x * offset,
      y: curr.y - normal.y * offset,
    });
  }

  const startCap = buildRoundCap(
    points[0],
    tangents[0],
    halfW,
    true
  );
  const endCap = buildRoundCap(
    points[points.length - 1],
    tangents[tangents.length - 1],
    halfW,
    false
  );

  surface.noStroke();
  if (setFill) surface.fill(255, constrain(opacity, 0, 1) * 255);
  surface.beginShape();
  for (const p of startCap) surface.vertex(p.x, p.y);
  for (let i = 1; i < left.length; i++) surface.vertex(left[i].x, left[i].y);
  for (const p of endCap) surface.vertex(p.x, p.y);
  for (let i = right.length - 2; i >= 1; i--) {
    surface.vertex(right[i].x, right[i].y);
  }
  surface.endShape(CLOSE);
}

function normalizePoint(x, y) {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

function buildRoundCap(center, tangent, radius, isStart) {
  const t = normalizePoint(tangent.x, tangent.y);
  const normal = { x: -t.y, y: t.x };
  const leftAngle = atan2(normal.y, normal.x);
  const rightAngle = atan2(-normal.y, -normal.x);
  const pts = [];
  const steps = 12;
  const centerAngle = atan2(t.y, t.x) + (isStart ? PI : 0);
  const angleA = isStart ? rightAngle : leftAngle;
  const angleB = isStart ? leftAngle : rightAngle;
  let deltaA = angleA - centerAngle;
  let deltaB = angleB - centerAngle;

  while (deltaA <= -PI) deltaA += TWO_PI;
  while (deltaA > PI) deltaA -= TWO_PI;
  while (deltaB <= -PI) deltaB += TWO_PI;
  while (deltaB > PI) deltaB -= TWO_PI;

  if (isStart) {
    if (deltaA < 0) deltaA += TWO_PI;
    if (deltaB > 0) deltaB -= TWO_PI;
  } else {
    if (deltaA > 0) deltaA -= TWO_PI;
    if (deltaB < 0) deltaB += TWO_PI;
  }

  for (let i = 0; i <= steps; i++) {
    const delta = lerp(deltaA, deltaB, i / steps);
    const a = centerAngle + delta;
    pts.push({
      x: center.x + cos(a) * radius,
      y: center.y + sin(a) * radius,
    });
  }
  return pts;
}

function ensureFireflies() {
  while (fireflyState.length < fireflyCount) {
    const i = fireflyState.length;
    fireflyState.push({
      seedA: random(1000),
      seedB: random(1000),
      seedC: random(1000),
      speed: random(0.08, 0.22),
      sizeScale: random(0.55, 1.3),
      opacityScale: random(0.5, 1),
    });
  }
  if (fireflyState.length > fireflyCount) {
    fireflyState.length = fireflyCount;
  }
}

function updateFireflies() {
  ensureFireflies();
  const t = millis() * 0.001;
  for (const plane of planes) {
    for (let i = 0; i < fireflyState.length; i++) {
      const fly = fireflyState[i];
      const nx = noise2DSafe(fly.seedA, t * fly.speed + i * 0.19);
      const ny = noise2DSafe(fly.seedB, t * fly.speed + i * 0.23 + 50);
      const px = map(nx, -1, 1, 0, plane.surface.width);
      const py = map(ny, -1, 1, 0, plane.surface.height);
      stampCircle(
        plane.surface,
        px,
        py,
        brushSize * fly.sizeScale,
        brushOpacity * fly.opacityScale
      );
    }
  }
}

function noise2DSafe(x, y) {
  if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise2D === "function") {
    return simplexNoise.noise2D(x, y);
  }
  if (typeof OpenSimplexNoise !== "undefined") {
    if (!window.simplexNoise) window.simplexNoise = new OpenSimplexNoise(1234);
    return window.simplexNoise.noise2D(x, y);
  }
  return random(-1, 1);
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
  uiText("Draw Simple", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });

  brushSize = Number(
    uiSlider(BRUSH_SIZE_KEY, "Brush", {
      min: 8,
      max: 320,
      init: brushSize,
    }, compact).value
  );
  brushOpacity = Number(
    uiSlider(BRUSH_OPACITY_KEY, "Opacity", {
      min: 0.02,
      max: 1,
      init: brushOpacity,
    }, compact).value
  );
  fireflyMode = !!uiToggle(FIREFLY_MODE_KEY, "Firefly", {
    ...compact,
    onBgColor: "#7db4ff",
    offBgColor: "#d8d8d8",
  }).value;
  debugSteps = !!uiToggle(DEBUG_STEPS_KEY, "Debug Steps", {
    ...compact,
    onBgColor: "#7db4ff",
    offBgColor: "#d8d8d8",
  }).value;
  fireflyCount = Number(
    uiSlider(FIREFLY_COUNT_KEY, "Flies", {
      min: 1,
      max: 24,
      init: fireflyCount,
    }, compact).value
  );
  fireflyCount = constrain(round(fireflyCount), 1, 24);
  ensureFireflies();

  if (uiButton("Clear", compact).clicked) {
    clearAll();
  }
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
}
