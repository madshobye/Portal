async function loadSoundFile(url)
{
  soundFile = new SoundFile();
  await soundFile.load(url);
  return soundFile;
 
}


// Minimal Sound player with timeout-safe loading
 class SoundFile {
  constructor(url) {
    this.audio = new Audio();
    this.audio.preload = "auto";
    if (url) this.load(url);
  }

  /**
   * Load an audio file.
   * @param {string} url - The audio file URL.
   * @param {number} timeoutMs - Timeout in milliseconds (default 5000).
   */
  load(url, timeoutMs = 5000) {
    this.audio.src = url;
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

  play()      { return this.audio.play(); }
  pause()     { this.audio.pause(); }
  stop()      { this.audio.pause(); this.audio.currentTime = 0; }
  toggle()    { this.audio.paused ? this.play() : this.pause(); }

  setVolume(v){ this.audio.volume = Math.max(0, Math.min(1, v)); }
  setLoop(b=true){ this.audio.loop = b; }
  seek(s)     { this.audio.currentTime = s; }

  get time()      { return this.audio.currentTime; }
  get duration()  { return this.audio.duration; }
  get playing()   { return !this.audio.paused; }

  on(event, handler) {
    this.audio.addEventListener(event, handler);
    return () => this.audio.removeEventListener(event, handler);
  }
}
