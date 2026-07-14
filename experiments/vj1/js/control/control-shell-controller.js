import { BLEND_MODES, VJ1, WORKSPACES } from "../constants.js";
import { compositionFrameMetrics } from "../domain/composition-frame.js";
import { applySceneSnapshotToState, createLiveCompositionView, createLiveRenderState, createSceneSnapshot, normalizeRenderSettings } from "../domain/models.js?v=projection-fit-1";
import { normalizeParamValue, RENDER_QUALITY_PARAM } from "../graph/component-schema.js?v=range-pair-1";
import { getGeneratorComponent, listGeneratorComponents } from "../graph/generator-registry.js?v=render-quality-2";
import { patchNodeDegree, planCompositorInputs, planPatchExecution, summarizeTextureBranches } from "../graph/patch-planner.js";
import { compileCompositionPatch } from "../graph/render-scheduler.js?v=hsv-alpha-key-1";
import { buildOutputUrl } from "../view-routing.js";
import { getShaderComponent, listShaderComponents } from "../shaders/shader-registry.js?v=hsv-alpha-key-1";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=thumbnail-fit-2";
import { frameFitViewport, resetViewport, zoomViewport } from "../output/preview-viewport.js";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js";
import { createHtmlCache, isInteractiveNode, isTextEditingNode, setClass, setText } from "./dom-utils.js";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js?v=view-icons-1";
import { effectIcon, emptyNote, esc, icon, paramRangePairTemplate, rangeTemplate, selectValuesTemplate, sourceTypeIcon, thumbnailTemplate } from "./template-utils.js?v=thumbnail-fit-2";

