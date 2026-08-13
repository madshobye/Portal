import {
  ButtonNode,
  CatalogPickerNode,
  CollectionNode,
  ColorPickerNode,
  compileUiModel,
  defineUiGraph,
  LayoutNode,
  HostRegionNode,
  ModalNode,
  PanelNode,
  PopupNode,
  RangeUiNode,
  SelectUiNode,
  SliderUiNode,
  TextInputNode,
  TextNode,
  TabsNode,
  ToggleNode,
  WorkspaceShellNode,
  GlobalInputNode,
  FileDownloadNode,
  ClipboardNode,
  WindowOpenNode,
  DiagnosticsNode,
  PreviewSurfaceNode,
  PresentationHudNode,
  MetricsSummaryNode,
  AnalysisReportNode,
  LibraryCatalogNode,
  NodeDefinitionStudioNode,
  NodeGraphEditorNode,
  NodeDefinitionEditorNode,
  ParameterAnimationEditorNode,
  ListNode,
  parameterUiGraph,
  parameterUiNodes,
  createParameterInspectorModel,
  createThumbnailCatalogGraphNode,
  createThumbnailCatalogModel,
} from "../libraries/ui-engine/index.js";
import { createTransitionCatalog } from "../libraries/transition-engine/index.js";
import { DefaultBuiltInTransition } from "../libraries/visual-nodes/catalog.js";
import { getSelectedMapping } from "./control-selectors.js";
import { UI_ICONS } from "./ui-icons.js";
import { liveSignificantAssignmentValue, liveSignificantParameterAssignments } from "./mapping-live-view.js";
import {
  CHAIN_BOUNDARY_SCALE_PARAM,
  CHAIN_COMPOSITE_PARAMS,
  chainBoundaryPositionParams,
  chainRenderQualityTarget,
  chainTransformParams,
} from "./parameter-view.js";
import { RENDER_QUALITY_PARAM, normalizeParamValue } from "../libraries/visual-nodes/shared/component-schema.js";
import { nodeBoundaryUniformScale, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import { componentParameterAddressForPath } from "../domain/component-layer-projection.js";
import { screenCaptureStatus } from "../libraries/device-engine/index.js";
import { BLEND_MODES } from "../constants.js";
import { catalogSortIcon } from "./catalog-view.js";

export { catalogSortIcon } from "./catalog-view.js";

const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];
const PARAMETER_TAB_FLOW_LAYOUT = Object.freeze({
  fill: false,
  grow: 0,
  shrink: 0,
  basis: "auto",
  overflow: "visible",
});
const PARAMETER_TAB_FILL_LAYOUT = Object.freeze({
  fill: true,
  grow: 1,
  shrink: 1,
  basis: 0,
  overflow: "visible",
});

export function nodesWorkspaceStudioUiGraph(model = {}) {
  const definition = declarativeUiValue(model.definition);
  const nodes = [{
    id: "node-definition-studio",
    type: NodeDefinitionStudioNode.id,
    stateAddress: "workspaces/nodes/studio",
    inputs: {
      definition,
      contextLabel: model.contextLabel,
      emptyText: "No registered nodes",
    },
  }];
  if (model.graph) nodes.push({
    id: "node-graph-editor",
    type: NodeGraphEditorNode.id,
    parent: "node-definition-studio",
    slot: "graph",
    stateAddress: `workspaces/nodes/graphs/${safeUiId(model.target?.id || model.definition?.id || "selected")}`,
    inputs: {
      definition,
      options: model.graphOptions || {},
    },
    commands: {
      "graph-change": "nodes.graph-change",
      status: "nodes.graph-status",
      "media-request": "nodes.graph-media-request",
      "public-parameter-toggle": "nodes.graph-public-parameter-toggle",
      "public-port-toggle": "nodes.graph-public-port-toggle",
    },
  });
  return defineUiGraph({ id: "vj1.control.nodes-workspace-studio", nodes });
}

function declarativeUiValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return undefined;
  if (Array.isArray(value)) return value.map((item) => declarativeUiValue(item, seen)).filter((item) => item !== undefined);
  if (typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    const next = declarativeUiValue(entry, seen);
    if (next !== undefined) projected[key] = next;
  }
  seen.delete(value);
  return projected;
}

export function nodeDefinitionInspectorUiGraph(model, {
  id = "vj1.control.node-definition-inspector",
  stateAddress = "workspaces/nodes/inspector/editor",
} = {}) {
  return defineUiGraph({
    id,
    nodes: [{
      id: "node-definition-editor",
      type: NodeDefinitionEditorNode.id,
      stateAddress,
      inputs: { model },
      commands: {
        save: "nodes.editor-save",
        reset: "nodes.editor-reset",
      },
    }],
  });
}

export function catalogPickerUiGraph(model, { id = "vj1.control.catalog-picker" } = {}) {
  return defineUiGraph({
    id,
    nodes: [{
      id: "catalog-picker",
      type: CatalogPickerNode.id,
      stateAddress: model?.stateAddress || `pickers/${safeUiId(id)}`,
      inputs: model || {},
      commands: {
        close: "picker.close",
        select: "picker.select",
        action: "picker.action",
        filter: "picker.filter",
        search: "picker.search",
      },
    }],
  });
}

export function previewToolsUiGraph(state, { workspace = "mapping", kind = "preview" } = {}) {
  const supportsQuality = ["component", "scene", "mapping", "live"].includes(workspace);
  const quality = ["auto", "good", "low"].includes(state?.ui?.previewQuality)
    ? state.ui.previewQuality
    : "good";
  const qualityLabel = { auto: "Auto", good: "Good", low: "Low" }[quality];
  const qualitySubject = {
    component: "Component",
    scene: "Scene",
    live: "Live",
    mapping: "Mapping",
  }[workspace] || "Preview";
  const slots = ["zoom-out", "fit-world", "fit-frame", "zoom-in", "diagnostics", "quality", "handles", "hud"]
    .map((slotId) => ({
      id: slotId,
      presentation: slotId === "hud" ? "preview-hud-slot" : "preview-tool-slot",
      grow: 0,
      shrink: 0,
      basis: "auto",
    }));
  const button = (buttonId, label, iconName, action, extra = {}) => ({
    id: `preview-${buttonId}`,
    type: ButtonNode.id,
    parent: "preview-tools-layout",
    slot: buttonId,
    inputs: {
      label,
      icon: iconName,
      iconOnly: extra.iconOnly !== false,
      presentation: String(extra.presentation || "preview-tool"),
      hidden: extra.hidden === true,
      buttonLabel: extra.buttonLabel || "",
      commandPayload: extra.commandPayload || {},
    },
    commands: { activate: action },
  });
  return defineUiGraph({
    id: "vj1.control.preview-tools",
    nodes: [{
      id: "preview-tools-layout",
      type: HostRegionNode.id,
      inputs: { orientation: "row", presentation: "preview-tools", slots },
    },
    button("zoom-out", "Zoom out", "remove", "preview.zoom", { commandPayload: { multiplier: 1 / 1.2 } }),
    button("fit-world", "Fit world", "public", "preview.fit-world"),
    button("fit-frame", "Fit outputs", "fit_screen", "preview.fit-frame"),
    button("zoom-in", "Zoom in", "add", "preview.zoom", { commandPayload: { multiplier: 1.2 } }),
    button("diagnostics", "Preview scaling diagnostics", "developer_mode", "preview.toggle-diagnostics", {
      presentation: state?.ui?.previewDiagnostics === true ? "preview-tool-active" : "preview-tool",
    }),
    button("quality", `${qualitySubject} preview resolution: ${qualityLabel}`, "", "preview.cycle-quality", {
      iconOnly: false,
      buttonLabel: qualityLabel,
      presentation: quality !== "auto" ? "preview-quality-active" : "preview-quality",
      hidden: !supportsQuality,
    }),
    button("handles", "Toggle mapping handles", "control_point_duplicate", "preview.toggle-mapping-handles", {
      presentation: state?.global?.mappingHandleMode !== "near" ? "preview-tool-active" : "preview-tool",
      hidden: kind !== "preview",
    }),
    {
      id: "preview-hud",
      type: PresentationHudNode.id,
      parent: "preview-tools-layout",
      slot: "hud",
      inputs: { presentation: "preview" },
    }],
  });
}

