/*
 * UI SLIM v2 — immediate-mode widgets for p5.js v2
 * Inspired by uislim (hobye.dk) & IMGUI principles
 *
 * Key points
 * - Immediate rendering: use directly in if-statements
 * - ID-based state for all stateful widgets (no uiFloat needed)
 * - Widgets: button, slider, text (label), promptText (window.prompt), toggle (button-like)
 * - Layout lists (vertical/horizontal) with uiListStart/uiListEnd
 * - CSS-like JSON styling with a base stylesheet you can override
 * - Absolute positioning: any widget outside lists can use {x,y,width[,height]}
 * - Text alignment per widget: hAlign: 'left'|'center'|'right', vAlign: 'top'|'middle'|'bottom'
 *
 * Example
 *   uiUpdateSimple();
 *   if (uiButton('Big', { x:200, y:20, width:300, height:120, fontSize:24 }).clicked) print('big');
 *   uiListStart({ x: 24, y: 24, width: 260, dir: 'vertical' });
 *     uiText('Demo', { bgColor:'#e6f0ff', hAlign:'center' });
 *     if (uiButton('Button').clicked) print('Button');
 *     uiSlider('value', 'Value', { min: 0, max: 1, init: 0.5 });
 *     const name = uiPromptText('name', 'Name').value;
 *     const enabled = uiToggle('enabled', 'Enabled', { onBgColor:'#d7f7de' }).value;
 *   uiListEnd();
 */

let _uiHoveringAny = false;
// -------------------------
// Core IO state
// -------------------------
let uiKeyPressed = false, uiKeyPressedOld = false;
let uiMX=0, uiMY=0, uiMXOld=0, uiMYOld=0;
let uiMP=false, uiMPOld=false;
let uiKey=undefined;
let uiKeyOld=undefined;
let uiSWidth=0, uiSHeight=0;
let uiStack=[];
let uiPointerSource = "mouse";
let uiMultiTouch = null;
let uiActiveTouchId = null;
let uiGraphicsTarget = null;
const _uiSliderDragState = {
  id: null,
};
const UI_CORNER_GESTURE_HOLD_MS = 3000;
const UI_DEBUG_HOLD_MS = 3000;
const UI_DEBUG_HOLD_INSET_PX = 0;
const UI_DEBUG_HOLD_SIZE_PX = 100;
const UI_DEBUG_OVERLAY_STORAGE_KEY = "uiSlim2.debugOverlay.visible";
const _uiShortcutState = (window.__uiShortcutState ??= {
  fullscreenRequested: false,
  overlayToggleRequested: false,
  cornerGestureRequested: false,
  cornerGestureStartMs: 0,
  cornerGestureFired: false,
  cornerGestureCorners: [],
  debugHoldRequested: false,
  debugHoldStartMs: 0,
  debugHoldFired: false,
});

if (!window.__uiSlimShortcutListenerInstalled) {
  window.__uiSlimShortcutListenerInstalled = true;
  window.addEventListener("keydown", (e) => {
    if (!e || e.repeat) return;
    const code = String(e.code || "");
    const alt = !!(e.altKey || (e.getModifierState && e.getModifierState("Alt")));
    if (!alt) return;

    if (code === "KeyF") {
      e.preventDefault();
      _uiShortcutState.fullscreenRequested = true;
      return;
    }
    if (code === "KeyD") {
      e.preventDefault();
      _uiShortcutState.overlayToggleRequested = true;
    }
  }, { capture: true });
}

