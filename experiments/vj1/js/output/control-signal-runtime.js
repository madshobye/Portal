const MIDI_RETRY_MS = 3000;
const AUDIO_RETRY_MS = 3000;
const OSC_RETRY_MS = 3000;
const OSC_MAX_PACKET_BYTES = 1024 * 1024;
const OSC_MAX_BUNDLE_DEPTH = 16;
const OSC_MAX_MESSAGES = 4096;

// Owns external control adapters independently from visual graphs. Control
// nodes resolve retained values through this object; permission, reconnect,
// browser resources, and wakeups remain host responsibilities.
export class ControlSignalRuntime {
  constructor({
    requestMidiAccess = defaultMidiAccessRequest,
    requestAudioStream = defaultAudioStreamRequest,
    createAudioContext = defaultAudioContextFactory,
    audioMediaDevices = defaultAudioMediaDevices(),
    createWebSocket = defaultWebSocketFactory,
    schedule = defaultSchedule,
    cancelSchedule = defaultCancelSchedule,
    onInvalidate = null,
    clock = runtimeMillis,
  } = {}) {
    this.adapters = new Map();
    this.onInvalidate = onInvalidate;
    this.revision = 0;
    this.register("midi", new MidiControlAdapter({
      requestAccess: requestMidiAccess,
      clock,
    }), { invalidate: false });
    this.register("audio", new AudioControlAdapter({
      requestStream: requestAudioStream,
      createContext: createAudioContext,
      mediaDevices: audioMediaDevices,
      clock,
    }), { invalidate: false });
    this.register("osc", new OscControlAdapter({
      createSocket: createWebSocket,
      schedule,
      cancelSchedule,
      clock,
    }), { invalidate: false });
  }

  register(kind, adapter, { invalidate = true } = {}) {
    const id = String(kind || "");
    if (!id || !adapter || typeof adapter.resolve !== "function") {
      throw new Error(`VJ1_CONTROL_SIGNAL_ADAPTER_INVALID:${id || "missing"}`);
    }
    this.adapters.get(id)?.dispose?.();
    adapter.setInvalidationHandler?.((reason) => {
      const cause = String(reason || "changed");
      this.invalidate(cause.startsWith(`${id}-`) ? cause : `${id}-${cause}`);
    });
    this.adapters.set(id, adapter);
    if (invalidate) this.invalidate(`${id}-adapter`);
    return adapter;
  }

  resolve(kind, address, options = {}) {
    return this.adapters.get(String(kind || ""))?.resolve(
      String(address || ""),
      options,
    );
  }

  status(kind, address = "", options = {}) {
    return this.adapters.get(String(kind || ""))?.status?.(
      String(address || ""),
      options,
    ) || {
      state: "unsupported",
      error: "",
    };
  }

  activate(kind, options = {}) {
    const adapter = this.adapters.get(String(kind || ""));
    adapter?.activate?.(options);
    adapter?.ensureAccess?.();
    return this.status(kind, "", options);
  }

  beginFrame() {
    for (const adapter of this.adapters.values()) adapter.beginFrame?.();
  }

  endFrame() {
    for (const adapter of this.adapters.values()) adapter.endFrame?.();
  }

  whenReady(kind, options = {}) {
    return this.adapters.get(String(kind || ""))?.whenReady?.(options) || Promise.resolve(null);
  }

  revisionFor(requirements = []) {
    const parts = [];
    const seen = new Set();
    for (const requirement of requirements || []) {
      if (requirement?.kind !== "control-signal") continue;
      const kind = String(requirement.signalKind || "");
      const address = String(requirement.address || "");
      const endpoint = String(requirement.endpoint || "");
      const key = endpoint
        ? `${kind}:${endpoint}:${address}`
        : `${kind}:${address}`;
      if (!kind || !address || seen.has(key)) continue;
      seen.add(key);
      const adapter = this.adapters.get(kind);
      if (!adapter) {
        parts.push(`${key}:unsupported@${this.revision}`);
        continue;
      }
      if (typeof adapter.revisionFor !== "function") return null;
      parts.push(`${key}:${String(adapter.revisionFor(address, requirement))}`);
    }
    return parts.sort().join("|");
  }

  invalidate(reason = "control-signal") {
    this.revision++;
    this.onInvalidate?.(reason);
  }

  dispose() {
    for (const adapter of this.adapters.values()) adapter.dispose?.();
    this.adapters.clear();
  }
}

