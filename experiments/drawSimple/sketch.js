const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const PLANE_COUNT_STORAGE_KEY = "drawSimple:planeCount";
const BRUSH_SIZE_KEY = "drawSimple.brushSize";
const BRUSH_OPACITY_KEY = "drawSimple.brushOpacity";
const BRUSH_SPEED_SIZE_KEY = "drawSimple.brushSpeedSize";
const BRUSH_TURN_SIZE_KEY = "drawSimple.brushTurnSize";
const BRUSH_SPEED_SPREAD_KEY = "drawSimple.brushSpeedSpread";
const BRUSH_HAIRS_KEY = "drawSimple.brushHairs";
const BRUSH_NOISE_KEY = "drawSimple.brushNoise";
const BRUSH_HOLE_KEY = "drawSimple.brushHole";
const BRUSH_SPLATTER_KEY = "drawSimple.brushSplatter";
const BRUSH_DRAG_KEY = "drawSimple.brushDrag";
const FADEOUT_KEY = "drawSimple.fadeout";
const BLEND_MODE_KEY = "drawSimple.blendModeIndex";
const INVERT_OUTPUT_KEY = "drawSimple.invertOutput";
const FIREFLY_MODE_KEY = "drawSimple.fireflyMode";
const FIREFLY_SPIRAL_KEY = "drawSimple.fireflySpiral";
const FIREFLY_BASE_SPEED_KEY = "drawSimple.fireflyBaseSpeed";
const FIREFLY_COUNT_KEY = "drawSimple.fireflyCount";
const DEBUG_STEPS_KEY = "drawSimple.debugSteps";

let mapper;
let multiTouch;
let planes = [];
let brushSize = 48;
let brushOpacity = 0.35;
let brushSpeedSize = 0;
let brushTurnSize = 0;
let brushSpeedSpread = 0;
let brushHairs = 1;
let brushNoise = 0;
let brushHole = 0;
let brushSplatter = 0;
let brushDrag = 0.35;
let fadeout = 0;
let blendModeIndex = 0;
let invertOutput = false;
let fireflyMode = false;
let fireflySpiral = false;
let fireflyBaseSpeed = 0.33;
let fireflyCount = 4;
let fireflyState = [];
let pointerTrail = new Map();
let debugSteps = false;

const BLEND_MODES = [
  { label: "Blend", mode: "BLEND" },
  { label: "Add", mode: "ADD" },
  { label: "Screen", mode: "SCREEN" },
  { label: "Lightest", mode: "LIGHTEST" },
  { label: "Difference", mode: "DIFFERENCE" },
  { label: "Exclusion", mode: "EXCLUSION" },
  { label: "Multiply", mode: "MULTIPLY" },
  { label: "Darkest", mode: "DARKEST" },
];

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  frameRate(60);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/multiTouch.js");
  await loadScript("portal/mapper.js");
  await loadScript("portal/simplexNoise.js");
  await loadScript("portal/paintPath.js");

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
  brushSize = constrain(brushSize, 6, 360);
  brushOpacity = Number(uiGetState(BRUSH_OPACITY_KEY, brushOpacity));
  brushOpacity = constrain(brushOpacity, 0.02, 1);
  brushSpeedSize = Number(uiGetState(BRUSH_SPEED_SIZE_KEY, brushSpeedSize));
  brushSpeedSize = constrain(brushSpeedSize, -1, 1);
  brushTurnSize = Number(uiGetState(BRUSH_TURN_SIZE_KEY, brushTurnSize));
  brushTurnSize = constrain(brushTurnSize, -1, 1);
  brushSpeedSpread = Number(uiGetState(BRUSH_SPEED_SPREAD_KEY, brushSpeedSpread));
  brushSpeedSpread = constrain(brushSpeedSpread, -1, 1);
  brushHairs = Number(uiGetState(BRUSH_HAIRS_KEY, brushHairs));
  brushHairs = constrain(round(brushHairs), 1, 6);
  brushNoise = Number(uiGetState(BRUSH_NOISE_KEY, brushNoise));
  brushNoise = constrain(brushNoise, 0, 1);
  brushHole = Number(uiGetState(BRUSH_HOLE_KEY, brushHole));
  brushHole = constrain(brushHole, 0, 1);
  brushSplatter = Number(uiGetState(BRUSH_SPLATTER_KEY, brushSplatter));
  brushSplatter = constrain(brushSplatter, 0, 1);
  brushDrag = Number(uiGetState(BRUSH_DRAG_KEY, brushDrag));
  brushDrag = constrain(brushDrag, 0, 1);
  fadeout = Number(uiGetState(FADEOUT_KEY, fadeout));
  fadeout = constrain(fadeout, 0, 1);
  blendModeIndex = Number(uiGetState(BLEND_MODE_KEY, blendModeIndex));
  blendModeIndex = constrain(round(blendModeIndex), 0, BLEND_MODES.length - 1);
  invertOutput = !!uiGetState(INVERT_OUTPUT_KEY, invertOutput);
  fireflyMode = !!uiGetState(FIREFLY_MODE_KEY, fireflyMode);
  fireflySpiral = !!uiGetState(FIREFLY_SPIRAL_KEY, fireflySpiral);
  fireflyBaseSpeed = Number(uiGetState(FIREFLY_BASE_SPEED_KEY, fireflyBaseSpeed));
  fireflyBaseSpeed = constrain(fireflyBaseSpeed, 0.1, 1.33);
  debugSteps = !!uiGetState(DEBUG_STEPS_KEY, debugSteps);
  fireflyCount = Number(uiGetState(FIREFLY_COUNT_KEY, fireflyCount));
  fireflyCount = constrain(round(fireflyCount), 1, 24);
  ensureFireflies();
}

