// Speech helper built on p5.speech
// API:
//   const speech = await new PortalSpeech({ language: 'en-US' }).init();
//   speech.setLanguage('da-DK');
//   await speech.speak('Hello world', 'en-US');
//   const sentence = await speech.listen('en-US');
//   speech.listenRecurring((sentence) => { ... }, { language: 'en-US' });
//   speech.stopListening();

class PortalSpeech {
  constructor({ language = "en-US" } = {}) {
    this.language = language;
    this.synth = null;
    this.rec = null;

    this.ready = false;
    this._listeningRecurring = false;
    this._listenHandler = null;
  }

  async init() {
    await PortalSpeech._ensureP5Speech();

    if (!window.p5?.Speech || !window.p5?.SpeechRec) {
      throw new Error("PortalSpeech: p5.speech did not load");
    }

    this.synth = new p5.Speech();
    this.rec = new p5.SpeechRec();

    this.setLanguage(this.language);

    this.ready = true;
    return this;
  }

  setLanguage(language = "en-US") {
    this.language = language;

    if (this.synth && typeof this.synth.setLang === "function") {
      try {
        this.synth.setLang(language);
      } catch {}
    }

    if (this.rec) {
      // p5.SpeechRec forwards this to underlying SpeechRecognition lang.
      this.rec.lang = language;
    }

    return this.language;
  }

  async speak(text, language = null) {
    if (!this.ready || !this.synth) throw new Error("Call init() before speak()");
    if (language) this.setLanguage(language);

    return await new Promise((resolve, reject) => {
      let done = false;
      let timeoutId = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve();
      };

      this.synth.onEnd = finish;
      this.synth.onError = (e) => {
        if (done) return;
        done = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(e || new Error("Speech synthesis failed"));
      };

      // Some browser/voice combos never fire onEnd; avoid hanging awaits.
      timeoutId = setTimeout(finish, 8000);

      try {
        this.synth.speak(String(text ?? ""));
      } catch (e) {
        if (done) return;
        done = true;
        if (timeoutId) clearTimeout(timeoutId);
        reject(e);
      }
    });
  }

  // One-shot listener: resolves with first final sentence.
  async listen(language = null) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listen()");
    if (language) this.setLanguage(language);

    return await new Promise((resolve, reject) => {
      let resolved = false;

      const finish = (value, isErr = false) => {
        if (resolved) return;
        resolved = true;
        try { this.rec.stop(); } catch {}
        if (isErr) reject(value);
        else resolve(value);
      };

      this.rec.onResult = () => {
        if (this.rec.resultValue) {
          const txt = String(this.rec.resultString || "").trim();
          if (txt) finish(txt, false);
        }
      };

      this.rec.onError = (e) => finish(e || new Error("Speech recognition failed"), true);

      try {
        // non-continuous, with interim enabled for browser robustness.
        this.rec.start(false, true);
      } catch (e) {
        finish(e, true);
      }
    });
  }

  // Continuous mode: callback called on each final sentence.
  listenRecurring(onSentence, { language = null, continuous = true, interimResults = true } = {}) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listenRecurring()");
    if (typeof onSentence !== "function") {
      throw new Error("listenRecurring(onSentence): onSentence must be a function");
    }
    if (language) this.setLanguage(language);

    this._listeningRecurring = true;
    this._listenHandler = onSentence;

    this.rec.onResult = () => {
      if (!this._listeningRecurring) return;
      if (!this.rec.resultValue) return;
      const txt = String(this.rec.resultString || "").trim();
      if (!txt) return;
      try {
        this._listenHandler(txt);
      } catch (e) {
        console.warn("PortalSpeech listenRecurring callback error:", e);
      }
    };

    // Auto-restart if browser ends recognition while still in recurring mode.
    this.rec.onEnd = () => {
      if (!this._listeningRecurring) return;
      try {
        this.rec.start(continuous, interimResults);
      } catch {}
    };

    this.rec.onError = () => {
      if (!this._listeningRecurring) return;
      setTimeout(() => {
        if (!this._listeningRecurring) return;
        try {
          this.rec.start(continuous, interimResults);
        } catch {}
      }, 200);
    };

    try {
      this.rec.start(continuous, interimResults);
    } catch (e) {
      throw e;
    }
  }

  stopListening() {
    this._listeningRecurring = false;
    try {
      this.rec?.stop();
    } catch {}
  }

  stopSpeaking() {
    try {
      this.synth?.stop();
    } catch {}
  }

  static async _ensureP5Speech() {
    if (window.p5?.Speech && window.p5?.SpeechRec) return;
    if (PortalSpeech._loadPromise) return PortalSpeech._loadPromise;

    const urls = [
      "https://cdnjs.cloudflare.com/ajax/libs/p5.js-speech/1.0.1/p5.speech.min.js",
      "https://unpkg.com/p5.speech@1.0.1/lib/p5.speech.js",
      "https://idmnyu.github.io/p5.js-speech/lib/p5.speech.js",
    ];

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const already = [...document.scripts].some((s) => s.src === src);
        if (already) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(s);
      });

    PortalSpeech._loadPromise = (async () => {
      let lastErr = null;
      for (const src of urls) {
        try {
          await loadScript(src);
          if (window.p5?.Speech && window.p5?.SpeechRec) return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("Could not load p5.speech");
    })();

    return PortalSpeech._loadPromise;
  }
}
