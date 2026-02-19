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

     /**
   * Ask the model something and get the result directly.
   * Returns an object:
   *    { text: "..."}           for normal Q&A
   * or { <structured fields> }  for function_call responses
   * or { error: "..." }         if something failed
   */
  async ask(userPrompt, img = null) {
    this.error = null;
    this.hasNew = false;
    this.latestObject = null;
    this.lastRaw = null;

    if (!this.apiKey) {
      this.error = "Missing API key";
      console.error("[GptClient] Missing API key");
      return { error: this.error };
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
      max_tokens: this.max_tokens,
    };

    // Structured JSON output
    if (this.functionSchemas.length > 0 && this.functionName) {
      body.functions = this.functionSchemas;
      body.function_call = { name: this.functionName };
    }

    // --- Call OpenAI ---
    let data;
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      data = await resp.json();
    } catch (e) {
      this.error = "Network error: " + e;
      console.error("[GptClient] fetch failed:", e);
      return { error: this.error };
    }

    this.lastRaw = data;

    if (data.error) {
      this.error = "API error: " + data.error.message;
      console.warn("[GptClient] API error:", data.error);
      return { error: this.error };
    }

    const msg = data?.choices?.[0]?.message;
    if (!msg) {
      this.error = "No message in response";
      console.warn("[GptClient] Unexpected response:", data);
      return { error: this.error };
    }

    // --- Parse structured function_call if present ---
    if (msg.function_call && msg.function_call.arguments) {
      try {
        const parsed = JSON.parse(msg.function_call.arguments);
        this.latestObject = parsed;
        this.hasNew = true;
        return parsed; // ✅ Return structured object directly
      } catch (e) {
        this.error = "Bad JSON in function_call";
        console.warn("[GptClient] Could not parse function_call:", msg.function_call);
        return { error: this.error };
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
    return result; // ✅ Return text result directly
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




}
