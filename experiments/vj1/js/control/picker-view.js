import { listGeneratorNodeComponents as listGeneratorComponents, listEffectNodeComponents as listShaderComponents } from "../libraries/visual-nodes/index.js";
import { effectIcon, UI_ICONS } from "./ui-icons.js";
import { sortComponentCatalog } from "./catalog-view.js";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js";
import { mediaCategory } from "./media-view.js";
import { catalogMarkerMeta } from "../domain/catalog-marker.js";
import { createAuthoredMediaSource } from "../domain/authored-visual-source.js";

function getByPath(target, path) {
  return String(path || "").split(".").filter(Boolean).reduce((value, segment) => value?.[segment], target);
}

export function generatorIcon(id) {
  return {
    fireflies: "flare",
    eyeball: "visibility",
    swayingTrees: "forest",
    waves: "waves",
    noise: "grain",
    tileTexture: "grid_on",
    screenShare: "present_to_all",
    cameraInput: "photo_camera",
    text: "text_fields",
    plasma: "blur_on",
    gradient: "gradient",
    featureMorph: "animation",
    featureMorphV2: "neurology",
    cellularCircles: "bubble_chart",
    meshPatterns: "polyline",
    galaxy: "blur_circular",
    fog: "foggy",
    volumetricClouds: "filter_drama",
    sunRays: "sunny",
    anatomy: "accessibility_new",
    terrainFlyover: "landscape",
    bezierStrokes: "gesture",
    shadertoyBaseWarp: "auto_awesome_mosaic",
    seascape: "water",
    paintDrips: "format_color_fill",
    cloudyTunnel: "blur_circular",
    cherenkovVolume: "bubble_chart",
    biomineLite: "biotech",
    checker: "grid_view",
    testPattern: "featured_video",
  }[id] || "auto_awesome";
}

function sourceFilterDescriptors({ mediaItems = [], allowedCategory = "", hasIsf = false, hasComponents = false } = {}) {
  if (allowedCategory) return [{
    id: allowedCategory,
    label: allowedCategory === "model" ? "3D" : allowedCategory === "image" ? "Images" : allowedCategory,
  }];
  const availableMedia = new Set(mediaItems.map(mediaCategory));
  return [
    ...(hasComponents ? [{ id: "component", label: "Components" }] : []),
    ...(availableMedia.has("image") ? [{ id: "image", label: "Images" }] : []),
    ...(availableMedia.has("video") ? [{ id: "video", label: "Videos" }] : []),
    ...(availableMedia.has("model") ? [{ id: "model", label: "3D" }] : []),
    { id: "generator", label: "Generators" },
    ...(hasIsf ? [{ id: "isf", label: "ISF" }] : []),
    { id: "live", label: "Live" },
    { id: "blank", label: "Blank" },
  ];
}

function elementFilterDescriptors({ mediaItems = [], hasComponents = false, hasIsf = false } = {}) {
  const availableMedia = new Set(mediaItems.map(mediaCategory));
  return [
    ...(hasComponents ? [{ id: "component", label: "Components" }] : []),
    ...(availableMedia.has("image") ? [{ id: "image", label: "Images" }] : []),
    ...(availableMedia.has("video") ? [{ id: "video", label: "Videos" }] : []),
    ...(availableMedia.has("model") ? [{ id: "model", label: "3D" }] : []),
    { id: "live", label: "Live" },
    { id: "group", label: "Groups" },
    { id: "generator", label: "Generators" },
    { id: "effect", label: "Effects" },
    ...(hasIsf ? [{ id: "isf", label: "ISF" }] : []),
  ];
}

