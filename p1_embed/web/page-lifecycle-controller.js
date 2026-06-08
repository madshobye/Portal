export function createPageLifecycleController({
  windowRef,
  documentRef,
  writeCurrentRevisionDraft,
  isBusy,
  connectionIntentWanted,
  getClient,
  getTransport,
  isConnectionVerified,
  handleTransportDropped,
  maybeReconnectAfterReturn,
  setUnloading,
  setReconnectAfterReturn,
} = {}) {
  function bind() {
    windowRef.addEventListener("resize", updateViewportHeight);
    windowRef.addEventListener("orientationchange", updateViewportHeight);

    const markUnload = () => {
      writeCurrentRevisionDraft();
      setUnloading(true);
    };
    const markReturned = () => {
      setUnloading(false);
      updateViewportHeight();
      recoverReturnedConnection();
    };
    const markVisible = () => {
      updateViewportHeight();
      if (!documentRef.hidden) recoverReturnedConnection();
    };
    windowRef.addEventListener("beforeunload", markUnload);
    windowRef.addEventListener("pagehide", markUnload);
    windowRef.addEventListener("pageshow", markReturned);
    windowRef.addEventListener("focus", markVisible);
    windowRef.addEventListener("online", markVisible);
    documentRef.addEventListener("visibilitychange", markVisible);
  }

  function updateViewportHeight() {
    const height = Math.max(320, Math.floor(windowRef.innerHeight || documentRef.documentElement.clientHeight || 0));
    documentRef.documentElement.style.setProperty("--app-height", `${height}px`);
  }

  function recoverReturnedConnection() {
    if (isBusy()) return;
    if (!connectionIntentWanted()) return;
    const client = getClient();
    const transport = getTransport();
    if (client && (!transport?.connected || !isConnectionVerified())) {
      handleTransportDropped(client, { reconnectOnReturn: true });
      return;
    }
    if (!client && !isBusy()) setReconnectAfterReturn(true);
    maybeReconnectAfterReturn();
  }

  return {
    bind,
    recoverReturnedConnection,
    updateViewportHeight,
  };
}
