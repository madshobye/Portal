import { normalizeParamValue } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { createNumberParam } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { esc, formatRangeValue, paramRangePairTemplate } from "./template-utils.js?v=slider-values-70";

export function shaderParamControlsTemplate(component, pass, basePath, options = {}) {
  const params = options.params || component?.params || [];
  if (!params.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(params, {
        pathFor: (param) => `${basePath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, pass, param),
        isSignificant: options.isSignificant,
      })}
    </div>
  `;
}

// Parameter declarations are ordered by authorial relevance. The common
// Render quality control and overflow controls belong to Details; the first
// six authored controls form the immediate performance surface. Components
// may override either set with `primaryParamIds` / `detailParamIds` without
// requiring a custom inspector.
export function componentParamViews(component = {}) {
  const visible = (component.params || []).filter((param) => param?.id !== "seed");
  const explicitPrimary = new Set(component.primaryParamIds || []);
  const explicitDetails = new Set(component.detailParamIds || []);
  if (explicitPrimary.size || explicitDetails.size) {
    const primary = visible.filter((param) => explicitPrimary.has(param.id) || (!explicitDetails.has(param.id) && param.id !== "renderQuality"));
    const details = visible.filter((param) => explicitDetails.has(param.id) || (param.id === "renderQuality" && !explicitPrimary.has(param.id)));
    return { primary, details };
  }
  const authored = visible.filter((param) => param.id !== "renderQuality");
  if (authored.length <= 6) return { primary: visible, details: [] };
  return {
    primary: authored.slice(0, 6),
    details: [...authored.slice(6), ...visible.filter((param) => param.id === "renderQuality")],
  };
}

export const CHAIN_TRANSFORM_PARAMS = Object.freeze([
  Object.freeze(createNumberParam("x", "Position X", { min: -2, max: 2, step: 0.001, defaultValue: 0 })),
  Object.freeze(createNumberParam("y", "Position Y", { min: -2, max: 2, step: 0.001, defaultValue: 0 })),
  Object.freeze(createNumberParam("scale", "Scale", { min: 0.05, max: 8, step: 0.001, defaultValue: 1, scale: "log" })),
  Object.freeze(createNumberParam("rotation", "Rotation", { min: -3.1416, max: 3.1416, step: 0.001, defaultValue: 0 })),
]);

export function chainTransformControlsTemplate(transform = {}, basePath, options = {}) {
  return `<div class="chain-param-list chain-transform-param-list">${paramControlsTemplate(CHAIN_TRANSFORM_PARAMS, {
    pathFor: (param) => `${basePath}.${param.id}`,
    valueFor: (param) => normalizeParamValue(param, transform?.[param.id]),
    attrs: options.attrs || "data-update",
    isSignificant: options.isSignificant || (() => false),
  })}</div>`;
}

export function paramControlsTemplate(params = [], {
  pathFor = (param) => param.id,
  valueFor = (param) => param.defaultValue,
  attrs = "data-update",
  isSignificant = () => false,
} = {}) {
  const visible = visibleParamControls(params);
  const byPair = new Map();
  for (const param of visible) {
    if (param.ui === "range-pair" && param.rangePair) {
      const pair = byPair.get(param.rangePair) || {};
      pair[param.rangeRole] = param;
      byPair.set(param.rangePair, pair);
    }
  }
  return visible.map((param) => {
    if (param.ui !== "range-pair" || !param.rangePair) {
      const path = pathFor(param);
      return paramControlTemplate(param, path, valueFor(param), attrs, {
        significant: isSignificant(param, path),
      });
    }
    if (param.rangeRole === "max") return "";
    const pair = byPair.get(param.rangePair);
    if (!pair?.min || !pair?.max) return paramControlTemplate(param, pathFor(param), valueFor(param), attrs);
    return paramRangePairTemplate({
      minParam: pair.min,
      maxParam: pair.max,
      minPath: pathFor(pair.min),
      maxPath: pathFor(pair.max),
      minValue: valueFor(pair.min),
      maxValue: valueFor(pair.max),
      attrs,
    });
  }).join("");
}

export function paramControlTemplate(param, path, value, attrs = "data-update", { significant = false } = {}) {
  const contextAttrs = attrs === "data-update"
    ? `data-param-context-path="${esc(path)}" data-param-default="${esc(JSON.stringify(param.defaultValue))}"`
    : "";
  const significantClass = significant ? " is-significant" : "";
  if (param.type === "boolean") {
    return `
      <label class="field inline-param param-context-target${significantClass}" ${contextAttrs}>
        <span>${esc(param.label || param.id)}</span>
        <input type="checkbox" ${attrs}="${esc(path)}" ${value ? "checked" : ""} />
      </label>
    `;
  }
  if (param.type === "enum") {
    return `
      <label class="field chain-param param-context-target${significantClass}" ${contextAttrs}>
        <span>${esc(param.label || param.id)}</span>
        <select ${attrs}="${esc(path)}">
          ${(param.values || []).map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  if (param.type === "color") return colorParamControlTemplate(param, path, value, attrs, { significant });
  const logarithmic = param.scale === "log" && Number(param.min) > 0 && Number(param.max) > Number(param.min);
  const sliderMin = logarithmic ? 0 : param.min ?? 0;
  const sliderMax = logarithmic ? 1 : param.max ?? 1;
  const sliderStep = logarithmic ? 0.001 : param.step ?? 0.01;
  const safeValue = clampNumber(Number(value), Number(param.min), Number(param.max));
  const sliderValue = logarithmic
    ? Math.log(safeValue / Number(param.min)) / Math.log(Number(param.max) / Number(param.min))
    : value;
  const scaleAttrs = logarithmic
    ? `data-number-scale="log" data-value-min="${param.min}" data-value-max="${param.max}"`
    : "";
  return `
    <label class="field range-field chain-param param-context-target${significantClass}" ${contextAttrs}>
      <span>${esc(param.label || param.id)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(safeValue, param.step ?? 0.01)}</output>
      <input type="range" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" data-display-step="${param.step ?? 0.01}" ${scaleAttrs} ${attrs}="${esc(path)}" value="${sliderValue}" />
    </label>
  `;
}

export function colorParamControlTemplate(param, path, value, attrs = "data-update", { significant = false } = {}) {
  const mode = attrs.includes("data-live-update") ? "live" : "state";
  const liveComponentMatch = /data-live-component-id="([^"]*)"/.exec(attrs);
  const liveComponentId = liveComponentMatch?.[1] || "";
  const rgba = normalizeColorHex(value || param.defaultValue || "#ffffffff");
  const rgb = rgba.slice(0, 7);
  const alpha = colorAlphaFromHex(rgba);
  return `
    <div class="field color-param chain-param param-context-target${significant ? " is-significant" : ""}" data-color-param data-color-mode="${mode}" data-color-path="${esc(path)}" ${mode === "state" ? `data-param-context-path="${esc(path)}" data-param-default="${esc(JSON.stringify(param.defaultValue))}"` : ""} ${liveComponentId ? `data-live-component-id="${esc(liveComponentId)}"` : ""}>
      <span>${esc(param.label || param.id)}</span>
      <div class="color-param-row">
        <input type="range" min="0" max="1" step="0.01" data-color-alpha value="${alpha}" aria-label="${esc(param.label || param.id)} alpha" />
        <input type="color" data-color-rgb value="${esc(rgb)}" aria-label="${esc(param.label || param.id)} color" />
      </div>
    </div>
  `;
}

export function paramCurrentValue(component, pass, param) {
  const values = {
    ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
  };
  if (param.id === "amount" && values.amount === undefined) values.amount = pass.amount;
  return normalizeParamValue(param, values[param.id]);
}

function visibleParamControls(params = []) {
  return (params || []).filter((param) => param?.id !== "seed");
}

function normalizeColorHex(value = "#ffffffff") {
  const clean = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{8}$/i.test(clean)) return `#${clean.toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean.toLowerCase()}ff`;
  return "#ffffffff";
}

function colorAlphaFromHex(value = "#ffffffff") {
  const rgba = normalizeColorHex(value);
  return Number.parseInt(rgba.slice(7, 9), 16) / 255;
}

function clampNumber(value, min, max) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 1;
  return Math.min(safeMax, Math.max(safeMin, Number.isFinite(value) ? value : safeMin));
}
