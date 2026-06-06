const CIRCUIT_VERSION = "0.1";
const WORLD_W = 1120;
const WORLD_H = 760;
const CIRCUIT_BG = "#ffffff";
const WIRE_POWER = "#e53935";
const WIRE_GROUND = "#111111";
const WIRE_SIGNALS = ["#c99700", "#27ae60", "#7e57c2", "#0097a7", "#ef6c00", "#1565c0", "#ad1457", "#558b2f", "#6d4c41"];
const WIRE_STROKE = 2.4;
const WIRE_CROSSING_GAP = 5.5;
const WIRE_RAIL_BASE_OFFSET = 32;
const WIRE_RAIL_PITCH = 14;
const WIRE_SIGNAL_MARGIN = 26;
const WIRE_SIGNAL_PITCH = 16;
const COMPONENT_TERMINAL_PITCH = 16;
const COMPONENT_TERMINAL_MIN_MARGIN = 8;
const COMPONENT_TERMINAL_MAX_MARGIN = 12;
const COMPONENT_LAYOUT_MIN_GAP = 72;
const COMPONENT_LINK_MARGIN = 24;
const NEOPIXEL_MAX_MA_PER_PIXEL = 60;
const BOARD_NEOPIXEL_POWER_BUDGET_MA = 500;

const pinDefs = [
  { pin: "VIN", side: "left", power: true, desc: "VIN / USB 5V" },
  { pin: "GND", side: "left", ground: true, desc: "Ground" },
  { pin: "13", side: "left", adc: true, pwm: true, desc: "GPIO13, ADC, PWM" },
  { pin: "12", side: "left", adc: true, pwm: true, caution: true, desc: "GPIO12, ADC, boot strap pin" },
  { pin: "14", side: "left", adc: true, pwm: true, desc: "GPIO14, ADC, PWM" },
  { pin: "27", side: "left", adc: true, pwm: true, desc: "GPIO27, ADC, PWM" },
  { pin: "26", side: "left", adc: true, dac: true, pwm: true, desc: "GPIO26, ADC, DAC, PWM" },
  { pin: "25", side: "left", adc: true, dac: true, pwm: true, desc: "GPIO25, ADC, DAC, PWM" },
  { pin: "33", side: "left", adc: true, pwm: true, desc: "GPIO33, ADC, PWM" },
  { pin: "32", side: "left", adc: true, pwm: true, desc: "GPIO32, ADC, PWM" },
  { pin: "35", side: "left", adc: true, inputOnly: true, desc: "GPIO35, ADC input only" },
  { pin: "34", side: "left", adc: true, inputOnly: true, desc: "GPIO34, ADC input only" },
  { pin: "39", side: "left", adc: true, inputOnly: true, desc: "GPIO39 / VN, ADC input only" },
  { pin: "36", side: "left", adc: true, inputOnly: true, desc: "GPIO36 / VP, ADC input only" },
  { pin: "EN", side: "left", caution: true, desc: "Enable/reset pin, not a GPIO" },

  { pin: "3V3", side: "right", power: true, desc: "3.3V power" },
  { pin: "GND3", side: "right", ground: true, label: "GND", desc: "Ground" },
  { pin: "15", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO15, ADC, PWM, boot strap pin" },
  { pin: "2", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO2, ADC, PWM, boot LED/strap" },
  { pin: "4", side: "right", adc: true, pwm: true, desc: "GPIO4, ADC, PWM, common LED strip data" },
  { pin: "16", side: "right", pwm: true, serial: "RX2", desc: "GPIO16, UART RX capable" },
  { pin: "17", side: "right", pwm: true, serial: "TX2", desc: "GPIO17, UART TX capable" },
  { pin: "5", side: "right", pwm: true, caution: true, desc: "GPIO5, boot strap pin" },
  { pin: "18", side: "right", pwm: true, desc: "GPIO18, SPI SCK capable" },
  { pin: "19", side: "right", pwm: true, desc: "GPIO19, SPI MISO capable" },
  { pin: "21", side: "right", pwm: true, i2c: "SDA", desc: "GPIO21, common I2C SDA" },
  { pin: "3", side: "right", serial: "RX0", caution: true, desc: "UART0 RX, USB serial transport" },
  { pin: "1", side: "right", serial: "TX0", caution: true, desc: "UART0 TX, USB serial transport" },
  { pin: "22", side: "right", pwm: true, i2c: "SCL", desc: "GPIO22, common I2C SCL" },
  { pin: "23", side: "right", pwm: true, desc: "GPIO23, SPI MOSI capable" },
];

const componentTypes = {
  button: { label: "Button", icon: "button", signal: "GPIO", needs: ["signal", "gnd"] },
  led: { label: "LED", icon: "light", signal: "GPIO", needs: ["signal", "gnd"] },
  ledStrip: { label: "NeoPixel strip", icon: "strip", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelRing: { label: "NeoPixel ring", icon: "ring", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelMatrix: { label: "LED matrix", icon: "matrix", signal: "Data", needs: ["data", "5v", "gnd"] },
  analogSensor: { label: "Analog sensor", icon: "sensor", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  digitalSensor: { label: "Digital sensor", icon: "sensor", signal: "GPIO", needs: ["signal", "3v3", "gnd"] },
  distanceSensor: { label: "Distance sensor", icon: "distance", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  ultrasonicSensor: { label: "Ultrasonic sensor", icon: "ultrasonic", signal: "Trig/Echo", needs: ["trigger", "echo", "5v", "gnd"] },
  microphone: { label: "Microphone", icon: "mic", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  joystick: { label: "Joystick", icon: "joystick", signal: "X/Y/SW", needs: ["x", "y", "sw", "3v3", "gnd"] },
  potentiometer: { label: "Potentiometer", icon: "pot", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  servo: { label: "Servo", icon: "servo", signal: "PWM", needs: ["signal", "5v", "gnd"] },
  servoLarge: { label: "Large servo", icon: "servo", signal: "PWM", needs: ["signal", "5v", "gnd"] },
  fan: { label: "Fan", icon: "fan", signal: "PWM", needs: ["signal", "power", "gnd"] },
  dcMotor: { label: "DC motor", icon: "motor", signal: "driver", needs: ["signal", "power", "gnd"] },
  stepperMotor: { label: "Stepper motor", icon: "stepper", signal: "STEP/DIR", needs: ["step", "dir", "en", "power", "gnd"] },
  buzzer: { label: "Buzzer", icon: "speaker", signal: "PWM", needs: ["signal", "gnd"] },
  relay: { label: "Relay", icon: "relay", signal: "GPIO", needs: ["signal", "power", "gnd"] },
  i2cDevice: { label: "I2C device", icon: "i2c", signal: "SDA/SCL", needs: ["sda", "scl", "3v3", "gnd"] },
  imu: { label: "IMU / MPU", icon: "imu", signal: "I2C", needs: ["sda", "scl", "3v3", "gnd"] },
  uartDevice: { label: "Serial device", icon: "uart", signal: "RX/TX", needs: ["rx", "tx", "gnd"] },
  mp3Player: { label: "MP3 player", icon: "mp3", signal: "RX/TX", needs: ["rx", "tx", "power", "gnd"] },
  touchPad: { label: "Touch input", icon: "touch", signal: "Touch", needs: ["signal"] },
  wifiService: { label: "WiFi / API", icon: "cloud", signal: "Network", needs: [] },
  powerSupply: { label: "External 5V supply", icon: "power", signal: "5V", needs: ["5v", "gnd"] },
  backEmfDiode: { label: "Back EMF diode", icon: "diode", signal: "Clamp", needs: ["5v", "gnd"] },
  unknown: { label: "Unknown part", icon: "question", signal: "?", needs: ["signal"] },
};

export function inferCircuitLayout(code, chatLayout = null) {
  const source = String(code || "");
  const parsed = inferFromSource(source);
  if (!chatLayout || typeof chatLayout !== "object") return parsed;
  return {
    ...parsed,
    assumptions: dedupe([...(parsed.assumptions || []), ...stringArray(chatLayout.assumptions)]),
    notes: dedupe([...(parsed.notes || []), ...stringArray(chatLayout.notes)]),
  };
}

export function normalizeCircuitLayout(layout) {
  if (!layout || typeof layout !== "object") return null;
  const board = {
    type: "esp32-classic",
    x: numberOr(layout.board?.x, 410),
    y: numberOr(layout.board?.y, 80),
    w: numberOr(layout.board?.w, 180),
    h: numberOr(layout.board?.h, 470),
  };
  const components = Array.isArray(layout.components)
    ? layout.components.map((component, index) => normalizeComponent(component, index)).filter(Boolean)
    : [];
  const connections = Array.isArray(layout.connections)
    ? layout.connections.map((connection, index) => normalizeConnection(connection, index)).filter(Boolean)
    : [];
  const placed = placeComponents(components, connections, board);
  return {
    version: String(layout.version || CIRCUIT_VERSION),
    board,
    components: placed,
    connections,
    assumptions: stringArray(layout.assumptions),
    notes: stringArray(layout.notes),
  };
}

export function initCircuitView({ mount, componentList, assumptions, pinInfo, alternatives, onComponentOverride } = {}) {
  let model = normalizeCircuitLayout({});
  let hoveredPin = null;
  let selectedComponentId = "";
  let dragging = null;
  let p5Instance = null;
  let renderMode = "symbols";
  let transform = { scale: 1, ox: 0, oy: 0 };

  const setModel = (nextModel) => {
    model = normalizeCircuitLayout(nextModel) || normalizeCircuitLayout({});
    if (selectedComponentId && !model.components.some((component) => component.id === selectedComponentId)) selectedComponentId = "";
    renderSidePanel(model);
    renderAlternatives();
    if (p5Instance) p5Instance.redraw();
  };

  const resize = () => {
    if (!p5Instance || !mount) return;
    const rect = mount.getBoundingClientRect();
    p5Instance.resizeCanvas(Math.max(320, rect.width), Math.max(260, rect.height));
    p5Instance.redraw();
  };

  const downloadPng = (filename = "p1e-circuit.png") => {
    const canvas = p5Instance?.canvas;
    if (!canvas) return false;
    p5Instance.redraw();
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  };

  if (!mount) return { setModel, resize, downloadPng, getModel: () => model };

  if (!window.p5) {
    mount.textContent = "Circuit canvas unavailable.";
    return { setModel, resize, downloadPng, getModel: () => model };
  }

  if (alternatives) {
    ["pointerdown", "mousedown", "mouseup", "pointerup"].forEach((name) => {
      alternatives.addEventListener(name, (event) => event.stopPropagation());
    });
  }

  p5Instance = new window.p5((p) => {
    p.setup = () => {
      const rect = mount.getBoundingClientRect();
      p.createCanvas(Math.max(320, rect.width), Math.max(260, rect.height));
      p.noLoop();
    };
    p.draw = () => {
      p.background(CIRCUIT_BG);
      transform = computeTransform(p.width, p.height);
      p.push();
      p.translate(transform.ox, transform.oy);
      p.scale(transform.scale);
      drawConnections(p, model, renderMode);
      drawBoard(p, model.board, hoveredPin);
      drawComponents(p, model.components, selectedComponentId, renderMode, model.board);
      p.pop();
      drawCircuitNote(p, model);
    };
    p.mouseMoved = () => {
      if (dragging) return;
      const world = screenToWorld(p.mouseX, p.mouseY, transform);
      const next = hitPin(world, model.board);
      if ((next?.pin || "") !== (hoveredPin?.pin || "")) {
        hoveredPin = next;
        renderPinInfo(hoveredPin);
        p.redraw();
      }
    };
    p.mousePressed = () => {
      const world = screenToWorld(p.mouseX, p.mouseY, transform);
      const component = hitComponent(world, model.components);
      if (!component) {
        selectedComponentId = "";
        renderAlternatives();
        p.redraw();
        return;
      }
      selectedComponentId = component.id;
      renderAlternatives();
      p.redraw();
      dragging = { id: component.id, dx: component.x - world.x, dy: component.y - world.y };
    };
    p.mouseDragged = () => {
      if (!dragging) return;
      const component = model.components.find((item) => item.id === dragging.id);
      if (!component) return;
      const world = screenToWorld(p.mouseX, p.mouseY, transform);
      component.x = clamp(world.x + dragging.dx, 60, WORLD_W - 60);
      component.y = clamp(world.y + dragging.dy, 44, WORLD_H - 44);
      renderSidePanel(model);
      p.redraw();
    };
    p.mouseReleased = () => {
      dragging = null;
    };
    p.windowResized = resize;
  }, mount);

  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  setModel(model);
  const setRenderMode = (mode = "symbols") => {
    renderMode = mode === "illustrations" ? "illustrations" : "symbols";
    if (p5Instance) p5Instance.redraw();
  };
  return { setModel, resize, downloadPng, getModel: () => model, setRenderMode };

  function renderSidePanel(nextModel) {
    if (componentList) {
      componentList.replaceChildren();
      if (!nextModel.components.length) {
        componentList.append(makeSmallLine("No concrete parts found yet."));
      } else {
        nextModel.components.forEach((component) => {
          const item = document.createElement("li");
          const title = document.createElement("strong");
          title.textContent = componentDisplayLabel(component);
          const meta = document.createElement("span");
          meta.textContent = component.inferredFrom || component.kind || component.type;
          item.append(title, meta);
          componentList.append(item);
        });
      }
    }
    if (assumptions) {
      assumptions.replaceChildren();
      const lines = compactCircuitNotes(nextModel.assumptions, nextModel.notes).slice(0, 8);
      if (!lines.length) assumptions.append(makeSmallLine("Clear enough."));
      lines.forEach((line) => assumptions.append(makeSmallLine(line)));
    }
  }

  function renderPinInfo(pin) {
    if (!pinInfo) return;
    pinInfo.textContent = pin ? `${pin.label || pin.pin}: ${pin.desc}` : "Hover a pin.";
  }

  function renderAlternatives() {
    if (!alternatives) return;
    alternatives.replaceChildren();
    const component = model.components.find((item) => item.id === selectedComponentId);
    if (!component) {
      alternatives.hidden = true;
      return;
    }
    alternatives.hidden = false;
    const title = document.createElement("strong");
    title.textContent = componentDisplayLabel(component);
    alternatives.append(title);
    componentAlternatives(component).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.label;
      button.classList.toggle("is-active", option.type === component.type);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onComponentOverride?.({ component, type: option.type, label: option.label });
      });
      alternatives.append(button);
    });
  }
}

function componentAlternatives(component) {
  const group = componentAlternativeGroup(component?.type);
  const typeOptions = Object.keys(componentTypes)
    .filter((type) => type !== "unknown" && type !== "wifiService" && type !== "powerSupply" && type !== "backEmfDiode")
    .filter((type) => componentAlternativeGroup(type) === group);
  return dedupe([component?.type, ...typeOptions])
    .filter((type) => componentTypes[type])
    .map((type) => ({ type, label: componentTypes[type].label }));
}

function componentAlternativeGroup(type) {
  if (["led", "relay", "buzzer", "servo", "servoLarge", "fan", "dcMotor", "stepperMotor"].includes(type)) return "gpio-output";
  if (["button", "digitalSensor", "touchPad"].includes(type)) return "gpio-input";
  if (["analogSensor", "distanceSensor", "microphone", "potentiometer"].includes(type)) return "adc-input";
  if (["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) return "addressable-led";
  if (["i2cDevice", "imu"].includes(type)) return "i2c";
  if (["uartDevice", "mp3Player"].includes(type)) return "uart";
  if (type === "joystick") return "multi-adc";
  if (type === "ultrasonicSensor") return "trigger-echo";
  return String(type || "unknown");
}

function inferFromSource(source) {
  const vars = parseNumericVars(source);
  const arrays = parseNumericArrays(source);
  const hints = parseCircuitHints(source);
  const lower = source.toLowerCase();
  const components = [];
  const connections = [];
  const assumptions = [];
  const notes = [];
  const seen = new Set();

  const add = (type, pin, options = {}) => {
    const idBase = `${type}-${pin || options.id || components.length}`;
    const id = uniqueId(idBase, seen);
    const typeDef = componentTypes[type] || componentTypes.unknown;
    const component = {
      id,
      type,
      label: options.label || typeDef.label,
      pin: pin ? String(pin) : "",
      pins: options.pins || {},
      inferredFrom: options.inferredFrom || "",
      confidence: numberOr(options.confidence, 0.65),
    };
    components.push(component);
    addDefaultConnections(component, connections, assumptions);
    return component;
  };

  hints.forEach((hint) => {
    add(hint.type, hint.pin, {
      label: componentTypes[hint.type]?.label || hint.type,
      inferredFrom: "p1e-circuit comment",
      confidence: 0.99,
    });
  });

  addStepperFromNamedPins(vars, add, components);
  addNamedPinComponents(vars, arrays, add, components);

  const triggerPin = findNamedPin(vars, /(trig|trigger)/i);
  const echoPin = findNamedPin(vars, /echo/i);
  const hasUltrasonicPins = (/ultrasonic|distance|hc-?sr04/i.test(source)) && triggerPin !== null && echoPin !== null;
  const joystickAnalogPins = lower.includes("joystick")
    ? collectCalls(source, "analogRead").map((args) => resolvePin(args[0], vars)).filter((value) => value !== null)
    : [];
  const joystickSwitchPin = lower.includes("joystick")
    ? findNamedPin(vars, /(sw|switch|button|btn)/i)
    : null;
  const hasJoystickPins = joystickAnalogPins.length >= 2;

  collectCalls(source, "ledConfig").forEach((args) => {
    const strip = resolvePin(args[0], vars) ?? args[0] ?? "0";
    const pin = resolvePin(args[1], vars);
    const count = resolvePin(args[2], vars);
    if (pin === null) return;
    const type = ledComponentType(lower, count);
    add(type, pin, {
      label: count ? `${componentTypes[type].label} (${count})` : componentTypes[type].label,
      pins: { data: String(pin), strip: String(strip), count: count ? String(count) : "" },
      inferredFrom: "ledConfig",
      confidence: 0.95,
    });
  });

  collectCalls(source, "pinMode").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin === null) return;
    if (hasUltrasonicPins && (pin === triggerPin || pin === echoPin)) return;
    if (hasJoystickPins && (joystickAnalogPins.includes(pin) || pin === joystickSwitchPin)) return;
    if (hasPin(components, pin)) return;
    const mode = String(args[1] || "").toUpperCase();
    if (mode.includes("INPUT_PULLUP") || mode === "2") {
      add("button", pin, { label: likelyLabel(lower, "button", "Button"), inferredFrom: "pinMode INPUT_PULLUP", confidence: 0.9 });
      assumptions.push(`GPIO ${pin} uses INPUT_PULLUP, so the drawing assumes a button or switch to GND.`);
    } else if (mode.includes("INPUT") || mode === "0") {
      add("digitalSensor", pin, { inferredFrom: "pinMode INPUT", confidence: 0.68 });
    } else if (mode.includes("OUTPUT") || mode === "1") {
      add(outputTypeFromPinExpr(args[0]), pin, { inferredFrom: "pinMode OUTPUT", confidence: 0.62 });
    }
  });

  collectCalls(source, "digitalRead").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (hasUltrasonicPins && pin === echoPin) return;
    if (hasJoystickPins && pin === joystickSwitchPin) return;
    if (pin !== null && !hasPin(components, pin)) {
      add(likelyButton(source, pin) ? "button" : "digitalSensor", pin, { inferredFrom: "digitalRead", confidence: 0.72 });
    }
  });

  collectCalls(source, "digitalWrite").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (hasUltrasonicPins && pin === triggerPin) return;
    if (pin !== null && !hasPin(components, pin)) {
      add(outputTypeFromPinExpr(args[0]), pin, { inferredFrom: "digitalWrite", confidence: 0.62 });
    }
  });

  if (hasUltrasonicPins) {
    add("ultrasonicSensor", "", {
      pins: { trigger: String(triggerPin), echo: String(echoPin) },
      inferredFrom: "trigger/echo distance sensor pins",
      confidence: 0.86,
    });
  }

  collectCalls(source, "analogRead").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) {
      if (lower.includes("joystick") && addJoystickFromAnalogReads(source, vars, add)) return;
      add(analogComponentType(lower, source, pin, args[0]), pin, { inferredFrom: "analogRead", confidence: 0.82 });
    }
  });

  collectCalls(source, "touchRead").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) {
      add("touchPad", pin, { inferredFrom: "touchRead", confidence: 0.75 });
    }
  });

  collectCalls(source, "analogWrite").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) {
      add(outputTypeFromPinExpr(args[0]), pin, { inferredFrom: "analogWrite", confidence: 0.65 });
    }
  });

  collectCalls(source, "tone").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) {
      add("buzzer", pin, { inferredFrom: "tone", confidence: 0.88 });
    }
  });

  collectCalls(source, "servoAttach").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) add("servo", pin, { inferredFrom: "servoAttach", confidence: 0.94 });
  });

  collectCalls(source, "fanAttach").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null && !hasPin(components, pin)) add("fan", pin, { inferredFrom: "fanAttach", confidence: 0.94 });
  });

  collectCalls(source, "wireBegin").forEach((args) => {
    const sda = resolvePin(args[0], vars) ?? 21;
    const scl = resolvePin(args[1], vars) ?? 22;
    add(i2cComponentType(lower), "", { pins: { sda: String(sda), scl: String(scl) }, inferredFrom: "wireBegin", confidence: 0.82 });
  });

  collectCalls(source, "serialBegin").forEach((args) => {
    const rx = resolvePin(args[1], vars);
    const tx = resolvePin(args[2], vars);
    add(serialComponentType(lower), "", {
      pins: { rx: rx !== null ? String(rx) : "?", tx: tx !== null ? String(tx) : "?" },
      inferredFrom: "serialBegin",
      confidence: 0.8,
    });
  });

  if (/\b(httpGet|fetchJson|httpJsonGet|wifiConnected|wifiConnect)\s*\(/.test(source)) {
    add("wifiService", "", { id: "wifi", label: "WiFi / web API", inferredFrom: "WiFi or HTTP binding", confidence: 0.7 });
  }

  if (!components.length && source.trim()) {
    const guessedPin = firstNumberNearHardwareWord(source);
    add("unknown", guessedPin ? String(guessedPin) : "", { label: "Possible component", confidence: 0.25 });
    assumptions.push("No direct hardware binding was obvious, so the drawing leaves a question-mark part.");
  }
  pruneDuplicateSignalPins(components, connections);
  addExternalPowerPlan(components, connections, assumptions, notes, seen);

  return normalizeCircuitLayout({
    version: CIRCUIT_VERSION,
    board: { type: "esp32-classic", x: (WORLD_W - 180) / 2, y: 100, w: 180, h: 470 },
    components,
    connections,
    assumptions: dedupe(assumptions),
    notes,
  });
}

