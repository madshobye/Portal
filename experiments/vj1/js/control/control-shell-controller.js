import { VJ1, WORKSPACES } from "../constants.js";
import { applySceneSnapshotToState, createLiveRenderState, createSceneSnapshot, sceneSourceNodes, syncLiveSnapshotFromScene } from "../domain/models.js?v=live-scene-authority-1";
import { buildOutputUrl } from "../view-routing.js?v=adaptive-component-demand-29";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=profile-edit-identity-1";
import { frameFitViewport, resetViewport, updatePreviewViewportForUi, zoomViewport } from "../output/preview-viewport.js?v=render-coordinate-scope-3";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js?v=adaptive-component-demand-29";
import { analyzeVj1Project, createRuntimeHotspotSmoother, summarizeRuntimeHotPasses } from "../metrics/component-metrics.js?v=per-renderer-share-1";
import { createHtmlCache, isInteractiveNode, isPointerInteractionNode, isTextEditingNode, setClass, setText } from "./dom-utils.js?v=preview-pointer-deferral-1";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js?v=performance-health-dots-1";
import { componentCatalogToolsTemplate, componentFilterTemplate, sortComponentCatalog } from "./catalog-view.js?v=changed-sort-user-truth-1";
import { canvasInspectorTemplate, componentSelectedChainSettingsTemplate, componentTemplate } from "./component-view.js?v=deep-edit-navigation-1";
import { canvasComponents, getSelectedScene, ordinaryComponents, selectedCanvasComponent } from "./control-selectors.js?v=control-selectors-extraction-1";
import { mappingInletsTemplate, mappingInspectorTemplate, mappingStudioTemplate } from "./mapping-view.js?v=mesh-topology-1";
import { liveComponentPillTemplate, liveInspectorTemplate, liveNavigableComponents, liveScenePillTemplate, scenePillTemplate, sceneRailConfigTemplate, sceneSignificantComponentTemplate, sceneSurfacePillTemplate, sceneSurfaceTemplate } from "./scene-live-view.js?v=deep-edit-navigation-1";
import { componentCardBarTemplate, deepEditButtonTemplate, panelTemplate, projectEmptyTemplate, textListItemTemplate } from "./view-primitives.js?v=profile-edit-identity-1";
import { emptyNote, esc, icon, thumbnailTemplate } from "./template-utils.js?v=power-flicker-1";
import { createClipboardController } from "./clipboard-controller.js?v=chain-only-authority-1";
import { createModalController } from "./modal-controller.js?v=source-picker-filters-1";
import { createInputController } from "./input-controller.js?v=source-picker-filters-1";

const performanceHealthClasses = Object.freeze([
  "health-0", "health-1", "health-2", "health-3", "health-4",
  "health-5", "health-6", "health-7", "health-8",
]);
const performanceHealthThresholds = Object.freeze([0.18, 0.32, 0.46, 0.60, 0.72, 0.82, 0.92, 1.0]);

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

