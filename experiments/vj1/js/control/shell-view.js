import { icon } from "./template-utils.js";

export function shellTemplate() {
  return `
    <div class="control-app studio-app" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <header class="topbar studio-topbar">
        <div class="brand">
          <div class="brand-mark">VJ</div>
          <button id="open-folder-main" class="project-button" type="button" title="Open project folder">
            <span class="material-symbols-rounded">folder_open</span>
            <span>
              <strong id="project-name">VJ1</strong>
              <small id="project-meta">Choose a project folder</small>
            </span>
          </button>
          <button id="close-project" class="icon-buttonish close-project-button is-hidden" type="button" title="Close project" aria-label="Close project">${icon("close")}</button>
        </div>
        <div class="top-actions">
          <div id="workspace-switch" class="workspace-switch" role="group" aria-label="Workspace">
            <button type="button" data-workspace="compose">${icon("account_tree")}<span>Compositions</span></button>
            <button type="button" data-workspace="canvas">${icon("dashboard_customize")}<span>Canvas</span></button>
            <button type="button" data-workspace="scene" class="is-active">${icon("auto_awesome")}<span>Scenes</span></button>
            <button type="button" data-workspace="mapping">${icon("schema")}<span>Nodes</span></button>
            <button type="button" data-workspace="live">${icon("play_circle")}<span>Live</span></button>
          </div>
          <button id="toggle-preview" class="icon-buttonish" type="button" title="Toggle preview" aria-label="Toggle preview">${icon("visibility")}</button>
          <button id="toggle-labels" class="icon-buttonish" type="button" title="Debug overlays" aria-label="Debug overlays">${icon("bug_report")}</button>
          <button id="open-settings" class="icon-buttonish" type="button" title="Settings" aria-label="Settings">${icon("settings")}</button>
          <button id="undo-project" class="icon-buttonish" type="button" title="Undo" aria-label="Undo" disabled>${icon("undo")}</button>
          <button id="redo-project" class="icon-buttonish" type="button" title="Redo" aria-label="Redo" disabled>${icon("redo")}</button>
          <button id="toggle-output-playback" class="icon-buttonish" type="button" title="Pause output" aria-label="Pause output" disabled>${icon("pause")}</button>
          <button id="blackout-main" class="icon-buttonish danger" type="button" title="Blackout" aria-label="Blackout">${icon("brightness_1")}</button>
          <button id="open-output" class="icon-buttonish" type="button" title="Open output" aria-label="Open output">${icon("open_in_new")}</button>
          <span id="render-cost" class="status-pill cost-pill" title="Render cost"><span class="material-symbols-rounded">speed</span><span id="render-cost-text">0%</span></span>
          <span id="output-status" class="status-pill"><span class="status-dot"></span><span id="output-status-text">output</span></span>
          <input id="import-files-main" class="hidden" type="file" multiple webkitdirectory data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
      </header>
      <div class="studio-layout">
        <aside id="project-rail" class="project-rail"></aside>
        <aside id="inspector" class="studio-inspector"></aside>
        <main id="studio" class="studio-main"></main>
      </div>
      <div id="modal-host"></div>
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
    renderCostText: root.querySelector("#render-cost-text"),
    openOutput: root.querySelector("#open-output"),
    togglePreview: root.querySelector("#toggle-preview"),
    toggleLabels: root.querySelector("#toggle-labels"),
    openSettings: root.querySelector("#open-settings"),
    undo: root.querySelector("#undo-project"),
    redo: root.querySelector("#redo-project"),
    toggleOutputPlayback: root.querySelector("#toggle-output-playback"),
    blackout: root.querySelector("#blackout-main"),
    workspaceSwitch: root.querySelector("#workspace-switch"),
    openFolder: root.querySelector("#open-folder-main"),
    closeProject: root.querySelector("#close-project"),
    importFiles: root.querySelector("#import-files-main"),
    projectRail: root.querySelector("#project-rail"),
    studio: root.querySelector("#studio"),
    inspector: root.querySelector("#inspector"),
    modalHost: root.querySelector("#modal-host"),
  };
}
