(() => {
  class RtcChatV3MqttClient {
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
      this.clientId = clientId || `rtcchat_${Math.random().toString(16).slice(2, 10)}`;
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
    }

    async init() {
      if (!window.mqtt?.connect) {
        throw new Error("mqtt.js is not loaded");
      }
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

    _bindEvents() {
      if (!this.client || this._bound) return;
      this._bound = true;

      this.client.on("connect", () => {
        this.connected = true;
        try {
          this._onConnect?.();
        } catch (error) {
          console.warn("RtcChatV3MqttClient onConnect callback error:", error);
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
        try {
          this._onMessage?.(result);
        } catch (error) {
          console.warn("RtcChatV3MqttClient onMessage callback error:", error);
        }
      });

      this.client.on("close", () => {
        this.connected = false;
        try {
          this._onDisconnect?.();
        } catch (error) {
          console.warn("RtcChatV3MqttClient onDisconnect callback error:", error);
        }
      });

      this.client.on("offline", () => {
        this.connected = false;
      });

      this.client.on("error", (error) => {
        if (this._onError) {
          try {
            this._onError(error);
          } catch (callbackError) {
            console.warn("RtcChatV3MqttClient onError callback error:", callbackError);
          }
        } else {
          console.warn("RtcChatV3MqttClient error:", error);
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
  }

  window.RtcChatV3MqttClient = RtcChatV3MqttClient;
})();
