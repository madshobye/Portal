import { setText } from "./dom-utils.js";
import { formatRangeValue } from "./template-utils.js";

export function setByPath(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = pathPart(parts[index]);
    cursor = cursor?.[part];
    if (!cursor) return;
  }
  if (!cursor || !parts.length) return;
  cursor[pathPart(parts.at(-1))] = value;
}

export function getByPath(target, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts) cursor = cursor?.[pathPart(part)];
  return cursor;
}

export function setByPathCreate(target, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = pathPart(parts[index]);
    if (cursor[part] === undefined) cursor[part] = Number.isNaN(Number(parts[index + 1])) ? {} : [];
    cursor = cursor[part];
  }
  if (cursor && parts.length) cursor[pathPart(parts.at(-1))] = value;
}

export function readInputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "range" || input.type === "number") {
    const value = Number(input.value);
    if (input.dataset.numberScale === "log") {
      const min = Number(input.dataset.valueMin);
      const max = Number(input.dataset.valueMax);
      if (min > 0 && max > min) return min * Math.pow(max / min, clamp(value, 0, 1));
    }
    return value;
  }
  return input.value;
}

export function syncRangeValue(input) {
  if (input?.type !== "range") return;
  const output = input.closest?.(".range-field")?.querySelector?.("[data-range-value]");
  if (!output) return;
  const value = readInputValue(input);
  if (input.dataset.rangeFormat === "time-stretch") {
    const stretch = Number(value) || 0;
    const scale = stretch <= -4 ? 0 : 2 ** stretch;
    setText(output, `${stretch.toFixed(2)} · ${scale < 0.1 ? scale.toFixed(3) : scale.toFixed(2)}×`);
    return;
  }
  if (input.dataset.rangeFormat === "percent") {
    setText(output, `${formatRangeValue(Number(value) * 100, input.dataset.displayStep || 1)}%`);
    return;
  }
  setText(output, `${formatRangeValue(value, input.dataset.displayStep || input.step)}${input.dataset.rangeSuffix || ""}`);
}

function pathPart(value) {
  return Number.isNaN(Number(value)) ? value : Number(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
