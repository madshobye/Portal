import { defineUiNode, UI_COMMAND_PHASES, UI_STATE_LIFETIMES } from "../ui-node.js";
import { createListNodeInstance } from "./list-node.js";
import { createSectionHeaderInstance } from "./section-header-node.js";
import { presentationClassNames } from "../presentation.js";

export const CollectionNode = defineUiNode({
  id: "core.ui.collection",
  name: "Collection",
  version: "0.1.0",
  description: "Retained titled collection with local search, semantic actions, and a composed selectable List.",
  inlets: {
    title: { type: "string", optional: true },
    icon: { type: "string", optional: true },
    items: { type: "any", required: true },
    selectedId: { type: "string", optional: true },
    emptyText: { type: "string", optional: true },
    searchPlaceholder: { type: "string", optional: true },
    headerActions: { type: "any", optional: true },
    toolActions: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
    headerPresentation: { type: "string", optional: true },
    listPresentation: { type: "string", optional: true },
    itemNode: { type: "string", optional: true },
    searchable: { type: "boolean", optional: true },
    reorderable: { type: "boolean", optional: true },
    pasteScope: { type: "string", optional: true },
    hasTitleSlot: { type: "boolean", optional: true },
    hasToolSlot: { type: "boolean", optional: true },
  },
  outlets: {
    select: { type: "event", optional: true },
    itemAction: { type: "event", optional: true },
    action: { type: "event", optional: true },
    search: { type: "event", optional: true },
    reorder: { type: "event", optional: true },
    itemContext: { type: "event", optional: true },
  },
  state: [{ id: "search", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" }],
  events: ["select", "itemAction", "itemContext", "action", "search", "reorder"],
  capabilities: ["ui-container", "searchable-collection", "selectable-list", "keyboard-navigation", "scroll-restoration"],
  factory: createCollectionInstance,
});

export function createCollectionInstance(context) {
  const { id, host, stateAddress, state, document, emit } = context;
  let inputs = normalizeCollectionInputs(context.inputs);
  let root = null;
  let header = null;
  let titleSlot = null;
  let tools = null;
  let toolsSlot = null;
  let search = null;
  let listHost = null;
  let list = null;
  const baseAddress = stateAddress || `nodes/${id}`;
  const searchAddress = `${baseAddress}/search`;

  function mount() {
    root = document.createElement("section");
    root.className = "ui-node-collection";
    root.dataset.uiNodeOwned = "collection";
    header = createSectionHeaderInstance({
      ...context,
      host: root,
      inputs: sectionHeaderInputs(inputs),
      emit(type, payload, phase) {
        if (type === "action") emit("action", { ...payload, scope: "header" }, phase);
      },
    });
    header.mount();
    titleSlot = header.slot("title");
    tools = document.createElement("div");
    tools.className = "ui-node-collection-tools";
    const searchLabel = document.createElement("label");
    searchLabel.className = "ui-node-collection-search";
    search = document.createElement("input");
    search.type = "search";
    search.autocomplete = "off";
    searchLabel.append(search);
    toolsSlot = document.createElement("span");
    toolsSlot.className = "ui-node-collection-tools-slot";
    tools.append(searchLabel, toolsSlot);
    listHost = document.createElement("div");
    listHost.className = "ui-node-collection-list-host";
    root.append(tools, listHost);
    root.addEventListener("click", onClick);
    search.addEventListener("input", onSearch);
    host.replaceChildren(root);
    list = createListNodeInstance({
      ...context,
      id: `${id}:list`,
      host: listHost,
      inputs: listInputs(inputs, currentQuery()),
      stateAddress: `${baseAddress}/list`,
      emit(type, payload, phase) {
        emit(type === "action" ? "itemAction" : type === "context" ? "itemContext" : type, payload, phase);
      },
    });
    list.mount();
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeCollectionInputs(nextInputs);
    reconcileClassNames(root, "ui-node-collection", inputs.presentation);
    root.dataset.uiPresentation = inputs.presentation;
    header.update(sectionHeaderInputs(inputs));
    search.placeholder = inputs.searchPlaceholder;
    search.parentElement.hidden = !inputs.searchable;
    const query = currentQuery();
    if (document.activeElement !== search && search.value !== query) search.value = query;
    tools.querySelectorAll('[data-ui-collection-action-scope="tool"]').forEach((button) => button.remove());
    for (const action of inputs.toolActions) tools.append(actionButton(action, "tool"));
    toolsSlot.hidden = !inputs.hasToolSlot;
    tools.hidden = !inputs.searchable && !inputs.toolActions.length && !inputs.hasToolSlot;
    list.update(listInputs(inputs, query));
  }

  function updateMedia(entries = []) {
    list?.updateMedia?.(entries);
  }

  function actionButton(action, scope) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uiCollectionAction = action.id;
    button.dataset.uiCollectionActionScope = scope;
    button.title = action.label;
    button.setAttribute("aria-label", action.label);
    button.textContent = action.icon || action.label;
    button.disabled = action.disabled;
    return button;
  }

  function onClick(event) {
    const action = event.target.closest?.("[data-ui-collection-action]");
    if (!action || !root.contains(action)) return;
    emit("action", {
      id: action.dataset.uiCollectionAction,
      scope: action.dataset.uiCollectionActionScope,
    }, UI_COMMAND_PHASES.COMMIT);
  }

  function onSearch() {
    const value = search.value || "";
    state.set(searchAddress, value, UI_STATE_LIFETIMES.SESSION);
    list.update(listInputs(inputs, value));
    emit("search", { value }, UI_COMMAND_PHASES.CHANGE);
  }

  function dispose() {
    list?.dispose?.();
    header?.dispose?.();
    list = null;
    header = null;
    search?.removeEventListener("input", onSearch);
    root?.removeEventListener("click", onClick);
    root?.remove();
    root = null;
  }

  function slot(name = "tools") {
    if (name === "title") return titleSlot;
    if (name === "tools") return toolsSlot;
    return null;
  }

  function currentQuery() {
    return String(state.get(searchAddress, "", UI_STATE_LIFETIMES.SESSION) || "");
  }

  return Object.freeze({ mount, update, updateMedia, dispose, slot, element: () => root });
}

function sectionHeaderInputs(inputs) {
  return {
    title: inputs.title,
    icon: inputs.icon,
    actions: inputs.headerActions,
    titleSlotVisible: inputs.hasTitleSlot,
    presentation: inputs.headerPresentation,
  };
}

function listInputs(inputs, query) {
  return {
    label: inputs.title,
    items: filteredItems(inputs.items, query),
    selectedId: inputs.selectedId,
    emptyText: query ? inputs.noResultsText : inputs.emptyText,
    presentation: inputs.listPresentation,
    itemNode: inputs.itemNode,
    reorderable: inputs.reorderable,
    pasteScope: inputs.pasteScope,
  };
}

export function filteredCollectionItems(items = [], query = "") {
  return filteredItems(items, query);
}

function filteredItems(items, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => String(item.searchText || item.label || "").toLocaleLowerCase().includes(normalized));
}

