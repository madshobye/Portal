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

export function initGuinoView({ canvas, status, widgetList, sendInput, requestRefresh, onAvailabilityChange }) {
  return new GuinoView({ root: canvas, status, widgetList, sendInput, requestRefresh, onAvailabilityChange });
}

class GuinoView {
  constructor({ root, status, widgetList, sendInput, requestRefresh, onAvailabilityChange }) {
    this.root = root;
    this.status = status;
    this.widgetList = widgetList;
    this.sendInput = sendInput;
    this.requestRefresh = requestRefresh;
    this.onAvailabilityChange = onAvailabilityChange;
    this.title = "Live UI";
    this.widgets = new Map();
    this.connected = false;
    this.accent = "#7fd0df";
    this.accentSoft = "#2a5861";
    this.lastInput = "";
    this.interacting = false;
    this.renderPending = false;
    this.renderTimer = 0;
    this.inputSendTimers = new Map();
    this.availability = "unknown";
    this.emptyAvailabilityTimer = 0;

    if (!this.root) return;
    this.root.classList.add("ui-dom");
    this.root.addEventListener("pointerdown", () => this.beginInteraction());
    this.root.addEventListener("pointerup", () => this.endInteractionSoon());
    this.root.addEventListener("pointercancel", () => this.endInteractionSoon());
    this.root.addEventListener("focusin", () => this.beginInteraction());
    this.root.addEventListener("focusout", () => this.endInteractionSoon());
    this.render();
  }

  setConnected(connected) {
    const next = Boolean(connected);
    if (this.connected === next) return;
    this.connected = next;
    if (!next) {
      this.setAvailability("unknown");
    } else if (!this.widgets.size) {
      this.markUiRefreshPending();
    }
    this.render();
  }

  resize() {
  }

  hasActiveUi() {
    return this.widgets.size > 0;
  }

  shouldShowUiTab() {
    return this.widgets.size > 0;
  }

  markUiRefreshPending() {
    if (!this.connected) return;
    this.setAvailability("pending");
    this.scheduleEmptyAvailabilityCheck();
  }

  clear() {
    this.widgets.clear();
    this.title = "Live UI";
    this.lastInput = "";
    this.setAvailability("empty");
    this.renderList();
    this.setStatus();
    this.render();
  }

  acceptEvent(name, data = {}) {
    if (!name?.startsWith("ui.")) return false;
    if (name === "ui.reset" || name === "ui.clear") {
      this.widgets.clear();
      this.title = data.title || "Live UI";
      this.setAvailability("pending");
      this.scheduleEmptyAvailabilityCheck();
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
    this.renderList();
    this.setStatus();
    this.scheduleRender();
    this.updateAvailabilityFromWidgets();
    return true;
  }

  setAvailability(value) {
    if (this.availability === value) return;
    this.availability = value;
    this.onAvailabilityChange?.(value);
  }

  scheduleEmptyAvailabilityCheck() {
    window.clearTimeout(this.emptyAvailabilityTimer);
    this.emptyAvailabilityTimer = window.setTimeout(() => {
      this.emptyAvailabilityTimer = 0;
      this.updateAvailabilityFromWidgets({ settleEmpty: true });
    }, 900);
  }

  updateAvailabilityFromWidgets({ settleEmpty = false } = {}) {
    if (this.widgets.size > 0) {
      window.clearTimeout(this.emptyAvailabilityTimer);
      this.emptyAvailabilityTimer = 0;
      this.setAvailability("active");
      return;
    }
    if (this.availability === "pending" && !settleEmpty) return;
    this.setAvailability("empty");
  }

  setStyle(data = {}) {
    this.accent = colorFromRgb(data.r ?? 127, data.g ?? 208, data.b ?? 223);
    this.accentSoft = colorFromRgb((data.r ?? 127) * 0.32, (data.g ?? 208) * 0.42, (data.b ?? 223) * 0.45);
    this.root?.style.setProperty("--ui-accent", this.accent);
    this.root?.style.setProperty("--ui-accent-soft", this.accentSoft);
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
      history: existing.history || [],
      updatedAt: Date.now(),
    };
    if (isGraph(next)) this.pushHistory(next, value);
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
    if (isGraph(widget)) this.pushHistory(widget, widget.value);
    this.widgets.set(id, widget);
    this.patchWidgetDom(widget);
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
    if (widget.history.length > 120) widget.history.splice(0, widget.history.length - 120);
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
    const widgets = sortedWidgets(this.widgets).filter((item) => !["spacer", "column"].includes(item.type));
    this.widgetList.innerHTML = widgets.map((item) => {
      const value = item.type === "button" || item.type === "label" ? "" : `<span>${Math.round(toNumber(item.value, 0))}</span>`;
      return `<li><strong>${escapeHtml(item.label || item.id)}</strong>${value}</li>`;
    }).join("");
  }