function draw() {
  background(invertOutput ? 255 : 0);
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
  applyFadeout();
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
    if (!trail || trail.planeIndex !== hit.surfaceIndex || !(trail.path instanceof PortalPaintPath)) {
      const path = new PortalPaintPath({
        rawSpacing: max(2, brushSize * 0.05),
        sampleSpacing: getBrushSampleSpacing(),
        curveSegmentLength: 8,
        maxRawPoints: 0,
      });
      path.addPoint(hit.x, hit.y);
      const rawPoints = path.getRawPoints();
      const points = path.getSampledPoints();
      pointerTrail.set(pointer.id, {
        planeIndex: hit.surfaceIndex,
        path,
        rawPoints,
        points,
        drawnCount: points.length,
        brushState: createBrushState(),
      });
      continue;
    }

    trail.path.setOptions({
      rawSpacing: max(2, brushSize * 0.05),
      sampleSpacing: getBrushSampleSpacing(),
      curveSegmentLength: 8,
      maxRawPoints: 0,
    });
    trail.path.addPoint(hit.x, hit.y);
    const rawPoints = trail.path.getRawPoints();
    const points = trail.path.getSampledPoints();
    const nextTrail = {
      planeIndex: hit.surfaceIndex,
      path: trail.path,
      rawPoints,
      points,
      drawnCount: trail.drawnCount || 0,
      brushState: trail.brushState || createBrushState(),
    };
    if (!debugSteps) {
      depositTrailStroke(
        plane.surface,
        nextTrail,
        nextTrail.drawnCount,
        brushSize,
        brushOpacity
      );
      nextTrail.drawnCount = points.length;
    } else {
      nextTrail.drawnCount = 0;
    }
    pointerTrail.set(pointer.id, nextTrail);
  }

  for (const id of Array.from(pointerTrail.keys())) {
    if (!activePointerIds.has(id)) pointerTrail.delete(id);
  }

  if (debugSteps) {
    redrawDebugTrails();
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

function withSurfaceBlendMode(surface, fn) {
  const entry = BLEND_MODES[constrain(round(blendModeIndex), 0, BLEND_MODES.length - 1)] || BLEND_MODES[0];
  const modeValue = typeof window[entry.mode] !== "undefined" ? window[entry.mode] : BLEND;
  surface.push();
  surface.blendMode(modeValue);
  try {
    fn?.();
  } finally {
    surface.pop();
  }
}

function getInkColor() {
  return invertOutput ? 0 : 255;
}

function applyFadeout() {
  if (fadeout <= 0.0001) return;
  const fade = constrain(getEffectiveFadeout(fadeout), 0, 1);
  const darkAlpha = fade * 255;
  const cutAlpha = Math.min(255, fade * 0.35 * 255);
  for (const plane of planes) {
    plane.surface.push();
    plane.surface.drawingContext.save();
    plane.surface.drawingContext.globalCompositeOperation = "source-atop";
    plane.surface.noStroke();
    plane.surface.fill(0, darkAlpha);
    plane.surface.rect(0, 0, plane.surface.width, plane.surface.height);
    plane.surface.drawingContext.globalCompositeOperation = "destination-out";
    plane.surface.fill(0, cutAlpha);
    plane.surface.rect(0, 0, plane.surface.width, plane.surface.height);
    plane.surface.drawingContext.restore();
    plane.surface.pop();
  }
}

function stampCircle(surface, x, y, size = brushSize, opacity = brushOpacity) {
  const alpha = getEffectiveOpacity(opacity) * 255;
  const radius = size * 0.28;
  const points = getBlobPointCount(radius);
  const blurOffsets = [
    { dx: -radius * 0.06, dy: 0, scale: 0.92, alpha: 0.16 },
    { dx: radius * 0.06, dy: 0, scale: 0.92, alpha: 0.16 },
    { dx: 0, dy: -radius * 0.06, scale: 0.92, alpha: 0.16 },
    { dx: 0, dy: radius * 0.06, scale: 0.92, alpha: 0.16 },
  ];

  withSurfaceBlendMode(surface, () => {
    surface.noStroke();
    for (const pass of blurOffsets) {
      surface.fill(getInkColor(), alpha * pass.alpha);
      drawBlobShape(surface, x + pass.dx, y + pass.dy, radius * pass.scale, points);
    }
    surface.fill(getInkColor(), alpha);
    drawBlobShape(surface, x, y, radius, points);
  });
}

function depositTrailStroke(surface, trail, drawnCount = 0, size = brushSize, opacity = brushOpacity) {
  const points = trail?.points;
  if (!Array.isArray(points) || points.length < 4) return;
  const startIndex = Math.max(3, drawnCount);
  const reinforceEvery = brushHairs > 1 || brushNoise > 0.01 || brushHole > 0.01 || brushSplatter > 0.01 ? 5 : 0;
  for (let endIndex = startIndex; endIndex < points.length; endIndex++) {
    depositExpressiveStamp(surface, trail, endIndex, size, opacity);
    if (reinforceEvery > 0 && endIndex % reinforceEvery === 0) {
      const reinforceStart = Math.max(3, endIndex - 2);
      for (let reinforceIndex = reinforceStart; reinforceIndex <= endIndex; reinforceIndex++) {
        depositExpressiveStamp(surface, trail, reinforceIndex, size, opacity * 0.2);
      }
    }
  }
}

function createBrushState() {
  return {
    hairs: [],
    stampIndex: 0,
    seed: random(1000),
  };
}

function ensureBrushHairs(brushState, count = brushHairs) {
  const targetCount = constrain(round(count), 1, 6);
  while (brushState.hairs.length < targetCount) {
    const i = brushState.hairs.length;
    brushState.hairs.push({
      offset: 0,
      velocity: 0,
      seed: random(1000) + i * 37.17,
      widthBias: random(0.82, 1.16),
    });
  }
  if (brushState.hairs.length > targetCount) {
    brushState.hairs.length = targetCount;
  }
}

function depositExpressiveStamp(surface, trail, endIndex, size = brushSize, opacity = brushOpacity) {
  const points = trail?.points;
  const brushState = trail?.brushState || createBrushState();
  const chunkStart = Math.max(0, endIndex - 3);
  const chunk = points.slice(chunkStart, endIndex + 1);
  if (chunk.length < 4) return;

  ensureBrushHairs(brushState, brushHairs);
  const dyn = deriveBrushDynamics(chunk, trail?.rawPoints, size, opacity);
  const alpha = dyn.alpha * 255;
  const expressiveAmount = Math.max(
    Math.abs(brushSpeedSize),
    Math.abs(brushTurnSize),
    Math.abs(brushSpeedSpread),
    Math.max(0, brushHairs - 1) / 5,
    brushNoise,
    brushHole,
    brushSplatter
  );
  const plainBrush =
    expressiveAmount <= 0.035;

  if (plainBrush) {
    withSurfaceBlendMode(surface, () => {
      const headPrev = points[endIndex - 1];
      const headCurr = points[endIndex];
      if (headPrev && headCurr) {
        surface.push();
        surface.noStroke();
        surface.fill(getInkColor(), alpha);
        drawPlainSegment(surface, headPrev, headCurr, dyn.radius);
        surface.pop();
      }

      const plainLookback = constrain(Math.round(map(dyn.radius, 2, 90, 5, 14)), 4, 16);
      const plainStart = Math.max(1, endIndex - plainLookback);
      for (let i = endIndex - 1; i >= plainStart; i--) {
        const age = endIndex - i;
        if (age > 2 && age % 2 === 1) continue;
        const prevPoint = points[i - 1];
        const currPoint = points[i];
        if (!prevPoint || !currPoint) continue;
        const falloff = age / Math.max(1, endIndex - plainStart);
        const stepRadius = dyn.radius * lerp(0.72, 0.08, falloff);
        const stepAlpha = alpha * lerp(0.18, 0.03, falloff);
        surface.push();
        surface.noStroke();
        surface.fill(getInkColor(), stepAlpha);
        drawPlainSegment(surface, prevPoint, currPoint, stepRadius);
        surface.pop();
      }
    });
    brushState.stampIndex += 1;
    return;
  }

  withSurfaceBlendMode(surface, () => {
    surface.push();
    surface.noStroke();

    for (let pass = 0; pass < 2; pass++) {
      const passScale = pass === 0 ? 1.18 : 1.0;
      const passAlpha = pass === 0 ? alpha * 0.24 : alpha * 1.08;
      for (let hairIndex = 0; hairIndex < brushState.hairs.length; hairIndex++) {
        const hair = brushState.hairs[hairIndex];
        const hairGeom = buildHairGeometry(chunk, dyn, brushState, hair, hairIndex, brushState.hairs.length, passScale);
        if (!hairGeom) continue;
        surface.fill(getInkColor(), passAlpha * (pass === 0 ? 0.75 : hairGeom.alpha));
        drawVariableRibbonShape(surface, hairGeom.points, hairGeom.widths);
      }
    }

    const nosePrev = points[endIndex - 1];
    const noseCurr = points[endIndex];
    if (nosePrev && noseCurr && expressiveAmount < 0.22) {
      const noseBlend = map(expressiveAmount, 0.035, 0.22, 1, 0.15, true);
      surface.fill(getInkColor(), alpha * 0.9 * noseBlend);
      drawPlainSegment(surface, nosePrev, noseCurr, dyn.radius * (0.9 + noseBlend * 0.1));
    }

    if (dyn.holeRadius > 1.2) {
      carveStrokeHole(surface, chunk, dyn);
    }
    if (dyn.splatterChance > 0.001) {
      drawInkSplatter(surface, chunk[chunk.length - 1], dyn, brushState);
    }

    surface.pop();
  });
  brushState.stampIndex += 1;
}

function deriveBrushDynamics(chunk, rawPoints, size = brushSize, opacity = brushOpacity) {
  const source =
    Array.isArray(rawPoints) && rawPoints.length >= 4
      ? rawPoints.slice(-4)
      : chunk;
  const p0 = source[Math.max(0, source.length - 4)];
  const p1 = source[Math.max(0, source.length - 3)];
  const p2 = source[Math.max(0, source.length - 2)];
  const p3 = source[source.length - 1];
  const vPrev = { x: p2.x - p1.x, y: p2.y - p1.y };
  const vNow = { x: p3.x - p2.x, y: p3.y - p2.y };
  const dir = normalizePoint(vNow.x || vPrev.x || 1, vNow.y || vPrev.y || 0);
  const prevDir = normalizePoint(vPrev.x || dir.x, vPrev.y || dir.y);
  const speed = Math.hypot(vNow.x, vNow.y);
  const accel = Math.hypot(vNow.x - vPrev.x, vNow.y - vPrev.y);
  const dot = constrain(prevDir.x * dir.x + prevDir.y * dir.y, -1, 1);
  const turn = Math.acos(dot);
  const turnSign = Math.sign(prevDir.x * dir.y - prevDir.y * dir.x) || 1;
  const speed01 = constrain(speed / max(4, size * 0.12), 0, 1);
  const accel01 = constrain(accel / max(3, size * 0.1), 0, 1);
  const turn01 = constrain(turn / PI, 0, 1);

  const speedSizeScale = brushSpeedSize >= 0
    ? lerp(1, 1 + brushSpeedSize * 2.2, speed01)
    : lerp(1, max(0.12, 1 + brushSpeedSize * 1.45), speed01);
  const speedSpreadScale = brushSpeedSpread >= 0
    ? lerp(1, 1 + brushSpeedSpread * 2.6, speed01)
    : lerp(1, max(0.08, 1 + brushSpeedSpread * 1.65), speed01);
  const speedAlphaScale = brushSpeedSpread >= 0
    ? lerp(1, 1 + brushSpeedSpread * 1.05, speed01)
    : lerp(1, max(0.18, 1 + brushSpeedSpread * 0.85), speed01);

  const turnWidthScale = brushTurnSize >= 0
    ? lerp(1, 1 + brushTurnSize * 1.8, turn01)
    : lerp(1, max(0.18, 1 + brushTurnSize * 0.9), turn01);
  const sizeNoise = noise3DSafe(
    p3.x * 0.003 + p2.x * 0.001,
    p3.y * 0.003 + p2.y * 0.001,
    speed01 * 1.7 + turn01 * 1.1 + accel01 * 0.9
  );
  const noiseSizeScale = lerp(1, max(0.2, 1 + sizeNoise * 0.75), brushNoise);
  const radius =
    size *
    0.28 *
    speedSizeScale *
    turnWidthScale *
    noiseSizeScale *
    lerp(1, 1.24, accel01 * 0.7);
  const spread = radius * (0.18 + brushHairs * 0.1) * speedSpreadScale;
  const noiseAmp = brushNoise * radius * (0.5 + 1.35 * speed01 + 0.9 * turn01 + 0.45 * accel01);
  const alpha = getEffectiveOpacity(opacity) * lerp(0.9, 1.15, speed01 * 0.45) * speedAlphaScale;
  const holeRadius = brushHole * radius * (0.22 + speed01 * 0.6 + turn01 * 0.45 + accel01 * 0.25);
  const holeJitter = holeRadius * (0.25 + brushNoise * 0.7 + turn01 * 0.35);
  const holeOffset = radius * (0.08 + turn01 * 0.2 + accel01 * 0.12);
  const drag01 = constrain(brushDrag, 0, 1);

  return {
    dir,
    prevDir,
    speed,
    speed01,
    accel01,
    turn01,
    turnSign,
    turnWidthScale,
    radius,
    spread,
    noiseAmp,
    drag01,
    inertia: lerp(0.04, 1.15, drag01) * (0.22 + speed01 * 0.9 + turn01 * 0.35),
    alpha,
    holeRadius,
    holeJitter,
    holeOffset,
    splatterChance: brushSplatter * (0.015 + speed01 * 0.12 + accel01 * 0.08 + turn01 * 0.28),
    splatterThrow: radius * (1.2 + speed01 * 3.2 + turn01 * 2.2),
  };
}

function buildHairGeometry(chunk, dyn, brushState, hair, hairIndex, hairCount, passScale = 1) {
  const slot = hairCount <= 1 ? 0 : map(hairIndex, 0, hairCount - 1, -1, 1);
  const noiseDrift = noise3DSafe(
    hair.seed,
    brushState.stampIndex * 0.11 + hairIndex * 0.17,
    dyn.speed01 * 0.9 + dyn.turn01 * 0.7
  );
  const targetOffset =
    slot * dyn.spread +
    noiseDrift * dyn.noiseAmp +
    dyn.turnSign * dyn.turn01 * dyn.radius * slot * 0.3;
  hair.velocity += (targetOffset - hair.offset) * lerp(0.28, 0.08, dyn.drag01);
  hair.velocity += noiseDrift * dyn.noiseAmp * lerp(0.07, 0.025, dyn.drag01);
  hair.velocity *= lerp(0.34, 0.93, dyn.drag01);
  hair.offset += hair.velocity;

  const points = [];
  const widths = [];
  const centerPull = 1 - Math.min(0.82, brushNoise * 0.55 + Math.abs(brushSpeedSpread) * 0.18 + brushHairs * 0.03);
  for (let i = 0; i < chunk.length; i++) {
    const prev = chunk[Math.max(0, i - 1)];
    const curr = chunk[i];
    const next = chunk[Math.min(chunk.length - 1, i + 1)];
    const localDir = normalizePoint(next.x - prev.x, next.y - prev.y);
    const localNormal = { x: -localDir.y, y: localDir.x };
    const depth = 1 - i / Math.max(1, chunk.length - 1);
    const localSpeed = Math.hypot(next.x - curr.x, next.y - curr.y);
    const lag = dyn.inertia * localSpeed * depth;
    const hairNoise = noise3DSafe(
      hair.seed + i * 0.31,
      curr.x * 0.003 + brushState.stampIndex * 0.02,
      curr.y * 0.003 + dyn.turn01 * 2
    );
    const offsetNormal = (hair.offset * (0.42 + depth * 0.38) + hairNoise * dyn.noiseAmp * 0.24) * centerPull;
    const offsetTangent = (-lag * 0.55 + hairNoise * dyn.noiseAmp * 0.06) * centerPull;
    const expressivePoint = {
      x: curr.x + localNormal.x * offsetNormal + localDir.x * offsetTangent,
      y: curr.y + localNormal.y * offsetNormal + localDir.y * offsetTangent,
    };
    points.push({
      x: lerp(curr.x, expressivePoint.x, 1 - centerPull * 0.55),
      y: lerp(curr.y, expressivePoint.y, 1 - centerPull * 0.55),
    });
    widths.push(
      max(
        1,
        dyn.radius *
          hair.widthBias *
          passScale *
          (0.58 + i / Math.max(1, chunk.length - 1) * 0.52) *
          lerp(0.92, 1.22, dyn.turn01) *
          (1 - abs(slot) * 0.12)
      )
    );
  }
  return { points, widths, alpha: 0.8 + 0.2 * (1 - abs(slot)) };
}

function drawVariableRibbonShape(surface, points, widths) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(widths)) return;
  const left = [];
  const right = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tangent = normalizePoint((curr.x - prev.x) + (next.x - curr.x), (curr.y - prev.y) + (next.y - curr.y));
    if (Math.hypot(tangent.x, tangent.y) < 1e-5) {
      tangent = normalizePoint(next.x - prev.x, next.y - prev.y);
    }
    const normal = { x: -tangent.y, y: tangent.x };
    const halfW = widths[Math.min(i, widths.length - 1)] || widths[widths.length - 1] || 1;
    left.push({ x: curr.x + normal.x * halfW, y: curr.y + normal.y * halfW });
    right.push({ x: curr.x - normal.x * halfW, y: curr.y - normal.y * halfW });
  }

  surface.beginShape();
  for (const p of buildCapPoints(left[0], right[0], points[0], widths[0] || 1, true)) {
    surface.vertex(p.x, p.y);
  }
  for (let i = 1; i < left.length; i++) {
    surface.vertex(left[i].x, left[i].y);
  }
  for (const p of buildCapPoints(left[left.length - 1], right[right.length - 1], points[points.length - 1], widths[widths.length - 1] || 1, false)) {
    surface.vertex(p.x, p.y);
  }
  for (let i = right.length - 2; i >= 1; i--) {
    surface.vertex(right[i].x, right[i].y);
  }
  surface.endShape(CLOSE);
}

