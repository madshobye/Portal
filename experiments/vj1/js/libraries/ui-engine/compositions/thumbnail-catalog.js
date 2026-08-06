import { CollectionNode } from "../nodes/collection-node.js";

export function createThumbnailCatalogModel({
  id,
  stateAddress,
  title,
  icon,
  items = [],
  selectedId = "",
  emptyText = "No items",
  noResultsText = "No matching items",
  searchPlaceholder = "Filter items",
  searchable = true,
  pasteScope = "",
  reorderable = false,
  hasToolSlot = false,
  headerActions = [],
  toolActions = [],
  commands = {},
} = {}) {
  if (!id) throw new Error("UI_THUMBNAIL_CATALOG_ID_REQUIRED");
  return {
    id,
    type: "collection",
    stateAddress,
    title,
    icon,
    items,
    selectedId,
    emptyText,
    noResultsText,
    searchPlaceholder,
    searchable,
    pasteScope,
    reorderable,
    hasToolSlot,
    presentation: "rail-catalog",
    listPresentation: "thumbnail-grid",
    itemNode: "thumbnail-button",
    layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
    headerActions,
    toolActions,
    onSelect: commands.select,
    onItemAction: commands.itemAction,
    onItemContext: commands.itemContext,
    onAction: commands.action,
    onSearch: commands.search,
    onReorder: commands.reorder,
  };
}

export function createThumbnailCatalogGraphNode({
  parent = "",
  slot = "default",
  ...options
} = {}) {
  const model = createThumbnailCatalogModel(options);
  const {
    id,
    type: _type,
    stateAddress,
    onSelect,
    onItemAction,
    onItemContext,
    onAction,
    onSearch,
    onReorder,
    ...inputs
  } = model;
  return {
    id,
    type: CollectionNode.id,
    parent,
    slot,
    stateAddress,
    inputs,
    commands: Object.fromEntries(Object.entries({
      select: onSelect,
      itemAction: onItemAction,
      itemContext: onItemContext,
      action: onAction,
      search: onSearch,
      reorder: onReorder,
    }).filter(([, action]) => action !== undefined && action !== null && action !== "")),
  };
}