// -------------------------
// State store (ID-based)
// -------------------------
const uiStore = new Map();
function uiGet(id, init){ if(!uiStore.has(id)) uiStore.set(id, init); return uiStore.get(id); }
function uiSet(id, v){ uiStore.set(id, v); }
function uiStorageKey(id) { return `uiSlim2:${String(id)}`; }
function uiShouldPersist(style = {}) { return style?.persist !== false; }
function uiGetPersisted(id, fallback) {
  try {
    const raw = localStorage.getItem(uiStorageKey(id));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function uiSetPersisted(id, value, style = {}) {
  if (!uiShouldPersist(style)) return;
  try {
    localStorage.setItem(uiStorageKey(id), JSON.stringify(value));
  } catch {}
}
function uiGetState(id, init, style = {}) {
  if (uiStore.has(id)) return uiStore.get(id);
  const value = uiShouldPersist(style) ? uiGetPersisted(id, init) : init;
  uiStore.set(id, value);
  return value;
}
function uiSetState(id, value, style = {}) {
  uiSet(id, value);
  uiSetPersisted(id, value, style);
}

// -------------------------
// Style system
// -------------------------
let uiBaseStyle = {
  common: {
    font: undefined,      // p5.Font or undefined
    fontSize: 15,
    height: 32,
    textColor: '#000000',
    padding: 8,
    margin: 8,
    rounding: 6,
    stroke: { weight: 0, color: '#000000', alpha: 255 },
    bgColor: 'silver',
    hover:   { bgColor: '#e8e8e8', cursor: 'pointer' },
    pressed: { bgColor: '#d0d0d0', cursor: 'pointer' },
    hAlign: 'left',   // 'left' | 'center' | 'right'
    vAlign: 'middle', // 'top' | 'middle' | 'bottom'
  },
  button: { },
  slider: { trackColor: '#f2f2f2', fillColor: '#7aa7ff', min: 0, max: 1 },
  toggle: { onBgColor: '#d7f7de', offBgColor: 'gray' },
  text: { },
  promptText: { },
  list: { dir: 'vertical', width: 220, x: 0, y: 0 }
};
function uiSetBaseStyle(newBase={}){ uiBaseStyle = uiMergeDeep({}, uiBaseStyle, newBase); }
function uiIsPlainObject(value){
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function uiMergeDeep(target, ...sources){
  for(const src of sources){ if(!src) continue; for(const k of Object.keys(src)){
    const v = src[k];
    if(uiIsPlainObject(v)) target[k] = uiMergeDeep(uiIsPlainObject(target[k]) ? target[k] : {}, v);
    else target[k] = v;
  }} return target;
}
function uiUseGraphics(target = null) {
  uiGraphicsTarget = target || null;
  return uiGraphicsTarget;
}

function uiEndUseGraphics() {
  uiGraphicsTarget = null;
}

function uiGetGraphicsTarget() {
  return uiGraphicsTarget;
}

function uiApplyStyle(style, target = null){
  const g = target || uiGraphicsTarget;
  if (g) {
    if(style.font) { g.textFont(style.font); } else { g.textFont(baseFont); }
    if(style.fontSize!==undefined) g.textSize(style.fontSize);
    if(style.textColor) g.fill(style.textColor);
    if(style.stroke && style.stroke.weight>0){
      g.stroke(style.stroke.color||0, style.stroke.alpha??255);
      g.strokeWeight(style.stroke.weight);
    } else g.noStroke();
    return;
  }

  if(style.font) {textFont(style.font)} else { textFont(baseFont)};
  if(style.fontSize!==undefined) textSize(style.fontSize);
  if(style.textColor) fill(style.textColor);
  if(style.stroke && style.stroke.weight>0){
    stroke(style.stroke.color||0, style.stroke.alpha??255);
    strokeWeight(style.stroke.weight);
  } else noStroke();
}

// -------------------------
// Frame update & input
// -------------------------
function uiShortcutDebugLog(...args) {
  if (typeof window !== "undefined" && window.uiSlimDebugShortcuts === false) return;
  console.log("[uiSlim shortcuts]", ...args);
}

function uiUpdateSimple() {
 cursor('default');

  const pointer = uiResolvePointerInput();
  uiUpdate(pointer.x, pointer.y, pointer.pressed, key, width, height, keyIsPressed);
 
 
}

function uiUseMultiTouch(instance = null) {
  uiMultiTouch = instance || null;
  if (!uiMultiTouch) {
    uiActiveTouchId = null;
    uiPointerSource = "mouse";
  }
  return uiMultiTouch;
}

function uiClearMultiTouch() {
  uiUseMultiTouch(null);
}

function uiGetPointerSource() {
  return uiPointerSource;
}

function uiResolvePointerInput() {
  const mt = uiResolveMultiTouchInstance();
  const fallback = {
    x: mouseX,
    y: mouseY,
    pressed: mouseIsPressed,
    source: "mouse",
  };

  if (!mt || typeof mt.getTouchesRaw !== "function") {
    uiResetCornerGesture();
    uiUpdateDebugHoldGesture(fallback.x, fallback.y, fallback.pressed, fallback.source);
    uiPointerSource = fallback.source;
    return fallback;
  }

  const touches = mt.getTouchesRaw();
  uiUpdateCornerGesture(touches);
  if (!Array.isArray(touches) || touches.length === 0) {
    uiActiveTouchId = null;
    uiUpdateDebugHoldGesture(fallback.x, fallback.y, fallback.pressed, fallback.source);
    uiPointerSource = fallback.source;
    return fallback;
  }

  let active = null;
  if (uiActiveTouchId != null) {
    active = touches.find((t) => Number(t?.id) === Number(uiActiveTouchId)) || null;
  }
  if (!active) {
    active = touches[0] || null;
    uiActiveTouchId = active ? Number(active.id) : null;
  }

  if (!active) {
    uiUpdateDebugHoldGesture(fallback.x, fallback.y, fallback.pressed, fallback.source);
    uiPointerSource = fallback.source;
    return fallback;
  }

  uiPointerSource = "touch";
  const pointer = {
    x: Number(active.x ?? fallback.x),
    y: Number(active.y ?? fallback.y),
    pressed: true,
    source: "touch",
    touchId: uiActiveTouchId,
    touchCount: touches.length,
  };
  uiUpdateDebugHoldGesture(pointer.x, pointer.y, pointer.pressed, pointer.source);
  return pointer;
}

function uiResolveMultiTouchInstance() {
  if (uiMultiTouch) return uiMultiTouch;
  if (typeof multiTouch !== "undefined" && multiTouch) return multiTouch;
  if (typeof window !== "undefined" && window.multiTouch) return window.multiTouch;
  return null;
}

function uiUpdateCornerGesture(touches) {
  const list = Array.isArray(touches) ? touches : [];
  const w = Number(width) > 0 ? Number(width) : uiSWidth;
  const h = Number(height) > 0 ? Number(height) : uiSHeight;
  if (list.length < 2 || w <= 0 || h <= 0) {
    uiResetCornerGesture();
    return;
  }

  const matched = [];
  const usedCorners = new Set();
  for (const touch of list) {
    const corner = uiTouchCorner(touch.x, touch.y, w, h);
    if (!corner || usedCorners.has(corner)) continue;
    usedCorners.add(corner);
    matched.push({ id: Number(touch.id), corner });
    if (matched.length >= 2) break;
  }

  if (matched.length < 2) {
    uiResetCornerGesture();
    return;
  }

  const cornerKey = matched
    .map((m) => m.corner)
    .sort()
    .join("|");
  const now = (typeof millis === "function") ? millis() : Date.now();
  const currentKey = (_uiShortcutState.cornerGestureCorners || []).slice().sort().join("|");

  if (cornerKey !== currentKey) {
    _uiShortcutState.cornerGestureStartMs = now;
    _uiShortcutState.cornerGestureCorners = matched.map((m) => m.corner);
    _uiShortcutState.cornerGestureFired = false;
  }

  if (
    !_uiShortcutState.cornerGestureFired &&
    now - _uiShortcutState.cornerGestureStartMs >= UI_CORNER_GESTURE_HOLD_MS
  ) {
    _uiShortcutState.cornerGestureRequested = true;
    _uiShortcutState.cornerGestureFired = true;
    uiShortcutDebugLog("corner gesture fullscreen", { corners: _uiShortcutState.cornerGestureCorners });
  }
}

function uiResetCornerGesture() {
  _uiShortcutState.cornerGestureStartMs = 0;
  _uiShortcutState.cornerGestureCorners = [];
  _uiShortcutState.cornerGestureFired = false;
}

function uiResetDebugHoldGesture() {
  _uiShortcutState.debugHoldRequested = false;
  _uiShortcutState.debugHoldStartMs = 0;
  _uiShortcutState.debugHoldFired = false;
}

function uiUpdateDebugHoldGesture(x, y, pressed, source = "mouse") {
  const w = Number(width) > 0 ? Number(width) : uiSWidth;
  const h = Number(height) > 0 ? Number(height) : uiSHeight;
  if (!pressed || w <= 0 || h <= 0 || !uiInDebugHoldZone(x, y, w, h)) {
    uiResetDebugHoldGesture();
    return;
  }

  const now = (typeof millis === "function") ? millis() : Date.now();
  if (!_uiShortcutState.debugHoldStartMs) {
    _uiShortcutState.debugHoldStartMs = now;
    _uiShortcutState.debugHoldFired = false;
  }

  if (
    !_uiShortcutState.debugHoldFired &&
    now - _uiShortcutState.debugHoldStartMs >= UI_DEBUG_HOLD_MS
  ) {
    _uiShortcutState.debugHoldRequested = true;
    _uiShortcutState.debugHoldFired = true;
    uiShortcutDebugLog("bottom-left hold overlay", { source });
  }
}

function uiInDebugHoldZone(x, y, w, h) {
  const size = UI_DEBUG_HOLD_SIZE_PX;
  const inset = UI_DEBUG_HOLD_INSET_PX;
  const left = inset;
  const right = inset + size;
  const top = h - inset - size;
  const bottom = h - inset;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function uiTouchCorner(x, y, w, h) {
  const hitSize = 100;
  const left = x >= 0 && x <= hitSize;
  const right = x >= w - hitSize && x <= w;
  const top = y >= 0 && y <= hitSize;
  const bottom = y >= h - hitSize && y <= h;

  if (left && top) return "top-left";
  if (right && top) return "top-right";
  if (left && bottom) return "bottom-left";
  if (right && bottom) return "bottom-right";
  return null;
}

function uiSetDebugOverlayVisible(nextVisible) {
  const visible = !!nextVisible;
  _uiInfo.visible = visible;
  try {
    localStorage.setItem(UI_DEBUG_OVERLAY_STORAGE_KEY, visible ? "true" : "false");
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("uiSlim:debugOverlayChange", {
      detail: { visible }
    }));
  } catch {}
  return visible;
}

function uiUpdate(_mx,_my,_mp,_key,_w,_h,_keyPressed){
  uiKeyOld = uiKey;
  uiSWidth=_w; uiSHeight=_h; uiKey=_key;
  uiMXOld=uiMX; uiMYOld=uiMY; uiMPOld=uiMP;
  uiMX=_mx; uiMY=_my; uiMP=_mp;
  uiKeyPressedOld = uiKeyPressed;
  uiKeyPressed = _keyPressed;
  if(uiStack.length===0) uiListStart(); // ensure a root list for flow layout

  // Handle uiSlim global shortcuts from shared keydown flags.
  if (_uiShortcutState.fullscreenRequested) {
    _uiShortcutState.fullscreenRequested = false;
    uiShortcutDebugLog("trigger fullscreen", { key: uiKey });
    fullScreenToggle();
  }
  if (_uiShortcutState.overlayToggleRequested) {
    _uiShortcutState.overlayToggleRequested = false;
    uiSetDebugOverlayVisible(!_uiInfo.visible);
    uiShortcutDebugLog("toggle overlay", { key: uiKey, visible: _uiInfo.visible });
  }
  if (_uiShortcutState.cornerGestureRequested) {
    _uiShortcutState.cornerGestureRequested = false;
    fullScreenToggle();
  }
  if (_uiShortcutState.debugHoldRequested) {
    _uiShortcutState.debugHoldRequested = false;
    uiSetDebugOverlayVisible(!_uiInfo.visible);
  }
}


function uiHit(x, y, w, h) {
  const hoverOld = uiMXOld > x && uiMYOld > y && uiMXOld < x + w && uiMYOld < y + h;
  const hover    = uiMX    > x && uiMY    > y && uiMX    < x + w && uiMY    < y + h;
  const pressed     = hover && uiMP;
  const pressedOld  = hoverOld && uiMPOld;
  const pressedDown = hover && uiMP && !uiMPOld;
  const dragging    = hover && pressed && pressedOld && (uiMX !== uiMXOld || uiMY !== uiMYOld);
  const clicked     = !dragging && hover && !uiMP && uiMPOld;
  const pressedUp   = (!hover && hoverOld) || (hover && !pressed && uiMPOld);

  // If ANY widget is hovered this frame, we set pointer now.
  if (hover) cursor('pointer');

  return { hover, hoverOld, pressed, pressedOld, pressedDown, pressedUp, dragging, clicked, mX: uiMX - x, mY: uiMY - y };
}



// -------------------------
// Layout lists
// -------------------------
function uiGetList(){ return uiStack[uiStack.length-1]; }
function uiListStart(opt={}){
  const base = uiMergeDeep({}, uiBaseStyle.list, opt);
  const parent = (uiStack.length>0) ? uiGetList() : null;
  const margin = (opt.margin!==undefined) ? opt.margin : uiBaseStyle.common.margin;
  let x,y,width,dir;
  if(parent){
    dir = base.dir;
    if(parent.dir==='vertical'){
      x = (opt.x!==undefined) ? parent.x + opt.x : parent.x;
      y = (opt.y!==undefined) ? parent.y + opt.y : parent.curY;
      width = (opt.width!==undefined) ? opt.width : parent.width;
    }
    else {
      x = (opt.x!==undefined) ? parent.x + opt.x : parent.curX;
      y = (opt.y!==undefined) ? parent.y + opt.y : parent.y;
      width = (opt.width!==undefined) ? opt.width : base.width;
    }
  } else {
    x = (opt.x!==undefined)?opt.x:base.x;
    y = (opt.y!==undefined)?opt.y:base.y;
    width = (opt.width!==undefined)?opt.width:base.width;
    dir = base.dir;
  }
  const list = { x, y, width, dir, margin, curX:x, curY:y, height:0 };
  uiStack.push(list);
  return list;
}
function uiListEnd(){ uiStack.pop(); }
function uiPlace(w,h){
  const c = uiGetList();
  const x = (c.dir==='vertical') ? c.x : c.curX;
  const y = (c.dir==='vertical') ? c.curY : c.y;
  const width = (c.dir==='vertical') ? c.width : w;
  if(c.dir==='vertical'){ c.curY += h + c.margin; c.height = (c.curY - c.y); }
  else { c.curX += w + c.margin; c.height = max(c.height, h); }
  return { x, y, width, height:h };
}

// -------------------------
// Text alignment helper
// -------------------------
function uiTextAlignFromStyle(s){
  let hx = LEFT; if(s.hAlign==='center') hx=CENTER; else if(s.hAlign==='right') hx=RIGHT;
  let vy = CENTER; if(s.vAlign==='top') vy=TOP; else if(s.vAlign==='bottom') vy=BOTTOM; else vy=CENTER;
  return { hx, vy };
}
function uiDrawLabel(textStr, box, s){
 const g = uiGraphicsTarget;
 if (g) {
  g.push();
  uiApplyStyle(s, g);
  g.fill(s.textColor||0);
  const pad = (s.padding!==undefined)?s.padding:8;
  const {hx,vy} = uiTextAlignFromStyle(s);
  g.textAlign(hx, vy);
  let tx = box.x + pad, ty;
  if(hx===CENTER) tx = box.x + box.width/2;
  else if(hx===RIGHT) tx = box.x + box.width - pad;
  if(vy===TOP) ty = box.y + pad;
  else if(vy===CENTER) ty = box.y + box.height/2;
  else ty = box.y + box.height - pad;
  g.text(textStr, tx, ty);
  g.pop();
  return;
 }

 push();
  uiApplyStyle(s);
  fill(s.textColor||0);
  const pad = (s.padding!==undefined)?s.padding:8;
  const {hx,vy} = uiTextAlignFromStyle(s);
  textAlign(hx, vy);
  let tx = box.x + pad, ty;
  if(hx===CENTER) tx = box.x + box.width/2;
  else if(hx===RIGHT) tx = box.x + box.width - pad;
  if(vy===TOP) ty = box.y + pad;
  else if(vy===CENTER) ty = box.y + box.height/2;
  else ty = box.y + box.height - pad;
 
  text(textStr, tx, ty);
  pop();
}

// -------------------------
// Widgets
// -------------------------
function uiText(txt, style={}){
  const g = uiGraphicsTarget;
  if (g) {
    g.push();
  } else {
    push();
  }
  const overlay2d = g ? false : _uiOverlayStart();
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.text, style);
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  if(s.bgColor){
    if (g) { g.fill(s.bgColor); g.noStroke(); g.rect(box.x, box.y, box.width, box.height, s.rounding); }
    else { fill(s.bgColor); noStroke(); rect(box.x, box.y, box.width, box.height, s.rounding); }
  }
  uiDrawLabel(txt, box, s);
  _uiOverlayEnd(overlay2d);
  if (g) g.pop(); else pop();
  return { x:box.x, y:box.y, width:box.width, height:box.height };
}

function uiButton(label, style={}){
  const g = uiGraphicsTarget;
  if (g) g.push(); else push();
  const overlay2d = g ? false : _uiOverlayStart();
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.button, style);
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined && s.height!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:s.height }
    : (s.x!==undefined && s.y!==undefined && s.width!==undefined)
      ? { x:s.x, y:s.y, width:s.width, height:h }
      : uiPlace(s.width||uiGetList().width, h);
  let cur = uiMergeDeep({}, s);
  const hit = uiHit(box.x, box.y, box.width, box.height);
  if(hit.pressed) cur = uiMergeDeep(cur, s.pressed); else if(hit.hover) cur = uiMergeDeep(cur, s.hover);
  if (g) {
    if(cur.bgColor){ g.fill(cur.bgColor); } else g.noFill();
    if(cur.stroke && cur.stroke.weight>0){ g.stroke(cur.stroke.color||0, cur.stroke.alpha??255); g.strokeWeight(cur.stroke.weight); } else g.noStroke();
    g.rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  } else {
    if(cur.bgColor){ fill(cur.bgColor); } else noFill();
    if(cur.stroke && cur.stroke.weight>0){ stroke(cur.stroke.color||0, cur.stroke.alpha??255); strokeWeight(cur.stroke.weight); } else noStroke();
    rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  }
  uiDrawLabel(label, box, cur);
  _uiOverlayEnd(overlay2d);
  if (g) g.pop(); else pop();
  return {
    clicked: hit.clicked,
    pressedDown: hit.pressedDown,
    pressedUp: hit.pressedUp,
    hover: hit.hover,
    pressed: hit.pressed,
    x:box.x,
    y:box.y,
    width:box.width,
    height:box.height
  };
}

