export function emptyNote(text) {
  return `<div class="soft-note">${esc(text)}</div>`;
}

export function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

export function thumbnailTemplate(src, fallbackIcon = "account_tree") {
  return src
    ? `<img src="${esc(src)}" alt="" loading="lazy" />`
    : `<div class="composition-card-empty">${icon(fallbackIcon)}</div>`;
}

export function sourceTypeIcon(type) {
  if (type === "media") return "perm_media";
  if (type === "camera") return "photo_camera";
  if (type === "black") return "brightness_1";
  return "auto_awesome";
}

export function rangeTemplate(label, path, value, min = 0, max = 1, step = 0.01) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-update="${path}" value="${value}" />
    </label>
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
    echoFade: "motion_blur",
    mirrorFold: "filter_vintage",
    heatShimmer: "local_fire_department",
    ripple: "water",
    rgbSplit: "gradient",
    kaleido: "filter_vintage",
    pixelate: "grid_view",
    plasma: "blur_on",
    lumaKey: "tonality",
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