function normalizeCollectionInputs(source = {}) {
  const actions = (values = []) => (values || []).map((action) => ({
    id: String(action?.id || ""),
    label: String(action?.label || action?.id || "Action"),
    icon: String(action?.icon || ""),
    disabled: action?.disabled === true,
  })).filter((action) => action.id);
  return {
    title: String(source.title || "Items"),
    icon: String(source.icon || ""),
    items: Array.isArray(source.items) ? source.items : [],
    selectedId: String(source.selectedId || ""),
    emptyText: String(source.emptyText || "No items"),
    noResultsText: String(source.noResultsText || "No matching items"),
    searchPlaceholder: String(source.searchPlaceholder || "Search"),
    headerActions: actions(source.headerActions),
    toolActions: actions(source.toolActions),
    presentation: String(source.presentation || "default"),
    listPresentation: String(source.listPresentation || "default"),
    itemNode: String(source.itemNode || "default"),
    searchable: source.searchable !== false,
    reorderable: source.reorderable === true,
    pasteScope: String(source.pasteScope || ""),
    hasTitleSlot: source.hasTitleSlot === true,
    hasToolSlot: source.hasToolSlot === true,
    headerPresentation: String(source.headerPresentation || "default"),
  };
}

function reconcileClassNames(element, base, presentation = "") {
  const previous = String(element.dataset.uiCollectionClasses || "").split(/\s+/).filter(Boolean);
  element.classList.remove(...previous);
  const next = presentationClassNames(presentation);
  element.className = base;
  element.classList.add(...next);
  element.dataset.uiCollectionClasses = next.join(" ");
}
