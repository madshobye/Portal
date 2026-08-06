import { defineUiNode } from "../ui-node.js";

export const DEFAULT_DESTRUCTIVE_REVEAL_DELAY_MS = 3000;

export const ThumbnailButtonNode = defineUiNode({
  id: "core.ui.thumbnail-button",
  name: "Thumbnail Button",
  version: "0.1.0",
  description: "Reusable retained thumbnail item with a label, badges, and semantic actions.",
  inlets: {
    item: { type: "any", required: true },
    selected: { type: "boolean", optional: true },
    reorderable: { type: "boolean", optional: true },
  },
  outlets: {
    activate: { type: "event", optional: true },
    action: { type: "event", optional: true },
    context: { type: "event", optional: true },
  },
  events: ["activate", "action", "context"],
  capabilities: ["ui-item", "thumbnail-presentation"],
  factory: createThumbnailButtonInstance,
});

export function createThumbnailButtonInstance({ host, inputs: initialInputs, document, emit = () => {} }) {
  let inputs = normalizeInputs(initialInputs);
  let root = null;
  let button = null;
  let media = null;
  let image = null;
  let fallback = null;
  let labelIcon = null;
  let label = null;
  let meta = null;
  let actions = null;
  let revealTimer = 0;
  let revealDelayElapsed = false;
  let destructiveActionsRevealed = false;
  let pointerPosition = null;

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-thumbnail-item";
    root.setAttribute("role", "option");

    button = document.createElement("button");
    button.type = "button";
    button.className = "ui-node-thumbnail-button";

    media = document.createElement("span");
    media.className = "ui-node-thumbnail-media";
    image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    fallback = document.createElement("span");
    fallback.className = "ui-node-thumbnail-fallback";
    fallback.setAttribute("aria-hidden", "true");
    media.append(image, fallback);

    const copy = document.createElement("span");
    copy.className = "ui-node-thumbnail-copy";
    labelIcon = document.createElement("span");
    labelIcon.className = "ui-node-thumbnail-label-icon";
    labelIcon.setAttribute("aria-hidden", "true");
    label = document.createElement("span");
    label.className = "ui-node-thumbnail-label";
    meta = document.createElement("small");
    copy.append(labelIcon, label, meta);

    actions = document.createElement("span");
    actions.className = "ui-node-thumbnail-actions";
    root.append(button, actions);
    button.append(media, copy);
    root.addEventListener("click", onClick);
    root.addEventListener("contextmenu", onContextMenu);
    root.addEventListener("pointerenter", onPointerEnter);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerleave", onPointerLeave);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeInputs(nextInputs);
    const { item, selected, reorderable } = inputs;
    root.dataset.uiListItem = item.id;
    root.dataset.uiFilterText = item.searchText;
    root.setAttribute("aria-selected", String(selected));
    root.classList.toggle("is-selected", selected);
    if (reorderable || item.reorderable) root.setAttribute("draggable", "true");
    else root.removeAttribute("draggable");

    button.dataset.uiListSelect = item.id;
    button.disabled = item.disabled;
    button.setAttribute("aria-disabled", String(item.disabled));
    button.classList.toggle("is-selected", selected);

    label.textContent = item.label;
    labelIcon.textContent = item.labelIcon;
    labelIcon.hidden = !item.labelIcon;
    meta.textContent = item.meta;
    meta.hidden = !item.meta;

    if (item.thumbnail.key) media.dataset.uiMediaKey = item.thumbnail.key;
    else delete media.dataset.uiMediaKey;
    if (item.thumbnail.src) {
      if (image.getAttribute("src") !== item.thumbnail.src) image.src = item.thumbnail.src;
      image.hidden = false;
      fallback.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      fallback.textContent = item.thumbnail.fallback || item.labelIcon;
      fallback.hidden = false;
    }

    actions.replaceChildren(...item.actions.map(actionButton));
  }

  function actionButton(action) {
    const actionElement = document.createElement("button");
    actionElement.type = "button";
    actionElement.className = "ui-node-thumbnail-action";
    actionElement.dataset.uiListAction = action.id;
    actionElement.dataset.uiListItem = inputs.item.id;
    actionElement.dataset.uiActionVariant = action.variant;
    actionElement.dataset.uiRevealDelayMs = String(action.revealDelayMs);
    actionElement.title = action.label;
    actionElement.setAttribute("aria-label", `${action.label} ${inputs.item.label}`);
    actionElement.textContent = action.icon || action.label;
    actionElement.disabled = action.disabled;
    if (action.revealDelayMs > 0 && !destructiveActionsRevealed) {
      actionElement.tabIndex = -1;
      actionElement.setAttribute("aria-hidden", "true");
    }
    return actionElement;
  }

  function onPointerEnter(event) {
    rememberPointerPosition(event);
    if (destructiveActionsRevealed || revealTimer) return;
    const delay = inputs.item.actions
      .filter((action) => !action.disabled && action.revealDelayMs > 0)
      .reduce((minimum, action) => Math.min(minimum, action.revealDelayMs), Infinity);
    if (!Number.isFinite(delay)) return;
    const schedule = document.defaultView?.setTimeout || globalThis.setTimeout;
    revealTimer = schedule(() => {
      revealTimer = 0;
      revealDelayElapsed = true;
      revealDestructiveActionsIfSafe();
    }, delay);
  }

  function onPointerMove(event) {
    rememberPointerPosition(event);
    if (revealDelayElapsed && !destructiveActionsRevealed) revealDestructiveActionsIfSafe();
  }

  function onPointerLeave() {
    resetDestructiveActionReveal();
  }

  function rememberPointerPosition(event) {
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (Number.isFinite(x) && Number.isFinite(y)) pointerPosition = { x, y };
  }

  function revealDestructiveActionsIfSafe() {
    if (!pointerPosition || pointerOverDelayedAction(pointerPosition)) return;
    setDestructiveActionsRevealed(true);
  }

  function pointerOverDelayedAction({ x, y }) {
    for (const action of actions?.querySelectorAll?.("[data-ui-reveal-delay-ms]") || []) {
      if (Number(action.dataset.uiRevealDelayMs) <= 0) continue;
      const bounds = action.getBoundingClientRect?.();
      if (bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) return true;
    }
    return false;
  }

  function setDestructiveActionsRevealed(revealed) {
    destructiveActionsRevealed = revealed === true;
    root?.classList.toggle("has-revealed-destructive-actions", destructiveActionsRevealed);
    for (const action of actions?.querySelectorAll?.("[data-ui-reveal-delay-ms]") || []) {
      const delayed = Number(action.dataset.uiRevealDelayMs) > 0;
      if (!delayed) continue;
      action.tabIndex = destructiveActionsRevealed ? 0 : -1;
      if (destructiveActionsRevealed) action.removeAttribute("aria-hidden");
      else action.setAttribute("aria-hidden", "true");
    }
  }

  function resetDestructiveActionReveal() {
    const cancel = document.defaultView?.clearTimeout || globalThis.clearTimeout;
    if (revealTimer) cancel(revealTimer);
    revealTimer = 0;
    revealDelayElapsed = false;
    pointerPosition = null;
    setDestructiveActionsRevealed(false);
  }

  function onClick(event) {
    const action = event.target.closest?.("[data-ui-list-action]");
    if (action && root.contains(action)) {
      if (Number(action.dataset.uiRevealDelayMs) > 0 && !destructiveActionsRevealed) return;
      emit("action", { id: inputs.item.id, action: action.dataset.uiListAction });
      return;
    }
    if (event.target.closest?.("[data-ui-list-select]")) emit("activate", { id: inputs.item.id });
  }

  function onContextMenu(event) {
    if (!event.target.closest?.("[data-ui-list-select]")) return;
    event.preventDefault();
    emit("context", { id: inputs.item.id, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0 });
  }

  function updateMedia(entries = []) {
    const key = inputs.item.thumbnail.key;
    if (!key) return false;
    const entry = (entries || []).find((candidate) =>
      `${String(candidate?.componentId || "")}:${String(candidate?.surfaceId || "")}` === key
    );
    const src = String(entry?.url || "");
    if (!src || src === inputs.item.thumbnail.src) return false;
    update({
      ...inputs,
      item: { ...inputs.item, thumbnail: { ...inputs.item.thumbnail, src } },
    });
    return true;
  }

  function dispose() {
    resetDestructiveActionReveal();
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("contextmenu", onContextMenu);
    root?.removeEventListener("pointerenter", onPointerEnter);
    root?.removeEventListener("pointermove", onPointerMove);
    root?.removeEventListener("pointerleave", onPointerLeave);
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, updateMedia, dispose, element: () => root });
}

