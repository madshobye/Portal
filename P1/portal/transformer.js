// Client-side LLM helper built on Transformers.js
// Supports dynamic model loading + structured Q/A results.
//
// Example:
//   const t = await new PortalTransformer().init();
//   const res = await t.ask("What is the capital of Denmark?", { context: "Denmark's capital is Copenhagen." });
//   print(res.answer, res.confidence);

class PortalTransformer {
  constructor({
    task = "question-answering",
    model = "Xenova/distilbert-base-cased-distilled-squad",
    quantized = true,
    dtype = null,
    device = null,
    context = "",
    maxNewTokens = 96,
    temperature = 0.2,
    topK = 40,
    onResult = null,
    onProgress = null,
  } = {}) {
    this.task = task;
    this.model = model;
    this.quantized = !!quantized;
    this.dtype = dtype;
    this.device = device;
    this.context = String(context || "");
    this.maxNewTokens = Number(maxNewTokens) || 96;
    this.temperature = Number(temperature) || 0.2;
    this.topK = Number(topK) || 40;

    this._onResult = typeof onResult === "function" ? onResult : null;
    this._onProgress = typeof onProgress === "function" ? onProgress : null;

    this.ready = false;
    this.loading = false;
    this.running = false;

    this._transformers = null;
    this.pipeline = null;

    this._hasResult = false;
    this._hasNew = false;
    this._lastResult = null;
  }

  async init() {
    await this._ensureTransformers();
    await this.loadModel({
      task: this.task,
      model: this.model,
      quantized: this.quantized,
      dtype: this.dtype,
      device: this.device,
    });
    this.ready = true;
    return this;
  }

  async loadModel({
    task = this.task,
    model = this.model,
    quantized = this.quantized,
    dtype = this.dtype,
    device = this.device,
  } = {}) {
    await this._ensureTransformers();
    this.loading = true;

    this.task = task;
    this.model = model;
    this.quantized = !!quantized;
    this.dtype = dtype ?? null;
    this.device = device ?? null;

    const opts = {
      quantized: this.quantized,
      progress_callback: (p) => {
        if (this._onProgress) {
          try {
            this._onProgress(p);
          } catch (e) {
            console.warn("PortalTransformer onProgress callback error:", e);
          }
        }
      },
    };
    if (this.dtype) opts.dtype = this.dtype;
    if (this.device) opts.device = this.device;

    this.pipeline = await this._transformers.pipeline(this.task, this.model, opts);
    this.loading = false;
    this.ready = true;
    return true;
  }

  setContext(text = "") {
    this.context = String(text || "");
  }

  async ask(question, { context = this.context } = {}) {
    if (!this.ready || !this.pipeline) throw new Error("Call init() before ask()");

    this.running = true;
    try {
      let result;

      if (this.task === "question-answering") {
        const q = String(question || "");
        const c = String(context || "");
        const { raw, qa } = await this._runQaWithFallbacks(q, c);
        result = {
          type: "qa",
          task: this.task,
          model: this.model,
          question: q,
          answer: String(qa.answer || ""),
          confidence: Number(qa.score || 0),
          start: Number.isFinite(qa.start) ? qa.start : null,
          end: Number.isFinite(qa.end) ? qa.end : null,
          raw,
          timestamp: Date.now(),
        };
      } else {
        const prompt = this._buildStructuredPrompt(String(question || ""), String(context || ""));
        const raw = await this.pipeline(prompt, {
          max_new_tokens: this.maxNewTokens,
          temperature: this.temperature,
          top_k: this.topK,
          do_sample: this.temperature > 0,
        });
        const text = this._extractGeneratedText(raw);
        const parsed = this._parseStructuredText(text);

        result = {
          type: "qa",
          task: this.task,
          model: this.model,
          question: String(question || ""),
          answer: String(parsed.answer || ""),
          confidence: this._to01(parsed.confidence),
          reason: String(parsed.reason || ""),
          text: text,
          raw,
          timestamp: Date.now(),
        };
      }

      this._lastResult = result;
      this._hasResult = true;
      this._hasNew = true;

      if (this._onResult) {
        try {
          this._onResult(result);
        } catch (e) {
          console.warn("PortalTransformer onResult callback error:", e);
        }
      }

      return result;
    } finally {
      this.running = false;
    }
  }