function drawPlainSegment(surface, a, b, radius) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) {
    drawBlobShape(surface, b.x, b.y, Math.max(1, radius), getBlobPointCount(radius));
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  drawStretchedBlobShape(
    surface,
    (a.x + b.x) * 0.5,
    (a.y + b.y) * 0.5,
    Math.max(1, radius),
    length * 0.5,
    ux,
    uy,
    nx,
    ny,
    getBlobPointCount(radius)
  );
}

function carveStrokeHole(surface, chunk, dyn) {
  const anchor = chunk[chunk.length - 1];
  const holeOffsetNoise = noise3DSafe(
    anchor.x * 0.006,
    anchor.y * 0.006,
    dyn.speed01 * 2 + dyn.turn01 * 3
  );
  const holeOffsetTangent = noise3DSafe(
    anchor.x * 0.004 + 70,
    anchor.y * 0.004 + 70,
    dyn.accel01 * 3 + dyn.turn01 * 2
  );
  const centerShift = {
    x:
      -dyn.dir.y * holeOffsetNoise * dyn.holeOffset +
      dyn.dir.x * holeOffsetTangent * dyn.holeOffset * 0.8,
    y:
      dyn.dir.x * holeOffsetNoise * dyn.holeOffset +
      dyn.dir.y * holeOffsetTangent * dyn.holeOffset * 0.8,
  };
  const holePoints = chunk.map((point, i) => {
    const phase = i / Math.max(1, chunk.length - 1);
    const nA = noise3DSafe(point.x * 0.006, point.y * 0.006, dyn.turn01 * 4 + phase * 0.7);
    const nB = noise3DSafe(point.x * 0.009 + 100, point.y * 0.009 + 100, dyn.speed01 * 5 + phase * 1.1);
    const wobble = dyn.holeJitter * (0.35 + phase * 0.85);
    const radiusScale = 0.58 + phase * 0.55 + nB * 0.22;
    return {
      x:
        point.x +
        centerShift.x * (0.45 + phase * 0.7) +
        (-dyn.dir.y) * nA * wobble +
        dyn.dir.x * nB * wobble * 0.5,
      y:
        point.y +
        centerShift.y * (0.45 + phase * 0.7) +
        dyn.dir.x * nA * wobble +
        dyn.dir.y * nB * wobble * 0.5,
      radiusScale,
    };
  });
  const holeWidths = holePoints.map((point, i) =>
    max(
      0.8,
      dyn.holeRadius *
        point.radiusScale *
        (0.68 + i / Math.max(1, holePoints.length - 1) * 0.28)
    )
  );
  surface.push();
  surface.drawingContext.save();
  surface.drawingContext.globalCompositeOperation = "destination-out";
  surface.fill(0, 230);
  surface.noStroke();
  drawVariableRibbonShape(surface, holePoints, holeWidths);
  surface.drawingContext.restore();
  surface.pop();
}