export class MidiControlAdapter {
  constructor({
    requestAccess = defaultMidiAccessRequest,
    onInvalidate = null,
    clock = runtimeMillis,
    retryMs = MIDI_RETRY_MS,
  } = {}) {
    this.requestAccess = requestAccess;
    this.onInvalidate = onInvalidate;
    this.clock = clock;
    this.retryMs = Math.max(0, Number(retryMs) || 0);
    this.access = null;
    this.accessPromise = null;
    this.retryAt = 0;
    this.error = "";
    this.signals = new Map();
    this.sequence = 0;
    this.lifecycleRevision = 0;
    this.boundInputs = new Set();
    this.disposed = false;
    this.reportedError = "";
  }

  setInvalidationHandler(onInvalidate = null) {
    this.onInvalidate = onInvalidate;
  }

  resolve(address) {
    this.ensureAccess();
    return this.signals.get(String(address || ""));
  }

  status(address = "") {
    return {
      state: this.access
        ? "ready"
        : this.accessPromise
          ? "requesting"
          : this.error
            ? "error"
            : "idle",
      error: this.error,
      inputCount: this.boundInputs.size,
      signalAvailable: address ? this.signals.has(String(address)) : undefined,
    };
  }

  whenReady() {
    this.ensureAccess();
    return this.accessPromise || Promise.resolve(this.access);
  }

  revisionFor(address) {
    const signal = this.signals.get(String(address || ""));
    return `${this.lifecycleRevision || 0}.${signal?.sequence || 0}`;
  }

  ensureAccess() {
    if (this.disposed || this.access || this.accessPromise || this.clock() < this.retryAt) return;
    let requested;
    try {
      requested = this.requestAccess();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.accessPromise = Promise.resolve(requested)
      .then((access) => {
        if (this.disposed) {
          closeMidiAccess(access);
          return null;
        }
        if (!access?.inputs) throw new Error("MIDI access has no input registry");
        this.access = access;
        this.error = "";
        this.reportedError = "";
        this.lifecycleRevision++;
        access.onstatechange = () => this.reconcileInputs();
        this.reconcileInputs();
        this.onInvalidate?.("midi-ready");
        return access;
      })
      .catch((error) => {
        this.fail(error);
        return null;
      })
      .finally(() => {
        this.accessPromise = null;
      });
  }

  reconcileInputs() {
    if (!this.access) return;
    const current = new Set();
    for (const input of this.access.inputs.values()) {
      if (!input || input.state === "disconnected") continue;
      current.add(input);
      if (this.boundInputs.has(input)) continue;
      input.onmidimessage = (event) => this.receive(input, event);
      input.open?.().catch?.((error) => this.report("VJ1_MIDI_INPUT_OPEN_FAILED", error));
      this.boundInputs.add(input);
    }
    for (const input of this.boundInputs) {
      if (current.has(input)) continue;
      input.onmidimessage = null;
      input.close?.().catch?.(() => {});
      this.boundInputs.delete(input);
    }
    this.lifecycleRevision++;
    this.onInvalidate?.("midi-inputs");
  }

  receive(input, event) {
    const decoded = decodeMidiMessage(event?.data);
    if (!decoded) return;
    const sequence = ++this.sequence;
    const timestamp = Number(event?.receivedTime) || this.clock();
    this.publish(decoded.address, decoded.value, sequence, timestamp);
    const inputId = String(input?.id || "");
    if (inputId) {
      this.publish(`${inputId}/${decoded.address}`, decoded.value, sequence, timestamp);
    }
    this.onInvalidate?.("midi-signal");
  }

  publish(address, value, sequence, timestamp) {
    let signal = this.signals.get(address);
    if (!signal) {
      signal = { value: 0, sequence: 0, timestamp: 0 };
      this.signals.set(address, signal);
    }
    signal.value = value;
    signal.sequence = sequence;
    signal.timestamp = timestamp;
  }

  fail(error) {
    this.access = null;
    this.retryAt = this.clock() + this.retryMs;
    this.error = error?.message || String(error || "MIDI access failed");
    this.lifecycleRevision++;
    this.report("VJ1_MIDI_ACCESS_FAILED", error);
    this.onInvalidate?.("midi-error");
  }

  report(code, error) {
    const message = error?.message || String(error || this.error || "MIDI error");
    const signature = `${code}:${message}`;
    if (signature === this.reportedError) return;
    this.reportedError = signature;
    console.error(`[${code}]`, {
      message,
      retryMs: this.retryMs,
    });
  }

  dispose() {
    this.disposed = true;
    for (const input of this.boundInputs) {
      input.onmidimessage = null;
      input.close?.().catch?.(() => {});
    }
    this.boundInputs.clear();
    if (this.access) {
      this.access.onstatechange = null;
      closeMidiAccess(this.access);
    }
    this.access = null;
    this.signals.clear();
  }
}

export class AudioControlAdapter {
  constructor({
    requestStream = defaultAudioStreamRequest,
    createContext = defaultAudioContextFactory,
    mediaDevices = defaultAudioMediaDevices(),
    onInvalidate = null,
    clock = runtimeMillis,
    retryMs = AUDIO_RETRY_MS,
    fftSize = 1024,
  } = {}) {
    this.requestStream = requestStream;
    this.createContext = createContext;
    this.mediaDevices = mediaDevices;
    this.onInvalidate = onInvalidate;
    this.clock = clock;
    this.retryMs = Math.max(0, Number(retryMs) || 0);
    this.fftSize = normalizeAudioFftSize(fftSize);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.accessPromise = null;
    this.retryAt = 0;
    this.error = "";
    this.deviceId = "";
    this.signals = new Map();
    this.activeAddresses = new Set();
    this.sequence = 0;
    this.lifecycleRevision = 0;
    this.timeData = null;
    this.frequencyData = null;
    this.disposed = false;
    this.reportedError = "";
    this.boundDeviceChange = () => this.handleDeviceChange();
    this.mediaDevices?.addEventListener?.(
      "devicechange",
      this.boundDeviceChange,
    );
  }