function parseNumericVars(source) {
  const vars = new Map();
  for (const match of source.matchAll(/\bvar\s+([A-Za-z_]\w*)\s*=\s*(-?\d+)\s*;/g)) {
    vars.set(match[1], Number(match[2]));
  }
  return vars;
}

function parseNumericArrays(source) {
  const arrays = new Map();
  for (const match of source.matchAll(/\bvar\s+([A-Za-z_]\w*)\s*\[\]\s*=\s*\{([^}]*)\}\s*;/g)) {
    const values = [];
    for (const item of match[2].split(",")) {
      const text = item.trim();
      if (/^-?\d+$/.test(text)) values.push(Number(text));
    }
    if (values.length) arrays.set(match[1], values);
  }
  return arrays;
}

function parseCircuitHints(source) {
  const hints = [];
  for (const match of String(source || "").matchAll(/\/\/\s*p1e-circuit:\s*(?:IO|GPIO)?\s*(\d{1,2})\s+([^\n;]+)/gi)) {
    const type = componentTypeFromCircuitHint(match[2]);
    if (type) hints.push({ pin: String(match[1]), type });
  }
  return hints;
}

function componentTypeFromCircuitHint(text) {
  const key = String(text || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const words = String(text || "").toLowerCase();
  const phraseAliases = [
    [/large\s*servo|big\s*servo|high\s*torque\s*servo|high\s*power\s*servo|servolarge/, "servoLarge"],
    [/neo\s*pixel\s*matrix|led\s*matrix|pixel\s*matrix/, "neopixelMatrix"],
    [/neo\s*pixel\s*(strip|string|bar)|led\s*(strip|string|bar)|pixel\s*(strip|string|bar)/, "ledStrip"],
    [/neo\s*pixel\s*ring|pixel\s*ring/, "neopixelRing"],
    [/potentiometer|pot|knob|dial/, "potentiometer"],
    [/distance\s*sensor|proximity\s*sensor/, "distanceSensor"],
    [/microphone|mic|sound\s*sensor/, "microphone"],
    [/analog\s*sensor/, "analogSensor"],
    [/digital\s*sensor/, "digitalSensor"],
    [/dc\s*motor/, "dcMotor"],
    [/stepper\s*motor|stepper/, "stepperMotor"],
  ];
  const phrase = phraseAliases.find(([pattern]) => pattern.test(words))?.[1];
  if (phrase && componentTypes[phrase]) return phrase;
  const aliases = {
    analog: "analogSensor",
    analogsensor: "analogSensor",
    button: "button",
    buzzer: "buzzer",
    dcmotor: "dcMotor",
    digitalsensor: "digitalSensor",
    distancesensor: "distanceSensor",
    fan: "fan",
    led: "led",
    ledmatrix: "neopixelMatrix",
    ledstrip: "ledStrip",
    matrix: "neopixelMatrix",
    microphone: "microphone",
    mic: "microphone",
    neopixel: "ledStrip",
    neopixelmatrix: "neopixelMatrix",
    neopixelring: "neopixelRing",
    neopixelstrip: "ledStrip",
    pot: "potentiometer",
    potentiometer: "potentiometer",
    relay: "relay",
    sensor: "analogSensor",
    bigservo: "servoLarge",
    highpowerservo: "servoLarge",
    hightorqueservo: "servoLarge",
    largeservo: "servoLarge",
    servo: "servo",
    servolarge: "servoLarge",
    stepper: "stepperMotor",
    steppermotor: "stepperMotor",
    switch: "button",
    touch: "touchPad",
    touchpad: "touchPad",
  };
  const type = aliases[key] || key;
  return componentTypes[type] ? type : "";
}

function addNamedPinComponents(vars, arrays, add, components) {
  arrays.forEach((pins, name) => {
    const kind = componentTypeFromName(name);
    if (!kind) return;
    pins.forEach((pin, index) => {
      if (hasPin(components, pin)) return;
      add(kind.type, pin, {
        label: numberedComponentLabel(kind.label, index),
        inferredFrom: `${name}[]`,
        confidence: kind.confidence,
      });
    });
  });

  vars.forEach((pin, name) => {
    if (!/pin$/i.test(name) || hasPin(components, pin)) return;
    const kind = componentTypeFromName(name);
    if (!kind) return;
    add(kind.type, pin, {
      label: kind.label,
      inferredFrom: name,
      confidence: kind.confidence,
    });
  });
}

function addStepperFromNamedPins(vars, add, components) {
  const step = findNamedPin(vars, /(step|pulse|pul|clk).*pin$/i);
  const dir = findNamedPin(vars, /(dir|direction).*pin$/i);
  if (step === null || dir === null) return false;
  if (hasPin(components, step) || hasPin(components, dir)) return false;
  const en = findNamedPin(vars, /(\ben|enable).*pin$/i);
  const pins = { step: String(step), dir: String(dir) };
  if (en !== null) pins.en = String(en);
  add("stepperMotor", "", {
    pins,
    inferredFrom: "step/dir pin variables",
    confidence: 0.92,
  });
  return true;
}

function pruneDuplicateSignalPins(components, connections) {
  const bestByPin = new Map();
  const removeIds = new Set();
  components.forEach((component) => {
    const pin = componentSignalPin(component);
    if (!pin) return;
    const existing = bestByPin.get(pin);
    if (!existing) {
      bestByPin.set(pin, component);
      return;
    }
    const winner = preferredSignalComponent(existing, component);
    const loser = winner === existing ? component : existing;
    bestByPin.set(pin, winner);
    removeIds.add(loser.id);
  });
  if (!removeIds.size) return;
  for (let index = components.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(components[index].id)) components.splice(index, 1);
  }
  for (let index = connections.length - 1; index >= 0; index -= 1) {
    if (removeIds.has(connections[index].from?.component) || removeIds.has(connections[index].to?.component)) {
      connections.splice(index, 1);
    }
  }
}

