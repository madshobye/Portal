import { defineUiNode, UI_COMMAND_PHASES, UI_STATE_LIFETIMES } from "../ui-node.js";
import { createThumbnailButtonInstance, normalizeThumbnailItem } from "./thumbnail-button-node.js";
import { presentationClassName, presentationClassNames } from "../presentation.js";
import { createRetainedScrollController } from "../scroll-state.js";
import { reconcileRetainedChildren } from "../retained-children.js";

export const ListNode = defineUiNode({
  id: "core.ui.list",
  name: "List",
  version: "0.1.0",
  description: "Retained selectable list with stable identity, keyboard navigation, actions, and restorable scroll state.",
  inlets: {
    items: { type: "any", required: true },
    selectedId: { type: "string", optional: true },
    label: { type: "string", optional: true },
    emptyText: { type: "string", optional: true },
    reorderable: { type: "boolean", optional: true },
    pasteScope: { type: "string", optional: true },
    itemNode: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
  },
  outlets: {
    select: { type: "event", optional: true },
    action: { type: "event", optional: true },
    reorder: { type: "event", optional: true },
    context: { type: "event", optional: true },
  },
  state: [
    { id: "scroll", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: { top: 0, left: 0 } },
    { id: "activeId", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" },
    { id: "selectedId", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" },
  ],
  events: ["select", "action", "reorder", "context"],
  capabilities: ["selectable-list", "keyboard-navigation", "scroll-restoration", "item-reordering"],
  factory: createListNodeInstance,
});

export function createListNodeInstance({
  id,
  host,
  inputs: initialInputs,
  stateAddress,
  state,
  emit,
  document,
}) {
  let inputs = normalizeListInputs(initialInputs);
  let root = null;
  let signature = "";
  const baseAddress = stateAddress || `nodes/${id}`;
  const scrollAddress = `${baseAddress}/scroll`;
  const activeAddress = `${baseAddress}/active`;
  const selectionAddress = `${baseAddress}/selected`;
  let commandedSelectionId = inputs.selectedId;
  const scroll = createRetainedScrollController({
    state,
    address: scrollAddress,
    window: document?.defaultView || globalThis,
  });
  const itemInstances = new Map();

  function mount() {
    root = resolveListRoot(host, id);
    root.dataset.uiNodeOwned = "list";
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragend", onDragEnd);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    root.addEventListener("contextmenu", onContextMenu);
    render(true);
    commandedSelectionId = selectedId();
    scroll.attach(root);
  }

  function update(nextInputs = {}) {
    inputs = normalizeListInputs(nextInputs);
    commandedSelectionId = selectedId();
    render(false);
  }

  function updateMedia(entries = []) {
    for (const retained of itemInstances.values()) retained.instance.updateMedia?.(entries);
  }

  function render(force) {
    const nextSignature = listContentSignature(inputs);
    if (force || signature !== nextSignature) {
      const position = root ? { top: root.scrollTop || 0, left: root.scrollLeft || 0 } : { top: 0, left: 0 };
      if (inputs.itemNode === "thumbnail-button") reconcileThumbnailItems();
      else {
        disposeItemInstances();
        root.innerHTML = renderListItemsHtml(inputs.items, {
          selectedId: selectedId(),
          emptyText: inputs.emptyText,
          reorderable: inputs.reorderable,
        });
      }
      signature = nextSignature;
      scroll.restore(position);
    } else {
      patchListSelection(root, selectedId());
    }
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", inputs.label);
    root.tabIndex = inputs.disabled ? -1 : 0;
    root.setAttribute("aria-disabled", String(inputs.disabled));
    root.dataset.uiPresentation = inputs.presentation;
    reconcileListClassNames(root, inputs.presentation);
    if (inputs.pasteScope) root.dataset.pasteScope = inputs.pasteScope;
    else delete root.dataset.pasteScope;
  }

  function reconcileThumbnailItems() {
    const retainedIds = new Set(inputs.items.map((item) => item.id));
    for (const [itemId, retained] of itemInstances) {
      if (retainedIds.has(itemId)) continue;
      retained.instance.dispose();
      retained.host.remove();
      itemInstances.delete(itemId);
    }
    if (!inputs.items.length) {
      disposeItemInstances();
      const empty = document.createElement("div");
      empty.className = "ui-node-empty";
      empty.textContent = inputs.emptyText;
      root.replaceChildren(empty);
      return;
    }
    const orderedHosts = inputs.items.map((item) => {
      let retained = itemInstances.get(item.id);
      const nextInputs = {
        item,
        selected: item.id === selectedId(),
        reorderable: inputs.reorderable,
      };
      if (!retained) {
        const itemHost = document.createElement("div");
        itemHost.className = "ui-node-list-item-host";
        const instance = createThumbnailButtonInstance({
          id: `${id}:thumbnail:${item.id}`,
          host: itemHost,
          inputs: nextInputs,
          stateAddress: `${baseAddress}/items/${encodeURIComponent(item.id)}`,
          state,
          document,
          emit: () => {},
        });
        instance.mount();
        retained = { host: itemHost, instance };
        itemInstances.set(item.id, retained);
      } else retained.instance.update(nextInputs);
      return retained.host;
    });
    reconcileRetainedChildren(root, orderedHosts);
  }

  function onClick(event) {
    const action = event.target.closest?.("[data-ui-list-action]");
    if (action && root.contains(action)) {
      const itemId = String(action.dataset.uiListItem || "");
      const actionId = String(action.dataset.uiListAction || "");
      const descriptor = inputs.items.find((item) => item.id === itemId)?.actions.find((itemAction) => itemAction.id === actionId);
      emit("action", { id: itemId, action: actionId, ...(descriptor?.payload || {}) });
      return;
    }
    const item = event.target.closest?.("[data-ui-list-select]");
    if (!item || !root.contains(item) || item.getAttribute("aria-disabled") === "true") return;
    select(String(item.dataset.uiListSelect || ""));
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest?.("[data-ui-list-action]")) return;
    const item = event.target.closest?.("[data-ui-list-select]");
    if (!item || !root.contains(item) || item.getAttribute("aria-disabled") === "true") return;
    // Native dragging can suppress the eventual click. Selection therefore
    // follows the press, while the app still receives only a semantic command.
    select(String(item.dataset.uiListSelect || ""));
  }

  function onKeyDown(event) {
    if (inputs.disabled || !inputs.items.length) return;
    const enabled = inputs.items.filter((item) => !item.disabled);
    if (!enabled.length) return;
    const activeId = String(state.get(activeAddress, selectedId()) || "");
    const currentIndex = Math.max(0, enabled.findIndex((item) => item.id === activeId));
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(enabled.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = enabled.length - 1;
    else if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      select(activeId || enabled[currentIndex].id);
      return;
    } else return;
    event.preventDefault();
    const next = enabled[nextIndex];
    state.set(activeAddress, next.id, UI_STATE_LIFETIMES.SESSION);
    focusItem(next.id);
  }

  function onContextMenu(event) {
    const item = event.target?.closest?.("[data-ui-list-select]");
    if (!item || !root.contains(item)) return;
    event.preventDefault();
    emit("context", {
      id: String(item.dataset.uiListSelect || ""),
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
    }, UI_COMMAND_PHASES.COMMIT);
  }

  function select(selectedId) {
    if (!selectedId) return;
    const changed = commandedSelectionId !== selectedId;
    commandedSelectionId = selectedId;
    state.set(activeAddress, selectedId, UI_STATE_LIFETIMES.SESSION);
    state.set(selectionAddress, selectedId, UI_STATE_LIFETIMES.SESSION);
    patchListSelection(root, selectedId);
    if (!changed) return;
    emit("select", { id: selectedId }, UI_COMMAND_PHASES.COMMIT);
  }

  function focusItem(itemId) {
    const item = [...root.querySelectorAll("[data-ui-list-select]")]
      .find((candidate) => candidate.dataset.uiListSelect === itemId);
    item?.focus?.();
    item?.scrollIntoView?.({ block: "nearest" });
  }

  function onDragStart(event) {
    const item = listItemFromEvent(event);
    if (!inputs.reorderable || !item) return;
    const itemId = String(item.dataset.uiListItem || "");
    if (!itemId) return;
    root.dataset.uiListDragging = itemId;
    item.classList.add("is-dragging");
    event.dataTransfer?.setData?.("text/plain", itemId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragEnd(event) {
    listItemFromEvent(event)?.classList.remove("is-dragging");
    root.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    delete root.dataset.uiListDragging;
  }

  function onDragOver(event) {
    const dropTarget = dropTargetFromEvent(event);
    const item = listItemFromEvent(event);
    const target = dropTarget || item;
    if (!inputs.reorderable || !root.dataset.uiListDragging || !target) return;
    event.preventDefault();
    target.classList.add("is-drop-target");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function onDragLeave(event) {
    (dropTargetFromEvent(event) || listItemFromEvent(event))?.classList.remove("is-drop-target");
  }

  function onDrop(event) {
    const dropTarget = dropTargetFromEvent(event);
    const item = listItemFromEvent(event);
    const target = dropTarget || item;
    if (!inputs.reorderable || !target) return;
    event.preventDefault();
    target.classList.remove("is-drop-target");
    const fromId = String(root.dataset.uiListDragging || event.dataTransfer?.getData?.("text/plain") || "");
    const toId = String(dropTarget?.dataset.uiListDropItem || item?.dataset.uiListItem || "");
    const position = String(dropTarget?.dataset.uiListDropPosition || "before");
    delete root.dataset.uiListDragging;
    if (fromId && toId && (fromId !== toId || position === "after")) {
      emit("reorder", { fromId, toId, position }, UI_COMMAND_PHASES.COMMIT);
    }
  }

  function listItemFromEvent(event) {
    const item = event.target?.closest?.("[data-ui-list-item]");
    return item && !item.dataset.uiListAction && root.contains(item) ? item : null;
  }

  function dropTargetFromEvent(event) {
    const target = event.target?.closest?.("[data-ui-list-drop-position]");
    return target && root.contains(target) ? target : null;
  }

  function dispose() {
    if (!root) return;
    scroll.dispose();
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("dragstart", onDragStart);
    root.removeEventListener("dragend", onDragEnd);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("dragleave", onDragLeave);
    root.removeEventListener("drop", onDrop);
    root.removeEventListener("contextmenu", onContextMenu);
    disposeItemInstances();
    root.removeAttribute("data-ui-node-owned");
    root = null;
  }

  function disposeItemInstances() {
    for (const retained of itemInstances.values()) retained.instance.dispose();
    itemInstances.clear();
  }

  return Object.freeze({ mount, update, updateMedia, dispose, element: () => root });

  function selectedId() {
    return inputs.controlledSelection
      ? inputs.selectedId
      : String(state.get(selectionAddress, "", UI_STATE_LIFETIMES.SESSION) || "");
  }
}

export function renderListItemsHtml(items = [], { selectedId = "", emptyText = "No items", reorderable = false } = {}) {
  const normalized = normalizeListItems(items);
  if (!normalized.length) return `<div class="ui-node-empty">${escapeHtml(emptyText)}</div>`;
  const afterZones = subtreeAfterZones(normalized);
  return normalized.map((item, index) => {
    const selected = item.id === String(selectedId || "");
    const mediaKey = item.media?.key
      ? ` data-ui-media-key="${escapeAttribute(item.media.key)}"`
      : "";
    const mediaPresentation = presentationClassName(item.media?.presentation);
    const media = item.media?.src
      ? `<span class="ui-node-list-media ${escapeAttribute(mediaPresentation)}"${mediaKey}><img src="${escapeAttribute(item.media.src)}" alt="" loading="lazy" /></span>`
      : item.media?.fallback
        ? `<span class="ui-node-list-media ui-node-list-media-fallback ${escapeAttribute(mediaPresentation)}"${mediaKey} aria-hidden="true">${escapeHtml(item.media.fallback)}</span>`
        : "";
    const actionHtml = (action) => `<button type="button" class="ui-node-list-action ${escapeAttribute(presentationClassName(action.presentation))}" data-ui-presentation="${escapeAttribute(action.presentation)}" data-ui-list-action="${escapeAttribute(action.id)}" data-ui-list-item="${escapeAttribute(item.id)}" title="${escapeAttribute(action.label)}" aria-label="${escapeAttribute(action.label)} ${escapeAttribute(item.label)}" ${action.disabled ? "disabled" : ""}><span class="ui-node-list-action-icon" aria-hidden="true">${escapeHtml(action.icon || action.label)}</span></button>`;
    const leadingActionItems = item.actions.filter((action) => action.position === "leading");
    const trailingActionItems = item.actions.filter((action) => action.position !== "leading");
    const leadingActions = leadingActionItems.map(actionHtml).join("");
    const trailingActions = trailingActionItems.map(actionHtml).join("");
    const structuralClasses = [
      leadingActionItems.length ? "has-leading" : "",
      trailingActionItems.some((action) => action.id !== "remove" && action.variant !== "remove") ? "has-action" : "",
      trailingActionItems.some((action) => action.id === "remove" || action.variant === "remove") ? "has-remove" : "",
    ].filter(Boolean).join(" ");
    const structuralSuffix = structuralClasses ? ` ${structuralClasses}` : "";
    const depthStyle = item.depth > 0 ? ` style="--ui-list-depth:${item.depth}"` : "";
    const row = `<div class="ui-node-list-item ${escapeAttribute(presentationClassName(item.presentation))}${structuralSuffix}${selected ? " is-selected" : ""}" data-ui-presentation="${escapeAttribute(item.presentation)}" data-ui-list-item="${escapeAttribute(item.id)}" data-ui-filter-text="${escapeAttribute(item.searchText)}" data-ui-list-depth="${item.depth}" role="option" aria-selected="${selected}"${depthStyle}${reorderable || item.reorderable ? ' draggable="true"' : ""}>
      ${leadingActions}<button type="button" class="ui-node-list-select ${escapeAttribute(presentationClassName(item.selectPresentation))}${selected ? " is-selected" : ""}" data-ui-presentation="${escapeAttribute(item.selectPresentation)}" data-ui-list-select="${escapeAttribute(item.id)}" aria-disabled="${item.disabled}" ${item.disabled ? "disabled" : ""}>
        ${media}<span class="ui-node-list-copy">${item.labelIcon ? `<span class="ui-node-list-label-icon" aria-hidden="true">${escapeHtml(item.labelIcon)}</span>` : ""}<span class="ui-node-list-label">${escapeHtml(item.label)}</span>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ""}</span>
      </button>${trailingActions}
    </div>`;
    const inside = item.acceptsChildren ? renderStructuralDropZone(item, "inside") : "";
    const after = (afterZones.get(index) || [])
      .map((owner) => renderStructuralDropZone(owner, "after"))
      .join("");
    return `${row}${inside}${after}`;
  }).join("");
}

function subtreeAfterZones(items) {
  const byLastIndex = new Map();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item.dropAfter) continue;
    let lastIndex = index;
    while (lastIndex + 1 < items.length && items[lastIndex + 1].depth > item.depth) lastIndex += 1;
    const owners = byLastIndex.get(lastIndex) || [];
    owners.push(item);
    owners.sort((left, right) => right.depth - left.depth);
    byLastIndex.set(lastIndex, owners);
  }
  return byLastIndex;
}

function renderStructuralDropZone(item, position) {
  const depthStyle = item.depth > 0 ? ` style="--ui-list-depth:${item.depth}"` : "";
  return `<span class="ui-node-list-drop-zone is-${position} is-structural" data-ui-list-drop-position="${position}" data-ui-list-drop-item="${escapeAttribute(item.id)}" data-ui-list-depth="${item.depth}" aria-hidden="true"${depthStyle}></span>`;
}

export function patchListSelection(root, selectedId) {
  const id = String(selectedId || "");
  root?.querySelectorAll?.("[data-ui-list-item]").forEach((item) => {
    if (item.dataset.uiListAction) return;
    const selected = String(item.dataset.uiListItem || "") === id;
    item.classList.toggle("is-selected", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  root?.querySelectorAll?.("[data-ui-list-select]").forEach((item) => {
    const selected = String(item.dataset.uiListSelect || "") === id;
    item.classList.toggle("is-selected", selected);
  });
}

export function nextListSelection(items = [], currentId = "", key = "ArrowDown") {
  const enabled = normalizeListItems(items).filter((item) => !item.disabled);
  if (!enabled.length) return "";
  const current = Math.max(0, enabled.findIndex((item) => item.id === String(currentId || "")));
  if (key === "Home") return enabled[0].id;
  if (key === "End") return enabled.at(-1).id;
  if (key === "ArrowUp") return enabled[Math.max(0, current - 1)].id;
  if (key === "ArrowDown") return enabled[Math.min(enabled.length - 1, current + 1)].id;
  return enabled[current].id;
}

function resolveListRoot(host, id) {
  if (host.matches?.("[data-ui-list-root]")) return host;
  let root = host.querySelector?.(`[data-ui-list-root="${cssEscape(id)}"]`);
  if (root) return root;
  root = host.ownerDocument?.createElement?.("div") || globalThis.document?.createElement?.("div");
  if (!root) throw new Error(`UI_LIST_DOCUMENT_REQUIRED:${id}`);
  root.dataset.uiListRoot = id;
  root.className = "ui-node-list";
  host.replaceChildren(root);
  return root;
}

function normalizeListInputs(inputs = {}) {
  return {
    items: normalizeListItems(inputs.items),
    selectedId: String(inputs.selectedId || ""),
    controlledSelection: Object.hasOwn(inputs, "selectedId"),
    label: String(inputs.label || "Items"),
    emptyText: String(inputs.emptyText || "No items"),
    disabled: inputs.disabled === true,
    reorderable: inputs.reorderable === true,
    pasteScope: String(inputs.pasteScope || ""),
    itemNode: String(inputs.itemNode || "default"),
    presentation: String(inputs.presentation || "default"),
  };
}

function reconcileListClassNames(root, presentation = "") {
  const previous = String(root.dataset.uiListClasses || "").split(/\s+/).filter(Boolean);
  root.classList.remove(...previous);
  const next = presentationClassNames(presentation);
  root.classList.add(...next);
  root.dataset.uiListClasses = next.join(" ");
}

function normalizeListItems(items = []) {
  return (items || []).map((item) => Object.freeze({
    id: String(item?.id || ""),
    label: String(item?.label || item?.name || item?.id || "Item"),
    meta: String(item?.meta || ""),
    searchText: String(item?.searchText || item?.label || item?.name || ""),
    disabled: item?.disabled === true,
    reorderable: item?.reorderable === true,
    depth: Math.max(0, Math.floor(Number(item?.depth) || 0)),
    acceptsChildren: item?.acceptsChildren === true,
    dropAfter: item?.dropAfter === true,
    presentation: String(item?.presentation || "default"),
    selectPresentation: String(item?.selectPresentation || "default"),
    labelIcon: String(item?.labelIcon || ""),
    thumbnail: normalizeThumbnailItem(item).thumbnail,
    media: item?.media ? Object.freeze({
      src: String(item.media.src || ""),
      fallback: String(item.media.fallback || ""),
      key: String(item.media.key || ""),
      presentation: String(item.media.presentation || "default"),
    }) : null,
    actions: Object.freeze((item?.actions || []).map((action) => Object.freeze({
      id: String(action?.id || ""),
      label: String(action?.label || action?.id || "Action"),
      icon: String(action?.icon || ""),
      presentation: String(action?.presentation || "default"),
      variant: String(action?.variant || action?.tone || action?.id || "default"),
      disabled: action?.disabled === true,
      position: action?.position === "leading" ? "leading" : "trailing",
      payload: Object.freeze({ ...(action?.payload && typeof action.payload === "object" ? action.payload : {}) }),
    })).filter((action) => action.id)),
  })).filter((item) => item.id);
}

function listContentSignature(inputs) {
  return JSON.stringify({
    items: inputs.items,
    emptyText: inputs.emptyText,
    disabled: inputs.disabled,
    itemNode: inputs.itemNode,
    presentation: inputs.presentation,
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
