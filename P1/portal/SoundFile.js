async function loadSoundFile(url)
{
  soundFile = new SoundFile();
  await soundFile.load(url);
  return soundFile;
 
}


// Minimal Sound player with timeout-safe loading
 class SoundFile {
  constructor(url, {
    poolSize = 6,
    triggerOffsetSec = 0,
    triggerAttackSec = 0.005,
    triggerReleaseSec = 0.02,
  } = {}) {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.poolSize = Math.max(1, Number(poolSize) || 6);
    this.triggerOffsetSec = Math.max(0, Number(triggerOffsetSec) || 0);
    this.triggerAttackSec = Math.max(0, Number(triggerAttackSec) || 0.005);
    this.triggerReleaseSec = Math.max(0, Number(triggerReleaseSec) || 0.02);
    this._voices = [this.audio];
    this._baseVolume = 1;
    this._baseLoop = false;
    this._voiceTimers = new WeakMap();
    this._keepAliveRequested = false;
    if (url) this.load(url);
  }

  /**
   * Load an audio file.
   * @param {string} url - The audio file URL.
   * @param {number} timeoutMs - Timeout in milliseconds (default 5000).
   */
  load(url, timeoutMs = 5000) {
    this.audio.src = url;
    this.audio.loop = this._baseLoop;
    this.audio.volume = this._baseVolume;
    this.audio.load();

    return new Promise((resolve, reject) => {
      let done = false;

      const cleanup = () => {
        clearTimeout(timer);
        this.audio.removeEventListener("canplaythrough", onReady);
        this.audio.removeEventListener("error", onError);
      };

      const onReady = () => {
        if (done) return;
        done = true;
        cleanup();
        this._registerVoice(this.audio);
        resolve();
      };

      const onError = (e) => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error(`Audio load failed: ${e.message || "unknown error"}`));
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Audio load timed out"));
      }, timeoutMs);

      this.audio.addEventListener("canplaythrough", onReady, { once: true });
      this.audio.addEventListener("error", onError, { once: true });
    });
  }

  _registerVoice(voice) {
    window.PortalActivation?.register(voice, "audio", () => this._unlockVoice(voice));
  }

  _playVoice(voice) {
    this._registerVoice(voice);
    const play = () => voice.play().then(value => {
      window.PortalActivation?.markReady(voice);
      return value;
    });
    return window.PortalActivation ? window.PortalActivation.run(voice, play) : play();
  }

  play() { return this._playVoice(this.audio); }
  trigger(offsetSec = this.triggerOffsetSec)   {
    const voice = this._acquireVoice();
    if (!voice) return Promise.reject(new Error("SoundFile: no available voice"));
    this._clearVoiceTimers(voice);
    voice.volume = 0;
    try { voice.currentTime = Math.max(0, Number(offsetSec) || 0); } catch {}
    this._registerVoice(voice);
    const play = () => {
      this._applyTriggerEnvelope(voice);
      return voice.play().then(value => {
        window.PortalActivation?.markReady(voice);
        return value;
      });
    };
    return window.PortalActivation ? window.PortalActivation.run(voice, play, { defer: false }) : play();
  }
  pause()     {
    for (const voice of this._voices) {
      window.PortalActivation?.cancel(voice);
      voice.pause();
    }
  }
  stop()      {
    for (const voice of this._voices) {
      window.PortalActivation?.cancel(voice);
      voice.pause();
      try { voice.currentTime = 0; } catch {}
    }
  }
  toggle()    { this.audio.paused ? this.play() : this.pause(); }

  setVolume(v){
    this._baseVolume = Math.max(0, Math.min(1, v));
    for (const voice of this._voices) voice.volume = this._baseVolume;
  }
  setLoop(b=true){
    this._baseLoop = !!b;
    for (const voice of this._voices) voice.loop = this._baseLoop;
  }
  seek(s)     {
    for (const voice of this._voices) {
      try { voice.currentTime = s; } catch {}
    }
  }
  async unlock() {
    // Initiate all plays synchronously; do not await a context resume first.
    const attempts = this._voices.map(voice => this._unlockVoice(voice));
    const results = await Promise.all(attempts);
    return results.every(Boolean);
  }

  async _unlockVoice(voice) {
    if (!voice) return false;
    this._registerVoice(voice);
    if (!voice.paused) {
      window.PortalActivation?.markReady(voice);
      return true;
    }
    const prevMuted = voice.muted;
    const prevVolume = voice.volume;
    const prevTime = voice.currentTime;
    try {
      const resume = SoundFile._resumeKeepAliveContext();
      voice.muted = true;
      voice.volume = 0;
      const playing = voice.play();
      await Promise.all([resume, playing]);
      voice.pause();
      try { voice.currentTime = prevTime; } catch {}
      window.PortalActivation?.markReady(voice);
      return true;
    } catch {
      return false;
    } finally {
      voice.muted = prevMuted;
      voice.volume = prevVolume;
    }
  }
  async playSilentLoopToKeepBluetoothAlive() {
    this._keepAliveRequested = true;
    return SoundFile._startSharedSilentLoop();
  }
  async playNothingToKeepBlueToothAlive() {
    return this.playSilentLoopToKeepBluetoothAlive();
  }
  stopSilentLoopToKeepBluetoothAlive() {
    this._keepAliveRequested = false;
    SoundFile._stopSharedSilentLoop();
  }
  stopNothingToKeepBlueToothAlive() {
    this.stopSilentLoopToKeepBluetoothAlive();
  }

  get time()      { return this.audio.currentTime; }
  get duration()  { return this.audio.duration; }
  get playing()   { return !this.audio.paused; }

  on(event, handler) {
    this.audio.addEventListener(event, handler);
    return () => this.audio.removeEventListener(event, handler);
  }

  _acquireVoice() {
    const idle = this._voices.find((voice) => voice.paused || voice.ended);
    if (idle) return idle;

    if (this._voices.length < this.poolSize) {
      const voice = this.audio.cloneNode(true);
      voice.preload = "auto";
      voice.volume = this._baseVolume;
      voice.loop = this._baseLoop;
      this._voices.push(voice);
      return voice;
    }

    return this._voices[0];
  }

  _clearVoiceTimers(voice) {
    const timers = this._voiceTimers.get(voice);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    this._voiceTimers.delete(voice);
  }

  _trackVoiceTimer(voice, timer) {
    const timers = this._voiceTimers.get(voice) || [];
    timers.push(timer);
    this._voiceTimers.set(voice, timers);
  }

  _applyTriggerEnvelope(voice) {
    const attackMs = Math.max(0, this.triggerAttackSec * 1000);
    const releaseMs = Math.max(0, this.triggerReleaseSec * 1000);
    const peak = this._baseVolume;

    if (attackMs <= 0) {
      voice.volume = peak;
    } else {
      const attackTimer = setTimeout(() => {
        voice.volume = peak;
      }, attackMs);
      this._trackVoiceTimer(voice, attackTimer);
    }

    const durationMs = Number.isFinite(voice.duration) ? voice.duration * 1000 : 0;
    const offsetMs = Math.max(0, this.triggerOffsetSec * 1000);
    if (durationMs > 0 && releaseMs > 0) {
      const releaseStart = Math.max(0, durationMs - releaseMs - offsetMs);
      const releaseTimer = setTimeout(() => {
        voice.volume = 0;
      }, releaseStart);
      this._trackVoiceTimer(voice, releaseTimer);
    }
  }

  static _getSharedSilentLoop() {
    if (SoundFile._sharedSilentLoop) return SoundFile._sharedSilentLoop;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const source = ctx.createOscillator();
    source.type = "sine";
    source.frequency.value = 12;

    const gain = ctx.createGain();
    gain.gain.value = 0.00002;

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    SoundFile._sharedSilentLoop = { ctx, source, gain };
    return SoundFile._sharedSilentLoop;
  }

  static async _startSharedSilentLoop() {
    const silent = SoundFile._getSharedSilentLoop();
    if (!silent) return false;
    try {
      await silent.ctx.resume();
      return true;
    } catch {
      return false;
    }
  }

  static _stopSharedSilentLoop() {
    const silent = SoundFile._sharedSilentLoop;
    if (!silent) return;
    silent.ctx.suspend().catch(() => {});
  }

  static async _resumeKeepAliveContext() {
    const silent = SoundFile._getSharedSilentLoop();
    if (!silent) return false;
    try {
      await silent.ctx.resume();
      return true;
    } catch {
      return false;
    }
  }
}
