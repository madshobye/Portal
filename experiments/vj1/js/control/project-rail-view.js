import { componentCatalogSearchText } from "./catalog-view.js";
import { getLiveSourceTarget, ordinaryComponents } from "./control-selectors.js";
import { liveProgramNavigableComponents, liveSignificantParameterAssignments } from "./mapping-live-view.js";
import { liveSurfaceVisible } from "../domain/live-ui-state.js";
import { componentTypeIcon, UI_ICONS } from "./ui-icons.js";
import { catalogMarkerMeta } from "../domain/catalog-marker.js";
import { liveSourceHasParameterDiffs } from "../domain/live-parameter-diffs.js";

export function liveProjectionListModel(state) {
  const mapping = state.mappings?.find((item) => String(item.id) === String(state.ui?.selectedMappingId || ""))
    || state.mappings?.[0]
    || null;
  const sceneMappingVisible = state.ui?.live?.sceneMappingVisible !== false;
  const surfaces = mapping?.surfaces || [];
  const requestedSelectedId = String(state.ui?.live?.previewSurfaceId || "__mapping__");
  const selectedId = requestedSelectedId;
  const sourceTarget = getLiveSourceTarget(state);
  const overallTarget = state.components?.find((component) =>
    !component.systemRole && String(component.id) === String(state.ui?.live?.selectedComponentId || "")
  ) || state.components?.find((component) =>
    component.type === "scene" && String(component.id) === String(state.ui?.live?.selectedSceneId || "")
  );
  const overallHasSource = state.ui?.live?.overallSourceCleared !== true && Boolean(overallTarget);
  const components = liveProgramNavigableComponents(state);
  const outputItem = ({ id, label, visible, iconName, clearAction = "" }) => ({
    id,
    label,
    presentation: "live-output-row",
    selectPresentation: "list-select",
    actions: [{
      id: "toggle-visibility",
      label: `${visible ? "Hide" : "Show"} ${label}`,
      icon: visible ? iconName : "hide_source",
      presentation: visible ? "enabled-toggle" : "disabled-toggle",
      position: "leading",
    }, ...(clearAction ? [{
      id: clearAction,
      label: clearAction === "clear-overall" ? "Clear Overall source" : "Clear custom source",
      icon: "close",
      presentation: "list-remove",
      variant: "remove",
    }] : [])],
  });
  const outputItems = [outputItem({
    id: "__mapping__",
    label: "Scene Mapping",
    visible: sceneMappingVisible,
    iconName: "crop_free",
    clearAction: sceneMappingVisible && overallHasSource ? "clear-overall" : "",
  }), ...surfaces.map((surface) => {
    const direct = surface.destination?.type === "direct";
    const visible = liveSurfaceVisible(surface, state.ui?.live);
    return outputItem({
      id: String(surface.id),
      label: surface.name || "Surface",
      visible,
      iconName: direct ? "desktop_windows" : "crop_free",
      clearAction: state.ui?.live?.surfacePatches?.[surface.id] ? "clear-patch" : "",
    });
  })];
  const componentItems = components.map((component) => {
    const fallbackIcon = componentTypeIcon(component);
    return {
      id: String(component.id || ""),
      label: String(component.name || "Component"),
      labelIcon: fallbackIcon,
      thumbnail: {
        src: String(component.thumbnail || ""),
        fallback: fallbackIcon,
        key: `${component.id}:`,
      },
    };
  });
  return {
    outputItems,
    selectedOutputId: selectedId,
    componentItems,
    selectedComponentId: String(state.ui?.live?.inspectedComponentId || ""),
    hasSignificant: liveSignificantParameterAssignments(state, Number.MAX_SAFE_INTEGER).length > 0,
    componentStateAddress: `live-scene-components/${sourceTarget?.id || "none"}`,
  };
}

export function mappingCatalogListItems(mappings = []) {
  return (mappings || []).map((mapping) => ({
    id: String(mapping.id || ""),
    label: String(mapping.name || "Mapping"),
    searchText: String(mapping.name || "").toLowerCase(),
    presentation: "mapping-row",
    selectPresentation: "list-select",
    media: { fallback: UI_ICONS.mapping },
    actions: [{
      id: "remove",
      label: "Remove mapping",
      icon: "close",
      presentation: "list-remove",
    }],
  }));
}

export function componentCatalogListItems(components = [], state = {}) {
  return (components || []).map((component) => {
  const fallbackIcon = componentTypeIcon(component);
  const removeDisabled = component.type !== "scene"
    ? ordinaryComponents(state).length <= 1
    : state.components.length <= 1;
    const marker = catalogMarkerMeta(component.catalogMarker);
    return {
      id: String(component.id || ""),
      label: String(component.name || "Component"),
      searchText: componentCatalogSearchText(component, state),
      labelIcon: fallbackIcon,
      thumbnail: {
        src: String(component.thumbnail || ""),
        fallback: fallbackIcon,
        key: `${component.id}:`,
      },
      actions: [{
        id: "marker",
        label: `${marker.label}; click to mark ${marker.nextLabel}`,
        icon: marker.icon,
        variant: `marker-${marker.marker}`,
      }, {
        id: "remove",
        label: "Remove",
        icon: "close",
        variant: "remove",
        disabled: removeDisabled,
      }],
    };
  });
}

export function liveSourceListItems(sources = [], state = {}) {
  const live = state.ui?.live || {};
  return (sources || []).map((source) => {
    const fallbackIcon = componentTypeIcon(source);
    const marker = catalogMarkerMeta(source.catalogMarker);
    const hasOverrides = liveSourceHasParameterDiffs(live, source.id);
    return {
      id: String(source.id || ""),
      label: String(source.name || "Source"),
      searchText: componentCatalogSearchText(source, state),
      labelIcon: fallbackIcon,
      thumbnail: {
        src: String(source.thumbnail || ""),
        fallback: fallbackIcon,
        key: `${source.id}:`,
      },
      actions: [{
        id: "marker",
        label: `${marker.label}; click to mark ${marker.nextLabel}`,
        icon: marker.icon,
        variant: `marker-${marker.marker}`,
      }, ...(hasOverrides ? [{
        id: "reset",
        label: "Reset temporary settings",
        icon: UI_ICONS.reset,
        variant: "reset",
      }] : [])],
    };
  });
}

export function selectedLiveSourceId(state = {}) {
  const live = state.ui?.live || {};
  return String(live.previewSurfaceId && live.previewSurfaceId !== "__mapping__"
    ? live.patchSourceId || ""
    : (live.overallSourceCleared === true ? "" : live.selectedComponentId || live.selectedSceneId || ""));
}
