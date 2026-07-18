export function emptyNote(text) {
  return `<div class="soft-note">${esc(text)}</div>`;
}

export function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

export function thumbnailTemplate(src, fallbackIcon = "account_tree") {
  return src
    ? `<div class="component-thumbnail"><img src="${esc(src)}" alt="" loading="lazy" /></div>`
    : `<div class="component-thumbnail component-card-empty">${icon(fallbackIcon)}</div>`;
}

export function sourceTypeIcon(type) {
  if (type === "media") return "perm_media";
  if (type === "camera") return "photo_camera";
  if (type === "black") return "brightness_1";
  return "auto_awesome";
}

export function formatRangeValue(value, step = 0.01) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  const increment = Math.abs(Number(step)) || 0.01;
  const decimals = increment >= 1 ? 0 : increment >= 0.1 ? 1 : increment >= 0.01 ? 2 : 3;
  return number.toFixed(decimals);
}

export function rangeTemplate(label, path, value, min = 0, max = 1, step = 0.01) {
  return `
    <label class="field range-field">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, step)}</output>
      <input type="range" min="${min}" max="${max}" step="${step}" data-update="${path}" value="${value}" />
    </label>
  `;
}

export function paramRangePairTemplate({ minParam, maxParam, minPath, maxPath, minValue, maxValue, attrs = "data-update" }) {
  const lowerBound = Number(minParam.min) || 0;
  const upperBound = Number(minParam.max) || 1;
  const span = Math.max(0.000001, upperBound - lowerBound);
  const safeMin = clampTemplateNumber(Number(minValue), lowerBound, upperBound);
  const safeMax = clampTemplateNumber(Number(maxValue), safeMin, upperBound);
  const startPercent = ((safeMin - lowerBound) / span) * 100;
  const endPercent = ((safeMax - lowerBound) / span) * 100;
  const display = minParam.rangeDisplay || "number";
  const label = minParam.label || minParam.rangePair || minParam.id;
  const kind = minParam.rangeKind || "plain";
  const minContext = attrs === "data-update"
    ? `data-param-context-path="${esc(minPath)}" data-param-default="${esc(JSON.stringify(minParam.defaultValue))}"`
    : "";
  const maxContext = attrs === "data-update"
    ? `data-param-context-path="${esc(maxPath)}" data-param-default="${esc(JSON.stringify(maxParam.defaultValue))}"`
    : "";
  return `
    <div
      class="param-range-pair chain-param"
      data-param-range
      data-range-kind="${esc(kind)}"
      data-range-display="${esc(display)}"
      style="--range-start: ${startPercent.toFixed(3)}%; --range-end: ${endPercent.toFixed(3)}%;"
    >
      <div class="param-range-labels">
        <span>${esc(label)}</span>
        <span><strong data-param-range-label="min">${esc(formatTemplateRangeValue(safeMin, display, minParam.step))}</strong><span aria-hidden="true">–</span><strong data-param-range-label="max">${esc(formatTemplateRangeValue(safeMax, display, maxParam.step))}</strong></span>
      </div>
      <div class="param-range-slider">
        <div class="param-range-track" aria-hidden="true"></div>
        <input type="range" min="${lowerBound}" max="${upperBound}" step="${minParam.step ?? 0.01}" value="${safeMin}" ${attrs}="${esc(minPath)}" ${minContext} data-param-range-input="min" aria-label="${esc(label)} minimum" />
        <input type="range" min="${lowerBound}" max="${upperBound}" step="${maxParam.step ?? 0.01}" value="${safeMax}" ${attrs}="${esc(maxPath)}" ${maxContext} data-param-range-input="max" aria-label="${esc(label)} maximum" />
      </div>
    </div>
  `;
}

export function selectValuesTemplate(path, values, value) {
  return `
    <select data-update="${path}">
      ${values.map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

export function effectIcon(id) {
  return {
    alphaVignette: "vignette",
    photoGrade: "tune",
    glitchDistort: "broken_image",
    spinRotate: "rotate_right",
    flip: "flip",
    echoFade: "motion_blur",
    mirrorFold: "filter_vintage",
    heatShimmer: "local_fire_department",
    smear: "texture",
    ripple: "water",
    rgbSplit: "gradient",
    kaleido: "filter_vintage",
    pixelate: "grid_view",
    plasma: "blur_on",
    lumaKey: "tonality",
    hsvAlphaKey: "colorize",
    custom: "data_object",
  }[id] || "auto_awesome";
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clampTemplateNumber(value, min, max) {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}

function formatTemplateRangeValue(value, display = "number", step = 0.01) {
  if (display === "degrees") return `${Math.round(value)}°`;
  if (display === "percent") return `${Math.round(value * 100)}%`;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(0, String(step).split(".")[1]?.length || 0));
  return Number(value).toFixed(decimals);
}
