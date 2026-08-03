import { esc, icon } from "./template-utils.js";
import { catalogMarkerMeta, sortCatalogItems } from "../domain/catalog-marker.js";
import { componentLayerProjection } from "../domain/component-layer-projection.js";

export function componentFilterTemplate(
  placeholder = "Filter components",
  viewStateKey = "catalog-filter:component",
) {
  return `<label class="component-filter-field">${icon("search")}<input type="search" data-component-filter data-view-state-key="${esc(viewStateKey)}" placeholder="${esc(placeholder)}" autocomplete="off" /></label>`;
}

export function componentCatalogToolsTemplate(scope, activeMode = "recent", placeholder = "Filter components") {
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
    <div class="component-catalog-tools">
      ${componentFilterTemplate(placeholder, `catalog-filter:${scope}`)}
      <div class="component-sort-toggle">
        <button type="button" class="is-active" data-catalog-sort-scope="${scope}" data-catalog-sort="${nextMode}" title="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}" aria-label="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}">${icon(activeIcon)}</button>
      </div>
    </div>
  `;
}

export function componentCatalogSearchText(component = {}, state = {}) {
  const terms = [];
  const append = (value) => {
    const text = String(value || "").trim();
    if (text) terms.push(text);
  };
  const visitLayers = (layers = []) => {
    for (const layer of layers) {
      const item = layer.item;
      append(item?.name);
      append(item?.componentId);
      append(item?.source?.mediaId);
      append(item?.source?.componentId);
      append(item?.source?.generatorId);
      append(item?.source?.params?.mediaId);
      visitLayers(layer.children);
    }
  };

  append(component.name);
  append(component.id);
  visitLayers(componentLayerProjection(state, component));
  return terms.join(" ").toLowerCase();
}

export function sortComponentCatalog(items = [], mode = "recent") {
  return sortCatalogItems(items, mode);
}

export function catalogMarkerButtonTemplate(item = {}, kind = "component") {
  const meta = catalogMarkerMeta(item.catalogMarker);
  return `<button type="button" class="catalog-marker-toggle marker-${meta.marker}" data-cycle-catalog-marker="${esc(kind)}" data-catalog-marker-id="${esc(item.id || "")}" title="${meta.label}; click to mark ${meta.nextLabel}" aria-label="${meta.label}; click to mark ${meta.nextLabel}">${icon(meta.icon)}</button>`;
}
