class GptClient {
  constructor({
    apiKey = "",
    model = "gpt-4o-mini",
    instructions = "You are a helpful assistant.",
    functionSchemas = [],      // optional: structured output schema(s)
    functionName = null,       // optional: the tool/function to force
    temperature = 0.7,
    max_tokens = 128,
  } = {}) {
    // config
    this.apiKey = apiKey;
    this.model = model;
    this.instructions = instructions;
    this.functionSchemas = functionSchemas;
    this.functionName = functionName;
    this.temperature = temperature;
    this.max_tokens = max_tokens;

    // state exposed to the sketch
    this.latestObject = null;  // { color: "blue" } or { text: "..." }
    this.hasNew = false;
    this.error = null;
    this.lastRaw = null;       // debug: raw server response
  }

  _buildTokenLimitField() {
    const value = Number(this.max_tokens);
    if (!Number.isFinite(value) || value <= 0) return {};
    if (this._usesMaxCompletionTokens()) {
      return { max_completion_tokens: value };
    }
    return { max_tokens: value };
  }

  _usesMaxCompletionTokens() {
    const model = String(this.model || "").toLowerCase();
    return model.startsWith("gpt-5");
  }

     /**
   * Ask the model something and get the result directly.
   * Returns an object:
   *    { text: "..."}           for normal Q&A
   * or { <structured fields> }  for function_call responses
   * or { error: "..." }         if something failed
   */
  async ask(userPrompt, img = null) {
    const t0 =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    this.error = null;
    this.hasNew = false;
    this.latestObject = null;
    this.lastRaw = null;

    let apiMs = 0;

    if (!this.apiKey) {
      this.error = "Missing API key";
      console.error("[GptClient] Missing API key");
      return this._attachMeta({ error: this.error }, {
        data: null,
        userPrompt,
        img,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    // --- Build multimodal user content ---
    const userContentBlocks = [{ type: "text", text: userPrompt }];

    if (img) {
      const imageBlock = await this._makeImageBlock(img);
      if (!imageBlock) {
        this.error = "Could not read image";
        return { error: this.error };
      }
      userContentBlocks.push(imageBlock);
    }

    const messages = [
      { role: "system", content: this.instructions },
      { role: "user", content: userContentBlocks },
    ];

    const body = {
      model: this.model,
      messages,
      temperature: this.temperature,
      ...this._buildTokenLimitField(),
    };

    // Structured JSON output
    if (this.functionSchemas.length > 0 && this.functionName) {
      body.functions = this.functionSchemas;
      body.function_call = { name: this.functionName };
    }

    // --- Call OpenAI ---
    let data;
    try {
      const apiStart =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      data = await resp.json();
      const apiEnd =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      apiMs = Math.max(0, apiEnd - apiStart);
    } catch (e) {
      this.error = "Network error: " + e;
      console.error("[GptClient] fetch failed:", e);
      return this._attachMeta({ error: this.error }, {
        data: null,
        userPrompt,
        img,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    this.lastRaw = data;

    if (data.error) {
      this.error = "API error: " + data.error.message;
      console.warn("[GptClient] API error:", data.error);
      return this._attachMeta({ error: this.error }, {
        data,
        userPrompt,
        img,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    const msg = data?.choices?.[0]?.message;
    if (!msg) {
      this.error = "No message in response";
      console.warn("[GptClient] Unexpected response:", data);
      return this._attachMeta({ error: this.error }, {
        data,
        userPrompt,
        img,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    // --- Parse structured function_call if present ---
    if (msg.function_call && msg.function_call.arguments) {
      try {
        const parsed = JSON.parse(msg.function_call.arguments);
        this.latestObject = parsed;
        this.hasNew = true;
        return this._attachMeta(parsed, {
          data,
          userPrompt,
          img,
          apiMs,
          totalMs: this._elapsedMs(t0),
        }); // ✅ Return structured object directly + meta
      } catch (e) {
        this.error = "Bad JSON in function_call";
        console.warn("[GptClient] Could not parse function_call:", msg.function_call);
        return this._attachMeta({ error: this.error }, {
          data,
          userPrompt,
          img,
          apiMs,
          totalMs: this._elapsedMs(t0),
        });
      }
    }

    // --- Fallback to plain text content ---
    let resultText = "";
    if (Array.isArray(msg.content)) {
      resultText = msg.content.map(b => b?.text || "").join("\n").trim();
    } else {
      resultText = msg.content;
    }

    const result = { text: resultText };
    this.latestObject = result;
    this.hasNew = true;
    return this._attachMeta(result, {
      data,
      userPrompt,
      img,
      apiMs,
      totalMs: this._elapsedMs(t0),
    }); // ✅ Return text result directly + meta
  }

  /**
   * Generate an image from a text prompt.
   * Returns:
   * {
   *   imageUrl,   // remote URL if API returns one
   *   dataUrl,    // base64 data URL if API returns b64
   *   image,      // p5.Image when possible (else null)
   *   prompt, model, size, text, meta
   * }
   */
  async generateImage(prompt, {
    model = "gpt-image-1",
    size = "1024x1024",
    n = 1,
    quality = "auto",
    output_format = "png",
    output_compression = null,
    background = "auto",
    moderation = "auto",
    preferB64 = true,
    loadAsP5Image = true,
  } = {}) {
    const t0 =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    this.error = null;
    this.hasNew = false;
    this.latestObject = null;
    this.lastRaw = null;

    let apiMs = 0;
    const userPrompt = String(prompt || "").trim();
    if (!userPrompt) {
      this.error = "Missing prompt";
      return this._attachMeta({ error: this.error }, {
        data: null,
        userPrompt: "",
        img: null,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    if (!this.apiKey) {
      this.error = "Missing API key";
      console.error("[GptClient] Missing API key");
      return this._attachMeta({ error: this.error }, {
        data: null,
        userPrompt,
        img: null,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    const body = {
      model,
      prompt: userPrompt,
      n: Math.max(1, Number(n) || 1),
    };
    if (size != null) body.size = size;
    if (quality != null) body.quality = quality;
    if (output_format != null) body.output_format = output_format;
    if (background != null) body.background = background;
    if (moderation != null) body.moderation = moderation;
    if (
      output_compression != null &&
      Number.isFinite(Number(output_compression))
    ) {
      body.output_compression = Math.max(
        0,
        Math.min(100, Number(output_compression))
      );
    }

    let data;
    try {
      const apiStart =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      let resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      // Fallback retry with minimum payload when strict params are rejected.
      if (!resp.ok) {
        let errData = null;
        try {
          errData = await resp.json();
        } catch {}

        const minimalBody = {
          model,
          prompt: userPrompt,
        };
        resp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(minimalBody),
        });

        if (!resp.ok) {
          data = errData;
          try {
            const retryErr = await resp.json();
            if (retryErr) data = retryErr;
          } catch {}
        } else {
          data = await resp.json();
        }
      } else {
        data = await resp.json();
      }
      const apiEnd =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      apiMs = Math.max(0, apiEnd - apiStart);
    } catch (e) {
      this.error = "Network error: " + e;
      return this._attachMeta({ error: this.error }, {
        data: null,
        userPrompt,
        img: null,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    this.lastRaw = data;

    if (data?.error) {
      const em = data?.error?.message || "Unknown API error";
      const et = data?.error?.type ? ` (${data.error.type})` : "";
      const ep = data?.error?.param ? ` [param: ${data.error.param}]` : "";
      this.error = "API error: " + em + et + ep;
      return this._attachMeta({ error: this.error }, {
        data,
        userPrompt,
        img: null,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    const first = data?.data?.[0] || null;
    if (!first) {
      this.error = "No image in response";
      return this._attachMeta({ error: this.error }, {
        data,
        userPrompt,
        img: null,
        apiMs,
        totalMs: this._elapsedMs(t0),
      });
    }

    const imageUrl = first?.url || null;
    const b64 = first?.b64_json || null;
    const dataUrl = b64 ? `data:image/${output_format || "png"};base64,${b64}` : null;
    const source = dataUrl || imageUrl || null;

    let p5Img = null;
    if (loadAsP5Image && source && typeof loadImage === "function") {
      try {
        p5Img = await this._loadP5Image(source);
      } catch (e) {
        console.warn("[GptClient] loadImage warning:", e);
      }
    }

    const result = {
      prompt: userPrompt,
      model,
      size,
      imageUrl,
      dataUrl,
      image: p5Img,
      text: "Image generated",
    };

    this.latestObject = result;
    this.hasNew = true;

    const out = this._attachMeta(result, {
      data,
      userPrompt,
      img: null,
      apiMs,
      totalMs: this._elapsedMs(t0),
    });

    if (out?.meta || out?._meta) {
      const mk = out.meta ? "meta" : "_meta";
      out[mk].settings = {
        ...out[mk].settings,
        imageGeneration: {
          model,
          size,
          n: Math.max(1, Number(n) || 1),
          quality,
          output_format,
          output_compression,
          background,
          moderation,
          preferB64,
        },
      };
    }

    return out;
  }
  async _makeImageBlock(img) {
  // Case 1: p5.Graphics (from createGraphics())
  if (img && img.elt && img.elt.toDataURL) {
    const dataURL = img.elt.toDataURL("image/jpeg", 0.9);
    return {
      type: "image_url",
      image_url: {
        url: dataURL
      }
    };
  }

  // Case 2: p5.Image (from loadImage, get, etc.)
  if (img && img.canvas && img.canvas.toDataURL) {
    const dataURL = img.canvas.toDataURL("image/jpeg", 0.9);
    return {
      type: "image_url",
      image_url: {
        url: dataURL
      }
    };
  }

  // Case 3: HTMLImageElement
  if (img instanceof HTMLImageElement) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dataURL = c.toDataURL("image/jpeg", 0.9);
    return {
      type: "image_url",
      image_url: {
        url: dataURL
      }
    };
  }

  // (Optional in the future: p5.MediaElement for video/webcam frames)
  return null;
}




  _attachMeta(resultObj, { data, userPrompt, img, apiMs, totalMs }) {
    const base = resultObj && typeof resultObj === "object" ? resultObj : { text: String(resultObj ?? "") };
    const key = Object.prototype.hasOwnProperty.call(base, "meta") ? "_meta" : "meta";

    base[key] = {
      instructions: this.instructions,
      prompt: userPrompt,
      model: data?.model || this.model,
      settings: {
        temperature: this.temperature,
        max_tokens: this.max_tokens,
        functionName: this.functionName,
        hasFunctionSchema: Array.isArray(this.functionSchemas) && this.functionSchemas.length > 0,
        imageIncluded: !!img,
      },
      tokens: {
        prompt: Number(data?.usage?.prompt_tokens ?? 0),
        completion: Number(data?.usage?.completion_tokens ?? 0),
        total: Number(data?.usage?.total_tokens ?? 0),
      },
      timingMs: {
        api: Math.round(Number(apiMs || 0)),
        total: Math.round(Number(totalMs || 0)),
      },
    };
    return base;
  }

  _elapsedMs(t0) {
    const t1 =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    return Math.max(0, t1 - t0);
  }

  _loadP5Image(src) {
    return new Promise((resolve, reject) => {
      try {
        loadImage(src, (img) => resolve(img), (e) => reject(e));
      } catch (e) {
        reject(e);
      }
    });
  }
}
