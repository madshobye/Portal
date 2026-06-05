export class WebSocketTransport extends EventTarget {
  constructor({
    url = "ws://p1-embed-f7a608.local:81/",
  } = {}) {
    super();
    this.url = url;
    this.socket = null;
    this.connected = false;
    this.state = "idle";
    this.supportsJson = true;
    this.supportsMsgPack = false;
  }

  get available() {
    return "WebSocket" in window;
  }

  async connect({ url = this.url } = {}) {
    if (!this.available) throw new Error("WebSocket is not available");
    if (this.connected) return true;

    this.url = url;
    this.setState("connecting");

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let settled = false;

      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) {
          resolve(value);
        } else {
          reject(value);
        }
      };

      const timer = setTimeout(() => {
        socket.close();
        finish(false, new Error(`Timed out connecting to ${this.url}`));
      }, 5000);

      socket.addEventListener("open", () => {
        this.connected = true;
        this.setState("connected");
        finish(true);
      }, { once: true });

      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          this.emit("line", { line: event.data });
        }
      });

      socket.addEventListener("close", () => {
        const wasConnecting = !settled;
        this.connected = false;
        this.setState("disconnected");
        if (wasConnecting) finish(false, new Error(`WebSocket closed before connecting to ${this.url}`));
      });

      socket.addEventListener("error", () => {
        const error = new Error(`WebSocket error: ${this.url}`);
        if (settled) this.emit("error", { error });
        finish(false, error);
      });
    });

    return true;
  }

  async disconnect() {
    this.connected = false;
    this.socket?.close();
    this.socket = null;
    this.setState("disconnected");
  }

  async sendLine(line) {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket transport is not connected");
    }
    this.socket.send(line);
  }

  setState(state) {
    this.state = state;
    this.emit("state", { state });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
