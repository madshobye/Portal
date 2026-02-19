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
let uiMX=0, uiMY=0, uiMXOld=0, uiMYOld=0;
let uiMP=false, uiMPOld=false;
let uiKey=undefined;
let uiSWidth=0, uiSHeight=0;
let uiStack=[];

// -------------------------
// State store (ID-based)
// -------------------------
const uiStore = new Map();
function uiGet(id, init){ if(!uiStore.has(id)) uiStore.set(id, init); return uiStore.get(id); }
function uiSet(id, v){ uiStore.set(id, v); }

// -------------------------
// Style system
// -------------------------
let uiBaseStyle = {
  common: {
    font: undefined,      // p5.Font or undefined
    fontSize: 15,
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
  button: { height: 32 },
  slider: { height: 28, trackColor: '#f2f2f2', fillColor: '#7aa7ff', min: 0, max: 1 },
  toggle: { height: 32, onBgColor: '#d7f7de', offBgColor: 'gray' },
  text: { height: 32 },
  promptText: { height: 32 },
  list: { dir: 'vertical', width: 220, x: 0, y: 0 }
};
function uiSetBaseStyle(newBase={}){ uiBaseStyle = uiMergeDeep({}, uiBaseStyle, newBase); }
function uiMergeDeep(target, ...sources){
  for(const src of sources){ if(!src) continue; for(const k of Object.keys(src)){
    const v = src[k];
    if(v && typeof v==='object' && !Array.isArray(v)) target[k] = uiMergeDeep(target[k]||{}, v);
    else target[k] = v;
  }} return target;
}
function uiApplyStyle(style){
  if(style.font) textFont(style.font);
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
function uiUpdateSimple() {
 cursor('default');
  
  uiUpdate(mouseX, mouseY, mouseIsPressed, key, width, height);
 
 
}


function uiUpdate(_mx,_my,_mp,_key,_w,_h){
  uiSWidth=_w; uiSHeight=_h; uiKey=_key;
  uiMXOld=uiMX; uiMYOld=uiMY; uiMPOld=uiMP;
  uiMX=_mx; uiMY=_my; uiMP=_mp;
  if(uiStack.length===0) uiListStart(); // ensure a root list for flow layout
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
    if(parent.dir==='vertical'){ x=parent.x; y=parent.curY; width=parent.width; }
    else { x=parent.curX; y=parent.y; width=base.width; }
  } else {
    // Respect caller-provided x/y. Otherwise use base defaults.
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
  push();
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.text, style);
  const h = (s.height!==undefined)?s.height:22;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  if(s.bgColor){ fill(s.bgColor); noStroke(); rect(box.x, box.y, box.width, box.height, s.rounding); }
  uiDrawLabel(txt, box, s);
  pop();
  return { x:box.x, y:box.y, width:box.width, height:box.height };
}

function uiButton(label, style={}){
  push();
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
  if(cur.bgColor){ fill(cur.bgColor); } else noFill();
  if(cur.stroke && cur.stroke.weight>0){ stroke(cur.stroke.color||0, cur.stroke.alpha??255); strokeWeight(cur.stroke.weight); } else noStroke();
  rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  uiDrawLabel(label, box, cur);
  pop();
  return { clicked: hit.clicked, hover: hit.hover, pressed: hit.pressed, x:box.x, y:box.y, width:box.width, height:box.height };
}

function uiPromptText(id, label, style={}){
  const currentValue = uiGet(id, '');
  const shown = currentValue!=='' ? (label+': '+currentValue) : label;
  const res = uiButton(shown, uiMergeDeep({}, uiBaseStyle.promptText, style));
  let changed=false, value=currentValue;
  if(res.clicked){ const nv = window.prompt(label, currentValue??''); if(nv!==null){ value=nv; changed=true; uiSet(id,value); } }
  return { ...res, changed, value };
}

function uiSlider(id, label, opts={}, style={}){
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.slider, style);
  const min = (opts.min!==undefined)?opts.min:s.min;
  const max = (opts.max!==undefined)?opts.max:s.max;
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  let val = uiGet(id, (opts.init!==undefined?opts.init:min));
  const hit = uiHit(box.x, box.y, box.width, box.height);
  if(hit.pressed){ const t = constrain((hit.mX)/(box.width), 0, 1); val = lerp(min, max, t); uiSet(id, val); }
  // track
  noStroke(); fill(s.trackColor); rect(box.x, box.y, box.width, box.height, s.rounding);
  // fill
  const tnow = (val-min)/(max-min); fill(s.fillColor); rect(box.x, box.y, box.width*tnow, box.height, s.rounding, 0, 0, s.rounding);
  // label
  uiDrawLabel(label+" ("+nf(val,1,2)+")", box, s);
  return { value: val, changed: hit.pressed, x:box.x, y:box.y, width:box.width, height:box.height };
}

