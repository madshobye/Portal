import { VJ1, WORKSPACES } from "../constants.js";
import { createLiveScenePreviewState, projectSelectedMapping, sceneSourceNodes } from "../domain/models.js";
import { activeLiveTransitions } from "../domain/live-transition-coordinator.js";
import { componentRenderPatchesForChange } from "../domain/render-transport-patch.js";
import { setLiveNodeParameterDiff } from "../domain/live-parameter-diffs.js";
import { buildOutputUrl } from "../view-routing.js";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js";
import { CONTROL_SIGNAL_COMMAND } from "../output/control-signal-command.js";
import { fitPreviewViewport, resetViewport, updatePreviewViewportForUi, zoomViewport } from "../output/preview-viewport.js";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js";
import { analyzeVj1Project, createRuntimeHotspotSmoother, summarizeRuntimeHotPasses } from "../metrics/component-metrics.js";
import { sortComponentCatalog } from "./catalog-view.js";
import { componentElementsUiModel, componentOverviewUiModel, componentSelectedChainSettingsModel, selectedChainParameterTabsModel } from "./component-view.js";
import { sceneComponents, getLiveSelectedTarget, getSelectedMapping, ordinaryComponents, selectedSceneComponent } from "./control-selectors.js";
import { selectedLiveComponentViewModel, selectedLiveInspectorModel, selectedLiveParameterTabsModel } from "./mapping-live-view.js";
import { createClipboardController } from "./clipboard-controller.js";
import { createModalController } from "./modal-controller.js";
import { createControlCommandController } from "./control-command-controller.js";
import { handleParameterAnimationCommand } from "./animation-command-controller.js";
import { createControlPerformanceSession } from "./control-performance-session.js";
import { boundedProfileValue, captureControlLiveProfileDiagnostic } from "./live-profile-diagnostics.js";
import { createControlRenderDiagnostics } from "./control-render-diagnostics.js";
import { UI_ICONS } from "./ui-icons.js";
import { componentCatalogListItems, liveProjectionListModel, liveSourceListItems, mappingCatalogListItems, selectedLiveSourceId } from "./project-rail-view.js";
import { prepareProjectNodeDefinitionEdit, prepareProjectNodeGraphEdit, selectedNodeEditorModel, withProjectNodeFork, withProjectNodeParameterExposure, withProjectNodePortExposure, withoutProjectNodeFork } from "./node-editor-view.js";
import { nodeLibraryInspectorModel, nodeLibraryRailModel, nodeLibraryStudioModel, selectedNodeWorkspaceTarget } from "./node-library-view.js";
import { graphWithNodeParameter } from "./node-graph-canvas.js";
import {
  resolveProjectVisualTransitionEntries,
} from "../libraries/visual-nodes/project-visual-node-resolver.js";
import { isMappingSurfaceVisibilityReason, previewActivationForContext } from "./preview-state-activation.js";
import {
  mergeSignalLoadSnapshots,
  signalLoadMeter,
} from "../metrics/signal-load-meter.js";
import {
  createUiStateController,
  createUiStateStore,
  compileUiModel,
  RetainedUiRuntime,
  UiNodeRegistry,
  UiNodeDefinitions,
  uiModelNodeId,
} from "../libraries/ui-engine/index.js";
import { artifactInspectorUiModel, componentCatalogUiModel, contextMenuUiGraph, liveComponentViewUiGraph, liveProjectionRailUiGraph, liveRailUiGraph, liveSignificantUiGraph, liveTimingUiGraph, mappingRailUiGraph, mappingSurfaceInspectorUiGraph, nodesRailUiGraph, nodesWorkspaceStudioUiGraph, parameterTabsUiGraph, previewSurfaceUiGraph, previewToolsUiGraph, sceneRailUiModel, sceneSurfaceInspectorUiModel, VJ1_CONTROL_UI_GRAPH } from "./control-ui-program.js";
import { NodeDefinitionEditorNode } from "../libraries/ui-engine/index.js";

const performanceHealthClasses = Object.freeze([
  "health-0", "health-1", "health-2", "health-3", "health-4",
  "health-5", "health-6", "health-7", "health-8",
]);
const performanceHealthThresholds = Object.freeze([0.18, 0.32, 0.46, 0.60, 0.72, 0.82, 0.92, 1.0]);
const PERFORMANCE_SIGNAL_CATEGORIES = Object.freeze([
  ["transactions", "Authored transactions"],
  ["invalidations", "Render wakeups"],
  ["compiles", "Graph compiles"],
  ["resourceRevisions", "Resource revisions"],
  ["cacheInvalidations", "Cache invalidations"],
  ["cacheHits", "Cache hits"],
  ["previewPresentations", "Preview presentations"],
  ["outputPresentations", "Output presentations"],
]);
const ARTIFACT_INSPECTOR_WORKSPACES = Object.freeze(["component", "scene", "live", "nodes"]);
const ELEMENT_PARAMETER_SECTION_LAYOUT = Object.freeze({
  fill: true,
  grow: 0,
  shrink: 0,
  basis: "40%",
  overflow: "hidden",
});
const SURFACE_INSPECTOR_SECTION_LAYOUT = Object.freeze({
  fill: false,
  grow: 0,
  shrink: 0,
  basis: "auto",
  overflow: "visible",
});

export function artifactInspectorScope(workspace) {
  const owner = String(workspace || "");
  return ARTIFACT_INSPECTOR_WORKSPACES.includes(owner)
    ? `vj1.control.${owner}-artifact-inspector`
    : "";
}

function mergeControlInvalidations(current = {}, next = {}) {
  const regions = [...new Set([
    ...(current.regions || []),
    ...(next.regions || []),
  ])];
  const currentPreview = String(current.preview || "");
  const nextPreview = String(next.preview || "");
  const preview = !currentPreview
    ? nextPreview
    : !nextPreview || currentPreview === nextPreview
      ? currentPreview
      : "render";
  return {
    regions,
    ...(preview ? { preview } : {}),
    ...((current.requiresRenderPatch || next.requiresRenderPatch)
      ? { requiresRenderPatch: true }
      : {}),
  };
}

// A scheduled shell render is an atomic workspace projection: it reconciles
// every view-owned region, including regions that only exist in Live. UI
// selection commands commonly follow a workspace command synchronously. They
// may add work to that pending frame, but must never replace it with a narrow
// rail/inspector render and leave DOM owned by the previous workspace behind.
export function mergeControlRenderRequests(current, next) {
  if (!current) return next;
  if (!next) return current;

  const flags = {
    force: current.force === true || next.force === true,
    // A complete preview replacement may only be skipped when every merged
    // request confirms that its preview work was already patched in place.
    previewPatched: current.previewPatched === true && next.previewPatched === true,
  };
  if (current.projection === "shell" || next.projection === "shell") {
    const owner = current.projection === "shell" ? current : next;
    return {
      ...owner,
      ...flags,
      projection: "shell",
      invalidation: null,
    };
  }
  if (current.projection !== next.projection) {
    return {
      ...current,
      ...flags,
      projection: "shell",
      invalidation: null,
    };
  }
  if (next.projection === "control-invalidation") {
    return {
      ...next,
      ...flags,
      invalidation: mergeControlInvalidations(current.invalidation, next.invalidation),
    };
  }
  return { ...next, ...flags };
}

// A Live transition is renderer-clocked and therefore does not publish
// authored state on its final frame. The control projection needs exactly one
// refresh after its deadline. Unrelated state traffic (metrics, autosave,
// readiness) must not keep cancelling that refresh: in particular, a message
// received during the small post-deadline grace window must leave the already
// scheduled callback intact.
export function createLiveTransitionExpiryScheduler({
  onExpire = () => {},
  now = () => Date.now(),
  schedule = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel = (handle) => globalThis.clearTimeout(handle),
  graceMs = 20,
} = {}) {
  let handle = null;
  let transitionKey = "";

  const clear = () => {
    if (handle !== null) cancel(handle);
    handle = null;
    transitionKey = "";
  };

  return Object.freeze({
    update(value) {
      const transitions = (Array.isArray(value) ? value : [value])
        .filter((candidate) => candidate?.id);
      const transition = transitions.slice().sort((a, b) =>
        (Number(a.startedAtMs) + Number(a.durationMs))
        - (Number(b.startedAtMs) + Number(b.durationMs))
      )[0];
      const startedAtMs = Number(transition?.startedAtMs) || 0;
      const durationMs = Math.max(0, Number(transition?.durationMs) || 0);
      const expiresAt = startedAtMs + durationMs;
      const nextKey = transition?.id && startedAtMs > 0 && durationMs > 0
        ? transitions.map((candidate) => `${String(candidate.id || "")}|${Number(candidate.startedAtMs) || 0}|${Number(candidate.durationMs) || 0}`)
          .sort()
          .join(",")
        : "";

      // Preserve the one callback already owned by this exact transition,
      // even when `now()` has crossed the semantic deadline. It may still be
      // inside its intentional post-deadline grace interval.
      if (handle !== null && nextKey && nextKey === transitionKey) return false;

      clear();
      if (!nextKey || expiresAt <= now()) return false;
      transitionKey = nextKey;
      handle = schedule(() => {
        handle = null;
        transitionKey = "";
        onExpire();
      }, Math.max(0, expiresAt - now()) + Math.max(0, Number(graceMs) || 0));
      return true;
    },
    cancel: clear,
  });
}

