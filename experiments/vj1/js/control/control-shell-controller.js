import { BLEND_MODES, SOURCE_TYPES, VJ1, WORKSPACES } from "../constants.js";
import { applySceneSnapshotToState, createLiveCompositionView, createLiveRenderState, createSceneSnapshot, normalizeRenderSettings } from "../domain/models.js?v=world-frame-24";
import { normalizeParamValue } from "../graph/component-schema.js";
import { listGeneratorComponents } from "../graph/generator-registry.js";
import { patchNodeDegree, planCompositorInputs, planPatchExecution, summarizeTextureBranches } from "../graph/patch-planner.js";
import { compileCompositionPatch } from "../graph/render-scheduler.js?v=world-frame-24";
import { buildOutputUrl } from "../view-routing.js";
import { getShaderComponent, listShaderComponents } from "../shaders/shader-registry.js?v=world-frame-24";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=world-frame-24";
import { frameFitViewport, resetViewport, zoomViewport } from "../output/preview-viewport.js";
import { createHtmlCache, isInteractiveNode, isTextEditingNode, setClass, setText } from "./dom-utils.js";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js";
import { effectIcon, emptyNote, esc, icon, rangeTemplate, selectValuesTemplate, sourceTypeIcon, thumbnailTemplate } from "./template-utils.js";

