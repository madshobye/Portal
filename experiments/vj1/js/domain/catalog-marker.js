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