function drawInkSplatter(surface, origin, dyn, brushState) {
  if (random() >= dyn.splatterChance) return;
  const turnBias = dyn.turn01 > 0.18 ? 1 : 0;
  const droplets = constrain(floor(1 + dyn.speed01 * 4 + dyn.turn01 * 7 + dyn.accel01 * 2 + turnBias), 1, 10);
  const normal = { x: -dyn.dir.y, y: dyn.dir.x };
  const alpha = dyn.alpha * 255;
  surface.noStroke();
  for (let i = 0; i < droplets; i++) {
    const burstPhase = i / Math.max(1, droplets - 1);
    const tangential = random(-dyn.radius * (0.35 + dyn.turn01 * 0.8), dyn.splatterThrow * (0.45 + burstPhase * 0.85));
    const lateral = randomGaussian() * dyn.radius * (0.28 + dyn.turn01 * 1.2 + dyn.speed01 * 0.15);
    const px = origin.x + dyn.dir.x * tangential + normal.x * lateral;
    const py = origin.y + dyn.dir.y * tangential + normal.y * lateral;
    const r = random(max(1.1, dyn.radius * 0.1), max(3.5, dyn.radius * (0.24 + dyn.speed01 * 0.34)));
    surface.fill(getInkColor(), alpha * random(0.5, 1));
    if (random() < 0.42) {
      const stretch = random(r, r * (3 + dyn.speed01 * 2.1));
      drawNoisyStretchedBlobShape(
        surface,
        px,
        py,
        r,
        stretch,
        dyn.dir.x,
        dyn.dir.y,
        normal.x,
        normal.y,
        brushState.seed + i * 0.37,
        dyn
      );
    } else {
      drawNoisyBlobShape(surface, px, py, r, brushState.seed + i * 0.37, dyn);
    }
  }
}

