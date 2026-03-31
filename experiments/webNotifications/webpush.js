class BrowserWebPushBridge {
  constructor({
    dbName = "portal-webnotifications-db",
    storeName = "kv",
    vapidSubject = "mailto:test@hobye.dk",
    proxyBase = "https://go.x2u.in/proxy?email=test@hobye.dk&apiKey=325a3cb5&url=",
    onEvent = null,
  } = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.vapidSubject = vapidSubject;
    this.proxyBase = proxyBase;
    this.onEvent = typeof onEvent === "function" ? onEvent : null;

    this.role = "idle";
    this.registration = null;
    this.subscription = null;
    this.keys = null;
    this.connected = false;

    this._onServiceWorkerMessage = (event) => this._handleServiceWorkerMessage(event.data);
  }

  async init() {
    if (!("serviceWorker" in navigator)) {
      this._emit("status", { text: "Service workers unsupported" });
      return;
    }

    this.registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    await navigator.serviceWorker.ready;
    navigator.serviceWorker.addEventListener("message", this._onServiceWorkerMessage);

    this.keys = await this._getOrCreateVapidKeys();
    this.subscription =
      (await this.registration.pushManager.getSubscription())?.toJSON?.() ||
      (await this._getStored("subscription"));

    if (this.subscription?.endpoint) {
      await this._setStored("subscription", this.subscription);
      this._emit("status", { text: "Service worker ready. Existing subscription found." });
    } else {
      this._emit("status", { text: "Service worker ready. Choose client or server." });
    }
  }

  connect(role) {
    this.role = role || "idle";
    this.connected = true;
    this._emit("status", { text: `Connected as ${this.role}` });
  }

  disconnect() {
    this.connected = false;
    this.role = "idle";
    this._emit("status", { text: "Disconnected" });
  }

  async requestNotificationPermission() {
    if (typeof Notification === "undefined") {
      this._emit("status", { text: "Notifications unsupported in this browser" });
      return "unsupported";
    }
    const permission = await Notification.requestPermission();
    this._emit("status", { text: `Notification permission: ${permission}` });
    return permission;
  }

  async subscribeClient() {
    if (this.role !== "client") {
      this._emit("status", { text: "Switch to client mode first" });
      return null;
    }
    if (!this.registration) {
      this._emit("status", { text: "Service worker not ready yet" });
      return null;
    }

    const permission = await this.requestNotificationPermission();
    if (permission !== "granted") {
      return null;
    }

    const existing = await this.registration.pushManager.getSubscription();
    if (existing) {
      this.subscription = existing.toJSON();
    } else {
      const publicKeyBytes = this._base64UrlToUint8(this.keys.publicKey);
      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKeyBytes,
      });
    }

    const json = typeof this.subscription.toJSON === "function"
      ? this.subscription.toJSON()
      : this.subscription;

    await this._setStored("subscription", json);
    this._emit("subscribed", { endpoint: json.endpoint });
    this._emit("status", { text: "Client subscribed for push trigger" });
    return json;
  }

  async sendTrigger() {
    if (this.role !== "server") {
      this._emit("status", { text: "Switch to server mode first" });
      return;
    }

    const subscription = (await this._getStored("subscription")) || this.subscription;
    if (!subscription?.endpoint) {
      this._emit("status", { text: "No client subscription available yet" });
      return;
    }

    this.subscription = subscription;

    try {
      const response = await this._sendPushRequest(subscription);
      this._emit("sent", { text: "Trigger sent" });
      this._emit("status", { text: `Push trigger sent (${response.status})` });
    } catch (error) {
      this._emit("status", {
        text: `Push failed: ${error?.message || error}`,
      });
    }
  }

  async clearSubscription() {
    if (this.registration) {
      const existing = await this.registration.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }
    }
    this.subscription = null;
    await this._setStored("subscription", null);
    this._emit("status", { text: "Subscription cleared" });
  }

  async _sendPushRequest(subscription) {
    const audience = new URL(subscription.endpoint).origin;
    const jwt = await this._createVapidJwt(audience, this.vapidSubject, this.keys.privateJwk);
    const headers = {
      TTL: "60",
      Authorization: `vapid t=${jwt}, k=${this.keys.publicKey}`,
      "Content-Length": "0",
    };

    try {
      const direct = await fetch(subscription.endpoint, {
        method: "POST",
        headers,
      });
      if (!direct.ok) {
        throw new Error(`Direct push failed (${direct.status})`);
      }
      return direct;
    } catch {
      const proxyUrl = this.proxyBase + encodeURIComponent(subscription.endpoint);
      const proxied = await fetch(proxyUrl, {
        method: "POST",
        headers,
      });
      if (!proxied.ok) {
        throw new Error(`Proxy push failed (${proxied.status})`);
      }
      return proxied;
    }
  }

  async _getOrCreateVapidKeys() {
    const existing = await this._getStored("vapidKeys");
    if (existing?.publicKey && existing?.privateJwk) {
      return existing;
    }

    const pair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"]
    );

    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const publicKey = this._publicJwkToVapidKey(publicJwk);

    const keys = { publicKey, privateJwk };
    await this._setStored("vapidKeys", keys);
    return keys;
  }

  async _createVapidJwt(audience, subject, privateJwk) {
    const header = { typ: "JWT", alg: "ES256" };
    const payload = {
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: subject,
    };

    const encodedHeader = this._base64UrlEncodeJson(header);
    const encodedPayload = this._base64UrlEncodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    );

    const joseSignature = this._ecdsaDerToJose(new Uint8Array(signature), 64);
    return `${signingInput}.${this._uint8ToBase64Url(joseSignature)}`;
  }

  _handleServiceWorkerMessage(data) {
    if (!data) return;
    if (data.type === "push-trigger") {
      this._emit("trigger", { text: data.text || "Push trigger received" });
    }
  }

  _openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async _getStored(key) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async _setStored(key, value) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  _publicJwkToVapidKey(jwk) {
    const x = this._base64UrlToUint8(jwk.x);
    const y = this._base64UrlToUint8(jwk.y);
    const out = new Uint8Array(65);
    out[0] = 0x04;
    out.set(x, 1);
    out.set(y, 33);
    return this._uint8ToBase64Url(out);
  }

  _base64UrlEncodeJson(value) {
    return this._uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  }

  _uint8ToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  _base64UrlToUint8(base64url) {
    const base64 = String(base64url).replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  _ecdsaDerToJose(signature, size) {
    if (signature[0] !== 0x30) {
      if (signature.length === size) return signature;
      throw new Error("Unexpected ECDSA signature format");
    }

    let offset = 2;
    if (signature[1] & 0x80) {
      offset = 2 + (signature[1] & 0x7f);
    }

    if (signature[offset] !== 0x02) {
      throw new Error("Invalid ECDSA DER signature");
    }
    const rLength = signature[offset + 1];
    const r = signature.slice(offset + 2, offset + 2 + rLength);
    offset = offset + 2 + rLength;

    if (signature[offset] !== 0x02) {
      throw new Error("Invalid ECDSA DER signature");
    }
    const sLength = signature[offset + 1];
    const s = signature.slice(offset + 2, offset + 2 + sLength);

    const out = new Uint8Array(size);
    out.set(r.slice(Math.max(0, r.length - size / 2)), size / 2 - Math.min(r.length, size / 2));
    out.set(s.slice(Math.max(0, s.length - size / 2)), size - Math.min(s.length, size / 2));
    return out;
  }

  _emit(type, detail) {
    if (this.onEvent) {
      this.onEvent({ type, ...detail });
    }
  }
}

window.BrowserWebPushBridge = BrowserWebPushBridge;
