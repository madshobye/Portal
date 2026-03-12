const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 8;
const MAX_POINTERS = 6;
const PLANE_COUNT_STORAGE_KEY = "chainpaintlab:planeCount";
const AUTO_POINTER_COUNT = 5;
const AUTO_MODE_SPIRAL = "spiral";
const AUTO_MODE_FIREFLY = "firefly";

let mapper;
let multiTouch;
let planes = [];
let recipeEntries = [];

let recipeKey = "round_brush";
let brushSize = 0.22;
let brushOpacity = 0.5;
let brushWetness = 0.45;
let brushWildness = 0.3;
let showPreview = false;
let invertOutput = false;
let autoMode = false;
let autoMotionMode = AUTO_MODE_SPIRAL;
let autoPointCount = AUTO_POINTER_COUNT;
let fadeOut = 0.0;

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pixelDensity(1);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/multiTouch.js");
  await loadScript("portal/simplexNoise.js");
  await loadScript("portal/mapper.js");
  await loadScript("portal/chainBrush.js");

  if (typeof simplexNoise === "undefined" && typeof OpenSimplexNoise !== "undefined") {
    window.simplexNoise = new OpenSimplexNoise(Date.now());
  }

  multiTouch = await new MultiTouch({ preventDefault: true }).init();
  await multiTouch.start();
  uiUseMultiTouch(multiTouch);
  recipeKey = uiGetState("chainpaintlab.recipe", recipeKey, { persist: true });
  brushSize = uiGetState("chainpaintlab.size", brushSize, { persist: true });
  brushOpacity = uiGetState("chainpaintlab.opacity", brushOpacity, { persist: true });
  brushWetness = uiGetState("chainpaintlab.wetness", brushWetness, { persist: true });
  brushWildness = uiGetState("chainpaintlab.wildness", brushWildness, { persist: true });
  fadeOut = uiGetState("chainpaintlab.fadeout", fadeOut, { persist: true });
  showPreview = !!uiGetState("chainpaintlab.preview", showPreview, { persist: true });
  invertOutput = !!uiGetState("chainpaintlab.invert", invertOutput, { persist: true });
  autoMode = !!uiGetState("chainpaintlab.automode", autoMode, { persist: true });
  autoMotionMode = uiGetState("chainpaintlab.automotion", autoMotionMode, { persist: true });
  autoPointCount = round(uiGetState("chainpaintlab.autopoints", autoPointCount, { persist: true }));
  uiSetBaseStyle({
    common: {
      fontSize: 12,
      height: 24,
      padding: 5,
      margin: 4,
      rounding: 4,
    },
    list: {
      width: 180,
    },
  });

  mapper = new ProjectionMapper();
  mapper.followDebugOverlayVisibility(true);
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) {
    mapper.setFont(baseMonoFont);
    textFont(baseMonoFont);
  } else if (typeof baseFont !== "undefined" && baseFont) {
    mapper.setFont(baseFont);
    textFont(baseFont);
  }

  const storedPlaneCount = getStoredPlaneCount();
  for (let i = 0; i < storedPlaneCount; i++) {
    await addPlane(false);
  }
  mapper.loadAll();

  recipeEntries = planes[0]?.brush?.getRecipeEntries?.() || [];

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      for (const plane of planes) plane.brush?.resetPointers?.();
    }
  });
}

function draw() {
  background(invertOutput ? 255 : 0);
  applyControlsToAllBrushes();
  applyFadeoutToAllBrushes();
  updatePlaneInput();
  renderPlanes();
  mapper?.render();

  if (showPreview) drawPlanePreview();

  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderUi();
    uiEndUseGraphics();
  });
  uiShowInfo();
}