function uiToggle(id, label, style={}){
  push();
  // Full-width button-like toggle with text and changing background
  const s = uiMergeDeep({}, uiBaseStyle.common, uiBaseStyle.button, uiBaseStyle.toggle, style);
  const h = s.height;
  const box = (s.x!==undefined && s.y!==undefined && s.width!==undefined)
    ? { x:s.x, y:s.y, width:s.width, height:h }
    : uiPlace(s.width||uiGetList().width, h);
  let v = !!uiGet(id, false);
  const hit = uiHit(box.x, box.y, box.width, box.height);
  if(hit.clicked){ v = !v; uiSet(id, v); }
  let cur = uiMergeDeep({}, s, { bgColor: v ? s.onBgColor : s.offBgColor });
  if(!v && hit.hover) cur = uiMergeDeep(cur, s.hover);
  if(!v && hit.pressed) cur = uiMergeDeep(cur, s.pressed);
  if(cur.bgColor){ fill(cur.bgColor); } else noFill();
  if(cur.stroke && cur.stroke.weight>0){ stroke(cur.stroke.color||0, cur.stroke.alpha??255); strokeWeight(cur.stroke.weight); } else noStroke();
  rect(box.x, box.y, box.width, box.height, cur.rounding!==undefined?cur.rounding:s.rounding);
  uiDrawLabel((v?label+' : ON':label+' : OFF'), box, cur);
  pop();
  return { value: v, toggled: hit.clicked, x:box.x, y:box.y, width:box.width, height:box.height };
}

// -------------------------
// Decorative rect utility
// -------------------------
function uiRect(x,y,w,h, style={}){
  push();
  const s = uiMergeDeep({}, uiBaseStyle.common, style);
  if(s.bgColor){ fill(s.bgColor); } else noFill();
  if(s.stroke && s.stroke.weight>0){ stroke(s.stroke.color||0, s.stroke.alpha??255); strokeWeight(s.stroke.weight); } else noStroke();
  rect(x,y,w,h, s.rounding);
  pop();
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
  comboPrev: false,      // previous state of Ctrl/Cmd+D combo
  measuring: false,
  sx: 0, sy: 0
};
const _uiDebugList = [];

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
 * - Toggle visibility: Cmd/Ctrl + D
 * - Drag to measure: press and drag to draw dx, dy, and distance.
 * - Shows mouse (x,y), fps, heap (if available), and RGB under cursor.
 * Call this once per frame (typically at the end of draw()).
 */
function uiShowInfo(opt = {}) {
 // --- 1) Handle plain Control key toggle (press & release) ---
const ctrlDown = (typeof keyIsDown === 'function') ? keyIsDown(CONTROL) : false;

// Toggle ON key down (edge detection)
if (ctrlDown && !_uiInfo.comboPrev) {
  _uiInfo.visible = !_uiInfo.visible;
}
_uiInfo.comboPrev = ctrlDown;
  if (!_uiInfo.visible) return { visible:false };

  // --- (NEW) Sample color UNDER the mouse BEFORE drawing the grid ---
  let rgbUnder = [0,0,0,0];
  try {
    const gx = constrain(floor(uiMX), 0, uiSWidth-1);
    const gy = constrain(floor(uiMY), 0, uiSHeight-1);
    rgbUnder = get(gx, gy); // [r,g,b,a] from your scene, not the grid
  } catch(e){}

  // --- 2) Draw semi-transparent grid ---
  _uiDrawGrid(opt);

  // --- 3) Measurement: press & drag to show line and distances ---
  _uiHandleMeasure();

  // --- 4) HUD: compact top bar (pass rgbUnder) ---
  _uiDrawHUD(rgbUnder);

  // --- 5) Debug console overlay ---
  _uiDrawDebugConsole();

  return {
    visible: true,
    measuring: _uiInfo.measuring,
    start: { x:_uiInfo.sx, y:_uiInfo.sy },
    end: { x: uiMX, y: uiMY },
    dx: uiMX - _uiInfo.sx,
    dy: uiMY - _uiInfo.sy,
    dist: dist(_uiInfo.sx, _uiInfo.sy, uiMX, uiMY)
  };
}