  setInvalidationHandler(onInvalidate = null) {
    this.onInvalidate = onInvalidate;
  }

  resolve(address) {
    const id = String(address || "");
    if (id) this.activeAddresses.add(id);
    this.ensureAccess();
    return this.signals.get(id);
  }

  status(address = "") {
    return {
      state: this.analyser
        ? "ready"
        : this.accessPromise
          ? "requesting"
          : this.error
            ? "error"
            : "idle",
      error: this.error,
      inputCount: this.stream ? 1 : 0,
      deviceId: this.deviceId,
      signalAvailable: address
        ? this.signals.has(String(address))
        : undefined,
    };
  }

  revisionFor(address) {
    const signal = this.signals.get(String(address || ""));
    return `${this.lifecycleRevision}.${signal?.sequence || 0}`;
  }

  whenReady() {
    this.ensureAccess();
    return this.accessPromise || Promise.resolve(this.stream);
  }

  ensureAccess() {
    if (
      this.disposed ||
      this.analyser ||
      this.accessPromise ||
      this.clock() < this.retryAt
    ) return;
    let requested;
    try {
      requested = this.requestStream();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.accessPromise = Promise.resolve(requested)
      .then((stream) => this.attach(stream))
      .catch((error) => {
        this.fail(error);
        return null;
      })
      .finally(() => {
        this.accessPromise = null;
      });
  }

  async attach(stream) {
    if (this.disposed) {
      stopAudioStream(stream);
      return null;
    }
    let context = null;
    try {
      if (!stream?.getAudioTracks?.().length) {
        throw new Error("Audio capture returned no audio track");
      }
      context = this.createContext();
      if (!context?.createAnalyser || !context?.createMediaStreamSource) {
        throw new Error("Web Audio analysis is unavailable");
      }
      if (context.state === "suspended" && typeof context.resume === "function") {
        await context.resume();
      }
    } catch (error) {
      stopAudioStream(stream);
      closeAudioContext(context);
      throw error;
    }
    if (this.disposed) {
      stopAudioStream(stream);
      closeAudioContext(context);
      return null;
    }
    let analyser = null;
    let source = null;
    try {
      analyser = context.createAnalyser();
      analyser.fftSize = this.fftSize;
      analyser.smoothingTimeConstant = 0.65;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (error) {
      source?.disconnect?.();
      analyser?.disconnect?.();
      stopAudioStream(stream);
      closeAudioContext(context);
      throw error;
    }
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.timeData = new Uint8Array(analyser.fftSize);
    this.frequencyData = new Uint8Array(analyser.frequencyBinCount);
    const track = stream.getAudioTracks()[0];
    this.deviceId = String(track?.getSettings?.().deviceId || track?.id || "");
    for (const current of stream.getAudioTracks()) {
      current.onended = () => this.handleTrackEnded(current);
    }
    this.error = "";
    this.reportedError = "";
    this.lifecycleRevision++;
    this.onInvalidate?.("audio-ready");
    return stream;
  }

  beginFrame() {
    const analyser = this.analyser;
    if (!analyser || !this.timeData || !this.frequencyData) return;
    analyser.getByteTimeDomainData(this.timeData);
    analyser.getByteFrequencyData(this.frequencyData);
    const sequence = ++this.sequence;
    const timestamp = this.clock();
    let sumSquares = 0;
    let peak = 0;
    for (const sample of this.timeData) {
      const value = (sample - 128) / 128;
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const level = Math.min(
      1,
      Math.sqrt(sumSquares / Math.max(1, this.timeData.length)),
    );
    const core = {
      level,
      peak: Math.min(1, peak),
      low: this.bandValue(20, 250),
      mid: this.bandValue(250, 2000),
      high: this.bandValue(2000, this.context?.sampleRate / 2 || 24000),
    };
    for (const [address, value] of Object.entries(core)) {
      this.publish(address, value, sequence, timestamp);
      if (this.deviceId) {
        this.publish(
          `${this.deviceId}/${address}`,
          value,
          sequence,
          timestamp,
        );
      }
    }
    for (const address of this.activeAddresses) {
      const canonical = audioCanonicalAddress(address, this.deviceId);
      const bin = audioBinIndex(canonical);
      if (bin == null || bin >= this.frequencyData.length) continue;
      this.publish(
        address,
        this.frequencyData[bin] / 255,
        sequence,
        timestamp,
      );
    }
  }

  bandValue(minHz, maxHz) {
    const sampleRate = Math.max(1, Number(this.context?.sampleRate) || 48000);
    const nyquist = sampleRate / 2;
    const start = Math.max(
      0,
      Math.floor((Math.max(0, minHz) / nyquist) * this.frequencyData.length),
    );
    const end = Math.min(
      this.frequencyData.length,
      Math.max(start + 1, Math.ceil((Math.max(minHz, maxHz) / nyquist) * this.frequencyData.length)),
    );
    let total = 0;
    for (let index = start; index < end; index++) {
      total += this.frequencyData[index];
    }
    return Math.min(1, total / Math.max(1, end - start) / 255);
  }

  publish(address, value, sequence, timestamp) {
    let signal = this.signals.get(address);
    if (!signal) {
      signal = { value: 0, sequence: 0, timestamp: 0 };
      this.signals.set(address, signal);
    }
    signal.value = value;
    signal.sequence = sequence;
    signal.timestamp = timestamp;
  }

  handleTrackEnded(track) {
    if (this.disposed || !this.stream?.getAudioTracks?.().includes(track)) {
      return;
    }
    this.releaseCapture();
    this.retryAt = this.clock();
    this.lifecycleRevision++;
    this.onInvalidate?.("audio-ended");
    this.ensureAccess();
  }

  handleDeviceChange() {
    if (this.disposed) return;
    const tracks = this.stream?.getAudioTracks?.() || [];
    if (tracks.some((track) => track.readyState !== "ended")) return;
    this.releaseCapture();
    this.retryAt = this.clock();
    this.lifecycleRevision++;
    this.onInvalidate?.("audio-devices");
    this.ensureAccess();
  }

  fail(error) {
    this.releaseCapture();
    this.retryAt = this.clock() + this.retryMs;
    this.error = error?.message || String(error || "Audio access failed");
    this.lifecycleRevision++;
    this.report("VJ1_AUDIO_ACCESS_FAILED", error);
    this.onInvalidate?.("audio-error");
  }

  report(code, error) {
    const message = error?.message || String(error || this.error || "Audio error");
    const signature = `${code}:${message}`;
    if (signature === this.reportedError) return;
    this.reportedError = signature;
    console.error(`[${code}]`, {
      message,
      retryMs: this.retryMs,
    });
  }

  releaseCapture() {
    this.source?.disconnect?.();
    this.analyser?.disconnect?.();
    for (const track of this.stream?.getAudioTracks?.() || []) {
      track.onended = null;
    }
    stopAudioStream(this.stream);
    closeAudioContext(this.context);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.timeData = null;
    this.frequencyData = null;
    this.deviceId = "";
    this.signals.clear();
  }

  dispose() {
    this.disposed = true;
    this.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.boundDeviceChange,
    );
    this.releaseCapture();
    this.activeAddresses.clear();
  }
}

export class OscControlAdapter {
  constructor({
    createSocket = defaultWebSocketFactory,
    schedule = defaultSchedule,
    cancelSchedule = defaultCancelSchedule,
    onInvalidate = null,
    clock = runtimeMillis,
    retryMs = OSC_RETRY_MS,
  } = {}) {
    this.createSocket = createSocket;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
    this.onInvalidate = onInvalidate;
    this.clock = clock;
    this.retryMs = Math.max(0, Number(retryMs) || 0);
    this.connections = new Map();
    this.signals = new Map();
    this.sequence = 0;
    this.disposed = false;
    this.reportedErrors = new Set();
  }

  setInvalidationHandler(onInvalidate = null) {
    this.onInvalidate = onInvalidate;
  }

  activate(options = {}) {
    const endpoint = normalizeOscEndpoint(options.endpoint, {
      allowEmpty: true,
    });
    if (endpoint) this.ensureConnection(endpoint);
  }

  resolve(address, options = {}) {
    try {
      const endpoint = normalizeOscEndpoint(options.endpoint, {
        allowEmpty: true,
      });
      if (!endpoint) return undefined;
      const key = oscSignalKey(endpoint, address);
      this.ensureConnection(endpoint);
      return this.signals.get(key);
    } catch {
      return undefined;
    }
  }

  status(address = "", options = {}) {
    let endpoint = "";
    try {
      endpoint = normalizeOscEndpoint(options.endpoint, {
        allowEmpty: true,
      });
    } catch (error) {
      return {
        state: "error",
        error: error?.message || String(error),
        endpoint: String(options.endpoint || ""),
        signalAvailable: false,
      };
    }
    if (!endpoint) {
      return {
        state: "unconfigured",
        error: "OSC WebSocket endpoint is required",
        endpoint: "",
        signalAvailable: false,
      };
    }
    if (address) {
      try {
        validateOscAddress(address);
      } catch (error) {
        return {
          state: "error",
          error: error?.message || String(error),
          endpoint,
          signalAvailable: false,
        };
      }
    }
    const connection = this.connections.get(endpoint);
    return {
      state: connection?.state || "idle",
      error: connection?.error || "",
      endpoint,
      signalAvailable: address
        ? this.signals.has(oscSignalKey(endpoint, address))
        : undefined,
    };
  }

  revisionFor(address, options = {}) {
    let endpoint = "";
    try {
      endpoint = normalizeOscEndpoint(options.endpoint, {
        allowEmpty: true,
      });
    } catch {
      return "invalid-endpoint";
    }
    if (!endpoint) return "unconfigured";
    let key;
    try {
      key = oscSignalKey(endpoint, address);
    } catch {
      return "invalid-address";
    }
    const connection = this.connections.get(endpoint);
    const signal = this.signals.get(key);
    return `${connection?.lifecycleRevision || 0}.${signal?.sequence || 0}`;
  }

  whenReady(options = {}) {
    const endpoint = normalizeOscEndpoint(options.endpoint);
    const connection = this.ensureConnection(endpoint);
    if (connection.state === "ready") return Promise.resolve(connection);
    if (!connection.readyPromise) {
      connection.readyPromise = new Promise((resolve) => {
        connection.resolveReady = resolve;
      });
    }
    return connection.readyPromise;
  }

  ensureConnection(endpoint) {
    const id = normalizeOscEndpoint(endpoint);
    let connection = this.connections.get(id);
    if (!connection) {
      connection = {
        endpoint: id,
        socket: null,
        state: "idle",
        error: "",
        lifecycleRevision: 0,
        retryAt: 0,
        retryTimer: null,
        readyPromise: null,
        resolveReady: null,
      };
      this.connections.set(id, connection);
    }
    if (
      this.disposed ||
      connection.state === "ready" ||
      connection.state === "connecting" ||
      connection.retryTimer !== null
    ) {
      return connection;
    }
    const delay = Math.max(0, connection.retryAt - this.clock());
    if (delay > 0) {
      this.scheduleReconnect(connection, delay);
      return connection;
    }
    this.open(connection);
    return connection;
  }

  open(connection) {
    let socket;
    try {
      socket = this.createSocket(connection.endpoint);
      if (!socket) throw new Error("WebSocket factory returned no socket");
    } catch (error) {
      this.failConnection(connection, error);
      return;
    }
    connection.socket = socket;
    connection.state = "connecting";
    connection.error = "";
    try {
      socket.binaryType = "arraybuffer";
    } catch {}
    socket.onopen = () => {
      if (!this.isCurrent(connection, socket)) return;
      connection.state = "ready";
      connection.error = "";
      connection.retryAt = 0;
      connection.lifecycleRevision++;
      connection.resolveReady?.(connection);
      connection.readyPromise = null;
      connection.resolveReady = null;
      this.onInvalidate?.("osc-ready");
    };
    socket.onmessage = (event) => {
      if (!this.isCurrent(connection, socket)) return;
      this.receive(connection, event?.data);
    };
    socket.onerror = () => {
      if (!this.isCurrent(connection, socket)) return;
      connection.error = "OSC WebSocket transport error";
    };
    socket.onclose = (event) => {
      if (!this.isCurrent(connection, socket)) return;
      this.detachSocket(connection, socket);
      if (this.disposed) return;
      const suffix = event?.code
        ? ` (${event.code}${event.reason ? `: ${event.reason}` : ""})`
        : "";
      connection.state = "error";
      connection.error =
        connection.error || `OSC WebSocket disconnected${suffix}`;
      connection.lifecycleRevision++;
      connection.retryAt = this.clock() + this.retryMs;
      this.onInvalidate?.("osc-disconnected");
      this.scheduleReconnect(connection, this.retryMs);
    };
  }

  async receive(connection, payload) {
    let messages;
    try {
      messages = await decodeOscPayload(payload);
    } catch (error) {
      this.report("VJ1_OSC_MESSAGE_INVALID", error, connection.endpoint);
      return;
    }
    if (!messages.length || this.disposed) return;
    const timestamp = this.clock();
    for (const message of messages) {
      const sequence = ++this.sequence;
      this.publish(
        connection.endpoint,
        message.address,
        message.value,
        sequence,
        timestamp,
      );
    }
    this.onInvalidate?.("osc-signal");
  }

  publish(endpoint, address, value, sequence, timestamp) {
    const key = oscSignalKey(endpoint, address);
    let signal = this.signals.get(key);
    if (!signal) {
      signal = { value: 0, sequence: 0, timestamp: 0 };
      this.signals.set(key, signal);
    }
    signal.value = value;
    signal.sequence = sequence;
    signal.timestamp = timestamp;
  }

  failConnection(connection, error) {
    connection.state = "error";
    connection.error =
      error?.message || String(error || "OSC WebSocket connection failed");
    connection.lifecycleRevision++;
    connection.retryAt = this.clock() + this.retryMs;
    this.report("VJ1_OSC_CONNECTION_FAILED", error, connection.endpoint);
    this.onInvalidate?.("osc-error");
    this.scheduleReconnect(connection, this.retryMs);
  }

  scheduleReconnect(connection, delay) {
    if (this.disposed || connection.retryTimer !== null) return;
    connection.retryTimer = this.schedule(() => {
      connection.retryTimer = null;
      if (!this.disposed) this.ensureConnection(connection.endpoint);
    }, Math.max(0, Number(delay) || 0));
  }

  isCurrent(connection, socket) {
    return !this.disposed && connection.socket === socket;
  }

  detachSocket(connection, socket) {
    if (connection.socket !== socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    connection.socket = null;
  }

  report(code, error, endpoint) {
    const message = error?.message || String(error || "OSC error");
    const signature = `${code}:${endpoint}:${message}`;
    if (this.reportedErrors.has(signature)) return;
    this.reportedErrors.add(signature);
    console.error(`[${code}]`, { endpoint, message });
  }

  dispose() {
    this.disposed = true;
    for (const connection of this.connections.values()) {
      if (connection.retryTimer !== null) {
        this.cancelSchedule(connection.retryTimer);
        connection.retryTimer = null;
      }
      const socket = connection.socket;
      if (socket) {
        this.detachSocket(connection, socket);
        try {
          socket.close?.(1000, "VJ1 control runtime disposed");
        } catch {}
      }
      connection.resolveReady?.(null);
      connection.readyPromise = null;
      connection.resolveReady = null;
    }
    this.connections.clear();
    this.signals.clear();
    this.reportedErrors.clear();
  }
}

export function decodeMidiMessage(data) {
  if (!data || data.length < 2) return null;
  const status = Number(data[0]) || 0;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data1 = Number(data[1]) || 0;
  const data2 = Number(data[2]) || 0;
  if (command === 0xb0) {
    return { address: `${channel}:cc:${data1}`, value: normalize7Bit(data2) };
  }
  if (command === 0x90 || command === 0x80) {
    const velocity = command === 0x80 ? 0 : normalize7Bit(data2);
    return { address: `${channel}:note:${data1}`, value: velocity };
  }
  if (command === 0xe0) {
    return {
      address: `${channel}:pitch`,
      value: Math.max(0, Math.min(1, (data1 + data2 * 128) / 16383)),
    };
  }
  if (command === 0xd0) {
    return { address: `${channel}:pressure`, value: normalize7Bit(data1) };
  }
  return null;
}

export async function decodeOscPayload(payload) {
  if (typeof payload === "string") {
    if (payload.length > OSC_MAX_PACKET_BYTES) {
      throw new Error("OSC JSON payload exceeds the size limit");
    }
    return decodeOscJson(JSON.parse(payload));
  }
  if (typeof Blob !== "undefined" && payload instanceof Blob) {
    if (payload.size > OSC_MAX_PACKET_BYTES) {
      throw new Error("OSC packet exceeds the size limit");
    }
    return decodeOscPacket(await payload.arrayBuffer());
  }
  if (payload instanceof ArrayBuffer) return decodeOscPacket(payload);
  if (ArrayBuffer.isView(payload)) {
    return decodeOscPacket(
      payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
      ),
    );
  }
  if (payload && typeof payload === "object") return decodeOscJson(payload);
  throw new Error("OSC payload must be JSON text or binary OSC data");
}

export function decodeOscPacket(payload) {
  const buffer = payload instanceof ArrayBuffer
    ? payload
    : ArrayBuffer.isView(payload)
      ? payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        )
      : null;
  if (!buffer) throw new Error("OSC packet is not binary data");
  if (buffer.byteLength > OSC_MAX_PACKET_BYTES) {
    throw new Error("OSC packet exceeds the size limit");
  }
  return decodeOscPacketView(new DataView(buffer), 0, buffer.byteLength);
}

function normalize7Bit(value) {
  return Math.max(0, Math.min(1, (Number(value) || 0) / 127));
}

function decodeOscJson(value) {
  const records = Array.isArray(value) ? value : [value];
  const messages = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("OSC JSON message must be an object");
    }
    const address = validateOscAddress(record.address);
    const args = Array.isArray(record.args)
      ? record.args.map(unwrapOscJsonArgument)
      : "value" in record
        ? [unwrapOscJsonArgument(record.value)]
        : [];
    messages.push({
      address,
      value: oscArgumentsValue(args),
    });
  }
  return messages;
}

