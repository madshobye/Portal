import { listGeneratorNodeComponents as listGeneratorComponents, listEffectNodeComponents as listShaderComponents } from "../libraries/visual-nodes/index.js?v=mesh-pattern-node-authority-1";
import { effectIcon, esc, icon, thumbnailTemplate } from "./template-utils.js?v=derived-thumbnail-projection-1";
import { catalogMarkerButtonTemplate, sortComponentCatalog } from "./catalog-view.js?v=catalog-tools-row-1";
import { listProjectIsfVisualComponents } from "../libraries/isf-engine/index.js?v=named-image-inputs-1";
import { mediaCategory, mediaPickerCardTemplate, mediaRefreshButtonTemplate } from "./media-view.js?v=media-name-presentation-1";
import { UI_ICONS } from "./ui-icons.js";

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
  const generators = [...listGeneratorComponents(), ...listProjectIsfVisualComponents(state).filter((component) => component.kind === "generator")]
    .filter((generator) => generator.id !== "black");
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
          ${mediaRefreshButtonTemplate()}
          <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
        </span>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="${allowedCategory === "model" ? "Search 3D objects" : allowedCategory === "image" ? "Search images" : "Search media and generators"}" autocomplete="off" />
      </label>

      ${sourceFilterBarTemplate({ active: sourceFilter, mediaItems: allMediaItems, allowedCategory })}

      <div class="element-modal-body" data-scroll-region data-scroll-key="source-picker-results">
        ${mediaPickerSectionTemplate(mediaItems, mediaLibrary, {
          action: "pick",
          selectedMediaId: source.type === "media" ? source.mediaId : "",
          sortMode: mediaSortMode,
          emptyMessage: allowedCategory === "model"
            ? "No 3D objects are available. Add an OBJ or STL file to the project folder."
            : "",
        })}

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

function sourceFilterBarTemplate({ active = "all", mediaItems = [], allowedCategory = "" } = {}) {
  if (allowedCategory) {
    const label = allowedCategory === "model" ? "3D" : allowedCategory === "image" ? "Images" : allowedCategory;
    const filterIcon = allowedCategory === "model" ? "deployed_code" : allowedCategory === "image" ? "image" : "filter_alt";
    return filterTabBarTemplate([[allowedCategory, label, filterIcon]], {
      active: allowedCategory,
      ariaLabel: "Allowed source type",
      scrollKey: "source-picker-filters",
      locked: true,
    });
  }
  const availableMedia = new Set(mediaItems.map(mediaCategory));
  const filters = [
    ...(availableMedia.has("image") ? [["image", "Images", "image"]] : []),
    ...(availableMedia.has("video") ? [["video", "Videos", "movie"]] : []),
    ...(availableMedia.has("model") ? [["model", "3D", "deployed_code"]] : []),
    ["generator", "Generators", "auto_awesome"],
    ["live", "Live", "photo_camera"],
    ["blank", "Blank", "radio_button_unchecked"],
  ];
  return filterTabBarTemplate(filters, {
    active,
    ariaLabel: "Filter source types",
    scrollKey: "source-picker-filters",
  });
}

