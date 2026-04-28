// Speech2 helper:
// - Uses Web Speech API directly (SpeechRecognition / webkitSpeechRecognition)
// - Recurring mode uses one-utterance cycles (continuous=false) with auto-restart
// - No custom sentence buffering; finals are emitted exactly as provided by the API

class PortalSpeech2 {
  constructor({
    language = "en-US",
    voice = null,
    pitch = 1,
    rate = 1,
    volume = 1,
  } = {}) {
    this.language = language;
    this.voiceName = voice;
    this.pitch = Number.isFinite(Number(pitch)) ? Number(pitch) : 1;
    this.rate = Number.isFinite(Number(rate)) ? Number(rate) : 1;
    this.volume = Number.isFinite(Number(volume))
      ? Math.max(0, Math.min(1, Number(volume)))
      : 1;

    this.ready = false;
    this.listening = false;
    this.speaking = false;

    this.rec = null;
    this._voice = null;
    this._listenPromise = null;
    this._listeningRecurring = false;
    this._listenHandler = null;
    this._listenResultHandler = null;
    this._listenStateHandler = null;
    this._speakStateHandler = null;
    this._interimResultHandler = null;
    this._recurringLanguage = null;
    this._recurringInterimResults = false;
    this._resumeRecurringRequested = false;
    this._restartTimer = null;

    this._hasResult = false;
    this._hasNew = false;
    this._resultText = "";
    this._hasInterim = false;
    this._interimText = "";
    this._lastInterimAt = 0;
    this._lastFinalAt = 0;
  }

  async init() {
    this._createRecognition();
    this.setLanguage(this.language);
    if (this.voiceName) this.setVoice(this.voiceName);
    this.ready = true;
    return this;
  }

