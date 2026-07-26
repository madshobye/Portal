import { esc } from "./template-utils.js";
import { mediaChoiceButtonTemplate } from "./media-view.js";

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
      ${mediaChoiceButtonTemplate(media, {
        mode: "value",
        path: `${base}.params.${paramId}`,
        accept: "image",
        emptyName: "Choose image",
        emptyDetail,
      })}
    </div>`;
}
