import { catalogMarkerButtonTemplate } from "./catalog-view.js?v=catalog-tools-row-1";
import { esc, icon } from "./template-utils.js?v=power-flicker-1";

const MEDIA_PICKER_ACTIONS = Object.freeze({
  add: "data-add-element-media",
  pick: "data-pick-source-media",
});

export function mediaRefreshButtonTemplate() {
  return `<button type="button" class="modal-refresh-media" data-refresh-media title="Rescan the project media folder">${icon("refresh")}<span>Refresh media</span></button>`;
}

export function mediaDisplayName(media = null, fallback = "Media") {
  const candidate = media?.name || media?.path || media?.id || "";
  const name = String(candidate).split(/[\\/]/).filter(Boolean).at(-1);
  return name || fallback;
}

export function mediaCategory(media = {}) {
  if (media.type === "video") return "video";
  const identity = String(media.path || media.id || media.name || "");
  if (media.type === "model" || /\.(obj|stl)$/i.test(identity)) return "model";
  if (/\.(mp4|m4v|mov|webm|ogv)$/i.test(identity)) return "video";
  return "image";
}

export function mediaChoiceButtonTemplate(media, {
  mode = "source",
  path = "",
  accept = "",
  emptyName = "Choose media",
  emptyDetail = "Media",
} = {}) {
  const present = !!media;
  const normalizedMedia = media || {};
  const category = mediaCategory(normalizedMedia);
  const trigger = mode === "value"
    ? `data-open-media-picker data-media-accept="${esc(accept || category)}" data-media-path="${esc(path)}"`
    : `data-open-source-choice="${esc(path)}"${category === "model" ? ' data-source-choice-category="model"' : ""}`;
  const iconName = category === "model" ? "deployed_code" : category === "video" ? "movie" : "image";
  return `<button type="button" class="source-choice-button" ${trigger}>
    ${icon(iconName)}
    <span>
      <strong>${esc(mediaDisplayName(media, emptyName))}</strong>
      ${present ? "" : `<small>${esc(emptyDetail)}</small>`}
    </span>
    ${icon("chevron_right")}
  </button>`;
}

export function mediaPickerCardTemplate(media, mediaLibrary, {
  action = "pick",
  selected = false,
} = {}) {
  const actionAttribute = MEDIA_PICKER_ACTIONS[action];
  if (!actionAttribute) throw new TypeError(`Unsupported media picker action: ${action}`);
  const name = mediaDisplayName(media);
  const category = mediaCategory(media);
  const hasPreview = ["image", "video", "model"].includes(media?.type) && !!mediaLibrary.getFile?.(media.id);
  const classes = `element-card media-element-card${selected ? " is-selected" : ""}`;
  return `
    <div class="element-card-shell" data-element-category="${category}" data-element-search-card="${esc(mediaSearchText(media))}">
      <button type="button" class="${classes}" ${actionAttribute}="${esc(media.id)}" title="${esc(name)}">
        ${hasPreview
          ? mediaPreviewElementTemplate(media)
          : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(media.type))}</div>`}
        <strong>${esc(name)}</strong>
      </button>
      ${catalogMarkerButtonTemplate(media, "media")}
    </div>
  `;
}

function mediaSearchText(media = {}) {
  return [media.id, media.name, media.type, media.path, "media"].filter(Boolean).join(" ").toLowerCase();
}

function mediaPreviewElementTemplate(media) {
  const previewId = esc(media.id);
  const preview = media.type === "video"
    ? `<video data-media-preview-id="${previewId}" muted playsinline preload="none"></video>`
    : `<img data-media-preview-id="${previewId}" alt="" loading="lazy" />`;
  return `<div class="media-preview-frame"><div class="media-picker-placeholder">${icon(mediaTypeIcon(media.type))}</div>${preview}</div>`;
}

function mediaTypeIcon(type = "") {
  if (type === "video") return "movie";
  if (type === "model") return "deployed_code";
  return "image";
}
