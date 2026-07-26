import { generatorImageMediaControlTemplate } from "./generator-media-view.js";

export function featureMorphMediaControlsTemplate(base, source = {}, state = {}, {
  note = "Best with related images that share recognizable local features.",
  emptyDetail = "SuperPoint input",
} = {}) {
  return `
    <div class="soft-note">${note}</div>
    ${generatorImageMediaControlTemplate(base, source, state, { label: "Image A", paramId: "imageAId", emptyDetail })}
    ${generatorImageMediaControlTemplate(base, source, state, { label: "Image B", paramId: "imageBId", emptyDetail })}
  `;
}