function unwrapOscJsonArgument(argument) {
  if (
    argument &&
    typeof argument === "object" &&
    !Array.isArray(argument) &&
    "value" in argument
  ) {
    return argument.value;
  }
  return argument;
}

function decodeOscPacketView(view, offset, limit, depth = 0) {
  if (depth > OSC_MAX_BUNDLE_DEPTH) {
    throw new Error("OSC bundle nesting exceeds the limit");
  }
  const first = readOscString(view, offset, limit);
  if (first.value === "#bundle") {
    let cursor = first.next;
    requireOscBytes(cursor, 8, limit);
    cursor += 8;
    const messages = [];
    while (cursor < limit) {
      requireOscBytes(cursor, 4, limit);
      const size = view.getUint32(cursor, false);
      cursor += 4;
      if (!size || cursor + size > limit) {
        throw new Error("OSC bundle element size is invalid");
      }
      messages.push(
        ...decodeOscPacketView(view, cursor, cursor + size, depth + 1),
      );
      if (messages.length > OSC_MAX_MESSAGES) {
        throw new Error("OSC bundle contains too many messages");
      }
      cursor += size;
    }
    return messages;
  }
  const address = validateOscAddress(first.value);
  const typeTags = readOscString(view, first.next, limit);
  if (!typeTags.value.startsWith(",")) {
    throw new Error("OSC type tag string is missing");
  }
  let cursor = typeTags.next;
  const args = [];
  for (const type of typeTags.value.slice(1)) {
    const decoded = readOscArgument(view, cursor, limit, type);
    cursor = decoded.next;
    if (decoded.include) args.push(decoded.value);
  }
  return [{
    address,
    value: oscArgumentsValue(args),
  }];
}

