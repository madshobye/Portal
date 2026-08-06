import { defineUiNode, UI_STATE_LIFETIMES } from "../ui-node.js";
import { presentationClassNames } from "../presentation.js";
import { reconcileRetainedChildren } from "../retained-children.js";
import { createSectionHeaderInstance } from "./section-header-node.js";
import { createRetainedScrollController } from "../scroll-state.js";

export const PanelNode = defineUiNode({
  id: "core.ui.panel",
  name: "Panel",
  version: "0.1.0",
  description: "Titled semantic content surface with a retained child slot.",
  inlets: {
    title: { type: "string", optional: true },
    icon: { type: "string", optional: true },
    media: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
    titleHidden: { type: "boolean", optional: true },
    hasTitleSlot: { type: "boolean", optional: true },
    headerPresentation: { type: "string", optional: true },
    hidden: { type: "boolean", optional: true },
  },
  outlets: {},
  capabilities: ["ui-container", "ui-panel"],
  factory: (context) => createContainerInstance(context, "panel"),
});

export const LayoutNode = defineUiNode({
  id: "core.ui.layout",
  name: "Layout",
  version: "0.1.0",
  description: "Row, column, grid, or split layout whose named slots host retained UI children.",
  inlets: {
    orientation: { type: "string", optional: true },
    slots: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
    sizing: { type: "string", optional: true },
    gap: { type: "number", optional: true },
  },
  outlets: {},
  capabilities: ["ui-container", "ui-layout"],
  factory: (context) => createContainerInstance(context, "layout"),
});

export const HostRegionNode = defineUiNode({
  id: "core.ui.host-region",
  name: "Host region",
  version: "0.1.0",
  description: "Explicitly configures a supplied application host as a retained named-slot layout.",
  inlets: {
    orientation: { type: "string", optional: true },
    slots: { type: "any", optional: true },
    presentation: { type: "string", optional: true },
    sizing: { type: "string", optional: true },
    gap: { type: "number", optional: true },
  },
  outlets: {},
  capabilities: ["ui-container", "ui-layout", "ui-host-integration"],
  factory: (context) => createContainerInstance(context, "layout", true),
});