export function createControlShell({ root, store, bridge, mediaLibrary, projectService, diagnostics = null }) {
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
  let performanceLongTaskObserver = null;
  let deepEditReturnContext = null;
  let diagnosticsOpen = false;
  let diagnosticsSnapshot = diagnostics?.summary?.() || emptyDiagnosticsSummary();
  const performanceHotspotSmoother = createRuntimeHotspotSmoother();
  let performanceHotspotComponentScope = "";
  const previewLayoutQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 1100px)")
    : null;
  const catalogOrderSnapshots = { component: [], scene: [] };
  const activeParamViews = new Map();
  const replaceHtmlIfChanged = createHtmlCache();
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
    diagnostics?.subscribe?.((summary) => {
      diagnosticsSnapshot = summary;
      renderDiagnostics();
    });
    previewLayoutQuery?.addEventListener?.("change", () => scheduleRenderNow(latestState));
    restorePreviewPreference();
    store.subscribe((state, reason, change) => {
      latestState = state;
      recordPerformanceStateEvent(reason);
      if (change.projectRestore) {
        invalidateCatalogOrder();
        deepEditReturnContext = null;
      }
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
      const patchedLivePreview = currentWorkspace(state) === "live" &&
        change.scope === "live" &&
        Array.isArray(change.livePatches) &&
        change.livePatches.length > 0 &&
        embeddedPreview.applyLivePatches(change.livePatches)?.applied;
      if (reason === "live:update") {
        // Native controls already display the commanded value. Rebuilding the
        // complete Live inspector here destroys its scroll/tab/element DOM
        // identity even though no structure changed.
        if (!patchedLivePreview) updatePreviewState(state);
        return;
      }
      if (change.phase === "edit") {
        renderTopbar(state);
        updatePreviewState(state);
        return;
      }
      if (change.phase === "scrub") {
        // Component preview gestures own an immediate local state overlay.
        // Feeding their store echo straight back into the same renderer makes
        // it rebuild lookup state twice per pointer frame.
        if (!patchedLivePreview && reason !== "scrub:chain-transform" && reason !== "scrub:canvas-frame") updatePreviewState(state);
        return;
      }
      if (change.phase === "color") {
        if (!patchedLivePreview) updatePreviewState(state);
        return;
      }
      if (reason === "workspace") {
        if (renderFrame) cancelAnimationFrame(renderFrame);
        renderFrame = 0;
        render(state);
        return;
      }
      if (change.structural) {
        // Structural commands change the identity and destination of controls.
        // They cannot wait behind a stale slider/text gesture hold: render on
        // the next frame after the current DOM event has completed.
        scheduleRenderNow(state, { force: true });
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

  function scheduleRenderNow(state, { force = false } = {}) {
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
      render(latestState);
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
    scheduleRenderNow(latestState);
  }

  function render(state) {
    const profileRenderStarted = performanceProfile ? performance.now() : 0;
    prepareCatalogOrder(state);
    setClass(root, "has-project-open", hasOpenProject(state));
    setClass(root, "no-project-open", !hasOpenProject(state));
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderPreview(state);
    if (performanceProfile) pushBounded(performanceProfile.host.uiRenderMs, performance.now() - profileRenderStarted, 240);
    modals.render(state);
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
    refs.performanceAnalyze.addEventListener("click", startPerformanceProfile);
    refs.performanceResultsHost.addEventListener("click", handlePerformanceResultsClick);
    window.addEventListener("click", closePerformanceSummary);

    refs.diagnosticsToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      diagnosticsOpen = !diagnosticsOpen;
      renderDiagnostics();
    });
    refs.diagnosticsSummary?.addEventListener("click", handleDiagnosticsClick);
    window.addEventListener("click", closeDiagnostics);

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
    const mappingActive = targetWorkspace === "scene";
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
    switchWorkspace(component.type === "canvas" ? "canvas" : "component");
    store.selectComponent?.(component.id);
    if (chainItemId) store.selectChainItem?.(chainItemId);
  }

  function returnFromDeepEdit() {
    const context = deepEditReturnContext;
    deepEditReturnContext = null;
    if (!context) return;
    switchWorkspace(context.workspace);
    if ((context.workspace === "component" || context.workspace === "canvas") &&
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

  function startPerformanceProfile() {
    if (performanceProfile) return;
    closePerformanceSummary();
    const startedAt = performance.now();
    performanceProfile = {
      startedAt,
      startedAtIso: new Date().toISOString(),
      endsAt: startedAt + performanceProfileDurationMs,
      samples: [],
      host: {
        uiRenderMs: [],
        longTasks: [],
        eventLoopLagMs: [],
        stateEvents: {},
        expectedTickAt: startedAt + 250,
        memoryStartBytes: performanceMemoryBytes(),
      },
    };
    startPerformanceHostObserver();
    capturePerformanceProfileSample(latestState);
    renderTopbar(latestState);
    performanceProfileTimer = window.setInterval(() => {
      if (performanceProfile) {
        const now = performance.now();
        pushBounded(performanceProfile.host.eventLoopLagMs, Math.max(0, now - performanceProfile.host.expectedTickAt), 80);
        performanceProfile.host.expectedTickAt = now + 250;
      }
      if (!performanceProfile || performance.now() >= performanceProfile.endsAt) {
        finishPerformanceProfile();
        return;
      }
      renderTopbar(latestState);
    }, 250);
  }

  function recordPerformanceStateEvent(reason) {
    if (!performanceProfile) return;
    const key = String(reason || "unknown");
    performanceProfile.host.stateEvents[key] = (performanceProfile.host.stateEvents[key] || 0) + 1;
  }

  function startPerformanceHostObserver() {
    if (typeof PerformanceObserver !== "function" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) return;
    try {
      performanceLongTaskObserver = new PerformanceObserver((list) => {
        if (!performanceProfile) return;
        for (const entry of list.getEntries()) {
          pushBounded(performanceProfile.host.longTasks, {
            durationMs: Number(entry.duration) || 0,
            name: entry.name || "main-thread task",
            startedAtMs: Number(entry.startTime) || 0,
          }, 120);
        }
      });
      performanceLongTaskObserver.observe({ type: "longtask", buffered: false });
    } catch (error) {
      console.warn("[VJ1_HOST_PROFILE_OBSERVER_FAILED]", { message: error?.message || String(error) });
      performanceLongTaskObserver = null;
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

  function closeDiagnostics() {
    if (!diagnosticsOpen) return;
    diagnosticsOpen = false;
    renderDiagnostics();
  }

  function renderDiagnostics() {
    if (!refs.diagnosticsToggle || !refs.diagnosticsSummaryContent) return;
    const snapshot = diagnosticsSnapshot || emptyDiagnosticsSummary();
    const level = snapshot.level || "ok";
    const iconName = level === "error" ? "error" : level === "warning" ? "warning" : level === "info" ? "info" : "check_circle";
    const count = (snapshot.counts?.info || 0) + (snapshot.counts?.warning || 0) + (snapshot.counts?.error || 0);
    refs.diagnosticsToggle.innerHTML = icon(iconName);
    refs.diagnosticsToggle.classList.remove("is-ok", "is-info", "is-warning", "is-error");
    refs.diagnosticsToggle.classList.add(`is-${level}`);
    refs.diagnosticsToggle.title = level === "ok" ? "Diagnostics: OK" : `Diagnostics: ${count} entr${count === 1 ? "y" : "ies"}`;
    refs.diagnosticsToggle.setAttribute("aria-label", level === "ok" ? "Open diagnostics, status OK" : `Open diagnostics, ${count} entries, status ${level}`);
    refs.diagnosticsToggle.setAttribute("aria-expanded", diagnosticsOpen ? "true" : "false");
    setClass(refs.diagnosticsSummary, "is-hidden", !diagnosticsOpen);
    if (!diagnosticsOpen) return;
    const entries = snapshot.entries || [];
    refs.diagnosticsSummaryContent.innerHTML = `
      <div class="diagnostics-summary-header">
        <span><strong>Diagnostics</strong><small>${entries.length ? `${count} captured entr${count === 1 ? "y" : "ies"}` : "No relevant console entries"}</small></span>
        <span class="diagnostics-state is-${esc(level)}">${icon(iconName)} ${esc(level === "ok" ? "OK" : level)}</span>
      </div>
      <ol class="diagnostics-entry-list">
        ${entries.length ? entries.slice().reverse().map(diagnosticEntryTemplate).join("") : `<li class="diagnostics-empty">${icon("check_circle")} Everything looks OK.</li>`}
      </ol>
      <div class="diagnostics-actions">
        <button type="button" data-diagnostics-clear ${entries.length ? "" : "disabled"}>${icon("delete_sweep")} Clear</button>
        <button type="button" data-diagnostics-copy ${entries.length ? "" : "disabled"}>${icon("content_copy")} Copy</button>
      </div>`;
  }

  async function handleDiagnosticsClick(event) {
    event.stopPropagation();
    if (event.target.closest("[data-diagnostics-clear]")) {
      diagnostics?.clear?.();
      return;
    }
    if (!event.target.closest("[data-diagnostics-copy]")) return;
    const text = diagnostics?.copyText?.() || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Diagnostics copied");
    } catch (error) {
      setStatus(`Could not copy diagnostics: ${error?.message || error}`);
    }
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
    refs.performanceSummaryContent.innerHTML = `
      <div class="performance-health-readouts">
        ${performanceReadoutTemplate("speed", "Overall", formatRenderCost(renderCost))}
        ${performanceReadoutTemplate("timer", "CPU", formatTimeMs(metric.cpuMs))}
        ${performanceReadoutTemplate("memory", "GPU", metric.gpuSupported ? formatTimeMs(metric.gpuMs) : "—")}
        ${performanceReadoutTemplate("open_in_new", "Output", outputConnected ? `${Math.round(outputFps)} fps` : "—")}
        ${performanceReadoutTemplate("cached", "Cache reuse", String(cacheHits))}
        ${performanceReadoutTemplate("refresh", "Renders", String(cacheRenders))}
      </div>
      <ol class="performance-hotspot-list">${rows}</ol>
    `;
    refs.performanceAnalyze.disabled = !!performanceProfile;
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
            transport: state.metrics.transport || null,
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
      transport: metric.transport ? structuredCloneSafe(metric.transport) : null,
    });
  }

  function finishPerformanceProfile() {
    if (!performanceProfile) return;
    if (performanceProfileTimer) window.clearInterval(performanceProfileTimer);
    performanceProfileTimer = 0;
    performanceLongTaskObserver?.disconnect?.();
    performanceLongTaskObserver = null;
    const session = performanceProfile;
    performanceProfile = null;
    const report = {
      kind: "vj1-runtime-profile",
      durationMs: performanceProfileDurationMs,
      startedAt: session.startedAtIso,
      completedAt: new Date().toISOString(),
      runtimeSamples: session.samples,
      analysis: analyzeVj1Project(latestState, { runtimeSamples: session.samples }),
      host: summarizePerformanceHost(session.host),
    };
    globalThis.__vj1LastProfileReport = report;
    console.info("[VJ1_PROFILE_COMPLETE]", report);
    showPerformanceResults(report);
    setStatus(`Profile complete · ${session.samples.length} samples analyzed`);
    renderTopbar(latestState);
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
        <div class="performance-results-body">
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
            <div class="performance-table-scroll"><table><thead><tr><th>#</th><th>Pass</th><th>Avg</th><th>P95</th><th>Max</th><th>N</th></tr></thead><tbody>${hotspotRows}</tbody></table></div>
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
    setClass(refs.returnFromDeepEdit, "is-hidden", !hasProject || !deepEditReturnContext);
    renderDiagnostics();
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
    setClass(refs.renderCost, "is-active", !!performanceProfile);
    const profileSeconds = performanceProfile
      ? Math.max(1, Math.ceil((performanceProfile.endsAt - performance.now()) / 1000))
      : 0;
    const workMetric = activeWorkMetric(state, outputFps);
    const frameInterval = frameTimeFromFps(workMetric.fps);
    setPerformanceHealthDot(refs.renderCostDot, renderCost);
    setPerformanceHealthDot(refs.cpuTimeDot, frameInterval > 0 ? workMetric.cpuMs / frameInterval : 0);
    setPerformanceHealthDot(refs.gpuTimeDot, frameInterval > 0 ? workMetric.gpuMs / frameInterval : 0, workMetric.gpuSupported);
    const healthTitle = performanceProfile
      ? `Profiling rendering… ${profileSeconds} second${profileSeconds === 1 ? "" : "s"} remaining`
      : `Overall ${formatRenderCost(renderCost)} · CPU ${formatTimeMs(workMetric.cpuMs)} · GPU ${workMetric.gpuSupported ? formatTimeMs(workMetric.gpuMs) : "unavailable"} · Output ${outputConnected ? `${Math.round(outputFps)} fps` : "closed"}`;
    refs.renderCost.title = healthTitle;
    refs.renderCost.setAttribute("aria-label", healthTitle);
    // Output metrics may arrive between pointerdown and click. Preserve the
    // interactive subtree until the browser finishes that event sequence.
    if (!refs.performanceSummary.classList.contains("is-hidden") && !shouldDeferRender()) renderPerformanceSummary(state);
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
    // Opening a display is infrastructure, not a Live performance command.
    // The popup receives the existing Live program through the output bridge;
    // editor selection must never change the program Scene as a side effect.
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

  function invalidateCatalogOrder() {
    activeCatalogViewKey = "";
    catalogOrderSnapshots.component = [];
    catalogOrderSnapshots.scene = [];
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
          ${state.scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Add a scene")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scn ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-add-scene title="Add empty scene" aria-label="Add empty scene">${icon("add")}</button>
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
    const paramFadeDuration = Math.max(0, Number(state.ui?.live?.paramFadeDuration) || 0);
    const timeStretch = Math.max(-4, Math.min(4, Number(state.global?.timeStretch) || 0));
    const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch;
    const liveScene = state.scenes.find((scene) => scene.id === (state.ui?.live?.selectedSceneId || state.scenes[0]?.id));
    const components = liveNavigableComponents(liveScene, state);
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live Scenes</span></div>
        <div class="scene-card-list live-scene-list">
          ${state.scenes.map((scene) => liveScenePillTemplate(scene, state)).join("") || emptyNote("Capture scenes first")}
        </div>
      </div>
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">account_tree</span><span>Scene components</span></div>
        <div class="component-card-list live-component-picker-list">
          ${components.map((component) => liveComponentPillTemplate(component, state)).join("") || emptyNote("No active components")}
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
        <label class="field range-field live-param-fade-duration">
          <span>Param fade</span>
          <output class="range-value" data-range-value>${paramFadeDuration.toFixed(2)} s</output>
          <input type="range" min="0" max="10" step="0.05" data-range-suffix=" s" data-update="ui.live.paramFadeDuration" value="${paramFadeDuration}" />
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

  function renderPreview(state) {
    if (currentWorkspace(state) === "mapping" || previewLayoutQuery?.matches) return;
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
    if (workspace === "mapping" || previewLayoutQuery?.matches) return;
    const kind = workspace === "component" || workspace === "canvas" ? "component" : "preview";
    embeddedPreview.setState(workspace === "live" ? createLiveRenderState(state) : state, kind);
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
    if (currentWorkspace(state) === "component") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      html = `${panelTemplate(
        "account_tree",
        selectedComponent?.name || "Component",
        selectedComponent ? componentTemplate(selectedComponent, state) : emptyNote("No component"),
        selectedComponent ? { titlePath: `${pathForComponent(state, selectedComponent)}.name` } : {}
      )}${selectedComponent ? componentSelectedChainSettingsTemplate(selectedComponent, state) : ""}`;
      replaceInspectorHtml(html, state);
      return;
    }
    if (currentWorkspace(state) === "mapping") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      html = panelTemplate(
        "schema",
        "Nodes",
        mappingInspectorTemplate(selectedComponent, state)
      );
      replaceInspectorHtml(html, state);
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
      replaceInspectorHtml(html, state);
      return;
    }
    if (currentWorkspace(state) === "live") {
      html = liveInspectorTemplate(state);
      replaceInspectorHtml(html, state);
      return;
    }
    const selectedScene = getSelectedScene(state);
    const selectedRoute = selectedScene?.snapshot?.surfaces?.find((surface) => surface.id === selectedSurface?.id);
    const sceneComponent = state.components.find((component) => component.id === selectedRoute?.componentId);
    html = `
      ${panelTemplate("select_all", selectedSurface?.name || "Surface", selectedSurface ? sceneSurfaceTemplate(selectedSurface, state, {
        sources: catalogItemsInSnapshot("scene", sceneSourceNodes(state)),
        sortMode: catalogSortMode(state, "scene"),
      }) : emptyNote("No surface"), selectedSurface && selectedSurface.destination?.type !== "direct"
        ? { titlePath: `${pathForSurface(state, selectedSurface)}.name` }
        : {})}
      ${sceneSignificantComponentTemplate(sceneComponent, state)}
    `;
    replaceInspectorHtml(html, state);
  }

  function replaceInspectorHtml(html, state) {
    rememberParamViewSelections(refs.inspector, activeParamViews);
    if (!replaceHtmlIfChanged(refs.inspector, html)) return false;
    restoreParamViewSelections(refs.inspector, activeParamViews);
    bindInputs(refs.inspector, state);
    return true;
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
    refs.projectRail.querySelector("[data-add-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scn ${latestState.scenes.length + 1}`;
      store.addScene(name);
    });
    refs.projectRail.querySelectorAll("[data-select-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectScene(button.dataset.selectScene));
    });
    refs.projectRail.querySelectorAll("[data-live-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectLiveScene(button.dataset.liveScene));
    });
    refs.projectRail.querySelectorAll("[data-live-component]").forEach((button) => {
      button.addEventListener("click", () => updateUi((ui) => {
        ui.live ||= {};
        ui.live.selectedComponentId = button.dataset.liveComponent;
      }, "select-live-component"));
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

function performanceComponentThumbnail(state, componentId, className) {
  const component = state.components?.find((item) => item.id === componentId);
  if (!component) return "";
  const fallbackIcon = component.type === "canvas" ? "dashboard_customize" : "account_tree";
  return `<span class="performance-component-thumbnail ${esc(className)}">${thumbnailTemplate(component.thumbnail, fallbackIcon)}</span>`;
}

function emptyDiagnosticsSummary() {
  return { level: "ok", counts: { info: 0, warning: 0, error: 0 }, entries: [] };
}

function diagnosticEntryTemplate(entry) {
  const time = new Date(entry.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const count = entry.count > 1 ? `<span class="diagnostics-repeat">×${entry.count}</span>` : "";
  return `<li class="is-${esc(entry.level)}"><header><span>${icon(diagnosticIcon(entry.level))}<strong>${esc(entry.level)}</strong></span><span>${esc(time)} ${count}</span></header><pre>${esc(entry.message)}</pre></li>`;
}

function diagnosticIcon(level) {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "info";
}

function workspaceLabel(workspace) {
  if (workspace === "component") return "Components";
  if (workspace === "canvas") return "Canvas";
  if (workspace === "live") return "Live";
  return "Scenes";
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

function pushBounded(items, value, limit) {
  items.push(value);
  if (items.length > limit) items.splice(0, items.length - limit);
}

function summarizePerformanceHost(host = {}) {
  const uiRenderMs = numericValues(host.uiRenderMs);
  const eventLoopLagMs = numericValues(host.eventLoopLagMs);
  const longTasks = (host.longTasks || []).filter((item) => Number.isFinite(Number(item?.durationMs)));
  const stateEvents = Object.entries(host.stateEvents || {})
    .map(([reason, count]) => ({ reason, count: Math.max(0, Number(count) || 0) }))
    .sort((a, b) => b.count - a.count);
  const memoryEndBytes = performanceMemoryBytes();
  const memoryStartBytes = host.memoryStartBytes === null || host.memoryStartBytes === undefined
    ? null
    : Number(host.memoryStartBytes);
  return {
    uiRenderCount: uiRenderMs.length,
    uiRenderMsAvg: averageNumbers(uiRenderMs),
    uiRenderMsP95: percentileNumbers(uiRenderMs, 0.95),
    uiRenderMsMax: uiRenderMs.length ? Math.max(...uiRenderMs) : 0,
    eventLoopLagMsP95: percentileNumbers(eventLoopLagMs, 0.95),
    eventLoopLagMsMax: eventLoopLagMs.length ? Math.max(...eventLoopLagMs) : 0,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((sum, item) => sum + Number(item.durationMs), 0),
    longTaskMaxMs: longTasks.length ? Math.max(...longTasks.map((item) => Number(item.durationMs))) : 0,
    longTasks: longTasks.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
    stateEventCount: stateEvents.reduce((sum, item) => sum + item.count, 0),
    topStateEvents: stateEvents.slice(0, 12),
    memoryStartBytes: Number.isFinite(memoryStartBytes) ? memoryStartBytes : null,
    memoryEndBytes,
    memoryDeltaBytes: Number.isFinite(memoryStartBytes) && Number.isFinite(memoryEndBytes) ? memoryEndBytes - memoryStartBytes : null,
  };
}

function performanceMemoryBytes() {
  const value = Number(globalThis.performance?.memory?.usedJSHeapSize);
  return Number.isFinite(value) ? value : null;
}

function numericValues(values = []) {
  return values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
}

function averageNumbers(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentileNumbers(values = [], percentile = 0.95) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1))];
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