async function addPlane(persist = true) {
  if (!mapper || planes.length >= MAX_PLANES) return false;
  const name = planeName(planes.length);
  const surface = mapper.add(SURFACE_W, SURFACE_H, name);
  surface.imageMode(CORNER);
  const brush = await new ChainBrush({
    width: SURFACE_W,
    height: SURFACE_H,
    background: null,
    foreground: 255,
    recipe: recipeKey,
    controls: currentControls(),
  }).init();
  const autoPainter = new PlaneAutoPainter({
    width: SURFACE_W,
    height: SURFACE_H,
    recipeKeys: recipeEntries.map((entry) => entry.key),
    seed: planes.length * 137.17 + 11.3,
    mode: autoMotionMode,
    pointCount: autoPointCount,
  });
  planes.push({ name, surface, brush, autoPainter });
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

function renderPlanes() {
  for (const plane of planes) {
    plane.surface.clear();
    const layer = plane.brush?.getLayer?.();
    if (layer) {
      if (invertOutput) {
        const inverted = layer.get();
        inverted.filter(INVERT);
        plane.surface.image(inverted, 0, 0, plane.surface.width, plane.surface.height);
      } else {
        plane.surface.image(layer, 0, 0, plane.surface.width, plane.surface.height);
      }
    }
  }
}

function updatePlaneInput() {
  const perPlane = Array.from({ length: planes.length }, () => []);
  const allowManual = mapper && !mapper.isActive();
  const pointers = allowManual ? getInputPointers() : [];

  for (const pointer of pointers) {
    const hit = mapper.screenToSurface(pointer.x, pointer.y);
    if (!hit) continue;
    const plane = planes[hit.surfaceIndex];
    if (!plane) continue;
    perPlane[hit.surfaceIndex].push({
      id: pointer.id,
      x: hit.x,
      y: hit.y,
      rawX: pointer.x,
      rawY: pointer.y,
    });
  }

  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i];
    if (autoMode && plane?.autoPainter) {
      plane.autoPainter.setMode(autoMotionMode);
      plane.autoPainter.setPointCount(autoPointCount);
      const autoPointers = plane.autoPainter.update({
        timeSec: millis() * 0.001,
        controls: currentControls(),
      });
      for (const ptr of autoPointers) perPlane[i].push(ptr);
    } else if (plane?.brush?.recipeName !== recipeKey) {
      plane.brush?.setRecipe?.(recipeKey);
    }

    planes[i].brush.updatePointers(perPlane[i]);
  }
}

function clearAllPlanePointers() {
  for (const plane of planes) {
    plane.brush?.updatePointers?.([]);
  }
}

function getInputPointers() {
  const touches = multiTouch?.getTouches?.() || [];
  const pointers = [];

  for (let i = 0; i < Math.min(MAX_POINTERS, touches.length); i++) {
    const t = touches[i];
    pointers.push({ id: `t${t.id}`, x: t.x, y: t.y });
  }

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

  if (hasUiPointer) return { id: "mouse", x: uiMX, y: uiMY };
  return { id: "mouse", x: mouseX + width * 0.5, y: mouseY + height * 0.5 };
}

function clearAllDrawings() {
  for (const plane of planes) {
    plane.brush?.clear?.(null);
  }
}

function setRecipeOnAllBrushes() {
  for (const plane of planes) {
    plane.brush?.setRecipe?.(recipeKey);
  }
}

function applyControlsToAllBrushes() {
  for (const plane of planes) {
    plane.brush?.patchControls?.(currentControls());
  }
}

function currentControls() {
  return {
    size: brushSize,
    opacity: brushOpacity,
    wetness: brushWetness,
    wildness: brushWildness,
  };
}

function applyFadeoutToAllBrushes() {
  if (fadeOut <= 0) return;
  const eraseAlpha = constrain(fadeOut, 0, 1) * 28;
  for (const plane of planes) {
    const layer = plane.brush?.getLayer?.();
    if (!layer) continue;
    layer.push();
    layer.noStroke();
    layer.drawingContext.save();
    layer.drawingContext.globalCompositeOperation = "destination-out";
    layer.fill(0, eraseAlpha);
    layer.rect(0, 0, layer.width, layer.height);
    layer.drawingContext.restore();
    layer.pop();
  }
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
  return `chainpaintlab_surface_${index + 1}`;
}

