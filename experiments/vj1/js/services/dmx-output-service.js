import {
  dmxFixtureProfile,
  dmxUniverseLength,
  normalizeDmxDeviceSettings,
  writeDmxFixtureValues,
} from "../libraries/dmx-engine/index.js";

export function createDmxOutputService({
  navigatorRef = globalThis.navigator,
  storage = globalThis.localStorage,
  clock = () => globalThis.performance?.now?.() ?? Date.now(),
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
  onStatus = null,
} = {}) {
  let settings = normalizeDmxDeviceSettings();
  let projectBlackout = false;
  let state = navigatorRef?.serial ? "ready" : "unsupported";
  let error = "";
  let port = null;
  let writer = null;
  let connecting = null;
  let timer = 0;
  let sending = false;
  let pending = false;
  let authoredSettingsRef = null;
  let authoredBlackout = null;
  let frame = new Uint8Array(1);
  let transmittedFrames = 0;
  let cadenceStartedAt = 0;
  let lastFrameAt = 0;
  let lastFrameInterval = 0;
  const probeContributions = new Map();
  let contributionSequence = 0;
  const testChannels = new Map();
  const listeners = new Set();
  if (typeof onStatus === "function") listeners.add(onStatus);

  const serialDisconnect = async (event) => {
    if (port && event?.port && event.port !== port) return;
    await closePort("disconnected");
    emit();
  };
  navigatorRef?.serial?.addEventListener?.("disconnect", serialDisconnect);

  function snapshot() {
    const elapsed = Math.max(0, clock() - cadenceStartedAt);
    return Object.freeze({
      state,
      error,
      connected: !!writer,
      enabled: settings.enabled,
      refreshRate: settings.refreshRate,
      universeLength: frame.length,
      transmittedFrames,
      actualRefreshRate: elapsed > 0 ? transmittedFrames * 1000 / elapsed : 0,
      lastFrameInterval,
      portInfo: port?.getInfo?.() || null,
    });
  }

  function emit() {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function syncState(nextState = {}) {
    const nextSettingsRef = nextState?.devices?.dmx || null;
    const nextBlackout = nextState?.global?.blackout === true;
    if (
      nextSettingsRef === authoredSettingsRef &&
      nextBlackout === authoredBlackout
    ) return;
    authoredSettingsRef = nextSettingsRef;
    authoredBlackout = nextBlackout;
    const nextSettings = normalizeDmxDeviceSettings(nextSettingsRef);
    const previousRate = settings.refreshRate;
    settings = nextSettings;
    projectBlackout = nextBlackout;
    const length = dmxUniverseLength(settings);
    if (frame.length !== length) frame = new Uint8Array(length);
    rebuildFrame();
    if (previousRate !== settings.refreshRate && timer) restartTimer();
    if (!settings.enabled) stopTimer();
    else if (writer) startTimer();
    else void tryReconnectKnown();
    emit();
  }

  async function connect() {
    if (!navigatorRef?.serial) {
      fail(new Error("Web Serial is unavailable. Use the current Chrome desktop browser."));
      return false;
    }
    const selected = await navigatorRef.serial.requestPort();
    rememberPort(selected);
    return openPort(selected, "picker");
  }

  async function tryReconnectKnown() {
    if (!settings.enabled || writer || connecting || !navigatorRef?.serial?.getPorts) return false;
    try {
      const ports = await navigatorRef.serial.getPorts();
      if (!ports?.length) return false;
      const hint = loadPortHint();
      const selected = ports.find((candidate) => samePortHint(candidate, hint)) || ports[0];
      return selected ? openPort(selected, "known") : false;
    } catch (caught) {
      fail(caught);
      return false;
    }
  }

  async function openPort(selected, source = "known") {
    if (!selected) return false;
    if (connecting) return connecting;
    connecting = (async () => {
      state = source === "picker" ? "requesting" : "reconnecting";
      error = "";
      emit();
      await closePort("");
      port = selected;
      await port.open({
        baudRate: 250000,
        dataBits: 8,
        stopBits: 2,
        parity: "none",
        flowControl: "none",
        bufferSize: 1024,
      });
      writer = port.writable?.getWriter?.() || null;
      if (!writer) throw new Error("The selected serial device has no writable stream.");
      rememberPort(port);
      state = "connected";
      transmittedFrames = 0;
      cadenceStartedAt = clock();
      lastFrameAt = 0;
      startTimer();
      if (!(await sendFrame())) return false;
      emit();
      return true;
    })();
    try {
      return await connecting;
    } catch (caught) {
      fail(caught);
      await closePort("error");
      return false;
    } finally {
      connecting = null;
    }
  }

  async function disconnect() {
    await closePort("disconnected");
    emit();
  }

  async function closePort(nextState = "disconnected") {
    stopTimer();
    pending = false;
    try {
      writer?.releaseLock?.();
    } catch {}
    writer = null;
    const closing = port;
    port = null;
    try {
      await closing?.close?.();
    } catch (caught) {
      console.warn("[VJ1_DMX_CLOSE_FAILED]", {
        message: caught?.message || String(caught),
      });
    }
    if (nextState) state = nextState;
  }

  function receiveProbe({ fixtureId = "", values = {}, source = {}, release = false } = {}) {
    if (!fixtureId) return false;
    const key = probeContributionKey(fixtureId, source);
    if (release) probeContributions.delete(key);
    else probeContributions.set(key, {
      fixtureId: String(fixtureId),
      values: { ...values },
      priority: dmxSourcePriority(source),
      sequence: ++contributionSequence,
      source: { ...source },
    });
    rebuildFrame();
    return true;
  }

  function releaseProbeSources(source = {}) {
    let changed = false;
    for (const [key, contribution] of probeContributions) {
      if (!dmxSourceMatches(contribution.source, source)) continue;
      probeContributions.delete(key);
      changed = true;
    }
    if (changed) rebuildFrame();
    return changed;
  }

  function setTestChannel(channelNumber, unitValue) {
    const channel = Math.round(Number(channelNumber));
    if (channel < 1 || channel > 512) return false;
    if (unitValue === null || unitValue === undefined) testChannels.delete(channel);
    else testChannels.set(channel, clamp01(unitValue));
    rebuildFrame();
    return true;
  }

  function clearTestChannels() {
    testChannels.clear();
    rebuildFrame();
  }

  function rebuildFrame() {
    frame.fill(0);
    const fixtureValues = mergedProbeFixtureValues(probeContributions);
    for (const fixture of settings.fixtures) {
      const { profile } = dmxFixtureProfile(settings, fixture.id);
      if (!profile) continue;
      writeDmxFixtureValues(
        frame,
        fixture,
        profile,
        fixtureValues.get(fixture.id) || {},
        projectBlackout,
      );
    }
    if (!projectBlackout) {
      for (const [channel, value] of testChannels) {
        if (channel <= frame.length) frame[channel - 1] = Math.round(value * 255);
      }
    }
  }

  function startTimer() {
    if (timer || !writer || !settings.enabled || typeof setIntervalFn !== "function") return;
    const interval = Math.max(25, Math.round(1000 / settings.refreshRate));
    timer = setIntervalFn(() => void sendFrame(), interval);
  }

  function stopTimer() {
    if (!timer) return;
    clearIntervalFn?.(timer);
    timer = 0;
  }

  function restartTimer() {
    stopTimer();
    startTimer();
  }

  async function sendFrame() {
    if (!writer || !port || !settings.enabled) return false;
    if (sending) {
      pending = true;
      return false;
    }
    sending = true;
    try {
      await port.setSignals({ break: true });
      await delay(1);
      await port.setSignals({ break: false });
      const payload = new Uint8Array(frame.length + 1);
      payload[0] = 0;
      payload.set(frame, 1);
      await writer.write(payload);
      const now = clock();
      lastFrameInterval = lastFrameAt ? now - lastFrameAt : 0;
      lastFrameAt = now;
      transmittedFrames += 1;
      if (transmittedFrames % 20 === 0) emit();
      return true;
    } catch (caught) {
      fail(caught);
      await closePort("error");
      emit();
      return false;
    } finally {
      sending = false;
      if (pending) {
        pending = false;
        void sendFrame();
      }
    }
  }

  function fail(caught) {
    error = caught?.message || String(caught || "Unknown DMX error");
    state = "error";
    console.error("[VJ1_DMX_OUTPUT_FAILED]", {
      message: error,
      fallback: "retain the last authored fixture values and wait for an explicit reconnect",
    });
    emit();
  }

  function rememberPort(selected) {
    try {
      storage?.setItem?.("vj1.dmx.port", JSON.stringify(selected?.getInfo?.() || {}));
    } catch {}
  }

  function loadPortHint() {
    try {
      return JSON.parse(storage?.getItem?.("vj1.dmx.port") || "null");
    } catch {
      return null;
    }
  }

  function dispose() {
    navigatorRef?.serial?.removeEventListener?.("disconnect", serialDisconnect);
    listeners.clear();
    void closePort("disposed");
  }

  return {
    clearTestChannels,
    connect,
    disconnect,
    dispose,
    receiveProbe,
    releaseProbeSources,
    sendFrame,
    setTestChannel,
    snapshot,
    subscribe,
    syncState,
    tryReconnectKnown,
  };
}

function mergedProbeFixtureValues(contributions) {
  const selected = new Map();
  for (const contribution of contributions.values()) {
    for (const [channelId, value] of Object.entries(contribution.values || {})) {
      const key = `${contribution.fixtureId}:${channelId}`;
      const current = selected.get(key);
      if (
        current &&
        (current.priority > contribution.priority ||
          (current.priority === contribution.priority && current.sequence > contribution.sequence))
      ) continue;
      selected.set(key, {
        fixtureId: contribution.fixtureId,
        channelId,
        value,
        priority: contribution.priority,
        sequence: contribution.sequence,
      });
    }
  }
  const result = new Map();
  for (const entry of selected.values()) {
    const values = result.get(entry.fixtureId) || {};
    values[entry.channelId] = entry.value;
    result.set(entry.fixtureId, values);
  }
  return result;
}

function probeContributionKey(fixtureId, source = {}) {
  const rendererId = String(source.rendererId || source.outputId || source.mode || "legacy");
  const componentId = String(source.componentId || "");
  const probeId = String(source.probeId || "");
  return `${rendererId}:${componentId}:${probeId}:${fixtureId}`;
}

function dmxSourcePriority(source = {}) {
  return String(source.mode || "") === "output" ? 2 : 1;
}

function dmxSourceMatches(candidate = {}, requested = {}) {
  const keys = ["rendererId", "mode", "outputId", "componentId", "probeId"]
    .filter((key) => requested[key] !== undefined && requested[key] !== "");
  return keys.length > 0 && keys.every((key) => String(candidate[key] || "") === String(requested[key]));
}

function samePortHint(port, hint) {
  if (!hint) return false;
  const info = port?.getInfo?.() || {};
  return Number(info.usbVendorId) === Number(hint.usbVendorId)
    && Number(info.usbProductId) === Number(hint.usbProductId);
}

function clamp01(value) {
  const number = Number(value);
  return Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0));
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