function uiPromptText(id, label, style={}){
  const currentValue = uiGetState(id, '', style);
  const shown = currentValue!=='' ? (label+': '+currentValue) : label;
  const res = uiButton(shown, uiMergeDeep({}, uiBaseStyle.promptText, style));
  let changed=false, value=currentValue;
  if(res.clicked){ const nv = window.prompt(label, currentValue??''); if(nv!==null){ value=nv; changed=true; uiSetState(id, value, style); } }
  return { ...res, changed, value };
}

function uiSlider(id, label, opts={}, style={}){
  const sliderOptionKeys = new Set(["min", "max", "init"]);
  const optsStyle = {};
  for (const key of Object.keys(opts || {})) {
    if (!sliderOptionKeys.has(key)) optsStyle[key] = opts[key];
  }
  const g = uiGraphicsTarget;
  if (g) g.push(); else push();
  const overlay2d = g ? false : _uiOverlayStart();
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.slider, optsStyle, style);
  const min = (opts.min!==undefined)?opts.min:s.min;
  const max = (opts.max!==undefined)?opts.max:s.max;
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  let val = uiGetState(id, (opts.init!==undefined?opts.init:min), s);
  const hit = uiHit(box.x, box.y, box.width, box.height);
  const safeRange = (max-min) || 1;
  const vertical = !!s.vertical;
  const isActive = _uiSliderDragState.id === id;
  let changed = false;

  if (hit.pressedDown) {
    _uiSliderDragState.id = id;
  }

  if (_uiSliderDragState.id === id && uiMP) {
    const currentT = constrain((val - min) / safeRange, 0, 1);
    const deltaT = vertical
      ? ((uiMYOld - uiMY) / Math.max(1, box.height))
      : ((uiMX - uiMXOld) / Math.max(1, box.width));
    const nextT = constrain(currentT + deltaT, 0, 1);
    const nextVal = lerp(min, max, nextT);
    if (Math.abs(nextVal - val) > 1e-9) {
      val = nextVal;
      uiSetState(id, val, s);
      changed = true;
    }
  }

  if (isActive && !uiMP) {
    _uiSliderDragState.id = null;
  }
  // track
  if (g) {
    g.noStroke(); g.fill(s.trackColor); g.rect(box.x, box.y, box.width, box.height, s.rounding);
  } else {
    noStroke(); fill(s.trackColor); rect(box.x, box.y, box.width, box.height, s.rounding);
  }
  // fill
  const tnow = constrain((val-min)/safeRange, 0, 1);
  if (g) {
    g.fill(s.fillColor);
    if (vertical) {
      const fillH = box.height * tnow;
      g.rect(box.x, box.y + box.height - fillH, box.width, fillH, s.rounding);
    } else {
      g.rect(box.x, box.y, box.width*tnow, box.height, s.rounding, 0, 0, s.rounding);
    }
  } else {
    fill(s.fillColor);
    if (vertical) {
      const fillH = box.height * tnow;
      rect(box.x, box.y + box.height - fillH, box.width, fillH, s.rounding);
    } else {
      rect(box.x, box.y, box.width*tnow, box.height, s.rounding, 0, 0, s.rounding);
    }
  }
  // label
  if (!s.hideText) {
    const labelText = s.hideValue ? String(label || "") : label+" ("+nf(val,1,2)+")";
    if (labelText) uiDrawLabel(labelText, box, s);
  }
  _uiOverlayEnd(overlay2d);
  if (g) g.pop(); else pop();
  return { value: val, changed, x:box.x, y:box.y, width:box.width, height:box.height };
}