  async askStructured(question, opts = {}) {
    return await this.ask(question, opts);
  }

  hasResult() {
    return this._hasResult;
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

  getResult() {
    return this._lastResult;
  }

  getresult() {
    return this.getResult();
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastResult };
  }

  consumenew() {
    return this.consumeNew();
  }

  getAnswer() {
    return String(this._lastResult?.answer || "");
  }

  getConfidence() {
    return Number(this._lastResult?.confidence || 0);
  }

  suggestSmallModels() {
    return [
      {
        model: "Xenova/distilbert-base-cased-distilled-squad",
        task: "question-answering",
        note: "Fast extractive Q/A. Best when you provide context text.",
      },
      {
        model: "Xenova/flan-t5-small",
        task: "text2text-generation",
        note: "Small instruct model. Can return short structured answers.",
      },
      {
        model: "Xenova/distilgpt2",
        task: "text-generation",
        note: "Very small generative model. Works in browser but lower quality.",
      },
    ];
  }

  _buildStructuredPrompt(question, context) {
    return (
      "Answer the question and return ONLY compact JSON with keys: answer, confidence, reason. " +
      "confidence must be a number between 0 and 1.\n" +
      `Question: ${question}\n` +
      `Context: ${context || "No additional context."}`
    );
  }

  _extractGeneratedText(raw) {
    if (Array.isArray(raw) && raw.length > 0) {
      const item = raw[0];
      if (typeof item?.generated_text === "string") return item.generated_text;
      if (typeof item?.summary_text === "string") return item.summary_text;
      if (typeof item?.text === "string") return item.text;
    }
    if (typeof raw === "string") return raw;
    return JSON.stringify(raw || "");
  }

  _parseStructuredText(text) {
    const src = String(text || "").trim();
    const first = src.indexOf("{");
    const last = src.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const block = src.slice(first, last + 1);
      try {
        const obj = JSON.parse(block);
        return {
          answer: obj?.answer ?? "",
          confidence: obj?.confidence ?? 0,
          reason: obj?.reason ?? "",
        };
      } catch {}
    }
    return {
      answer: src,
      confidence: 0,
      reason: "",
    };
  }

  _to01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  _normalizeQaRaw(raw) {
    const item = Array.isArray(raw) ? raw[0] : raw;
    return {
      answer: item?.answer ?? item?.text ?? "",
      score: item?.score ?? item?.confidence ?? 0,
      start: item?.start,
      end: item?.end,
    };
  }

  async _runQaWithFallbacks(question, context) {
    const attempts = [];

    // Transformers.js API shape differs by version; try object input first.
    try {
      const rawObj = await this.pipeline({ question, context });
      const qaObj = this._normalizeQaRaw(rawObj);
      attempts.push({ raw: rawObj, qa: qaObj, mode: "object" });
      if (String(qaObj.answer || "").trim()) return attempts[attempts.length - 1];
    } catch (e) {
      attempts.push({ raw: { _error: String(e) }, qa: { answer: "", score: 0 }, mode: "object_error" });
    }

    // Fallback for versions expecting positional args.
    try {
      const rawPos = await this.pipeline(question, context);
      const qaPos = this._normalizeQaRaw(rawPos);
      attempts.push({ raw: rawPos, qa: qaPos, mode: "positional" });
      if (String(qaPos.answer || "").trim()) return attempts[attempts.length - 1];
    } catch (e) {
      attempts.push({ raw: { _error: String(e) }, qa: { answer: "", score: 0 }, mode: "positional_error" });
    }

    // Return the last non-error attempt if all are empty; keeps debug visibility.
    const lastUsable = [...attempts].reverse().find((a) => !String(a.mode).endsWith("_error"));
    return lastUsable || { raw: attempts, qa: { answer: "", score: 0 } };
  }

  async _ensureTransformers() {
    if (this._transformers?.pipeline) return;

    const candidates = [
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers",
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2",
    ];

    let lastError = null;
    for (const url of candidates) {
      try {
        const mod = await import(url);
        if (mod?.pipeline) {
          this._transformers = mod;
          return;
        }
      } catch (e) {
        lastError = e;
      }
    }

    throw new Error(
      "PortalTransformer: could not load Transformers.js" +
        (lastError ? ` (${lastError})` : "")
    );
  }
}
