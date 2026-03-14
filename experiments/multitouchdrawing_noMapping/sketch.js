const SURFACE_W = 1920;
const SURFACE_H = 1080;
const MIN_PLANES = 1;
const MAX_PLANES = 1;
const PLANE_COUNT_STORAGE_KEY = "multitouchdrawing:planeCount";

let mapper;
let ink;
let multiTouch;
let planes = [];
let recipeEntries = [];

let brushRecipe = "calligraphy";
let brushSize = 1.0;
let brushWildness = 0.25;
let brushOpacity = 0.85;
let brushMovement = 0.55;
let brushFluidity = 0.45;
let brushChain = 0.25;
let invertOutput = false;
let showDirectPreview = false;
let showBrushDebug = false;
let debugRawPointers = [];
let debugNormalizedPointers = [];
let debugEnginePointers = [];
let debugInputMode = "idle";
let debugPointerStateCount = 0;
let showDirectLayerDot = false;

async function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(60);
  noStroke();
  imageMode(CENTER);

  await loadScript("portal/uiSlim2.js");
  await loadScript("portal/multiTouch.js");
  await loadScript("portal/noMappingMapper.js");
  await loadScript("portal/ink.js");

  multiTouch = await new MultiTouch({ preventDefault: true }).init();
  await multiTouch.start();
  uiUseMultiTouch(multiTouch);

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
  for (let i = 0; i < storedPlaneCount; i++) addPlane(false);
  mapper.loadAll();

  showDirectPreview = false;
  showBrushDebug = false;
  showDirectLayerDot = false;

  ink = await new InkDrawing({
    width: windowWidth,
    height: windowHeight,
    background: null,
    foreground: 255,
    recipe: brushRecipe,
  }).init();

  recipeEntries = ink.getRecipeEntries();
  if (!recipeEntries.find((entry) => entry.key === brushRecipe)) {
    brushRecipe = recipeEntries[0]?.key || "calligraphy";
    uiSetState("multitouchdrawing.recipe", brushRecipe);
  }

  applyInkStyle();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      ink?.resetPointers?.();
      debugRawPointers = [];
      debugNormalizedPointers = [];
      debugEnginePointers = [];
      debugInputMode = "idle";
      debugPointerStateCount = 0;
    }
  });
}

