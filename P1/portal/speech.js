// Speech helper built on p5.speech
// API:
//   const speech = await new PortalSpeech({ language: 'en-US' }).init();
//   speech.setLanguage('da-DK');
//   await speech.speak('Hello world', 'en-US');
//   const sentence = await speech.listen('en-US');
//   speech.listenRecurring((sentence) => { ... }); // callback optional
//   speech.stopListening();
//   speech.onInterimResult((partial) => { ... });
//   speech.getInterimText();
//   speech.hasInterimResult();
//   speech.isSilentFor(800);

class PortalSpeech {
  constructor({
    language = "en-US",
    voice = null,
    pitch = 1,
    rate = 1,
    volume = 1,
  } = {}) {
    this.language = language;
    this.synth = null;
    this.rec = null;
    this._voice = null;
    this.voiceName = voice;
    this.pitch = pitch;
    this.rate = rate;
    this.volume = volume;

    this.ready = false;
    this.listening = false;
    this.speaking = false;
    this._listeningRecurring = false;
    this._listenHandler = null;
    this._listenResultHandler = null;
    this._listenStateHandler = null;
    this._speakStateHandler = null;
    this._listenPromise = null;
    this._recurringLanguage = null;
    this._recurringInterimResults = false;
    this._resumeRecurringRequested = false;
    this._hasResult = false;
    this._hasNew = false;
    this._resultText = "";
    this._hasInterim = false;
    this._interimText = "";
    this._interimResultHandler = null;
    this._lastInterimAt = 0;
    this._lastFinalAt = 0;
  }

  async init() {
    await PortalSpeech._ensureP5Speech();

    if (!window.p5?.Speech || !window.p5?.SpeechRec) {
      throw new Error("PortalSpeech: p5.speech did not load");
    }

    this.synth = new p5.Speech();
    this.rec = new p5.SpeechRec();

    await this._waitVoices();
    this.setLanguage(this.language);
    if (this.voiceName) this.setVoice(this.voiceName);
    this.setPitch(this.pitch);
    this.setRate(this.rate);
    this.setVolume(this.volume);

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
      try {
        if (this.rec.rec) this.rec.rec.lang = language;
      } catch {}
      try {
        if (this.rec.recognition) this.rec.recognition.lang = language;
      } catch {}
    }

    if (this.voiceName) {
      this.setVoice(this.voiceName);
    } else {
      this._voice = this._pickVoice(language);
    }