export function normalizeThumbnailItem(item = {}) {
  return Object.freeze({
    id: String(item.id || ""),
    label: String(item.label || item.name || item.id || "Item"),
    meta: String(item.meta || ""),
    searchText: String(item.searchText || item.label || item.name || ""),
    labelIcon: String(item.labelIcon || item.icon || ""),
    disabled: item.disabled === true,
    reorderable: item.reorderable === true,
    thumbnail: Object.freeze({
      src: String(item.thumbnail?.src || item.media?.src || ""),
      fallback: String(item.thumbnail?.fallback || item.media?.fallback || ""),
      key: String(item.thumbnail?.key || item.media?.key || ""),
    }),
    actions: Object.freeze((item.actions || []).map((action) => {
      const variant = String(action?.variant || action?.tone || action?.id || "default");
      const requestedDelay = action?.revealDelayMs;
      return Object.freeze({
        id: String(action?.id || ""),
        label: String(action?.label || action?.id || "Action"),
        icon: String(action?.icon || ""),
        variant,
        disabled: action?.disabled === true,
        revealDelayMs: Math.max(0, Number(requestedDelay ?? (variant === "remove" ? DEFAULT_DESTRUCTIVE_REVEAL_DELAY_MS : 0)) || 0),
        payload: Object.freeze({ ...(action?.payload && typeof action.payload === "object" ? action.payload : {}) }),
      });
    }).filter((action) => action.id)),
  });
}

function normalizeInputs(inputs = {}) {
  return {
    item: normalizeThumbnailItem(inputs.item),
    selected: inputs.selected === true,
    reorderable: inputs.reorderable === true,
  };
}
