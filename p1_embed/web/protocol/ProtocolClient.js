export class ProtocolClient extends EventTarget {
  constructor(transport, { timeoutMs = 5000 } = {}) {
    super();
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();

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
        reject(new Error(`Timed out waiting for ${name}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name });
    });

    await this.transport.sendLine(JSON.stringify(message));
    return await responsePromise;
  }

  async sendRaw(text) {
    await this.transport.sendLine(text);
  }

  acceptLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("raw", { line });
      return;
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
      this.emit("response", { response: message });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.ok) {
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
