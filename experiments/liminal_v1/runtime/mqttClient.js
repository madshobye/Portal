(() => {
  class LiminalV1MqttClient {
    constructor({
      broker,
      clientId,
      onConnect = null,
      onMessage = null,
      onDisconnect = null,
      onError = null,
    }) {
      this.broker = broker;
      this.clientId = clientId;
      this.client = null;
      this.connected = false;
      this._onConnect = onConnect;
      this._onMessage = onMessage;
      this._onDisconnect = onDisconnect;
      this._onError = onError;
    }

    async connect() {
      if (!window.mqtt?.connect) {
        throw new Error("mqtt.js is not loaded");
      }

      if (this.client && this.connected) {
        return true;
      }

      if (!this.client) {
        this.client = window.mqtt.connect(this.broker, {
          clientId: this.clientId,
        });
        this.bindEvents();
      }

      return await new Promise((resolve, reject) => {
        const handleConnect = () => {
          cleanup();
          resolve(true);
        };
        const handleError = (error) => {
          cleanup();
          reject(error || new Error("MQTT connect failed"));
        };
        const cleanup = () => {
          this.client?.off?.("connect", handleConnect);
          this.client?.off?.("error", handleError);
        };

        this.client.on("connect", handleConnect);
        this.client.on("error", handleError);
      });
    }

    bindEvents() {
      this.client.on("connect", () => {
        this.connected = true;
        this._onConnect?.();
      });

      this.client.on("message", (topic, raw) => {
        const payload = typeof raw === "string" ? raw : raw?.toString?.() ?? "";
        this._onMessage?.({ topic, payload });
      });

      this.client.on("close", () => {
        this.connected = false;
        this._onDisconnect?.();
      });

      this.client.on("offline", () => {
        this.connected = false;
      });

      this.client.on("error", (error) => {
        this._onError?.(error);
      });
    }

    async subscribe(topic) {
      await this.connect();
      return await new Promise((resolve, reject) => {
        this.client.subscribe(topic, (error) => {
          if (error) return reject(error);
          resolve(true);
        });
      });
    }

    async publish(topic, payload) {
      await this.connect();
      return await new Promise((resolve, reject) => {
        this.client.publish(topic, JSON.stringify(payload), (error) => {
          if (error) return reject(error);
          resolve(true);
        });
      });
    }

    disconnect(force = false) {
      const client = this.client;
      this.client = null;
      try {
        client?.end(!!force);
      } catch {}
      this.connected = false;
    }
  }

  window.LiminalV1MqttClient = LiminalV1MqttClient;
})();
