import { VJ1, WORKSPACES } from "../constants.js";
import { applySceneSnapshotToState, createLiveRenderState, createSceneSnapshot, sceneSourceNodes, syncLiveSnapshotFromScene } from "../domain/models.js?v=render-coordinate-scope-3";
import { buildOutputUrl } from "../view-routing.js?v=adaptive-component-demand-29";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=video-active-ownership-1";
import { frameFitViewport, resetViewport, updatePreviewViewportForUi, zoomViewport } from "../output/preview-viewport.js?v=render-coordinate-scope-3";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js?v=adaptive-component-demand-29";
import { analyzeVj1Project } from "../metrics/component-metrics.js?v=shader-component-catalog-extraction-1";
import { createHtmlCache, isInteractiveNode, isPointerInteractionNode, isTextEditingNode, setClass, setText } from "./dom-utils.js?v=preview-pointer-deferral-1";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js?v=adaptive-component-demand-29";
import { componentCatalogToolsTemplate, componentFilterTemplate, sortComponentCatalog } from "./catalog-view.js?v=catalog-view-extraction-1";
import { canvasInspectorTemplate, componentSelectedChainSettingsTemplate, componentTemplate } from "./component-view.js?v=terrain-mesh-near-1";
import { canvasComponents, getSelectedScene, ordinaryComponents, selectedCanvasComponent } from "./control-selectors.js?v=control-selectors-extraction-1";
import { mappingInletsTemplate, mappingInspectorTemplate, mappingStudioTemplate } from "./mapping-view.js?v=terrain-mesh-near-1";
import { liveInspectorTemplate, liveScenePillTemplate, scenePillTemplate, sceneRailConfigTemplate, sceneSurfacePillTemplate, sceneSurfaceTemplate } from "./scene-live-view.js?v=terrain-mesh-near-1";
import { componentCardBarTemplate, panelTemplate, projectEmptyTemplate, textListItemTemplate } from "./view-primitives.js?v=view-primitives-extraction-1";
import { emptyNote, esc, icon, thumbnailTemplate } from "./template-utils.js?v=slider-values-70";
import { createClipboardController } from "./clipboard-controller.js?v=clipboard-controller-extraction-1";
import { createModalController } from "./modal-controller.js?v=terrain-mesh-near-1";
import { createInputController } from "./input-controller.js?v=render-coordinate-scope-3";

