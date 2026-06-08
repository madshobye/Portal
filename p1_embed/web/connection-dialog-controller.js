export function createConnectionDialogController({
  dialog,
  historyList,
  usbConnect,
  peerToggle,
  websocketToggle,
  peerField,
  peerConnect,
  peerInput,
  websocketField,
  websocketConnect,
  websocketInput,
  readHistoryItems,
  isKindAvailable,
  kindLabel,
  kindIcon,
  displayLabel,
  isMqttKind,
  isWebRtcKind,
  isBusy,
  hasClient,
  onRefreshUsbPorts,
  onConnectUsb,
  onConnectMqtt,
  onConnectWebRtc,
  onConnectWebSocket,
  onForgetItem,
  logLine,
} = {}) {
  let historyPending = false;

  async function open() {
    renderHistory();
    await onRefreshUsbPorts?.();
    renderOptions();
    hideNewFields();
    dialog.showModal();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function renderOptions() {
    usbConnect.classList.toggle("is-hidden", !isKindAvailable("usb"));
    peerToggle.classList.toggle("is-hidden", !isKindAvailable("mqtt"));
    websocketToggle.classList.toggle("is-hidden", !isKindAvailable("websocket"));
  }

  function hideNewFields() {
    websocketField.classList.add("is-hidden");
    websocketConnect.classList.add("is-hidden");
    peerField.classList.add("is-hidden");
    peerConnect.classList.add("is-hidden");
  }

  function showWebSocketField() {
    peerField.classList.add("is-hidden");
    peerConnect.classList.add("is-hidden");
    websocketField.classList.remove("is-hidden");
    websocketConnect.classList.remove("is-hidden");
    websocketInput.focus();
    websocketInput.select();
  }

  function showPeerField() {
    websocketField.classList.add("is-hidden");
    websocketConnect.classList.add("is-hidden");
    peerField.classList.remove("is-hidden");
    peerConnect.classList.remove("is-hidden");
    peerInput.focus();
    peerInput.select();
  }

  function renderHistory() {
    const items = readHistoryItems()
      .filter((item) => isKindAvailable(item.kind))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    historyList.replaceChildren();
    historyList.classList.toggle("is-hidden", items.length === 0);

    items.forEach((item) => {
      historyList.append(renderHistoryItem(item));
    });
  }

  function renderHistoryItem(item) {
    const itemLabel = displayLabel(item);
    const row = document.createElement("div");
    row.className = "connection-history-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button suggestion-button";
    button.title = historyTitle(item, itemLabel);
    button.setAttribute("aria-label", button.title);
    button.disabled = hasClient() || isBusy() || historyPending;

    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = kindIcon(item.kind);
    const label = document.createElement("span");
    label.textContent = item.kind === "usb" ? `USB ${itemLabel}` : itemLabel;
    button.append(icon, label);
    button.addEventListener("click", () => {
      void connectHistoryItem(item);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "connection-history-remove icon-button";
    remove.title = `Remove ${itemLabel}`;
    remove.setAttribute("aria-label", remove.title);
    remove.disabled = isBusy() || historyPending;
    const removeIcon = document.createElement("span");
    removeIcon.className = "material-symbols-rounded";
    removeIcon.textContent = "close";
    remove.append(removeIcon);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      onForgetItem(item);
    });

    row.append(button, remove);
    return row;
  }

  async function connectHistoryItem(item) {
    if (hasClient() || isBusy() || historyPending) return;
    historyPending = true;
    renderHistory();
    try {
      if (item.kind === "usb") {
        await onConnectUsb(item.hint);
      } else if (isMqttKind(item.kind)) {
        await onConnectMqtt(item.peerId, item.mqtt);
      } else if (isWebRtcKind(item.kind)) {
        await onConnectWebRtc(item.peerId);
      } else {
        await onConnectWebSocket(item.url);
      }
    } catch (error) {
      logLine?.("error", error?.message || "connection failed");
    } finally {
      historyPending = false;
      renderHistory();
    }
  }

  function historyTitle(item, itemLabel) {
    const type = kindLabel(item.kind);
    const detail = item.kind === "websocket" ? item.url : item.kind === "usb" ? item.label : item.peerId;
    return detail && detail !== itemLabel ? `${type}: ${itemLabel} (${detail})` : `${type}: ${itemLabel}`;
  }

  return {
    close,
    open,
    renderHistory,
    renderOptions,
    showPeerField,
    showWebSocketField,
  };
}
