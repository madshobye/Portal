export function colorUniform(value) {
  if (Array.isArray(value)) return value.slice(0, 4);
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(String(value || ""));
  if (!match) return [1, 1, 1, 1];
  return [
    parseInt(match[1], 16) / 255,
    parseInt(match[2], 16) / 255,
    parseInt(match[3], 16) / 255,
    match[4] ? parseInt(match[4], 16) / 255 : 1,
  ];
}

export function modelColor(value, fallback = [255, 255, 255, 255]) {
  const rgba = colorUniform(value);
  if (!rgba) return fallback;
  return rgba.map((channel) => Math.round(Math.max(0, Math.min(1, Number(channel) || 0)) * 255));
}

export function normalizedModelColor(value, fallback = [255, 255, 255, 255]) {
  return modelColor(value, fallback).map((channel) => channel / 255);
}