  render() {
    if (!this.root) return;
    if (this.interacting) {
      this.renderPending = true;
      return;
    }
    this.renderPending = false;
    window.clearTimeout(this.renderTimer);
    this.renderTimer = 0;
    this.root.toggleAttribute("aria-disabled", !this.connected);
    this.root.innerHTML = "";
    const widgets = sortedWidgets(this.widgets);
    if (!widgets.length) return;

    const fragment = document.createDocumentFragment();
    const grid = document.createElement("div");
    grid.className = "ui-grid";
    fragment.append(grid);

    for (const widget of widgets) {
      if (widget.type === "column") {
        const column = document.createElement("div");
        column.className = "ui-column-break";
        grid.append(column);
        continue;
      }
      grid.append(this.renderWidget(widget));
    }
    this.root.append(fragment);
  }

  renderWidget(widget) {
    if (widget.type === "spacer") {
      const spacer = document.createElement("div");
      spacer.className = "ui-widget ui-spacer";
      spacer.style.minHeight = `${14 + clamp(toNumber(widget.value, 1), 1, 3) * 12}px`;
      return spacer;
    }

    const wrap = document.createElement("section");
    wrap.className = `ui-widget ui-widget-${cssType(widget.type)}`;
    wrap.dataset.uiId = widget.id;
    if (isGraph(widget) || widget.type === "label") wrap.classList.add("ui-widget-wide");

    if (widget.type === "button") {
      const button = document.createElement("button");
      button.className = "ui-live-button";
      button.type = "button";
      button.textContent = widget.label || widget.id;
      button.disabled = !this.connected;
      button.addEventListener("click", () => {
        this.beginInteraction();
        this.sendUi(widget.id, "press").finally(() => this.endInteractionSoon());
      });
      wrap.append(button);
      return wrap;
    }

    if (widget.type === "label") {
      const label = document.createElement("div");
      label.className = widget.id === "title" ? "ui-live-title" : "ui-live-label";
      label.textContent = widget.text || widget.value || widget.label || "";
      wrap.append(label);
      return wrap;
    }

    const header = document.createElement("header");
    header.textContent = widget.label || widget.id;
    wrap.append(header);

    if (widget.type === "toggle") {
      wrap.append(this.renderToggle(widget));
    } else if (widget.type === "slider") {
      wrap.append(this.renderSlider(widget));
    } else if (isGraph(widget)) {
      wrap.append(this.renderGraph(widget));
    } else {
      wrap.append(this.renderValue(widget));
    }
    return wrap;
  }

  renderToggle(widget) {
    const label = document.createElement("label");
    label.className = "ui-live-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = toNumber(widget.value, 0) > 0;
    input.disabled = !this.connected;
    input.addEventListener("change", () => {
      const next = input.checked ? 1 : 0;
      widget.value = next;
      this.sendUi(widget.id, "set", next).finally(() => this.endInteractionSoon());
    });
    const text = document.createElement("span");
    text.textContent = input.checked ? "on" : "off";
    input.addEventListener("change", () => {
      text.textContent = input.checked ? "on" : "off";
    });
    const switchTrack = document.createElement("span");
    switchTrack.className = "ui-live-switch";
    switchTrack.setAttribute("aria-hidden", "true");
    label.append(input, switchTrack, text);
    return label;
  }