function renderUi() {
  uiListStart({ x: 30, y: 40 });
  uiText("Chain Paint Lab", {
    bgColor: "#d8d8d8",
    color: "#000000",
  });

  for (const entry of recipeEntries) {
    const active = recipeKey === entry.key;
    const pressed = uiButton(entry.label, {
      bgColor: active ? "#cfcfcf" : "#e0e0e0",
      hoverBgColor: active ? "#bdbdbd" : "#d2d2d2",
      borderColor: "#00000022",
      persist: false,
    });
    if (pressed.clicked) {
      recipeKey = entry.key;
      uiSetState("chainpaintlab.recipe", recipeKey, { persist: true });
      setRecipeOnAllBrushes();
    }
  }

  brushSize = uiSlider("chainpaintlab.size", "Size", {
    min: 0.02,
    max: 1.25,
    init: brushSize,
    step: 0.01,
  }).value;

  brushOpacity = uiSlider("chainpaintlab.opacity", "Opacity", {
    min: 0.02,
    max: 1.0,
    init: brushOpacity,
    step: 0.01,
  }).value;

  brushWetness = uiSlider("chainpaintlab.wetness", "Wetness", {
    min: 0,
    max: 1,
    init: brushWetness,
    step: 0.01,
  }).value;

  brushWildness = uiSlider("chainpaintlab.wildness", "Wildness", {
    min: 0,
    max: 1,
    init: brushWildness,
    step: 0.01,
  }).value;

  fadeOut = uiSlider("chainpaintlab.fadeout", "Fadeout", {
    min: 0,
    max: 1,
    init: fadeOut,
    step: 0.01,
  }).value;

  showPreview = uiToggle("chainpaintlab.preview", "Brush Preview", {
    onBgColor: "#cfcfcf",
    offBgColor: "#e0e0e0",
  }).value;

  uiText("Auto Motion", {
    bgColor: "#d8d8d8",
    color: "#000000",
  });
  for (const mode of [AUTO_MODE_SPIRAL, AUTO_MODE_FIREFLY]) {
    const active = autoMotionMode === mode;
    const pressed = uiButton(mode === AUTO_MODE_SPIRAL ? "Spiral" : "Firefly", {
      bgColor: active ? "#cfcfcf" : "#e0e0e0",
      hoverBgColor: active ? "#bdbdbd" : "#d2d2d2",
      borderColor: "#00000022",
      persist: false,
    });
    if (pressed.clicked) {
      autoMotionMode = mode;
      uiSetState("chainpaintlab.automotion", autoMotionMode, { persist: true });
      for (const plane of planes) plane.autoPainter?.setMode?.(mode);
    }
  }

  const previousAutoMode = autoMode;
  autoMode = uiToggle("chainpaintlab.automode", "Auto Mode", {
    onBgColor: "#cfcfcf",
    offBgColor: "#e0e0e0",
  }).value;

  autoPointCount = round(uiSlider("chainpaintlab.autopoints", "Auto Points", {
    min: 1,
    max: 16,
    init: autoPointCount,
    step: 1,
  }).value);

  invertOutput = uiToggle("chainpaintlab.invert", "Invert", {
    onBgColor: "#cfcfcf",
    offBgColor: "#e0e0e0",
  }).value;

  if (!autoMode && previousAutoMode !== autoMode) {
    setRecipeOnAllBrushes();
    clearAllPlanePointers();
  }

  if (uiButton("Clear Drawings", {
    persist: false,
    bgColor: "#e0e0e0",
    hoverBgColor: "#d2d2d2",
  }).clicked) {
    clearAllDrawings();
  }
  if (uiButton("Add Plane", { persist: false }).clicked) {
    addPlane(true);
  }
  if (uiButton("Remove Plane", { persist: false }).clicked) {
    removePlane(true);
  }
  if (uiButton("Clear Mapping", { persist: false }).clicked) {
    mapper?.resetAll();
  }

  uiText(`planes: ${planes.length}`, {
    bgColor: "#d8d8d8",
    color: "#00000099",
  });
  uiListEnd();

  applyControlsToAllBrushes();
}

