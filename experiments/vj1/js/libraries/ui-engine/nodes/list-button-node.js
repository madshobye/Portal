import { defineUiNode } from "../ui-node.js";

export const ListButtonNode = defineUiNode({
  id: "core.ui.list-button",
  name: "List Button",
  version: "0.1.0",
  description: "Reusable retained text-list item with leading/trailing actions and hierarchy drop targets.",
  inlets: {
    item: { type: "any", required: true },
    selected: { type: "boolean", optional: true },
    reorderable: { type: "boolean", optional: true },
  },
  outlets: { activate: { type: "event", optional: true }, action: { type: "event", optional: true } },
  events: ["activate", "action"],
  capabilities: ["ui-item", "text-list-presentation", "hierarchical-item"],
  factory: createListButtonInstance,
});

export function createListButtonInstance({ host, inputs: initialInputs, document, emit = () => {} }) {
  let inputs = normalizeInputs(initialInputs);
  let root = null;
  let select = null;
  let label = null;
  let meta = null;
  let leading = null;
  let trailing = null;
  let dropInside = null;
  let dropAfter = null;

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-list-button-item";
    root.setAttribute("role", "option");
    leading = document.createElement("span");
    leading.className = "ui-node-list-leading-actions";
    select = document.createElement("button");
    select.type = "button";
    select.className = "ui-node-list-button";
    const copy = document.createElement("span");
    copy.className = "ui-node-list-button-copy";
    label = document.createElement("span");
    label.className = "ui-node-list-button-label";
    meta = document.createElement("small");
    copy.append(label, meta);
    select.append(copy);
    trailing = document.createElement("span");
    trailing.className = "ui-node-list-trailing-actions";
    dropInside = dropTarget("inside");
    dropAfter = dropTarget("after");
    root.append(leading, select, trailing, dropInside, dropAfter);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeInputs(nextInputs);
    const { item, selected, reorderable } = inputs;
    root.dataset.uiListItem = item.id;
    root.dataset.uiFilterText = item.searchText;
    root.dataset.uiListDepth = String(item.depth);
    root.dataset.uiItemKind = item.kind;
    root.style.setProperty("--ui-list-depth", String(item.depth));
    root.setAttribute("aria-selected", String(selected));
    root.classList.toggle("is-selected", selected);
    if (reorderable || item.reorderable) root.setAttribute("draggable", "true");
    else root.removeAttribute("draggable");

    select.dataset.uiListSelect = item.id;
    select.disabled = item.disabled;
    select.setAttribute("aria-disabled", String(item.disabled));
    select.classList.toggle("is-selected", selected);
    label.textContent = item.label;
    meta.textContent = item.meta;
    meta.hidden = !item.meta;
    leading.replaceChildren(...item.actions.filter((action) => action.position === "leading").map(actionButton));
    trailing.replaceChildren(...item.actions.filter((action) => action.position !== "leading").map(actionButton));
    dropInside.hidden = !item.acceptsChildren;
    dropAfter.hidden = !item.dropAfter;
  }

  function actionButton(action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-node-list-button-action";
    button.dataset.uiListAction = action.id;
    button.dataset.uiListItem = inputs.item.id;
    button.dataset.uiActionVariant = action.variant;
    button.dataset.uiActionState = action.active ? "active" : "inactive";
    button.title = action.label;
    button.setAttribute("aria-label", `${action.label} ${inputs.item.label}`);
    button.textContent = action.icon || action.label;
    button.disabled = action.disabled;
    return button;
  }

  function dropTarget(position) {
    const target = document.createElement("span");
    target.className = `ui-node-list-drop-zone is-${position}`;
    target.dataset.uiListDropPosition = position;
    target.setAttribute("aria-hidden", "true");
    return target;
  }

  function dispose() {
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

export function normalizeListButtonItem(item = {}) {
  return Object.freeze({
    id: String(item.id || ""),
    label: String(item.label || item.name || item.id || "Item"),
    meta: String(item.meta || ""),
    searchText: String(item.searchText || item.label || item.name || ""),
    kind: String(item.kind || "default"),
    disabled: item.disabled === true,
    reorderable: item.reorderable === true,
    depth: Math.max(0, Math.floor(Number(item.depth) || 0)),
    acceptsChildren: item.acceptsChildren === true,
    dropAfter: item.dropAfter === true,
    actions: Object.freeze((item.actions || []).map((action) => Object.freeze({
      id: String(action?.id || ""),
      label: String(action?.label || action?.id || "Action"),
      icon: String(action?.icon || ""),
      variant: String(action?.variant || action?.tone || action?.id || "default"),
      active: action?.active === true,
      disabled: action?.disabled === true,
      position: action?.position === "leading" ? "leading" : "trailing",
      payload: Object.freeze({ ...(action?.payload && typeof action.payload === "object" ? action.payload : {}) }),
    })).filter((action) => action.id)),
  });
}

function normalizeInputs(inputs = {}) {
  return {
    item: normalizeListButtonItem(inputs.item),
    selected: inputs.selected === true,
    reorderable: inputs.reorderable === true,
  };
}