function readOscArgument(view, offset, limit, type) {
  if (type === "i") {
    requireOscBytes(offset, 4, limit);
    return { value: view.getInt32(offset, false), next: offset + 4, include: true };
  }
  if (type === "f") {
    requireOscBytes(offset, 4, limit);
    return { value: view.getFloat32(offset, false), next: offset + 4, include: true };
  }
  if (type === "d") {
    requireOscBytes(offset, 8, limit);
    return { value: view.getFloat64(offset, false), next: offset + 8, include: true };
  }
  if (type === "h") {
    requireOscBytes(offset, 8, limit);
    const value = typeof view.getBigInt64 === "function"
      ? Number(view.getBigInt64(offset, false))
      : view.getInt32(offset, false) * 2 ** 32 + view.getUint32(offset + 4, false);
    return { value, next: offset + 8, include: true };
  }
  if (type === "s" || type === "S") {
    const string = readOscString(view, offset, limit);
    return { value: string.value, next: string.next, include: true };
  }
  if (type === "b") {
    requireOscBytes(offset, 4, limit);
    const size = view.getUint32(offset, false);
    const start = offset + 4;
    requireOscBytes(start, size, limit);
    return {
      value: new Uint8Array(
        view.buffer.slice(
          view.byteOffset + start,
          view.byteOffset + start + size,
        ),
      ),
      next: alignOscOffset(start + size),
      include: true,
    };
  }
  if (type === "c" || type === "r" || type === "m") {
    requireOscBytes(offset, 4, limit);
    const raw = view.getUint32(offset, false);
    return {
      value: type === "c" ? String.fromCodePoint(raw) : raw,
      next: offset + 4,
      include: true,
    };
  }
  if (type === "t") {
    requireOscBytes(offset, 8, limit);
    return {
      value: [
        view.getUint32(offset, false),
        view.getUint32(offset + 4, false),
      ],
      next: offset + 8,
      include: true,
    };
  }
  if (type === "T") return { value: true, next: offset, include: true };
  if (type === "F") return { value: false, next: offset, include: true };
  if (type === "N") return { value: null, next: offset, include: true };
  if (type === "I") return { value: Infinity, next: offset, include: true };
  if (type === "[") return { value: null, next: offset, include: false };
  if (type === "]") return { value: null, next: offset, include: false };
  throw new Error(`OSC type tag is unsupported:${type}`);
}

