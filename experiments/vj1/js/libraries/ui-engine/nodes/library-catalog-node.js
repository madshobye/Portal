import { defineUiNode } from "../ui-node.js";

export const LibraryCatalogNode = defineUiNode({
  id: "core.ui.library-catalog",
  name: "Library catalog",
  version: "0.1.0",
  description: "Searchable grouped library catalog whose items and actions emit semantic commands.",
  inlets: {
    title: { type: "string", optional: true },
    icon: { type: "string", optional: true },
    searchPlaceholder: { type: "string", optional: true },
    sections: { type: "array", optional: true },
    emptyText: { type: "string", optional: true },
  },
  outlets: {
    select: { type: "event", optional: true },
    action: { type: "event", optional: true },
    search: { type: "event", optional: true },
    drag: { type: "event", optional: true },
  },
  capabilities: ["ui-container", "ui-collection", "ui-library"],
  factory: createLibraryCatalogInstance,
});

function createLibraryCatalogInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root;
  let title;
  let search;
  let body;
  let empty;

  function mount() {
    root = element(document, "section", "ui-node-library-catalog");
    const header = element(document, "header", "ui-node-library-catalog-header");
    const icon = element(document, "span", "material-symbols-rounded");
    icon.dataset.uiLibraryIcon = "";
    title = element(document, "strong");
    header.append(icon, title);
    const searchLabel = element(document, "label", "ui-node-library-catalog-search");
    const searchIcon = element(document, "span", "material-symbols-rounded");
    searchIcon.textContent = "search";
    search = element(document, "input");
    search.type = "search";
    searchLabel.append(searchIcon, search);
    body = element(document, "div", "ui-node-library-catalog-body");
    empty = element(document, "p", "ui-node-library-catalog-empty");
    root.append(header, searchLabel, body, empty);
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("dragstart", onDragStart);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    root.querySelector("[data-ui-library-icon]").textContent = String(inputs.icon || "schema");
    title.textContent = String(inputs.title || "Library");
    search.placeholder = String(inputs.searchPlaceholder || "Filter items");
    const query = search.value.trim().toLowerCase();
    const sections = (inputs.sections || []).map((section) => renderSection(document, section, query));
    body.replaceChildren(...sections);
    const visible = sections.some((section) => !section.hidden);
    empty.textContent = String(inputs.emptyText || "No items");
    empty.hidden = visible;
  }

  function onInput(event) {
    if (event.target !== search) return;
    update(inputs);
    emit("search", { value: search.value });
  }

  function onClick(event) {
    const action = event.target.closest?.("[data-ui-library-action]");
    if (action && root.contains(action)) {
      const itemRoot = action.closest(".ui-node-library-item");
      const fields = Object.fromEntries([...itemRoot?.querySelectorAll?.("[data-ui-library-field]") || []]
        .map((field) => [field.dataset.uiLibraryField, field.value]));
      emit("action", {
        id: action.dataset.uiLibraryAction,
        itemId: action.dataset.uiLibraryItem || "",
        value: action.dataset.uiLibraryValue || "",
        fields,
      });
      return;
    }
    const item = event.target.closest?.("[data-ui-library-select]");
    if (item && root.contains(item)) emit("select", { id: item.dataset.uiLibrarySelect, kind: item.dataset.uiLibraryKind || "item" });
  }

  function onDragStart(event) {
    const item = event.target.closest?.("[data-ui-library-drag]");
    if (!item || !root.contains(item) || item.draggable !== true) return;
    const payload = { id: item.dataset.uiLibraryDrag, kind: item.dataset.uiLibraryKind || "item" };
    event.dataTransfer?.setData("application/x-vj1-node-definition", payload.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    emit("drag", payload);
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("input", onInput);
    root?.removeEventListener("dragstart", onDragStart);
    root?.remove();
    root = title = search = body = empty = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function renderSection(document, section = {}, query = "") {
  const root = element(document, "section", "ui-node-library-section");
  const header = element(document, "header");
  const title = element(document, "h3");
  title.textContent = String(section.label || "Items");
  const count = element(document, "small");
  count.textContent = String(section.count ?? section.items?.length ?? 0);
  title.append(document.createTextNode(" "), count);
  const actions = element(document, "span", "ui-node-library-section-actions");
  actions.append(...(section.actions || []).map((action) => actionButton(document, action)));
  header.append(title, actions);
  const list = element(document, "div", "ui-node-library-section-items");
  const items = (section.items || []).filter((item) => !query || String(item.search || `${item.label || ""} ${item.detail || ""}`).toLowerCase().includes(query));
  list.append(...items.map((item) => renderItem(document, item)));
  root.append(header, list);
  root.hidden = items.length === 0 && !(section.actions || []).length;
  return root;
}

function renderItem(document, item = {}) {
  const root = element(document, item.presentation === "card" ? "article" : "button", `ui-node-library-item${item.presentation === "card" ? " is-card" : ""}`);
  if (root.tagName === "BUTTON") root.type = "button";
  if (item.selectable !== false) root.dataset.uiLibrarySelect = String(item.id || "");
  root.dataset.uiLibraryKind = String(item.kind || "item");
  root.classList.toggle("is-selected", item.selected === true);
  root.classList.toggle("is-disabled", item.disabled === true);
  if (item.draggable === true) {
    root.draggable = true;
    root.dataset.uiLibraryDrag = String(item.id || "");
  }
  const identity = element(document, "span", "ui-node-library-item-identity");
  const icon = element(document, "span", "material-symbols-rounded");
  icon.textContent = String(item.icon || "data_object");
  const copy = element(document, "span");
  const label = element(document, "strong");
  label.textContent = String(item.label || item.id || "Item");
  const detail = element(document, "small");
  detail.textContent = String(item.detail || "");
  copy.append(label, detail);
  identity.append(icon, copy);
  root.append(identity);
  if (item.meta) {
    const meta = element(document, "em");
    meta.textContent = String(item.meta);
    root.append(meta);
  }
  if (item.description) {
    const description = element(document, "p");
    description.textContent = String(item.description);
    root.append(description);
  }
  if (item.facts?.length) {
    const facts = element(document, "ul");
    facts.append(...item.facts.map((fact) => {
      const row = element(document, "li");
      row.textContent = String(fact);
      return row;
    }));
    root.append(facts);
  }
  if (item.fields?.length) {
    const fields = element(document, "span", "ui-node-library-item-fields");
    fields.append(...item.fields.map((field) => renderField(document, item.id, field)));
    root.append(fields);
  }
  if (item.actions?.length) {
    const actions = element(document, "span", "ui-node-library-item-actions");
    actions.append(...item.actions.map((action) => actionButton(document, action, item.id)));
    root.append(actions);
  }
  return root;
}

function renderField(document, itemId, field = {}) {
  const label = element(document, "label");
  const copy = element(document, "span");
  copy.textContent = String(field.label || "Value");
  const select = element(document, "select");
  select.setAttribute("aria-label", String(field.label || "Value"));
  select.dataset.uiLibraryField = String(field.id || "");
  select.dataset.uiLibraryItem = String(itemId || "");
  select.append(...(field.options || []).map((option) => {
    const node = element(document, "option");
    node.value = String(option.value ?? "");
    node.textContent = String(option.label ?? option.value ?? "");
    node.selected = String(option.value ?? "") === String(field.value ?? "");
    return node;
  }));
  label.append(copy, select);
  return label;
}

function actionButton(document, action = {}, itemId = "") {
  const button = element(document, "button");
  button.type = "button";
  button.dataset.uiLibraryAction = String(action.id || "");
  button.dataset.uiLibraryItem = String(itemId || action.itemId || "");
  button.dataset.uiLibraryValue = String(action.value || "");
  button.disabled = action.disabled === true;
  const icon = element(document, "span", "material-symbols-rounded");
  icon.textContent = String(action.icon || "");
  const label = element(document, "span");
  label.textContent = String(action.label || action.id || "Action");
  if (action.icon) button.append(icon);
  button.append(label);
  return button;
}

function element(document, tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