export const TabsNode = defineUiNode({
  id: "core.ui.tabs",
  name: "Tabs",
  version: "0.1.0",
  description: "Retained tab selection, keyboard navigation, and named content slots.",
  inlets: {
    items: { type: "any", required: true },
    selectedId: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
    tabListPresentation: { type: "string", optional: true },
    panelsPresentation: { type: "string", optional: true },
  },
  outlets: { select: { type: "event", optional: true } },
  state: [{ id: "selectedId", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" }],
  events: ["select"],
  capabilities: ["ui-container", "ui-tabs", "keyboard-navigation", "scroll-restoration"],
  factory: createTabsInstance,
});

export const ModalNode = defineUiNode({
  id: "core.ui.modal",
  name: "Modal",
  version: "0.1.0",
  description: "Accessible modal overlay with private backdrop, close controls, and content slot.",
  inlets: {
    open: { type: "boolean", optional: true },
    title: { type: "string", optional: true },
    description: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
    contentPresentation: { type: "string", optional: true },
  },
  outlets: { close: { type: "event", optional: true } },
  events: ["close"],
  capabilities: ["ui-container", "ui-overlay", "ui-modal"],
  factory: (context) => createOverlayInstance(context, true),
});

export const PopupNode = defineUiNode({
  id: "core.ui.popup",
  name: "Popup",
  version: "0.1.0",
  description: "Non-modal popup surface with an owned dismissal lifecycle and content slot.",
  inlets: {
    open: { type: "boolean", optional: true },
    title: { type: "string", optional: true },
    description: { type: "string", optional: true },
    presentation: { type: "string", optional: true },
    contentPresentation: { type: "string", optional: true },
    position: { type: "any", optional: true },
    headerHidden: { type: "boolean", optional: true },
    closeOnOutside: { type: "boolean", optional: true },
    role: { type: "string", optional: true },
  },
  outlets: { close: { type: "event", optional: true } },
  events: ["close"],
  capabilities: ["ui-container", "ui-overlay", "ui-popup"],
  factory: (context) => createOverlayInstance(context, false),
});

export const UI_CONTAINER_NODE_DEFINITIONS = Object.freeze([
  PanelNode,
  LayoutNode,
  HostRegionNode,
  TabsNode,
  ModalNode,
  PopupNode,
]);

export function shouldRetainProjectedPanelMedia({ hasImage = false, previousKey = "", nextKey = "", src = "" } = {}) {
  return !src && hasImage && String(previousKey) === String(nextKey);
}

function createContainerInstance(context, kind, integrateHost = false) {
  const { id, host, inputs: initialInputs, document } = context;
  let inputs = initialInputs || {};
  let root = null;
  let content = null;
  let adoptedHost = false;
  let adoptedClassName = "";
  let panelHeader = null;
  let panelHeaderSlot = null;
  const slots = new Map();
  const slotClasses = new Map();

  function mount() {
    adoptedHost = kind === "layout" && integrateHost;
    root = adoptedHost ? host : document.createElement(kind === "panel" ? "section" : "div");
    if (adoptedHost) adoptedClassName = root.className;
    root.classList.add(`ui-node-${kind}`);
    root.dataset.uiNodeOwned = kind;
    if (kind === "panel") {
      panelHeader = createSectionHeaderInstance({
        ...context,
        host: root,
        inputs: panelHeaderInputs(inputs),
      });
      panelHeader.mount();
      panelHeader.part("title").dataset.uiPanelTitle = "";
      panelHeaderSlot = panelHeader.slot("actions");
      panelHeaderSlot.dataset.uiSlot = "header";
    }
    if (adoptedHost) {
      content = root;
    } else {
      content = document.createElement("div");
      content.className = `ui-node-${kind}-content`;
      root.append(content);
      host.replaceChildren(root);
    }
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    root.hidden = inputs.hidden === true;
    if (kind === "panel") {
      reconcileClassNames(root, "ui-node-panel", "", inputs.presentation);
      root.dataset.uiPresentation = String(inputs.presentation || "default");
      panelHeader.update(panelHeaderInputs(inputs));
    }
    if (kind === "layout") {
      reconcileClassNames(root, "ui-node-layout", adoptedHost ? adoptedClassName : "", inputs.presentation);
      root.dataset.uiPresentation = String(inputs.presentation || "default");
      root.dataset.uiLayoutAdopted = String(adoptedHost);
      root.dataset.uiLayoutSizing = inputs.sizing === "content" ? "content" : "fill";
      root.style?.setProperty?.("--ui-layout-gap", `${Math.max(0, Number(inputs.gap) || 0)}px`);
      root.dataset.orientation = ["row", "column", "grid", "split"].includes(inputs.orientation)
        ? inputs.orientation
        : "column";
      reconcileSlots(inputs.slots || ["default"]);
    }
  }

  function reconcileSlots(names) {
    const descriptors = names.map((value) => typeof value === "object" ? value : { id: value });
    const retained = new Set(descriptors.map((descriptor) => String(descriptor.id || "default")));
    for (const [slotId, element] of slots) {
      if (retained.has(slotId)) continue;
      element.remove();
      slots.delete(slotId);
      slotClasses.delete(slotId);
    }
    reconcileRetainedChildren(content, descriptors.map((descriptor) => ensureSlot(descriptor)));
  }

  function ensureSlot(value) {
    const descriptor = typeof value === "object" ? value : { id: value };
    const id = String(descriptor.id || "default");
    let element = slots.get(id);
    // A child asking for its named slot is a lookup, not a reconfiguration.
    // Preserve the classes/attributes established by the Layout descriptor.
    if (element && typeof value !== "object") return element;
    if (!element) {
      element = document.createElement("div");
      element.dataset.uiSlot = id;
      slots.set(id, element);
    }
    const previousClasses = slotClasses.get(id) || [];
    element.classList.remove(...previousClasses);
    const nextClasses = [
      ...presentationClassNames(descriptor.presentation),
    ];
    element.classList.add("ui-node-layout-slot", ...nextClasses);
    slotClasses.set(id, nextClasses);
    if (descriptor.scrollKey) {
      element.dataset.scrollRegion = "";
      element.dataset.scrollKey = String(descriptor.scrollKey);
    } else {
      delete element.dataset.scrollRegion;
      delete element.dataset.scrollKey;
    }
    element.dataset.uiSlotFill = String(descriptor.fill === true);
    element.dataset.uiPresentation = String(descriptor.presentation || "default");
    element.dataset.uiSlotOverflow = ["visible", "hidden", "auto", "scroll"].includes(descriptor.overflow)
      ? descriptor.overflow
      : "visible";
    element.style?.setProperty?.("--ui-slot-grow", finiteCssNumber(descriptor.grow, 1));
    element.style?.setProperty?.("--ui-slot-shrink", finiteCssNumber(descriptor.shrink, 1));
    element.style?.setProperty?.("--ui-slot-basis", cssBasis(descriptor.basis));
    return element;
  }

  function slot(name = "default") {
    if (kind === "panel") {
      if (name === "header-title" || name === "title") return panelHeader?.slot("title");
      if (String(name).startsWith("header-action:")) return panelHeader?.slot(String(name).slice("header-".length));
      return name === "header" || name === "header-actions" ? panelHeaderSlot : content;
    }
    if (kind !== "layout") return content;
    const element = ensureSlot(name);
    if (!element.parentNode) content.append(element);
    return element;
  }

  function dispose() {
    if (adoptedHost) {
      for (const element of slots.values()) element.remove();
      root?.removeAttribute("data-ui-node-owned");
      root?.removeAttribute("data-orientation");
      root?.removeAttribute("data-ui-layout-adopted");
      if (root) root.className = adoptedClassName;
    } else {
      panelHeader?.dispose?.();
      root?.remove();
    }
    root = null;
    content = null;
    panelHeader = null;
    panelHeaderSlot = null;
    adoptedClassName = "";
    slots.clear();
    slotClasses.clear();
  }

  return Object.freeze({ mount, update, dispose, slot, element: () => root });
}

function panelHeaderInputs(inputs = {}) {
  return {
    title: String(inputs.title || "Panel"),
    icon: String(inputs.icon || ""),
    media: inputs.media || null,
    titleHidden: inputs.titleHidden === true,
    titleSlotVisible: inputs.hasTitleSlot === true,
    presentation: String(inputs.headerPresentation || "default"),
  };
}

function createTabsInstance({ id, host, inputs: initialInputs, stateAddress, state, document, emit }) {
  let inputs = normalizeTabs(initialInputs);
  let root = null;
  let tabList = null;
  let panels = null;
  const tabButtons = new Map();
  const slots = new Map();
  const baseAddress = stateAddress || `nodes/${id}`;
  const selectionAddress = `${baseAddress}/selected`;
  const scrollControllers = new Map();

  function mount() {
    root = document.createElement("section");
    root.className = "ui-node-tabs";
    root.dataset.uiNodeOwned = "tabs";
    tabList = document.createElement("div");
    tabList.className = "ui-node-tab-list";
    tabList.setAttribute("role", "tablist");
    panels = document.createElement("div");
    panels.className = "ui-node-tab-panels";
    root.append(tabList, panels);
    tabList.addEventListener("click", onClick);
    tabList.addEventListener("keydown", onKeyDown);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = normalizeTabs(nextInputs);
    reconcileClassNames(root, "ui-node-tabs", "", inputs.presentation);
    reconcileClassNames(tabList, "ui-node-tab-list", "", inputs.tabListPresentation);
    reconcileClassNames(panels, "ui-node-tab-panels", "", inputs.panelsPresentation);
    root.dataset.uiPresentation = inputs.presentation;
    const requestedId = inputs.selectedId || state.get(selectionAddress, inputs.items[0]?.id || "");
    const selectedId = inputs.items.some((item) => item.id === requestedId && !item.disabled)
      ? requestedId
      : inputs.items.find((item) => !item.disabled)?.id || "";
    const retained = new Set(inputs.items.map((item) => item.id));
    for (const [tabId, tab] of tabButtons) {
      if (retained.has(tabId)) continue;
      tab.remove();
      tabButtons.delete(tabId);
    }
    for (const [index, item] of inputs.items.entries()) {
      const tab = ensureTab(item.id);
      tab.className = presentationClassNames(item.tabPresentation).join(" ");
      tab.dataset.uiPresentation = item.tabPresentation;
      if (tab.textContent !== item.label) tab.textContent = item.label;
      tab.disabled = item.disabled;
      tab.setAttribute("aria-selected", String(item.id === selectedId));
      tab.tabIndex = item.id === selectedId ? 0 : -1;
      const currentAtIndex = tabList.children[index] || null;
      if (currentAtIndex !== tab) tabList.insertBefore(tab, currentAtIndex);
    }
    for (const [slotId, panel] of slots) {
      if (retained.has(slotId)) continue;
      scrollControllers.get(slotId)?.dispose();
      scrollControllers.delete(slotId);
      panel.remove();
      slots.delete(slotId);
    }
    for (const item of inputs.items) {
      const panel = ensurePanel(item.id);
      reconcileClassNames(panel, "ui-node-tab-panel", "", item.panelPresentation);
      panel.dataset.uiPresentation = item.panelPresentation;
      if (item.scrollKey) panel.dataset.uiScrollKey = item.scrollKey;
      else delete panel.dataset.uiScrollKey;
      panel.hidden = item.id !== selectedId;
    }
    state.set(selectionAddress, selectedId, UI_STATE_LIFETIMES.SESSION);
  }

  function onClick(event) {
    const tab = event.target.closest?.("[data-ui-tab]");
    if (!tab || !tabList.contains(tab) || tab.disabled) return;
    select(tab.dataset.uiTab);
  }

  function onKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const enabled = [...tabList.querySelectorAll("[data-ui-tab]")].filter((tab) => !tab.disabled);
    const current = Math.max(0, enabled.indexOf(document.activeElement));
    const index = event.key === "Home" ? 0
      : event.key === "End" ? enabled.length - 1
        : event.key === "ArrowLeft" ? Math.max(0, current - 1)
          : Math.min(enabled.length - 1, current + 1);
    event.preventDefault();
    enabled[index]?.focus();
    select(enabled[index]?.dataset.uiTab);
  }

  function select(selectedId) {
    if (!selectedId) return;
    state.set(selectionAddress, selectedId, UI_STATE_LIFETIMES.SESSION);
    update({ ...inputs, selectedId });
    emit("select", { id: selectedId });
  }

  function ensureTab(name) {
    const tabId = String(name || "default");
    if (tabButtons.has(tabId)) return tabButtons.get(tabId);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.uiTab = tabId;
    tab.id = `ui-tab-${id}-${tabId}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `ui-tab-panel-${id}-${tabId}`);
    tabButtons.set(tabId, tab);
    tabList.append(tab);
    return tab;
  }

  function ensurePanel(name) {
    const slotId = String(name || "default");
    if (slots.has(slotId)) return slots.get(slotId);
    const panel = document.createElement("div");
    panel.className = "ui-node-tab-panel";
    panel.dataset.uiSlot = slotId;
    panel.id = `ui-tab-panel-${id}-${slotId}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `ui-tab-${id}-${slotId}`);
    slots.set(slotId, panel);
    panels.append(panel);
    const controller = createRetainedScrollController({
      state,
      address: panelScrollAddress(slotId),
      window: document?.defaultView || globalThis,
    });
    scrollControllers.set(slotId, controller);
    controller.attach(panel);
    return panel;
  }

  function panelScrollAddress(slotId) {
    return `${baseAddress}/panels/${encodeStateAddressPart(slotId)}/scroll`;
  }

  function dispose() {
    tabList?.removeEventListener("click", onClick);
    tabList?.removeEventListener("keydown", onKeyDown);
    for (const controller of scrollControllers.values()) controller.dispose();
    scrollControllers.clear();
    root?.remove();
    tabButtons.clear();
    slots.clear();
  }

  return Object.freeze({ mount, update, dispose, slot: ensurePanel, element: () => root });
}