const MODEL_RENDER_MODES = ["surface", "wireframe", "surfaceWire", "points"];
const MEDIA_FIT_MODES = ["contain", "cover"];
const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];
const MODEL_SURFACE_COLOR_PARAM = { id: "surfaceColor", label: "Surface color", type: "color", defaultValue: "#dce1dcff" };
const MODEL_WIRE_COLOR_PARAM = { id: "wireColor", label: "Wire color", type: "color", defaultValue: "#141414dd" };
const MEDIA_FIT_PARAM = { id: "fit", label: "Fit", type: "enum", values: MEDIA_FIT_MODES, defaultValue: "contain" };
const MODEL_SOURCE_PARAMS = [
  RENDER_QUALITY_PARAM,
  { id: "renderMode", label: "Draw mode", type: "enum", values: MODEL_RENDER_MODES, defaultValue: "surface" },
  MODEL_SURFACE_COLOR_PARAM,
  MODEL_WIRE_COLOR_PARAM,
  { id: "rotationX", label: "Rotate X", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "rotationY", label: "Rotate Y", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "rotationZ", label: "Rotate Z", type: "number", min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 },
  { id: "modelScale", label: "Scale", type: "number", min: 0.1, max: 5, step: 0.01, defaultValue: 1 },
  { id: "spinX", label: "Spin X", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "spinY", label: "Spin Y", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "spinZ", label: "Spin Z", type: "number", min: -3, max: 3, step: 0.01, defaultValue: 0 },
  { id: "depth", label: "Depth scale", type: "number", min: 0.2, max: 3, step: 0.01, defaultValue: 1 },
  { id: "visibleDepth", label: "Visible depth", type: "number", min: 0.02, max: 1, step: 0.01, defaultValue: 1 },
  { id: "wireThickness", label: "Wire thickness", type: "number", min: 0.5, max: 12, step: 0.1, defaultValue: 1 },
  { id: "pointBudget", label: "Point budget", type: "number", min: 500, max: 50000, step: 500, defaultValue: 4000 },
];

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
  let sourceChoicePicker = null;
  let focusElementPickerSearch = false;
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
      if (reason.startsWith("color:")) {
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
    setClass(root, "has-project-open", hasOpenProject(state));
    setClass(root, "no-project-open", !hasOpenProject(state));
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

    refs.toggleOutputPlayback.addEventListener("click", () => {
      if (latestState.metrics.clients <= 0) return;
      store.update((draft) => {
        draft.global.playing = draft.global.playing === false;
      }, "toggle-output-playback");
    });

    refs.openSettings.addEventListener("click", () => {
      settingsOpen = true;
      mediaPicker = null;
      elementPicker = null;
      sourceChoicePicker = null;
      renderModal(latestState);
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);
    refs.closeProject?.addEventListener("click", closeProject);

    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!hasOpenProject(latestState)) return;
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

  async function closeProject() {
    await projectService.closeProject?.().catch((error) => setStatus(`Close error: ${error.message || error}`));
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
    const hasProject = hasOpenProject(state);
    const projectName = hasProject ? (state.project.name || state.project.folderName || "VJ1") : "No project open";
    const projectMeta = state.project.warnings?.[0] || (
      hasProject && state.project.folderName && state.project.folderName !== projectName
        ? state.project.folderName
        : ""
    );
    setText(refs.projectName, projectName);
    setText(refs.projectMeta, hasProject ? projectMeta : "Choose a folder to begin");
    setClass(refs.projectMeta, "is-hidden", hasProject && !projectMeta);
    setClass(refs.closeProject, "is-hidden", !hasProject);
    const outputConnected = state.metrics.clients > 0;
    const outputFps = outputConnected ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
    setClass(refs.outputStatus, "is-live", outputConnected);
    setText(refs.outputStatusText, outputConnected ? `${Math.round(outputFps)} fps` : "output");
    const renderCost = activeRenderCost(state);
    setClass(refs.renderCost, "is-hot", renderCost > 0.8);
    setText(refs.renderCostText, formatRenderCost(renderCost));
    const workMetric = activeWorkMetric(state, outputFps);
    setClass(refs.cpuTime, "is-hot", workMetric.cpuMs > 8.33);
    setText(refs.cpuTimeText, formatTimeMs(workMetric.cpuMs));
    refs.cpuTime.title = cpuTimeTitle(workMetric);
    setClass(refs.gpuTime, "is-hot", workMetric.gpuSupported && workMetric.gpuMs > 8.33);
    setText(refs.gpuTimeText, workMetric.gpuSupported ? formatTimeMs(workMetric.gpuMs) : "--");
    refs.gpuTime.title = gpuTimeTitle(workMetric);
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.toggleLabels, "is-active", state.global.showLabels !== false);
    const outputPlaying = state.global.playing !== false;
    refs.toggleOutputPlayback.disabled = !outputConnected;
    refs.toggleOutputPlayback.title = outputPlaying ? "Pause output" : "Play output";
    refs.toggleOutputPlayback.setAttribute("aria-label", refs.toggleOutputPlayback.title);
    setText(refs.toggleOutputPlayback.querySelector(".material-symbols-rounded"), outputPlaying ? "pause" : "play_arrow");
    setClass(refs.toggleOutputPlayback, "is-active", outputConnected && !outputPlaying);
    setClass(refs.blackout, "is-active", state.global.blackout);
    refs.undo.disabled = !state.ui.canUndo;
    refs.redo.disabled = !state.ui.canRedo;
    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      button.disabled = !hasProject;
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function renderProjectRail(state) {
    const hasProject = hasOpenProject(state);
    const workspace = currentWorkspace(state);
    const html = hasProject ? railToolsTemplate(state, workspace) : "";
    if (replaceHtmlIfChanged(refs.projectRail, html)) bindRailEvents();
  }

  function railToolsTemplate(state, workspace) {
    if (workspace === "compose") return compositionToolsTemplate(state);
    if (workspace === "canvas") return canvasToolsTemplate(state);
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

  function canvasToolsTemplate(state) {
    const canvases = canvasCompositions(state);
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">dashboard_customize</span><span>Canvas compositions</span></div>
        <div class="composition-card-list">
          ${canvases.map((composition) => compositionPillTemplate(composition, state)).join("") || emptyNote("Create a canvas composition")}
        </div>
        <button type="button" data-add-canvas-composition>${icon("add")} Add canvas</button>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">texture</span><span>Sampling</span></div>
        <div class="soft-note">Assign a surface to a canvas composition, then set its source rectangle here. Projection mapping still happens after this sample.</div>
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
        <div class="surface-pills" data-surface-reorder-list>
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
        <div class="rail-title"><span class="material-symbols-rounded">schema</span><span>Node Patch</span></div>
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
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      embeddedPreview.pause();
      if (replaceHtmlIfChanged(refs.studio, `
        <section class="studio-stage project-empty-stage">
          <div class="visual-frame is-empty" data-preview-host>
            ${projectEmptyTemplate()}
          </div>
        </section>
      `)) bindStudioEvents();
      return;
    }
    if (currentWorkspace(state) === "mapping") {
      embeddedPreview.pause();
      const html = mappingStudioTemplate(state);
      if (replaceHtmlIfChanged(refs.studio, html)) bindStudioEvents();
      return;
    }
    if (currentWorkspace(state) === "canvas") {
      embeddedPreview.pause();
      const html = canvasStudioTemplate(state);
      if (replaceHtmlIfChanged(refs.studio, html)) {
        bindStudioEvents();
        bindInputs(refs.studio, state);
      }
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
    if (currentWorkspace(state) === "canvas") return;
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
    setClass(handleButton, "is-active", state.global.mappingHandleMode !== "near");
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
    if (workspace === "mapping" || workspace === "canvas") return;
    const kind = workspace === "compose" ? "composition" : "preview";
    embeddedPreview.setState(workspace === "live" ? createLiveRenderState(state) : state, kind);
  }

  function renderInspector(state) {
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      replaceHtmlIfChanged(refs.inspector, "");
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
        "Nodes",
        mappingInspectorTemplate(selectedComposition, state)
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "canvas") {
      const selectedCanvas = selectedCanvasComposition(state);
      html = panelTemplate(
        "dashboard_customize",
        "Canvas",
        selectedCanvas ? canvasInspectorTemplate(selectedCanvas, state) : emptyNote("Create a canvas composition")
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
    refs.projectRail.querySelectorAll("[data-add-canvas-composition]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasComposition?.());
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
    refs.projectRail.querySelectorAll("[data-toggle-path]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePathFromButton(button, `toggle:${button.dataset.togglePath}`);
      });
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
    refs.projectRail.querySelectorAll("[data-surface-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        onReorder: (fromId, toId) => store.reorderSurfaces?.(fromId, toId),
      });
    });
    refs.projectRail.querySelectorAll("[data-remove-composition]").forEach((button) => {
      button.addEventListener("click", () => store.removeComposition(button.dataset.removeComposition));
    });
  }

  function renderModal(state) {
    const host = refs.modalHost;
    if (!host) return;
    if (!mediaPicker && !elementPicker && !sourceChoicePicker && !settingsOpen) {
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
    if (sourceChoicePicker) {
      if (!replaceHtmlIfChanged(host, sourceChoicePickerTemplate(state, sourceChoicePicker, mediaLibrary, mediaPreviewUrls))) return;
      host.querySelector("[data-close-modal]")?.addEventListener("click", closeSourceChoicePicker);
      host.querySelector(".modal-backdrop")?.addEventListener("click", closeSourceChoicePicker);
      bindElementPickerSearch(host);
      host.querySelectorAll("[data-pick-source-media]").forEach((button) => {
        button.addEventListener("click", () => {
          setSourceChoice({ type: "media", mediaId: button.dataset.pickSourceMedia || "" });
          closeSourceChoicePicker();
        });
      });
      host.querySelector("[data-pick-source-camera]")?.addEventListener("click", () => {
        setSourceChoice({ type: "camera" });
        closeSourceChoicePicker();
      });
      host.querySelector("[data-pick-source-black]")?.addEventListener("click", () => {
        setSourceChoice({ type: "black" });
        closeSourceChoicePicker();
      });
      host.querySelectorAll("[data-pick-source-generator]").forEach((button) => {
        button.addEventListener("click", () => {
          setSourceChoice({ type: "generator", generatorId: button.dataset.pickSourceGenerator || "testPattern" });
          closeSourceChoicePicker();
        });
      });
      return;
    }
    if (elementPicker) {
      if (!replaceHtmlIfChanged(host, elementPickerTemplate(state, elementPicker, mediaLibrary, mediaPreviewUrls))) return;
      host.querySelector("[data-close-modal]")?.addEventListener("click", closeElementPicker);
      host.querySelector(".modal-backdrop")?.addEventListener("click", closeElementPicker);
      bindElementPickerSearch(host);
      focusPendingElementPickerSearch(host);
      host.querySelectorAll("[data-add-element-media]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainSource(elementPicker.compositionId, {
            type: "media",
            mediaId: button.dataset.addElementMedia || "",
          });
          closeElementPicker();
        });
      });
      host.querySelector("[data-add-element-camera]")?.addEventListener("click", () => {
        activateElementPickerTarget();
        store.addChainSource(elementPicker.compositionId, { type: "camera" });
        closeElementPicker();
      });
      host.querySelector("[data-add-element-group]")?.addEventListener("click", () => {
        activateElementPickerTarget();
        store.addChainGroup(elementPicker.compositionId);
        closeElementPicker();
      });
      host.querySelectorAll("[data-add-element-generator]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainSource(elementPicker.compositionId, {
            type: "generator",
            generatorId: button.dataset.addElementGenerator || "testPattern",
          });
          closeElementPicker();
        });
      });
      host.querySelectorAll("[data-add-element-effect]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
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

  function bindElementPickerSearch(host) {
    const input = host.querySelector("[data-element-search]");
    if (!input) return;
    const applyFilter = () => filterElementPicker(host, input.value || "");
    input.addEventListener("input", applyFilter);
    applyFilter();
  }

  function filterElementPicker(host, value) {
    const query = normalizeSearchText(value);
    host.querySelectorAll("[data-element-search-card]").forEach((card) => {
      const haystack = normalizeSearchText(card.dataset.elementSearchCard || "");
      card.classList.toggle("is-search-hidden", !!query && !haystack.includes(query));
    });
    host.querySelectorAll("[data-element-section]").forEach((section) => {
      const cards = Array.from(section.querySelectorAll("[data-element-search-card]"));
      const visibleCount = cards.filter((card) => !card.classList.contains("is-search-hidden")).length;
      const empty = section.querySelector("[data-element-empty]");
      const sectionHidden = visibleCount <= 0;
      section.hidden = sectionHidden;
      section.classList.toggle("is-search-hidden", sectionHidden);
      if (empty) empty.hidden = true;
    });
    const sections = Array.from(host.querySelectorAll("[data-element-section]"));
    const hasVisibleSection = sections.some((section) => !section.hidden);
    const noResults = host.querySelector("[data-element-no-results]");
    if (noResults) noResults.hidden = hasVisibleSection || !query;
  }

  function focusPendingElementPickerSearch(host) {
    if (!focusElementPickerSearch) return;
    focusElementPickerSearch = false;
    requestAnimationFrame(() => {
      const input = host.querySelector("[data-element-search]");
      if (input && document.activeElement !== input) input.focus({ preventScroll: true });
    });
  }

  function normalizeSearchText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function openMediaPicker(path) {
    mediaPicker = { path };
    elementPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function closeMediaPicker() {
    mediaPicker = null;
    renderModal(latestState);
  }

  function openElementPicker(compositionId, selectedChainItemId = "") {
    elementPicker = { compositionId, selectedChainItemId };
    focusElementPickerSearch = true;
    mediaPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function activateElementPickerTarget() {
    if (elementPicker?.selectedChainItemId) store.selectChainItem(elementPicker.selectedChainItemId);
  }

  function closeElementPicker() {
    elementPicker = null;
    renderModal(latestState);
  }

  function openSourceChoicePicker(path) {
    sourceChoicePicker = { path };
    mediaPicker = null;
    elementPicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function closeSourceChoicePicker() {
    sourceChoicePicker = null;
    renderModal(latestState);
  }

  function setSourceChoice(source) {
    if (!sourceChoicePicker?.path) return;
    store.update((draft) => {
      const previous = getByPath(draft, sourceChoicePicker.path) || {};
      const next = { ...source };
      if (next.type === "generator" && previous.type === "generator" && previous.generatorId === next.generatorId && previous.params) {
        next.params = previous.params;
      }
      if (next.type === "media" && previous.type === "media" && previous.mediaId === next.mediaId) {
        next.start = previous.start;
        next.end = previous.end;
        next.speed = previous.speed;
      }
      setByPath(draft, sourceChoicePicker.path, next);
    }, `update:${sourceChoicePicker.path}`);
  }

  function closeSettings() {
    settingsOpen = false;
    renderModal(latestState);
  }

  function updateRenderSetting(input, reason) {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      setByPath(draft, input.dataset.settingsUpdate, readInputValue(input));
      draft.render = normalizeRenderSettings(draft.render);
      scaleMappingForRenderChange(draft, previousRender, draft.render);
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
      const previousRender = normalizeRenderSettings(draft.render);
      draft.render = normalizeRenderSettings({
        ...draft.render,
        frameWidth,
        frameHeight,
      });
      scaleMappingForRenderChange(draft, previousRender, draft.render);
    }, "render-preset");
  }

  function scaleMappingForRenderChange(draft, previousRender, nextRender) {
    const previous = normalizeRenderSettings(previousRender);
    const next = normalizeRenderSettings(nextRender);
    const sx = next.worldWidth / Math.max(1, previous.worldWidth);
    const sy = next.worldHeight / Math.max(1, previous.worldHeight);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    if (Math.abs(sx - 1) < 0.0001 && Math.abs(sy - 1) < 0.0001) return;
    const mapping = draft.mappings?.local;
    if (!Array.isArray(mapping?.surfaces)) return;
    for (const mappedSurface of mapping.surfaces) {
      if (!Array.isArray(mappedSurface.corners)) continue;
      mappedSurface.corners = mappedSurface.corners.map((corner) => ({
        x: Math.round((Number(corner.x) || 0) * sx * 1000) / 1000,
        y: Math.round((Number(corner.y) || 0) * sy * 1000) / 1000,
      }));
    }
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
      resetProjectMapping();
    });
    bindCanvasRectInteractions(refs.studio);
  }

  function bindInputs(scope, state) {
    scope.querySelectorAll("[data-video-trim]").forEach(bindVideoTrimControl);
    scope.querySelectorAll("[data-param-range]").forEach(bindParamRangeControl);
    scope.querySelectorAll("[data-color-param]").forEach(bindColorParamControl);
    scope.querySelectorAll("[data-update]").forEach((input) => {
      if (input.dataset.videoTrimInput || input.dataset.paramRangeInput) return;
      if (input.type === "range") {
        input.addEventListener("input", () => {
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
    scope.querySelectorAll("[data-set-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = button.dataset.setPath;
        const value = button.dataset.setValueType === "number"
          ? Number(button.dataset.setValue)
          : button.dataset.setValue;
        store.update((draft) => setByPath(draft, path, value), `update:${path}`);
      });
    });
    scope.querySelectorAll("[data-toggle-path]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePathFromButton(button, `toggle:${button.dataset.togglePath}`);
      });
    });
    scope.querySelectorAll("[data-live-update]").forEach((input) => {
      if (input.dataset.paramRangeInput) return;
      if (input.type === "range") {
        input.addEventListener("input", () => {
          updateLivePathFromInput(input, "scrub:live");
        });
        input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
        return;
      }
      input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
    });
    scope.querySelectorAll("[data-live-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleLivePathFromButton(button, "live:toggle");
      });
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
    scope.querySelectorAll("[data-open-source-choice]").forEach((button) => {
      button.addEventListener("click", () => openSourceChoicePicker(button.dataset.openSourceChoice));
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
      button.addEventListener("click", () => openElementPicker(
        button.dataset.compositionId || latestState.ui.selectedCompositionId,
        button.dataset.targetChainItem || ""
      ));
    });
    scope.querySelectorAll("[data-add-canvas-composition]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasComposition?.());
    });
    scope.querySelectorAll("[data-add-canvas-layer]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasLayer?.(button.dataset.canvasCompositionId || latestState.ui.selectedCompositionId));
    });
    scope.querySelectorAll("[data-add-source-rect]").forEach((button) => {
      button.addEventListener("click", () => addCanvasSourceRect(button.dataset.addSourceRect, button.dataset.canvasCompositionId));
    });
    scope.querySelectorAll("[data-remove-canvas-layer]").forEach((button) => {
      button.addEventListener("click", () => store.removeCanvasLayer?.(button.dataset.canvasCompositionId, button.dataset.removeCanvasLayer));
    });
    scope.querySelectorAll("[data-select-chain-item]").forEach((button) => {
      button.addEventListener("click", () => store.selectChainItem(button.dataset.selectChainItem));
    });
    scope.querySelectorAll("[data-remove-chain-item]").forEach((button) => {
      button.addEventListener("click", () => removeChainItem(button.dataset.compositionId, button.dataset.removeChainItem));
    });
    scope.querySelectorAll("[data-chain-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        itemSelector: ".chain-item-row[data-reorder-id]",
        dropSelector: "[data-reorder-id]",
        onReorder: (fromId, toId, position) => store.reorderChain(list.dataset.compositionId, fromId, toId, position),
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
        resetProjectMapping(button.dataset.resetSurfaceMapping);
      });
    });
    scope.querySelectorAll("[data-reset-mapping]").forEach((button) => {
      button.addEventListener("click", () => {
        resetProjectMapping();
      });
    });
  }

  function bindVideoTrimControl(control) {
    const startInput = control.querySelector("[data-video-trim-input='start']");
    const endInput = control.querySelector("[data-video-trim-input='end']");
    if (!startInput || !endInput) return;
    const onInput = (event) => {
      const role = event.currentTarget.dataset.videoTrimInput;
      updateVideoTrimFromInputs(control, role, `scrub:${event.currentTarget.dataset.update}`);
    };
    const onChange = (event) => {
      const role = event.currentTarget.dataset.videoTrimInput;
      updateVideoTrimFromInputs(control, role, `update:${event.currentTarget.dataset.update}`);
    };
    startInput.addEventListener("input", onInput);
    startInput.addEventListener("change", onChange);
    endInput.addEventListener("input", onInput);
    endInput.addEventListener("change", onChange);
    syncVideoTrimControl(control, Number(startInput.value) || 0, Number(endInput.value) || 0, Number(startInput.max) || 60);
  }

  function bindParamRangeControl(control) {
    const minInput = control.querySelector("[data-param-range-input='min']");
    const maxInput = control.querySelector("[data-param-range-input='max']");
    if (!minInput || !maxInput) return;
    const isLive = !!minInput.dataset.liveUpdate;
    const onInput = (event) => {
      const role = event.currentTarget.dataset.paramRangeInput;
      updateParamRangeFromInputs(control, role, isLive ? "scrub:live" : `scrub:${event.currentTarget.dataset.update}`);
    };
    const onChange = (event) => {
      const role = event.currentTarget.dataset.paramRangeInput;
      updateParamRangeFromInputs(control, role, isLive ? "live:update" : `update:${event.currentTarget.dataset.update}`);
    };
    minInput.addEventListener("input", onInput);
    minInput.addEventListener("change", onChange);
    maxInput.addEventListener("input", onInput);
    maxInput.addEventListener("change", onChange);
    syncParamRangeControl(control, Number(minInput.value), Number(maxInput.value));
  }

  function removeChainItem(compositionId, itemId) {
    store.update((draft) => {
      const composition = draft.compositions.find((item) => item.id === compositionId);
      if (!composition?.chain) return;
      const removed = removeChainItemFromChain(composition.chain, itemId, true);
      if (removed && draft.ui.selectedChainItemId === itemId) draft.ui.selectedChainItemId = firstChainItemId(composition.chain);
    }, "remove-chain-item");
  }

  function bindCanvasRectInteractions(scope) {
    scope.querySelectorAll("[data-canvas-source-rect]").forEach((rectEl) => {
      rectEl.addEventListener("pointerdown", (event) => startCanvasSourceRectDrag(event, rectEl));
      rectEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          store.selectSurface(rectEl.dataset.canvasSourceRect);
        }
      });
    });
  }

  function startCanvasSourceRectDrag(event, rectEl) {
    if (event.button !== 0) return;
    const board = rectEl.closest("[data-canvas-board]");
    const surfaceId = rectEl.dataset.canvasSourceRect;
    if (!board || !surfaceId) return;
    event.preventDefault();
    event.stopPropagation();
    rectEl.setPointerCapture?.(event.pointerId);
    store.selectSurface(surfaceId);

    const boardRect = board.getBoundingClientRect();
    const canvasWidth = Math.max(1, Number(board.dataset.canvasWidth) || boardRect.width || 1);
    const canvasHeight = Math.max(1, Number(board.dataset.canvasHeight) || boardRect.height || 1);
    const scaleX = canvasWidth / Math.max(1, boardRect.width || 1);
    const scaleY = canvasHeight / Math.max(1, boardRect.height || 1);
    const state = latestState;
    const surface = state.surfaces.find((item) => item.id === surfaceId);
    const startRect = clampSourceRect(surface?.sourceRect || createCanvasSourceRect(canvasWidth, canvasHeight), canvasWidth, canvasHeight);
    const mode = event.target?.dataset?.canvasRectHandle || "move";
    const startPointer = { x: event.clientX, y: event.clientY };
    rectEl.classList.add("is-dragging");

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const dx = (moveEvent.clientX - startPointer.x) * scaleX;
      const dy = (moveEvent.clientY - startPointer.y) * scaleY;
      const nextRect = resizeCanvasSourceRect(startRect, mode, dx, dy, canvasWidth, canvasHeight);
      applyCanvasSourceRect(surfaceId, nextRect, "scrub:canvas-source-rect");
    };

    const onEnd = (endEvent) => {
      rectEl.releasePointerCapture?.(event.pointerId);
      rectEl.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onEnd, true);
      const dx = (endEvent.clientX - startPointer.x) * scaleX;
      const dy = (endEvent.clientY - startPointer.y) * scaleY;
      const nextRect = resizeCanvasSourceRect(startRect, mode, dx, dy, canvasWidth, canvasHeight);
      applyCanvasSourceRect(surfaceId, nextRect, "update:canvas-source-rect");
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
  }

  function applyCanvasSourceRect(surfaceId, rect, reason) {
    store.update((draft) => {
      const surface = draft.surfaces.find((item) => item.id === surfaceId);
      if (!surface) return;
      surface.sourceRect = rect;
    }, reason);
  }

  function addCanvasSourceRect(surfaceId, canvasCompositionId) {
    const composition = latestState.compositions.find((item) => item.id === canvasCompositionId) || selectedCanvasComposition(latestState);
    const canvas = composition?.canvas || {};
    const canvasWidth = Math.max(1, Number(canvas.width) || 3840);
    const canvasHeight = Math.max(1, Number(canvas.height) || 2160);
    applyCanvasSourceRect(surfaceId, createCanvasSourceRect(canvasWidth, canvasHeight), "update:canvas-source-rect-add");
  }

  function resetProjectMapping(surfaceId = "") {
    store.update((draft) => {
      draft.mappings ||= {};
      const defaults = defaultProjectSurfaceMapping(draft.render, draft.surfaces);
      const existing = Array.isArray(draft.mappings.local?.surfaces) ? draft.mappings.local.surfaces : [];
      const existingById = new Map(existing.map((surface) => [surface.id || surface.name, surface]));
      const defaultById = new Map(defaults.map((surface) => [surface.id || surface.name, surface]));
      draft.mappings.local = {
        ...(draft.mappings.local || {}),
        surfaces: draft.surfaces.map((surface) => {
          const id = surface.id || surface.name;
          const fallback = defaultById.get(id);
          if (!surfaceId || id === surfaceId) return fallback;
          return existingById.get(id) || fallback;
        }).filter(Boolean),
      };
    }, surfaceId ? "reset-surface-mapping" : "reset-mapping");
  }

  function setStatus(message) {
    store.update((draft) => {
      draft.metrics.message = message;
    }, "status");
  }

  function updatePathFromInput(input, reason) {
    const path = input.dataset.update;
    store.update((draft) => {
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, readInputValue(input));
      if (currentWorkspace(draft) === "scene") {
        if (path.startsWith("scenes.")) {
          applySelectedSceneSnapshot(draft);
        } else if (path.startsWith("surfaces.")) {
          syncSelectedSceneSnapshot(draft);
        }
      }
    }, reason);
  }

  function bindColorParamControl(control) {
    const rgbInput = control.querySelector("[data-color-rgb]");
    const alphaInput = control.querySelector("[data-color-alpha]");
    rgbInput?.addEventListener("input", () => updateColorParamFromControl(control, `scrub:${control.dataset.colorPath}`));
    rgbInput?.addEventListener("change", () => updateColorParamFromControl(control, `color:${control.dataset.colorPath}`));
    alphaInput?.addEventListener("input", () => updateColorParamFromControl(control, `scrub:${control.dataset.colorPath}`));
    alphaInput?.addEventListener("change", () => updateColorParamFromControl(control, `color:${control.dataset.colorPath}`));
  }

  function updateColorParamFromControl(control, reason) {
    const path = control.dataset.colorPath;
    if (!path) return;
    const value = colorValueFromControl(control);
    store.update((draft) => {
      if (control.dataset.colorMode === "live") {
        const compositionId = control.dataset.liveCompositionId;
        if (!compositionId) return;
        draft.ui.live.compositionOverrides ||= {};
        const override = draft.ui.live.compositionOverrides[compositionId] ||= {};
        setByPathCreate(override, path, value);
        return;
      }
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, value);
      if (currentWorkspace(draft) === "scene") {
        if (path.startsWith("scenes.")) applySelectedSceneSnapshot(draft);
        else if (path.startsWith("surfaces.")) syncSelectedSceneSnapshot(draft);
      }
    }, reason);
  }

  function updateVideoTrimFromInputs(control, activeRole, reason) {
    const startInput = control.querySelector("[data-video-trim-input='start']");
    const endInput = control.querySelector("[data-video-trim-input='end']");
    const startPath = startInput?.dataset.update;
    const endPath = endInput?.dataset.update;
    if (!startInput || !endInput || !startPath || !endPath) return;
    const max = Math.max(0.01, Number(startInput.max) || Number(endInput.max) || 60);
    let start = clampNumberLocal(Number(startInput.value) || 0, 0, max);
    let end = clampNumberLocal(Number(endInput.value) || max, 0, max);
    if (start > end) {
      if (activeRole === "start") end = start;
      else start = end;
    }
    startInput.value = String(start);
    endInput.value = String(end);
    syncVideoTrimControl(control, start, end, max);
    const keepImplicitEnd = control.dataset.videoTrimImplicitEnd === "true" && activeRole !== "end";
    store.update((draft) => {
      setByPath(draft, startPath, roundTrimTime(start));
      setByPath(draft, endPath, keepImplicitEnd ? 0 : roundTrimTime(end));
    }, reason);
  }

  function updateParamRangeFromInputs(control, activeRole, reason) {
    const minInput = control.querySelector("[data-param-range-input='min']");
    const maxInput = control.querySelector("[data-param-range-input='max']");
    if (!minInput || !maxInput) return;
    const minPath = minInput.dataset.update || minInput.dataset.liveUpdate;
    const maxPath = maxInput.dataset.update || maxInput.dataset.liveUpdate;
    if (!minPath || !maxPath) return;
    const lowerBound = Number(minInput.min);
    const upperBound = Number(minInput.max);
    let minValue = clampNumberLocal(Number(minInput.value), lowerBound, upperBound);
    let maxValue = clampNumberLocal(Number(maxInput.value), lowerBound, upperBound);
    if (minValue > maxValue) {
      if (activeRole === "min") maxValue = minValue;
      else minValue = maxValue;
    }
    minInput.value = String(minValue);
    maxInput.value = String(maxValue);
    syncParamRangeControl(control, minValue, maxValue);
    store.update((draft) => {
      if (minInput.dataset.liveUpdate) {
        const compositionId = minInput.dataset.liveCompositionId;
        if (!compositionId) return;
        draft.ui.live.compositionOverrides ||= {};
        const override = draft.ui.live.compositionOverrides[compositionId] ||= {};
        setByPathCreate(override, minPath, minValue);
        setByPathCreate(override, maxPath, maxValue);
        return;
      }
      setByPathCreate(draft, minPath, minValue);
      setByPathCreate(draft, maxPath, maxValue);
      if (currentWorkspace(draft) === "scene") {
        if (minPath.startsWith("scenes.")) applySelectedSceneSnapshot(draft);
        else if (minPath.startsWith("surfaces.")) syncSelectedSceneSnapshot(draft);
      }
    }, reason);
  }

  function togglePathFromButton(button, reason) {
    const path = button.dataset.togglePath;
    if (!path) return;
    const nextValue = button.dataset.toggleValue !== "true";
    store.update((draft) => {
      setByPath(draft, path, nextValue);
      if (currentWorkspace(draft) === "scene") {
        if (path.startsWith("scenes.")) {
          applySelectedSceneSnapshot(draft);
        } else if (path.startsWith("surfaces.")) {
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

  function toggleLivePathFromButton(button, reason) {
    const compositionId = button.dataset.liveCompositionId;
    const path = button.dataset.liveToggle;
    if (!compositionId || !path) return;
    const nextValue = button.dataset.toggleValue !== "true";
    store.update((draft) => {
      draft.ui.live.compositionOverrides ||= {};
      const override = draft.ui.live.compositionOverrides[compositionId] ||= {};
      setByPathCreate(override, path, nextValue);
    }, reason);
  }

  return { mount };
}

function compositionPillTemplate(composition, state) {
  const selected = state.ui.selectedCompositionId === composition.id;
  const fallbackIcon = composition.type === "canvas" ? "dashboard_customize" : "account_tree";
  return `
    <div class="composition-card-row">
      <button type="button" class="composition-card ${selected ? "is-selected" : ""}" data-select-composition="${esc(composition.id)}">
        ${thumbnailTemplate(composition.thumbnail, fallbackIcon)}
        <span>${esc(composition.name)}</span>
      </button>
      <button type="button" class="composition-card-remove" data-remove-composition="${esc(composition.id)}" title="Remove" aria-label="Remove ${esc(composition.name)}" ${state.compositions.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
    </div>
  `;
}

function canvasStudioTemplate(state) {
  const composition = selectedCanvasComposition(state);
  if (!composition) {
    return `
      <section class="canvas-stage">
        <div class="project-empty">
          <span class="material-symbols-rounded">dashboard_customize</span>
          <h2>Canvas composition</h2>
          <p>Create a canvas composition to place existing compositions on a large source canvas.</p>
          <button type="button" class="primary" data-add-canvas-composition>${icon("add")} Add canvas</button>
        </div>
      </section>
    `;
  }
  const canvas = composition.canvas || { width: 3840, height: 2160, layers: [] };
  const width = Math.max(1, Number(canvas.width) || 3840);
  const height = Math.max(1, Number(canvas.height) || 2160);
  const assignedSurfaces = state.surfaces.filter((surface) => surface.compositionId === composition.id);
  return `
    <section class="canvas-stage">
      <div class="canvas-board-shell">
        <div class="canvas-board-meta">
          <strong>${esc(composition.name)}</strong>
          <span>${Math.round(width)} x ${Math.round(height)}</span>
        </div>
        <div class="canvas-board" data-canvas-board data-canvas-width="${width}" data-canvas-height="${height}" style="aspect-ratio: ${width} / ${height};">
          <div class="canvas-grid"></div>
          ${(canvas.layers || []).map((layer, index) => canvasLayerRectTemplate(layer, index, state, width, height)).join("")}
          ${assignedSurfaces.map((surface) => canvasSurfaceRectTemplate(surface, state, width, height)).join("")}
          ${!(canvas.layers || []).length ? `<div class="canvas-empty-note">Add layers from existing compositions</div>` : ""}
        </div>
      </div>
    </section>
  `;
}

function canvasLayerRectTemplate(layer, index, state, canvasWidth, canvasHeight) {
  const source = state.compositions.find((composition) => composition.id === layer.compositionId);
  const left = percent(layer.x, canvasWidth);
  const top = percent(layer.y, canvasHeight);
  const width = percent(layer.width, canvasWidth);
  const height = percent(layer.height, canvasHeight);
  return `
    <div
      class="canvas-layer-rect"
      style="left:${left}%; top:${top}%; width:${width}%; height:${height}%; --layer-index:${index};"
      title="${esc(layer.name || source?.name || "Layer")}"
    >
      <span>${esc(source?.name || layer.name || "Missing composition")}</span>
      <small>${Math.round(layer.x || 0)}, ${Math.round(layer.y || 0)} / ${Math.round(layer.width || 0)} x ${Math.round(layer.height || 0)}</small>
    </div>
  `;
}

function canvasSurfaceRectTemplate(surface, state, canvasWidth, canvasHeight) {
  const rect = clampSourceRect(surface.sourceRect || createCanvasSourceRect(canvasWidth, canvasHeight), canvasWidth, canvasHeight);
  const left = percent(rect.x, canvasWidth);
  const top = percent(rect.y, canvasHeight);
  const width = percent(rect.width, canvasWidth);
  const height = percent(rect.height, canvasHeight);
  const selected = state.ui.selectedSurfaceId === surface.id;
  return `
    <div
      role="button"
      tabindex="0"
      class="canvas-surface-rect ${selected ? "is-selected" : ""}"
      style="left:${left}%; top:${top}%; width:${width}%; height:${height}%;"
      data-canvas-source-rect="${esc(surface.id)}"
      data-select-surface="${esc(surface.id)}"
      title="Sample rect for ${esc(surface.name)}"
    >
      <span>${esc(surface.name)}</span>
      <i data-canvas-rect-handle="nw" aria-hidden="true"></i>
      <i data-canvas-rect-handle="ne" aria-hidden="true"></i>
      <i data-canvas-rect-handle="sw" aria-hidden="true"></i>
      <i data-canvas-rect-handle="se" aria-hidden="true"></i>
    </div>
  `;
}

function percent(value, total) {
  return Math.max(0, Math.min(100, (Number(value) || 0) / Math.max(1, Number(total) || 1) * 100));
}

function createCanvasSourceRect(canvasWidth, canvasHeight) {
  const width = Math.max(64, Math.round(canvasWidth * 0.25));
  const height = Math.max(64, Math.round(canvasHeight * 0.25));
  return {
    x: Math.round((canvasWidth - width) * 0.5),
    y: Math.round((canvasHeight - height) * 0.5),
    width,
    height,
  };
}

function clampSourceRect(rect = {}, canvasWidth = 1, canvasHeight = 1) {
  const minSize = 16;
  const width = Math.max(minSize, Math.min(canvasWidth, Number(rect.width) || Math.min(960, canvasWidth)));
  const height = Math.max(minSize, Math.min(canvasHeight, Number(rect.height) || Math.min(540, canvasHeight)));
  return {
    x: Math.round(Math.max(0, Math.min(canvasWidth - width, Number(rect.x) || 0))),
    y: Math.round(Math.max(0, Math.min(canvasHeight - height, Number(rect.y) || 0))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function resizeCanvasSourceRect(startRect, mode, dx, dy, canvasWidth, canvasHeight) {
  const minSize = 16;
  const rect = { ...startRect };
  if (mode === "move") {
    rect.x += dx;
    rect.y += dy;
    return clampSourceRect(rect, canvasWidth, canvasHeight);
  }
  if (mode.includes("w")) {
    rect.x += dx;
    rect.width -= dx;
  }
  if (mode.includes("e")) {
    rect.width += dx;
  }
  if (mode.includes("n")) {
    rect.y += dy;
    rect.height -= dy;
  }
  if (mode.includes("s")) {
    rect.height += dy;
  }
  if (rect.width < minSize) {
    if (mode.includes("w")) rect.x = startRect.x + startRect.width - minSize;
    rect.width = minSize;
  }
  if (rect.height < minSize) {
    if (mode.includes("n")) rect.y = startRect.y + startRect.height - minSize;
    rect.height = minSize;
  }
  return clampSourceRect(rect, canvasWidth, canvasHeight);
}

function canvasInspectorTemplate(composition, state) {
  const base = pathForComposition(state, composition);
  const canvas = composition.canvas || { width: 3840, height: 2160, layers: [] };
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(composition.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
      </div>
      <div class="field-pair">
        <label class="field">Width <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.width" value="${canvas.width}" /></label>
        <label class="field">Height <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.height" value="${canvas.height}" /></label>
      </div>
      <section class="canvas-inspector-section">
        <div class="rail-title"><span class="material-symbols-rounded">layers</span><span>Layers</span></div>
        <button type="button" data-add-canvas-layer data-canvas-composition-id="${esc(composition.id)}">${icon("add")} Add layer</button>
        <div class="canvas-layer-list">
          ${(canvas.layers || []).map((layer, index) => canvasLayerEditorTemplate(layer, index, composition, state, `${base}.canvas.layers.${index}`)).join("") || emptyNote("Add a layer to place an existing composition on this canvas.")}
        </div>
      </section>
      <section class="canvas-inspector-section">
        <div class="rail-title"><span class="material-symbols-rounded">select_all</span><span>Surface sample rects</span></div>
        <div class="canvas-surface-list">
          ${state.surfaces.map((surface) => canvasSurfaceEditorTemplate(surface, composition, state)).join("")}
        </div>
      </section>
    </article>
  `;
}

function canvasLayerEditorTemplate(layer, index, composition, state, base) {
  return `
    <article class="canvas-layer-editor">
      <header>
        <strong>${esc(layer.name || `Layer ${index + 1}`)}</strong>
        <button type="button" class="icon-buttonish" data-canvas-composition-id="${esc(composition.id)}" data-remove-canvas-layer="${esc(layer.id)}" title="Remove layer" aria-label="Remove ${esc(layer.name || `Layer ${index + 1}`)}">${icon("close")}</button>
      </header>
      <label class="field">Source ${compositionSelectTemplate(`${base}.compositionId`, state, layer.compositionId, composition.id)}</label>
      <div class="field-pair">
        <label class="field">X <input type="number" step="1" data-update="${base}.x" value="${Number(layer.x) || 0}" /></label>
        <label class="field">Y <input type="number" step="1" data-update="${base}.y" value="${Number(layer.y) || 0}" /></label>
      </div>
      <div class="field-pair">
        <label class="field">W <input type="number" min="1" step="1" data-update="${base}.width" value="${Number(layer.width) || 1}" /></label>
        <label class="field">H <input type="number" min="1" step="1" data-update="${base}.height" value="${Number(layer.height) || 1}" /></label>
      </div>
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, layer.blend || "normal")}</label>
        ${rangeTemplate("Opacity", `${base}.opacity`, layer.opacity ?? 1)}
      </div>
    </article>
  `;
}

function canvasSurfaceEditorTemplate(surface, composition, state) {
  const surfaceBase = pathForSurface(state, surface);
  const assigned = surface.compositionId === composition.id;
  const rect = surface.sourceRect || {};
  return `
    <article class="canvas-surface-editor ${assigned ? "is-assigned" : ""}">
      <header>
        <strong>${esc(surface.name)}</strong>
        ${assigned
          ? `<button type="button" data-add-source-rect="${esc(surface.id)}" data-canvas-composition-id="${esc(composition.id)}">${icon("crop_free")} Add rect</button>`
          : `<button type="button" data-set-composition="${esc(composition.id)}" data-composition-path="${surfaceBase}.compositionId">${icon("ads_click")} Use canvas</button>`}
      </header>
      ${assigned ? `
        <div class="field-pair">
          <label class="field">X <input type="number" min="0" step="1" data-update="${surfaceBase}.sourceRect.x" value="${Number(rect.x) || 0}" /></label>
          <label class="field">Y <input type="number" min="0" step="1" data-update="${surfaceBase}.sourceRect.y" value="${Number(rect.y) || 0}" /></label>
        </div>
        <div class="field-pair">
          <label class="field">W <input type="number" min="1" step="1" data-update="${surfaceBase}.sourceRect.width" value="${Number(rect.width) || 960}" /></label>
          <label class="field">H <input type="number" min="1" step="1" data-update="${surfaceBase}.sourceRect.height" value="${Number(rect.height) || 540}" /></label>
        </div>
      ` : ""}
    </article>
  `;
}

function compositionSelectTemplate(path, state, value, excludeId = "") {
  const options = state.compositions.filter((composition) => composition.id !== excludeId && composition.type !== "canvas");
  return `
    <select data-update="${esc(path)}">
      <option value="">None</option>
      ${options.map((composition) => `<option value="${esc(composition.id)}" ${composition.id === value ? "selected" : ""}>${esc(composition.name)}</option>`).join("")}
    </select>
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
  if (node.role === "group" || node.kind === "group") return "account_tree";
  if (node.role === "output") return "output";
  return "schema";
}

function nodeLabel(node) {
  if (node.role === "source" && node.params?.generatorId) return node.params.generatorId;
  if (node.role === "group" || node.kind === "group") return node.state?.group?.name || "Group";
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

function enableToggleButton({ path = "", livePath = "", compositionId = "", value = true, iconName = "power_settings_new", label = "" }) {
  const enabled = value !== false;
  const toggleAttrs = livePath
    ? `data-live-composition-id="${esc(compositionId)}" data-live-toggle="${esc(livePath)}"`
    : `data-toggle-path="${esc(path)}"`;
  const action = enabled ? "Disable" : "Enable";
  return `
    <button type="button" class="enable-toggle ${enabled ? "is-enabled" : ""}" ${toggleAttrs} data-toggle-value="${enabled ? "true" : "false"}" title="${action} ${esc(label)}" aria-label="${action} ${esc(label)}">
      ${icon(enabled ? iconName : "hide_source")}
    </button>
  `;
}

function sceneSurfacePillTemplate(surface, state) {
  const sceneSurface = getSceneSurfaceView(surface, state);
  const composition = state.compositions.find((item) => item.id === sceneSurface.compositionId);
  const enabled = surface.enabled !== false;
  return selectablePillTemplate({
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: enabled ? "crop_free" : "hide_source",
    label: surface.name,
    meta: composition?.name || "None",
    togglePath: `${pathForSurface(state, surface)}.enabled`,
    toggleValue: enabled,
    removeAction: "data-remove-surface",
    removeDisabled: state.surfaces.length <= 1,
  });
}

function selectablePillTemplate({ selected, action, id, iconName, label, meta, togglePath = "", toggleValue = true, removeAction = "", removeDisabled = false }) {
  return `
    <div class="list-row ${togglePath ? "has-enable-toggle" : ""}" data-reorder-id="${esc(id)}">
      ${togglePath ? enableToggleButton({
        path: togglePath,
        value: toggleValue,
        iconName,
        label,
      }) : ""}
      <button type="button" class="list-select ${selected ? "is-selected" : ""}" ${action}="${esc(id)}">
        <span>${esc(label)}</span>
        <small>${esc(meta)}</small>
      </button>
      ${removeAction ? `<button type="button" class="list-remove" ${removeAction}="${esc(id)}" title="Remove" aria-label="Remove ${esc(label)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>` : ""}
    </div>
  `;
}

function compositionTemplate(composition, state) {
  const base = pathForComposition(state, composition);
  if (composition.type === "canvas") {
    return `
      <article class="sculpt-card">
        <div class="sculpt-head">
          <input type="text" data-update="${base}.name" value="${esc(composition.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
        <div class="soft-note">This is a canvas composition. Use the Canvas workspace to place layers and set surface sample rectangles.</div>
      </article>
    `;
  }
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(composition.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
      </div>
      ${compositionFrameControlsTemplate(composition, state, base)}
      ${compositionUnifiedChainTemplate(composition, state, base)}
    </article>
  `;
}

function compositionFrameControlsTemplate(composition, state, base) {
  const metrics = compositionFrameMetrics(state.render || {}, composition);
  const megapixels = (metrics.width * metrics.height / 1000000).toFixed(2);
  const shapeOptions = [
    ["landscape", "Landscape"],
    ["portrait", "Portrait"],
    ["square", "Square"],
  ];
  const scaleOptions = [0.5, 1, 2];
  return `
    <section class="composition-frame-controls">
      <div class="rail-title"><span class="material-symbols-rounded">aspect_ratio</span><span>Frame</span></div>
      <div class="segmented-pills composition-option-grid" role="group" aria-label="Composition frame shape">
        ${shapeOptions.map(([value, label]) => `
          <button type="button" class="${metrics.frameShape === value ? "is-selected" : ""}" data-set-path="${base}.frameShape" data-set-value="${value}" aria-pressed="${metrics.frameShape === value}">${label}</button>
        `).join("")}
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">high_quality</span><span>Resolution scale</span></div>
      <div class="segmented-pills composition-option-grid" role="group" aria-label="Composition resolution scale">
        ${scaleOptions.map((value) => `
          <button type="button" class="${metrics.resolutionScale === value ? "is-selected" : ""}" data-set-path="${base}.resolutionScale" data-set-value="${value}" data-set-value-type="number" aria-pressed="${metrics.resolutionScale === value}">${value}×</button>
        `).join("")}
      </div>
      <div class="composition-frame-summary">
        <span>${metrics.baseWidth} × ${metrics.baseHeight} frame</span>
        <strong>${metrics.width} × ${metrics.height}</strong>
        <small>${metrics.effectiveScale}× effective · ${megapixels} MP</small>
      </div>
    </section>
  `;
}

function compositionUnifiedChainTemplate(composition, state, ownerPath) {
  const selected = selectedChainItemSelection(composition, state);
  return `
    <div class="chain-column">
      <section class="chain-list-section">
        <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Chain</span></div>
        <div class="composition-chain-list" data-chain-reorder-list data-composition-id="${esc(composition.id)}">
          ${chainItemsTemplate(composition.chain || [], composition, state, `${ownerPath}.chain`, 0, true)}
        </div>
        <button type="button" class="chain-add-button" data-open-element-picker data-composition-id="${esc(composition.id)}" title="Add element" aria-label="Add element">${icon("add")}</button>
      </section>
      <section class="chain-selected-section">
        ${selected ? selectedChainItemTemplate(selected.item, composition, state, selected.path) : emptyNote("Select a chain item")}
      </section>
    </div>
  `;
}

function chainItemsTemplate(chain, composition, state, base, depth = 0, topLevel = false) {
  if (!chain?.length) return depth ? `<div class="soft-note chain-group-empty">Group is empty</div>` : "";
  return chain.map((item, index) => chainItemRowTemplate(item, composition, state, index, `${base}.${index}`, depth, topLevel ? chain.length : null)).join("");
}

function chainItemRowTemplate(item, composition, state, index, base, depth = 0, topLevelLength = null) {
  const selected = state.ui.selectedChainItemId === item.id;
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const label = chainItemLabel(item, media);
  const iconName = chainItemIcon(item);
  const kindLabel = item.kind === "source" ? item.source?.type || "source" : item.kind === "group" ? `${item.chain?.length || 0} item group` : "effect";
  const canRemove = item.kind === "group" || depth > 0 || topLevelLength === null || topLevelLength > 1;
  return `
    <div class="chain-item-block ${item.kind === "group" ? "is-group" : ""}" style="--chain-depth: ${depth};">
      <div class="chain-item-row ${selected ? "is-selected" : ""}" data-reorder-id="${esc(item.id)}">
        ${enableToggleButton({
          path: `${base}.enabled`,
          value: item.enabled !== false,
          iconName,
          label,
        })}
        <button type="button" class="chain-item-select" data-select-chain-item="${esc(item.id)}">
          <span>${esc(label)}</span>
          <small>${esc(kindLabel)}</small>
        </button>
        <button type="button" class="chain-item-remove" data-composition-id="${esc(composition.id)}" data-remove-chain-item="${esc(item.id)}" title="Remove" aria-label="Remove ${esc(label)}" ${canRemove ? "" : "disabled"}>${icon("close")}</button>
      </div>
      ${item.kind === "group" ? `
        <div class="chain-group-drop-zone" data-reorder-id="${esc(item.id)}" data-drop-position="inside" title="Drop inside ${esc(label)}" aria-label="Drop inside ${esc(label)}"></div>
        ${!item.collapsed ? `<div class="chain-group-children" data-reorder-id="${esc(item.id)}" data-drop-position="inside">${chainItemsTemplate(item.chain || [], composition, state, `${base}.chain`, depth + 1)}</div>` : ""}
        <div class="chain-group-drop-zone is-after" data-reorder-id="${esc(item.id)}" data-drop-position="after" title="Drop after ${esc(label)}" aria-label="Drop after ${esc(label)}"></div>
      ` : ""}
    </div>
  `;
}

const SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS = false;

function selectedChainItemTemplate(item, composition, state, base) {
  if (item.kind === "source") return sourceChainItemTemplate(item, state, base);
  if (item.kind === "group") return groupChainItemTemplate(item, composition, base);
  const component = getShaderComponent(item.componentId);
  return `
    <section class="chain-item-editor">
      <div class="rail-title"><span class="material-symbols-rounded">${effectIcon(item.componentId)}</span><span>${esc(component?.name || item.componentId)}</span></div>
      ${shaderParamControlsTemplate(component, item, base)}
      ${component?.spatial && SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS ? effectTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function groupChainItemTemplate(item, composition, base) {
  return `
    <section class="chain-item-editor">
      <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>${esc(item.name || "Group")}</span></div>
      <label class="field">Name <input type="text" data-update="${base}.name" value="${esc(item.name || "Group")}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" /></label>
      <label class="field inline-param">
        <span>Collapsed</span>
        <input type="checkbox" data-update="${base}.collapsed" ${item.collapsed ? "checked" : ""} />
      </label>
      <button type="button" class="chain-add-button" data-open-element-picker data-composition-id="${esc(composition.id)}" data-target-chain-item="${esc(item.id)}" title="Add element to group" aria-label="Add element to group">${icon("add")}</button>
      <div class="soft-note">Use the preview handles to move, scale, or rotate the group as one unit.</div>
    </section>
  `;
}

function sourceChainItemTemplate(item, state, base) {
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const displayName = sourceChainItemDisplayName(item, media);
  return `
    <section class="chain-item-editor">
      <div class="rail-title"><span class="material-symbols-rounded">${sourceIcon(item.source)}</span><span>${esc(displayName)}</span></div>
      <label class="field">Name <input type="text" data-update="${base}.name" value="${esc(displayName)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" /></label>
      ${sourcePickerTemplate(item, state, base)}
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend)}</label>
        ${rangeTemplate("Opacity", `${base}.opacity`, item.opacity)}
      </div>
      ${SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS ? sourceTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function sourceTransformControlsTemplate(item, base) {
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

function selectedChainItemSelection(composition, state) {
  const selected = findChainItemSelection(composition.chain || [], state.ui.selectedChainItemId, `${pathForComposition(state, composition)}.chain`);
  return selected || firstChainItemSelection(composition.chain || [], `${pathForComposition(state, composition)}.chain`);
}

function sourcePickerTemplate(composition, state, base) {
  const source = composition.source || {};
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      <div class="field">
        <span>Source</span>
        <button type="button" class="source-choice-button" data-open-source-choice="${esc(`${base}.source`)}">
          ${icon(sourceIcon(source))}
          <span>
            <strong>${esc(sourceTitle(source, media))}</strong>
            <small>${esc(sourceSubtitle(source, media))}</small>
          </span>
          ${icon("chevron_right")}
        </button>
      </div>
      ${source.type === "generator" ? generatorParamControlsTemplate(`${base}.source`, source) : ""}
      ${source.type === "media" && !isModelMediaSource(source, media) ? mediaSourceFitControlsTemplate(`${base}.source`, source) : ""}
      ${source.type === "media" && isVideoMediaSource(source, media) ? videoSourceControlsTemplate(`${base}.source`, source, media) : ""}
      ${source.type === "media" && isModelMediaSource(source, media) ? modelSourceControlsTemplate(`${base}.source`, source) : ""}
      ${source.type === "camera" ? `<div class="soft-note">Using the portal camera feed.</div>` : ""}
      ${source.type === "black" ? `<div class="soft-note">Black source selected.</div>` : ""}
    </div>
  `;
}

function mediaSourceFitControlsTemplate(base, source = {}) {
  return `
    ${rangeTemplate("Render quality", `${base}.params.renderQuality`, source.params?.renderQuality ?? 0.5, 0, 1, 0.01)}
    <label class="field chain-param">Fit ${selectValuesTemplate(`${base}.params.fit`, MEDIA_FIT_MODES, source.params?.fit || "contain")}</label>
  `;
}

function sourceIcon(source = {}) {
  if (source.type === "generator") return generatorIcon(source.generatorId || "testPattern");
  if (source.type === "media") return isModelMediaSource(source) ? "deployed_code" : "perm_media";
  if (source.type === "camera") return "photo_camera";
  if (source.type === "black") return "radio_button_unchecked";
  return sourceTypeIcon(source.type || "generator");
}

function sourceTitle(source = {}, media = null) {
  if (source.type === "generator") return getGeneratorComponent(source.generatorId || "testPattern").label || getGeneratorComponent(source.generatorId || "testPattern").name;
  if (source.type === "media") return media?.name || source.mediaId || "Media";
  if (source.type === "camera") return "Live camera";
  if (source.type === "black") return "Black";
  return "Choose source";
}

function sourceSubtitle(source = {}, media = null) {
  if (source.type === "generator") return "Generator";
  if (source.type === "media") return media?.type === "model" || isModelMediaSource(source) ? "3D model" : media?.type ? `Media ${media.type}` : "Media";
  if (source.type === "camera") return "Portal camera feed";
  if (source.type === "black") return "Empty black source";
  return "Source";
}

function sourceChainItemDisplayName(item = {}, media = null) {
  if (!item.name || isGenericLayerName(item.name)) return sourceTitle(item.source || {}, media);
  return item.name;
}

function chainItemLabel(item = {}, media = null) {
  if (item.kind === "source") return sourceChainItemDisplayName(item, media);
  if (item.kind === "group") return item.name || "Group";
  return item.name || item.componentId || "Effect";
}

function chainItemIcon(item = {}) {
  if (item.kind === "source") return sourceIcon(item.source || {});
  if (item.kind === "group") return "account_tree";
  return effectIcon(item.componentId);
}

function findChainItemSelection(chain = [], id = "", base = "chain") {
  if (!Array.isArray(chain) || !id) return null;
  for (let index = 0; index < chain.length; index++) {
    const item = chain[index];
    const path = `${base}.${index}`;
    if (item.id === id) return { item, path };
    const nested = item.kind === "group" ? findChainItemSelection(item.chain || [], id, `${path}.chain`) : null;
    if (nested) return nested;
  }
  return null;
}

function firstChainItemSelection(chain = [], base = "chain") {
  if (!Array.isArray(chain) || !chain.length) return null;
  return { item: chain[0], path: `${base}.0` };
}

function firstChainItemId(chain = []) {
  if (!Array.isArray(chain) || !chain.length) return "";
  return chain[0]?.id || "";
}

function removeChainItemFromChain(chain = [], itemId = "", topLevel = false) {
  if (!Array.isArray(chain) || !itemId) return false;
  const index = chain.findIndex((item) => item.id === itemId);
  if (index >= 0) {
    if (topLevel && chain.length <= 1) return false;
    chain.splice(index, 1);
    return true;
  }
  for (const item of chain) {
    if (item.kind === "group" && removeChainItemFromChain(item.chain || [], itemId, false)) return true;
  }
  return false;
}

function isGenericLayerName(value) {
  return /^Layer(?:\s+\d+)?$/i.test(String(value || "").trim());
}

function videoSourceControlsTemplate(base, source = {}, media = null) {
  const trim = videoTrimValues(source, media);
  return `
    <div class="video-source-controls">
      <div class="rail-title"><span class="material-symbols-rounded">content_cut</span><span>Movie segment</span></div>
      ${videoTrimTemplate(base, trim)}
      ${rangeTemplate("Movie speed", `${base}.speed`, source.speed ?? 1, 0, 4, 0.01)}
    </div>
  `;
}

function videoTrimTemplate(base, trim) {
  const startPercent = trim.max ? (trim.start / trim.max) * 100 : 0;
  const endPercent = trim.max ? (trim.end / trim.max) * 100 : 100;
  return `
    <div
      class="video-trim-control"
      data-video-trim
      data-video-trim-implicit-end="${trim.implicitEnd ? "true" : "false"}"
      style="--trim-start: ${startPercent.toFixed(3)}%; --trim-end: ${endPercent.toFixed(3)}%;"
    >
      <div class="video-trim-labels">
        <span>Start <strong data-video-trim-label="start">${formatTrimTime(trim.start)}</strong></span>
        <span>End <strong data-video-trim-label="end">${formatTrimTime(trim.end)}</strong></span>
      </div>
      <div class="video-trim-slider">
        <div class="video-trim-track" aria-hidden="true"></div>
        <input
          type="range"
          min="0"
          max="${trim.max}"
          step="0.01"
          value="${trim.start}"
          data-update="${base}.start"
          data-video-trim-input="start"
          aria-label="Movie segment start"
        />
        <input
          type="range"
          min="0"
          max="${trim.max}"
          step="0.01"
          value="${trim.end}"
          data-update="${base}.end"
          data-video-trim-input="end"
          aria-label="Movie segment end"
        />
      </div>
    </div>
  `;
}

function videoTrimValues(source = {}, media = null) {
  const duration = Number(media?.duration) > 0 ? Number(media.duration) : 0;
  const start = Math.max(0, Number(source.start) || 0);
  const explicitEnd = Math.max(0, Number(source.end) || 0);
  const max = Math.max(duration, explicitEnd, start, 60);
  const end = explicitEnd > start ? explicitEnd : max;
  return {
    start: roundTrimTime(Math.min(start, max)),
    end: roundTrimTime(Math.min(Math.max(end, start), max)),
    max: roundTrimTime(max),
    implicitEnd: !(explicitEnd > start),
  };
}

function isVideoMediaSource(source = {}, media = null) {
  if (media?.type === "video") return true;
  return /\.(mp4|m4v|mov|webm|ogv)$/i.test(String(source.mediaId || ""));
}

function isModelMediaSource(source = {}, media = null) {
  if (media?.type === "model") return true;
  return /\.(stl|obj)$/i.test(String(source.mediaId || ""));
}

function modelSourceControlsTemplate(base, source = {}) {
  const params = source.params || {};
  return `
    <div class="model-source-controls">
      <div class="rail-title"><span class="material-symbols-rounded">deployed_code</span><span>3D model</span></div>
      ${rangeTemplate("Render quality", `${base}.params.renderQuality`, params.renderQuality ?? 0.5, 0, 1, 0.01)}
      <label class="field chain-param">Draw mode ${selectValuesTemplate(`${base}.params.renderMode`, MODEL_RENDER_MODES, params.renderMode || "surface")}</label>
      ${colorParamControlTemplate(MODEL_SURFACE_COLOR_PARAM, `${base}.params.surfaceColor`, params.surfaceColor || MODEL_SURFACE_COLOR_PARAM.defaultValue)}
      ${colorParamControlTemplate(MODEL_WIRE_COLOR_PARAM, `${base}.params.wireColor`, params.wireColor || MODEL_WIRE_COLOR_PARAM.defaultValue)}
      <div class="model-param-list">
        ${rangeTemplate("Rotate X", `${base}.params.rotationX`, params.rotationX || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Rotate Y", `${base}.params.rotationY`, params.rotationY || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Rotate Z", `${base}.params.rotationZ`, params.rotationZ || 0, -3.14, 3.14, 0.01)}
        ${rangeTemplate("Scale", `${base}.params.modelScale`, params.modelScale ?? 1, 0.1, 5, 0.01)}
        ${rangeTemplate("Spin X", `${base}.params.spinX`, params.spinX || 0, -3, 3, 0.01)}
        ${rangeTemplate("Spin Y", `${base}.params.spinY`, params.spinY || 0, -3, 3, 0.01)}
        ${rangeTemplate("Spin Z", `${base}.params.spinZ`, params.spinZ || 0, -3, 3, 0.01)}
        ${rangeTemplate("Depth scale", `${base}.params.depth`, params.depth ?? 1, 0.2, 3, 0.01)}
        ${rangeTemplate("Visible depth", `${base}.params.visibleDepth`, params.visibleDepth ?? 1, 0.02, 1, 0.01)}
        ${rangeTemplate("Wire thickness", `${base}.params.wireThickness`, params.wireThickness ?? 1, 0.5, 12, 0.1)}
        ${rangeTemplate("Point budget", `${base}.params.pointBudget`, params.pointBudget ?? 4000, 500, 50000, 500)}
      </div>
    </div>
  `;
}

function generatorParamControlsTemplate(base, source = {}) {
  const component = getGeneratorComponent(source.generatorId || "testPattern");
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${base}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, { params: source.params || {} }, param),
      })}
    </div>
  `;
}

function generatorIcon(id) {
  return {
    fireflies: "flare",
    eyeball: "visibility",
    swayingTrees: "forest",
    waves: "waves",
    noise: "grain",
    plasma: "blur_on",
    gradient: "gradient",
    anatomy: "accessibility_new",
    terrainFlyover: "landscape",
    bezierStrokes: "gesture",
    shadertoyBaseWarp: "auto_awesome_mosaic",
    seascape: "water",
    paintDrips: "format_color_fill",
    cloudyTunnel: "blur_circular",
    cherenkovVolume: "bubble_chart",
    biomineLite: "biotech",
    checker: "grid_view",
    testPattern: "featured_video",
  }[id] || "auto_awesome";
}

function sceneSurfaceTemplate(surface, state) {
  const scene = getSelectedScene(state);
  const surfaceBase = pathForSurface(state, surface);
  const sceneIndex = scene ? state.scenes.findIndex((item) => item.id === scene.id) : -1;
  const surfaceIndex = scene?.snapshot?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasSceneSurface = sceneIndex >= 0 && surfaceIndex >= 0;
  const sceneSurface = hasSceneSurface ? scene.snapshot.surfaces[surfaceIndex] : null;
  const sceneBase = `scenes.${sceneIndex}.snapshot.surfaces.${surfaceIndex}`;
  const assignedComposition = state.compositions.find((composition) => composition.id === (sceneSurface?.compositionId || surface.compositionId));
  const rectBase = hasSceneSurface ? `${sceneBase}.sourceRect` : `${surfaceBase}.sourceRect`;
  const sourceRect = sceneSurface?.sourceRect || surface.sourceRect || {};
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${surfaceBase}.name" value="${esc(surface.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
      </div>
      <div class="surface-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Scene assignment</span></div>
      ${hasSceneSurface ? `
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        ${compositionAssignmentTemplate(`${sceneBase}.compositionId`, state.compositions, sceneSurface.compositionId)}
        <label class="field">Projection fit ${selectValuesTemplate(`${sceneBase}.projectionFit`, PROJECTION_FIT_MODES, sceneSurface.projectionFit || "cover")}</label>
        ${assignedComposition?.type === "canvas" ? surfaceSourceRectTemplate(rectBase, sourceRect) : ""}
      ` : `<div class="soft-note">Capture a scene to store composition assignments for this surface.</div>`}
    </article>
  `;
}

function surfaceSourceRectTemplate(base, rect = {}) {
  return `
    <div class="canvas-surface-editor is-assigned">
      <header><strong>Canvas sample rect</strong><small>source pixels</small></header>
      <div class="field-pair">
        <label class="field">X <input type="number" min="0" step="1" data-update="${base}.x" value="${Number(rect.x) || 0}" /></label>
        <label class="field">Y <input type="number" min="0" step="1" data-update="${base}.y" value="${Number(rect.y) || 0}" /></label>
      </div>
      <div class="field-pair">
        <label class="field">W <input type="number" min="1" step="1" data-update="${base}.width" value="${Number(rect.width) || 960}" /></label>
        <label class="field">H <input type="number" min="1" step="1" data-update="${base}.height" value="${Number(rect.height) || 540}" /></label>
      </div>
    </div>
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
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${basePath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, pass, param),
      })}
    </div>
  `;
}

function visibleParamControls(params = []) {
  return (params || []).filter((param) => param?.id !== "seed");
}

function paramControlsTemplate(params = [], {
  pathFor = (param) => param.id,
  valueFor = (param) => param.defaultValue,
  attrs = "data-update",
} = {}) {
  const visible = visibleParamControls(params);
  const byPair = new Map();
  for (const param of visible) {
    if (param.ui === "range-pair" && param.rangePair) {
      const pair = byPair.get(param.rangePair) || {};
      pair[param.rangeRole] = param;
      byPair.set(param.rangePair, pair);
    }
  }
  return visible.map((param) => {
    if (param.ui !== "range-pair" || !param.rangePair) {
      return paramControlTemplate(param, pathFor(param), valueFor(param), attrs);
    }
    if (param.rangeRole === "max") return "";
    const pair = byPair.get(param.rangePair);
    if (!pair?.min || !pair?.max) return paramControlTemplate(param, pathFor(param), valueFor(param), attrs);
    return paramRangePairTemplate({
      minParam: pair.min,
      maxParam: pair.max,
      minPath: pathFor(pair.min),
      maxPath: pathFor(pair.max),
      minValue: valueFor(pair.min),
      maxValue: valueFor(pair.max),
      attrs,
    });
  }).join("");
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
  if (param.type === "color") return colorParamControlTemplate(param, path, value, attrs);
  const logarithmic = param.scale === "log" && Number(param.min) > 0 && Number(param.max) > Number(param.min);
  const sliderMin = logarithmic ? 0 : param.min ?? 0;
  const sliderMax = logarithmic ? 1 : param.max ?? 1;
  const sliderStep = logarithmic ? 0.001 : param.step ?? 0.01;
  const safeValue = clampNumberLocal(Number(value), Number(param.min), Number(param.max));
  const sliderValue = logarithmic
    ? Math.log(safeValue / Number(param.min)) / Math.log(Number(param.max) / Number(param.min))
    : value;
  const scaleAttrs = logarithmic
    ? `data-number-scale="log" data-value-min="${param.min}" data-value-max="${param.max}"`
    : "";
  return `
    <label class="field range-field chain-param">
      <span>${esc(param.label || param.id)}</span>
      <input type="range" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" ${scaleAttrs} ${attrs}="${esc(path)}" value="${sliderValue}" />
    </label>
  `;
}

function colorParamControlTemplate(param, path, value, attrs = "data-update") {
  const mode = attrs.includes("data-live-update") ? "live" : "state";
  const liveCompositionMatch = /data-live-composition-id="([^"]*)"/.exec(attrs);
  const liveCompositionId = liveCompositionMatch?.[1] || "";
  const rgba = normalizeColorHex(value || param.defaultValue || "#ffffffff");
  const rgb = rgba.slice(0, 7);
  const alpha = colorAlphaFromHex(rgba);
  return `
    <div class="field color-param chain-param" data-color-param data-color-mode="${mode}" data-color-path="${esc(path)}" ${liveCompositionId ? `data-live-composition-id="${esc(liveCompositionId)}"` : ""}>
      <span>${esc(param.label || param.id)}</span>
      <div class="color-param-row">
        <input type="color" data-color-rgb value="${esc(rgb)}" aria-label="${esc(param.label || param.id)} color" />
        <input type="range" min="0" max="1" step="0.01" data-color-alpha value="${alpha}" aria-label="${esc(param.label || param.id)} alpha" />
      </div>
    </div>
  `;
}

function paramCurrentValue(component, pass, param) {
  const values = {
    ...(pass.params && typeof pass.params === "object" ? pass.params : {}),
  };
  if (param.id === "amount" && values.amount === undefined) values.amount = pass.amount;
  return normalizeParamValue(param, values[param.id]);
}

function projectEmptyTemplate() {
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
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">high_quality</span><span>Composition upscaling</span></div>
          <label class="settings-toggle">
            <span>Enable upscaling pipeline</span>
            <input type="checkbox" data-settings-update="render.upscaling.enabled" ${render.upscaling.enabled ? "checked" : ""} />
          </label>
          <label class="field range-field">
            <span>Internal render amount · ${Math.round(render.upscaling.amount * 100)}%</span>
            <input type="range" min="0.35" max="1" step="0.01" data-settings-update="render.upscaling.amount" value="${render.upscaling.amount}" />
          </label>
          <div class="soft-note">Renders each chain composition at this fraction, then applies one fast edge-aware upscale before projection.</div>
        </section>
        <section class="element-section">
          <div class="rail-title"><span class="material-symbols-rounded">grain</span><span>Post processing</span></div>
          <label class="settings-toggle">
            <span>Grayscale</span>
            <input type="checkbox" data-settings-update="render.postProcessing.grayscaleEnabled" ${render.postProcessing.grayscaleEnabled ? "checked" : ""} />
          </label>
          <label class="field range-field">
            <span>Grayscale amount · ${Math.round(render.postProcessing.grayscaleAmount * 100)}%</span>
            <input type="range" min="0" max="1" step="0.05" data-settings-update="render.postProcessing.grayscaleAmount" value="${render.postProcessing.grayscaleAmount}" />
          </label>
          <label class="settings-toggle">
            <span>Monochrome noise</span>
            <input type="checkbox" data-settings-update="render.postProcessing.noiseEnabled" ${render.postProcessing.noiseEnabled ? "checked" : ""} />
          </label>
          <label class="field range-field">
            <span>Noise amount · ${Math.round(render.postProcessing.noiseAmount * 1000) / 10}%</span>
            <input type="range" min="0" max="0.2" step="0.005" data-settings-update="render.postProcessing.noiseAmount" value="${render.postProcessing.noiseAmount}" />
          </label>
          <div class="soft-note">These filters run at the composition’s full target resolution after upscaling.</div>
        </section>
      </div>
    </section>
  `;
}

function sourceChoicePickerTemplate(state, picker, mediaLibrary, urlCache) {
  const source = currentSourceValue(picker, state);
  const mediaItems = state.media || [];
  const generators = listGeneratorComponents().filter((generator) => generator.id !== "black");
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Choose source">
      <header class="modal-header">
        <div>
          <strong>Choose source</strong>
          <small>Pick one source for this element.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="Search media and generators" autocomplete="off" />
      </label>

      <div class="element-modal-body">
        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => sourceMediaCardTemplate(item, source, mediaLibrary, urlCache)).join("") : `
              <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${generators.map((generator) => `
              <button type="button" class="element-card ${source.type === "generator" && source.generatorId === generator.id ? "is-selected" : ""}" data-pick-source-generator="${esc(generator.id)}" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
                ${icon(generatorIcon(generator.id))}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching generators.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">input</span><span>Other sources</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card ${source.type === "camera" ? "is-selected" : ""}" data-pick-source-camera data-element-search-card="live camera portal camera feed video input">
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
            <button type="button" class="element-card ${source.type === "black" ? "is-selected" : ""}" data-pick-source-black data-element-search-card="black empty blank source">
              ${icon("radio_button_unchecked")}
              <strong>Black</strong>
              <small>Empty black source</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching sources.</div>
        </section>
        <div class="soft-note" data-element-no-results hidden>No matching sources.</div>
      </div>
    </section>
  `;
}

function sourceMediaCardTemplate(item, source, mediaLibrary, urlCache) {
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  const selected = source.type === "media" && source.mediaId === item.id;
  return `
    <button type="button" class="element-card media-element-card ${selected ? "is-selected" : ""}" data-pick-source-media="${esc(item.id)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function elementPickerTemplate(state, picker, mediaLibrary, urlCache) {
  const mediaItems = state.media || [];
  const generators = listGeneratorComponents().filter((generator) => generator.id !== "black");
  const effects = listShaderComponents();
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel element-modal" role="dialog" aria-modal="true" aria-label="Add element">
      <header class="modal-header">
        <div>
          <strong>Add element</strong>
          <small>Choose a source or an effect for this composition.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>

      <label class="element-search-field">
        ${icon("search")}
        <input type="search" data-element-search placeholder="Search media, generators, effects" autocomplete="off" />
      </label>

      <div class="element-modal-body">
        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">perm_media</span><span>Media</span></div>
          <div class="element-grid media-element-grid">
            ${mediaItems.length ? mediaItems.map((item) => elementMediaCardTemplate(item, mediaLibrary, urlCache)).join("") : `
              <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
            `}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching media.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">videocam</span><span>Live input</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-add-element-camera data-element-search-card="live camera portal camera feed video input">
              ${icon("photo_camera")}
              <strong>Live camera</strong>
              <small>Portal camera feed</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching live inputs.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Structure</span></div>
          <div class="element-grid compact-element-grid">
            <button type="button" class="element-card" data-add-element-group data-element-search-card="group folder chain nested structure">
              ${icon("account_tree")}
              <strong>Group</strong>
              <small>nested chain</small>
            </button>
          </div>
          <div class="soft-note" data-element-empty hidden>No matching structure elements.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
          <div class="element-grid compact-element-grid">
            ${generators.map((generator) => `
              <button type="button" class="element-card" data-add-element-generator="${esc(generator.id)}" data-element-search-card="${esc(elementSearchText(generator.id, generator.label, generator.name, generator.category, "generator"))}">
                ${icon(generatorIcon(generator.id))}
                <strong>${esc(generator.label || generator.name)}</strong>
                <small>generator</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching generators.</div>
        </section>

        <section class="element-section" data-element-section>
          <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
          <div class="element-grid compact-element-grid">
            ${effects.map((shader) => `
              <button type="button" class="element-card" data-add-element-effect="${esc(shader.id)}" data-element-search-card="${esc(elementSearchText(shader.id, shader.name, shader.category, "effect"))}">
                ${icon(effectIcon(shader.id))}
                <strong>${esc(shader.name)}</strong>
                <small>${esc(shader.category || "effect")}</small>
              </button>
            `).join("")}
          </div>
          <div class="soft-note" data-element-empty hidden>No matching effects.</div>
        </section>
        <div class="soft-note" data-element-no-results hidden>No matching elements.</div>
      </div>
    </section>
  `;
}

function elementMediaCardTemplate(item, mediaLibrary, urlCache) {
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="element-card media-element-card" data-add-element-media="${esc(item.id)}" data-element-search-card="${esc(elementSearchText(item.id, item.name, item.type, item.path, "media"))}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function elementSearchText(...parts) {
  return parts.filter(Boolean).join(" ").toLowerCase();
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
          <div class="soft-note">Drop image, video, or 3D model files into the browser, or add them to the project folder.</div>
        `}
      </div>
    </section>
  `;
}

function mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache) {
  const selected = item.id === currentMediaValue(picker, state);
  const previewUrl = item.type === "image" || item.type === "video" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="media-picker-card ${selected ? "is-selected" : ""}" data-pick-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
      ${previewUrl
        ? mediaPreviewElementTemplate(item, previewUrl)
        : `<div class="media-picker-placeholder">${icon(mediaTypeIcon(item.type))}</div>`}
      <span>${esc(item.name)}</span>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function mediaPreviewElementTemplate(item, previewUrl) {
  return item.type === "video"
    ? `<video src="${esc(previewUrl)}" muted playsinline preload="metadata"></video>`
    : `<img src="${esc(previewUrl)}" alt="" loading="lazy" />`;
}

function mediaTypeIcon(type = "") {
  if (type === "video") return "movie";
  if (type === "model") return "deployed_code";
  return "image";
}

function currentMediaValue(picker, state) {
  if (!picker?.path || !state) return "";
  const cursor = getByPath(state, picker.path);
  return typeof cursor === "string" ? cursor : "";
}

function currentSourceValue(picker, state) {
  if (!picker?.path || !state) return {};
  const source = getByPath(state, picker.path);
  return source && typeof source === "object" ? source : {};
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
      ${chain.map((item, index) => liveChainItemTemplate(item, compositionId, index, `chain.${index}`)).join("")}
    </div>
  `;
}

function liveChainItemTemplate(item, compositionId, index, path = `chain.${index}`) {
  if (item.kind === "effect") {
    const component = getShaderComponent(item.componentId);
    const label = component?.name || item.componentId;
    return `
      <div class="live-chain-pass">
        <div class="live-chain-title">
          ${enableToggleButton({
            livePath: `${path}.enabled`,
            compositionId,
            value: item.enabled !== false,
            iconName: effectIcon(item.componentId),
            label,
          })}
          <span>${esc(label)}</span>
        </div>
        ${liveShaderParamControlsTemplate(component, item, compositionId, path)}
      </div>
    `;
  }
  if (item.kind === "group") {
    const label = item.name || "Group";
    return `
      <div class="live-chain-pass live-chain-group">
        <div class="live-chain-title">
          ${enableToggleButton({
            livePath: `${path}.enabled`,
            compositionId,
            value: item.enabled !== false,
            iconName: "account_tree",
            label,
          })}
          <span>${esc(label)}</span>
        </div>
        ${item.chain?.length ? `<div class="live-chain-list">${item.chain.map((child, childIndex) => liveChainItemTemplate(child, compositionId, childIndex, `${path}.chain.${childIndex}`)).join("")}</div>` : ""}
      </div>
    `;
  }
  const label = sourceChainItemDisplayName(item);
  const iconName = sourceIcon(item.source || {});
  return `
    <div class="live-chain-pass">
      <div class="live-chain-title">
        ${enableToggleButton({
          livePath: `${path}.enabled`,
          compositionId,
          value: item.enabled !== false,
          iconName,
          label,
        })}
        <span>${esc(label)}</span>
      </div>
      ${liveRangeTemplate("Opacity", compositionId, `${path}.opacity`, item.opacity ?? 1)}
      <label class="field chain-param">Blend ${liveSelectValuesTemplate(compositionId, `${path}.blend`, BLEND_MODES, item.blend || "normal")}</label>
      ${liveSourceParamControlsTemplate(item, compositionId, path)}
    </div>
  `;
}

function liveShaderParamControlsTemplate(component, item, compositionId, itemPath) {
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, item, param),
        attrs: liveParamAttrs(compositionId),
      })}
    </div>
  `;
}

function liveSourceParamControlsTemplate(item, compositionId, itemPath) {
  const params = sourceLiveParams(item.source || {});
  if (!params.length) return "";
  const values = {
    ...(item.source?.params && typeof item.source.params === "object" ? item.source.params : {}),
    ...(item.params && typeof item.params === "object" ? item.params : {}),
  };
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => normalizeParamValue(param, values[param.id]),
        attrs: liveParamAttrs(compositionId),
      })}
    </div>
  `;
}

function sourceLiveParams(source = {}) {
  if (source.type === "generator") return getGeneratorComponent(source.generatorId || "testPattern").params || [];
  if (source.type === "media") {
    if (isModelMediaSource(source)) return MODEL_SOURCE_PARAMS;
    return [RENDER_QUALITY_PARAM, MEDIA_FIT_PARAM];
  }
  return [];
}

function liveParamAttrs(compositionId) {
  return `data-live-composition-id="${esc(compositionId)}" data-live-update`;
}

function liveRangeTemplate(label, compositionId, path, value) {
  return `
    <label class="field range-field chain-param">
      <span>${esc(label)}</span>
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
    if (surface.enabled === false) continue;
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

function canvasCompositions(state) {
  return (state.compositions || []).filter((composition) => composition.type === "canvas");
}

function selectedCanvasComposition(state) {
  return canvasCompositions(state).find((composition) => composition.id === state.ui.selectedCompositionId)
    || canvasCompositions(state)[0]
    || null;
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

function hasOpenProject(state) {
  return !!state?.project?.folderName;
}

function activeRenderCost(state) {
  const previewCost = Number(state.metrics.previewRenderCost);
  if (state.ui?.debugPreview && Number(state.metrics.previewFps) > 0 && Number.isFinite(previewCost)) return previewCost;
  const outputCost = Number(state.metrics.renderCost);
  return Number.isFinite(outputCost) ? outputCost : 0;
}

function activeWorkMetric(state, outputFps = 0) {
  const previewFps = Math.max(0, Number(state.metrics.previewFps) || 0);
  if (state.ui?.debugPreview && previewFps > 0) {
    return {
      fps: previewFps,
      cpuMs: Math.max(0, Number(state.metrics.previewFrameMs) || 0),
      gpuMs: Math.max(0, Number(state.metrics.previewGpuMs) || 0),
      gpuSupported: state.metrics.previewGpuSupported === true,
      profile: state.metrics.previewProfile || null,
      source: "preview",
    };
  }
  return {
    fps: outputFps,
    cpuMs: Math.max(0, Number(state.metrics.frameMs) || 0),
    gpuMs: Math.max(0, Number(state.metrics.gpuMs) || 0),
    gpuSupported: state.metrics.gpuSupported === true,
    profile: state.metrics.profile || null,
    source: "output",
  };
}

function compositionRenderTime(profile) {
  const value = Number(profile?.compositionWallMs ?? profile?.compositionMs);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function formatTimeMs(ms) {
  const value = Math.max(0, Number(ms) || 0);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
}

function frameTimeFromFps(fps) {
  const value = Number(fps);
  return Number.isFinite(value) && value > 0 ? 1000 / value : 0;
}

function cpuTimeTitle(metric) {
  if (!(Number(metric?.fps) > 0)) return "CPU render work: no active renderer sample";
  const interval = frameTimeFromFps(metric.fps);
  const lines = [
    `CPU render work: ${formatTimeMs(metric.cpuMs)} (${metric.source})`,
    `Frame interval: ${formatTimeMs(interval)} from ${Math.round(metric.fps)} fps`,
  ];
  const profile = metric.profile;
  if (!profile) return lines.join("\n");
  const compositionMs = compositionRenderTime(profile);
  const sampledTotal = Math.max(0, Number(profile.totalMs) || 0);
  const renders = Math.max(0, Math.round(Number(profile.compositionRenders) || 0));
  const cacheHits = Math.max(0, Math.round(Number(profile.compositionCacheHits) || 0));
  const stageRenders = Math.max(0, Math.round(Number(profile.stageRenders) || 0));
  const stageCacheHits = Math.max(0, Math.round(Number(profile.stageCacheHits) || 0));
  const slowest = (profile.passSamples || [])
    .filter((sample) => sample?.type === "composition")
    .slice()
    .sort((a, b) => (Number(b.ms) || 0) - (Number(a.ms) || 0))
    .slice(0, 3);
  lines.push(`Sampled composition: ${formatTimeMs(compositionMs)}`);
  lines.push(`Sampled other work: ${formatTimeMs(Math.max(0, sampledTotal - compositionMs))}`);
  lines.push(`${renders} rendered, ${cacheHits} composition cache hit${cacheHits === 1 ? "" : "s"}, ${stageRenders} stage render${stageRenders === 1 ? "" : "s"}, ${stageCacheHits} stage reuse${stageCacheHits === 1 ? "" : "s"}`);
  for (const sample of slowest) {
    lines.push(`${sample.compositionName || sample.compositionId || "Composition"}: ${formatTimeMs(sample.ms)}`);
  }
  return lines.join("\n");
}

function gpuTimeTitle(metric) {
  if (!metric?.gpuSupported) return "GPU render work: timer queries unavailable in this browser/GPU";
  return `GPU average query: ${formatTimeMs(metric.gpuMs)} (${metric.source})\nRolling average of completed non-overlapping WebGL timer queries; not a frame duration`;
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

function getByPath(target, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = target;
  for (const part of parts) {
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
  }
  return cursor;
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
  if (input.type === "range" || input.type === "number") {
    const value = Number(input.value);
    if (input.dataset.numberScale === "log") {
      const min = Number(input.dataset.valueMin);
      const max = Number(input.dataset.valueMax);
      if (min > 0 && max > min) return min * Math.pow(max / min, clampNumberLocal(value, 0, 1));
    }
    return value;
  }
  return input.value;
}

function colorValueFromControl(control) {
  const rgb = normalizeColorHex(control.querySelector("[data-color-rgb]")?.value || "#ffffff").slice(0, 7);
  const alpha = clampNumberLocal(Number(control.querySelector("[data-color-alpha]")?.value) || 0, 0, 1);
  return `${rgb}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

function normalizeColorHex(value = "#ffffffff") {
  const text = String(value || "").trim();
  const match = /^#?([a-f\d]{6})([a-f\d]{2})?$/i.exec(text);
  if (!match) return "#ffffffff";
  return `#${match[1].toLowerCase()}${(match[2] || "ff").toLowerCase()}`;
}

function colorAlphaFromHex(value = "#ffffffff") {
  const rgba = normalizeColorHex(value);
  return parseInt(rgba.slice(7, 9), 16) / 255;
}

function syncVideoTrimControl(control, start, end, max) {
  const safeMax = Math.max(0.01, Number(max) || 60);
  const safeStart = clampNumberLocal(Number(start) || 0, 0, safeMax);
  const safeEnd = clampNumberLocal(Number(end) || safeMax, safeStart, safeMax);
  control.style.setProperty("--trim-start", `${((safeStart / safeMax) * 100).toFixed(3)}%`);
  control.style.setProperty("--trim-end", `${((safeEnd / safeMax) * 100).toFixed(3)}%`);
  const startLabel = control.querySelector("[data-video-trim-label='start']");
  const endLabel = control.querySelector("[data-video-trim-label='end']");
  if (startLabel) startLabel.textContent = formatTrimTime(safeStart);
  if (endLabel) endLabel.textContent = formatTrimTime(safeEnd);
}

function syncParamRangeControl(control, minValue, maxValue) {
  const minInput = control.querySelector("[data-param-range-input='min']");
  const maxInput = control.querySelector("[data-param-range-input='max']");
  if (!minInput || !maxInput) return;
  const lowerBound = Number(minInput.min);
  const upperBound = Number(minInput.max);
  const span = Math.max(0.000001, upperBound - lowerBound);
  const safeMin = clampNumberLocal(Number(minValue), lowerBound, upperBound);
  const safeMax = clampNumberLocal(Number(maxValue), safeMin, upperBound);
  control.style.setProperty("--range-start", `${(((safeMin - lowerBound) / span) * 100).toFixed(3)}%`);
  control.style.setProperty("--range-end", `${(((safeMax - lowerBound) / span) * 100).toFixed(3)}%`);
  const display = control.dataset.rangeDisplay || "number";
  const minLabel = control.querySelector("[data-param-range-label='min']");
  const maxLabel = control.querySelector("[data-param-range-label='max']");
  if (minLabel) minLabel.textContent = formatParamRangeValue(safeMin, display, Number(minInput.step));
  if (maxLabel) maxLabel.textContent = formatParamRangeValue(safeMax, display, Number(maxInput.step));
}

function formatParamRangeValue(value, display = "number", step = 0.01) {
  if (display === "degrees") return `${Math.round(value)}°`;
  if (display === "percent") return `${Math.round(value * 100)}%`;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(0, String(step).split(".")[1]?.length || 0));
  return Number(value).toFixed(decimals);
}

function formatTrimTime(value) {
  const seconds = roundTrimTime(Math.max(0, Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  const centiseconds = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function roundTrimTime(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clampNumberLocal(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