export function createControlShell({ root, store, bridge, mediaLibrary, projectService }) {
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  let renderPending = false;
  let deferredRenderState = null;
  let deferredRenderTimer = 0;
  let activePointerCount = 0;
  let activeCatalogViewKey = "";
  let performanceProfile = null;
  let performanceProfileTimer = 0;
  const catalogOrderSnapshots = { component: [], scene: [] };
  const replaceHtmlIfChanged = createHtmlCache();
  const mediaPreviewUrls = new Map();
  const clipboard = createClipboardController({
    root,
    store,
    getState: () => latestState,
    getInspector: () => refs.inspector,
    importFiles,
    setStatus,
  });
  const modals = createModalController({
    store,
    getState: () => latestState,
    getHost: () => refs.modalHost,
    mediaLibrary,
    mediaPreviewUrls,
    replaceHtmlIfChanged,
    getCatalogSortMode: (state) => catalogSortMode(state, "component"),
    bindCatalogSortControls,
  });
  const inputs = createInputController({
    store,
    getState: () => latestState,
    modals,
    bindComponentFilters,
    bindCatalogSortControls,
    resetProjectMapping,
    currentWorkspace,
    applySelectedSceneSnapshot,
    syncSelectedSceneSnapshot,
  });
  const embeddedPreview = createEmbeddedPreviewApp({
    store,
    mediaLibrary,
    projectService,
    onChainItemTarget: (componentId, itemId) => {
      clipboard.setChainItemTarget(componentId, itemId);
    },
  });
  const performanceProfileDurationMs = 10000;

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    restorePreviewPreference();
    store.subscribe((state, reason, change) => {
      latestState = state;
      if (reason === "output-metrics" || reason === "preview-metrics") capturePerformanceProfileSample(state, reason);
      if (reason === "mapping-state") {
        renderTopbar(state);
        renderPreview(state);
        return;
      }
      if (reason === "output-metrics" || reason === "preview-metrics" || reason === "project-history" || reason === "project-autosave" || reason === "project-autosave-error") {
        renderTopbar(state);
        return;
      }
      if (change.phase === "edit") {
        renderTopbar(state);
        updatePreviewState(state);
        return;
      }
      if (change.phase === "scrub") {
        updatePreviewState(state);
        return;
      }
      if (change.phase === "color") {
        updatePreviewState(state);
        return;
      }
      if (reason === "workspace") {
        if (renderFrame) cancelAnimationFrame(renderFrame);
        renderFrame = 0;
        render(state);
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
    // Pointerup is followed by click. Flush in the next task so the clicked
    // node remains mounted for the complete browser event sequence, without
    // adding a human-visible quiet period after every interaction.
    deferredRenderTimer = setTimeout(flushDeferredRender, 0);
  }

  function flushDeferredRender() {
    deferredRenderTimer = 0;
    if (!renderPending || !deferredRenderState) return;
    // Pointerup/focusout schedules the next attempt. Do not poll while a user
    // is holding a control or editing text.
    if (shouldDeferRender()) return;
    const state = deferredRenderState;
    deferredRenderState = null;
    renderPending = false;
    scheduleRenderNow(state);
  }

  function render(state) {
    prepareCatalogOrder(state);
    setClass(root, "has-project-open", hasOpenProject(state));
    setClass(root, "no-project-open", !hasOpenProject(state));
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderPreview(state);
    modals.render(state);
  }

  function bindStaticEvents() {
    bindInteractionDeferral();

    refs.outputMenu.addEventListener("click", (event) => {
      const state = store.getState();
      const outputs = state.render.outputs || [];
      if (event.target.closest("summary") && outputs.length === 1) {
        event.preventDefault();
        openOutputWindows(state, outputs);
        return;
      }
      const button = event.target.closest("[data-open-output-id]");
      if (!button) return;
      openOutputWindows(state, outputs.filter((output) => output.id === button.dataset.openOutputId));
    });

    refs.togglePreview.addEventListener("click", () => {
      updateUi((ui) => {
        ui.debugPreview = !ui.debugPreview;
        rememberPreviewPreference(ui.debugPreview);
      }, "toggle-preview");
    });

    refs.renderCost.addEventListener("click", startPerformanceProfile);

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
      modals.openSettings();
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);
    refs.closeProject?.addEventListener("click", closeProject);

    refs.workspaceButtons.forEach((button) => {
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

    refs.undo.addEventListener("click", undoProject);
    refs.redo.addEventListener("click", redoProject);

    clipboard.bindWindowEvents();
    window.addEventListener("keydown", handleHistoryKeydown);
  }

  async function undoProject() {
    refs.undo.disabled = true;
    await projectService.undoProject().catch((error) => setStatus(`Undo error: ${error.message || error}`));
  }

  async function redoProject() {
    refs.redo.disabled = true;
    await projectService.redoProject().catch((error) => setStatus(`Redo error: ${error.message || error}`));
  }

  function handleHistoryKeydown(event) {
    if (isTextEditingNode(event.target) || isTextEditingNode(document.activeElement)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || String(event.key).toLowerCase() !== "z") return;
    event.preventDefault();
    if (event.shiftKey) redoProject();
    else undoProject();
  }

  function restorePreviewPreference() {
    let stored = "";
    try {
      stored = sessionStorage.getItem(VJ1.localPreviewKey) || "";
    } catch {
      stored = "";
    }
    if (!stored) return;
    updateUi((ui) => {
      ui.debugPreview = stored === "1";
    }, "restore-preview-preference");
  }

  function rememberPreviewPreference(value) {
    try {
      sessionStorage.setItem(VJ1.localPreviewKey, value ? "1" : "0");
    } catch {
      // This is only a tab preference; project data stays in the project folder.
    }
  }

  function startPerformanceProfile() {
    if (performanceProfile) return;
    const startedAt = performance.now();
    performanceProfile = {
      startedAt,
      startedAtIso: new Date().toISOString(),
      endsAt: startedAt + performanceProfileDurationMs,
      samples: [],
    };
    capturePerformanceProfileSample(latestState);
    renderTopbar(latestState);
    performanceProfileTimer = window.setInterval(() => {
      if (!performanceProfile || performance.now() >= performanceProfile.endsAt) {
        finishPerformanceProfile();
        return;
      }
      renderTopbar(latestState);
    }, 250);
  }

  function capturePerformanceProfileSample(state, reason = "active") {
    if (!performanceProfile) return;
    const outputFps = state.metrics?.clients > 0 ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
    const metric = reason === "preview-metrics"
      ? {
          source: "preview",
          fps: Math.max(0, Number(state.metrics.previewFps) || 0),
          cpuMs: Math.max(0, Number(state.metrics.previewFrameMs) || 0),
          gpuMs: Math.max(0, Number(state.metrics.previewGpuMs) || 0),
          gpuSupported: state.metrics.previewGpuSupported === true,
          profile: state.metrics.previewProfile || null,
          renderCost: Math.max(0, Number(state.metrics.previewRenderCost) || 0),
        }
      : reason === "output-metrics"
        ? {
            source: "output",
            fps: outputFps,
            cpuMs: Math.max(0, Number(state.metrics.frameMs) || 0),
            gpuMs: Math.max(0, Number(state.metrics.gpuMs) || 0),
            gpuSupported: state.metrics.gpuSupported === true,
            profile: state.metrics.profile || null,
            renderCost: Math.max(0, Number(state.metrics.renderCost) || 0),
          }
        : { ...activeWorkMetric(state, outputFps), renderCost: activeRenderCost(state) };
    if (!(metric.fps > 0)) return;
    performanceProfile.samples.push({
      sampledAt: new Date().toISOString(),
      source: metric.source,
      fps: metric.fps,
      frameMs: metric.cpuMs,
      gpuMs: metric.gpuMs,
      gpuSupported: metric.gpuSupported,
      renderCost: metric.renderCost,
      profile: metric.profile ? structuredCloneSafe(metric.profile) : null,
    });
  }

  function finishPerformanceProfile() {
    if (!performanceProfile) return;
    if (performanceProfileTimer) window.clearInterval(performanceProfileTimer);
    performanceProfileTimer = 0;
    const session = performanceProfile;
    performanceProfile = null;
    const report = {
      kind: "vj1-runtime-profile",
      durationMs: performanceProfileDurationMs,
      startedAt: session.startedAtIso,
      completedAt: new Date().toISOString(),
      runtimeSamples: session.samples,
      analysis: analyzeVj1Project(latestState, { runtimeSamples: session.samples }),
    };
    globalThis.__vj1LastProfileReport = report;
    downloadPerformanceProfile(report, latestState.project?.name || "vj1");
    console.info("[VJ1_PROFILE_COMPLETE]", report);
    setStatus(`Profile complete · ${session.samples.length} samples downloaded`);
    renderTopbar(latestState);
  }

  function bindInteractionDeferral() {
    root.addEventListener("pointerdown", (event) => {
      if (!isPointerInteractionNode(event.target)) return;
      activePointerCount += 1;
      beginInteractionHold();
    }, true);
    window.addEventListener("pointerup", endPointerInteractionSoon, true);
    window.addEventListener("pointercancel", endPointerInteractionSoon, true);
    root.addEventListener("focusin", (event) => {
      if (isInteractiveNode(event.target)) beginInteractionHold();
    }, true);
    root.addEventListener("focusout", scheduleDeferredRenderFlush, true);
  }

  function beginInteractionHold() {
    if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
    deferredRenderTimer = 0;
  }

  function endPointerInteractionSoon() {
    activePointerCount = Math.max(0, activePointerCount - 1);
    scheduleDeferredRenderFlush();
  }

  function shouldDeferRender() {
    return activePointerCount > 0 || hasFocusedEditor();
  }

  function hasFocusedEditor() {
    const active = document.activeElement;
    // A committed select change is safe to render immediately. Text editors
    // remain mounted until blur so typing and selection are never disturbed.
    return active?.tagName !== "SELECT" && isTextEditingNode(active);
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
    const incoming = Array.from(files || []);
    const names = new Set(incoming.map((file) => file?.name).filter(Boolean));
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
    const mediaIds = (latestState.media || [])
      .filter((item) => names.has(item.name) || names.has(String(item.path || "").split("/").pop()))
      .map((item) => item.id);
    return { ...(result || {}), mediaIds };
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
    setClass(refs.renderCost, "is-active", !!performanceProfile);
    const profileSeconds = performanceProfile
      ? Math.max(1, Math.ceil((performanceProfile.endsAt - performance.now()) / 1000))
      : 0;
    setText(refs.renderCostText, performanceProfile ? `${profileSeconds}s` : formatRenderCost(renderCost));
    refs.renderCost.title = performanceProfile
      ? `Profiling rendering… ${profileSeconds} second${profileSeconds === 1 ? "" : "s"} remaining`
      : "Profile rendering for 10 seconds and download an analysis report";
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
    renderOutputMenu(state);
    refs.undo.disabled = !state.ui.canUndo;
    refs.redo.disabled = !state.ui.canRedo;
    refs.workspaceButtons.forEach((button) => {
      button.disabled = !hasProject;
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function openOutputWindows(state, outputs = []) {
    // Output windows have one scene authority: Live. Opening from Scene is an
    // explicit request to take that Scene live before the popup is opened,
    // rather than giving the popup a temporary private scene that the next
    // ordinary Live update would immediately replace.
    if (
      state.ui.workspace === "scene" &&
      state.ui.selectedSceneId &&
      String(state.ui.live?.selectedSceneId || "") !== String(state.ui.selectedSceneId)
    ) {
      store.selectLiveScene(state.ui.selectedSceneId);
    }
    for (const output of outputs) {
      window.open(
        buildOutputUrl("output", { outputId: output.id }),
        `vj1-output-${output.id}`,
        `popup=yes,width=${output.width},height=${output.height}`
      );
    }
    refs.outputMenu.open = false;
    if (!outputs.length) return;
    updateUi((ui) => {
      ui.outputWindowOpen = true;
    }, "open-output");
  }

  function renderOutputMenu(state) {
    if (!refs.outputMenuItems) return;
    const outputs = state.render.outputs || [];
    const direct = outputs.length === 1;
    const summary = refs.outputMenu.querySelector("summary");
    const title = direct ? `Open ${outputs[0].name}` : "Open output";
    summary.title = title;
    summary.setAttribute("aria-label", title);
    setClass(refs.outputMenu, "is-direct", direct);
    if (direct) refs.outputMenu.open = false;

    // Output metrics update the top bar continuously. Only rebuild these
    // buttons when the configured outputs change, otherwise a render between
    // pointerdown and click detaches the clicked button and swallows the click.
    const menuOutputs = direct ? [] : outputs;
    const signature = JSON.stringify(menuOutputs.map((output) => [output.id, output.name, output.width, output.height]));
    if (refs.outputMenuItems.dataset.outputsSignature !== signature) {
      refs.outputMenuItems.dataset.outputsSignature = signature;
      refs.outputMenuItems.innerHTML = menuOutputs.map((output) => `
        <button type="button" data-open-output-id="${esc(output.id)}">
          <span></span><small>${output.width}×${output.height}</small>
        </button>
      `).join("");
    }
    for (const output of menuOutputs) {
      const button = [...refs.outputMenuItems.querySelectorAll("[data-open-output-id]")]
        .find((item) => item.dataset.openOutputId === output.id);
      if (button) setText(button.querySelector("span"), `${state.metrics.outputs?.[output.id] ? "● " : ""}${output.name}`);
    }
  }

  function prepareCatalogOrder(state) {
    const workspace = currentWorkspace(state);
    if (!hasOpenProject(state)) {
      activeCatalogViewKey = "";
      return;
    }
    const viewKey = `${state.project.folderName || state.project.name || "project"}:${workspace}`;
    if (viewKey === activeCatalogViewKey) return;
    activeCatalogViewKey = viewKey;
    if (workspace === "component" || workspace === "scene") captureCatalogOrder(workspace, state);
  }

  function captureCatalogOrder(scope, state) {
    const items = scope === "scene" ? sceneSourceNodes(state) : ordinaryComponents(state);
    catalogOrderSnapshots[scope] = sortComponentCatalog(items, catalogSortMode(state, scope)).map((item) => item.id);
  }

  function catalogSortMode(state, scope) {
    const mode = state.ui?.catalogSortModes?.[scope];
    return ["recent", "name", "created"].includes(mode) ? mode : "recent";
  }

  function catalogItemsInSnapshot(scope, items = []) {
    const positions = new Map((catalogOrderSnapshots[scope] || []).map((id, index) => [id, index]));
    return items.slice().sort((a, b) => {
      const aPosition = positions.has(a.id) ? positions.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bPosition = positions.has(b.id) ? positions.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition;
    });
  }

  function bindCatalogSortControls(scope) {
    scope?.querySelectorAll?.("[data-catalog-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        const catalog = button.dataset.catalogSortScope;
        const mode = button.dataset.catalogSort;
        if (!["component", "scene"].includes(catalog) || !["recent", "name", "created"].includes(mode)) return;
        updateUi((ui) => {
          ui.catalogSortModes ||= { component: "recent", scene: "recent" };
          ui.catalogSortModes[catalog] = mode;
        }, `catalog-sort:${catalog}`);
        captureCatalogOrder(catalog, latestState);
        if (catalog === "component") renderProjectRail(latestState);
        else renderInspector(latestState);
      });
    });
  }

  function renderProjectRail(state) {
    const hasProject = hasOpenProject(state);
    const workspace = currentWorkspace(state);
    const html = hasProject ? railToolsTemplate(state, workspace) : "";
    if (replaceHtmlIfChanged(refs.projectRail, html)) bindRailEvents();
  }

  function railToolsTemplate(state, workspace) {
    if (workspace === "component") return componentToolsTemplate(state);
    if (workspace === "canvas") return canvasToolsTemplate(state);
    if (workspace === "mapping") return mappingToolsTemplate(state);
    if (workspace === "live") return liveToolsTemplate(state);
    return sceneToolsTemplate(state);
  }

  function componentToolsTemplate(state) {
    const components = catalogItemsInSnapshot("component", ordinaryComponents(state));
    return `
      <div class="ui-section rail-section" data-component-filter-scope>
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Components</span></div>
        ${componentCatalogToolsTemplate("component", catalogSortMode(state, "component"), "Filter components")}
        <div class="component-card-list" data-paste-scope="component-list">
          ${components.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create visual recipes")}
        </div>
        <button type="button" data-add-component>${icon("add")} Add component</button>
      </div>
    `;
  }

  function canvasToolsTemplate(state) {
    const canvases = canvasComponents(state);
    const selectedCanvas = selectedCanvasComponent(state);
    return `
      <div class="ui-section rail-section" data-component-filter-scope>
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">dashboard_customize</span><span>Canvases</span></div>
        ${componentFilterTemplate("Filter canvases")}
        <div class="component-card-list" data-paste-scope="canvas-list">
          ${canvases.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create a canvas component")}
        </div>
        <button type="button" data-add-canvas-component>${icon("add")} Add canvas</button>
      </div>
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">select_all</span><span>Frames</span></div>
        <div class="recording-frame-pills">
          ${(state.recordingFrames || []).map((frame, index) => canvasFramePillTemplate(frame, index, selectedCanvas)).join("") || emptyNote("Add a recording frame")}
        </div>
        <button type="button" data-add-canvas-frame data-canvas-component-id="${esc(selectedCanvas?.id || "")}" ${selectedCanvas ? "" : "disabled"}>${icon("add")} Add recording frame</button>
      </div>
    `;
  }

  function sceneToolsTemplate(state) {
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scenes</span></div>
        <div class="scene-card-list" data-paste-scope="scene-list">
          ${state.scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Capture surface assignments")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scn ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-save-scene title="Capture scene" aria-label="Capture scene">${icon("add")}</button>
        </div>
      </div>
      ${sceneRailConfigTemplate(state)}
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">select_all</span><span>Surfaces</span></div>
        <div class="surface-pills" data-surface-reorder-list data-paste-scope="surface-list">
          ${state.surfaces.map((surface) => sceneSurfacePillTemplate(surface, state)).join("")}
        </div>
        <button type="button" data-add-surface>${icon("add")} Add surface</button>
      </div>
    `;
  }

  function liveToolsTemplate(state) {
    const transitionDuration = Math.max(0, Number(state.ui?.live?.transitionDuration) || 0);
    const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
    const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch;
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live Scenes</span></div>
        <div class="scene-card-list live-scene-list">
          ${state.scenes.map((scene) => liveScenePillTemplate(scene, state)).join("") || emptyNote("Capture scenes first")}
        </div>
      </div>
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">tune</span><span>Timing</span></div>
        <label class="field range-field live-time-scale">
          <span>Time stretch</span>
          <output class="range-value" data-range-value>${timeStretch.toFixed(2)} · ${timeScale < 0.1 ? timeScale.toFixed(3) : timeScale.toFixed(2)}×</output>
          <input type="range" min="-4" max="4" step="0.01" data-range-format="time-stretch" data-update="global.timeStretch" value="${timeStretch}" />
        </label>
        <label class="field range-field live-transition-duration">
          <span>Transition</span>
          <output class="range-value" data-range-value>${transitionDuration.toFixed(1)} s</output>
          <input type="range" min="0" max="10" step="0.1" data-range-suffix=" s" data-update="ui.live.transitionDuration" value="${transitionDuration}" />
        </label>
      </div>
    `;
  }

  function mappingToolsTemplate(state) {
    const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
    return `
      <div class="ui-section rail-section" data-component-filter-scope>
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">schema</span><span>Node Patch</span></div>
        ${componentFilterTemplate()}
        <div class="component-card-list">
          ${state.components.map((component) => componentPillTemplate(component, state)).join("") || emptyNote("Create a component")}
        </div>
      </div>
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">input</span><span>Inlets</span></div>
        <div class="node-chip-list">
          ${mappingInletsTemplate(selectedComponent)}
        </div>
      </div>
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">output</span><span>Outlets</span></div>
        <div class="node-chip-list">
          <div class="node-chip"><span>texture</span><small>component output</small></div>
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
    const kind = workspace === "component" || workspace === "canvas" ? "component" : "preview";
    const previewState = workspace === "live" ? createLiveRenderState(state) : state;
    if (!previewHost.querySelector("[data-embedded-preview-stage]")) {
      replaceHtmlIfChanged(previewHost, `
        <div class="embedded-preview-stage" data-embedded-preview-stage></div>
        <div class="preview-tools">
          <button type="button" class="preview-tool" data-preview-zoom-out title="Zoom out" aria-label="Zoom out">${icon("remove")}</button>
          <button type="button" class="preview-tool" data-preview-fit-world title="Fit world" aria-label="Fit world">${icon("public")}</button>
          <button type="button" class="preview-tool" data-preview-fit-frame title="Fit outputs" aria-label="Fit outputs">${icon("fit_screen")}</button>
          <button type="button" class="preview-tool" data-preview-zoom-in title="Zoom in" aria-label="Zoom in">${icon("add")}</button>
          <button type="button" class="preview-tool preview-quality-tool is-hidden" data-preview-quality title="Preview resolution" aria-label="Preview resolution"><span data-preview-quality-label>Auto</span></button>
          <button type="button" class="preview-tool" data-toggle-mapping-handles title="Toggle mapping handles" aria-label="Toggle mapping handles">${icon("control_point_duplicate")}</button>
          <div class="preview-fps" data-preview-fps>0 fps</div>
        </div>
      `);
    }
    bindPreviewViewportTools(previewHost);
    const handleButton = previewHost.querySelector("[data-toggle-mapping-handles]");
    setClass(handleButton, "is-active", state.global.mappingHandleMode !== "near");
    setClass(handleButton, "is-hidden", kind !== "preview");
    const qualityButton = previewHost.querySelector("[data-preview-quality]");
    const canvas = workspace === "canvas" ? selectedCanvasComponent(state) : null;
    const supportsPreviewQuality = !!canvas || workspace === "scene" || workspace === "live";
    const storedPreviewQuality = canvas?.canvas?.previewQuality || state.ui?.previewQualities?.[workspace];
    const previewQuality = ["low", "full"].includes(storedPreviewQuality) ? storedPreviewQuality : "auto";
    const qualityLabels = { auto: "Auto", low: "Low", full: "Full" };
    const qualitySubject = canvas ? "Canvas" : workspace === "live" ? "Live" : "Scene";
    const qualityDescriptions = canvas ? {
      auto: "Auto: internal Canvas raster follows the visible preview size",
      low: "Low: internal Canvas raster uses half the preview width and height",
      full: "Full: internal Canvas raster uses the full Canvas dimensions",
    } : {
      auto: `Auto: ${qualitySubject} render demand follows the visible preview size`,
      low: `Low: ${qualitySubject} render demand uses half the automatic width and height`,
      full: `Full: ${qualitySubject} render demand uses the configured output density`,
    };
    setClass(qualityButton, "is-hidden", !supportsPreviewQuality);
    setClass(qualityButton, "is-active", supportsPreviewQuality && previewQuality !== "auto");
    setText(qualityButton?.querySelector("[data-preview-quality-label]"), qualityLabels[previewQuality]);
    if (qualityButton) {
      qualityButton.title = `${qualityDescriptions[previewQuality]}. Click to change quality.`;
      qualityButton.setAttribute("aria-label", `${qualitySubject} preview resolution: ${qualityLabels[previewQuality]}`);
    }
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
    const kind = workspace === "component" || workspace === "canvas" ? "component" : "preview";
    embeddedPreview.setState(workspace === "live" ? createLiveRenderState(state) : state, kind);
  }

  function renderInspector(state) {
    refs.inspector.dataset.workspace = currentWorkspace(state);
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      replaceHtmlIfChanged(refs.inspector, "");
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    let html = "";
    if (currentWorkspace(state) === "component") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      html = `${panelTemplate(
        "account_tree",
        selectedComponent?.name || "Component",
        selectedComponent ? componentTemplate(selectedComponent, state) : emptyNote("No component"),
        selectedComponent ? { titlePath: `${pathForComponent(state, selectedComponent)}.name` } : {}
      )}${selectedComponent ? componentSelectedChainSettingsTemplate(selectedComponent, state) : ""}`;
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "mapping") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      html = panelTemplate(
        "schema",
        "Nodes",
        mappingInspectorTemplate(selectedComponent, state)
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "canvas") {
      const selectedCanvas = selectedCanvasComponent(state);
      html = `${panelTemplate(
        "dashboard_customize",
        selectedCanvas?.name || "Canvas",
        selectedCanvas ? canvasInspectorTemplate(selectedCanvas, state) : emptyNote("Create a canvas component"),
        selectedCanvas ? { titlePath: `${pathForComponent(state, selectedCanvas)}.name` } : {}
      )}${selectedCanvas ? componentSelectedChainSettingsTemplate(selectedCanvas, state) : ""}`;
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "live") {
      html = liveInspectorTemplate(state);
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    html = `
      ${panelTemplate("select_all", selectedSurface?.name || "Surface", selectedSurface ? sceneSurfaceTemplate(selectedSurface, state, {
        sources: catalogItemsInSnapshot("scene", sceneSourceNodes(state)),
        sortMode: catalogSortMode(state, "scene"),
      }) : emptyNote("No surface"), selectedSurface && selectedSurface.destination?.type !== "direct"
        ? { titlePath: `${pathForSurface(state, selectedSurface)}.name` }
        : {})}
    `;
    if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
  }

  function bindRailEvents() {
    inputs.bind(refs.projectRail);
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelectorAll("[data-add-component]").forEach((button) => {
      button.addEventListener("click", () => store.addComponent());
    });
    refs.projectRail.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
    refs.projectRail.querySelector("[data-save-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scn ${latestState.scenes.length + 1}`;
      store.saveScene(name);
    });
    refs.projectRail.querySelectorAll("[data-select-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectScene(button.dataset.selectScene));
    });
    refs.projectRail.querySelectorAll("[data-live-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectLiveScene(button.dataset.liveScene));
    });
    refs.projectRail.querySelectorAll("[data-reset-live-scene]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        store.resetLiveScene?.(button.dataset.resetLiveScene);
      });
    });
    refs.projectRail.querySelectorAll("[data-delete-scene]").forEach((button) => {
      button.addEventListener("click", () => store.deleteScene(button.dataset.deleteScene));
    });
    refs.projectRail.querySelectorAll("[data-surface-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        onReorder: (fromId, toId) => store.reorderSurfaces?.(fromId, toId),
      });
    });
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
    bindButton("[data-preview-quality]", () => {
      store.update((draft) => {
        const workspace = currentWorkspace(draft);
        if (workspace === "canvas") {
          const canvas = selectedCanvasComponent(draft);
          if (!canvas) return;
          canvas.canvas ||= { width: VJ1.canvasWidth, height: VJ1.canvasHeight };
          canvas.canvas.previewQuality = nextPreviewQuality(canvas.canvas.previewQuality);
          return;
        }
        if (workspace !== "scene" && workspace !== "live") return;
        draft.ui.previewQualities ||= { scene: "auto", live: "auto" };
        draft.ui.previewQualities[workspace] = nextPreviewQuality(draft.ui.previewQualities[workspace]);
      }, "preview-quality");
    });
    bindButton("[data-preview-fit-world]", () => {
      updateUi((ui) => {
        updatePreviewViewportForUi(ui, resetViewport());
      }, "preview-fit-world");
    });
    bindButton("[data-preview-fit-frame]", () => {
      const stage = previewHost.querySelector("[data-embedded-preview-stage]");
      const rect = stage?.getBoundingClientRect?.();
      updateUi((ui) => {
        updatePreviewViewportForUi(ui, frameFitViewport({
          stageSize: {
            width: Math.max(1, Math.floor(rect?.width || previewHost.clientWidth || 960)),
            height: Math.max(1, Math.floor(rect?.height || previewHost.clientHeight || 540)),
          },
          render: latestState.render,
        }));
      }, "preview-fit-frame");
    });
  }

  function nudgePreviewZoom(multiplier) {
    updateUi((ui) => {
      updatePreviewViewportForUi(ui, (viewport) => zoomViewport(viewport, multiplier));
    }, "preview-zoom");
  }

  function updateUi(recipe, reason) {
    if (typeof store.updateUi === "function") {
      store.updateUi(recipe, reason);
      return;
    }
    store.update((draft) => recipe(draft.ui), reason);
  }

  function bindStudioEvents() {
    refs.studio.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.studio.querySelector("[data-import-files]")?.addEventListener("click", () => refs.importFiles.click());
    refs.studio.querySelector("[data-reset-mapping]")?.addEventListener("click", () => {
      resetProjectMapping();
    });
  }

  function bindInputs(scope) {
    inputs.bind(scope);
  }

  function resetProjectMapping(surfaceId = "") {
    store.update((draft) => {
      draft.mappings ||= {};
      const mappedSurfaces = draft.surfaces.filter((surface) => surface.destination?.type !== "direct");
      const defaults = defaultProjectSurfaceMapping(draft.render, mappedSurfaces);
      const existing = Array.isArray(draft.mappings.local?.surfaces) ? draft.mappings.local.surfaces : [];
      const existingById = new Map(existing.map((surface) => [surface.id || surface.name, surface]));
      const defaultById = new Map(defaults.map((surface) => [surface.id || surface.name, surface]));
      draft.mappings.local = {
        ...(draft.mappings.local || {}),
        surfaces: mappedSurfaces.map((surface) => {
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

  return { mount };
}

function componentPillTemplate(component, state) {
  const selected = state.ui.selectedComponentId === component.id;
  const fallbackIcon = component.type === "canvas" ? "dashboard_customize" : "account_tree";
  const removeDisabled = component.type !== "canvas"
    ? ordinaryComponents(state).length <= 1
    : state.components.length <= 1;
  return `
    <div class="component-card-row" data-component-filter-card="${esc(component.name.toLowerCase())}">
      <button type="button" class="component-card ${selected ? "is-selected" : ""}" data-select-component="${esc(component.id)}">
        ${thumbnailTemplate(component.thumbnail, fallbackIcon)}
        ${componentCardBarTemplate(component.name)}
      </button>
      <button type="button" class="component-card-remove" data-remove-component="${esc(component.id)}" title="Remove" aria-label="Remove ${esc(component.name)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>
    </div>
  `;
}

function canvasFramePillTemplate(frame, index, component) {
  const label = frame.name || `Frame ${index + 1}`;
  return textListItemTemplate({
    rowClass: "list-row",
    leadingHtml: `<span class="text-list-static-icon" aria-hidden="true">${icon("select_all")}</span>`,
    label,
    meta: "Shared",
    mainClass: "list-select recording-frame-label",
    removeClass: "list-remove",
    removeAttributes: `data-canvas-component-id="${esc(component?.id || "")}" data-remove-canvas-frame="${esc(frame.id)}"`,
    removeTitle: "Remove recording frame",
  });
}



function syncSelectedSceneSnapshot(state) {
  const scene = state.scenes.find((item) => item.id === state.ui.selectedSceneId);
  if (!scene) return;
  scene.snapshot = createSceneSnapshot(state);
  syncLiveSnapshotFromScene(state, scene);
}

function applySelectedSceneSnapshot(state) {
  const scene = getSelectedScene(state);
  if (!scene) return;
  applySceneSnapshotToState(state, scene);
  syncLiveSnapshotFromScene(state, scene);
}


function nextPreviewQuality(value) {
  const quality = ["low", "full"].includes(value) ? value : "auto";
  return quality === "auto" ? "low" : quality === "low" ? "full" : "auto";
}

function currentWorkspace(state) {
  return WORKSPACES.includes(state.ui?.workspace) ? state.ui.workspace : "scene";
}

function hasOpenProject(state) {
  return !!state?.project?.folderName;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function downloadPerformanceProfile(report, projectName = "vj1") {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeProjectName = String(projectName || "vj1")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "vj1";
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${timestamp}-${safeProjectName}.profile.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

function componentRenderTime(profile) {
  const value = Number(profile?.componentWallMs ?? profile?.componentMs);
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
  const componentMs = componentRenderTime(profile);
  const sampledTotal = Math.max(0, Number(profile.totalMs) || 0);
  const renders = Math.max(0, Math.round(Number(profile.componentRenders) || 0));
  const cacheHits = Math.max(0, Math.round(Number(profile.componentCacheHits) || 0));
  const stageRenders = Math.max(0, Math.round(Number(profile.stageRenders) || 0));
  const stageCacheHits = Math.max(0, Math.round(Number(profile.stageCacheHits) || 0));
  const slowest = (profile.passSamples || [])
    .filter((sample) => sample?.type === "component")
    .slice()
    .sort((a, b) => (Number(b.ms) || 0) - (Number(a.ms) || 0))
    .slice(0, 3);
  lines.push(`Sampled component: ${formatTimeMs(componentMs)}`);
  lines.push(`Sampled other work: ${formatTimeMs(Math.max(0, sampledTotal - componentMs))}`);
  lines.push(`${renders} rendered, ${cacheHits} component cache hit${cacheHits === 1 ? "" : "s"}, ${stageRenders} stage render${stageRenders === 1 ? "" : "s"}, ${stageCacheHits} stage reuse${stageCacheHits === 1 ? "" : "s"}`);
  for (const sample of slowest) {
    lines.push(`${sample.componentName || sample.componentId || "Component"}: ${formatTimeMs(sample.ms)}`);
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


function bindComponentFilters(scope) {
  scope?.querySelectorAll?.("[data-component-filter]").forEach((input) => {
    input.addEventListener("input", () => {
      const filterScope = input.closest("[data-component-filter-scope]");
      const query = input.value.trim().toLowerCase();
      filterScope?.querySelectorAll?.("[data-component-filter-card]").forEach((card) => {
        card.hidden = !!query && !String(card.dataset.componentFilterCard || "").includes(query);
      });
    });
  });
}

function pathForSurface(state, surface) {
  return `surfaces.${state.surfaces.findIndex((item) => item.id === surface.id)}`;
}

function pathForScene(state, scene) {
  return `scenes.${state.scenes.findIndex((item) => item.id === scene.id)}`;
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
