import { catalogMarkerMeta, sortCatalogItems } from "../domain/catalog-marker.js";
import { componentLayerProjection } from "../domain/component-layer-projection.js";

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

export function catalogSortIcon(mode = "recent") {
  return {
    recent: "history",
    marker: "keep",
    name: "sort_by_alpha",
    created: "add_circle",
  }[mode] || "history";
}

export function catalogMarkerAction(item = {}, kind = "component") {
  const meta = catalogMarkerMeta(item.catalogMarker);
  return {
    id: "cycle-marker",
    action: "catalog.marker-cycle",
    icon: meta.icon,
    label: `${meta.label}; mark ${meta.nextLabel}`,
    target: { kind, id: item.id || "" },
    presentation: `marker-${meta.marker}`,
  };
}
