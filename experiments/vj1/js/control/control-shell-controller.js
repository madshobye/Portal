import { BLEND_MODES, VJ1, WORKSPACES } from "../constants.js";
import { componentFrameMetrics } from "../domain/component-frame.js";
import { applySceneSourceNode, applySceneSnapshotToState, createLiveComponentView, createLiveRenderState, createOutputDefinition, createSceneSnapshot, normalizeRenderSettings, resolveSceneSourceNode, sceneSourceNodes, syncLiveSnapshotFromScene } from "../domain/models.js?v=centered-freeze-68";
import { latestProjectActivity, touchComponentUsed, touchRecordingFrameUsed } from "../domain/component-activity.js?v=adaptive-component-demand-29";
import { normalizeParamValue, RENDER_QUALITY_PARAM } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { getGeneratorComponent, listGeneratorComponents } from "../graph/generator-registry.js?v=group-composite-59";
import { patchNodeDegree, planCompositorInputs, planPatchExecution, summarizeTextureBranches } from "../graph/patch-planner.js";
import { compileComponentPatch } from "../graph/render-scheduler.js?v=adaptive-component-demand-29";
import { buildOutputUrl } from "../view-routing.js?v=adaptive-component-demand-29";
import { getShaderComponent, listShaderComponents } from "../shaders/shader-registry.js?v=adaptive-component-demand-29";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=centered-freeze-68";
import { frameFitViewport, resetViewport, zoomViewport } from "../output/preview-viewport.js?v=adaptive-component-demand-29";
import { defaultProjectSurfaceMapping } from "../output/render-geometry.js?v=adaptive-component-demand-29";
import { analyzeVj1Project } from "../metrics/component-metrics.js?v=adaptive-component-demand-29";
import { createHtmlCache, isInteractiveNode, isTextEditingNode, setClass, setText } from "./dom-utils.js";
import { bindReorderList } from "./reorder-list.js";
import { collectRefs, shellTemplate } from "./shell-view.js?v=adaptive-component-demand-29";
import { configuredOutputsTemplate, settingsModalTemplate } from "./settings-view.js?v=editable-titles-71";
import { elementPickerTemplate, generatorIcon, mediaPickerTemplate, sourceChoicePickerTemplate } from "./picker-view.js?v=flat-orange-ui-69";
import { featureMorphMediaControlsTemplate } from "./feature-morph-view.js?v=mobilenet-morph-v2-47";
import { generatorImageMediaControlTemplate } from "./generator-media-view.js?v=tile-texture-40";
import { effectIcon, emptyNote, esc, formatRangeValue, icon, paramRangePairTemplate, rangeTemplate, selectValuesTemplate, sourceTypeIcon, thumbnailTemplate } from "./template-utils.js?v=slider-values-70";
import { chainPasteTarget, clipboardPayloadForTarget, VJ1_CLIPBOARD_TYPE } from "../domain/clipboard.js?v=clipboard-routing-62";