function draw() {
  background(invertOutput ? 255 : 0);

  if (!mapper?.isActive?.()) {
    updateDrawingInput();
  }

  updatePlanesFromInk();
  mapper?.render();
  drawDirectPreview();
  renderBrushDebug();

  uiDrawOnDebugOverlay((overlay) => {
    uiUseGraphics(overlay);
    renderUi();
    uiEndUseGraphics();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  ink?.resize(windowWidth, windowHeight, true);
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
  return `multitouchdrawing_surface_${index + 1}`;
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

function updateDrawingInput() {
  const touches = multiTouch?.getTouches() || [];
  debugRawPointers = touches.map((t) => ({ x: t.x, y: t.y }));
  debugEnginePointers = [];
  debugInputMode = "idle";

  if (touches.length === 3) {
    debugInputMode = "fade-3-touch";
    debugNormalizedPointers = [];
    applyThreeFingerFade(touches);
    ink.updatePointers([]);
    return;
  }

  const pointers = touches.map((t) => ({
    id: `t${t.id}`,
    x: t.x,
    y: t.y,
  }));

  if (!pointers.length && mouseIsPressed) {
    pointers.push({ id: "mouse", x: mouseX, y: mouseY });
    debugRawPointers = [{ x: mouseX, y: mouseY }];
  }

  debugInputMode = pointers.length ? `draw-${pointers.length}` : "idle";
  debugNormalizedPointers = pointers.map((p) => ({ x: p.x, y: p.y }));
  ink.updatePointers(pointers);
  debugEnginePointers = pointers.map((p) => ({ x: p.x, y: p.y }));
  debugPointerStateCount = ink?.pointerState?.size || 0;

  if (showDirectLayerDot) {
    const layer = ink?.getLayer?.();
    const p = pointers[0];
    if (layer && p) {
      layer.push();
      layer.noStroke();
      layer.fill(0, 255, 255, 220);
      layer.circle(p.x, p.y, 28);
      layer.pop();
    }
  }
}

function applyThreeFingerFade(touches) {
  const avgSep =
    (dist2D(touches[0], touches[1]) +
      dist2D(touches[1], touches[2]) +
      dist2D(touches[2], touches[0])) / 3;

  const base = constrain(map(avgSep, 30, 350, 0.01, 0.11), 0.008, 0.14);
  const strength =
    base *
    (0.55 + brushFluidity * 0.8) *
    (0.7 + brushWildness * 0.45) *
    (0.8 + brushMovement * 0.25);
  ink.fade(strength, 0);

  const layer = ink.getLayer();
  if (!layer) return;

  layer.push();
  layer.stroke(0, 90 + 70 * brushOpacity);
  layer.strokeWeight(1);
  const specks = Math.floor(layer.width * layer.height * strength * 0.0009);
  for (let i = 0; i < specks; i++) {
    layer.point(random(layer.width), random(layer.height));
  }
  layer.noStroke();
  layer.fill(0, 24 + 36 * brushWildness);
  const dust = Math.floor(800 * strength * (1 + brushWildness + brushFluidity * 0.4));
  for (let i = 0; i < dust; i++) {
    layer.circle(random(layer.width), random(layer.height), random(1, 3));
  }
  layer.pop();
}

function dist2D(a, b) {
  return dist(a.x, a.y, b.x, b.y);
}

function updatePlanesFromInk() {
  const layer = ink?.getLayer();
  if (!layer) return;

  for (const plane of planes) {
    plane.surface.clear();
    if (invertOutput) {
      const inverted = layer.get();
      inverted.filter(INVERT);
      plane.surface.image(inverted, 0, 0, plane.surface.width, plane.surface.height);
    } else {
      plane.surface.image(layer, 0, 0, plane.surface.width, plane.surface.height);
    }
  }
}

function drawDirectPreview() {
  const layer = ink?.getLayer();
  if (!layer || !showDirectPreview) return;

  push();
  imageMode(CORNER);
  if (showDirectPreview) {
    if (invertOutput) {
      const inverted = layer.get();
      inverted.filter(INVERT);
      image(inverted, 0, 0, width, height);
    } else {
      image(layer, 0, 0, width, height);
    }
  }
  imageMode(CENTER);
  pop();
}

function renderBrushDebug() {
  if (!showBrushDebug) return;
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) textFont(baseMonoFont);
  else if (typeof baseFont !== "undefined" && baseFont) textFont(baseFont);
  push();
  noFill();
  strokeWeight(1.5);
  for (const p of debugRawPointers) {
    stroke(255, 0, 0);
    rectMode(CENTER);
    rect(p.x, p.y, 10, 10);
  }
  for (const p of debugNormalizedPointers) {
    stroke(0, 255, 120);
    circle(p.x + 16, p.y, 12);
  }
  for (const p of debugEnginePointers) {
    stroke(0, 140, 255);
    triangle(p.x - 16, p.y - 7, p.x - 8, p.y + 7, p.x - 24, p.y + 7);
  }
  rectMode(CORNER);
  noStroke();
  fill(0, 180);
  rect(16, height - 112, 260, 92);
  fill(255);
  textSize(16);
  textAlign(LEFT, TOP);
  text(`input: ${debugInputMode}`, 24, height - 104);
  text(`raw: ${debugRawPointers.length}`, 24, height - 80);
  text(`norm: ${debugNormalizedPointers.length}`, 24, height - 58);
  text(`state: ${debugPointerStateCount}`, 140, height - 80);
  fill(debugPointerStateCount > 0 ? color(255, 255, 0) : color(120));
  rect(140, height - 56, 120, 16);
  pop();
  if (!ink?.pointerState) return;

  push();
  noFill();
  strokeWeight(1);
  fill(255, 255, 0);
  noStroke();
  textSize(16);
  textAlign(LEFT, TOP);
  text(`engine pointers: ${ink.pointerState.size || 0}`, 24, height - 36);
  const firstState = Array.from(ink.pointerState.values())[0];
  const firstParticle = firstState?.chains?.[0]?.particles?.[0];
  const fx = Number(firstState?.hx);
  const fy = Number(firstState?.hy);
  const px = Number(firstParticle?.x);
  const py = Number(firstParticle?.y);
  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    noStroke();
    fill(255, 255, 0, 220);
    circle(fx + 64, fy + 64, 48);
  } else if (firstState) {
    noStroke();
    fill(255, 255, 0, 220);
    rectMode(CORNER);
    rect(width - 120, 20, 80, 40);
  }
  if (Number.isFinite(px) && Number.isFinite(py)) {
    noStroke();
    fill(255, 0, 255, 220);
    circle(px + 96, py + 96, 36);
  } else if (firstParticle) {
    noStroke();
    fill(255, 0, 255, 220);
    rectMode(CORNER);
    rect(width - 120, 70, 80, 40);
  }
  for (const state of ink.pointerState.values()) {
    if (!Number.isFinite(state?.hx) || !Number.isFinite(state?.hy)) continue;
    stroke(255, 255, 0, 220);
    noFill();
    circle(state.hx + 32, state.hy, 18);
    noStroke();
    fill(255, 255, 0, 220);
    circle(state.hx + 32, state.hy, 4);

    for (const chain of state.chains || []) {
      const parts = chain?.particles || [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
        if (i > 0) {
          const prev = parts[i - 1];
          if (!Number.isFinite(prev?.x) || !Number.isFinite(prev?.y)) continue;
          stroke(255, 0, 255, 180);
          line(prev.x + 32, prev.y + 20, p.x + 32, p.y + 20);
        }
        noStroke();
        fill(255, 0, 255, 220);
        circle(p.x + 32, p.y + 20, max(3, 6 - i * 0.2));
      }
    }
  }
  pop();
}

function applyInkStyle() {
  if (!ink) return;
  ink.setRecipe(brushRecipe);
  ink.patchControls({
    size: brushSize,
    wildness: brushWildness,
    opacity: brushOpacity,
    movement: brushMovement,
    fluidity: brushFluidity,
    chain: brushChain,
  });
}

function renderUi() {
  if (typeof baseMonoFont !== "undefined" && baseMonoFont) textFont(baseMonoFont);
  else if (typeof baseFont !== "undefined" && baseFont) textFont(baseFont);
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
  uiText("Multitouch Drawing", {
    ...compact,
    height: 24,
    bgColor: "#ececec",
    hAlign: "center",
  });
  uiText("Recipes", {
    ...compact,
    bgColor: "#ececec",
    hAlign: "center",
  });

  renderRecipeColumn(compact);

  brushSize = Number(
    uiSlider("multitouchdrawing.size", "Size", {
      min: 0.2,
      max: 3.0,
      init: brushSize,
      persist: false,
      ...compact,
    }).value
  );
  brushWildness = Number(
    uiSlider("multitouchdrawing.wildness", "Wildness", {
      min: 0,
      max: 1,
      init: brushWildness,
      persist: false,
      ...compact,
    }).value
  );
  brushOpacity = Number(
    uiSlider("multitouchdrawing.opacity", "Opacity", {
      min: 0.05,
      max: 1,
      init: brushOpacity,
      persist: false,
      ...compact,
    }).value
  );
  brushMovement = Number(
    uiSlider("multitouchdrawing.movement", "Movement", {
      min: 0,
      max: 1,
      init: brushMovement,
      persist: false,
      ...compact,
    }).value
  );
  brushFluidity = Number(
    uiSlider("multitouchdrawing.fluidity", "Fluidity", {
      min: 0,
      max: 1,
      init: brushFluidity,
      persist: false,
      ...compact,
    }).value
  );
  brushChain = Number(
    uiSlider("multitouchdrawing.chain", "Chain", {
      min: 0,
      max: 1,
      init: brushChain,
      persist: false,
      ...compact,
    }).value
  );

  invertOutput = !!uiToggle("multitouchdrawing.invert", "Invert Output", {
    ...compact,
    onBgColor: "#d7e7ff",
    offBgColor: "#d0d0d0",
    persist: false,
  }).value;
  showDirectPreview = !!uiToggle("multitouchdrawing.directPreview", "Show Ink Preview", {
    ...compact,
    onBgColor: "#dcefd9",
    offBgColor: "#d0d0d0",
    persist: false,
  }).value;
  showBrushDebug = !!uiToggle("multitouchdrawing.brushDebug", "Show Brush Debug", {
    ...compact,
    onBgColor: "#fff1cc",
    offBgColor: "#d0d0d0",
    persist: false,
  }).value;
  showDirectLayerDot = !!uiToggle("multitouchdrawing.directLayerDot", "Direct Layer Dot", {
    ...compact,
    onBgColor: "#d9f6ff",
    offBgColor: "#d0d0d0",
    persist: false,
  }).value;

  if (uiButton("Clear Drawing", compact).clicked) {
    ink?.clear();
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

  applyInkStyle();

  fill(0);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`recipe: ${recipeLabel(brushRecipe)}`, 270, 24);
  text(`planes: ${planes.length}`, 270, 46);
  text(`touches: ${multiTouch?.getTouchCount?.() || 0}`, 270, 68);
  text(`size ${nf(brushSize, 1, 2)}  wild ${nf(brushWildness, 1, 2)}`, 270, 90);
  text(`opacity ${nf(brushOpacity, 1, 2)}  move ${nf(brushMovement, 1, 2)}`, 270, 112);
  text(`fluid ${nf(brushFluidity, 1, 2)}  chain ${nf(brushChain, 1, 2)}`, 270, 134);
  text(`preview ${showDirectPreview ? "on" : "off"}  debug ${showBrushDebug ? "on" : "off"}`, 270, 156);
  text(`direct dot ${showDirectLayerDot ? "on" : "off"}`, 270, 178);
  text(
    `mapper: ${typeof uiIsDebugOverlayVisible === "function" && uiIsDebugOverlayVisible() ? "adjusting" : "locked"}`,
    270,
    200
  );
}

function renderRecipeColumn(compact) {
  const list = uiGetList();
  if (!list) return;

  const startY = list.curY;
  const buttonH = compact.height ?? 22;
  const gap = compact.margin ?? 3;

  for (let i = 0; i < recipeEntries.length; i++) {
    const entry = recipeEntries[i];
    const active = brushRecipe === entry.key;
    const result = uiButton(entry.label, {
      ...compact,
      x: list.x,
      y: startY + i * (buttonH + gap),
      width: list.width,
      height: buttonH,
      bgColor: active ? "#dcefd9" : "#d0d0d0",
    });
    if (result.clicked && brushRecipe !== entry.key) {
      brushRecipe = entry.key;
      applyInkStyle();
    }
  }

  list.curY = startY + recipeEntries.length * (buttonH + gap) + list.margin;
  list.height = Math.max(list.height, list.curY - list.y);
}

function recipeLabel(key) {
  return recipeEntries.find((entry) => entry.key === key)?.label || key;
}
