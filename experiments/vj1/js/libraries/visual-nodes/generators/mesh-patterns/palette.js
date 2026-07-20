export function meshPatternPalette(params = {}) {
  const count = clamp(Math.round(Number(params.colorCount) || 4), 2, 4);
  const base = parseColor(params.baseColor, "#e34b7fff");
  const custom = [
    base,
    parseColor(params.colorB, "#27c7c7ff"),
    parseColor(params.colorC, "#f0c541ff"),
    parseColor(params.colorD, "#45246dff"),
  ];
  const harmony = String(params.palette || "triadic").toLowerCase();
  if (harmony === "custom") return Array.from({ length: 4 }, (_value, index) => custom[index % count]);
  const hsl = rgbToHsl(base);
  const offsets = {
    analogous: [-0.09, -0.03, 0.03, 0.09],
    complementary: [0, 0.5, 0.06, 0.56],
    triadic: [0, 1 / 3, 2 / 3, 1 / 6],
    "split complementary": [0, 5 / 12, 7 / 12, 0.5],
    tetradic: [0, 0.25, 0.5, 0.75],
    monochrome: [0, 0, 0, 0],
  }[harmony] || [0, 1 / 3, 2 / 3, 1 / 6];
  const generated = offsets.map((offset, index) => {
    const lightness = harmony === "monochrome"
      ? clamp(hsl[2] + (index - (count - 1) * 0.5) * 0.13, 0.08, 0.92)
      : clamp(hsl[2] + (index % 2 ? 0.06 : -0.035), 0.08, 0.92);
    const rgb = hslToRgb([(hsl[0] + offset + 1) % 1, hsl[1], lightness]);
    return [...rgb, base[3]];
  });
  return Array.from({ length: 4 }, (_value, index) => generated[index % count]);
}

function parseColor(value, fallback) {
  const clean = String(value || fallback).replace(/^#/, "");
  const fallbackClean = String(fallback).replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(clean)
    ? clean
    : /^[0-9a-f]{6}$/i.test(clean) ? `${clean}ff` : fallbackClean;
  return [0, 2, 4, 6].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function rgbToHsl(color) {
  const [red, green, blue] = color;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) * 0.5;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  let hue = maximum === red
    ? (green - blue) / delta + (green < blue ? 6 : 0)
    : maximum === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]) {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (offset) => {
    let value = (hue + offset + 1) % 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function meshPatternPaletteModuleSource() {
  return [meshPatternPalette, parseColor, rgbToHsl, hslToRgb, clamp].map(String).join("\n\n");
}
