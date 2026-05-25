export class WebSocketTransport extends EventTarget {
  constructor({
    url = "ws://p1-embed-f7a608.local:81/",
  } = {}) {
    super();
    this.url = url;
    this.socket = null;
    this.connected = false;
    this.state = "idle";
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

      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting to ${this.url}`));
      }, 5000);

      socket.addEventListener("open", () => {
        clearTimeout(timer);
        this.connected = true;
        this.setState("connected");
        resolve();
      }, { once: true });

      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          this.emit("line", { line: event.data });
        }
      });

      socket.addEventListener("close", () => {
        this.connected = false;
        this.setState("disconnected");
      });

      socket.addEventListener("error", () => {
        this.emit("error", { error: new Error(`WebSocket error: ${this.url}`) });
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
