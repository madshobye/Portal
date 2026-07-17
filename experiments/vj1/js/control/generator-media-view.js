import { esc, icon } from "./template-utils.js?v=adaptive-component-demand-29";

export function generatorImageMediaControlTemplate(base, source = {}, state = {}, {
  label = "Image",
  paramId = "imageId",
  emptyDetail = "Generator input",
} = {}) {
  const mediaId = source.params?.[paramId] || "";
  const media = (state.media || []).find((item) => item.id === mediaId);
  return `
    <div class="field">
      <span>${esc(label)}</span>
      <button type="button" class="source-choice-button" data-open-media-picker data-media-accept="image" data-media-path="${esc(`${base}.params.${paramId}`)}">
        ${icon("image")}
        <span><strong>${esc(media?.name || "Choose image")}</strong><small>${esc(media?.path || emptyDetail)}</small></span>
        ${icon("chevron_right")}
      </button>
    </div>`;
}
