const accentCache = new Map();

export function thumbnailAccentColor(url = "") {
  const key = String(url || "");
  if (!key) return Promise.resolve("#777777");
  if (!accentCache.has(key)) accentCache.set(key, loadAccent(key));
  return accentCache.get(key);
}

export function dominantAccentFromPixels(data = []) {
  const buckets = new Map();
  for (let index = 0; index + 3 < data.length; index += 4) {
    const alpha = Number(data[index + 3]) / 255;
    if (alpha < 0.25) continue;
    const r = Number(data[index]);
    const g = Number(data[index + 1]);
    const b = Number(data[index + 2]);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;
    const lightness = (max + min) / 510;
    if (lightness < 0.08 || lightness > 0.94) continue;
    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;
    const key = `${qr},${qg},${qb}`;
    const weight = alpha * (0.35 + saturation * 1.65);
    buckets.set(key, (buckets.get(key) || 0) + weight);
  }
  const winner = [...buckets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (!winner) return "#777777";
  return `#${winner.split(",").map((value) =>
    Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0")
  ).join("")}`;
}

function loadAccent(url) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return Promise.resolve("#777777");
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(dominantAccentFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data));
      } catch {
        resolve("#777777");
      }
    };
    image.onerror = () => resolve("#777777");
    image.src = url;
  });
}