function readOscString(view, offset, limit) {
  if (offset >= limit) throw new Error("OSC string exceeds packet");
  let end = offset;
  while (end < limit && view.getUint8(end) !== 0) end++;
  if (end >= limit) throw new Error("OSC string is not null terminated");
  const bytes = new Uint8Array(
    view.buffer,
    view.byteOffset + offset,
    end - offset,
  );
  return {
    value: new TextDecoder().decode(bytes),
    next: alignOscOffset(end + 1),
  };
}

function alignOscOffset(offset) {
  return (offset + 3) & ~3;
}

function requireOscBytes(offset, count, limit) {
  if (offset < 0 || count < 0 || offset + count > limit) {
    throw new Error("OSC packet is truncated");
  }
}

function validateOscAddress(address) {
  const value = String(address || "");
  if (!value.startsWith("/") || value.includes("\0")) {
    throw new Error(`OSC address is invalid:${value || "missing"}`);
  }
  return value;
}

function oscArgumentsValue(args) {
  if (!args.length) return 1;
  return args.length === 1 ? args[0] : args;
}

function oscSignalKey(endpoint, address) {
  return `${endpoint}\n${validateOscAddress(address)}`;
}

function normalizeOscEndpoint(endpoint, { allowEmpty = false } = {}) {
  const value = String(endpoint || "").trim();
  if (!value && allowEmpty) return "";
  if (!value) throw new Error("OSC WebSocket endpoint is required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OSC WebSocket endpoint is invalid:${value}`);
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`OSC endpoint must use ws or wss:${value}`);
  }
  if (url.username || url.password) {
    throw new Error("OSC endpoint credentials are not supported");
  }
  return url.href;
}