export function createControlShell({ root, store, bridge, mediaLibrary, projectService }) {
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  let renderPending = false;
  let deferredRenderState = null;
  let deferredRenderTimer = 0;
  let activePointerCount = 0;
  let interactionHoldUntil = 0;
  let mediaPicker = null;
  let elementPicker = null;
  let settingsOpen = false;
  const replaceHtmlIfChanged = createHtmlCache();
  const mediaPreviewUrls = new Map();
  const embeddedPreview = createEmbeddedPreviewApp({ store, mediaLibrary, projectService });
  const interactionQuietMs = 160;

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    restorePreviewPreference();
    store.subscribe((state, reason) => {
      latestState = state;
      if (reason === "mapping-state") {
        renderTopbar(state);
        renderPreview(state);
        return;
      }
      if (reason === "output-metrics" || reason === "preview-metrics" || reason === "project-history" || reason === "project-autosave" || reason === "project-autosave-error") {
        renderTopbar(state);
        return;
      }
      if (reason.startsWith("edit:")) {
        renderTopbar(state);
        updatePreviewState(state);
        return;
      }
      if (reason.startsWith("scrub:")) {
        updatePreviewState(state);
        return;
      }
      scheduleRender(state);
    });
  }

  function scheduleRender(state) {
    if (shouldDeferRender()) {
      deferRender(state);
      return;
    }
    scheduleRenderNow(state);
  }

  function scheduleRenderNow(state) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (shouldDeferRender()) {
        deferRender(state);
        return;
      }
      render(state);
    });
  }

  function deferRender(state) {
    deferredRenderState = state;
    renderPending = true;
    renderTopbar(state);
    updatePreviewState(state);
    scheduleDeferredRenderFlush();
  }

  function scheduleDeferredRenderFlush() {
    if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
    deferredRenderTimer = setTimeout(flushDeferredRender, interactionQuietMs);
  }

  function flushDeferredRender() {
    deferredRenderTimer = 0;
    if (!renderPending || !deferredRenderState) return;
    if (shouldDeferRender()) {
      scheduleDeferredRenderFlush();
      return;
    }
    const state = deferredRenderState;
    deferredRenderState = null;
    renderPending = false;
    scheduleRenderNow(state);
  }

  function render(state) {
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderPreview(state);
    renderModal(state);
  }

  function bindStaticEvents() {
    bindInteractionDeferral();

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
        rememberPreviewPreference(draft.ui.debugPreview);
      }, "toggle-preview");
    });

    refs.toggleLabels.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.showLabels = !draft.global.showLabels;
      }, "toggle-labels");
    });

    refs.openSettings.addEventListener("click", () => {
      settingsOpen = true;
      mediaPicker = null;
      elementPicker = null;
      renderModal(latestState);
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);

    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      button.addEventListener("click", () => {
        const workspace = WORKSPACES.includes(button.dataset.workspace) ? button.dataset.workspace : "scene";
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

    refs.undo.addEventListener("click", async () => {
      refs.undo.disabled = true;
      await projectService.undoProject().catch((error) => setStatus(`Undo error: ${error.message || error}`));
    });

    refs.redo.addEventListener("click", async () => {
      refs.redo.disabled = true;
      await projectService.redoProject().catch((error) => setStatus(`Redo error: ${error.message || error}`));
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      await importFiles(event.dataTransfer?.files || []);
    });
  }

  function restorePreviewPreference() {
    let stored = "";
    try {
      stored = sessionStorage.getItem(VJ1.localPreviewKey) || "";
    } catch {
      stored = "";
    }
    if (!stored) return;
    store.update((draft) => {
      draft.ui.debugPreview = stored === "1";
    }, "restore-preview-preference");
  }

  function rememberPreviewPreference(value) {
    try {
      sessionStorage.setItem(VJ1.localPreviewKey, value ? "1" : "0");
    } catch {
      // This is only a tab preference; project data stays in the project folder.
    }
  }

  function bindInteractionDeferral() {
    root.addEventListener("pointerdown", (event) => {
      if (!isInteractiveNode(event.target)) return;
      activePointerCount += 1;
      beginInteractionHold();
    }, true);
    window.addEventListener("pointerup", endPointerInteractionSoon, true);
    window.addEventListener("pointercancel", endPointerInteractionSoon, true);
    root.addEventListener("focusin", (event) => {
      if (isInteractiveNode(event.target)) beginInteractionHold();
    }, true);
    root.addEventListener("focusout", () => {
      interactionHoldUntil = performance.now() + interactionQuietMs;
      scheduleDeferredRenderFlush();
    }, true);
    root.addEventListener("input", (event) => {
      if (isInteractiveNode(event.target)) beginInteractionHold();
    }, true);
    root.addEventListener("change", (event) => {
      if (!isInteractiveNode(event.target)) return;
      interactionHoldUntil = performance.now() + interactionQuietMs;
      scheduleDeferredRenderFlush();
    }, true);
  }

  function beginInteractionHold() {
    interactionHoldUntil = performance.now() + interactionQuietMs;
    if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
  }

  function endPointerInteractionSoon() {
    activePointerCount = Math.max(0, activePointerCount - 1);
    interactionHoldUntil = performance.now() + interactionQuietMs;
    scheduleDeferredRenderFlush();
  }

  function shouldDeferRender() {
    const now = performance.now();
    return activePointerCount > 0 || now < interactionHoldUntil || hasFocusedEditor();
  }

  function hasFocusedEditor() {
    return isTextEditingNode(document.activeElement);
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
    const projectName = state.project.name || "VJ1";
    const projectMeta = state.project.warnings?.[0] || (
      state.project.folderName && state.project.folderName !== projectName
        ? state.project.folderName
        : ""
    );
    setText(refs.projectName, projectName);
    setText(refs.projectMeta, projectMeta || "Choose a project folder to begin");
    setClass(refs.projectMeta, "is-hidden", !projectMeta && !!state.project.folderName);
    setClass(refs.outputStatus, "is-live", state.metrics.clients > 0);
    setText(refs.outputStatusText, state.metrics.clients > 0 ? `${Math.round(state.metrics.fps || 0)} fps` : "output");
    const renderCost = activeRenderCost(state);
    setClass(refs.renderCost, "is-hot", renderCost > 0.8);
    setText(refs.renderCostText, formatRenderCost(renderCost));
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.toggleLabels, "is-active", state.global.showLabels !== false);
    setClass(refs.blackout, "is-active", state.global.blackout);
    refs.undo.disabled = !state.ui.canUndo;
    refs.redo.disabled = !state.ui.canRedo;
    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function renderProjectRail(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    const workspace = currentWorkspace(state);
    const html = `
      ${hasProject || workspace === "mapping" ? railToolsTemplate(state, workspace) : `
        <div class="folder-first-note">
          <span class="material-symbols-rounded">gesture</span>
          <p>Open a folder first. The set, media, scenes, shaders, and mappings will live there together.</p>
        </div>
      `}
    `;
    if (replaceHtmlIfChanged(refs.projectRail, html)) bindRailEvents();
  }

  function railToolsTemplate(state, workspace) {
    if (workspace === "compose") return compositionToolsTemplate(state);
    if (workspace === "mapping") return mappingToolsTemplate(state);
    if (workspace === "live") return liveToolsTemplate(state);
    return sceneToolsTemplate(state);
  }

  function compositionToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Compositions</span></div>
        <div class="composition-card-list">
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
        <div class="scene-card-list">
          ${state.scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Capture surface assignments")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scene ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-save-scene title="Capture scene" aria-label="Capture scene">${icon("add")}</button>
        </div>
      </div>
      ${sceneRailConfigTemplate(state)}
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">select_all</span><span>Surfaces</span></div>
        <div class="surface-pills">
          ${state.surfaces.map((surface) => sceneSurfacePillTemplate(surface, state)).join("")}
        </div>
        <button type="button" data-add-surface>${icon("add")} Add surface</button>
      </div>
    `;
  }

  function liveToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live Scenes</span></div>
        <div class="scene-card-list live-scene-list">
          ${state.scenes.map((scene) => liveScenePillTemplate(scene, state)).join("") || emptyNote("Capture scenes first")}
        </div>
      </div>
    `;
  }

  function mappingToolsTemplate(state) {
    const selectedComposition = state.compositions.find((composition) => composition.id === state.ui.selectedCompositionId) || state.compositions[0];
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">schema</span><span>Mapping Patch</span></div>
        <div class="composition-card-list">
          ${state.compositions.map((composition) => compositionPillTemplate(composition, state)).join("") || emptyNote("Create a composition")}
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">input</span><span>Inlets</span></div>
        <div class="node-chip-list">
          ${mappingInletsTemplate(selectedComposition)}
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">output</span><span>Outlets</span></div>
        <div class="node-chip-list">
          <div class="node-chip"><span>texture</span><small>composition output</small></div>
          <div class="node-chip"><span>event</span><small>manual lane</small></div>
        </div>
      </div>
    `;
  }

  function renderStudio(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (currentWorkspace(state) === "mapping") {
      embeddedPreview.pause();
      const html = mappingStudioTemplate(state);
      if (replaceHtmlIfChanged(refs.studio, html)) bindStudioEvents();
      return;
    }
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
      replaceHtmlIfChanged(previewHost, projectEmptyTemplate());
      embeddedPreview.pause();
    }
  }

  function renderPreview(state) {
    if (currentWorkspace(state) === "mapping") return;
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    if (!previewHost || previewHost.classList.contains("is-empty")) return;
    const workspace = currentWorkspace(state);
    const kind = workspace === "compose" ? "composition" : "preview";
    const previewState = workspace === "live" ? createLiveRenderState(state) : state;
    if (!previewHost.querySelector("[data-embedded-preview-stage]")) {
      replaceHtmlIfChanged(previewHost, `
        <div class="embedded-preview-stage" data-embedded-preview-stage></div>
        <div class="preview-tools">
          <button type="button" class="preview-tool" data-preview-zoom-out title="Zoom out" aria-label="Zoom out">${icon("remove")}</button>
          <button type="button" class="preview-tool" data-preview-fit-world title="Fit world" aria-label="Fit world">${icon("public")}</button>
          <button type="button" class="preview-tool" data-preview-fit-frame title="Fit output frame" aria-label="Fit output frame">${icon("fit_screen")}</button>
          <button type="button" class="preview-tool" data-preview-zoom-in title="Zoom in" aria-label="Zoom in">${icon("add")}</button>
          <button type="button" class="preview-tool" data-toggle-mapping-handles title="Toggle mapping handles" aria-label="Toggle mapping handles">${icon("control_point_duplicate")}</button>
          <div class="preview-fps" data-preview-fps>0 fps</div>
        </div>
      `);
    }
    bindPreviewViewportTools(previewHost);
    const handleButton = previewHost.querySelector("[data-toggle-mapping-handles]");
    setClass(handleButton, "is-subtle", state.global.mappingHandleMode === "near");
    setClass(handleButton, "is-hidden", kind !== "preview");
    if (handleButton && !handleButton.dataset.bound) {
      handleButton.dataset.bound = "true";
      handleButton.addEventListener("click", () => {
        store.update((draft) => {
          draft.global.mappingHandleMode = draft.global.mappingHandleMode === "near" ? "always" : "near";
        }, "toggle-mapping-handles");
      });
    }
    embeddedPreview.mount({
      host: previewHost,
      stage: previewHost.querySelector("[data-embedded-preview-stage]"),
      hud: previewHost.querySelector("[data-preview-fps]"),
      mode: kind,
      state: previewState,
    });
  }

  function updatePreviewState(state) {
    const workspace = currentWorkspace(state);
    if (workspace === "mapping") return;
    const kind = workspace === "compose" ? "composition" : "preview";
    embeddedPreview.setState(workspace === "live" ? createLiveRenderState(state) : state, kind);
  }

  function renderInspector(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!hasProject && currentWorkspace(state) !== "mapping") {
      replaceHtmlIfChanged(refs.inspector, panelTemplate(
        "folder_open",
        "Project first",
        `<div class="soft-note">The controls appear after you choose a folder. That keeps every look connected to a real local show file.</div>`
      ));
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    let html = "";
    if (currentWorkspace(state) === "compose") {
      const selectedComposition = state.compositions.find((composition) => composition.id === state.ui.selectedCompositionId) || state.compositions[0];
      html = panelTemplate(
        "account_tree",
        "Composition",
        selectedComposition ? compositionTemplate(selectedComposition, state) : emptyNote("No composition")
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "mapping") {
      const selectedComposition = state.compositions.find((composition) => composition.id === state.ui.selectedCompositionId) || state.compositions[0];
      html = panelTemplate(
        "schema",
        "Node Mapping",
        mappingInspectorTemplate(selectedComposition, state)
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "live") {
      html = panelTemplate(
        "tune",
        "Live",
        liveInspectorTemplate(state)
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    html = `
      ${panelTemplate("select_all", "Surface", selectedSurface ? sceneSurfaceTemplate(selectedSurface, state) : emptyNote("No surface"))}
    `;
    if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
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
    refs.projectRail.querySelectorAll("[data-update]").forEach((input) => {
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updatePathFromInput(input, `edit:${input.dataset.update}`));
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
        return;
      }
      input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
    });
    refs.projectRail.querySelectorAll("[data-select-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectScene(button.dataset.selectScene));
    });
    refs.projectRail.querySelectorAll("[data-live-scene]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          const nextSceneId = button.dataset.liveScene;
          draft.ui.live.selectedSceneId = nextSceneId;
          draft.ui.live.compositionOverrides = {};
        }, "live:scene");
      });
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
  }

  function renderModal(state) {
    const host = refs.modalHost;
    if (!host) return;
    if (!mediaPicker && !elementPicker && !settingsOpen) {
      replaceHtmlIfChanged(host, "");
      return;
    }
    if (settingsOpen) {
      if (!replaceHtmlIfChanged(host, settingsModalTemplate(state))) return;
      host.querySelector("[data-close-modal]")?.addEventListener("click", closeSettings);
      host.querySelector(".modal-backdrop")?.addEventListener("click", closeSettings);
      host.querySelectorAll("[data-settings-update]").forEach((input) => {
        input.addEventListener("input", () => updateRenderSetting(input, `scrub:${input.dataset.settingsUpdate}`));
        input.addEventListener("change", () => updateRenderSetting(input, `update:${input.dataset.settingsUpdate}`));
      });
      host.querySelectorAll("[data-render-preset]").forEach((button) => {
        button.addEventListener("click", () => applyRenderPreset(button.dataset.renderPreset));
      });
      return;
    }
    if (elementPicker) {
      if (!replaceHtmlIfChanged(host, elementPickerTemplate(state, elementPicker, mediaLibrary, mediaPreviewUrls))) return;
      host.querySelector("[data-close-modal]")?.addEventListener("click", closeElementPicker);
      host.querySelector(".modal-backdrop")?.addEventListener("click", closeElementPicker);
      host.querySelectorAll("[data-add-element-media]").forEach((button) => {
        button.addEventListener("click", () => {
          store.addChainSource(elementPicker.compositionId, {
            type: "media",
            mediaId: button.dataset.addElementMedia || "",
          });
          closeElementPicker();
        });
      });
      host.querySelector("[data-add-element-camera]")?.addEventListener("click", () => {
        store.addChainSource(elementPicker.compositionId, { type: "camera" });
        closeElementPicker();
      });
      host.querySelectorAll("[data-add-element-generator]").forEach((button) => {
        button.addEventListener("click", () => {
          store.addChainSource(elementPicker.compositionId, {
            type: "generator",
            generatorId: button.dataset.addElementGenerator || "testPattern",
          });
          closeElementPicker();
        });
      });
      host.querySelectorAll("[data-add-element-effect]").forEach((button) => {
        button.addEventListener("click", () => {
          store.addChainEffect(elementPicker.compositionId, button.dataset.addElementEffect);
          closeElementPicker();
        });
      });
      return;
    }
    if (!replaceHtmlIfChanged(host, mediaPickerTemplate(state, mediaPicker, mediaLibrary, mediaPreviewUrls))) return;
    host.querySelector("[data-close-modal]")?.addEventListener("click", closeMediaPicker);
    host.querySelector(".modal-backdrop")?.addEventListener("click", closeMediaPicker);
    host.querySelectorAll("[data-pick-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const mediaId = button.dataset.pickMedia || "";
        store.update((draft) => {
          setByPath(draft, mediaPicker.path, mediaId);
          const sourcePath = mediaPicker.path.replace(/\.mediaId$/, "");
          setByPath(draft, `${sourcePath}.type`, "media");
        }, `update:${mediaPicker.path}`);
        closeMediaPicker();
      });
    });
  }

  function openMediaPicker(path) {
    mediaPicker = { path };
    elementPicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function closeMediaPicker() {
    mediaPicker = null;
    renderModal(latestState);
  }

  function openElementPicker(compositionId) {
    elementPicker = { compositionId };
    mediaPicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function closeElementPicker() {
    elementPicker = null;
    renderModal(latestState);
  }

  function closeSettings() {
    settingsOpen = false;
    renderModal(latestState);
  }

  function updateRenderSetting(input, reason) {
    store.update((draft) => {
      setByPath(draft, input.dataset.settingsUpdate, readInputValue(input));
      draft.render = normalizeRenderSettings(draft.render);
    }, reason);
  }

  function applyRenderPreset(preset) {
    const presets = {
      wide: [960, 540],
      xga: [1024, 768],
      hd: [1280, 720],
      fhd: [1920, 1080],
      "2k": [2048, 1080],
      "4k": [3840, 2160],
    };
    const [frameWidth, frameHeight] = presets[preset] || presets.wide;
    store.update((draft) => {
      draft.render = normalizeRenderSettings({
        ...draft.render,
        frameWidth,
        frameHeight,
      });
    }, "render-preset");
  }

  function bindPreviewViewportTools(previewHost) {
    const bindButton = (selector, handler) => {
      const button = previewHost.querySelector(selector);
      if (!button || button.dataset.bound) return;
      button.dataset.bound = "true";
      button.addEventListener("click", handler);
    };
    bindButton("[data-preview-zoom-out]", () => nudgePreviewZoom(1 / 1.2));
    bindButton("[data-preview-zoom-in]", () => nudgePreviewZoom(1.2));
    bindButton("[data-preview-fit-world]", () => {
      store.update((draft) => {
        draft.ui.previewViewport = resetViewport();
      }, "preview-fit-world");
    });
    bindButton("[data-preview-fit-frame]", () => {
      const stage = previewHost.querySelector("[data-embedded-preview-stage]");
      const rect = stage?.getBoundingClientRect?.();
      store.update((draft) => {
        draft.ui.previewViewport = frameFitViewport({
          stageSize: {
            width: Math.max(1, Math.floor(rect?.width || previewHost.clientWidth || 960)),
            height: Math.max(1, Math.floor(rect?.height || previewHost.clientHeight || 540)),
          },
          render: draft.render,
        });
      }, "preview-fit-frame");
    });
  }

  function nudgePreviewZoom(multiplier) {
    store.update((draft) => {
      draft.ui.previewViewport = zoomViewport(draft.ui.previewViewport, multiplier);
    }, "preview-zoom");
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
    scope.querySelectorAll("[data-live-update]").forEach((input) => {
      if (input.type === "range") {
        input.addEventListener("input", () => {
          updateRangeLabel(input);
          updateLivePathFromInput(input, "scrub:live");
        });
        input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
        return;
      }
      input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
    });
    scope.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    scope.querySelectorAll("[data-select-composition]").forEach((button) => {
      button.addEventListener("click", () => store.selectComposition(button.dataset.selectComposition));
    });
    scope.querySelectorAll("[data-set-source-type]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.sourcePath, button.dataset.setSourceType);
        }, `update:${button.dataset.sourcePath}`);
      });
    });
    scope.querySelectorAll("[data-set-generator]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.generatorPath, button.dataset.setGenerator);
        }, `update:${button.dataset.generatorPath}`);
      });
    });
    scope.querySelectorAll("[data-open-media-picker]").forEach((button) => {
      button.addEventListener("click", () => openMediaPicker(button.dataset.mediaPath));
    });
    scope.querySelectorAll("[data-set-composition]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.compositionPath, button.dataset.setComposition);
          if (currentWorkspace(draft) === "scene" && button.dataset.compositionPath?.startsWith("scenes.")) {
            applySelectedSceneSnapshot(draft);
          }
        }, `update:${button.dataset.compositionPath}`);
      });
    });
    scope.querySelectorAll("[data-open-element-picker]").forEach((button) => {
      button.addEventListener("click", () => openElementPicker(button.dataset.compositionId || latestState.ui.selectedCompositionId));
    });
    scope.querySelectorAll("[data-select-chain-item]").forEach((button) => {
      button.addEventListener("click", () => store.selectChainItem(button.dataset.selectChainItem));
    });
    scope.querySelectorAll("[data-remove-chain-item]").forEach((button) => {
      button.addEventListener("click", () => removeChainItem(button.dataset.compositionId, button.dataset.removeChainItem));
    });
    scope.querySelectorAll("[data-chain-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        onReorder: (fromId, toId) => store.reorderChain(list.dataset.compositionId, fromId, toId),
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

  function removeChainItem(compositionId, itemId) {
    store.update((draft) => {
      const composition = draft.compositions.find((item) => item.id === compositionId);
      if (!composition?.chain || composition.chain.length <= 1) return;
      composition.chain = composition.chain.filter((item) => item.id !== itemId);
      if (draft.ui.selectedChainItemId === itemId) draft.ui.selectedChainItemId = composition.chain[0]?.id || "";
    }, "remove-chain-item");
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

  function updateLivePathFromInput(input, reason) {
    store.update((draft) => {
      const compositionId = input.dataset.liveCompositionId;
      if (!compositionId) return;
      draft.ui.live.compositionOverrides ||= {};
      const override = draft.ui.live.compositionOverrides[compositionId] ||= {};
      setByPathCreate(override, input.dataset.liveUpdate, readInputValue(input));
    }, reason);
  }

  return { mount };
}

function compositionPillTemplate(composition, state) {
  const selected = state.ui.selectedCompositionId === composition.id;
  return `
    <div class="composition-card-row">
      <button type="button" class="composition-card ${selected ? "is-selected" : ""}" data-select-composition="${esc(composition.id)}">
        ${thumbnailTemplate(composition.thumbnail)}
        <span>${esc(composition.name)}</span>
      </button>
      <button type="button" class="composition-card-remove" data-remove-composition="${esc(composition.id)}" title="Remove" aria-label="Remove ${esc(composition.name)}" ${state.compositions.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
    </div>
  `;
}

function mappingStudioTemplate(state) {
  const composition = state.compositions.find((item) => item.id === state.ui.selectedCompositionId) || state.compositions[0];
  const patch = compileCompositionPatch(composition || {});
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);
  return `
    <section class="mapping-stage" data-mapping-stage>
      <div class="mapping-board">
        ${compositor.inputs.length
          ? compositor.inputs.map((input, index) => mappingBranchRowTemplate(input, index, plan)).join("")
          : mappingPlanRowTemplate(plan)}
        <div class="mapping-flow-row mapping-control-row">
          ${mappingSchedulerNodeTemplate(state)}
          <div class="mapping-wire"><span></span></div>
          ${mappingEventNodeTemplate(composition)}
        </div>
      </div>
    </section>
  `;
}

function mappingPlanRowTemplate(plan) {
  return `
    <div class="mapping-flow-row">
      ${plan.nodes.map((node, index) => `
        ${index > 0 ? `<div class="mapping-wire"><span></span></div>` : ""}
        ${mappingNodeTemplate(node, index, plan)}
      `).join("")}
    </div>
  `;
}

function mappingBranchRowTemplate(input, branchIndex, plan) {
  const nodes = [input.source, ...(input.effects || []), input.output].filter(Boolean);
  return `
    <div class="mapping-flow-row" data-branch="${branchIndex + 1}">
      ${nodes.map((node, index) => `
        ${index > 0 ? `<div class="mapping-wire"><span></span></div>` : ""}
        ${mappingNodeTemplate(node, index, plan)}
      `).join("")}
    </div>
  `;
}

function mappingNodeTemplate(node, index, plan = null) {
  const degree = plan ? patchNodeDegree(plan, node.id) : { in: node.inlets?.length || 0, out: node.outlets?.length || 0 };
  return `
    <article class="mapping-node mapping-node-${esc(node.role || node.kind)}" style="--node-index: ${index};">
      <header>
        ${icon(mappingNodeIcon(node))}
        <strong>${esc(nodeLabel(node))}</strong>
      </header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", node.inlets)}
        ${mappingPortsTemplate("out", node.outlets)}
      </div>
      ${node.params && Object.keys(node.params).length ? `
        <div class="mapping-param-pills">
          ${Object.entries(node.params).map(([key, value]) => `<span>${esc(key)} <small>${esc(formatMappingValue(value))}</small></span>`).join("")}
        </div>
      ` : ""}
      <div class="mapping-param-pills">
        <span>degree <small>${degree.in} in / ${degree.out} out</small></span>
        ${node.state?.renderRequest ? `<span>request <small>${esc(formatRenderRequest(node.state.renderRequest))}</small></span>` : ""}
      </div>
    </article>
  `;
}

function mappingSchedulerNodeTemplate(state) {
  return `
    <article class="mapping-node mapping-node-scheduler">
      <header>${icon("schedule")}<strong>Manual Scheduler</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", [{ id: "event", label: "event", type: "event" }])}
        ${mappingPortsTemplate("out", [{ id: "event", label: "event", type: "event" }])}
      </div>
      <div class="mapping-param-pills">
        <span>lane <small>${state.scheduler?.manualLane === false ? "off" : "on"}</small></span>
        <span>mode <small>${esc(state.scheduler?.mode || "hardconfigured")}</small></span>
      </div>
    </article>
  `;
}

function mappingEventNodeTemplate(composition) {
  return `
    <article class="mapping-node mapping-node-event">
      <header>${icon("bolt")}<strong>Param Event</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", [{ id: "event", label: "event", type: "event" }])}
        ${mappingPortsTemplate("out", [{ id: "params", label: composition?.name || "composition", type: "number" }])}
      </div>
      <div class="mapping-param-pills">
        <span>target <small>${esc(composition?.name || "composition")}</small></span>
      </div>
    </article>
  `;
}

function mappingPortsTemplate(label, ports = []) {
  return `
    <div class="mapping-ports">
      <small>${esc(label)}</small>
      ${ports.length ? ports.map((port) => `
        <span><i></i>${esc(port.label || port.id)}<em>${esc(port.type)}</em></span>
      `).join("") : `<span class="is-empty"><i></i>none<em>-</em></span>`}
    </div>
  `;
}

function mappingInspectorTemplate(composition, state) {
  const patch = compileCompositionPatch(composition || {});
  const plan = planPatchExecution(patch);
  const compositorPlan = planCompositorInputs(plan);
  const branchSummaries = summarizeTextureBranches(plan);
  const outputNode = patch.nodes.find((node) => node.role === "output");
  const compositor = outputNode?.state?.compositor || {};
  const branchWarnings = branchSummaries.flatMap((branch) => branch.warnings || []);
  const compositorWarnings = compositorPlan.warnings || [];
  const generators = listGeneratorComponents();
  const effects = listShaderComponents();
  return `
    <article class="sculpt-card mapping-inspector">
      <label class="field">Composition
        <select data-update="ui.selectedCompositionId">
          ${state.compositions.map((item) => `<option value="${esc(item.id)}" ${item.id === composition?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
        </select>
      </label>
      <label class="field inline-param">
        <span>Manual scheduler</span>
        <input type="checkbox" data-update="scheduler.manualLane" ${state.scheduler?.manualLane === false ? "" : "checked"} />
      </label>
      <div class="mapping-stat-grid">
        <span><strong>${patch.nodes.length}</strong><small>nodes</small></span>
        <span><strong>${patch.edges.length}</strong><small>edges</small></span>
        <span><strong>${compositorPlan.inputs.length}</strong><small>branches</small></span>
      </div>
      <div class="soft-note">${esc(compositor.type === "layered" ? `${compositor.inputCount} layered compositor inputs` : "Single texture passthrough")}</div>
      ${plan.warnings.length ? `<div class="soft-note">${esc(plan.warnings.length)} graph warning${plan.warnings.length === 1 ? "" : "s"}</div>` : ""}
      ${branchWarnings.length ? `<div class="soft-note">${esc(branchWarnings.length)} branch warning${branchWarnings.length === 1 ? "" : "s"}</div>` : ""}
      ${compositorWarnings.length ? `<div class="soft-note">${esc(compositorWarnings.length)} compositor warning${compositorWarnings.length === 1 ? "" : "s"}</div>` : ""}
      ${branchSummaries.length ? `
        <div class="node-chip-list compact">
          ${branchSummaries.map((branch) => `
            <div class="node-chip">
              <span>${esc(branch.inletId || `texture-${branch.index || 1}`)}</span>
              <small>${esc(branch.sourceLabel)} -> ${esc(branch.effectComponentIds.join(" -> ") || "output")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
      <div class="node-chip-list compact">
        ${generators.map((component) => componentChipTemplate(component)).join("")}
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
      <div class="node-chip-list compact">
        ${effects.map((component) => componentChipTemplate(component)).join("")}
      </div>
    </article>
  `;
}

function mappingInletsTemplate(composition) {
  const patch = compileCompositionPatch(composition || {});
  const plan = planPatchExecution(patch);
  const ports = [];
  for (const node of plan.nodes) {
    for (const inlet of node.inlets || []) {
      ports.push({ node, inlet });
    }
    for (const param of Object.keys(node.params || {})) {
      ports.push({ node, inlet: { id: param, label: param, type: "number" } });
    }
  }
  return ports.length
    ? ports.map(({ node, inlet }) => `<div class="node-chip"><span>${esc(inlet.label || inlet.id)}</span><small>${esc(nodeLabel(node))} / ${esc(inlet.type)}</small></div>`).join("")
    : `<div class="node-chip"><span>texture</span><small>source</small></div>`;
}

function componentChipTemplate(component) {
  const inletCount = component.inlets?.length || 0;
  const outletCount = component.outlets?.length || 0;
  const paramCount = component.params?.length || 0;
  return `
    <div class="node-chip">
      <span>${esc(component.name || component.id)}</span>
      <small>${inletCount} in / ${outletCount} out / ${paramCount} param${paramCount === 1 ? "" : "s"}</small>
    </div>
  `;
}

function mappingNodeIcon(node) {
  if (node.role === "source" || node.kind === "generator") return "input";
  if (node.role === "effect") return effectIcon(node.componentId);
  if (node.role === "output") return "output";
  return "schema";
}

function nodeLabel(node) {
  if (node.role === "source" && node.params?.generatorId) return node.params.generatorId;
  if (node.role === "output") return "Output";
  return node.componentId || node.id || "Node";
}

function formatMappingValue(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number.toFixed(2);
  return value;
}

function formatRenderRequest(request = {}) {
  const role = request.role || "texture";
  const width = Math.max(1, Math.floor(Number(request.width) || 1));
  const height = Math.max(1, Math.floor(Number(request.height) || 1));
  return `${role} ${width}x${height}`;
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
      </div>
      ${compositionUnifiedChainTemplate(composition, state, base)}
    </article>
  `;
}

function compositionUnifiedChainTemplate(composition, state, ownerPath) {
  const selected = selectedChainItem(composition, state);
  return `
    <div class="chain-column">
      <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Chain</span></div>
      <div class="composition-chain-list" data-chain-reorder-list data-composition-id="${esc(composition.id)}">
        ${(composition.chain || []).map((item, index) => chainItemRowTemplate(item, composition, state, index)).join("")}
      </div>
      <button type="button" class="chain-add-button" data-open-element-picker data-composition-id="${esc(composition.id)}">${icon("add")} Add element</button>
      ${selected ? selectedChainItemTemplate(selected, composition, state, `${ownerPath}.chain.${composition.chain.findIndex((item) => item.id === selected.id)}`) : emptyNote("Select a chain item")}
    </div>
  `;
}

function chainItemRowTemplate(item, composition, state, index) {
  const selected = state.ui.selectedChainItemId === item.id;
  return `
    <div class="chain-item-row ${selected ? "is-selected" : ""}" data-reorder-id="${esc(item.id)}">
      <button type="button" class="chain-item-select" data-select-chain-item="${esc(item.id)}">
        ${icon(item.kind === "source" ? sourceTypeIcon(item.source?.type || "generator") : effectIcon(item.componentId))}
        <span>${esc(item.name || item.componentId)}</span>
        <small>${item.kind === "source" ? esc(item.source?.type || "source") : "effect"}</small>
      </button>
      <button type="button" class="chain-item-remove" data-composition-id="${esc(composition.id)}" data-remove-chain-item="${esc(item.id)}" title="Remove" aria-label="Remove ${esc(item.name || item.componentId)}" ${composition.chain.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
    </div>
  `;
}

function selectedChainItemTemplate(item, composition, state, base) {
  if (item.kind === "source") return sourceChainItemTemplate(item, state, base);
  const component = getShaderComponent(item.componentId);
  return `
    <section class="chain-item-editor">
      <div class="rail-title"><span class="material-symbols-rounded">${effectIcon(item.componentId)}</span><span>${esc(component?.name || item.componentId)}</span></div>
      <label class="toggle-line">${icon("power_settings_new")}<input type="checkbox" data-update="${base}.enabled" ${item.enabled ? "checked" : ""} /> Enabled</label>
      ${shaderParamControlsTemplate(component, item, base)}
      ${component?.spatial ? effectTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function sourceChainItemTemplate(item, state, base) {
  return `
    <section class="chain-item-editor">
      <div class="rail-title"><span class="material-symbols-rounded">layers</span><span>Layer</span></div>
      <label class="field">Name <input type="text" data-update="${base}.name" value="${esc(item.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" /></label>
      <label class="toggle-line">${icon("power_settings_new")}<input type="checkbox" data-update="${base}.enabled" ${item.enabled ? "checked" : ""} /> Enabled</label>
      ${sourcePickerTemplate(item, state, base)}
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend)}</label>
        ${rangeTemplate("Opacity", `${base}.opacity`, item.opacity)}
      </div>
      <div class="field-pair">
        ${rangeTemplate("X", `${base}.transform.x`, item.transform?.x || 0, -1, 1, 0.01)}
        ${rangeTemplate("Y", `${base}.transform.y`, item.transform?.y || 0, -1, 1, 0.01)}
      </div>
      <div class="field-pair">
        ${rangeTemplate("Scale", `${base}.transform.scale`, item.transform?.scale ?? 1, 0.1, 3, 0.01)}
        ${rangeTemplate("Rotate", `${base}.transform.rotation`, item.transform?.rotation || 0, -3.14, 3.14, 0.01)}
      </div>
    </section>
  `;
}

function effectTransformControlsTemplate(item, base) {
  return `
    <div class="field-pair">
      ${rangeTemplate("X", `${base}.transform.x`, item.transform?.x || 0, -1, 1, 0.01)}
      ${rangeTemplate("Y", `${base}.transform.y`, item.transform?.y || 0, -1, 1, 0.01)}
    </div>
    <div class="field-pair">
      ${rangeTemplate("Scale", `${base}.transform.scale`, item.transform?.scale ?? 1, 0.1, 3, 0.01)}
      ${rangeTemplate("Rotate", `${base}.transform.rotation`, item.transform?.rotation || 0, -3.14, 3.14, 0.01)}
    </div>
  `;
}

function selectedChainItem(composition, state) {
  return composition.chain?.find((item) => item.id === state.ui.selectedChainItemId) || composition.chain?.[0] || null;
}

function sourcePickerTemplate(composition, state, base) {
  const source = composition.source || {};
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      <div class="field">
        <span>Source</span>
        <div class="segmented-pills">
          ${SOURCE_TYPES.map((type) => `
            <button type="button" class="${source.type === type.id ? "is-selected" : ""}" data-set-source-type="${type.id}" data-source-path="${base}.source.type">
              ${icon(sourceTypeIcon(type.id))}
              <span>${esc(type.label)}</span>
            </button>
          `).join("")}
        </div>
      </div>
      ${source.type === "generator" ? generatorPickerTemplate(`${base}.source.generatorId`, source.generatorId) : ""}
      ${source.type === "media" ? mediaPickerButtonTemplate(`${base}.source.mediaId`, media) : ""}
      ${source.type === "camera" ? `<div class="soft-note">Using the portal camera feed.</div>` : ""}
      ${source.type === "black" ? `<div class="soft-note">Black source selected.</div>` : ""}
    </div>
  `;
}

function generatorPickerTemplate(path, value) {
  return `
    <div class="field">
      <span>Generator</span>
      <div class="generator-grid">
        ${listGeneratorComponents().filter((generator) => generator.id !== "black").map((generator) => `
          <button type="button" class="generator-card ${generator.id === value ? "is-selected" : ""}" data-set-generator="${generator.id}" data-generator-path="${path}">
            ${icon("auto_awesome")}
            <strong>${esc(generator.label || generator.name)}</strong>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function mediaPickerButtonTemplate(path, media) {
  return `
    <div class="field">
      <span>Media</span>
      <button type="button" class="media-select-button" data-open-media-picker data-media-path="${path}">
        ${icon(media?.type === "video" ? "movie" : media?.type === "image" ? "image" : "perm_media")}
        <span>${esc(media?.name || "Choose media")}</span>
        ${icon("chevron_right")}
      </button>
    </div>
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
      <div class="surface-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Scene assignment</span></div>
      ${hasSceneSurface ? `
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        ${compositionAssignmentTemplate(`${sceneBase}.compositionId`, state.compositions, sceneSurface.compositionId)}
      ` : `<div class="soft-note">Capture a scene to store composition assignments for this surface.</div>`}
    </article>
  `;
}

function sceneRailConfigTemplate(state) {
  const scene = getSelectedScene(state);
  if (!scene) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
        ${emptyNote("Capture a scene to edit scene settings.")}
      </div>
    `;
  }
  const base = pathForScene(state, scene);
  return `
    <div class="rail-section">
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
      <label class="field">Name <input type="text" data-update="${base}.name" value="${esc(scene.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" /></label>
    </div>
  `;
}

function panelTemplate(iconName, title, body) {
  return `
    <section class="glass-panel focus-panel">
      <header class="panel-title">
        <span class="material-symbols-rounded">${iconName}</span>
        <span>${esc(title)}</span>
      </header>
      ${body}
    </section>
  `;
}

function shaderParamControlsTemplate(component, pass, basePath) {
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${component.params.map((param) => paramControlTemplate(param, `${basePath}.params.${param.id}`, paramCurrentValue(component, pass, param))).join("")}
    </div>
  `;
}

function paramControlTemplate(param, path, value, attrs = "data-update") {
  if (param.type === "boolean") {
    return `
      <label class="field inline-param">
        <span>${esc(param.label || param.id)}</span>
        <input type="checkbox" ${attrs}="${esc(path)}" ${value ? "checked" : ""} />
      </label>
    `;
  }
  if (param.type === "enum") {
    return `
      <label class="field chain-param">
        <span>${esc(param.label || param.id)}</span>
        <select ${attrs}="${esc(path)}">
          ${(param.values || []).map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  return `
    <label class="field range-field chain-param">
      <span><span>${esc(param.label || param.id)}</span><strong>${formatParamValue(value)}</strong></span>
      <input type="range" min="${param.min ?? 0}" max="${param.max ?? 1}" step="${param.step ?? 0.01}" ${attrs}="${esc(path)}" value="${value}" />
    </label>
  `;
}

function paramCurrentValue(component, pass, param) {
  const values = {
    ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
  };
  if (param.id === "amount" && values.amount === undefined) values.amount = pass.amount;
  return normalizeParamValue(param, values[param.id]);
}

function formatParamValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : esc(value);
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

function settingsModalTemplate(state) {
  const render = normalizeRenderSettings(state.render || {});
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel settings-modal" role="dialog" aria-modal="true" aria-label="Project settings">
      <header class="modal-header">
        <div>
          <strong>Project settings</strong>
          <small>Output frame and rendering budget.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <div class="settings-modal-body">
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">crop_16_9</span><span>Output frame</span></div>
          <div class="settings-preset-row">
            <button type="button" data-render-preset="wide">960 x 540</button>
            <button type="button" data-render-preset="xga">XGA</button>
            <button type="button" data-render-preset="hd">HD</button>
            <button type="button" data-render-preset="fhd">Full HD</button>
            <button type="button" data-render-preset="2k">2K</button>
            <button type="button" data-render-preset="4k">4K</button>
          </div>
          <div class="field-pair">
            <label class="field">Width <input type="number" min="128" max="8192" step="1" data-settings-update="render.frameWidth" value="${render.frameWidth}" /></label>
            <label class="field">Height <input type="number" min="128" max="8192" step="1" data-settings-update="render.frameHeight" value="${render.frameHeight}" /></label>
          </div>
        </section>
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">texture</span><span>Surface texture</span></div>
          <div class="field-pair">
            <label class="field">Width <input type="number" min="64" max="8192" step="1" data-settings-update="render.surfaceWidth" value="${render.surfaceWidth}" /></label>
            <label class="field">Height <input type="number" min="64" max="8192" step="1" data-settings-update="render.surfaceHeight" value="${render.surfaceHeight}" /></label>
          </div>
        </section>
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">speed</span><span>Performance</span></div>
          <div class="field-pair">
            <label class="field">Pixel density <input type="number" min="0.5" max="2" step="0.25" data-settings-update="render.pixelDensity" value="${render.pixelDensity}" /></label>
            <label class="field">Edge softness <input type="number" min="0" max="8" step="0.5" data-settings-update="render.edgeSoftness" value="${render.edgeSoftness}" /></label>
          </div>
        </section>
      </div>
    </section>
  `;
}

function elementPickerTemplate(state, picker, mediaLibrary, urlCache) {
  const mediaItems = state.media || [];
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Add element">
      <header class="modal-header">
        <div>
          <strong>Add element</strong>
          <small>Choose a source layer or an effect for this composition.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>

      <div class="element-modal-body">
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media layers</span></div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => elementMediaCardTemplate(item, mediaLibrary, urlCache)).join("") : `
              <div class="soft-note">Drop image or video files into the browser, or add them to the project folder.</div>
            `}
          </div>
        </section>

        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">videocam</span><span>Live input</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-add-element-camera>
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
          </div>
        </section>

        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${listGeneratorComponents().filter((generator) => generator.id !== "black").map((generator) => `
              <button type="button" class="element-card" data-add-element-generator="${esc(generator.id)}">
                ${icon("auto_awesome")}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
          <div class="element-grid compact-element-grid">
            ${listShaderComponents().map((shader) => `
              <button type="button" class="element-card" data-add-element-effect="${esc(shader.id)}">
                ${icon(effectIcon(shader.id))}
                <strong>${esc(shader.name)}</strong>
                <small>${esc(shader.category || "effect")}</small>
              </button>
            `).join("")}
          </div>
        </section>
      </div>
    </section>
  `;
}

function elementMediaCardTemplate(item, mediaLibrary, urlCache) {
  const imageUrl = item.type === "image" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="element-card media-element-card" data-add-element-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
      ${imageUrl
        ? `<img src="${esc(imageUrl)}" alt="" loading="lazy" />`
        : `<div class="media-picker-placeholder">${icon(item.type === "video" ? "movie" : "image")}</div>`}
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function mediaPickerTemplate(state, picker, mediaLibrary, urlCache) {
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel media-modal" role="dialog" aria-modal="true" aria-label="Choose media">
      <header class="modal-header">
        <div>
          <strong>Choose media</strong>
          <small>${state.media.length} file${state.media.length === 1 ? "" : "s"}</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <div class="media-picker-grid">
        ${state.media.length ? state.media.map((item) => mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache)).join("") : `
          <div class="soft-note">Drop image or video files into the browser, or add them to the project folder.</div>
        `}
      </div>
    </section>
  `;
}

function mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache) {
  const selected = item.id === currentMediaValue(picker, state);
  const imageUrl = item.type === "image" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="media-picker-card ${selected ? "is-selected" : ""}" data-pick-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
      ${imageUrl
        ? `<img src="${esc(imageUrl)}" alt="" loading="lazy" />`
        : `<div class="media-picker-placeholder">${icon(item.type === "video" ? "movie" : "image")}</div>`}
      <span>${esc(item.name)}</span>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function currentMediaValue(picker, state) {
  if (!picker?.path || !state) return "";
  const parts = picker.path.split(".");
  let cursor = state;
  for (const part of parts) {
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
  }
  return typeof cursor === "string" ? cursor : "";
}

function mediaPreviewUrl(id, mediaLibrary, urlCache) {
  if (urlCache.has(id)) return urlCache.get(id);
  const file = mediaLibrary.getFile(id);
  if (!file) return "";
  const url = URL.createObjectURL(file);
  urlCache.set(id, url);
  return url;
}

function scenePillTemplate(scene, state) {
  const selected = state.ui.selectedSceneId === scene.id;
  const compositions = sceneFingerprintCompositions(scene, state);
  return `
    <div class="composition-card-row">
      <button type="button" class="composition-card scene-card ${selected ? "is-selected" : ""}" data-select-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(compositions)}
        <span>${esc(scene.name)}</span>
      </button>
      <button type="button" class="composition-card-remove" data-delete-scene="${esc(scene.id)}" title="Remove" aria-label="Remove ${esc(scene.name)}">${icon("close")}</button>
    </div>
  `;
}

function liveScenePillTemplate(scene, state) {
  const selected = liveSelectedSceneId(state) === scene.id;
  const compositions = sceneFingerprintCompositions(scene, state);
  return `
    <button type="button" class="composition-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
      ${sceneFingerprintTemplate(compositions)}
      <span>${esc(scene.name)}</span>
    </button>
  `;
}

function liveInspectorTemplate(state) {
  const scene = getLiveSelectedScene(state);
  if (!scene) return emptyNote("No scenes");
  const compositions = liveSceneCompositions(scene, state);
  return `
    <div class="live-panel">
      <div class="live-scene-name">${esc(scene.name)}</div>
      <div class="live-composition-list">
        ${compositions.map((composition) => liveCompositionTemplate(composition, state)).join("") || emptyNote("No compositions")}
      </div>
    </div>
  `;
}

function liveCompositionTemplate(composition, state) {
  const view = createLiveCompositionView(composition, state);
  return `
    <article class="live-composition-card">
      <header class="live-composition-head">
        ${thumbnailTemplate(composition.thumbnail)}
        <strong>${esc(composition.name)}</strong>
      </header>
      ${liveUnifiedChainTemplate(view.chain, composition.id)}
    </article>
  `;
}

function liveUnifiedChainTemplate(chain, compositionId) {
  if (!chain?.length) return "";
  return `
    <div class="live-chain-list">
      ${chain.map((item, index) => liveChainItemTemplate(item, compositionId, index)).join("")}
    </div>
  `;
}

function liveChainItemTemplate(item, compositionId, index) {
  if (item.kind === "effect") {
    const component = getShaderComponent(item.componentId);
    return `
      <div class="live-chain-pass">
        <label>${icon(effectIcon(item.componentId))}<input type="checkbox" data-live-composition-id="${esc(compositionId)}" data-live-update="chain.${index}.enabled" ${item.enabled ? "checked" : ""} />${esc(component?.name || item.componentId)}</label>
        ${liveShaderParamControlsTemplate(component, item, compositionId, index)}
      </div>
    `;
  }
  return `
    <div class="live-chain-pass">
      <label>${icon(sourceTypeIcon(item.source?.type || "generator"))}<input type="checkbox" data-live-composition-id="${esc(compositionId)}" data-live-update="chain.${index}.enabled" ${item.enabled ? "checked" : ""} />${esc(item.name || item.componentId || "Layer")}</label>
      ${liveRangeTemplate("Opacity", compositionId, `chain.${index}.opacity`, item.opacity ?? 1)}
      <label class="field chain-param">Blend ${liveSelectValuesTemplate(compositionId, `chain.${index}.blend`, BLEND_MODES, item.blend || "normal")}</label>
    </div>
  `;
}

function liveShaderParamControlsTemplate(component, item, compositionId, index) {
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${component.params.map((param) => {
        const path = `chain.${index}.params.${param.id}`;
        const attrs = `data-live-composition-id="${esc(compositionId)}" data-live-update`;
        return liveParamControlTemplate(param, path, paramCurrentValue(component, item, param), attrs);
      }).join("")}
    </div>
  `;
}

function liveParamControlTemplate(param, path, value, attrs) {
  if (param.type === "boolean") {
    return `
      <label class="field inline-param">
        <span>${esc(param.label || param.id)}</span>
        <input type="checkbox" ${attrs}="${esc(path)}" ${value ? "checked" : ""} />
      </label>
    `;
  }
  if (param.type === "enum") {
    return `
      <label class="field chain-param">
        <span>${esc(param.label || param.id)}</span>
        <select ${attrs}="${esc(path)}">
          ${(param.values || []).map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  return `
    <label class="field range-field chain-param">
      <span><span>${esc(param.label || param.id)}</span><strong>${formatParamValue(value)}</strong></span>
      <input type="range" min="${param.min ?? 0}" max="${param.max ?? 1}" step="${param.step ?? 0.01}" ${attrs}="${esc(path)}" value="${value}" />
    </label>
  `;
}

function liveRangeTemplate(label, compositionId, path, value) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="0" max="1" step="0.01" data-live-composition-id="${esc(compositionId)}" data-live-update="${path}" value="${value}" />
    </label>
  `;
}

function liveSelectValuesTemplate(compositionId, path, values, value) {
  return `
    <select data-live-composition-id="${esc(compositionId)}" data-live-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function sceneFingerprintCompositions(scene, state) {
  const ids = [];
  for (const surface of scene.snapshot?.surfaces || []) {
    if (surface.compositionId && !ids.includes(surface.compositionId)) ids.push(surface.compositionId);
  }
  return ids
    .map((id) => state.compositions.find((composition) => composition.id === id))
    .filter(Boolean);
}

function sceneFingerprintTemplate(compositions) {
  if (!compositions.length) return `<div class="composition-card-empty">${icon("auto_awesome_motion")}</div>`;
  const withThumbs = compositions.filter((composition) => composition.thumbnail);
  if (!withThumbs.length) return `<div class="composition-card-empty">${icon("auto_awesome_motion")}</div>`;
  return `
    <div class="scene-fingerprint">
      ${withThumbs.slice(0, 5).map((composition, index) => `
        <img
          src="${esc(composition.thumbnail)}"
          alt=""
          loading="lazy"
          style="--fingerprint-index: ${index}; --fingerprint-count: ${withThumbs.length};"
        />
      `).join("")}
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

function getLiveSelectedScene(state) {
  const id = liveSelectedSceneId(state);
  return state.scenes.find((scene) => scene.id === id) || null;
}

function liveSelectedSceneId(state) {
  return state.ui?.live?.selectedSceneId || state.scenes[0]?.id || "";
}

function liveSceneCompositions(scene, state) {
  return sceneFingerprintCompositions(scene, state);
}

function sceneSurfaceSnapshot(scene, surfaceId) {
  return scene?.snapshot?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

function getSceneSurfaceView(surface, state) {
  const snapshot = sceneSurfaceSnapshot(getSelectedScene(state), surface.id);
  return snapshot ? { ...surface, ...snapshot } : surface;
}

function currentWorkspace(state) {
  return WORKSPACES.includes(state.ui?.workspace) ? state.ui.workspace : "scene";
}

function activeRenderCost(state) {
  const previewCost = Number(state.metrics.previewRenderCost);
  if (state.ui?.debugPreview && Number.isFinite(previewCost)) return previewCost;
  const outputCost = Number(state.metrics.renderCost);
  return Number.isFinite(outputCost) ? outputCost : 0;
}

function formatRenderCost(cost) {
  const percent = Math.max(0, Math.min(999, Number(cost) * 100 || 0));
  return `${percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function compositionAssignmentTemplate(path, compositions, value) {
  return `
    <div class="field composition-assignment-field">
      <span>Composition</span>
      <div class="composition-card-list assignment-card-list">
        ${compositions.map((composition) => {
          const selected = composition.id === value;
          return `
            <button type="button" class="composition-card assignment-card ${selected ? "is-selected" : ""}" data-set-composition="${esc(composition.id)}" data-composition-path="${esc(path)}">
              ${thumbnailTemplate(composition.thumbnail)}
              <span>${esc(composition.name)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
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

function setByPathCreate(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = Number.isNaN(Number(parts[i])) ? parts[i] : Number(parts[i]);
    const nextPart = parts[i + 1];
    if (cursor[part] === undefined) cursor[part] = Number.isNaN(Number(nextPart)) ? {} : [];
    cursor = cursor[part];
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

function pathForScene(state, scene) {
  return `scenes.${state.scenes.findIndex((item) => item.id === scene.id)}`;
}

function pathForComposition(state, composition) {
  return `compositions.${state.compositions.findIndex((item) => item.id === composition.id)}`;
}