export function sourceChoicePickerUiModel(state, picker, mediaLibrary) {
  const source = currentSourceValue(picker, state);
  const allowedCategory = picker?.allowedCategory || "";
  const components = picker?.allowComponents
    ? (state.components || []).filter((component) => component.type !== "scene" && component.id !== picker.ownerComponentId)
    : [];
  const mediaSortMode = state.ui?.catalogSortModes?.media || "recent";
  const allMedia = sortComponentCatalog(state.media || [], mediaSortMode);
  const media = allowedCategory ? allMedia.filter((item) => elementMediaCategory(item) === allowedCategory) : allMedia;
  const generators = mergeVisualCatalogEntries(
    listGeneratorComponents(),
    listProjectIsfVisualComponents(state).filter((component) => component.kind === "generator"),
  ).filter((generator) => !["black", "cameraInput"].includes(generator.id));
  const selectedMediaId = selectedSourceMediaId(source);
  const sections = [
    ...(components.length ? [{
      id: "components", label: "Components", emptyText: "No matching components.",
      items: components.map((component) => ({
        id: `component:${component.id}`, label: component.name, meta: "component", icon: UI_ICONS.component,
        media: component.thumbnail ? { src: component.thumbnail, type: "image" } : null,
        categories: "component", searchText: elementSearchText(component.name, "component source"),
        selected: source.type === "component" && source.componentId === component.id,
        value: { type: "component", componentId: component.id },
      })),
    }] : []),
    mediaCatalogSection(media, mediaLibrary, mediaSortMode, (item) => sourceForMediaDescriptor(item), selectedMediaId),
    ...(!allowedCategory ? [{
      id: "generators", label: "Generators", emptyText: "No matching generators.",
      items: generators.map((generator) => visualCatalogItem(generator, "generator", {
        selected: source.type === "generator" && source.generatorId === generator.id,
        value: { type: "generator", generatorId: generator.id },
      })),
    }, {
      id: "other", label: "Other sources", emptyText: "No matching sources.",
      items: [{
        id: "generator:cameraInput", label: "Live camera", meta: "Portal camera feed", icon: "photo_camera",
        categories: "live", searchText: "live camera portal camera feed video input",
        selected: source.type === "generator" && source.generatorId === "cameraInput",
        value: { type: "generator", generatorId: "cameraInput" },
      }, {
        id: "generator:black", label: "Black", meta: "Empty black source", icon: "radio_button_unchecked",
        categories: "blank", searchText: "black empty blank source",
        selected: source.type === "generator" && source.generatorId === "black",
        value: { type: "generator", generatorId: "black" },
      }],
    }] : []),
  ];
  return {
    stateAddress: allowedCategory ? `picker/source/${allowedCategory}` : "picker/source/all",
    title: picker?.valueMode === "mediaId" ? "Choose image" : "Choose source",
    description: picker?.valueMode === "mediaId" ? "Pick one image for this parameter." : "Pick one source for this element.",
    searchPlaceholder: allowedCategory === "model" ? "Search 3D objects" : allowedCategory === "image" ? "Search images" : "Search media and generators",
    activeFilter: allowedCategory || picker?.filter || "all",
    search: picker?.search || "",
    lockedFilter: !!allowedCategory,
    filters: sourceFilterDescriptors({
      mediaItems: allMedia,
      allowedCategory,
      hasIsf: generators.some(isIsfVisualComponent),
      hasComponents: components.length > 0,
    }),
    actions: [{ id: "refresh", label: "Refresh media", icon: "refresh" }],
    sections,
    noResultsText: "No matching sources.",
  };
}

export function elementPickerUiModel(state, picker, mediaLibrary, componentCatalog = {}) {
  const mediaSortMode = state.ui?.catalogSortModes?.media || "recent";
  const media = sortComponentCatalog(state.media || [], mediaSortMode);
  const owner = state.components.find((component) => component.id === picker.componentId);
  const componentItems = Array.isArray(componentCatalog.components) ? componentCatalog.components : state.components;
  const components = owner?.type === "scene"
    ? componentItems.filter((component) => component.id !== picker.componentId && component.type !== "scene")
    : [];
  const projectIsf = listProjectIsfVisualComponents(state);
  const generators = mergeVisualCatalogEntries(listGeneratorComponents(), projectIsf.filter((component) => component.kind === "generator"))
    .filter((generator) => !["black", "cameraInput"].includes(generator.id));
  const effects = mergeVisualCatalogEntries(listShaderComponents(), projectIsf.filter((component) => component.kind === "effect"));
  return {
    stateAddress: `picker/element/${encodeURIComponent(picker.componentId || "unknown")}`,
    title: "Add element",
    description: "Choose a source or an effect for this component.",
    searchPlaceholder: "Search media, generators, effects",
    activeFilter: picker.filter || "all",
    search: picker.search || "",
    filters: elementFilterDescriptors({
      mediaItems: media,
      hasComponents: components.length > 0,
      hasIsf: [...generators, ...effects].some(isIsfVisualComponent),
    }),
    actions: [{ id: "refresh", label: "Refresh media", icon: "refresh" }],
    sections: [
      ...(components.length ? [{
        id: "components", label: "Components", emptyText: "No matching components.",
        actions: [catalogSortDescriptor("component", componentCatalog.sortMode || "recent")],
        items: components.map((component) => catalogMarkedItem({
          id: `component:${component.id}`, label: component.name, meta: "component", icon: UI_ICONS.component,
          media: component.thumbnail ? { src: component.thumbnail, type: "image" } : null,
          categories: "component", searchText: elementSearchText(component.name, "component source"),
          value: { kind: "source", value: { type: "component", componentId: component.id } },
        }, component, "component")),
      }] : []),
      mediaCatalogSection(media, mediaLibrary, mediaSortMode, (item) => ({ kind: "source", value: sourceForMediaDescriptor(item) })),
      {
        id: "live", label: "Live input", emptyText: "No matching live inputs.", items: [{
          id: "generator:cameraInput", label: "Live camera", meta: "Portal camera feed", icon: "photo_camera",
          categories: "live", searchText: "live camera portal camera feed video input",
          value: { kind: "source", value: { type: "generator", generatorId: "cameraInput" } },
        }],
      }, {
        id: "structure", label: "Structure", emptyText: "No matching structure elements.", items: [{
          id: "group", label: "Group", meta: "nested chain", icon: UI_ICONS.group,
          categories: "group", searchText: "group folder chain nested structure", value: { kind: "group" },
        }],
      }, {
        id: "generators", label: "Generators", emptyText: "No matching generators.",
        items: generators.map((generator) => visualCatalogItem(generator, "generator", {
          value: { kind: "source", value: { type: "generator", generatorId: generator.id } },
        })),
      }, {
        id: "effects", label: "Effects", emptyText: "No matching effects.",
        items: effects.map((effect) => visualCatalogItem(effect, "effect", {
          value: { kind: "effect", value: effect.id },
        })),
      },
    ],
    noResultsText: "No matching elements.",
  };
}

