const CIRCUIT_VERSION = "0.1";
const WORLD_W = 1000;
const WORLD_H = 640;

const pinDefs = [
  { pin: "3V3", side: "left", power: true, desc: "3.3V power" },
  { pin: "GND", side: "left", ground: true, desc: "Ground" },
  { pin: "36", side: "left", adc: true, inputOnly: true, desc: "GPIO36, ADC input only" },
  { pin: "39", side: "left", adc: true, inputOnly: true, desc: "GPIO39, ADC input only" },
  { pin: "34", side: "left", adc: true, inputOnly: true, desc: "GPIO34, ADC input only" },
  { pin: "35", side: "left", adc: true, inputOnly: true, desc: "GPIO35, ADC input only" },
  { pin: "32", side: "left", adc: true, pwm: true, desc: "GPIO32, ADC, PWM" },
  { pin: "33", side: "left", adc: true, pwm: true, desc: "GPIO33, ADC, PWM" },
  { pin: "25", side: "left", adc: true, dac: true, pwm: true, desc: "GPIO25, ADC, DAC, PWM" },
  { pin: "26", side: "left", adc: true, dac: true, pwm: true, desc: "GPIO26, ADC, DAC, PWM" },
  { pin: "27", side: "left", adc: true, pwm: true, desc: "GPIO27, ADC, PWM" },
  { pin: "14", side: "left", adc: true, pwm: true, desc: "GPIO14, ADC, PWM" },
  { pin: "12", side: "left", adc: true, pwm: true, caution: true, desc: "GPIO12, ADC, boot strap pin" },
  { pin: "GND2", side: "left", ground: true, label: "GND", desc: "Ground" },
  { pin: "VIN", side: "left", power: true, desc: "VIN / USB 5V" },

  { pin: "23", side: "right", pwm: true, desc: "GPIO23, SPI MOSI capable" },
  { pin: "22", side: "right", pwm: true, i2c: "SCL", desc: "GPIO22, common I2C SCL" },
  { pin: "1", side: "right", serial: "TX0", caution: true, desc: "UART0 TX, USB serial transport" },
  { pin: "3", side: "right", serial: "RX0", caution: true, desc: "UART0 RX, USB serial transport" },
  { pin: "21", side: "right", pwm: true, i2c: "SDA", desc: "GPIO21, common I2C SDA" },
  { pin: "19", side: "right", pwm: true, desc: "GPIO19, SPI MISO capable" },
  { pin: "18", side: "right", pwm: true, desc: "GPIO18, SPI SCK capable" },
  { pin: "5", side: "right", pwm: true, caution: true, desc: "GPIO5, boot strap pin" },
  { pin: "17", side: "right", pwm: true, serial: "TX2", desc: "GPIO17, UART TX capable" },
  { pin: "16", side: "right", pwm: true, serial: "RX2", desc: "GPIO16, UART RX capable" },
  { pin: "4", side: "right", adc: true, pwm: true, desc: "GPIO4, ADC, PWM, common LED strip data" },
  { pin: "2", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO2, ADC, PWM, boot LED/strap" },
  { pin: "15", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO15, ADC, PWM, boot strap pin" },
  { pin: "GND3", side: "right", ground: true, label: "GND", desc: "Ground" },
  { pin: "3V3B", side: "right", power: true, label: "3V3", desc: "3.3V power" },
];

const componentTypes = {
  button: { label: "Button", icon: "button", signal: "GPIO", needs: ["signal", "gnd"] },
  led: { label: "LED", icon: "light", signal: "GPIO", needs: ["signal", "gnd"] },
  ledStrip: { label: "LED strip", icon: "strip", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelRing: { label: "NeoPixel ring", icon: "ring", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelMatrix: { label: "NeoPixel matrix", icon: "matrix", signal: "Data", needs: ["data", "5v", "gnd"] },
  analogSensor: { label: "Analog sensor", icon: "sensor", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  digitalSensor: { label: "Digital sensor", icon: "sensor", signal: "GPIO", needs: ["signal", "3v3", "gnd"] },
  distanceSensor: { label: "Distance sensor", icon: "distance", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  ultrasonicSensor: { label: "Ultrasonic sensor", icon: "ultrasonic", signal: "Trig/Echo", needs: ["trigger", "echo", "5v", "gnd"] },
  microphone: { label: "Microphone", icon: "mic", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  joystick: { label: "Joystick", icon: "joystick", signal: "X/Y/SW", needs: ["x", "y", "sw", "3v3", "gnd"] },
  potentiometer: { label: "Potentiometer", icon: "pot", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  servo: { label: "Servo", icon: "servo", signal: "PWM", needs: ["signal", "5v", "gnd"] },
  fan: { label: "Fan", icon: "fan", signal: "PWM", needs: ["signal", "power", "gnd"] },
  dcMotor: { label: "DC motor", icon: "motor", signal: "driver", needs: ["signal", "power", "gnd"] },
  stepperMotor: { label: "Stepper motor", icon: "stepper", signal: "driver", needs: ["signal", "power", "gnd"] },
  buzzer: { label: "Buzzer", icon: "speaker", signal: "PWM", needs: ["signal", "gnd"] },
  relay: { label: "Relay", icon: "relay", signal: "GPIO", needs: ["signal", "power", "gnd"] },
  i2cDevice: { label: "I2C device", icon: "i2c", signal: "SDA/SCL", needs: ["sda", "scl", "3v3", "gnd"] },
  imu: { label: "IMU / MPU", icon: "imu", signal: "I2C", needs: ["sda", "scl", "3v3", "gnd"] },
  uartDevice: { label: "Serial device", icon: "uart", signal: "RX/TX", needs: ["rx", "tx", "gnd"] },
  mp3Player: { label: "MP3 player", icon: "mp3", signal: "RX/TX", needs: ["rx", "tx", "power", "gnd"] },
  touchPad: { label: "Touch input", icon: "touch", signal: "Touch", needs: ["signal"] },
  wifiService: { label: "WiFi / API", icon: "cloud", signal: "Network", needs: [] },
  unknown: { label: "Unknown part", icon: "question", signal: "?", needs: ["signal"] },
};

export function inferCircuitLayout(code, chatLayout = null) {
  const source = String(code || "");
  const parsed = inferFromSource(source);
  const normalizedChat = normalizeCircuitLayout(chatLayout);
  if (!normalizedChat) return parsed;

  const merged = normalizeCircuitLayout({
    ...parsed,
    ...normalizedChat,
    components: mergeComponents(parsed.components, normalizedChat.components),
    connections: mergeConnections(parsed.connections, normalizedChat.connections),
    assumptions: [...(parsed.assumptions || []), ...(normalizedChat.assumptions || [])],
    notes: [...(parsed.notes || []), ...(normalizedChat.notes || [])],
  });
  return merged || parsed;
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
  const placed = placeComponents(components);
  const connections = Array.isArray(layout.connections)
    ? layout.connections.map((connection, index) => normalizeConnection(connection, index)).filter(Boolean)
    : [];
  return {
    version: String(layout.version || CIRCUIT_VERSION),
    board,
    components: placed,
    connections,
    assumptions: stringArray(layout.assumptions),
    notes: stringArray(layout.notes),
  };
}

export function initCircuitView({ mount, componentList, assumptions, json, pinInfo } = {}) {
  let model = normalizeCircuitLayout({});
  let hoveredPin = null;
  let dragging = null;
  let p5Instance = null;
  let transform = { scale: 1, ox: 0, oy: 0 };

  const setModel = (nextModel) => {
    model = normalizeCircuitLayout(nextModel) || normalizeCircuitLayout({});
    renderSidePanel(model);
    if (p5Instance) p5Instance.redraw();
  };

  const resize = () => {
    if (!p5Instance || !mount) return;
    const rect = mount.getBoundingClientRect();
    p5Instance.resizeCanvas(Math.max(320, rect.width), Math.max(260, rect.height));
    p5Instance.redraw();
  };

  if (!mount) return { setModel, resize, getModel: () => model };

  if (!window.p5) {
    mount.textContent = "Circuit canvas unavailable.";
    return { setModel, resize, getModel: () => model };
  }

  p5Instance = new window.p5((p) => {
    p.setup = () => {
      const rect = mount.getBoundingClientRect();
      p.createCanvas(Math.max(320, rect.width), Math.max(260, rect.height));
      p.noLoop();
    };
    p.draw = () => {
      p.background("#141516");
      transform = computeTransform(p.width, p.height);
      p.push();
      p.translate(transform.ox, transform.oy);
      p.scale(transform.scale);
      drawGrid(p);
      drawConnections(p, model);
      drawBoard(p, model.board, hoveredPin);
      drawComponents(p, model.components);
      p.pop();
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
      if (!component) return;
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
  return { setModel, resize, getModel: () => model };

  function renderSidePanel(nextModel) {
    if (json) json.textContent = JSON.stringify(stripVolatileModelFields(nextModel), null, 2);
    if (componentList) {
      componentList.replaceChildren();
      if (!nextModel.components.length) {
        componentList.append(makeSmallLine("No concrete parts found yet."));
      } else {
        nextModel.components.forEach((component) => {
          const item = document.createElement("li");
          const title = document.createElement("strong");
          title.textContent = component.label || componentTypes[component.type]?.label || component.type;
          const meta = document.createElement("span");
          meta.textContent = component.pin ? `GPIO ${component.pin}` : (component.kind || component.type);
          item.append(title, meta);
          componentList.append(item);
        });
      }
    }
    if (assumptions) {
      assumptions.replaceChildren();
      const lines = [...(nextModel.assumptions || []), ...(nextModel.notes || [])].filter(Boolean).slice(0, 8);
      if (!lines.length) assumptions.append(makeSmallLine("Clear enough."));
      lines.forEach((line) => assumptions.append(makeSmallLine(line)));
    }
  }

  function renderPinInfo(pin) {
    if (!pinInfo) return;
    pinInfo.textContent = pin ? `${pin.label || pin.pin}: ${pin.desc}` : "Hover a pin.";
  }
}

function inferFromSource(source) {
  const vars = parseNumericVars(source);
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
    const mode = String(args[1] || "").toUpperCase();
    if (mode.includes("INPUT_PULLUP") || mode === "2") {
      add("button", pin, { label: likelyLabel(lower, "button", "Button"), inferredFrom: "pinMode INPUT_PULLUP", confidence: 0.9 });
      assumptions.push(`GPIO ${pin} uses INPUT_PULLUP, so the drawing assumes a button or switch to GND.`);
    } else if (mode.includes("INPUT") || mode === "0") {
      add("digitalSensor", pin, { inferredFrom: "pinMode INPUT", confidence: 0.68 });
    } else if (mode.includes("OUTPUT") || mode === "1") {
      add(outputTypeFromContext(lower), pin, { inferredFrom: "pinMode OUTPUT", confidence: 0.62 });
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
      add(outputTypeFromContext(lower), pin, { inferredFrom: "digitalWrite", confidence: 0.62 });
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
      add(analogComponentType(lower, source, pin), pin, { inferredFrom: "analogRead", confidence: 0.82 });
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
      add(outputTypeFromContext(lower), pin, { inferredFrom: "analogWrite", confidence: 0.65 });
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
    if (pin !== null) add("servo", pin, { inferredFrom: "servoAttach", confidence: 0.94 });
  });

  collectCalls(source, "fanAttach").forEach((args) => {
    const pin = resolvePin(args[0], vars);
    if (pin !== null) add("fan", pin, { inferredFrom: "fanAttach", confidence: 0.94 });
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

  return normalizeCircuitLayout({
    version: CIRCUIT_VERSION,
    board: { type: "esp32-classic", x: 410, y: 80, w: 180, h: 470 },
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

function ledComponentType(lower, count) {
  if (lower.includes("matrix") || Number(count) >= 64) return "neopixelMatrix";
  if (lower.includes("ring") || lower.includes("circle")) return "neopixelRing";
  return "ledStrip";
}

function analogComponentType(lower, source, pin) {
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
  } else if (["led", "ledStrip", "neopixelRing", "neopixelMatrix", "analogSensor", "digitalSensor", "distanceSensor", "microphone", "joystick", "potentiometer", "servo", "fan", "dcMotor", "stepperMotor", "buzzer", "relay"].includes(type)) {
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    if (["ledStrip", "neopixelRing", "neopixelMatrix", "servo", "fan", "dcMotor", "stepperMotor", "relay"].includes(type)) {
      connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "power" });
      if (["ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) assumptions.push("NeoPixels need V, data, and GND; larger strips should use separate 5V power with common ground.");
      if (["dcMotor", "stepperMotor", "fan"].includes(type)) assumptions.push("Motors and fans should use a driver or transistor stage; this drawing shows the control signal, power, and common ground.");
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
  const type = componentTypes[component.type] ? component.type : "unknown";
  return {
    id: String(component.id || `${type}-${index}`),
    type,
    label: String(component.label || componentTypes[type].label),
    pin: component.pin !== undefined && component.pin !== null ? String(component.pin) : "",
    pins: normalizePins(component.pins),
    x: finiteOrNull(component.x),
    y: finiteOrNull(component.y),
    inferredFrom: String(component.inferredFrom || ""),
    confidence: clamp(numberOr(component.confidence, 0.5), 0, 1),
  };
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
    to: { boardPin: String(boardPin) },
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

function placeComponents(components) {
  const left = [];
  const right = [];
  components.forEach((component, index) => {
    if (component.type === "wifiService") right.push(component);
    else if (index % 2) right.push(component);
    else left.push(component);
  });
  const place = (items, x, y0, gap) => {
    items.forEach((component, index) => {
      if (!Number.isFinite(component.x)) component.x = x;
      if (!Number.isFinite(component.y)) component.y = y0 + index * gap;
    });
  };
  place(left, 120, 82, 86);
  place(right, 750, 82, 86);
  return components;
}

function mergeComponents(base = [], extra = []) {
  const byKey = new Map();
  [...base, ...extra].forEach((component) => {
    const key = component.id || `${component.type}:${component.pin || JSON.stringify(component.pins || {})}`;
    byKey.set(key, { ...(byKey.get(key) || {}), ...component });
  });
  return [...byKey.values()];
}

function mergeConnections(base = [], extra = []) {
  const seen = new Set();
  const out = [];
  [...base, ...extra].forEach((connection) => {
    const key = `${connection.from?.component}:${connection.from?.pin}:${connection.to?.boardPin}:${connection.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(connection);
  });
  return out;
}

function stripVolatileModelFields(model) {
  return {
    version: model.version,
    board: model.board,
    components: model.components,
    connections: model.connections,
    assumptions: model.assumptions,
    notes: model.notes,
  };
}

function drawGrid(p) {
  p.stroke("#1f2224");
  p.strokeWeight(1);
  for (let x = 0; x <= WORLD_W; x += 40) p.line(x, 0, x, WORLD_H);
  for (let y = 0; y <= WORLD_H; y += 40) p.line(0, y, WORLD_W, y);
}

function drawConnections(p, model) {
  const componentsById = new Map(model.components.map((component) => [component.id, component]));
  model.connections.forEach((connection) => {
    const component = componentsById.get(connection.from.component);
    const pin = pinPosition(model.board, connection.to.boardPin);
    if (!component || !pin) return;
    const start = componentAnchor(component, connection.from.pin);
    p.noFill();
    p.stroke(connection.color || "#8fc7d4");
    p.strokeWeight(connection.label === "GND" ? 1.7 : 2.4);
    const mid = (start.x + pin.x) / 2;
    p.bezier(start.x, start.y, mid, start.y, mid, pin.y, pin.x, pin.y);
    p.noStroke();
    p.fill(connection.color || "#8fc7d4");
    p.circle(pin.x, pin.y, 7);
  });
}

function drawBoard(p, board, hovered) {
  p.push();
  p.fill("#202326");
  p.stroke("#50575c");
  p.strokeWeight(2);
  p.rect(board.x, board.y, board.w, board.h, 10);
  p.fill("#111314");
  p.noStroke();
  p.rect(board.x + 46, board.y + 24, board.w - 92, 46, 5);
  p.fill("#f3efe5");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(18);
  p.textStyle(p.BOLD);
  p.text("ESP32", board.x + board.w / 2, board.y + 46);
  p.textStyle(p.NORMAL);
  p.textSize(9);
  p.fill("#a69f93");
  p.text("classic dev board", board.x + board.w / 2, board.y + 68);

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
    p.textAlign(pin.side === "left" ? p.RIGHT : p.LEFT, p.CENTER);
    p.text(pin.label || pin.pin, pin.side === "left" ? pos.x - 10 : pos.x + 10, pos.y);
  });
  p.pop();
}

function pinFill(pin) {
  if (pin.power) return "#d26b5b";
  if (pin.ground) return "#8f9699";
  if (pin.adc) return "#d6bd62";
  if (pin.i2c) return "#59bdd0";
  if (pin.caution) return "#9b7354";
  return "#6f868c";
}

function pinPosition(board, pinName) {
  const key = String(pinName || "");
  const pin = pinDefs.find((item) => item.pin === key || item.label === key);
  if (!pin) return null;
  const sidePins = pinDefs.filter((item) => item.side === pin.side);
  const index = sidePins.findIndex((item) => item.pin === pin.pin);
  const y = board.y + 96 + index * ((board.h - 132) / Math.max(1, sidePins.length - 1));
  const x = pin.side === "left" ? board.x + 15 : board.x + board.w - 15;
  return { x, y, ...pin };
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
  const w = component.type === "ledStrip" ? 170 : 138;
  const h = 62;
  return { x: component.x - w / 2, y: component.y - h / 2, w, h };
}

function drawComponents(p, components) {
  components.forEach((component) => {
    p.push();
    p.translate(component.x, component.y);
    drawComponent(p, component);
    p.pop();
  });
}

function drawComponent(p, component) {
  const w = component.type === "ledStrip" ? 170 : 138;
  const h = 62;
  p.stroke("#43494e");
  p.strokeWeight(1.5);
  p.fill("#1d2022");
  p.rect(-w / 2, -h / 2, w, h, 8);
  p.noStroke();
  p.fill("#f3efe5");
  p.textAlign(p.CENTER, p.TOP);
  p.textSize(12);
  p.textStyle(p.BOLD);
  p.text(component.label, 0, -h / 2 + 7);
  p.textStyle(p.NORMAL);
  p.fill("#a69f93");
  p.textSize(9);
  p.text(component.pin ? `GPIO ${component.pin}` : componentTypes[component.type]?.signal || "", 0, h / 2 - 15);

  if (component.type === "ledStrip") drawLedStrip(p);
  else if (component.type === "neopixelRing") drawNeoPixelRing(p);
  else if (component.type === "neopixelMatrix") drawNeoPixelMatrix(p);
  else if (component.type === "button") drawButton(p);
  else if (component.type === "led") drawLed(p);
  else if (component.type === "potentiometer") drawPot(p);
  else if (component.type === "distanceSensor") drawDistanceSensor(p);
  else if (component.type === "ultrasonicSensor") drawUltrasonic(p);
  else if (component.type === "microphone") drawMic(p);
  else if (component.type === "joystick") drawJoystick(p);
  else if (component.type === "servo") drawServo(p);
  else if (component.type === "fan") drawFan(p);
  else if (component.type === "dcMotor") drawDcMotor(p);
  else if (component.type === "stepperMotor") drawStepper(p);
  else if (component.type === "i2cDevice") drawChip(p, "I2C");
  else if (component.type === "imu") drawChip(p, "IMU");
  else if (component.type === "uartDevice") drawChip(p, "RX/TX");
  else if (component.type === "mp3Player") drawChip(p, "MP3");
  else if (component.type === "wifiService") drawCloud(p);
  else if (component.type === "unknown") drawQuestion(p);
  else drawSensor(p);
}

function drawLedStrip(p) {
  for (let i = 0; i < 8; i += 1) {
    p.fill(i % 3 === 0 ? "#59bdd0" : (i % 3 === 1 ? "#d6bd62" : "#d26b5b"));
    p.rect(-64 + i * 18, -2, 11, 11, 2);
  }
}

function drawNeoPixelRing(p) {
  p.noFill();
  p.stroke("#59bdd0");
  p.circle(0, 10, 38);
  p.noStroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    p.fill(i % 3 === 0 ? "#59bdd0" : (i % 3 === 1 ? "#d6bd62" : "#d26b5b"));
    p.circle(Math.cos(a) * 19, 10 + Math.sin(a) * 19, 5);
  }
}

function drawNeoPixelMatrix(p) {
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      const n = x + y;
      p.fill(n % 3 === 0 ? "#59bdd0" : (n % 3 === 1 ? "#d6bd62" : "#d26b5b"));
      p.rect(-34 + x * 13, -4 + y * 10, 7, 7, 2);
    }
  }
}

function drawButton(p) {
  p.stroke("#b8bec0");
  p.noFill();
  p.line(-22, 8, -7, 8);
  p.line(7, 8, 22, 8);
  p.line(-7, 8, 8, -4);
  p.noStroke();
  p.fill("#b8bec0");
  p.circle(-24, 8, 5);
  p.circle(24, 8, 5);
}

function drawLed(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.circle(0, 8, 25);
  p.line(-4, 17, -16, 28);
  p.line(4, 17, 16, 28);
}

function drawPot(p) {
  p.stroke("#d6bd62");
  p.noFill();
  p.circle(0, 9, 28);
  p.line(0, 9, 10, -2);
}

function drawDistanceSensor(p) {
  p.fill("#202b36");
  p.stroke("#59bdd0");
  p.rect(-32, -3, 64, 30, 4);
  p.fill("#8f9699");
  p.circle(-16, 12, 17);
  p.circle(16, 12, 17);
}

function drawUltrasonic(p) {
  drawDistanceSensor(p);
}

function drawMic(p) {
  p.fill("#243025");
  p.stroke("#61d47c");
  p.rect(-25, -2, 50, 28, 4);
  p.fill("#111314");
  p.circle(0, 12, 22);
}

function drawJoystick(p) {
  p.fill("#26282c");
  p.stroke("#8f9699");
  p.circle(0, 11, 34);
  p.fill("#111314");
  p.circle(0, 11, 17);
  p.fill("#8f9699");
  p.ellipse(6, 2, 16, 24);
}

function drawServo(p) {
  p.fill("#27333a");
  p.stroke("#59bdd0");
  p.rect(-25, -1, 50, 26, 4);
  p.noStroke();
  p.fill("#59bdd0");
  p.circle(0, 12, 12);
}

function drawFan(p) {
  p.noFill();
  p.stroke("#59bdd0");
  p.circle(0, 11, 30);
  p.line(0, 11, 18, 6);
  p.line(0, 11, -12, -4);
  p.line(0, 11, -4, 28);
}

function drawDcMotor(p) {
  p.fill("#c7c7c0");
  p.stroke("#4a4f53");
  p.rect(-30, 2, 60, 22, 11);
  p.line(30, 13, 42, 13);
  p.line(-42, 13, -30, 13);
}

function drawStepper(p) {
  p.fill("#9c9b95");
  p.stroke("#4a4f53");
  p.rect(-26, -5, 52, 38, 5);
  p.fill("#d6d3ca");
  p.circle(0, 14, 20);
  p.line(0, 14, 0, -14);
}

function drawChip(p, label) {
  p.fill("#232a2d");
  p.stroke("#59bdd0");
  p.rect(-30, -3, 60, 28, 4);
  p.noStroke();
  p.fill("#59bdd0");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(11);
  p.text(label, 0, 11);
}

function drawSensor(p) {
  p.fill("#252822");
  p.stroke("#d6bd62");
  p.rect(-24, -2, 48, 26, 4);
  p.noStroke();
  p.fill("#d6bd62");
  p.circle(0, 11, 8);
}

function drawCloud(p) {
  p.noStroke();
  p.fill("#59666b");
  p.circle(-16, 11, 24);
  p.circle(2, 3, 30);
  p.circle(21, 12, 22);
  p.rect(-27, 10, 58, 16, 8);
}

function drawQuestion(p) {
  p.noStroke();
  p.fill("#d6bd62");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(28);
  p.text("?", 0, 11);
}

function componentAnchor(component, pinName) {
  const w = component.type === "ledStrip" ? 170 : 138;
  const x = component.x + (component.x < 500 ? w / 2 : -w / 2);
  let y = component.y;
  const pin = String(pinName || "").toLowerCase();
  if (pin.includes("gnd")) y += 20;
  if (pin.includes("power") || pin.includes("3v3") || pin.includes("5v")) y -= 18;
  if (pin === "scl" || pin === "tx") y += 12;
  if (pin === "sda" || pin === "rx") y -= 2;
  return { x, y };
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
