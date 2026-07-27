export const CATALOG_MARKER_NONE = 0;
export const CATALOG_MARKER_STARRED = 1;
export const CATALOG_MARKER_HEARTED = 2;
export const CATALOG_MARKER_PINNED = 3;

export function normalizeCatalogMarker(value) {
  const marker = Math.round(Number(value) || 0);
  return [CATALOG_MARKER_STARRED, CATALOG_MARKER_HEARTED, CATALOG_MARKER_PINNED].includes(marker)
    ? marker
    : CATALOG_MARKER_NONE;
}

export function nextCatalogMarker(value) {
  return (normalizeCatalogMarker(value) + 1) % 4;
}

export function catalogMarkerMeta(value) {
  const marker = normalizeCatalogMarker(value);
  if (marker === CATALOG_MARKER_PINNED) return { marker, icon: "keep", label: "Pinned", nextLabel: "unmarked" };
  if (marker === CATALOG_MARKER_HEARTED) return { marker, icon: "favorite", label: "Favorite", nextLabel: "pinned" };
  if (marker === CATALOG_MARKER_STARRED) return { marker, icon: "star", label: "Starred", nextLabel: "favorite" };
  return { marker, icon: "star_outline", label: "Unmarked", nextLabel: "starred" };
}

export function sortCatalogItems(items = [], mode = "recent") {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return items.slice().sort((a, b) => {
    // Pins are authored placement and remain above every other marker under
    // each catalog ordering.
    const pinnedOrder = Number(normalizeCatalogMarker(b.catalogMarker) === CATALOG_MARKER_PINNED)
      - Number(normalizeCatalogMarker(a.catalogMarker) === CATALOG_MARKER_PINNED);
    if (pinnedOrder) return pinnedOrder;
    if (mode === "marker") {
      const markerOrder = normalizeCatalogMarker(b.catalogMarker)
        - normalizeCatalogMarker(a.catalogMarker);
      if (markerOrder) return markerOrder;
      const recentOrder = catalogTimestamp(b, "updatedAt")
        - catalogTimestamp(a, "updatedAt");
      if (recentOrder) return recentOrder;
      return 0;
    }
    if (mode === "name") {
      return collator.compare(a.name || "", b.name || "")
        || collator.compare(a.id || "", b.id || "");
    }
    const field = mode === "created" ? "createdAt" : "updatedAt";
    const aTime = catalogTimestamp(a, field);
    const bTime = catalogTimestamp(b, field);
    return bTime - aTime
      || collator.compare(a.name || "", b.name || "")
      || collator.compare(a.id || "", b.id || "");
  });
}

function catalogTimestamp(item = {}, field = "updatedAt") {
  const value = item[field] || item.activity?.[field];
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