function preferredSignalComponent(left, right) {
  const diff = signalComponentPriority(right) - signalComponentPriority(left);
  if (diff > 0) return right;
  if (diff < 0) return left;
  return numberOr(right.confidence, 0) > numberOr(left.confidence, 0) ? right : left;
}

function signalComponentPriority(component) {
  if (/p1e-circuit comment/i.test(component?.inferredFrom || "")) return 1000;
  if (isNeoPixelType(component?.type)) return 100;
  if (["servo", "fan", "dcMotor", "stepperMotor", "relay", "buzzer"].includes(component?.type)) return 80;
  if (["analogSensor", "digitalSensor", "distanceSensor", "microphone", "joystick", "potentiometer", "touchPad"].includes(component?.type)) return 70;
  if (component?.type === "button") return 60;
  if (component?.type === "led") return 20;
  return 40;
}

function componentSignalPin(component) {
  return String(
    component?.pins?.data
    || component?.pins?.signal
    || component?.pins?.trigger
    || component?.pins?.sda
    || component?.pins?.rx
    || component?.pin
    || "",
  );
}

function componentTypeFromName(name) {
  const lower = String(name || "").toLowerCase();
  if (/button|btn|switch/.test(lower)) return { type: "button", label: "Button", confidence: 0.94 };
  if (/buzzer|speaker/.test(lower)) return { type: "buzzer", label: "Buzzer", confidence: 0.94 };
  if (/relay/.test(lower)) return { type: "relay", label: "Relay", confidence: 0.94 };
  if (/(large|big|high.?torque|high.?power).{0,16}servo|servo.{0,16}(large|big|high.?torque|high.?power)/.test(lower)) return { type: "servoLarge", label: "Large servo", confidence: 0.92 };
  if (/servo/.test(lower)) return { type: "servo", label: "Servo", confidence: 0.9 };
  if (/fan/.test(lower)) return { type: "fan", label: "Fan", confidence: 0.9 };
  if (/pot|knob|dial/.test(lower)) return { type: "potentiometer", label: "Potentiometer", confidence: 0.92 };
  if (/microphone|mic|sound/.test(lower)) return { type: "microphone", label: "Microphone", confidence: 0.9 };
  if (/distance|proximity|sharp/.test(lower)) return { type: "distanceSensor", label: "Distance sensor", confidence: 0.88 };
  if (/analog|adc|sensor/.test(lower)) return { type: "analogSensor", label: "Analog sensor", confidence: 0.86 };
  if (/led|light/.test(lower)) return { type: "led", label: "LED", confidence: 0.9 };
  return null;
}

function numberedComponentLabel(label, index) {
  return `${label} ${index + 1}`;
}

function collectCalls(source, name) {
  const calls = [];
  const re = new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, "g");
  for (const match of source.matchAll(re)) {
    calls.push(splitArgs(match[1]));
  }
  return calls;
}

function splitArgs(text) {
  const args = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function resolvePin(expr, vars) {
  const value = String(expr || "").trim();
  if (!value) return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (vars.has(value)) return vars.get(value);
  return null;
}

function findNamedPin(vars, pattern) {
  for (const [name, value] of vars.entries()) {
    if (pattern.test(name)) return value;
  }
  return null;
}

function outputTypeFromContext(lower) {
  if (lower.includes("relay")) return "relay";
  if (lower.includes("buzz") || lower.includes("tone") || lower.includes("speaker")) return "buzzer";
  if (lower.includes("stepper")) return "stepperMotor";
  if (lower.includes("dc motor") || lower.includes("motor")) return "dcMotor";
  if (lower.includes("fan") || lower.includes("motor")) return "fan";
  return "led";
}

function outputTypeFromPinExpr(expr) {
  return componentTypeFromName(expr)?.type || "led";
}

function ledComponentType(lower, count) {
  if (lower.includes("strip")) return "ledStrip";
  if (lower.includes("ring") || lower.includes("circle")) return "neopixelRing";
  if (lower.includes("matrix")) return "ledStrip";
  return "ledStrip";
}

function analogComponentType(lower, source, pin, expr = "") {
  const local = String(expr || "").toLowerCase();
  if (local.includes("pot") || local.includes("knob") || local.includes("dial")) return "potentiometer";
  if (local.includes("microphone") || local.includes("mic") || local.includes("sound") || local.includes("volume")) return "microphone";
  if (local.includes("distance") || local.includes("proximity") || local.includes("sharp")) return "distanceSensor";
  if (lower.includes("microphone") || lower.includes("mic") || lower.includes("sound") || lower.includes("volume")) return "microphone";
  if (lower.includes("distance") || lower.includes("proximity") || lower.includes("ir sensor") || lower.includes("sharp")) return "distanceSensor";
  if (lower.includes("pot") || lower.includes("knob") || lower.includes("dial")) return "potentiometer";
  const analogReads = collectCalls(source, "analogRead").map((args) => resolvePin(args[0], parseNumericVars(source))).filter((value) => value !== null);
  if (analogReads.length >= 2 && analogReads.includes(pin)) return "joystick";
  return "analogSensor";
}

function addJoystickFromAnalogReads(source, vars, add) {
  const analogPins = collectCalls(source, "analogRead")
    .map((args) => resolvePin(args[0], vars))
    .filter((value) => value !== null);
  if (analogPins.length < 2) return false;
  const swPin = findNamedPin(vars, /(sw|switch|button|btn)/i) ?? collectCalls(source, "digitalRead")
    .map((args) => resolvePin(args[0], vars))
    .find((value) => value !== null);
  const pins = { x: String(analogPins[0]), y: String(analogPins[1]) };
  if (swPin !== undefined) pins.sw = String(swPin);
  add("joystick", "", { pins, inferredFrom: "analogRead joystick axes", confidence: 0.88 });
  return true;
}

function i2cComponentType(lower) {
  if (/\b(mpu|imu|gyro|accelerometer|gy-?85|6050)\b/i.test(lower)) return "imu";
  return "i2cDevice";
}

function serialComponentType(lower) {
  if (/\b(mp3|dfplayer|player|sound module)\b/i.test(lower)) return "mp3Player";
  return "uartDevice";
}

function likelyButton(source, pin) {
  const re = new RegExp(`(button|btn|switch|press|pullup|released|pressed|pinMode\\s*\\([^)]*${pin}[^)]*INPUT_PULLUP)`, "i");
  return re.test(source);
}

function likelyLabel(lower, keyword, fallback) {
  return lower.includes(keyword) ? fallback : fallback;
}

function firstNumberNearHardwareWord(source) {
  const match = source.match(/(?:pin|gpio|led|button|sensor|servo|fan|relay|buzzer)[^\n;]{0,24}\b(\d{1,2})\b/i);
  return match ? match[1] : "";
}

function hasPin(components, pin) {
  const value = String(pin);
  return components.some((component) => component.pin === value || Object.values(component.pins || {}).includes(value));
}

function addDefaultConnections(component, connections, assumptions) {
  const type = component.type;
  const pin = component.pin || component.pins?.signal || component.pins?.data;
  const id = component.id;
  if (type === "joystick") {
    if (component.pins?.x) connections.push({ from: { component: id, pin: "X" }, to: { boardPin: component.pins.x }, color: "#d6bd62", label: "X" });
    if (component.pins?.y) connections.push({ from: { component: id, pin: "Y" }, to: { boardPin: component.pins.y }, color: "#d6bd62", label: "Y" });
    if (component.pins?.sw) connections.push({ from: { component: id, pin: "SW" }, to: { boardPin: component.pins.sw }, color: "#8fc7d4", label: "SW" });
    connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    return;
  }
  if (type === "ultrasonicSensor") {
    if (component.pins?.trigger) connections.push({ from: { component: id, pin: "TRIG" }, to: { boardPin: component.pins.trigger }, color: "#59bdd0", label: "TRIG" });
    if (component.pins?.echo) connections.push({ from: { component: id, pin: "ECHO" }, to: { boardPin: component.pins.echo }, color: "#d6bd62", label: "ECHO" });
    connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "power" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    return;
  }
  if (type === "stepperMotor" && (component.pins?.step || component.pins?.dir)) {
    if (component.pins?.step) connections.push({ from: { component: id, pin: "STEP" }, to: { boardPin: component.pins.step }, color: "#59bdd0", label: "STEP" });
    if (component.pins?.dir) connections.push({ from: { component: id, pin: "DIR" }, to: { boardPin: component.pins.dir }, color: "#d6bd62", label: "DIR" });
    if (component.pins?.en) connections.push({ from: { component: id, pin: "EN" }, to: { boardPin: component.pins.en }, color: "#7e57c2", label: "EN" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    assumptions.push("Stepper motors should use a driver with external motor power; this drawing shows STEP/DIR control and common ground.");
    return;
  }
  if (pin) {
    connections.push({
      from: { component: id, pin: primaryComponentPin(type) },
      to: { boardPin: String(pin) },
      color: signalColor(type),
      label: componentTypes[type]?.signal || "signal",
    });
  }
  if (type === "button") {
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
  } else if (["led", "ledStrip", "neopixelRing", "neopixelMatrix", "analogSensor", "digitalSensor", "distanceSensor", "microphone", "joystick", "potentiometer", "servo", "servoLarge", "fan", "dcMotor", "stepperMotor", "buzzer", "relay"].includes(type)) {
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    if (["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) {
      if (!isNeoPixelType(type) || !needsExternalNeoPixelPower(component)) {
        connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "power" });
      }
      if (isNeoPixelType(type)) assumptions.push("NeoPixels need V, data, and GND; larger strips should use separate 5V power with common ground.");
    } else if (["servo", "servoLarge", "fan", "dcMotor", "stepperMotor", "relay"].includes(type)) {
      if (type === "servo") {
        connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "5V" });
      }
      if (!["servoLarge", "fan"].includes(type)) {
        assumptions.push(`${componentTypes[type]?.label || "This component"} needs suitable power; dense inferred diagrams show signal and common ground${type === "servo" ? "." : " and omit the board-crossing VIN lead."}`);
      }
      if (["dcMotor", "stepperMotor", "fan"].includes(type)) assumptions.push("Motors and fans should use a driver or transistor stage; this drawing shows the control signal and common ground.");
    } else if (["analogSensor", "digitalSensor", "distanceSensor", "microphone", "joystick", "potentiometer"].includes(type)) {
      connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    }
  } else if (type === "i2cDevice" || type === "imu") {
    if (component.pins?.sda) connections.push({ from: { component: id, pin: "SDA" }, to: { boardPin: component.pins.sda }, color: "#59bdd0", label: "SDA" });
    if (component.pins?.scl) connections.push({ from: { component: id, pin: "SCL" }, to: { boardPin: component.pins.scl }, color: "#d6bd62", label: "SCL" });
    connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
  } else if (type === "uartDevice" || type === "mp3Player") {
    if (component.pins?.rx && component.pins.rx !== "?") connections.push({ from: { component: id, pin: "RX" }, to: { boardPin: component.pins.rx }, color: "#59bdd0", label: "RX" });
    if (component.pins?.tx && component.pins.tx !== "?") connections.push({ from: { component: id, pin: "TX" }, to: { boardPin: component.pins.tx }, color: "#d6bd62", label: "TX" });
    if (type === "mp3Player") connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "power" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
  }
}

