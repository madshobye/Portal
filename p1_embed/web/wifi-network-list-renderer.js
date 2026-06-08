export function createWifiNetworkListRenderer({ list, isDeviceConnected, isBusy, onForget }) {
  function render(networks = []) {
    if (!list) return;
    const savedNetworks = Array.isArray(networks) ? networks : [];
    list.replaceChildren();
    if (!savedNetworks.length) {
      const empty = document.createElement("div");
      empty.className = "wifi-network-empty";
      empty.textContent = "No saved networks";
      list.append(empty);
      return;
    }
    savedNetworks.forEach((network, index) => {
      const ssid = network?.ssid || `Network ${index + 1}`;
      const row = document.createElement("div");
      row.className = "wifi-network-row";

      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded";
      icon.textContent = "wifi";

      const label = document.createElement("span");
      label.className = "wifi-network-name";
      label.textContent = ssid;

      const meta = document.createElement("span");
      meta.className = "wifi-network-meta";
      meta.textContent = network?.passwordSet ? "saved" : "open";

      const remove = document.createElement("button");
      remove.className = "button compact icon-buttonish";
      remove.type = "button";
      remove.title = `Forget ${network?.ssid || "network"}`;
      remove.setAttribute("aria-label", remove.title);
      remove.innerHTML = '<span class="material-symbols-rounded">close</span>';
      remove.disabled = !isDeviceConnected() || isBusy();
      remove.addEventListener("click", () => onForget(index));

      row.append(icon, label, meta, remove);
      list.append(row);
    });
  }

  return { render };
}
