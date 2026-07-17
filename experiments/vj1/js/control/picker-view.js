import { listGeneratorComponents } from "../graph/generator-registry.js?v=group-composite-59";
import { listShaderComponents } from "../shaders/shader-registry.js?v=adaptive-component-demand-29";
import { effectIcon, esc, icon, thumbnailTemplate } from "./template-utils.js?v=adaptive-component-demand-29";

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
    plasma: "blur_on",
    gradient: "gradient",
    featureMorph: "animation",
    featureMorphV2: "neurology",
    cellularCircles: "bubble_chart",
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

export function sourceChoicePickerTemplate(state, picker, mediaLibrary, urlCache) {
  const source = currentSourceValue(picker, state);
  const mediaItems = state.media || [];
  const generators = listGeneratorComponents().filter((generator) => generator.id !== "black");
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Choose source">
      <header class="modal-header">
        <div>
          <strong>Choose source</strong>
          <small>Pick one source for this element.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="Search media and generators" autocomplete="off" />
      </label>

      <div class="element-modal-body">
        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => sourceMediaCardTemplate(item, source, mediaLibrary, urlCache)).join("") : `
              <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${generators.map((generator) => `
              <button type="button" class="element-card ${source.type === "generator" && source.generatorId === generator.id ? "is-selected" : ""}" data-pick-source-generator="${esc(generator.id)}" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
                ${icon(generatorIcon(generator.id))}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching generators.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">input</span><span>Other sources</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card ${source.type === "camera" ? "is-selected" : ""}" data-pick-source-camera data-element-search-card="live camera portal camera feed video input">
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
            <button type="button" class="element-card ${source.type === "black" ? "is-selected" : ""}" data-pick-source-black data-element-search-card="black empty blank source">
              ${icon("radio_button_unchecked")}
              <strong>Black</strong>
              <small>Empty black source</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching sources.</div>
        </section>
        <div class="soft-note" data-element-no-results hidden>No matching sources.</div>
      </div>
    </section>
  `;
}

function sourceMediaCardTemplate(item, source, mediaLibrary, urlCache) {
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  const selected = source.type === "media" && source.mediaId === item.id;
  return `
    <button type="button" class="element-card media-element-card ${selected ? "is-selected" : ""}" data-pick-source-media="${esc(item.id)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

export function elementPickerTemplate(state, picker, mediaLibrary, urlCache, componentCatalog = {}) {
  const mediaItems = state.media || [];
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

      <div class="element-modal-body">
        ${components.length ? `<section class="ui-section element-section" data-element-section>
          <div class="element-section-heading">
            <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Components</span></div>
            ${componentPickerSortTemplate(componentCatalog.sortMode || "recent")}
          </div>
          <div class="element-grid media-element-grid">
            ${components.map((component) => `
              <button type="button" class="element-card media-element-card" data-add-element-component="${esc(component.id)}" data-element-search-card="${esc(elementSearchText(component.name, "component source"))}">
                ${thumbnailTemplate(component.thumbnail)}
                <strong>${esc(component.name)}</strong>
                <small>component</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching components.</div>
        </section>` : ""}

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => elementMediaCardTemplate(item, mediaLibrary, urlCache)).join("") : `
              <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        <section class="ui-section element-section" data-element-section>
          <div class="ui-section-header rail-title"><span class="material-symbols-rounded">videocam</span><span>Live input</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-add-element-camera data-element-search-card="live camera portal camera feed video input">
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
            <button type="button" class="element-card" data-add-element-group data-element-search-card="group folder chain nested structure">
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
              <button type="button" class="element-card" data-add-element-generator="${esc(generator.id)}" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
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
              <button type="button" class="element-card" data-add-element-effect="${esc(shader.id)}" data-element-search-card="${esc(elementSearchText(shader.id, shader.name, shader.category, "effect"))}">
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

function componentPickerSortTemplate(activeMode = "recent") {
  const modes = [
    ["recent", "Changed", "history"],
    ["name", "Name", "sort_by_alpha"],
    ["created", "Created", "add_circle"],
  ];
  const activeIndex = Math.max(0, modes.findIndex(([mode]) => mode === activeMode));
  const [, activeLabel, activeIcon] = modes[activeIndex];
  const [nextMode, nextLabel] = modes[(activeIndex + 1) % modes.length];
  return `
    <div class="component-sort-toggle component-picker-sort">
      <button type="button" class="is-active" data-catalog-sort-scope="component" data-catalog-sort="${nextMode}" title="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}" aria-label="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}">${icon(activeIcon)}<span>${activeLabel}</span></button>
    </div>
  `;
}

function elementMediaCardTemplate(item, mediaLibrary, urlCache) {
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="element-card media-element-card" data-add-element-media="${esc(item.id)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function elementSearchText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function mediaPickerTemplate(state, picker, mediaLibrary, urlCache) {
  const mediaItems = picker?.accept
    ? state.media.filter((item) => item.type === picker.accept)
    : state.media;
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel media-modal" role="dialog" aria-modal="true" aria-label="Choose media">
      <header class="modal-header">
        <div>
          <strong>Choose media</strong>
          <small>${mediaItems.length} file${mediaItems.length === 1 ? "" : "s"}</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <div class="media-picker-grid">
        ${mediaItems.length ? mediaItems.map((item) => mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache)).join("") : `
          <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
        `}
      </div>
    </section>
  `;
}

function mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache) {
  const selected = item.id === currentMediaValue(picker, state);
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="media-picker-card ${selected ? "is-selected" : ""}" data-pick-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <span>${esc(item.name)}</span>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function mediaPreviewElementTemplate(item, previewUrl) {
  return item.type === "video"
    ? `<video src="${esc(previewUrl)}" muted playsinline preload="metadata"></video>`
    : `<img src="${esc(previewUrl)}" alt="" loading="lazy" />`;
}

function mediaTypeIcon(type = "") {
  if (type === "video") return "movie";
  if (type === "model") return "deployed_code";
  return "image";
}

function currentMediaValue(picker, state) {
  if (!picker?.path || !state) return "";
  const cursor = getByPath(state, picker.path);
  return typeof cursor === "string" ? cursor : "";
}

function currentSourceValue(picker, state) {
  if (!picker?.path || !state) return {};
  const source = getByPath(state, picker.path);
  return source && typeof source === "object" ? source : {};
}

function mediaPreviewUrl(id, mediaLibrary, urlCache) {
  if (urlCache.has(id)) return urlCache.get(id);
  const file = mediaLibrary.getFile(id);
  if (!file) return "";
  const url = URL.createObjectURL(file);
  urlCache.set(id, url);
  return url;
}