  renderSlider(widget) {
    const wrap = document.createElement("div");
    wrap.className = "ui-live-slider";
    const value = document.createElement("strong");
    value.textContent = String(Math.round(toNumber(widget.value, 0)));
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(toNumber(widget.min, 0));
    input.max = String(toNumber(widget.max, 100));
    input.value = String(Math.round(toNumber(widget.value, 0)));
    input.disabled = !this.connected;
    input.addEventListener("input", () => {
      widget.value = Number(input.value);
      value.textContent = input.value;
      this.sendUiDebounced(widget.id, Number(input.value));
    });
    input.addEventListener("change", () => {
      this.flushDebouncedInput(widget.id);
      this.sendUi(widget.id, "set", Number(input.value)).finally(() => this.endInteractionSoon());
    });
    const range = document.createElement("span");
    range.textContent = `${Math.round(toNumber(widget.min, 0))} - ${Math.round(toNumber(widget.max, 100))}`;
    wrap.append(value, input, range);
    return wrap;
  }

  renderValue(widget) {
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    const value = clamp(toNumber(widget.value, min), min, max);
    const t = clamp((value - min) / (max - min || 1), 0, 1);
    const wrap = document.createElement("div");
    wrap.className = "ui-live-value";
    const number = document.createElement("strong");
    number.className = "ui-live-number";
    number.textContent = String(Math.round(value));
    const meter = document.createElement("span");
    meter.className = "ui-live-meter";
    meter.style.setProperty("--value", `${t * 100}%`);
    wrap.append(number, meter);
    return wrap;
  }

  renderGraph(widget) {
    const min = toNumber(widget.min, 0);
    const max = toNumber(widget.max, 100);
    const history = widget.history || [];
    const wrap = document.createElement("div");
    wrap.className = "ui-live-graph";
    const value = document.createElement("strong");
    value.className = "ui-live-number";
    value.textContent = String(Math.round(toNumber(widget.value, 0)));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 42");
    svg.setAttribute("preserveAspectRatio", "none");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("ui-live-graph-path");
    path.setAttribute("d", graphPath(history, min, max));
    svg.append(path);
    wrap.append(value, svg);
    return wrap;
  }

  patchWidgetDom(widget) {
    if (!this.root || !this.interacting) return;
    const node = this.root.querySelector(`[data-ui-id="${cssEscape(widget.id)}"]`);
    if (!node) return;

    const number = node.querySelector(".ui-live-number");
    if (number) number.textContent = String(Math.round(toNumber(widget.value, 0)));

    if (isGraph(widget)) {
      const path = node.querySelector(".ui-live-graph-path");
      if (path) {
        path.setAttribute("d", graphPath(widget.history || [], toNumber(widget.min, 0), toNumber(widget.max, 100)));
      }
      return;
    }

    if (widget.type === "value") {
      const min = toNumber(widget.min, 0);
      const max = toNumber(widget.max, 100);
      const value = clamp(toNumber(widget.value, min), min, max);
      const meter = node.querySelector(".ui-live-meter");
      if (meter) meter.style.setProperty("--value", `${clamp((value - min) / (max - min || 1), 0, 1) * 100}%`);
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

  beginInteraction() {
    this.interacting = true;
    window.clearTimeout(this.renderTimer);
  }

  endInteractionSoon() {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.interacting = false;
      if (this.renderPending) this.render();
    }, 160);
  }

  scheduleRender() {
    if (this.interacting) {
      this.renderPending = true;
      return;
    }
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), 0);
  }

  sendUiDebounced(id, value) {
    this.flushDebouncedInput(id);
    const timer = window.setTimeout(() => {
      this.inputSendTimers.delete(id);
      this.sendUi(id, "set", value, { quietErrors: true });
    }, 90);
    this.inputSendTimers.set(id, timer);
  }

  flushDebouncedInput(id) {
    const timer = this.inputSendTimers.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    this.inputSendTimers.delete(id);
  }
}

function sortedWidgets(widgets) {
  return [...widgets.values()].sort((a, b) => a.order - b.order);
}

function isGraph(widget) {
  return ["graph", "plot", "waveform"].includes(widget.type);
}

function cssType(type = "") {
  return String(type || "value").replace(/[^a-z0-9_-]/gi, "-");
}

function graphPath(history = [], min = 0, max = 100) {
  if (history.length < 2) return "";
  return history.map((value, index) => {
    const x = (index / Math.max(1, history.length - 1)) * 100;
    const y = 42 - clamp((toNumber(value, min) - min) / (max - min || 1), 0, 1) * 42;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}