function addExternalPowerPlan(components, connections, assumptions, notes, seen) {
  const powered = [];
  components.forEach((component) => {
    if (component.type === "servoLarge") {
      powered.push({ component, diode: true, reason: "Large servo should use external 5V power with common ground and a back EMF protection diode." });
      return;
    }
    if (component.type === "fan") {
      powered.push({ component, reason: "Fan should use external power with common ground." });
      return;
    }
    if (isNeoPixelType(component.type)) {
      const count = neoPixelCount(component);
      if (!count) return;
      const currentMa = neoPixelCurrentMa(count);
      notes.push(`${component.label}: ${count} NeoPixels x ${NEOPIXEL_MAX_MA_PER_PIXEL} mA ~= ${formatCurrent(currentMa)} worst-case.`);
      if (currentMa > BOARD_NEOPIXEL_POWER_BUDGET_MA) {
        powered.push({
          component,
          reason: `${component.label}: ${count} NeoPixels can draw about ${formatCurrent(currentMa)} at full white, above the ${formatCurrent(BOARD_NEOPIXEL_POWER_BUDGET_MA)} board-power budget. Use an external 5V supply and common ground.`,
        });
      }
    }
  });
  if (!powered.length) return;

  const supply = {
    id: uniqueId("external-5v-supply", seen),
    type: "powerSupply",
    label: "External 5V supply",
    pin: "",
    pins: {},
    inferredFrom: "external power requirement",
    confidence: 0.9,
  };
  components.push(supply);
  rerouteVinPowerToExternalSupply(supply, components, connections);
  powered.forEach(({ component, reason, diode }) => {
    connections.push({ from: { component: supply.id, pin: "5V" }, to: { component: component.id, pin: "power" }, color: WIRE_POWER, label: "5V" });
    connections.push({ from: { component: supply.id, pin: "GND" }, to: { boardPin: "GND" }, color: "#8f9699", label: "common GND" });
    if (diode) {
      const protection = {
        id: uniqueId(`${component.id}-back-emf-diode`, seen),
        type: "backEmfDiode",
        label: "Back EMF diode",
        pin: "",
        pins: {},
        inferredFrom: "large servo protection",
        confidence: 0.86,
      };
      components.push(protection);
      connections.push({ from: { component: protection.id, pin: "5V" }, to: { component: component.id, pin: "power" }, color: WIRE_POWER, label: "diode +" });
      connections.push({ from: { component: protection.id, pin: "GND" }, to: { component: component.id, pin: "gnd" }, color: WIRE_GROUND, label: "diode -" });
    }
    assumptions.push(reason);
  });
}

function rerouteVinPowerToExternalSupply(supply, components, connections) {
  const componentIds = new Set(components.map((component) => component.id));
  let changed = 0;
  connections.forEach((connection) => {
    const componentId = connection.from?.component;
    if (!componentIds.has(componentId)) return;
    if (componentId === supply.id) return;
    if (connection.from?.pin !== "power") return;
    if (!/^vin$/i.test(String(connection.to?.boardPin || ""))) return;
    if (connections.some((candidate) => (
      candidate.from?.component === supply.id
      && candidate.from?.pin === "5V"
      && candidate.to?.component === componentId
      && candidate.to?.pin === "power"
    ))) return;
    connection.from = { component: supply.id, pin: "5V" };
    connection.to = { component: componentId, pin: "power" };
    connection.color = WIRE_POWER;
    connection.label = "5V";
    changed += 1;
  });
  return changed;
}

function isNeoPixelType(type) {
  return ["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type);
}

function neoPixelCount(component) {
  const count = Number(component?.pins?.count || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function neoPixelCurrentMa(count) {
  return Math.round(Number(count || 0) * NEOPIXEL_MAX_MA_PER_PIXEL);
}

function needsExternalNeoPixelPower(component) {
  const count = neoPixelCount(component);
  return count > 0 && neoPixelCurrentMa(count) > BOARD_NEOPIXEL_POWER_BUDGET_MA;
}

function formatCurrent(ma) {
  return ma >= 1000 ? `${(ma / 1000).toFixed(ma % 1000 ? 1 : 0)} A` : `${ma} mA`;
}

function primaryComponentPin(type) {
  if (["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) return "data";
  if (type === "touchPad") return "touch";
  return "signal";
}

function signalColor(type) {
  if (type === "button") return "#b8bec0";
  if (["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) return "#59bdd0";
  if (["analogSensor", "distanceSensor", "microphone", "joystick", "potentiometer"].includes(type)) return "#d6bd62";
  return "#8fc7d4";
}

function normalizeComponent(component, index) {
  if (!component || typeof component !== "object") return null;
  const requestedType = componentTypes[component.type] ? component.type : "unknown";
  const type = requestedType;
  const fallbackLabel = componentTypes[type].label;
  return {
    id: String(component.id || `${type}-${index}`),
    type,
    label: normalizeComponentLabel(component.label || fallbackLabel, requestedType),
    pin: component.pin !== undefined && component.pin !== null ? String(component.pin) : "",
    pins: normalizePins(component.pins),
    x: finiteOrNull(component.x),
    y: finiteOrNull(component.y),
    inferredFrom: String(component.inferredFrom || ""),
    confidence: clamp(numberOr(component.confidence, 0.5), 0, 1),
  };
}

function normalizeComponentLabel(label, type) {
  const text = String(label || "");
  return text;
}

function normalizeConnection(connection, index) {
  if (!connection || typeof connection !== "object") return null;
  const boardPin = connection.to?.boardPin ?? connection.boardPin ?? connection.pin ?? "";
  return {
    id: String(connection.id || `wire-${index}`),
    from: {
      component: String(connection.from?.component || connection.component || ""),
      pin: String(connection.from?.pin || connection.componentPin || ""),
    },
    to: {
      boardPin: String(boardPin),
      component: String(connection.to?.component || ""),
      pin: String(connection.to?.pin || ""),
    },
    color: String(connection.color || "#8fc7d4"),
    label: String(connection.label || ""),
    assumption: String(connection.assumption || ""),
  };
}

function normalizePins(pins) {
  if (!pins || typeof pins !== "object") return {};
  const out = {};
  Object.entries(pins).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") out[String(key)] = String(value);
  });
  return out;
}

function placeComponents(components, connections = [], board = null) {
  const left = [];
  const right = [];
  components.forEach((component, index) => {
    const side = componentPlacementSide(component, connections, index, board, components);
    if (side === "right") right.push(component);
    else left.push(component);
  });
  const boardCenter = board ? board.x + board.w / 2 : WORLD_W / 2;
  placeSideComponents(left, Math.max(118, boardCenter - 410), connections, board);
  placeSideComponents(right, Math.min(WORLD_W - 118, boardCenter + 410), connections, board);
  return components;
}

function placeSideComponents(items, x, connections, board) {
  const fallbackGap = items.length > 1 ? clamp((WORLD_H - 190) / (items.length - 1), 78, 108) : 90;
  const preferred = new Map();
  items.forEach((component, index) => {
    if (!Number.isFinite(component.x) && component.type !== "powerSupply") component.x = x;
    if (Number.isFinite(component.y)) {
      preferred.set(component.id, { y: component.y, locked: true });
      return;
    }
    const directY = componentDirectPinY(component, connections, board);
    preferred.set(component.id, {
      y: Number.isFinite(directY) ? directY : 96 + index * fallbackGap,
      locked: false,
    });
  });
  const flexible = new Set(items.filter((component) => component.type === "powerSupply").map((component) => component.id));
  const placed = items
    .filter((component) => !flexible.has(component.id))
    .map((component) => ({ component, ...(preferred.get(component.id) || { y: 96, locked: false }) }))
    .sort((left, right) => left.y - right.y);
  resolveVerticalComponentGaps(placed);
  placed.forEach((entry) => {
    if (!entry.locked) entry.component.y = entry.y;
  });
  items
    .filter((component) => flexible.has(component.id))
    .forEach((component) => placeFlexiblePowerSupply(component, connections, items, board, x));
}

function componentDirectPinY(component, connections, board) {
  if (!board) return null;
  const connection = connections.find((item) => (
    item.from?.component === component.id
    && item.to?.boardPin
    && !isRailBoardPin(item.to.boardPin)
  ));
  const targetConnection = !connection && component.type === "backEmfDiode"
    ? connectionForComponentTarget(component, connections)
    : null;
  const pos = connection
    ? pinPositionForComponent(board, connection.to.boardPin, component)
    : pinPositionForComponent(board, targetConnection?.to?.boardPin, component);
  return pos?.y ?? null;
}

function placeFlexiblePowerSupply(component, connections, sideItems, board, fallbackX) {
  if (Number.isFinite(component.x) && Number.isFinite(component.y)) return;
  const target = powerSupplyTarget(component, connections, sideItems);
  if (!target || !board) {
    if (!Number.isFinite(component.x)) component.x = fallbackX;
    if (!Number.isFinite(component.y)) component.y = 96;
    return;
  }
  if (!Number.isFinite(component.x)) component.x = fallbackX;
  if (!Number.isFinite(component.y)) component.y = nearestPowerSupplyColumnY(component, target, sideItems);
}

function powerSupplyTarget(component, connections, sideItems) {
  const targets = connections
    .filter((item) => item.from?.component === component.id && item.to?.component)
    .map((item) => item.to.component);
  return targets
    .map((id) => sideItems.find((item) => item.id === id))
    .find(Boolean) || null;
}

function nearestPowerSupplyColumnY(component, target, sideItems) {
  const top = 70;
  const bottom = WORLD_H - 76;
  const gap = componentPlacementGap(component, target);
  const preferred = [
    target.y + gap,
    target.y - gap,
    target.y + gap * 2,
    target.y - gap * 2,
  ].map((y) => clamp(y, top, bottom));
  const scan = [];
  for (let y = top; y <= bottom; y += 6) scan.push(y);
  const candidates = uniqueNumbers([...preferred, ...scan]);
  const blockers = sideItems.filter((item) => item.id !== component.id);
  const score = (candidate, overlapWeight = 10) => blockers.reduce((total, item) => {
    if (!Number.isFinite(item.y)) return total;
    return total + Math.max(0, componentPlacementGap(component, item) - Math.abs(candidate - item.y)) * overlapWeight;
  }, nearestDistance(candidate, preferred) + Math.abs(candidate - target.y) * 0.02);
  const open = candidates
    .filter((candidate) => blockers.every((item) => {
      if (!Number.isFinite(item.y)) return true;
      return Math.abs(candidate - item.y) >= componentPlacementGap(component, item);
    }))
    .sort((left, right) => score(left, 0) - score(right, 0))[0];
  if (Number.isFinite(open)) return open;
  return candidates
    .map((candidate) => ({
      y: candidate,
      score: score(candidate),
    }))
    .sort((left, right) => left.score - right.score)[0]?.y ?? target.y;
}

function uniqueNumbers(values) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  });
  return out;
}

function nearestDistance(value, candidates) {
  return candidates.reduce((best, candidate) => Math.min(best, Math.abs(value - candidate)), Infinity);
}

function resolveVerticalComponentGaps(entries) {
  const top = 70;
  const bottom = WORLD_H - 76;
  entries.forEach((entry) => {
    entry.y = clamp(entry.y, top, bottom);
  });
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    const minGap = componentPlacementGap(previous.component, current.component);
    if (!current.locked && current.y < previous.y + minGap) current.y = previous.y + minGap;
  }
  const overflow = entries.length ? entries[entries.length - 1].y - bottom : 0;
  if (overflow > 0) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (!entries[index].locked) entries[index].y -= overflow;
    }
    for (let index = entries.length - 2; index >= 0; index -= 1) {
      const next = entries[index + 1];
      const current = entries[index];
      const minGap = componentPlacementGap(current.component, next.component);
      if (!current.locked && current.y > next.y - minGap) current.y = next.y - minGap;
    }
  }
  entries.forEach((entry) => {
    entry.y = clamp(entry.y, top, bottom);
  });
}

function componentPlacementGap(left, right) {
  const supportExtra = isCircuitSupportPart(left?.type) || isCircuitSupportPart(right?.type) ? 34 : 0;
  return Math.max(
    COMPONENT_LAYOUT_MIN_GAP,
    componentBodyHeight(left?.type) / 2 + componentBodyHeight(right?.type) / 2 + 32 + supportExtra,
  );
}

function isCircuitSupportPart(type) {
  return type === "powerSupply" || type === "backEmfDiode";
}

function isRailBoardPin(pinName) {
  return /^(g|gnd|ground|vin|vcc|3v3|3\.3v|5v|\+)$/i.test(String(pinName || ""));
}

function componentPlacementSide(component, connections, index, board = null, components = []) {
  const center = board ? board.x + board.w / 2 : WORLD_W / 2;
  if (Number.isFinite(component.x)) return component.x < center ? "left" : "right";
  if (component.type === "backEmfDiode") {
    const targetPinSide = boardPinSide(connectionForComponentTarget(component, connections)?.to?.boardPin);
    if (targetPinSide) return targetPinSide;
  }
  if (component.type === "powerSupply") {
    const clusterSide = externalPowerClusterSide(connections, components, board);
    if (clusterSide) return clusterSide;
    return "left";
  }
  const directSide = boardPinSide(component.pin);
  if (directSide) return directSide;
  for (const pin of Object.values(component.pins || {})) {
    const side = boardPinSide(pin);
    if (side) return side;
  }
  const counts = { left: 0, right: 0 };
  connections.forEach((connection) => {
    if (connection.from?.component !== component.id) return;
    if (["GND", "GND3", "VIN", "3V3"].includes(String(connection.to?.boardPin || ""))) return;
    const side = boardPinSide(connection.to?.boardPin);
    if (side) counts[side] += 1;
  });
  if (counts.left !== counts.right) return counts.left > counts.right ? "left" : "right";
  if (component.type === "wifiService") return "right";
  return index % 2 ? "right" : "left";
}

