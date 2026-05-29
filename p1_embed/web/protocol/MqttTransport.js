const DEFAULT_MQTT_ROOT = "";
export const MQTT_TRANSPORT_VERSION = "0.1.87-ui179";

console.info(`[P1E mqtt] loaded ${MQTT_TRANSPORT_VERSION}`);

export class MqttTransport extends EventTarget {
  constructor({
    mqttUrl = "wss://public.cloud.shiftr.io",
    username = "public",
    password = "public",
    root = DEFAULT_MQTT_ROOT,
    clientId = "",
    deviceId = "",
    connectTimeoutMs = 15000,
  } = {}) {
    super();
    this.mqttUrl = mqttUrl;
    this.username = username;
    this.password = password;
    this.root = root;
    this.localId = normalizeTopicPart(clientId) || makeClientId();
    this.remoteId = normalizeTopicPart(deviceId);
    this.connectTimeoutMs = connectTimeoutMs;
    this.client = null;
    this.connected = false;
    this._closed = false;
  }

  get available() {
    return typeof window !== "undefined" && "mqtt" in window;
  }

  async connect({ remoteId = this.remoteId } = {}) {
    if (!("mqtt" in window)) throw new Error("MQTT.js is not available");
    this.remoteId = normalizeTopicPart(remoteId);
    if (!this.remoteId) throw new Error("MQTT device id is required");
    this._closed = false;
    this.setState("signaling_connecting", { remoteId: this.remoteId });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.disconnect();
        reject(new Error(`Timed out opening MQTT connection for ${this.remoteId}`));
      }, this.connectTimeoutMs);

      const finish = (ok, value) => {
        clearTimeout(timer);
        ok ? resolve(value) : reject(value);
      };

      try {
        this.client = window.mqtt.connect(this.mqttUrl, {
          clientId: this.localId,
          username: this.username,
          password: this.password,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: Math.min(this.connectTimeoutMs, 12000),
        });

        this.client.on("connect", async () => {
          if (this._closed) return;
          this.connected = true;
          this.setState("signaling_connected", { remoteId: this.remoteId, localId: this.localId });
          try {
            await subscribe(this.client, this.responseTopic());
            await subscribe(this.client, this.eventTopic());
            await subscribe(this.client, this.helloTopic());
            this.setState("answer_received", { remoteId: this.remoteId });
            this.setState("connected", { remoteId: this.remoteId, localId: this.localId });
            finish(true, true);
          } catch (error) {
            finish(false, error);
          }
        });

        this.client.on("message", (topic, payload) => this.handleMessage(topic, payload));
        this.client.on("close", () => {
          this.connected = false;
          if (!this._closed) this.setState("disconnected", { remoteId: this.remoteId });
        });
        this.client.on("error", (error) => {
          this.emit("error", { error });
          if (!this.connected) finish(false, error);
        });
      } catch (error) {
        finish(false, error);
      }
    });

    return true;
  }

  async disconnect() {
    this._closed = true;
    this.connected = false;
    if (this.client) {
      await new Promise((resolve) => {
        try {
          this.client.end(true, {}, resolve);
        } catch {
          resolve();
        }
      });
    }
    this.client = null;
    this.setState("disconnected", { remoteId: this.remoteId });
  }

  async sendBytes(data) {
    if (!this.client || !this.connected) throw new Error("MQTT is not connected");
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await publish(this.client, this.commandTopic(), bytes);
  }

  async sendLine() {
    throw new Error("MQTT transport uses binary MessagePack frames");
  }

  commandTopic() {
    return `${this.baseTopic()}/cmd/${this.localId}`;
  }

  responseTopic() {
    return `${this.baseTopic()}/res/${this.localId}`;
  }

  eventTopic() {
    return `${this.baseTopic()}/evt`;
  }

  helloTopic() {
    return `${this.baseTopic()}/hello`;
  }

  baseTopic() {
    const root = normalizeTopicPart(this.root) || this.remoteId;
    return `p1e/${root}/${this.remoteId}`;
  }

  handleMessage(topic, payload) {
    if (topic === this.helloTopic()) {
      this.emit("state", { state: "diagnostic", remoteId: this.remoteId, message: `hello ${payload?.length || 0} bytes` });
      return;
    }
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    this.emit("frame", { data: bytes });
  }

  setState(state, detail = {}) {
    this.emit("state", { state, ...detail });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function normalizeTopicPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function makeClientId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `p1e-web-${Date.now().toString(36)}-${suffix}`;
}

function subscribe(client, topic) {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 0 }, (error) => error ? reject(error) : resolve());
  });
}

function publish(client, topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 0, retain: false }, (error) => error ? reject(error) : resolve());
  });
}
