import { VJ1, WORKSPACES } from "../constants.js";
import { createLiveScenePreviewState, projectSelectedMapping, sceneSourceNodes } from "../domain/models.js?v=live-output-matrix-contract-3";
import { componentRenderPatchesForChange } from "../domain/render-transport-patch.js?v=component-transport-patch-1";
import { buildOutputUrl } from "../view-routing.js?v=adaptive-component-demand-29";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=mesh-geometry-detail-2";
import { fitPreviewViewport, resetViewport, updatePreviewViewportForUi, zoomViewport } from "../output/preview-viewport.js?v=cursor-anchored-zoom-1";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js?v=adaptive-component-demand-29";
import { analyzeVj1Project, createRuntimeHotspotSmoother, summarizeRuntimeHotPasses } from "../metrics/component-metrics.js?v=compiled-capability-revision-1";
import { createHtmlCache, isInteractiveNode, isPointerInteractionNode, isTextEditingNode, setClass, setText } from "./dom-utils.js?v=scroll-region-1";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js?v=workspace-icons-1-unified-playback-surface-mapping-icon-shared-ui-icons-topbar-order-1";
import { sortComponentCatalog } from "./catalog-view.js?v=catalog-tools-row-1";
import { sceneSurfaceInspectorTemplate, sceneInspectorTemplate, componentHeaderAddButtonTemplate, componentSelectedChainSettingsTemplate, componentTemplate } from "./component-view.js?v=inspector-view-option-parameter-control-group-1";
import { sceneComponents, getSelectedMapping, ordinaryComponents, selectedSceneComponent } from "./control-selectors.js?v=live-output-matrix-contract-3";
import { liveInspectorTemplate, mappingSurfaceTemplate } from "./mapping-live-view.js?v=live-output-matrix-contract-3";
import { deepEditButtonTemplate, panelTemplate, projectEmptyTemplate } from "./view-primitives.js?v=uniform-section-hierarchy-card-type-icons-1";
import { emptyNote, esc, icon, thumbnailTemplate } from "./template-utils.js?v=derived-thumbnail-projection-1";
import { createClipboardController } from "./clipboard-controller.js?v=scene-live-audit-1";
import { createModalController } from "./modal-controller.js?v=parameter-control-group-1";
import { createInputController } from "./input-controller.js?v=inspector-view-option-parameter-control-group-1";
import { createControlPerformanceSession } from "./control-performance-session.js?v=control-performance-session-1";
import { createControlDiagnosticsController } from "./control-diagnostics-controller.js?v=control-diagnostics-counter-1";
import { createControlRenderDiagnostics } from "./control-render-diagnostics.js?v=control-ui-long-render-1";
import { componentTypeIcon, UI_ICONS } from "./ui-icons.js";
import { liveProjectionRailTemplate, projectRailTemplate } from "./project-rail-view.js?v=live-output-matrix-contract-3";
import { prepareProjectNodeDefinitionEdit, prepareProjectNodeGraphEdit, selectedNodeEditorTemplate, withProjectNodeFork, withProjectNodeParameterExposure, withProjectNodePortExposure, withoutProjectNodeFork } from "./node-editor-view.js?v=project-group-authoring-public-group-ports-atomic-preflight-2";
import { bindNodeLibraryFilter, nodeLibraryInspectorTemplate, nodeLibraryRailTemplate, nodeLibraryStudioTemplate, selectedNodeWorkspaceTarget } from "./node-library-view.js?v=canonical-effect-params-1";
import { bindNodeGraphCanvas } from "./node-graph-canvas.js?v=typed-media-render-process-1";
import {
  resolveProjectVisualTransitionEntries,
} from "../libraries/visual-nodes/project-visual-node-resolver.js?v=async-media-dirty-1";
import { isMappingSurfaceVisibilityReason, previewActivationForContext } from "./preview-state-activation.js?v=live-output-matrix-contract-3";

const performanceHealthClasses = Object.freeze([
  "health-0", "health-1", "health-2", "health-3", "health-4",
  "health-5", "health-6", "health-7", "health-8",
]);
const performanceHealthThresholds = Object.freeze([0.18, 0.32, 0.46, 0.60, 0.72, 0.82, 0.92, 1.0]);
const liveProgramRenderReasons = new Set([
  "live:scene",
  "live:target",
  "live:surface-patch-clear",
  "live:overall-component-clear",
  "live:surface-visibility",
]);
const previewViewportReasons = new Set([
  "preview-zoom",
  "preview-pan",
  "preview-fit-world",
  "preview-fit-frame",
]);

export function rememberParamViewSelections(scope, selections = new Map()) {
  for (const input of scope?.querySelectorAll?.(".chain-param-view-input:checked") || []) {
    if (input.name && input.id) selections.set(input.name, input.id);
  }
  return selections;
}

export function restoreParamViewSelections(scope, selections = new Map()) {
  for (const input of scope?.querySelectorAll?.(".chain-param-view-input") || []) {
    if (input.id && selections.get(input.name) === input.id) input.checked = true;
  }
  return selections;
}

