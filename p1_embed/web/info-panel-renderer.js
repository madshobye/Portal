export function createInfoPanelRenderer({
  fields,
  infoShare,
  infoQr,
  brandVersion,
  connectMqtt,
  connectWebSocket,
} = {}) {
  function renderBrand({ webVersion, firmwareVersion } = {}) {
    if (!brandVersion) return;
    const firmware = String(firmwareVersion || "").trim();
    const webLine = `web ${webVersion}`;
    const firmwareLine = firmware ? `fw ${firmware}` : "";
    brandVersion.replaceChildren(
      versionLine(webLine),
      versionLine(firmwareLine),
    );
    brandVersion.title = firmwareLine ? `${webLine} / ${firmwareLine}` : webLine;
  }

  function versionLine(text) {
    const line = document.createElement("span");
    line.className = "brand-version-line";
    line.textContent = text;
    return line;
  }

  function renderCards(cards = []) {
    fields.replaceChildren(...cards.map((card) => infoCard(card.icon, card.title, card.metrics, card.options)));
  }

  function infoCard(icon, title, metrics = [], options = {}) {
    const card = document.createElement("section");
    card.className = `info-card${options.compact ? " info-card-compact" : ""}`;
    const header = document.createElement("header");
    const iconEl = document.createElement("span");
    iconEl.className = "material-symbols-rounded info-card-icon";
    iconEl.textContent = icon;
    const titleEl = document.createElement("strong");
    titleEl.textContent = title || "-";
    header.append(iconEl, titleEl);
    const body = document.createElement("div");
    body.className = "info-card-body";
    metrics.forEach((metric) => body.append(renderMetric(metric, options.links || {})));
    card.append(header, body);
    return card;
  }

  function renderMetric(metric, links = {}) {
    const row = document.createElement("div");
    row.className = "info-metric";
    const label = document.createElement("span");
    label.textContent = metric.label;
    const value = document.createElement("strong");
    const text = String(metric.value || "-");
    if (metric.label === "MQTT" && links.peerId) {
      value.append(actionLink(text, () => connectMqtt(links.peerId), "Connect MQTT"));
    } else if (metric.label === "WebSocket" && links.wsUrl) {
      value.append(actionLink(text, () => connectWebSocket(links.wsUrl), "Connect WebSocket"));
    } else if (metric.label === "Share" && links.shareUrl) {
      const link = document.createElement("a");
      link.className = "info-link";
      link.href = links.shareUrl;
      link.textContent = links.shareUrl;
      link.title = "Open this interface and connect to this device";
      value.append(link);
    } else {
      value.textContent = text;
    }
    row.append(label, value);
    return row;
  }

  function actionLink(text, action, title) {
    const button = document.createElement("button");
    button.className = "info-link";
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", action);
    return button;
  }

  function metric(label, value) {
    return { label, value };
  }

  function renderShare(shareUrl = "") {
    const url = String(shareUrl || "");
    infoShare.classList.toggle("is-hidden", !url);
    if (!url) {
      infoQr.replaceChildren();
      delete infoQr.dataset.url;
      return;
    }

    if (infoQr.dataset.url === url) return;
    infoQr.dataset.url = url;
    infoQr.replaceChildren(renderQrCanvas(url));
  }

  function renderQrCanvas(text) {
    if (typeof window.createQRCode !== "function") {
      const fallback = document.createElement("div");
      fallback.className = "info-qr-fallback";
      fallback.textContent = "QR unavailable";
      return fallback;
    }

    try {
      const qr = window.createQRCode(text);
      const quiet = 4;
      const scale = Math.max(2, Math.floor(150 / (qr.size + quiet * 2)));
      const pixels = (qr.size + quiet * 2) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = pixels;
      canvas.height = pixels;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pixels, pixels);
      ctx.fillStyle = "#000000";
      for (let y = 0; y < qr.size; y += 1) {
        for (let x = 0; x < qr.size; x += 1) {
          if (qr.getModule(x, y)) {
            ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
          }
        }
      }
      return canvas;
    } catch (error) {
      const fallback = document.createElement("div");
      fallback.className = "info-qr-fallback";
      fallback.textContent = error.message || "QR failed";
      return fallback;
    }
  }

  return {
    metric,
    renderBrand,
    renderCards,
    renderShare,
  };
}
