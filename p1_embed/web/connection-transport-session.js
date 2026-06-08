export function createConnectionTransportSession({
  ProtocolClient,
  canEncodeCommand,
  getClient,
  setClient,
  getTransport,
  setTransport,
  getGeneration,
  setGeneration,
  getConnectionVerified,
  setConnectionVerified,
  getSuppressConnectionLogs,
  setSuppressConnectionLogs,
  setBusy,
  setBusyLabel,
  getReconnectAfterReturn,
  setReconnectAfterReturn,
  getReconnectAfterReturnAttempted,
  setReconnectAfterReturnAttempted,
  isBusy,
  isUnloading,
  documentRef,
  markConnectionAttemptStarted,
  markConnectionAttemptFailed,
  setConnectionIntentWanted,
  connectionIntentWanted,
  clearConnectionUrlParams,
  closeConnectDialog,
  updateEnabledState,
  setConnected,
  renderConnectionState,
  stopStatusPolling,
  startStatusPolling,
  rememberActiveConnection,
  rememberSuccessfulConnection,
  startupRefresh,
  autoReconnectLastConnection,
  settle,
  logLine,
  logJson,
  acceptEvent,
  isBinaryTransportKind,
  isMqttKind,
  isDroppedTransportState,
  transportStateLogEntries,
} = {}) {
  const bumpGeneration = () => {
    const generation = getGeneration() + 1;
    setGeneration(generation);
    return generation;
  };

  async function connectTransport(nextTransport, options, kind, label, { quiet = false, lightStartup = false, includeScript = true, startupTimeoutMs = 15000, startupAttempts = 1, startupRetryDelayMs = 450, preserveUrl = false, busyLabelText = "connecting" } = {}) {
    const generation = bumpGeneration();
    setConnectionVerified(false);
    markConnectionAttemptStarted();
    setSuppressConnectionLogs(quiet);
    setBusy(true);
    setBusyLabel(busyLabelText);
    updateEnabledState();
    try {
      await disconnectTransport({ quiet: true, keepGeneration: true });
      setTransport(nextTransport);
      nextTransport.kind = kind;
      nextTransport.label = label;
      const nextClient = new ProtocolClient(nextTransport);
      setClient(nextClient);
      bindClient(nextClient);
      const ok = await nextTransport.connect(options);
      if (generation !== getGeneration()) {
        await nextTransport.disconnect?.();
        return false;
      }
      if (!ok) throw new Error(`${label} device was not available`);
      if (kind === "usb") {
        await enableUsbMsgPack(nextTransport);
        if (generation !== getGeneration()) {
          await nextTransport.disconnect?.();
          return false;
        }
      }
      closeConnectDialog();
      updateEnabledState();
      rememberActiveConnection(kind, options);
      if (!preserveUrl) clearConnectionUrlParams();
      if (!quiet && kind !== "usb") logLine("info", isBinaryTransportKind(kind) ? `Connected to ${label}` : `${label} connected`);

      if (lightStartup) await settle(450);
      if (generation !== getGeneration()) return false;
      const verified = await startupRefresh({
        quiet,
        includeScript,
        timeoutMs: startupTimeoutMs,
        attempts: startupAttempts,
        retryDelayMs: startupRetryDelayMs,
        expectedGeneration: generation,
      });
      if (generation === getGeneration() && verified) {
        setConnectionVerified(true);
        rememberSuccessfulConnection(kind, label, options);
        if (!quiet && kind === "usb") logLine("info", `${label} connected`);
        setConnected(true);
        startStatusPolling();
        return true;
      } else if (generation === getGeneration()) {
        if (!quiet) logLine("warn", `${label} connected but did not answer protocol checks`);
        markConnectionAttemptFailed();
        await disconnectTransport({ quiet: true, keepGeneration: true });
        setConnected(false);
        return false;
      }
    } catch (error) {
      if (generation !== getGeneration()) return false;
      if (!quiet) logLine("error", error.message);
      if (getTransport() === nextTransport) {
        await disconnectTransport({ quiet: true, keepGeneration: true });
      }
      markConnectionAttemptFailed();
      setConnected(false);
      return false;
    } finally {
      if (generation === getGeneration()) {
        setSuppressConnectionLogs(false);
        setBusy(false);
        setBusyLabel("");
        updateEnabledState();
      }
    }
    return false;
  }

  async function enableUsbMsgPack(nextTransport) {
    if (!nextTransport || typeof nextTransport.setMsgPackMode !== "function") return;
    if (!canEncodeCommand("protocol.mode")) throw new Error("No MessagePack opcode for protocol.mode");
    let response;
    try {
      response = await getClient().requestJson("protocol.mode", { mode: "msgpack" }, { timeoutMs: 5000 });
    } catch (error) {
      nextTransport.setMsgPackMode(true);
      try {
        response = await getClient().requestMsgPack("protocol.mode", { mode: "msgpack" }, { timeoutMs: 3000 });
        logLine("debug", "USB was already in binary mode");
      } catch {
        nextTransport.setMsgPackMode(false);
        throw error;
      }
    }
    const mode = String(response?.mode || "").toLowerCase();
    if (mode !== "msgpack") throw new Error(`USB refused MessagePack mode: ${mode || "unknown"}`);
    nextTransport.setMsgPackMode(true);
    logLine("debug", "USB binary channel open");
  }

  async function cancelConnectionAttempt() {
    bumpGeneration();
    setConnectionIntentWanted(false);
    clearConnectionUrlParams();
    try {
      await getTransport()?.disconnect?.();
    } finally {
      setClient(null);
      setTransport(null);
      setConnectionVerified(false);
      closeConnectDialog();
      stopStatusPolling();
      setSuppressConnectionLogs(false);
      setBusy(false);
      setBusyLabel("");
      setConnected(false);
      logLine("info", "connection cancelled");
      updateEnabledState();
    }
  }

  async function disconnectTransport({ quiet = false, keepGeneration = false } = {}) {
    if (!keepGeneration) bumpGeneration();
    if (!keepGeneration && !isUnloading()) {
      setConnectionIntentWanted(false);
      setReconnectAfterReturn(false);
      setReconnectAfterReturnAttempted(false);
    }
    try {
      getClient()?.dispose?.();
      await getTransport()?.disconnect();
    } finally {
      setClient(null);
      setTransport(null);
      setConnectionVerified(false);
      closeConnectDialog();
      stopStatusPolling();
      if (!quiet && !keepGeneration && !isUnloading()) clearConnectionUrlParams();
      if (!keepGeneration) {
        setBusy(false);
        setBusyLabel("");
        setSuppressConnectionLogs(false);
      }
      setConnected(false);
      if (!quiet) logLine("info", "disconnected");
    }
  }

  function bindClient(nextClient) {
    nextClient.addEventListener("state", (event) => {
      if (nextClient !== getClient()) return;
      logTransportState(event.detail);
      renderConnectionState(event.detail.state);
      if (event.detail.state === "connected") closeConnectDialog();
      if (isDroppedTransportState(event.detail.state) && !isUnloading()) {
        const shouldReconnect = getConnectionVerified() && connectionIntentWanted();
        handleTransportDropped(nextClient, { reconnectOnReturn: shouldReconnect });
      }
    });

    nextClient.addEventListener("message", (event) => {
      if (nextClient !== getClient()) return;
      logJson("trace", event.detail.message);
    });

    nextClient.addEventListener("event", (event) => {
      if (nextClient !== getClient()) return;
      acceptEvent(event.detail.event);
    });

    nextClient.addEventListener("raw", (event) => {
      if (nextClient !== getClient()) return;
      logJson("trace", event.detail.line);
    });

    nextClient.addEventListener("response", (event) => {
      if (nextClient !== getClient()) return;
      const response = event.detail.response || {};
      if (event.detail.late) {
        logLine("debug", `< late response id=${response.id ?? "?"}`);
      }
    });

    nextClient.addEventListener("error", (event) => {
      if (nextClient !== getClient()) return;
      if (getSuppressConnectionLogs()) return;
      logLine("error", event.detail.error?.message || "transport error");
    });
  }

  function logTransportState(detail = {}) {
    const activeTransport = getTransport();
    if (getSuppressConnectionLogs() || !isBinaryTransportKind(activeTransport?.kind)) return;
    const target = detail.remoteId || activeTransport?.remoteId || activeTransport?.label || "device";
    transportStateLogEntries(detail, { kind: activeTransport?.kind, target, isMqttKind }).forEach(([level, message]) => logLine(level, message));
  }

  function handleTransportDropped(droppedClient, { reconnectOnReturn = false } = {}) {
    if (droppedClient !== getClient()) return;
    const droppedTransport = droppedClient.transport;
    stopStatusPolling();
    droppedClient.dispose?.();
    setClient(null);
    setTransport(null);
    setConnectionVerified(false);
    setReconnectAfterReturn(Boolean(reconnectOnReturn));
    setReconnectAfterReturnAttempted(false);
    setBusy(false);
    setBusyLabel("");
    setSuppressConnectionLogs(false);
    setConnected(false);
    updateEnabledState();
    droppedTransport?.disconnect?.();
    maybeReconnectAfterReturn();
  }

  function maybeReconnectAfterReturn() {
    if (!getReconnectAfterReturn() || getReconnectAfterReturnAttempted()) return;
    if (documentRef.hidden || getClient() || isBusy()) return;
    if (!connectionIntentWanted()) return;
    setReconnectAfterReturn(false);
    setReconnectAfterReturnAttempted(true);
    autoReconnectLastConnection({ reconnecting: true }).catch((error) => {
      logLine("warn", `reconnect failed: ${error.message}`);
    });
  }

  return {
    bindClient,
    cancelConnectionAttempt,
    connectTransport,
    disconnectTransport,
    enableUsbMsgPack,
    handleTransportDropped,
    logTransportState,
    maybeReconnectAfterReturn,
  };
}
