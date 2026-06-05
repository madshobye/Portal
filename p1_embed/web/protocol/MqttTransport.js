import { MsgPackReader, MsgPackWriter } from "./P1MsgPack.js?v=0.1.87-ui335";

const DEFAULT_MQTT_ROOT = "";
const FRAME_AUTH = 3;
const FRAME_SECURE = 4;
const AUTH_START = 0;
const AUTH_CHALLENGE = 1;
const AUTH_FINISH = 2;
const AUTH_OK = 3;
const AUTH_ERROR = 4;

export const MQTT_TRANSPORT_VERSION = "0.1.87-ui335";

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
    authProvider = null,
    authMode = "control",
    guestKey = "",
  } = {}) {
    super();
    this.mqttUrl = mqttUrl;
    this.username = username;
    this.password = password;
    this.root = root;
    this.remoteId = normalizeTopicPart(deviceId);
    this.explicitClientId = normalizeTopicPart(clientId);
    this.localId = this.explicitClientId || loadStoredClientId(this.remoteId);
    this.connectTimeoutMs = connectTimeoutMs;
    this.client = null;
    this.connected = false;
    this._closed = false;
    this.hello = null;
    this.helloPromise = null;
    this.helloResolve = null;
    this.helloTimer = null;
    this.authRequired = false;
    this.auth = loadStoredAuth(this.remoteId);
    this.sessionId = 0;
    this.rxCounter = 0;
    this.txCounter = 0;
    this.clientNonce = null;
    this.authPromise = null;
    this.authResolve = null;
    this.authReject = null;
    this.authProvider = authProvider;
    this.authMode = authMode;
    this.guestKey = normalizeGuestKey(guestKey);
    this.reauthPromise = null;
    this.sessionStartedAt = 0;
    this.sendQueue = Promise.resolve();
  }

  get available() {
    return typeof window !== "undefined" && "mqtt" in window;
  }

  async connect({ remoteId = this.remoteId } = {}) {
    if (!("mqtt" in window)) throw new Error("MQTT.js is not available");
    this.remoteId = normalizeTopicPart(remoteId);
    if (!this.remoteId) throw new Error("MQTT device id is required");
    this.localId = this.explicitClientId || loadStoredClientId(this.remoteId);
    this.hello = null;
    this.auth = loadStoredAuth(this.remoteId);
    this._closed = false;
    this.setState("signaling_connecting", { remoteId: this.remoteId });

    await new Promise((resolve, reject) => {
      let openTimer = setTimeout(() => {
        this.disconnect();
        reject(new Error(`Timed out opening MQTT connection for ${this.remoteId}`));
      }, this.connectTimeoutMs);

      const finish = (ok, value) => {
        if (openTimer) clearTimeout(openTimer);
        openTimer = null;
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
            await this.waitForHello(Math.min(5000, Math.max(1000, this.connectTimeoutMs - 1000)));
            if (openTimer) clearTimeout(openTimer);
            openTimer = null;
            this.authRequired = this.hello?.auth === "required";
            const guestUiOpen = this.isGuestUiOpen();
            if ((this.authRequired || this.hello?.auth === "required") && !guestUiOpen) {
              await this.signIn({ retryPromptOnRejectedKey: true });
            }
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
    this.clearHelloWait();
    this.clearSession();
    this.setState("disconnected", { remoteId: this.remoteId });
  }

  async sendBytes(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const task = this.sendQueue.then(() => this.sendBytesNow(bytes));
    this.sendQueue = task.catch(() => {});
    return task;
  }

  async sendBytesNow(bytes) {
    if (!this.client || !this.connected) throw new Error("MQTT is not connected");
    if (this.authRequired && !this.sessionId) {
      if (!this.canSendAnonymous(bytes)) {
        await this.signIn({ retryPromptOnRejectedKey: true });
      }
    }
    const payload = this.sessionId ? await this.encodeSecure(bytes) : bytes;
    if (this.authRequired && !this.sessionId && !this.canSendAnonymous(bytes)) throw new Error("MQTT sign in required");
    await publish(this.client, this.commandTopic(), payload);
  }

  prepareMsgPackData(name, data = {}) {
    if (!this.isGuestUiOpen() || !this.isAnonymousUiCommandName(name)) return data;
    return { ...data, __guestKey: this.guestKey };
  }

  isGuestUiOpen() {
    return this.authMode === "guest-ui" && Boolean(this.hello?.anonymousUi) && this.guestKey.length >= 16;
  }

  isAnonymousUiCommandName(name = "") {
    return name === "status.light"
      || name === "system.info"
      || name === "wifi.status"
      || name === "script.input"
      || name === "wrench.input";
  }

  canSendAnonymous(bytes) {
    if (!this.isGuestUiOpen()) return false;
    try {
      const reader = new MsgPackReader(bytes);
      const count = reader.array();
      const frameType = reader.uint();
      reader.uint();
      const op = reader.uint();
      return frameType === 0 && count >= 4 && (op === 2 || op === 3 || op === 9 || op === 14);
    } catch {
      return false;
    }
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
      const text = new TextDecoder().decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload));
      try {
        this.hello = JSON.parse(text);
        this.authRequired = this.hello?.auth === "required";
      } catch {
        this.hello = null;
      }
      this.resolveHelloWait();
      this.emit("state", { state: "diagnostic", remoteId: this.remoteId, message: `hello ${payload?.length || 0} bytes` });
      return;
    }
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (this.isAuthFrame(bytes)) {
      this.handleAuthFrame(bytes);
      return;
    }
    if (this.isSecureFrame(bytes)) {
      this.decodeSecure(bytes).then((inner) => {
        if (inner) this.emit("frame", { data: inner });
      }).catch((error) => {
        if (error?.staleSecureFrame) {
          this.emit("state", { state: "diagnostic", remoteId: this.remoteId, message: error.message });
          return;
        }
        error.message = `${error.message} (mqtt bytes=${bytes.length}, head=${hexHead(bytes)})`;
        this.emit("error", { error });
      });
      return;
    }
    if (this.authRequired && this.sessionId && topic === this.eventTopic()) {
      return;
    }
    this.emit("frame", { data: bytes });
  }

  isAuthFrame(bytes) {
    return bytes?.length >= 3
      && (bytes[0] & 0xf0) === 0x90
      && bytes[1] === FRAME_AUTH
      && isMsgPackUIntPrefix(bytes[2]);
  }

  isSecureFrame(bytes) {
    return bytes?.length >= 2 && (bytes[0] & 0xf0) === 0x90 && bytes[1] === FRAME_SECURE;
  }

  async authenticate() {
    if (!this.client || !this.connected) throw new Error("MQTT is not connected");
    if (!this.auth?.username || !this.auth?.key) throw new Error("MQTT sign in required");
    if (this.authPromise) return this.authPromise;
    this.clientNonce = randomBytes(16);
    this.authPromise = new Promise((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;
      setTimeout(() => {
        if (!this.authPromise) return;
        const error = new Error("MQTT sign in timed out");
        this.authPromise = null;
        this.authReject = null;
        this.authResolve = null;
        reject(error);
      }, 5000);
    });
    const writer = new MsgPackWriter(128);
    writer.array(5);
    writer.uint(FRAME_AUTH);
    writer.uint(AUTH_START);
    writer.string(this.localId);
    writer.string(this.auth.username);
    writer.bin(this.clientNonce);
    await publish(this.client, this.commandTopic(), writer.bytes());
    return this.authPromise;
  }

  async signIn({ retryPromptOnRejectedKey = false } = {}) {
    const hadStoredAuth = Boolean(loadStoredAuth(this.remoteId));
    await this.ensureAuth();
    try {
      await this.authenticate();
    } catch (error) {
      if (!retryPromptOnRejectedKey || !hadStoredAuth || !isRejectedAuthError(error)) throw error;
      await this.ensureAuth({ forcePrompt: true });
      await this.authenticate();
    }
  }

  async handleAuthFrame(bytes) {
    try {
      const reader = new MsgPackReader(bytes);
      const count = reader.array();
      const frameType = reader.uint();
      const op = reader.uint();
      if (frameType !== FRAME_AUTH) return;
      if (op === AUTH_CHALLENGE) {
        const serverNonce = reader.bin();
        this.authRequired = Boolean(count >= 4 ? reader.bool() : true);
        if (count >= 5) reader.bool();
        if (!this.auth?.key || !this.clientNonce) throw new Error("MQTT sign in required");
        const tag = await authProof(this.auth.key, this.localId, this.auth.username, this.clientNonce, serverNonce);
        const writer = new MsgPackWriter(160);
        writer.array(6);
        writer.uint(FRAME_AUTH);
        writer.uint(AUTH_FINISH);
        writer.string(this.auth.username);
        writer.bin(this.clientNonce);
        writer.bin(serverNonce);
        writer.bin(tag);
        await publish(this.client, this.commandTopic(), writer.bytes());
        return;
      }
      if (op === AUTH_OK) {
        this.sessionId = reader.uint();
        this.rxCounter = 0;
        this.txCounter = 0;
        this.sessionStartedAt = Date.now();
        const resolve = this.authResolve;
        this.authPromise = null;
        this.authResolve = null;
        this.authReject = null;
        if (resolve) resolve(true);
        this.emit("state", { state: "diagnostic", remoteId: this.remoteId, message: `signed in as ${this.auth.username}` });
        return;
      }
      if (op === AUTH_ERROR) {
        const code = String(reader.value?.() || "auth_error");
        if (code === "session_invalid") {
          this.recoverSession(code).catch((error) => this.emit("error", { error }));
          return;
        }
        if (code === "auth_failed" || code === "unknown_user") {
          clearOnlineAuthKey(this.remoteId);
          this.auth = null;
          this.clearSession();
        }
        const error = new Error(`MQTT sign in failed: ${code}`);
        if (code === "auth_failed" || code === "unknown_user") error.authRejected = true;
        const reject = this.authReject;
        this.authPromise = null;
        this.authResolve = null;
        this.authReject = null;
        if (reject) reject(error);
        else this.emit("error", { error });
      }
    } catch (error) {
      if (this.authReject) this.authReject(error);
      else this.emit("error", { error });
      this.authPromise = null;
      this.authResolve = null;
      this.authReject = null;
    }
  }

  async ensureAuth({ forcePrompt = false } = {}) {
    this.auth = forcePrompt ? null : loadStoredAuth(this.remoteId);
    if (forcePrompt) clearOnlineAuthKey(this.remoteId);
    if (this.auth?.username && this.auth?.key) return this.auth;
    if (typeof this.authProvider === "function") {
      const provided = await this.authProvider({ remoteId: this.remoteId, hello: this.hello });
      if (provided?.username && provided?.keyHex) {
        storeOnlineAuthKey(this.remoteId, provided.username, provided.keyHex);
      }
      this.auth = loadStoredAuth(this.remoteId);
    }
    if (!this.auth?.username || !this.auth?.key) {
      this.emit("state", { state: "auth_required", remoteId: this.remoteId });
      throw new Error("MQTT sign in required");
    }
    return this.auth;
  }

  waitForHello(timeoutMs = 5000) {
    if (this.hello) return Promise.resolve(this.hello);
    this.clearHelloWait();
    this.helloPromise = new Promise((resolve, reject) => {
      this.helloTimer = setTimeout(() => {
        if (!this.helloPromise) return;
        this.clearHelloWait();
        reject(new Error(`Timed out waiting for MQTT hello from ${this.remoteId}`));
      }, timeoutMs);
      this.helloResolve = (hello) => {
        this.clearHelloWait();
        resolve(hello);
      };
    });
    return this.helloPromise;
  }

  resolveHelloWait() {
    if (this.helloResolve && this.hello) this.helloResolve(this.hello);
  }

  clearHelloWait() {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.helloTimer = null;
    this.helloPromise = null;
    this.helloResolve = null;
  }

  clearSession() {
    this.sessionId = 0;
    this.rxCounter = 0;
    this.txCounter = 0;
    this.clientNonce = null;
    this.sessionStartedAt = 0;
  }

  async recoverSession(reason = "session_invalid") {
    if (this.reauthPromise) return this.reauthPromise;
    this.clearSession();
    this.emit("state", { state: "session_lost", remoteId: this.remoteId, reason });
    this.reauthPromise = (async () => {
      await this.ensureAuth();
      await this.authenticate();
      this.emit("state", { state: "session_restored", remoteId: this.remoteId, reason });
      return true;
    })();
    try {
      return await this.reauthPromise;
    } finally {
      this.reauthPromise = null;
    }
  }

  async encodeSecure(payload) {
    const counter = ++this.txCounter;
    const cipher = await aesCtrCrypt(this.auth.key, this.sessionId, counter, 0, payload);
    const tag = await secureTag(this.auth.key, this.sessionId, counter, cipher);
    const writer = new MsgPackWriter(cipher.length + 96);
    writer.array(5);
    writer.uint(FRAME_SECURE);
    writer.uint(this.sessionId);
    writer.uint(counter);
    writer.bin(cipher);
    writer.bin(tag);
    return writer.bytes();
  }

  async decodeSecure(bytes) {
    const reader = new MsgPackReader(bytes);
    const count = reader.array();
    const frameType = reader.uint();
    if (count < 5 || frameType !== FRAME_SECURE) throw new Error("Bad MQTT secure frame");
    const sessionId = reader.uint();
    const counter = reader.uint();
    const cipher = reader.bin();
    const tag = reader.bin();
    if (!this.auth?.key) throw new Error("Invalid MQTT secure session: no key");
    if (sessionId !== this.sessionId) {
      const error = new Error(`Stale MQTT secure frame: session ${hexU32(sessionId)} != ${hexU32(this.sessionId)}`);
      error.staleSecureFrame = true;
      throw error;
    }
    if (counter <= this.rxCounter) {
      const error = new Error(`Stale MQTT secure frame: counter ${counter} <= ${this.rxCounter}`);
      error.staleSecureFrame = true;
      throw error;
    }
    const expected = await secureTag(this.auth.key, sessionId, counter, cipher);
    if (!constantTimeEqual(expected, tag)) throw new Error("Invalid MQTT secure signature");
    this.rxCounter = counter;
    return aesCtrCrypt(this.auth.key, sessionId, counter, 1, cipher);
  }

  setState(state, detail = {}) {
    this.emit("state", { state, ...detail });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function normalizeGuestKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeTopicPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function makeClientId(prefix = "w") {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `p1e-${prefix}-${suffix}`;
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

function hexHead(bytes, count = 12) {
  return Array.from(bytes.slice(0, Math.min(count, bytes.length)), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function isMsgPackUIntPrefix(byte) {
  return byte <= 0x7f || byte === 0xcc || byte === 0xcd || byte === 0xce;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authStorageKey(remoteId) {
  return `p1e.online.auth.${normalizeTopicPart(remoteId)}`;
}

function clientIdStorageKey(remoteId) {
  return `p1e.mqtt.browserId.${normalizeTopicPart(remoteId)}`;
}

function tabClientIdStorageKey(remoteId) {
  return `p1e.mqtt.tabId.${normalizeTopicPart(remoteId)}`;
}

function loadStoredClientId(remoteId) {
  const normalizedRemote = normalizeTopicPart(remoteId);
  try {
    let browserId = normalizeTopicPart(localStorage.getItem(clientIdStorageKey(normalizedRemote)));
    if (!browserId || browserId.length > 28) {
      browserId = makeClientId("b");
      localStorage.setItem(clientIdStorageKey(normalizedRemote), browserId);
    }
    let tabId = normalizeTopicPart(sessionStorage.getItem(tabClientIdStorageKey(normalizedRemote)));
    if (!tabId || tabId.length > 28) {
      tabId = makeClientId("t");
      sessionStorage.setItem(tabClientIdStorageKey(normalizedRemote), tabId);
    }
    return `${browserId}-${tabId}`;
  } catch {
    return makeClientId();
  }
}

function loadStoredAuth(remoteId) {
  try {
    const raw = localStorage.getItem(authStorageKey(remoteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username || !parsed?.keyHex) return null;
    return { username: String(parsed.username), keyHex: String(parsed.keyHex), key: hexToBytes(parsed.keyHex) };
  } catch {
    return null;
  }
}

export async function deriveOnlineAuthKeyHex(deviceId, username, password) {
  const text = `${normalizeTopicPart(deviceId)}:${String(username || "").trim()}:${String(password || "")}`;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(bytes));
}

export function storeOnlineAuthKey(remoteId, username, keyHex) {
  localStorage.setItem(authStorageKey(remoteId), JSON.stringify({ username: String(username || "").trim(), keyHex: String(keyHex || "").trim().toLowerCase() }));
}

export function clearOnlineAuthKey(remoteId) {
  localStorage.removeItem(authStorageKey(remoteId));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function hexToBytes(hex) {
  const text = String(hex || "").trim();
  if (text.length % 2) throw new Error("Invalid hex key");
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexU32(value) {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function u32be(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function secureCounter(sessionId, counter, direction) {
  const value = new Uint8Array(16);
  value[0] = (sessionId >>> 24) & 255;
  value[1] = (sessionId >>> 16) & 255;
  value[2] = (sessionId >>> 8) & 255;
  value[3] = sessionId & 255;
  value[4] = (counter >>> 16) & 255;
  value[5] = (counter >>> 8) & 255;
  value[6] = counter & 255;
  value[7] = direction & 255;
  return value;
}

async function aesCtrCrypt(keyBytes, sessionId, counter, direction, payload) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["encrypt", "decrypt"]);
  const result = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: secureCounter(sessionId, counter, direction), length: 64 },
    key,
    payload,
  );
  return new Uint8Array(result);
}

async function hmacSha256(keyBytes, chunks) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

function stringChunk(value) {
  const body = new TextEncoder().encode(String(value ?? ""));
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  return out;
}

function authProof(key, clientId, username, clientNonce, serverNonce) {
  return hmacSha256(key, [
    stringChunk("P1E-MQTT-AUTH-v1"),
    stringChunk(clientId),
    stringChunk(username),
    clientNonce,
    serverNonce,
  ]);
}

function isRejectedAuthError(error) {
  return Boolean(error?.authRejected)
    || /MQTT sign in failed: (auth_failed|unknown_user)/.test(String(error?.message || ""));
}

function secureTag(key, sessionId, counter, payload) {
  return hmacSha256(key, [
    stringChunk("P1E-MQTT-SECURE-v1"),
    u32be(sessionId),
    u32be(counter),
    payload,
  ]);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