function drawPlanePreview() {
  const pointer = getMousePointer();
  const hit = mapper?.screenToSurface?.(pointer.x, pointer.y);
  if (!hit) return;
  const recipe = planes[hit.surfaceIndex]?.brush?.getRecipe?.();
  if (!recipe) return;

  const sizeScale = lerp(recipe.control.sizeRange[0], recipe.control.sizeRange[1], brushSize);
  const radius = recipe.shape.radius * sizeScale;
  const roots = planes[hit.surfaceIndex].brush._makeRoots(recipe.shape, recipe.chain.count);

  push();
  translate(-width * 0.5, -height * 0.5);
  noFill();
  stroke(0, 50);
  strokeWeight(1);
  circle(pointer.x, pointer.y, radius * 2);
  noStroke();
  fill(0, 70);
  for (const root of roots) {
    circle(
      pointer.x + root.x * radius * recipe.shape.aspectX,
      pointer.y + root.y * radius * recipe.shape.aspectY,
      3
    );
  }
  pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

class PlaneAutoPainter {
  constructor({ width, height, recipeKeys = [], seed = 0, mode = AUTO_MODE_SPIRAL, pointCount = AUTO_POINTER_COUNT } = {}) {
    this.width = width;
    this.height = height;
    this.recipeKeys = recipeKeys.length ? recipeKeys.slice() : ["round_brush"];
    this.seed = seed;
    this.pointerCount = pointCount;
    this.mode = mode;
    this.recipeKey = this.recipeKeys[0];
    this.cycleStartSec = null;
    this.cycleIndex = 0;
    this.fireflies = [];
    this.pointerRecipes = [];
    this._ensureFireflies();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.cycleStartSec = null;
    this.cycleIndex = 0;
    this._ensureFireflies(true);
  }

  setPointCount(count) {
    const next = constrain(round(count || AUTO_POINTER_COUNT), 1, 16);
    if (next === this.pointerCount) return;
    this.pointerCount = next;
    this._ensureFireflies(true);
  }

  update({ timeSec, controls }) {
    if (this.mode === AUTO_MODE_FIREFLY) {
      return this._updateFirefly({ timeSec, controls });
    }
    return this._updateSpiral({ timeSec, controls });
  }

  _updateSpiral({ timeSec, controls }) {
    if (this.cycleStartSec == null) this.cycleStartSec = timeSec;

    for (let attempt = 0; attempt < 2; attempt++) {
      const elapsed = Math.max(0, timeSec - this.cycleStartSec);
      const cx = this.width * 0.5;
      const cy = this.height * 0.5;
      const cycleSeed = this.seed + this.cycleIndex * 17.13;
      const phase = elapsed * 0.065 + cycleSeed;
      const radiusBase = min(this.width, this.height) * 0.01;
      const spiralGain = min(this.width, this.height) * 0.08;
      const theta = phase * TWO_PI * 0.38;
      const nestedNoiseA = this._nestedNoise(phase * 0.19, 0.13, 0.07);
      const nestedNoiseB = this._nestedNoise(phase * 0.11 + 13.1, 0.09, 0.05);
      const spiralProgress = constrain(elapsed * 0.03, 0, 1);
      const spiralRadius = radiusBase + spiralGain * spiralProgress + nestedNoiseA * 90;
      const centerX = cx + Math.cos(theta) * spiralRadius + nestedNoiseB * 120 * spiralProgress;
      const centerY = cy + Math.sin(theta) * spiralRadius + nestedNoiseA * 90 * spiralProgress;

      const recipeIndexNoise = (this._nestedNoise(phase * 0.07 + 40.7, 0.05, 0.03) + 1) * 0.5;
      const recipeIndex = constrain(floor(recipeIndexNoise * this.recipeKeys.length), 0, this.recipeKeys.length - 1);
      this.recipeKey = this.recipeKeys[recipeIndex];

      const out = [];
      let outOfBounds = false;
      const edgeMargin = 120;
      for (let i = 0; i < this.pointerCount; i++) {
        const style = this._styleForPoint(i, phase, controls);
        const ptPhase = phase + i * 0.17;
        const offsetNoiseX = this._nestedNoise(ptPhase * 0.37 + i * 1.1 + 20, 0.09, 0.05);
        const offsetNoiseY = this._nestedNoise(ptPhase * 0.41 + i * 1.7 + 40, 0.08, 0.04);
        const radialNoise = this._nestedNoise(ptPhase * 0.53 + i * 3.1 + 9.8, 0.11, 0.08);
        const angularNoise = this._nestedNoise(ptPhase * 0.61 + i * 2.3, 0.14, 0.09);
        const localTheta = theta + i * (TWO_PI / this.pointerCount) + angularNoise * 0.9;
        const localRadius = 0.8 + style.controls.size * 5 + radialNoise * (1.5 + style.controls.wildness * 7);
        const px =
          centerX +
          Math.cos(localTheta) * localRadius +
          offsetNoiseX * (3 + style.controls.wildness * 12);
        const py =
          centerY +
          Math.sin(localTheta) * localRadius +
          offsetNoiseY * (3 + style.controls.wildness * 12);
        if (
          px < edgeMargin ||
          py < edgeMargin ||
          px > this.width - edgeMargin ||
          py > this.height - edgeMargin
        ) {
          outOfBounds = true;
          break;
        }
        out.push({
          id: `auto-${this.seed.toFixed(2)}-${i}`,
          x: px,
          y: py,
          rawX: centerX,
          rawY: centerY,
          auto: true,
          recipe: style.recipe,
          controls: style.controls,
        });
      }

      if (!outOfBounds) return out;

      this.cycleStartSec = timeSec;
      this.cycleIndex += 1;
    }

    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    return Array.from({ length: this.pointerCount }, (_, i) => ({
      id: `auto-${this.seed.toFixed(2)}-${i}`,
      x: cx,
      y: cy,
      rawX: cx,
      rawY: cy,
      auto: true,
      recipe: this._styleForPoint(i, timeSec, controls).recipe,
      controls: this._styleForPoint(i, timeSec, controls).controls,
    }));
  }

  getRecipeKey() {
    return this.recipeKey;
  }

  _updateFirefly({ timeSec, controls }) {
    this._ensureFireflies();
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const edgeMargin = 110;
    const dt = 1 / 60;
    const out = [];
    const motionScale = 1.1 + controls.wildness * 2.8;
    const driftScale = 24 + controls.size * 52;
    const exploreX = this.width * 0.44;
    const exploreY = this.height * 0.44;
    const orbitRange = 80;
    const repelRange = 42;
    const orbitStrength = 0.045 + controls.wildness * 0.06;
    const repelStrength = 0.06 + controls.wetness * 0.04;

    for (let i = 0; i < this.fireflies.length; i++) {
      const fly = this.fireflies[i];
      const style = this._styleForPoint(i, timeSec, controls);
      const t = timeSec + i * 0.13 + this.seed;

      const fieldX = this._nestedNoise(t * 0.47 + fly.seed, 0.21, 0.09);
      const fieldY = this._nestedNoise(t * 0.43 + fly.seed + 50, 0.18, 0.08);
      const orbitX = this._nestedNoise(t * 0.17 + fly.seed + 100, 0.05, 0.03);
      const orbitY = this._nestedNoise(t * 0.19 + fly.seed + 150, 0.06, 0.04);

      if (fly.targetAge <= 0 || dist(fly.x, fly.y, fly.tx, fly.ty) < 28) {
        const targetNoiseX = this._nestedNoise(t * 0.09 + fly.seed + 200, 0.08, 0.05);
        const targetNoiseY = this._nestedNoise(t * 0.08 + fly.seed + 300, 0.07, 0.04);
        fly.tx = constrain(cx + targetNoiseX * exploreX, edgeMargin, this.width - edgeMargin);
        fly.ty = constrain(cy + targetNoiseY * exploreY, edgeMargin, this.height - edgeMargin);
        fly.targetAge = 90 + ((i * 37) % 120);
      }
      fly.targetAge -= 1;

      const pullX = (fly.tx - fly.x) * (0.012 + controls.wetness * 0.018);
      const pullY = (fly.ty - fly.y) * (0.012 + controls.wetness * 0.018);
      let pairVX = 0;
      let pairVY = 0;

      if (fly.buddyIndex != null && timeSec > fly.buddyUntil) {
        fly.buddyIndex = null;
        fly.buddyUntil = 0;
      }

      for (let j = 0; j < this.fireflies.length; j++) {
        if (i === j) continue;
        const other = this.fireflies[j];
        const dx = other.x - fly.x;
        const dy = other.y - fly.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) continue;

        if (d < repelRange) {
          const repel = (1 - d / repelRange) * repelStrength;
          pairVX -= (dx / d) * repel;
          pairVY -= (dy / d) * repel;
        }

        if (d < orbitRange && fly.buddyIndex == null && other.buddyIndex == null) {
          fly.buddyIndex = j;
          other.buddyIndex = i;
          fly.buddyUntil = timeSec + 1.2 + ((i + j) % 5) * 0.18;
          other.buddyUntil = fly.buddyUntil;
        }
      }

      if (fly.buddyIndex != null) {
        const other = this.fireflies[fly.buddyIndex];
        if (other) {
          const dx = other.x - fly.x;
          const dy = other.y - fly.y;
          const d = Math.max(0.001, Math.hypot(dx, dy));
          const nx = dx / d;
          const ny = dy / d;
          const txp = -ny;
          const typ = nx;
          const orbitFade = constrain((fly.buddyUntil - timeSec) / 1.4, 0, 1);
          pairVX += txp * orbitStrength * orbitFade;
          pairVY += typ * orbitStrength * orbitFade;
          if (d < repelRange * 1.2) {
            pairVX -= nx * repelStrength * 0.6;
            pairVY -= ny * repelStrength * 0.6;
          }
        }
      }

      fly.vx = fly.vx * 0.94 + pullX + fieldX * motionScale * dt * 60 + pairVX;
      fly.vy = fly.vy * 0.94 + pullY + fieldY * motionScale * dt * 60 + pairVY;
      fly.x += fly.vx + orbitX * driftScale * 0.02;
      fly.y += fly.vy + orbitY * driftScale * 0.02;

      if (
        fly.x < edgeMargin ||
        fly.y < edgeMargin ||
        fly.x > this.width - edgeMargin ||
        fly.y > this.height - edgeMargin
      ) {
        fly.x = cx + orbitX * 80;
        fly.y = cy + orbitY * 80;
        fly.vx = 0;
        fly.vy = 0;
        fly.buddyIndex = null;
        fly.buddyUntil = 0;
      }

      out.push({
        id: `auto-${this.seed.toFixed(2)}-${i}`,
        x: constrain(fly.x, edgeMargin, this.width - edgeMargin),
        y: constrain(fly.y, edgeMargin, this.height - edgeMargin),
        rawX: fly.x,
        rawY: fly.y,
        auto: true,
        recipe: style.recipe,
        controls: style.controls,
      });
    }

    return out;
  }

  _ensureFireflies(reset = false) {
    if (reset) this.fireflies = [];
    if (reset) this.pointerRecipes = [];
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    while (this.fireflies.length < this.pointerCount) {
      const i = this.fireflies.length;
      const seed = this.seed + i * 11.7;
      this.fireflies.push({
        seed,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        tx: cx,
        ty: cy,
        targetAge: 0,
        buddyIndex: null,
        buddyUntil: 0,
      });
    }
    if (this.fireflies.length > this.pointerCount) {
      this.fireflies.length = this.pointerCount;
    }
    if (this.pointerRecipes.length > this.pointerCount) {
      this.pointerRecipes.length = this.pointerCount;
    }
  }


  _styleForPoint(index, timeSec, controls) {
    if (!this.pointerRecipes[index]) {
      const stableNoise = (this._nestedNoise(this.seed + index * 1.31, 0.03, 0.02) + 1) * 0.5;
      const recipeIndex = constrain(floor(stableNoise * this.recipeKeys.length), 0, this.recipeKeys.length - 1);
      this.pointerRecipes[index] = this.recipeKeys[recipeIndex];
    }
    const recipe = this.pointerRecipes[index];
    const t = timeSec + this.seed + index * 0.37;
    const sizeMod = this._nestedNoise(t * 0.23 + 10, 0.09, 0.05);
    const opacityMod = this._nestedNoise(t * 0.19 + 20, 0.07, 0.04);
    const wetMod = this._nestedNoise(t * 0.29 + 30, 0.11, 0.06);
    const wildMod = this._nestedNoise(t * 0.31 + 40, 0.13, 0.08);
    return {
      recipe,
      controls: {
        size: constrain(controls.size * (0.7 + (sizeMod + 1) * 0.45), 0.02, 1.5),
        opacity: constrain(controls.opacity * (0.75 + (opacityMod + 1) * 0.25), 0.01, 1),
        wetness: constrain(controls.wetness + wetMod * 0.28, 0, 1),
        wildness: constrain(controls.wildness + wildMod * 0.35, 0, 1),
      },
    };
  }

  _nestedNoise(t, f1, f2) {
    const a = this._noise2(this.seed + t * f1, 100 + t * f1);
    const b = this._noise2(200 + this.seed + a * 1.7 + t * f2, 300 + a * 1.3 + t * f2);
    return this._noise2(400 + this.seed + b * 2.1 + t * f1, 500 + a * 0.9 + b * 1.2 + t * f2);
  }

  _noise2(x, y) {
    if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise2D === "function") {
      return simplexNoise.noise2D(x, y);
    }
    if (typeof OpenSimplexNoise !== "undefined") {
      if (!window.simplexNoise) window.simplexNoise = new OpenSimplexNoise(1234);
      return window.simplexNoise.noise2D(x, y);
    }
    return noise(x, y) * 2 - 1;
  }
}