function externalPowerClusterSide(connections, components, board = null) {
  const supply = components.find((component) => component.type === "powerSupply");
  if (!supply) return "";
  const powered = connections
    .filter((connection) => connection.from?.component === supply.id && connection.from?.pin === "5V" && connection.to?.component)
    .map((connection) => {
      const component = components.find((item) => item.id === connection.to.component);
      return component ? { component, score: externalPowerTargetScore(component.type) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const target = powered[0]?.component;
  if (!target) return "";
  const side = sideForComponentSignalTarget(target, connections, board);
  if (!side) return "";
  return isNeoPixelType(target.type) ? (side === "left" ? "right" : "left") : side;
}

function externalPowerTargetScore(type) {
  if (type === "servoLarge") return 100;
  if (["fan", "dcMotor", "stepperMotor"].includes(type)) return 90;
  if (type === "servo") return 80;
  if (isNeoPixelType(type)) return 30;
  return 20;
}

function sideForComponentSignalTarget(component, connections, board = null) {
  const center = board ? board.x + board.w / 2 : WORLD_W / 2;
  if (Number.isFinite(component?.x)) return component.x < center ? "left" : "right";
  const target = connections.find((connection) => (
    connection.from?.component === component?.id
    && connection.to?.boardPin
    && !isRailBoardPin(connection.to.boardPin)
  ));
  return boardPinSide(target?.to?.boardPin);
}

function connectionForComponentTarget(component, connections) {
  const targetComponent = connections.find((connection) => connection.from?.component === component.id && connection.to?.component)?.to?.component;
  if (!targetComponent) return null;
  return connections.find((connection) => (
    connection.from?.component === targetComponent
    && connection.to?.boardPin
    && !isRailBoardPin(connection.to.boardPin)
  )) || null;
}

function mergeComponents(base = [], extra = []) {
  const byKey = new Map();
  base.forEach((component) => {
    byKey.set(componentMergeKey(component), component);
  });
  extra.forEach((component) => {
    const key = componentMergeKey(component);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, mergeDuplicateComponent(existing, component));
    } else {
      byKey.set(key, component);
    }
  });
  return [...byKey.values()];
}

function mergeDuplicateComponent(base, extra) {
  return {
    ...extra,
    ...base,
    x: Number.isFinite(extra.x) ? extra.x : base.x,
    y: Number.isFinite(extra.y) ? extra.y : base.y,
  };
}

function componentMergeKey(component) {
  const type = String(component?.type || "unknown");
  const pins = component?.pins || {};
  if (isNeoPixelType(type)) return `${type}:data=${pins.data || component.pin || ""}`;
  if (type === "powerSupply") return `${type}:external-5v`;
  if (component?.pin) return `${type}:pin=${component.pin}`;
  const pinEntries = Object.entries(pins)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${type}:${pinEntries || component?.id || ""}`;
}

function mergeConnections(base = [], extra = []) {
  const seen = new Set();
  const out = [];
  [...base, ...extra].forEach((connection) => {
    const key = `${connection.from?.component}:${connection.from?.pin}:${connection.to?.boardPin || connection.to?.component}:${connection.to?.pin || ""}:${connection.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(connection);
  });
  return out;
}

function drawConnections(p, model, renderMode = "symbols") {
  const componentsById = new Map(model.components.map((component) => [component.id, component]));
  const lanes = buildWireLanes(model);
  const terminals = buildComponentTerminals(model, componentsById);
  const orderedConnections = [...model.connections].sort((left, right) => wireDrawRank(left) - wireDrawRank(right));
  const routes = orderedConnections.map((connection) => {
    const component = componentsById.get(connection.from.component);
    if (!component) return null;
    const targetComponent = componentsById.get(connection.to?.component);
    const pin = targetComponent ? null : pinPositionForComponent(model.board, connection.to.boardPin, component);
    if (!targetComponent && !pin) return null;
    const start = componentTerminalAnchor(component, connection.from.pin, terminals, model.board, renderMode);
    const end = targetComponent
      ? componentTerminalAnchor(targetComponent, connection.to.pin, terminals, model.board, renderMode)
      : pin;
    const points = targetComponent
      ? componentWireRoutePoints(start, end, component, targetComponent, connection, model.board, lanes)
      : wireRoutePoints(connection, start, pin, component, model.board, lanes);
    const laneKey = wireLaneKey(connection);
    const drawRank = wireDrawRank(connection);
    const sourceSide = pointSide(start, model.board);
    const targetSide = targetComponent ? pointSide(end, model.board) : pin?.side || "";
    return {
      connection,
      start,
      end,
      endDot: end,
      points,
      color: wireColor(connection),
      laneKey,
      drawRank,
      sourceSide,
      targetSide,
      targetBoardPin: String(connection.to?.boardPin || ""),
      targetComponent,
    };
  }).filter(Boolean);
  const collapsedRoutes = collapseSharedRailRoundTrips(routes)
    .map((route, routeIndex) => ({ ...route, routeIndex }));

  collapsedRoutes.forEach((route) => {
    const crossings = wireCrossingsForRoute(route, collapsedRoutes);
    p.noFill();
    p.stroke(route.color);
    p.strokeWeight(WIRE_STROKE);
    p.strokeJoin(p.ROUND);
    p.strokeCap(p.ROUND);
    drawPolylineWithGaps(p, route.points, crossings);
    p.noStroke();
    p.fill(route.color);
    p.circle(route.start.x, route.start.y, 5);
    if (route.endDot) p.circle(route.endDot.x, route.endDot.y, route.targetComponent ? 5 : 7);
  });
}

function collapseSharedRailRoundTrips(routes) {
  const trunks = new Map();
  return routes.map((route) => {
    if (!isSharedRailRoundTrip(route)) return route;
    const key = `${route.laneKey}:${route.sourceSide}->${route.targetSide}:${route.targetBoardPin}`;
    const join = route.points[2];
    const existing = trunks.get(key);
    if (!existing) {
      trunks.set(key, { join });
      return route;
    }
    return {
      ...route,
      points: [route.start, route.points[1], existing.join],
      end: existing.join,
      endDot: null,
    };
  });
}

function isSharedRailRoundTrip(route) {
  return (route.laneKey === "power:3v3" || route.laneKey === "ground")
    && route.sourceSide
    && route.targetSide
    && route.sourceSide !== route.targetSide
    && route.points.length >= 7
    && /^(3V3|GND|GND3)$/i.test(route.targetBoardPin);
}

function pointSide(point, board) {
  if (!point || !board) return "";
  return point.x < board.x + board.w / 2 ? "left" : "right";
}

function wireDrawRank(connection) {
  const color = wireColor(connection);
  if (color === WIRE_POWER) return 0;
  if (color === WIRE_GROUND) return 1;
  return 2;
}

function buildComponentTerminals(model, componentsById) {
  const terminalsByComponent = new Map();
  const desiredSidesByComponent = new Map();
  const addDesiredSide = (component, side) => {
    if (!component || !side) return;
    let counts = desiredSidesByComponent.get(component.id);
    if (!counts) {
      counts = { left: 0, right: 0 };
      desiredSidesByComponent.set(component.id, counts);
    }
    counts[side] += 1;
  };
  const addTerminal = (component, pinName) => {
    if (!component || !pinName) return;
    let pins = terminalsByComponent.get(component.id);
    if (!pins) {
      pins = new Map();
      terminalsByComponent.set(component.id, pins);
    }
    const pin = String(pinName);
    if (!pins.has(pin)) pins.set(pin, { pin });
  };

  model.connections.forEach((connection) => {
    const source = componentsById.get(connection.from?.component);
    const target = componentsById.get(connection.to?.component);
    if (!source) return;
    const sourceSide = target
      ? componentSideForComponent(source, target, model.board)
      : componentSideForBoard(source, model.board, connection.to?.boardPin, connection.from?.pin);
    addDesiredSide(source, sourceSide);
    addTerminal(source, connection.from?.pin);
    if (target) {
      addDesiredSide(target, componentSideForComponent(target, source, model.board));
      addTerminal(target, connection.to?.pin);
    }
  });

  const terminals = new Map();
  terminalsByComponent.forEach((pinsByName, id) => {
    const component = componentsById.get(id);
    const out = { left: new Map(), right: new Map() };
    const side = componentPrimaryTerminalSide(component, model.board, desiredSidesByComponent.get(id));
    const pins = [...pinsByName.values()].sort((a, b) => terminalSortRank(a.pin) - terminalSortRank(b.pin) || a.pin.localeCompare(b.pin));
    const offsets = componentTerminalOffsets(pins.length, component);
    pins.forEach((terminal, index) => {
      out[side].set(terminal.pin, { side, yOffset: offsets[index] || 0 });
    });
    terminals.set(id, out);
  });
  return terminals;
}

function componentPrimaryTerminalSide(component, board, counts = null) {
  if (counts && counts.left !== counts.right) return counts.left > counts.right ? "left" : "right";
  if (!component || !board) return "right";
  return component.x < board.x + board.w / 2 ? "right" : "left";
}

function componentSideForBoard(component, board, boardPinName = "", componentPinName = "") {
  const pinSide = boardPinSideForComponent(boardPinName, component, board);
  if (pinSide && component.x < board.x + board.w / 2) return "right";
  if (pinSide && component.x >= board.x + board.w / 2) return "left";
  return component.x < board.x + board.w / 2 ? "right" : "left";
}

function componentSideForComponent(component, otherComponent, board = null) {
  const sameColumn = Math.abs(Number(otherComponent?.x || 0) - Number(component?.x || 0)) < 18;
  if (sameColumn) return componentPrimaryTerminalSide(component, board);
  if (otherComponent.x < component.x) return "left";
  if (otherComponent.x > component.x) return "right";
  return componentPrimaryTerminalSide(component, board);
}

function componentTerminalAnchor(component, pinName, terminals, board, renderMode = "symbols") {
  const pin = String(pinName || "");
  const sides = terminals.get(component.id);
  let terminal = sides?.left.get(pin) || sides?.right.get(pin);
  if (!terminal) {
    const side = componentPrimaryTerminalSide(component, board);
    terminal = { side, yOffset: 0 };
  }
  const halfW = componentTerminalHalfWidth(component.type, renderMode);
  return {
    x: component.x + (terminal.side === "left" ? -halfW : halfW),
    y: component.y + terminal.yOffset,
  };
}

function componentTerminalHalfWidth(type, renderMode = "symbols") {
  if (renderMode === "illustrations") return componentIllustrationHalfWidth(type);
  return componentBodyWidth(type) / 2;
}

function componentTerminalOffsets(count, component) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const span = COMPONENT_TERMINAL_PITCH * (count - 1);
  const pitch = COMPONENT_TERMINAL_PITCH;
  const start = -span / 2;
  return Array.from({ length: count }, (_, index) => start + index * pitch);
}

function componentTerminalMargin(bodyH) {
  return clamp(bodyH * 0.24, COMPONENT_TERMINAL_MIN_MARGIN, COMPONENT_TERMINAL_MAX_MARGIN);
}

function terminalSortRank(pinName) {
  const pin = String(pinName || "").toLowerCase();
  if (/(5v|vcc|vin|power|3v3|\+)/.test(pin)) return 10;
  if (/(data|signal|sig|sda|rx|trigger|touch)/.test(pin)) return 20;
  if (/(scl|tx|echo)/.test(pin)) return 30;
  if (/(gnd|ground|-)/.test(pin)) return 40;
  return 25;
}