// -------------------------
// Internals
// -------------------------
function _uiDrawGrid(opt) {
   const s50 = uiMergeDeep({}, {
    color: { r: 120, g: 120, b: 120, a: 80 },   // lighter gray, very transparent
    weight: 1
  }, opt.grid50);

  const s100 = uiMergeDeep({}, {
    color: { r: 120, g: 120, b: 120, a: 120 },   // darker gray
    weight: 1
  }, opt.grid100);

  push();
  noFill();

  // 50px lines
  stroke(s50.color.r, s50.color.g, s50.color.b, s50.color.a);
  strokeWeight(s50.weight);
  for (let x = 0; x <= uiSWidth; x += 50) line(x, 0, x, uiSHeight);
  for (let y = 0; y <= uiSHeight; y += 50) line(0, y, uiSWidth, y);

  // 100px lines
  stroke(s100.color.r, s100.color.g, s100.color.b, s100.color.a);
  strokeWeight(s100.weight);
  for (let x = 0; x <= uiSWidth; x += 100) line(x, 0, x, uiSHeight);
  for (let y = 0; y <= uiSHeight; y += 100) line(0, y, uiSWidth, y);

  pop();
}


function _uiHandleMeasure() {
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

  push();
  // main line
  stroke(120, 120, 120, 255); strokeWeight(2); line(x0, y0, x1, y1);
  stroke(255, 255, 255, 160); strokeWeight(1); line(x0, y0, x1, y1);

  // projections
    stroke(120, 120, 120, 255); strokeWeight(1);
  line(x0, y0, x1, y0); // horizontal projection
  line(x1, y0, x1, y1); // vertical projection
  noFill();
 // ellipse(x0, y0,dd*2,dd*2);
  // little endpoints
  noStroke(); fill(0, 160); circle(x0, y0, 6); circle(x1, y1, 6);
  fill(200); circle(x0, y0, 3); circle(x1, y1, 3);

  // labels
  textAlign(CENTER, BOTTOM);
  textSize(12); noStroke();
  _uiTextWithChip(`${Math.round(dx)} px`, x0 + dx/2, y0 - 6);
  textAlign(LEFT, CENTER);
  _uiTextWithChip(`${Math.round(dy)} px`, x1 + 6, y0 + dy/2);

  textAlign(CENTER, TOP);
  _uiTextWithChip(`${Math.round(dd)} px`, (x0+x1)/2, (y0+y1)/2);

  pop();
}
function _uiDrawHUD(rgbUnder = [0,0,0,0]) {
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

  const rStr = pad((rgbUnder[0]|0), 3);
  const gStr = pad((rgbUnder[1]|0), 3);
  const bStr = pad((rgbUnder[2]|0), 3);

  const textStr =
    `Portal: ${pVersion}  x:${mxStr}  y:${myStr}   fps:${fpsStr}   mem:${memStr}MB   rgb: ${rStr},${gStr},${bStr}`;

  push();
  translate(10,10);
  noStroke();
  const barLength = 545;
  fill(80);                // translucent black bar
  rect(0, -1, 545, barH,5,5,5,5);  // full width

  fill(255);
  textAlign(LEFT, CENTER);
  textFont('monospace');       // fixed-width so spaces hold the layout
  textSize(12);
  text(textStr, padX, barH / 2);

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
  if(typeof urlToSketch !== 'undefined' && urlToSketch != ""   && uiSWidth >barLength+qrSize+qrPadding*3)
  {
    translate(uiSWidth-qrSize-qrPadding*5,-qrPadding);
    
    fill("white");
    noStroke();
    rect(0,0,qrSize+qrPadding*2,qrSize+qrPadding*2,3,3,3,3);
  drawQRCode(sketchQRCode, qrPadding, qrPadding, qrSize);
  }
  pop();
}



function _uiDrawDebugConsole() {
  if (_uiDebugList.length === 0) return;
  const pad = 8, lineH = 16, w = uiSWidth * 0.6;
  const h = pad*2 + lineH * _uiDebugList.length;
  const x = pad, y = uiSHeight - h - pad;

  push();
  noStroke();
  fill(0, 150); rect(x, y, w, h, 8);
  fill(255, 230); rect(x, y, w, 22, 8, 8, 0, 0);
  fill(0); textAlign(LEFT, CENTER); textSize(12);
  text('DEBUG', x+8, y+11);

  fill(255);
  for (let i=0; i<_uiDebugList.length; i++) {
    text(_uiDebugList[i], x+8, y+22 + (i+0.5)*lineH);
  }
  pop();
}

function _uiTextWithOutline(t, x, y) {
  push();
  fill(0, 180); text(t, x+1, y+1);
  fill(255); text(t, x, y);
  pop();
}
function _uiTextWithChip(t, x, y) {
  const padX = 6, padY = 3;
  push();
  textSize(12); textAlign(CENTER, CENTER);
  const tw = textWidth(t);
  noStroke(); fill(0, 160); rect(x - (tw/2 + padX), y - (8+padY), tw + padX*2, 16 + padY*2, 6);
  fill(255); text(t, x, y);
  pop();
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

// Example p5 usage:
// function setup(){ createCanvas(900, 600); }
// function draw(){ background(245); uiUpdateSimple(); uiDemoPanel(); }
