const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function coreContext() {
  const context = vm.createContext({ Uint8ClampedArray });
  vm.runInContext(fs.readFileSync(path.join(root, 'fire-core.js'), 'utf8'), context);
  return vm.runInContext('FireDmxCore', context);
}

test('bottom-up WebGL pixels map to the displayed band and all 28 RGBW sections', () => {
  const core = coreContext();
  const pixels = new Uint8Array(core.width * core.height * 4);
  for (let row = 0; row < core.height; row++) {
    for (let x = 0; x < core.width; x++) {
      pixels.set([Math.floor(x / 16) * 8, core.height - 1 - row, 40, 255], (row * core.width + x) * 4);
    }
  }
  const settings = { ...core.defaults, brightness: 1 };
  const output = core.sample(pixels, settings);
  assert.equal(output.length, 112);
  assert.deepEqual(Array.from(output.slice(0, 4)), [0, 115, 40, 0]);
  assert.deepEqual(Array.from(output.slice(-4)), [216, 115, 40, 0]);
  const reversed = core.sample(pixels, { ...settings, reversed: true });
  assert.deepEqual(Array.from(reversed.slice(0, 4)), [216, 115, 40, 0]);
  const rgbw = core.sample(pixels, { ...settings, whiteMix: 1 });
  assert.deepEqual(Array.from(rgbw.slice(-4)), [176, 75, 0, 40]);
  const preview = core.previewPixels(pixels);
  assert.equal(preview[1], 0);
  assert.equal(preview[(core.height - 1) * core.width * 4 + 1], 191);
  assert.ok(core.sample(pixels, { ...settings, blackout: true, testColor: 4 }).every(v => v === 0));
  for (let color = 1; color <= 4; color++) {
    const solid = core.sample(pixels, { ...settings, testColor: color });
    assert.ok(solid.every((v, i) => v === (i % 4 === color - 1 ? 160 : 0)));
  }
});

test('worker renders and writes without page draw calls or preview acknowledgements', async () => {
  const messages = [], timers = [], writes = [], signals = [];
  let clock = 0, shaderTime = 0, rendered = 0, open = false;
  let activeWrites = 0, maximumWrites = 0;
  const port = {
    getInfo: () => ({ usbVendorId: 1027, usbProductId: 24577 }),
    async open(options) { assert.equal(options.baudRate, 250000); open = true; },
    async close() { open = false; },
    async setSignals(value) { signals.push(value.break); },
    writable: { getWriter: () => ({
      async write(bytes) {
        maximumWrites = Math.max(maximumWrites, ++activeWrites);
        await new Promise(setImmediate);
        writes.push(Array.from(bytes));
        activeWrites--;
      },
      releaseLock() { assert.equal(activeWrites, 0); },
    }) },
  };
  const gl = {
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    useProgram() {}, bindBuffer() {}, createBuffer: () => ({}), bufferData() {},
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {}, viewport() {},
    getUniformLocation: (_, name) => name, isContextLost: () => false,
    uniform1f(name, value) { if (name === 'uTime') shaderTime = value; },
    drawArrays() { rendered++; },
    readPixels(x, y, w, h, format, type, pixels) {
      for (let i = 0; i < pixels.length; i += 4) {
        pixels.set([Math.floor(shaderTime * 100) % 255, 60, 20, 255], i);
      }
    },
  };
  const context = vm.createContext({
    Uint8Array, Uint8ClampedArray, Float32Array, console,
    performance: { now: () => clock },
    navigator: { serial: { getPorts: async () => [port], addEventListener() {} } },
    OffscreenCanvas: class { getContext() { return gl; } },
    fetch: async () => ({ ok: true, text: async () => fs.readFileSync(path.join(root, 'fire.frag'), 'utf8') }),
    postMessage: message => messages.push(message),
    setTimeout(fn, delay) {
      if (delay <= 1) return setTimeout(fn, delay); // Portal's DMX break delay
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    // Any accidental autoStream use would fail: the worker owns one awaited loop.
    setInterval() { throw new Error('Unexpected independent serial timer'); },
    clearInterval() {},
  });
  context.importScripts = (...files) => files.forEach(file => {
    vm.runInContext(fs.readFileSync(path.resolve(root, file), 'utf8'), context);
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'fire-worker.js'), 'utf8'), context);
  for (let i = 0; i < 20 && timers.length === 0; i++) await new Promise(setImmediate);
  assert.ok(messages.some(m => m.type === 'ready'));
  async function tick() {
    clock += 33;
    const callback = timers.shift();
    assert.ok(callback, 'worker scheduled its next frame');
    await callback();
  }
  context.onmessage({ data: { type: 'connect', info: port.getInfo() } });
  await tick();
  assert.equal(open, true);
  const initialTime = shaderTime;
  // No page renders, requests, or replies during these iterations.
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(writes.length, 13);
  assert.ok(rendered >= 14);
  assert.ok(shaderTime > initialTime);
  assert.notEqual(writes[0][1], writes.at(-1)[1]);
  assert.equal(maximumWrites, 1);
  assert.ok(writes.every(frame => frame.length === 113 && frame[0] === 0));
  assert.ok(signals.every((value, index) => value === (index % 2 === 0)));
  assert.equal(messages.filter(m => m.type === 'preview').length, 0);
  context.onmessage({ data: { type: 'preview' } });
  await tick();
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(messages.filter(m => m.type === 'preview').length, 1, 'preview queue stays bounded');
  context.onmessage({ data: { type: 'settings', settings: { paused: true } } });
  const frozen = shaderTime;
  await tick();
  assert.equal(shaderTime, frozen);
  context.onmessage({ data: { type: 'settings', settings: { blackout: true } } });
  await tick();
  assert.ok(writes.at(-1).every(v => v === 0));
  context.onmessage({ data: { type: 'disconnect' } });
  const count = writes.length;
  await tick();
  assert.equal(open, false);
  assert.equal(writes.length, count);
  context.onmessage({ data: { type: 'connect', info: port.getInfo() } });
  await tick();
  assert.equal(open, true);
  assert.equal(writes.length, count + 1);
});