function componentWireRoutePoints(start, end, sourceComponent = null, targetComponent = null, connection = null, board = null, lanes = null) {
  if (!board || !lanes) {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const color = wireColor(connection || {});
  const laneKey = wireLaneKey(connection || {});
  const sourceSide = start.x < board.x + board.w / 2 ? "left" : "right";
  const targetSide = end.x < board.x + board.w / 2 ? "left" : "right";
  const sourceLaneX = wireLaneX(board, sourceSide, laneKey, lanes);
  const targetLaneX = wireLaneX(board, targetSide, laneKey, lanes);
  if (sourceSide === targetSide) {
    return [
      start,
      { x: sourceLaneX, y: start.y },
      { x: sourceLaneX, y: end.y },
      end,
    ];
  }
  const bridgeY = wireBridgeY(board, laneKey, lanes, start, { y: end.y }, targetSide);
  return [
    start,
    { x: sourceLaneX, y: start.y },
    { x: sourceLaneX, y: bridgeY },
    { x: targetLaneX, y: bridgeY },
    { x: targetLaneX, y: end.y },
    end,
  ];
}

function localComponentWireRoutePoints(start, end, sourceComponent = null, targetComponent = null) {
  if (Math.abs(start.y - end.y) < 1) return [start, end];
  const sourceSide = sourceComponent && start.x < sourceComponent.x ? "left" : "right";
  const targetSide = targetComponent && end.x < targetComponent.x ? "left" : "right";
  let elbowX = (start.x + end.x) / 2;
  if (sourceSide === targetSide) {
    elbowX = sourceSide === "left"
      ? Math.min(start.x, end.x) - COMPONENT_LINK_MARGIN
      : Math.max(start.x, end.x) + COMPONENT_LINK_MARGIN;
  }
  return [start, { x: elbowX, y: start.y }, { x: elbowX, y: end.y }, end];
}

function buildWireLanes(model) {
  const componentsById = new Map(model.components.map((component) => [component.id, component]));
  const colorsBySide = { left: [], right: [] };
  const addLane = (side, key) => {
    if (!colorsBySide[side]?.includes(key)) colorsBySide[side].push(key);
  };
  model.connections.forEach((connection) => {
    const component = componentsById.get(connection.from?.component);
    const targetComponent = componentsById.get(connection.to?.component);
    const sourceSide = component
      ? (component.x < model.board.x + model.board.w / 2 ? "left" : "right")
      : "";
    const targetSide = targetComponent
      ? (targetComponent.x < model.board.x + model.board.w / 2 ? "left" : "right")
      : (boardPinSideForComponent(connection.to?.boardPin, component, model.board) || "right");
    const laneKey = wireLaneKey(connection);
    addLane(sourceSide || targetSide, laneKey);
    addLane(targetSide, laneKey);
  });
  colorsBySide.left.sort(wireLaneSort);
  colorsBySide.right.sort(wireLaneSort);
  return colorsBySide;
}

function wireRoutePoints(connection, start, pin, component, board, lanes) {
  const color = wireColor(connection);
  const laneKey = wireLaneKey(connection);
  const targetSide = pin.side || "right";
  const sourceSide = component.x < board.x + board.w / 2 ? "left" : "right";
  const sourceLaneX = wireLaneX(board, sourceSide, laneKey, lanes);
  const targetLaneX = wireLaneX(board, targetSide, laneKey, lanes);
  const pinEntry = pinEntryPoint(board, pin);
  if (sourceSide === targetSide) {
    return [
      start,
      { x: targetLaneX, y: start.y },
      { x: targetLaneX, y: pinEntry.y },
      pinEntry,
      pin,
    ];
  }
  const bridgeY = wireBridgeY(board, laneKey, lanes, start, pin, targetSide);
  return [
    start,
    { x: sourceLaneX, y: start.y },
    { x: sourceLaneX, y: bridgeY },
    { x: targetLaneX, y: bridgeY },
    { x: targetLaneX, y: pinEntry.y },
    pinEntry,
    pin,
  ];
}

function pinEntryPoint(board, pin) {
  const clearance = 10;
  return {
    x: pin.side === "left" ? board.x - clearance : board.x + board.w + clearance,
    y: pin.y,
  };
}

function wireLaneX(board, side, laneKey, lanes) {
  const offset = wireLaneOffset(side, laneKey, lanes);
  return side === "left" ? board.x - offset : board.x + board.w + offset;
}

function wireBridgeY(board, laneKey, lanes, start, pin, side) {
  const index = wireLaneIndex(side, laneKey, lanes);
  const railSide = powerRailBridgeSide(laneKey);
  const above = railSide ? railSide === "top" : (start.y + pin.y) / 2 < board.y + board.h / 2;
  const offset = 42 + index * 12;
  return above ? board.y - offset : board.y + board.h + offset;
}

function powerRailBridgeSide(laneKey) {
  if (laneKey === "power:3v3") return "top";
  if (laneKey === "power:5v" || laneKey === "power:vin") return "bottom";
  return "";
}

function wireLaneIndex(side, laneKey, lanes) {
  const list = lanes[side] || [];
  const index = list.indexOf(laneKey);
  return index < 0 ? 0 : index;
}

function wireLaneOffset(side, laneKey, lanes) {
  const list = lanes[side] || [];
  const group = wireLaneGroup(laneKey);
  if (group === "signal") {
    const railCount = list.filter((key) => wireLaneGroup(key) === "rail").length;
    const signalIndex = list.filter((key) => wireLaneGroup(key) === "signal").indexOf(laneKey);
    return WIRE_RAIL_BASE_OFFSET
      + Math.max(0, railCount - 1) * WIRE_RAIL_PITCH
      + WIRE_SIGNAL_MARGIN
      + Math.max(0, signalIndex) * WIRE_SIGNAL_PITCH;
  }
  const railIndex = list.filter((key) => wireLaneGroup(key) === "rail").indexOf(laneKey);
  return WIRE_RAIL_BASE_OFFSET + Math.max(0, railIndex) * WIRE_RAIL_PITCH;
}

function wireLaneSort(left, right) {
  const rank = wireLaneSortRank(left) - wireLaneSortRank(right);
  if (rank) return rank;
  return String(left).localeCompare(String(right));
}

function wireLaneSortRank(laneKey) {
  if (laneKey === "ground") return 0;
  if (String(laneKey || "").startsWith("power:")) return 1;
  return 2;
}

function wireLaneGroup(laneKey) {
  return laneKey === "ground" || String(laneKey || "").startsWith("power:") ? "rail" : "signal";
}

function wireLaneKey(connection) {
  const text = wireText(connection);
  if (/\b(3v3|3\.3v)\b/.test(text)) return "power:3v3";
  if (/\b(5v)\b/.test(text)) return "power:5v";
  if (/\b(vin|vcc|power|\+)\b/.test(text)) return "power:vin";
  if (/\b(g|gnd|ground)\b/.test(text)) return "ground";
  return `signal:${wireColor(connection)}:${wireIdentity(connection)}`;
}

function wireIdentity(connection) {
  return [
    connection.id,
    connection.from?.component,
    connection.from?.pin,
    connection.to?.boardPin || connection.to?.component,
    connection.to?.pin,
  ].filter(Boolean).join(":");
}

function wireColor(connection) {
  const text = wireText(connection);
  if (/\b(g|gnd|ground)\b/.test(text)) return WIRE_GROUND;
  if (/\b(\+|vcc|vin|3v3|3\.3v|5v|power)\b/.test(text)) return WIRE_POWER;
  return WIRE_SIGNALS[stableHash(text) % WIRE_SIGNALS.length];
}

function wireText(connection) {
  const parts = [
    connection.label,
    connection.from?.pin,
    connection.to?.boardPin,
    connection.to?.pin,
  ].map((value) => String(value || "").toLowerCase());
  return parts.join(" ");
}

function drawCircuitNote(p, model) {
  const count = model.components?.length || 0;
  p.push();
  p.noStroke();
  p.fill("#202326");
  p.textAlign(p.LEFT, p.TOP);
  p.textStyle(p.NORMAL);
  p.textSize(11);
  p.text(`${count} part${count === 1 ? "" : "s"} inferred`, 12, 12);
  p.fill("#687076");
  p.textSize(10);
  p.text("Estimated circuit based on code", 12, 28);
  p.pop();
}

function stableHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function drawPolyline(p, points) {
  p.beginShape();
  points.forEach((point) => p.vertex(point.x, point.y));
  p.endShape();
}

function drawPolylineWithGaps(p, points, crossings = []) {
  if (!crossings.length) {
    drawPolyline(p, points);
    return;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    drawSegmentWithGaps(p, a, b, crossings);
  }
}

function drawSegmentWithGaps(p, a, b, crossings) {
  if (samePoint(a, b)) return;
  const horizontal = nearlyEqual(a.y, b.y);
  const vertical = nearlyEqual(a.x, b.x);
  if (!horizontal && !vertical) {
    p.line(a.x, a.y, b.x, b.y);
    return;
  }
  const axisStart = horizontal ? a.x : a.y;
  const axisEnd = horizontal ? b.x : b.y;
  const cuts = crossings
    .filter((point) => pointOnSegmentInterior(point, a, b))
    .map((point) => horizontal ? point.x : point.y)
    .sort((left, right) => left - right);
  if (!cuts.length) {
    p.line(a.x, a.y, b.x, b.y);
    return;
  }
  const direction = axisEnd >= axisStart ? 1 : -1;
  let cursor = axisStart;
  const orderedCuts = direction > 0 ? cuts : cuts.reverse();
  orderedCuts.forEach((cut) => {
    const before = cut - direction * WIRE_CROSSING_GAP;
    const after = cut + direction * WIRE_CROSSING_GAP;
    drawAxisLine(p, horizontal, a, cursor, before);
    cursor = after;
  });
  drawAxisLine(p, horizontal, a, cursor, axisEnd);
}

function drawAxisLine(p, horizontal, reference, from, to) {
  if (nearlyEqual(from, to)) return;
  if (horizontal) p.line(from, reference.y, to, reference.y);
  else p.line(reference.x, from, reference.x, to);
}

function wireCrossingsForRoute(route, routes) {
  const crossings = [];
  routes.forEach((other) => {
    if (other === route) return;
    if (other.laneKey === route.laneKey) return;
    const otherRank = Number(other.drawRank || 0);
    const routeRank = Number(route.drawRank || 0);
    if (otherRank < routeRank) return;
    if (otherRank === routeRank && Number(other.routeIndex || 0) <= Number(route.routeIndex || 0)) return;
    routeSegments(route.points).forEach((a) => {
      routeSegments(other.points).forEach((b) => {
        const point = perpendicularCrossing(a, b);
        if (point && !crossings.some((existing) => samePoint(existing, point))) crossings.push(point);
      });
    });
  });
  return crossings;
}

function routeSegments(points) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (!samePoint(a, b)) segments.push({ a, b });
  }
  return segments;
}

function perpendicularCrossing(first, second) {
  const firstH = nearlyEqual(first.a.y, first.b.y);
  const firstV = nearlyEqual(first.a.x, first.b.x);
  const secondH = nearlyEqual(second.a.y, second.b.y);
  const secondV = nearlyEqual(second.a.x, second.b.x);
  if (firstH && secondV) return crossingPoint(first, second);
  if (firstV && secondH) return crossingPoint(second, first);
  return null;
}

function crossingPoint(horizontal, vertical) {
  const x = vertical.a.x;
  const y = horizontal.a.y;
  const point = { x, y };
  if (!pointOnSegmentInterior(point, horizontal.a, horizontal.b)) return null;
  if (!pointOnSegmentInterior(point, vertical.a, vertical.b)) return null;
  return point;
}

function pointOnSegmentInterior(point, a, b) {
  const horizontal = nearlyEqual(a.y, b.y);
  const vertical = nearlyEqual(a.x, b.x);
  if (horizontal && !nearlyEqual(point.y, a.y)) return false;
  if (vertical && !nearlyEqual(point.x, a.x)) return false;
  const axisPoint = horizontal ? point.x : point.y;
  const axisA = horizontal ? a.x : a.y;
  const axisB = horizontal ? b.x : b.y;
  const minAxis = Math.min(axisA, axisB) + WIRE_CROSSING_GAP;
  const maxAxis = Math.max(axisA, axisB) - WIRE_CROSSING_GAP;
  return axisPoint > minAxis && axisPoint < maxAxis;
}

function samePoint(a, b) {
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

function drawBoard(p, board, hovered) {
  p.push();
  p.fill("#202326");
  p.stroke("#50575c");
  p.strokeWeight(2);
  p.rect(board.x, board.y, board.w, board.h, 10);
  p.fill("#c7ccd0");
  p.stroke("#6f7478");
  p.strokeWeight(1.5);
  p.rect(board.x + board.w / 2 - 36, board.y - 8, 72, 58, 4);
  p.noStroke();
  p.fill("#33383c");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(8);
  p.text("USB", board.x + board.w / 2, board.y + 21);
  p.fill("#f3efe5");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(16);
  p.textStyle(p.BOLD);
  p.text("ESP32", board.x + board.w / 2, board.y + 76);
  p.textStyle(p.NORMAL);

  pinDefs.forEach((pin) => {
    const pos = pinPosition(board, pin.pin);
    if (!pos) return;
    const active = hovered?.pin === pin.pin;
    p.fill(active ? "#f3efe5" : pinFill(pin));
    p.stroke(active ? "#ffffff" : "#30363a");
    p.strokeWeight(active ? 2 : 1);
    p.circle(pos.x, pos.y, active ? 12 : 9);
    p.noStroke();
    p.fill(active ? "#f3efe5" : "#b8b0a2");
    p.textSize(10);
    p.textAlign(pin.side === "left" ? p.LEFT : p.RIGHT, p.CENTER);
    p.text(pin.label || pin.pin, pin.side === "left" ? pos.x + 10 : pos.x - 10, pos.y);
  });
  p.pop();
}

function pinFill(pin) {
  if (pin.power) return WIRE_POWER;
  if (pin.ground) return WIRE_GROUND;
  if (pin.adc) return WIRE_SIGNALS[0];
  if (pin.i2c) return WIRE_SIGNALS[1];
  if (pin.caution) return "#9b7354";
  return "#6f868c";
}

function pinPosition(board, pinName, preferredSide = "") {
  const pin = findPinDef(pinName, preferredSide);
  if (!pin) return null;
  const sidePins = pinDefs.filter((item) => item.side === pin.side);
  const index = sidePins.findIndex((item) => item.pin === pin.pin);
  const y = board.y + 96 + index * ((board.h - 132) / Math.max(1, sidePins.length - 1));
  const x = pin.side === "left" ? board.x + 15 : board.x + board.w - 15;
  return { x, y, ...pin };
}

function pinPositionForComponent(board, pinName, component) {
  return pinPosition(board, pinName, preferredBoardSide(component, board));
}

function findPinDef(pinName, preferredSide = "") {
  const key = String(pinName || "");
  if (preferredSide) {
    const preferred = pinDefs.find((item) => item.side === preferredSide && (item.pin === key || item.label === key));
    if (preferred) return preferred;
  }
  return pinDefs.find((item) => item.pin === key || item.label === key) || null;
}

function boardPinSide(pinName, preferredSide = "") {
  return findPinDef(pinName, preferredSide)?.side || "";
}

function boardPinSideForComponent(pinName, component, board) {
  return boardPinSide(pinName, preferredBoardSide(component, board));
}

function preferredBoardSide(component, board) {
  if (!component || !board) return "";
  return component.x < board.x + board.w / 2 ? "left" : "right";
}

function hitPin(world, board) {
  for (const pin of pinDefs) {
    const pos = pinPosition(board, pin.pin);
    if (!pos) continue;
    const dx = world.x - pos.x;
    const dy = world.y - pos.y;
    if ((dx * dx + dy * dy) <= 144) return pos;
  }
  return null;
}

function hitComponent(world, components) {
  for (let i = components.length - 1; i >= 0; i -= 1) {
    const component = components[i];
    const bounds = componentBounds(component);
    if (
      world.x >= bounds.x
      && world.x <= bounds.x + bounds.w
      && world.y >= bounds.y
      && world.y <= bounds.y + bounds.h
    ) {
      return component;
    }
  }
  return null;
}

function componentBounds(component) {
  const w = componentWidth(component.type);
  const bodyH = componentBodyHeight(component.type);
  const pad = 4;
  return {
    x: component.x - w / 2 - pad,
    y: component.y - bodyH / 2 - pad,
    w: w + pad * 2,
    h: bodyH + pad * 2,
  };
}

function drawComponents(p, components, selectedComponentId = "", renderMode = "symbols", board = null) {
  components.forEach((component) => {
    p.push();
    p.translate(component.x, component.y);
    drawComponent(p, component, component.id === selectedComponentId, renderMode, board);
    p.pop();
  });
}

function drawComponent(p, component, selected = false, renderMode = "symbols", board = null) {
  const w = componentWidth(component.type);
  const h = componentBodyHeight(component.type);
  const connectorSide = componentConnectorSide(component, board);
  if (renderMode === "symbols" && component.type !== "ledStrip") {
    p.stroke(selected ? "#0097a7" : "#43494e");
    p.strokeWeight(selected ? 2.4 : 1.5);
    p.fill("#1d2022");
    p.rect(-w / 2, -h / 2, w, h, 8);
  } else if (selected && renderMode !== "illustrations") {
    p.noFill();
    p.stroke("#0097a7");
    p.strokeWeight(2.4);
    p.rect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 4);
  }

  if (renderMode === "illustrations") {
    p.push();
    p.scale(componentIllustrationScale(component.type));
    drawComponentIllustration(p, component, connectorSide);
    p.pop();
  } else {
    drawComponentSymbol(p, component);
  }

  p.noStroke();
  p.fill("#1f2326");
  p.textAlign(p.CENTER, p.TOP);
  p.textSize(11);
  p.textStyle(p.NORMAL);
  p.text(componentDisplayLabel(component), 0, componentLabelY(component.type, h, renderMode));
  p.textStyle(p.NORMAL);
}

