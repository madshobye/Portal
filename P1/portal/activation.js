// Shared media activation. First release is opt-in: PORTAL_ACTIVATION = 'auto'.
(function () {
  if (window.PortalActivation) return;
  const entries = new Map();
  let pending = [];
  const running = new Set();
  let overlay = null;
  let previousFocus = null;
  let stopPrime = null;
  let suppressUntil = 0;
  let mode = window.PORTAL_ACTIVATION || 'off';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const enabled = () => mode !== 'off';
  const active = () => navigator.userActivation?.isActive === true;
  const aborted = () => new DOMException('Activation cancelled', 'AbortError');
  const blocked = error => error?.name === 'NotAllowedError' || error?.error === 'not-allowed';
  const needs = () => [...entries.values()].some(e => e.state === 'needs-interaction');

  function render() {
    if (!enabled() || !needs()) {
      if (overlay) {
        overlay.remove(); overlay = null;
        previousFocus?.focus?.(); previousFocus = null;
        suppressUntil = Date.now() + 250;
      }
      return;
    }
    if (overlay || !document.body) return;
    previousFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Enable sound and speech');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      background: 'rgba(0,0,0,.82)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '16px', color: 'white',
      font: '18px system-ui', touchAction: 'manipulation',
    });
    const button = document.createElement('button');
    button.textContent = 'Tap to start';
    Object.assign(button.style, { padding: '18px 28px', font: 'inherit', borderRadius: '12px' });
    const skip = document.createElement('button');
    skip.textContent = 'Continue without sound';
    Object.assign(skip.style, { padding: '10px', font: 'inherit' });
    // Keep the gesture away from p5/canvas controls, including synthetic clicks.
    for (const event of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
      overlay.addEventListener(event, e => e.stopPropagation());
    }
    overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      if (e.key === 'Tab') {
        e.preventDefault(); (document.activeElement === button ? skip : button).focus();
      }
    });
    button.addEventListener('click', event => {
      if (!event.isTrusted) return;
      button.textContent = 'Enabling…';
      activate(); // Do not await before invoking browser APIs.
    });
    skip.addEventListener('click', dismiss);
    overlay.append(button, skip); document.body.appendChild(overlay); button.focus();
  }

  function register(owner, capability, activate) {
    if (entries.has(owner)) return;
    entries.set(owner, { capability, activate,
      verified: false, state: enabled() && (mode === 'always' || mobile) ? 'needs-interaction' : 'ready' });
    render();
  }
  function markReady(owner) {
    const entry = entries.get(owner);
    if (!entry || entry.state === 'dismissed') return;
    for (const [key, e] of entries) {
      if (e.state !== 'dismissed' && (key === owner || (entry.capability === 'speech' && e.capability === 'speech'))) { e.state = 'ready'; e.verified = true; }
    }
    render();
    Promise.resolve().then(drain);
  }
  function enqueue(task) {
    const entry = entries.get(task.owner);
    if (!entry) { task.reject(aborted()); return; }
    entry.state = 'needs-interaction'; entry.verified = false; pending.push(task); render();
    if (overlay) overlay.querySelector('button').textContent = 'Tap to enable sound';
  }
  function execute(task) {
    running.add(task);
    let result;
    try { result = task.operation(); }
    catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(value => {
      running.delete(task);
      if (!task.cancelled) task.resolve(value);
      drain();
    }, error => {
      running.delete(task);
      if (enabled() && !task.cancelled && blocked(error)) {
        if (task.defer) enqueue(task);
        else {
          const entry = entries.get(task.owner);
          if (entry) { entry.state = 'needs-interaction'; entry.verified = false; render(); }
          task.reject(error);
        }
      }
      else task.reject(error);
    });
  }
  function run(owner, operation, { defer = true } = {}) {
    if (!enabled() || !entries.has(owner)) return operation();
    return new Promise((resolve, reject) => {
      const task = { owner, operation, resolve, reject, defer, cancelled: false };
      const entry = entries.get(owner);
      if (entry.state === 'dismissed') {
        if (!active()) { reject(aborted()); return; }
        entry.state = 'ready';
      }
      if (entry.state === 'needs-interaction' && !active()) {
        if (defer) enqueue(task);
        else reject(new DOMException('Tap to enable sound', 'NotAllowedError'));
      }
      else execute(task);
    });
  }
  function activate() {
    const speaking = [...running].some(t => !t.cancelled && entries.get(t.owner)?.capability === 'speech');
    const speechTask = speaking ? null : pending.find(t => entries.get(t.owner)?.capability === 'speech');
    const batch = pending.filter(t => entries.get(t.owner)?.capability !== 'speech' || t === speechTask);
    pending = pending.filter(t => !batch.includes(t));
    const busyOwners = new Set(batch.map(t => t.owner));
    let speechPrimed = speaking || !!speechTask;
    const activations = [];
    for (const [owner, entry] of entries) {
      if (entry.state !== 'needs-interaction' || entry.activating || busyOwners.has(owner)) continue;
      if (entry.capability === 'speech') {
        if (speechPrimed) continue;
        speechPrimed = true;
      }
      // Start every capability synchronously, before waiting for any result.
      try {
        entry.activating = true;
        activations.push(Promise.resolve(entry.activate()).then(ok => {
          if (ok === true && entry.state !== 'dismissed') markReady(owner);
        }).finally(() => { entry.activating = false; }));
      } catch (error) { entry.activating = false; activations.push(Promise.reject(error)); }
    }
    batch.forEach(execute);
    Promise.allSettled(activations).then(() => {
      if (overlay) overlay.querySelector('button').textContent = 'Tap to enable sound';
      render();
    });
  }
  function drain() {
    // Continue queued requests after manual unlock or completed playback.
    // Only one queued speech request uses the global synthesis engine at a time.
    for (const task of [...pending]) {
      const entry = entries.get(task.owner);
      if (entry?.state !== 'ready') continue;
      const busy = [...running].some(t => !t.cancelled &&
        (t.owner === task.owner || (entry.capability === 'speech' && entries.get(t.owner)?.capability === 'speech')));
      if (busy) continue;
      pending = pending.filter(t => t !== task);
      execute(task);
    }
  }
  function cancel(owner) {
    const removed = [...pending, ...running].filter(t => t.owner === owner);
    pending = pending.filter(t => t.owner !== owner);
    removed.forEach(t => { t.cancelled = true; t.reject(aborted()); });
  }
  function dismiss() {
    stopPrime?.();
    for (const e of entries.values()) e.state = 'dismissed';
    for (const owner of entries.keys()) cancel(owner);
    render();
  }
  function configure(options = {}) {
    if (!['off', 'auto', 'always'].includes(options.mode)) throw new Error('Activation mode must be off, auto or always');
    mode = options.mode;
    if (!enabled()) dismiss();
    else {
      for (const e of entries.values()) if (!e.verified) e.state = mode === 'always' || mobile ? 'needs-interaction' : 'ready';
      render();
    }
  }
  function primeSpeech() {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve(false);
    if (synth.speaking || synth.pending) return Promise.resolve(false);
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance('Ready');
      utterance.lang = 'en';
      let timer;
      const cleanup = () => { clearTimeout(timer); if (stopPrime === stop) stopPrime = null; };
      const stop = () => { cleanup(); synth.cancel(); resolve(false); };
      stopPrime = stop;
      timer = setTimeout(stop, 4000);
      utterance.onstart = () => { clearTimeout(timer); resolve(true); };
      utterance.onend = () => { cleanup(); resolve(false); };
      utterance.onerror = () => { cleanup(); resolve(false); };
      try { synth.speak(utterance); }
      catch { cleanup(); resolve(false); }
    });
  }

  window.PortalActivation = {
    register, run, markReady, cancel, configure, primeSpeech,
    unregister(owner) { cancel(owner); entries.delete(owner); render(); },
    getState(owner) { return entries.get(owner)?.state || 'unregistered'; },
    get mode() { return mode; },
    get blocksInput() { return !!overlay || Date.now() < suppressUntil; },
  };
})();