function uiToggle(id, label, style={}){
  const g = uiGraphicsTarget;
  if (g) g.push(); else push();
  const overlay2d = g ? false : _uiOverlayStart();
  // Full-width button-like toggle with text and changing background
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.button, uiBaseStyle.toggle, style);
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  let v = !!uiGetState(id, false, style);
  const hit = uiHit(box.x, box.y, box.width, box.height);
  if(hit.clicked){ v = !v; uiSetState(id, v, style); }
  let cur = uiMergeDeep({}, s, { bgColor: v ? s.onBgColor : s.offBgColor });
  if(!v && hit.hover) cur = uiMergeDeep(cur, s.hover);
  if(!v && hit.pressed) cur = uiMergeDeep(cur, s.pressed);
  if (g) {
    if(cur.bgColor){ g.fill(cur.bgColor); } else g.noFill();
    if(cur.stroke && cur.stroke.weight>0){ g.stroke(cur.stroke.color||0, cur.stroke.alpha??255); g.strokeWeight(cur.stroke.weight); } else g.noStroke();
    g.rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  } else {
    if(cur.bgColor){ fill(cur.bgColor); } else noFill();
    if(cur.stroke && cur.stroke.weight>0){ stroke(cur.stroke.color||0, cur.stroke.alpha??255); strokeWeight(cur.stroke.weight); } else noStroke();
    rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  }
  const showStateText = !!s.showStateText;
  uiDrawLabel(showStateText ? (v ? label+' : ON' : label+' : OFF') : label, box, cur);
  _uiOverlayEnd(overlay2d);
  if (g) g.pop(); else pop();
  return { value: v, toggled: hit.clicked, x:box.x, y:box.y, width:box.width, height:box.height };
}