function componentConnectorSide(component, board = null) {
  if (!component || !board) return "right";
  return component.x < board.x + board.w / 2 ? "right" : "left";
}

function drawComponentSymbol(p, component) {
  if (component.type === "ledStrip") drawLedStrip(p);
  else if (component.type === "neopixelRing") drawNeoPixelRing(p);
  else if (component.type === "neopixelMatrix") drawNeoPixelMatrix(p);
  else if (component.type === "button") drawButton(p);
  else if (component.type === "led") drawLed(p);
  else if (component.type === "analogSensor") drawAnalogSensor(p);
  else if (component.type === "potentiometer") drawPot(p);
  else if (component.type === "distanceSensor") drawDistanceSensor(p);
  else if (component.type === "ultrasonicSensor") drawUltrasonic(p);
  else if (component.type === "microphone") drawMic(p);
  else if (component.type === "joystick") drawJoystick(p);
  else if (component.type === "servo" || component.type === "servoLarge") drawServo(p, component.type === "servoLarge");
  else if (component.type === "fan") drawFan(p);
  else if (component.type === "dcMotor") drawDcMotor(p);
  else if (component.type === "stepperMotor") drawStepper(p);
  else if (component.type === "relay") drawRelay(p);
  else if (component.type === "i2cDevice") drawChip(p, "I2C");
  else if (component.type === "imu") drawChip(p, "IMU");
  else if (component.type === "uartDevice") drawChip(p, "RX/TX");
  else if (component.type === "mp3Player") drawChip(p, "MP3");
  else if (component.type === "wifiService") drawCloud(p);
  else if (component.type === "powerSupply") drawPowerSupply(p);
  else if (component.type === "backEmfDiode") drawDiode(p);
  else if (component.type === "unknown") drawQuestion(p);
  else drawSensor(p);
}

function drawComponentIllustration(p, component, connectorSide = "right") {
  if (component.type === "ledStrip") drawLedStrip(p);
  else if (component.type === "neopixelRing") drawNeoPixelRingIllustration(p);
  else if (component.type === "neopixelMatrix") drawLedMatrixIllustration(p);
  else if (component.type === "button") drawButtonIllustration(p);
  else if (component.type === "led") drawLedIllustration(p);
  else if (component.type === "analogSensor") drawAnalogSensorIllustration(p);
  else if (component.type === "potentiometer") drawPotIllustration(p, connectorSide);
  else if (component.type === "distanceSensor" || component.type === "ultrasonicSensor") drawDistanceSensorIllustration(p);
  else if (component.type === "microphone") drawMicrophoneIllustration(p);
  else if (component.type === "joystick") drawJoystickIllustration(p);
  else if (component.type === "servo" || component.type === "servoLarge") drawServoIllustration(p, component.type === "servoLarge", connectorSide);
  else if (component.type === "fan") drawFanIllustration(p);
  else if (component.type === "dcMotor") drawDcMotorIllustration(p, connectorSide);
  else if (component.type === "stepperMotor") drawStepperIllustration(p);
  else if (component.type === "relay") drawRelayIllustration(p);
  else if (component.type === "buzzer") drawBuzzerIllustration(p);
  else if (component.type === "i2cDevice") drawModuleIllustration(p, "I2C", "#1565c0");
  else if (component.type === "imu") drawModuleIllustration(p, "IMU", "#1565c0");
  else if (component.type === "uartDevice") drawModuleIllustration(p, "UART", "#1565c0");
  else if (component.type === "mp3Player") drawModuleIllustration(p, "MP3", "#1565c0");
  else if (component.type === "wifiService") drawWifiIllustration(p);
  else if (component.type === "powerSupply") drawPowerSupplyIllustration(p);
  else if (component.type === "backEmfDiode") drawDiodeIllustration(p);
  else if (component.type === "unknown") drawQuestion(p);
  else drawSensorIllustration(p);
}

function componentDisplayLabel(component) {
  const label = String(component?.label || componentTypes[component?.type]?.label || component?.type || "");
  const pin = primaryDisplayPin(component);
  if (!pin) return label;
  const io = `IO ${pin}`;
  if (new RegExp(`\\b${escapeRegExp(io)}\\b`, "i").test(label)) return label;
  const paren = label.match(/^(.*)\(([^)]*)\)\s*$/);
  if (paren) return `${paren[1].trim()} (${paren[2].trim()}, ${io})`;
  return `${label} (${io})`;
}

function primaryDisplayPin(component) {
  if (!component) return "";
  return component.pin || component.pins?.data || component.pins?.signal || component.pins?.step || component.pins?.trigger || component.pins?.sda || component.pins?.rx || "";
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentWidth(type) {
  if (type === "ledStrip") return 180;
  if (type === "servoLarge") return 162;
  if (type === "powerSupply") return 150;
  if (type === "backEmfDiode") return 118;
  return 138;
}

function componentBodyWidth(type) {
  if (type === "ledStrip") return 180;
  return componentWidth(type);
}

function componentBodyHeight(type) {
  return componentBodyHeightForPinCount(type, componentDefaultTerminalCount(type));
}

function componentBodyHeightForPinCount(type, count = 0) {
  const base = type === "ledStrip" ? 36 : (type === "servoLarge" ? 62 : 50);
  if (count <= 1) return base;
  return Math.max(base, COMPONENT_TERMINAL_PITCH * (count - 1) + COMPONENT_TERMINAL_MIN_MARGIN * 2);
}

function componentDefaultTerminalCount(type) {
  return componentTypes[type]?.needs?.length || 0;
}

function componentLabelY(type, fallbackHeight, renderMode = "symbols") {
  if (type === "ledStrip") return componentBodyHeight(type) / 2 + 4;
  if (renderMode === "illustrations") return Math.max(fallbackHeight / 2 + 4, componentIllustrationHalfHeight(type) + 8);
  return fallbackHeight / 2 + 4;
}

function componentIllustrationScale(type) {
  if (type === "ledStrip") return 1;
  if (type === "dcMotor") return 1;
  if (type === "buzzer") return 1;
  if (type === "powerSupply" || type === "backEmfDiode") return 1.08;
  return 1.18;
}

function componentIllustrationHalfWidth(type) {
  const scale = componentIllustrationScale(type);
  if (type === "ledStrip") return 90;
  if (type === "powerSupply") return 49;
  if (type === "backEmfDiode") return 37;
  if (type === "servoLarge") return 45;
  if (type === "dcMotor") return 34;
  if (type === "buzzer") return 37;
  return Math.min(componentBodyWidth(type) / 2 - 8, 42 * scale);
}

function componentIllustrationHalfHeight(type) {
  const scale = componentIllustrationScale(type);
  if (type === "buzzer") return 43;
  if (type === "potentiometer") return 33 * scale;
  if (type === "servoLarge") return 48 * scale;
  if (type === "servo") return 40 * scale;
  if (type === "stepperMotor") return 36 * scale;
  if (type === "led") return 27 * scale;
  if (type === "button") return 18 * scale;
  if (type === "fan") return 24 * scale;
  if (type === "dcMotor") return 20;
  if (type === "powerSupply" || type === "backEmfDiode") return 20 * scale;
  if (type === "neopixelRing" || type === "neopixelMatrix") return 28 * scale;
  return componentBodyHeight(type) / 2;
}

function drawLedStrip(p) {
  const h = componentBodyHeight("ledStrip");
  p.noStroke();
  p.fill("#303030");
  p.rect(-90, -h / 2, 180, h, 1);

  const ledXs = [-62, -31, 0, 31, 62];
  ledXs.forEach((x) => {
    p.fill("#f6f6f2");
    p.stroke("#5b5b5b");
    p.strokeWeight(3);
    p.rect(x - 12, -12, 24, 24, 2);
    p.noFill();
    p.stroke("#5b5b5b");
    p.strokeWeight(3);
    p.circle(x, 0, 15);
    p.noStroke();
    p.fill("#efefef");
    p.circle(x, 0, 9);
  });

}

function drawNeoPixelRing(p) {
  p.noFill();
  p.stroke("#59bdd0");
  p.circle(0, 0, 38);
  p.noStroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    p.fill(i % 3 === 0 ? "#59bdd0" : (i % 3 === 1 ? "#d6bd62" : "#d26b5b"));
    p.circle(Math.cos(a) * 19, Math.sin(a) * 19, 5);
  }
}

function drawNeoPixelMatrix(p) {
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      const n = x + y;
      p.fill(n % 3 === 0 ? "#59bdd0" : (n % 3 === 1 ? "#d6bd62" : "#d26b5b"));
      p.rect(-34 + x * 13, -18 + y * 10, 7, 7, 2);
    }
  }
}

function drawButton(p) {
  p.stroke("#b8bec0");
  p.noFill();
  p.line(-22, 8, -7, 8);
  p.line(7, 8, 22, 8);
  p.line(-7, 8, 8, -4);
  p.noFill();
  p.circle(-24, 8, 5);
  p.circle(24, 8, 5);
}

function drawLed(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.circle(0, 0, 25);
  p.line(-4, 9, -15, 20);
  p.line(4, 9, 15, 20);
}

function drawPot(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.circle(0, 0, 28);
  p.line(0, 0, 10, -11);
}

function drawDistanceSensor(p) {
  p.stroke("#59bdd0");
  p.noFill();
  p.rect(-32, -15, 64, 30, 4);
  p.noFill();
  p.circle(-16, 0, 17);
  p.circle(16, 0, 17);
}

function drawUltrasonic(p) {
  drawDistanceSensor(p);
}

function drawMic(p) {
  p.stroke("#61d47c");
  p.noFill();
  p.rect(-25, -14, 50, 28, 4);
  p.circle(0, 0, 22);
}

function drawJoystick(p) {
  p.stroke("#8f9699");
  p.noFill();
  p.circle(0, 11, 34);
  p.circle(0, 11, 17);
  p.ellipse(6, 2, 16, 24);
}

function drawServo(p, large = false) {
  p.stroke("#59bdd0");
  p.noFill();
  p.rect(large ? -34 : -25, large ? -18 : -13, large ? 68 : 50, large ? 36 : 26, 4);
  p.circle(0, 0, large ? 16 : 12);
}

function drawFan(p) {
  p.noFill();
  p.stroke("#59bdd0");
  p.circle(0, 0, 30);
  p.line(0, 0, 18, -5);
  p.line(0, 0, -12, -15);
  p.line(0, 0, -4, 17);
}

function drawDcMotor(p) {
  p.stroke("#4a4f53");
  p.noFill();
  p.rect(-30, 2, 60, 22, 11);
  p.line(30, 13, 42, 13);
  p.line(-42, 13, -30, 13);
}

function drawStepper(p) {
  p.stroke("#4a4f53");
  p.noFill();
  p.rect(-26, -19, 52, 38, 5);
  p.circle(0, 0, 20);
  p.line(0, 0, 0, -14);
}

function drawRelay(p) {
  p.stroke("#8fc7d4");
  p.noFill();
  p.rect(-30, -15, 60, 30, 4);
  p.noFill();
  p.stroke("#d6bd62");
  p.line(-20, 5, -6, 5);
  p.line(7, 5, 20, 5);
  p.line(-6, 5, 10, -8);
  p.circle(-22, 5, 5);
  p.circle(22, 5, 5);
}

function drawChip(p, label) {
  p.stroke("#59bdd0");
  p.noFill();
  p.rect(-30, -3, 60, 28, 4);
  p.noStroke();
  p.fill("#59bdd0");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(11);
  p.text(label, 0, 11);
}

function drawSensor(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.rect(-24, -13, 48, 26, 4);
  p.circle(0, 0, 8);
}

function drawAnalogSensor(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.rect(-28, -14, 56, 28, 4);
  p.noFill();
  p.stroke("#d6bd62");
  p.line(-18, 7, -8, 7);
  p.line(-8, 7, -2, -6);
  p.line(-2, -6, 6, 6);
  p.line(6, 6, 18, 6);
  p.circle(-18, 7, 4);
  p.circle(18, 6, 4);
}

function drawCloud(p) {
  p.noStroke();
  p.fill("#59666b");
  p.circle(-16, 11, 24);
  p.circle(2, 3, 30);
  p.circle(21, 12, 22);
  p.rect(-27, 10, 58, 16, 8);
}