function drawDebugStepTrail(surface, points, size = brushSize, opacity = brushOpacity) {
  if (!Array.isArray(points) || points.length === 0) return;
  drawDebugPathDots(surface, points, size, opacity, "smoothed");
}

function redrawDebugTrails() {
  for (const plane of planes) {
    plane.surface.clear();
  }
  for (const trail of pointerTrail.values()) {
    const plane = planes[trail.planeIndex];
    if (!plane || !Array.isArray(trail.points)) continue;
    if (Array.isArray(trail.rawPoints)) {
      drawDebugPathDots(plane.surface, trail.rawPoints, brushSize, brushOpacity, "raw");
    }
    drawDebugStepTrail(plane.surface, trail.points, brushSize, brushOpacity);
  }
}

function drawDebugPathDots(surface, points, size = brushSize, opacity = brushOpacity, mode = "raw") {
  if (!Array.isArray(points) || points.length === 0) return;
  const alpha = constrain(opacity, 0, 1) * 255;
  const dotSize = mode === "smoothed" ? Math.max(12, size * 0.24) : Math.max(8, size * 0.14);
  surface.push();
  surface.noStroke();
  if (mode === "smoothed") {
    surface.fill(255, 80, 80, alpha);
  } else {
    surface.fill(getInkColor(), alpha);
  }
  for (const point of points) {
    surface.circle(point.x, point.y, dotSize);
  }
  surface.pop();
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

function drawNoisyBlobShape(surface, cx, cy, radius, seed, dyn, points = null) {
  const count = points || constrain(Math.round(getBlobPointCount(radius) * 0.34), 18, 36);
  const noiseAmount = radius * (0.12 + brushNoise * 0.3 + dyn.speed01 * 0.08 + dyn.turn01 * 0.06);
  surface.beginShape();
  for (let i = 0; i < count; i++) {
    const angle = (TWO_PI * i) / count;
    const n = noise3DSafe(seed + cos(angle) * 0.9, seed + sin(angle) * 0.9, i * 0.13 + dyn.turn01 * 2);
    const radial = radius + n * noiseAmount;
    surface.vertex(cx + cos(angle) * radial, cy + sin(angle) * radial);
  }
  surface.endShape(CLOSE);
}

function drawNoisyStretchedBlobShape(surface, cx, cy, radius, stretch, ux, uy, nx, ny, seed, dyn, points = null) {
  const count = points || constrain(Math.round(getBlobPointCount(radius) * 0.3), 16, 32);
  const noiseAmount = radius * (0.12 + brushNoise * 0.26 + dyn.speed01 * 0.08 + dyn.turn01 * 0.06);
  surface.beginShape();
  for (let i = 0; i < count; i++) {
    const angle = (TWO_PI * i) / count;
    const n = noise3DSafe(seed + cos(angle) * 0.8, seed + sin(angle) * 0.8, i * 0.17 + dyn.accel01 * 2);
    const along = cos(angle) * (radius + stretch + n * noiseAmount * 0.35);
    const across = sin(angle) * (radius + n * noiseAmount);
    const px = cx + ux * along + nx * across;
    const py = cy + uy * along + ny * across;
    surface.vertex(px, py);
  }
  surface.endShape(CLOSE);
}

function getBlobPointCount(radius) {
  return constrain(Math.round(32 + radius * 1.2), 40, 128);
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
      seedD: random(1000),
      speed: random(0.08, 0.22),
      sizeScale: random(0.55, 1.3),
      opacityScale: random(0.5, 1),
      trails: [],
      spiralDirection: random() < 0.5 ? -1 : 1,
      motionTime: 0,
      lastUpdateSec: null,
      x: random(),
      y: random(),
      vx: 0,
      vy: 0,
      targetX: null,
      targetY: null,
      targetVX: 0,
      targetVY: 0,
    });
  }
  if (fireflyState.length > fireflyCount) {
    fireflyState.length = fireflyCount;
  }
}

