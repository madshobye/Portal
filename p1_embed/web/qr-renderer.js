export function renderQrCanvas(text, { targetSize = 150, fallbackClass = "qr-fallback" } = {}) {
  if (typeof window.createQRCode !== "function") {
    return fallback("QR unavailable", fallbackClass);
  }

  try {
    const qr = window.createQRCode(String(text || ""));
    const quiet = 4;
    const scale = Math.max(2, Math.floor(targetSize / (qr.size + quiet * 2)));
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
    return fallback("QR failed", fallbackClass);
  }
}

function fallback(message, className) {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = message;
  return element;
}