// -------------------------
// Decorative rect utility
// -------------------------
function uiRect(x,y,w,h, style={}){
  const g = uiGraphicsTarget;
  if (g) g.push(); else push();
  const overlay2d = g ? false : _uiOverlayStart();
  const s = uiMergeDeep({}, uiBaseStyle.common, style);
  if (g) {
    if(s.bgColor){ g.fill(s.bgColor); } else g.noFill();
    if(s.stroke && s.stroke.weight>0){ g.stroke(s.stroke.color||0, s.stroke.alpha??255); g.strokeWeight(s.stroke.weight); } else g.noStroke();
    g.rect(x,y,w,h, s.rounding);
  } else {
    if(s.bgColor){ fill(s.bgColor); } else noFill();
    if(s.stroke && s.stroke.weight>0){ stroke(s.stroke.color||0, s.stroke.alpha??255); strokeWeight(s.stroke.weight); } else noStroke();
    rect(x,y,w,h, s.rounding);
  }
  _uiOverlayEnd(overlay2d);
  if (g) g.pop(); else pop();
}

// -------------------------
// Demo (optional)
// -------------------------
function uiDemoPanel(){
  if(uiButton('Button ABS', { x:200, y:20, width:300, height:80, fontSize:20 }).clicked){ print('ABS'); }
  uiListStart({ x: 24, y: 124, width: 260, dir: 'vertical' });
    uiText('DEMO', { bgColor:'#eef3ff', hAlign:'center' });
    if(uiButton('Button').clicked) print('Button');
    uiSlider('value', 'Value', { min:0, max:1, init:0.5 }, { hAlign:'right' });
    const name = uiPromptText('name', 'Name').value;
    const enabled = uiToggle('enabled', 'Enabled').value;
  uiListEnd();
}
function uiUpdateCursor(){
  let isHovering = false;

  // determine hover from most recent uiHit() info
  // this assumes uiHit() is called each frame for all elements;
  // so we can track the last hover state globally
  if (window._uiHovering) isHovering = true;

  if (isHovering) cursor('pointer');
  else cursor('default');

  // reset hover tracker for next frame
  window._uiHovering = false;
}