function updateFireflies() {
  ensureFireflies();
  const t = millis() * 0.001;
  const targets = [];
  for (let i = 0; i < fireflyState.length; i++) {
    const fly = fireflyState[i];
    advanceFireflyTime(fly, i, t);
    const targetPos = fireflySpiral
      ? getSpiralFireflyPosition(fly, i, SURFACE_W, SURFACE_H)
      : getNoiseFireflyPosition(fly, i, SURFACE_W, SURFACE_H);
    targets.push({
      x: constrain(targetPos.x / SURFACE_W, 0, 1),
      y: constrain(targetPos.y / SURFACE_H, 0, 1),
    });
  }
  updateFireflyFlock(targets);

  for (let planeIndex = 0; planeIndex < planes.length; planeIndex++) {
    const plane = planes[planeIndex];
    for (let i = 0; i < fireflyState.length; i++) {
      const fly = fireflyState[i];
      const dynamicSizeScale = fly.sizeScale * getFireflySizeScale(fly, i, t);
      const px = constrain(fly.x, 0, 1) * plane.surface.width;
      const py = constrain(fly.y, 0, 1) * plane.surface.height;
      let trail = fly.trails[planeIndex];
      if (!(trail?.path instanceof PortalPaintPath)) {
        trail = createFireflyTrail(px, py, dynamicSizeScale);
        fly.trails[planeIndex] = trail;
        continue;
      }

      const lastPoint = trail.rawPoints?.[trail.rawPoints.length - 1];
      const jumpLimit = max(32, brushSize * dynamicSizeScale * 1.8);
      if (lastPoint && dist(lastPoint.x, lastPoint.y, px, py) > jumpLimit) {
        fly.trails[planeIndex] = createFireflyTrail(px, py, dynamicSizeScale);
        continue;
      }

      trail.path.setOptions({
        rawSpacing: max(2, brushSize * dynamicSizeScale * 0.05),
        sampleSpacing: getFireflySampleSpacing(dynamicSizeScale),
        curveSegmentLength: 8,
        maxRawPoints: 0,
      });
      trail.path.addPoint(px, py);
      trail.rawPoints = trail.path.getRawPoints();
      trail.points = trail.path.getSampledPoints();
      if (!debugSteps) {
        const flyProfile = getFireflyBrushProfile(fly, i, t);
        withBrushProfile(flyProfile, () => {
          depositTrailStroke(
            plane.surface,
            trail,
            trail.drawnCount || 0,
            brushSize * dynamicSizeScale,
            brushOpacity * fly.opacityScale
          );
        });
        trail.drawnCount = trail.points.length;
      } else {
        trail.drawnCount = 0;
      }
    }
  }
}

function updateFireflyFlock(targets) {
  const neighborDist = 0.22;
  const separationDist = 0.075;
  const targetFollow = fireflySpiral ? 0.32 : 0.26;
  const targetLead = fireflySpiral ? 0.22 : 0.18;
  const cohesionPull = 0.003;
  const alignmentPull = 0.005;
  const separationPull = 0.035;
  const damping = 0.82;
  const maxSpeed = 0.0028 + fireflyBaseSpeed * 0.0018;

  for (let i = 0; i < fireflyState.length; i++) {
    const fly = fireflyState[i];
    const target = targets[i];
    if (Number.isFinite(fly.targetX) && Number.isFinite(fly.targetY)) {
      fly.targetVX = target.x - fly.targetX;
      fly.targetVY = target.y - fly.targetY;
    } else {
      fly.targetVX = 0;
      fly.targetVY = 0;
    }
    fly.targetX = target.x;
    fly.targetY = target.y;
    if (!Number.isFinite(fly.x) || !Number.isFinite(fly.y)) {
      fly.x = target.x;
      fly.y = target.y;
    }

    let sepX = 0;
    let sepY = 0;
    let cohX = 0;
    let cohY = 0;
    let aliX = 0;
    let aliY = 0;
    let count = 0;

    for (let j = 0; j < fireflyState.length; j++) {
      if (i === j) continue;
      const other = fireflyState[j];
      const dx = fly.x - other.x;
      const dy = fly.y - other.y;
      const d = Math.hypot(dx, dy);
      if (d < neighborDist) {
        cohX += other.x;
        cohY += other.y;
        aliX += other.vx;
        aliY += other.vy;
        count += 1;
      }
      if (d > 0.0001 && d < separationDist) {
        const force = (separationDist - d) / separationDist;
        sepX += (dx / d) * force;
        sepY += (dy / d) * force;
      }
    }

    const targetDx = target.x - fly.x;
    const targetDy = target.y - fly.y;
    let offsetX = sepX * separationPull;
    let offsetY = sepY * separationPull;
    if (count > 0) {
      cohX = cohX / count - fly.x;
      cohY = cohY / count - fly.y;
      aliX = aliX / count - fly.vx;
      aliY = aliY / count - fly.vy;
      offsetX += cohX * cohesionPull + aliX * alignmentPull;
      offsetY += cohY * cohesionPull + aliY * alignmentPull;
    }

    fly.vx = (fly.vx + fly.targetVX * targetLead + offsetX) * damping;
    fly.vy = (fly.vy + fly.targetVY * targetLead + offsetY) * damping;
    const speed = Math.hypot(fly.vx, fly.vy);
    if (speed > maxSpeed) {
      fly.vx = (fly.vx / speed) * maxSpeed;
      fly.vy = (fly.vy / speed) * maxSpeed;
    }

    fly.x = constrain(lerp(target.x, fly.x + fly.vx, 1 - targetFollow), 0.02, 0.98);
    fly.y = constrain(lerp(target.y, fly.y + fly.vy, 1 - targetFollow), 0.02, 0.98);
  }
}

function getFireflySizeScale(fly, index, timeSec) {
  const n = noise2DSafe(fly.seedC + 620, timeSec * 0.14 + index * 0.08);
  return constrain(1 + n * 2.5, 0.14, 3.5);
}

function advanceFireflyTime(fly, index, timeSec) {
  if (!Number.isFinite(fly.lastUpdateSec)) {
    fly.lastUpdateSec = timeSec;
    return;
  }
  const dt = constrain(timeSec - fly.lastUpdateSec, 0, 0.1);
  fly.lastUpdateSec = timeSec;
  const speedBias = 1 + brushSpeedSize * 0.35;
  const speedMod = map(
    noise2DSafe(fly.seedD + 90, timeSec * 0.17 + index * 0.09),
    -1,
    1,
    0.45 * speedBias,
    1.75 * speedBias
  );
  fly.motionTime += dt * fly.speed * fireflyBaseSpeed * speedMod;
}