    return this.language;
  }

  setVoice(voiceName) {
    this.voiceName = voiceName || null;
    if (!this.voiceName) {
      this._voice = this._pickVoice(this.language);
      return;
    }
    const synth = window.speechSynthesis;
    if (synth?.getVoices && this.voiceName) {
      const voices = synth.getVoices() || [];
      const byName = voices.find((v) => (v.name || "").toLowerCase() === this.voiceName.toLowerCase());
      if (byName) this._voice = byName;
    }
    if (this.synth && typeof this.synth.setVoice === "function" && this.voiceName) {
      try {
        this.synth.setVoice(this.voiceName);
      } catch {}
    }
  }

  setPitch(pitch = 1) {
    this.pitch = Number.isFinite(Number(pitch)) ? Number(pitch) : 1;
    if (this.synth && typeof this.synth.setPitch === "function") {
      try {
        this.synth.setPitch(this.pitch);
      } catch {}
    }
  }

  setRate(rate = 1) {
    this.rate = Number.isFinite(Number(rate)) ? Number(rate) : 1;
    if (this.synth && typeof this.synth.setRate === "function") {
      try {
        this.synth.setRate(this.rate);
      } catch {}
    }
  }

  setVolume(volume = 1) {
    const v = Number(volume);
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    if (this.synth && typeof this.synth.setVolume === "function") {
      try {
        this.synth.setVolume(this.volume);
      } catch {}
    }
  }

  onResult(handler) {
    if (typeof handler !== "function") {
      throw new Error("onResult(handler): handler must be a function");
    }
    this._listenResultHandler = handler;
  }

  setResultHandler(handler) {
    return this.onResult(handler);
  }

  onListeningChange(handler) {
    if (typeof handler !== "function") {
      throw new Error("onListeningChange(handler): handler must be a function");
    }
    this._listenStateHandler = handler;
  }

  onSpeakingChange(handler) {
    if (typeof handler !== "function") {
      throw new Error("onSpeakingChange(handler): handler must be a function");
    }
    this._speakStateHandler = handler;
  }

  onInterimResult(handler) {
    if (typeof handler !== "function") {
      throw new Error("onInterimResult(handler): handler must be a function");
    }
    this._interimResultHandler = handler;
  }

  setInterimResultHandler(handler) {
    return this.onInterimResult(handler);
  }

  isListening() {
    return !!this.listening;
  }

  isSpeaking() {
    return !!this.speaking;
  }

  hasResult() {
    return this._hasResult;
  }

  hasInterimResult() {
    return this._hasInterim;
  }

  hasinterimresult() {
    return this.hasInterimResult();
  }

  hasNewResult() {
    return this._hasNew;
  }

  hasnewresult() {
    return this.hasNewResult();
  }

  resetNewFlag() {
    this._hasNew = false;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, text: this._resultText };
  }

  consumenew() {
    return this.consumeNew();
  }

  getLatest() {
    return { text: this._resultText, result: this._resultText };
  }

  getlatest() {
    return this.getLatest();
  }

  getResult() {
    return this._resultText;
  }

  getInterimText() {
    return this._interimText;
  }

  getinterimtext() {
    return this.getInterimText();
  }

  getresult() {
    return this.getResult();
  }

  getText() {
    return this._resultText;
  }

  clearInterimResult() {
    this._hasInterim = false;
    this._interimText = "";
  }

  msSinceSpeech(nowMs = Date.now()) {
    const last = Math.max(Number(this._lastInterimAt) || 0, Number(this._lastFinalAt) || 0);
    if (!last) return Infinity;
    return Math.max(0, Number(nowMs) - last);
  }

  issincespeech(nowMs = Date.now()) {
    return this.msSinceSpeech(nowMs);
  }

  isSilentFor(ms, nowMs = Date.now()) {
    const threshold = Math.max(0, Number(ms) || 0);
    return this.msSinceSpeech(nowMs) >= threshold;
  }

  issilentfor(ms, nowMs = Date.now()) {
    return this.isSilentFor(ms, nowMs);
  }

  isReceivingSpeech(recentMs = 700, nowMs = Date.now()) {
    const threshold = Math.max(0, Number(recentMs) || 0);
    return this.msSinceSpeech(nowMs) <= threshold;
  }

  isreceivingspeech(recentMs = 700, nowMs = Date.now()) {
    return this.isReceivingSpeech(recentMs, nowMs);
  }

  // Flexible matcher against latest recognized sentence.
  // Examples:
  //   speech.isMatch("red")
  //   speech.isMatch(["red", "blue"])               // any by default
  //   speech.isMatch(["background", "red"], { all: true })
  //   speech.isMatch("red", { wholeWord: true })
  //   speech.isMatch(/^where is/i)
  isMatch(query, options = {}) {
    const {
      text = null,
      all = false,
      exact = false,
      wholeWord = false,
      caseSensitive = false,
      normalize = true,
      ignorePunctuation = true,
      collapseWhitespace = true,
    } = options || {};

    const source = String(text ?? this._resultText ?? "");
    if (!source) return false;

    if (typeof query === "function") {
      try {
        return !!query(source);
      } catch {
        return false;
      }
    }

    const textNorm = this._normalizeForMatch(source, {
      caseSensitive,
      normalize,
      ignorePunctuation,
      collapseWhitespace,
    });

    const testOne = (q) => {
      if (q == null) return false;

      if (q instanceof RegExp) {
        const flags = caseSensitive
          ? q.flags.replace(/i/g, "")
          : q.flags.includes("i")
            ? q.flags
            : q.flags + "i";
        const re = new RegExp(q.source, flags);
        return re.test(source);
      }

      const qNorm = this._normalizeForMatch(String(q), {
        caseSensitive,
        normalize,
        ignorePunctuation,
        collapseWhitespace,
      });
      if (!qNorm) return false;

      if (exact) return textNorm === qNorm;

      if (wholeWord) {
        const escaped = this._escapeRegex(qNorm);
        return new RegExp(`\\b${escaped}\\b`).test(textNorm);
      }

      return textNorm.includes(qNorm);
    };

    if (Array.isArray(query)) {
      if (!query.length) return false;
      return all ? query.every(testOne) : query.some(testOne);
    }

    return testOne(query);
  }

  ismatch(query, options = {}) {
    return this.isMatch(query, options);
  }

  _normalizeForMatch(text, options = {}) {
    const {
      caseSensitive = false,
      normalize = true,
      ignorePunctuation = true,
      collapseWhitespace = true,
    } = options;

    let out = String(text ?? "");

    if (normalize) {
      try {
        out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      } catch {}
    }

    if (!caseSensitive) out = out.toLowerCase();
    if (ignorePunctuation) out = out.replace(/[^\w\s]/g, " ");
    if (collapseWhitespace) out = out.replace(/\s+/g, " ").trim();

    return out;
  }

  _escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _setListeningState(value) {
    const next = !!value;
    if (this.listening === next) return;
    this.listening = next;
    if (typeof this._listenStateHandler === "function") {
      try {
        this._listenStateHandler(this.listening);
      } catch (e) {
        console.warn("PortalSpeech onListeningChange callback error:", e);
      }
    }
  }

  _setSpeakingState(value) {
    const next = !!value;
    if (this.speaking === next) return;
    this.speaking = next;
    if (typeof this._speakStateHandler === "function") {
      try {
        this._speakStateHandler(this.speaking);
      } catch (e) {
        console.warn("PortalSpeech onSpeakingChange callback error:", e);
      }
    }
  }

  _commitResult(text) {
    const txt = String(text || "").trim();
    if (!txt) return false;

    this._resultText = txt;
    this._hasResult = true;
    this._hasNew = true;
    this._lastFinalAt = Date.now();
    this.clearInterimResult();

    if (typeof this._listenResultHandler === "function") {
      try {
        this._listenResultHandler(txt);
      } catch (e) {
        console.warn("PortalSpeech onResult callback error:", e);
      }
    }

    return true;
  }

  _commitInterim(text) {
    const txt = String(text || "").trim();
    if (!txt) return false;

    this._interimText = txt;
    this._hasInterim = true;
    this._lastInterimAt = Date.now();

    if (typeof this._interimResultHandler === "function") {
      try {
        this._interimResultHandler(txt);
      } catch (e) {
        console.warn("PortalSpeech onInterimResult callback error:", e);
      }
    }

    return true;
  }

  async speak(text, language = null) {
    if (!this.ready || !this.synth) throw new Error("Call init() before speak()");
    if (language) this.setLanguage(language);

    const shouldResumeRecurring = this._listeningRecurring;
    const wasListening = this.isListening();
    if (shouldResumeRecurring) this._resumeRecurringRequested = true;
    if (wasListening) this.stopListening(true);
    this._setSpeakingState(true);

    try {
      // Prefer native speech synthesis for reliability across browsers.
      const nativeSynth = window.speechSynthesis;
      if (nativeSynth && typeof SpeechSynthesisUtterance !== "undefined") {
        return await new Promise((resolve, reject) => {
          let done = false;
          let timeoutId = null;

          const finish = () => {
            if (done) return;
            done = true;
            if (timeoutId) clearTimeout(timeoutId);
            resolve();
          };

          try {
            nativeSynth.cancel();
            nativeSynth.resume();

            const u = new SpeechSynthesisUtterance(String(text ?? ""));
            u.lang = this.language || "en-US";
            if (this._voice) u.voice = this._voice;
            u.pitch = this.pitch;
            u.rate = this.rate;
            u.volume = this.volume;
            u.onend = finish;
            u.onerror = (e) => {
              if (done) return;
              done = true;
              if (timeoutId) clearTimeout(timeoutId);
              reject(e || new Error("Native speech synthesis failed"));
            };

            timeoutId = setTimeout(finish, 8000);
            nativeSynth.speak(u);
          } catch (e) {
            if (done) return;
            done = true;
            if (timeoutId) clearTimeout(timeoutId);
            reject(e);
          }
        });
      }

      // Fallback to p5.Speech
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
    } finally {
      this._setSpeakingState(false);
      if (shouldResumeRecurring && this._resumeRecurringRequested) {
        try {
          this.listenRecurring(this._listenHandler ?? null, {
            language: this._recurringLanguage || this.language,
            interimResults: this._recurringInterimResults,
          });
        } catch (e) {
          console.warn("PortalSpeech could not resume recurring listening after speak:", e);
        }
      }
      this._resumeRecurringRequested = false;
    }
  }

  _pickVoice(language) {
    const synth = window.speechSynthesis;
    if (!synth?.getVoices) return null;
    const voices = synth.getVoices() || [];
    if (!voices.length) return null;
    const lang = (language || "").toLowerCase();
    return (
      voices.find((v) => (v.lang || "").toLowerCase() === lang) ||
      voices.find((v) => (v.lang || "").toLowerCase().startsWith(lang.split("-")[0])) ||
      voices[0]
    );
  }

  async _waitVoices(timeoutMs = 1500) {
    const synth = window.speechSynthesis;
    if (!synth?.getVoices) return;
    if ((synth.getVoices() || []).length) return;

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        synth.onvoiceschanged = null;
        resolve();
      };
      synth.onvoiceschanged = finish;
      setTimeout(finish, timeoutMs);
    });
  }

  // One-shot listener: resolves with first final sentence.
  async listen(language = null) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listen()");
    if (language) this.setLanguage(language);
    if (this._listenPromise) return this._listenPromise;

    this._listenPromise = new Promise((resolve, reject) => {
      let resolved = false;
      let lastText = "";
      this._setListeningState(true);

      const finish = (value, isErr = false) => {
        if (resolved) return;
        resolved = true;
        try { this.rec.stop(); } catch {}
        this._setListeningState(false);
        this.clearInterimResult();
        this._listenPromise = null;
        if (isErr) {
          reject(value);
        } else {
          resolve(value);
        }
      };

      this.rec.onResult = () => {
        const txt = String(this.rec.resultString || "").trim();
        if (txt) lastText = txt;
        // In non-interim mode this should already be a full sentence.
        if (this.rec.resultValue && txt) {
          this._commitResult(txt);
          finish(txt, false);
          return;
        }
        this._commitInterim(txt);
      };

      this.rec.onEnd = () => {
        if (resolved) return;
        if (lastText) {
          this._commitResult(lastText);
          finish(lastText, false);
        }
        else finish("", false);
      };

      this.rec.onError = (e) => {
        // Treat silence as an empty sentence, not an exception.
        if (e?.error === "no-speech") {
          finish("", false);
          return;
        }
        finish(e || new Error("Speech recognition failed"), true);
      };

      const startOnce = () => {
        // non-continuous + no interim gives more complete sentence results.
        this.rec.start(false, false);
      };

      const startSafe = () => {
        try {
          startOnce();
        } catch (e) {
          const msg = String(e?.message || e);
          if (msg.includes("already started") || e?.name === "InvalidStateError") {
            try { this.rec.stop(); } catch {}
            setTimeout(() => {
              try {
                startOnce();
              } catch (err) {
                finish(err, true);
              }
            }, 120);
          } else {
            finish(e, true);
          }
        }
      };

      startSafe();
    });

    return await this._listenPromise;
  }

  // Recurring mode: continuously listens and calls callback for each final sentence.
  listenRecurring(onSentence = null, { language = null, interimResults = false } = {}) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listenRecurring()");
    if (onSentence != null && typeof onSentence !== "function") {
      throw new Error("listenRecurring(onSentence): onSentence must be a function");
    }
    if (language) this.setLanguage(language);
    const continuous = true;

    this._listeningRecurring = true;
    this._setListeningState(true);
    this._listenHandler = onSentence;
    this._recurringLanguage = language || this.language;
    this._recurringInterimResults = !!interimResults;

    this.rec.onResult = () => {
      if (!this._listeningRecurring) return;
      const txt = String(this.rec.resultString || "").trim();
      if (!txt) return;
      if (!this.rec.resultValue) {
        this._commitInterim(txt);
        return;
      }
      this._commitResult(txt);
      if (typeof this._listenHandler !== "function") return;
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

  stopListening(internal = false) {
    if (!internal) this._resumeRecurringRequested = false;
    this._listeningRecurring = false;
    this._setListeningState(false);
    this.clearInterimResult();
    try {
      this.rec?.stop();
    } catch {}
  }

  stopSpeaking() {
    try {
      window.speechSynthesis?.cancel?.();
    } catch {}
    try {
      this.synth?.stop();
    } catch {}
    this._setSpeakingState(false);
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