// =========================
// Debug & Info Overlay
// =========================
let _uiInfo = {
  visible: false,
  measuring: false,
  measureEnabled: false,
  gridEnabled: false,
  sx: 0, sy: 0
};
let debugOverlay = null;
const _uiDebugOverlayDrawFns = [];
const _uiDebugList = [];
let _uiRgbUnderCache = [0, 0, 0, 0];
let _uiRgbSampleLastMs = 0;

try {
  _uiInfo.visible = localStorage.getItem(UI_DEBUG_OVERLAY_STORAGE_KEY) === "true";
} catch {}

function _uiSampleRgbUnderMouse(sampleEveryMs = 80) {
  const now = (typeof millis === "function") ? millis() : Date.now();
  if (now - _uiRgbSampleLastMs < sampleEveryMs) return _uiRgbUnderCache;

  try {
    const gx = constrain(floor(uiMX), 0, uiSWidth - 1);
    const gy = constrain(floor(uiMY), 0, uiSHeight - 1);
    const px = get(gx, gy);
    if (Array.isArray(px) && px.length >= 3) {
      _uiRgbUnderCache = [px[0] | 0, px[1] | 0, px[2] | 0, px[3] ?? 255];
    }
  } catch {}

  _uiRgbSampleLastMs = now;
  return _uiRgbUnderCache;
}

/**
 * Add a debug line to the overlay console (max 10).
 * Example: uiDebug(`value=${nf(v,1,2)}`);
 */
function uiDebug(msg) {
  const t = (typeof window !== 'undefined' && typeof performance !== 'undefined')
    ? (performance.now()/1000).toFixed(2) : '';
  _uiDebugList.push((t ? `[${t}s] ` : '') + String(msg));
  if (_uiDebugList.length > 10) _uiDebugList.shift();
}

/**
 * Draw the coordinate grid, HUD, measurement, and debug console.
 * - Toggle visibility: Alt/Option + D
 * - Drag to measure: press and drag to draw dx, dy, and distance.
 * - Shows mouse (x,y), fps, heap (if available), and RGB under cursor.
 * Call this once per frame (typically at the end of draw()).
 */
function uiShowInfo(opt = {}) {
  if (!_uiInfo.visible) return { visible:false };
  const target = _uiEnsureDebugOverlay();
  _uiClearDebugOverlay(target);

  // --- Optional (default ON): sample color under mouse with throttling ---
  const sampleColor = (opt.sampleColor !== false);
  const sampleEveryMs = Number(opt.sampleEveryMs) || 80;
  const rgbUnder = sampleColor
    ? _uiSampleRgbUnderMouse(sampleEveryMs)
    : _uiRgbUnderCache;

  // --- 2) Draw semi-transparent grid ---
  if (_uiInfo.gridEnabled) _uiDrawGrid(target, opt);

  // --- 3) Measurement: press & drag to show line and distances ---
  if (opt.measure !== false && _uiInfo.measureEnabled) _uiHandleMeasure(target);
  else _uiInfo.measuring = false;

  // --- 4) HUD: compact top bar (pass rgbUnder) ---
  _uiDrawHUD(target, rgbUnder);

  // --- 5) Debug console overlay ---
  _uiDrawDebugConsole(target);
  _uiRunDebugOverlayDrawFns(target);
  _uiCompositeDebugOverlay(target);

  return {
    visible: true,
    measuring: _uiInfo.measuring,
    measureEnabled: _uiInfo.measureEnabled,
    gridEnabled: _uiInfo.gridEnabled,
    start: { x:_uiInfo.sx, y:_uiInfo.sy },
    end: { x: uiMX, y: uiMY },
    dx: uiMX - _uiInfo.sx,
    dy: uiMY - _uiInfo.sy,
    dist: dist(_uiInfo.sx, _uiInfo.sy, uiMX, uiMY)
  };
}

function uiIsDebugOverlayVisible() {
  return !!_uiInfo.visible;
}


// -------------------------
// Internals
// -------------------------
function _uiIsWebGLContext() {
  return (
    (typeof WebGLRenderingContext !== "undefined" &&
      drawingContext instanceof WebGLRenderingContext) ||
    (typeof WebGL2RenderingContext !== "undefined" &&
      drawingContext instanceof WebGL2RenderingContext)
  );
}



function _uiOverlaySpace() {
  if (!_uiIsWebGLContext()) return;
  resetMatrix();
  translate(-width / 2, -height / 2);
}

function _uiOverlayStart() {
  if (!_uiIsWebGLContext()) return false;
  _uiOverlaySpace();
  if (drawingContext?.disable && drawingContext?.DEPTH_TEST !== undefined) {
    drawingContext.disable(drawingContext.DEPTH_TEST);
  }
  return true;
}

function _uiOverlayEnd(active) {
  if (!active) return;
  if (drawingContext?.enable && drawingContext?.DEPTH_TEST !== undefined) {
    drawingContext.enable(drawingContext.DEPTH_TEST);
  }
}