  _createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("PortalSpeech2: SpeechRecognition is not available");
    this.rec = new SR();
    return this.rec;
  }

  setLanguage(language = "en-US") {
    this.language = language;
    if (this.rec) this.rec.lang = language;
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
    if (!synth?.getVoices) return;
    const voices = synth.getVoices() || [];
    const byName = voices.find(
      (v) => (v.name || "").toLowerCase() === this.voiceName.toLowerCase()
    );
    if (byName) this._voice = byName;
  }

  setPitch(pitch = 1) {
    this.pitch = Number.isFinite(Number(pitch)) ? Number(pitch) : 1;
  }

  setRate(rate = 1) {
    this.rate = Number.isFinite(Number(rate)) ? Number(rate) : 1;
  }

  setVolume(volume = 1) {
    const v = Number(volume);
    this.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
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

  isInterim() {
    return this._hasInterim;
  }

  isinterim() {
    return this.isInterim();
  }

  getInterimFlag() {
    return this._hasInterim;
  }

  getinterimflag() {
    return this.getInterimFlag();
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

  _setListeningState(value) {
    const next = !!value;
    if (this.listening === next) return;
    this.listening = next;
    if (typeof this._listenStateHandler === "function") {
      try {
        this._listenStateHandler(this.listening);
      } catch (e) {
        console.warn("PortalSpeech2 onListeningChange callback error:", e);
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
        console.warn("PortalSpeech2 onSpeakingChange callback error:", e);
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
        console.warn("PortalSpeech2 onResult callback error:", e);
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
        console.warn("PortalSpeech2 onInterimResult callback error:", e);
      }
    }
    return true;
  }

  async speak(text, language = null) {
    if (!this.ready) throw new Error("Call init() before speak()");
    if (language) this.setLanguage(language);

    const shouldResumeRecurring = this._listeningRecurring;
    if (shouldResumeRecurring) this._resumeRecurringRequested = true;
    if (this.isListening()) this.stopListening(true);
    this._setSpeakingState(true);

    try {
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        throw new Error("PortalSpeech2: Speech synthesis is unavailable");
      }
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
          synth.cancel();
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
            reject(e || new Error("PortalSpeech2: Speech synthesis failed"));
          };
          timeoutId = setTimeout(finish, 10000);
          synth.speak(u);
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
          console.warn("PortalSpeech2 could not resume recurring listening:", e);
        }
      }
      this._resumeRecurringRequested = false;
    }
  }

  async listen(language = null) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listen()");
    if (language) this.setLanguage(language);
    if (this._listenPromise) return this._listenPromise;

    this._listenPromise = new Promise((resolve, reject) => {
      let resolved = false;
      this._setListeningState(true);

      const finish = (value, isErr = false) => {
        if (resolved) return;
        resolved = true;
        try { this.rec.stop(); } catch {}
        this._setListeningState(false);
        this._listenPromise = null;
        if (isErr) reject(value);
        else resolve(value);
      };

      this.rec.lang = this.language;
      this.rec.continuous = false;
      this.rec.interimResults = true;

      this.rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const txt = String(result?.[0]?.transcript || "").trim();
          if (!txt) continue;
          if (result.isFinal) {
            this._commitResult(txt);
            finish(txt, false);
            return;
          }
          this._commitInterim(txt);
        }
      };

      this.rec.onend = () => {
        if (resolved) return;
        finish("", false);
      };

      this.rec.onerror = (e) => {
        if (e?.error === "no-speech") {
          finish("", false);
          return;
        }
        finish(e || new Error("PortalSpeech2: recognition failed"), true);
      };

      try {
        this.rec.start();
      } catch (e) {
        finish(e, true);
      }
    });

    return await this._listenPromise;
  }

  listenRecurring(onSentence = null, { language = null, interimResults = false } = {}) {
    if (!this.ready || !this.rec) throw new Error("Call init() before listenRecurring()");
    if (onSentence != null && typeof onSentence !== "function") {
      throw new Error("listenRecurring(onSentence): onSentence must be a function");
    }
    if (language) this.setLanguage(language);

    this._listenHandler = onSentence;
    this._recurringLanguage = language || this.language;
    this._recurringInterimResults = !!interimResults;
    this._listeningRecurring = true;

    this._attachRecurringHandlers();
    this._startRecurringCycle(0);
  }

  async reinitializeRecognition({ restartIfNeeded = true } = {}) {
    const wasRecurring = !!this._listeningRecurring;
    const recurringLanguage = this._recurringLanguage || this.language;
    const recurringInterimResults = !!this._recurringInterimResults;
    const recurringHandler = this._listenHandler ?? null;

    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    try { this.rec?.stop?.(); } catch {}
    if (this.rec) {
      this.rec.onresult = null;
      this.rec.onend = null;
      this.rec.onerror = null;
    }

    this._listenPromise = null;
    this._setListeningState(false);
    this.clearInterimResult();
    this._createRecognition();
    this.setLanguage(this.language);
    if (this.voiceName) this.setVoice(this.voiceName);

    if (restartIfNeeded && wasRecurring) {
      this.listenRecurring(recurringHandler, {
        language: recurringLanguage,
        interimResults: recurringInterimResults,
      });
    }

    return this;
  }

  _attachRecurringHandlers() {
    if (!this.rec) return;
    this.rec.onresult = (event) => {
      if (!this._listeningRecurring) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const txt = String(result?.[0]?.transcript || "").trim();
        if (!txt) continue;

        if (result.isFinal) {
          this._commitResult(txt);
          if (typeof this._listenHandler === "function") {
            try {
              this._listenHandler(txt);
            } catch (e) {
              console.warn("PortalSpeech2 listenRecurring callback error:", e);
            }
          }
          try { this.rec.stop(); } catch {}
        } else if (this._recurringInterimResults) {
          this._commitInterim(txt);
        }
      }
    };

    this.rec.onend = () => {
      this._setListeningState(false);
      if (!this._listeningRecurring) return;
      this._startRecurringCycle(120);
    };

    this.rec.onerror = () => {
      this._setListeningState(false);
      if (!this._listeningRecurring) return;
      this._startRecurringCycle(180);
    };
  }

  _startRecurringCycle(delayMs = 0) {
    if (!this.rec || !this._listeningRecurring) return;
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    const startNow = () => {
      if (!this.rec || !this._listeningRecurring) return;
      this.rec.lang = this._recurringLanguage || this.language;
      this.rec.continuous = false;
      this.rec.interimResults = !!this._recurringInterimResults;
      this._setListeningState(true);
      try {
        this.rec.start();
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("already started") || e?.name === "InvalidStateError") {
          try { this.rec.stop(); } catch {}
          this._startRecurringCycle(120);
        } else {
          this._setListeningState(false);
          this._startRecurringCycle(220);
        }
      }
    };
    if (delayMs > 0) {
      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        startNow();
      }, Math.max(0, Number(delayMs) || 0));
      return;
    }
    startNow();
  }

  stopListening(internal = false) {
    if (!internal) this._resumeRecurringRequested = false;
    this._listeningRecurring = false;
    this._setListeningState(false);
    this.clearInterimResult();
    if (this._restartTimer !== null) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    try { this.rec?.stop(); } catch {}
  }

  stopSpeaking() {
    try { window.speechSynthesis?.cancel?.(); } catch {}
    this._setSpeakingState(false);
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
}

window.PortalSpeech2 = PortalSpeech2;
