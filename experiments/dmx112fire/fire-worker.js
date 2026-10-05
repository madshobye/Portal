// The render clock and serial port live here, independently of p5's draw().
importScripts("fire-core.js", "../../P1/portal/dmxSerial.js");

const FRAME_MS = 33;
let settings = { ...FireDmxCore.defaults };
let gl, program, uniforms, pixels, dmx;
let ready = false, previewRequested = false, time = 0, previousTick = 0;
let serialCommand = null, status = "Not connected", lastStatus = "";

// Keep Portal's framing and serial settings. The page grants permission; this
// worker opens the uniquely matching granted port without invoking a picker.
class WorkerDmxSerial extends DmxSerial {
  async connectGrantedPort(info) {
    const ports = await navigator.serial.getPorts();
    const matching = ports.filter(port => {
      const candidate = port.getInfo();
      return candidate.usbVendorId === info.usbVendorId &&
        candidate.usbProductId === info.usbProductId &&
        candidate.bluetoothServiceClassId === info.bluetoothServiceClassId;
    });
    if (matching.length !== 1) {
      throw new Error(matching.length ? "Multiple matching adapters; unplug the extra adapter." : "Adapter permission not available.");
    }
    await this._openPort(matching[0], "known");
  }

  async closeGrantedPort() {
    // Called between writes, and awaited before another connection is allowed.
    this._disconnectRequested = true;
    this.stopOutput();
    this.writer?.releaseLock();
    this.writer = null;
    const port = this.port;
    this.port = null;
    this.connected = false;
    this.connecting = false;
    if (port) await port.close();
    this._setState("disconnected");
  }
}

function reportStatus(next, force = false) {
  status = next;
  const signature = `${status}:${!!dmx?.connected}`;
  if (!force && signature === lastStatus) return;
  lastStatus = signature;
  postMessage({ type: "status", status, connected: !!dmx?.connected });
}

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
  }
  return shader;
}

async function initialize() {
  const canvas = new OffscreenCanvas(FireDmxCore.width, FireDmxCore.height);
  gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
  if (!gl) throw new Error("Background WebGL is unavailable in this browser.");
  const response = await fetch("fire.frag");
  if (!response.ok) throw new Error("Could not load fire.frag");
  const vertex = compile(gl.VERTEX_SHADER, `
    attribute vec2 aPosition;
    varying vec2 vTexCoord;
    void main() {
      vTexCoord = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `);
  const fragment = compile(gl.FRAGMENT_SHADER, await response.text());
  program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Shader linking failed");
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, FireDmxCore.width, FireDmxCore.height);
  uniforms = Object.fromEntries(["uTime", "uWind", "uMode"].map(name => [name, gl.getUniformLocation(program, name)]));
  pixels = new Uint8Array(FireDmxCore.width * FireDmxCore.height * 4);

  if (navigator.serial) {
    dmx = await new WorkerDmxSerial({
      channels: 112, autoReconnect: false, autoReconnectOnRefresh: false,
      autoStream: false, frameIntervalMs: FRAME_MS,
      onError: () => reportStatus("Send failed"),
      onState: state => {
        if (state === "disconnected") reportStatus("Not connected");
      },
    }).init();
  }
  ready = true;
  previousTick = performance.now();
  postMessage({ type: "ready", serialAvailable: !!dmx });
  reportStatus(dmx ? "Not connected" : "Web Serial unavailable");
  void tick();
}

async function tick() {
  const started = performance.now();
  try {
    if (serialCommand) {
      const command = serialCommand;
      serialCommand = null;
      try {
        if (!dmx) throw new Error("Web Serial unavailable in worker.");
        await dmx.closeGrantedPort();
        if (command.type === "connect") {
          reportStatus("Connecting…");
          await dmx.connectGrantedPort(command.info);
        } else reportStatus("Not connected", true);
      } catch (err) {
        reportStatus("Connection failed");
        postMessage({ type: "connection-error", message: err.message });
      }
    }
    const now = performance.now();
    if (!settings.paused) time += (now - previousTick) / 1000 * settings.speed;
    previousTick = now;
    if (gl.isContextLost()) throw new Error("Background WebGL context lost. Reload the sketch.");
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform1f(uniforms.uWind, settings.wind);
    gl.uniform1f(uniforms.uMode, settings.mode);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, FireDmxCore.width, FireDmxCore.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const output = FireDmxCore.sample(pixels, settings);
    if (dmx?.connected) {
      dmx.setChannels(output);
      // Await a complete frame: never overlap break timing or serial writes.
      const sent = await dmx.sendFrame();
      reportStatus(sent ? "Connected" : "Send failed");
    }
    // Pull previews only while the page draws; hidden pages never build a queue.
    if (previewRequested) {
      previewRequested = false;
      const preview = FireDmxCore.previewPixels(pixels);
      postMessage({ type: "preview", pixels: preview, output }, [preview.buffer]);
    }
  } catch (err) {
    // A shader failure must not leave the adapter streaming stale fire values.
    try {
      if (dmx?.connected) {
        dmx.clear();
        await dmx.sendFrame();
        await dmx.closeGrantedPort();
      }
    } finally {
      ready = false;
      postMessage({ type: "fatal", message: err.message });
    }
    return;
  }
  setTimeout(tick, Math.max(1, FRAME_MS - (performance.now() - started)));
}

onmessage = ({ data }) => {
  if (data.type === "settings") settings = { ...settings, ...data.settings };
  if (data.type === "preview" && ready) previewRequested = true;
  if (data.type === "connect" || data.type === "disconnect") serialCommand = data;
};

initialize().catch(err => postMessage({ type: "fatal", message: err.message }));
