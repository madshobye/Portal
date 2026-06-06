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
const COMPONENT_ILLUSTRATION_PIN_X = 52;
const NEOPIXEL_MAX_MA_PER_PIXEL = 60;
const BOARD_NEOPIXEL_POWER_BUDGET_MA = 500;
const BOARD_PIN_EDGE_INSET = 8;

const COMPONENT_ACCENTS = {
  physicalInput: { wire: "#9aa0a3", outline: "#d2d8da" },
  sensor: { wire: "#0097a7", outline: "#68d8e6" },
  light: { wire: "#c99700", outline: "#f1d15b" },
  actuator: { wire: "#7e57c2", outline: "#b99af2" },
  comms: { wire: "#1565c0", outline: "#82b8ff" },
  power: { wire: "#27ae60", outline: "#69e489" },
  protection: { wire: WIRE_POWER, outline: "#ff8a80" },
  unknown: { wire: "#8f9699", outline: "#d6bd62" },
};

const classicPinDefs = [
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

const d1MiniPinDefs = [
  { pin: "EN", side: "left", caution: true, desc: "Enable/reset pin, not a GPIO" },
  { pin: "36", side: "left", adc: true, inputOnly: true, desc: "GPIO36 / SVP, ADC input only" },
  { pin: "26", side: "left", adc: true, dac: true, pwm: true, desc: "GPIO26, ADC, DAC, PWM" },
  { pin: "18", side: "left", pwm: true, desc: "GPIO18, SPI SCK capable" },
  { pin: "19", side: "left", pwm: true, desc: "GPIO19, SPI MISO capable" },
  { pin: "23", side: "left", pwm: true, desc: "GPIO23, SPI MOSI capable" },
  { pin: "5", side: "left", pwm: true, caution: true, desc: "GPIO5, boot strap pin" },
  { pin: "13", side: "left", adc: true, pwm: true, desc: "GPIO13, ADC, PWM" },
  { pin: "10", side: "left", caution: true, desc: "GPIO10 / flash pin" },
  { pin: "GND", side: "left", ground: true, desc: "Ground" },
  { pin: "39", side: "left", adc: true, inputOnly: true, desc: "GPIO39 / SVN, ADC input only" },
  { pin: "35", side: "left", adc: true, inputOnly: true, desc: "GPIO35, ADC input only" },
  { pin: "33", side: "left", adc: true, pwm: true, desc: "GPIO33, ADC, PWM" },
  { pin: "34", side: "left", adc: true, inputOnly: true, desc: "GPIO34, ADC input only" },
  { pin: "9", side: "left", caution: true, desc: "GPIO9 / flash pin" },
  { pin: "1", side: "left", serial: "TX0", caution: true, desc: "UART0 TX, USB serial transport" },

  { pin: "3V3", side: "right", power: true, desc: "3.3V power" },
  { pin: "VIN", side: "right", power: true, label: "5V", desc: "5V / VCC power" },
  { pin: "GND3", side: "right", ground: true, label: "GND", desc: "Ground" },
  { pin: "27", side: "right", adc: true, pwm: true, desc: "GPIO27, ADC, PWM" },
  { pin: "25", side: "right", adc: true, dac: true, pwm: true, desc: "GPIO25, ADC, DAC, PWM" },
  { pin: "32", side: "right", adc: true, pwm: true, desc: "GPIO32, ADC, PWM" },
  { pin: "12", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO12, ADC, boot strap pin" },
  { pin: "4", side: "right", adc: true, pwm: true, desc: "GPIO4, ADC, PWM, common LED strip data" },
  { pin: "0", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO0, boot strap pin" },
  { pin: "2", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO2, ADC, PWM, boot LED/strap" },
  { pin: "15", side: "right", adc: true, pwm: true, caution: true, desc: "GPIO15, ADC, PWM, boot strap pin" },
  { pin: "16", side: "right", pwm: true, serial: "RX2", desc: "GPIO16, UART RX capable" },
  { pin: "17", side: "right", pwm: true, serial: "TX2", desc: "GPIO17, UART TX capable" },
  { pin: "21", side: "right", pwm: true, i2c: "SDA", desc: "GPIO21, common I2C SDA" },
  { pin: "22", side: "right", pwm: true, i2c: "SCL", desc: "GPIO22, common I2C SCL" },
  { pin: "3", side: "right", serial: "RX0", caution: true, desc: "UART0 RX, USB serial transport" },
];

const boardProfiles = {
  "esp32-classic": { type: "esp32-classic", label: "ESP32", title: "ESP32", pinDefs: classicPinDefs, w: 180, h: 470, usb: "top" },
  "esp32-d1-mini": { type: "esp32-d1-mini", label: "ESP32 D1 mini", title: "ESP32 mini", pinDefs: d1MiniPinDefs, w: 165, h: 430, usb: "bottom" },
};

const pinDefs = classicPinDefs;

const componentTypes = {
  button: { label: "Button", icon: "button", signal: "GPIO", needs: ["signal", "gnd"] },
  led: { label: "LED", icon: "light", signal: "GPIO", needs: ["signal", "gnd"] },
  ledStrip: { label: "NeoPixel strip", icon: "strip", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelRing: { label: "NeoPixel ring", icon: "ring", signal: "Data", needs: ["data", "5v", "gnd"] },
  neopixelMatrix: { label: "LED matrix", icon: "matrix", signal: "Data", needs: ["data", "5v", "gnd"] },
  analogSensor: { label: "Analog sensor", icon: "sensor", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  digitalSensor: { label: "Digital sensor", icon: "sensor", signal: "GPIO", needs: ["signal", "3v3", "gnd"] },
  distanceSensor: { label: "Distance sensor", icon: "distance", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  vl53l0xTof: { label: "GY-VL53L0XV2 ToF", icon: "tof", signal: "I2C", needs: ["3v3", "sda", "scl", "gnd"] },
  ultrasonicSensor: { label: "Ultrasonic sensor", icon: "ultrasonic", signal: "Trig/Echo", needs: ["trigger", "echo", "5v", "gnd"] },
  microphone: { label: "Microphone", icon: "mic", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  joystick: { label: "Joystick", icon: "joystick", signal: "X/Y/SW", needs: ["x", "y", "sw", "3v3", "gnd"] },
  potentiometer: { label: "Potentiometer", icon: "pot", signal: "ADC", needs: ["signal", "3v3", "gnd"] },
  i2sAudioDecoder: { label: "UDA1334A I2S decoder", icon: "audio", signal: "I2S", needs: ["3v3", "bclk", "din", "lrc", "gnd"] },
  ld2410cRadar: { label: "LD2410C radar", icon: "radar", signal: "UART/OUT", needs: ["tx", "rx", "out", "5v", "gnd"] },
  servo: { label: "Servo", icon: "servo", signal: "PWM", needs: ["signal", "5v", "gnd"] },
  servoLarge: { label: "Large servo", icon: "servo", signal: "PWM", needs: ["signal", "5v", "gnd"] },
  fan: { label: "PC fan", icon: "fan", signal: "PWM", needs: ["signal", "power", "gnd"] },
  dcMotor: { label: "DC motor controller", icon: "motor", signal: "IN1/IN2", needs: ["in1", "in2", "power", "gnd"] },
  stepperMotor: { label: "Stepper controller", icon: "stepper", signal: "STEP/DIR", needs: ["step", "dir", "power", "gnd"] },
  buzzer: { label: "Buzzer", icon: "speaker", signal: "PWM", needs: ["signal", "gnd"] },
  relay: { label: "Relay", icon: "relay", signal: "GPIO", needs: ["signal", "power", "gnd"] },
  i2cDevice: { label: "I2C device", icon: "i2c", signal: "SDA/SCL", needs: ["sda", "scl", "3v3", "gnd"] },
  imu: { label: "IMU / MPU", icon: "imu", signal: "I2C", needs: ["sda", "scl", "3v3", "gnd"] },
  uartDevice: { label: "Serial device", icon: "uart", signal: "RX/TX", needs: ["rx", "tx", "gnd"] },
  mp3Player: { label: "DFPlayer Mini", icon: "mp3", signal: "RX/TX", needs: ["rx", "tx", "power", "gnd"] },
  touchPad: { label: "Touch input", icon: "touch", signal: "Touch", needs: ["signal"] },
  wifiService: { label: "WiFi / API", icon: "cloud", signal: "Network", needs: [] },
  uiPanel: { label: "P1E UI preview", icon: "ui", signal: "UI", needs: [] },
  homeAssistant: { label: "Home Assistant preview", icon: "ha", signal: "Wireless", needs: [] },
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
  const board = normalizeBoard(layout.board);
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

function normalizeBoard(board = {}) {
  const type = boardProfiles[board?.type]?.type || "esp32-classic";
  const profile = boardProfiles[type];
  return {
    type,
    x: numberOr(board?.x, (WORLD_W - profile.w) / 2),
    y: numberOr(board?.y, 100),
    w: numberOr(board?.w, profile.w),
    h: numberOr(board?.h, profile.h),
  };
}

function boardWithType(board = {}, type = "esp32-classic") {
  const nextType = boardProfiles[type]?.type || "esp32-classic";
  const profile = boardProfiles[nextType];
  const current = normalizeBoard(board);
  const centerX = current.x + current.w / 2;
  return {
    ...current,
    type: nextType,
    x: centerX - profile.w / 2,
    w: profile.w,
    h: profile.h,
  };
}

function boardProfile(board = null) {
  return boardProfiles[board?.type] || boardProfiles["esp32-classic"];
}

function boardPinDefs(board = null) {
  return boardProfile(board).pinDefs;
}

export function initCircuitView({ mount, componentList, assumptions, pinInfo, alternatives, onComponentOverride } = {}) {
  let model = normalizeCircuitLayout({});
  let hoveredPin = null;
  let selectedComponentId = "";
  let selectedComponentPin = "";
  let dragging = null;
  let p5Instance = null;
  let renderMode = "symbols";
  let boardType = "esp32-classic";
  let transform = { scale: 1, ox: 0, oy: 0 };

  const setModel = (nextModel) => {
    model = normalizeCircuitLayout(nextModel) || normalizeCircuitLayout({});
    model.board = boardWithType(model.board, boardType);
    if (selectedComponentId && !model.components.some((component) => component.id === selectedComponentId)) {
      const replacement = selectedComponentPin
        ? model.components.find((component) => componentSelectionKey(component) === selectedComponentPin)
        : null;
      selectedComponentId = replacement?.id || "";
    }
    if (selectedComponentId) {
      const selected = model.components.find((component) => component.id === selectedComponentId);
      selectedComponentPin = componentSelectionKey(selected);
    } else {
      selectedComponentPin = "";
    }
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
        selectedComponentPin = "";
        renderAlternatives();
        p.redraw();
        return;
      }
      selectedComponentId = component.id;
      selectedComponentPin = componentSelectionKey(component);
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
  const setBoardType = (type = "esp32-classic") => {
    const next = boardProfiles[type]?.type || "esp32-classic";
    if (boardType === next && model.board?.type === next) return;
    boardType = next;
    model.board = boardWithType(model.board, boardType);
    model.components = placeComponents(model.components || [], model.connections || [], model.board);
    renderSidePanel(model);
    renderAlternatives();
    if (p5Instance) p5Instance.redraw();
  };
  return { setModel, resize, downloadPng, getModel: () => model, setRenderMode, setBoardType };

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

function componentSelectionKey(component) {
  return String(
    component?.pin
    || component?.pins?.data
    || component?.pins?.signal
    || component?.pins?.in1
    || component?.pins?.out
    || component?.pins?.din
    || component?.pins?.step
    || component?.pins?.trigger
    || component?.pins?.sda
    || component?.pins?.rx
    || "",
  ).replace(/\D+/g, "");
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
  if (["i2cDevice", "imu", "vl53l0xTof"].includes(type)) return "i2c";
  if (["uartDevice", "mp3Player", "ld2410cRadar"].includes(type)) return "uart";
  if (type === "i2sAudioDecoder") return "audio";
  if (["uiPanel", "homeAssistant", "wifiService"].includes(type)) return "interface";
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

  addKnownProtocolModules(source, vars, add, components);
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

  addUiPreviewComponent(source, add, components);
  addHomeAssistantPreviewComponent(source, add, components);

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
    [/gy\s*-?\s*vl53l0xv?2?|vl53l0x|laser\s*tof|tof\s*distance|time\s*of\s*flight/, "vl53l0xTof"],
    [/uda\s*1334a?|i2s\s*(stereo\s*)?(decoder|dac|audio)|stereo\s*decoder/, "i2sAudioDecoder"],
    [/hi\s*-?\s*link\s*ld\s*2410c?|ld\s*2410c?|microwave\s*radar|presence\s*radar|radar\s*module/, "ld2410cRadar"],
    [/microphone|mic|sound\s*sensor/, "microphone"],
    [/analog\s*sensor/, "analogSensor"],
    [/digital\s*sensor/, "digitalSensor"],
    [/df\s*player\s*mini|dfplayer|mp3\s*player|sound\s*player/, "mp3Player"],
    [/dc\s*motor/, "dcMotor"],
    [/stepper\s*motor|stepper/, "stepperMotor"],
    [/pc\s*fan|case\s*fan|computer\s*fan/, "fan"],
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
    dfplayer: "mp3Player",
    dfplayermini: "mp3Player",
    distancesensor: "distanceSensor",
    fan: "fan",
    gyvl53l0x: "vl53l0xTof",
    gyvl53l0xv2: "vl53l0xTof",
    hilinkld2410c: "ld2410cRadar",
    i2saudio: "i2sAudioDecoder",
    i2sdecoder: "i2sAudioDecoder",
    led: "led",
    ledmatrix: "neopixelMatrix",
    ledstrip: "ledStrip",
    ld2410: "ld2410cRadar",
    ld2410c: "ld2410cRadar",
    matrix: "neopixelMatrix",
    microphone: "microphone",
    mic: "microphone",
    mp3: "mp3Player",
    mp3player: "mp3Player",
    neopixel: "ledStrip",
    neopixelmatrix: "neopixelMatrix",
    neopixelring: "neopixelRing",
    neopixelstrip: "ledStrip",
    pcfan: "fan",
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
    tof: "vl53l0xTof",
    tofmodule: "vl53l0xTof",
    uda1334: "i2sAudioDecoder",
    uda1334a: "i2sAudioDecoder",
    vl53: "vl53l0xTof",
    vl53l0x: "vl53l0xTof",
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

function addKnownProtocolModules(source, vars, add, components) {
  const lower = String(source || "").toLowerCase();
  if (/(gy\s*-?\s*)?vl53l0x|tof|time\s+of\s+flight|laser\s+distance/.test(lower) && !hasType(components, "vl53l0xTof")) {
    const sda = findNamedPin(vars, /sda.*pin|pin.*sda/i);
    const scl = findNamedPin(vars, /scl.*pin|pin.*scl/i);
    const xshut = findNamedPin(vars, /(xshut|shut|enable).*pin|pin.*(xshut|shut|enable)/i);
    const gpio1 = findNamedPin(vars, /(gpio1|interrupt|int).*pin|pin.*(gpio1|interrupt|int)/i);
    if (sda !== null || scl !== null || xshut !== null || gpio1 !== null) {
      add("vl53l0xTof", "", {
        pins: compactPins({ sda, scl, xshut, gpio1 }),
        inferredFrom: "VL53L0X pin names",
        confidence: 0.93,
      });
    }
  }

  if (/(uda\s*1334a?|i2s|stereo\s+decoder|audio\s+dac)/.test(lower) && !hasType(components, "i2sAudioDecoder")) {
    const bclk = findNamedPin(vars, /(bclk|bck|bit.?clock|sclk).*pin|pin.*(bclk|bck|bit.?clock|sclk)/i);
    const din = findNamedPin(vars, /(din|data|dout|i2sdata).*pin|pin.*(din|data|dout|i2sdata)/i);
    const lrc = findNamedPin(vars, /(lrc|lrclk|wsel|word.?select|ws).*pin|pin.*(lrc|lrclk|wsel|word.?select|ws)/i);
    if (bclk !== null || din !== null || lrc !== null) {
      add("i2sAudioDecoder", "", {
        pins: compactPins({ bclk, din, lrc }),
        inferredFrom: "I2S audio pin names",
        confidence: 0.9,
      });
    }
  }

  if (/(hi\s*-?\s*link\s*)?ld\s*2410c?|microwave\s+radar|presence\s+radar|radar\s+module/.test(lower) && !hasType(components, "ld2410cRadar")) {
    const rx = findNamedPin(vars, /(radar.*rx|ld2410.*rx|rx).*pin|pin.*(radar.*rx|ld2410.*rx|rx)/i);
    const tx = findNamedPin(vars, /(radar.*tx|ld2410.*tx|tx).*pin|pin.*(radar.*tx|ld2410.*tx|tx)/i);
    const out = findNamedPin(vars, /(radar.*out|ld2410.*out|presence|motion|out).*pin|pin.*(radar.*out|ld2410.*out|presence|motion|out)/i);
    if (rx !== null || tx !== null || out !== null) {
      add("ld2410cRadar", "", {
        pins: compactPins({ rx, tx, out }),
        inferredFrom: "LD2410C radar pin names",
        confidence: 0.92,
      });
    }
  }
}

function addUiPreviewComponent(source, add, components) {
  if (hasType(components, "uiPanel")) return false;
  const counts = {
    sliders: countCalls(source, ["uiSlider"]),
    toggles: countCalls(source, ["uiToggle"]),
    buttons: countCalls(source, ["uiButton"]),
    values: countCalls(source, ["uiValue"]),
    labels: countCalls(source, ["uiLabel", "uiText"]),
  };
  const used = countCalls(source, ["uiBegin", "uiColor", "uiPoll", "uiGet", "uiUpdate"]) + Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!used) return false;
  const title = firstStringArg(source, "uiBegin") || "Script UI";
  add("uiPanel", "", {
    id: "p1e-ui-preview",
    label: "P1E UI",
    pins: { title, ...counts },
    inferredFrom: "UI bindings",
    confidence: 0.9,
  });
  return true;
}

function addHomeAssistantPreviewComponent(source, add, components) {
  if (hasType(components, "homeAssistant")) return false;
  const counts = {
    lights: countCalls(source, ["haLight", "haOnOffLight", "haRgbLight"]),
    switches: countCalls(source, ["haSwitch"]),
    sensors: countCalls(source, ["haSensor", "haBinarySensor"]),
    numbers: countCalls(source, ["haNumber"]),
    buttons: countCalls(source, ["haButton"]),
  };
  const used = countCalls(source, [
    "haBegin", "haSet", "haUpdate", "haSetRgb", "haGet", "haChanged",
    "haEvent", "haPoll", "haEventIs", "haEventValue", "haPress",
  ]) + Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!used) return false;
  const title = firstStringArg(source, "haBegin") || "Home Assistant";
  add("homeAssistant", "", {
    id: "home-assistant-preview",
    label: "Home Assistant",
    pins: { title, ...counts },
    inferredFrom: "Home Assistant bindings",
    confidence: 0.9,
  });
  return true;
}

function compactPins(pins) {
  const out = {};
  Object.entries(pins || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) out[key] = String(value);
  });
  return out;
}

function hasType(components, type) {
  return components.some((component) => component.type === type);
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
  if (["vl53l0xTof", "i2sAudioDecoder", "ld2410cRadar"].includes(component?.type)) return 90;
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
    || component?.pins?.in1
    || component?.pins?.out
    || component?.pins?.din
    || component?.pins?.bclk
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
  if (/fan/.test(lower)) return { type: "fan", label: "PC fan", confidence: 0.9 };
  if (/stepper/.test(lower)) return { type: "stepperMotor", label: "Stepper controller", confidence: 0.9 };
  if (/dc.?motor|motor/.test(lower)) return { type: "dcMotor", label: "DC motor controller", confidence: 0.86 };
  if (/pot|knob|dial/.test(lower)) return { type: "potentiometer", label: "Potentiometer", confidence: 0.92 };
  if (/vl53|tof|time.?of.?flight|laser.?distance/.test(lower)) return { type: "vl53l0xTof", label: "GY-VL53L0XV2 ToF", confidence: 0.92 };
  if (/uda1334|i2s|stereo.?decoder|audio.?dac/.test(lower)) return { type: "i2sAudioDecoder", label: "UDA1334A I2S decoder", confidence: 0.9 };
  if (/ld2410|microwave.?radar|presence.?radar|radar/.test(lower)) return { type: "ld2410cRadar", label: "LD2410C radar", confidence: 0.9 };
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

function countCalls(source, names) {
  return names.reduce((sum, name) => sum + collectCalls(source, name).length, 0);
}

function firstStringArg(source, name) {
  const args = collectCalls(source, name)[0] || [];
  return unquoteStringLiteral(args[0] || "");
}

function unquoteStringLiteral(value) {
  const text = String(value || "").trim();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text[text.length - 1] !== quote) return "";
  return text.slice(1, -1).replace(/\\(["'\\])/g, "$1");
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
  if (/\b(vl53l0x|vl53|tof|time.?of.?flight|laser.?distance)\b/i.test(lower)) return "vl53l0xTof";
  if (/\b(mpu|imu|gyro|accelerometer|gy-?85|6050)\b/i.test(lower)) return "imu";
  return "i2cDevice";
}

function serialComponentType(lower) {
  if (/\b(ld2410c?|microwave.?radar|presence.?radar|radar)\b/i.test(lower)) return "ld2410cRadar";
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
  const pin = component.pin || component.pins?.signal || component.pins?.data || component.pins?.in1 || component.pins?.step;
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
  if (type === "dcMotor") {
    const in1 = component.pins?.in1 || pin;
    const in2 = component.pins?.in2 || secondaryControlPin(in1);
    if (in1) connections.push({ from: { component: id, pin: "IN1" }, to: { boardPin: in1 }, color: "#59bdd0", label: "IN1" });
    if (in2) connections.push({ from: { component: id, pin: "IN2" }, to: { boardPin: in2 }, color: "#d6bd62", label: "IN2" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    assumptions.push("DC motor controller is shown with two ESP32 control inputs (IN1/IN2), external motor power, and common ground.");
    return;
  }
  if (type === "stepperMotor") {
    const step = component.pins?.step || pin;
    const dir = component.pins?.dir || secondaryControlPin(step);
    if (step) connections.push({ from: { component: id, pin: "STEP" }, to: { boardPin: step }, color: "#59bdd0", label: "STEP" });
    if (dir) connections.push({ from: { component: id, pin: "DIR" }, to: { boardPin: dir }, color: "#d6bd62", label: "DIR" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    assumptions.push("Stepper controller is shown as a driver stage with two ESP32 control inputs (STEP/DIR), common ground, and external motor power.");
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
      if (type === "servo" || type === "relay") {
        connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "5V" });
      }
      if (type === "relay") {
        assumptions.push("Relay module is shown powered from board 5V/VIN with common ground; load-side relay contacts are not shown.");
      } else if (!["servoLarge", "fan", "dcMotor", "stepperMotor"].includes(type)) {
        assumptions.push(`${componentTypes[type]?.label || "This component"} needs suitable power; dense inferred diagrams show signal and common ground${type === "servo" ? "." : " and omit the board-crossing VIN lead."}`);
      }
      if (["dcMotor", "stepperMotor", "fan"].includes(type)) assumptions.push("Motors and fans should use a driver or transistor stage; this drawing shows the control signal and common ground.");
    } else if (["analogSensor", "digitalSensor", "distanceSensor", "microphone", "joystick", "potentiometer"].includes(type)) {
      connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    }
  } else if (type === "i2cDevice" || type === "imu" || type === "vl53l0xTof") {
    if (component.pins?.sda) connections.push({ from: { component: id, pin: "SDA" }, to: { boardPin: component.pins.sda }, color: "#59bdd0", label: "SDA" });
    if (component.pins?.scl) connections.push({ from: { component: id, pin: "SCL" }, to: { boardPin: component.pins.scl }, color: "#d6bd62", label: "SCL" });
    if (component.pins?.xshut) connections.push({ from: { component: id, pin: "XSHUT" }, to: { boardPin: component.pins.xshut }, color: "#7e57c2", label: "XSHUT" });
    if (component.pins?.gpio1) connections.push({ from: { component: id, pin: "GPIO1" }, to: { boardPin: component.pins.gpio1 }, color: "#0097a7", label: "GPIO1" });
    connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    if (type === "vl53l0xTof") assumptions.push("VL53L0X ToF module is drawn as an I2C board; XSHUT/GPIO1 are only shown when named in code.");
  } else if (type === "i2sAudioDecoder") {
    if (component.pins?.bclk) connections.push({ from: { component: id, pin: "BCLK" }, to: { boardPin: component.pins.bclk }, color: "#59bdd0", label: "BCLK" });
    if (component.pins?.din) connections.push({ from: { component: id, pin: "DIN" }, to: { boardPin: component.pins.din }, color: "#d6bd62", label: "DIN" });
    if (component.pins?.lrc) connections.push({ from: { component: id, pin: "LRC" }, to: { boardPin: component.pins.lrc }, color: "#7e57c2", label: "LRC" });
    connections.push({ from: { component: id, pin: "3v3" }, to: { boardPin: "3V3" }, color: "#d26b5b", label: "3V3" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    assumptions.push("UDA1334A is drawn as an I2S DAC/decoder; analog audio output wiring is not shown.");
  } else if (type === "uartDevice" || type === "mp3Player" || type === "ld2410cRadar") {
    if (component.pins?.rx && component.pins.rx !== "?") connections.push({ from: { component: id, pin: "RX" }, to: { boardPin: component.pins.rx }, color: "#59bdd0", label: "RX" });
    if (component.pins?.tx && component.pins.tx !== "?") connections.push({ from: { component: id, pin: "TX" }, to: { boardPin: component.pins.tx }, color: "#d6bd62", label: "TX" });
    if (component.pins?.out) connections.push({ from: { component: id, pin: "OUT" }, to: { boardPin: component.pins.out }, color: "#7e57c2", label: "OUT" });
    if (type === "mp3Player" || type === "ld2410cRadar") connections.push({ from: { component: id, pin: "power" }, to: { boardPin: "VIN" }, color: "#d26b5b", label: "5V" });
    connections.push({ from: { component: id, pin: "gnd" }, to: { boardPin: "GND" }, color: "#8f9699", label: "GND" });
    if (type === "ld2410cRadar") assumptions.push("LD2410C is drawn as a 5V radar module; UART and OUT are shown when named in code.");
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
      powered.push({ component, reason: "PC fan should use external power with common ground." });
      return;
    }
    if (component.type === "dcMotor") {
      powered.push({ component, diode: true, reason: "DC motor controller should use external motor power with common ground and a flyback/back EMF diode across the motor output." });
      return;
    }
    if (component.type === "stepperMotor") {
      powered.push({ component, reason: "Stepper controller should use external motor power with common ground; the driver stage handles coil switching/protection." });
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
        inferredFrom: `${component.label || componentTypes[component.type]?.label || "motor"} protection`,
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
  if (type === "vl53l0xTof") return "XSHUT";
  if (type === "i2sAudioDecoder") return "DIN";
  if (type === "ld2410cRadar") return "OUT";
  if (type === "touchPad") return "touch";
  return "signal";
}

function secondaryControlPin(primaryPin) {
  const primary = String(primaryPin || "");
  const controls = pinDefs
    .filter((pin) => !pin.power && !pin.ground && !pin.inputOnly && pin.pin !== "EN")
    .map((pin) => ({ pin: pin.pin, caution: Boolean(pin.caution) }));
  const index = controls.findIndex((pin) => pin.pin === primary);
  if (index < 0 || !controls.length) return "";
  for (let offset = 1; offset < controls.length; offset += 1) {
    const candidate = controls[(index + offset) % controls.length];
    if (!candidate.caution) return candidate.pin;
  }
  return controls[(index + 1) % controls.length]?.pin || "";
}

function signalColor(type) {
  return componentAccent(type).wire;
}

function componentAccent(type) {
  return COMPONENT_ACCENTS[componentColorGroup(type)] || COMPONENT_ACCENTS.unknown;
}

function componentOutlineColor(type) {
  return componentAccent(type).outline;
}

function componentColorGroup(type) {
  if (["button", "touchPad", "joystick"].includes(type)) return "physicalInput";
  if (["analogSensor", "digitalSensor", "distanceSensor", "ultrasonicSensor", "microphone", "potentiometer", "vl53l0xTof", "ld2410cRadar"].includes(type)) return "sensor";
  if (["led", "ledStrip", "neopixelRing", "neopixelMatrix"].includes(type)) return "light";
  if (["servo", "servoLarge", "fan", "dcMotor", "stepperMotor", "buzzer", "relay"].includes(type)) return "actuator";
  if (["i2cDevice", "imu", "uartDevice", "mp3Player", "i2sAudioDecoder", "wifiService", "uiPanel", "homeAssistant"].includes(type)) return "comms";
  if (type === "powerSupply") return "power";
  if (type === "backEmfDiode") return "protection";
  return "unknown";
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
    const targetPinSide = boardPinSide(connectionForComponentTarget(component, connections)?.to?.boardPin, "", board);
    if (targetPinSide) return targetPinSide;
  }
  if (component.type === "powerSupply") {
    const clusterSide = externalPowerClusterSide(connections, components, board);
    if (clusterSide) return clusterSide;
    return "left";
  }
  const directSide = boardPinSide(component.pin, "", board);
  if (directSide) return directSide;
  for (const pin of Object.values(component.pins || {})) {
    const side = boardPinSide(pin, "", board);
    if (side) return side;
  }
  const counts = { left: 0, right: 0 };
  connections.forEach((connection) => {
    if (connection.from?.component !== component.id) return;
    if (["GND", "GND3", "VIN", "3V3"].includes(String(connection.to?.boardPin || ""))) return;
    const side = boardPinSide(connection.to?.boardPin, "", board);
    if (side) counts[side] += 1;
  });
  if (counts.left !== counts.right) return counts.left > counts.right ? "left" : "right";
  if (["wifiService", "uiPanel", "homeAssistant"].includes(component.type)) return "right";
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
  return boardPinSide(target?.to?.boardPin, "", board);
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
  if (type === "uiPanel") return `${type}:script-ui`;
  if (type === "homeAssistant") return `${type}:ha`;
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
  if (!component || !board) return "right";
  return component.x < board.x + board.w / 2 ? "right" : "left";
}

function componentSideForBoard(component, board, boardPinName = "", componentPinName = "") {
  return componentPrimaryTerminalSide(component, board);
}

function componentSideForComponent(component, otherComponent, board = null) {
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
  if (/(data|signal|sig|in1|step|sda|rx|trigger|touch|din|bclk|lrc|out|xshut|gpio1)/.test(pin)) return 20;
  if (/(in2|dir|scl|tx|echo)/.test(pin)) return 30;
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
  if (board?.type === "esp32-d1-mini") {
    drawD1MiniBoard(p, board, hovered);
    return;
  }
  drawClassicBoard(p, board, hovered);
}

function drawClassicBoard(p, board, hovered) {
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
  p.text(boardProfile(board).title, board.x + board.w / 2, board.y + 76);
  p.textStyle(p.NORMAL);

  boardPinDefs(board).forEach((pin) => {
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

function drawD1MiniBoard(p, board, hovered) {
  p.push();
  p.fill("#214a78");
  p.stroke("#1a3557");
  p.strokeWeight(2);
  const notch = 15;
  p.beginShape();
  p.vertex(board.x + notch, board.y);
  p.vertex(board.x + board.w - notch, board.y);
  p.vertex(board.x + board.w, board.y + notch);
  p.vertex(board.x + board.w, board.y + board.h);
  p.vertex(board.x + board.w * 0.64, board.y + board.h);
  p.vertex(board.x + board.w * 0.58, board.y + board.h - 20);
  p.vertex(board.x + board.w * 0.42, board.y + board.h - 20);
  p.vertex(board.x + board.w * 0.36, board.y + board.h);
  p.vertex(board.x, board.y + board.h);
  p.vertex(board.x, board.y + notch);
  p.endShape(p.CLOSE);

  p.fill("#101214");
  p.noStroke();
  p.rect(board.x + board.w * 0.22, board.y + 30, board.w * 0.56, 92, 2);
  p.fill("#f7f7f2");
  p.stroke("#222");
  p.strokeWeight(1);
  p.rect(board.x + board.w * 0.28, board.y + 56, board.w * 0.44, 70, 1);
  p.noFill();
  p.stroke("#d9b30c");
  p.strokeWeight(2);
  const ax = board.x + board.w * 0.32;
  const ay = board.y + 20;
  p.line(ax, ay + 24, ax, ay);
  p.line(ax, ay, ax + 20, ay);
  p.line(ax + 20, ay, ax + 20, ay + 16);
  p.line(ax + 20, ay + 16, ax + 42, ay + 16);
  p.line(ax + 42, ay + 16, ax + 42, ay);
  p.line(ax + 42, ay, ax + 66, ay);
  p.line(ax + 66, ay, ax + 66, ay + 28);

  p.fill("#f3efe5");
  p.noStroke();
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(13);
  p.textStyle(p.BOLD);
  p.text(boardProfile(board).title, board.x + board.w / 2, board.y + 166);
  p.textStyle(p.NORMAL);

  p.fill("#e8e8e5");
  p.stroke("#222");
  p.strokeWeight(1.5);
  p.rect(board.x + board.w / 2 - 27, board.y + board.h - 44, 54, 36, 5);
  p.noStroke();
  p.fill("#33383c");
  p.textSize(7);
  p.text("USB", board.x + board.w / 2, board.y + board.h - 25);

  p.fill("#0d0e10");
  p.noStroke();
  p.rect(board.x + 38, board.y + board.h - 72, 22, 24, 1);
  p.rect(board.x + board.w - 52, board.y + board.h - 96, 10, 18, 1);
  p.rect(board.x + board.w - 36, board.y + board.h - 64, 8, 10, 1);

  boardPinDefs(board).forEach((pin) => {
    const pos = pinPosition(board, pin.pin);
    if (!pos) return;
    const active = hovered?.pin === pin.pin;
    p.fill("#ffffff");
    p.stroke(active ? "#ffffff" : "#d9b30c");
    p.strokeWeight(active ? 2.5 : 2);
    p.circle(pos.x, pos.y, active ? 12 : 9);
    p.noStroke();
    p.fill(active ? "#202326" : "#d9b30c");
    p.circle(pos.x, pos.y, active ? 4 : 3);
    p.fill(active ? "#202326" : "#f3efe5");
    p.textSize(8);
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
  const pin = findPinDef(pinName, preferredSide, board);
  if (!pin) return null;
  const sidePins = boardPinDefs(board).filter((item) => item.side === pin.side);
  const index = sidePins.findIndex((item) => item.pin === pin.pin);
  const y = board.y + 96 + index * ((board.h - 132) / Math.max(1, sidePins.length - 1));
  const x = pin.side === "left" ? board.x + BOARD_PIN_EDGE_INSET : board.x + board.w - BOARD_PIN_EDGE_INSET;
  return { x, y, ...pin };
}

function pinPositionForComponent(board, pinName, component) {
  return pinPosition(board, pinName, preferredBoardSide(component, board));
}

function findPinDef(pinName, preferredSide = "", board = null) {
  const key = String(pinName || "");
  const defs = boardPinDefs(board);
  if (preferredSide) {
    const preferred = defs.find((item) => item.side === preferredSide && (item.pin === key || item.label === key));
    if (preferred) return preferred;
  }
  return defs.find((item) => item.pin === key || item.label === key) || null;
}

function boardPinSide(pinName, preferredSide = "", board = null) {
  return findPinDef(pinName, preferredSide, board)?.side || "";
}

function boardPinSideForComponent(pinName, component, board) {
  return boardPinSide(pinName, preferredBoardSide(component, board), board);
}

function preferredBoardSide(component, board) {
  if (!component || !board) return "";
  return component.x < board.x + board.w / 2 ? "left" : "right";
}

function hitPin(world, board) {
  for (const pin of boardPinDefs(board)) {
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
    drawComponentSymbol(p, component, connectorSide);
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

function drawComponentSymbol(p, component, connectorSide = "right") {
  const accent = componentOutlineColor(component.type);
  if (component.type === "ledStrip") drawLedStrip(p, accent);
  else if (component.type === "neopixelRing") drawNeoPixelRing(p, accent);
  else if (component.type === "neopixelMatrix") drawNeoPixelMatrix(p, accent);
  else if (component.type === "button") drawButton(p, accent);
  else if (component.type === "led") drawLed(p, accent);
  else if (component.type === "analogSensor") drawAnalogSensor(p, accent);
  else if (component.type === "potentiometer") drawPot(p, accent);
  else if (component.type === "touchPad") drawTouchInput(p, accent);
  else if (component.type === "distanceSensor") drawDistanceSensor(p, accent);
  else if (component.type === "ultrasonicSensor") drawUltrasonic(p, accent);
  else if (component.type === "microphone") drawMic(p, accent);
  else if (component.type === "joystick") drawJoystick(p, accent);
  else if (component.type === "servo" || component.type === "servoLarge") drawServo(p, component.type === "servoLarge", accent);
  else if (component.type === "fan") drawFan(p, accent);
  else if (component.type === "dcMotor") drawDcMotor(p, connectorSide, accent);
  else if (component.type === "stepperMotor") drawStepper(p, connectorSide, accent);
  else if (component.type === "relay") drawRelay(p, accent);
  else if (component.type === "i2cDevice") drawChip(p, "I2C", accent);
  else if (component.type === "imu") drawChip(p, "IMU", accent);
  else if (component.type === "vl53l0xTof") drawChip(p, "ToF", accent);
  else if (component.type === "uartDevice") drawChip(p, "RX/TX", accent);
  else if (component.type === "mp3Player") drawChip(p, "MP3", accent);
  else if (component.type === "i2sAudioDecoder") drawChip(p, "I2S", accent);
  else if (component.type === "ld2410cRadar") drawChip(p, "RADAR", accent);
  else if (component.type === "wifiService") drawCloud(p, accent);
  else if (component.type === "uiPanel") drawUiPreviewSymbol(p, component, accent);
  else if (component.type === "homeAssistant") drawHomeAssistantSymbol(p, component, accent);
  else if (component.type === "powerSupply") drawPowerSupply(p, accent);
  else if (component.type === "backEmfDiode") drawDiode(p, accent);
  else if (component.type === "unknown") drawQuestion(p, accent);
  else drawSensor(p, accent);
}

function drawComponentIllustration(p, component, connectorSide = "right") {
  if (component.type === "ledStrip") drawLedStrip(p);
  else if (component.type === "neopixelRing") drawNeoPixelRingIllustration(p);
  else if (component.type === "neopixelMatrix") drawLedMatrixIllustration(p);
  else if (component.type === "button") drawButtonIllustration(p, connectorSide);
  else if (component.type === "led") drawLedIllustration(p, connectorSide);
  else if (component.type === "analogSensor") drawAnalogSensorIllustration(p, connectorSide);
  else if (component.type === "potentiometer") drawPotIllustration(p, connectorSide);
  else if (component.type === "touchPad") drawTouchInputIllustration(p);
  else if (component.type === "distanceSensor") drawDistanceSensorIllustration(p, connectorSide);
  else if (component.type === "ultrasonicSensor") drawUltrasonicSensorIllustration(p, connectorSide);
  else if (component.type === "microphone") drawMicrophoneIllustration(p, connectorSide);
  else if (component.type === "joystick") drawJoystickIllustration(p, connectorSide);
  else if (component.type === "servo" || component.type === "servoLarge") drawServoIllustration(p, component.type === "servoLarge", connectorSide);
  else if (component.type === "fan") drawFanIllustration(p, connectorSide);
  else if (component.type === "dcMotor") drawDcMotorIllustration(p, connectorSide);
  else if (component.type === "stepperMotor") drawStepperIllustration(p, connectorSide);
  else if (component.type === "relay") drawRelayIllustration(p, connectorSide);
  else if (component.type === "buzzer") drawBuzzerIllustration(p);
  else if (component.type === "i2cDevice") drawModuleIllustration(p, "I2C", "#1565c0", connectorSide, 4);
  else if (component.type === "imu") drawImuIllustration(p, connectorSide);
  else if (component.type === "vl53l0xTof") drawVl53l0xIllustration(p, component, connectorSide);
  else if (component.type === "uartDevice") drawModuleIllustration(p, "UART", "#1565c0", connectorSide, 3);
  else if (component.type === "mp3Player") drawDfPlayerIllustration(p, connectorSide);
  else if (component.type === "i2sAudioDecoder") drawUda1334Illustration(p, component, connectorSide);
  else if (component.type === "ld2410cRadar") drawLd2410Illustration(p, component, connectorSide);
  else if (component.type === "wifiService") drawWifiIllustration(p);
  else if (component.type === "uiPanel") drawUiPreviewIllustration(p, component);
  else if (component.type === "homeAssistant") drawHomeAssistantIllustration(p, component);
  else if (component.type === "powerSupply") drawPowerSupplyIllustration(p);
  else if (component.type === "backEmfDiode") drawDiodeIllustration(p);
  else if (component.type === "unknown") drawQuestion(p);
  else drawSensorIllustration(p, connectorSide);
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
  return component.pin || component.pins?.data || component.pins?.signal || component.pins?.in1 || component.pins?.out || component.pins?.din || component.pins?.step || component.pins?.trigger || component.pins?.sda || component.pins?.rx || "";
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentWidth(type) {
  if (type === "ledStrip") return 180;
  if (type === "neopixelMatrix") return 96;
  if (type === "uiPanel") return 176;
  if (type === "homeAssistant") return 158;
  if (type === "dcMotor" || type === "stepperMotor") return 190;
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
  const base = type === "ledStrip"
    ? 36
    : (type === "neopixelMatrix"
      ? 76
      : (type === "uiPanel" || type === "homeAssistant"
        ? 116
        : (type === "vl53l0xTof"
          ? 96
          : (type === "i2sAudioDecoder"
            ? 82
            : (type === "ld2410cRadar"
              ? 74
              : (type === "servoLarge" ? 62 : (type === "dcMotor" || type === "stepperMotor" ? 72 : (type === "fan" ? 62 : 50))))))));
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
  if (type === "neopixelMatrix") return 1;
  if (type === "dcMotor") return 1;
  if (type === "stepperMotor") return 1;
  if (type === "buzzer") return 1;
  if (type === "powerSupply" || type === "backEmfDiode") return 1.08;
  return 1.18;
}

function componentIllustrationHalfWidth(type) {
  const scale = componentIllustrationScale(type);
  if (type === "ledStrip") return 90;
  if (type === "neopixelMatrix") return 36;
  if (type === "distanceSensor") return 57;
  if (type === "ultrasonicSensor") return 56;
  if (type === "joystick") return 58;
  if (type === "imu") return 52;
  if (type === "mp3Player") return 46;
  if (type === "vl53l0xTof") return 48;
  if (type === "i2sAudioDecoder") return 78;
  if (type === "ld2410cRadar") return 70;
  if (type === "uiPanel") return 78;
  if (type === "homeAssistant") return 68;
  if (["led", "button", "analogSensor", "digitalSensor", "microphone", "relay", "servo", "servoLarge", "fan"].includes(type)) return COMPONENT_ILLUSTRATION_PIN_X;
  if (type === "potentiometer") return COMPONENT_ILLUSTRATION_PIN_X;
  if (type === "powerSupply") return 49;
  if (type === "backEmfDiode") return 56;
  if (type === "servoLarge") return 45;
  if (type === "dcMotor" || type === "stepperMotor") return 90;
  if (type === "buzzer") return 37;
  if (type === "touchPad") return 20;
  return Math.min(componentBodyWidth(type) / 2 - 8, 42 * scale);
}

function componentIllustrationHalfHeight(type) {
  const scale = componentIllustrationScale(type);
  if (type === "distanceSensor") return 28;
  if (type === "ultrasonicSensor") return 28;
  if (type === "joystick") return 47;
  if (type === "imu") return 38;
  if (type === "mp3Player") return 44;
  if (type === "vl53l0xTof") return 50;
  if (type === "i2sAudioDecoder") return 45;
  if (type === "ld2410cRadar") return 40;
  if (type === "uiPanel") return 58;
  if (type === "homeAssistant") return 58;
  if (type === "buzzer") return 43;
  if (type === "potentiometer") return 27;
  if (type === "servoLarge") return 48 * scale;
  if (type === "servo") return 40 * scale;
  if (type === "stepperMotor") return 42;
  if (type === "neopixelMatrix") return 36;
  if (type === "led") return 27 * scale;
  if (type === "button") return 18 * scale;
  if (type === "touchPad") return 20 * scale;
  if (type === "fan") return 34 * scale;
  if (type === "dcMotor") return 40;
  if (type === "powerSupply") return 20 * scale;
  if (type === "backEmfDiode") return 14;
  if (type === "neopixelRing") return 28 * scale;
  return componentBodyHeight(type) / 2;
}

function drawLedStrip(p, accent = componentOutlineColor("ledStrip")) {
  const h = componentBodyHeight("ledStrip");
  p.noStroke();
  p.fill("#303030");
  p.rect(-90, -h / 2, 180, h, 1);
  p.noFill();
  p.stroke(accent);
  p.strokeWeight(1.6);
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

function drawNeoPixelRing(p, accent = componentOutlineColor("neopixelRing")) {
  p.noFill();
  p.stroke(accent);
  p.circle(0, 0, 38);
  p.noStroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    p.fill(i % 3 === 0 ? "#59bdd0" : (i % 3 === 1 ? "#d6bd62" : "#d26b5b"));
    p.circle(Math.cos(a) * 19, Math.sin(a) * 19, 5);
  }
}

function drawNeoPixelMatrix(p, accent = componentOutlineColor("neopixelMatrix")) {
  p.noFill();
  p.stroke(accent);
  p.rect(-28, -28, 56, 56, 4);
  drawSquareMatrixPixels(p, 6, 7, 4, false);
}

function drawSquareMatrixPixels(p, count, pixelSize, gap, withPads = true) {
  const total = count * pixelSize + (count - 1) * gap;
  const start = -total / 2;
  p.noStroke();
  for (let y = 0; y < count; y += 1) {
    for (let x = 0; x < count; x += 1) {
      const px = start + x * (pixelSize + gap);
      const py = start + y * (pixelSize + gap);
      const n = x + y;
      if (withPads) {
        p.fill("#f7f7f2");
        p.rect(px, py, pixelSize, pixelSize, 1);
        p.fill(n % 3 === 0 ? "#59bdd0" : (n % 3 === 1 ? "#d6bd62" : "#d26b5b"));
        p.circle(px + pixelSize / 2, py + pixelSize / 2, pixelSize * 0.5);
      } else {
        p.fill(n % 3 === 0 ? "#59bdd0" : (n % 3 === 1 ? "#d6bd62" : "#d26b5b"));
        p.rect(px, py, pixelSize, pixelSize, 1.5);
      }
    }
  }
}

function drawButton(p, accent = componentOutlineColor("button")) {
  p.stroke(accent);
  p.noFill();
  p.line(-22, 8, -7, 8);
  p.line(7, 8, 22, 8);
  p.line(-7, 8, 8, -4);
  p.noFill();
  p.circle(-24, 8, 5);
  p.circle(24, 8, 5);
}

function drawLed(p, accent = componentOutlineColor("led")) {
  p.stroke(accent);
  p.noFill();
  p.circle(0, 0, 25);
  p.line(-4, 9, -15, 20);
  p.line(4, 9, 15, 20);
}

function drawPot(p, accent = componentOutlineColor("potentiometer")) {
  p.stroke(accent);
  p.noFill();
  p.circle(0, 0, 28);
  p.line(0, 0, 10, -11);
}

function drawDistanceSensor(p, accent = componentOutlineColor("distanceSensor")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-32, -15, 64, 30, 4);
  p.noFill();
  p.circle(-16, 0, 17);
  p.circle(16, 0, 17);
}

function drawUltrasonic(p, accent = componentOutlineColor("ultrasonicSensor")) {
  drawDistanceSensor(p, accent);
}

function drawMic(p, accent = componentOutlineColor("microphone")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-25, -14, 50, 28, 4);
  p.circle(0, 0, 22);
}

function drawJoystick(p, accent = componentOutlineColor("joystick")) {
  p.stroke(accent);
  p.noFill();
  p.circle(0, 11, 34);
  p.circle(0, 11, 17);
  p.ellipse(6, 2, 16, 24);
}

function drawServo(p, large = false, accent = componentOutlineColor("servo")) {
  p.stroke(accent);
  p.noFill();
  p.rect(large ? -34 : -25, large ? -18 : -13, large ? 68 : 50, large ? 36 : 26, 4);
  p.circle(0, 0, large ? 16 : 12);
}

function drawFan(p, accent = componentOutlineColor("fan")) {
  p.noFill();
  p.stroke(accent);
  p.rect(-24, -24, 48, 48, 5);
  p.circle(0, 0, 31);
  p.circle(0, 0, 7);
  [[-17, -17], [17, -17], [-17, 17], [17, 17]].forEach(([x, y]) => p.circle(x, y, 4));
  drawPcFanBlades(p, accent, false);
}

function drawDcMotor(p, connectorSide = "left", accent = componentOutlineColor("dcMotor")) {
  const dir = connectorSide === "left" ? 1 : -1;
  p.push();
  p.translate(dir * 14, 0);
  p.stroke(accent);
  p.noFill();
  p.rect(-dir * 82 - (dir < 0 ? 36 : 0), -23, 36, 46, 3);
  p.noStroke();
  p.fill(accent);
  drawControllerText(p, -dir * 64, "CTRL", 10);
  p.stroke(accent);
  p.noFill();
  p.line(-dir * 46, -7, -dir * 15, -7);
  p.line(-dir * 46, 7, -dir * 15, 7);
  p.rect(dir * 12 - 27, -13, 54, 26, 12);
  p.line(dir * 39, 0, dir * 54, 0);
  p.pop();
}

function drawStepper(p, connectorSide = "left", accent = componentOutlineColor("stepperMotor")) {
  const dir = connectorSide === "left" ? 1 : -1;
  p.push();
  p.translate(dir * 24, 0);
  p.stroke(accent);
  p.noFill();
  p.rect(-dir * 82 - (dir < 0 ? 36 : 0), -26, 36, 52, 3);
  p.noStroke();
  p.fill(accent);
  drawControllerText(p, -dir * 64, "CTRL", 10);
  p.stroke(accent);
  p.noFill();
  [-18, -9, 0, 9, 18].forEach((y) => p.line(-dir * 46, y, -dir * 10, y));
  p.stroke(accent);
  p.rect(dir * 17 - 16, -28, 32, 56, 5);
  p.circle(dir * 17, 0, 18);
  p.line(dir * 17, 0, dir * 17, -20);
  p.pop();
}

function drawRelay(p, accent = componentOutlineColor("relay")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-30, -15, 60, 30, 4);
  p.noFill();
  p.stroke(accent);
  p.line(-20, 5, -6, 5);
  p.line(7, 5, 20, 5);
  p.line(-6, 5, 10, -8);
  p.circle(-22, 5, 5);
  p.circle(22, 5, 5);
}

function drawChip(p, label, accent = componentOutlineColor("i2cDevice")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-30, -3, 60, 28, 4);
  p.noStroke();
  p.fill(accent);
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(11);
  p.text(label, 0, 11);
}

function drawSensor(p, accent = componentOutlineColor("analogSensor")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-24, -13, 48, 26, 4);
  p.circle(0, 0, 8);
}

function drawTouchInput(p, accent = componentOutlineColor("touchPad")) {
  p.stroke(accent);
  p.strokeWeight(1.5);
  p.fill("#050505");
  p.circle(0, 0, 24);
}

function drawAnalogSensor(p, accent = componentOutlineColor("analogSensor")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-28, -14, 56, 28, 4);
  p.noFill();
  p.stroke(accent);
  p.line(-18, 7, -8, 7);
  p.line(-8, 7, -2, -6);
  p.line(-2, -6, 6, 6);
  p.line(6, 6, 18, 6);
  p.circle(-18, 7, 4);
  p.circle(18, 6, 4);
}

function drawCloud(p, accent = componentOutlineColor("wifiService")) {
  p.noStroke();
  p.fill(accent);
  p.circle(-16, 11, 24);
  p.circle(2, 3, 30);
  p.circle(21, 12, 22);
  p.rect(-27, 10, 58, 16, 8);
}

function drawUiPreviewSymbol(p, component, accent = componentOutlineColor("uiPanel")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-54, -34, 108, 68, 6);
  p.line(-42, -14, 42, -14);
  p.line(-42, 4, 42, 4);
  p.noStroke();
  p.fill(accent);
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(11);
  p.text("UI", 0, -22);
  p.rect(-38, 16, 52, 5, 3);
  p.circle(22, 18.5, 10);
}

function drawHomeAssistantSymbol(p, component, accent = componentOutlineColor("homeAssistant")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-44, -34, 88, 68, 9);
  p.circle(0, -6, 26);
  p.noStroke();
  p.fill(accent);
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(10);
  p.text("HA", 0, -6);
  p.circle(-18, 22, 7);
  p.circle(0, 22, 7);
  p.circle(18, 22, 7);
}

function drawPowerSupply(p, accent = componentOutlineColor("powerSupply")) {
  p.stroke(accent);
  p.noFill();
  p.rect(-38, -16, 76, 32, 5);
  p.noStroke();
  p.fill(accent);
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(12);
  p.text("5V", 0, -3);
  p.textStyle(p.NORMAL);
  p.textSize(9);
  p.text("GND", 0, 10);
}

function drawDiode(p, accent = componentOutlineColor("backEmfDiode")) {
  p.stroke(accent);
  p.strokeWeight(2);
  p.noFill();
  drawVerticalDiodeGlyph(p, 22, 12, 10, -9, 11);
}

function drawVerticalDiodeGlyph(p, leadExtent, cathodeY, baseY, tipY, halfWidth) {
  p.line(0, -leadExtent, 0, -cathodeY);
  p.line(0, baseY, 0, leadExtent);
  p.triangle(-halfWidth, baseY, halfWidth, baseY, 0, tipY);
  p.line(-halfWidth - 3, -cathodeY, halfWidth + 3, -cathodeY);
}

function drawQuestion(p, accent = componentOutlineColor("unknown")) {
  p.noStroke();
  p.fill(accent);
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
  p.rect(-36, -36, 72, 72, 2);
  drawSquareMatrixPixels(p, 6, 7.5, 3.5, true);
}

function drawButtonIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#101214");
  p.rect(-31, -8, 62, 24, 4);
  p.fill("#202326");
  p.rect(-25, 0, 50, 13, 2);
  p.fill("#d31818");
  p.rect(-21, -23, 42, 20, 5);
  p.fill("#b91313");
  p.rect(-17, -8, 34, 7, 2);
  p.fill("#ff6767");
  p.rect(-12, -20, 19, 5, 3);
  p.fill("#efefea");
  p.rect(-23, -6, 7, 3, 1);
  p.rect(16, -6, 7, 3, 1);
  drawSidePinStubs(p, side, [-6, 8], { fromX: 31, toX: COMPONENT_ILLUSTRATION_PIN_X, color: "#747b7f", dotColor: "#d7dad8" });
}

function drawLedIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#2b2f32");
  p.rect(-34, -8, 68, 22, 3);
  p.fill("#f05d5d");
  p.circle(0, -3, 28);
  p.fill("#ffb6b6");
  p.circle(-6, -9, 8);
  drawSidePinStubs(p, side, [-8, 8], { fromX: 34, toX: COMPONENT_ILLUSTRATION_PIN_X, color: "#8f9699", dotColor: "#d7dad8" });
}

function drawAnalogSensorIllustration(p, connectorSide = "right") {
  drawModuleIllustration(p, "ADC", "#263f77", connectorSide, 3);
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
  p.rect(-18, -21, 34, 42, 0);
  p.arc(14, 0, 56, 42, -Math.PI / 2, Math.PI / 2);
  p.fill("#666767");
  componentTerminalOffsets(3, null).forEach((y) => p.rect(-COMPONENT_ILLUSTRATION_PIN_X, y - 3, 30, 6, 1));
  p.fill("#f3f3ef");
  p.stroke("#5b5d5e");
  p.strokeWeight(2.4);
  componentTerminalOffsets(3, null).forEach((y) => p.circle(-11, y, 10));
  p.noStroke();
  p.fill("#050505");
  p.circle(12, 0, 39);
  p.fill("#1f2020");
  p.circle(12, 0, 27);
  p.noFill();
  p.stroke("#5b5d5e");
  p.strokeWeight(2.4);
  p.circle(12, 0, 27);
  p.stroke("#d5d5d0");
  p.strokeWeight(4);
  p.line(12, -15, 12, 2);
  p.stroke("#8f9699");
  p.strokeWeight(1.2);
  for (let i = 0; i < 22; i += 1) {
    const angle = (Math.PI * 2 * i) / 22;
    const x1 = 12 + Math.cos(angle) * 20;
    const y1 = Math.sin(angle) * 20;
    const x2 = 12 + Math.cos(angle) * 23;
    const y2 = Math.sin(angle) * 23;
    p.line(x1, y1, x2, y2);
  }
  p.pop();
}

function drawDistanceSensorIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.push();
  p.scale(side, 1);
  p.noStroke();
  p.fill("#4c4e4d");
  p.rect(-42, -16, 84, 32, 2);
  p.fill("#5d5f5e");
  p.rect(-34, -20, 68, 8, 1);
  p.rect(-34, 12, 68, 8, 1);
  p.fill("#303231");
  p.rect(-28, -10, 56, 20, 1);
  p.fill("#161717");
  p.stroke("#3b3e3d");
  p.strokeWeight(2);
  p.circle(-26, 0, 18);
  p.circle(26, 0, 18);
  p.fill("#070707");
  p.circle(-26, 0, 12);
  p.circle(26, 0, 12);
  p.noStroke();
  p.fill("#f4f4ef");
  p.circle(-50, 0, 12);
  p.circle(50, 0, 12);
  p.pop();
  drawSidePinStubs(p, side, [-10, 0, 10], { fromX: 38, toX: 56, color: "#747b7f", dotColor: "#d7dad8" });
}

function drawUltrasonicSensorIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#0f66ad");
  p.rect(-38, -23, 76, 46, 3);
  p.fill("#d8d8d0");
  p.circle(-18, 0, 24);
  p.circle(18, 0, 24);
  p.fill("#5a5f63");
  p.circle(-18, 0, 16);
  p.circle(18, 0, 16);
  drawSidePinStubs(p, side, [-15, -5, 5, 15], { fromX: 38, toX: 54, color: "#747b7f", dotColor: "#d7dad8" });
}

function drawMicrophoneIllustration(p, connectorSide = "right") {
  drawModuleIllustration(p, "MIC", "#0f66ad", connectorSide, 3);
  p.fill("#202020");
  p.stroke("#707070");
  p.strokeWeight(2);
  p.circle(0, 3, 26);
  p.noStroke();
  p.fill("#111");
  p.circle(0, 3, 15);
}

function drawJoystickIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#050505");
  p.rect(-42, -32, 84, 64, 1);
  p.fill("#f7f7f2");
  [[-33, -23], [33, -23], [-33, 23], [33, 23]].forEach(([x, y]) => p.circle(x, y, 12));
  p.fill("#232526");
  p.circle(8, 0, 62);
  p.fill("#131516");
  p.circle(8, 0, 50);
  p.fill("#2e3030");
  p.circle(8, 0, 42);
  p.fill("#202222");
  p.circle(8, 0, 34);
  p.fill("#3b3d3d");
  p.arc(8, 0, 42, 42, 0.45, 1.85);
  drawSidePinHeader(p, side, [-24, -12, 0, 12, 24], {
    fromX: 38,
    toX: 58,
    labels: ["GND", "+5V", "VRx", "VRy", "SW"],
    labelColor: "#f2f2ef",
    dotColor: "#54d76b",
  });
}

function drawServoIllustration(p, large = false, connectorSide = "left") {
  const side = connectorSideSign(connectorSide);
  const bodyW = large ? 76 : 60;
  const bodyH = large ? 46 : 42;
  p.noStroke();
  p.fill(large ? "#111517" : "#4b00d8");
  p.rect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 3);
  p.fill(large ? "#1d2022" : "#2e007d");
  p.rect(-bodyW / 2 + 4, -bodyH / 2 + 4, bodyW - 8, bodyH - 8, 2);
  p.stroke("#d6d8d8");
  p.strokeWeight(2);
  p.fill("#f2f2ef");
  p.rect(-8, -7, large ? 52 : 44, 14, 8);
  p.noStroke();
  p.fill("#f2f2ef");
  p.circle(-8, 0, large ? 26 : 22);
  p.fill(large ? "#111517" : "#4b00d8");
  p.circle(-8, 0, large ? 15 : 13);
  p.fill("#f2f2ef");
  p.circle(-8, 0, large ? 7 : 6);
  p.fill("#d6d8d8");
  [13, 26, 39].forEach((x) => p.circle(x, 0, large ? 5 : 4));
  drawSidePinStubs(p, side, [-16, 0, 16], { fromX: bodyW / 2, toX: COMPONENT_ILLUSTRATION_PIN_X, color: "#8f9699", dotColor: "#d7dad8" });
}

function drawFanIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#171b1e");
  p.rect(-31, -31, 62, 62, 7);
  p.fill("#2b3135");
  p.circle(0, 0, 49);
  p.fill("#101315");
  p.circle(0, 0, 42);
  p.fill("#cbd2d4");
  [[-22, -22], [22, -22], [-22, 22], [22, 22]].forEach(([x, y]) => p.circle(x, y, 7));
  p.fill("#171b1e");
  [[-22, -22], [22, -22], [-22, 22], [22, 22]].forEach(([x, y]) => p.circle(x, y, 3.2));
  drawPcFanBlades(p, "#58c4d6", true);
  p.fill("#1d2022");
  p.circle(0, 0, 12);
  p.fill("#58c4d6");
  p.circle(0, 0, 5);
  drawSidePinStubs(p, side, [-16, 0, 16], { fromX: 31, toX: COMPONENT_ILLUSTRATION_PIN_X, color: "#8f9699", dotColor: "#d7dad8" });
}

function drawPcFanBlades(p, color, filled) {
  p.push();
  if (filled) {
    p.noStroke();
    p.fill(color);
  } else {
    p.noFill();
    p.stroke(color);
  }
  for (let i = 0; i < 4; i += 1) {
    p.push();
    p.rotate((Math.PI * 2 * i) / 4);
    p.beginShape();
    p.vertex(4, -3);
    p.bezierVertex(12, -16, 25, -13, 22, -3);
    p.bezierVertex(18, 3, 11, 5, 5, 3);
    p.endShape(p.CLOSE);
    p.pop();
  }
  p.pop();
}

function drawDcMotorIllustration(p, connectorSide = "left") {
  const dir = connectorSide === "left" ? 1 : -1;
  drawMotorControllerBox(p, -dir * 68, 70);
  drawInternalControllerWires(p, dir, [-8, 8], [WIRE_POWER, WIRE_GROUND], -46, -8);
  p.noStroke();
  p.fill("#efefed");
  p.stroke("#5d5f60");
  p.strokeWeight(2.4);
  p.rect(dir * 26 - 34, -18, 68, 36, 10);
  p.line(dir * 26 - dir * 18, -18, dir * 26 - dir * 18, 18);
  p.noStroke();
  p.fill("#8b8c8c");
  p.rect(dir * 26 + dir * 33 - (dir < 0 ? 9 : 0), -6, 9, 12, 2);
  p.fill("#666767");
  p.rect(dir * 26 + dir * 41 - (dir < 0 ? 22 : 0), -3, 22, 6, 1);
}

function drawStepperIllustration(p, connectorSide = "left") {
  const dir = connectorSide === "left" ? 1 : -1;
  drawMotorControllerBox(p, -dir * 68, 76);
  drawInternalControllerWires(p, dir, [-20, -10, 0, 10, 20], ["#8f9699", "#8f9699", "#8f9699", "#8f9699", "#8f9699"], -46, -11);
  p.noStroke();
  p.fill("#cfcfca");
  p.rect(dir * 25 - 18, -34, 36, 68, 5);
  p.fill("#9c9b95");
  p.circle(dir * 25, 0, 24);
  p.fill("#eeeeea");
  p.circle(dir * 25, 0, 10);
  p.fill("#606060");
  p.rect(dir * 25 - 5, -45, 10, 18, 2);
}

function drawMotorControllerBox(p, x, h) {
  p.noStroke();
  p.fill("#111517");
  p.rect(x - 22, -h / 2, 44, h, 4);
  p.fill("#f3efe5");
  drawControllerText(p, x, "controller", 10);
}

function drawControllerText(p, x, label, size = 10) {
  p.push();
  p.translate(x, 0);
  p.rotate(-Math.PI / 2);
  p.textAlign(p.CENTER, p.CENTER);
  p.textStyle(p.NORMAL);
  p.textSize(size);
  p.text(label, 0, 0);
  p.pop();
}

function drawInternalControllerWires(p, dir, offsets, colors, controllerInnerX, motorInnerX) {
  p.strokeWeight(WIRE_STROKE);
  offsets.forEach((y, index) => {
    p.stroke(colors[index] || "#8f9699");
    p.line(dir * controllerInnerX, y, dir * motorInnerX, y);
  });
}

function drawRelayIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#126a96");
  p.rect(-32, -20, 64, 40, 4);
  p.fill("#0b4664");
  p.rect(-22, -12, 44, 24, 2);
  drawSidePinStubs(p, side, [-16, 0, 16], { fromX: 32, toX: COMPONENT_ILLUSTRATION_PIN_X, color: "#8f9699", dotColor: "#d7dad8" });
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

function drawTouchInputIllustration(p) {
  p.noStroke();
  p.fill("#050505");
  p.circle(0, 0, 34);
}

function connectorSideSign(connectorSide = "right") {
  return connectorSide === "left" ? -1 : 1;
}

function drawSidePinStubs(p, side, offsets, { fromX = 34, toX = 52, color = "#8f9699", dotColor = "#d7dad8" } = {}) {
  p.stroke(color);
  p.strokeWeight(2.4);
  offsets.forEach((y) => {
    p.line(side * fromX, y, side * toX, y);
    p.noStroke();
    p.fill(dotColor);
    p.circle(side * fromX, y, 4.5);
    p.stroke(color);
  });
}

function drawSidePinHeader(p, side, offsets, {
  fromX = 34,
  toX = 52,
  color = "#8f9699",
  dotColor = "#d7dad8",
  labels = [],
  labelColor = "#f2f2ef",
} = {}) {
  drawSidePinStubs(p, side, offsets, { fromX, toX, color, dotColor });
  if (!labels.length) return;
  p.noStroke();
  p.fill(labelColor);
  p.textAlign(side > 0 ? p.RIGHT : p.LEFT, p.CENTER);
  p.textSize(6.5);
  offsets.forEach((y, index) => {
    const label = labels[index] || "";
    if (label) p.text(label, side * (fromX - 5), y);
  });
}

function drawModuleIllustration(p, label, color = "#1565c0", connectorSide = "right", pinCount = 3) {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill(color);
  p.rect(-34, -20, 68, 40, 3);
  p.fill("#0e2233");
  p.rect(-17, -10, 34, 20, 2);
  p.fill("#d9f1ff");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(8);
  p.text(label, 0, 0);
  drawSidePinStubs(p, side, componentTerminalOffsets(pinCount, null), {
    fromX: 34,
    toX: COMPONENT_ILLUSTRATION_PIN_X,
    color: "#8f9699",
    dotColor: "#f4f0dc",
  });
}

function drawImuIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#105a9f");
  p.rect(-36, -28, 72, 56, 3);
  p.fill("#f7f7f2");
  [[-28, -20], [28, -20], [-28, 20], [28, 20]].forEach(([x, y]) => p.circle(x, y, 8));
  p.fill("#22272b");
  p.rect(-12, -10, 24, 20, 3);
  p.fill("#e2c46b");
  for (let i = 0; i < 8; i += 1) {
    const x = -24 + (i % 4) * 16;
    const y = i < 4 ? -17 : 17;
    p.rect(x - 3, y - 2, 6, 4, 1);
  }
  p.stroke("#f7f7f2");
  p.strokeWeight(1.5);
  p.line(18, -3, 27, -12);
  p.line(18, -3, 27, 6);
  p.line(18, -3, 9, -12);
  p.noStroke();
  p.fill("#f7f7f2");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(7);
  p.text("IMU", 0, 19);
  drawSidePinHeader(p, side, [-18, -6, 6, 18], {
    fromX: 33,
    toX: 52,
    labels: ["VCC", "GND", "SCL", "SDA"],
    labelColor: "#f2f2ef",
    dotColor: "#54d76b",
  });
}

function drawDfPlayerIllustration(p, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#22262a");
  p.rect(-29, -36, 58, 72, 3);
  p.fill("#111417");
  p.rect(-17, -24, 34, 30, 2);
  p.fill("#9a9a95");
  p.rect(-15, -22, 30, 26, 2);
  p.stroke("#33383b");
  p.strokeWeight(1.3);
  [-7, 2, 11].forEach((x) => p.line(x, -18, x, -3));
  p.noStroke();
  p.fill("#d8d2be");
  p.rect(-19, 18, 38, 7, 1);
  p.fill("#f2f2ef");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(6.3);
  p.text("DFPlayer", 0, 11);
  p.text("Mini", 0, 28);
  drawSidePinHeader(p, side, [-25, -8, 9, 26], {
    fromX: 28,
    toX: 46,
    labels: ["VCC", "GND", "TX", "RX"],
    labelColor: "#f2f2ef",
    dotColor: "#d7dad8",
  });
}

function drawVl53l0xIllustration(p, component, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#5b2a86");
  p.rect(-18, -42, 36, 84, 4);
  p.fill("#f7f4d4");
  p.stroke("#8b7d40");
  p.strokeWeight(2);
  p.circle(0, -34, 18);
  p.circle(0, 34, 18);
  p.noStroke();
  p.fill(CIRCUIT_BG);
  p.circle(0, -34, 10);
  p.circle(0, 34, 10);
  p.fill("#18191d");
  p.rect(-8, -13, 16, 26, 3);
  p.fill("#30343a");
  p.rect(-5, -8, 10, 16, 2);
  p.fill("#f2f2ef");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(6);
  p.text("VL53", 0, 22);
  drawSidePinHeader(p, side, activeModuleOffsets(component, "vl53l0xTof"), {
    fromX: 18,
    toX: 48,
    labels: activeModuleLabels(component, "vl53l0xTof"),
    labelColor: "#f2f2ef",
    dotColor: "#f7f4d4",
  });
}

function drawUda1334Illustration(p, component, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#7a2a92");
  p.rect(-60, -30, 120, 60, 4);
  p.fill("#f7f4d4");
  [[-50, -21], [50, -21], [-50, 21], [50, 21]].forEach(([x, y]) => p.circle(x, y, 12));
  p.fill(CIRCUIT_BG);
  [[-50, -21], [50, -21], [-50, 21], [50, 21]].forEach(([x, y]) => p.circle(x, y, 7));
  p.fill("#15171a");
  p.rect(-32, -10, 20, 20, 3);
  p.fill("#d9d1bb");
  p.circle(8, -8, 15);
  p.circle(8, 12, 15);
  p.fill("#101112");
  p.rect(32, -9, 30, 18, 4);
  p.fill("#4d4d4d");
  p.rect(54, -6, 13, 12, 2);
  p.stroke("#c6a7d1");
  p.strokeWeight(1.2);
  [-42, -38, -34, -30].forEach((x) => p.line(x, -4, -14, -4 + (x + 42) * 0.8));
  p.noStroke();
  p.fill("#f2f2ef");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(6);
  p.text("UDA1334A", -16, 22);
  drawSidePinHeader(p, side, activeModuleOffsets(component, "i2sAudioDecoder"), {
    fromX: 60,
    toX: 78,
    labels: activeModuleLabels(component, "i2sAudioDecoder"),
    labelColor: "#f2f2ef",
    dotColor: "#d7dad8",
  });
}

function drawLd2410Illustration(p, component, connectorSide = "right") {
  const side = connectorSideSign(connectorSide);
  p.noStroke();
  p.fill("#062a63");
  p.rect(-58, -31, 116, 62, 8);
  p.fill("#f5e28a");
  p.rect(-41, -14, 30, 23, 1);
  p.rect(13, -14, 30, 23, 1);
  p.stroke("#e6c84f");
  p.strokeWeight(1.4);
  p.noFill();
  p.line(-26, 9, -26, 17);
  p.line(28, 9, 28, 17);
  p.line(-26, 17, 0, 22);
  p.line(28, 17, 0, 22);
  p.noStroke();
  p.fill("#0c0c0c");
  p.rect(-13, -1, 26, 26, 4);
  p.fill("#d0b155");
  for (let i = 0; i < 7; i += 1) {
    p.rect(-17 + i * 5.5, -4, 3, 5, 1);
    p.rect(-17 + i * 5.5, 24, 3, 5, 1);
  }
  p.fill("#f2f2ef");
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(7);
  p.text("LD2410C", 0, -22);
  drawSidePinHeader(p, side, activeModuleOffsets(component, "ld2410cRadar"), {
    fromX: 58,
    toX: 70,
    labels: activeModuleLabels(component, "ld2410cRadar"),
    labelColor: "#f2f2ef",
    dotColor: "#d7b23f",
  });
}

function activeModuleOffsets(component, type) {
  return componentTerminalOffsets(activeModulePinCount(component, type), component);
}

function activeModulePinCount(component, type) {
  const pins = component?.pins || {};
  if (type === "vl53l0xTof") {
    const signals = uniquePinNames([component?.pin, pins.sda, pins.scl, pins.xshut, pins.gpio1]).length;
    return Math.max(3, signals + 2);
  }
  if (type === "i2sAudioDecoder") {
    const signals = uniquePinNames([component?.pin, pins.bclk, pins.din, pins.lrc]).length;
    return Math.max(3, signals + 2);
  }
  if (type === "ld2410cRadar") {
    const signals = uniquePinNames([component?.pin, pins.rx, pins.tx, pins.out]).length;
    return Math.max(3, signals + 2);
  }
  return componentDefaultTerminalCount(type);
}

function activeModuleLabels(component, type) {
  const count = activeModulePinCount(component, type);
  if (type === "vl53l0xTof") return ["VIN", "SDA", "SCL", "GND", "GPIO1", "XSHUT"].slice(0, count);
  if (type === "i2sAudioDecoder") return ["3V0", "BCLK", "DIN", "LRC", "GND"].slice(0, count);
  if (type === "ld2410cRadar") return ["VCC", "RX", "TX", "OUT", "GND"].slice(0, count);
  return [];
}

function uniquePinNames(values) {
  return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
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

function drawUiPreviewIllustration(p, component) {
  const title = String(component?.pins?.title || "Script UI").slice(0, 18).toUpperCase();
  const sliders = pinCountValue(component, "sliders");
  const toggles = pinCountValue(component, "toggles");
  const values = pinCountValue(component, "values") + pinCountValue(component, "labels");
  const buttons = pinCountValue(component, "buttons");
  p.noStroke();
  p.fill("#111517");
  p.rect(-76, -52, 152, 104, 8);
  p.fill("#1b1f21");
  p.stroke("#343a3f");
  p.strokeWeight(1.2);
  p.rect(-67, -43, 134, 28, 5);
  p.noStroke();
  p.fill("#f3efe5");
  p.textAlign(p.LEFT, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(8.5);
  p.text(title, -58, -29);
  p.textStyle(p.NORMAL);
  let y = -2;
  if (sliders) {
    p.fill("#a7a29a");
    p.textSize(7.2);
    p.text("slider", -58, y - 9);
    p.fill("#ffb050");
    p.rect(-58, y + 1, 102, 5, 3);
    p.fill("#2f3437");
    p.rect(44, y + 1, 14, 5, 3);
    y += 22;
  }
  if (toggles) {
    p.fill("#a7a29a");
    p.textSize(7.2);
    p.text("toggle", -58, y - 8);
    p.fill("#695322");
    p.stroke("#ffb050");
    p.strokeWeight(1.2);
    p.rect(-58, y, 28, 16, 8);
    p.noStroke();
    p.fill("#ffb050");
    p.circle(-40, y + 8, 12);
    y += 22;
  }
  if (values) {
    p.fill("#ffb050");
    p.textSize(15);
    p.text("87", -58, y + 3);
  }
  if (buttons) {
    p.fill("#263f45");
    p.stroke("#5bbecf");
    p.strokeWeight(1.2);
    p.rect(28, y - 8, 30, 17, 4);
    p.noStroke();
    p.fill("#d8f1f3");
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(8);
    p.text("OK", 43, y);
  }
}

function drawHomeAssistantIllustration(p, component) {
  const lights = pinCountValue(component, "lights");
  const switches = pinCountValue(component, "switches");
  const sensors = pinCountValue(component, "sensors");
  const numbers = pinCountValue(component, "numbers");
  const buttons = pinCountValue(component, "buttons");
  p.noStroke();
  p.fill("#17191a");
  p.rect(-62, -52, 124, 104, 12);
  p.fill("#2b2c2d");
  p.rect(-62, -52, 124, 15, 12);
  p.fill("#f3efe5");
  p.textAlign(p.LEFT, p.CENTER);
  p.textStyle(p.BOLD);
  p.textSize(8);
  p.text("Home Assistant", -50, -27);
  p.textStyle(p.NORMAL);
  if (lights) {
    p.fill("#f7942e");
    p.rect(-20, -4, 40, 47, 14);
    p.fill("#ffffff");
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(11);
    p.text("100%", 0, -13);
    drawTinyBulb(p, 0, 14, "#fff7dd");
  } else {
    p.fill("#253341");
    p.rect(-46, -6, 92, 42, 8);
  }
  const chips = [];
  if (switches) chips.push("switch");
  if (sensors) chips.push("sensor");
  if (numbers) chips.push("number");
  if (buttons) chips.push("button");
  if (!chips.length && !lights) chips.push("entity");
  chips.slice(0, 3).forEach((chip, index) => {
    const x = -36 + index * 36;
    p.fill(index === 0 ? "#ff9d2e" : (index === 1 ? "#f7c74a" : "#f4dfc7"));
    p.circle(x, 43, 11);
    p.fill("#f3efe5");
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(4.8);
    p.text(chip[0].toUpperCase(), x, 43);
  });
}

function drawTinyBulb(p, x, y, color) {
  p.fill(color);
  p.circle(x, y - 4, 12);
  p.rect(x - 4, y + 1, 8, 6, 2);
  p.fill("#17191a");
  p.rect(x - 3, y + 6, 6, 2, 1);
}

function pinCountValue(component, key) {
  const n = Number(component?.pins?.[key] || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function drawDiodeIllustration(p) {
  p.stroke("#050505");
  p.strokeWeight(3.8);
  p.line(-52, 0, -31, 0);
  p.line(30, 0, 52, 0);
  p.noStroke();
  p.fill("#050505");
  p.rect(-31, -12, 38, 24, 1);
  p.fill("#d8d8d4");
  p.rect(7, -12, 10, 24, 0);
  p.fill("#050505");
  p.rect(17, -12, 13, 24, 0);
}

function drawSensorIllustration(p, connectorSide = "right") {
  drawModuleIllustration(p, "SENS", "#263f77", connectorSide, 3);
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
