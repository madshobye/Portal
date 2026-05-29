const theme = {
  bg: "#111314",
  panel: "#1b1d1f",
  panelSoft: "#151718",
  line: "#34383c",
  lineHot: "#6d858d",
  text: "#f1ede6",
  muted: "#aaa59c",
  accent: "#7fd0df",
  accentSoft: "#2a5861",
  disabledWash: "rgba(17, 19, 20, 0.68)",
  disabledText: "#8e8a82",
  good: "#7ac285",
  warn: "#d8be64",
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

function normalizeId(value, fallback = "item") {
  return String(value || fallback).trim().replace(/\s+/g, "_");
}

function colorFromRgb(r, g, b) {
  const toHex = (value) => clamp(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawText(ctx, text, x, y, options = {}) {
  const { size = 14, weight = 500, color = theme.text, align = "left", baseline = "top" } = options;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(text ?? ""), x, y);
}

function pointerFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function initGuinoView({ canvas, status, widgetList, sendInput, requestRefresh }) {
  return new GuinoView({ canvas, status, widgetList, sendInput, requestRefresh });
}

class GuinoView {
  constructor({ canvas, status, widgetList, sendInput, requestRefresh }) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d");
    this.status = status;
    this.widgetList = widgetList;
    this.sendInput = sendInput;
    this.requestRefresh = requestRefresh;
    this.title = "Live UI";
    this.widgets = new Map();
    this.rects = new Map();
    this.dpr = 1;
    this.hoverId = "";
    this.pressedId = "";
    this.dragId = "";
    this.scrollY = 0;
    this.contentHeight = 0;
    this.lastUpdateAt = 0;
    this.lastInput = "";
    this.sliderSendTimer = 0;
    this.accent = theme.accent;
    this.accentSoft = theme.accentSoft;
    this.connected = false;
    this.resizeObserver = null;
    this.raf = 0;
    this.pointerDown = false;

    if (!this.canvas || !this.ctx) return;
    this.bind();
    this.resize();
  }

  setConnected(connected) {
    const next = Boolean(connected);
    if (this.connected === next) return;
    this.connected = next;
    if (!next) {
      this.cancelPointer();
      this.hoverId = "";
    }
    this.scheduleDraw();
  }

  bind() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelPointer());
    this.canvas.addEventListener("mouseleave", () => {
      this.hoverId = "";
      this.scheduleDraw();
    });
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect() || this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width || 640));
    const height = Math.max(260, Math.floor(rect.height || 420));
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scheduleDraw();
  }

  clear() {
    this.widgets.clear();
    this.rects.clear();
    this.title = "Live UI";
    this.scrollY = 0;
    this.lastUpdateAt = Date.now();
    this.renderList();
    this.setStatus();
    this.scheduleDraw();
  }

  acceptEvent(name, data = {}) {
    if (!name?.startsWith("ui.")) return false;
    if (name === "ui.reset" || name === "ui.clear") {
      this.widgets.clear();
      this.title = data.title || "Live UI";
      this.scrollY = 0;
    } else if (name === "ui.item") {
      this.upsertWidget(data);
    } else if (name === "ui.value") {
      this.setWidgetValue(data.id, data.value);
    } else if (name === "ui.text") {
      this.setWidgetText(data.id, data.text || data.value || data.message || "");
    } else if (name === "ui.remove") {
      this.widgets.delete(normalizeId(data.id));
    } else if (name === "ui.style") {
      this.setStyle(data);
    }
    this.lastUpdateAt = Date.now();
    this.renderList();
    this.setStatus();
    this.scheduleDraw();
    return true;
  }

  setStyle(data = {}) {
    this.accent = colorFromRgb(data.r ?? 127, data.g ?? 208, data.b ?? 223);
    this.accentSoft = colorFromRgb((data.r ?? 127) * 0.32, (data.g ?? 208) * 0.42, (data.b ?? 223) * 0.45);
  }

  upsertWidget(data = {}) {
    const id = normalizeId(data.id || data.label || data.type, `item-${this.widgets.size + 1}`);
    const existing = this.widgets.get(id) || { id, order: this.widgets.size, history: [] };
    const type = String(data.type || existing.type || "value").toLowerCase();
    const min = toNumber(data.min, existing.min ?? 0);
    const max = toNumber(data.max, existing.max ?? 100);
    const value = data.value !== undefined ? toNumber(data.value, existing.value ?? min) : existing.value ?? min;
    const next = {
      ...existing,
      ...data,
      id,
      type,
      label: data.label || existing.label || id,
      text: data.text || existing.text || "",
      value,
      min,
      max: max === min ? min + 1 : max,
      updatedAt: Date.now(),
    };
    if (type === "graph" || type === "plot" || type === "waveform") {
      next.history = existing.history || [];
      this.pushHistory(next, value);
    }
    this.widgets.set(id, next);
  }

  setWidgetValue(idValue, value) {
    const id = normalizeId(idValue);
    const widget = this.widgets.get(id) || {
      id,
      order: this.widgets.size,
      type: "value",
      label: id,
      min: 0,
      max: 100,
      history: [],
    };
    widget.value = toNumber(value, widget.value || 0);
    widget.updatedAt = Date.now();
    if (widget.type === "graph" || widget.type === "plot" || widget.type === "waveform") this.pushHistory(widget, widget.value);
    this.widgets.set(id, widget);
  }

  setWidgetText(idValue, text) {
    const id = normalizeId(idValue);
    const widget = this.widgets.get(id) || { id, order: this.widgets.size, type: "label", label: id };
    widget.text = String(text ?? "");
    widget.updatedAt = Date.now();
    this.widgets.set(id, widget);
  }

  pushHistory(widget, value) {
    widget.history = widget.history || [];
    widget.history.push(toNumber(value, 0));
    if (widget.history.length > 96) widget.history.splice(0, widget.history.length - 96);
  }

  setStatus(text = "") {
    if (!this.status) return;
    if (text) {
      this.status.textContent = text;
      return;
    }
    const count = this.widgets.size;
    const suffix = this.lastInput ? ` / ${this.lastInput}` : "";
    this.status.textContent = count ? `${count} control${count === 1 ? "" : "s"} from firmware${suffix}` : "waiting for firmware UI";
  }

  renderList() {
    if (!this.widgetList) return;
    const widgets = [...this.widgets.values()].sort((a, b) => a.order - b.order);
    this.widgetList.innerHTML = widgets.map((item) => {
      const value = item.type === "button" || item.type === "label" ? "" : `<span>${Math.round(toNumber(item.value, 0))}</span>`;
      return `<li><strong>${escapeHtml(item.label || item.id)}</strong>${value}</li>`;
    }).join("");
  }

  scheduleDraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  draw() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    const widgets = [...this.widgets.values()].sort((a, b) => a.order - b.order);
    this.rects.clear();
    if (!widgets.length) {
      return;
    }

    this.drawHeader(ctx, w);
    const pad = 18;
    const gap = 12;
    const bodyTop = 66;
    const colCount = Math.max(1, Math.floor((w - pad * 2 + gap) / 264));
    const colW = Math.floor((w - pad * 2 - gap * (colCount - 1)) / colCount);
    let y = bodyTop - this.scrollY;
    let col = 0;
    let rowHeight = 0;

    for (const widget of widgets) {
      if (widget.type === "column") {
        if (col < colCount - 1) {
          col += 1;
        } else {
          col = 0;
          y += rowHeight + gap;
          rowHeight = 0;
        }
        continue;
      }
      const span = this.widgetSpan(widget, colCount);
      const ww = colW * span + gap * (span - 1);
      if (col + span > colCount) {
        col = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      const x = pad + col * (colW + gap);
      const wh = this.widgetHeight(widget);
      this.drawWidget(ctx, widget, x, y, ww, wh);
      this.rects.set(widget.id, { x, y, w: ww, h: wh, widget });
      rowHeight = Math.max(rowHeight, wh);
      col += span;
      if (col >= colCount) {
        col = 0;
        y += rowHeight + gap;
        rowHeight = 0;
      }
    }

    this.contentHeight = Math.max(h, y + rowHeight + gap + this.scrollY);
    const maxScroll = Math.max(0, this.contentHeight - h);
    this.scrollY = clamp(this.scrollY, 0, maxScroll);
  }

  drawHeader(ctx, w) {
    ctx.fillStyle = theme.panelSoft;
    ctx.fillRect(0, 0, w, 54);
    ctx.strokeStyle = theme.line;
    ctx.beginPath();
    ctx.moveTo(0, 54);
    ctx.lineTo(w, 54);
    ctx.stroke();
    drawText(ctx, this.title, 18, 18, { size: 18, weight: 700, color: this.connected ? theme.text : theme.disabledText });
  }

  drawEmpty(ctx, w, h) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);
  }

  drawDisabledOverlay(ctx, w, h) {
    ctx.fillStyle = theme.disabledWash;
    ctx.fillRect(0, 54, w, Math.max(0, h - 54));
  }

  widgetSpan(widget, colCount) {
    if (colCount <= 1) return 1;
    if (["graph", "plot", "waveform"].includes(widget.type)) return Math.min(2, colCount);
    if (widget.type === "label") return Math.min(2, colCount);
    if (widget.type === "spacer") return Math.min(2, colCount);
    return 1;
  }

  widgetHeight(widget) {
    if (widget.type === "spacer") return 12 + clamp(toNumber(widget.value, 1), 1, 3) * 14;
    if (widget.type === "column") return 0;
    if (widget.type === "label") return 68;
    if (widget.type === "button" || widget.type === "toggle") return 88;
    if (widget.type === "slider") return 98;
    if (["graph", "plot", "waveform"].includes(widget.type)) return 154;
    return 108;
  }

  drawWidget(ctx, widget, x, y, w, h) {
    if (widget.type === "spacer") return this.drawSpacer(ctx, widget, x, y, w, h);
    roundedRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = theme.panel;
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.stroke();

    const label = widget.label || widget.id;
    if (widget.type !== "button" && widget.type !== "label") {
      drawText(ctx, label, x + 14, y + 13, { size: 13, weight: 800 });
    }

    if (widget.type === "button") return this.drawButton(ctx, widget, x, y, w, h);
    if (widget.type === "toggle") return this.drawToggle(ctx, widget, x, y, w, h);
    if (widget.type === "slider") return this.drawSlider(ctx, widget, x, y, w, h);
    if (["graph", "plot", "waveform"].includes(widget.type)) return this.drawGraph(ctx, widget, x, y, w, h);
    if (widget.type === "label") return this.drawLabel(ctx, widget, x, y, w, h);
    return this.drawValue(ctx, widget, x, y, w, h);
  }

  drawSpacer(ctx, widget, x, y, w, h) {
    return;
  }

  drawLabel(ctx, widget, x, y, w, h) {
    const text = widget.text || widget.value || widget.label || "";
    const isTitle = widget.id === "title";
    drawText(ctx, text, x + 14, y + (isTitle ? 22 : 26), {
      size: isTitle ? 18 : 13,
      weight: isTitle ? 800 : 650,
      color: isTitle ? theme.text : theme.muted,
    });
  }

  drawButton(ctx, widget, x, y, w, h) {
    const down = this.pressedId === widget.id;
    const isHover = this.hoverId === widget.id;
    const bx = x + 14;
    const by = y + 14;
    const bw = w - 28;
    const bh = h - 28;
    roundedRect(ctx, bx, by, bw, bh, 7);
    ctx.fillStyle = down ? this.accentSoft : (isHover ? "#202528" : theme.panelSoft);
    ctx.fill();
    ctx.strokeStyle = down || isHover ? this.accent : theme.line;
    ctx.stroke();
    drawText(ctx, widget.label || widget.id, bx + bw / 2, by + bh / 2 + 1, {
      size: 14,
      weight: 850,
      color: down ? this.accent : theme.text,
      align: "center",
      baseline: "middle",
    });
  }

  drawToggle(ctx, widget, x, y, w, h) {
    const on = toNumber(widget.value, 0) > 0;
    const isHover = this.hoverId === widget.id;
    const tx = x + w - 76;
    const ty = y + 42;
    roundedRect(ctx, tx, ty, 54, 28, 14);
    ctx.fillStyle = on ? this.accentSoft : (isHover ? "#2b2e31" : "#232527");
    ctx.fill();
    ctx.strokeStyle = on || isHover ? this.accent : theme.line;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx + (on ? 39 : 15), ty + 14, 10, 0, Math.PI * 2);
    ctx.fillStyle = on ? this.accent : theme.muted;
    ctx.fill();
    drawText(ctx, on ? "on" : "off", x + 14, y + 50, { size: 18, weight: 800, color: on ? this.accent : theme.muted });
  }

  drawSlider(ctx, widget, x, y, w, h) {
    const isHover = this.hoverId === widget.id || this.dragId === widget.id;
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    const value = clamp(toNumber(widget.value, min), min, max);
    const t = (value - min) / (max - min || 1);
    const sx = x + 14;
    const sy = y + 58;
    const sw = w - 28;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a2d30";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + sw, sy);
    ctx.stroke();
    ctx.strokeStyle = this.accent;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + sw * t, sy);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx + sw * t, sy, 11, 0, Math.PI * 2);
    ctx.fillStyle = isHover ? this.accent : theme.text;
    ctx.fill();
    drawText(ctx, Math.round(value), x + w - 14, y + 16, { size: 18, weight: 800, align: "right", color: this.accent });
    drawText(ctx, `${Math.round(min)} - ${Math.round(max)}`, x + 14, y + 76, { size: 10, weight: 600, color: theme.muted });
  }

  drawGraph(ctx, widget, x, y, w, h) {
    const gx = x + 14;
    const gy = y + 44;
    const gw = w - 28;
    const gh = h - 62;
    roundedRect(ctx, gx, gy, gw, gh, 5);
    ctx.fillStyle = "#0c0d0e";
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.stroke();
    const history = widget.history || [];
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    if (history.length > 1) {
      ctx.beginPath();
      history.forEach((value, index) => {
        const tx = gx + (index / Math.max(1, history.length - 1)) * gw;
        const ty = gy + gh - clamp((toNumber(value, min) - min) / (max - min || 1), 0, 1) * gh;
        if (index === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      });
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    drawText(ctx, Math.round(toNumber(widget.value, 0)), x + w - 14, y + 15, { size: 16, weight: 800, align: "right", color: this.accent });
  }

  drawValue(ctx, widget, x, y, w, h) {
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    const value = clamp(toNumber(widget.value, min), min, max);
    const t = clamp((value - min) / (max - min || 1), 0, 1);
    drawText(ctx, Math.round(value), x + 14, y + 42, { size: 32, weight: 900, color: this.accent });
    const gx = x + 14;
    const gy = y + h - 24;
    const gw = w - 28;
    roundedRect(ctx, gx, gy, gw, 8, 4);
    ctx.fillStyle = "#2a2d30";
    ctx.fill();
    roundedRect(ctx, gx, gy, gw * t, 8, 4);
    ctx.fillStyle = this.accent;
    ctx.fill();
  }

  onPointerDown(event) {
    if (!this.connected) return;
    const p = pointerFromEvent(this.canvas, event);
    const hit = this.hitTest(p.x, p.y);
    if (!hit) return;
    this.pointerDown = true;
    this.pressedId = hit.widget.id;
    this.canvas.setPointerCapture?.(event.pointerId);
    if (hit.widget.type === "slider") {
      this.dragId = hit.widget.id;
      this.updateSliderFromPointer(hit.widget, p.x, true);
    }
    this.scheduleDraw();
  }

  onPointerMove(event) {
    if (!this.connected) {
      if (this.hoverId) {
        this.hoverId = "";
        this.scheduleDraw();
      }
      return;
    }
    const p = pointerFromEvent(this.canvas, event);
    const hit = this.hitTest(p.x, p.y);
    this.hoverId = hit?.widget?.id || "";
    if (this.dragId) {
      const widget = this.widgets.get(this.dragId);
      if (widget) this.updateSliderFromPointer(widget, p.x, false);
    }
    this.scheduleDraw();
  }

  onPointerUp(event) {
    if (!this.connected) {
      this.cancelPointer();
      return;
    }
    const p = pointerFromEvent(this.canvas, event);
    const hit = this.hitTest(p.x, p.y);
    const widget = this.widgets.get(this.pressedId);
    if (widget && hit?.widget?.id === widget.id) {
      if (widget.type === "button") this.sendUi(widget.id, "press");
      if (widget.type === "toggle") {
        const next = toNumber(widget.value, 0) > 0 ? 0 : 1;
        widget.value = next;
        this.sendUi(widget.id, "set", next);
      }
      if (widget.type === "slider") this.sendUi(widget.id, "set", Math.round(toNumber(widget.value, 0)));
    }
    this.cancelPointer();
  }

  cancelPointer() {
    this.pointerDown = false;
    this.pressedId = "";
    this.dragId = "";
    this.scheduleDraw();
  }

  onWheel(event) {
    if (!this.connected) return;
    const h = this.canvas.height / this.dpr;
    const maxScroll = Math.max(0, this.contentHeight - h);
    if (maxScroll <= 0) return;
    event.preventDefault();
    this.scrollY = clamp(this.scrollY + event.deltaY, 0, maxScroll);
    this.scheduleDraw();
  }

  hitTest(x, y) {
    for (const rect of [...this.rects.values()].reverse()) {
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return rect;
    }
    return null;
  }

  updateSliderFromPointer(widget, pointerX, force) {
    const rect = this.rects.get(widget.id);
    if (!rect) return;
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    const t = clamp((pointerX - (rect.x + 14)) / Math.max(1, rect.w - 28), 0, 1);
    widget.value = Math.round(min + t * (max - min));
    const now = Date.now();
    if (force || now - this.sliderSendTimer > 90) {
      this.sliderSendTimer = now;
      this.sendUi(widget.id, "set", Math.round(widget.value), { quietErrors: true });
    }
  }

  async sendUi(id, type, value = "", { quietErrors = false } = {}) {
    if (!this.sendInput) return;
    if (!this.connected) {
      this.setStatus("Connect to use UI");
      return;
    }
    const label = type === "set" ? `${id}=${value}` : `${id}:${type}`;
    this.lastInput = label;
    this.setStatus();
    try {
      await this.sendInput({ id, type, value });
    } catch (error) {
      if (!quietErrors) this.setStatus(`UI input failed: ${error.message}`);
    }
  }

  requestFirmwareRefresh() {
    if (this.requestRefresh) return this.requestRefresh();
    return this.sendUi("system", "hello");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
