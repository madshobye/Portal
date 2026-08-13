import { defineUiNode, UI_COMMAND_PHASES, UI_STATE_LIFETIMES } from "../ui-node.js";
import { createRetainedScrollController } from "../scroll-state.js";

export const CatalogPickerNode = defineUiNode({
  id: "core.ui.catalog-picker",
  name: "Catalog picker",
  version: "0.1.0",
  description: "Searchable and filterable retained catalog with sectioned cards, semantic selection, and lazy media lifecycle.",
  inlets: {
    title: { type: "string", optional: true },
    description: { type: "string", optional: true },
    searchPlaceholder: { type: "string", optional: true },
    filters: { type: "any", optional: true },
    sections: { type: "any", optional: true },
    actions: { type: "any", optional: true },
    activeFilter: { type: "string", optional: true },
    search: { type: "string", optional: true },
    noResultsText: { type: "string", optional: true },
    lockedFilter: { type: "boolean", optional: true },
  },
  outlets: {
    close: { type: "event", optional: true },
    select: { type: "event", optional: true },
    action: { type: "event", optional: true },
    filter: { type: "event", optional: true },
    search: { type: "event", optional: true },
  },
  state: [
    { id: "filter", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "all" },
    { id: "search", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" },
    { id: "scroll", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: { top: 0, left: 0 } },
    { id: "activeItem", lifetime: UI_STATE_LIFETIMES.SESSION, defaultValue: "" },
  ],
  events: ["close", "select", "action", "filter", "search"],
  control: "catalog-picker",
  capabilities: ["ui-overlay", "searchable-catalog", "filterable-catalog", "keyboard-navigation", "lazy-media", "scroll-restoration"],
  factory: createCatalogPickerInstance,
});

export function createCatalogPickerInstance({ id, host, inputs: initialInputs, stateAddress, state, document, capabilities, emit }) {
  let inputs = normalizePickerInputs(initialInputs);
  let root = null;
  let panel = null;
  let title = null;
  let description = null;
  let headerActions = null;
  let searchInput = null;
  let filters = null;
  let body = null;
  let noResults = null;
  let observer = null;
  let intentMedia = null;
  let intentTimer = 0;
  const loadedMedia = new Map();
  const mediaPreview = capabilities?.mediaPreview || null;
  const baseAddress = stateAddress || `nodes/${id}`;
  const filterAddress = `${baseAddress}/filter`;
  const searchAddress = `${baseAddress}/search`;
  const scrollAddress = `${baseAddress}/scroll`;
  const activeItemAddress = `${baseAddress}/active-item`;
  const scroll = createRetainedScrollController({
    state,
    address: scrollAddress,
    window: document?.defaultView || globalThis,
  });

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-catalog-picker";
    root.dataset.uiNodeOwned = "catalog-picker";
    const backdrop = document.createElement("div");
    backdrop.className = "ui-node-catalog-backdrop";
    backdrop.addEventListener("click", onClose);
    panel = document.createElement("section");
    panel.className = "ui-node-catalog-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const header = document.createElement("header");
    const copy = document.createElement("div");
    title = document.createElement("strong");
    description = document.createElement("small");
    copy.append(title, description);
    headerActions = document.createElement("span");
    headerActions.className = "ui-node-catalog-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.uiCatalogClose = "";
    close.setAttribute("aria-label", "Close");
    setActionButtonContent(close, { icon: "close", label: "Close" }, document);
    headerActions.append(close);
    header.append(copy, headerActions);
    const searchLabel = document.createElement("label");
    searchLabel.className = "ui-node-catalog-search";
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.autocomplete = "off";
    searchLabel.append(searchInput);
    filters = document.createElement("nav");
    filters.className = "ui-node-catalog-filters";
    filters.setAttribute("role", "tablist");
    body = document.createElement("div");
    body.className = "ui-node-catalog-body";
    noResults = document.createElement("div");
    noResults.className = "ui-node-catalog-empty";
    body.append(noResults);
    panel.append(header, searchLabel, filters, body);
    root.append(backdrop, panel);
    panel.addEventListener("click", onClick);
    panel.addEventListener("keydown", onKeyDown);
    panel.addEventListener("pointerover", onMediaIntentPointerOver);
    panel.addEventListener("pointerout", onMediaIntentPointerOut);
    panel.addEventListener("focusin", onMediaIntentFocus);
    searchInput.addEventListener("input", onSearch);
    host.replaceChildren(root);
    update(inputs);
    scroll.attach(body);
  }

  function update(nextInputs = {}) {
    inputs = normalizePickerInputs(nextInputs);
    root.className = "ui-node-catalog-picker";
    title.textContent = inputs.title;
    description.textContent = inputs.description;
    description.hidden = !inputs.description;
    panel.setAttribute("aria-label", inputs.title);
    searchInput.placeholder = inputs.searchPlaceholder;
    const storedSearch = String(state.get(searchAddress, inputs.search) || "");
    if (document.activeElement !== searchInput && searchInput.value !== storedSearch) searchInput.value = storedSearch;
    const storedFilter = String(state.get(filterAddress, inputs.activeFilter) || "all");
    reconcileActions();
    reconcileFilters(storedFilter);
    reconcileSections();
    applyVisibility(storedSearch, storedFilter);
    observeMedia();
  }

  function reconcileActions() {
    headerActions.querySelectorAll("[data-ui-catalog-action]").forEach((button) => button.remove());
    const close = headerActions.querySelector("[data-ui-catalog-close]");
    for (const action of inputs.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.uiCatalogAction = action.id;
      button.title = action.label;
      button.setAttribute("aria-label", action.label);
      setActionButtonContent(button, action, document);
      button.disabled = action.disabled;
      headerActions.insertBefore(button, close);
    }
  }

  function reconcileFilters(active) {
    filters.replaceChildren(...inputs.filters.map((filter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.uiCatalogFilter = filter.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(filter.id === active));
      button.classList.toggle("is-active", filter.id === active);
      button.disabled = inputs.lockedFilter || filter.disabled;
      button.textContent = filter.label;
      return button;
    }));
    filters.hidden = inputs.filters.length === 0;
  }

  function reconcileSections() {
    releaseDetachedMedia();
    body.querySelectorAll("[data-ui-catalog-section]").forEach((section) => section.remove());
    releaseDetachedMedia();
    for (const section of inputs.sections) {
      const element = document.createElement("section");
      element.dataset.uiCatalogSection = section.id;
      const heading = document.createElement("header");
      const headingLabel = document.createElement("span");
      headingLabel.textContent = section.label;
      const headingActions = document.createElement("span");
      headingActions.className = "ui-node-catalog-section-actions";
      for (const action of section.actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.uiCatalogAction = action.id;
        button.dataset.uiCatalogSectionId = section.id;
        button.title = action.label;
        button.setAttribute("aria-label", action.label);
        setActionButtonContent(button, action, document);
        headingActions.append(button);
      }
      heading.append(headingLabel, headingActions);
      const grid = document.createElement("div");
      grid.className = "ui-node-catalog-grid";
      for (const item of section.items) grid.append(createCard(item));
      const empty = document.createElement("div");
      empty.className = "ui-node-catalog-empty";
      empty.dataset.uiCatalogSectionEmpty = "";
      empty.textContent = section.emptyText;
      empty.hidden = true;
      element.append(heading, grid, empty);
      body.insertBefore(element, noResults);
    }
    noResults.textContent = inputs.noResultsText;
  }

  function createCard(item) {
    const shell = document.createElement("div");
    shell.className = "ui-node-catalog-card-shell";
    shell.dataset.uiCatalogItem = item.id;
    shell.dataset.uiCatalogCategories = item.categories.join(" ");
    shell.dataset.uiCatalogSearch = item.searchText;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uiCatalogSelect = item.id;
    button.className = "ui-node-catalog-card";
    button.setAttribute("aria-pressed", String(item.selected));
    if (item.media?.key || item.media?.src) {
      const media = document.createElement(item.media.type === "video" ? "video" : "img");
      if (item.media.key) media.dataset.uiCatalogMedia = item.media.key;
      if (item.media.src) media.dataset.uiCatalogMediaSrc = item.media.src;
      media.dataset.uiCatalogMediaLoad = item.media.load;
      media.dataset.uiCatalogMediaReady = "false";
      media.alt = "";
      media.addEventListener(media.tagName === "VIDEO" ? "loadeddata" : "load", onMediaReady);
      media.addEventListener("error", onMediaError);
      if (media.tagName === "VIDEO") {
        media.muted = true;
        media.playsInline = true;
        media.preload = "none";
      }
      if (item.media.poster) media.poster = item.media.poster;
      button.append(media);
    } else if (item.icon) {
      const icon = document.createElement("span");
      icon.className = "ui-node-catalog-icon material-symbols-rounded";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.icon;
      button.append(icon);
    }
    const strong = document.createElement("strong");
    strong.textContent = item.label;
    const small = document.createElement("small");
    small.textContent = item.meta;
    button.append(strong, small);
    shell.append(button);
    item.actions.forEach((action, index) => {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.dataset.uiCatalogItemAction = action.id;
      actionButton.dataset.uiCatalogItemId = item.id;
      if (action.presentation) actionButton.dataset.uiActionVariant = action.presentation;
      actionButton.style.setProperty("--ui-catalog-action-index", String(index));
      actionButton.title = action.label;
      actionButton.setAttribute("aria-label", action.label);
      setActionButtonContent(actionButton, action, document);
      shell.append(actionButton);
    });
    return shell;
  }

  function onClick(event) {
    if (event.target.closest?.("[data-ui-catalog-close]")) return onClose();
    const action = event.target.closest?.("[data-ui-catalog-action]");
    if (action) return emit("action", {
      id: action.dataset.uiCatalogAction,
      sectionId: action.dataset.uiCatalogSectionId || "",
    }, UI_COMMAND_PHASES.COMMIT);
    const itemAction = event.target.closest?.("[data-ui-catalog-item-action]");
    if (itemAction) return emit("action", {
      id: itemAction.dataset.uiCatalogItemAction,
      itemId: itemAction.dataset.uiCatalogItemId,
    }, UI_COMMAND_PHASES.COMMIT);
    const filter = event.target.closest?.("[data-ui-catalog-filter]");
    if (filter) return selectFilter(filter.dataset.uiCatalogFilter);
    const selected = event.target.closest?.("[data-ui-catalog-select]");
    if (!selected) return;
    const item = findItem(selected.dataset.uiCatalogSelect);
    if (item) {
      setActiveItem(item.id);
      emit("select", { id: item.id, value: item.value }, UI_COMMAND_PHASES.COMMIT);
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const filter = event.target.closest?.("[data-ui-catalog-filter]");
    if (filter && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const buttons = [...filters.querySelectorAll("[data-ui-catalog-filter]:not(:disabled)")];
      const current = Math.max(0, buttons.indexOf(filter));
      const next = nextLinearIndex(buttons.length, current, event.key);
      event.preventDefault();
      const requested = buttons[next]?.dataset.uiCatalogFilter || "";
      selectFilter(requested, { toggle: false });
      [...filters.querySelectorAll("[data-ui-catalog-filter]")]
        .find((button) => button.dataset.uiCatalogFilter === requested)?.focus?.();
      return;
    }
    const card = event.target.closest?.("[data-ui-catalog-select]");
    if (!card && event.target !== searchInput) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const cards = visibleCards();
    if (!cards.length) return;
    const current = card ? Math.max(0, cards.indexOf(card)) : -1;
    const next = nextLinearIndex(cards.length, current, event.key);
    event.preventDefault();
    const target = cards[next];
    setActiveItem(target.dataset.uiCatalogSelect);
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function onClose() {
    emit("close", {}, UI_COMMAND_PHASES.COMMIT);
  }

  function onSearch() {
    const value = searchInput.value || "";
    state.set(searchAddress, value, UI_STATE_LIFETIMES.SESSION);
    applyVisibility(value, activeFilter());
    emit("search", { value }, UI_COMMAND_PHASES.CHANGE);
  }

  function intentMediaForEvent(event) {
    return event.target.closest?.("[data-ui-catalog-item]")
      ?.querySelector?.('[data-ui-catalog-media-load="intent"]') || null;
  }

  function onMediaIntentPointerOver(event) {
    const media = intentMediaForEvent(event);
    if (!media) return;
    const shell = media.closest("[data-ui-catalog-item]");
    if (shell?.contains(event.relatedTarget)) return;
    scheduleIntentMedia(media);
  }

  function onMediaIntentPointerOut(event) {
    const media = intentMediaForEvent(event);
    if (!media) return;
    const shell = media.closest("[data-ui-catalog-item]");
    if (shell?.contains(event.relatedTarget)) return;
    cancelIntentMedia(media);
  }

  function onMediaIntentFocus(event) {
    const media = intentMediaForEvent(event);
    if (!media) return;
    scheduleIntentMedia(media);
  }

  function scheduleIntentMedia(media) {
    if (media.dataset.uiCatalogMediaState) return;
    cancelIntentMedia();
    intentMedia = media;
    intentTimer = (document.defaultView?.setTimeout || globalThis.setTimeout)(() => {
      const requested = intentMedia;
      intentMedia = null;
      intentTimer = 0;
      if (requested?.isConnected) loadMedia(requested);
    }, 300);
  }

  function cancelIntentMedia(media = null) {
    if (media && intentMedia !== media) return;
    if (intentTimer) (document.defaultView?.clearTimeout || globalThis.clearTimeout)(intentTimer);
    intentTimer = 0;
    intentMedia = null;
  }

  function selectFilter(requested, { toggle = true } = {}) {
    const current = activeFilter();
    const value = toggle
      ? nextCatalogFilter(current, requested, inputs.lockedFilter)
      : inputs.lockedFilter ? current : String(requested || "all");
    state.set(filterAddress, value, UI_STATE_LIFETIMES.SESSION);
    reconcileFilters(value);
    applyVisibility(searchInput.value, value);
    emit("filter", { value }, UI_COMMAND_PHASES.COMMIT);
  }

  function activeFilter() {
    return String(state.get(filterAddress, inputs.activeFilter) || "all");
  }

  function applyVisibility(search, filter) {
    const query = normalizeSearch(search);
    let visibleSections = 0;
    for (const section of body.querySelectorAll("[data-ui-catalog-section]")) {
      let visibleItems = 0;
      for (const card of section.querySelectorAll("[data-ui-catalog-item]")) {
        const matchesSearch = !query || normalizeSearch(card.dataset.uiCatalogSearch).includes(query);
        const categories = String(card.dataset.uiCatalogCategories || "").split(/\s+/);
        const matchesFilter = filter === "all" || categories.includes(filter);
        card.hidden = !(matchesSearch && matchesFilter);
        if (!card.hidden) visibleItems += 1;
      }
      section.hidden = visibleItems === 0;
      if (!section.hidden) visibleSections += 1;
    }
    noResults.hidden = visibleSections > 0 || (!query && filter === "all");
    syncCardTabStops();
  }

  function visibleCards() {
    return [...body.querySelectorAll("[data-ui-catalog-select]")]
      .filter((card) => !card.closest("[data-ui-catalog-item]")?.hidden && !card.closest("[data-ui-catalog-section]")?.hidden);
  }

  function setActiveItem(itemId) {
    state.set(activeItemAddress, String(itemId || ""), UI_STATE_LIFETIMES.SESSION);
    syncCardTabStops();
  }

  function syncCardTabStops() {
    const cards = visibleCards();
    const requested = String(state.get(activeItemAddress, "", UI_STATE_LIFETIMES.SESSION) || "");
    const active = cards.find((card) => card.dataset.uiCatalogSelect === requested) || cards[0] || null;
    for (const card of body.querySelectorAll("[data-ui-catalog-select]")) card.tabIndex = card === active ? 0 : -1;
  }

  function observeMedia() {
    releaseDetachedMedia();
    observer?.disconnect?.();
    observer = null;
    const media = [...body.querySelectorAll("[data-ui-catalog-media], [data-ui-catalog-media-src]")]
      .filter((element) => element.dataset.uiCatalogMediaLoad !== "intent");
    if (!media.length) return;
    if (typeof document.defaultView?.IntersectionObserver !== "function") {
      media.slice(0, 24).forEach(loadMedia);
      return;
    }
    observer = new document.defaultView.IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) loadMedia(entry.target);
    }, { root: body, rootMargin: "360px 0px" });
    media.forEach((element) => observer.observe(element));
  }

  async function loadMedia(element) {
    const key = element?.dataset?.uiCatalogMedia || "";
    const directUrl = element?.dataset?.uiCatalogMediaSrc || "";
    if ((!key && !directUrl) || element.dataset.uiCatalogMediaState || loadedMedia.has(element)) return;
    element.dataset.uiCatalogMediaState = "loading";
    const url = directUrl || await Promise.resolve(mediaPreview?.acquire?.(key));
    if (!url) {
      delete element.dataset.uiCatalogMediaState;
      return;
    }
    if (!element.isConnected) {
      if (key) mediaPreview?.release?.(key);
      return;
    }
    element.src = url;
    if (element.tagName === "VIDEO") element.load?.();
    element.dataset.uiCatalogMediaState = "loaded";
    if (key) loadedMedia.set(element, key);
  }

  function onMediaReady(event) {
    event.currentTarget.dataset.uiCatalogMediaReady = "true";
  }

  function onMediaError(event) {
    const element = event.currentTarget;
    element.dataset.uiCatalogMediaReady = "false";
    element.dataset.uiCatalogMediaState = "failed";
  }

  function releaseDetachedMedia() {
    for (const [element, key] of loadedMedia) {
      if (element.isConnected) continue;
      element.pause?.();
      element.removeAttribute?.("src");
      element.dataset.uiCatalogMediaReady = "false";
      mediaPreview.release?.(key);
      loadedMedia.delete(element);
    }
  }

  function findItem(itemId) {
    for (const section of inputs.sections) {
      const item = section.items.find((candidate) => candidate.id === itemId);
      if (item) return item;
    }
    return null;
  }

  function dispose() {
    scroll.dispose();
    cancelIntentMedia();
    observer?.disconnect?.();
    for (const [element, key] of loadedMedia) {
      element.pause?.();
      element.removeAttribute?.("src");
      element.dataset.uiCatalogMediaReady = "false";
      mediaPreview.release?.(key);
    }
    loadedMedia.clear();
    root?.remove();
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

function setActionButtonContent(button, action, document) {
  if (!action.icon) {
    button.textContent = action.label;
    return;
  }
  const glyph = document.createElement("span");
  glyph.className = "ui-node-catalog-action-icon";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = action.icon;
  button.replaceChildren(glyph);
}

function normalizePickerInputs(source = {}) {
  return {
    title: String(source.title || "Choose item"),
    description: String(source.description || ""),
    searchPlaceholder: String(source.searchPlaceholder || "Search"),
    activeFilter: String(source.activeFilter || "all"),
    search: String(source.search || ""),
    noResultsText: String(source.noResultsText || "No matching items."),
    lockedFilter: source.lockedFilter === true,
    filters: (source.filters || []).map((filter) => ({
      id: String(filter?.id || ""), label: String(filter?.label || filter?.id || "Filter"), disabled: filter?.disabled === true,
    })).filter((filter) => filter.id),
    actions: (source.actions || []).map((action) => ({
      id: String(action?.id || ""), label: String(action?.label || action?.id || "Action"), icon: String(action?.icon || ""), disabled: action?.disabled === true,
    })).filter((action) => action.id),
    sections: (source.sections || []).map((section) => ({
      id: String(section?.id || "section"),
      label: String(section?.label || "Items"),
      emptyText: String(section?.emptyText || "No matching items."),
      actions: (section?.actions || []).map((action) => ({
        id: String(action?.id || ""), label: String(action?.label || action?.id || "Action"), icon: String(action?.icon || ""),
      })).filter((action) => action.id),
      items: (section?.items || []).map(normalizeCatalogItem).filter((item) => item.id),
    })),
  };
}

function normalizeCatalogItem(item = {}) {
  return {
    id: String(item.id || ""),
    label: String(item.label || item.id || "Item"),
    meta: String(item.meta || ""),
    icon: String(item.icon || ""),
    searchText: normalizeSearch(item.searchText || `${item.label || ""} ${item.meta || ""}`),
    categories: String(Array.isArray(item.categories) ? item.categories.join(" ") : item.categories || "all").split(/\s+/).filter(Boolean),
    selected: item.selected === true,
    value: item.value,
    media: item.media && typeof item.media === "object" ? {
      key: String(item.media.key || ""),
      src: String(item.media.src || ""),
      type: item.media.type === "video" ? "video" : "image",
      poster: String(item.media.poster || ""),
      load: item.media.load === "intent" ? "intent" : "visible",
    } : null,
    actions: (item.actions || []).map((action) => ({
      id: String(action?.id || ""),
      label: String(action?.label || action?.id || "Action"),
      icon: String(action?.icon || ""),
      presentation: String(action?.presentation || ""),
    })).filter((action) => action.id),
  };
}

function normalizeSearch(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function nextCatalogFilter(activeFilter = "all", requestedFilter = "all", locked = false) {
  const active = String(activeFilter || "all");
  const requested = String(requestedFilter || "all");
  if (locked) return active;
  return active === requested ? "all" : requested;
}

export function nextCatalogItemIndex(length, currentIndex = -1, key = "ArrowDown") {
  return nextLinearIndex(Math.max(0, Number(length) || 0), Number(currentIndex), key);
}

function nextLinearIndex(length, currentIndex, key) {
  if (length <= 0) return -1;
  const current = Math.max(-1, Math.min(length - 1, Number(currentIndex) || 0));
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, current <= 0 ? 0 : current - 1);
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(length - 1, current + 1);
  return Math.max(0, current);
}
