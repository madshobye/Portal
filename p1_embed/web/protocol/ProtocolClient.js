const P1E_PROTOCOL_DEBUG = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("debug")) localStorage.setItem("p1_embed.debug.console", "1");
    return params.has("debug") || localStorage.getItem("p1_embed.debug.console") === "1";
  } catch {
    return false;
  }
})();

function p1eProtocolDebug(label, data = {}) {
  if (!P1E_PROTOCOL_DEBUG) return;
  console.debug("[P1E protocol]", label, {
    at: new Date().toISOString(),
    ...data,
  });
}

export class ProtocolClient extends EventTarget {
  constructor(transport, { timeoutMs = 15000 } = {}) {
    super();
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.lineCount = 0;
    this.scriptPrintCount = 0;

    this.transport.addEventListener("line", (event) => this.acceptLine(event.detail.line));
    this.transport.addEventListener("state", (event) => this.emit("state", event.detail));
    this.transport.addEventListener("error", (event) => this.emit("error", event.detail));
  }

  async request(name, data = {}, options = {}) {
    const id = String(this.nextId++);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const message = {
      type: "cmd",
      id,
      name,
      data,
      ...data,
    };

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        p1eProtocolDebug("timeout", {
          id,
          name,
          timeoutMs,
          pending: [...this.pending.keys()],
        });
        reject(new Error(`Timed out waiting for ${name} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name });
    });

    const line = JSON.stringify(message);
    p1eProtocolDebug("send", {
      id,
      name,
      bytes: new TextEncoder().encode(line).length,
      timeoutMs,
      pending: [...this.pending.keys()],
    });
    await this.transport.sendLine(line);
    p1eProtocolDebug("send-ok", { id, name });
    return await responsePromise;
  }

  async sendRaw(text) {
    await this.transport.sendLine(text);
  }

  acceptLine(line) {
    this.lineCount += 1;
    const message = parseProtocolMessage(line);
    if (!message) {
      p1eProtocolDebug("raw", {
        lineCount: this.lineCount,
        sample: String(line).slice(0, 180),
      });
      this.emit("raw", { line });
      return;
    }

    if (message.type === "evt" && message.name === "script.print") {
      this.scriptPrintCount += 1;
      if (this.scriptPrintCount <= 8 || this.scriptPrintCount % 25 === 0) {
        p1eProtocolDebug("event", {
          lineCount: this.lineCount,
          type: message.type,
          name: message.name,
          scriptPrintCount: this.scriptPrintCount,
          pending: [...this.pending.keys()],
          message: message.data?.message,
        });
      }
    } else {
      p1eProtocolDebug("message", {
        lineCount: this.lineCount,
        type: message.type,
        name: message.name,
        id: message.id,
        ok: message.ok,
        pending: [...this.pending.keys()],
      });
    }

    this.emit("message", { message });

    if (message.type === "res") {
      this.acceptResponse(message);
      return;
    }

    if (message.type === "evt") {
      this.emit("event", { event: message });
      return;
    }

    this.emit("unknown", { message });
  }

  acceptResponse(message) {
    const id = String(message.id ?? "");
    const pending = this.pending.get(id);
    if (!pending) {
      p1eProtocolDebug("late-response", {
        id,
        ok: message.ok,
        pending: [...this.pending.keys()],
      });
      this.emit("response", { response: message, late: true });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.ok) {
      p1eProtocolDebug("resolve", {
        id,
        name: pending.name,
      });
      pending.resolve(message.data || {});
    } else {
      const error = new Error(message.error?.message || "Protocol command failed");
      error.code = message.error?.code || "command_failed";
      error.response = message;
      pending.reject(error);
    }
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function parseProtocolMessage(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
  }

  const candidates = ['{"type":"res"', '{"type":"evt"', '{"type":"cmd"'];
  let start = -1;
  for (const candidate of candidates) {
    const index = text.indexOf(candidate);
    if (index >= 0 && (start < 0 || index < start)) start = index;
  }
  if (start < 0) return null;

  const end = findJsonObjectEnd(text, start);
  if (end < 0) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
