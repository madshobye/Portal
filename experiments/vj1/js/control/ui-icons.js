export const UI_ICONS = Object.freeze({
  component: "extension",
  scene: "landscape",
  live: "play_circle",
  mapping: "select_all",
  nodes: "schema",
  surface: "select_all",
  group: "account_tree",
});

export function componentTypeIcon(componentOrType = "") {
  const type = typeof componentOrType === "string" ? componentOrType : componentOrType?.type;
  return type === "scene" ? UI_ICONS.scene : UI_ICONS.component;
}
