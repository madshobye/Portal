export function createConnectionDialogStateController({
  navigatorRef,
  getTransport,
  normalizePeerId,
  pickPortFromHint,
  readUsbHint,
  usbHintLabel,
  currentDeviceDisplayName,
  historyActions,
  renderConnectionHistory,
  logLine,
} = {}) {
  let knownUsbPortCount = 0;
  let knownUsbLabel = "";

  function connectionHistoryDisplayLabel(item) {
    if (!item) return "";
    if (item.kind === "usb") return item.label || "USB";
    const transport = getTransport();
    const activeRemote = normalizePeerId(transport?.remoteId || "");
    const itemRemote = normalizePeerId(item.peerId || "");
    const friendly = currentDeviceDisplayName();
    if (friendly && itemRemote && itemRemote === activeRemote) return friendly;
    return item.label || item.peerId || item.url || "";
  }

  function forgetConnectionHistoryItem(item) {
    historyActions.forgetConnectionHistoryItem(item);
    renderConnectionHistory();
    logLine("info", "removed recent connection");
  }

  async function refreshKnownUsbPorts() {
    if (!("serial" in navigatorRef)) {
      clearKnownUsbPorts();
      renderConnectionHistory();
      return;
    }
    try {
      const ports = await navigatorRef.serial.getPorts();
      knownUsbPortCount = ports.length;
      const hinted = pickPortFromHint(ports, readUsbHint());
      const port = hinted || ports[0] || null;
      knownUsbLabel = port ? usbHintLabel(port.getInfo?.() || {}) : "";
    } catch {
      clearKnownUsbPorts();
    }
    renderConnectionHistory();
  }

  function clearKnownUsbPorts() {
    knownUsbPortCount = 0;
    knownUsbLabel = "";
  }

  return {
    connectionHistoryDisplayLabel,
    forgetConnectionHistoryItem,
    refreshKnownUsbPorts,
  };
}