export function elementPickerTemplate(state, picker, mediaLibrary, componentCatalog = {}) {
  const mediaSortMode = state.ui?.catalogSortModes?.media || "recent";
  const mediaItems = sortComponentCatalog(state.media || [], mediaSortMode);
  const owner = state.components.find((component) => component.id === picker.componentId);
  const componentItems = Array.isArray(componentCatalog.components) ? componentCatalog.components : state.components;
  const components = owner?.type === "scene"
    ? componentItems.filter((component) => component.id !== picker.componentId && component.type !== "scene")
    : [];
  const projectIsf = listProjectIsfVisualComponents(state);
  const generators = [...listGeneratorComponents(), ...projectIsf.filter((component) => component.kind === "generator")]
    .filter((generator) => generator.id !== "black");
  const effects = [...listShaderComponents(), ...projectIsf.filter((component) => component.kind === "effect")];
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Add element">
      <header class="modal-header">
        <div>
          <strong>Add element</strong>
          <small>Choose a source or an effect for this component.</small>
        </div>
        <span class="modal-header-actions">
          ${mediaRefreshButtonTemplate()}
          <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
        </span>
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

      <div class="element-modal-body" data-scroll-region data-scroll-key="element-picker-results">
        ${components.length ? `<section class="ui-section element-section" data-element-section>
          <div class="element-section-heading">
            <div class="ui-section-header rail-title"><span class="material-symbols-rounded">${UI_ICONS.component}</span><span>Components</span></div>
            ${componentPickerSortTemplate(componentCatalog.sortMode || "recent")}
          </div>
          <div class="element-grid media-element-grid">
            ${components.map((component) => `
              <div class="element-card-shell" data-element-category="component" data-element-search-card="${esc(elementSearchText(component.name, "component source"))}">
                <button type="button" class="element-card media-element-card" data-add-element-component="${esc(component.id)}">
                  ${thumbnailTemplate(component.thumbnail, UI_ICONS.component, component.id)}
                  <strong>${esc(component.name)}</strong>
                  <small>component</small>
                </button>
                ${catalogMarkerButtonTemplate(component, "component")}
              </div>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching components.</div>
        </section>` : ""}

        ${mediaPickerSectionTemplate(mediaItems, mediaLibrary, {
          action: "add",
          sortMode: mediaSortMode,
        })}

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
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">${UI_ICONS.group}</span><span>Structure</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-element-category="group" data-add-element-group data-element-search-card="group folder chain nested structure">
              ${icon(UI_ICONS.group)}
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
    ...(availableMedia.has("image") ? [["image", "Images", "image"]] : []),
    ...(availableMedia.has("video") ? [["video", "Videos", "movie"]] : []),
    ...(availableMedia.has("model") ? [["model", "3D", "deployed_code"]] : []),
    ["generator", "Generators", "auto_awesome"],
    ["effect", "Effects", "blur_on"],
    ...(hasComponents ? [["component", "Components", UI_ICONS.component]] : []),
    ["live", "Live", "photo_camera"],
    ["group", "Groups", "folder"],
  ];
  return filterTabBarTemplate(filters, {
    active,
    ariaLabel: "Filter element types",
    scrollKey: "element-picker-filters",
  });
}

function mediaPickerSectionTemplate(mediaItems, mediaLibrary, {
  action = "pick",
  selectedMediaId = "",
  sortMode = "recent",
  emptyMessage = "",
} = {}) {
  const fallback = emptyMessage || "Drop image, video, or 3D model files into the browser, or add them to the project folder.";
  return `<section class="ui-section element-section" data-element-section>
    <div class="element-section-heading">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
      ${catalogPickerSortTemplate("media", sortMode)}
    </div>
    <div class="element-grid media-element-grid">
      ${mediaItems.length ? mediaItems.map((item) => mediaPickerCardTemplate(item, mediaLibrary, {
        action,
        selected: item.id === selectedMediaId,
      })).join("") : `<div class="soft-note">${fallback}</div>`}
    </div>
    <div class="soft-note" data-element-empty hidden>No matching media.</div>
  </section>`;
}

function filterTabBarTemplate(filters, {
  active = "all",
  ariaLabel = "Filter",
  scrollKey = "picker-filters",
  locked = false,
} = {}) {
  const validActive = filters.some(([id]) => id === active) ? active : "all";
  return `
    <nav class="element-filter-bar" role="tablist" data-scroll-region data-scroll-key="${esc(scrollKey)}" aria-label="${esc(ariaLabel)}">
      ${filters.map(([id, label, filterIcon]) => `
        <button type="button" role="tab" class="${id === validActive ? "is-active" : ""}" data-element-filter="${esc(id)}" aria-selected="${id === validActive}" ${locked ? "disabled" : ""} ${id === "model" ? 'title="3D models (OBJ and STL)"' : ""}>
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

export function elementMediaCategory(item = {}) {
  return mediaCategory(item);
}

function elementSearchText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function currentSourceValue(picker, state) {
  if (!picker?.path || !state) return {};
  const source = getByPath(state, picker.path);
  if (picker.valueMode === "mediaId") {
    return typeof source === "string" ? { type: "media", mediaId: source } : {};
  }
  return source && typeof source === "object" ? source : {};
}
