/************* Singleton loader for PeerJS *************/
let __peerJsLoaderPromise = null;

function loadPeerJsScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensurePeerJsOnce() {
  if (__peerJsLoaderPromise) return __peerJsLoaderPromise;
  __peerJsLoaderPromise = (async () => {
    if (!window.Peer) {
      console.log("[PortalPeerJs] Loading PeerJS...");
      await loadPeerJsScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
      console.log("[PortalPeerJs] PeerJS loaded.");
    } else {
      console.log("[PortalPeerJs] PeerJS already present.");
    }
  })();
  return __peerJsLoaderPromise;
}

class PortalPeerJs {
  constructor({
    peerId = null,
    options = {},
    singleConnection = true,
    onOpen = null,
    onConnection = null,
    onData = null,
    onClose = null,
    onError = null,
  } = {}) {
    this.peerId = peerId || null;
    this.options = { ...options };
    this.singleConnection = !!singleConnection;

    this._onOpen = typeof onOpen === "function" ? onOpen : null;
    this._onConnection = typeof onConnection === "function" ? onConnection : null;
    this._onData = typeof onData === "function" ? onData : null;
    this._onClose = typeof onClose === "function" ? onClose : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.peer = null;
    this.ready = false;
    this.open = false;

    this.connections = new Map();
    this.conn = null;

    this._hasResult = false;
    this._hasNew = false;
    this._lastData = null;
  }

  async init() {
    await ensurePeerJsOnce();
    this.peer = new window.Peer(this.peerId, this.options);
    this._bindPeerEvents();
    this.ready = true;
    return this;
  }

  _bindPeerEvents() {
    if (!this.peer) return;

    this.peer.on("open", (id) => {
      this.open = true;
      this.peerId = id;
      if (this._onOpen) {
        try {
          this._onOpen(id);
        } catch (e) {
          console.warn("[PortalPeerJs] onOpen callback error:", e);
        }
      }
    });

    this.peer.on("connection", (conn) => {
      if (this.singleConnection && this.conn && this.conn.open && this.conn.peer !== conn.peer) {
        conn.on("open", () => {
          try {
            conn.send("Already connected");
          } catch {}
          try {
            conn.close();
          } catch {}
        });
        return;
      }
      this._attachConnection(conn);
    });

    this.peer.on("error", (err) => {
      if (this._onError) {
        try {
          this._onError(err);
        } catch (e) {
          console.warn("[PortalPeerJs] onError callback error:", e);
        }
      } else {
        console.warn("[PortalPeerJs] Peer error:", err);
      }
    });

    this.peer.on("close", () => {
      this.open = false;
    });
  }

  _attachConnection(conn) {
    if (!conn || typeof conn.on !== "function") {
      throw new Error("PortalPeerJs: invalid connection object");
    }
    this.connections.set(conn.peer, conn);
    this.conn = conn;

    conn.on("open", () => {
      if (this._onConnection) {
        try {
          this._onConnection(conn);
        } catch (e) {
          console.warn("[PortalPeerJs] onConnection callback error:", e);
        }
      }
    });

    conn.on("data", (data) => {
      this._lastData = {
        peer: conn.peer,
        data,
        timestamp: Date.now(),
      };
      this._hasResult = true;
      this._hasNew = true;

      if (this._onData) {
        try {
          this._onData(data, conn);
        } catch (e) {
          console.warn("[PortalPeerJs] onData callback error:", e);
        }
      }
    });

    conn.on("close", () => {
      this.connections.delete(conn.peer);
      if (this.conn === conn) {
        this.conn = null;
      }
      if (this._onClose) {
        try {
          this._onClose(conn);
        } catch (e) {
          console.warn("[PortalPeerJs] onClose callback error:", e);
        }
      }
    });

    conn.on("error", (err) => {
      if (this._onError) {
        try {
          this._onError(err, conn);
        } catch (e) {
          console.warn("[PortalPeerJs] onError callback error:", e);
        }
      } else {
        console.warn("[PortalPeerJs] Connection error:", err);
      }
    });
  }

  async connect(targetPeerId, options = {}) {
    if (!this.ready || !this.peer) {
      throw new Error("PortalPeerJs.connect(): call await init() first");
    }
    if (!targetPeerId) {
      throw new Error("PortalPeerJs.connect(targetPeerId): targetPeerId is required");
    }
    if (!this.open) {
      await new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup();
          resolve(true);
        };
        const onError = (err) => {
          cleanup();
          reject(err || new Error("PeerJS did not open"));
        };
        const cleanup = () => {
          this.peer?.off?.("open", onOpen);
          this.peer?.off?.("error", onError);
        };
        this.peer?.on?.("open", onOpen);
        this.peer?.on?.("error", onError);
      });
    }

    const conn = this.peer.connect(targetPeerId, options);
    if (!conn) {
      throw new Error(`PeerJS could not create a connection to ${targetPeerId}`);
    }
    this._attachConnection(conn);

    return await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve(conn);
      };
      const onError = (err) => {
        cleanup();
        reject(err || new Error("PeerJS connect failed"));
      };
      const cleanup = () => {
        conn.off?.("open", onOpen);
        conn.off?.("error", onError);
      };

      conn.on("open", onOpen);
      conn.on("error", onError);
    });
  }

  send(data, peerId = null) {
    const conn = peerId ? this.connections.get(peerId) : this.conn;
    if (!conn || !conn.open) return false;
    conn.send(data);
    return true;
  }

  isConnected(peerId = null) {
    const conn = peerId ? this.connections.get(peerId) : this.conn;
    return !!(conn && conn.open);
  }

  getConnection(peerId = null) {
    return peerId ? this.connections.get(peerId) || null : this.conn;
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }

  resetNewFlag() {
    this._hasNew = false;
  }

  getResult() {
    return this._lastData;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._lastData };
  }

  closeConnection(peerId = null) {
    const conn = peerId ? this.connections.get(peerId) : this.conn;
    if (!conn) return;
    try {
      conn.close();
    } catch {}
  }

  disconnect() {
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {}
    }
    this.connections.clear();
    this.conn = null;
  }

  destroy() {
    this.disconnect();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {}
    }
    this.peer = null;
    this.ready = false;
    this.open = false;
  }
}