function defaultMidiAccessRequest() {
  if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
    throw new Error("Web MIDI is unavailable in this browser context");
  }
  return navigator.requestMIDIAccess({ sysex: false, software: true });
}

function defaultAudioStreamRequest() {
  const devices = defaultAudioMediaDevices();
  if (!devices?.getUserMedia) {
    throw new Error("Audio capture is unavailable in this browser context");
  }
  return devices.getUserMedia({
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    video: false,
  });
}

function defaultAudioContextFactory() {
  const AudioContextConstructor =
    globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Web Audio is unavailable in this browser context");
  }
  return new AudioContextConstructor({ latencyHint: "interactive" });
}

function defaultAudioMediaDevices() {
  return typeof navigator !== "undefined" ? navigator.mediaDevices || null : null;
}

function defaultWebSocketFactory(endpoint) {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is unavailable in this browser context");
  }
  return new WebSocket(endpoint);
}

function defaultSchedule(callback, delay) {
  return setTimeout(callback, delay);
}

function defaultCancelSchedule(timer) {
  clearTimeout(timer);
}

function closeMidiAccess(access) {
  for (const input of access?.inputs?.values?.() || []) {
    input.onmidimessage = null;
    input.close?.().catch?.(() => {});
  }
}

function stopAudioStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop?.();
}

function closeAudioContext(context) {
  if (!context || context.state === "closed") return;
  Promise.resolve(context.close?.()).catch(() => {});
}

function normalizeAudioFftSize(value) {
  const target = Math.max(32, Math.min(32768, Number(value) || 1024));
  return 2 ** Math.round(Math.log2(target));
}

function audioCanonicalAddress(address, deviceId) {
  const id = String(address || "");
  const prefix = deviceId ? `${deviceId}/` : "";
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function audioBinIndex(address) {
  const match = /^bin:(\d+)$/.exec(String(address || ""));
  return match ? Math.max(0, Number(match[1]) || 0) : null;
}

function runtimeMillis() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