function createFireflyTrail(x, y, sizeScale = 1) {
  const path = new PortalPaintPath({
    rawSpacing: max(2, brushSize * sizeScale * 0.05),
    sampleSpacing: getFireflySampleSpacing(sizeScale),
    curveSegmentLength: 8,
    maxRawPoints: 0,
  });
  path.addPoint(x, y);
  return {
    path,
    rawPoints: path.getRawPoints(),
    points: path.getSampledPoints(),
    drawnCount: path.getSampledPoints().length,
    brushState: createBrushState(),
  };
}

function getFireflyBrushProfile(fly, index, timeSec) {
  const nA = noise2DSafe(fly.seedA + 200, timeSec * 0.13 + index * 0.07);
  const nB = noise2DSafe(fly.seedB + 300, timeSec * 0.11 + index * 0.09);
  const nC = noise2DSafe(fly.seedC + 400, timeSec * 0.17 + index * 0.05);
  const nD = noise2DSafe(fly.seedD + 500, timeSec * 0.09 + index * 0.13);
  const hairsBase = constrain(round(brushHairs), 1, 6);
  return {
    speedSize: constrain(brushSpeedSize + nA * 0.32, -1, 1),
    turnSize: constrain(brushTurnSize + nB * 0.32, -1, 1),
    speedSpread: constrain(brushSpeedSpread + nC * 0.28, -1, 1),
    hairs: constrain(Math.round(hairsBase + (nA * 0.6 + nD * 0.4) * 1.25), 1, 6),
    noise: constrain(brushNoise + map(nB, -1, 1, -0.12, 0.22), 0, 1),
    hole: constrain(brushHole + map(nC, -1, 1, -0.08, 0.16), 0, 1),
    splatter: constrain(brushSplatter + map(nD, -1, 1, -0.1, 0.2), 0, 1),
    drag: constrain(brushDrag + map(nA * 0.5 + nC * 0.5, -1, 1, -0.2, 0.2), 0, 1),
  };
}

function withBrushProfile(profile, fn) {
  const saved = {
    brushSpeedSize,
    brushTurnSize,
    brushSpeedSpread,
    brushHairs,
    brushNoise,
    brushHole,
    brushSplatter,
    brushDrag,
  };
  brushSpeedSize = profile?.speedSize ?? brushSpeedSize;
  brushTurnSize = profile?.turnSize ?? brushTurnSize;
  brushSpeedSpread = profile?.speedSpread ?? brushSpeedSpread;
  brushHairs = profile?.hairs ?? brushHairs;
  brushNoise = profile?.noise ?? brushNoise;
  brushHole = profile?.hole ?? brushHole;
  brushSplatter = profile?.splatter ?? brushSplatter;
  brushDrag = profile?.drag ?? brushDrag;
  try {
    fn?.();
  } finally {
    brushSpeedSize = saved.brushSpeedSize;
    brushTurnSize = saved.brushTurnSize;
    brushSpeedSpread = saved.brushSpeedSpread;
    brushHairs = saved.brushHairs;
    brushNoise = saved.brushNoise;
    brushHole = saved.brushHole;
    brushSplatter = saved.brushSplatter;
    brushDrag = saved.brushDrag;
  }
}

function getNoiseFireflyPosition(fly, index, widthPx, heightPx) {
  const flyTime = fly.motionTime;
  const nx = noise2DSafe(fly.seedA, flyTime + index * 0.19);
  const ny = noise2DSafe(fly.seedB, flyTime + index * 0.23 + 50);
  return {
    x: map(nx, -1, 1, 0, widthPx),
    y: map(ny, -1, 1, 0, heightPx),
  };
}

function getSpiralFireflyPosition(fly, index, widthPx, heightPx) {
  const minDim = min(widthPx, heightPx);
  const cx = widthPx * 0.5;
  const cy = heightPx * 0.5;
  const speedPulse =
    0.22 +
    1.55 * Math.pow(0.5 + 0.5 * noise2DSafe(fly.seedD + 930, fly.motionTime * 0.16 + index * 0.09), 1.4);
  const sizePulse =
    0.45 +
    1.25 * Math.pow(0.5 + 0.5 * noise2DSafe(fly.seedB + 970, fly.motionTime * 0.11 + index * 0.07), 1.15);
  const radialRate =
    (0.035 + 0.085 * map(noise2DSafe(fly.seedD + 800, fly.motionTime * 0.09), -1, 1, 0, 1)) *
    speedPulse;
  const radialPhase = fly.motionTime * radialRate + fly.seedC * 0.021;
  const spiralProgress = 0.5 - 0.5 * cos(radialPhase * TWO_PI);
  const spiralEase = Math.pow(spiralProgress, 0.82);
  const angularRate =
    (0.45 + 1.85 * map(noise2DSafe(fly.seedA + 820, fly.motionTime * 0.07), -1, 1, 0, 1)) *
    (0.55 + speedPulse * 0.95);
  const phase = fly.motionTime * angularRate + fly.seedC * 0.013;
  const theta = phase * TWO_PI * 0.46 * fly.spiralDirection + index * 0.37;
  const nestedNoiseA = nestedNoise2D(fly.seedA + phase * 0.19 + index * 1.1, 0.13, 0.07);
  const nestedNoiseB = nestedNoise2D(fly.seedB + phase * 0.11 + 13.1 + index * 1.7, 0.09, 0.05);
  const radialNoise = nestedNoise2D(fly.seedD + phase * 0.53 + index * 3.1 + 9.8, 0.11, 0.08);
  const angularNoise = nestedNoise2D(fly.seedC + phase * 0.61 + index * 2.3, 0.14, 0.09);
  const radiusBase = minDim * 0.02;
  const spiralGain = minDim * (0.46 + brushTurnSize * 0.1 + brushSpeedSpread * 0.1);
  const spiralRadius =
    radiusBase +
    spiralGain * spiralEase * sizePulse +
    nestedNoiseA * (minDim * 0.08) +
    radialNoise * (18 + spiralEase * minDim * 0.08 * sizePulse);
  const localTheta =
    theta +
    nestedNoise2D(fly.seedC + phase * 0.21 + index * 1.3, 0.14, 0.09) * 1.1 +
    angularNoise * (0.35 + spiralEase * 0.75);
  const localRadius =
    spiralRadius +
    nestedNoise2D(fly.seedD + phase * 0.31 + index * 2.1, 0.11, 0.08) * (12 + spiralEase * minDim * 0.03);
  const pos = {
    x: cx + cos(localTheta) * localRadius + nestedNoiseB * minDim * 0.07 * spiralEase,
    y: cy + sin(localTheta) * localRadius + nestedNoiseA * minDim * 0.05 * spiralEase,
  };
  return pos;
}

