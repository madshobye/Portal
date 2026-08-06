import { defineUiNode } from "../ui-node.js";
import { reconcileRetainedChildren } from "../retained-children.js";

export const MetricsSummaryNode = defineUiNode({
  id: "core.ui.metrics-summary",
  name: "Metrics summary",
  version: "0.1.0",
  description: "Compact retained metric readouts and ranked hotspot list.",
  inlets: {
    readouts: { type: "array", optional: true },
    categories: { type: "array", optional: true },
    categoryTitle: { type: "string", optional: true },
    categoryNote: { type: "string", optional: true },
    hotspots: { type: "array", optional: true },
    emptyText: { type: "string", optional: true },
  },
  outlets: { action: { type: "event", optional: true } },
  capabilities: ["ui-display", "ui-metrics", "ui-list"],
  factory: createMetricsSummaryInstance,
});

export const AnalysisReportNode = defineUiNode({
  id: "core.ui.analysis-report",
  name: "Analysis report",
  version: "0.1.0",
  description: "Modal retained analysis report with cards, sections, an optional table, and semantic actions.",
  inlets: {
    open: { type: "boolean", optional: true },
    title: { type: "string", optional: true },
    subtitle: { type: "string", optional: true },
    cards: { type: "array", optional: true },
    sections: { type: "array", optional: true },
    table: { type: "record", optional: true },
    note: { type: "string", optional: true },
    actions: { type: "array", optional: true },
  },
  outlets: { action: { type: "event", optional: true }, close: { type: "event", optional: true } },
  capabilities: ["ui-container", "ui-modal", "ui-report"],
  factory: createAnalysisReportInstance,
});

export const UI_REPORT_NODE_DEFINITIONS = Object.freeze([MetricsSummaryNode, AnalysisReportNode]);

function createMetricsSummaryInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  let readouts = null;
  let categoryRegion = null;
  let categoryTitle = null;
  let categories = null;
  let categoryNote = null;
  let hotspots = null;
  const readoutRows = new Map();
  const categoryRows = new Map();
  const hotspotRows = new Map();
  function mount() {
    root = el(document, "div", "ui-node-metrics-summary");
    readouts = el(document, "div", "ui-node-metrics-readouts");
    categoryRegion = el(document, "section", "ui-node-metrics-category-region");
    categoryTitle = text(document, "strong", "");
    categories = el(document, "ul", "ui-node-metrics-categories");
    categoryNote = text(document, "small", "");
    categoryRegion.append(categoryTitle, categories, categoryNote);
    hotspots = el(document, "ol", "ui-node-metrics-hotspots");
    root.append(readouts, categoryRegion, hotspots);
    root.addEventListener("click", onClick);
    host.replaceChildren(root);
    update(inputs);
  }
  function update(nextInputs = {}) {
    inputs = nextInputs;
    reconcileMetricReadouts(inputs.readouts || []);
    reconcileMetricCategories(inputs.categories || []);
    reconcileMetricHotspots(inputs.hotspots || []);
  }

  function reconcileMetricReadouts(items) {
    const entries = keyedDescriptors(items, "readout");
    reconcileRetainedChildren(readouts, entries.map(({ key, item }) => {
      let retained = readoutRows.get(key);
      if (!retained) {
        const card = el(document, "div", "ui-node-metric-readout");
        const icon = glyph(document, "");
        const label = text(document, "small", "");
        const value = text(document, "strong", "");
        card.append(icon, label, value);
        retained = { root: card, icon, label, value };
        readoutRows.set(key, retained);
      }
      retained.icon.textContent = String(item.icon || "");
      retained.label.textContent = String(item.label || "");
      retained.value.textContent = String(item.value ?? "");
      return retained.root;
    }));
    releaseMissingRows(readoutRows, entries);
  }

  function reconcileMetricCategories(items) {
    const entries = keyedDescriptors(items, "category");
    categoryTitle.textContent = String(inputs.categoryTitle || "");
    categoryTitle.hidden = !inputs.categoryTitle;
    categoryNote.textContent = String(inputs.categoryNote || "");
    categoryNote.hidden = !inputs.categoryNote;
    categoryRegion.hidden = !entries.length && !inputs.categoryTitle && !inputs.categoryNote;
    reconcileRetainedChildren(categories, entries.map(({ key, item }) => {
      let retained = categoryRows.get(key);
      if (!retained) {
        const row = el(document, "li", "ui-node-metric-category");
        const label = text(document, "span", "");
        const value = text(document, "strong", "");
        row.append(label, value);
        retained = { root: row, label, value };
        categoryRows.set(key, retained);
      }
      retained.label.textContent = String(item.label || "");
      retained.value.textContent = String(item.value ?? "");
      return retained.root;
    }));
    releaseMissingRows(categoryRows, entries);
  }

  function reconcileMetricHotspots(items) {
    const entries = keyedDescriptors(items, "hotspot");
    if (!entries.length) {
      hotspotRows.clear();
      hotspots.replaceChildren(text(document, "li", inputs.emptyText || "No samples"));
      return;
    }
    reconcileRetainedChildren(hotspots, entries.map(({ key, item }) => {
      let retained = hotspotRows.get(key);
      if (!retained) {
        const row = el(document, "li", "ui-node-metric-hotspot");
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        const copy = el(document, "span", "ui-node-metric-hotspot-copy");
        const label = text(document, "strong", "");
        const detail = text(document, "small", "");
        copy.append(label, detail);
        const value = el(document, "span", "ui-node-metric-hotspot-value");
        const amount = text(document, "strong", "");
        const share = text(document, "small", "");
        value.append(amount, share);
        const action = actionButton(document, "", "", "edit", { iconOnly: true });
        action.classList.add("ui-node-metric-hotspot-action");
        row.append(image, copy, value, action);
        retained = { root: row, image, copy, label, detail, value, amount, share, action };
        hotspotRows.set(key, retained);
      }
      const mediaSource = String(item.media?.src || "");
      retained.image.hidden = !mediaSource;
      if (mediaSource && retained.image.src !== mediaSource) retained.image.src = mediaSource;
      retained.root.classList.toggle("has-media", Boolean(mediaSource));
      retained.label.textContent = String(item.label || "");
      retained.detail.textContent = String(item.detail || "");
      retained.amount.textContent = String(item.value ?? "");
      retained.share.textContent = String(item.share ?? "");
      retained.action.hidden = !item.action;
      if (item.action) updateActionButton(retained.action, item.action, { iconOnly: item.action.iconOnly !== false });
      return retained.root;
    }));
    releaseMissingRows(hotspotRows, entries);
  }
  function onClick(event) {
    const button = event.target.closest?.("[data-ui-report-action]");
    if (!button || !root.contains(button)) return;
    emit("action", { id: button.dataset.uiReportAction, ...(parsePayload(button.dataset.payload)) });
  }
  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.remove();
    readoutRows.clear();
    categoryRows.clear();
    hotspotRows.clear();
    root = readouts = categoryRegion = categoryTitle = categories = categoryNote = hotspots = null;
  }
  return Object.freeze({ mount, update, dispose, element: () => root });
}

function createAnalysisReportInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  let title = null;
  let subtitle = null;
  let cards = null;
  let body = null;
  let footer = null;
  function mount() {
    root = el(document, "div", "ui-node-analysis-report");
    const backdrop = el(document, "button", "ui-node-analysis-report-backdrop");
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close report");
    backdrop.addEventListener("click", () => emit("close"));
    const panel = el(document, "section", "ui-node-analysis-report-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const header = el(document, "header", "ui-node-analysis-report-header");
    const copy = el(document, "span");
    title = el(document, "strong");
    subtitle = el(document, "small");
    copy.append(title, subtitle);
    const close = actionButton(document, "close", "Close", "close", { iconOnly: true });
    header.append(copy, close);
    body = el(document, "div", "ui-node-analysis-report-body");
    cards = el(document, "div", "ui-node-analysis-report-cards");
    body.append(cards);
    footer = el(document, "footer", "ui-node-analysis-report-actions");
    panel.append(header, body, footer);
    root.append(backdrop, panel);
    root.addEventListener("click", onClick);
    host.replaceChildren(root);
    update(inputs);
  }
  function update(nextInputs = {}) {
    inputs = nextInputs;
    root.hidden = inputs.open !== true;
    title.textContent = String(inputs.title || "Analysis");
    subtitle.textContent = String(inputs.subtitle || "");
    cards.replaceChildren(...(inputs.cards || []).map((item) => {
      const card = el(document, "div");
      card.append(text(document, "small", item.label), text(document, "strong", item.value));
      return card;
    }));
    const sections = (inputs.sections || []).map((section) => {
      const region = el(document, "section", "ui-node-analysis-report-section");
      region.append(text(document, "h3", section.title));
      if (section.description) region.append(text(document, "p", section.description));
      if (section.items?.length) {
        const list = el(document, "ul");
        const structured = section.items.every((item) => item && typeof item === "object" && !Array.isArray(item));
        list.classList.toggle("is-metrics", structured);
        list.append(...section.items.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return text(document, "li", item);
          const row = el(document, "li");
          row.append(text(document, "span", item.label), text(document, "strong", item.value));
          return row;
        }));
        region.append(list);
      }
      const sectionTable = reportTable(document, section.table);
      if (sectionTable) region.append(sectionTable);
      return region;
    });
    const table = reportTable(document, inputs.table);
    const note = inputs.note ? text(document, "p", inputs.note) : null;
    body.replaceChildren(cards, ...sections, ...(table ? [table] : []), ...(note ? [note] : []));
    footer.replaceChildren(...(inputs.actions || []).map((item) => actionButton(document, item.id, item.label, item.icon || "")));
  }
  function onClick(event) {
    const button = event.target.closest?.("[data-ui-report-action]");
    if (!button || !root.contains(button)) return;
    const id = String(button.dataset.uiReportAction || "");
    if (id === "close") emit("close");
    else emit("action", { id });
  }
  function dispose() { root?.removeEventListener("click", onClick); root?.remove(); root = title = subtitle = cards = body = footer = null; }
  return Object.freeze({ mount, update, dispose, element: () => root });
}

function reportTable(document, model) {
  if (!model?.columns?.length) return null;
  const wrapper = el(document, "div", "ui-node-analysis-report-table");
  const table = el(document, "table");
  const head = el(document, "thead");
  const header = el(document, "tr");
  header.append(...model.columns.map((column) => text(document, "th", column.label)));
  head.append(header);
  const body = el(document, "tbody");
  body.append(...(model.rows || []).map((row) => {
    const tr = el(document, "tr");
    tr.append(...model.columns.map((column) => reportTableCell(document, row[column.id])));
    return tr;
  }));
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function reportTableCell(document, value) {
  const cell = el(document, "td");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    cell.textContent = String(value ?? "");
    return cell;
  }
  const content = el(document, "span", "ui-node-analysis-report-table-cell");
  if (value.media?.src) {
    const image = document.createElement("img");
    image.src = String(value.media.src);
    image.alt = "";
    image.loading = "lazy";
    content.append(image);
  }
  const copy = el(document, "span");
  copy.append(text(document, "strong", value.label), text(document, "small", value.detail));
  content.append(copy);
  cell.append(content);
  return cell;
}

function actionButton(document, id, label, iconName, options = {}) {
  const button = el(document, "button");
  button.type = "button";
  updateActionButton(button, { id, label, icon: iconName }, options);
  return button;
}
function updateActionButton(button, action = {}, { iconOnly = false } = {}) {
  const label = String(action.label || action.id || "Action");
  const iconName = String(action.icon || "");
  button.dataset.uiReportAction = String(action.id || "");
  button.dataset.payload = JSON.stringify(action.payload || {});
  button.dataset.uiIconOnly = iconOnly ? "true" : "false";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.replaceChildren(...(iconName ? [glyph(button.ownerDocument, iconName)] : []), ...(iconOnly ? [] : [text(button.ownerDocument, "span", label)]));
}
function keyedDescriptors(items, prefix) {
  const counts = new Map();
  return items.map((item, index) => {
    const base = String(item?.id || item?.label || `${prefix}-${index}`);
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return { key: count ? `${base}:${count}` : base, item: item || {} };
  });
}
function releaseMissingRows(rows, entries) {
  const retained = new Set(entries.map(({ key }) => key));
  for (const key of rows.keys()) if (!retained.has(key)) rows.delete(key);
}
function glyph(document, name) { const node = el(document, "span", "material-symbols-rounded"); node.textContent = String(name || ""); return node; }
function text(document, tag, value) { const node = el(document, tag); node.textContent = String(value ?? ""); return node; }
function el(document, tag, className = "") { const node = document.createElement(tag); if (className) node.className = className; return node; }
function parsePayload(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
