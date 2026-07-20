import { esc, icon } from "./template-utils.js?v=slider-values-70";
import { CATALOG_MARKER_PINNED, catalogMarkerMeta, normalizeCatalogMarker } from "../domain/catalog-marker.js?v=catalog-marker-four-state-1";

export function componentFilterTemplate(placeholder = "Filter components") {
  return `<label class="component-filter-field">${icon("search")}<input type="search" data-component-filter placeholder="${esc(placeholder)}" autocomplete="off" /></label>`;
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
      ${componentFilterTemplate(placeholder)}
      <div class="component-sort-toggle">
        <button type="button" class="is-active" data-catalog-sort-scope="${scope}" data-catalog-sort="${nextMode}" title="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}" aria-label="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}">${icon(activeIcon)}<span>${activeLabel}</span></button>
      </div>
    </div>
  `;
}

export function sortComponentCatalog(items = [], mode = "recent") {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return items.slice().sort((a, b) => {
    // A pin is user-authored placement, not merely a marker sort rank. Keep it
    // above unpinned, starred, and hearted items under every catalog ordering.
    const pinnedOrder = Number(normalizeCatalogMarker(b.catalogMarker) === CATALOG_MARKER_PINNED)
      - Number(normalizeCatalogMarker(a.catalogMarker) === CATALOG_MARKER_PINNED);
    if (pinnedOrder) return pinnedOrder;
    if (mode === "marker") {
      const markerOrder = normalizeCatalogMarker(b.catalogMarker) - normalizeCatalogMarker(a.catalogMarker);
      if (markerOrder) return markerOrder;
      const recentOrder = catalogTimestamp(b, "updatedAt") - catalogTimestamp(a, "updatedAt");
      if (recentOrder) return recentOrder;
      return 0;
    }
    if (mode === "name") return collator.compare(a.name || "", b.name || "") || collator.compare(a.id || "", b.id || "");
    // The persisted "recent" key predates the user-facing Changed label.
    // Changed means authored edits, not selection/use. Including lastUsedAt
    // makes a click appear to reorder the catalog after the next refresh.
    const field = mode === "created" ? "createdAt" : "updatedAt";
    const aTime = catalogTimestamp(a, field);
    const bTime = catalogTimestamp(b, field);
    return bTime - aTime || collator.compare(a.name || "", b.name || "") || collator.compare(a.id || "", b.id || "");
  });
}

export function catalogMarkerButtonTemplate(item = {}, kind = "component") {
  const meta = catalogMarkerMeta(item.catalogMarker);
  return `<button type="button" class="catalog-marker-toggle marker-${meta.marker}" data-cycle-catalog-marker="${esc(kind)}" data-catalog-marker-id="${esc(item.id || "")}" title="${meta.label}; click to mark ${meta.nextLabel}" aria-label="${meta.label}; click to mark ${meta.nextLabel}">${icon(meta.icon)}</button>`;
}

function catalogTimestamp(item = {}, field = "updatedAt") {
  const value = item[field] || item.activity?.[field];
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