function _uiEnsureDebugOverlay() {
  const w = Math.max(1, Number(uiSWidth) || Number(width) || 1);
  const h = Math.max(1, Number(uiSHeight) || Number(height) || 1);
  if (!debugOverlay || debugOverlay.width !== w || debugOverlay.height !== h) {
    debugOverlay = createGraphics(w, h);
    if (typeof debugOverlay.pixelDensity === "function") debugOverlay.pixelDensity(1);
    if (typeof window !== "undefined") window.debugOverlay = debugOverlay;
  }
  return debugOverlay;
}

function _uiClearDebugOverlay(target) {
  if (!target) return;
  target.clear();
  if (typeof target.resetMatrix === "function") target.resetMatrix();
}

function _uiCompositeDebugOverlay(target) {
  if (!target) return;
  push();
  const overlay2d = _uiOverlayStart();
  imageMode(CORNER);
  image(target, 0, 0, uiSWidth, uiSHeight);
  _uiOverlayEnd(overlay2d);
  pop();
}

function uiDrawOnDebugOverlay(fn) {
  if (typeof fn === "function") _uiDebugOverlayDrawFns.push(fn);
}

function _uiRunDebugOverlayDrawFns(target) {
  if (!_uiDebugOverlayDrawFns.length) return;
  while (_uiDebugOverlayDrawFns.length) {
    const fn = _uiDebugOverlayDrawFns.shift();
    try {
      fn(target);
    } catch (err) {
      console.warn("uiDrawOnDebugOverlay callback failed:", err);
    }
  }
}

function _uiDrawGrid(target, opt) {
   const s50 = uiMergeDeep({}, {
    color: { r: 120, g: 120, b: 120, a: 80 },   // lighter gray, very transparent
    weight: 1
  }, opt.grid50);

  const s100 = uiMergeDeep({}, {
    color: { r: 120, g: 120, b: 120, a: 120 },   // darker gray
    weight: 1
  }, opt.grid100);

  target.push();
  target.noFill();

  // 50px lines
  target.stroke(s50.color.r, s50.color.g, s50.color.b, s50.color.a);
  target.strokeWeight(s50.weight);
  for (let x = 0; x <= uiSWidth; x += 50) target.line(x, 0, x, uiSHeight);
  for (let y = 0; y <= uiSHeight; y += 50) target.line(0, y, uiSWidth, y);

  // 100px lines
  target.stroke(s100.color.r, s100.color.g, s100.color.b, s100.color.a);
  target.strokeWeight(s100.weight);
  for (let x = 0; x <= uiSWidth; x += 100) target.line(x, 0, x, uiSHeight);
  for (let y = 0; y <= uiSHeight; y += 100) target.line(0, y, uiSWidth, y);

  target.pop();
}


function _uiHandleMeasure(target) {
  const mp = uiMP;
  if (mp && !_uiInfo.measuring) { // press -> start
    _uiInfo.measuring = true;
    _uiInfo.sx = uiMX;
    _uiInfo.sy = uiMY;
  } else if (!mp && _uiInfo.measuring) {
    // release -> stop (keeps last start only while pressed)
    _uiInfo.measuring = false;
  }

  if (!_uiInfo.measuring && !uiMP) return;

  const x0 = _uiInfo.sx, y0 = _uiInfo.sy;
  const x1 = uiMX,        y1 = uiMY;
  const dx = x1 - x0,     dy = y1 - y0;
  const dd = sqrt(dx*dx + dy*dy);

  target.push();
  // main line
  target.stroke(120, 120, 120, 255); target.strokeWeight(2); target.line(x0, y0, x1, y1);
  target.stroke(255, 255, 255, 160); target.strokeWeight(1); target.line(x0, y0, x1, y1);

  // projections
  target.stroke(120, 120, 120, 255); target.strokeWeight(1);
  target.line(x0, y0, x1, y0); // horizontal projection
  target.line(x1, y0, x1, y1); // vertical projection
  target.noFill();
 // ellipse(x0, y0,dd*2,dd*2);
  // little endpoints
  target.noStroke(); target.fill(0, 160); target.circle(x0, y0, 6); target.circle(x1, y1, 6);
  target.fill(200); target.circle(x0, y0, 3); target.circle(x1, y1, 3);

  // labels
  target.textAlign(CENTER, BOTTOM);
  target.textSize(12); target.noStroke();
  _uiTextWithChip(target, `${Math.round(dx)} px`, x0 + dx/2, y0 - 6);
  target.textAlign(LEFT, CENTER);
  _uiTextWithChip(target, `${Math.round(dy)} px`, x1 + 6, y0 + dy/2);

  target.textAlign(CENTER, TOP);
  _uiTextWithChip(target, `${Math.round(dd)} px`, (x0+x1)/2, (y0+y1)/2);

  target.pop();
}
function _uiDrawHUD(target, rgbUnder = [0,0,0,0]) {
  const padX = 8;
  const barH = 26;

  // helpers: left-pad with spaces (stable width, no leading zeros)
  const pad = (v, w) => String(v).padStart(w, ' ');

  // readings
  const fpsNum = (typeof frameRate === 'function') ? Math.round(frameRate()) : NaN;
  const fpsStr = isNaN(fpsNum) ? '  —' : pad(fpsNum, 3); // 3-char field, space-padded

  const mem = _uiGetMemoryMB(); // {used, total} or null
  const memUsed = mem ? mem.used : null;
  const memStr = (memUsed == null) ? '  —' : pad(memUsed, 4); // 4-char field (e.g. " 512")

  const mxStr = pad((uiMX|0), 4);
  const myStr = pad((uiMY|0), 4);
  const pointerStr = String(uiPointerSource || "mouse").padEnd(5, ' ');

  const rStr = pad((rgbUnder[0]|0), 3);
  const gStr = pad((rgbUnder[1]|0), 3);
  const bStr = pad((rgbUnder[2]|0), 3);

  const textStr =
    `Portal: ${pVersion}  x:${mxStr}  y:${myStr}  ptr:${pointerStr}  fps:${fpsStr}   mem:${memStr}MB   rgb: ${rStr},${gStr},${bStr}`;

  target.push();
  const barX = 10;
  const barY = 9;
  const toggleW = 86;
  const gap = 6;
  const textPad = 16;

  uiUseGraphics(target);
  if (baseMonoFont && typeof target.textFont === "function") target.textFont(baseMonoFont);
  if (typeof target.textSize === "function") target.textSize(12);
  const textW = Math.ceil(target.textWidth(textStr) + textPad);
  uiText(textStr, {
    x: barX,
    y: barY,
    width: textW,
    height: barH,
    bgColor: "#505050",
    textColor: "#ffffff",
    hAlign: "left",
    vAlign: "middle",
    padding: 8,
    radius: 5,
    fontSize: 12,
  });

  _uiInfo.measureEnabled = !!uiToggle("ui_debug_measure_toggle", "measure", {
    x: barX + textW + gap,
    y: barY,
    width: toggleW,
    height: barH,
    bgColor: "#707070",
    offBgColor: "#707070",
    onBgColor: "#8c8c8c",
    textColor: "#ffffff",
    radius: 5,
    fontSize: 12,
  }).value;

  _uiInfo.gridEnabled = !!uiToggle("ui_debug_grid_toggle", "grid", {
    x: barX + textW + gap + toggleW + gap,
    y: barY,
    width: toggleW,
    height: barH,
    bgColor: "#707070",
    offBgColor: "#707070",
    onBgColor: "#8c8c8c",
    textColor: "#ffffff",
    radius: 5,
    fontSize: 12,
  }).value;
  uiEndUseGraphics();

  // Color swatch at right
  const swW = 22, swH = barH - 10;
  const swX = uiSWidth - swW - padX;
  const swY = (barH - swH)/2;
  /*stroke(255, 220);
  strokeWeight(1);
  fill(rgbUnder[0]||0, rgbUnder[1]||0, rgbUnder[2]||0);
  rect(swX, swY, swW, swH, 4);*/
  const qrSize = 100;
  const qrPadding = 5;
  const canShowQR =
    typeof urlToSketch !== "undefined" &&
    typeof urlToSketch === "string" &&
    urlToSketch.trim() !== "" &&
    typeof sketchQRCode !== "undefined" &&
    !!sketchQRCode &&
    Number.isFinite(Number(sketchQRCode.size)) &&
    Number(sketchQRCode.size) > 0 &&
    typeof drawQRCode === "function" &&
    (typeof sketchQRCodeValid === "undefined" || !!sketchQRCodeValid) &&
    uiSWidth > barLength + qrSize + qrPadding * 3;

  if (canShowQR)
  {
    target.translate(uiSWidth-qrSize-qrPadding*5,10-qrPadding);
    
    target.fill("white");
    target.noStroke();
    target.rect(0,0,qrSize+qrPadding*2,qrSize+qrPadding*2,3,3,3,3);
  }
  target.pop();
}