export function createControlShell({
  root,
  store,
  bridge,
  mediaLibrary,
  projectService,
  midiInput,
  dmxOutput,
  screenCapture,
  diagnostics = null,
  nodePackage = null,
  onLifecycle = null,
}) {
  if (!midiInput || !dmxOutput || !screenCapture) throw new Error("CONTROL_DEVICE_SERVICES_REQUIRED");
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  let scheduledRenderRequest = null;
  let renderPending = false;
  let deferredRenderState = null;
  let deferredRenderContext = null;
  let deferredRenderTimer = 0;
  let liveTransitionNodes = null;
  let liveTransitionPackages = null;
  let liveTransitionEntries = Object.freeze([]);
  let activePointerCount = 0;
  let activeEditor = false;
  let compactPreviewLayout = false;
  let outputWindowRequestSequence = 0;
  let activeCatalogViewKey = "";
  let deepEditReturnContext = null;
  const performanceHotspotSmoother = createRuntimeHotspotSmoother();
  const controlSignalMeter = signalLoadMeter("control");
  let signalRefreshTimer = 0;
  let performanceSummaryOpen = false;
  let performanceHotspotComponentScope = "";
  const catalogOrderSnapshots = { component: [], scene: [], mapping: [], live: [], source: [] };
  const retainedUi = new RetainedUiRuntime({
    registry: new UiNodeRegistry(UiNodeDefinitions),
    state: createUiStateController({
      session: createUiStateStore({
        namespace: "vj1-control",
        storage: globalThis.sessionStorage,
      }),
    }),
    capabilities: {
      mediaPreview: Object.freeze({
        acquire: (mediaId) => mediaLibrary?.acquirePreviewUrl?.(mediaId),
        release: (mediaId) => mediaLibrary?.releasePreviewUrl?.(mediaId),
      }),
      nodeDefinitions: Object.freeze({
        get: (id, version = "") => editorNodePackage?.registry?.get?.(id, version),
      }),
    },
    dispatch: dispatchUiNodeCommand,
  });
  let diagnosticsOpen = false;
  let diagnosticsSnapshot = diagnostics?.summary?.() || emptyDiagnosticsSummary();
  const controlRenderDiagnostics = createControlRenderDiagnostics({ diagnostics });
  const liveTransitionExpiryScheduler = createLiveTransitionExpiryScheduler({
    onExpire: () => {
      store.advanceLiveTransitions?.();
      if (currentWorkspace(latestState) !== "live") return;
      renderMeasuredControlPhases(latestState, { reason: "live-transition-expired" }, [
        ["live-projection-rail", () => renderLiveProjectionRail(latestState)],
        ["inspector", () => renderInspector(latestState)],
      ]);
    },
  });
  const clipboard = createClipboardController({
    store,
    getState: () => latestState,
    importFiles,
    setStatus,
    onTargetChange: syncClipboardNode,
  });
  let embeddedPreview = null;
  let modals = null;
  modals = createModalController({
    store,
    getState: () => latestState,
    getHost: () => refs.modalHost,
    mediaLibrary,
    refreshMedia: () => projectService.refreshFolder({ force: true }),
    getCatalogSortMode: (state, scope = "component") => catalogSortMode(state, scope),
    retainedUi,
    midiInput,
    dmxOutput,
    screenCapture,
  });
  let animationTriggerSequence = 0;
  const triggerParameterAnimation = ({ address }) => {
    if (!address) return;
    const payload = {
      kind: "control",
      address,
      value: 1,
      sequence: ++animationTriggerSequence,
      timestamp: Date.now(),
    };
    embeddedPreview?.command(CONTROL_SIGNAL_COMMAND, payload);
    bridge.command(CONTROL_SIGNAL_COMMAND, payload);
  };
  const inputs = createControlCommandController({
    store,
    getState: () => latestState,
    modals,
    resetProjectMapping,
    currentWorkspace,
    refreshSelectedMappingProjection,
    showContextMenu,
    closeContextMenu,
    triggerIsfEvent({ target, parameterId }) {
      if (!target || !parameterId) return;
      const payload = {
        type: "isf-event",
        target,
        payload: { parameterId },
      };
      embeddedPreview?.command("schedule", payload);
      bridge.command("schedule", payload);
    },
  });
  embeddedPreview = createEmbeddedPreviewApp({
    store,
    mediaLibrary,
    projectService,
    onControlSignal: (payload) =>
      bridge.command(CONTROL_SIGNAL_COMMAND, payload),
    onDmxFixture: (payload) => dmxOutput.receiveProbe(payload),
    onDownload: (request) => retainedUi.updateNode("file-download", {
      request,
    }, { scope: "vj1.control.ui" }),
    screenCapture,
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
    diagnosticForState: (state, context) => captureControlLiveProfileDiagnostic(
      state,
      context?.kind === "event" ? {} : (store.getLiveRenderState?.() || {}),
      context,
    ),
    signalForState: (state) => activeSignalLoad(state, controlSignalMeter.snapshot()),
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
    onTick: () => renderTopbarHealth(latestState),
    onActiveChange: (enabled) => {
      const payload = { enabled: enabled === true };
      embeddedPreview?.command("set-profile-diagnostics", payload);
      bridge.command("set-profile-diagnostics", payload);
    },
    onComplete: (report, sampleCount) => {
      globalThis.__vj1LastProfileReport = report;
      console.info("[VJ1_PROFILE_COMPLETE]", report);
      showPerformanceResults(report);
      setStatus(`Profile complete · ${sampleCount} samples analyzed`);
      renderTopbarHealth(latestState);
    },
  });

  function mount() {
    retainedUi.activate(VJ1_CONTROL_UI_GRAPH, {
      host: root,
      scope: "vj1.control.ui",
    });
    const shell = retainedUi.getNode("application-shell", { scope: "vj1.control.ui" });
    const workspaceLayout = retainedUi.getNode("workspace-layout", { scope: "vj1.control.ui" });
    refs = {
      shell,
      projectRail: workspaceLayout.slot("project-rail"),
      liveProjectionRail: workspaceLayout.slot("live-projection-rail"),
      inspector: workspaceLayout.slot("inspector"),
      studio: workspaceLayout.slot("studio"),
      studioLayout: workspaceLayout.element(),
      modalHost: shell.slot("modal"),
      contextMenuHost: shell.slot("context"),
      performanceResultsHost: shell.slot("performance-results"),
      performanceSummaryContent: shell.slot("performance-summary"),
    };
    syncClipboardNode();
    diagnostics?.subscribe?.((snapshot) => {
      diagnosticsSnapshot = snapshot || emptyDiagnosticsSummary();
      renderTopbar(latestState);
    });
    restorePreviewPreference();
    midiInput.syncState(latestState);
    dmxOutput.syncState(latestState);
    scheduleLiveTransitionRefresh(latestState);
    if (!signalRefreshTimer) {
      signalRefreshTimer = globalThis.setInterval(() => renderTopbarHealth(latestState), 1000);
    }
    store.subscribe((state, reason, change) => {
      latestState = state;
      midiInput.syncState(state);
      dmxOutput.syncState(state);
      if (state.nodes?.definitions !== editorProjectDefinitions) {
        editorProjectDefinitions = state.nodes?.definitions || [];
        editorNodePackage = nodePackage?.editorContext?.(
          projectService.getInstalledNodePackages?.() || [],
          projectService.getAvailableNodePackages?.() || [],
          editorProjectDefinitions,
        ) || nodePackage;
      }
      scheduleLiveTransitionRefresh(state);
      performanceSession.recordStateEvent(reason, state, change);
      if (change.effects.lifecycle.project === "restore") {
        invalidateCatalogOrder();
        deepEditReturnContext = null;
      }
      if (reason === "output-metrics" || reason === "preview-metrics") performanceSession.captureSample(state, reason);
      if (change.effects.preview.mode === "mapping") {
        renderTopbar(state);
        // Mapping drags originate in the embedded mapper, so its scrub echo
        // must not be fed back as a complete preview state on every pointer
        // sample. The final commit still reconciles programmatic/reset edits.
        if (change.command.phase !== "scrub") renderPreview(state, { reason, change });
        return;
      }
      if (change.effects.preview.mode === "metrics") {
        renderTopbar(state);
        return;
      }
      if (change.effects.preview.mode === "thumbnails") {
        retainedUi.broadcast("updateMedia", change.projection.entries);
        return;
      }
      if (change.effects.preview.mode === "viewport") {
        // Navigation changes only the retained p5 presentation transform.
        // A full state replacement would rebuild the render graph and, in
        // Live, discard its temporary parameter overlay.
        embeddedPreview.setViewport(state.ui);
        return;
      }
      const patchedLivePreview = currentWorkspace(state) === "live" &&
        change.command.domain === "live" &&
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
        // Native controls already display their commanded value. Hardware
        // MIDI has no matching DOM event, so it additionally reconciles the
        // inspector. Parameter changes can also add the reset action to a
        // source card; retain that explicit project-rail invalidation instead
        // of returning before the card list sees the new diff bank.
        if (!patchedLivePreview) updatePreviewState(state);
        const regions = new Set(change.effects.control?.regions || []);
        if (change.input === "midi" && currentWorkspace(state) === "live") {
          regions.add("live-projection-rail");
          regions.add("inspector");
        }
        if (regions.size) {
          scheduleRenderNow(state, {
            reason,
            change,
            projection: "control-invalidation",
            invalidation: { regions: [...regions] },
            previewPatched: patchedLivePreview,
          });
        }
        return;
      }
      if (change.command.phase === "edit") {
        renderTopbar(state);
        if (!patchedStudioPreview) {
          updatePreviewState(state, previewActivationForContext({ reason, change }));
        }
        return;
      }
      if (change.command.phase === "scrub") {
        // Component preview gestures own an immediate local state overlay.
        // Feeding their store echo straight back into the same renderer makes
        // it rebuild lookup state twice per pointer frame.
        if (!patchedLivePreview && !patchedStudioPreview && reason !== "scrub:chain-transform" && reason !== "scrub:chain-boundary" && reason !== "scrub:scene-surface") updatePreviewState(state);
        const scrubInvalidation = change.effects.control;
        if (
          scrubInvalidation &&
          (!scrubInvalidation.requiresRenderPatch || patchedLivePreview || patchedStudioPreview)
        ) {
          scheduleRenderNow(state, {
            reason,
            change,
            projection: "control-invalidation",
            invalidation: scrubInvalidation,
            previewPatched: patchedLivePreview || patchedStudioPreview,
          });
        }
        return;
      }
      if (change.command.phase === "color") {
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
      const controlInvalidation = change.effects.control;
      if (
        controlInvalidation &&
        (!controlInvalidation.requiresRenderPatch || patchedLivePreview || patchedStudioPreview)
      ) {
        scheduleRenderNow(state, {
          force: true,
          reason,
          change,
          projection: "control-invalidation",
          invalidation: controlInvalidation,
        });
        return;
      }
      if (currentWorkspace(state) === "live" && change.effects.preview.mode === "live-program") {
        scheduleRenderNow(state, { force: true, reason, change, projection: "live-program" });
        return;
      }
      if (change.effects.graph.mode === "recompile") {
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
    // Transition progress is renderer-owned and intentionally does not write
    // the project store every frame. The scheduler protects this one expiry
    // refresh from unrelated state notifications.
    liveTransitionExpiryScheduler.update(activeLiveTransitions(state.ui?.live));
  }

  function scheduleRender(state, context = {}) {
    if (shouldDeferRender()) {
      deferRender(state, context);
      return;
    }
    scheduleRenderNow(state, context);
  }

  function scheduleRenderNow(state, {
    force = false,
    reason = "",
    change = null,
    projection = "shell",
    invalidation = null,
    previewPatched = false,
  } = {}) {
    if (force) {
      deferredRenderState = null;
      deferredRenderContext = null;
      renderPending = false;
      if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
      deferredRenderTimer = 0;
    }
    scheduledRenderRequest = mergeControlRenderRequests(scheduledRenderRequest, {
      force,
      reason,
      change,
      projection,
      invalidation,
      previewPatched,
    });
    // One frame owns one coherent projection. Later same-frame notifications
    // merge into this request instead of cancelling it and narrowing its
    // workspace coverage.
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      const request = scheduledRenderRequest || {};
      scheduledRenderRequest = null;
      if (!request.force && shouldDeferRender()) {
        deferRender(latestState, request);
        return;
      }
      // A queued frame is only a request to render. Its captured snapshot is
      // not an authority: rapid scrubs/toggles may have advanced the store
      // before this callback runs.
      if (request.projection === "live-program") {
        renderLiveProgramChange(latestState, request);
      } else if (request.projection === "control-invalidation") {
        renderControlInvalidation(latestState, request, request.invalidation);
      } else {
        render(latestState, request);
      }
    });
  }

  function deferRender(state, context = {}) {
    deferredRenderState = state;
    deferredRenderContext = context;
    renderPending = true;
    renderTopbar(state);
    // A retained patch remains authoritative while the DOM rebuild waits for
    // pointerup/focusout. Replacing Preview state here would turn the final
    // (often value-identical) drag commit into a Component + Mapping recompile.
    if (!context.previewPatched) updatePreviewState(state);
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
    const context = deferredRenderContext || {};
    deferredRenderState = null;
    deferredRenderContext = null;
    renderPending = false;
    scheduleRenderNow(latestState, {
      ...context,
      reason: context.reason || "deferred-interaction-flush",
    });
  }

  function render(state, context = {}) {
    const profileRenderStarted = performanceSession.isActive() ? performance.now() : 0;
    renderMeasuredControlPhases(state, context, [
      ["catalog-order", () => prepareCatalogOrder(state)],
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

  function renderControlInvalidation(state, context = {}, invalidation = {}) {
    const regionRenderers = {
      "topbar": () => renderTopbar(state),
      "project-rail": () => renderProjectRail(state),
      "project-selection": () => renderProjectRail(state),
      "live-projection-rail": () => renderLiveProjectionRail(state),
      "inspector": () => renderInspector(state),
      "studio": () => renderStudio(state),
      "modals": () => modals.render(state),
    };
    const operations = [...new Set(invalidation.regions || [])]
      .filter((region) => regionRenderers[region])
      .map((region) => [region, regionRenderers[region]]);
    if (invalidation.preview === "ui") {
      operations.push(["preview", () => updatePreviewState(state, "ui")]);
    } else if (invalidation.preview === "mapping") {
      operations.push(["preview", () => updatePreviewState(state, "mapping")]);
    } else if (invalidation.preview === "projection") {
      operations.push(["preview", () => updatePreviewState(state, "projection")]);
    } else if (invalidation.preview === "render") {
      operations.push(["preview", () => renderPreview(state, context)]);
    } else if (invalidation.preview === "assets") {
      operations.push(["preview", () => updatePreviewState(state, "assets")]);
    }
    renderMeasuredControlPhases(state, context, operations);
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
      topic: context.change?.command?.topic,
      workspace: currentWorkspace(state),
    });
  }

  function syncClipboardNode() {
    retainedUi.updateNode("clipboard", clipboard.snapshot(), { scope: "vj1.control.ui" });
  }

  function updateUi(recipe, reason) {
    if (typeof store.updateUi === "function") {
      store.updateUi(recipe, reason);
      return;
    }
    store.update((draft) => recipe(draft.ui), reason);
  }

  function nudgePreviewZoom(multiplier) {
    updateUi((ui) => {
      updatePreviewViewportForUi(ui, (viewport) => zoomViewport(viewport, multiplier));
    }, "preview-zoom");
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
    await projectService.undoProject().catch((error) => setStatus(`Undo error: ${error.message || error}`));
  }

  async function redoProject() {
    await projectService.redoProject().catch((error) => setStatus(`Redo error: ${error.message || error}`));
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
    performanceSummaryOpen = !performanceSummaryOpen;
    refs.shell.setPopover("performance", performanceSummaryOpen);
    if (performanceSummaryOpen) renderPerformanceSummary(latestState);
  }

  function closePerformanceSummary() {
    performanceSummaryOpen = false;
    refs.shell?.setPopover("performance", false);
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
    const signalLoad = activeSignalLoad(state, controlSignalMeter.snapshot());
    const cacheHits = profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.componentCacheHits) || 0) + Math.max(0, Number(profile.stageCacheHits) || 0), 0);
    const cacheRenders = profiles.reduce((sum, profile) => sum + Math.max(0, Number(profile.componentRenders) || 0) + Math.max(0, Number(profile.stageRenders) || 0), 0);
    retainedUi.updateNode("performance-summary", {
      readouts: [
        { icon: "speed", label: "Overall", value: formatRenderCost(renderCost) },
        { icon: "timer", label: "CPU", value: formatTimeMs(metric.cpuMs) },
        { icon: "memory", label: "GPU", value: metric.gpuSupported ? formatTimeMs(metric.gpuMs) : "—" },
        { icon: "open_in_new", label: "Output", value: outputConnected ? `${Math.round(outputFps)} fps` : "—" },
        { icon: "cached", label: "Cache reuse", value: String(cacheHits) },
        { icon: "refresh", label: "Renders", value: String(cacheRenders) },
        { icon: "vital_signs", label: "Signal load", value: `${Math.round(signalLoad.totalPerSecond)}/s` },
      ],
      categoryTitle: "Signal flow per second",
      categoryNote: signalLoad.topReasons?.length
        ? `Top: ${signalLoad.topReasons.slice(0, 3).map((item) => `${item.reason} ${Math.round(item.count)}`).join(" · ")}`
        : "",
      categories: PERFORMANCE_SIGNAL_CATEGORIES.map(([id, label]) => ({
        id,
        label,
        value: `${formatNumber(signalLoad.categories?.[id], 1)}/s`,
      })),
      hotspots: hotspots.map((item) => {
        const rendererTotalMs = smoothed.totalsBySource[item.runtimeSource || "renderer"] || displayTotalMs;
        const share = rendererTotalMs > 0 ? Math.min(999, item.msAvg / rendererTotalMs * 100) : 0;
        const component = state.components?.find((candidate) => candidate.id === item.componentId);
        return {
          id: `${item.runtimeSource || "renderer"}:${item.componentId || ""}:${item.chainItemId || ""}`,
          label: item.name,
          detail: item.runtimeSource ? `${item.kind} · ${item.runtimeSource}` : item.kind,
          value: formatTimeMs(item.msAvg),
          share: formatPercent(share),
          media: component?.thumbnail ? { src: component.thumbnail } : null,
          action: item.componentId ? { id: "edit", label: `Edit ${item.name}`, icon: "edit", iconOnly: true, payload: { componentId: item.componentId, chainItemId: item.chainItemId || "" } } : null,
        };
      }),
      emptyText: "Waiting for an active renderer sample…",
    }, { scope: "vj1.control.ui" });
  }

  function showPerformanceResults(report) {
    retainedUi.updateNode("performance-report", performanceReportModel(report), { scope: "vj1.control.ui" });
  }

  function performanceReportModel(report = {}) {
    const runtime = report.analysis?.runtime || {};
    const host = report.host || {};
    const profile = runtime.profile || {};
    const cacheHits = (profile.componentCacheHitsAvg || 0) + (profile.stageCacheHitsAvg || 0);
    const cacheRenders = (profile.componentRendersAvg || 0) + (profile.stageRendersAvg || 0);
    const cacheReuse = cacheHits + cacheRenders > 0 ? cacheHits / (cacheHits + cacheRenders) * 100 : 0;
    const hotspots = profile.hotPasses || [];
    return {
      open: true,
      title: "Performance analysis",
      subtitle: `10 second sampled report · ${runtime.sampleCount || 0} metric samples`,
      cards: [
        { label: "FPS average", value: formatNumber(runtime.fpsAvg, 1) },
        { label: "CPU frame p95", value: formatTimeMs(runtime.frameMsP95) },
        { label: "GPU timer average", value: runtime.gpuSampleCount ? formatTimeMs(runtime.gpuMsAvg) : "--" },
        { label: "Frame budget p95", value: formatPercent((runtime.renderCostP95 || 0) * 100) },
        { label: "UI rebuild p95", value: host.uiRenderCount ? formatTimeMs(host.uiRenderMsP95) : "--" },
        { label: "Main-thread blocks", value: String(host.longTaskCount || 0) },
        { label: "Event-loop lag p95", value: formatTimeMs(host.eventLoopLagMsP95) },
        { label: "Render cache reuse", value: formatPercent(cacheReuse) },
        { label: "Signal pressure avg", value: `${formatNumber(host.signalPressurePerSecondAvg, 1)}/s` },
      ],
      sections: [
        {
          title: "Signal flow",
          description: "Per-second architectural activity. Presentations and cache hits are throughput and do not increase the pressure light.",
          items: PERFORMANCE_SIGNAL_CATEGORIES.map(([id, label]) => ({
            label,
            value: `${formatNumber(host.signalCategoriesPerSecondAvg?.[id], 1)}/s`,
          })),
        },
        {
          title: "Attributed CPU hotspots",
          description: "Average, p95, and maximum duration for the bounded diagnostic pass samples. Component rows include their child work.",
          table: {
            columns: [
              { id: "rank", label: "#" }, { id: "pass", label: "Pass" }, { id: "avg", label: "Avg" },
              { id: "p95", label: "P95" }, { id: "max", label: "Max" }, { id: "samples", label: "N" },
            ],
            rows: hotspots.slice(0, 12).map((item, index) => {
              const component = latestState.components?.find((candidate) => candidate.id === item.componentId);
              return {
                rank: index + 1,
                pass: {
                  label: item.name,
                  detail: item.kind,
                  media: component?.thumbnail ? { src: component.thumbnail } : null,
                },
                avg: formatTimeMs(item.msAvg),
                p95: formatTimeMs(item.msP95),
                max: formatTimeMs(item.msMax),
                samples: item.sampleCount,
              };
            }),
          },
        },
        ...(report.analysis?.bottlenecks?.length ? [{
          title: "Observations",
          items: report.analysis.bottlenecks.slice(0, 6).map((item) => `${item.scope} · ${item.message}`),
        }] : []),
        {
          title: "Host / UI activity",
          description: `${host.uiRenderCount || 0} UI reconciliations · ${host.stateEventCount || 0} state notifications · ${host.longTaskTotalMs ? `${formatTimeMs(host.longTaskTotalMs)} blocked in long tasks` : "no long tasks observed"}`,
          items: (host.topStateEvents || []).map((item) => `${item.reason} · ${item.count}`),
        },
      ],
      note: "GPU time is an aggregate of completed non-overlapping WebGL timer queries. Exact per-pass GPU profiling is not run continuously because it changes the workload being measured.",
      actions: [{ id: "close", label: "Close" }, { id: "download", label: "Download report", icon: "download" }],
    };
  }

  function downloadPerformanceReport(report) {
    if (!report) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeProjectName = String(latestState.project?.name || "vj1")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vj1";
    retainedUi.updateNode("file-download", {
      request: {
        id: `profile:${timestamp}`,
        filename: `${timestamp}-${safeProjectName}.profile.json`,
        mime: "application/json",
        text: JSON.stringify(boundedProfileValue(report), null, 2),
      },
    }, { scope: "vj1.control.ui" });
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
    return activePointerCount > 0 || activeEditor;
  }

  async function openProjectFolder() {
    const result = await projectService.openFolder().catch((error) => {
      setStatus(`Folder error: ${error.message || error}`);
      return null;
    });
    if (result?.fallback) refs.shell.requestImport();
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
    const returnLabel = hasProject && deepEditReturnContext
      ? `Return to ${workspaceLabel(deepEditReturnContext.workspace)}`
      : "";
    const outputPlaying = state.global.playing !== false;
    const diagnostic = diagnosticsSnapshot || emptyDiagnosticsSummary();
    const diagnosticCount = Math.max(0, Number(diagnostic.counts?.error) || 0) + Math.max(0, Number(diagnostic.counts?.warning) || 0) + Math.max(0, Number(diagnostic.counts?.info) || 0);
    refs.shell.update({
      brand: "VJ",
      hasProject,
      workspace: currentWorkspace(state),
      project: {
        name: projectName,
        meta: hasProject ? projectMeta : "Choose a folder to begin",
        returnLabel,
      },
      workspaces: [
        { id: "component", label: "Components", icon: UI_ICONS.component },
        { id: "scene", label: "Scenes", icon: UI_ICONS.scene },
        { id: "live", label: "Live", icon: UI_ICONS.live },
        { id: "mapping", label: "Mapping", icon: UI_ICONS.mapping, group: "technical" },
        { id: "nodes", label: "Nodes", icon: UI_ICONS.nodes, group: "technical" },
      ].map((item) => ({ ...item, disabled: !hasProject, active: item.id === currentWorkspace(state) })),
      actions: [
        { id: "toggle-preview", label: "Toggle preview", icon: "visibility", active: state.ui.debugPreview === true },
        { id: "toggle-hud", label: "Output FPS and resolution", icon: "bug_report", active: state.global.showHud !== false },
        { id: "settings", label: "Settings", icon: "settings" },
        { id: "diagnostics-toggle", label: diagnostic.level === "ok" ? "Diagnostics: OK" : `Diagnostics: ${diagnosticCount} entries`, icon: diagnosticIcon(diagnostic.level), presentation: "diagnostics", level: diagnostic.level, active: diagnosticsOpen },
        { id: "undo", label: "Undo", icon: "undo", disabled: !state.ui.canUndo },
        { id: "redo", label: "Redo", icon: "redo", disabled: !state.ui.canRedo },
        { id: "playback", label: outputPlaying ? "Pause playback" : "Play playback", icon: outputPlaying ? "pause" : "play_arrow", disabled: !hasProject, active: hasProject && !outputPlaying },
        { id: "blackout", label: "Blackout", icon: "brightness_1", presentation: "danger", active: state.global.blackout === true },
      ],
      outputs: (state.render.outputs || []).map((output) => ({
        id: output.id,
        name: output.name,
        detail: formatOutputAspect(output.aspectRatio),
        connected: Boolean(state.metrics.outputs?.[output.id]),
      })),
      health: topbarHealthModel(state),
    });
    retainedUi.updateNode("diagnostics", {
      title: "Diagnostics",
      level: diagnostic.level,
      counts: diagnostic.counts,
      entries: diagnostic.entries,
    }, { scope: "vj1.control.ui" });
    refs.shell.setPopover("diagnostics", diagnosticsOpen);
    refs.shell.setPopover("performance", performanceSummaryOpen);
    if (performanceSummaryOpen && !shouldDeferRender()) renderPerformanceSummary(state);
  }

  function renderTopbarHealth(state) {
    refs?.shell?.updateHealth?.(topbarHealthModel(state));
  }

  function topbarHealthModel(state) {
    const outputConnected = state.metrics.clients > 0;
    const outputFps = outputConnected ? Math.max(0, Number(state.metrics.fps) || 0) : 0;
    const renderCost = activeRenderCost(state);
    const profileSeconds = performanceSession.remainingSeconds();
    const workMetric = activeWorkMetric(state, outputFps);
    const signalLoad = activeSignalLoad(state, controlSignalMeter.snapshot());
    const frameInterval = frameTimeFromFps(workMetric.fps);
    return {
      active: performanceSession.isActive(),
      outputConnected,
      outputText: outputConnected ? `${Math.round(outputFps)}` : "-",
      label: performanceSession.isActive()
        ? `Profiling rendering… ${profileSeconds} second${profileSeconds === 1 ? "" : "s"} remaining`
        : `Overall ${formatRenderCost(renderCost)} · CPU ${formatTimeMs(workMetric.cpuMs)} · GPU ${workMetric.gpuSupported ? formatTimeMs(workMetric.gpuMs) : "unavailable"} · Signals ${Math.round(signalLoad.totalPerSecond)}/s · Output ${outputConnected ? `${Math.round(outputFps)} fps` : "closed"}`,
      levels: [
        performanceHealthStep(renderCost),
        performanceHealthStep(frameInterval > 0 ? workMetric.cpuMs / frameInterval : 0),
        workMetric.gpuSupported ? performanceHealthStep(frameInterval > 0 ? workMetric.gpuMs / frameInterval : 0) : null,
        performanceHealthStep(signalLoad.pressure),
      ],
    };
  }

  function openOutputWindows(state, outputs = []) {
    // Opening a display is infrastructure, not a Live performance command.
    // The popup receives the existing Live program through the output bridge;
    // editor selection must never change the program Scene as a side effect.
    retainedUi.updateNode("window-open", {
      requests: outputs.map((output) => ({
        id: `output:${++outputWindowRequestSequence}`,
        url: buildOutputUrl("output", { outputId: output.id }),
        name: `vj1-output-${output.id}`,
        features: "popup=yes",
      })),
    }, { scope: "vj1.control.ui" });
    if (!outputs.length) return;
    updateUi((ui) => {
      ui.outputWindowOpen = true;
    }, "open-output");
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

  function renderProjectRail(state) {
    const hasProject = hasOpenProject(state);
    const workspace = currentWorkspace(state);
    if (workspace !== "live") retainedUi.deactivate("vj1.control.live-timing");
    const railScopes = [
      "vj1.control.component-catalog",
      "vj1.control.scene-rail",
      "vj1.control.mapping-rail",
      "vj1.control.live-rail",
      "vj1.control.nodes-rail",
    ];
    for (const scope of railScopes) {
      const activeScope = {
        component: "vj1.control.component-catalog",
        scene: "vj1.control.scene-rail",
        mapping: "vj1.control.mapping-rail",
        live: "vj1.control.live-rail",
        nodes: "vj1.control.nodes-rail",
      }[workspace];
      if (!hasProject || scope !== activeScope) retainedUi.deactivate(scope);
    }
    if (hasProject && workspace === "component") {
      for (const nodeId of ["component-catalog-list", "scene-catalog-list", "mapping-catalog-list"]) retainedUi.unmountNode(nodeId);
      retainedUi.activate(compileUiModel(componentCatalogUiModel({
        items: componentCatalogListItems(catalogItemsInSnapshot("component", ordinaryComponents(state)), state),
        selectedId: state.ui?.selectedComponentId || "",
        sortMode: catalogSortMode(state, "component"),
        projectId: state.project?.folderName || state.project?.name || "unopened",
      }), { id: "vj1.control.component-catalog" }), { host: refs.projectRail, scope: "vj1.control.component-catalog" });
      return;
    }
    if (hasProject && workspace === "scene") {
      for (const nodeId of ["component-catalog-list", "scene-catalog-list", "mapping-catalog-list"]) retainedUi.unmountNode(nodeId);
      retainedUi.activate(compileUiModel(sceneRailUiModel(state, {
        items: componentCatalogListItems(catalogItemsInSnapshot("scene", sceneComponents(state)), state),
        sortMode: catalogSortMode(state, "scene"),
        projectId: state.project?.folderName || state.project?.name || "unopened",
      }), { id: "vj1.control.scene-rail" }), { host: refs.projectRail, scope: "vj1.control.scene-rail" });
      return;
    }
    if (hasProject && workspace === "mapping") {
      for (const nodeId of ["component-catalog-list", "scene-catalog-list", "mapping-catalog-list"]) retainedUi.unmountNode(nodeId);
      retainedUi.activate(mappingRailUiGraph(state, {
        items: mappingCatalogListItems(catalogItemsInSnapshot("mapping", state.mappings || [])),
        sortMode: catalogSortMode(state, "mapping"),
        projectId: state.project?.folderName || state.project?.name || "unopened",
      }), { host: refs.projectRail, scope: "vj1.control.mapping-rail" });
      return;
    }
    if (hasProject && workspace === "live") {
      const showScenes = state.ui?.live?.showScenes !== false;
      const showComponents = state.ui?.live?.showComponents === true;
      const sources = catalogItemsInSnapshot("live", [
        ...(showScenes ? sceneComponents(state) : []),
        ...(showComponents ? ordinaryComponents(state) : []),
      ]);
      retainedUi.activate(liveRailUiGraph(state, {
        items: liveSourceListItems(sources, state),
        selectedId: selectedLiveSourceId(state),
        sortMode: catalogSortMode(state, "live"),
        projectId: state.project?.folderName || state.project?.name || "unopened",
      }), { host: refs.projectRail, scope: "vj1.control.live-rail" });
      const timingPanel = retainedUi.getNode("live-timing-panel", { scope: "vj1.control.live-rail" });
      retainedUi.activate(liveTimingUiGraph(state, transitionEntriesForState(state)), {
        host: timingPanel.slot("content"),
        scope: "vj1.control.live-timing",
      });
      return;
    }
    retainedUi.deactivate("vj1.control.live-timing");
    if (hasProject && workspace === "nodes") {
      retainedUi.activate(nodesRailUiGraph(nodeLibraryRailModel(state, editorNodePackage)), {
        host: refs.projectRail,
        scope: "vj1.control.nodes-rail",
      });
      return;
    }
    for (const scope of railScopes) retainedUi.deactivate(scope);
  }

  function dispatchUiNodeCommand(command) {
    if (modals?.handleUiCommand?.(command)) return true;
    if (command.action === "global.shortcut") {
      if (command.payload?.id === "redo") redoProject();
      else if (command.payload?.id === "undo") undoProject();
      return true;
    }
    if (command.action === "global.interaction") {
      const active = command.payload?.active === true;
      if (command.payload?.kind === "pointer") {
        activePointerCount = active ? activePointerCount + 1 : Math.max(0, activePointerCount - 1);
      } else if (command.payload?.kind === "editor") activeEditor = active;
      if (active) beginInteractionHold();
      else scheduleDeferredRenderFlush();
      return true;
    }
    if (command.action === "global.viewport") {
      compactPreviewLayout = command.payload?.matches === true;
      scheduleRenderNow(latestState, { reason: "preview-layout" });
      return true;
    }
    if (command.action === "global.lifecycle") {
      onLifecycle?.(command.payload || {});
      return true;
    }
    if (command.action === "download.complete") return true;
    if (command.action === "download.error") {
      setStatus(`Download failed: ${command.payload?.message || "unknown error"}`);
      return true;
    }
    if (command.action === "window.complete") return true;
    if (command.action === "window.blocked") {
      setStatus("Output window was blocked by the browser");
      return true;
    }
    if (command.action === "clipboard.target") {
      clipboard.setLocation(command.payload || {});
      return true;
    }
    if (command.action === "clipboard.cut") return clipboard.cut();
    if (command.action === "clipboard.delete") return clipboard.remove();
    if (command.action === "clipboard.paste") {
      clipboard.paste(command.payload || {});
      return true;
    }
    if (command.action === "shell.action") return handleShellAction(String(command.payload?.id || ""), command.payload || {});
    if (command.action === "diagnostics.clear") {
      diagnostics?.clear?.();
      return true;
    }
    if (command.action === "diagnostics.copy") {
      const text = diagnostics?.copyText?.() || "";
      if (!text) return true;
      globalThis.navigator?.clipboard?.writeText?.(text)
        .then(() => setStatus("Diagnostics copied"))
        .catch((error) => setStatus(`Could not copy diagnostics: ${error?.message || error}`));
      return true;
    }
    if (command.action === "performance.summary-action" && command.payload?.id === "edit") {
      openComponentEditor(String(command.payload?.componentId || ""), String(command.payload?.chainItemId || ""));
      return true;
    }
    if (command.action === "performance.report-close") {
      retainedUi.updateNode("performance-report", { open: false }, { scope: "vj1.control.ui" });
      return true;
    }
    if (command.action === "performance.report-action" && command.payload?.id === "download") {
      downloadPerformanceReport(globalThis.__vj1LastProfileReport);
      return true;
    }
    if (command.action === "context-menu.close") return inputs.dismissContextMenu();
    if (command.action === "context-menu.action") {
      return inputs.executeContextMenuAction(command.payload?.id);
    }
    if (command.action === "picker.open-media") {
      modals.openMediaPicker(String(command.payload?.path || ""), String(command.payload?.accept || ""));
      return true;
    }
    if (command.action === "picker.open-live-media") {
      const payload = command.payload || {};
      modals.openMediaPicker("", String(payload.accept || ""), (value) => {
        store.updateLive((draft) => {
          setLiveNodeParameterDiff(
            draft,
            String(payload.componentId || ""),
            String(payload.nodeId || ""),
            String(payload.path || ""),
            value,
          );
        }, { reason: "live:media-parameter", input: "ui" });
      });
      return true;
    }
    if (command.action === "picker.open-source") {
      modals.openSourceChoicePicker(
        String(command.payload?.path || ""),
        String(command.payload?.category || ""),
        {
          allowComponents: command.payload?.allowComponents === true,
          ownerComponentId: String(command.payload?.ownerComponentId || ""),
        },
      );
      return true;
    }
    if (command.action === "picker.open-element") {
      modals.openElementPicker(
        String(command.payload?.componentId || latestState.ui?.selectedComponentId || ""),
        String(command.payload?.targetChainItem || ""),
      );
      return true;
    }
    if (command.action === "animation.edit") {
      return handleParameterAnimationCommand(command.payload || {}, {
        getState: () => latestState,
        store,
        setStatus,
        triggerParameterAnimation,
      });
    }
    if (command.action === "preview.zoom") {
      nudgePreviewZoom(Number(command.payload?.multiplier) || 1);
      return true;
    }
    if (command.action === "preview.toggle-diagnostics") {
      updateUi((ui) => { ui.previewDiagnostics = ui.previewDiagnostics !== true; }, "preview-diagnostics");
      return true;
    }
    if (command.action === "preview.cycle-quality") {
      store.update((draft) => {
        if (!["component", "scene", "mapping", "live"].includes(currentWorkspace(draft))) return;
        draft.ui.previewQuality = nextPreviewQuality(draft.ui.previewQuality);
      }, "preview-quality");
      return true;
    }
    if (command.action === "preview.fit-world") {
      updateUi((ui) => { updatePreviewViewportForUi(ui, resetViewport()); }, "preview-fit-world");
      return true;
    }
    if (command.action === "preview.fit-frame") {
      const previewSurface = retainedUi.getNode("preview-surface", { scope: "vj1.control.preview-surface" });
      const previewHost = previewSurface?.slot?.("frame");
      const stage = previewSurface?.slot?.("stage");
      const rect = stage?.getBoundingClientRect?.();
      updateUi((ui) => {
        updatePreviewViewportForUi(ui, fitPreviewViewport({
          workspace: currentWorkspace(latestState),
          stageSize: {
            width: Math.max(1, Math.floor(rect?.width || previewHost?.clientWidth || 960)),
            height: Math.max(1, Math.floor(rect?.height || previewHost?.clientHeight || 540)),
          },
          render: latestState.render,
        }));
      }, "preview-fit-frame");
      return true;
    }
    if (command.action === "preview.toggle-mapping-handles") {
      store.update((draft) => {
        draft.global.mappingHandleMode = draft.global.mappingHandleMode === "near" ? "always" : "near";
      }, "toggle-mapping-handles");
      return true;
    }
    if (command.action === "nodes.library-search" || command.action === "nodes.library-drag") return true;
    if (command.action === "nodes.library-select") {
      const id = String(command.payload?.id || "");
      if (!id) return false;
      if (command.payload?.kind === "project-group") {
        updateUi((ui) => { ui.selectedNodeGroupId = id; }, "select-node-group");
      } else {
        updateUi((ui) => {
          ui.selectedNodeDefinitionId = id;
          ui.selectedNodeGroupId = "";
        }, "select-node-definition");
      }
      return true;
    }
    if (command.action === "nodes.library-action") {
      handleNodesLibraryAction(command.payload || {});
      return true;
    }
    if (command.action.startsWith("nodes.graph-")) {
      const handlers = nodeGraphCommandHandlers();
      if (command.action === "nodes.graph-status") handlers.onStatus(command.payload?.message);
      else if (command.action === "nodes.graph-change") handlers.onGraphChange(command.payload?.graph, command.payload?.reason);
      else if (command.action === "nodes.graph-media-request") handlers.onMediaParameterRequest(command.payload || {});
      else if (command.action === "nodes.graph-public-parameter-toggle") handlers.onPublicParameterToggle(command.payload || {});
      else if (command.action === "nodes.graph-public-port-toggle") handlers.onPublicPortToggle(command.payload || {});
      else return false;
      return true;
    }
    if (command.action === "nodes.editor-save" || command.action === "nodes.editor-reset") {
      const baseId = String(command.payload?.baseId || "");
      const baseVersion = String(command.payload?.baseVersion || "");
      let definition;
      try {
        definition = editorNodePackage?.registry?.get?.(baseId, baseVersion);
      } catch {
        setStatus("Node definition is no longer available");
        return true;
      }
      if (!definition) return false;
      if (command.action === "nodes.editor-reset") {
        store.update((draft) => {
          draft.nodes = withoutProjectNodeFork(draft.nodes, definition);
        }, "update:node-fork-reset");
        setStatus(`${definition.name} restored to the built-in version`);
        return true;
      }
      try {
        const nextNodes = prepareProjectNodeDefinitionEdit(
          withProjectNodeFork(latestState.nodes, definition, command.payload?.sources || {}),
          definition,
          { preflight: editorNodePackage?.preflightGraphEdit },
        );
        store.update((draft) => { draft.nodes = nextNodes; }, "update:node-fork");
        setStatus(`${definition.name} project version saved`);
      } catch (error) {
        setStatus(`${definition.name} project version was not saved: ${error?.message || "invalid source"}`);
      }
      return true;
    }
    if (command.action === "component.catalog-search") return true;
    if (command.action === "component.catalog-action") {
      const action = String(command.payload?.id || "");
      if (action === "add") {
        store.addComponent();
        return true;
      }
      if (action.startsWith("sort:")) {
        const mode = action.slice("sort:".length);
        if (!["recent", "marker", "name", "created"].includes(mode)) return false;
        updateUi((ui) => {
          ui.catalogSortModes ||= {};
          ui.catalogSortModes.component = mode;
        }, "catalog-sort:component");
        captureCatalogOrder("component", latestState);
        renderProjectRail(latestState);
        return true;
      }
      return false;
    }
    if (command.action === "live.catalog-search") return true;
    if (command.action === "live.source-filter") {
      const kind = command.payload?.kind === "components" ? "components" : "scenes";
      const key = kind === "components" ? "showComponents" : "showScenes";
      const otherKey = key === "showScenes" ? "showComponents" : "showScenes";
      const value = command.payload?.value === true;
      updateUi((ui) => {
        ui.live ||= {};
        const otherEnabled = otherKey === "showScenes"
          ? ui.live.showScenes !== false
          : ui.live.showComponents === true;
        if (!value && !otherEnabled) return;
        ui.live[key] = value;
      }, "live-source-filter");
      return true;
    }
    if (command.action === "live.catalog-action") {
      const action = String(command.payload?.id || "");
      if (!action.startsWith("sort:")) return false;
      const mode = action.slice("sort:".length);
      if (!["recent", "marker", "name", "created"].includes(mode)) return false;
      updateUi((ui) => {
        ui.catalogSortModes ||= {};
        ui.catalogSortModes.live = mode;
      }, "catalog-sort:live");
      captureCatalogOrder("live", latestState);
      renderProjectRail(latestState);
      return true;
    }
    if (["live.source-select", "live.source-action"].includes(command.action)) {
      const id = String(command.payload?.id || "");
      const target = latestState.components.find((component) => component.id === id);
      if (!target) return false;
      if (command.action === "live.source-select") {
        if (target.type === "scene") store.selectLiveScene(id);
        else store.selectLiveComponent?.(id);
        return true;
      }
      if (command.payload?.action === "marker") {
        return store.cycleCatalogMarker?.(
          target.type === "scene" ? "scene" : "component",
          id,
        ) === true;
      }
      if (command.payload?.action === "reset") {
        store.resetLiveTarget?.(id);
        return true;
      }
      return false;
    }
    if (command.action === "live.reset-parameters") {
      store.resetLiveParameters?.();
      return true;
    }
    if (command.action === "live.component-view-select") {
      const id = command.payload?.id === "elements" ? "elements" : "controls";
      updateUi((ui) => {
        ui.live ||= {};
        ui.live.componentView = id;
      }, "select-live-component-view");
      return true;
    }
    if (command.action === "live.element-select") {
      const componentId = String(getLiveSelectedTarget(latestState)?.id || "");
      const nodeId = String(command.payload?.id || "");
      if (!componentId || !nodeId) return false;
      updateUi((ui) => {
        ui.live ||= {};
        ui.live.selectedChainItemIds ||= {};
        ui.live.selectedChainItemIds[componentId] = nodeId;
      }, "select-live-chain-item");
      return true;
    }
    if (command.action === "live.element-action") {
      if (command.payload?.action !== "toggle-enabled") return false;
      return inputs.updateLiveValue({
        componentId: String(command.payload?.componentId || ""),
        nodeId: String(command.payload?.nodeId || command.payload?.id || ""),
        path: String(command.payload?.path || "enabled"),
      }, command.payload?.value === true, { phase: command.phase });
    }
    if (command.action === "inspector.add-element") {
      const componentId = String(command.payload?.targetId || "");
      if (!componentId) return false;
      modals.openElementPicker(componentId, "");
      return true;
    }
    if (command.action === "inspector.edit-component") {
      const componentId = String(command.payload?.targetId || "");
      if (!componentId) return false;
      openComponentEditor(componentId);
      return true;
    }
    if (command.action === "live.output-select") {
      const id = String(command.payload?.id || "");
      if (!id) return false;
      store.selectLivePreviewSurface?.(id);
      return true;
    }
    if (command.action === "live.output-action") {
      const id = String(command.payload?.id || "");
      const action = String(command.payload?.action || "");
      if (!id || !action) return false;
      if (action === "toggle-visibility") {
        store.toggleLiveSurfaceVisibility?.(id);
        return true;
      }
      if (action === "clear-patch" && id !== "__mapping__") {
        store.clearLiveSurfacePatch?.(id);
        return true;
      }
      if (action === "clear-overall" && id === "__mapping__") {
        store.clearLiveOverallComponent?.();
        return true;
      }
      return false;
    }
    if (command.action === "live.inspect-component") {
      const id = String(command.payload?.id || "");
      if (!id) return false;
      updateUi((ui) => {
        ui.live ||= {};
        ui.live.inspectedComponentId = id;
      }, "select-live-inspected-component");
      return true;
    }
    if (command.action === "mapping.reset-surface") {
      resetProjectMapping(String(command.payload?.surfaceId || ""));
      return true;
    }
    if (command.action === "component.element-select") {
      const nodeId = String(command.payload?.id || "");
      if (!nodeId) return false;
      store.selectChainItem(nodeId);
      return true;
    }
    if (command.action === "component.element-action") {
      const operation = String(command.payload?.operation || command.payload?.action || "");
      if (operation === "toggle-enabled") {
        return inputs.updatePersistentValue(String(command.payload?.path || ""), command.payload?.value, {
          phase: command.phase,
        });
      }
      if (operation === "remove") {
        store.removeChainItem?.(
          String(command.payload?.componentId || command.target?.componentId || ""),
          String(command.payload?.nodeId || command.payload?.id || ""),
        );
        return true;
      }
      if (operation === "edit-component") {
        openComponentEditor(String(command.payload?.componentId || ""));
        return true;
      }
      return false;
    }
    if (command.action === "component.element-reorder") {
      const componentId = String(command.target?.componentId || "");
      const fromId = String(command.payload?.fromId || "");
      const toId = String(command.payload?.toId || "");
      const position = ["before", "inside", "after"].includes(command.payload?.position)
        ? command.payload.position
        : "before";
      if (!componentId || !fromId || !toId) return false;
      store.reorderChain(componentId, fromId, toId, position);
      return true;
    }
    if (command.action === "project.set-value") {
      return inputs.updatePersistentValue(command.address, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "project.set-range") {
      return inputs.updatePersistentRange(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "project.set-related-value") {
      return inputs.updatePersistentRelatedValue(command.target, command.payload, {
        phase: command.phase,
      });
    }
    if (command.action === "project.set-video-trim") {
      return inputs.updatePersistentVideoTrim(
        command.target,
        command.payload?.value,
        command.payload?.active,
        { phase: command.phase },
      );
    }
    if (command.action === "project.set-boundary-scale") {
      return inputs.updatePersistentBoundaryScale(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "project.trigger-event") {
      return inputs.triggerPersistentEvent(command.target);
    }
    if (command.action === "parameter.open-context-menu") {
      const rangeRole = String(command.payload?.role || "");
      const target = rangeRole && command.target?.[rangeRole]
        ? command.target[rangeRole]
        : command.target;
      return inputs.openParameterContextMenu(target, {
        x: command.payload?.x,
        y: command.payload?.y,
      });
    }
    if (command.action === "live.set-value") {
      return inputs.updateLiveValue(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "live.set-range") {
      return inputs.updateLiveRange(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "live.set-related-value") {
      return inputs.updateLiveRelatedValue(command.target, command.payload, {
        phase: command.phase,
      });
    }
    if (command.action === "live.set-boundary-scale") {
      return inputs.updateLiveBoundaryScale(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (command.action === "live.trigger-event") {
      return inputs.triggerLiveEvent(command.target);
    }
    if (command.action === "live.set-animation-value") {
      return inputs.updateLiveAnimationValue(command.target, command.payload?.value, {
        phase: command.phase,
      });
    }
    if (["component.select", "component.item-action", "component.item-context"].includes(command.action)) {
      const id = String(command.payload?.id || "");
      if (!id) return false;
      if (command.action === "component.select") {
        store.selectComponent(id);
        const selected = latestState.components.find((item) => item.id === id);
        clipboard.setTarget({
          kind: selected?.type === "scene" ? "scene-list" : "component-list",
          itemId: id,
        });
        return true;
      }
      if (command.action === "component.item-context") {
        return inputs.openComponentContextMenu(id, {
          x: command.payload?.x,
          y: command.payload?.y,
        });
      }
      if (command.payload?.action === "remove") {
        store.removeComponent(id);
        return true;
      }
      if (command.payload?.action === "marker") {
        const selected = latestState.components.find((item) => item.id === id);
        return store.cycleCatalogMarker?.(
          selected?.type === "scene" ? "scene" : "component",
          id,
        ) === true;
      }
      return false;
    }
    if (command.action === "scene.catalog-search") return true;
    if (command.action === "scene.catalog-action") {
      const action = String(command.payload?.id || "");
      if (action === "add") {
        store.addScene?.();
        return true;
      }
      if (action.startsWith("sort:")) {
        const mode = action.slice("sort:".length);
        if (!["recent", "marker", "name", "created"].includes(mode)) return false;
        updateUi((ui) => {
          ui.catalogSortModes ||= {};
          ui.catalogSortModes.scene = mode;
        }, "catalog-sort:scene");
        captureCatalogOrder("scene", latestState);
        renderProjectRail(latestState);
        return true;
      }
      return false;
    }
    if (command.action === "surface.catalog-action" && command.payload?.id === "add") {
      store.addSurface?.();
      return true;
    }
    if (["surface.select", "surface.item-action", "surface.reorder"].includes(command.action)) {
      const id = String(command.payload?.id || "");
      if (command.action === "surface.reorder") {
        const fromId = String(command.payload?.fromId || "");
        const toId = String(command.payload?.toId || "");
        if (!fromId || !toId) return false;
        store.reorderSurfaces?.(fromId, toId);
        return true;
      }
      if (!id) return false;
      if (command.action === "surface.select") {
        store.selectSurface(id);
        clipboard.setTarget({ kind: "surface-list", itemId: id });
        return true;
      }
      if (command.payload?.action === "remove") {
        store.removeSurface(id);
        return true;
      }
      if (id === "__scene_mapping__" && command.payload?.action === "toggle-scene-mapping") {
        store.setSceneMappingInLive?.(latestState.ui?.live?.sceneMappingInLive === false);
        return true;
      }
      if (command.payload?.action === "toggle-enabled") {
        const mappingIndex = latestState.mappings.findIndex((mapping) => mapping.id === latestState.ui?.selectedMappingId);
        const surfaceIndex = latestState.mappings[mappingIndex]?.surfaces?.findIndex((surface) => surface.id === id) ?? -1;
        const surface = latestState.mappings[mappingIndex]?.surfaces?.[surfaceIndex];
        if (!surface || mappingIndex < 0 || surfaceIndex < 0) return false;
        clipboard.setTarget({ kind: "surface-list", itemId: id });
        if (typeof store.setMappingSurfaceVisibility === "function") {
          store.setMappingSurfaceVisibility(
            latestState.mappings[mappingIndex].id,
            surface.id,
            surface.enabled === false,
            "toggle:mapping-surface-visibility",
          );
          return true;
        }
        store.selectSurface(id);
        return inputs.updatePersistentValue(`mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`, surface.enabled === false);
      }
      return false;
    }
    if (command.action === "mapping.catalog-search") return true;
    if (command.action === "mapping.catalog-action") {
      const action = String(command.payload?.id || "");
      if (action === "add") {
        store.addMapping(`Map ${latestState.mappings.length + 1}`);
        return true;
      }
      if (action.startsWith("sort:")) {
        const mode = action.slice("sort:".length);
        if (!["recent", "marker", "name", "created"].includes(mode)) return false;
        updateUi((ui) => {
          ui.catalogSortModes ||= {};
          ui.catalogSortModes.mapping = mode;
        }, "catalog-sort:mapping");
        captureCatalogOrder("mapping", latestState);
        renderProjectRail(latestState);
        return true;
      }
      return false;
    }
    if (!["mapping.select", "mapping.item-action"].includes(command.action)) return false;
    const id = String(command.payload?.id || "");
    if (!id) return false;
    if (command.action === "mapping.select") {
      store.selectMapping(id);
      clipboard.setTarget({ kind: "mapping-list", itemId: id });
      return true;
    }
    if (command.action === "mapping.item-action" && command.payload?.action === "remove") {
      store.deleteMapping(id);
      return true;
    }
    return false;
  }

  function handleShellAction(id, payload = {}) {
    if (id.startsWith("workspace:")) {
      if (!hasOpenProject(latestState)) return false;
      const workspace = id.slice("workspace:".length);
      deepEditReturnContext = null;
      switchWorkspace(WORKSPACES.includes(workspace) ? workspace : "scene");
      return true;
    }
    if (id.startsWith("output:")) {
      const outputId = id.slice("output:".length);
      openOutputWindows(latestState, (latestState.render.outputs || []).filter((output) => output.id === outputId));
      return true;
    }
    if (id === "open-output") {
      const outputs = latestState.render.outputs || [];
      if (outputs.length === 1) openOutputWindows(latestState, outputs);
      return true;
    }
    if (id === "open-folder") {
      openProjectFolder();
      return true;
    }
    if (id === "close-project") {
      closeProject();
      return true;
    }
    if (id === "return") {
      returnFromDeepEdit();
      return true;
    }
    if (id === "import-files") {
      importFiles(payload.files || []);
      return true;
    }
    if (id === "toggle-preview") {
      updateUi((ui) => {
        ui.debugPreview = !ui.debugPreview;
        rememberPreviewPreference(ui.debugPreview);
      }, "toggle-preview");
      return true;
    }
    if (id === "toggle-hud") {
      store.update((draft) => { draft.global.showHud = draft.global.showHud === false; }, "toggle-output-hud");
      return true;
    }
    if (id === "settings") {
      modals.openSettings();
      return true;
    }
    if (id === "diagnostics-toggle") {
      diagnosticsOpen = !diagnosticsOpen;
      refs.shell.setPopover("diagnostics", diagnosticsOpen);
      return true;
    }
    if (id === "performance-toggle") {
      togglePerformanceSummary();
      return true;
    }
    if (id === "performance-analyze") {
      closePerformanceSummary();
      performanceSession.start();
      return true;
    }
    if (id === "dismiss-popovers") {
      diagnosticsOpen = false;
      closePerformanceSummary();
      refs.shell.setPopover("diagnostics", false);
      return true;
    }
    if (id === "undo") {
      undoProject();
      return true;
    }
    if (id === "redo") {
      redoProject();
      return true;
    }
    if (id === "playback") {
      if (!hasOpenProject(latestState)) return false;
      store.update((draft) => { draft.global.playing = draft.global.playing === false; }, "toggle-output-playback");
      return true;
    }
    if (id === "blackout") {
      store.update((draft) => { draft.global.blackout = !draft.global.blackout; }, "blackout");
      return true;
    }
    return false;
  }

  function showContextMenu(model) {
    if (!refs?.contextMenuHost) return false;
    retainedUi.activate(contextMenuUiGraph(model), {
      host: refs.contextMenuHost,
      scope: "vj1.control.context-menu",
    });
    return true;
  }

  function closeContextMenu() {
    retainedUi.deactivate("vj1.control.context-menu");
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
    if (!hasOpenProject(state) || workspace !== "live") {
      retainedUi.deactivate("vj1.control.live-projection-rail");
      retainedUi.deactivate("vj1.control.live-significant");
      return;
    }
    const model = liveProjectionListModel(state);
    retainedUi.activate(liveProjectionRailUiGraph(model), {
      host: refs.liveProjectionRail,
      scope: "vj1.control.live-projection-rail",
    });
    const significantPanel = retainedUi.getNode("live-significant-panel", {
      scope: "vj1.control.live-projection-rail",
    });
    if (model.hasSignificant && significantPanel) {
      retainedUi.activate(liveSignificantUiGraph(state), {
        host: significantPanel.slot("content"),
        scope: "vj1.control.live-significant",
      });
    } else {
      retainedUi.deactivate("vj1.control.live-significant");
    }
  }

  function renderStudio(state) {
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      retainedUi.deactivate("vj1.control.preview-tools");
      embeddedPreview.pause();
      retainedUi.activate(previewSurfaceUiGraph({ empty: true, emptyText: "Open a project folder to begin" }), {
        host: refs.studio,
        scope: "vj1.control.preview-surface",
      });
      return;
    }
    if (currentWorkspace(state) === "nodes") {
      retainedUi.deactivate("vj1.control.preview-surface");
      retainedUi.deactivate("vj1.control.preview-tools");
      embeddedPreview.pause();
      const model = nodeLibraryStudioModel(state, editorNodePackage);
      retainedUi.activate(nodesWorkspaceStudioUiGraph(model), {
        host: refs.studio,
        scope: "vj1.control.nodes-workspace-studio",
      });
      return;
    }
    retainedUi.deactivate("vj1.control.nodes-workspace-studio");
    if (compactPreviewLayout) {
      retainedUi.deactivate("vj1.control.preview-surface");
      retainedUi.deactivate("vj1.control.preview-tools");
      embeddedPreview.pause();
      return;
    }
    retainedUi.activate(previewSurfaceUiGraph(), {
      host: refs.studio,
      scope: "vj1.control.preview-surface",
    });
  }

  function renderPreview(state, context = {}) {
    if (currentWorkspace(state) === "nodes" || compactPreviewLayout) return;
    const previewSurface = retainedUi.getNode("preview-surface", { scope: "vj1.control.preview-surface" });
    const previewHost = previewSurface?.slot?.("frame");
    const previewStage = previewSurface?.slot?.("stage");
    const toolsHost = previewSurface?.slot?.("tools");
    if (!previewHost || !previewStage || !toolsHost) return;
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
    retainedUi.activate(previewToolsUiGraph(state, { workspace, kind }), {
      host: toolsHost,
      scope: "vj1.control.preview-tools",
    });
    const previewHud = retainedUi.getNode("preview-hud", { scope: "vj1.control.preview-tools" });
    embeddedPreview.mount({
      surface: previewSurface,
      stage: previewStage,
      hud: previewHud,
      mode: kind,
      state: previewState,
      activation: previewActivationForContext(context),
    });
  }

  function updatePreviewState(state, activation = "full") {
    const workspace = currentWorkspace(state);
    if (workspace === "nodes" || compactPreviewLayout) return;
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
    const workspace = currentWorkspace(state);
    deactivateArtifactInspectorScopes(artifactInspectorScope(workspace));
    if (workspace !== "component" && workspace !== "scene") deactivateChainParameterUi();
    if (workspace !== "live") deactivateLiveParameterUi();
    if (workspace !== "mapping") retainedUi.deactivate("vj1.control.mapping-inspector");
    if (workspace !== "scene") retainedUi.deactivate("vj1.control.scene-surface-inspector");
    const hasProject = hasOpenProject(state);
    if (!hasProject) {
      deactivateArtifactInspectorScopes();
      retainedUi.deactivate("vj1.control.mapping-inspector");
      deactivateChainParameterUi();
      deactivateLiveParameterUi();
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    let html = "";
    if (workspace === "nodes") {
      const editorModel = nodeLibraryInspectorModel(state, editorNodePackage);
      renderInspectorPanel(state, {
        targetId: "node-editor",
        title: "Node editor",
        kind: "Node",
        icon: "schema",
        contentId: "node-graph-editor",
        secondaryId: "node-secondary-inspector",
        contentChildren: [{
          id: "node-graph-editor",
          type: "node",
          nodeType: NodeDefinitionEditorNode.id,
          inputs: { model: editorModel },
          commands: {
            save: { action: "nodes.editor-save" },
            reset: { action: "nodes.editor-reset" },
          },
        }],
      });
      return;
    }
    if (workspace === "component") {
      const selectedComponent = state.components.find((component) => component.id === state.ui.selectedComponentId) || state.components[0];
      const selectedElementParameters = selectedComponent
        ? componentSelectedChainSettingsModel(selectedComponent, state)
        : null;
      renderInspectorPanel(state, {
        targetId: selectedComponent?.id || "",
        title: selectedComponent?.name || "Component",
        titleAddress: selectedComponent ? `${pathForComponent(state, selectedComponent)}.name` : "",
        kind: "Component",
        icon: UI_ICONS.component,
        secondaryId: "component-parameters",
        emptyText: "No component",
        headerAction: selectedComponent ? {
          action: "inspector.add-element",
          label: "Add element",
          icon: "add",
        } : null,
        contentChildren: selectedComponent ? [
          componentOverviewUiModel(selectedComponent, state),
          componentElementsUiModel(selectedComponent, state),
        ] : [],
        contentId: "component-overview",
        secondaryLayout: selectedElementParameters ? ELEMENT_PARAMETER_SECTION_LAYOUT : undefined,
        secondaryChildren: selectedElementParameters ? [selectedElementParameters] : [],
      });
      return;
    }
    if (workspace === "scene") {
      const selectedScene = selectedSceneComponent(state);
      const selectedSceneSurface = state.ui.sceneInspectorTarget === "surface"
        ? state.surfaces?.find((surface) => surface.id === state.ui.selectedSurfaceId) || null
        : null;
      const selectedSceneElementParameters = selectedScene && !selectedSceneSurface
        ? componentSelectedChainSettingsModel(selectedScene, state)
        : null;
      renderInspectorPanel(state, {
        targetId: selectedScene?.id || "",
        title: selectedScene?.name || "Scene",
        titleAddress: selectedScene ? `${pathForComponent(state, selectedScene)}.name` : "",
        kind: "Scene",
        icon: UI_ICONS.scene,
        contentId: "scene-overview",
        secondaryId: "scene-surface-or-parameters",
        emptyText: "Create a scene",
        headerAction: selectedScene ? {
          action: "inspector.add-element",
          label: "Add element",
          icon: "add",
        } : null,
        contentChildren: selectedScene ? [
          { ...componentOverviewUiModel(selectedScene, state), id: "scene-overview" },
          componentElementsUiModel(selectedScene, state),
        ] : [],
        secondaryLayout: selectedSceneSurface
          ? SURFACE_INSPECTOR_SECTION_LAYOUT
          : selectedSceneElementParameters ? ELEMENT_PARAMETER_SECTION_LAYOUT : undefined,
        secondaryPresentation: selectedSceneSurface ? "scene-surface-secondary" : "artifact-secondary",
        secondaryChildren: selectedSceneSurface
          ? [sceneSurfaceInspectorUiModel(selectedSceneSurface, state)]
          : selectedSceneElementParameters ? [selectedSceneElementParameters] : [],
      });
      return;
    }
    if (workspace === "live") {
      renderInspectorPanel(state, {
        ...selectedLiveInspectorModel(state),
        contentId: "live-component-views",
        secondaryId: "live-element-parameters",
      });
      return;
    }
    retainedUi.activate(mappingSurfaceInspectorUiGraph(selectedSurface, state), {
      host: refs.inspector,
    });
  }

  function renderInspectorPanel(state, model = {}) {
    retainedUi.deactivate("vj1.control.mapping-inspector");
    retainedUi.deactivate("vj1.control.scene-surface-inspector");
    const workspace = currentWorkspace(state);
    const scope = artifactInspectorScope(workspace);
    if (!scope) throw new Error(`ARTIFACT_INSPECTOR_WORKSPACE_REQUIRED:${workspace}`);
    deactivateArtifactInspectorScopes(scope);
    const contentId = String(model.contentId || "content");
    const secondaryId = String(model.secondaryId || "secondary-content");
    retainedUi.activate(compileUiModel(artifactInspectorUiModel({
      targetId: model.targetId || "",
      title: model.title || model.kind || "Inspector",
      titleAddress: model.titleAddress || "",
      kind: model.kind || "Inspector",
      icon: model.icon || "",
      media: model.media || null,
      emptyText: model.emptyText || "Nothing selected",
      headerAction: model.headerAction || null,
      contentId,
      secondaryId,
      primaryLayout: model.primaryLayout,
      secondaryLayout: model.secondaryLayout,
      secondaryPresentation: model.secondaryPresentation,
      contentChildren: model.contentChildren,
      secondaryChildren: model.secondaryChildren,
    }), {
      id: scope,
      stateAddress: `workspaces/${workspace}/inspector`,
    }), {
      host: refs.inspector,
      scope,
    });
    reconcileInspectorEmbeddedUi(state);
  }

  function deactivateArtifactInspectorScopes(activeScope = "") {
    for (const workspace of ARTIFACT_INSPECTOR_WORKSPACES) {
      const scope = artifactInspectorScope(workspace);
      if (scope !== activeScope) retainedUi.deactivate(scope);
    }
  }

  function reconcileInspectorEmbeddedUi(state) {
    reconcileChainParameterTabsUi(state);
    reconcileLiveComponentViewUi(state);
    reconcileLiveChainParameterTabsUi(state);
  }

  function inspectorParameterComponent(state) {
    const workspace = currentWorkspace(state);
    if (workspace === "scene") return selectedSceneComponent(state);
    if (workspace === "component") {
      return state.components.find((item) => item.id === state.ui.selectedComponentId) || state.components[0];
    }
    return null;
  }

  function reconcileChainParameterTabsUi(state) {
    const scope = "vj1.control.chain-parameter-tabs";
    const workspace = currentWorkspace(state);
    const inspectorScope = artifactInspectorScope(workspace);
    const secondaryId = workspace === "scene" ? "scene-surface-or-parameters" : "component-parameters";
    const host = retainedUi.getNode(uiModelNodeId([
      "artifact-inspector",
      secondaryId,
      "selected-element-panel",
      "chain-parameter-tabs",
    ]), { scope: inspectorScope })?.element?.();
    const component = inspectorParameterComponent(state);
    const model = host && component ? selectedChainParameterTabsModel(component, state, {
      nodeEditorModel: selectedNodeEditorModel(component, state, editorNodePackage),
    }) : null;
    reconcileParameterTabs(scope, host, model, state, false);
  }

  function deactivateChainParameterUi() {
    retainedUi.deactivate("vj1.control.chain-parameter-tabs");
  }

  function reconcileLiveComponentViewUi(state) {
    const scope = "vj1.control.live-component-view";
    const inspectorScope = artifactInspectorScope("live");
    const host = retainedUi.getNode(uiModelNodeId([
      "artifact-inspector", "primary", "live-component-views",
    ]), { scope: inspectorScope })?.element?.();
    const model = host && currentWorkspace(state) === "live"
      ? selectedLiveComponentViewModel(state)
      : null;
    if (!host || !model) {
      retainedUi.deactivate(scope);
      return;
    }
    retainedUi.activate(liveComponentViewUiGraph(model), { host, scope });
  }

  function reconcileLiveChainParameterTabsUi(state) {
    const scope = "vj1.control.live-chain-parameter-tabs";
    const inspectorScope = artifactInspectorScope("live");
    const host = retainedUi.getNode(uiModelNodeId([
      "artifact-inspector",
      "live-element-parameters",
      "live-element-panel",
      "live-chain-parameter-tabs",
    ]), { scope: inspectorScope })?.element?.();
    const model = host ? selectedLiveParameterTabsModel(state) : null;
    reconcileParameterTabs(scope, host, model, state, true);
  }

  function reconcileParameterTabs(scope, host, model, state, live) {
    if (!host || !model?.views?.length) {
      retainedUi.deactivate(scope);
      return;
    }
    retainedUi.activate(parameterTabsUiGraph(model, { id: scope, live }), { host, scope });
  }

  function deactivateLiveParameterUi() {
    retainedUi.deactivate("vj1.control.live-component-view");
    retainedUi.deactivate("vj1.control.live-chain-parameter-tabs");
  }

  async function handleNodesLibraryAction(payload = {}) {
    const action = String(payload.id || "");
    const packageId = String(payload.itemId || "");
    if (action === "create-visual-group" || action === "create-scene3d-group") {
      const scene3d = action === "create-scene3d-group";
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
        setStatus(`${name} created`);
      } catch (error) {
        setStatus(`${kindName} was not created: ${error?.message || error}`);
      }
      return;
    }
    if (action === "import-package") {
      const confirmed = typeof globalThis.confirm !== "function"
        || globalThis.confirm("Import this node package? Node packages may contain executable JavaScript. Only import packages you trust.");
      if (!confirmed) return;
      try {
        const imported = await projectService.importNodePackageFolder();
        setStatus(`${imported.id}@${imported.version} imported; choose Install to activate it`);
      } catch (error) {
        if (error?.name !== "AbortError") setStatus(`Package was not imported: ${error?.message || error}`);
      }
      return;
    }
    if (action === "export-selected-package") {
      try {
        const selection = selectedProjectPackageExport(latestState, editorNodePackage);
        const suggestedId = `org.vj1.project.${packageIdentifier(latestState.project?.name || "visual")}`;
        const id = globalThis.prompt?.("Stable package ID", suggestedId)?.trim();
        if (!id) return;
        const version = globalThis.prompt?.("Exact package version", "0.1.0")?.trim();
        if (!version) return;
        const name = globalThis.prompt?.("Package name", selection.name)?.trim() || selection.name;
        const encoded = nodePackage.exportProjectPackage(latestState, {
          id, version, name,
          description: `Reusable VJ1 package exported from ${selection.name}.`,
          ...selection.manifest,
        });
        const path = await projectService.writeNodePackageManifest(encoded);
        setStatus(`Package written to ${path}`);
      } catch (error) {
        setStatus(`Package was not exported: ${error?.message || error}`);
      }
      return;
    }
    if (!packageId) return;
    try {
      if (action === "toggle-package") {
        const enable = String(payload.value) === "true";
        await projectService.setNodePackageEnabled(packageId, enable);
        setStatus(`${packageId} ${enable ? "enabled" : "disabled"}`);
      } else if (action === "install-package") {
        const version = String(payload.fields?.version || payload.value || "");
        await projectService.installNodePackage(packageId, version);
        setStatus(`${packageId}@${version} is active for this project`);
      } else if (action === "export-package-folder") {
        const version = String(payload.value || "");
        const exported = await projectService.exportNodePackageFolder(packageId, version);
        setStatus(`${exported.id}@${exported.version} exported to ${exported.path}`);
      } else if (action === "remove-package") {
        const confirmed = typeof globalThis.confirm !== "function"
          || globalThis.confirm(`Remove ${packageId} from this project? Package files will remain in the folder.`);
        if (!confirmed) return;
        await projectService.removeNodePackage(packageId);
        setStatus(`${packageId} project reference removed`);
      }
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(`${packageId}: ${error?.message || error}`);
    }
  }

  function nodeGraphCommandHandlers() {
    return {
      onStatus: setStatus,
      onMediaParameterRequest: ({ nodeId, parameterId, accept }) => {
        modals.openMediaPicker("", accept, (value) => {
          const target = selectedNodeWorkspaceTarget(latestState, editorNodePackage);
          const graph = target?.definition?.parts?.find((part) => part.kind === "graph");
          if (!graph) return;
          nodeGraphCommandHandlers().onGraphChange(
            graphWithNodeParameter(graph, nodeId, parameterId, String(value || "")),
            "change-parameter",
          );
        });
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
    };
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

  function dispose() {
    retainedUi.dispose();
    liveTransitionExpiryScheduler.cancel();
    performanceSession.dispose();
    if (signalRefreshTimer) globalThis.clearInterval(signalRefreshTimer);
    signalRefreshTimer = 0;
    if (renderFrame) globalThis.cancelAnimationFrame?.(renderFrame);
    renderFrame = 0;
    if (deferredRenderTimer) globalThis.clearTimeout(deferredRenderTimer);
    deferredRenderTimer = 0;
  }

  return {
    mount,
    dispose,
    deliverControlSignal(payload) {
      embeddedPreview?.command(CONTROL_SIGNAL_COMMAND, payload);
    },
    refreshDeviceStatus() {
      modals?.render(latestState);
    },
  };
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

function diagnosticIcon(level) {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  if (level === "info") return "info";
  return "check_circle";
}

function emptyDiagnosticsSummary() {
  return Object.freeze({
    level: "ok",
    counts: Object.freeze({ info: 0, warning: 0, error: 0 }),
    entries: Object.freeze([]),
  });
}

function formatPercent(value) {
  const number = Math.max(0, Number(value) || 0);
  return `${number > 0 && number < 10 ? number.toFixed(1) : Math.round(number)}%`;
}

export function performanceHealthStep(load) {
  const value = Math.max(0, Number(load) || 0);
  for (let index = 0; index < performanceHealthThresholds.length; index++) {
    if (value < performanceHealthThresholds[index]) return index;
  }
  return performanceHealthClasses.length - 1;
}

export function activeRenderCost(state) {
  let total = 0;
  const outputCost = Number(state.metrics.renderCost);
  if (Number(state.metrics.clients) > 0 && Number.isFinite(outputCost)) total += Math.max(0, outputCost);
  const previewCost = Number(state.metrics.previewRenderCost);
  if (state.ui?.debugPreview && Number(state.metrics.previewFps) > 0 && Number.isFinite(previewCost)) total += Math.max(0, previewCost);
  return total;
}

export function activeSignalLoad(state, controlSnapshot = null) {
  return mergeSignalLoadSnapshots(
    controlSnapshot,
    state?.ui?.debugPreview ? state?.metrics?.previewSignalLoad : null,
    Number(state?.metrics?.clients) > 0 ? state?.metrics?.signalLoad : null,
  );
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
      diagnostic: state.metrics.profileDiagnostic || null,
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
      diagnostic: state.metrics.previewProfileDiagnostic || null,
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
    diagnostic: renderers.length === 1 ? renderers[0].diagnostic : {
      renderers: renderers.map((renderer) => ({
        source: renderer.source,
        diagnostic: renderer.diagnostic || null,
      })),
    },
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
      diagnostic: state.metrics.previewProfileDiagnostic || null,
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
      diagnostic: state.metrics.profileDiagnostic || null,
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


function pathForMapping(state, mapping) {
  return `mappings.${state.mappings.findIndex((item) => item.id === mapping.id)}`;
}

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
