// Student-friendly MQTT helper
// Requires mqtt.js in browser (auto-loaded from unpkg if missing).
//
// Example:
//   const mq = await new PortalMqtt({ broker: "wss://..." }).init();
//   await mq.subscribe("/topic");
//   await mq.publish("/topic", "hello");

class PortalMqtt {
  constructor({
    broker = "wss://public:public@public.cloud.shiftr.io",
    clientId = null,
    options = {},
    autoConnect = true,
    onConnect = null,
    onMessage = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.broker = broker;
    this.clientId = clientId || `portal_${Math.random().toString(16).slice(2, 10)}`;
    this.options = { ...options };
    this.autoConnect = !!autoConnect;

    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onMessage = typeof onMessage === "function" ? onMessage : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.client = null;
    this.ready = false;
    this.connected = false;
    this._bound = false;

    this._hasResult = false;
    this._hasNew = false;
    this._lastMessage = null; // { topic, message, raw, timestamp }
  }

  async init() {
    await this._ensureMqtt();
    this.ready = true;
    if (this.autoConnect) await this.connect();
    return this;
  }

  async connect() {
    if (!this.ready) throw new Error("Call init() before connect()");
    if (this.connected && this.client) return true;

    if (!this.client) {
      this.client = window.mqtt.connect(this.broker, {
        clientId: this.clientId,
        ...this.options,
      });
      this._bindEvents();
    }

    return await new Promise((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve(true);
      };
      const onError = (err) => {
        cleanup();
        reject(err || new Error("MQTT connect failed"));
      };
      const cleanup = () => {
        this.client?.off?.("connect", onConnect);
        this.client?.off?.("error", onError);
      };

      this.client?.on?.("connect", onConnect);
      this.client?.on?.("error", onError);
    });
  }

  disconnect(force = false) {
    if (!this.client) return;
    try {
      this.client.end(!!force);
    } catch {}
    this.connected = false;
  }

  async subscribe(topic, options = {}) {
    if (!topic) throw new Error("subscribe(topic): topic is required");
    await this._ensureConnected();
    return await new Promise((resolve, reject) => {
      this.client.subscribe(topic, options, (err, granted) => {
        if (err) return reject(err);
        resolve(granted || true);
      });
    });
  }

  async unsubscribe(topic) {
    if (!topic) throw new Error("unsubscribe(topic): topic is required");
    await this._ensureConnected();
    return await new Promise((resolve, reject) => {
      this.client.unsubscribe(topic, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  async publish(topic, message, options = {}) {
    if (!topic) throw new Error("publish(topic, message): topic is required");
    await this._ensureConnected();
    const payload = String(message ?? "");
    return await new Promise((resolve, reject) => {
      this.client.publish(topic, payload, options, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
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
    return this._lastMessage;
  }

  getresult() {
    return this.getResult();
  }

  getLatest() {
    return { result: this._lastMessage };
  }

  getlatest() {
    return this.getLatest();
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastMessage };
  }

  consumenew() {
    return this.consumeNew();
  }

  setMessageHandler(fn) {
    this._onMessage = typeof fn === "function" ? fn : null;
  }

  _bindEvents() {
    if (!this.client || this._bound) return;
    this._bound = true;

    this.client.on("connect", () => {
      this.connected = true;
      if (this._onConnect) {
        try {
          this._onConnect();
        } catch (e) {
          console.warn("PortalMqtt onConnect callback error:", e);
        }
      }
    });

    this.client.on("message", (topic, raw) => {
      const message = this._toText(raw);
      const result = {
        topic,
        message,
        raw,
        timestamp: Date.now(),
      };

      this._lastMessage = result;
      this._hasResult = true;
      this._hasNew = true;

      if (this._onMessage) {
        try {
          this._onMessage(result);
        } catch (e) {
          console.warn("PortalMqtt onMessage callback error:", e);
        }
      }
    });

    this.client.on("close", () => {
      this.connected = false;
      if (this._onDisconnect) {
        try {
          this._onDisconnect();
        } catch (e) {
          console.warn("PortalMqtt onDisconnect callback error:", e);
        }
      }
    });

    this.client.on("offline", () => {
      this.connected = false;
    });

    this.client.on("error", (err) => {
      if (this._onError) {
        try {
          this._onError(err);
        } catch (e) {
          console.warn("PortalMqtt onError callback error:", e);
        }
      } else {
        console.warn("PortalMqtt error:", err);
      }
    });
  }

  async _ensureConnected() {
    if (!this.client || !this.connected) await this.connect();
  }

  _toText(raw) {
    if (raw == null) return "";
    if (typeof raw === "string") return raw;
    if (raw instanceof Uint8Array && typeof TextDecoder !== "undefined") {
      try {
        return new TextDecoder().decode(raw);
      } catch {}
    }
    if (typeof raw?.toString === "function") return raw.toString();
    return String(raw);
  }

  async _ensureMqtt() {
    if (window.mqtt?.connect) return;
    await loadScript("https://unpkg.com/mqtt/dist/mqtt.min.js");
    if (!window.mqtt?.connect) {
      throw new Error("PortalMqtt: mqtt.js failed to load");
    }
  }
}