function _uiDrawDebugConsole(target) {
  if (_uiDebugList.length === 0) return;
  const pad = 8, lineH = 16, w = uiSWidth * 0.6;
  const h = pad*2 + lineH * _uiDebugList.length;
  const x = pad, y = uiSHeight - h - pad;

  target.push();
  target.textFont(baseMonoFont);
  target.noStroke();
  target.fill(0, 150); target.rect(x, y, w, h, 8);
  target.fill(255, 230); target.rect(x, y, w, 22, 8, 8, 0, 0);
  target.fill(0); target.textAlign(LEFT, CENTER); target.textSize(12);
  target.text('DEBUG', x+8, y+11);

  target.fill(255);
  for (let i=0; i<_uiDebugList.length; i++) {
    target.text(_uiDebugList[i], x+8, y+22 + (i+0.5)*lineH);
  }
  target.pop();
}

function _uiTextWithOutline(t, x, y) {
  push();
  fill(0, 180); text(t, x+1, y+1);
  fill(255); text(t, x, y);
  pop();
}
function _uiTextWithChip(target, t, x, y) {
  const padX = 6, padY = 3;
  target.push();
  target.textFont(baseMonoFont);
  target.textSize(12); target.textAlign(CENTER, CENTER);
  const tw = target.textWidth(t);
  target.noStroke(); target.fill(0, 160); target.rect(x - (tw/2 + padX), y - (8+padY), tw + padX*2, 16 + padY*2, 6);
  target.fill(255); target.text(t, x, y);
  target.pop();
}
function _uiGetMemoryMB() {
  try {
    if (performance && performance.memory) {
      const m = performance.memory;
      return {
        used: Math.round(m.usedJSHeapSize/1048576),
        total: Math.round(m.totalJSHeapSize/1048576)
      };
    }
  } catch (e) { }
  return null;
}




// -------------------------
// Exports
// -------------------------
window.uiShowInfo = uiShowInfo;
window.uiIsDebugOverlayVisible = uiIsDebugOverlayVisible;
window.uiDebug = uiDebug;
window.uiUpdate = uiUpdate;
window.uiUpdateSimple = uiUpdateSimple;
window.uiListStart = uiListStart;
window.uiListEnd = uiListEnd;
window.uiText = uiText;
window.uiButton = uiButton;
window.uiPromptText = uiPromptText;
window.uiSlider = uiSlider;
window.uiToggle = uiToggle;
window.uiRect = uiRect;
window.uiSetBaseStyle = uiSetBaseStyle;
window.uiGet = uiGet;
window.uiSet = uiSet;
window.uiGetState = uiGetState;
window.uiSetState = uiSetState;
window.uiUseGraphics = uiUseGraphics;
window.uiEndUseGraphics = uiEndUseGraphics;
window.uiGetGraphicsTarget = uiGetGraphicsTarget;
window.uiGetDebugOverlay = _uiEnsureDebugOverlay;
window.uiDrawOnDebugOverlay = uiDrawOnDebugOverlay;
window.debugOverlay = debugOverlay;

// Example p5 usage:
// function setup(){ createCanvas(900, 600); }
// function draw(){ background(245); uiUpdateSimple(); uiDemoPanel(); }
