export const UI_ICONS = Object.freeze({
  component: "extension",
  scene: "landscape",
  live: "play_circle",
  mapping: "select_all",
  nodes: "schema",
  surface: "select_all",
  group: "account_tree",
  visible: "visibility",
  hidden: "visibility_off",
  reset: "refresh",
  testPattern: "grid_view",
});

export function visibilityIcon(visible = true) {
  return visible ? UI_ICONS.visible : UI_ICONS.hidden;
}

export function componentTypeIcon(componentOrType = "") {
  const type = typeof componentOrType === "string" ? componentOrType : componentOrType?.type;
  return type === "scene" ? UI_ICONS.scene : UI_ICONS.component;
}

export function sourceTypeIcon(type) {
  if (type === "media") return "perm_media";
  if (type === "camera") return "photo_camera";
  if (type === "black") return "brightness_1";
  return "auto_awesome";
}

export function effectIcon(id) {
  return {
    alphaVignette: "vignette",
    brokenFluorescent: "fluorescent",
    powerFlicker: "lightbulb",
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
