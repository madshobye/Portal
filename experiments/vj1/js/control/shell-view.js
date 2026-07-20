import { icon } from "./template-utils.js";

export function shellTemplate() {
  return `
    <div class="control-app studio-app" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <header class="topbar studio-topbar">
        <div class="brand">
          <div class="brand-mark">VJ</div>
          <div class="project-title-control">
            <button id="open-folder-main" class="project-button" type="button" title="Open project folder">
              <span class="material-symbols-rounded">folder_open</span>
              <span>
                <strong id="project-name">VJ1</strong>
                <small id="project-meta">Choose a project folder</small>
              </span>
            </button>
            <button id="close-project" class="icon-buttonish close-project-button is-hidden" type="button" title="Close project" aria-label="Close project">${icon("close")}</button>
          </div>
          <div id="workspace-switch" class="workspace-switch workspace-view-switch" role="group" aria-label="Views">
            <button type="button" data-workspace="component" title="Components" aria-label="Components">${icon("account_tree")}</button>
            <button type="button" data-workspace="canvas" title="Canvas" aria-label="Canvas">${icon("dashboard_customize")}</button>
            <button type="button" data-workspace="scene" class="is-active" title="Scenes" aria-label="Scenes">${icon("auto_awesome")}</button>
            <button type="button" data-workspace="nodes" title="Nodes" aria-label="Nodes">${icon("schema")}</button>
            <button type="button" data-workspace="live" title="Live" aria-label="Live">${icon("play_circle")}</button>
          </div>
          <button id="return-from-deep-edit" class="icon-buttonish deep-edit-return is-hidden" type="button" title="Return" aria-label="Return">${icon("arrow_back")}</button>
        </div>
        <div class="top-actions" data-scroll-region data-scroll-key="top-actions">
          <button id="toggle-preview" class="icon-buttonish" type="button" title="Toggle preview" aria-label="Toggle preview">${icon("visibility")}</button>
          <button id="toggle-output-hud" class="icon-buttonish" type="button" title="Output FPS and resolution" aria-label="Toggle output FPS and resolution">${icon("bug_report")}</button>
          <button id="open-settings" class="icon-buttonish" type="button" title="Settings" aria-label="Settings">${icon("settings")}</button>
          <div class="diagnostics-menu">
            <button id="diagnostics-toggle" class="icon-buttonish diagnostics-toggle is-ok" type="button" title="Diagnostics: OK" aria-label="Open diagnostics, status OK" aria-expanded="false">${icon("check_circle")}</button>
            <div id="diagnostics-summary" class="diagnostics-summary is-hidden" role="dialog" aria-label="Application diagnostics">
              <div id="diagnostics-summary-content"></div>
            </div>
          </div>
          <button id="undo-project" class="icon-buttonish" type="button" title="Undo" aria-label="Undo" disabled>${icon("undo")}</button>
          <button id="redo-project" class="icon-buttonish" type="button" title="Redo" aria-label="Redo" disabled>${icon("redo")}</button>
          <button id="toggle-output-playback" class="icon-buttonish" type="button" title="Pause output" aria-label="Pause output" disabled>${icon("pause")}</button>
          <button id="blackout-main" class="icon-buttonish danger" type="button" title="Blackout" aria-label="Blackout">${icon("brightness_1")}</button>
          <details id="output-menu" class="output-menu">
            <summary class="icon-buttonish" title="Open output" aria-label="Open output">${icon("open_in_new")}</summary>
            <div id="output-menu-items" class="output-menu-items"></div>
          </details>
          <div class="performance-menu">
            <button id="render-cost" class="performance-health-button" type="button" title="Open performance overview" aria-label="Open performance overview" aria-expanded="false">
              <span class="performance-health-dots" aria-hidden="true">
                <span id="render-cost-dot" class="performance-health-dot health-0"></span>
                <span id="cpu-time-dot" class="performance-health-dot health-0"></span>
                <span id="gpu-time-dot" class="performance-health-dot is-unknown"></span>
              </span>
              <span id="output-status" class="performance-output-status"><span id="output-status-text">-</span></span>
            </button>
            <div id="performance-summary" class="performance-summary is-hidden" role="dialog" aria-label="Current rendering performance">
              <div id="performance-summary-content"></div>
              <button id="performance-analyze" class="performance-analyze-button" type="button"><span class="material-symbols-rounded">query_stats</span><span>Analyze 10 seconds</span></button>
            </div>
          </div>
          <input id="import-files-main" class="hidden" type="file" multiple webkitdirectory data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
      </header>
      <div class="studio-layout" data-scroll-region data-scroll-key="studio-layout">
        <aside id="project-rail" class="project-rail" data-scroll-region data-scroll-key="project-rail:scene"></aside>
        <aside id="inspector" class="studio-inspector" data-scroll-region data-scroll-key="inspector:scene"></aside>
        <main id="studio" class="studio-main"></main>
      </div>
      <div id="modal-host"></div>
      <div id="performance-results-host"></div>
    </div>
  `;
}

export function collectRefs(root) {
  return {
    projectName: root.querySelector("#project-name"),
    projectMeta: root.querySelector("#project-meta"),
    outputStatus: root.querySelector("#output-status"),
    outputStatusText: root.querySelector("#output-status-text"),
    renderCost: root.querySelector("#render-cost"),
    renderCostDot: root.querySelector("#render-cost-dot"),
    cpuTimeDot: root.querySelector("#cpu-time-dot"),
    gpuTimeDot: root.querySelector("#gpu-time-dot"),
    performanceSummary: root.querySelector("#performance-summary"),
    performanceSummaryContent: root.querySelector("#performance-summary-content"),
    performanceAnalyze: root.querySelector("#performance-analyze"),
    performanceResultsHost: root.querySelector("#performance-results-host"),
    outputMenu: root.querySelector("#output-menu"),
    outputMenuItems: root.querySelector("#output-menu-items"),
    togglePreview: root.querySelector("#toggle-preview"),
    toggleOutputHud: root.querySelector("#toggle-output-hud"),
    openSettings: root.querySelector("#open-settings"),
    diagnosticsToggle: root.querySelector("#diagnostics-toggle"),
    diagnosticsSummary: root.querySelector("#diagnostics-summary"),
    diagnosticsSummaryContent: root.querySelector("#diagnostics-summary-content"),
    undo: root.querySelector("#undo-project"),
    redo: root.querySelector("#redo-project"),
    toggleOutputPlayback: root.querySelector("#toggle-output-playback"),
    blackout: root.querySelector("#blackout-main"),
    workspaceButtons: root.querySelectorAll("[data-workspace]"),
    returnFromDeepEdit: root.querySelector("#return-from-deep-edit"),
    openFolder: root.querySelector("#open-folder-main"),
    closeProject: root.querySelector("#close-project"),
    importFiles: root.querySelector("#import-files-main"),
    projectRail: root.querySelector("#project-rail"),
    studio: root.querySelector("#studio"),
    inspector: root.querySelector("#inspector"),
    modalHost: root.querySelector("#modal-host"),
  };
}