function createOverlayInstance({ id, host, inputs: initialInputs, document, emit }, modal) {
  let inputs = initialInputs || {};
  let root = null;
  let surface = null;
  let title = null;
  let description = null;
  let content = null;
  let header = null;
  let previouslyFocused = null;
  let wasOpen = false;
  let positionFrame = 0;

  function mount() {
    root = document.createElement("div");
    root.className = modal ? "ui-node-modal" : "ui-node-popup";
    root.dataset.uiNodeOwned = modal ? "modal" : "popup";
    if (modal) {
      const backdrop = document.createElement("button");
      backdrop.type = "button";
      backdrop.className = "ui-node-modal-backdrop";
      backdrop.tabIndex = -1;
      backdrop.setAttribute("aria-label", "Close");
      backdrop.addEventListener("click", close);
      root.append(backdrop);
    }
    surface = document.createElement("section");
    surface.className = "ui-node-overlay-surface";
    surface.setAttribute("role", modal ? "dialog" : "region");
    surface.setAttribute("aria-modal", String(modal));
    surface.tabIndex = -1;
    header = document.createElement("header");
    header.className = "ui-node-overlay-header";
    const heading = document.createElement("div");
    heading.className = "ui-node-overlay-heading";
    title = document.createElement("h2");
    title.id = `ui-overlay-title-${id}`;
    surface.setAttribute("aria-labelledby", title.id);
    description = document.createElement("p");
    description.id = `ui-overlay-description-${id}`;
    description.className = "ui-node-overlay-description";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.className = "ui-node-overlay-close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", close);
    heading.append(title, description);
    header.append(heading, closeButton);
    content = document.createElement("div");
    content.className = "ui-node-overlay-content";
    surface.append(header, content);
    root.append(surface);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("pointerdown", onRootPointerDown);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    const open = inputs.open === true;
    root.hidden = !open;
    title.textContent = String(inputs.title || (modal ? "Dialog" : "Popup"));
    description.textContent = String(inputs.description || "");
    description.hidden = !inputs.description;
    header.hidden = inputs.headerHidden === true;
    if (inputs.description) surface.setAttribute("aria-describedby", description.id);
    else surface.removeAttribute("aria-describedby");
    surface.setAttribute("role", String(inputs.role || (modal ? "dialog" : "region")));
    reconcileClassNames(surface, "ui-node-overlay-surface", "", inputs.presentation);
    reconcileClassNames(content, "ui-node-overlay-content", "", inputs.contentPresentation);
    surface.dataset.uiPresentation = String(inputs.presentation || "default");
    content.dataset.uiPresentation = String(inputs.contentPresentation || "default");
    reconcilePosition();
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement;
      surface.focus?.();
    } else if (!open && wasOpen) {
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
    wasOpen = open;
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!modal || event.key !== "Tab") return;
    const focusable = [...surface.querySelectorAll("button, input, select, textarea, [tabindex]")]
      .filter((element) => !element.disabled && element.tabIndex >= 0);
    if (!focusable.length) {
      event.preventDefault();
      surface.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close() {
    emit("close", {});
  }

  function onRootPointerDown(event) {
    if (!modal && inputs.closeOnOutside !== false && event.target === root) close();
  }

  function reconcilePosition() {
    const positioned = !modal && inputs.position && typeof inputs.position === "object";
    root.classList.toggle("is-positioned", positioned);
    if (!positioned) {
      surface.style.removeProperty("left");
      surface.style.removeProperty("top");
      return;
    }
    const place = () => {
      positionFrame = 0;
      if (!surface || !inputs.position) return;
      const padding = Math.max(0, Number(inputs.position.padding) || 8);
      const bounds = surface.getBoundingClientRect();
      const viewportWidth = Math.max(0, Number(document.defaultView?.innerWidth) || 0);
      const viewportHeight = Math.max(0, Number(document.defaultView?.innerHeight) || 0);
      const requestedX = Math.max(padding, Number(inputs.position.x) || padding);
      const requestedY = Math.max(padding, Number(inputs.position.y) || padding);
      const x = viewportWidth
        ? Math.max(padding, Math.min(requestedX, viewportWidth - bounds.width - padding))
        : requestedX;
      const y = viewportHeight
        ? Math.max(padding, Math.min(requestedY, viewportHeight - bounds.height - padding))
        : requestedY;
      surface.style.left = `${x}px`;
      surface.style.top = `${y}px`;
    };
    place();
    const schedule = document.defaultView?.requestAnimationFrame || globalThis.requestAnimationFrame;
    if (schedule) positionFrame = schedule(place);
  }

  function dispose() {
    if (wasOpen) previouslyFocused?.focus?.();
    const cancel = document.defaultView?.cancelAnimationFrame || globalThis.cancelAnimationFrame;
    if (positionFrame) cancel?.(positionFrame);
    root?.removeEventListener("keydown", onKeyDown);
    root?.removeEventListener("pointerdown", onRootPointerDown);
    root?.remove();
    root = null;
    surface = null;
    content = null;
    description = null;
    header = null;
    previouslyFocused = null;
    wasOpen = false;
  }

  return Object.freeze({ mount, update, dispose, slot: () => content, element: () => root });
}

