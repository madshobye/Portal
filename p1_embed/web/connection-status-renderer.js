export function createConnectionStatusRenderer({
  connection,
  getClient,
  getTransport,
  isBusy,
  getBusyLabel,
  connectionDeviceLabel,
  transportProtocolLabel,
  scriptStatusLabel,
  statusFpsLabel,
  wifiStatusLabel,
  memoryStatusLabel,
} = {}) {
  function render(transportState = "") {
    const client = getClient();
    const transport = getTransport();
    const transportOpen = Boolean(client && transport?.connected);
    const transportOnline = Boolean(transportOpen && transport?.verified);
    connection.classList.toggle("is-online", transportOnline);
    if (!client || (!transportOpen && !isBusy())) {
      connection.textContent = "not connected";
      return;
    }

    const parts = [connectionDeviceLabel(), transportProtocolLabel()];
    if (isBusy() && getBusyLabel()) {
      parts.push(getBusyLabel());
    } else {
      parts.push(scriptStatusLabel());
    }
    parts.push(statusFpsLabel());
    parts.push(wifiStatusLabel());
    parts.push(memoryStatusLabel());

    const state = transportState && !["connected", "connecting", "hub_open", "trying_device"].includes(transportState) ? transportState : "";
    if (state) parts.push(state);
    connection.textContent = parts.filter(Boolean).join(" | ");
  }

  return {
    render,
  };
}
