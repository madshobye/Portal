import { listGeneratorComponents } from "../graph/generator-registry.js?v=volumetric-clouds-1";
import { listShaderComponents } from "../shaders/shader-registry.js?v=alpha-feather-1";
import { effectIcon, esc, icon, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";
import { catalogMarkerButtonTemplate, sortComponentCatalog } from "./catalog-view.js?v=catalog-marker-four-state-1";

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

export function sourceChoicePickerTemplate(state, picker, mediaLibrary) {
  const source = currentSourceValue(picker, state);
  const allowedCategory = picker?.allowedCategory || "";
  const mediaSortMode = state.ui?.catalogSortModes?.media || "recent";
  const allMediaItems = sortComponentCatalog(state.media || [], mediaSortMode);
  const mediaItems = allowedCategory
    ? allMediaItems.filter((item) => elementMediaCategory(item) === allowedCategory)
    : allMediaItems;
  const generators = listGeneratorComponents().filter((generator) => generator.id !== "black");
  const sourceFilter = allowedCategory || picker?.filter || "all";
  const isMediaValuePicker = picker?.valueMode === "mediaId";
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Choose source">
      <header class="modal-header">
        <div>
          <strong>${isMediaValuePicker ? "Choose image" : "Choose source"}</strong>
          <small>${isMediaValuePicker ? "Pick one image for this parameter." : "Pick one source for this element."}</small>
        </div>
        <span class="modal-header-actions">
          <button type="button" class="icon-buttonish" data-refresh-media title="Refresh media folder" aria-label="Refresh media folder">${icon("refresh")}</button>
          <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
        </span>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="${allowedCategory === "model" ? "Search 3D objects" : allowedCategory === "image" ? "Search images" : "Search media and generators"}" autocomplete="off" />
      </label>

      ${sourceFilterBarTemplate({ active: sourceFilter, mediaItems: allMediaItems, allowedCategory })}

      <div class="element-modal-body">
        <section class="ui-section element-section" data-element-section>
          <div class="element-section-heading">
            <div class="ui-section-header rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
            ${catalogPickerSortTemplate("media", mediaSortMode)}
          </div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => sourceMediaCardTemplate(item, source, mediaLibrary)).join("") : `
              <div class="soft-note">${allowedCategory === "model" ? "No 3D objects are available. Add an OBJ or STL file to the project folder." : "Drop image, video, or 3D model files into the browser, or add them to the project folder."}</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        ${allowedCategory ? "" : `<section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${generators.map((generator) => `
              <button type="button" class="element-card ${source.type === "generator" && source.generatorId === generator.id ? "is-selected" : ""}" data-pick-source-generator="${esc(generator.id)}" data-element-category="generator" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
                ${icon(generatorIcon(generator.id))}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching generators.</div>
        </section>`}

        ${allowedCategory ? "" : `<section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">input</span><span>Other sources</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card ${source.type === "camera" ? "is-selected" : ""}" data-pick-source-camera data-element-category="live" data-element-search-card="live camera portal camera feed video input">
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
            <button type="button" class="element-card ${source.type === "black" ? "is-selected" : ""}" data-pick-source-black data-element-category="blank" data-element-search-card="black empty blank source">
              ${icon("radio_button_unchecked")}
              <strong>Black</strong>
              <small>Empty black source</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching sources.</div>
        </section>`}
        <div class="soft-note" data-element-no-results hidden>No matching sources.</div>
      </div>
    </section>
  `;
}

function sourceMediaCardTemplate(item, source, mediaLibrary) {
  const hasPreview = mediaHasLazyPreview(item, mediaLibrary);
  const selected = source.type === "media" && source.mediaId === item.id;
  return `
    <div class="element-card-shell" data-element-category="${elementMediaCategory(item)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}">
      <button type="button" class="element-card media-element-card ${selected ? "is-selected" : ""}" data-pick-source-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
        ${hasPreview
          ? mediaPreviewElementTemplate(item)
          : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
        <strong>${esc(item.name)}</strong>
        <small>${esc(item.type)}</small>
      </button>
      ${catalogMarkerButtonTemplate(item, "media")}
    </div>
  `;
}

function sourceFilterBarTemplate({ active = "all", mediaItems = [], allowedCategory = "" } = {}) {
  if (allowedCategory) {
    const label = allowedCategory === "model" ? "3D" : allowedCategory === "image" ? "Images" : allowedCategory;
    const filterIcon = allowedCategory === "model" ? "deployed_code" : allowedCategory === "image" ? "image" : "filter_alt";
    return `<nav class="element-filter-bar" aria-label="Allowed source type">
      <button type="button" class="is-active" data-element-filter="${esc(allowedCategory)}" aria-pressed="true" disabled>${icon(filterIcon)}<span>${esc(label)}</span></button>
    </nav>`;
  }
  const availableMedia = new Set(mediaItems.map(elementMediaCategory));
  const filters = [
    ["all", "All", "apps"],
    ...(availableMedia.has("image") ? [["image", "Images", "image"]] : []),
    ...(availableMedia.has("video") ? [["video", "Videos", "movie"]] : []),
    ...(availableMedia.has("model") ? [["model", "3D", "deployed_code"]] : []),
    ["generator", "Generators", "auto_awesome"],
    ["live", "Live", "photo_camera"],
    ["blank", "Blank", "radio_button_unchecked"],
  ];
  const validActive = filters.some(([id]) => id === active) ? active : "all";
  return `<nav class="element-filter-bar" aria-label="Filter source types">
    ${filters.map(([id, label, filterIcon]) => `
      <button type="button" class="${id === validActive ? "is-active" : ""}" data-element-filter="${id}" aria-pressed="${id === validActive}">${icon(filterIcon)}<span>${label}</span></button>
    `).join("")}
  </nav>`;
}

export function elementPickerTemplate(state, picker, mediaLibrary, componentCatalog = {}) {
  const mediaSortMode = state.ui?.catalogSortModes?.media || "recent";
  const mediaItems = sortComponentCatalog(state.media || [], mediaSortMode);
  const owner = state.components.find((component) => component.id === picker.componentId);
  const componentItems = Array.isArray(componentCatalog.components) ? componentCatalog.components : state.components;
  const components = owner?.type === "canvas"
    ? componentItems.filter((component) => component.id !== picker.componentId && component.type !== "canvas")
    : [];
  const generators = listGeneratorComponents().filter((generator) => generator.id !== "black");
  const effects = listShaderComponents();
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Add element">
      <header class="modal-header">
        <div>
          <strong>Add element</strong>
          <small>Choose a source or an effect for this component.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="Search media, generators, effects" autocomplete="off" />
      </label>

      ${elementFilterBarTemplate({
        active: picker.filter || "all",
        mediaItems,
        hasComponents: components.length > 0,
      })}

      <div class="element-modal-body">
        ${components.length ? `<section class="ui-section element-section" data-element-section>
          <div class="element-section-heading">
            <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Components</span></div>
            ${componentPickerSortTemplate(componentCatalog.sortMode || "recent")}
          </div>
          <div class="element-grid media-element-grid">
            ${components.map((component) => `
              <div class="element-card-shell" data-element-category="component" data-element-search-card="${esc(elementSearchText(component.name, "component source"))}">
                <button type="button" class="element-card media-element-card" data-add-element-component="${esc(component.id)}">
                  ${thumbnailTemplate(component.thumbnail)}
                  <strong>${esc(component.name)}</strong>
                  <small>component</small>
                </button>
                ${catalogMarkerButtonTemplate(component, "component")}
              </div>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching components.</div>
        </section>` : ""}

        <section class="ui-section element-section" data-element-section>
          <div class="element-section-heading">
            <div class="ui-section-header rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
            ${catalogPickerSortTemplate("media", mediaSortMode)}
          </div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => elementMediaCardTemplate(item, mediaLibrary)).join("") : `
              <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">videocam</span><span>Live input</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-element-category="live" data-add-element-camera data-element-search-card="live camera portal camera feed video input">
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching live inputs.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Structure</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-element-category="group" data-add-element-group data-element-search-card="group folder chain nested structure">
              ${icon("account_tree")}
              <strong>Group</strong>
              <small>nested chain</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching structure elements.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${generators.map((generator) => `
              <button type="button" class="element-card" data-element-category="generator" data-add-element-generator="${esc(generator.id)}" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
                ${icon(generatorIcon(generator.id))}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching generators.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
          <div class="element-grid compact-element-grid">
            ${effects.map((shader) => `
              <button type="button" class="element-card" data-element-category="effect" data-add-element-effect="${esc(shader.id)}" data-element-search-card="${esc(elementSearchText(shader.id, shader.name, shader.category, "effect"))}">
                ${icon(effectIcon(shader.id))}
                <strong>${esc(shader.name)}</strong>
                <small>${esc(shader.category || "effect")}</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching effects.</div>
        </section>
        <div class="soft-note" data-element-no-results hidden>No matching elements.</div>
      </div>
    </section>
  `;
}

function elementFilterBarTemplate({ active = "all", mediaItems = [], hasComponents = false } = {}) {
  const availableMedia = new Set(mediaItems.map(elementMediaCategory));
  const filters = [
    ["all", "All", "apps"],
    ...(availableMedia.has("image") ? [["image", "Images", "image"]] : []),
    ...(availableMedia.has("video") ? [["video", "Videos", "movie"]] : []),
    ...(availableMedia.has("model") ? [["model", "3D", "deployed_code"]] : []),
    ["generator", "Generators", "auto_awesome"],
    ["effect", "Effects", "blur_on"],
    ...(hasComponents ? [["component", "Components", "account_tree"]] : []),
    ["live", "Live", "photo_camera"],
    ["group", "Groups", "folder"],
  ];
  const validActive = filters.some(([id]) => id === active) ? active : "all";
  return `
    <nav class="element-filter-bar" aria-label="Filter element types">
      ${filters.map(([id, label, filterIcon]) => `
        <button type="button" class="${id === validActive ? "is-active" : ""}" data-element-filter="${id}" aria-pressed="${id === validActive}" ${id === "model" ? 'title="3D models (OBJ and STL)"' : ""}>
          ${icon(filterIcon)}<span>${label}</span>
        </button>
      `).join("")}
    </nav>
  `;
}

function componentPickerSortTemplate(activeMode = "recent") {
  return catalogPickerSortTemplate("component", activeMode);
}

function catalogPickerSortTemplate(scope = "component", activeMode = "recent") {
  const modes = [
    ["recent", "Changed", "history"],
    ["marker", "Marked", "keep"],
    ["name", "Name", "sort_by_alpha"],
    ["created", "Created", "add_circle"],
  ];
  const activeIndex = Math.max(0, modes.findIndex(([mode]) => mode === activeMode));
  const [, activeLabel, activeIcon] = modes[activeIndex];
  const [nextMode, nextLabel] = modes[(activeIndex + 1) % modes.length];
  return `
    <div class="component-sort-toggle component-picker-sort">
      <button type="button" class="is-active" data-catalog-sort-scope="${esc(scope)}" data-catalog-sort="${nextMode}" title="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}" aria-label="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}">${icon(activeIcon)}<span>${activeLabel}</span></button>
    </div>
  `;
}

function elementMediaCardTemplate(item, mediaLibrary) {
  const hasPreview = mediaHasLazyPreview(item, mediaLibrary);
  return `
    <div class="element-card-shell" data-element-category="${elementMediaCategory(item)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}">
      <button type="button" class="element-card media-element-card" data-add-element-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
        ${hasPreview
          ? mediaPreviewElementTemplate(item)
          : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
        <strong>${esc(item.name)}</strong>
        <small>${esc(item.type)}</small>
      </button>
      ${catalogMarkerButtonTemplate(item, "media")}
    </div>
  `;
}

export function elementMediaCategory(item = {}) {
  if (item.type === "video") return "video";
  if (item.type === "model" || /\.(obj|stl)$/i.test(String(item.path || item.name || ""))) return "model";
  return "image";
}

function elementSearchText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function mediaPreviewElementTemplate(item) {
  const previewId = esc(item.id);
  const media = item.type === "video"
    ? `<video data-media-preview-id="${previewId}" muted playsinline preload="none"></video>`
    : `<img data-media-preview-id="${previewId}" alt="" loading="lazy" />`;
  return `<div class="media-preview-frame"><div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>${media}</div>`;
}

function mediaHasLazyPreview(item, mediaLibrary) {
  return (item.type === "image" || item.type === "video" || item.type === "model") && !!mediaLibrary.getFile?.(item.id);
}

function mediaTypeIcon(type = "") {
  if (type === "video") return "movie";
  if (type === "model") return "deployed_code";
  return "image";
}

function currentSourceValue(picker, state) {
  if (!picker?.path || !state) return {};
  const source = getByPath(state, picker.path);
  if (picker.valueMode === "mediaId") {
    return typeof source === "string" ? { type: "media", mediaId: source } : {};
  }
  return source && typeof source === "object" ? source : {};
}