function reconcileClassNames(element, baseClass, preservedClassName = "", presentation = "") {
  element.className = [...new Set([
    ...String(preservedClassName || "").split(/\s+/).filter(Boolean),
    baseClass,
    ...presentationClassNames(presentation),
  ])].join(" ");
}

function finiteCssNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(number) : String(fallback);
}

function cssBasis(value) {
  if (value === undefined || value === null || value === "") return "0px";
  if (typeof value === "number" && Number.isFinite(value)) return `${Math.max(0, value)}px`;
  const text = String(value);
  return /^(?:auto|content|0|\d+(?:\.\d+)?(?:px|%|rem|em|fr))$/.test(text) ? text : "0px";
}

function normalizeTabs(inputs = {}) {
  return {
    selectedId: String(inputs.selectedId || ""),
    presentation: String(inputs.presentation || "default"),
    tabListPresentation: String(inputs.tabListPresentation || "default"),
    panelsPresentation: String(inputs.panelsPresentation || "default"),
    items: (inputs.items || []).map((item) => {
      const source = typeof item === "object" ? item : { id: item, label: item };
      return {
        id: String(source.id || ""),
        label: String(source.label || source.id || "Tab"),
        disabled: source.disabled === true,
        tabPresentation: String(source.tabPresentation || "default"),
        panelPresentation: String(source.panelPresentation || "default"),
        scrollKey: String(source.scrollKey || ""),
      };
    }).filter((item) => item.id),
  };
}

function encodeStateAddressPart(value) {
  return encodeURIComponent(String(value || "default")).replaceAll("%", "_");
}