export function createControlShell({ root, store, bridge, mediaLibrary, projectService, diagnostics = null, nodePackage = null }) {
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  let renderPending = false;
  let deferredRenderState = null;
  let deferredRenderTimer = 0;
  let liveTransitionRefreshTimer = 0;
  let liveTransitionNodes = null;
  let liveTransitionPackages = null;
  let liveTransitionEntries = Object.freeze([]);
  let activePointerCount = 0;
  let activeCatalogViewKey = "";
  let deepEditReturnContext = null;
  const performanceHotspotSmoother = createRuntimeHotspotSmoother();
  let performanceHotspotComponentScope = "";
  const previewLayoutQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 860px)")
    : null;
  const catalogOrderSnapshots = { component: [], scene: [], mapping: [], live: [], source: [] };
  const activeParamViews = new Map();
  const replaceHtmlIfChanged = createHtmlCache();
  const diagnosticsController = createControlDiagnosticsController({
    diagnostics,
    getRefs: () => refs,
    replaceHtmlIfChanged,
    setStatus,
  });
  const controlRenderDiagnostics = createControlRenderDiagnostics({ diagnostics });
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
    refreshMedia: () => projectService.refreshFolder({ force: true }),
    replaceHtmlIfChanged,
    getCatalogSortMode: (state, scope = "component") => catalogSortMode(state, scope),
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
    refreshSelectedMappingProjection,
  });
  const embeddedPreview = createEmbeddedPreviewApp({
    store,
    mediaLibrary,
    projectService,
    onChainItemTarget: (componentId, itemId) => {
      clipboard.setChainItemTarget(componentId, itemId);
    },
  });
  let editorNodePackage = nodePackage?.editorContext?.(
    projectService.getInstalledNodePackages?.() || [],
    projectService.getAvailableNodePackages?.() || [],
    latestState.nodes?.definitions || [],
  ) || nodePackage;
  let editorProjectDefinitions = latestState.nodes?.definitions || [];
  projectService.subscribeNodePackages?.((packages, availablePackages) => {
    editorNodePackage = nodePackage?.editorContext?.(
      packages,
      availablePackages,
      latestState.nodes?.definitions || [],
    ) || nodePackage;
    editorProjectDefinitions = latestState.nodes?.definitions || [];
    embeddedPreview.setInstalledNodePackages(packages);
    if (currentWorkspace(latestState) !== "nodes") return;
    renderProjectRail(latestState);
    renderStudio(latestState);
    renderInspector(latestState);
  });
  const performanceSession = createControlPerformanceSession({
    getState: () => latestState,
    metricForState: performanceMetricForState,
    analyze: (state, samples) => analyzeVj1Project(state, {
      runtimeSamples: samples,
      resolveNodeDefinition: (node) => {
        const registry = editorNodePackage?.registry;
        const nodeId = String(node?.nodeId || "");
        const nodeVersion = String(node?.nodeVersion || "");
        return registry?.has?.(nodeId, nodeVersion)
          ? registry.get(nodeId, nodeVersion)
          : null;
      },
    }),
    onTick: () => renderTopbar(latestState),
    onComplete: (report, sampleCount) => {
      globalThis.__vj1LastProfileReport = report;
      console.info("[VJ1_PROFILE_COMPLETE]", report);
      showPerformanceResults(report);
      setStatus(`Profile complete · ${sampleCount} samples analyzed`);
      renderTopbar(latestState);
    },
  });

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    diagnosticsController.mount();
    previewLayoutQuery?.addEventListener?.("change", () => scheduleRenderNow(latestState, { reason: "preview-layout" }));
    restorePreviewPreference();
    scheduleLiveTransitionRefresh(latestState);
    store.subscribe((state, reason, change) => {
      latestState = state;
      if (state.nodes?.definitions !== editorProjectDefinitions) {
        editorProjectDefinitions = state.nodes?.definitions || [];
        editorNodePackage = nodePackage?.editorContext?.(
          projectService.getInstalledNodePackages?.() || [],
          projectService.getAvailableNodePackages?.() || [],
          editorProjectDefinitions,
        ) || nodePackage;
      }
      scheduleLiveTransitionRefresh(state);
      performanceSession.recordStateEvent(reason);
      if (change.projectRestore) {
        invalidateCatalogOrder();
        deepEditReturnContext = null;
      }
      if (reason === "output-metrics" || reason === "preview-metrics") performanceSession.captureSample(state, reason);
      if (change.topic === "mapping-state") {
        renderTopbar(state);
        // Mapping drags originate in the embedded mapper, so its scrub echo
        // must not be fed back as a complete preview state on every pointer
        // sample. The final commit still reconciles programmatic/reset edits.
        if (change.phase !== "scrub") renderPreview(state, { reason, change });
        return;
      }
      if (reason === "output-metrics" || reason === "preview-metrics" || reason === "project-history" || reason === "project-autosave" || reason === "project-autosave-error") {
        renderTopbar(state);
        return;
      }
      if (change.scope === "derived" && change.projection?.kind === "component-thumbnails") {
        patchComponentThumbnails(change.projection.entries);
        return;
      }
      if (change.scope === "ui" && previewViewportReasons.has(reason)) {
        // Navigation changes only the retained p5 presentation transform.
        // A full state replacement would rebuild the render graph and, in
        // Live, discard its temporary parameter overlay.
        embeddedPreview.setViewport(state.ui);
        return;
      }
      const patchedLivePreview = currentWorkspace(state) === "live" &&
        change.scope === "live" &&
        Array.isArray(change.livePatches) &&
        change.livePatches.length > 0 &&
        embeddedPreview.applyLivePatches(change.livePatches)?.applied;
      const renderPatches = Array.isArray(change.renderPatches) && change.renderPatches.length
        ? change.renderPatches
        : componentRenderPatchesForChange(state, change);
      // Component and Scene controls use the same compact renderer patch
      // contract as the Output bridge. Applying it in place avoids replacing
      // and normalizing the complete preview state for every slider sample.
      const patchedStudioPreview = currentWorkspace(state) !== "live" &&
        renderPatches.length > 0 &&
        embeddedPreview.applyRenderPatches(renderPatches)?.applied;
      if (reason === "live:update") {
        // Native controls already display the commanded value. Rebuilding the
        // complete Live inspector here destroys its scroll/tab/element DOM
        // identity even though no structure changed.
        if (!patchedLivePreview) updatePreviewState(state);
        return;
      }
      if (change.phase === "edit") {
        renderTopbar(state);
        if (!patchedStudioPreview) {
          updatePreviewState(state, previewActivationForContext({ reason, change }));
        }
        return;
      }
      if (change.phase === "scrub") {
        // Component preview gestures own an immediate local state overlay.
        // Feeding their store echo straight back into the same renderer makes
        // it rebuild lookup state twice per pointer frame.
        if (!patchedLivePreview && !patchedStudioPreview && reason !== "scrub:chain-transform" && reason !== "scrub:chain-boundary" && reason !== "scrub:scene-surface") updatePreviewState(state);
        return;
      }
      if (change.phase === "color") {
        if (!patchedLivePreview && !patchedStudioPreview) updatePreviewState(state);
        return;
      }
      if (reason === "workspace") {
        // State selection is committed synchronously, but a workspace switch
        // can replace all three editor columns and retarget the retained
        // Preview canvas. Reconcile that structure after the click event has
        // returned so browser input latency does not include a complete shell
        // render. `force` discards any older queued editor projection.
        scheduleRenderNow(state, { force: true, reason, change });
        return;
      }
      if (currentWorkspace(state) === "mapping" && isMappingSurfaceVisibilityReason(reason)) {
        // The clicked eye is patched optimistically and its selection is part
        // of the same transaction. Only the inspector focus and compiled
        // Mapping projection can have changed; rebuilding catalogs, studio
        // structure, and the Preview DOM here made one eye click unnecessarily
        // expensive.
        scheduleRenderNow(state, {
          force: true,
          reason,
          change,
          projection: "mapping-surface-visibility",
        });
        return;
      }
      if (currentWorkspace(state) === "live" && liveProgramRenderReasons.has(reason)) {
        scheduleRenderNow(state, { force: true, reason, change, projection: "live-program" });
        return;
      }
      if (change.structural) {
        // Structural commands change the identity and destination of controls.
        // They cannot wait behind a stale slider/text gesture hold: render on
        // the next frame after the current DOM event has completed.
        scheduleRenderNow(state, { force: true, reason, change });
        return;
      }
      scheduleRender(state, {
        reason,
        change,
        previewPatched: patchedLivePreview || patchedStudioPreview,
      });
    });
  }

  function scheduleLiveTransitionRefresh(state) {
    if (liveTransitionRefreshTimer) clearTimeout(liveTransitionRefreshTimer);
    liveTransitionRefreshTimer = 0;
    const transition = state.ui?.live?.transition;
    const expiresAt = (Number(transition?.startedAtMs) || 0) + Math.max(0, Number(transition?.durationMs) || 0);
    if (!transition?.fromSurfaceRoutes || expiresAt <= Date.now()) return;
    // Transition progress is renderer-owned and intentionally does not write
    // the project store every frame. Refresh the structural Live panels once
    // at expiry so their route-derived catalogs discard the previous program.
    liveTransitionRefreshTimer = setTimeout(() => {
      liveTransitionRefreshTimer = 0;
      if (currentWorkspace(latestState) === "live") {
        renderMeasuredControlPhases(latestState, { reason: "live-transition-expired" }, [
          ["live-projection-rail", () => renderLiveProjectionRail(latestState)],
          ["inspector", () => renderInspector(latestState)],
        ]);
      }
    }, Math.max(0, expiresAt - Date.now()) + 20);
  }

  function scheduleRender(state, context = {}) {
    if (shouldDeferRender()) {
      deferRender(state);
      return;
    }
    scheduleRenderNow(state, context);
  }

  function scheduleRenderNow(state, { force = false, reason = "", change = null, projection = "shell" } = {}) {
    if (force) {
      deferredRenderState = null;
      renderPending = false;
      if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
      deferredRenderTimer = 0;
    }
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (!force && shouldDeferRender()) {
        deferRender(latestState);
        return;
      }
      // A queued frame is only a request to render. Its captured snapshot is
      // not an authority: rapid scrubs/toggles may have advanced the store
      // before this callback runs.
      if (projection === "live-program") renderLiveProgramChange(latestState, { reason, change });
      else if (projection === "mapping-surface-visibility") {
        renderMappingSurfaceVisibilityChange(latestState, { reason, change });
      }
      else render(latestState, { reason, change });
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
    deferredRenderState = null;
    renderPending = false;
    scheduleRenderNow(latestState, { reason: "deferred-interaction-flush" });
  }

  function render(state, context = {}) {
    const profileRenderStarted = performanceSession.isActive() ? performance.now() : 0;
    renderMeasuredControlPhases(state, context, [
      ["catalog-order", () => prepareCatalogOrder(state)],
      ["shell-state", () => {
        setClass(root, "has-project-open", hasOpenProject(state));
        setClass(root, "no-project-open", !hasOpenProject(state));
      }],
      ["topbar", () => renderTopbar(state)],
      ["project-rail", () => renderProjectRail(state)],
      ["live-projection-rail", () => renderLiveProjectionRail(state)],
      ["studio", () => renderStudio(state)],
      ["inspector", () => renderInspector(state)],
      ["preview", () => {
        // A successful retained render patch has already made this exact
        // project change authoritative inside the preview renderer. Replacing
        // its complete state again here would rebuild programs and resources
        // during the same UI transaction.
        if (!context.previewPatched) renderPreview(state, context);
      }],
      ["modals", () => modals.render(state)],
    ]);
    if (performanceSession.isActive()) performanceSession.recordUiRender(performance.now() - profileRenderStarted);
  }

  function renderLiveProgramChange(state, context = {}) {
    if (context.reason === "live:surface-visibility") {
      renderMeasuredControlPhases(state, context, [
        ["live-projection-rail", () => renderLiveProjectionRail(state)],
        ["preview", () => updatePreviewState(state, "projection")],
      ]);
      return;
    }
    renderMeasuredControlPhases(state, context, [
      ["project-rail", () => renderProjectRail(state)],
      ["live-projection-rail", () => renderLiveProjectionRail(state)],
      ["inspector", () => renderInspector(state)],
      ["preview", () => renderPreview(state, context)],
    ]);
  }

  function renderMappingSurfaceVisibilityChange(state, context = {}) {
    renderMeasuredControlPhases(state, context, [
      ["project-selection", () => patchProjectRailSelection(state)],
      ["inspector", () => renderInspector(state)],
      ["preview", () => updatePreviewState(state, "mapping")],
    ]);
  }

  function renderMeasuredControlPhases(state, context, operations) {
    const renderStarted = performance.now();
    const phases = [];
    for (const [name, operation] of operations) {
      const started = performance.now();
      operation();
      phases.push({ name, durationMs: performance.now() - started });
    }
    controlRenderDiagnostics.report({
      durationMs: performance.now() - renderStarted,
      phases,
      reason: context.reason,
      topic: context.change?.topic,
      workspace: currentWorkspace(state),
    });
  }

  function patchComponentThumbnails(entries = []) {
    const updates = new Map((entries || []).map((entry) => [
      `${String(entry?.componentId || "")}:${String(entry?.surfaceId || "")}`,
      String(entry?.url || ""),
    ]));
    if (!updates.size) return;
    for (const thumbnail of root.querySelectorAll("[data-component-thumbnail]")) {
      const key = `${thumbnail.dataset.componentThumbnail || ""}:${thumbnail.dataset.surfaceThumbnail || ""}`;
      const url = updates.get(key);
      if (!url) continue;
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      thumbnail.classList.remove("component-card-empty");
      thumbnail.replaceChildren(image);
    }
  }

  function bindStaticEvents() {
    bindInteractionDeferral();

    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-component]");
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      openComponentEditor(button.dataset.editComponent, button.dataset.editChainItem || "");
    }, true);

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

    refs.renderCost.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePerformanceSummary();
    });
    refs.performanceSummary.addEventListener("click", (event) => event.stopPropagation());
    refs.performanceAnalyze.addEventListener("click", () => {
      closePerformanceSummary();
      performanceSession.start();
    });
    refs.performanceResultsHost.addEventListener("click", handlePerformanceResultsClick);
    window.addEventListener("click", closePerformanceSummary);

    refs.diagnosticsToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      diagnosticsController.toggle();
    });
    refs.diagnosticsSummary?.addEventListener("click", diagnosticsController.handleClick);
    window.addEventListener("click", diagnosticsController.close);

    refs.toggleOutputHud.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.showHud = draft.global.showHud === false;
      }, "toggle-output-hud");
    });

    refs.toggleOutputPlayback.addEventListener("click", () => {
      if (!hasOpenProject(latestState)) return;
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
    refs.returnFromDeepEdit?.addEventListener("click", returnFromDeepEdit);

    refs.workspaceButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (!hasOpenProject(latestState)) return;
        const workspace = WORKSPACES.includes(button.dataset.workspace) ? button.dataset.workspace : "scene";
        deepEditReturnContext = null;
        switchWorkspace(workspace);
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

  function switchWorkspace(workspace) {
    const targetWorkspace = WORKSPACES.includes(workspace) ? workspace : "scene";
    const mappingActive = targetWorkspace === "mapping";
    if (typeof store.setWorkspace === "function") store.setWorkspace(targetWorkspace);
    else {
      store.update((draft) => {
        draft.ui.workspace = targetWorkspace;
        draft.global.calibrating = mappingActive;
      }, "workspace");
    }
    embeddedPreview.command("set-calibrate", { calibrating: mappingActive });
    bridge.command("set-calibrate", { calibrating: mappingActive });
  }

  function openComponentEditor(componentId, chainItemId = "") {
    const component = latestState.components?.find((item) => item.id === componentId);
    if (!component) return;
    closePerformanceSummary();
    if (!deepEditReturnContext) {
      deepEditReturnContext = {
        workspace: currentWorkspace(latestState),
        selectedComponentId: latestState.ui?.selectedComponentId || "",
      };
    }
    switchWorkspace(component.type === "scene" ? "scene" : "component");
    store.selectComponent?.(component.id);
    if (chainItemId) store.selectChainItem?.(chainItemId);
  }

  function returnFromDeepEdit() {
    const context = deepEditReturnContext;
    deepEditReturnContext = null;
    if (!context) return;
    switchWorkspace(context.workspace);
    if ((context.workspace === "component" || context.workspace === "scene") &&
        latestState.components?.some((item) => item.id === context.selectedComponentId)) {
      store.selectComponent?.(context.selectedComponentId);
    }
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
    } catch (error) {
      console.warn("[VJ1_PREVIEW_PREFERENCE_READ_FAILED]", { fallback: "project default preview visibility", message: error?.message || String(error) });
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
    } catch (error) {
      console.warn("[VJ1_PREVIEW_PREFERENCE_WRITE_FAILED]", { fallback: "current in-memory preview visibility", message: error?.message || String(error) });
      // This is only a tab preference; project data stays in the project folder.
    }
  }

  function togglePerformanceSummary() {
    const opening = refs.performanceSummary.classList.contains("is-hidden");
    setClass(refs.performanceSummary, "is-hidden", !opening);
    refs.renderCost.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) renderPerformanceSummary(latestState);
  }

  function closePerformanceSummary() {
    setClass(refs.performanceSummary, "is-hidden", true);
    refs.renderCost?.setAttribute("aria-expanded", "false");
  }

  function renderPerformanceSummary(state) {
    const outputFps = state.metrics?.clients > 0 ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
    const metric = activeWorkMetric(state, outputFps);
    const profiles = (metric.renderers || [])
      .filter((renderer) => renderer.profile)
      .map((renderer) => ({ ...renderer.profile, runtimeSource: renderer.source }));
    const totalMs = profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.totalMs) || 0), 0);
    const totalsBySource = profiles.reduce((totals, profile) => {
      const source = profile.runtimeSource || "renderer";
      totals[source] = (totals[source] || 0) + Math.max(0, Number(profile.totalMs) || 0);
      return totals;
    }, {});
    const measuredHotspots = summarizeRuntimeHotPasses(profiles, 16);
    const componentScope = Array.from(new Set(measuredHotspots.map((item) => `${item.runtimeSource || "renderer"}:${item.componentId || ""}`))).sort().join(",");
    if (componentScope) performanceHotspotComponentScope = componentScope;
    const smoothed = performanceHotspotSmoother.update(measuredHotspots, {
      scope: `${metric.source || "renderer"}:${performanceHotspotComponentScope}`,
      totalMs,
      totalsBySource,
      limit: 8,
    });
    const hotspots = smoothed.hotspots;
    const displayTotalMs = smoothed.totalMs;
    const renderCost = activeRenderCost(state);
    const outputConnected = Number(state.metrics?.clients) > 0;
    const cacheHits = profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.componentCacheHits) || 0) + Math.max(0, Number(profile.stageCacheHits) || 0), 0);
    const cacheRenders = profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.componentRenders) || 0) + Math.max(0, Number(profile.stageRenders) || 0), 0);
    const rows = hotspots.length
      ? hotspots.map((item) => {
          const rendererTotalMs = smoothed.totalsBySource[item.runtimeSource || "renderer"] || displayTotalMs;
          const share = rendererTotalMs > 0 ? Math.min(999, item.msAvg / rendererTotalMs * 100) : 0;
          const edit = deepEditButtonTemplate(item.componentId, { chainItemId: item.chainItemId, className: "performance-hotspot-edit", label: `Edit ${item.name}` });
          const thumbnail = performanceComponentThumbnail(state, item.componentId, "performance-hotspot-thumbnail");
          const context = item.runtimeSource ? `${item.kind} · ${item.runtimeSource}` : item.kind;
          return `<li class="${edit ? "has-edit" : ""} ${thumbnail ? "has-thumbnail" : ""}">${thumbnail}<span><strong>${esc(item.name)}</strong><small>${esc(context)}</small></span><span class="performance-hotspot-value">${formatTimeMs(item.msAvg)}<small>${formatPercent(share)}</small></span>${edit}</li>`;
        }).join("")
      : `<li class="performance-empty-row">Waiting for an active renderer sample…</li>`;
    replaceHtmlIfChanged(refs.performanceSummaryContent, `
      <div class="performance-health-readouts">
        ${performanceReadoutTemplate("speed", "Overall", formatRenderCost(renderCost))}
        ${performanceReadoutTemplate("timer", "CPU", formatTimeMs(metric.cpuMs))}
        ${performanceReadoutTemplate("memory", "GPU", metric.gpuSupported ? formatTimeMs(metric.gpuMs) : "—")}
        ${performanceReadoutTemplate("open_in_new", "Output", outputConnected ? `${Math.round(outputFps)} fps` : "—")}
        ${performanceReadoutTemplate("cached", "Cache reuse", String(cacheHits))}
        ${performanceReadoutTemplate("refresh", "Renders", String(cacheRenders))}
      </div>
      <ol class="performance-hotspot-list" data-scroll-region data-scroll-key="performance-hotspots">${rows}</ol>
    `);
    refs.performanceAnalyze.disabled = performanceSession.isActive();
  }

  function showPerformanceResults(report) {
    const runtime = report.analysis?.runtime || {};
    const host = report.host || {};
    const runtimeProfile = runtime.profile || {};
    const cacheHits = (runtimeProfile.componentCacheHitsAvg || 0) + (runtimeProfile.stageCacheHitsAvg || 0);
    const cacheRenders = (runtimeProfile.componentRendersAvg || 0) + (runtimeProfile.stageRendersAvg || 0);
    const cacheReusePercent = cacheHits + cacheRenders > 0 ? cacheHits / (cacheHits + cacheRenders) * 100 : 0;
    const hotspots = runtime.profile?.hotPasses || [];
    const hotspotRows = hotspots.length
      ? hotspots.slice(0, 12).map((item, index) => {
        const thumbnail = performanceComponentThumbnail(latestState, item.componentId, "performance-analysis-thumbnail");
        return `
          <tr>
            <td>${index + 1}</td>
            <td><span class="performance-pass-cell">${thumbnail}<span><strong>${esc(item.name)}</strong><small>${esc(item.kind)}</small></span></span></td>
            <td>${formatTimeMs(item.msAvg)}</td>
            <td>${formatTimeMs(item.msP95)}</td>
            <td>${formatTimeMs(item.msMax)}</td>
            <td>${item.sampleCount}</td>
          </tr>`;
      }).join("")
      : `<tr><td colspan="6">No attributed render passes were captured.</td></tr>`;
    const bottlenecks = (report.analysis?.bottlenecks || []).slice(0, 6);
    refs.performanceResultsHost.innerHTML = `
      <div class="modal-backdrop performance-results-backdrop" data-performance-close></div>
      <section class="modal-panel performance-results-modal" role="dialog" aria-modal="true" aria-label="Performance analysis">
        <header class="modal-header">
          <div><strong>Performance analysis</strong><small>10 second sampled report · ${runtime.sampleCount || 0} metric samples</small></div>
          <button type="button" class="icon-buttonish" data-performance-close aria-label="Close">${icon("close")}</button>
        </header>
        <div class="performance-results-body" data-scroll-region data-scroll-key="performance-results">
          <div class="performance-result-cards">
            <div><small>FPS average</small><strong>${formatNumber(runtime.fpsAvg, 1)}</strong></div>
            <div><small>CPU frame p95</small><strong>${formatTimeMs(runtime.frameMsP95)}</strong></div>
            <div><small>GPU timer average</small><strong>${runtime.gpuSampleCount ? formatTimeMs(runtime.gpuMsAvg) : "--"}</strong></div>
            <div><small>Frame budget p95</small><strong>${formatPercent((runtime.renderCostP95 || 0) * 100)}</strong></div>
            <div><small>UI rebuild p95</small><strong>${host.uiRenderCount ? formatTimeMs(host.uiRenderMsP95) : "--"}</strong></div>
            <div><small>Main-thread blocks</small><strong>${host.longTaskCount || 0}</strong></div>
            <div><small>Event-loop lag p95</small><strong>${formatTimeMs(host.eventLoopLagMsP95)}</strong></div>
            <div><small>Render cache reuse</small><strong>${formatPercent(cacheReusePercent)}</strong></div>
          </div>
          <div class="performance-results-section">
            <h3>Attributed CPU hotspots</h3>
            <p>Average, p95, and maximum duration for the bounded diagnostic pass samples. Component rows include their child work.</p>
            <div class="performance-table-scroll" data-scroll-region data-scroll-key="performance-results-table"><table><thead><tr><th>#</th><th>Pass</th><th>Avg</th><th>P95</th><th>Max</th><th>N</th></tr></thead><tbody>${hotspotRows}</tbody></table></div>
          </div>
          ${bottlenecks.length ? `<div class="performance-results-section"><h3>Observations</h3><ul>${bottlenecks.map((item) => `<li><strong>${esc(item.scope)}</strong> · ${esc(item.message)}</li>`).join("")}</ul></div>` : ""}
          <div class="performance-results-section"><h3>Host / UI activity</h3><p>${host.uiRenderCount || 0} full UI rebuilds · ${host.stateEventCount || 0} state notifications · ${host.longTaskTotalMs ? `${formatTimeMs(host.longTaskTotalMs)} blocked in long tasks` : "no long tasks observed"}${host.memoryDeltaBytes === null ? "" : ` · ${formatBytesSigned(host.memoryDeltaBytes)} JS heap change`}</p>${host.topStateEvents?.length ? `<ul>${host.topStateEvents.map((item) => `<li>${esc(item.reason)} · ${item.count}</li>`).join("")}</ul>` : ""}</div>
          <p class="performance-method-note">GPU time is an aggregate of completed non-overlapping WebGL timer queries. Exact per-pass GPU profiling is not run continuously because it changes the workload being measured.</p>
        </div>
        <footer class="performance-results-actions">
          <button type="button" data-performance-close>Close</button>
          <button type="button" class="is-active" data-performance-download>${icon("download")} Download report</button>
        </footer>
      </section>`;
  }

  function handlePerformanceResultsClick(event) {
    if (event.target.closest("[data-performance-download]")) {
      const report = globalThis.__vj1LastProfileReport;
      if (report) downloadPerformanceProfile(report, latestState.project?.name || "vj1");
      return;
    }
    if (event.target.closest("[data-performance-close]")) refs.performanceResultsHost.innerHTML = "";
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
    else if (result?.loaded === false) setStatus(result.error || "Project loading was blocked; no files were changed.");
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
    const hasFolderAccess = projectService.hasOpenFolder?.() ?? hasProject;
    const projectName = hasProject ? (state.project.name || state.project.folderName || "VJ1") : "No project open";
    const projectMeta = (hasProject && !hasFolderAccess
      ? `Read-only recovery from Output. Click the folder button to restore access to ${state.project.folderName || projectName}.`
      : state.project.warnings?.[0]) || (
      hasProject && state.project.folderName && state.project.folderName !== projectName
        ? state.project.folderName
        : ""
    );
    setText(refs.projectName, projectName);
    setText(refs.projectMeta, hasProject ? projectMeta : "Choose a folder to begin");
    setClass(refs.projectMeta, "is-hidden", hasProject && !projectMeta);
    setClass(refs.closeProject, "is-hidden", !hasProject);
    setClass(refs.returnFromDeepEdit, "is-hidden", !hasProject || !deepEditReturnContext);
    diagnosticsController.render();
    if (refs.returnFromDeepEdit && deepEditReturnContext) {
      const label = workspaceLabel(deepEditReturnContext.workspace);
      refs.returnFromDeepEdit.title = `Return to ${label}`;
      refs.returnFromDeepEdit.setAttribute("aria-label", `Return to ${label}`);
    }
    const outputConnected = state.metrics.clients > 0;
    const outputFps = outputConnected ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
    setClass(refs.outputStatus, "is-live", outputConnected);
    setText(refs.outputStatusText, outputConnected ? `${Math.round(outputFps)}` : "-");
    const renderCost = activeRenderCost(state);
    setClass(refs.renderCost, "is-active", performanceSession.isActive());
    const profileSeconds = performanceSession.remainingSeconds();
    const workMetric = activeWorkMetric(state, outputFps);
    const frameInterval = frameTimeFromFps(workMetric.fps);
    setPerformanceHealthDot(refs.renderCostDot, renderCost);
    setPerformanceHealthDot(refs.cpuTimeDot, frameInterval > 0 ? workMetric.cpuMs / frameInterval : 0);
    setPerformanceHealthDot(refs.gpuTimeDot, frameInterval > 0 ? workMetric.gpuMs / frameInterval : 0, workMetric.gpuSupported);
    const healthTitle = performanceSession.isActive()
      ? `Profiling rendering… ${profileSeconds} second${profileSeconds === 1 ? "" : "s"} remaining`
      : `Overall ${formatRenderCost(renderCost)} · CPU ${formatTimeMs(workMetric.cpuMs)} · GPU ${workMetric.gpuSupported ? formatTimeMs(workMetric.gpuMs) : "unavailable"} · Output ${outputConnected ? `${Math.round(outputFps)} fps` : "closed"}`;
    refs.renderCost.title = healthTitle;
    refs.renderCost.setAttribute("aria-label", healthTitle);
    // Output metrics may arrive between pointerdown and click. Preserve the
    // interactive subtree until the browser finishes that event sequence.
    if (!refs.performanceSummary.classList.contains("is-hidden") && !shouldDeferRender()) renderPerformanceSummary(state);
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.toggleOutputHud, "is-active", state.global.showHud !== false);
    const outputPlaying = state.global.playing !== false;
    refs.toggleOutputPlayback.disabled = !hasProject;
    refs.toggleOutputPlayback.title = outputPlaying ? "Pause playback" : "Play playback";
    refs.toggleOutputPlayback.setAttribute("aria-label", refs.toggleOutputPlayback.title);
    setText(refs.toggleOutputPlayback.querySelector(".material-symbols-rounded"), outputPlaying ? "pause" : "play_arrow");
    setClass(refs.toggleOutputPlayback, "is-active", hasProject && !outputPlaying);
    setClass(refs.blackout, "is-active", state.global.blackout);
    setClass(refs.blackout, "is-output-enabled", !state.global.blackout);
    renderOutputMenu(state);
    refs.undo.disabled = !state.ui.canUndo;
    refs.redo.disabled = !state.ui.canRedo;
    refs.workspaceButtons.forEach((button) => {
      button.disabled = !hasProject;
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function openOutputWindows(state, outputs = []) {
    // Opening a display is infrastructure, not a Live performance command.
    // The popup receives the existing Live program through the output bridge;
    // editor selection must never change the program Scene as a side effect.
    for (const output of outputs) {
      window.open(
        buildOutputUrl("output", { outputId: output.id }),
        `vj1-output-${output.id}`,
        "popup=yes"
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
    const signature = JSON.stringify(menuOutputs.map((output) => [output.id, output.name, output.aspectRatio]));
    if (refs.outputMenuItems.dataset.outputsSignature !== signature) {
      refs.outputMenuItems.dataset.outputsSignature = signature;
      refs.outputMenuItems.innerHTML = menuOutputs.map((output) => `
        <button type="button" data-open-output-id="${esc(output.id)}">
          <span></span><small>${formatOutputAspect(output.aspectRatio)}</small>
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
    if (["component", "scene", "mapping"].includes(workspace)) captureCatalogOrder(workspace, state);
    if (workspace === "mapping") captureCatalogOrder("source", state);
    if (workspace === "live") captureCatalogOrder("live", state);
  }

  function invalidateCatalogOrder() {
    activeCatalogViewKey = "";
    catalogOrderSnapshots.component = [];
    catalogOrderSnapshots.scene = [];
    catalogOrderSnapshots.mapping = [];
    catalogOrderSnapshots.live = [];
    catalogOrderSnapshots.source = [];
  }

  function captureCatalogOrder(scope, state) {
    const items = scope === "mapping"
      ? state.mappings || []
      : scope === "live"
        ? [...sceneComponents(state), ...ordinaryComponents(state)]
        : scope === "source"
          ? sceneSourceNodes(state)
          : scope === "scene"
            ? sceneComponents(state)
            : ordinaryComponents(state);
    catalogOrderSnapshots[scope] = sortComponentCatalog(items, catalogSortMode(state, scope)).map((item) => item.id);
  }

  function catalogSortMode(state, scope) {
    const mode = state.ui?.catalogSortModes?.[scope];
    return ["recent", "marker", "name", "created"].includes(mode) ? mode : "recent";
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
        if (!["component", "scene", "mapping", "live", "source", "media"].includes(catalog) || !["recent", "marker", "name", "created"].includes(mode)) return;
        updateUi((ui) => {
          ui.catalogSortModes ||= { component: "recent", scene: "recent", mapping: "recent", live: "recent", source: "recent", media: "recent" };
          ui.catalogSortModes[catalog] = mode;
        }, `catalog-sort:${catalog}`);
        if (catalog !== "media") captureCatalogOrder(catalog, latestState);
        if (catalog === "source") renderInspector(latestState);
        else if (catalog === "component" || catalog === "scene" || catalog === "mapping") renderProjectRail(latestState);
      });
    });
  }

  function renderProjectRail(state) {
    const hasProject = hasOpenProject(state);
    const workspace = currentWorkspace(state);
    refs.projectRail.dataset.workspace = workspace;
    const html = hasProject
      ? workspace === "nodes"
        ? nodeLibraryRailTemplate(state, editorNodePackage)
        : projectRailTemplate(state, {
          workspace,
          // Selection belongs to the editor projection, not the catalog
          // topology. Keeping it out of the catalog HTML preserves every card
          // and thumbnail DOM node when the operator changes focus.
          renderSelection: false,
          catalogItems: (scope, items) => catalogItemsInSnapshot(scope, items),
          catalogSortMode: (scope) => catalogSortMode(state, scope),
          transitionEntries: workspace === "live"
            ? transitionEntriesForState(state)
            : null,
        })
      : "";
    if (replaceHtmlIfChanged(refs.projectRail, html, { scrollKey: `project-rail:${workspace}` })) bindRailEvents();
    patchProjectRailSelection(state);
  }

  function patchProjectRailSelection(state) {
    patchSelectedItems("[data-select-component]", state.ui?.selectedComponentId);
    patchSelectedItems("[data-select-surface]", state.ui?.selectedSurfaceId, { includeRow: true });
    patchSelectedItems("[data-select-mapping]", state.ui?.selectedMappingId, { includeRow: true });
  }

  function patchSelectedItems(selector, selectedId, { includeRow = false } = {}) {
    refs.projectRail?.querySelectorAll?.(selector).forEach((item) => {
      const attribute = selector.slice(1, -1);
      const selected = String(item.getAttribute(attribute) || "") === String(selectedId || "");
      item.classList.toggle("is-selected", selected);
      if (includeRow) item.closest(".text-list-item")?.classList.toggle("is-selected", selected);
    });
  }

  function transitionEntriesForState(state) {
    const installedPackages =
      projectService.getInstalledNodePackages?.() || [];
    if (
      state.nodes === liveTransitionNodes &&
      installedPackages === liveTransitionPackages
    ) return liveTransitionEntries;
    liveTransitionNodes = state.nodes;
    liveTransitionPackages = installedPackages;
    liveTransitionEntries = resolveProjectVisualTransitionEntries(state, {
      installedPackages,
    });
    return liveTransitionEntries;
  }

  function renderLiveProjectionRail(state) {
    const workspace = currentWorkspace(state);
    refs.studioLayout.dataset.workspace = workspace;
    refs.liveProjectionRail.dataset.workspace = workspace;
    const html = hasOpenProject(state) && workspace === "live"
      ? liveProjectionRailTemplate(state)
      : "";
    if (replaceHtmlIfChanged(refs.liveProjectionRail, html, { scrollKey: "live-projection-rail" })) {
      refs.liveProjectionRail.querySelectorAll("[data-live-preview-surface]").forEach((button) => {
        button.addEventListener("click", () => store.selectLivePreviewSurface?.(button.dataset.livePreviewSurface));
      });
      refs.liveProjectionRail.querySelectorAll("[data-live-surface-visibility]").forEach((button) => {
        button.addEventListener("click", () => store.toggleLiveSurfaceVisibility?.(button.dataset.liveSurfaceVisibility));
      });
      refs.liveProjectionRail.querySelectorAll("[data-clear-live-surface-patch]").forEach((button) => {
        button.addEventListener("click", () => store.clearLiveSurfacePatch?.(button.dataset.clearLiveSurfacePatch));
      });
      refs.liveProjectionRail.querySelectorAll("[data-clear-live-overall-component]").forEach((button) => {
        button.addEventListener("click", () => store.clearLiveOverallComponent?.());
      });
      refs.liveProjectionRail.querySelectorAll("[data-live-component]").forEach((button) => {
        button.addEventListener("click", () => updateUi((ui) => {
          ui.live ||= {};
          ui.live.inspectedComponentId = button.dataset.liveComponent;
        }, "select-live-inspected-component"));
      });
    }
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
    if (currentWorkspace(state) === "nodes") {
      embeddedPreview.pause();
      if (replaceHtmlIfChanged(refs.studio, nodeLibraryStudioTemplate(state, editorNodePackage), { scrollKey: "node-library-workspace" })) bindStudioEvents();
      return;
    }
    if (previewLayoutQuery?.matches) {
      embeddedPreview.pause();
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

  function renderPreview(state, context = {}) {
    if (currentWorkspace(state) === "nodes" || previewLayoutQuery?.matches) return;
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    if (!previewHost || previewHost.classList.contains("is-empty")) return;
    const workspace = currentWorkspace(state);
    const kind = workspace === "component" || workspace === "scene"
      ? "component"
      : workspace === "live"
        ? "live"
        : "preview";
    const previewState = workspace === "live"
      ? createLiveScenePreviewState(state)
      : workspace === "mapping"
        ? store.getMappingRenderState(state.ui.selectedMappingId)
        : state;
    if (!previewHost.querySelector("[data-embedded-preview-stage]")) {
      replaceHtmlIfChanged(previewHost, `
        <div class="embedded-preview-stage" data-embedded-preview-stage></div>
        <div class="preview-tools">
          <button type="button" class="preview-tool" data-preview-zoom-out title="Zoom out" aria-label="Zoom out">${icon("remove")}</button>
          <button type="button" class="preview-tool" data-preview-fit-world title="Fit world" aria-label="Fit world">${icon("public")}</button>
          <button type="button" class="preview-tool" data-preview-fit-frame title="Fit outputs" aria-label="Fit outputs">${icon("fit_screen")}</button>
          <button type="button" class="preview-tool" data-preview-zoom-in title="Zoom in" aria-label="Zoom in">${icon("add")}</button>
          <button type="button" class="preview-tool" data-preview-diagnostics title="Preview scaling diagnostics" aria-label="Preview scaling diagnostics">${icon("developer_mode")}</button>
          <button type="button" class="preview-tool preview-quality-tool is-hidden" data-preview-quality title="Preview resolution" aria-label="Preview resolution"><span data-preview-quality-label>Auto</span></button>
          <button type="button" class="preview-tool" data-toggle-mapping-handles title="Toggle mapping handles" aria-label="Toggle mapping handles">${icon("control_point_duplicate")}</button>
          <div class="preview-fps" data-preview-fps>0 fps</div>
        </div>
      `);
    }
    bindPreviewViewportTools(previewHost);
    setClass(previewHost.querySelector("[data-preview-diagnostics]"), "is-active", state.ui?.previewDiagnostics === true);
    const handleButton = previewHost.querySelector("[data-toggle-mapping-handles]");
    setClass(handleButton, "is-active", state.global.mappingHandleMode !== "near");
    setClass(handleButton, "is-hidden", kind !== "preview");
    const qualityButton = previewHost.querySelector("[data-preview-quality]");
    const supportsPreviewQuality = ["component", "scene", "mapping", "live"].includes(workspace);
    const previewQuality = ["auto", "good", "low"].includes(state.ui?.previewQuality)
      ? state.ui.previewQuality
      : "good";
    const qualityLabels = { auto: "Auto", good: "Good", low: "Low" };
    const qualitySubject = workspace === "scene"
      ? "Scene"
      : workspace === "component"
        ? "Component"
        : workspace === "live"
          ? "Live"
          : "Mapping";
    const qualityDescriptions = {
      auto: `Auto: ${qualitySubject} preview adapts to its visible size`,
      good: `Good: ${qualitySubject} preview matches the display's native density`,
      low: `Low: ${qualitySubject} preview reduces GPU work for heavy compositions`,
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
      activation: previewActivationForContext(context),
    });
  }

  function updatePreviewState(state, activation = "full") {
    const workspace = currentWorkspace(state);
    if (workspace === "nodes" || previewLayoutQuery?.matches) return;
    const kind = workspace === "component" || workspace === "scene"
      ? "component"
      : workspace === "live"
        ? "live"
        : "preview";
    const previewState = workspace === "live"
      ? createLiveScenePreviewState(state)
      : workspace === "mapping"
        ? store.getMappingRenderState(state.ui.selectedMappingId)
        : state;
    embeddedPreview.setState(previewState, kind, { activation });
  }

  function renderInspector(state) {
    refs.inspector.dataset.workspace = currentWorkspace(state);
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      rememberParamViewSelections(refs.inspector, activeParamViews);
      replaceHtmlIfChanged(refs.inspector, "");
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    let html = "";
    if (currentWorkspace(state) === "nodes") {
      html = panelTemplate("schema", "Node editor", nodeLibraryInspectorTemplate(state, editorNodePackage));
      replaceInspectorHtml(html, state);
      return;
    }
    if (currentWorkspace(state) === "component") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      html = `${panelTemplate(
        UI_ICONS.component,
        selectedComponent?.name || "Component",
        selectedComponent ? componentTemplate(selectedComponent, state) : emptyNote("No component"),
        selectedComponent ? {
          titlePath: `${pathForComponent(state, selectedComponent)}.name`,
          headerActionHtml: componentHeaderAddButtonTemplate(selectedComponent),
        } : {}
      )}${selectedComponent ? componentSelectedChainSettingsTemplate(selectedComponent, state, {
        nodeEditorHtml: selectedNodeEditorTemplate(selectedComponent, state, editorNodePackage),
      }) : ""}`;
      replaceInspectorHtml(html, state);
      return;
    }
    if (currentWorkspace(state) === "scene") {
      const selectedScene = selectedSceneComponent(state);
      const selectedSceneSurface = state.ui.sceneInspectorTarget === "surface"
        ? state.surfaces?.find((surface) => surface.id === state.ui.selectedSurfaceId) || null
        : null;
      html = `${panelTemplate(
        UI_ICONS.scene,
        selectedScene?.name || "Scene",
        selectedScene ? sceneInspectorTemplate(selectedScene, state) : emptyNote("Create a scene"),
        selectedScene ? {
          titlePath: `${pathForComponent(state, selectedScene)}.name`,
          headerActionHtml: componentHeaderAddButtonTemplate(selectedScene),
        } : {}
      )}${selectedScene && selectedSceneSurface
        ? panelTemplate(UI_ICONS.surface, selectedSceneSurface.name || "Surface", sceneSurfaceInspectorTemplate(selectedSceneSurface, state), selectedSceneSurface.destination?.type !== "direct" ? {
          titlePath: `${pathForSurface(state, selectedSceneSurface)}.name`,
          className: "scene-surface-panel",
        } : { className: "scene-surface-panel" })
        : selectedScene ? componentSelectedChainSettingsTemplate(selectedScene, state, {
          nodeEditorHtml: selectedNodeEditorTemplate(selectedScene, state, editorNodePackage),
        }) : ""}`;
      replaceInspectorHtml(html, state);
      return;
    }
    if (currentWorkspace(state) === "live") {
      html = liveInspectorTemplate(state);
      replaceInspectorHtml(html, state);
      return;
    }
    html = `
      ${panelTemplate(UI_ICONS.surface, selectedSurface?.name || "Surface", selectedSurface ? mappingSurfaceTemplate(selectedSurface, state, {
        sources: catalogItemsInSnapshot("source", sceneSourceNodes(state)),
        sortMode: catalogSortMode(state, "source"),
      }) : emptyNote("No surface"), selectedSurface && selectedSurface.destination?.type !== "direct"
        ? { titlePath: `${pathForSurface(state, selectedSurface)}.name` }
        : {})}
    `;
    replaceInspectorHtml(html, state);
  }

  function replaceInspectorHtml(html, state) {
    rememberParamViewSelections(refs.inspector, activeParamViews);
    if (!replaceHtmlIfChanged(refs.inspector, html, { scrollKey: `inspector:${currentWorkspace(state)}` })) return false;
    restoreParamViewSelections(refs.inspector, activeParamViews);
    replaceHtmlIfChanged.restoreScrollRegions(refs.inspector);
    bindInputs(refs.inspector, state);
    return true;
  }

  function bindRailEvents() {
    inputs.bind(refs.projectRail);
    bindNodeLibraryFilter(refs.projectRail);
    refs.projectRail.querySelector("[data-scene-mapping-in-live]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      store.setSceneMappingInLive?.(event.currentTarget.dataset.sceneMappingInLive !== "true");
    });
    refs.projectRail.querySelectorAll("[data-create-project-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const scene3d = button.dataset.createProjectGroup === "scene3d";
        const kindName = scene3d ? "3D Group" : "Visual Group";
        const name = globalThis.prompt?.(`${kindName} name`, scene3d ? "3D Scene Group" : "Visual Group")?.trim();
        if (!name) return;
        const used = new Set((latestState.nodes?.definitions || []).map((definition) => definition.id));
        const baseId = `org.vj1.project.${packageIdentifier(name)}`;
        let id = baseId;
        let index = 2;
        while (used.has(id) || editorNodePackage?.registry?.has?.(id)) id = `${baseId}-${index++}`;
        try {
          const definition = scene3d
            ? nodePackage.createProjectScene3dGroupDefinition({ id, name })
            : nodePackage.createProjectVisualGroupDefinition({ id, name });
          store.update((draft) => {
            draft.nodes.definitions = [...(draft.nodes.definitions || []), definition];
            draft.ui.selectedNodeDefinitionId = id;
            draft.ui.selectedNodeGroupId = "";
          }, `update:create-project-${scene3d ? "scene3d" : "visual"}-group`);
          setStatus(scene3d
            ? `${name} created · its mesh, material, camera, Scene, and image nodes compile into retained 3D render steps`
            : `${name} created · drag visual nodes into its graph`);
        } catch (error) {
          setStatus(`${kindName} was not created: ${error?.message || error}`);
        }
      });
    });
    refs.projectRail.querySelectorAll("[data-select-node-definition]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.selectedNodeDefinitionId = button.dataset.selectNodeDefinition;
        ui.selectedNodeGroupId = "";
      }, "select-node-definition"));
    });
    refs.projectRail.querySelectorAll("[data-select-node-group]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.selectedNodeGroupId = button.dataset.selectNodeGroup;
      }, "select-node-group"));
    });
    refs.projectRail.querySelector("[data-node-package-export]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        const selection = selectedProjectPackageExport(latestState, editorNodePackage);
        const suggestedId = `org.vj1.project.${packageIdentifier(latestState.project?.name || "visual")}`;
        const id = globalThis.prompt?.("Stable package ID", suggestedId)?.trim();
        if (!id) return;
        const version = globalThis.prompt?.("Exact package version", "0.1.0")?.trim();
        if (!version) return;
        const name = globalThis.prompt?.("Package name", selection.name)?.trim() || selection.name;
        button.disabled = true;
        const encoded = nodePackage.exportProjectPackage(latestState, {
          id,
          version,
          name,
          description: `Reusable VJ1 package exported from ${selection.name}.`,
          ...selection.manifest,
        });
        const path = await projectService.writeNodePackageManifest(encoded);
        setStatus(`Package written to ${path}`);
      } catch (error) {
        button.disabled = false;
        setStatus(`Package was not exported: ${error?.message || error}`);
      }
    });
    refs.projectRail.querySelector("[data-node-package-import]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const confirmed = typeof globalThis.confirm !== "function"
        || globalThis.confirm("Import this node package? Node packages may contain executable JavaScript. Only import packages you trust.");
      if (!confirmed) return;
      button.disabled = true;
      try {
        const imported = await projectService.importNodePackageFolder();
        setStatus(`${imported.id}@${imported.version} imported; choose Install to activate it`);
      } catch (error) {
        button.disabled = false;
        if (error?.name !== "AbortError") {
          setStatus(`Package was not imported: ${error?.message || error}`);
        }
      }
    });
    refs.projectRail.querySelectorAll("[data-node-package-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        const packageId = button.dataset.nodePackageToggle || "";
        const enable = button.dataset.nodePackageEnabled !== "true";
        button.disabled = true;
        try {
          await projectService.setNodePackageEnabled(packageId, enable);
          setStatus(`${packageId} ${enable ? "enabled" : "disabled"}`);
        } catch (error) {
          button.disabled = false;
          setStatus(`${packageId} was not ${enable ? "enabled" : "disabled"}: ${error?.message || error}`);
        }
      });
    });
    refs.projectRail.querySelectorAll("[data-node-package-install]").forEach((button) => {
      button.addEventListener("click", async () => {
        const packageId = button.dataset.nodePackageInstall || "";
        const version = [...refs.projectRail.querySelectorAll("[data-node-package-version-select]")]
          .find((select) => select.dataset.nodePackageVersionSelect === packageId)?.value || "";
        button.disabled = true;
        try {
          await projectService.installNodePackage(packageId, version);
          setStatus(`${packageId}@${version} is active for this project`);
        } catch (error) {
          button.disabled = false;
          setStatus(`${packageId}@${version} was not installed: ${error?.message || error}`);
        }
      });
    });
    refs.projectRail.querySelectorAll("[data-node-package-export-folder]").forEach((button) => {
      button.addEventListener("click", async () => {
        const packageId = button.dataset.nodePackageExportFolder || "";
        const version = [...refs.projectRail.querySelectorAll("[data-node-package-version-select]")]
          .find((select) => select.dataset.nodePackageVersionSelect === packageId)?.value
          || button.dataset.nodePackageVersion
          || "";
        button.disabled = true;
        try {
          const exported = await projectService.exportNodePackageFolder(packageId, version);
          setStatus(`${exported.id}@${exported.version} exported to ${exported.path}`);
        } catch (error) {
          button.disabled = false;
          if (error?.name !== "AbortError") {
            setStatus(`Package was not exported: ${error?.message || error}`);
          }
        }
      });
    });
    refs.projectRail.querySelectorAll("[data-node-package-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        const packageId = button.dataset.nodePackageRemove || "";
        const confirmed = typeof globalThis.confirm !== "function"
          || globalThis.confirm(`Remove ${packageId} from this project? Package files will remain in the folder.`);
        if (!confirmed) return;
        button.disabled = true;
        try {
          await projectService.removeNodePackage(packageId);
          setStatus(`${packageId} project reference removed`);
        } catch (error) {
          button.disabled = false;
          setStatus(`${packageId} was not removed: ${error?.message || error}`);
        }
      });
    });
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelectorAll("[data-add-component]").forEach((button) => {
      button.addEventListener("click", () => store.addComponent());
    });
    refs.projectRail.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
    refs.projectRail.querySelector("[data-add-mapping]")?.addEventListener("click", () => {
      const name = `Map ${latestState.mappings.length + 1}`;
      store.addMapping(name);
    });
    refs.projectRail.querySelectorAll("[data-select-mapping]").forEach((button) => {
      button.addEventListener("click", () => store.selectMapping(button.dataset.selectMapping));
    });
    refs.projectRail.querySelectorAll("[data-live-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectLiveScene(button.dataset.liveScene));
    });
    refs.projectRail.querySelectorAll("[data-live-target-component]").forEach((button) => {
      button.addEventListener("click", () => store.selectLiveComponent?.(button.dataset.liveTargetComponent));
    });
    refs.projectRail.querySelectorAll("[data-live-source-filter]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.live ||= {};
        const key = button.dataset.liveSourceFilter === "components" ? "showComponents" : "showScenes";
        const otherKey = key === "showScenes" ? "showComponents" : "showScenes";
        const next = !ui.live[key];
        // Keep at least one catalog visible; both may be enabled.
        if (!next && !ui.live[otherKey]) return;
        ui.live[key] = next;
      }, "live-source-filter"));
    });
    refs.projectRail.querySelectorAll("[data-live-component]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.live ||= {};
        ui.live.inspectedComponentId = button.dataset.liveComponent;
      }, "select-live-inspected-component"));
    });
    refs.projectRail.querySelectorAll("[data-reset-live-scene]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        store.resetLiveScene?.(button.dataset.resetLiveScene);
      });
    });
    refs.projectRail.querySelectorAll("[data-delete-mapping]").forEach((button) => {
      button.addEventListener("click", () => store.deleteMapping(button.dataset.deleteMapping));
    });
    bindCatalogMarkerControls(refs.projectRail);
    refs.projectRail.querySelectorAll("[data-surface-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        onReorder: (fromId, toId) => store.reorderSurfaces?.(fromId, toId),
      });
    });
  }

  function bindCatalogMarkerControls(scope) {
    scope?.querySelectorAll?.("[data-cycle-catalog-marker]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const kind = button.dataset.cycleCatalogMarker || "component";
        const id = button.dataset.catalogMarkerId || "";
        if (!store.cycleCatalogMarker?.(kind, id)) return;
        if (kind !== "media") {
          const catalog = kind === "mapping" ? "mapping" : latestState.components.find((item) => item.id === id)?.type === "scene" ? "scene" : "component";
          captureCatalogOrder(catalog, latestState);
          if (kind === "component") captureCatalogOrder("source", latestState);
        }
        renderProjectRail(latestState);
        if (scope === refs.inspector) renderInspector(latestState);
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
    bindButton("[data-preview-diagnostics]", () => {
      updateUi((ui) => {
        ui.previewDiagnostics = ui.previewDiagnostics !== true;
      }, "preview-diagnostics");
    });
    bindButton("[data-preview-quality]", () => {
      store.update((draft) => {
        if (!["component", "scene", "mapping", "live"].includes(currentWorkspace(draft))) return;
        draft.ui.previewQuality = nextPreviewQuality(draft.ui.previewQuality);
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
        updatePreviewViewportForUi(ui, fitPreviewViewport({
          workspace: currentWorkspace(latestState),
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
    bindNodeGraphCanvas(refs.studio, {
      registry: editorNodePackage?.registry,
      onStatus: setStatus,
      onMediaParameterRequest: ({ accept, apply }) => {
        modals.openMediaPicker("", accept, apply);
      },
      onPublicParameterToggle: ({ nodeId, parameterId, publicParameterId }) => {
        const target = selectedNodeWorkspaceTarget(latestState, editorNodePackage);
        if (target?.kind !== "definition" || target.baseDefinition?.metadata?.projectOwned !== true) {
          setStatus("Only project-owned Groups can publish new controls");
          return;
        }
        const graph = target.definition.parts?.find((part) => part.kind === "graph");
        const child = graph?.nodes?.find((node) => String(node.id || "") === String(nodeId || ""));
        let childDefinition = null;
        try {
          childDefinition = editorNodePackage?.registry?.get?.(
            child?.type || child?.nodeId,
            child?.version || child?.nodeVersion || "",
          );
        } catch {}
        const parameter = childDefinition?.parameters?.[parameterId] ||
          childDefinition?.inlets?.[parameterId];
        if (!parameter) {
          setStatus(`Public control was not updated: configurable value ${nodeId}.${parameterId} is unavailable`);
          return;
        }
        const response = globalThis.prompt?.(
          "Public control ID (clear to make internal)",
          publicParameterId || packageIdentifier(`${nodeId}-${parameterId}`),
        );
        if (response == null) return;
        const nextPublicId = response.trim();
        const exposed = !!nextPublicId;
        try {
          const nextNodes = prepareProjectNodeDefinitionEdit(
            withProjectNodeParameterExposure(latestState.nodes, target.baseDefinition, {
              nodeId,
              parameterId,
              publicParameterId: nextPublicId,
              parameter,
              sectionLabel: childDefinition.name,
              exposed,
            }),
            target.baseDefinition,
            { preflight: editorNodePackage?.preflightGraphEdit },
          );
          store.update((draft) => {
            draft.nodes = nextNodes;
          }, `update:${exposed ? "publish" : "unpublish"}-node-parameter`);
          setStatus(exposed
            ? `${parameter.label || parameterId} is now public as ${nextPublicId}`
            : `${parameter.label || parameterId} is internal again`);
        } catch (error) {
          setStatus(`Public control was not updated: ${error?.message || error}`);
        }
      },
      onPublicPortToggle: ({ nodeId, portId, direction, publicPortId }) => {
        const target = selectedNodeWorkspaceTarget(latestState, editorNodePackage);
        if (target?.kind !== "definition" || target.baseDefinition?.metadata?.projectOwned !== true) {
          setStatus("Only project-owned Groups can publish ports");
          return;
        }
        const graph = target.definition.parts?.find((part) => part.kind === "graph");
        const child = graph?.nodes?.find((node) => String(node.id || "") === String(nodeId || ""));
        let childDefinition = null;
        try {
          childDefinition = editorNodePackage?.registry?.get?.(
            child?.type || child?.nodeId,
            child?.version || child?.nodeVersion || "",
          );
        } catch {}
        const role = direction === "outlet" ? "outlet" : "inlet";
        const port = role === "outlet"
          ? childDefinition?.outlets?.[portId]
          : childDefinition?.inlets?.[portId];
        if (!port) {
          setStatus(`Public port was not updated: ${role} ${nodeId}.${portId} is unavailable`);
          return;
        }
        const response = globalThis.prompt?.(
          `Public ${role} ID (clear to make internal)`,
          publicPortId || packageIdentifier(`${nodeId}-${portId}`),
        );
        if (response == null) return;
        const nextPublicId = response.trim();
        const exposed = !!nextPublicId;
        try {
          const nextNodes = prepareProjectNodeDefinitionEdit(
            withProjectNodePortExposure(latestState.nodes, target.baseDefinition, {
              nodeId,
              portId,
              publicPortId: nextPublicId,
              port,
              direction: role,
              exposed,
            }),
            target.baseDefinition,
            { preflight: editorNodePackage?.preflightGraphEdit },
          );
          store.update((draft) => {
            draft.nodes = nextNodes;
          }, `update:${exposed ? "publish" : "unpublish"}-node-port`);
          setStatus(exposed
            ? `${port.label || portId} is now public as ${nextPublicId}`
            : `${port.label || portId} is internal again`);
        } catch (error) {
          setStatus(`Public port was not updated: ${error?.message || error}`);
        }
      },
      onGraphChange: (graph, action) => {
        const target = selectedNodeWorkspaceTarget(latestState, editorNodePackage);
        if (!target) return;
        try {
          const nextNodes = prepareProjectNodeGraphEdit(latestState.nodes, target, graph, {
            validate: action !== "move-node",
            preflight: editorNodePackage?.preflightGraphEdit,
          });
          store.update((draft) => {
            draft.nodes = nextNodes;
          }, `update:node-graph-${action}`);
          if (target.id === "vj1.application.program") {
            const activation = editorNodePackage?.applicationProgramStatus?.(store.getState());
            setStatus(activation?.valid === false
              ? `Application setup is incomplete: ${activation.error}`
              : activation?.requiresRestart
                ? "Application setup updated · reload after autosave to activate"
                : "Application setup graph updated");
          } else {
            setStatus(`${target.definition.name} graph updated`);
          }
        } catch (error) {
          setStatus(`${target.definition.name} graph was not updated: ${error?.message || "invalid graph"}`);
        }
      },
    });
  }

  function bindInputs(scope) {
    inputs.bind(scope);
    bindNodeEditorEvents(scope);
    bindCatalogMarkerControls(scope);
    scope.querySelectorAll("[data-live-component-view]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.live ||= {};
        ui.live.componentView = button.dataset.liveComponentView === "elements" ? "elements" : "controls";
      }, "select-live-component-view"));
    });
    scope.querySelectorAll("[data-live-chain-item]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.live ||= {};
        ui.live.selectedChainItemIds ||= {};
        ui.live.selectedChainItemIds[button.dataset.liveComponentId] = button.dataset.liveChainItem;
      }, "select-live-chain-item"));
    });
  }

  function bindNodeEditorEvents(scope) {
    if (!editorNodePackage?.registry) return;
    scope.querySelectorAll("[data-save-node-fork]").forEach((button) => {
      button.addEventListener("click", () => {
        const editor = button.closest("[data-node-editor]");
        if (!editor) return;
        let definition;
        try {
          definition = editorNodePackage.registry.get(editor.dataset.nodeBaseId, editor.dataset.nodeBaseVersion);
        } catch {
          setStatus("Node definition is no longer available");
          return;
        }
        const sources = {};
        for (const input of editor.querySelectorAll("[data-node-part-source]")) {
          if (!input.readOnly) sources[input.dataset.nodePartSource] = input.value;
        }
        try {
          const nextNodes = prepareProjectNodeDefinitionEdit(
            withProjectNodeFork(latestState.nodes, definition, sources),
            definition,
            { preflight: editorNodePackage?.preflightGraphEdit },
          );
          store.update((draft) => {
            draft.nodes = nextNodes;
          }, "update:node-fork");
          setStatus(`${definition.name} project version saved`);
        } catch (error) {
          setStatus(`${definition.name} project version was not saved: ${error?.message || "invalid source"}`);
        }
      });
    });
    scope.querySelectorAll("[data-reset-node-fork]").forEach((button) => {
      button.addEventListener("click", () => {
        const editor = button.closest("[data-node-editor]");
        if (!editor) return;
        let definition;
        try {
          definition = editorNodePackage.registry.get(editor.dataset.nodeBaseId, editor.dataset.nodeBaseVersion);
        } catch {
          return;
        }
        store.update((draft) => {
          draft.nodes = withoutProjectNodeFork(draft.nodes, definition);
        }, "update:node-fork-reset");
        setStatus(`${definition.name} restored to the built-in version`);
      });
    });
  }

  function resetProjectMapping(surfaceId = "") {
    store.update((draft) => {
      const mapping = draft.mappings.find((item) => item.id === draft.ui.selectedMappingId);
      if (!mapping) return;
      const mappedSurfaces = mapping.surfaces.filter((surface) => surface.destination?.type !== "direct");
      const defaults = defaultProjectSurfaceMapping(draft.render, mappedSurfaces);
      const existing = Array.isArray(mapping.calibration?.surfaces) ? mapping.calibration.surfaces : [];
      const existingById = new Map(existing.map((surface) => [surface.id || surface.name, surface]));
      const defaultById = new Map(defaults.map((surface) => [surface.id || surface.name, surface]));
      mapping.calibration = {
        ...(mapping.calibration || {}),
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

function formatOutputAspect(value) {
  const ratio = Number(value) || 16 / 9;
  const common = [[16 / 9, "16:9"], [4 / 3, "4:3"], [16 / 10, "16:10"], [1, "1:1"], [9 / 16, "9:16"]]
    .find(([candidate]) => Math.abs(candidate - ratio) < 0.001);
  return common?.[1] || `${Math.round(ratio * 1000) / 1000}:1`;
}

function refreshSelectedMappingProjection(state) {
  const mapping = getSelectedMapping(state);
  if (!mapping) return;
  projectSelectedMapping(state, mapping);
}


function nextPreviewQuality(value) {
  const quality = ["good", "low"].includes(value) ? value : "auto";
  return quality === "auto" ? "good" : quality === "good" ? "low" : "auto";
}

function currentWorkspace(state) {
  return WORKSPACES.includes(state.ui?.workspace) ? state.ui.workspace : "mapping";
}

function performanceComponentThumbnail(state, componentId, className) {
  const component = state.components?.find((item) => item.id === componentId);
  if (!component) return "";
  const fallbackIcon = componentTypeIcon(component);
  return `<span class="performance-component-thumbnail ${esc(className)}">${thumbnailTemplate(component.thumbnail, fallbackIcon)}</span>`;
}

function workspaceLabel(workspace) {
  if (workspace === "component") return "Components";
  if (workspace === "scene") return "Scenes";
  if (workspace === "live") return "Live";
  if (workspace === "nodes") return "Nodes";
  return "Mapping";
}

function hasOpenProject(state) {
  return !!state?.project?.folderName;
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

function selectedProjectPackageExport(state, nodePackage) {
  const target = selectedNodeWorkspaceTarget(state, nodePackage);
  if (!target) throw new Error("NODE_PACKAGE_EXPORT_SELECTION_REQUIRED");
  if (target.kind === "project-group") {
    return {
      name: target.group.name || target.group.id,
      manifest: { groupIds: [target.group.id] },
    };
  }
  const definition = target.baseDefinition;
  const localDefinition = (state.nodes?.definitions || []).find((item) =>
    item.id === definition.id && item.version === definition.version);
  const fork = (state.nodes?.forks || []).find((item) =>
    item.base?.id === definition.id && item.base?.version === definition.version);
  if (localDefinition) {
    return {
      name: definition.name || definition.id,
      manifest: {
        nodeIds: [{ id: definition.id, version: definition.version }],
        ...(fork ? { forkIds: [fork.id] } : {}),
      },
    };
  }
  if (fork) {
    return {
      name: fork.name || definition.name || fork.id,
      manifest: { forkIds: [fork.id] },
    };
  }
  throw new Error("NODE_PACKAGE_EXPORT_REQUIRES_PROJECT_OWNED_SELECTION");
}

function packageIdentifier(value) {
  return String(value || "visual")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "visual";
}

function formatNumber(value, precision = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(precision) : "--";
}

function formatPercent(value) {
  const number = Math.max(0, Number(value) || 0);
  return `${number > 0 && number < 10 ? number.toFixed(1) : Math.round(number)}%`;
}

function formatBytesSigned(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "unknown";
  const sign = bytes > 0 ? "+" : bytes < 0 ? "−" : "";
  const absolute = Math.abs(bytes);
  const amount = absolute >= 1024 * 1024 ? `${(absolute / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(absolute / 1024)} KB`;
  return `${sign}${amount}`;
}

function performanceReadoutTemplate(iconName, label, value) {
  return `<span class="performance-health-readout">${icon(iconName)}<span><small>${esc(label)}</small><strong>${esc(value)}</strong></span></span>`;
}

export function performanceHealthStep(load) {
  const value = Math.max(0, Number(load) || 0);
  for (let index = 0; index < performanceHealthThresholds.length; index++) {
    if (value < performanceHealthThresholds[index]) return index;
  }
  return performanceHealthClasses.length - 1;
}

function setPerformanceHealthDot(dot, load, available = true) {
  if (!dot) return;
  dot.classList.remove(...performanceHealthClasses, "is-unknown");
  if (!available) {
    dot.classList.add("is-unknown");
    return;
  }
  dot.classList.add(performanceHealthClasses[performanceHealthStep(load)]);
}

export function activeRenderCost(state) {
  let total = 0;
  const outputCost = Number(state.metrics.renderCost);
  if (Number(state.metrics.clients) > 0 && Number.isFinite(outputCost)) total += Math.max(0, outputCost);
  const previewCost = Number(state.metrics.previewRenderCost);
  if (state.ui?.debugPreview && Number(state.metrics.previewFps) > 0 && Number.isFinite(previewCost)) total += Math.max(0, previewCost);
  return total;
}

export function activeWorkMetric(state, outputFps = 0) {
  const renderers = [];
  if (Number(state.metrics.clients) > 0) {
    renderers.push({
      fps: outputFps,
      cpuMs: Math.max(0, Number(state.metrics.frameMs) || 0),
      gpuMs: Math.max(0, Number(state.metrics.gpuMs) || 0),
      gpuSupported: state.metrics.gpuSupported === true,
      profile: state.metrics.profile || null,
      transport: state.metrics.transport || null,
      source: "output",
    });
  }
  const previewFps = Math.max(0, Number(state.metrics.previewFps) || 0);
  if (state.ui?.debugPreview && previewFps > 0) {
    renderers.push({
      fps: previewFps,
      cpuMs: Math.max(0, Number(state.metrics.previewFrameMs) || 0),
      gpuMs: Math.max(0, Number(state.metrics.previewGpuMs) || 0),
      gpuSupported: state.metrics.previewGpuSupported === true,
      profile: state.metrics.previewProfile || null,
      source: "preview",
    });
  }
  if (!renderers.length) return { fps: 0, cpuMs: 0, gpuMs: 0, gpuSupported: false, profile: null, profiles: [], renderers, source: "renderer" };
  const supportedGpuRenderers = renderers.filter((renderer) => renderer.gpuSupported);
  const activeFps = renderers.map((renderer) => renderer.fps).filter((fps) => fps > 0);
  return {
    fps: activeFps.length ? Math.min(...activeFps) : 0,
    cpuMs: renderers.reduce((sum, renderer) => sum + renderer.cpuMs, 0),
    gpuMs: supportedGpuRenderers.reduce((sum, renderer) => sum + renderer.gpuMs, 0),
    gpuSupported: supportedGpuRenderers.length > 0,
    profile: renderers.length === 1 ? renderers[0].profile : null,
    profiles: renderers.map((renderer) => renderer.profile).filter(Boolean),
    transport: renderers.find((renderer) => renderer.source === "output")?.transport || null,
    renderers,
    source: renderers.map((renderer) => renderer.source).join(" + "),
  };
}

function performanceMetricForState(state, reason = "active") {
  const outputFps = state.metrics?.clients > 0 ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
  if (reason === "preview-metrics") {
    return {
      source: "preview",
      fps: Math.max(0, Number(state.metrics.previewFps) || 0),
      cpuMs: Math.max(0, Number(state.metrics.previewFrameMs) || 0),
      gpuMs: Math.max(0, Number(state.metrics.previewGpuMs) || 0),
      gpuSupported: state.metrics.previewGpuSupported === true,
      profile: state.metrics.previewProfile || null,
      renderCost: Math.max(0, Number(state.metrics.previewRenderCost) || 0),
    };
  }
  if (reason === "output-metrics") {
    return {
      source: "output",
      fps: outputFps,
      cpuMs: Math.max(0, Number(state.metrics.frameMs) || 0),
      gpuMs: Math.max(0, Number(state.metrics.gpuMs) || 0),
      gpuSupported: state.metrics.gpuSupported === true,
      profile: state.metrics.profile || null,
      renderCost: Math.max(0, Number(state.metrics.renderCost) || 0),
      transport: state.metrics.transport || null,
    };
  }
  return { ...activeWorkMetric(state, outputFps), renderCost: activeRenderCost(state) };
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
  if (metric.renderers?.length > 1) {
    for (const renderer of metric.renderers) lines.push(`${renderer.source}: ${formatTimeMs(renderer.cpuMs)} at ${Math.round(renderer.fps)} fps`);
    lines.push("Combined value sums active preview and output renderer work.");
    return lines.join("\n");
  }
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
  const lines = [`GPU average queries: ${formatTimeMs(metric.gpuMs)} (${metric.source})`];
  for (const renderer of metric.renderers || []) {
    lines.push(`${renderer.source}: ${renderer.gpuSupported ? formatTimeMs(renderer.gpuMs) : "timer unavailable"}`);
  }
  lines.push("Combined value sums available renderer query averages; it is not a frame duration.");
  return lines.join("\n");
}

function formatRenderCost(cost) {
  const percent = Math.max(0, Math.min(999, Number(cost) * 100 || 0));
  return `${percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}


function bindComponentFilters(scope) {
  scope?.querySelectorAll?.("[data-component-filter]").forEach((input) => {
    const apply = () => applyComponentFilter(input);
    input.addEventListener("input", apply);
    apply();
  });
}

function applyComponentFilter(input) {
  const filterScope = input?.closest?.("[data-component-filter-scope]");
  const query = String(input?.value || "").trim().toLowerCase();
  filterScope?.querySelectorAll?.("[data-component-filter-card]").forEach((card) => {
    card.hidden = !!query && !String(card.dataset.componentFilterCard || "").includes(query);
  });
}

function pathForSurface(state, surface) {
  const mappingIndex = state.mappings.findIndex((item) => item.id === state.ui.selectedMappingId);
  const surfaceIndex = state.mappings[mappingIndex]?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  return `mappings.${mappingIndex}.surfaces.${surfaceIndex}`;
}

function pathForMapping(state, mapping) {
  return `mappings.${state.mappings.findIndex((item) => item.id === mapping.id)}`;
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