function drawPowerSupply(p) {
  p.stroke("#61d47c");
  p.noFill();
  p.rect(-38, -16, 76, 32, 5);
  p.noStroke();
  p.fill("#61d47c");
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(12);
  p.text("5V", 0, -3);
  p.textStyle(p.NORMAL);
  p.textSize(9);
  p.text("GND", 0, 10);
}

function drawDiode(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.line(-28, 0, -12, 0);
  p.line(15, 0, 28, 0);
  p.triangle(-12, -12, -12, 12, 11, 0);
  p.line(15, -13, 15, 13);
}

function drawQuestion(p) {
  p.noStroke();
  p.fill("#d6bd62");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(28);
  p.text("?", 0, 11);
}

function drawNeoPixelRingIllustration(p) {
  p.noStroke();
  p.fill("#3f4548");
  p.circle(0, 0, 54);
  p.fill("#1d2022");
  p.circle(0, 0, 32);
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    p.fill("#f7f7f2");
    p.rect(Math.cos(a) * 21 - 5, Math.sin(a) * 21 - 5, 10, 10, 2);
    p.fill(i % 3 === 0 ? "#59bdd0" : (i % 3 === 1 ? "#d6bd62" : "#d26b5b"));
    p.circle(Math.cos(a) * 21, Math.sin(a) * 21, 5);
  }
}

function drawLedMatrixIllustration(p) {
  p.fill("#1b3470");
  p.noStroke();
  p.rect(-42, -24, 84, 48, 2);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      p.fill("#f7f7f2");
      p.rect(-32 + x * 11, -17 + y * 11, 8, 8, 1);
      p.fill((x + y) % 3 === 0 ? "#59bdd0" : ((x + y) % 3 === 1 ? "#d6bd62" : "#d26b5b"));
      p.circle(-28 + x * 11, -13 + y * 11, 4);
    }
  }
}

function drawButtonIllustration(p) {
  p.noStroke();
  p.fill("#d31717");
  p.rect(-26, -16, 52, 32, 4);
  p.fill("#33383c");
  p.rect(-15, -4, 30, 16, 2);
  p.fill("#f0f0e8");
  for (let i = 0; i < 3; i += 1) p.rect(-17 + i * 17, -13, 6, 4, 1);
}

function drawLedIllustration(p) {
  p.noStroke();
  p.fill("#2b2f32");
  p.rect(-34, -8, 68, 22, 3);
  p.fill("#f05d5d");
  p.circle(0, -3, 28);
  p.fill("#ffb6b6");
  p.circle(-6, -9, 8);
  p.stroke("#8f9699");
  p.strokeWeight(2);
  p.line(-10, 15, -10, 25);
  p.line(10, 15, 10, 25);
}

function drawAnalogSensorIllustration(p) {
  drawModuleIllustration(p, "ADC", "#263f77");
  p.stroke("#f1d15b");
  p.strokeWeight(2);
  p.noFill();
  p.beginShape();
  p.vertex(-20, 10);
  p.vertex(-8, 10);
  p.vertex(-2, -8);
  p.vertex(8, 8);
  p.vertex(20, 8);
  p.endShape();
}

function drawPotIllustration(p, connectorSide = "left") {
  const flip = connectorSide === "right" ? -1 : 1;
  p.push();
  p.scale(flip, 1);
  p.noStroke();
  p.fill("#bdbdb8");
  p.rect(-25, -27, 42, 54, 0);
  p.arc(16, 0, 72, 54, -Math.PI / 2, Math.PI / 2);
  p.fill("#666767");
  [-18, 0, 18].forEach((y) => p.rect(-58, y - 4, 35, 8, 1));
  p.fill("#f3f3ef");
  p.stroke("#5b5d5e");
  p.strokeWeight(3);
  [-18, 0, 18].forEach((y) => p.circle(-12, y, 13));
  p.noStroke();
  p.fill("#050505");
  p.circle(13, 0, 48);
  p.fill("#1f2020");
  p.circle(13, 0, 34);
  p.noFill();
  p.stroke("#5b5d5e");
  p.strokeWeight(3);
  p.circle(13, 0, 34);
  p.stroke("#d5d5d0");
  p.strokeWeight(5);
  p.line(13, -18, 13, 3);
  p.stroke("#8f9699");
  p.strokeWeight(1.2);
  for (let i = 0; i < 26; i += 1) {
    const angle = (Math.PI * 2 * i) / 26;
    const x1 = 13 + Math.cos(angle) * 25;
    const y1 = Math.sin(angle) * 25;
    const x2 = 13 + Math.cos(angle) * 28;
    const y2 = Math.sin(angle) * 28;
    p.line(x1, y1, x2, y2);
  }
  p.pop();
}

function drawDistanceSensorIllustration(p) {
  p.noStroke();
  p.fill("#0f66ad");
  p.rect(-38, -23, 76, 46, 3);
  p.fill("#d8d8d0");
  p.circle(-18, 0, 24);
  p.circle(18, 0, 24);
  p.fill("#5a5f63");
  p.circle(-18, 0, 16);
  p.circle(18, 0, 16);
  p.fill("#f4f0dc");
  for (let i = 0; i < 4; i += 1) p.rect(-18 + i * 12, 21, 4, 9, 1);
}

function drawMicrophoneIllustration(p) {
  drawModuleIllustration(p, "MIC", "#0f66ad");
  p.fill("#202020");
  p.stroke("#707070");
  p.strokeWeight(2);
  p.circle(0, 3, 26);
  p.noStroke();
  p.fill("#111");
  p.circle(0, 3, 15);
}

function drawJoystickIllustration(p) {
  p.noStroke();
  p.fill("#494d50");
  p.rect(-32, -18, 64, 36, 4);
  p.fill("#1b1d20");
  p.circle(0, 0, 33);
  p.fill("#282a2d");
  p.circle(0, 0, 22);
  p.fill("#111");
  p.ellipse(7, -7, 18, 26);
}

function drawServoIllustration(p, large = false, connectorSide = "left") {
  const flip = connectorSide === "right" ? -1 : 1;
  p.push();
  p.scale(flip, 1);
  p.noStroke();
  p.fill("#4b00d8");
  p.rect(large ? -34 : -28, large ? -27 : -23, large ? 48 : 40, large ? 54 : 46, 2);
  p.fill("#2e007d");
  p.rect(large ? -31 : -25, large ? -24 : -20, large ? 42 : 34, large ? 48 : 40, 1);
  p.fill("#f2f2ef");
  p.stroke("#d6d8d8");
  p.strokeWeight(2);
  p.rect(0, -8, large ? 58 : 48, 16, 8);
  p.noStroke();
  p.fill("#f2f2ef");
  p.circle(-7, 0, large ? 28 : 23);
  p.fill("#4b00d8");
  p.circle(-7, 0, large ? 17 : 14);
  p.fill("#f2f2ef");
  p.circle(-7, 0, large ? 8 : 6);
  p.fill("#d6d8d8");
  [16, 30, 44].forEach((x) => p.circle(x, 0, large ? 5 : 4));
  p.noStroke();
  p.fill("#c45a18");
  p.rect(large ? -22 : -19, large ? 27 : 23, 5, large ? 19 : 16);
  p.fill("#c62828");
  p.rect(large ? -16 : -13, large ? 27 : 23, 5, large ? 19 : 16);
  p.fill("#6d4c41");
  p.rect(large ? -10 : -7, large ? 27 : 23, 5, large ? 19 : 16);
  p.pop();
}

function drawFanIllustration(p) {
  p.noStroke();
  p.fill("#33383c");
  p.rect(-35, -20, 70, 40, 4);
  p.fill("#58c4d6");
  p.circle(0, 0, 34);
  p.fill("#1d2022");
  p.circle(0, 0, 10);
  p.fill("#33383c");
  for (let i = 0; i < 3; i += 1) {
    p.push();
    p.rotate((Math.PI * 2 * i) / 3);
    p.ellipse(11, 0, 24, 9);
    p.pop();
  }
}

function drawDcMotorIllustration(p, connectorSide = "left") {
  const flip = connectorSide === "right" ? -1 : 1;
  p.push();
  p.scale(flip, 1);
  p.noStroke();
  p.fill("#efefed");
  p.stroke("#5d5f60");
  p.strokeWeight(2.4);
  p.rect(-34, -18, 68, 36, 10);
  p.line(-18, -18, -18, 18);
  p.noStroke();
  p.fill("#8b8c8c");
  p.rect(33, -6, 9, 12, 2);
  p.fill("#666767");
  p.rect(41, -3, 22, 6, 1);
  p.pop();
}

function drawStepperIllustration(p) {
  p.noStroke();
  p.fill("#cfcfca");
  p.rect(-29, -22, 58, 44, 5);
  p.fill("#9c9b95");
  p.circle(0, 0, 24);
  p.fill("#eeeeea");
  p.circle(0, 0, 10);
  p.fill("#606060");
  p.rect(-5, -35, 10, 18, 2);
}

function drawRelayIllustration(p) {
  p.noStroke();
  p.fill("#126a96");
  p.rect(-32, -20, 64, 40, 4);
  p.fill("#0b4664");
  p.rect(-22, -12, 44, 24, 2);
  p.fill("#f4f0dc");
  for (let i = 0; i < 3; i += 1) p.rect(-18 + i * 18, 18, 5, 10, 1);
}

function drawBuzzerIllustration(p) {
  p.noStroke();
  p.fill("#111");
  p.ellipse(0, -27, 20, 28);
  p.ellipse(0, 27, 20, 28);
  p.fill("#f2f2ef");
  p.circle(0, -30, 7);
  p.circle(0, 30, 7);
  p.fill("#050505");
  p.circle(0, 0, 58);
  p.noFill();
  p.stroke("#555b60");
  p.strokeWeight(5);
  p.arc(0, 0, 58, 58, -0.8, 0.75);
  p.arc(0, 0, 58, 58, 1.2, 2.1);
  p.stroke("#2b2f32");
  p.strokeWeight(0.9);
  [44, 36, 28, 20, 12].forEach((diameter) => p.circle(0, 0, diameter));
  p.noStroke();
  p.fill("#e7e8e3");
  p.circle(0, 0, 16);
}

function drawModuleIllustration(p, label, color = "#1565c0") {
  p.noStroke();
  p.fill(color);
  p.rect(-34, -20, 68, 40, 3);
  p.fill("#0e2233");
  p.rect(-17, -10, 34, 20, 2);
  p.fill("#f4f0dc");
  for (let i = 0; i < 4; i += 1) p.circle(-24 + i * 16, 16, 4);
  p.fill("#d9f1ff");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(8);
  p.text(label, 0, 0);
}

function drawWifiIllustration(p) {
  p.noStroke();
  p.fill("#0d47a1");
  p.rect(-31, -23, 62, 46, 3);
  p.fill("#f4c02f");
  for (let i = 0; i < 8; i += 1) p.circle(-36, -17 + i * 5, 3);
  for (let i = 0; i < 8; i += 1) p.circle(36, -17 + i * 5, 3);
  p.noFill();
  p.stroke("#f4c02f");
  p.strokeWeight(2);
  p.rect(-16, -8, 32, 24, 2);
}

function drawPowerSupplyIllustration(p) {
  p.noStroke();
  p.fill("#26312b");
  p.rect(-45, -18, 90, 36, 5);
  p.stroke("#61d47c");
  p.strokeWeight(2);
  p.noFill();
  p.rect(-31, -11, 62, 22, 3);
  p.noStroke();
  p.fill("#61d47c");
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(12);
  p.text("5V", 0, -2);
  p.textStyle(p.NORMAL);
}

function drawDiodeIllustration(p) {
  p.noStroke();
  p.fill("#101820");
  p.rect(-34, -16, 68, 32, 4);
  p.stroke("#d6bd62");
  p.strokeWeight(3);
  p.noFill();
  p.line(-26, 0, -10, 0);
  p.line(15, 0, 28, 0);
  p.triangle(-10, -11, -10, 11, 12, 0);
  p.line(16, -12, 16, 12);
}

function drawSensorIllustration(p) {
  drawModuleIllustration(p, "SENS", "#263f77");
}

function computeTransform(width, height) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H);
  return {
    scale,
    ox: (width - WORLD_W * scale) / 2,
    oy: (height - WORLD_H * scale) / 2,
  };
}

function screenToWorld(x, y, transform) {
  return {
    x: (x - transform.ox) / transform.scale,
    y: (y - transform.oy) / transform.scale,
  };
}

function makeSmallLine(text) {
  const li = document.createElement("li");
  li.textContent = String(text);
  return li;
}

function compactCircuitNotes(assumptions = [], notes = []) {
  const lines = dedupe([...stringArray(assumptions), ...stringArray(notes)]);
  const hasLargeServoSpecific = lines.some((line) => /large servo should use external 5v power/i.test(line));
  const hasNeoPixelSpecific = lines.some((line) => /neopixels can draw|neopixels x/i.test(line));
  const hasExternalSupplySpecific = lines.some((line) => /external 5v supply is used|should use external 5v power|should use external power/i.test(line));
  return lines.filter((line) => {
    if (hasLargeServoSpecific && /^(large\s+)?servo needs suitable power/i.test(line)) return false;
    if (hasExternalSupplySpecific && /needs suitable power; dense inferred diagrams/i.test(line)) return false;
    if (hasNeoPixelSpecific && /^neopixels need v, data, and gnd/i.test(line)) return false;
    return true;
  });
}

function uniqueId(base, seen) {
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
  let id = slug;
  let n = 2;
  while (seen.has(id)) {
    id = `${slug}-${n}`;
    n += 1;
  }
  seen.add(id);
  return id;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}
