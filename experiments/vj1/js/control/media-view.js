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

export function mediaChoiceUiModel(media, {
  id = "resource",
  label = "Media",
  mode = "source",
  path = "",
  accept = "",
  emptyName = "Choose media",
  emptyDetail = "Media",
  allowComponents = false,
  ownerComponentId = "",
} = {}) {
  const present = !!media;
  const normalizedMedia = media || {};
  const category = mediaCategory(normalizedMedia);
  const valueLabel = mediaDisplayName(media, emptyName);
  return {
    id,
    type: "resourceButton",
    label,
    valueLabel,
    detail: present ? "" : emptyDetail,
    icon: category === "model" ? "deployed_code" : category === "video" ? "movie" : "image",
    presentation: "resource-choice",
    accessibleLabel: `${label}: ${valueLabel}`,
    commandPayload: mode === "value"
      ? { path, accept: accept || category }
      : { path, category: category === "model" ? "model" : "", allowComponents, ownerComponentId },
    onActivate: { action: mode === "value" ? "picker.open-media" : "picker.open-source" },
  };
}
