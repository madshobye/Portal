const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../portal/map.js'), 'utf8');

function harness(protocol = 'blob:') {
  const calls = [], revoked = [];
  class TileLayer {
    constructor(url, options) { this.url = url; this.options = options; this.events = {}; }
    static extend(methods) { class Child extends this {} Object.assign(Child.prototype, methods); return Child; }
    on(event, callback) { this.events[event] = callback; return this; }
    getTileUrl() { return this.url; }
    addTo(map) { assert(map); calls.push(['addTo']); }
  }
  const context = {
    AbortController, console,
    location: { protocol, origin: protocol === 'file:' ? 'null' : 'https://preview.p5js.org' },
    document: {
      querySelectorAll: () => [{ href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' }],
      createElement: () => ({}),
    },
    L: { TileLayer, tileLayer: (url, options) => new TileLayer(url, options) },
    URL: { createObjectURL: () => 'blob:tile', revokeObjectURL: url => revoked.push(url) },
    fetch: async (url, options) => {
      calls.push(['fetch', url, options]);
      return { ok: true, blob: async () => ({}) };
    },
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(source, context);
  return { context, calls, revoked, layer: () => context._portalMapTileLayer('https://tile.openstreetmap.org/10/546/320.png', 'OSM contributors') };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('ordinary HTTP and local-file pages retain the standard Leaflet tile loader and attribution', () => {
  for (const protocol of ['https:', 'file:']) {
    const h = harness(protocol), layer = h.layer();
    assert.equal(layer.createTile, undefined);
    assert.equal(layer.options.attribution, 'OSM contributors');
  }
});
test('blob preview sends its real origin, retains default caching and releases image URLs', async () => {
  const h = harness(), layer = h.layer();
  let loaded = false;
  const tile = layer.createTile({}, (error, result) => { assert.equal(error, null); assert.equal(result, tile); loaded = true; });
  await settle();
  const options = h.calls[0][2];
  assert.equal(options.referrer, 'https://preview.p5js.org/');
  assert.equal(options.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.equal(options.cache, undefined);
  assert.equal(tile.src, 'blob:tile');
  tile.onload();
  assert(loaded); assert.deepEqual(h.revoked, ['blob:tile']);
});
test('unloading a tile aborts its request and does not create a stale image', async () => {
  const h = harness(); let resolve;
  h.context.fetch = () => new Promise(r => { resolve = r; });
  const layer = h.layer();
  const tile = layer.createTile({}, () => assert.fail('Cancelled tile must not report completion'));
  layer.events.tileunload({ tile });
  resolve({ ok: true, blob: async () => ({}) });
  await settle(); assert.equal(tile.src, undefined);
});
test('failed tile requests reach Leaflet without retrying or decoding the error response', async () => {
  const h = harness(); let error;
  h.context.fetch = async () => ({ ok: false, status: 403 });
  const tile = h.layer().createTile({}, e => { error = e; });
  await settle(); assert.match(error.message, /403/); assert.equal(tile.src, undefined);
});
test('init waits for Mappa overlay readiness before attaching tiles and stacking the canvas', async () => {
  const h = harness('https:'); let complete, mapOptions, move;
  const sibling = {};
  const host = { insertBefore(canvas, next) { assert.equal(next, sibling); canvas.parentElement = host; } };
  const canvas = { style: {}, parentElement: host, nextSibling: sibling };
  h.context.getComputedStyle = () => ({ position: 'relative' });
  h.context.Mappa = class {
    tileMap(options) {
      mapOptions = options;
      return { overlay(canvas, callback) { complete = () => { canvas.parentElement = {}; this.map = { getContainer: () => ({}), on: (event, fn) => { move = fn; } }; callback(); }; } };
    }
  };
  const map = new h.context.PortalMap();
  map._ensureStackedWrapper = () => { assert(map.container); assert.equal(canvas.parentElement, host); h.calls.push(['stack']); };
  map._installPortalSync = () => {};
  map._startCanvasRectMonitor = () => {};
  const pending = map.init({ canvas });
  await settle(); assert.equal(map.ready, false); assert.equal(h.calls.length, 0);
  assert.equal(mapOptions.style, '');
  complete(); await pending;
  assert.equal(map.ready, true); assert.deepEqual(h.calls, [['addTo'], ['stack']]);
  assert.match(map.tileMap.tiles.options.attribution, /OpenStreetMap/);
  assert.equal(canvas.style.pointerEvents, 'none');
  canvas.style.transform = 'translate(40px, 20px)'; move();
  assert.equal(canvas.style.transform, 'none');
});
