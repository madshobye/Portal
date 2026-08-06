import { defineUiNode } from "../ui-node.js";

export const WorkspaceShellNode = defineUiNode({
  id: "core.ui.workspace-shell",
  name: "Workspace shell",
  version: "0.1.0",
  description: "Application-neutral workspace shell with a top bar, view commands, status controls, and named content regions.",
  inlets: {
    brand: { type: "string", optional: true },
    project: { type: "record", optional: true },
    workspaces: { type: "array", optional: true },
    actions: { type: "array", optional: true },
    outputs: { type: "array", optional: true },
    health: { type: "record", optional: true },
    hasProject: { type: "boolean", optional: true },
    workspace: { type: "string", optional: true },
  },
  outlets: { action: { type: "event", optional: true } },
  capabilities: ["ui-container", "ui-workspace-shell", "retained-child-host"],
  factory: createWorkspaceShellInstance,
});

function createWorkspaceShellInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;
  let refs = null;
  let windowClick = null;
  const workspaceButtonLists = new Map();

  function mount() {
    root = element(document, "div", "ui-node-workspace-shell control-app studio-app");
    root.dataset.uiNodeOwned = "workspace-shell";
    const topbar = element(document, "header", "topbar studio-topbar");
    const brand = element(document, "div", "brand");
    const brandMark = element(document, "div", "brand-mark");
    const projectControl = element(document, "div", "project-title-control");
    const projectButton = actionButton(document, "open-folder", "folder_open", "Open project folder", "project-button");
    const projectCopy = element(document, "span");
    const projectName = element(document, "strong");
    const projectMeta = element(document, "small");
    projectCopy.append(projectName, projectMeta);
    projectButton.append(projectCopy);
    const closeProject = actionButton(document, "close-project", "close", "Close project", "icon-buttonish close-project-button");
    projectControl.append(projectButton, closeProject);
    const primaryViews = element(document, "div", "workspace-switch workspace-view-switch");
    primaryViews.setAttribute("role", "group");
    primaryViews.setAttribute("aria-label", "Views");
    const returnButton = actionButton(document, "return", "arrow_back", "Return", "icon-buttonish deep-edit-return");
    brand.append(brandMark, projectControl, primaryViews, returnButton);

    const topActions = element(document, "div", "top-actions");
    const technicalViews = element(document, "div", "workspace-switch workspace-tool-switch");
    technicalViews.setAttribute("role", "group");
    technicalViews.setAttribute("aria-label", "Technical views");
    const ordinaryActions = element(document, "div", "ui-node-workspace-shell-actions");
    const outputMenu = element(document, "details", "output-menu");
    const outputSummary = element(document, "summary", "icon-buttonish");
    outputSummary.title = "Open output";
    outputSummary.setAttribute("aria-label", "Open output");
    outputSummary.dataset.uiAction = "open-output";
    outputSummary.append(icon(document, "open_in_new"));
    const outputItems = element(document, "div", "output-menu-items");
    outputMenu.append(outputSummary, outputItems);
    const performance = element(document, "div", "performance-menu");
    const healthButton = actionButton(document, "performance-toggle", "", "Open performance overview", "performance-health-button");
    const healthDots = element(document, "span", "performance-health-dots");
    healthDots.setAttribute("aria-hidden", "true");
    const healthDotNodes = [0, 1, 2, 3].map(() => element(document, "span", "performance-health-dot health-0"));
    healthDots.append(...healthDotNodes);
    const outputStatus = element(document, "span", "performance-output-status");
    const outputStatusText = element(document, "span");
    outputStatus.append(outputStatusText);
    healthButton.append(healthDots, outputStatus);
    const performanceSummary = element(document, "div", "performance-summary");
    performanceSummary.hidden = true;
    performanceSummary.setAttribute("role", "dialog");
    performanceSummary.setAttribute("aria-label", "Current rendering performance");
    const performanceSummaryContent = element(document, "div");
    const performanceAnalyze = actionButton(document, "performance-analyze", "query_stats", "Analyze 10 seconds", "performance-analyze-button", false);
    performanceSummary.append(performanceSummaryContent, performanceAnalyze);
    performance.append(healthButton, performanceSummary);
    const diagnosticsSummary = element(document, "div", "diagnostics-summary");
    diagnosticsSummary.hidden = true;
    diagnosticsSummary.setAttribute("role", "dialog");
    diagnosticsSummary.setAttribute("aria-label", "Application diagnostics");
    const diagnosticsSummaryContent = element(document, "div");
    diagnosticsSummary.append(diagnosticsSummaryContent);
    const importFiles = element(document, "input");
    importFiles.type = "file";
    importFiles.multiple = true;
    importFiles.setAttribute("webkitdirectory", "");
    importFiles.hidden = true;
    topActions.append(technicalViews, ordinaryActions, diagnosticsSummary, outputMenu, performance, importFiles);
    topbar.append(brand, topActions);

    const workspace = element(document, "div", "studio-layout");
    const modal = element(document, "div", "ui-node-workspace-shell-modal");
    const context = element(document, "div", "ui-node-workspace-shell-context");
    const performanceResults = element(document, "div", "ui-node-workspace-shell-performance-results");
    const system = element(document, "div", "ui-node-workspace-shell-system");
    system.hidden = true;
    root.append(topbar, workspace, modal, context, performanceResults, system);
    host.replaceChildren(root);
    refs = {
      brandMark, projectName, projectMeta, closeProject, primaryViews, technicalViews,
      returnButton, ordinaryActions, outputMenu, outputSummary, outputItems, healthButton,
      healthDots: healthDotNodes, outputStatus, outputStatusText, performanceSummary,
      performanceSummaryContent, performanceAnalyze, diagnosticsSummary, diagnosticsSummaryContent,
      importFiles, workspace, modal,
      context, performanceResults, system,
    };
    root.addEventListener("click", onClick);
    importFiles.addEventListener("change", onFiles);
    windowClick = () => emit("action", { id: "dismiss-popovers" });
    document.defaultView?.addEventListener?.("click", windowClick);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs;
    if (!refs) return;
    const project = inputs.project || {};
    refs.brandMark.textContent = String(inputs.brand || "UI");
    refs.projectName.textContent = String(project.name || "No project open");
    refs.projectMeta.textContent = String(project.meta || "");
    refs.projectMeta.hidden = !project.meta;
    refs.closeProject.hidden = inputs.hasProject !== true;
    refs.returnButton.hidden = !project.returnLabel;
    refs.returnButton.title = String(project.returnLabel || "Return");
    refs.returnButton.setAttribute("aria-label", refs.returnButton.title);
    refs.workspace.dataset.workspace = String(inputs.workspace || "");
    reconcileWorkspaceButtons(refs.primaryViews, (inputs.workspaces || []).filter((item) => item.group !== "technical"));
    reconcileWorkspaceButtons(refs.technicalViews, (inputs.workspaces || []).filter((item) => item.group === "technical"));
    reconcileActionButtons(refs.ordinaryActions, inputs.actions || []);
    reconcileOutputs();
    updateHealth(inputs.health || {});
    root.classList.toggle("has-project-open", inputs.hasProject === true);
    root.classList.toggle("no-project-open", inputs.hasProject !== true);
  }

  function updateHealth(health = {}) {
    if (!refs) return;
    refs.outputStatus.classList.toggle("is-live", health.outputConnected === true);
    refs.outputStatusText.textContent = String(health.outputText ?? "-");
    refs.healthButton.classList.toggle("is-active", health.active === true);
    refs.performanceAnalyze.disabled = health.active === true;
    refs.healthButton.title = String(health.label || "Performance overview");
    refs.healthButton.setAttribute("aria-label", refs.healthButton.title);
    const levels = Array.isArray(health.levels) ? health.levels : [];
    refs.healthDots.forEach((dot, index) => {
      dot.className = "performance-health-dot";
      const level = levels[index];
      if (level === null || level === undefined) dot.classList.add("is-unknown");
      else dot.classList.add(`health-${Math.max(0, Math.min(8, Number(level) || 0))}`);
    });
  }

  function reconcileWorkspaceButtons(container, descriptors) {
    const normalized = descriptors.map((item) => ({
      id: `workspace:${item.id}`,
      icon: item.icon,
      label: item.label,
      iconOnly: true,
      active: item.active,
      disabled: item.disabled,
    }));
    const nextIds = normalized.map((item) => item.id);
    const previousIds = workspaceButtonLists.get(container) || [];
    if (!sameOrderedIds(previousIds, nextIds)) {
      reconcileButtons(container, normalized, (item) => item);
      workspaceButtonLists.set(container, nextIds);
      return;
    }
    // Workspace state changes are attribute updates on continuously mounted
    // buttons. In particular, a profiler/metric refresh must never enter a
    // structural reconciliation path between pointerdown and click.
    normalized.forEach((item, index) => {
      updateRetainedButton(buttonForEntry(container.children[index]), item);
    });
  }

  function reconcileActionButtons(container, descriptors) {
    reconcileButtons(container, descriptors, (item) => item);
  }

  function reconcileButtons(container, descriptors, normalize) {
    const existing = new Map([...container.children].map((child) => [buttonForEntry(child)?.dataset.uiAction, child]));
    const ordered = descriptors.map((source) => {
      const item = normalize(source);
      const id = String(item.id || "");
      const retainedEntry = existing.get(id);
      let button = buttonForEntry(retainedEntry);
      if (!button) button = actionButton(document, id, item.icon, item.label, actionPresentationClass(item.presentation), item.iconOnly !== false);
      updateRetainedButton(button, item);
      existing.delete(id);
      if (id !== "diagnostics-toggle") return button;
      const menu = retainedEntry?.classList?.contains("diagnostics-menu")
        ? retainedEntry
        : element(document, "div", "diagnostics-menu");
      if (button.parentElement !== menu) menu.append(button);
      if (refs.diagnosticsSummary.parentElement !== menu) menu.append(refs.diagnosticsSummary);
      return menu;
    });
    for (const stale of existing.values()) stale.remove();
    // Preserve mounted controls across status/metric updates. Detaching a
    // button between pointerdown and pointerup cancels the browser click.
    ordered.forEach((entry, index) => {
      const current = container.children[index];
      if (current !== entry) container.insertBefore(entry, current || null);
    });
  }

  function updateRetainedButton(button, item) {
    if (!button) return;
    const id = String(item.id || "");
    const title = String(item.label || id);
    const disabled = item.disabled === true;
    const hidden = item.hidden === true;
    const active = item.active === true;
    if (button.dataset.uiAction !== id) button.dataset.uiAction = id;
    if (button.title !== title) button.title = title;
    if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
    if (button.disabled !== disabled) button.disabled = disabled;
    if (button.hidden !== hidden) button.hidden = hidden;
    if (button.classList.contains("is-active") !== active) button.classList.toggle("is-active", active);
    const glyph = button.querySelector(".material-symbols-rounded");
    const iconName = String(item.icon || "");
    if (glyph && glyph.textContent !== iconName) glyph.textContent = iconName;
    const text = button.querySelector(".ui-node-workspace-shell-button-label");
    const buttonLabel = String(item.buttonLabel || item.label || "");
    if (text && text.textContent !== buttonLabel) text.textContent = buttonLabel;
  }

  function reconcileOutputs() {
    const outputs = inputs.outputs || [];
    const direct = outputs.length === 1;
    refs.outputMenu.classList.toggle("is-direct", direct);
    refs.outputSummary.title = direct ? `Open ${outputs[0]?.name || "output"}` : "Open output";
    refs.outputSummary.setAttribute("aria-label", refs.outputSummary.title);
    if (direct) refs.outputMenu.open = false;
    const descriptors = direct ? [] : outputs.map((output) => ({
      id: `output:${output.id}`,
      label: `${output.connected ? "● " : ""}${output.name}`,
      buttonLabel: `${output.connected ? "● " : ""}${output.name}`,
      iconOnly: false,
      presentation: "output-menu-button",
    }));
    reconcileButtons(refs.outputItems, descriptors, (item) => item);
    [...refs.outputItems.children].forEach((button, index) => {
      let detail = button.querySelector("small");
      if (!detail) {
        detail = element(document, "small");
        button.append(detail);
      }
      detail.textContent = String(outputs[index]?.detail || "");
    });
  }

  function onClick(event) {
    if (event.target.closest?.(".diagnostics-summary")) {
      event.stopPropagation();
      return;
    }
    const action = event.target.closest?.("[data-ui-action]");
    if (!action || !root.contains(action)) return;
    const id = String(action.dataset.uiAction || "");
    if (["performance-toggle", "performance-analyze", "diagnostics-toggle"].includes(id)) event.stopPropagation();
    if (id === "open-output" && (inputs.outputs || []).length === 1) event.preventDefault();
    emit("action", { id });
  }

  function onFiles() {
    emit("action", { id: "import-files", files: Array.from(refs.importFiles.files || []) });
    refs.importFiles.value = "";
  }

  function setPopover(name, open) {
    const target = name === "performance"
      ? refs?.performanceSummary
      : name === "diagnostics"
        ? refs?.diagnosticsSummary
        : null;
    if (!target) return false;
    target.hidden = open !== true;
    refs.healthButton?.setAttribute("aria-expanded", open === true ? "true" : "false");
    return true;
  }

  function requestImport() {
    refs?.importFiles?.click();
  }

  function slot(name) {
    return {
      workspace: refs?.workspace,
      modal: refs?.modal,
      context: refs?.context,
      "performance-results": refs?.performanceResults,
      "performance-summary": refs?.performanceSummaryContent,
      "diagnostics-summary": refs?.diagnosticsSummaryContent,
      system: refs?.system,
    }[name] || null;
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    refs?.importFiles?.removeEventListener("change", onFiles);
    if (windowClick) document.defaultView?.removeEventListener?.("click", windowClick);
    root?.remove();
    root = null;
    refs = null;
    windowClick = null;
    workspaceButtonLists.clear();
  }

  return Object.freeze({ mount, update, updateHealth, dispose, slot, element: () => root, setPopover, requestImport });
}

export function sameOrderedIds(previous = [], next = []) {
  return previous.length === next.length && previous.every((id, index) => id === next[index]);
}

function buttonForEntry(entry) {
  if (!entry) return null;
  if (entry.dataset?.uiAction) return entry;
  return entry.querySelector?.(":scope > [data-ui-action]") || null;
}

function actionButton(document, id, iconName, label, className = "icon-buttonish", iconOnly = true) {
  const button = element(document, "button", className);
  button.type = "button";
  button.dataset.uiAction = id;
  button.title = label;
  button.setAttribute("aria-label", label);
  if (iconName) button.append(icon(document, iconName));
  if (!iconOnly) {
    const copy = element(document, "span", "ui-node-workspace-shell-button-label");
    copy.textContent = label;
    button.append(copy);
  }
  return button;
}

function icon(document, name) {
  const span = element(document, "span", "material-symbols-rounded");
  span.textContent = String(name || "");
  return span;
}

function element(document, tagName, className = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
}

function actionPresentationClass(presentation) {
  if (presentation === "danger") return "icon-buttonish danger";
  if (presentation === "diagnostics") return "icon-buttonish diagnostics-toggle";
  if (presentation === "output-menu") return "output-menu-button";
  return "icon-buttonish";
}