function nestedNoise2D(value, innerScale = 0.1, outerScale = 0.05) {
  const inner = noise2DSafe(value * innerScale, value * innerScale + 17.13);
  return noise2DSafe(value * outerScale + inner * 2.7, value * outerScale + 43.9);
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

function noise3DSafe(x, y, z) {
  if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise3D === "function") {
    return simplexNoise.noise3D(x, y, z);
  }
  if (typeof OpenSimplexNoise !== "undefined") {
    if (!window.simplexNoise) window.simplexNoise = new OpenSimplexNoise(1234);
    if (typeof window.simplexNoise.noise3D === "function") {
      return window.simplexNoise.noise3D(x, y, z);
    }
  }
  return random(-1, 1);
}

function getBrushSampleSpacing() {
  if (debugSteps) return max(12, brushSize * 0.28);
  return constrain(0.9 + brushSize * 0.02, 0.9, 4.5);
}

function getFireflySampleSpacing(sizeScale = 1) {
  const scaledSize = brushSize * sizeScale;
  return constrain(0.45 + scaledSize * 0.008, 0.45, 2.2);
}

function getEffectiveOpacity(opacity) {
  return constrain(opacity, 0, 1) * 0.3;
}

function getEffectiveFadeout(value) {
  return constrain(value, 0, 1) * 0.04;
}

function renderUi() {
  const compact = {
    width: 112,
    height: 22,
    fontSize: 11,
    padding: 5,
    margin: 3,
    rounding: 4,
    bgColor: "#d8d8d8",
  };
  const colGap = 12;
  const col2X = 24 + compact.width + colGap;

  uiListStart({ x: 24, y: 24, width: compact.width, dir: "vertical" });
  uiText("Draw Simple", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });

  brushSize = Number(
    uiSlider(BRUSH_SIZE_KEY, "Brush", {
      min: 6,
      max: 360,
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
  brushSpeedSize = Number(
    uiSlider(BRUSH_SPEED_SIZE_KEY, "Speed Size", {
      min: -1,
      max: 1,
      init: brushSpeedSize,
    }, compact).value
  );
  brushTurnSize = Number(
    uiSlider(BRUSH_TURN_SIZE_KEY, "Turn Size", {
      min: -1,
      max: 1,
      init: brushTurnSize,
    }, compact).value
  );
  brushSpeedSpread = Number(
    uiSlider(BRUSH_SPEED_SPREAD_KEY, "Speed Dynamics", {
      min: -1,
      max: 1,
      init: brushSpeedSpread,
    }, compact).value
  );
  brushHairs = Number(
    uiSlider(BRUSH_HAIRS_KEY, "Hairs", {
      min: 1,
      max: 6,
      init: brushHairs,
      step: 1,
    }, compact).value
  );
  brushHairs = constrain(round(brushHairs), 1, 6);
  brushNoise = Number(
    uiSlider(BRUSH_NOISE_KEY, "Noise", {
      min: 0,
      max: 1,
      init: brushNoise,
    }, compact).value
  );
  brushHole = Number(
    uiSlider(BRUSH_HOLE_KEY, "Hole", {
      min: 0,
      max: 1,
      init: brushHole,
    }, compact).value
  );
  uiListEnd();

  uiListStart({ x: col2X, y: 24, width: compact.width, dir: "vertical" });
  uiText(" ", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });
  brushSplatter = Number(
    uiSlider(BRUSH_SPLATTER_KEY, "Splatter", {
      min: 0,
      max: 1,
      init: brushSplatter,
    }, compact).value
  );
  brushDrag = Number(
    uiSlider(BRUSH_DRAG_KEY, "Hair Drag", {
      min: 0,
      max: 1,
      init: brushDrag,
    }, compact).value
  );
  fadeout = Number(
    uiSlider(FADEOUT_KEY, "Fade", {
      min: 0,
      max: 1,
      init: fadeout,
    }, compact).value
  );
  const blendLabel = BLEND_MODES[blendModeIndex]?.label || BLEND_MODES[0].label;
  if (uiButton(`Blend: ${blendLabel}`, compact).clicked) {
    blendModeIndex = (blendModeIndex + 1) % BLEND_MODES.length;
    uiSetState(BLEND_MODE_KEY, blendModeIndex);
  }
  invertOutput = !!uiToggle(INVERT_OUTPUT_KEY, "Invert", {
    ...compact,
    onBgColor: "#7db4ff",
    offBgColor: "#d8d8d8",
  }).value;
  fireflyBaseSpeed = Number(
    uiSlider(FIREFLY_BASE_SPEED_KEY, "Base Speed", {
      min: 0.1,
      max: 1.33,
      init: fireflyBaseSpeed,
    }, compact).value
  );
  fireflyMode = !!uiToggle(FIREFLY_MODE_KEY, "Firefly", {
    ...compact,
    onBgColor: "#7db4ff",
    offBgColor: "#d8d8d8",
  }).value;
  fireflySpiral = !!uiToggle(FIREFLY_SPIRAL_KEY, "Spiral", {
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
  brushSize = constrain(brushSize, 6, 360);
  brushOpacity = constrain(brushOpacity, 0.02, 1);
  brushSpeedSize = constrain(brushSpeedSize, -1, 1);
  brushTurnSize = constrain(brushTurnSize, -1, 1);
  brushSpeedSpread = constrain(brushSpeedSpread, -1, 1);
  brushNoise = constrain(brushNoise, 0, 1);
  brushHole = constrain(brushHole, 0, 1);
  brushSplatter = constrain(brushSplatter, 0, 1);
  brushDrag = constrain(brushDrag, 0, 1);
  fadeout = constrain(fadeout, 0, 1);
  fireflyBaseSpeed = constrain(fireflyBaseSpeed, 0.1, 1.33);
  fireflyCount = constrain(round(fireflyCount), 1, 24);
  ensureFireflies();

  if (uiButton("Clear", compact).clicked) {
    clearAll();
  }
  if (uiButton("Fullscreen", compact).clicked) {
    fullScreenToggle();
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
