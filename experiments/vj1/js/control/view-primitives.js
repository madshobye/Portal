import { esc, icon } from "./template-utils.js?v=slider-values-70";

export function componentCardBarTemplate(label) {
  return `<div class="component-card-bar"><span>${esc(label)}</span></div>`;
}

export function scrollRegionTemplate(key, content, { className = "", attributes = "", tagName = "div" } = {}) {
  const safeTag = ["div", "nav", "ol", "section"].includes(tagName) ? tagName : "div";
  return `<${safeTag} class="${esc(className)}" data-scroll-region data-scroll-key="${esc(key)}" ${attributes}>${content}</${safeTag}>`;
}

export function emptyStateTemplate(text) {
  return `<div class="soft-note ui-empty-state ui-list-empty">${esc(text)}</div>`;
}

// Shared shell for every scrollable catalog/list in the project rail. Keeping
// the header, optional tools, empty state, and scroll region in one primitive
// prevents workspace-specific empty-list markup from changing the flex/grid
// behavior of the surrounding layout.
export function railListSectionTemplate({
  iconName = "",
  title = "",
  headerHtml = "",
  beforeListHtml = "",
  content = "",
  emptyText = "",
  className = "",
  listClassName = "",
  scrollKey = "",
  sectionAttributes = "",
  listAttributes = "",
} = {}) {
  const empty = !content;
  const header = headerHtml || `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${esc(iconName)}</span><span>${esc(title)}</span></div>`;
  const listContent = content || emptyStateTemplate(emptyText);
  return `
    <div class="ui-section rail-section rail-list-section ui-list-section${empty ? " is-empty" : ""}${className ? ` ${esc(className)}` : ""}" ${sectionAttributes}>
      ${header}
      ${beforeListHtml}
      ${scrollRegionTemplate(scrollKey, listContent, {
        className: `ui-list-content rail-scroll-list${listClassName ? ` ${listClassName}` : ""}`,
        attributes: listAttributes,
      })}
    </div>`;
}

export function deepEditButtonTemplate(componentId, { chainItemId = "", className = "", label = "Edit component" } = {}) {
  if (!componentId) return "";
  const chainTarget = chainItemId ? ` data-edit-chain-item="${esc(chainItemId)}"` : "";
  return `<button type="button" class="deep-edit-button ${esc(className)}" data-edit-component="${esc(componentId)}"${chainTarget} title="${esc(label)}" aria-label="${esc(label)}">${icon("edit")}</button>`;
}

export function enableToggleButton({ path = "", livePath = "", componentId = "", value = true, iconName = "power_settings_new", label = "", selectAction = "", selectId = "" }) {
  const enabled = value !== false;
  const toggleAttrs = livePath
    ? `data-live-component-id="${esc(componentId)}" data-live-toggle="${esc(livePath)}"`
    : `data-toggle-path="${esc(path)}"`;
  const action = enabled ? "Disable" : "Enable";
  return `
    <button type="button" class="enable-toggle ${enabled ? "is-enabled" : ""}" ${toggleAttrs} ${selectAction ? `data-toggle-select-action="${esc(selectAction)}" data-toggle-select-id="${esc(selectId)}"` : ""} data-toggle-value="${enabled ? "true" : "false"}" title="${action} ${esc(label)}" aria-label="${action} ${esc(label)}">
      ${icon(enabled ? iconName : "hide_source")}
    </button>
  `;
}

export function selectablePillTemplate({ selected, action, id, iconName, label, meta, rowClass = "list-row", togglePath = "", toggleValue = true, removeAction = "", removeDisabled = false, reorderable = true }) {
  return textListItemTemplate({
    rowClass,
    selected,
    reorderId: reorderable ? id : "",
    leadingHtml: togglePath ? enableToggleButton({
      path: togglePath,
      value: toggleValue,
      iconName,
      label,
      selectAction: action,
      selectId: id,
    }) : "",
    label,
    meta,
    mainClass: "list-select",
    mainAction: action,
    mainActionId: id,
    removeClass: "list-remove",
    removeAction,
    removeActionId: id,
    removeDisabled,
  });
}

export function textListItemTemplate({
  rowClass = "",
  selected = false,
  reorderId = "",
  leadingHtml = "",
  label = "",
  meta = "",
  mainClass = "",
  mainAction = "",
  mainActionId = "",
  removeClass = "",
  removeAction = "",
  removeActionId = "",
  removeAttributes = "",
  removeTitle = "Remove",
  removeDisabled = false,
  actionHtml = "",
} = {}) {
  const hasRemove = Boolean(removeAction || removeAttributes);
  const mainClasses = ["text-list-main", mainClass, selected ? "is-selected" : ""].filter(Boolean).join(" ");
  const rowClasses = [
    "text-list-item",
    rowClass,
    leadingHtml ? "has-leading" : "",
    hasRemove ? "has-remove" : "",
    actionHtml ? "has-action" : "",
    selected ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const mainContent = `<span>${esc(label)}</span>${meta ? `<small>${esc(meta)}</small>` : ""}`;
  const main = mainAction
    ? `<button type="button" class="${mainClasses}" ${mainAction}="${esc(mainActionId)}">${mainContent}</button>`
    : `<div class="${mainClasses}">${mainContent}</div>`;
  const remove = hasRemove
    ? `<button type="button" class="text-list-remove ${removeClass}" ${removeAction ? `${removeAction}="${esc(removeActionId)}"` : ""} ${removeAttributes} title="${esc(removeTitle)}" aria-label="${esc(removeTitle)} ${esc(label)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>`
    : "";
  return `
    <div class="${rowClasses}" ${reorderId ? `data-reorder-id="${esc(reorderId)}"` : ""}>
      ${leadingHtml}
      ${main}
      ${actionHtml}
      ${remove}
    </div>
  `;
}

export function titleInputTemplate(path, value) {
  return `<input class="section-title-input" type="text" data-update="${esc(path)}" value="${esc(value)}" aria-label="Name" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />`;
}

export function editableSectionTitleTemplate(iconName, path, value) {
  return `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${iconName}</span>${titleInputTemplate(path, value)}</div>`;
}

export function panelTemplate(iconName, title, body, { titlePath = "", headerActionHtml = "", className = "", empty = false } = {}) {
  return `
    <section class="ui-section focus-panel${empty ? " is-empty" : ""}${className ? ` ${esc(className)}` : ""}">
      <header class="ui-section-header panel-title">
        <span class="material-symbols-rounded">${iconName}</span>
        ${titlePath ? titleInputTemplate(titlePath, title) : `<span>${esc(title)}</span>`}
        ${headerActionHtml}
      </header>
      ${body}
    </section>
  `;
}

export function projectEmptyTemplate() {
  return `
    <div class="project-empty">
      <span class="material-symbols-rounded">folder_open</span>
      <h2>Open a folder to begin</h2>
      <p>Choose an empty folder or an existing VJ1 project folder.</p>
      <div class="button-row">
        <button type="button" class="primary" data-open-folder>${icon("folder_open")} Open folder</button>
      </div>
    </div>
  `;
}