function mediaCatalogSection(items, mediaLibrary, sortMode, valueFor, selectedMediaId = "") {
  return {
    id: "media", label: "Media", emptyText: "No matching media.",
    actions: [catalogSortDescriptor("media", sortMode)],
    items: items.map((item) => catalogMarkedItem({
      id: `media:${item.id}`,
      label: String(item.name || item.path || item.id || "Media").split(/[\\/]/).filter(Boolean).at(-1) || "Media",
      meta: elementMediaCategory(item),
      icon: item.type === "video" ? "movie" : item.type === "model" ? "deployed_code" : "image",
      categories: elementMediaCategory(item),
      searchText: elementSearchText(item.id, item.name, item.type, item.path, "media"),
      selected: item.id === selectedMediaId,
      value: valueFor(item),
      media: ["image", "video", "model"].includes(item.type) && mediaLibrary?.getFile?.(item.id)
        ? {
          key: item.id,
          // The thumbnail handler always returns a still derived image,
          // including for videos and 3D media.
          type: "image",
          load: "visible",
        }
        : null,
    }, item, "media")),
  };
}

function sourceForMediaDescriptor(item) {
  return createAuthoredMediaSource(item.id, item);
}

function visualCatalogItem(component, kind, overrides = {}) {
  return {
    id: `${kind}:${component.id}`,
    label: visualPickerDisplayName(component),
    meta: component.category || kind,
    icon: kind === "effect" ? effectIcon(component.id) : generatorIcon(component.id),
    categories: elementPickerCategories(kind, component),
    searchText: elementSearchText(component.id, component.label, component.name, component.category, kind, isIsfVisualComponent(component) ? "isf" : ""),
    ...overrides,
  };
}

function catalogMarkedItem(descriptor, item, kind) {
  const marker = catalogMarkerMeta(item.catalogMarker);
  return {
    ...descriptor,
    actions: [{ id: `marker:${kind}`, label: `${marker.label}; click to mark ${marker.nextLabel}`, icon: marker.icon }],
  };
}

function catalogSortDescriptor(scope, activeMode) {
  const modes = ["recent", "marker", "name", "created"];
  const index = Math.max(0, modes.indexOf(activeMode));
  const next = modes[(index + 1) % modes.length];
  return { id: `sort:${scope}:${next}`, label: `Sorted by ${modes[index]}; click to sort by ${next}`, icon: "sort" };
}

// A project may already contain an imported ISF file that later becomes part
// of the bundled catalog. Identity, rather than its display label or origin,
// determines whether it is the same visual. Keep the project definition
// authoritative so existing projects retain their exact source and settings,
// while presenting one catalog card.
export function mergeVisualCatalogEntries(builtIns = [], project = []) {
  const projectById = new Map(
    (project || []).filter((item) => item?.id).map((item) => [item.id, item]),
  );
  const merged = [];
  const included = new Set();
  for (const item of builtIns || []) {
    const selected = projectById.get(item?.id) || item;
    if (!selected?.id || included.has(selected.id)) continue;
    included.add(selected.id);
    merged.push(selected);
  }
  for (const item of project || []) {
    if (!item?.id || included.has(item.id)) continue;
    included.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function elementMediaCategory(item = {}) {
  return mediaCategory(item);
}

function elementSearchText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function isIsfVisualComponent(component = {}) {
  return component?.family === "isf" ||
    component?.isf?.format === "isf@2" ||
    component?.nodeDefinition?.metadata?.visualFamily === "isf";
}

export function visualPickerDisplayName(component = {}) {
  const name = String(component?.label || component?.name || "Visual");
  return isIsfVisualComponent(component) && !/\(ISF\)$/i.test(name)
    ? `${name} (ISF)`
    : name;
}

function elementPickerCategories(primary, component) {
  return isIsfVisualComponent(component) ? `${primary} isf` : primary;
}

function currentSourceValue(picker, state) {
  if (!picker?.path || !state) return {};
  const source = getByPath(state, picker.path);
  if (picker.valueMode === "mediaId") {
    return typeof source === "string" ? { type: "media-value", mediaId: source } : {};
  }
  return source && typeof source === "object" ? source : {};
}

function selectedSourceMediaId(source = {}) {
  if (source.type === "media-value") {
    return String(source.mediaId || "");
  }
  if (
    source.type === "generator" &&
    (source.generatorId === "mediaImage" || source.generatorId === "modelMedia")
  ) return String(source.params?.mediaId || "");
  return "";
}
