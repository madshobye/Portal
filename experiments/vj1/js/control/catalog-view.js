import { esc, icon } from "./template-utils.js?v=slider-values-70";

export function componentFilterTemplate(placeholder = "Filter components") {
  return `<label class="component-filter-field">${icon("search")}<input type="search" data-component-filter placeholder="${esc(placeholder)}" autocomplete="off" /></label>`;
}

export function componentCatalogToolsTemplate(scope, activeMode = "recent", placeholder = "Filter components") {
  const modes = [
    ["recent", "Changed", "history"],
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

function catalogTimestamp(item = {}, field = "updatedAt") {
  const value = item[field] || item.activity?.[field];
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
