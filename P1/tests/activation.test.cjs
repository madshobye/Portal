const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../portal', file), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(mode = 'always', mobile = true) {
  const nodes = [];
  const document = { activeElement: null };
  function node(tag) {
    const n = { tag, style: {}, children: [], listeners: {},
      setAttribute() {}, append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      addEventListener(event, fn) { this.listeners[event] = fn; },
      remove() { this.removed = true; }, focus() { document.activeElement = this; },
      querySelector() { return this.children[0]; },
    };
    nodes.push(n); return n;
  }
  document.body = node('body'); document.createElement = node;
  const c = { document, navigator: { userAgent: mobile ? 'iPhone' : 'Desktop', userActivation: { isActive: false } },
    console, Date, DOMException, setTimeout, clearTimeout,
    PORTAL_ACTIVATION: mode,
  };
  c.window = c; vm.createContext(c); vm.runInContext(read('activation.js'), c);
  const overlay = () => document.body.children.findLast(n => !n.removed);
  return { c, api: c.PortalActivation, nodes, overlay,
    tap() { overlay().children[0].listeners.click({ isTrusted: true }); },
    skip() { overlay().children[1].listeners.click(); },
  };
}

test('off is the default; loading alone never creates an overlay', async () => {
  const h = harness('');
  assert.equal(h.api.mode, 'off');
  assert.equal(h.overlay(), undefined);
  h.api.configure({ mode: 'off' });
  const owner = {}; h.api.register(owner, 'audio', () => assert.fail());
  assert.equal(await h.api.run(owner, () => Promise.resolve(42)), 42);
  assert.equal(h.overlay(), undefined);
});
test('several modules share one overlay and activators run synchronously in the tap', async () => {
  const h = harness(), calls = [];
  let finish;
  h.api.register({}, 'audio', () => { calls.push('audio'); return new Promise(r => { finish = r; }); });
  h.api.register({}, 'speech', () => { calls.push('speech'); return true; });
  assert.equal(h.c.document.body.children.length, 1);
  h.tap(); assert.deepEqual(calls, ['audio', 'speech']);
  finish(true); await settle(); assert.equal(h.overlay(), undefined);
});
test('late registration shows another prompt; manual unlock avoids redundant activation', () => {
  const h = harness(), first = {}, second = {};
  h.api.register(first, 'audio', () => assert.fail()); h.api.markReady(first);
  assert.equal(h.overlay(), undefined);
  h.api.register(second, 'audio', () => true); assert(h.overlay());
  h.api.unregister(second); assert.equal(h.overlay(), undefined);
});
test('a real active gesture takes the direct path; ordinary failures are not retried', async () => {
  const h = harness(), owner = {};
  h.api.register(owner, 'audio', () => true);
  h.c.navigator.userActivation.isActive = true;
  let called = false;
  await assert.rejects(h.api.run(owner, () => { called = true; throw new Error('file missing'); }), /file missing/);
  assert(called);
});
test('desktop NotAllowedError requests interaction and retries only on a tap', async () => {
  const h = harness('auto', false), owner = {}; let attempts = 0;
  h.api.register(owner, 'audio', () => assert.fail());
  const result = h.api.run(owner, () => {
    if (++attempts === 1) throw new DOMException('blocked', 'NotAllowedError');
    h.api.markReady(owner); return 12;
  });
  await settle(); assert(h.overlay()); assert.equal(attempts, 1);
  h.tap(); assert.equal(await result, 12); assert.equal(attempts, 2);
});
test('skip and stop reject pending operations without playing them', async () => {
  const h = harness(), owner = {}; h.api.register(owner, 'audio', () => true);
  const p = h.api.run(owner, () => assert.fail());
  const rejected = assert.rejects(p, { name: 'AbortError' });
  h.skip(); await rejected; assert.equal(h.overlay(), undefined);
  h.api.configure({ mode: 'always' });
  const p2 = h.api.run(owner, () => assert.fail());
  const stopped = assert.rejects(p2, { name: 'AbortError' });
  h.api.cancel(owner); await stopped;
});
test('cancellation during a request prevents a late blocked result being queued again', async () => {
  const h = harness('auto', false), owner = {}; let fail;
  h.api.register(owner, 'audio', () => true);
  const p = h.api.run(owner, () => new Promise((_, reject) => { fail = reject; }));
  const rejected = assert.rejects(p, { name: 'AbortError' });
  h.api.cancel(owner); await rejected;
  fail(new DOMException('blocked', 'NotAllowedError')); await settle();
  assert.equal(h.overlay(), undefined);
});
test('speech requests are preserved and started in order, without an extra greeting', async () => {
  const h = harness(), one = {}, two = {}, calls = []; let finish;
  h.api.register(one, 'speech', () => assert.fail('must use real pending speech'));
  h.api.register(two, 'speech', () => assert.fail('must not prime another instance'));
  const p1 = h.api.run(one, () => { calls.push(1); h.api.markReady(one); return new Promise(r => { finish = r; }); });
  const p2 = h.api.run(two, () => { calls.push(2); return 2; });
  h.tap(); assert.deepEqual(calls, [1]); finish(1);
  assert.equal(await p1, 1); assert.equal(await p2, 2); assert.deepEqual(calls, [1, 2]);
});
test('speech priming is shared and a failed activation does not become ready', async () => {
  const h = harness(); let calls = 0; const one = {}, two = {};
  h.api.register(one, 'speech', () => { calls++; return false; });
  h.api.register(two, 'speech', () => { calls++; return false; });
  h.tap(); await settle(); assert.equal(calls, 1);
  assert.equal(h.api.getState(one), 'needs-interaction'); assert(h.overlay());
});
test('SoundFile keeps standalone support and unlock starts playback before awaiting context', async () => {
  const h = harness(); const calls = [];
  h.c.Audio = class {
    constructor() { this.paused = true; this.currentTime = 9; this.volume = .4; this.muted = false; }
    play() { calls.push('play'); this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  vm.runInContext(read('SoundFile.js') + '\nwindow.TestSound = SoundFile;', h.c);
  const sound = new h.c.TestSound(); let resume;
  h.c.TestSound._resumeKeepAliveContext = () => new Promise(r => { resume = r; });
  const unlocked = sound.unlock(); assert.deepEqual(calls, ['play']);
  resume(true); assert.equal(await unlocked, true);
  assert.equal(sound.audio.currentTime, 9); assert.equal(sound.audio.volume, .4); assert.equal(sound.audio.muted, false);
  assert.equal(h.api.getState(sound.audio), 'ready');
  delete h.c.PortalActivation; await sound.play(); assert.equal(sound.playing, true);
});
test('speech modules preserve speak promise, language and recurring-listen resume', async () => {
  for (const file of ['speech.js', 'speech2.js']) {
    const h = harness(); let utterance, resumed = 0;
    h.c.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    h.c.speechSynthesis = { cancel() {}, resume() {}, speak(u) { utterance = u; u.onstart?.(); }, getVoices: () => [] };
    vm.runInContext(read(file), h.c);
    const Speech = vm.runInContext(file === 'speech.js' ? 'PortalSpeech' : 'PortalSpeech2', h.c);
    const speech = new Speech(); speech.ready = true; speech.synth = {};
    speech._listeningRecurring = true; speech.isListening = () => false;
    speech.listenRecurring = () => { resumed++; };
    h.api.register(speech, 'speech', () => h.api.primeSpeech());
    const p = speech.speak('Hello', 'en-GB'); assert.equal(utterance, undefined);
    h.tap(); assert.equal(utterance.text, 'Hello'); assert.equal(utterance.lang, 'en-GB');
    assert.equal(h.api.getState(speech), 'ready');
    utterance.onend(); await p; assert.equal(resumed, 1);
  }
});

test('short sound effects request activation but are not replayed later', async () => {
  const h = harness(), owner = {}; let primed = false;
  h.api.register(owner, 'audio', () => { primed = true; return true; });
  await assert.rejects(h.api.run(owner, () => assert.fail('stale effect replayed'), { defer: false }), { name: 'NotAllowedError' });
  h.tap(); await settle(); assert(primed);
});
test('dismissal suppresses automatic playback but a new direct gesture can play', async () => {
  const h = harness(), owner = {}; h.api.register(owner, 'audio', () => true); h.skip();
  await assert.rejects(h.api.run(owner, () => assert.fail()), { name: 'AbortError' });
  h.c.navigator.userActivation.isActive = true;
  assert.equal(await h.api.run(owner, () => 7), 7);
});
test('a synthetic overlay click cannot activate playback', () => {
  const h = harness(); h.api.register({}, 'audio', () => assert.fail());
  h.overlay().children[0].listeners.click({ isTrusted: false });
});
test('speech priming timeout remains unverified and clears the pending greeting', async () => {
  const h = harness(); let timeout, cancellations = 0;
  h.c.setTimeout = fn => { timeout = fn; return 1; }; h.c.clearTimeout = () => {};
  h.c.SpeechSynthesisUtterance = class {};
  h.c.speechSynthesis = { speak() {}, cancel() { cancellations++; } };
  const owner = {}; h.api.register(owner, 'speech', () => h.api.primeSpeech());
  h.tap(); timeout(); await settle();
  assert.equal(cancellations, 1); assert.equal(h.api.getState(owner), 'needs-interaction');
});
test('uiSlim does not carry a press or click through the activation overlay', () => {
  const h = harness(); h.c.addEventListener = () => {}; h.c.cursor = () => {};
  vm.runInContext(read('uiSlim2.js'), h.c);
  h.c.uiUpdate(10, 10, true, '', 500, 500, false);
  const before = h.c.uiHit(0, 0, 50, 50); assert(before.pressedDown);
  h.api.register({}, 'audio', () => true);
  h.c.uiUpdate(10, 10, false, '', 500, 500, false);
  assert.equal(h.c.uiHit(0, 0, 50, 50).clicked, false);
});

test('manual unlock resumes a request already waiting behind the overlay', async () => {
  const h = harness(), owner = {};
  h.api.register(owner, 'audio', () => assert.fail());
  const result = h.api.run(owner, () => 99);
  h.api.markReady(owner);
  assert.equal(await result, 99); assert.equal(h.overlay(), undefined);
});
test('repeated taps do not start duplicate activation callbacks', async () => {
  const h = harness(); let calls = 0, finish;
  h.api.register({}, 'audio', () => { calls++; return new Promise(r => { finish = r; }); });
  h.tap(); h.tap(); assert.equal(calls, 1); finish(true); await settle();
});

test('an activation completing after Skip cannot re-enable sound', async () => {
  const h = harness(), owner = {}; let finish;
  h.api.register(owner, 'audio', () => new Promise(r => { finish = r; }));
  h.tap(); h.skip(); h.api.markReady(owner); finish(true); await settle();
  assert.equal(h.api.getState(owner), 'dismissed'); assert.equal(h.overlay(), undefined);
});
