import { BLEND_MODES, GENERATORS, SOURCE_TYPES } from "../constants.js";
import { applySceneSnapshotToState, createSceneSnapshot } from "../domain/models.js";
import { buildOutputUrl } from "../view-routing.js";
import { listShaderComponents } from "../shaders/shader-registry.js";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=scene-snapshots-51";

export function createControlShell({ root, store, bridge, mediaLibrary, projectService }) {
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  const embeddedPreview = createEmbeddedPreviewApp({ store, mediaLibrary });

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    store.subscribe((state, reason) => {
      latestState = state;
      if (reason === "mapping-state") {
        renderTopbar(state);
        renderPreview(state);
        return;
      }
      if (reason === "output-metrics" || reason === "project-autosave" || reason === "project-autosave-error") {
        renderTopbar(state);
        return;
      }
      if (reason.startsWith("edit:")) {
        renderTopbar(state);
        updatePreviewState(state);
        return;
      }
      if (reason.startsWith("scrub:")) return;
      scheduleRender(state);
    });
  }

  function scheduleRender(state) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render(state);
    });
  }

  function render(state) {
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderPreview(state);
  }

  function bindStaticEvents() {
    refs.openOutput.addEventListener("click", () => {
      window.open(buildOutputUrl("output"), "vj1-output", "popup=yes,width=1280,height=720");
      store.update((draft) => {
        draft.ui.outputWindowOpen = true;
      }, "open-output");
      setTimeout(() => bridge.sendState(), 350);
    });

    refs.togglePreview.addEventListener("click", () => {
      store.update((draft) => {
        draft.ui.debugPreview = !draft.ui.debugPreview;
      }, "toggle-preview");
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);

    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      button.addEventListener("click", () => {
        const workspace = ["compose", "scene"].includes(button.dataset.workspace) ? button.dataset.workspace : "scene";
        const mappingActive = workspace === "scene";
        if (typeof store.setWorkspace === "function") store.setWorkspace(workspace);
        else {
          store.update((draft) => {
            draft.ui.workspace = workspace;
            draft.global.calibrating = mappingActive;
          }, "workspace");
        }
        embeddedPreview.command("set-calibrate", { calibrating: mappingActive });
        bridge.command("set-calibrate", { calibrating: mappingActive });
      });
    });

    refs.blackout.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.blackout = !draft.global.blackout;
      }, "blackout");
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      await importFiles(event.dataTransfer?.files || []);
    });
  }

  async function openProjectFolder() {
    const result = await projectService.openFolder().catch((error) => {
      setStatus(`Folder error: ${error.message || error}`);
      return null;
    });
    if (result?.fallback) refs.importFiles.click();
  }

  async function importFiles(files) {
    let result = await projectService.importExternalFiles(files).catch((error) => {
      setStatus(`Import error: ${error.message || error}`);
      return null;
    });
    if (result?.needsFolder) {
      const opened = await projectService.openFolder().catch((error) => {
        setStatus(`Folder error: ${error.message || error}`);
        return null;
      });
      if (opened?.fallback) {
        setStatus("Open a project folder before importing files");
        return;
      }
      result = await projectService.importExternalFiles(files).catch((error) => {
        setStatus(`Import error: ${error.message || error}`);
        return null;
      });
    }
    if (result?.imported) setStatus(`Imported ${result.imported} file${result.imported === 1 ? "" : "s"}`);
  }

  function renderTopbar(state) {
    setText(refs.projectName, state.project.name || "VJ1");
    setText(
      refs.projectMeta,
      state.project.warnings?.[0] || (state.project.folderName ? state.project.folderName : "Choose a project folder to begin")
    );
    setClass(refs.outputStatus, "is-live", state.metrics.clients > 0);
    setText(refs.outputStatusText, state.metrics.clients > 0 ? `${Math.round(state.metrics.fps || 0)} fps` : "output");
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.blackout, "is-active", state.global.blackout);
    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function renderProjectRail(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    const workspace = currentWorkspace(state);
    refs.projectRail.innerHTML = `
      ${hasProject ? railToolsTemplate(state, workspace) : `
        <div class="folder-first-note">
          <span class="material-symbols-rounded">gesture</span>
          <p>Open a folder first. The set, media, scenes, shaders, and mappings will live there together.</p>
        </div>
      `}
    `;
    bindRailEvents();
  }

  function railToolsTemplate(state, workspace) {
    if (workspace === "compose") return compositionToolsTemplate(state);
    return sceneToolsTemplate(state);
  }

  function compositionToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Compositions</span></div>
        <div class="scene-pills">
          ${state.compositions.map((composition) => compositionPillTemplate(composition, state)).join("") || emptyNote("Create visual recipes")}
        </div>
        <button type="button" data-add-composition>${icon("add")} Add composition</button>
      </div>
    `;
  }

  function sceneToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scenes</span></div>
        <div class="scene-pills">
          ${state.scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Capture surface assignments")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scene ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-save-scene title="Capture scene" aria-label="Capture scene">${icon("add")}</button>
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">select_all</span><span>Surfaces</span></div>
        <div class="surface-pills">
          ${state.surfaces.map((surface) => sceneSurfacePillTemplate(surface, state)).join("")}
        </div>
        <button type="button" data-add-surface>${icon("add")} Add surface</button>
      </div>
    `;
  }

  function renderStudio(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!refs.studio.querySelector("[data-studio-stage]")) {
      refs.studio.innerHTML = `
      <section class="studio-stage" data-studio-stage>
        <div class="visual-frame" data-preview-host>
        </div>
      </section>
    `;
      bindStudioEvents();
    }
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    setClass(previewHost, "is-empty", !hasProject);
    if (!hasProject) {
      previewHost.innerHTML = projectEmptyTemplate();
      embeddedPreview.pause();
    }
  }

  function renderPreview(state) {
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    if (!previewHost || previewHost.classList.contains("is-empty")) return;
    if (!state.ui.debugPreview) {
      embeddedPreview.pause();
      ensurePreviewHiddenOverlay(previewHost);
      return;
    }
    removePreviewHiddenOverlay(previewHost);
    const kind = currentWorkspace(state) === "compose" ? "composition" : "preview";
    if (!previewHost.querySelector("[data-embedded-preview-stage]")) {
      previewHost.innerHTML = `
        <div class="embedded-preview-stage" data-embedded-preview-stage></div>
        <div class="preview-fps" data-preview-fps>0 fps</div>
      `;
    }
    embeddedPreview.mount({
      host: previewHost,
      stage: previewHost.querySelector("[data-embedded-preview-stage]"),
      hud: previewHost.querySelector("[data-preview-fps]"),
      mode: kind,
      state,
    });
  }

  function updatePreviewState(state) {
    if (!state.ui.debugPreview) return;
    const kind = currentWorkspace(state) === "compose" ? "composition" : "preview";
    embeddedPreview.setState(state, kind);
  }

  function renderInspector(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!hasProject) {
      refs.inspector.innerHTML = `
        <section class="glass-panel focus-panel">
          <header class="panel-title">
            <span class="material-symbols-rounded">folder_open</span>
            <span>Project first</span>
          </header>
          <div class="soft-note">The controls appear after you choose a folder. That keeps every look connected to a real local show file.</div>
        </section>
      `;
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    if (currentWorkspace(state) === "compose") {
      const selectedComposition = state.compositions.find((composition) => composition.id === state.ui.selectedCompositionId) || state.compositions[0];
      refs.inspector.innerHTML = `
        <section class="glass-panel focus-panel">
          <header class="panel-title">
            <span class="material-symbols-rounded">account_tree</span>
            <span>Composition</span>
          </header>
          ${selectedComposition ? compositionTemplate(selectedComposition, state) : emptyNote("No composition")}
        </section>
      `;
      bindInputs(refs.inspector, state);
      return;
    }
    refs.inspector.innerHTML = `
      <section class="glass-panel focus-panel">
        <header class="panel-title">
          <span class="material-symbols-rounded">select_all</span>
          <span>Surface</span>
        </header>
        ${selectedSurface ? sceneSurfaceTemplate(selectedSurface, state) : emptyNote("No surface")}
      </section>
    `;
    bindInputs(refs.inspector, state);
  }

  function bindRailEvents() {
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    refs.projectRail.querySelectorAll("[data-select-composition]").forEach((button) => {
      button.addEventListener("click", () => store.selectComposition(button.dataset.selectComposition));
    });
    refs.projectRail.querySelectorAll("[data-add-composition]").forEach((button) => {
      button.addEventListener("click", () => store.addComposition());
    });
    refs.projectRail.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
    refs.projectRail.querySelector("[data-save-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scene ${latestState.scenes.length + 1}`;
      store.saveScene(name);
    });
    refs.projectRail.querySelectorAll("[data-recall-scene]").forEach((button) => {
      button.addEventListener("click", () => store.recallScene(button.dataset.recallScene));
    });
    refs.projectRail.querySelectorAll("[data-delete-scene]").forEach((button) => {
      button.addEventListener("click", () => store.deleteScene(button.dataset.deleteScene));
    });
    refs.projectRail.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    refs.projectRail.querySelectorAll("[data-remove-composition]").forEach((button) => {
      button.addEventListener("click", () => store.removeComposition(button.dataset.removeComposition));
    });
    refs.projectRail.querySelectorAll("[data-add-shader]").forEach((button) => {
      button.addEventListener("click", () => addShaderPass(button.dataset.addShader, "composition", latestState.ui.selectedCompositionId));
    });
    refs.projectRail.querySelectorAll("[data-assign-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const mediaId = button.dataset.assignMedia;
        store.update((draft) => {
          const composition = draft.compositions.find((item) => item.id === draft.ui.selectedCompositionId);
          if (composition) composition.source = { type: "media", mediaId, generatorId: composition.source.generatorId };
        }, "assign-media");
      });
    });
  }

  function bindStudioEvents() {
    refs.studio.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.studio.querySelector("[data-import-files]")?.addEventListener("click", () => refs.importFiles.click());
    refs.studio.querySelector("[data-reset-mapping]")?.addEventListener("click", () => {
      embeddedPreview.command("reset-mapping");
      bridge.command("reset-mapping");
    });
  }

  function bindInputs(scope, state) {
    scope.querySelectorAll("[data-update]").forEach((input) => {
      if (input.type === "range") {
        input.addEventListener("input", () => {
          updateRangeLabel(input);
          updatePathFromInput(input, `scrub:${input.dataset.update}`);
        });
        input.addEventListener("change", () => {
          updatePathFromInput(input, `update:${input.dataset.update}`);
        });
        return;
      }
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updatePathFromInput(input, `edit:${input.dataset.update}`));
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
        return;
      }
      input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
    });
    scope.querySelectorAll("[data-select-layer]").forEach((button) => {
      button.addEventListener("click", () => store.selectLayer(button.dataset.selectLayer));
    });
    scope.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    scope.querySelectorAll("[data-select-composition]").forEach((button) => {
      button.addEventListener("click", () => store.selectComposition(button.dataset.selectComposition));
    });
    scope.querySelectorAll("[data-remove-pass]").forEach((button) => {
      button.addEventListener("click", () => removeShaderPass(button.dataset.target, button.dataset.targetId, Number(button.dataset.passIndex)));
    });
    scope.querySelectorAll("[data-add-shader]").forEach((button) => {
      button.addEventListener("click", () => {
        addShaderPass(
          button.dataset.addShader,
          button.dataset.target || "composition",
          button.dataset.targetId || latestState.ui.selectedCompositionId
        );
      });
    });
    scope.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    scope.querySelectorAll("[data-remove-composition]").forEach((button) => {
      button.addEventListener("click", () => store.removeComposition(button.dataset.removeComposition));
    });
    scope.querySelectorAll("[data-reset-surface-mapping]").forEach((button) => {
      button.addEventListener("click", () => {
        embeddedPreview.command("reset-mapping", { surfaceId: button.dataset.resetSurfaceMapping });
        bridge.command("reset-mapping", { surfaceId: button.dataset.resetSurfaceMapping });
      });
    });
    scope.querySelectorAll("[data-reset-mapping]").forEach((button) => {
      button.addEventListener("click", () => {
        embeddedPreview.command("reset-mapping");
        bridge.command("reset-mapping");
      });
    });
  }

  function addShaderPass(id, target, targetId) {
    store.update((draft) => {
      const owner = getShaderOwner(draft, target, targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].push({ id, enabled: true, amount: id === "custom" ? 0.5 : 0.32 });
      if (target === "surface" && currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
    }, "add-shader-pass");
  }

  function removeShaderPass(target, targetId, index) {
    store.update((draft) => {
      const owner = getShaderOwner(draft, target, targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].splice(index, 1);
      if (target === "surface" && currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
    }, "remove-shader-pass");
  }

  function getShaderOwner(state, target, targetId) {
    if (target === "surface" && currentWorkspace(state) === "scene") {
      const scene = getSelectedScene(state);
      return sceneSurfaceSnapshot(scene, targetId);
    }
    if (target === "surface") return state.surfaces.find((surface) => surface.id === targetId);
    if (target === "composition") return state.compositions.find((composition) => composition.id === targetId);
    return null;
  }

  function setStatus(message) {
    store.update((draft) => {
      draft.metrics.message = message;
    }, "status");
  }

  function updatePathFromInput(input, reason) {
    store.update((draft) => {
      setByPath(draft, input.dataset.update, readInputValue(input));
      if (currentWorkspace(draft) === "scene") {
        if (input.dataset.update.startsWith("scenes.")) {
          applySelectedSceneSnapshot(draft);
        } else if (input.dataset.update.startsWith("surfaces.")) {
          syncSelectedSceneSnapshot(draft);
        }
      }
    }, reason);
  }

  return { mount };
}

function shellTemplate() {
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
        </div>
        <div class="top-actions">
          <div id="workspace-switch" class="workspace-switch" role="group" aria-label="Workspace">
            <button type="button" data-workspace="compose">${icon("account_tree")}<span>Compositions</span></button>
            <button type="button" data-workspace="scene" class="is-active">${icon("auto_awesome")}<span>Scene</span></button>
          </div>
          <button id="toggle-preview" class="icon-buttonish" type="button" title="Toggle preview" aria-label="Toggle preview">${icon("visibility")}</button>
          <button id="blackout-main" class="icon-buttonish danger" type="button" title="Blackout" aria-label="Blackout">${icon("brightness_1")}</button>
          <button id="open-output" class="icon-buttonish" type="button" title="Open output" aria-label="Open output">${icon("open_in_new")}</button>
          <span id="output-status" class="status-pill"><span class="status-dot"></span><span id="output-status-text">output</span></span>
          <input id="import-files-main" class="hidden" type="file" multiple webkitdirectory data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
      </header>
      <div class="studio-layout">
        <aside id="project-rail" class="project-rail"></aside>
        <main id="studio" class="studio-main"></main>
        <aside id="inspector" class="studio-inspector"></aside>
      </div>
    </div>
  `;
}

function collectRefs(root) {
  return {
    projectName: root.querySelector("#project-name"),
    projectMeta: root.querySelector("#project-meta"),
    outputStatus: root.querySelector("#output-status"),
    outputStatusText: root.querySelector("#output-status-text"),
    openOutput: root.querySelector("#open-output"),
    togglePreview: root.querySelector("#toggle-preview"),
    blackout: root.querySelector("#blackout-main"),
    workspaceSwitch: root.querySelector("#workspace-switch"),
    openFolder: root.querySelector("#open-folder-main"),
    importFiles: root.querySelector("#import-files-main"),
    projectRail: root.querySelector("#project-rail"),
    studio: root.querySelector("#studio"),
    inspector: root.querySelector("#inspector"),
  };
}

function ensurePreviewHiddenOverlay(host) {
  if (!host.querySelector("[data-preview-hidden-overlay]")) {
    host.insertAdjacentHTML("beforeend", `<div class="preview-hidden-overlay" data-preview-hidden-overlay>${icon("visibility_off")} Preview hidden</div>`);
  }
}

function removePreviewHiddenOverlay(host) {
  host.querySelector("[data-preview-hidden-overlay]")?.remove();
}

function compositionPillTemplate(composition, state) {
  return selectablePillTemplate({
    selected: state.ui.selectedCompositionId === composition.id,
    action: "data-select-composition",
    id: composition.id,
    iconName: composition.enabled ? "account_tree" : "hide_source",
    label: composition.name,
    meta: `${composition.shaderChain?.length || 0} fx`,
    removeAction: "data-remove-composition",
    removeDisabled: state.compositions.length <= 1,
  });
}

function sceneSurfacePillTemplate(surface, state) {
  const sceneSurface = getSceneSurfaceView(surface, state);
  const composition = state.compositions.find((item) => item.id === sceneSurface.compositionId);
  return selectablePillTemplate({
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: sceneSurface.enabled ? "crop_free" : "hide_source",
    label: surface.name,
    meta: composition?.name || "None",
    removeAction: "data-remove-surface",
    removeDisabled: state.surfaces.length <= 1,
  });
}

function selectablePillTemplate({ selected, action, id, iconName, label, meta, removeAction = "", removeDisabled = false }) {
  return `
    <div class="list-row">
      <button type="button" class="list-select ${selected ? "is-selected" : ""}" ${action}="${esc(id)}">
        ${icon(iconName)}
        <span>${esc(label)}</span>
        <small>${esc(meta)}</small>
      </button>
      ${removeAction ? `<button type="button" class="list-remove" ${removeAction}="${esc(id)}" title="Remove" aria-label="Remove ${esc(label)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>` : ""}
    </div>
  `;
}

function compositionTemplate(composition, state) {
  const base = pathForComposition(state, composition);
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(composition.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        <label class="mini-toggle">${icon("power_settings_new")}<input type="checkbox" data-update="${base}.enabled" ${composition.enabled ? "checked" : ""} /></label>
      </div>
      <div class="field-pair">
        <label class="field">Source ${selectTemplate(`${base}.source.type`, SOURCE_TYPES, composition.source.type)}</label>
        <label class="field">Generator ${selectTemplate(`${base}.source.generatorId`, GENERATORS, composition.source.generatorId)}</label>
      </div>
      <label class="field">Media ${mediaSelectTemplate(`${base}.source.mediaId`, state.media, composition.source.mediaId)}</label>
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, composition.blend)}</label>
        <label class="field">Speed <input type="number" min="0" step="0.05" data-update="${base}.speed" value="${composition.speed}" /></label>
      </div>
      ${rangeTemplate("Intensity", `${base}.opacity`, composition.opacity)}
      ${compositionChainTemplate(composition, base)}
    </article>
  `;
}

function sceneSurfaceTemplate(surface, state) {
  const scene = getSelectedScene(state);
  const surfaceBase = pathForSurface(state, surface);
  const sceneIndex = scene ? state.scenes.findIndex((item) => item.id === scene.id) : -1;
  const surfaceIndex = scene?.snapshot?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasSceneSurface = sceneIndex >= 0 && surfaceIndex >= 0;
  const sceneSurface = hasSceneSurface ? scene.snapshot.surfaces[surfaceIndex] : null;
  const sceneBase = `scenes.${sceneIndex}.snapshot.surfaces.${surfaceIndex}`;
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${surfaceBase}.name" value="${esc(surface.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        <label class="mini-toggle">${icon("power_settings_new")}<input type="checkbox" data-update="${surfaceBase}.enabled" ${surface.enabled ? "checked" : ""} /></label>
      </div>
      <label class="toggle-line">${icon("label")}<span>Show mapping label</span><input type="checkbox" data-update="${surfaceBase}.showLabel" ${surface.showLabel ? "checked" : ""} /></label>
      <label class="toggle-line">${icon("lock")}<span>Lock mapping later</span><input type="checkbox" data-update="${surfaceBase}.calibrationLocked" ${surface.calibrationLocked ? "checked" : ""} /></label>
      <div class="setup-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Scene assignment</span></div>
      ${hasSceneSurface ? `
        <label class="field">Composition ${compositionSelectTemplate(`${sceneBase}.compositionId`, state.compositions, sceneSurface.compositionId)}</label>
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        <label class="field">Blend ${selectValuesTemplate(`${sceneBase}.finalBlend`, BLEND_MODES, sceneSurface.finalBlend)}</label>
        <label class="toggle-line">${icon("label")}<span>Scene label</span><input type="checkbox" data-update="${sceneBase}.showLabel" ${sceneSurface.showLabel ? "checked" : ""} /></label>
      ` : `<div class="soft-note">Capture a scene to store composition assignments for this surface.</div>`}
    </article>
  `;
}

function compositionChainTemplate(composition, ownerPath) {
  return `
    <div class="chain-column">
      <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Chain</span></div>
      ${shaderChainTemplate(composition.shaderChain, "composition", composition.id, ownerPath)}
      <details class="chain-add">
        <summary>${icon("add")} Add effect</summary>
        <div class="effect-palette">
          ${listShaderComponents().map((shader) => `
            <button type="button" data-add-shader="${shader.id}" data-target="composition" data-target-id="${composition.id}" title="${esc(shader.name)}">
              ${icon(effectIcon(shader.id))}
              <span>${esc(shader.name)}</span>
            </button>
          `).join("")}
        </div>
      </details>
    </div>
  `;
}

function shaderChainTemplate(chain, target, targetId, ownerPath, chainKey = "shaderChain") {
  if (!chain?.length) return `<div class="soft-note">No effects on this ${target}</div>`;
  return `
    <div class="chain-list">
      ${chain.map((pass, index) => `
        <div class="chain-pass">
          <label>${icon(effectIcon(pass.id))}<input type="checkbox" data-update="${ownerPath}.${chainKey}.${index}.enabled" ${pass.enabled ? "checked" : ""} />${esc(pass.id)}</label>
          <input type="range" min="0" max="1" step="0.01" data-update="${ownerPath}.${chainKey}.${index}.amount" value="${pass.amount}" />
          <button type="button" data-remove-pass data-target="${target}" data-target-id="${targetId}" data-pass-index="${index}" title="Remove effect" aria-label="Remove effect">${icon("close")}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function projectEmptyTemplate() {
  return `
    <div class="project-empty">
      <span class="material-symbols-rounded">folder_open</span>
      <h2>Open a folder to begin</h2>
      <p>Your folder becomes the show: media, shaders, scenes, mappings, and project settings live together.</p>
      <div class="button-row">
        <button type="button" class="primary" data-open-folder>${icon("folder_open")} Open folder</button>
        <button type="button" data-import-files>${icon("upload_file")} Import files</button>
      </div>
    </div>
  `;
}

function mediaPillTemplate(item) {
  return `
    <button type="button" data-assign-media="${esc(item.id)}" title="${esc(item.path)}">
      ${icon(item.type === "image" ? "image" : "movie")}
      <span>${esc(item.name)}</span>
    </button>
  `;
}

function scenePillTemplate(scene, state) {
  return `
    <div class="list-row">
      <button type="button" class="list-select ${state.ui.selectedSceneId === scene.id ? "is-selected" : ""}" data-recall-scene="${esc(scene.id)}">
        ${icon("play_arrow")}
        <span>${esc(scene.name)}</span>
        <small>${scene.snapshot?.surfaces?.length || 0} surfaces</small>
      </button>
      <button type="button" class="list-remove" data-delete-scene="${esc(scene.id)}" title="Remove" aria-label="Remove ${esc(scene.name)}">${icon("close")}</button>
    </div>
  `;
}

function syncSelectedSceneSnapshot(state) {
  const scene = state.scenes.find((item) => item.id === state.ui.selectedSceneId);
  if (!scene) return;
  scene.snapshot = createSceneSnapshot(state);
}

function applySelectedSceneSnapshot(state) {
  const scene = getSelectedScene(state);
  if (scene) applySceneSnapshotToState(state, scene);
}

function getSelectedScene(state) {
  return state.scenes.find((scene) => scene.id === state.ui.selectedSceneId) || null;
}

function sceneSurfaceSnapshot(scene, surfaceId) {
  return scene?.snapshot?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

function getSceneSurfaceView(surface, state) {
  const snapshot = sceneSurfaceSnapshot(getSelectedScene(state), surface.id);
  return snapshot ? { ...surface, ...snapshot } : surface;
}

function currentWorkspace(state) {
  return ["compose", "scene"].includes(state.ui?.workspace) ? state.ui.workspace : "scene";
}

function rangeTemplate(label, path, value) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="0" max="1" step="0.01" data-update="${path}" value="${value}" />
    </label>
  `;
}

function selectTemplate(path, options, value) {
  return `
    <select data-update="${path}">
      ${options.map((option) => `<option value="${option.id}" ${option.id === value ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
    </select>
  `;
}

function selectValuesTemplate(path, values, value) {
  return `
    <select data-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function mediaSelectTemplate(path, media, value) {
  return `
    <select data-update="${path}">
      <option value="">None</option>
      ${media.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
    </select>
  `;
}

function compositionSelectTemplate(path, compositions, value) {
  return `
    <select data-update="${path}">
      ${compositions.map((composition) => `<option value="${esc(composition.id)}" ${composition.id === value ? "selected" : ""}>${esc(composition.name)}</option>`).join("")}
    </select>
  `;
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
    if (!cursor) return;
  }
  const last = parts[parts.length - 1];
  cursor[Number.isNaN(Number(last)) ? last : Number(last)] = value;
}

function readInputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "range" || input.type === "number") return Number(input.value);
  return input.value;
}

function updateRangeLabel(input) {
  const label = input.closest(".range-field");
  const value = label?.querySelector("strong");
  if (value) value.textContent = Number(input.value).toFixed(2);
}

function pathForSurface(state, surface) {
  return `surfaces.${state.surfaces.findIndex((item) => item.id === surface.id)}`;
}

function pathForComposition(state, composition) {
  return `compositions.${state.compositions.findIndex((item) => item.id === composition.id)}`;
}

function emptyNote(text) {
  return `<div class="soft-note">${esc(text)}</div>`;
}

function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

function setText(node, text) {
  const next = String(text ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function setHTML(node, html) {
  const next = String(html ?? "");
  if (node && node.innerHTML !== next) node.innerHTML = next;
}

function setClass(node, className, on) {
  if (!node) return;
  const hasClass = node.classList.contains(className);
  if (on && !hasClass) node.classList.add(className);
  if (!on && hasClass) node.classList.remove(className);
}

function effectIcon(id) {
  return {
    ripple: "water",
    rgbSplit: "gradient",
    kaleido: "filter_vintage",
    pixelate: "grid_view",
    plasma: "blur_on",
    lumaKey: "tonality",
    custom: "data_object",
  }[id] || "auto_awesome";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