export function previewSurfaceUiGraph({ empty = false, emptyText = "Open a project to begin" } = {}) {
  return defineUiGraph({
    id: "vj1.control.preview-surface",
    nodes: [{
      id: "preview-surface",
      type: PreviewSurfaceNode.id,
      inputs: { empty, emptyText },
    }],
  });
}

export function componentCatalogUiGraph({ items = [], selectedId = "", sortMode = "recent", projectId = "unopened" } = {}) {
  return compileUiModel(componentCatalogUiModel({ items, selectedId, sortMode, projectId }), {
    id: "vj1.control.component-catalog",
  });
}

export function nodesRailUiGraph(model = {}) {
  return defineUiGraph({
    id: "vj1.control.nodes-rail",
    nodes: [{
      id: "nodes-library",
      type: LibraryCatalogNode.id,
      stateAddress: "workspaces/nodes/library",
      inputs: model,
      commands: {
        select: "nodes.library-select",
        action: "nodes.library-action",
        search: "nodes.library-search",
        drag: "nodes.library-drag",
      },
    }],
  });
}

export function componentCatalogUiModel({ items = [], selectedId = "", sortMode = "recent", projectId = "unopened" } = {}) {
  const modes = ["recent", "marker", "name", "created"];
  const activeIndex = Math.max(0, modes.indexOf(sortMode));
  const nextMode = modes[(activeIndex + 1) % modes.length];
  return {
    id: "component-rail",
    type: "host-region",
    orientation: "column",
    children: [thumbnailCatalogUiModel({
      id: "catalog",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/component-catalog`,
      title: "Components",
      icon: UI_ICONS.component,
      items,
      selectedId,
      emptyText: "Create visual recipes",
      noResultsText: "No matching components",
      searchPlaceholder: "Filter components",
      addLabel: "Add component",
      sortMode: modes[activeIndex],
      nextSortMode: nextMode,
      commands: {
        select: "component.select",
        itemAction: "component.item-action",
        itemContext: "component.item-context",
        action: "component.catalog-action",
        search: "component.catalog-search",
      },
    })],
  };
}

export function sceneRailUiGraph(state, { items = [], sortMode = "recent", projectId = "unopened" } = {}) {
  return compileUiModel(sceneRailUiModel(state, { items, sortMode, projectId }), {
    id: "vj1.control.scene-rail",
  });
}

export function sceneRailUiModel(state, { items = [], sortMode = "recent", projectId = "unopened" } = {}) {
  const selectedMappingId = String(getSelectedMapping(state)?.id || "unselected");
  const modes = ["recent", "marker", "name", "created"];
  const activeIndex = Math.max(0, modes.indexOf(sortMode));
  const nextMode = modes[(activeIndex + 1) % modes.length];
  return {
    id: "scene-rail",
    type: "host-region",
    orientation: "column",
    children: [{
      ...thumbnailCatalogUiModel({
      id: "scenes",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/scene-catalog`,
      title: "Scenes",
      icon: UI_ICONS.scene,
      items,
      selectedId: state.ui?.selectedComponentId || "",
      emptyText: "Create a scene",
      noResultsText: "No matching scenes",
      searchPlaceholder: "Filter scenes",
      pasteScope: "scene-list",
      addLabel: "Add scene",
      sortMode: modes[activeIndex],
      nextSortMode: nextMode,
      commands: {
        select: "component.select",
        itemAction: "component.item-action",
        itemContext: "component.item-context",
        action: "scene.catalog-action",
        search: "scene.catalog-search",
      },
      }),
    }, {
      id: "surfaces",
      type: "collection",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/mappings/${encodeURIComponent(selectedMappingId)}/surfaces`,
      title: "Surfaces",
      icon: UI_ICONS.surface,
      items: sceneSurfaceListItems(state),
      selectedId: state.ui?.selectedSurfaceId || "",
      emptyText: "Add a surface",
      searchable: false,
      reorderable: true,
      pasteScope: "surface-list",
      presentation: "scene-surface-collection",
      listPresentation: "surface-pills",
      layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
      headerActions: [{ id: "add", label: "Add surface", icon: "add" }],
      onSelect: "surface.select",
      onItemAction: "surface.item-action",
      onAction: "surface.catalog-action",
      onReorder: "surface.reorder",
    }],
  };
}

export function thumbnailCatalogUiModel({
  id,
  stateAddress,
  title,
  icon,
  items = [],
  selectedId = "",
  emptyText = "No items",
  noResultsText = "No matching items",
  searchPlaceholder = "Filter items",
  pasteScope = "",
  addLabel = "Add item",
  sortMode = "recent",
  nextSortMode = "marker",
  commands = {},
} = {}) {
  return createThumbnailCatalogModel({
    id,
    stateAddress,
    title,
    icon,
    items,
    selectedId,
    emptyText,
    noResultsText,
    searchPlaceholder,
    pasteScope,
    headerActions: [{ id: "add", label: addLabel, icon: "add" }],
    toolActions: [{
      id: `sort:${nextSortMode}`,
      label: `Sorted by ${sortMode}; click to sort by ${nextSortMode}`,
      icon: catalogSortIcon(sortMode),
    }],
    commands,
  });
}

export function sceneSurfaceListItems(state) {
  const authored = new Map((getSelectedMapping(state)?.surfaces || []).map((surface) => [String(surface.id), surface]));
  return surfaceListItems(state.surfaces || [], authored);
}

export function mappingRailUiGraph(state, { items = [], sortMode = "recent", projectId = "unopened" } = {}) {
  const mapping = getSelectedMapping(state);
  const mappingIndex = state.mappings?.findIndex((candidate) => candidate.id === mapping?.id) ?? -1;
  const modes = ["recent", "marker", "name", "created"];
  const activeIndex = Math.max(0, modes.indexOf(sortMode));
  const nextMode = modes[(activeIndex + 1) % modes.length];
  const surfaceItems = mapping ? [{
    id: "__scene_mapping__",
    label: "Scene Mapping",
    disabled: true,
    presentation: "scene-mapping-row",
    selectPresentation: "list-select",
    actions: [{
      id: "toggle-scene-mapping",
      label: state.ui?.live?.sceneMappingInLive !== false ? "Disable Scene Mapping" : "Enable Scene Mapping",
      icon: state.ui?.live?.sceneMappingInLive !== false ? "crop_free" : "hide_source",
      presentation: state.ui?.live?.sceneMappingInLive !== false ? "enabled-toggle" : "disabled-toggle",
      position: "leading",
    }],
  }, ...surfaceListItems(mapping.surfaces || [])] : [];
  return defineUiGraph({
    id: "vj1.control.mapping-rail",
    nodes: [{
      id: "mapping-rail-layout",
      type: HostRegionNode.id,
      inputs: {
        orientation: "column",
        presentation: "mapping-rail",
        slots: ["mappings", "surfaces"],
      },
    }, {
      id: "mapping-collection",
      type: CollectionNode.id,
      parent: "mapping-rail-layout",
      slot: "mappings",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/mapping-catalog`,
      inputs: {
        title: "Mappings",
        icon: UI_ICONS.mapping,
        items,
        selectedId: state.ui?.selectedMappingId || "",
        emptyText: "Add a mapping",
        noResultsText: "No matching mappings",
        searchPlaceholder: "Filter mappings",
        presentation: "mapping-collection",
        listPresentation: "mapping-list",
        pasteScope: "mapping-list",
        headerActions: [{ id: "add", label: "Add mapping", icon: "add" }],
        toolActions: [{
          id: `sort:${nextMode}`,
          label: `Sorted by ${modes[activeIndex]}; click to sort by ${nextMode}`,
          icon: catalogSortIcon(modes[activeIndex]),
        }],
      },
      commands: {
        select: "mapping.select",
        itemAction: "mapping.item-action",
        action: "mapping.catalog-action",
        search: "mapping.catalog-search",
      },
    }, {
      id: "mapping-surface-collection",
      type: CollectionNode.id,
      parent: "mapping-rail-layout",
      slot: "surfaces",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/mapping-surfaces`,
      inputs: {
        title: mapping?.name || "Mapping",
        icon: UI_ICONS.surface,
        items: surfaceItems,
        selectedId: state.ui?.selectedSurfaceId || "",
        emptyText: mapping ? "Add a surface" : "Create a mapping to edit its Surfaces.",
        searchable: false,
        reorderable: Boolean(mapping),
        pasteScope: "surface-list",
        hasTitleSlot: Boolean(mapping),
        hasToolSlot: Boolean(mapping),
        presentation: "mapping-surface-collection",
        listPresentation: "surface-pills",
        headerActions: mapping ? [{ id: "add", label: "Add surface", icon: "add" }] : [],
      },
      commands: {
        select: "surface.select",
        itemAction: "surface.item-action",
        action: "surface.catalog-action",
        reorder: "surface.reorder",
      },
    }, ...(mapping ? [{
      id: "mapping-name",
      type: TextInputNode.id,
      parent: "mapping-surface-collection",
      slot: "title",
      stateAddress: `mappings.${mappingIndex}.name`,
      inputs: {
        label: "Mapping name",
        labelHidden: true,
        value: mapping.name,
        presentation: "mapping-name",
      },
      commands: { change: "project.set-value" },
    }, {
      id: "mapping-test-pattern",
      type: ToggleNode.id,
      parent: "mapping-surface-collection",
      slot: "tools",
      stateAddress: "ui.mappingTestPattern",
      inputs: {
        label: "Test pattern",
        value: state.ui?.mappingTestPattern !== false,
        icon: UI_ICONS.testPattern,
        iconOnly: false,
        presentation: "mapping-test-pattern",
      },
      commands: { change: "project.set-value" },
    }] : [])],
  });
}

export function liveRailUiGraph(state, { items = [], selectedId = "", sortMode = "recent", projectId = "unopened" } = {}) {
  const modes = ["recent", "marker", "name", "created"];
  const activeIndex = Math.max(0, modes.indexOf(sortMode));
  const nextMode = modes[(activeIndex + 1) % modes.length];
  const showScenes = state.ui?.live?.showScenes !== false;
  const showComponents = state.ui?.live?.showComponents === true;
  return defineUiGraph({
    id: "vj1.control.live-rail",
    nodes: [{
      id: "live-rail-layout",
      type: HostRegionNode.id,
      inputs: {
        orientation: "column",
        slots: [
          { id: "sources", fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
          { id: "timing", fill: true, grow: 0, shrink: 0, basis: "30%", overflow: "hidden" },
        ],
      },
    }, createThumbnailCatalogGraphNode({
      id: "live-source-collection",
      parent: "live-rail-layout",
      slot: "sources",
      stateAddress: `projects/${encodeURIComponent(String(projectId || "unopened"))}/live-sources`,
      title: "Sources",
      icon: UI_ICONS.live,
      items,
      selectedId,
      emptyText: "Create a Scene or Part first",
      noResultsText: "No matching sources",
      searchPlaceholder: "Filter sources",
      hasToolSlot: true,
      toolActions: [{
        id: `sort:${nextMode}`,
        label: `Sorted by ${modes[activeIndex]}; click to sort by ${nextMode}`,
        icon: catalogSortIcon(modes[activeIndex]),
      }],
      commands: {
        select: "live.source-select",
        itemAction: "live.source-action",
        itemContext: "component.item-context",
        action: "live.catalog-action",
        search: "live.catalog-search",
      },
    }), {
      id: "live-source-filter-layout",
      type: LayoutNode.id,
      parent: "live-source-collection",
      slot: "tools",
      inputs: {
        orientation: "row",
        sizing: "fill",
        gap: 6,
        presentation: "live-source-tabs",
        slots: [
          { id: "scenes", grow: 1, shrink: 1, basis: 0 },
          { id: "components", grow: 1, shrink: 1, basis: 0 },
        ],
      },
    }, {
      id: "live-source-scenes",
      type: ToggleNode.id,
      parent: "live-source-filter-layout",
      slot: "scenes",
      inputs: {
        label: "Scenes",
        value: showScenes,
        icon: UI_ICONS.scene,
        iconOnly: false,
        presentation: "live-source-toggle",
      },
      commands: { change: { action: "live.source-filter", payload: { kind: "scenes" } } },
    }, {
      id: "live-source-components",
      type: ToggleNode.id,
      parent: "live-source-filter-layout",
      slot: "components",
      inputs: {
        label: "Parts",
        value: showComponents,
        icon: UI_ICONS.component,
        iconOnly: false,
        presentation: "live-source-toggle",
      },
      commands: { change: { action: "live.source-filter", payload: { kind: "components" } } },
    }, {
      id: "live-timing-panel",
      type: PanelNode.id,
      parent: "live-rail-layout",
      slot: "timing",
      inputs: {
        title: "Live",
        icon: "tune",
        presentation: "live-timing",
      },
    }, {
      id: "live-reset-session",
      type: ButtonNode.id,
      parent: "live-timing-panel",
      slot: "header",
      inputs: {
        label: "Reset Live parameters",
        icon: UI_ICONS.reset,
        iconOnly: true,
        presentation: "live-reset",
      },
      commands: { activate: "live.reset-parameters" },
    }],
  });
}

export function liveProjectionRailUiGraph(model = {}) {
  return defineUiGraph({
    id: "vj1.control.live-projection-rail",
    nodes: [{
      id: "live-projection-layout",
      type: HostRegionNode.id,
      inputs: {
        orientation: "column",
        slots: ["output", "significant", "components"].map((id) => ({
          id,
          fill: true,
          grow: 1,
          shrink: 1,
          basis: 0,
          overflow: "hidden",
        })),
      },
    }, {
      id: "live-output-collection",
      type: CollectionNode.id,
      parent: "live-projection-layout",
      slot: "output",
      stateAddress: "live/projection/outputs",
      inputs: {
        title: "Output",
        icon: "view_column",
        items: model.outputItems || [],
        selectedId: model.selectedOutputId || "__mapping__",
        emptyText: "No output surfaces",
        searchable: false,
        presentation: "live-projection",
        listPresentation: "live-projection-list",
      },
      commands: {
        select: "live.output-select",
        itemAction: "live.output-action",
      },
    }, {
      id: "live-significant-panel",
      type: PanelNode.id,
      parent: "live-projection-layout",
      slot: "significant",
      inputs: {
        title: "Significant",
        icon: "tune",
        presentation: "live-significant",
      },
    }, createThumbnailCatalogGraphNode({
      id: "live-component-collection",
      parent: "live-projection-layout",
      slot: "components",
      stateAddress: model.componentStateAddress || "live-scene-components/none",
      title: "Components",
      icon: UI_ICONS.component,
      items: model.componentItems || [],
      selectedId: model.selectedComponentId || "",
      emptyText: "No Components",
      searchable: false,
      commands: { select: "live.inspect-component" },
    }), ...(model.hasSignificant === true ? [] : [{
      id: "live-significant-empty",
      type: TextNode.id,
      parent: "live-significant-panel",
      inputs: {
        text: "No significant parameters in the active outputs",
        tone: "muted",
      },
    }])],
  });
}

function surfaceListItems(projections, authoredById = null) {
  const authored = authoredById || new Map((projections || []).map((surface) => [String(surface.id), surface]));
  return (projections || []).map((projection) => {
    const surface = authored.get(String(projection.id)) || projection;
    const direct = surface.destination?.type === "direct";
    const enabled = surface.enabled !== false;
    return {
      id: String(surface.id || ""),
      label: String(surface.name || "Surface"),
      presentation: direct ? "direct-surface-row" : "surface-row",
      selectPresentation: "list-select",
      reorderable: true,
      actions: [{
        id: "toggle-enabled",
        label: enabled ? "Hide surface" : "Show surface",
        icon: enabled ? (direct ? "desktop_windows" : "crop_free") : "hide_source",
        presentation: enabled ? "enabled-toggle" : "disabled-toggle",
        position: "leading",
      }, ...direct ? [] : [{
        id: "remove",
        label: "Remove surface",
        icon: "close",
        presentation: "list-remove",
      }]],
    };
  });
}
const SETTINGS_TABS = Object.freeze([
  { id: "outputs", label: "Outputs" },
  { id: "inputs", label: "Inputs" },
  { id: "devices", label: "Devices" },
  { id: "rendering", label: "Rendering" },
]);

// VJ1 supplies only semantic regions and presentation classes. LayoutNode owns
// the DOM elements and can be replaced by another UI graph without changing
// store commands, renderer hosts, or the generic UI runtime.
export const VJ1_CONTROL_UI_GRAPH = defineUiGraph({
  id: "vj1.control.ui",
  version: 1,
  nodes: [{
    id: "application-shell",
    type: WorkspaceShellNode.id,
    stateAddress: "workspace/shell",
    inputs: { brand: "VJ" },
    commands: { action: "shell.action" },
  }, {
    id: "global-input",
    type: GlobalInputNode.id,
    parent: "application-shell",
    slot: "system",
    inputs: { mediaQuery: "(max-width: 860px)" },
    commands: {
      shortcut: "global.shortcut",
      interaction: "global.interaction",
      viewport: "global.viewport",
      lifecycle: "global.lifecycle",
    },
  }, {
    id: "file-download",
    type: FileDownloadNode.id,
    parent: "application-shell",
    slot: "system",
    inputs: {},
    commands: { complete: "download.complete", error: "download.error" },
  }, {
    id: "clipboard",
    type: ClipboardNode.id,
    parent: "application-shell",
    slot: "system",
    inputs: {},
    commands: {
      target: "clipboard.target",
      cut: "clipboard.cut",
      delete: "clipboard.delete",
      paste: "clipboard.paste",
    },
  }, {
    id: "window-open",
    type: WindowOpenNode.id,
    parent: "application-shell",
    slot: "system",
    inputs: {},
    commands: { complete: "window.complete", blocked: "window.blocked" },
  }, {
    id: "diagnostics",
    type: DiagnosticsNode.id,
    parent: "application-shell",
    slot: "diagnostics-summary",
    inputs: { title: "Diagnostics", level: "ok", counts: {}, entries: [] },
    commands: { clear: "diagnostics.clear", copy: "diagnostics.copy" },
  }, {
    id: "performance-summary",
    type: MetricsSummaryNode.id,
    parent: "application-shell",
    slot: "performance-summary",
    inputs: { readouts: [], categories: [], hotspots: [], emptyText: "Waiting for a renderer sample" },
    commands: { action: "performance.summary-action" },
  }, {
    id: "performance-report",
    type: AnalysisReportNode.id,
    parent: "application-shell",
    slot: "performance-results",
    inputs: { open: false },
    commands: { action: "performance.report-action", close: "performance.report-close" },
  }, {
    id: "workspace-layout",
    type: HostRegionNode.id,
    parent: "application-shell",
    slot: "workspace",
    stateAddress: "workspace/layout",
    inputs: {
      orientation: "grid",
      presentation: "workspace",
      slots: [
        {
          id: "project-rail",
          presentation: "workspace-project-rail",
          scrollKey: "project-rail:scene",
        },
        {
          id: "live-projection-rail",
          presentation: "workspace-live-rail",
          scrollKey: "live-projection-rail",
        },
        {
          id: "inspector",
          presentation: "workspace-inspector",
          scrollKey: "inspector:scene",
        },
        {
          id: "studio",
          presentation: "workspace-main",
        },
      ],
    },
  }],
});

export function settingsModalUiGraph(model) {
  return compileUiModel(model, { id: "vj1.control.settings" });
}

export function contextMenuUiGraph({ x = 0, y = 0, actions = [] } = {}) {
  const normalizedActions = (actions || []).filter((action) => action?.id && action?.label);
  const slots = normalizedActions.map((action) => safeUiId(`action-${action.id}`));
  return defineUiGraph({
    id: "vj1.control.context-menu",
    nodes: [{
      id: "context-popup",
      type: PopupNode.id,
      inputs: {
        open: true,
        title: "Context menu",
        headerHidden: true,
        closeOnOutside: true,
        role: "menu",
        position: { x, y, padding: 8 },
        presentation: "context-popup",
        contentPresentation: "context-popup-content",
      },
      commands: { close: "context-menu.close" },
    }, {
      id: "context-actions",
      type: LayoutNode.id,
      parent: "context-popup",
      slot: "content",
      inputs: {
        orientation: "column",
        presentation: "context-actions",
        slots,
      },
    }, ...normalizedActions.map((action, index) => ({
      id: `context-action-${safeUiId(action.id)}-${index}`,
      type: ButtonNode.id,
      parent: "context-actions",
      slot: slots[index],
      inputs: {
        label: action.label,
        buttonLabel: action.label,
        icon: String(action.icon || ""),
        iconOnly: false,
        presentation: action.danger ? "context-action-danger" : "context-action",
        commandPayload: { id: String(action.id) },
      },
      commands: { activate: "context-menu.action" },
    }))],
  });
}

export function parameterTabsUiGraph(model, {
  id = "vj1.control.parameter-tabs",
  live = false,
} = {}) {
  return compileUiModel(parameterTabsUiModel(model, { live }), { id });
}

export function parameterTabsUiModel(model, { live = false } = {}) {
  const views = model?.views || [];
  return createParameterInspectorModel({
    id: "parameter-tabs",
    stateAddress: model?.stateAddress || "parameters/unknown/tabs",
    presentation: live ? "live-parameter-tabs" : "parameter-tabs",
    tabListPresentation: "parameter-tab-list",
    panelsPresentation: "parameter-tab-panels",
    tabs: views.map((view) => ({
      id: view.id,
      label: view.label,
      tabPresentation: "parameter-view-option",
      panelPresentation: `parameter-panel-${view.id}`,
      scrollKey: `${live ? "live-" : ""}chain-params:${model?.component?.id || "unknown"}:${model?.nodeId || model?.item?.id || "unknown"}:${view.id}`,
      contentPresentation: "parameter-tab-content",
      children: view.nodeEditorModel ? [{
        id: "content",
        type: "node",
        nodeType: NodeDefinitionEditorNode.id,
        inputs: { model: view.nodeEditorModel },
        commands: {
          save: { action: "nodes.editor-save" },
          reset: { action: "nodes.editor-reset" },
        },
      }] : view.animationModel ? [{
        id: "animation-editor",
        type: "node",
        nodeType: ParameterAnimationEditorNode.id,
        inputs: { model: view.animationModel },
        commands: { edit: { action: "animation.edit" } },
      }] : view.id === "general" ? [parameterTabFillModel(live ? liveChainGeneralParameterUiModel({
        id: "general-parameters",
        state: model?.state,
        component: model?.component,
        item: model?.item,
        nodeId: model?.nodeId,
      }) : chainGeneralParameterUiModel({
        id: "general-parameters",
        item: model?.item,
        basePath: model?.path,
        component: model?.component,
        state: model?.state,
      }))] : [
        ...(view.models || []).map(parameterTabFlowModel),
        ...(view.parameterModel || (!live && view.videoModel)) ? [parameterTabFillModel(
          live
            ? liveChainContentParameterUiModel(view.parameterModel)
            : view.parameterModel
              ? chainContentParameterUiModel(view.parameterModel, {
                  leadingControls: chainVideoParameterDescriptors(view.videoModel),
                })
              : chainVideoControlsUiModel(view.videoModel)
        )] : [],
      ],
    })),
  });
}

function parameterTabFlowModel(model = {}) {
  return { ...model, layout: model.layout || PARAMETER_TAB_FLOW_LAYOUT };
}

function parameterTabFillModel(model = {}) {
  return { ...model, layout: model.layout || PARAMETER_TAB_FILL_LAYOUT };
}

export function liveComponentViewUiGraph(model) {
  const controls = model?.component
    ? liveComponentControlDescriptors(model.component, model.view, model.state)
    : [];
  return defineUiGraph({
    id: "vj1.control.live-component-view",
    nodes: [{
      id: "live-component-view-tabs",
      type: TabsNode.id,
      stateAddress: model?.stateAddress || "live/component/view",
      inputs: {
        selectedId: model?.selectedId || "controls",
        items: (model?.views || []).map((view) => ({
          id: view.id,
          label: view.label,
          tabPresentation: "live-component-view-option",
          panelPresentation: `live-component-view-panel-${view.id}`,
          scrollKey: `${model?.stateAddress || "live/component/view"}/${view.id}`,
        })),
        presentation: "live-component-view",
        tabListPresentation: "live-component-view-tabs",
        panelsPresentation: "live-component-view-panels",
      },
      commands: { select: "live.component-view-select" },
    }, ...parameterUiNodes({
      id: "live-component-public-controls",
      controls,
      parent: "live-component-view-tabs",
      slot: "controls",
      changeAction: "live.set-value",
      contextAction: "parameter.open-context-menu",
    }), {
      id: "live-component-elements",
      type: ListNode.id,
      parent: "live-component-view-tabs",
      slot: "elements",
      stateAddress: `${model?.stateAddress || "live/component/view"}/elements`,
      inputs: {
        items: model?.elements || [],
        selectedId: model?.elements?.find((item) => item.selected)?.id || "",
        label: `${model?.component?.name || "Component"} elements`,
        emptyText: "No elements",
        presentation: "element-list",
      },
      commands: {
        select: "live.element-select",
        action: "live.element-action",
      },
    }],
  });
}

export function artifactInspectorUiGraph(model = {}) {
  return compileUiModel(artifactInspectorUiModel(model), {
    id: "vj1.control.artifact-inspector",
  });
}

export function artifactInspectorUiModel(model = {}) {
  const targetId = String(model.targetId || "");
  const hasTarget = Boolean(targetId);
  const contentId = String(model.contentId || "content");
  const secondaryId = String(model.secondaryId || "secondary-content");
  return {
    id: "artifact-inspector",
    type: "host-region",
    orientation: "column",
    presentation: "artifact-inspector",
    children: [{
      id: "primary",
      layout: model.primaryLayout || { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
      type: "panel",
      title: String(model.title || "Inspector"),
      icon: String(model.icon || ""),
      media: model.media || null,
      headerPresentation: model.media ? "media" : "default",
      presentation: hasTarget ? "artifact-panel" : "artifact-panel-empty",
      titleBinding: model.titleAddress ? {
        label: `${model.kind || "Artifact"} name`,
        value: String(model.title || ""),
        address: String(model.titleAddress),
        stateAddress: String(model.titleAddress),
        action: "project.set-value",
        presentation: "artifact-title",
      } : null,
      headerActions: model.headerAction ? [{
        id: "action",
        label: String(model.headerAction.label || "Action"),
        icon: String(model.headerAction.icon || ""),
        presentation: "artifact-action",
        action: String(model.headerAction.action || "inspector.action"),
        payload: { targetId },
      }] : [],
      children: hasTarget ? (Array.isArray(model.contentChildren) ? model.contentChildren : [{
        id: contentId,
        type: "layout",
        orientation: "column",
        presentation: "artifact-content",
        label: `${model.kind || "Artifact"} content`,
      }]) : [{
        id: "empty",
        type: "text",
        text: String(model.emptyText || "Nothing selected"),
        tone: "muted",
      }],
    }, {
      id: secondaryId,
      slot: "secondary",
      layout: model.secondaryLayout || { fill: true, grow: 0, shrink: 1, basis: "auto", overflow: "auto" },
      type: "layout",
      orientation: "column",
      presentation: String(model.secondaryPresentation || "artifact-secondary"),
      label: `${model.kind || "Artifact"} secondary inspector`,
      children: Array.isArray(model.secondaryChildren) ? model.secondaryChildren : [],
    }],
    metadata: { contentId, secondaryId },
  };
}

export function mappingSurfaceInspectorUiGraph(surface, state) {
  const controls = mappingSurfaceControlDescriptors(surface, state);
  const mapping = getSelectedMapping(state);
  const mappingIndex = mapping ? state.mappings.findIndex((item) => item.id === mapping.id) : -1;
  const surfaceIndex = mapping?.surfaces?.findIndex((item) => item.id === surface?.id) ?? -1;
  const authoredSurface = mappingIndex >= 0 && surfaceIndex >= 0 ? mapping.surfaces[surfaceIndex] : null;
  const direct = authoredSurface?.destination?.type === "direct" || surface?.destination?.type === "direct";
  const nodes = [{
    id: "mapping-surface-panel",
    type: PanelNode.id,
    inputs: {
      icon: UI_ICONS.surface,
      title: surface?.name || "Surface",
      titleHidden: Boolean(surface && !direct),
    },
  }];
  if (!surface) {
    nodes.push({
      id: "mapping-surface-empty",
      type: TextNode.id,
      parent: "mapping-surface-panel",
      slot: "content",
      inputs: { text: "No surface", tone: "muted" },
    });
    return defineUiGraph({ id: "vj1.control.mapping-inspector", nodes });
  }
  const baseAddress = `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
  if (!direct) {
    nodes.push({
      id: "mapping-surface-title",
      type: TextInputNode.id,
      parent: "mapping-surface-panel",
      slot: "header",
      stateAddress: `${baseAddress}.name`,
      inputs: {
        label: "Surface name",
        labelHidden: true,
        commitMode: "commit",
        value: authoredSurface?.name || surface.name || "Surface",
      },
      commands: { change: "project.set-value" },
    });
  }
  const slots = [
    ...(!direct ? [{ id: "reset", presentation: "inspector-action-slot" }] : []),
  ];
  const parameterNodes = parameterUiNodes({
    id: "vj1.control.mapping-surface-parameters",
    controls: controls.map((control) => ({
      ...control,
      ...control.inputs,
      kind: control.type === SelectUiNode.id ? "enum" : "number",
      context: false,
    })),
    parent: "mapping-surface-controls",
    slot: "parameters",
    changeAction: "project.set-value",
    contextAction: "",
  });
  slots.push({ id: "parameters", presentation: "inspector-control-slot" });
  nodes.push({
    id: "mapping-surface-controls",
    type: LayoutNode.id,
    parent: "mapping-surface-panel",
    slot: "content",
    inputs: {
      orientation: "column",
      presentation: "inspector-controls",
      sizing: "content",
      slots,
    },
  });
  if (!direct) {
    nodes.push({
      id: "mapping-surface-reset",
      type: ButtonNode.id,
      parent: "mapping-surface-controls",
      slot: "reset",
      inputs: {
        label: "Reset surface",
        icon: UI_ICONS.reset,
        commandPayload: { surfaceId: surface.id },
      },
      commands: { activate: "mapping.reset-surface" },
    });
  }
  nodes.push(...parameterNodes);
  return defineUiGraph({ id: "vj1.control.mapping-inspector", nodes });
}

export function sceneSurfaceInspectorUiModel(surface, state) {
  const mapping = getSelectedMapping(state);
  const mappingIndex = mapping ? state.mappings.findIndex((item) => item.id === mapping.id) : -1;
  const surfaceIndex = mapping?.surfaces?.findIndex((item) => item.id === surface?.id) ?? -1;
  const authoredSurface = mappingIndex >= 0 && surfaceIndex >= 0 ? mapping.surfaces[surfaceIndex] : null;
  if (!surface || !authoredSurface) return null;
  const direct = authoredSurface.destination?.type === "direct";
  const baseAddress = `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
  const flowLayout = { grow: 0, shrink: 0, basis: "auto", overflow: "visible" };
  const controls = [
    { id: "x", type: "number", label: "Scene X", min: 0, max: 1, step: 0.001, precision: 3 },
    { id: "y", type: "number", label: "Scene Y", min: 0, max: 1, step: 0.001, precision: 3 },
    { id: "width", type: "number", label: "Scene width", min: 0.001, max: 1, step: 0.001, precision: 3 },
    { id: "height", type: "number", label: "Scene height", min: 0.001, max: 1, step: 0.001, precision: 3 },
    { id: "keepProportions", type: "boolean", label: "Keep proportions" },
    { id: "projectionFit", type: "enum", label: "Fit", options: PROJECTION_FIT_MODES },
  ];
  return {
    id: "scene-surface-panel",
    type: "panel",
    presentation: "scene-surface-panel",
    layout: flowLayout,
    icon: UI_ICONS.surface,
    title: authoredSurface.name || surface.name || "Surface",
    titleBinding: direct ? null : {
      label: "Surface name",
      commitMode: "commit",
      value: authoredSurface.name || surface.name || "Surface",
      address: `${baseAddress}.name`,
      stateAddress: `${baseAddress}.name`,
      action: "project.set-value",
      presentation: "artifact-title",
    },
    children: [{
      id: "scene-surface-note",
      type: "text",
      text: "Surface · move and scale its 2D rectangle in the Scene preview; calibrate its projection in Mapping.",
      tone: "muted",
      presentation: "inspector-note",
      layout: flowLayout,
    }, {
      id: "scene-surface-controls",
      type: "parameters",
      orientation: "column",
      presentation: "scene-surface-controls",
      layout: flowLayout,
      changeAction: "project.set-value",
      contextAction: "",
      controls: controls.map((control) => ({
        ...control,
        address: `${baseAddress}.${control.id}`,
        stateAddress: `${baseAddress}.${control.id}`,
        value: authoredSurface[control.id],
        presentation: "parameter",
        context: false,
        layout: flowLayout,
      })),
    }],
  };
}

export function sceneSurfaceInspectorUiGraph(surface, state) {
  const model = sceneSurfaceInspectorUiModel(surface, state);
  return model
    ? compileUiModel(model, { id: "vj1.control.scene-surface-inspector" })
    : defineUiGraph({ id: "vj1.control.scene-surface-inspector", nodes: [] });
}

export function liveTimingUiGraph(state, transitionEntries = []) {
  const transitions = createTransitionCatalog(transitionEntries).list();
  const transitionId = String(state.ui?.live?.transitionId || DefaultBuiltInTransition.id);
  const selectedTransition = transitions.find((item) => item.id === transitionId)
    || transitions.find((item) => item.id === DefaultBuiltInTransition.id)
    || transitions[0]
    || DefaultBuiltInTransition;
  const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
  const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
  const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
  const controls = [{
    id: "live-transition-style",
    type: SelectUiNode.id,
    address: "ui.live.transitionId",
    inputs: {
      label: "Transition style",
      value: selectedTransition.id,
      options: transitions.map((item) => ({ value: item.id, label: item.name })),
    },
  }, ...transitionUiControlDescriptors(selectedTransition, state.ui?.live?.transitionParameters || {}), {
    id: "live-time-stretch",
    type: SliderUiNode.id,
    address: "global.timeStretch",
    inputs: {
      label: "Time stretch",
      value: timeStretch,
      min: -4,
      max: 4,
      step: 0.01,
      precision: 2,
      format: {
        kind: "power",
        base: 2,
        zeroAtMin: true,
        precision: 2,
        smallPrecision: 3,
        smallThreshold: 0.1,
        separator: " · ",
        suffix: "×",
      },
    },
  }, {
    id: "live-transition-duration",
    type: SliderUiNode.id,
    address: "ui.live.transitionDuration",
    inputs: { label: "Transition", value: transitionDuration, min: 0, max: 10, step: 0.1, precision: 1, suffix: " s" },
  }, {
    id: "live-param-fade-duration",
    type: SliderUiNode.id,
    address: "ui.live.paramFadeDuration",
    inputs: { label: "Param fade", value: paramFadeDuration, min: 0, max: 10, step: 0.05, precision: 2, suffix: " s" },
  }];
  return parameterUiGraph({
    id: "vj1.control.live-timing",
    controls: controls.map((control) => ({
      ...control,
      ...control.inputs,
      kind: parameterKindForNodeType(control.type),
      context: false,
    })),
    changeAction: "project.set-value",
    contextAction: "",
  });
}

export function liveSignificantUiGraph(state) {
  const controls = liveSignificantParameterAssignments(state, Number.MAX_SAFE_INTEGER)
    .flatMap((assignment, index) => {
      const component = state.components?.find((candidate) => String(candidate.id) === String(assignment.componentId));
      if (!component) return [];
      const value = Number(liveSignificantAssignmentValue(assignment, component, state));
      if (!Number.isFinite(value)) return [];
      const animation = assignment.kind === "animation";
      const target = animation
        ? {
            componentId: component.id,
            targetNodeId: assignment.targetNodeId,
            trackId: assignment.trackId,
            field: assignment.field,
          }
        : {
            componentId: component.id,
            nodeId: assignment.nodeId || "",
            path: assignment.path,
          };
      return [{
        id: `live-significant-${index}-${safeUiId(assignment.id)}`,
        address: animation
          ? `live/components/${encodeURIComponent(component.id)}/animation/${encodeURIComponent(assignment.trackId)}/${encodeURIComponent(assignment.field)}`
          : `live/components/${encodeURIComponent(component.id)}/nodes/${encodeURIComponent(assignment.nodeId || "root")}/${encodeURIComponent(assignment.path)}`,
        target,
        action: animation ? "live.set-animation-value" : "live.set-value",
        inputs: {
          label: assignment.name,
          value,
          min: Number(assignment.min),
          max: Number(assignment.max),
          step: Number(assignment.step) || 0.01,
          scale: assignment.scale === "log" ? "log" : "linear",
        },
      }];
    });
  return parameterUiGraph({
    id: "vj1.control.live-significant",
    controls: controls.map((control) => ({
      ...control,
      ...control.inputs,
      kind: "number",
      context: false,
    })),
    contextAction: "",
  });
}

export function chainGeneralParameterUiGraph({
  id = "vj1.control.chain-general",
  item,
  basePath,
  component,
  state,
} = {}) {
  if (!item || !basePath) return parameterUiGraph({ id, controls: [] });
  const controls = chainGeneralParameterDescriptors({ item, basePath, component, state });
  return parameterUiGraph({
    id,
    controls,
    changeAction: "project.set-value",
    contextAction: "parameter.open-context-menu",
  });
}

export function chainGeneralParameterUiModel({
  id = "general-parameters",
  item,
  basePath,
  component,
  state,
} = {}) {
  return {
    id,
    type: "parameters",
    orientation: "column",
    presentation: "parameter-list",
    changeAction: "project.set-value",
    contextAction: "parameter.open-context-menu",
    controls: chainGeneralParameterDescriptors({ item, basePath, component, state }),
  };
}

function chainGeneralParameterDescriptors({ item, basePath, component, state } = {}) {
  if (!item || !basePath) return [];
  return chainGeneralParameterEntries(item, basePath).map((entry) => parameterDescriptor(
    entry.param,
    entry.path,
    entry.value,
    { component, state },
    entry.boundary ? {
      action: "project.set-boundary-scale",
      target: { path: entry.path, ...entry.boundary },
      contextTarget: parameterContextTarget(entry.param, entry.path, component, { boundary: entry.boundary }),
    } : {},
  ));
}

export function chainContentParameterUiGraph(model, {
  id = `vj1.control.chain-content-${safeUiId(model?.paramView || "primary")}`,
} = {}) {
  if (!model) return parameterUiGraph({ id, controls: [] });
  const controls = chainContentParameterDescriptors(model);
  return parameterUiGraph({
    id,
    controls,
    changeAction: "project.set-value",
    contextAction: "parameter.open-context-menu",
  });
}

export function chainContentParameterUiModel(model = {}, { leadingControls = [] } = {}) {
  return {
    id: `${model.paramView || "primary"}-parameters`,
    type: "parameters",
    orientation: "column",
    presentation: "parameter-list",
    changeAction: "project.set-value",
    contextAction: "parameter.open-context-menu",
    controls: [...leadingControls, ...chainContentParameterDescriptors(model)],
  };
}

function chainContentParameterDescriptors(model = {}) {
  return retainedParameterDescriptors(model.params, {
    relatedParams: model.allParams,
    pathFor: (param) => `${model.basePath}.params.${param.id}`,
    valueFor: (param) => normalizeParamValue(param, model.values?.[param.id]),
    descriptorFor: (param, path, value, relatedControls) => parameterDescriptor(
      param,
      path,
      value,
      { component: model.component, state: model.state },
      markdownParameterOverrides(param, relatedControls, {
        action: "project.set-related-value",
      }),
    ),
    rangeAction: "project.set-range",
    rangeTargetFor: (minParam, maxParam, minPath, maxPath) => ({ minPath, maxPath }),
    rangeContextFor: (minParam, maxParam, minPath, maxPath) => ({
      min: parameterContextTarget(minParam, minPath, model.component),
      max: parameterContextTarget(maxParam, maxPath, model.component),
    }),
  });
}

export function chainVideoControlsUiGraph(model, {
  id = "vj1.control.chain-video-controls",
} = {}) {
  return model
    ? compileUiModel(chainVideoControlsUiModel(model), { id })
    : defineUiGraph({ id, nodes: [] });
}

export function chainVideoControlsUiModel(model = {}) {
  return {
    id: "video-parameters",
    type: "parameters",
    orientation: "column",
    presentation: "parameter-list",
    changeAction: "project.set-value",
    contextAction: "parameter.open-context-menu",
    controls: chainVideoParameterDescriptors(model),
  };
}

function chainVideoParameterDescriptors(model) {
  if (!model) return [];
  const trim = model.trim || {};
  const startPath = `${model.basePath}.start`;
  const endPath = `${model.basePath}.end`;
  const speedPath = `${model.basePath}.speed`;
  return [{
      id: "video-trim-range",
      kind: "range",
      label: "Movie segment",
      address: startPath,
      value: { min: trim.start, max: trim.end },
      min: 0,
      max: trim.max,
      step: 0.01,
      display: "time",
      disabled: !trim.available,
      action: "project.set-video-trim",
      target: {
        startPath,
        endPath,
        implicitEnd: trim.implicitEnd === true,
      },
    }, {
      id: "video-speed",
      kind: "number",
      label: "Movie speed",
      address: speedPath,
      value: model.speed,
      min: 0,
      max: 4,
      step: 0.01,
      precision: 2,
      action: "project.set-value",
      defaultValue: 1,
      contextTarget: {
        path: speedPath,
        mode: "state",
        componentId: model.component?.id || "",
        defaultValue: 1,
        resettable: true,
      },
    }];
}

export function liveComponentControlsUiGraph(component, view, state, {
  id = "vj1.control.live-component-controls",
} = {}) {
  return parameterUiGraph({
    id,
    controls: liveComponentControlDescriptors(component, view, state),
    changeAction: "live.set-value",
    contextAction: "parameter.open-context-menu",
  });
}

function liveComponentControlDescriptors(component, view, state) {
  if (!component) return [];
  const controls = [];
  const add = (param, path, value) => controls.push(parameterDescriptor(
    param,
    path,
    normalizeParamValue(param, value),
    { component, state },
    {
      action: "live.set-value",
      target: { componentId: component.id, nodeId: "", path },
      contextTarget: {
        path,
        mode: "live",
        componentId: component.id,
        nodeId: "",
        defaultValue: param.defaultValue,
        resettable: true,
      },
    },
  ));
  if (component.type !== "scene") {
    for (const param of chainTransformParams(view?.transform)) {
      add(param, `transform.${param.id}`, view?.transform?.[param.id]);
    }
  }
  add({ id: "opacity", label: "Opacity", type: "number", min: 0, max: 1, step: 0.01, defaultValue: 1 }, "opacity", view?.opacity ?? 1);
  add({ id: "speed", label: "Speed", type: "number", min: 0, max: 4, step: 0.01, defaultValue: 1 }, "speed", view?.speed ?? 1);
  add({ id: "blend", label: "Blend", type: "enum", values: BLEND_MODES, defaultValue: "normal" }, "blend", view?.blend || "normal");
  return controls;
}

export function liveChainContentParameterUiGraph(model, {
  id = `vj1.control.live-chain-content-${safeUiId(model?.paramView || "primary")}`,
} = {}) {
  if (!model) return parameterUiGraph({ id, controls: [] });
  const controls = liveChainContentParameterDescriptors(model);
  return parameterUiGraph({
    id,
    controls,
    changeAction: "live.set-value",
    contextAction: "parameter.open-context-menu",
  });
}

export function liveChainContentParameterUiModel(model = {}) {
  return {
    id: `${model.paramView || "primary"}-parameters`,
    type: "parameters",
    orientation: "column",
    presentation: "parameter-list",
    changeAction: "live.set-value",
    contextAction: "parameter.open-context-menu",
    controls: liveChainContentParameterDescriptors(model),
  };
}

function liveChainContentParameterDescriptors(model = {}) {
  const descriptorFor = (param, path, value, extraOverrides = {}) => {
    return parameterDescriptor(
      param,
      path,
      value,
      { component: model.component, state: model.state },
      {
        action: param.type === "event" ? "live.trigger-event" : "live.set-value",
        target: {
          componentId: model.component.id,
          nodeId: model.nodeId,
          path,
        },
        contextTarget: param.type === "event" ? null : {
          path,
          mode: "live",
          componentId: model.component.id,
          nodeId: model.nodeId,
          defaultValue: param.defaultValue,
          resettable: true,
        },
        ...extraOverrides,
      },
    );
  };
  return retainedParameterDescriptors(model.params, {
    relatedParams: model.allParams,
    pathFor: (param) => `${model.pathPrefix}.${param.id}`,
    valueFor: (param) => normalizeParamValue(param, model.values?.[param.id]),
    descriptorFor: (param, path, value, relatedControls) => descriptorFor(
      param,
      path,
      value,
      markdownParameterOverrides(param, relatedControls, {
        action: "live.set-related-value",
        componentId: model.component.id,
        nodeId: model.nodeId,
      }),
    ),
    rangeAction: "live.set-range",
    rangeTargetFor: (minParam, maxParam, minPath, maxPath) => ({
      componentId: model.component.id,
      nodeId: model.nodeId,
      minPath,
      maxPath,
    }),
    rangeContextFor: (minParam, maxParam, minPath, maxPath) => ({
      min: {
        path: minPath,
        mode: "live",
        componentId: model.component.id,
        nodeId: model.nodeId,
        defaultValue: minParam.defaultValue,
        resettable: true,
      },
      max: {
        path: maxPath,
        mode: "live",
        componentId: model.component.id,
        nodeId: model.nodeId,
        defaultValue: maxParam.defaultValue,
        resettable: true,
      },
    }),
  });
}

export function liveChainGeneralParameterUiGraph(model, {
  id = "vj1.control.live-chain-general",
} = {}) {
  if (!model) return parameterUiGraph({ id, controls: [] });
  const controls = liveChainGeneralParameterDescriptors(model);
  return parameterUiGraph({
    id,
    controls,
    changeAction: "live.set-value",
    contextAction: "parameter.open-context-menu",
  });
}

export function liveChainGeneralParameterUiModel(model = {}) {
  return {
    id: model.id || "general-parameters",
    type: "parameters",
    orientation: "column",
    presentation: "parameter-list",
    changeAction: "live.set-value",
    contextAction: "parameter.open-context-menu",
    controls: liveChainGeneralParameterDescriptors(model),
  };
}

function liveChainGeneralParameterDescriptors(model = {}) {
  if (!model.item || !model.component || !model.nodeId) return [];
  return chainGeneralParameterEntries(model.item, "").map((entry) => parameterDescriptor(
    entry.param,
    entry.path,
    entry.value,
    { component: model.component, state: model.state },
    {
      action: entry.boundary ? "live.set-boundary-scale" : "live.set-value",
      target: {
        componentId: model.component.id,
        nodeId: model.nodeId,
        path: entry.path,
        ...(entry.boundary || {}),
      },
      contextTarget: {
        path: entry.path,
        mode: "live",
        componentId: model.component.id,
        nodeId: model.nodeId,
        defaultValue: entry.param.defaultValue,
        resettable: true,
        ...(entry.boundary ? { boundary: entry.boundary } : {}),
      },
    },
  ));
}

function chainGeneralParameterEntries(item, basePath = "") {
  const path = (relative) => [String(basePath || "").replace(/\.$/, ""), relative].filter(Boolean).join(".");
  const boundary = normalizeNodeBoundary(item?.boundary);
  const quality = chainRenderQualityTarget(item, basePath);
  return [
    ...(quality ? [{ param: RENDER_QUALITY_PARAM, path: quality.path, value: normalizeParamValue(RENDER_QUALITY_PARAM, quality.value) }] : []),
    ...CHAIN_COMPOSITE_PARAMS.map((param) => ({ param, path: path(param.id), value: normalizeParamValue(param, item?.[param.id]) })),
    ...chainTransformParams(item?.transform).map((param) => ({ param, path: path(`transform.${param.id}`), value: normalizeParamValue(param, item?.transform?.[param.id]) })),
    ...chainBoundaryPositionParams(boundary).map((param) => ({ param, path: path(`boundary.${param.id}`), value: normalizeParamValue(param, boundary[param.id]) })),
    {
      param: CHAIN_BOUNDARY_SCALE_PARAM,
      path: path("boundary.scale"),
      value: nodeBoundaryUniformScale(boundary),
      boundary: { width: boundary.width, height: boundary.height },
    },
  ];
}

function retainedParameterDescriptors(params = [], {
  relatedParams = params,
  pathFor,
  valueFor,
  descriptorFor,
  rangeAction,
  rangeTargetFor,
  rangeContextFor,
} = {}) {
  const pairs = new Map();
  for (const param of params) {
    if (param?.ui !== "range-pair" || !param.rangePair) continue;
    const pair = pairs.get(param.rangePair) || {};
    pair[param.rangeRole] = param;
    pairs.set(param.rangePair, pair);
  }
  const controls = [];
  for (const param of params) {
    if (param?.ui !== "range-pair" || !param.rangePair) {
      const path = pathFor(param);
      const relatedControls = (param.styleControls || []).map((id) => {
        const relatedParam = relatedParams.find((candidate) => candidate?.id === id);
        return relatedParam ? {
          param: relatedParam,
          path: pathFor(relatedParam),
          value: valueFor(relatedParam),
        } : null;
      }).filter(Boolean);
      controls.push(descriptorFor(param, path, valueFor(param), relatedControls));
      continue;
    }
    if (param.rangeRole === "max") continue;
    const pair = pairs.get(param.rangePair);
    if (!pair?.min || !pair?.max) {
      const path = pathFor(param);
      controls.push(descriptorFor(param, path, valueFor(param)));
      continue;
    }
    const minPath = pathFor(pair.min);
    const maxPath = pathFor(pair.max);
    const lowerBound = Number.isFinite(Number(pair.min.min)) ? Number(pair.min.min) : 0;
    const upperBound = Number.isFinite(Number(pair.min.max)) ? Number(pair.min.max) : 1;
    controls.push({
      id: `parameter-range-${safeUiId(param.rangePair)}-${safeUiId(minPath)}`,
      kind: "range",
      label: pair.min.label || param.rangePair || pair.min.id,
      address: minPath,
      value: {
        min: normalizeParamValue(pair.min, valueFor(pair.min)),
        max: normalizeParamValue(pair.max, valueFor(pair.max)),
      },
      defaultValue: {
        min: pair.min.defaultValue,
        max: pair.max.defaultValue,
      },
      min: lowerBound,
      max: upperBound,
      minStep: pair.min.step,
      maxStep: pair.max.step,
      display: pair.min.rangeDisplay || "number",
      rangeKind: pair.min.rangeKind || "plain",
      action: rangeAction,
      target: rangeTargetFor(pair.min, pair.max, minPath, maxPath),
      contextTarget: rangeContextFor(pair.min, pair.max, minPath, maxPath),
    });
  }
  return controls;
}

function parameterDescriptor(param, address, value, { component, state }, overrides = {}) {
  const significantAddress = componentParameterAddressForPath(state, component, address);
  const significant = !!significantAddress && (component?.significantParams || []).includes(significantAddress);
  const optionLabel = (option) => param.optionLabels instanceof Map
    ? param.optionLabels.get(option)
    : param.optionLabels?.[option];
  const screenInput = param.ui === "screen-input";
  const event = param.type === "event";
  const screenInputs = screenInput ? screenCaptureStatus().inputs : [];
  const availableScreenInput = screenInputs.some((input) => input.id === String(value || ""));
  return {
    id: `parameter-${safeUiId(param.id)}-${safeUiId(address)}`,
    kind: screenInput ? "enum" : param.ui === "markdown" ? "markdown" : param.type,
    label: param.label || param.id,
    value,
    address,
    defaultValue: param.defaultValue,
    min: param.min,
    max: param.max,
    step: param.step,
    scale: param.scale,
    options: screenInput ? [
      { value: "", label: "Select a shared input" },
      ...(value && !availableScreenInput ? [{ value: String(value), label: "Unavailable input" }] : []),
      ...screenInputs.map((input) => ({
        value: input.id,
        label: `${input.name}${input.width && input.height ? ` · ${input.width} × ${input.height}` : ""}`,
      })),
    ] : (param.values || []).map((option) => ({ value: option, label: optionLabel(option) || option })),
    multiline: param.type === "text",
    significant,
    action: event ? "project.trigger-event" : "",
    target: event ? { path: address } : null,
    context: !event,
    contextTarget: event ? null : parameterContextTarget(param, address, component),
    ...overrides,
  };
}

function markdownParameterOverrides(param, relatedControls = [], {
  action = "",
  componentId = "",
  nodeId = "",
} = {}) {
  if (param?.ui !== "markdown") return {};
  return {
    styleControls: relatedControls.map((control) => ({
      id: control.param.id,
      label: textStyleControlLabel(control.param.id),
      title: control.param.label || control.param.id,
      value: control.value === true,
    })),
    styleAction: action,
    styleTarget: {
      ...(componentId ? { componentId } : {}),
      ...(nodeId ? { nodeId } : {}),
      controls: Object.fromEntries(relatedControls.map((control) => [control.param.id, {
        path: control.path,
      }])),
    },
  };
}

function textStyleControlLabel(id) {
  if (id === "bold") return "B";
  if (id === "italic") return "I";
  if (id === "underline") return "U";
  if (id === "fillEnabled") return "Fill";
  if (id === "outlineEnabled") return "Outline";
  return String(id || "Style");
}

function parameterContextTarget(param, path, component, extra = {}) {
  return {
    path,
    mode: "state",
    componentId: component?.id || "",
    defaultValue: param.defaultValue,
    resettable: true,
    ...extra,
  };
}

function parameterKindForNodeType(type) {
  if (type === ToggleNode.id) return "boolean";
  if (type === SelectUiNode.id) return "enum";
  if (type === ColorPickerNode.id) return "color";
  if (type === RangeUiNode.id) return "range";
  return "number";
}

function transitionUiControlDescriptors(transition, values) {
  return (transition?.parameters || []).map((param, index) => {
    const id = `live-transition-param-${index}-${safeUiId(param.id)}`;
    const address = `ui.live.transitionParameters.${param.id}`;
    const value = values[param.id] ?? param.defaultValue;
    if (param.type === "boolean") return {
      id,
      type: ToggleNode.id,
      address,
      inputs: { label: param.label || param.id, value: value === true },
    };
    if (param.type === "enum") return {
      id,
      type: SelectUiNode.id,
      address,
      inputs: { label: param.label || param.id, value, options: param.values || [] },
    };
    if (param.type === "color") return {
      id,
      type: ColorPickerNode.id,
      address,
      inputs: { label: param.label || param.id, value: value || "#000000ff" },
    };
    return {
      id,
      type: SliderUiNode.id,
      address,
      inputs: {
        label: param.label || param.id,
        value: Number(value),
        min: Number(param.min ?? 0),
        max: Number(param.max ?? 1),
        step: Number(param.step ?? 0.01),
      },
    };
  });
}

function safeUiId(value) {
  return String(value || "parameter").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function mappingSurfaceControlDescriptors(surface, state) {
  if (!surface) return [];
  const mapping = getSelectedMapping(state);
  const mappingIndex = mapping ? state.mappings.findIndex((item) => item.id === mapping.id) : -1;
  const surfaceIndex = mapping?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const mappingSurface = mappingIndex >= 0 && surfaceIndex >= 0 ? mapping.surfaces[surfaceIndex] : null;
  const mappingBase = `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
  const direct = surface.destination?.type === "direct";
  const controls = [{
    id: "mapping-surface-feather",
    type: SliderUiNode.id,
    address: `${mappingBase}.feather`,
    inputs: { label: "Feather", value: surface.feather ?? 0, min: 0, max: 0.5, step: 0.005, precision: 3 },
  }];
  if (!mappingSurface) return controls;
  controls.push({
    id: "mapping-surface-presence",
    type: SliderUiNode.id,
    address: `${mappingBase}.opacity`,
    inputs: { label: "Presence", value: mappingSurface.opacity, min: 0, max: 1, step: 0.01, precision: 2 },
  }, {
    id: "mapping-surface-projection-fit",
    type: SelectUiNode.id,
    address: `${mappingBase}.projectionFit`,
    inputs: {
      label: direct ? "Fit" : "Projection fit",
      value: mappingSurface.projectionFit || (direct ? "contain" : "cover"),
      options: PROJECTION_FIT_MODES,
    },
  });
  return controls;
}