const MODEL_RENDER_MODES = ["surface", "wireframe", "surfaceWire", "points"];
const MEDIA_FIT_MODES = ["contain", "cover"];
const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"];
const MODEL_SURFACE_COLOR_PARAM = { id: "surfaceColor", label: "Surface color", type: "color", defaultValue: "#dce1dcff" };
const MODEL_WIRE_COLOR_PARAM = { id: "wireColor", label: "Wire color", type: "color", defaultValue: "#141414dd" };
const VJ1_CLIPBOARD_TEXT_PREFIX = "VJ1_CLIPBOARD:";
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
  let settingsTab = "outputs";
  let activeCatalogViewKey = "";
  let performanceProfile = null;
  let performanceProfileTimer = 0;
  let pasteTarget = { kind: "media-library" };
  let internalClipboard = null;
  const catalogOrderSnapshots = { component: [], scene: [] };
  const replaceHtmlIfChanged = createHtmlCache();
  const mediaPreviewUrls = new Map();
  const embeddedPreview = createEmbeddedPreviewApp({
    store,
    mediaLibrary,
    projectService,
    onChainItemTarget: (componentId, itemId) => {
      pasteTarget = { kind: "chain-item", componentId, itemId };
      root.dataset.pasteTarget = "chain-item";
    },
  });
  const interactionQuietMs = 160;
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
    prepareCatalogOrder(state);
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
      store.update((draft) => {
        draft.ui.debugPreview = !draft.ui.debugPreview;
        rememberPreviewPreference(draft.ui.debugPreview);
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

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      const target = resolvePasteTarget(event.target) || pasteTarget;
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      const files = droppedFiles.length ? droppedFiles : await imageFilesFromTransfer(event.dataTransfer, "drop");
      if (files.length) await importExternalMedia(files, pasteDestination(target));
    });
    window.addEventListener("click", rememberPasteTarget);
    window.addEventListener("copy", copyFromCurrentTarget);
    window.addEventListener("cut", cutFromCurrentTarget);
    window.addEventListener("paste", pasteIntoCurrentTarget);
    window.addEventListener("keydown", handleHistoryKeydown);
    window.addEventListener("keydown", handleDeleteKeydown);
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

  function rememberPasteTarget(event) {
    const next = resolvePasteTarget(event.target);
    if (next) {
      pasteTarget = next;
      root.dataset.pasteTarget = next.kind;
    }
  }

  function resolvePasteTarget(node) {
    const element = node?.closest ? node : node?.parentElement;
    if (!element?.closest) return null;
    const chainItem = element.closest("[data-select-chain-item]");
    if (chainItem) return {
      kind: "chain-item",
      componentId: latestState.ui.selectedComponentId,
      itemId: chainItem.dataset.selectChainItem,
    };
    const componentButton = element.closest("[data-select-component]");
    if (componentButton) {
      const component = latestState.components.find((item) => item.id === componentButton.dataset.selectComponent);
      return { kind: component?.type === "canvas" ? "canvas-list" : "component-list", itemId: component?.id || "" };
    }
    const sceneButton = element.closest("[data-select-scene]");
    if (sceneButton) return { kind: "scene-list", itemId: sceneButton.dataset.selectScene };
    const surfaceButton = element.closest("[data-select-surface]");
    if (surfaceButton) return { kind: "surface-list", itemId: surfaceButton.dataset.selectSurface };
    const mediaButton = element.closest("[data-pick-media], [data-pick-source-media], [data-add-element-media]");
    if (mediaButton) return {
      kind: "media-item",
      itemId: mediaButton.dataset.pickMedia || mediaButton.dataset.pickSourceMedia || mediaButton.dataset.addElementMedia || "",
    };
    const scope = element.closest("[data-paste-scope]");
    if (scope) return { kind: scope.dataset.pasteScope };
    const chainList = element.closest("[data-chain-reorder-list]");
    if (chainList) return chainPasteTarget(latestState, chainList.dataset.componentId, latestState.ui.selectedChainItemId);
    if (element.closest(".studio-stage") || refs.inspector?.contains?.(element)) {
      if (latestState.ui.workspace === "component" || latestState.ui.workspace === "canvas") {
        return latestState.ui.selectedChainItemId
          ? { kind: "chain-item", componentId: latestState.ui.selectedComponentId, itemId: latestState.ui.selectedChainItemId }
          : chainPasteTarget(latestState, latestState.ui.selectedComponentId, "");
      }
    }
    return null;
  }

  function pasteDestination(target = pasteTarget) {
    if (target.kind !== "chain-item") return target;
    return chainPasteTarget(latestState, target.componentId, target.itemId);
  }

  function copyFromCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const payload = clipboardPayloadForTarget(latestState, pasteTarget);
    if (!payload) return;
    writeClipboardPayload(event, payload);
    setStatus(`Copied ${payload.value.name || payload.kind}`);
  }

  function writeClipboardPayload(event, payload) {
    internalClipboard = payload;
    const serialized = JSON.stringify(payload);
    try {
      event.clipboardData?.setData(VJ1_CLIPBOARD_TYPE, serialized);
    } catch {}
    event.clipboardData?.setData("text/plain", `${VJ1_CLIPBOARD_TEXT_PREFIX}${serialized}`);
    event.preventDefault();
  }

  function cutFromCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const target = { ...pasteTarget };
    const payload = clipboardPayloadForTarget(latestState, target);
    if (!payload) return;
    writeClipboardPayload(event, payload);
    const removed = deleteTarget(target);
    setStatus(removed ? `Cut ${payload.value.name || payload.kind}` : `Copied ${payload.value.name || payload.kind}`);
  }

  function handleDeleteKeydown(event) {
    if (isTextEditingNode(event.target) || isTextEditingNode(document.activeElement)) return;
    if (event.metaKey || event.ctrlKey || event.altKey || (event.key !== "Delete" && event.key !== "Backspace")) return;
    const payload = clipboardPayloadForTarget(latestState, pasteTarget);
    if (!payload || !deleteTarget({ ...pasteTarget })) return;
    event.preventDefault();
    setStatus(`Deleted ${payload.value.name || payload.kind}`);
  }

  function deleteTarget(target) {
    const before = clipboardPayloadForTarget(store.getState(), target);
    if (!before) return false;
    if (target.kind === "chain-item") store.removeChainItem?.(target.componentId, target.itemId);
    else if (target.kind === "component-list" || target.kind === "canvas-list") store.removeComponent?.(target.itemId);
    else if (target.kind === "scene-list") store.deleteScene?.(target.itemId);
    else if (target.kind === "surface-list") store.removeSurface?.(target.itemId);
    else return false;
    const state = store.getState();
    const removed = !clipboardPayloadForTarget(state, target);
    if (removed) pasteTarget = targetAfterDelete(state, target);
    return removed;
  }

  function targetAfterDelete(state, target) {
    if (target.kind === "chain-item") {
      return state.ui.selectedChainItemId
        ? { kind: "chain-item", componentId: target.componentId, itemId: state.ui.selectedChainItemId }
        : { kind: "chain", componentId: target.componentId, itemId: "" };
    }
    if (target.kind === "component-list" || target.kind === "canvas-list") {
      const component = state.components.find((item) => item.id === state.ui.selectedComponentId);
      return component ? { kind: component.type === "canvas" ? "canvas-list" : "component-list", itemId: component.id } : target;
    }
    if (target.kind === "scene-list") return { kind: "scene-list", itemId: state.ui.selectedSceneId || "" };
    if (target.kind === "surface-list") return { kind: "surface-list", itemId: state.ui.selectedSurfaceId || "" };
    return target;
  }

  async function pasteIntoCurrentTarget(event) {
    if (isTextEditingNode(document.activeElement)) return;
    const target = pasteDestination(pasteTarget);
    const plainText = event.clipboardData?.getData("text/plain") || "";
    const serialized = event.clipboardData?.getData(VJ1_CLIPBOARD_TYPE) ||
      (plainText.startsWith(VJ1_CLIPBOARD_TEXT_PREFIX) ? plainText.slice(VJ1_CLIPBOARD_TEXT_PREFIX.length) : "");
    const hasExternalImage = Array.from(event.clipboardData?.files || []).some((file) => file?.type?.startsWith("image/")) ||
      !!imageUrlFromTransfer(event.clipboardData);
    if (hasExternalImage || serialized || internalClipboard) event.preventDefault();
    const files = await imageFilesFromTransfer(event.clipboardData, "paste");
    if (files.length) {
      await importExternalMedia(files, target);
      return;
    }
    let payload = null;
    try {
      const externalText = (plainText && !plainText.startsWith(VJ1_CLIPBOARD_TEXT_PREFIX) ? plainText : "") || event.clipboardData?.getData("text/html") || "";
      payload = serialized ? JSON.parse(serialized) : externalText ? null : internalClipboard;
    } catch {
      payload = internalClipboard;
    }
    if (!payload) return;
    const result = store.pasteClipboard?.(payload, target);
    if (result?.pasted) {
      pasteTarget = targetAfterPaste(result, target);
      setStatus(`Pasted ${payload.kind}`);
    }
    else setStatus(pasteFailureMessage(result?.reason));
  }

  async function importExternalMedia(files, target) {
    const result = await importFiles(files);
    if (!result?.imported) return;
    for (const mediaId of result.mediaIds || []) {
      const media = latestState.media?.find((item) => item.id === mediaId);
      if (media?.type !== "image") continue;
      const pasted = store.pasteClipboard?.({ kind: "media", value: media }, target);
      if (pasted?.pasted && target.kind === "chain") target = targetAfterPaste(pasted, target);
    }
  }

  async function imageFilesFromTransfer(transfer, source = "paste") {
    const seenFiles = new Set();
    const direct = [
      ...Array.from(transfer?.files || []),
      ...Array.from(transfer?.items || []).map((item) => item.kind === "file" ? item.getAsFile?.() : null),
    ].filter((file) => {
      if (!file?.type?.startsWith("image/")) return false;
      const signature = `${file.name}:${file.size}:${file.lastModified}`;
      if (seenFiles.has(signature)) return false;
      seenFiles.add(signature);
      return true;
    });
    if (direct.length) return source === "paste" ? direct.map(uniqueClipboardImageFile) : direct;
    const url = imageUrlFromTransfer(transfer);
    if (!url) return [];
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return [];
      return [new File([blob], clipboardImageName(blob.type), { type: blob.type })];
    } catch (error) {
      setStatus(`Could not import pasted image: ${error.message || error}`);
      return [];
    }
  }

  function imageUrlFromTransfer(transfer) {
    const html = transfer?.getData?.("text/html") || "";
    if (html && typeof DOMParser !== "undefined") {
      const src = new DOMParser().parseFromString(html, "text/html").querySelector("img")?.src;
      if (src) return src;
    }
    const text = (transfer?.getData?.("text/uri-list") || transfer?.getData?.("text/plain") || "").trim().split(/\r?\n/)[0];
    return /^(https?:|data:image\/)/i.test(text) ? text : "";
  }

  function uniqueClipboardImageFile(file) {
    const extension = String(file.name || "").match(/\.[a-z0-9]+$/i)?.[0] || imageExtension(file.type);
    return new File([file], `clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${extension}`, { type: file.type });
  }

  function clipboardImageName(type) {
    return `web-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${imageExtension(type)}`;
  }

  function imageExtension(type = "") {
    if (type.includes("jpeg")) return ".jpg";
    if (type.includes("webp")) return ".webp";
    if (type.includes("gif")) return ".gif";
    if (type.includes("svg")) return ".svg";
    return ".png";
  }

  function pasteFailureMessage(reason = "") {
    if (reason === "components-only-in-canvas") return "Component references can only be pasted into a Canvas";
    if (reason === "wrong-list") return "Paste into the matching Component or Canvas list";
    if (reason === "library-only") return "Media kept in the library; click a Component or Canvas preview to add it";
    return "This item cannot be pasted at the current target";
  }

  function targetAfterPaste(result, previous) {
    if (result.kind === "chain-item") return previous.kind === "group"
      ? previous
      : { kind: "chain-item", componentId: previous.componentId || previous.itemId || "", itemId: result.id };
    if (result.kind === "component") {
      const component = latestState.components.find((item) => item.id === result.id);
      return { kind: component?.type === "canvas" ? "canvas-list" : "component-list", itemId: result.id };
    }
    if (result.kind === "scene") return { kind: "scene-list", itemId: result.id };
    if (result.kind === "surface") return { kind: "surface-list", itemId: result.id };
    return previous;
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
    store.update((draft) => {
      draft.ui.outputWindowOpen = true;
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
        store.update((draft) => {
          draft.ui.catalogSortModes ||= { component: "recent", scene: "recent" };
          draft.ui.catalogSortModes[catalog] = mode;
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
    bindCatalogSortControls(refs.projectRail);
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    refs.projectRail.querySelectorAll("[data-select-component]").forEach((button) => {
      button.addEventListener("click", () => store.selectComponent(button.dataset.selectComponent));
    });
    refs.projectRail.querySelectorAll("[data-add-component]").forEach((button) => {
      button.addEventListener("click", () => store.addComponent());
    });
    refs.projectRail.querySelectorAll("[data-add-canvas-component]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasComponent?.());
    });
    refs.projectRail.querySelectorAll("[data-add-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasFrame?.(button.dataset.canvasComponentId || latestState.ui.selectedComponentId));
    });
    refs.projectRail.querySelectorAll("[data-remove-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.removeCanvasFrame?.(button.dataset.canvasComponentId, button.dataset.removeCanvasFrame));
    });
    refs.projectRail.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
    refs.projectRail.querySelector("[data-save-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scn ${latestState.scenes.length + 1}`;
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
    refs.projectRail.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    refs.projectRail.querySelectorAll("[data-surface-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        onReorder: (fromId, toId) => store.reorderSurfaces?.(fromId, toId),
      });
    });
    refs.projectRail.querySelectorAll("[data-remove-component]").forEach((button) => {
      button.addEventListener("click", () => store.removeComponent(button.dataset.removeComponent));
    });
    bindComponentFilters(refs.projectRail);
  }

  function renderModal(state) {
    const host = refs.modalHost;
    if (!host) return;
    if (!mediaPicker && !elementPicker && !sourceChoicePicker && !settingsOpen) {
      replaceHtmlIfChanged(host, "");
      return;
    }
    if (settingsOpen) {
      if (!host.querySelector("[data-settings-modal]")) {
        replaceHtmlIfChanged(host, settingsModalTemplate(state, settingsTab));
        host.querySelector("[data-close-modal]")?.addEventListener("click", closeSettings);
        host.querySelector(".modal-backdrop")?.addEventListener("click", closeSettings);
        host.querySelectorAll("[data-settings-tab]").forEach((button) => {
          button.addEventListener("click", () => {
            settingsTab = button.dataset.settingsTab || "outputs";
            applySettingsTab(host);
          });
        });
      }
      syncSettingsModal(host, state);
      bindSettingsModalControls(host);
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
      const modalSortMode = catalogSortMode(state, "component");
      const modalComponents = sortComponentCatalog(state.components || [], modalSortMode);
      if (!replaceHtmlIfChanged(host, elementPickerTemplate(state, elementPicker, mediaLibrary, mediaPreviewUrls, {
        components: modalComponents,
        sortMode: modalSortMode,
      }))) return;
      host.querySelector("[data-close-modal]")?.addEventListener("click", closeElementPicker);
      host.querySelector(".modal-backdrop")?.addEventListener("click", closeElementPicker);
      bindElementPickerSearch(host);
      bindCatalogSortControls(host);
      focusPendingElementPickerSearch(host);
      host.querySelectorAll("[data-add-element-media]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainSource(elementPicker.componentId, {
            type: "media",
            mediaId: button.dataset.addElementMedia || "",
          });
          closeElementPicker();
        });
      });
      host.querySelectorAll("[data-add-element-component]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainSource(elementPicker.componentId, {
            type: "component",
            componentId: button.dataset.addElementComponent || "",
          });
          closeElementPicker();
        });
      });
      host.querySelector("[data-add-element-camera]")?.addEventListener("click", () => {
        activateElementPickerTarget();
        store.addChainSource(elementPicker.componentId, { type: "camera" });
        closeElementPicker();
      });
      host.querySelector("[data-add-element-group]")?.addEventListener("click", () => {
        activateElementPickerTarget();
        store.addChainGroup(elementPicker.componentId);
        closeElementPicker();
      });
      host.querySelectorAll("[data-add-element-generator]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainSource(elementPicker.componentId, {
            type: "generator",
            generatorId: button.dataset.addElementGenerator || "testPattern",
          });
          closeElementPicker();
        });
      });
      host.querySelectorAll("[data-add-element-effect]").forEach((button) => {
        button.addEventListener("click", () => {
          activateElementPickerTarget();
          store.addChainEffect(elementPicker.componentId, button.dataset.addElementEffect);
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
          if (/\.mediaId$/.test(mediaPicker.path)) {
            const sourcePath = mediaPicker.path.replace(/\.mediaId$/, "");
            setByPath(draft, `${sourcePath}.type`, "media");
          }
        }, `update:${mediaPicker.path}`);
        closeMediaPicker();
      });
    });
  }

  function bindSettingsModalControls(host) {
    host.querySelectorAll("[data-settings-update]").forEach((input) => {
      if (input.dataset.settingsBound) return;
      input.dataset.settingsBound = "true";
      input.addEventListener("input", () => {
        syncRangeValue(input);
        updateRenderSetting(input, `scrub:${input.dataset.settingsUpdate}`);
      });
      input.addEventListener("change", () => {
        syncRangeValue(input);
        updateRenderSetting(input, `update:${input.dataset.settingsUpdate}`);
      });
    });
    host.querySelectorAll("[data-render-preset]").forEach((button) => {
      if (button.dataset.settingsBound) return;
      button.dataset.settingsBound = "true";
      button.addEventListener("click", () => applyRenderPreset(button.dataset.renderPreset));
    });
    host.querySelectorAll("[data-camera-preset]").forEach((button) => {
      if (button.dataset.settingsBound) return;
      button.dataset.settingsBound = "true";
      button.addEventListener("click", () => applyCameraPreset(button.dataset.cameraPreset));
    });
    const addOutput = host.querySelector("[data-add-output]");
    if (addOutput && !addOutput.dataset.settingsBound) {
      addOutput.dataset.settingsBound = "true";
      addOutput.addEventListener("click", addConfiguredOutput);
    }
    host.querySelectorAll("[data-remove-output]").forEach((button) => {
      if (button.dataset.settingsBound) return;
      button.dataset.settingsBound = "true";
      button.addEventListener("click", () => removeConfiguredOutput(button.dataset.removeOutput));
    });
  }

  function syncSettingsModal(host, state) {
    const modal = host.querySelector("[data-settings-modal]");
    if (!modal) return;
    const render = normalizeRenderSettings(state.render || {});
    const outputList = modal.querySelector("[data-configured-output-list]");
    const outputSignature = render.outputs.map((output) => output.id).join("|");
    if (outputList && outputList.dataset.outputSignature !== outputSignature) {
      outputList.innerHTML = configuredOutputsTemplate(render);
      outputList.dataset.outputSignature = outputSignature;
    }
    const normalizedState = { ...state, render };
    modal.querySelectorAll("[data-settings-update]").forEach((input) => {
      if (input === document.activeElement) return;
      const value = getByPath(normalizedState, input.dataset.settingsUpdate);
      if (input.type === "checkbox") input.checked = value === true;
      else if (value !== undefined && input.value !== String(value)) input.value = String(value);
    });
    setText(modal.querySelector("[data-upscaling-amount-label]"), `${Math.round(render.upscaling.amount * 100)}%`);
    setText(modal.querySelector("[data-grayscale-amount-label]"), `${Math.round(render.postProcessing.grayscaleAmount * 100)}%`);
    setText(modal.querySelector("[data-noise-amount-label]"), `${Math.round(render.postProcessing.noiseAmount * 1000) / 10}%`);
    const manualSurfaceTexture = render.surfaceTexture.mode === "manual";
    modal.querySelectorAll("[data-manual-surface-texture]").forEach((element) => {
      element.hidden = !manualSurfaceTexture;
      element.querySelectorAll("input").forEach((input) => { input.disabled = !manualSurfaceTexture; });
    });
    applySettingsTab(host);
  }

  function applySettingsTab(host) {
    host.querySelectorAll("[data-settings-tab]").forEach((button) => {
      const active = button.dataset.settingsTab === settingsTab;
      setClass(button, "is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    host.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== settingsTab;
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

  function openMediaPicker(path, accept = "") {
    mediaPicker = { path, accept };
    elementPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    renderModal(latestState);
  }

  function closeMediaPicker() {
    mediaPicker = null;
    renderModal(latestState);
  }

  function openElementPicker(componentId, selectedChainItemId = "") {
    elementPicker = { componentId, selectedChainItemId };
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
    syncSettingsModal(refs.modalHost, store.getState());
  }

  function applyRenderPreset(preset) {
    const presets = {
      wide: [960, 540],
      xga: [1024, 768],
      wxga: [1280, 800],
      hd: [1280, 720],
      fhd: [1920, 1080],
      wuxga: [1920, 1200],
      "2k": [2048, 1080],
      "4k": [3840, 2160],
    };
    const [frameWidth, frameHeight] = presets[preset] || presets.wide;
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      draft.render = normalizeRenderSettings({
        ...draft.render,
        outputs: (draft.render.outputs || []).map((output, index) => index === 0
          ? { ...output, width: frameWidth, height: frameHeight }
          : output),
      });
      scaleMappingForRenderChange(draft, previousRender, draft.render);
    }, "render-preset");
  }

  function addConfiguredOutput() {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      const output = createOutputDefinition(previousRender.outputs.length, previousRender.frameWidth, previousRender.frameHeight);
      if (previousRender.outputs.some((item) => item.id === output.id)) output.id = `output-${Date.now().toString(36)}`;
      const outputs = [...previousRender.outputs, output];
      draft.render = normalizeRenderSettings({ ...previousRender, outputs });
    }, "add-output");
  }

  function applyCameraPreset(preset) {
    const presets = {
      sd: [640, 480],
      hd: [1280, 720],
      fhd: [1920, 1080],
      "4k": [3840, 2160],
    };
    const size = presets[preset];
    if (!size) return;
    store.update((draft) => {
      draft.render = normalizeRenderSettings({
        ...draft.render,
        camera: {
          ...draft.render?.camera,
          width: size[0],
          height: size[1],
          maxResolution: false,
        },
      });
    }, "camera-preset");
  }

  function removeConfiguredOutput(outputId) {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      if (previousRender.outputs.length <= 1) return;
      const outputs = previousRender.outputs.filter((output) => output.id !== outputId);
      draft.render = normalizeRenderSettings({ ...previousRender, outputs });
    }, "remove-output");
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
  }

  function bindInputs(scope, state) {
    bindComponentFilters(scope);
    bindCatalogSortControls(scope);
    scope.querySelectorAll("[data-video-trim]").forEach(bindVideoTrimControl);
    scope.querySelectorAll("[data-param-range]").forEach(bindParamRangeControl);
    scope.querySelectorAll("[data-color-param]").forEach(bindColorParamControl);
    scope.querySelectorAll("[data-update]").forEach((input) => {
      if (input.dataset.videoTrimInput || input.dataset.paramRangeInput) return;
      if (input.type === "range") {
        input.addEventListener("input", () => {
          syncRangeValue(input);
          updatePathFromInput(input, `scrub:${input.dataset.update}`);
        });
        input.addEventListener("change", () => {
          syncRangeValue(input);
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
          syncRangeValue(input);
          updateLivePathFromInput(input, "scrub:live");
        });
        input.addEventListener("change", () => {
          syncRangeValue(input);
          updateLivePathFromInput(input, "live:update");
        });
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
    scope.querySelectorAll("[data-select-component]").forEach((button) => {
      button.addEventListener("click", () => store.selectComponent(button.dataset.selectComponent));
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
      button.addEventListener("click", () => openMediaPicker(button.dataset.mediaPath, button.dataset.mediaAccept || ""));
    });
    scope.querySelectorAll("[data-open-source-choice]").forEach((button) => {
      button.addEventListener("click", () => openSourceChoicePicker(button.dataset.openSourceChoice));
    });
    scope.querySelectorAll("[data-set-component]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.componentPath, button.dataset.setComponent);
          if (currentWorkspace(draft) === "scene" && button.dataset.componentPath?.startsWith("scenes.")) {
            applySelectedSceneSnapshot(draft);
          }
        }, `update:${button.dataset.componentPath}`);
      });
    });
    scope.querySelectorAll("[data-open-element-picker]").forEach((button) => {
      button.addEventListener("click", () => openElementPicker(
        button.dataset.componentId || latestState.ui.selectedComponentId,
        button.dataset.targetChainItem || ""
      ));
    });
    scope.querySelectorAll("[data-add-canvas-component]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasComponent?.());
    });
    scope.querySelectorAll("[data-add-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasFrame?.(button.dataset.canvasComponentId || latestState.ui.selectedComponentId));
    });
    scope.querySelectorAll("[data-remove-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.removeCanvasFrame?.(button.dataset.canvasComponentId, button.dataset.removeCanvasFrame));
    });
    scope.querySelectorAll("[data-set-route-source-node]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          const route = getByPath(draft, button.dataset.routeBase);
          const node = resolveSceneSourceNode(draft, button.dataset.setRouteSourceNode);
          if (route && node) {
            Object.assign(route, applySceneSourceNode(route, node));
            touchComponentUsed(draft, node.componentId);
            if (node.frameId) touchRecordingFrameUsed(draft, node.frameId);
          }
          if (currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
        }, "update:surface-source-node");
      });
    });
    scope.querySelectorAll("[data-select-chain-item]").forEach((button) => {
      button.addEventListener("click", () => store.selectChainItem(button.dataset.selectChainItem));
    });
    scope.querySelectorAll("[data-remove-chain-item]").forEach((button) => {
      button.addEventListener("click", () => store.removeChainItem?.(button.dataset.componentId, button.dataset.removeChainItem));
    });
    scope.querySelectorAll("[data-chain-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        itemSelector: ".chain-item-row[data-reorder-id]",
        dropSelector: "[data-reorder-id]",
        onReorder: (fromId, toId, position) => store.reorderChain(list.dataset.componentId, fromId, toId, position),
      });
    });
    scope.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    scope.querySelectorAll("[data-remove-component]").forEach((button) => {
      button.addEventListener("click", () => store.removeComponent(button.dataset.removeComponent));
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
        const componentId = control.dataset.liveComponentId;
        if (!componentId) return;
        const overrides = activeLiveOverrideBank(draft);
        const override = overrides[componentId] ||= {};
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
        const componentId = minInput.dataset.liveComponentId;
        if (!componentId) return;
        const overrides = activeLiveOverrideBank(draft);
        const override = overrides[componentId] ||= {};
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
      invalidateComponentPreviewAssets(draft, path);
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
      const componentId = input.dataset.liveComponentId;
      if (!componentId) return;
      const overrides = activeLiveOverrideBank(draft);
      const override = overrides[componentId] ||= {};
      setByPathCreate(override, input.dataset.liveUpdate, readInputValue(input));
    }, reason);
  }

  function toggleLivePathFromButton(button, reason) {
    const componentId = button.dataset.liveComponentId;
    const path = button.dataset.liveToggle;
    if (!componentId || !path) return;
    const nextValue = button.dataset.toggleValue !== "true";
    store.update((draft) => {
      const overrides = activeLiveOverrideBank(draft);
      const override = overrides[componentId] ||= {};
      setByPathCreate(override, path, nextValue);
    }, reason);
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

function componentCardBarTemplate(label) {
  return `<div class="component-card-bar"><span>${esc(label)}</span></div>`;
}

function canvasInspectorTemplate(component, state) {
  const base = pathForComponent(state, component);
  const canvas = component.canvas || { width: VJ1.canvasWidth, height: VJ1.canvasHeight };
  return `
    <article class="sculpt-card">
      <div class="field-pair">
        <label class="field">Width <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.width" value="${canvas.width}" /></label>
        <label class="field">Height <input type="number" min="128" max="8192" step="1" data-update="${base}.canvas.height" value="${canvas.height}" /></label>
      </div>
      ${componentUnifiedChainTemplate(component, state, base)}
    </article>
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

function componentSelectTemplate(path, state, value, excludeId = "") {
  const options = state.components.filter((component) => component.id !== excludeId && component.type !== "canvas");
  return `
    <select data-update="${esc(path)}">
      <option value="">None</option>
      ${options.map((component) => `<option value="${esc(component.id)}" ${component.id === value ? "selected" : ""}>${esc(component.name)}</option>`).join("")}
    </select>
  `;
}

function mappingStudioTemplate(state) {
  const component = state.components.find((item) => item.id === state.ui.selectedComponentId) || state.components[0];
  const patch = compileComponentPatch(component || {});
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
          ${mappingEventNodeTemplate(component)}
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

function mappingEventNodeTemplate(component) {
  return `
    <article class="mapping-node mapping-node-event">
      <header>${icon("bolt")}<strong>Param Event</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", [{ id: "event", label: "event", type: "event" }])}
        ${mappingPortsTemplate("out", [{ id: "params", label: component?.name || "component", type: "number" }])}
      </div>
      <div class="mapping-param-pills">
        <span>target <small>${esc(component?.name || "component")}</small></span>
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

function mappingInspectorTemplate(component, state) {
  const patch = compileComponentPatch(component || {});
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
      <label class="field">Component
        <select data-update="ui.selectedComponentId">
          ${state.components.map((item) => `<option value="${esc(item.id)}" ${item.id === component?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
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
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
      <div class="node-chip-list compact">
        ${generators.map((component) => componentChipTemplate(component)).join("")}
      </div>
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
      <div class="node-chip-list compact">
        ${effects.map((component) => componentChipTemplate(component)).join("")}
      </div>
    </article>
  `;
}

function mappingInletsTemplate(component) {
  const patch = compileComponentPatch(component || {});
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

function enableToggleButton({ path = "", livePath = "", componentId = "", value = true, iconName = "power_settings_new", label = "" }) {
  const enabled = value !== false;
  const toggleAttrs = livePath
    ? `data-live-component-id="${esc(componentId)}" data-live-toggle="${esc(livePath)}"`
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
  const component = state.components.find((item) => item.id === sceneSurface.componentId);
  const enabled = surface.enabled !== false;
  const direct = surface.destination?.type === "direct";
  return selectablePillTemplate({
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: enabled ? (direct ? "desktop_windows" : "crop_free") : "hide_source",
    label: surface.name,
    meta: component?.name || "None",
    togglePath: `${pathForSurface(state, surface)}.enabled`,
    toggleValue: enabled,
    removeAction: direct ? "" : "data-remove-surface",
    removeDisabled: false,
    reorderable: true,
  });
}

function selectablePillTemplate({ selected, action, id, iconName, label, meta, togglePath = "", toggleValue = true, removeAction = "", removeDisabled = false, reorderable = true }) {
  return textListItemTemplate({
    rowClass: "list-row",
    selected,
    reorderId: reorderable ? id : "",
    leadingHtml: togglePath ? enableToggleButton({
      path: togglePath,
      value: toggleValue,
      iconName,
      label,
    }) : "",
    label,
    meta,
    mainClass: "list-select",
    mainAction: action,
    mainActionId: id,
    removeClass: "list-remove",
    removeAction,
    removeActionId: id,
    removeDisabled,
  });
}

function textListItemTemplate({
  rowClass = "",
  selected = false,
  reorderId = "",
  leadingHtml = "",
  label = "",
  meta = "",
  mainClass = "",
  mainAction = "",
  mainActionId = "",
  removeClass = "",
  removeAction = "",
  removeActionId = "",
  removeAttributes = "",
  removeTitle = "Remove",
  removeDisabled = false,
} = {}) {
  const hasRemove = Boolean(removeAction || removeAttributes);
  const mainClasses = ["text-list-main", mainClass, selected ? "is-selected" : ""].filter(Boolean).join(" ");
  const rowClasses = [
    "text-list-item",
    rowClass,
    leadingHtml ? "has-leading" : "",
    hasRemove ? "has-remove" : "",
    selected ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  const mainContent = `<span>${esc(label)}</span>${meta ? `<small>${esc(meta)}</small>` : ""}`;
  const main = mainAction
    ? `<button type="button" class="${mainClasses}" ${mainAction}="${esc(mainActionId)}">${mainContent}</button>`
    : `<div class="${mainClasses}">${mainContent}</div>`;
  const remove = hasRemove
    ? `<button type="button" class="text-list-remove ${removeClass}" ${removeAction ? `${removeAction}="${esc(removeActionId)}"` : ""} ${removeAttributes} title="${esc(removeTitle)}" aria-label="${esc(removeTitle)} ${esc(label)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>`
    : "";
  return `
    <div class="${rowClasses}" ${reorderId ? `data-reorder-id="${esc(reorderId)}"` : ""}>
      ${leadingHtml}
      ${main}
      ${remove}
    </div>
  `;
}

function componentTemplate(component, state) {
  const base = pathForComponent(state, component);
  if (component.type === "canvas") {
    return `
      <article class="sculpt-card">
        ${componentInstanceSyncTemplate(component, base)}
        <div class="soft-note">This Canvas uses the shared component chain. Add components as sources with the plus button, organize them in Groups when needed, and define recording frames.</div>
      </article>
    `;
  }
  return `
    <article class="sculpt-card">
      ${componentFrameControlsTemplate(component, state, base)}
      ${componentUnifiedChainTemplate(component, state, base)}
    </article>
  `;
}

function componentInstanceSyncTemplate(component, base, compact = false) {
  const enabled = component.syncInstances !== false;
  const button = `
    <button type="button" class="${enabled ? "is-selected" : ""}" data-toggle-path="${base}.syncInstances" data-toggle-value="${enabled ? "true" : "false"}" aria-pressed="${enabled}" title="On keeps this Component synchronized everywhere; off gives each Canvas placement and surface its own phase">
      ${compact ? `${icon("sync")}<span class="visually-hidden">Sync instances</span>` : "Sync instances"}
    </button>
  `;
  if (compact) return button;
  return `
    <div class="segmented-pills component-option-grid" role="group" aria-label="Component instance timing">
      ${button}
    </div>
  `;
}

function componentFrameControlsTemplate(component, state, base) {
  const metrics = componentFrameMetrics(state.render || {}, component);
  const megapixels = (metrics.width * metrics.height / 1000000).toFixed(2);
  const shapeOptions = [
    ["landscape", "Landscape"],
    ["portrait", "Portrait"],
    ["square", "Square"],
  ];
  const shapeIcons = { landscape: "crop_landscape", portrait: "crop_portrait", square: "crop_square" };
  const scaleOptions = [0.5, 1, 2];
  return `
    <section class="component-frame-controls">
      <div class="section-toolbar component-quick-toolbar" aria-label="Component quick settings">
        <div class="section-toolbar-group component-quick-group" role="group" aria-label="Component instance timing">
          ${componentInstanceSyncTemplate(component, base, true)}
        </div>
        <div class="section-toolbar-group component-quick-group" role="group" aria-label="Component frame shape">
        ${shapeOptions.map(([value, label]) => `
          <button type="button" class="${metrics.frameShape === value ? "is-selected" : ""}" data-set-path="${base}.frameShape" data-set-value="${value}" aria-pressed="${metrics.frameShape === value}" title="${label}">${icon(shapeIcons[value])}<span class="visually-hidden">${label}</span></button>
        `).join("")}
        </div>
        <div class="section-toolbar-group component-quick-group component-resolution-buttons" role="group" aria-label="Component resolution scale">
        ${scaleOptions.map((value) => `
          <button type="button" class="${metrics.resolutionScale === value ? "is-selected" : ""}" data-set-path="${base}.resolutionScale" data-set-value="${value}" data-set-value-type="number" aria-pressed="${metrics.resolutionScale === value}" title="${value}× resolution">${value}×</button>
        `).join("")}
        </div>
      </div>
      <div class="component-frame-summary">
        <span>${metrics.baseWidth} × ${metrics.baseHeight} frame</span>
        <strong>${metrics.width} × ${metrics.height}</strong>
        <small>${metrics.effectiveScale}× effective · ${megapixels} MP</small>
      </div>
    </section>
  `;
}

function componentUnifiedChainTemplate(component, state, ownerPath) {
  return `
    <div class="chain-column">
      <section class="chain-list-section" aria-label="Elements">
        <div class="component-chain-list" data-chain-reorder-list data-component-id="${esc(component.id)}">
          ${chainItemsTemplate(component.chain || [], component, state, `${ownerPath}.chain`, 0, true)}
        </div>
        <button type="button" class="chain-add-button" data-open-element-picker data-component-id="${esc(component.id)}" title="Add element" aria-label="Add element">${icon("add")}</button>
      </section>
    </div>
  `;
}

function componentSelectedChainSettingsTemplate(component, state) {
  const selected = selectedChainItemSelection(component, state);
  if (!selected) return "";
  return `
    <section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">
      ${selectedChainItemTemplate(selected.item, component, state, selected.path)}
    </section>
  `;
}

function chainItemsTemplate(chain, component, state, base, depth = 0, topLevel = false) {
  if (!chain?.length) return depth ? `<div class="soft-note chain-group-empty">Group is empty</div>` : "";
  return chain.map((item, index) => chainItemRowTemplate(item, component, state, index, `${base}.${index}`, depth, topLevel ? chain.length : null)).join("");
}

function chainItemRowTemplate(item, component, state, index, base, depth = 0, topLevelLength = null) {
  const selected = state.ui.selectedChainItemId === item.id;
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const label = chainItemLabel(item, media, referencedComponent);
  const iconName = chainItemIcon(item);
  const kindLabel = item.kind === "source" ? item.source?.type || "source" : item.kind === "group" ? `${item.chain?.length || 0} item group` : "effect";
  const canRemove = item.kind === "group" || depth > 0 || topLevelLength === null || topLevelLength > 1;
  const row = textListItemTemplate({
    rowClass: "chain-item-row",
    selected,
    reorderId: item.id,
    leadingHtml: enableToggleButton({
      path: `${base}.enabled`,
      value: item.enabled !== false,
      iconName,
      label,
    }),
    label,
    meta: kindLabel,
    mainClass: "chain-item-select",
    mainAction: "data-select-chain-item",
    mainActionId: item.id,
    removeClass: "chain-item-remove",
    removeAttributes: `data-component-id="${esc(component.id)}" data-remove-chain-item="${esc(item.id)}"`,
    removeDisabled: !canRemove,
  });
  return `
    <div class="chain-item-block ${item.kind === "group" ? "is-group" : ""}" style="--chain-depth: ${depth};">
      ${row}
      ${item.kind === "group" ? `
        <div class="chain-group-drop-zone" data-reorder-id="${esc(item.id)}" data-drop-position="inside" title="Drop inside ${esc(label)}" aria-label="Drop inside ${esc(label)}"></div>
        ${!item.collapsed ? `<div class="chain-group-children" data-reorder-id="${esc(item.id)}" data-drop-position="inside">${chainItemsTemplate(item.chain || [], component, state, `${base}.chain`, depth + 1)}</div>` : ""}
        <div class="chain-group-drop-zone is-after" data-reorder-id="${esc(item.id)}" data-drop-position="after" title="Drop after ${esc(label)}" aria-label="Drop after ${esc(label)}"></div>
      ` : ""}
    </div>
  `;
}

const SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS = false;

function selectedChainItemTemplate(item, component, state, base) {
  if (item.kind === "source") return sourceChainItemTemplate(item, component, state, base);
  if (item.kind === "group") return groupChainItemTemplate(item, component, state, base);
  const effectComponent = getShaderComponent(item.componentId);
  return `
    <section class="chain-item-editor">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">${effectIcon(item.componentId)}</span><span>${esc(effectComponent?.name || item.componentId)}</span></div>
      ${shaderParamControlsTemplate(effectComponent, item, base)}
      ${effectComponent?.spatial && SHOW_CHAIN_ITEM_TRANSFORM_CONTROLS ? effectTransformControlsTemplate(item, base) : ""}
    </section>
  `;
}

function groupChainItemTemplate(item, component, state, base) {
  return `
    <section class="chain-item-editor">
      ${editableSectionTitleTemplate("account_tree", base + ".name", item.name || "Group")}
      <label class="field inline-param">
        <span>Collapsed</span>
        <input type="checkbox" data-update="${base}.collapsed" ${item.collapsed ? "checked" : ""} />
      </label>
      <div class="chain-composite-controls group-composite-controls">
        <label class="field"><span>Blend</span>${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend || "normal")}</label>
        ${rangeTemplate("Alpha", `${base}.opacity`, item.opacity ?? 1)}
      </div>
      <button type="button" class="chain-add-button" data-open-element-picker data-component-id="${esc(component.id)}" data-target-chain-item="${esc(item.id)}" title="Add element to group" aria-label="Add element to group">${icon("add")}</button>
      <div class="soft-note">Use the preview handles to move, scale, or rotate the group as one unit.</div>
    </section>
  `;
}

function sourceChainItemTemplate(item, ownerComponent, state, base) {
  const media = state.media?.find((entry) => entry.id === item.source?.mediaId) || null;
  const referencedComponent = state.components?.find((entry) => entry.id === item.source?.componentId) || null;
  const displayName = sourceChainItemDisplayName(item, media, referencedComponent);
  const isCanvasComponentPlacement = ownerComponent?.type === "canvas" && item.source?.type === "component";
  return `
    <section class="chain-item-editor">
      ${isCanvasComponentPlacement
        ? `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${sourceIcon(item.source)}</span><span>${esc(displayName)}</span></div>`
        : editableSectionTitleTemplate(sourceIcon(item.source), base + ".name", displayName)}
      ${item.source?.type === "component"
        ? (isCanvasComponentPlacement ? "" : `<label class="field">Component ${componentSelectTemplate(`${base}.source.componentId`, state, item.source.componentId)}</label>`)
        : sourcePickerTemplate(item, state, base)}
      <div class="chain-composite-controls">
        <label class="field"><span>Blend</span>${selectValuesTemplate(`${base}.blend`, BLEND_MODES, item.blend)}</label>
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

function selectedChainItemSelection(component, state) {
  const selected = findChainItemSelection(component.chain || [], state.ui.selectedChainItemId, `${pathForComponent(state, component)}.chain`);
  return selected || firstChainItemSelection(component.chain || [], `${pathForComponent(state, component)}.chain`);
}

function sourcePickerTemplate(component, state, base) {
  const source = component.source || {};
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      ${source.type === "generator" ? "" : `<div class="field">
        <span>Source</span>
        <button type="button" class="source-choice-button" data-open-source-choice="${esc(`${base}.source`)}">
          ${icon(sourceIcon(source))}
          <span>
            <strong>${esc(sourceTitle(source, media))}</strong>
            <small>${esc(sourceSubtitle(source, media))}</small>
          </span>
          ${icon("chevron_right")}
        </button>
      </div>`}
      ${source.type === "generator" ? generatorParamControlsTemplate(`${base}.source`, source, state) : ""}
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
  if (source.type === "component") return "account_tree";
  if (source.type === "generator") return generatorIcon(source.generatorId || "testPattern");
  if (source.type === "media") return isModelMediaSource(source) ? "deployed_code" : "perm_media";
  if (source.type === "camera") return "photo_camera";
  if (source.type === "black") return "radio_button_unchecked";
  return sourceTypeIcon(source.type || "generator");
}

function sourceTitle(source = {}, media = null, component = null) {
  if (source.type === "component") return component?.name || source.componentId || "Component";
  if (source.type === "generator") return getGeneratorComponent(source.generatorId || "testPattern").label || getGeneratorComponent(source.generatorId || "testPattern").name;
  if (source.type === "media") return media?.name || source.mediaId || "Media";
  if (source.type === "camera") return "Live camera";
  if (source.type === "black") return "Black";
  return "Choose source";
}

function sourceSubtitle(source = {}, media = null) {
  if (source.type === "component") return "Component reference";
  if (source.type === "generator") return "Generator";
  if (source.type === "media") return media?.type === "model" || isModelMediaSource(source) ? "3D model" : media?.type ? `Media ${media.type}` : "Media";
  if (source.type === "camera") return "Portal camera feed";
  if (source.type === "black") return "Empty black source";
  return "Source";
}

function sourceChainItemDisplayName(item = {}, media = null, component = null) {
  if (item.source?.type === "component") return sourceTitle(item.source, media, component);
  if (!item.name || isGenericLayerName(item.name) || item.name === item.source?.componentId) {
    return sourceTitle(item.source || {}, media, component);
  }
  return item.name;
}

function chainItemLabel(item = {}, media = null, component = null) {
  if (item.kind === "source") return sourceChainItemDisplayName(item, media, component);
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

function isGenericLayerName(value) {
  return /^Layer(?:\s+\d+)?$/i.test(String(value || "").trim());
}

function videoSourceControlsTemplate(base, source = {}, media = null) {
  const trim = videoTrimValues(source, media);
  return `
    <div class="video-source-controls">
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">content_cut</span><span>Movie segment</span></div>
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
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">deployed_code</span><span>3D model</span></div>
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

function generatorParamControlsTemplate(base, source = {}, state = {}) {
  const component = getGeneratorComponent(source.generatorId || "testPattern");
  if (!component?.params?.length) return "";
  const mediaControls = component.id === "featureMorph" || component.id === "featureMorphV2"
    ? featureMorphMediaControlsTemplate(base, source, state, component.id === "featureMorphV2" ? {
        note: "MobileNet compares a grid of semantic image regions. Best with related subjects or layouts.",
        emptyDetail: "MobileNet input",
      } : {})
    : component.id === "tileTexture"
      ? generatorImageMediaControlTemplate(base, source, state, { emptyDetail: "Tileable texture" })
      : "";
  return `
    <div class="chain-param-list">
      ${mediaControls}
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${base}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, { params: source.params || {} }, param),
      })}
    </div>
  `;
}

function sceneSurfaceTemplate(surface, state, catalog = {}) {
  const scene = getSelectedScene(state);
  const surfaceBase = pathForSurface(state, surface);
  const sceneIndex = scene ? state.scenes.findIndex((item) => item.id === scene.id) : -1;
  const surfaceIndex = scene?.snapshot?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasSceneSurface = sceneIndex >= 0 && surfaceIndex >= 0;
  const sceneSurface = hasSceneSurface ? scene.snapshot.surfaces[surfaceIndex] : null;
  const sceneBase = `scenes.${sceneIndex}.snapshot.surfaces.${surfaceIndex}`;
  const direct = surface.destination?.type === "direct";
  return `
    <article class="sculpt-card">
      ${direct ? `<div class="soft-note">Direct output</div>` : ""}
      ${direct ? "" : `<div class="surface-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>`}
      ${rangeTemplate("Feather", `${surfaceBase}.feather`, surface.feather ?? 0, 0, 0.5, 0.005)}
      ${hasSceneSurface ? `
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        <label class="field">${direct ? "Fit" : "Projection fit"} ${selectValuesTemplate(`${sceneBase}.projectionFit`, PROJECTION_FIT_MODES, sceneSurface.projectionFit || (direct ? "contain" : "cover"))}</label>
        ${componentAssignmentTemplate(sceneBase, state, sceneSurface, catalog)}
      ` : `<div class="soft-note">Capture a scene to store component assignments for this surface.</div>`}
    </article>
  `;
}

function sceneRailConfigTemplate(state) {
  const scene = getSelectedScene(state);
  if (!scene) {
    return `
      <div class="ui-section rail-section">
        <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
        ${emptyNote("Capture a scene to edit scene settings.")}
      </div>
    `;
  }
  const base = pathForScene(state, scene);
  return `
    <div class="ui-section rail-section">
      ${editableSectionTitleTemplate("auto_awesome_motion", `${base}.name`, scene.name)}
    </div>
  `;
}

function titleInputTemplate(path, value) {
  return `<input class="section-title-input" type="text" data-update="${esc(path)}" value="${esc(value)}" aria-label="Name" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />`;
}

function editableSectionTitleTemplate(iconName, path, value) {
  return `<div class="ui-section-header rail-title"><span class="material-symbols-rounded">${iconName}</span>${titleInputTemplate(path, value)}</div>`;
}

function panelTemplate(iconName, title, body, { titlePath = "" } = {}) {
  return `
    <section class="ui-section focus-panel">
      <header class="ui-section-header panel-title">
        <span class="material-symbols-rounded">${iconName}</span>
        ${titlePath ? titleInputTemplate(titlePath, title) : `<span>${esc(title)}</span>`}
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
      <output class="range-value" data-range-value>${formatRangeValue(safeValue, param.step ?? 0.01)}</output>
      <input type="range" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" data-display-step="${param.step ?? 0.01}" ${scaleAttrs} ${attrs}="${esc(path)}" value="${sliderValue}" />
    </label>
  `;
}

function colorParamControlTemplate(param, path, value, attrs = "data-update") {
  const mode = attrs.includes("data-live-update") ? "live" : "state";
  const liveComponentMatch = /data-live-component-id="([^"]*)"/.exec(attrs);
  const liveComponentId = liveComponentMatch?.[1] || "";
  const rgba = normalizeColorHex(value || param.defaultValue || "#ffffffff");
  const rgb = rgba.slice(0, 7);
  const alpha = colorAlphaFromHex(rgba);
  return `
    <div class="field color-param chain-param" data-color-param data-color-mode="${mode}" data-color-path="${esc(path)}" ${liveComponentId ? `data-live-component-id="${esc(liveComponentId)}"` : ""}>
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

function scenePillTemplate(scene, state) {
  const selected = state.ui.selectedSceneId === scene.id;
  const components = sceneFingerprintComponents(scene, state);
  return `
    <div class="component-card-row">
      <button type="button" class="component-card scene-card ${selected ? "is-selected" : ""}" data-select-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(components)}
        ${componentCardBarTemplate(scene.name)}
      </button>
      <button type="button" class="component-card-remove" data-delete-scene="${esc(scene.id)}" title="Remove" aria-label="Remove ${esc(scene.name)}">${icon("close")}</button>
    </div>
  `;
}

function liveScenePillTemplate(scene, state) {
  const selected = liveSelectedSceneId(state) === scene.id;
  const components = sceneFingerprintComponents(scene, state);
  const sceneOverrides = state.ui?.live?.sceneOverrides?.[scene.id] || (selected ? state.ui?.live?.componentOverrides || {} : {});
  const hasOverrides = Object.keys(sceneOverrides).length > 0;
  return `
    <div class="component-card-row">
      <button type="button" class="component-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(components)}
        ${componentCardBarTemplate(scene.name)}
      </button>
      <button type="button" class="component-card-remove" data-reset-live-scene="${esc(scene.id)}" title="Reset temporary settings" aria-label="Reset temporary settings for ${esc(scene.name)}" ${hasOverrides ? "" : "disabled"}>${icon("restart_alt")}</button>
    </div>
  `;
}

function liveInspectorTemplate(state) {
  const scene = getLiveSelectedScene(state);
  if (!scene) return panelTemplate("tune", "Live", emptyNote("No scenes"));
  const components = liveSceneComponents(scene, state);
  return components.map((component) => liveComponentTemplate(component, state)).join("")
    || panelTemplate("tune", scene.name, emptyNote("No components"));
}

function liveComponentTemplate(component, state) {
  const view = createLiveComponentView(component, state);
  return `
    <article class="ui-section focus-panel live-component-card">
      <header class="ui-section-header panel-title live-component-head">
        ${thumbnailTemplate(component.thumbnail)}
        <strong>${esc(component.name)}</strong>
      </header>
      ${liveUnifiedChainTemplate(view.chain, component.id, state, new Set([component.id]))}
    </article>
  `;
}

function liveUnifiedChainTemplate(chain, componentId, state, ancestry = new Set([componentId])) {
  if (!chain?.length) return "";
  return `
    <div class="live-chain-list">
      ${chain.map((item, index) => liveChainItemTemplate(item, componentId, index, `chain.${index}`, state, ancestry)).join("")}
    </div>
  `;
}

function liveChainItemTemplate(item, componentId, index, path = `chain.${index}`, state = {}, ancestry = new Set([componentId])) {
  if (item.kind === "effect") {
    const component = getShaderComponent(item.componentId);
    const label = component?.name || item.componentId;
    return `
      <div class="live-chain-pass">
        <div class="live-chain-title">
          ${enableToggleButton({
            livePath: `${path}.enabled`,
            componentId,
            value: item.enabled !== false,
            iconName: effectIcon(item.componentId),
            label,
          })}
          <span>${esc(label)}</span>
        </div>
        ${liveShaderParamControlsTemplate(component, item, componentId, path)}
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
            componentId,
            value: item.enabled !== false,
            iconName: "account_tree",
            label,
          })}
          <span>${esc(label)}</span>
        </div>
        ${liveRangeTemplate("Alpha", componentId, `${path}.opacity`, item.opacity ?? 1)}
        <label class="field chain-param">Blend ${liveSelectValuesTemplate(componentId, `${path}.blend`, BLEND_MODES, item.blend || "normal")}</label>
        ${item.chain?.length ? `<div class="live-chain-list">${item.chain.map((child, childIndex) => liveChainItemTemplate(child, componentId, childIndex, `${path}.chain.${childIndex}`, state, ancestry)).join("")}</div>` : ""}
      </div>
    `;
  }
  const referencedComponent = item.source?.type === "component"
    ? state.components?.find((component) => component.id === item.source.componentId)
    : null;
  const label = sourceChainItemDisplayName(item, null, referencedComponent);
  const iconName = sourceIcon(item.source || {});
  let referencedElements = "";
  if (referencedComponent && !ancestry.has(referencedComponent.id)) {
    const referencedView = createLiveComponentView(referencedComponent, state);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(referencedComponent.id);
    referencedElements = `
      <div class="live-referenced-component">
        <div class="live-referenced-title">${icon("account_tree")}<span>${esc(referencedComponent.name)} elements</span></div>
        ${liveUnifiedChainTemplate(referencedView.chain, referencedComponent.id, state, nextAncestry)}
      </div>
    `;
  }
  return `
    <div class="live-chain-pass">
      <div class="live-chain-title">
        ${enableToggleButton({
          livePath: `${path}.enabled`,
          componentId,
          value: item.enabled !== false,
          iconName,
          label,
        })}
        <span>${esc(label)}</span>
      </div>
      ${liveRangeTemplate("Opacity", componentId, `${path}.opacity`, item.opacity ?? 1)}
      <label class="field chain-param">Blend ${liveSelectValuesTemplate(componentId, `${path}.blend`, BLEND_MODES, item.blend || "normal")}</label>
      ${liveSourceParamControlsTemplate(item, componentId, path)}
      ${referencedElements}
    </div>
  `;
}

function liveShaderParamControlsTemplate(component, item, componentId, itemPath) {
  if (!component?.params?.length) return "";
  return `
    <div class="chain-param-list">
      ${paramControlsTemplate(component.params, {
        pathFor: (param) => `${itemPath}.params.${param.id}`,
        valueFor: (param) => paramCurrentValue(component, item, param),
        attrs: liveParamAttrs(componentId),
      })}
    </div>
  `;
}

function liveSourceParamControlsTemplate(item, componentId, itemPath) {
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
        attrs: liveParamAttrs(componentId),
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

function liveParamAttrs(componentId) {
  return `data-live-component-id="${esc(componentId)}" data-live-update`;
}

function liveRangeTemplate(label, componentId, path, value) {
  return `
    <label class="field range-field chain-param">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, 0.01)}</output>
      <input type="range" min="0" max="1" step="0.01" data-live-component-id="${esc(componentId)}" data-live-update="${path}" value="${value}" />
    </label>
  `;
}

function liveSelectValuesTemplate(componentId, path, values, value) {
  return `
    <select data-live-component-id="${esc(componentId)}" data-live-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function sceneFingerprintComponents(scene, state) {
  const ids = [];
  for (const surface of scene.snapshot?.surfaces || []) {
    if (surface.enabled === false) continue;
    if (surface.componentId && !ids.includes(surface.componentId)) ids.push(surface.componentId);
  }
  return ids
    .map((id) => state.components.find((component) => component.id === id))
    .filter(Boolean);
}

function sceneFingerprintTemplate(components) {
  if (!components.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  const withThumbs = components.filter((component) => component.thumbnail);
  if (!withThumbs.length) return `<div class="component-card-empty">${icon("auto_awesome_motion")}</div>`;
  return `
    <div class="scene-fingerprint">
      ${withThumbs.slice(0, 5).map((component, index) => `
        <img
          src="${esc(component.thumbnail)}"
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
  syncLiveSnapshotFromScene(state, scene);
}

function applySelectedSceneSnapshot(state) {
  const scene = getSelectedScene(state);
  if (!scene) return;
  applySceneSnapshotToState(state, scene);
  syncLiveSnapshotFromScene(state, scene);
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

function liveSceneComponents(scene, state) {
  return sceneFingerprintComponents(scene, state);
}

function canvasComponents(state) {
  return (state.components || []).filter((component) => component.type === "canvas");
}

function ordinaryComponents(state) {
  return (state.components || []).filter((component) => component.type !== "canvas");
}

function selectedCanvasComponent(state) {
  return canvasComponents(state).find((component) => component.id === state.ui.selectedComponentId)
    || canvasComponents(state)[0]
    || null;
}

function sceneSurfaceSnapshot(scene, surfaceId) {
  return scene?.snapshot?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

function getSceneSurfaceView(surface, state) {
  const snapshot = sceneSurfaceSnapshot(getSelectedScene(state), surface.id);
  return snapshot ? { ...surface, ...snapshot } : surface;
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

function componentAssignmentTemplate(routeBase, state, route = {}, catalog = {}) {
  const options = catalog.sources || sceneSourceNodes(state);
  return `
    <div class="field component-assignment-field" data-component-filter-scope>
      <span>Component</span>
      ${componentCatalogToolsTemplate("scene", catalog.sortMode || "recent", "Filter sources")}
      <div class="component-card-list assignment-card-list">
        ${options.map((node) => {
          const selected = node.id === route.sourceNodeId;
          return `
            <button type="button" class="component-card assignment-card ${selected ? "is-selected" : ""}" data-component-filter-card="${esc(node.name.toLowerCase())}" data-set-route-source-node="${esc(node.id)}" data-route-base="${esc(routeBase)}">
              ${thumbnailTemplate(node.thumbnail, node.type === "recording-frame" ? "select_all" : "account_tree")}
              ${componentCardBarTemplate(node.name)}
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function componentFilterTemplate(placeholder = "Filter components") {
  return `<label class="component-filter-field">${icon("search")}<input type="search" data-component-filter placeholder="${esc(placeholder)}" autocomplete="off" /></label>`;
}

function componentCatalogToolsTemplate(scope, activeMode = "recent", placeholder = "Filter components") {
  const modes = [
    ["recent", "Changed", "history"],
    ["name", "Name", "sort_by_alpha"],
    ["created", "Created", "add_circle"],
  ];
  const activeIndex = Math.max(0, modes.findIndex(([mode]) => mode === activeMode));
  const [, activeLabel, activeIcon] = modes[activeIndex];
  const [nextMode, nextLabel] = modes[(activeIndex + 1) % modes.length];
  return `
    <div class="component-catalog-tools">
      ${componentFilterTemplate(placeholder)}
      <div class="component-sort-toggle">
        <button type="button" class="is-active" data-catalog-sort-scope="${scope}" data-catalog-sort="${nextMode}" title="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}" aria-label="Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}">${icon(activeIcon)}<span>${activeLabel}</span></button>
      </div>
    </div>
  `;
}

export function sortComponentCatalog(items = [], mode = "recent") {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return items.slice().sort((a, b) => {
    if (mode === "name") return collator.compare(a.name || "", b.name || "") || collator.compare(a.id || "", b.id || "");
    const field = mode === "created" ? "createdAt" : "recentAt";
    const aTime = catalogTimestamp(a, field);
    const bTime = catalogTimestamp(b, field);
    return bTime - aTime || collator.compare(a.name || "", b.name || "") || collator.compare(a.id || "", b.id || "");
  });
}

function catalogTimestamp(item = {}, field = "recentAt") {
  if (field === "recentAt") return Number(item.recentAt) || latestProjectActivity(item.activity);
  const value = item[field] || item.activity?.[field];
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
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

function activeLiveOverrideBank(state) {
  state.ui.live ||= {};
  state.ui.live.componentOverrides ||= {};
  state.ui.live.sceneOverrides ||= {};
  const sceneId = String(state.ui.live.selectedSceneId || "");
  if (sceneId) state.ui.live.sceneOverrides[sceneId] = state.ui.live.componentOverrides;
  return state.ui.live.componentOverrides;
}

function invalidateComponentPreviewAssets(state, path = "") {
  const match = String(path).match(/^components\.(\d+)\.(chain|shaderChain|source|opacity|blend|speed|syncInstances)/);
  if (!match) return;
  const component = state.components?.[Number(match[1])];
  if (!component) return;
  component.thumbnail = "";
  if (component.type === "canvas" && component.canvas) component.canvas.frameThumbnails = {};
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

function syncRangeValue(input) {
  if (input?.type !== "range") return;
  const output = input.closest?.(".range-field")?.querySelector?.("[data-range-value]");
  if (!output) return;
  const value = readInputValue(input);
  if (input.dataset.rangeFormat === "time-stretch") {
    const stretch = Number(value) || 0;
    const scale = stretch <= -4 ? 0 : 2 ** stretch;
    setText(output, `${stretch.toFixed(2)} · ${scale < 0.1 ? scale.toFixed(3) : scale.toFixed(2)}×`);
    return;
  }
  if (input.dataset.rangeFormat === "percent") {
    setText(output, `${formatRangeValue(Number(value) * 100, input.dataset.displayStep || 1)}%`);
    return;
  }
  setText(output, `${formatRangeValue(value, input.dataset.displayStep || input.step)}${input.dataset.rangeSuffix || ""}`);
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

function pathForComponent(state, component) {
  return `components.${state.components.findIndex((item) => item.id === component.id)}`;
}
