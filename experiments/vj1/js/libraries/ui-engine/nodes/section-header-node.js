import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";

export const SectionHeaderNode = defineUiNode({
  id: "core.ui.section-header",
  name: "Section Header",
  version: "0.1.0",
  description: "Shared section identity header with optional media, editable title content, and semantic actions.",
  inlets: {
    title: { type: "string", optional: true },
    icon: { type: "string", optional: true },
    media: { type: "any", optional: true },
    actions: { type: "any", optional: true },
    titleHidden: { type: "boolean", optional: true },
    titleSlotVisible: { type: "boolean", optional: true },
    presentation: { type: "string", optional: true },
  },
  outlets: { action: { type: "event", optional: true } },
  events: ["action"],
  capabilities: ["ui-display", "ui-container", "ui-section-header"],
  factory: createSectionHeaderInstance,
});

export function createSectionHeaderInstance(context) {
  const { host, document, emit = () => {} } = context;
  let inputs = normalizeInputs(context.inputs);
  let root = null;
  let media = null;
  let mediaKey = "";
  let icon = null;
  let title = null;
  let titleSlot = null;
  let actions = null;
  const actionSlots = new Map();

  function mount() {
    root = document.createElement("header");
    root.dataset.uiNodeOwned = "section-header";
    media = document.createElement("span");
    icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    title = document.createElement("strong");
    titleSlot = document.createElement("div");
    actions = document.createElement("div");
    root.className = "ui-node-section-header";
    media.className = "ui-node-section-header-media";
    icon.className = "ui-node-section-header-icon";
    title.className = "ui-node-section-header-title";
    titleSlot.className = "ui-node-section-header-title-slot";
    actions.className = "ui-node-section-header-actions";
    root.append(media, icon, title, titleSlot, actions);
    root.addEventListener("click", onClick);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeInputs(nextInputs);
    root.dataset.uiPresentation = inputs.presentation;
    title.textContent = inputs.title;
    title.hidden = inputs.titleHidden || inputs.titleSlotVisible;
    titleSlot.hidden = !inputs.titleSlotVisible;
    icon.textContent = inputs.icon;
    icon.hidden = !inputs.icon;
    reconcileMedia(inputs.media);
    reconcileActions(inputs.actions);
  }

  function reconcileMedia(descriptor) {
    media.hidden = !descriptor;
    if (!descriptor) {
      media.className = "ui-node-section-header-media";
      media.replaceChildren();
      delete media.dataset.uiMediaKey;
      mediaKey = "";
      return;
    }
    const previousKey = mediaKey;
    const nextKey = String(descriptor.key || "");
    mediaKey = nextKey;
    media.className = "ui-node-section-header-media";
    if (nextKey) media.dataset.uiMediaKey = nextKey;
    else delete media.dataset.uiMediaKey;
    const currentImage = media.querySelector?.("img");
    if (descriptor.src) {
      if (currentImage?.getAttribute?.("src") === String(descriptor.src)) return;
      const image = document.createElement("img");
      image.src = String(descriptor.src);
      image.alt = String(descriptor.alt || "");
      image.loading = "lazy";
      media.replaceChildren(image);
      return;
    }
    if (!descriptor.src && currentImage && previousKey === nextKey) return;
    media.textContent = String(descriptor.fallbackIcon || "");
  }

  function reconcileActions(descriptors) {
    const projected = [...actions.children].filter((child) => !child.dataset.uiSectionHeaderAction);
    const buttons = descriptors.map((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.uiSectionHeaderAction = action.id;
      button.title = action.label;
      button.setAttribute("aria-label", action.label);
      button.disabled = action.disabled;
      const glyph = document.createElement("span");
      glyph.className = "ui-node-section-header-action-icon";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = action.icon || action.label;
      button.append(glyph);
      return button;
    });
    actions.replaceChildren(...projected, ...buttons);
  }

  function onClick(event) {
    const action = event.target.closest?.("[data-ui-section-header-action]");
    if (!action || !root.contains(action)) return;
    emit("action", { id: String(action.dataset.uiSectionHeaderAction || "") }, UI_COMMAND_PHASES.COMMIT);
  }

  function slot(name = "actions") {
    if (name === "media") return media;
    if (name === "title") return titleSlot;
    if (String(name).startsWith("action:")) {
      const id = String(name).slice("action:".length);
      if (!actionSlots.has(id)) {
        const actionSlot = document.createElement("span");
        actionSlot.className = "ui-node-section-header-action-slot";
        actionSlot.dataset.uiSectionHeaderActionSlot = id;
        actionSlots.set(id, actionSlot);
        actions.append(actionSlot);
      }
      return actionSlots.get(id);
    }
    return actions;
  }

  function part(name) {
    return { media, icon, title, titleSlot, actions }[name] || null;
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.remove();
    root = null;
    media = null;
    icon = null;
    title = null;
    titleSlot = null;
    actions = null;
    actionSlots.clear();
  }

  return Object.freeze({ mount, update, dispose, slot, part, element: () => root });
}

function normalizeInputs(source = {}) {
  return {
    title: String(source.title || ""),
    icon: String(source.icon || ""),
    media: source.media && typeof source.media === "object" ? source.media : null,
    actions: (source.actions || []).map((action) => ({
      id: String(action?.id || ""),
      label: String(action?.label || action?.id || "Action"),
      icon: String(action?.icon || ""),
      disabled: action?.disabled === true,
    })).filter((action) => action.id),
    titleHidden: source.titleHidden === true,
    titleSlotVisible: source.titleSlotVisible === true,
    presentation: String(source.presentation || "default"),
  };
}
