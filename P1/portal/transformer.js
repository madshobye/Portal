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
        const text = this._extractGeneratedText(raw, prompt);
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

  async askJSON({
    instructions = "",
    prompt = "",
    schema = {},
    context = "",
    maxAttempts = 2,
  } = {}) {
    if (!this.ready || !this.pipeline) throw new Error("Call init() before askJSON()");

    const schemaObj = this._normalizeSchema(schema);
    const requiredKeys = Object.keys(schemaObj);
    if (requiredKeys.length === 0) {
      throw new Error("askJSON requires a non-empty schema object");
    }

    this.running = true;
    try {
      const basePrompt = this._buildCustomJSONPrompt({
        instructions,
        prompt,
        context,
        schema: schemaObj,
      });

      let attemptText = "";
      let lastRaw = null;

      for (let i = 0; i < Math.max(1, Number(maxAttempts) || 1); i++) {
        const runPrompt =
          i === 0 ? basePrompt : this._buildRepairJSONPrompt(attemptText, schemaObj);
        const raw = await this.pipeline(runPrompt, {
          max_new_tokens: this.maxNewTokens,
          temperature: i === 0 ? this.temperature : 0,
          top_k: i === 0 ? this.topK : 1,
          do_sample: i === 0 ? this.temperature > 0 : false,
        });
        lastRaw = raw;
        attemptText = this._extractGeneratedText(raw, runPrompt);
        const obj = this._parseAnyJSONObject(attemptText);
        if (obj) {
          const normalized = this._coerceToSchema(obj, schemaObj);
          if (this._hasAllKeys(normalized, requiredKeys)) {
            return normalized;
          }
        }
      }

      // Final fallback: return object with required keys present.
      const fallback = this._coerceToSchema(this._parseAnyJSONObject(attemptText) || {}, schemaObj);
      if (!this._hasAllKeys(fallback, requiredKeys)) {
        throw new Error("askJSON: failed to produce JSON with required keys");
      }
      return fallback;
    } finally {
      this.running = false;
    }
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

  getLatest() {
    return { result: this._lastResult };
  }

  getlatest() {
    return this.getLatest();
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
      "You are a strict JSON API. Return ONLY one minified JSON object and nothing else.\n" +
      'Schema: {"answer":"string","confidence":number,"reason":"string"}\n' +
      "Rules:\n" +
      "- confidence must be between 0 and 1\n" +
      "- answer must be short (max 25 words)\n" +
      "- reason must be short (max 35 words)\n" +
      "- no markdown, no explanations outside JSON\n" +
      `Question: ${question}\n` +
      `Context: ${context || "No additional context."}\n` +
      'Output JSON:'
    );
  }

  _normalizeSchema(schema) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
    return schema;
  }

  _buildCustomJSONPrompt({ instructions, prompt, context, schema }) {
    const schemaStr = JSON.stringify(schema);
    return (
      "You are a strict JSON API. Return ONLY one minified JSON object and nothing else.\n" +
      `Schema: ${schemaStr}\n` +
      "Rules:\n" +
      "- output must be valid JSON\n" +
      "- include all schema keys\n" +
      "- no markdown, no code fences, no prose outside JSON\n" +
      `Instructions: ${String(instructions || "Follow schema exactly.")}\n` +
      `Prompt: ${String(prompt || "")}\n` +
      `Context: ${String(context || "")}\n` +
      "Output JSON:"
    );
  }

  _buildRepairJSONPrompt(previousText, schema) {
    return (
      "Fix the text below into ONLY one valid minified JSON object.\n" +
      `Schema: ${JSON.stringify(schema)}\n` +
      "Rules:\n" +
      "- include all schema keys\n" +
      "- output JSON only\n" +
      `Text: ${String(previousText || "")}\n` +
      "Output JSON:"
    );
  }

  _extractGeneratedText(raw, prompt = "") {
    const promptText = String(prompt || "");
    const stripPromptPrefix = (txt) => {
      const src = String(txt || "");
      if (!src) return src;
      if (promptText && src.startsWith(promptText)) {
        return src.slice(promptText.length).trimStart();
      }
      return src;
    };

    if (Array.isArray(raw) && raw.length > 0) {
      const item = raw[0];
      if (typeof item?.generated_text === "string")
        return stripPromptPrefix(item.generated_text);
      if (typeof item?.summary_text === "string")
        return stripPromptPrefix(item.summary_text);
      if (typeof item?.text === "string")
        return stripPromptPrefix(item.text);
    }
    if (typeof raw === "string") return stripPromptPrefix(raw);
    return stripPromptPrefix(JSON.stringify(raw || ""));
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
    // Fallback: try line-based extraction if model ignored JSON.
    const answerLine = src.match(/(?:^|\n)\s*answer\s*[:=]\s*(.+)/i)?.[1] || "";
    const confidenceLine =
      src.match(/(?:^|\n)\s*confidence\s*[:=]\s*([0-9]*\.?[0-9]+)/i)?.[1] || "";
    const reasonLine = src.match(/(?:^|\n)\s*reason\s*[:=]\s*(.+)/i)?.[1] || "";
    if (answerLine || confidenceLine || reasonLine) {
      return {
        answer: answerLine.trim(),
        confidence: confidenceLine.trim(),
        reason: reasonLine.trim(),
      };
    }

    // Last resort: keep output concise instead of dumping long prose.
    const oneLine = src.replace(/\s+/g, " ").trim();
    const clipped = oneLine.length > 180 ? oneLine.slice(0, 177) + "..." : oneLine;
    return {
      answer: clipped,
      confidence: 0,
      reason: "Model did not return structured JSON.",
    };
  }

  _parseAnyJSONObject(text) {
    const src = String(text || "");
    for (let start = src.lastIndexOf("{"); start >= 0; start = src.lastIndexOf("{", start - 1)) {
      for (let end = src.indexOf("}", start + 1); end >= 0; end = src.indexOf("}", end + 1)) {
        const block = src.slice(start, end + 1);
        try {
          const parsed = JSON.parse(block);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch {}
      }
    }
    return null;
  }

  _hasAllKeys(obj, keys) {
    return keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
  }

  _coerceToSchema(obj, schema) {
    const out = {};
    for (const key of Object.keys(schema)) {
      const expected = schema[key];
      const value = obj?.[key];
      if (value === undefined || value === null) {
        out[key] = this._defaultForType(expected);
        continue;
      }
      out[key] = this._coerceValue(value, expected);
    }
    return out;
  }

  _defaultForType(typeName) {
    const t = String(typeName || "").toLowerCase();
    if (t === "number") return 0;
    if (t === "boolean") return false;
    if (t === "array") return [];
    if (t === "object") return {};
    return "";
  }

  _coerceValue(value, typeName) {
    const t = String(typeName || "").toLowerCase();
    if (t === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    if (t === "boolean") {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true") return true;
        if (s === "false") return false;
      }
      return Boolean(value);
    }
    if (t === "array") return Array.isArray(value) ? value : [value];
    if (t === "object") return value && typeof value === "object" ? value : {};
    return String(value);
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
