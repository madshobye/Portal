import {
  applyMappingForEditing,
  projectSelectedMapping,
  clone,
  createSceneComponent,
  createDefaultComponent,
  createDefaultSurface,
  createComponentEffect,
  createComponentGroup,
  createComponentLayer,
  createInitialState,
  createLiveRenderState,
  mappingPreviewSurfaceRoutes,
  materializeLiveSurfacePatchRoute,
  createEmptyMappingFromState,
  createMappingFromState,
  sanitizeState,
  syncSurfaceProportionsFromMapping,
  uid,
} from "./domain/models.js";
import { compileLiveProjectionProgram } from "./domain/live-projection-program.js";
import {
  advanceLiveTransitionCoordinator,
  clearLiveTransitionCoordinator,
  scheduleLiveTransition,
} from "./domain/live-transition-coordinator.js";
import { firstEnabledLiveSurfaceId, liveSurfaceVisible } from "./domain/live-ui-state.js";
import { stampChangedProjectItems, touchComponentUsed } from "./domain/component-activity.js";
import { componentFrameMetrics } from "./domain/component-frame.js";
import { WORKSPACES } from "./constants.js";
import { createChangeEvent } from "./libraries/state-engine/state-command/index.js";
import { sceneLogicalSize } from "./domain/render-settings.js";
import { nextCatalogMarker } from "./domain/catalog-marker.js";
import { moveById } from "./domain/list-operations.js";
import {
  applyComponentGraphCommand,
  clearComponentGraphReferences,
  componentGraphNode,
  componentGraphCommandEvent,
  COMPONENT_GRAPH_COMMANDS,
} from "./domain/component-graph-commands.js";
import { componentLayerProjection } from "./domain/component-layer-projection.js";
import { copyComponentAsScene, pasteClipboardPayload } from "./domain/clipboard.js";
import { initializeLiveChainInsertion } from "./domain/scene-routing.js";
import {
  materializeStructuralTree,
  ObservableDataStore,
  produceStructuralShare,
} from "./libraries/data-store/data-store/index.js";
import { signalLoadMeter } from "./metrics/signal-load-meter.js";
import { applyEditorSelection, editorSelectionChangedPaths } from "./domain/editor-selection.js";
import { rebaseSessionTimeline } from "./libraries/timing-engine/session-timeline/index.js";
import {
  activeLiveTargetId,
  clearLiveTargetParameterDiffs,
  liveParameterDiffBank,
  updateLiveParameterDiffIfPresent,
  updateLiveNodeParameterDiffIfPresent,
} from "./domain/live-parameter-diffs.js";

export function createAppState(initial = null, {
  prepareState = null,
  prepareChange = null,
  classifyChange = createChangeEvent,
} = {}) {
  const normalizeState = (value) => {
    const normalized = sanitizeState(value);
    return typeof prepareState === "function" ? prepareState(normalized) : normalized;
  };
  let state = normalizeState(initial || createInitialState());
  // The application owns one immutable world root. Commands path-copy the
  // branches they change and publication shares that root with read-only
  // consumers. Full detached copies are explicit snapshot boundaries only.
  const dataStore = new ObservableDataStore(state, {
    clone,
    publication: "reference",
  });
  let pendingEditBaseline = null;
  const authoredSignalMeter = signalLoadMeter("control");
  function emit(change = "change") {
    const previousWorld = dataStore.current();
    const sessionTimeline = rebaseSessionTimeline(
      previousWorld?.metrics?.sessionTimeline,
      previousWorld?.global,
      state?.global,
    );
    if (state.metrics?.sessionTimeline !== sessionTimeline) {
      state = {
        ...state,
        metrics: {
          ...(state.metrics || {}),
          sessionTimeline,
        },
      };
    }
    // Commands may collect render patches while their recipe is operating on
    // the copy-on-write draft. The authored world is finalized before
    // publication, but those small side-channel values are not part of that
    // world tree and can otherwise retain transaction Proxies. Materialize the
    // event once at the transaction boundary so Preview, Output transport,
    // history, and diagnostics all observe the same plain-data command.
    const event = classifyChange(materializeStructuralTree(change));
    // Scrub/edit samples are intermediate values inside one authored gesture.
    // Count the completed command once; render invalidations retain the
    // per-sample cadence needed to diagnose an expensive drag.
    if (["project", "live"].includes(event.command.domain) && event.command.phase === "commit") {
      authoredSignalMeter.record("transactions", 1, event.reason);
    } else if (event.command.domain === "assets") {
      authoredSignalMeter.record("resourceRevisions", 1, event.reason);
    }
    dataStore.publish(state, event);
  }

  function getState() {
    return dataStore.current();
  }

  function snapshotState() {
    return dataStore.snapshot(state);
  }

  function getMetrics() {
    return clone(state.metrics);
  }

  function replace(next, change = "replace") {
    const event = classifyChange(change);
    const previous = pendingEditBaseline || state;
    pendingEditBaseline = null;
    const normalized = normalizeState(next);
    state = event.effects.lifecycle.project === "restore" ? normalized : stampChangedProjectItems(previous, normalized);
    if (event.command.domain !== "live") reconcileLiveParameterDiffsWithPersistentEdits(previous, state);
    emit(event);
  }

  function update(recipe, change = "update") {
    const event = classifyChange(change);
    const transactionBaseline = pendingEditBaseline || state;
    const next = produceStructuralShare(state, recipe);
    if (next === state && !pendingEditBaseline) return false;
    if (event.command.domain === "project" && ["scrub", "edit"].includes(event.command.phase)) {
      // A gesture is one transaction. Preserve the immutable pre-gesture root
      // while each sample path-copies only the branch it changes.
      pendingEditBaseline ||= state;
      state = produceStructuralShare(
        projectMappingProjectionForChangedSelection(state, next),
        (draft) => synchronizeActiveLiveDiffsForProjectChange(draft, event),
      );
      emit(event);
      return true;
    }
    pendingEditBaseline = null;
    let committed = projectMappingProjectionForChangedSelection(state, next);
    if (event.command.domain === "project") {
      committed = stampChangedOwners(transactionBaseline, committed);
      committed = produceStructuralShare(committed, (draft) => {
        reconcileLiveParameterDiffsWithPersistentEdits(transactionBaseline, draft);
        synchronizeActiveLiveDiffsForProjectChange(draft, event);
      });
      if (typeof prepareChange === "function") {
        // Activation is staged: graph reconciliation/compilation must finish
        // before the candidate can replace the published world root. A
        // compiler or validator error therefore leaves both state and
        // subscribers on the previous, executable revision.
        const prepared = prepareChange(transactionBaseline, committed, event);
        if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) {
          throw new Error("STATE_CHANGE_ACTIVATION_INVALID");
        }
        committed = prepared;
      }
    }
    state = committed;
    emit(event);
    return true;
  }

  function updateUi(recipe, change = "ui-update") {
    state = produceStructuralShare(state, (draft) => recipe(draft.ui));
    const supplied = change && typeof change === "object" ? change : { reason: change };
    emit({
      ...supplied,
      reason: String(supplied.reason || "ui-update"),
      command: { ...(supplied.command || {}), domain: "ui" },
    });
  }

  function updateRuntime(recipe, change = "runtime-update") {
    const metrics = clone(state.metrics);
    recipe(metrics);
    state = { ...state, metrics };
    emit({ reason: change, command: { domain: "runtime" } });
  }

  function updateDerived(recipe, change = "derived-update") {
    state = produceStructuralShare(state, recipe);
    const supplied = change && typeof change === "object" ? change : { reason: change };
    emit({
      ...supplied,
      reason: String(supplied.reason || "derived-update"),
      command: { ...(supplied.command || {}), domain: "derived" },
    });
  }

  function setComponentThumbnail(componentId, surfaceId = "", thumbnail = "") {
    if (!componentId || !thumbnail) return { updated: false, previous: "" };
    const index = state.components.findIndex((component) => component.id === componentId);
    if (index < 0) return { updated: false, previous: "" };
    const current = state.components[index];
    const previous = surfaceId && current.type === "scene"
      ? current.scene?.surfaceThumbnails?.[surfaceId] || ""
      : current.thumbnail || "";
    if (previous === thumbnail) return { updated: false, previous };
    let component;
    if (surfaceId && current.type === "scene") {
      component = {
        ...current,
        scene: {
          ...(current.scene || {}),
          surfaceThumbnails: {
            ...(current.scene?.surfaceThumbnails || {}),
            [surfaceId]: thumbnail,
          },
        },
      };
    } else {
      component = { ...current, thumbnail };
    }
    const components = state.components.slice();
    components[index] = component;
    state = { ...state, components };
    emit({
      reason: "component-thumbnail",
      command: { domain: "derived" },
      projection: {
        kind: "component-thumbnails",
        entries: [{ componentId, surfaceId, url: thumbnail }],
      },
    });
    return { updated: true, previous };
  }

  function updateLive(recipe, change = "live:update") {
    state = produceStructuralShare(state, recipe);
    const supplied = change && typeof change === "object" ? change : { reason: change };
    emit({ ...supplied, command: { ...(supplied.command || {}), domain: "live" } });
  }

  function resetLiveTarget(id) {
    updateLive((draft) => {
      const targetId = String(
        id ||
        draft.ui.live?.selectedComponentId ||
        draft.ui.live?.selectedSceneId ||
        "",
      );
      if (!targetId) return;
      clearLiveTargetParameterDiffs(draft, targetId);
    }, "live:reset");
  }

  function restoreLiveSession(session = {}, {
    reason = "live:session-restore",
  } = {}) {
    const savedLive = session?.live;
    if (!savedLive || typeof savedLive !== "object") return false;
    updateLive((draft) => {
      const mapping = draft.mappings.find(
        (item) => String(item.id) === String(session.selectedMappingId || ""),
      ) || draft.mappings.find(
        (item) => String(item.id) === String(draft.ui.selectedMappingId || ""),
      ) || draft.mappings[0];
      if (!mapping) return;
      draft.ui.selectedMappingId = mapping.id;
      projectSelectedMapping(draft, mapping);
      draft.global.timeStretch = Math.max(
        -4,
        Math.min(4, Number(session.timeStretch) || 0),
      );
      draft.ui.live.selectedSceneId = String(savedLive.selectedSceneId || "");
      draft.ui.live.selectedComponentId = String(savedLive.selectedComponentId || "");
      draft.ui.live.overallSourceCleared = savedLive.overallSourceCleared === true;
      draft.ui.live.sceneMappingVisible = savedLive.sceneMappingVisible !== false;
      draft.ui.live.inspectedComponentId = "";
      draft.ui.live.patchSourceId = "";
      draft.ui.live.surfacePatches = clone(savedLive.surfacePatches || {});
      draft.ui.live.surfaceVisibility = clone(savedLive.surfaceVisibility || {});
      draft.ui.live.parameterDiffs = clone(savedLive.parameterDiffs || {});
      draft.ui.live.transitionId = String(
        savedLive.transitionId || draft.ui.live.transitionId || "vj1.transition.dissolve",
      );
      draft.ui.live.transitionParameters = clone(savedLive.transitionParameters || {});
      draft.ui.live.transitionDuration = Math.max(
        0,
        Math.min(30, Number(savedLive.transitionDuration) || 0),
      );
      draft.ui.live.paramFadeDuration = Math.max(
        0,
        Math.min(30, Number(savedLive.paramFadeDuration) || 0),
      );
      clearLiveTransitionCoordinator(draft.ui.live);
      const requestedSurfaceId = String(savedLive.previewSurfaceId || "");
      const surfaceIsValid = requestedSurfaceId === "__mapping__"
        || mapping.surfaces?.some(
          (surface) => String(surface.id) === requestedSurfaceId,
        );
      draft.ui.live.previewSurfaceId = surfaceIsValid
        ? requestedSurfaceId
        : draft.ui.live.sceneMappingVisible
          ? "__mapping__"
          : firstEnabledLiveSurfaceId(mapping, draft.ui.live) || "__mapping__";
      draft.ui.previewViewports ||= {};
      draft.ui.previewViewports.live = {
        zoom: 1,
        x: 0,
        y: 0,
        fit: "frame",
      };
    }, { reason });
    return true;
  }

  function resetLiveSession() {
    updateLive((draft) => {
      const mapping = draft.mappings.find(
        (item) => String(item.id) === String(draft.ui.selectedMappingId || ""),
      ) || draft.mappings[0];
      const scene = draft.components.find((item) => item.type === "scene");
      const sceneMappingVisible = draft.ui.live?.sceneMappingInLive !== false;
      draft.ui.live.selectedSceneId = String(scene?.id || "");
      draft.ui.live.selectedComponentId = String(scene?.id || "");
      draft.ui.live.overallSourceCleared = !scene;
      draft.ui.live.sceneMappingVisible = sceneMappingVisible;
      draft.ui.live.inspectedComponentId = "";
      draft.ui.live.previewSurfaceId = sceneMappingVisible
        ? "__mapping__"
        : firstEnabledLiveSurfaceId(mapping, {
            ...draft.ui.live,
            sceneMappingVisible,
            surfacePatches: {},
            surfaceVisibility: {},
          }) || "__mapping__";
      draft.ui.live.patchSourceId = "";
      draft.ui.live.surfacePatches = {};
      draft.ui.live.surfaceVisibility = {};
      draft.ui.live.parameterDiffs = {};
      clearLiveTransitionCoordinator(draft.ui.live);
      draft.ui.previewViewports ||= {};
      draft.ui.previewViewports.live = {
        zoom: 1,
        x: 0,
        y: 0,
        fit: "frame",
      };
    }, { reason: "live:session-reset" });
    return true;
  }

  function updateMapping(mappingId, mapping, status = "Mapping updated", change = "mapping-state") {
    // Mapping feedback is a small, already-normalized renderer payload. Do not
    // send it through the generic whole-project clone/sanitize path: large
    // media projects otherwise make every mapping commit proportional to all
    // unrelated project data. The ordinary change event still owns history,
    // autosave, and output synchronization.
    const selectedId = String(state.ui?.selectedMappingId || "");
    const mappings = state.mappings.map((entry) => String(entry.id) === selectedId
      ? { ...entry, calibration: clone(mapping) }
      : entry);
    state = {
      ...state,
      mappings,
      mappingCalibration: clone(mapping),
      ui: { ...state.ui, mappingStatus: status || "Mapping updated" },
    };
    syncSurfaceProportionsFromMapping(state, mappings.find((entry) => String(entry.id) === selectedId));
    pendingEditBaseline = null;
    emit(change);
  }

  function subscribe(listener) {
    const event = classifyChange("init");
    return dataStore.subscribe(listener, { event });
  }

  return {
    getState,
    snapshotState,
    getMetrics,
    replace,
    update,
    updateUi,
    updateRuntime,
    updateDerived,
    setComponentThumbnail,
    isDebugPreviewEnabled: () => state.ui?.debugPreview !== false,
    updateLive,
    advanceLiveTransitions(nowMs = Date.now()) {
      let advanced = false;
      updateLive((draft) => {
        advanced = advanceLiveTransitionCoordinator(draft.ui.live, nowMs);
      }, { reason: "live:transition-advance" });
      return advanced;
    },
    updateMapping,
    subscribe,
    cycleCatalogMarker(kind, id) {
      const collection = kind === "media" ? "media" : kind === "mapping" ? "mappings" : "components";
      const index = (state[collection] || []).findIndex((item) => item.id === id);
      if (index < 0) return false;
      const previousItem = state[collection][index];
      const item = {
        ...previousItem,
        catalogMarker: nextCatalogMarker(previousItem.catalogMarker),
      };
      if (collection === "components") {
        item.activity = { ...(previousItem.activity || {}) };
        stampChangedProjectItems(
          { components: [previousItem] },
          { components: [item] },
        );
      }
      const items = state[collection].slice();
      items[index] = item;
      state = { ...state, [collection]: items };
      pendingEditBaseline = null;
      emit({
        reason: `catalog-marker:${kind}`,
        command: { domain: "project" },
        changedPaths: [`${collection}.${index}.catalogMarker`],
      });
      return true;
    },
    pasteClipboard(payload, target) {
      let result = { pasted: false, reason: "empty" };
      update((draft) => {
        result = pasteClipboardPayload(draft, payload, target);
      }, "paste");
      return result;
    },
    selectSurface(id) {
      if (!state.surfaces.some((surface) => surface.id === id)) return;
      const changedPaths = editorSelectionChangedPaths(state.ui, "surface");
      updateUi((ui) => {
        applyEditorSelection(ui, "surface", id);
      }, {
        reason: "select-surface",
        changedPaths,
      });
    },
    setMappingSurfaceVisibility(mappingId, surfaceId, visible, reason = "") {
      const mappingIndex = state.mappings.findIndex((mapping) =>
        String(mapping.id) === String(mappingId)
      );
      const previousMapping = state.mappings[mappingIndex];
      const surfaceIndex = previousMapping?.surfaces?.findIndex((surface) =>
        String(surface.id) === String(surfaceId)
      ) ?? -1;
      const previousSurface = previousMapping?.surfaces?.[surfaceIndex];
      if (mappingIndex < 0 || surfaceIndex < 0 || !previousSurface) return false;
      const nextSurface = {
        ...previousSurface,
        enabled: visible !== false,
        activity: { ...(previousSurface.activity || {}) },
      };
      const nextMapping = {
        ...previousMapping,
        surfaces: previousMapping.surfaces.slice(),
      };
      nextMapping.surfaces[surfaceIndex] = nextSurface;
      // Activity stamping is scoped to the one authored Surface. The generic
      // project update path compares every Component and Mapping item, which
      // made a one-bit eye command proportional to the entire project.
      stampChangedProjectItems(
        { mappings: [{ id: previousMapping.id, surfaces: [previousSurface] }] },
        { mappings: [{ id: nextMapping.id, surfaces: [nextSurface] }] },
      );
      const mappings = state.mappings.slice();
      mappings[mappingIndex] = nextMapping;
      const previous = state;
      const ui = { ...state.ui };
      applyEditorSelection(ui, "surface", surfaceId);
      const next = {
        ...state,
        mappings,
        ui,
      };
      if (String(state.ui?.selectedMappingId || "") === String(nextMapping.id)) {
        projectSelectedMapping(next, nextMapping);
      }
      state = typeof prepareChange === "function"
        ? prepareChange(previous, next, classifyChange({
          reason: reason || `toggle:mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`,
          command: { domain: "project" },
        }))
        : next;
      pendingEditBaseline = null;
      const changeReason = reason ||
        `toggle:mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`;
      const committedMapping = state.mappings.find((entry) => entry.id === mappingId) || nextMapping;
      const previewSurfaceRoutes = mappingPreviewSurfaceRoutes(state, committedMapping);
      const outputSurfaceRoutes = compileLiveProjectionProgram(state).currentRoutes.surfaces;
      emit({
        reason: changeReason,
        command: { domain: "project" },
        changedPaths: [
          `mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`,
          ...editorSelectionChangedPaths(state.ui, "surface"),
        ],
        renderPatches: [{
          target: "state",
          path: "surfaces",
          value: previewSurfaceRoutes,
        }],
        // Scene/Mapping view previews the editor's selected Scene, while the
        // external Output must retain its independently mounted Live source.
        // These are two projections of one authored visibility bit, not one
        // interchangeable Surface route program.
        outputRenderPatches: [{
          target: "state",
          path: "surfaces",
          value: outputSurfaceRoutes,
        }],
      });
      return true;
    },
    setComponentValues(entries = [], {
      reason = "",
      selectAction = "",
      selectId = "",
    } = {}) {
      const normalizedEntries = entries.map((entry) =>
        normalizeComponentControlEntry(state, entry)
      );
      const componentIndex = normalizedEntries[0]?.componentIndex;
      const previousComponent = state.components?.[componentIndex];
      if (
        !normalizedEntries.length ||
        normalizedEntries.some((entry) => !entry || entry.componentIndex !== componentIndex) ||
        !previousComponent
      ) return false;
      let nextComponent = previousComponent;
      let nextNodes = state.nodes;
      for (const entry of normalizedEntries) {
        if (entry.nodeId) {
          nextNodes = copyPathWithValue(
            nextNodes,
            entry.graphPath.slice("nodes.".length),
            entry.value,
            { createMissing: true },
          );
          if (!nextNodes) return false;
        } else {
          nextComponent = copyPathWithValue(
            nextComponent,
            entry.relativePath,
            entry.value,
            { createMissing: true },
          );
          if (!nextComponent) return false;
        }
      }
      nextComponent.activity = { ...(previousComponent.activity || {}) };
      // Stamp only the affected Component. Inspector controls already produce
      // normalized authored values; whole-project normalization and stable
      // comparison make a local parameter command proportional to unrelated
      // media and Components without adding correctness.
      stampChangedProjectItems(
        { components: [previousComponent] },
        { components: [nextComponent] },
      );
      const components = state.components.slice();
      components[componentIndex] = nextComponent;
      const ui = clone(state.ui);
      if (selectAction === "chain-item" && selectId) {
        applyEditorSelection(ui, "element", selectId);
      } else if (selectAction === "data-select-component" && selectId) {
        ui.selectedComponentId = String(selectId);
      }
      const previous = state;
      const changedPaths = normalizedEntries.map((entry) =>
        entry.graphPath || `components.${componentIndex}.${entry.relativePath}`
      );
      let next = { ...state, components, nodes: nextNodes, ui };
      next = typeof prepareChange === "function"
        ? prepareChange(previous, next, classifyChange({
          reason: reason || `update:components.${componentIndex}.${normalizedEntries[0].relativePath}`,
          command: { domain: "project" },
          changedPaths,
        }))
        : next;
      reconcileLiveParameterDiffsWithPersistentEdits(previous, next);
      synchronizeActiveLiveDiffsForProjectChange(next, { changedPaths });
      state = next;
      pendingEditBaseline = null;
      const selectionChangedPaths = selectAction === "chain-item" && selectId
        ? editorSelectionChangedPaths(state.ui, "element")
        : [];
      emit({
        reason: reason || `update:components.${componentIndex}.${normalizedEntries[0].relativePath}`,
        command: { domain: "project" },
        changedPaths: [
          ...changedPaths,
          ...selectionChangedPaths,
        ],
        renderPatches: normalizedEntries.filter((entry) =>
          !["activity", "thumbnail", "name", "catalogMarker"].includes(
            String(entry.relativePath).split(".")[0]
          )
        ).map((entry) => ({
          componentId: String(previousComponent.id),
          nodeId: entry.nodeId,
          path: entry.relativePath,
          value: entry.value,
        })),
      });
      return true;
    },
    setComponentValue(path, value, options = {}) {
      return this.setComponentValues([{ path, value }], options);
    },
    setComponentToggle(path, value, options = {}) {
      return this.setComponentValues([{ path, value }], options);
    },
    selectComponent(id) {
      const index = state.components.findIndex((component) => component.id === id);
      if (index < 0) return;
      const component = {
        ...state.components[index],
        activity: { ...(state.components[index].activity || {}) },
      };
      const components = state.components.slice();
      components[index] = component;
      touchComponentUsed({ components }, id);
      const ui = clone(state.ui);
      ui.selectedComponentId = id;
      applyEditorSelection(ui, "element", componentLayerProjection(state, component)[0]?.nodeId || "");
      rememberWorkspaceComponent({ ui }, ui.workspace, component);
      state = { ...state, components, ui };
      // Selection is local to the editor. It is still autosaved so recent-use
      // sorting survives reload, but it must not rebuild a Live render state.
      emit({
        reason: "select-component",
        command: { domain: "ui" },
        changedPaths: ["ui.selectedComponentId"],
      });
    },
    setWorkspace(workspace) {
      const targetWorkspace = WORKSPACES.includes(workspace) ? workspace : "scene";
      if (state.ui.workspace === targetWorkspace) return false;
      // Workspace navigation changes editor projection only. Running it
      // through the generic project update path cloned, normalized, and
      // activity-diffed the complete project inside the browser click
      // handler. Keep the authored collections structurally shared and clone
      // only the UI/global/Mapping projection branches this command owns.
      const draft = {
        ...state,
        ui: clone(state.ui),
        global: { ...state.global },
      };
      const current = draft.components.find((component) => component.id === draft.ui.selectedComponentId);
      rememberWorkspaceComponent(draft, draft.ui.workspace, current);
      draft.ui.workspace = targetWorkspace;
      restoreWorkspaceComponent(draft, targetWorkspace);
      draft.global.calibrating = targetWorkspace === "mapping";
      if (targetWorkspace === "mapping") {
        const mapping = draft.mappings.find((item) => item.id === draft.ui.selectedMappingId) || draft.mappings[0];
        if (mapping) projectSelectedMapping(draft, mapping);
      }
      state = draft;
      // Workspace has an explicit browser preference owner in view-routing.
      // It is not a project edit and must not serialize project.json or send a
      // complete render state to Output.
      emit({ reason: "workspace", command: { domain: "ui" } });
      return true;
    },
    getLiveRenderState() {
      // createLiveRenderState owns its clone. Passing the internal immutable
      // truth avoids cloning the complete project twice before transport.
      return createLiveRenderState(state);
    },
    getMappingRenderState(id) {
      const current = getState();
      const scene = current.mappings.find((item) => String(item.id) === String(id));
      return scene ? applyMappingForEditing(current, scene) : createLiveRenderState(current);
    },
    getRenderState() {
      const current = getState();
      if (current.ui?.workspace === "live") return createLiveRenderState(current);
      if (current.ui?.workspace === "mapping") {
        const scene = current.mappings.find((item) => item.id === current.ui.selectedMappingId) || current.mappings[0];
        return scene ? applyMappingForEditing(current, scene) : current;
      }
      return current;
    },
    addComponent() {
      update((draft) => {
        const componentCount = draft.components.filter((item) => item.type !== "scene" && !item.systemRole).length;
        const component = createDefaultComponent(componentCount, { empty: componentCount > 10 });
        draft.components.push(component);
        draft.ui.selectedComponentId = component.id;
        applyEditorSelection(draft.ui, "element", component.chain[0]?.id || "");
        rememberWorkspaceComponent(draft, "component", component);
      }, "add-component");
    },
    addScene() {
      update((draft) => {
        const component = createSceneComponent(
          draft.components.filter((item) => item.type === "scene").length
        );
        draft.components.push(component);
        draft.ui.selectedComponentId = component.id;
        applyEditorSelection(draft.ui, "element", component.chain[0]?.id || "");
        rememberWorkspaceComponent(draft, "scene", component);
      }, "add-scene");
    },
    copyComponentToScene(componentId) {
      if (!state.components.some((item) => item.id === componentId && item.type !== "scene" && !item.systemRole)) {
        return { converted: false, reason: "missing-component" };
      }
      let result = { converted: false, reason: "missing-component" };
      update((draft) => {
        result = copyComponentAsScene(draft, componentId);
        if (!result.converted) return;
        draft.ui.workspace = "scene";
        draft.global.calibrating = false;
      }, "convert-component-to-scene");
      return result;
    },
    selectChainItem(id) {
      const selected = state.components.find((component) => component.id === state.ui.selectedComponentId);
      if (!id) {
        if (!state.ui.selectedChainItemId &&
            !(state.ui.workspace === "scene" && state.ui.sceneInspectorTarget !== "element")) return;
        const changedPaths = editorSelectionChangedPaths(state.ui, "element");
        updateUi((ui) => {
          applyEditorSelection(ui, "element", "");
        }, {
          reason: "select-chain-item",
          changedPaths,
        });
        return;
      }
      if (!componentGraphNode(state, selected?.id, id)) return;
      const changedPaths = editorSelectionChangedPaths(state.ui, "element");
      updateUi((ui) => {
        applyEditorSelection(ui, "element", id);
      }, {
        reason: "select-chain-item",
        changedPaths,
      });
    },
    removeChainItem(componentId, itemId) {
      update((draft) => {
        const result = applyComponentGraphCommand(draft, {
          type: COMPONENT_GRAPH_COMMANDS.REMOVE,
          componentId,
          nodeId: itemId,
          selectionId: draft.ui.selectedChainItemId,
        });
        if (result.changed && draft.ui.selectedChainItemId === itemId) {
          applyEditorSelection(draft.ui, "element", result.selectionId);
        }
      }, componentGraphCommandEvent({
        type: COMPONENT_GRAPH_COMMANDS.REMOVE,
        componentId,
        nodeId: itemId,
      }, "remove-chain-item"));
    },
    addChainSource(componentId, source = { type: "generator", generatorId: "testPattern" }) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        if (source.type === "component" && component.type !== "scene") return;
        const layer = createComponentLayer(componentLayerCount(draft, component), source);
        initializeLiveChainInsertion(draft, component.id, layer);
        if (source.type === "component" && component.type === "scene") {
          const referenced = draft.components.find((item) => item.id === source.componentId && item.type !== "scene");
          if (!referenced) return;
          const metrics = componentFrameMetrics(draft.render, referenced);
          const sceneWidth = sceneLogicalSize(draft.render).width;
          layer.source.placement = {
            scale: metrics.baseWidth / sceneWidth,
          };
        }
        applyComponentGraphCommand(draft, {
          type: COMPONENT_GRAPH_COMMANDS.INSERT,
          componentId,
          item: layer,
          afterNodeId: draft.ui.selectedChainItemId,
        });
        applyEditorSelection(draft.ui, "element", layer.id);
      }, componentGraphCommandEvent({
        type: COMPONENT_GRAPH_COMMANDS.INSERT,
        componentId,
        nodeId: "new-source",
      }, "add-chain-source"));
    },
    addChainEffect(componentId, effectId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        const effect = createComponentEffect(effectId);
        initializeLiveChainInsertion(draft, component.id, effect);
        applyComponentGraphCommand(draft, {
          type: COMPONENT_GRAPH_COMMANDS.INSERT,
          componentId,
          item: effect,
          afterNodeId: draft.ui.selectedChainItemId,
        });
        applyEditorSelection(draft.ui, "element", effect.id);
      }, componentGraphCommandEvent({
        type: COMPONENT_GRAPH_COMMANDS.INSERT,
        componentId,
        nodeId: "new-effect",
      }, "add-chain-effect"));
    },
    addChainGroup(componentId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        const group = createComponentGroup(componentGroupCount(draft, component));
        initializeLiveChainInsertion(draft, component.id, group);
        applyComponentGraphCommand(draft, {
          type: COMPONENT_GRAPH_COMMANDS.INSERT,
          componentId,
          item: group,
          afterNodeId: draft.ui.selectedChainItemId,
        });
        applyEditorSelection(draft.ui, "element", group.id);
      }, componentGraphCommandEvent({
        type: COMPONENT_GRAPH_COMMANDS.INSERT,
        componentId,
        nodeId: "new-group",
      }, "add-chain-group"));
    },
    reorderChain(componentId, fromId, toId, position = "before") {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        applyComponentGraphCommand(draft, {
          type: COMPONENT_GRAPH_COMMANDS.MOVE,
          componentId,
          nodeId: fromId,
          targetNodeId: toId,
          position,
        });
      }, componentGraphCommandEvent({
        type: COMPONENT_GRAPH_COMMANDS.MOVE,
        componentId,
        nodeId: fromId,
        targetNodeId: toId,
        position,
      }, "reorder-chain"));
    },
    reorderSurfaces(fromId, toId) {
      update((draft) => {
        const mapping = draft.mappings.find((item) => item.id === draft.ui.selectedMappingId);
        if (mapping) moveById(mapping.surfaces, fromId, toId);
      }, "reorder-surfaces");
    },
    removeComponent(id) {
      update((draft) => {
        if (draft.components.length <= 1) return;
        draft.components = draft.components.filter((component) => component.id !== id);
        draft.ui.selectedComponentId = draft.components[0]?.id || "";
        for (const mapping of draft.mappings) {
          for (const surface of mapping.surfaces || []) {
            if (surface.componentId === id) surface.componentId = draft.ui.selectedComponentId;
          }
        }
        clearComponentGraphReferences(draft, id);
        restoreWorkspaceComponent(draft, draft.ui.workspace);
      }, "remove-component");
    },
    addSurface() {
      update((draft) => {
        const mapping = draft.mappings.find((item) => item.id === draft.ui.selectedMappingId);
        if (!mapping) return;
        const mappedSurfaces = mapping.surfaces.filter((item) => item.destination?.type !== "direct");
        const surface = createDefaultSurface(mappedSurfaces.length);
        surface.id = uid("surface");
        surface.name = `Srf ${mappedSurfaces.length + 1}`;
        surface.mappingId = surface.id;
        mapping.surfaces.push(surface);
        applyEditorSelection(draft.ui, "surface", surface.id);
      }, "add-surface");
    },
    removeSurface(id) {
      update((draft) => {
        const mapping = draft.mappings.find((item) => item.id === draft.ui.selectedMappingId);
        if (!mapping) return;
        const target = mapping.surfaces.find((surface) => surface.id === id);
        if (target?.destination?.type === "direct") return;
        mapping.surfaces = mapping.surfaces.filter((surface) => surface.id !== id);
        for (const component of draft.components || []) {
          if (component.type !== "scene") continue;
          if (component.scene?.surfaceThumbnails) delete component.scene.surfaceThumbnails[id];
        }
        applyEditorSelection(draft.ui, "surface", mapping.surfaces[0]?.id || "");
        if (Array.isArray(mapping.calibration?.surfaces)) {
          mapping.calibration.surfaces = mapping.calibration.surfaces.filter((surface) => surface.name !== id && surface.id !== id);
        }
      }, "remove-surface");
    },
    saveMapping(name) {
      update((draft) => {
        const scene = createMappingFromState(draft, name);
        draft.mappings.push(scene);
        draft.ui.selectedMappingId = scene.id;
      }, "save-mapping");
    },
    addMapping(name) {
      update((draft) => {
        const scene = createEmptyMappingFromState(draft, name);
        draft.mappings.push(scene);
        projectSelectedMapping(draft, scene);
        draft.ui.selectedMappingId = scene.id;
      }, "add-mapping");
    },
    selectMapping(id) {
      const current = getState();
      const scene = current.mappings.find((item) => String(item.id) === String(id));
      if (!scene) return;
      // Mapping selection changes the editor's projected Surface view, not
      // the authored Mapping. Publishing it as a project commit used to create
      // invisible undo entries and synchronize a non-authoritative projection
      // to Output.
      state = applyMappingForEditing(current, scene);
      pendingEditBaseline = null;
      emit({ reason: "select-mapping", command: { domain: "ui" } });
    },
    selectLiveScene(id) {
      updateLive((draft) => {
        const scene = draft.components.find((item) => item.type === "scene" && String(item.id) === String(id));
        if (!scene) return;
        const mapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || "")) || draft.mappings[0];
        if (patchSelectedLiveSurface(draft, scene, mapping)) return;
        draft.ui.live.overallSourceCleared = false;
        const previousSceneId = String(draft.ui.live.selectedSceneId || "");
        const previousTarget = draft.components.find((item) =>
          !item.systemRole && String(item.id) === String(draft.ui.live.selectedComponentId || "")
        ) || draft.components.find((item) => item.type === "scene" && String(item.id) === previousSceneId);
        if (previousSceneId === String(scene.id)
          && String(previousTarget?.id || "") === String(scene.id)) return;
        const previousRoutes = compileLiveProjectionProgram(draft).logicalRoutes;
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.selectedComponentId = scene.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        scheduleLiveRouteTransition(draft, previousRoutes, {
          previousTargetId: previousTarget?.id || "",
        });
      }, "live:scene");
    },
    selectLiveComponent(id) {
      updateLive((draft) => {
        const target = draft.components.find((item) =>
          item.type !== "scene" && !item.systemRole && String(item.id) === String(id)
        );
        if (!target) return;
        const mapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || "")) || draft.mappings[0];
        if (patchSelectedLiveSurface(draft, target, mapping)) return;
        draft.ui.live.overallSourceCleared = false;
        if (String(draft.ui.live.selectedComponentId || "") === String(target.id)) return;
        const sceneId = String(draft.ui.live.selectedSceneId || "");
        const scene = draft.components.find((item) => item.type === "scene" && String(item.id) === sceneId);
        const previousTarget = draft.components.find((item) =>
          !item.systemRole && String(item.id) === String(draft.ui.live.selectedComponentId || "")
        ) || scene;
        const previousRoutes = compileLiveProjectionProgram(draft).logicalRoutes;
        draft.ui.live.selectedComponentId = target.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        scheduleLiveRouteTransition(draft, previousRoutes, {
          previousTargetId: previousTarget?.id || "",
        });
      }, "live:target");
    },
    selectLivePreviewSurface(id) {
      const requested = String(id || "__mapping__");
      const current = getState();
      const mapping = current.mappings.find((item) => String(item.id) === String(current.ui.selectedMappingId || "")) || current.mappings[0];
      if (requested !== "__mapping__" && !mapping?.surfaces?.some((surface) => String(surface.id) === requested)) return;
      updateUi((ui) => {
        ui.live ||= {};
        ui.live.previewSurfaceId = requested;
        ui.live.inspectedComponentId = "";
        ui.previewViewports ||= {};
        // Projection selection changes the view of the retained Preview
        // canvas; it never substitutes a second canvas or rewrites the routed
        // output program. Re-enter the shared frame fit so an old manual
        // pan/zoom from another matrix cell cannot make the selected output
        // appear to be a different render.
        ui.previewViewports.live = { zoom: 1, x: 0, y: 0, fit: "frame" };
        // Surface selection chooses a patch destination, not a source. Clear
        // the pending source so moving through the projection matrix cannot
        // accidentally reapply the previously selected Scene or Component.
        ui.live.patchSourceId = "";
      }, "live:preview-surface");
    },
    setSceneMappingInLive(included) {
      const enabled = included !== false;
      update((draft) => {
        draft.ui.live ||= {};
        draft.ui.live.sceneMappingInLive = enabled;
        // Mapping owns the persisted default. Live visibility remains a
        // separate runtime value and can be changed again from the Live rail.
        draft.ui.live.sceneMappingVisible = enabled;
        if (!enabled && String(draft.ui.live.previewSurfaceId || "__mapping__") === "__mapping__") {
          const mapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || ""))
            || draft.mappings[0];
          draft.ui.live.previewSurfaceId = firstEnabledLiveSurfaceId(mapping, draft.ui.live) || "__mapping__";
        }
      }, "toggle:ui.live.sceneMappingInLive");
      return true;
    },
    toggleLiveSurfaceVisibility(id) {
      const surfaceId = String(id || "");
      const current = getState();
      const mapping = current.mappings.find((item) => String(item.id) === String(current.ui.selectedMappingId || "")) || current.mappings[0];
      if (!surfaceId || !mapping) return false;
      if (surfaceId === "__mapping__") {
        const visible = current.ui.live?.sceneMappingVisible === false;
        updateLive((draft) => {
          draft.ui.live.sceneMappingVisible = visible;
        }, "live:surface-visibility");
        return true;
      }
      const surface = mapping.surfaces?.find((candidate) => String(candidate.id) === surfaceId);
      if (!surface) return false;
      const visible = !liveSurfaceVisible(surface, current.ui.live);
      updateLive((draft) => {
        draft.ui.live.surfaceVisibility ||= {};
        draft.ui.live.surfaceVisibility[surfaceId] = visible;
        clearLiveTransitionCoordinator(draft.ui.live);
      }, "live:surface-visibility");
      return true;
    },
    clearLiveSurfacePatch(id) {
      const surfaceId = String(id || "");
      const current = getState();
      const mapping = current.mappings.find((item) => String(item.id) === String(current.ui.selectedMappingId || "")) || current.mappings[0];
      if (!surfaceId
        || !mapping?.surfaces?.some((surface) => String(surface.id) === surfaceId)
        || !current.ui.live?.surfacePatches?.[surfaceId]) return false;
      const clearedPatchTargetId = String(current.ui.live.surfacePatches[surfaceId] || "");
      updateLive((draft) => {
        const draftMapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || "")) || draft.mappings[0];
        if (!draftMapping) return;
        const previousRoutes = clone(compileLiveProjectionProgram(draft).logicalRoutes);
        draft.ui.live.surfacePatches ||= {};
        delete draft.ui.live.surfacePatches[surfaceId];
        draft.ui.live.patchSourceId = "";
        scheduleLiveRouteTransition(draft, previousRoutes, {
          previousTargetId: clearedPatchTargetId,
          surfaceId,
        });
      }, "live:surface-patch-clear");
      return true;
    },
    clearLiveOverallComponent() {
      const current = getState();
      const selectedTarget = current.components.find((component) =>
        !component.systemRole && String(component.id) === String(current.ui.live?.selectedComponentId || "")
      ) || current.components.find((component) =>
        component.type === "scene" && String(component.id) === String(current.ui.live?.selectedSceneId || "")
      );
      if (!selectedTarget || current.ui.live?.overallSourceCleared === true) return false;
      updateLive((draft) => {
        const mapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || "")) || draft.mappings[0];
        if (!mapping) return;
        const previousRoutes = clone(compileLiveProjectionProgram(draft).logicalRoutes);
        draft.ui.live.overallSourceCleared = true;
        draft.ui.live.selectedSceneId = "";
        draft.ui.live.selectedComponentId = "";
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        scheduleLiveRouteTransition(draft, previousRoutes, {
          previousTargetId: selectedTarget.id,
        });
      }, "live:overall-component-clear");
      return true;
    },
    restoreLiveScene(id) {
      updateLive((draft) => {
        const scene = draft.components.find((item) => item.type === "scene" && String(item.id) === String(id));
        if (!scene) return;
        draft.ui.live.overallSourceCleared = false;
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.surfacePatches = {};
        draft.ui.live.patchSourceId = "";
        clearLiveTransitionCoordinator(draft.ui.live);
        draft.ui.live.selectedComponentId = scene.id;
      }, { reason: "live:scene-restore" });
    },
    restoreLiveSession,
    restoreLivePreference({ sceneId = "", previewSurfaceId = "" } = {}) {
      return restoreLiveSession({
        selectedMappingId: state.ui.selectedMappingId,
        timeStretch: state.global.timeStretch,
        live: {
          ...state.ui.live,
          selectedSceneId: sceneId,
          selectedComponentId: sceneId,
          previewSurfaceId,
          surfacePatches: {},
          surfaceVisibility: {},
          transitionCoordinator: {},
        },
      }, { reason: "live:preference-restore" });
    },
    resetLiveSession,
    resetLiveTarget,
    deleteMapping(id) {
      update((draft) => {
        draft.mappings = draft.mappings.filter((scene) => String(scene.id) !== String(id));
        if (String(draft.ui.selectedMappingId) === String(id)) draft.ui.selectedMappingId = draft.mappings[0]?.id || "";
        const selectedScene = draft.mappings.find((scene) => scene.id === draft.ui.selectedMappingId);
        if (selectedScene) projectSelectedMapping(draft, selectedScene);
      }, "delete-mapping");
    },
  };
}

function projectMappingProjectionForChangedSelection(previous, next) {
  if (next.ui?.workspace !== "mapping") return next;
  const selectedId = String(next.ui?.selectedMappingId || "");
  const previousMapping = previous.mappings?.find((item) => String(item.id) === selectedId);
  const nextMapping = next.mappings?.find((item) => String(item.id) === selectedId);
  if (previousMapping === nextMapping) return next;
  return produceStructuralShare(next, (draft) => {
    const mapping = draft.mappings?.find((item) => String(item.id) === selectedId);
    projectSelectedMapping(draft, mapping);
  });
}

function stampChangedOwners(previous, next) {
  const previousComponents = new Map(
    (previous.components || []).map((component) => [String(component.id), component])
  );
  const changedComponents = (next.components || []).flatMap((component, index) => {
    const before = previousComponents.get(String(component.id));
    return before === component ? [] : [{ before, index }];
  });
  const previousMappings = new Map(
    (previous.mappings || []).map((mapping) => [String(mapping.id), mapping])
  );
  const changedSurfaces = [];
  for (let mappingIndex = 0; mappingIndex < (next.mappings || []).length; mappingIndex++) {
    const mapping = next.mappings[mappingIndex];
    const beforeMapping = previousMappings.get(String(mapping.id));
    if (beforeMapping === mapping) continue;
    const previousSurfaces = new Map(
      (beforeMapping?.surfaces || []).map((surface) => [String(surface.id), surface])
    );
    for (let surfaceIndex = 0; surfaceIndex < (mapping.surfaces || []).length; surfaceIndex++) {
      const surface = mapping.surfaces[surfaceIndex];
      const before = previousSurfaces.get(String(surface.id));
      if (before !== surface) changedSurfaces.push({
        before,
        mappingId: mapping.id,
        mappingIndex,
        surfaceIndex,
      });
    }
  }
  if (!changedComponents.length && !changedSurfaces.length) return next;
  const timestamp = new Date().toISOString();
  return produceStructuralShare(next, (draft) => {
    for (const { before, index } of changedComponents) {
      stampChangedProjectItems(
        { components: before ? [before] : [] },
        { components: [draft.components[index]] },
        timestamp,
      );
    }
    for (const entry of changedSurfaces) {
      stampChangedProjectItems(
        {
          mappings: [{
            id: entry.mappingId,
            surfaces: entry.before ? [entry.before] : [],
          }],
        },
        {
          mappings: [{
            id: entry.mappingId,
            surfaces: [draft.mappings[entry.mappingIndex].surfaces[entry.surfaceIndex]],
          }],
        },
        timestamp,
      );
    }
  });
}

function rememberWorkspaceComponent(draft, workspace, component) {
  if (workspace !== "component" && workspace !== "scene") return;
  if (!component || (workspace === "scene") !== (component.type === "scene")) return;
  draft.ui.workspaceSelectionIds ||= { component: "", scene: "" };
  draft.ui.workspaceSelectionIds[workspace] = component.id;
}

function restoreWorkspaceComponent(draft, workspace) {
  if (workspace !== "component" && workspace !== "scene") return;
  draft.ui.workspaceSelectionIds ||= { component: "", scene: "" };
  const wantsScene = workspace === "scene";
  const rememberedId = draft.ui.workspaceSelectionIds[workspace];
  const component = draft.components.find((item) =>
    item.id === rememberedId && (item.type === "scene") === wantsScene
  ) || draft.components.find((item) => (item.type === "scene") === wantsScene);
  if (!component) return;
  draft.ui.workspaceSelectionIds[workspace] = component.id;
  draft.ui.selectedComponentId = component.id;
  applyEditorSelection(draft.ui, "element", componentLayerProjection(draft, component)[0]?.nodeId || "");
}

function componentLayerCount(state, component) {
  return flattenComponentLayers(componentLayerProjection(state, component)).length;
}

function componentGroupCount(state, component) {
  return flattenComponentLayers(componentLayerProjection(state, component))
    .filter((layer) => layer.item?.kind === "group").length;
}

function flattenComponentLayers(layers = []) {
  return (layers || []).flatMap((layer) => [layer, ...flattenComponentLayers(layer.children)]);
}

// Overall selection changes the base Live program. Explicit per-Surface
// patches remain independent matrix assignments and must survive that change.
// Rebuild from the selected Scene/Component first, then apply those authored
// exceptions and visibility. This keeps one route authority for preview and
// output instead of merging stale, previously materialized routes.
function patchSelectedLiveSurface(state, target, mapping) {
  const surfaceId = String(state.ui?.live?.previewSurfaceId || "__mapping__");
  if (surfaceId === "__mapping__" || !mapping) return false;
  const targetRoute = materializeLiveSurfacePatchRoute(state, target, mapping, surfaceId);
  if (!targetRoute) return false;
  const previousRoutes = clone(compileLiveProjectionProgram(state).logicalRoutes);
  state.ui.live.surfacePatches ||= {};
  state.ui.live.surfacePatches[surfaceId] = target.id;
  state.ui.live.patchSourceId = target.id;
  state.ui.live.inspectedComponentId = "";
  scheduleLiveRouteTransition(state, previousRoutes, { surfaceId });
  return true;
}

function scheduleLiveRouteTransition(state, previousRoutes, {
  previousTargetId: explicitPreviousTargetId = "",
  surfaceId = "",
} = {}) {
  const durationMs = Math.round(Math.max(0, Number(state.ui.live.transitionDuration) || 0) * 1000);
  const previousRouteTargetId = previousRoutes?.surfaces?.find((route) =>
    !surfaceId || String(route.id) === String(surfaceId)
  )?.componentId;
  // Overall selection owns one explicit target even when individual Surface
  // patches route other Components. Inferring that target from the first
  // rendered route snapshots the wrong Live diff bank in a mixed Mapping.
  // Surface-only transitions still derive their previous endpoint from the
  // addressed route when no explicit cleared-patch target is supplied.
  const previousTargetId = String(
    explicitPreviousTargetId || previousRouteTargetId || "",
  );
  if (durationMs <= 0 || !previousRoutes?.surfaces?.length) {
    clearLiveTransitionCoordinator(state.ui.live);
    return;
  }
  const currentRoutes = clone(compileLiveProjectionProgram(state).logicalRoutes);
  const currentRouteTargetId = currentRoutes.surfaces?.find((route) =>
    !surfaceId || String(route.id) === String(surfaceId)
  )?.componentId;
  scheduleLiveTransition(state.ui.live, {
    id: uid("live-transition"),
    fromSceneId: String(state.ui.live.selectedSceneId || ""),
    fromTargetId: previousTargetId,
    toTargetId: String(
      surfaceId
        ? currentRouteTargetId || ""
        : state.ui.live.selectedComponentId || state.ui.live.selectedSceneId || "",
    ),
    surfaceId: String(surfaceId || ""),
    toSurfaceRoutes: currentRoutes,
    transitionId: String(state.ui.live.transitionId || "vj1.transition.dissolve"),
    transitionParameters: clone(state.ui.live.transitionParameters || {}),
    durationMs,
  });
}

function copyPathWithValue(target, path, value, { createMissing = false } = {}) {
  const parts = String(path || "").split(".").filter(Boolean).map((part) =>
    /^\d+$/.test(part) ? Number(part) : part
  );
  if (!parts.length || parts.some((part) =>
    ["__proto__", "prototype", "constructor"].includes(String(part))
  )) return null;
  const copy = Array.isArray(target) ? target.slice() : { ...target };
  let sourceCursor = target;
  let copyCursor = copy;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    let sourceChild = sourceCursor?.[part];
    if ((!sourceChild || typeof sourceChild !== "object") && createMissing) {
      sourceChild = typeof parts[index + 1] === "number" ? [] : {};
    }
    if (!sourceChild || typeof sourceChild !== "object") return null;
    const copyChild = Array.isArray(sourceChild) ? sourceChild.slice() : { ...sourceChild };
    copyCursor[part] = copyChild;
    sourceCursor = sourceChild;
    copyCursor = copyChild;
  }
  const leaf = parts.at(-1);
  if (!sourceCursor || typeof sourceCursor !== "object") return null;
  if (!createMissing && !(leaf in sourceCursor)) return null;
  copyCursor[leaf] = value;
  return copy;
}

function normalizeComponentControlEntry(state, entry = {}) {
  const path = String(entry?.path || "");
  const componentMatch = /^components\.(\d+)\.(.+)$/.exec(path);
  if (componentMatch) return {
    componentIndex: Number(componentMatch[1]),
    componentId: String(state.components?.[Number(componentMatch[1])]?.id || ""),
    nodeId: "",
    graphPath: "",
    relativePath: componentMatch[2],
    value: entry.value,
  };
  const parts = path.split(".").filter(Boolean);
  if (parts[0] !== "nodes" || parts[1] !== "groups" || !/^\d+$/.test(parts[2] || "")) return null;
  const configurationIndex = parts.lastIndexOf("configuration");
  if (configurationIndex < 5 || !parts.slice(configurationIndex + 1).length) return null;
  const group = state.nodes?.groups?.[Number(parts[2])];
  if (group?.generatedBy !== "vj1-component-compiler") return null;
  let cursor = state;
  let node = null;
  for (let index = 0; index < configurationIndex; index++) {
    const part = /^\d+$/.test(parts[index]) ? Number(parts[index]) : parts[index];
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) return null;
    cursor = cursor[part];
    if (index > 0 && parts[index - 1] === "nodes" && typeof part === "number") node = cursor;
  }
  const componentIndex = state.components?.findIndex((component) =>
    String(component.id || "") === String(group.componentId || "")
  ) ?? -1;
  if (componentIndex < 0 || !node?.id) return null;
  return {
    componentIndex,
    componentId: String(group.componentId || ""),
    nodeId: String(node.id),
    graphPath: path,
    relativePath: parts.slice(configurationIndex + 1).join("."),
    value: entry.value,
  };
}

function reconcileLiveParameterDiffsWithPersistentEdits(previous, next) {
  const previousComponents = new Map((previous?.components || []).map((component) => [String(component.id), component]));
  const nextComponents = new Map((next?.components || []).map((component) => [String(component.id), component]));
  const rebaseBank = (bank = {}) => Object.fromEntries(Object.entries(bank || {}).flatMap(([componentId, override]) => {
    const rebased = rebaseLiveOverride(
      override,
      previousComponents.get(String(componentId)),
      nextComponents.get(String(componentId))
    );
    return hasLiveOverrideContent(rebased) ? [[componentId, rebased]] : [];
  }));

  next.ui.live.parameterDiffs = Object.fromEntries(Object.entries(next.ui.live.parameterDiffs || {}).map(([targetId, bank]) => [
    targetId,
    rebaseBank(bank),
  ]));
}

function synchronizeActiveLiveDiffsForProjectChange(state, event = {}) {
  const paths = new Set(event.changedPaths || []);
  if (/^components\.\d+\./.test(String(event.command?.topic || ""))) {
    paths.add(String(event.command.topic));
  }
  const targetId = activeLiveTargetId(state.ui?.live);
  if (!targetId) return;
  for (const path of paths) {
    const graphEntry = normalizeComponentControlEntry(state, { path });
    if (graphEntry?.nodeId && graphEntry.graphPath) {
      const graphNode = componentGraphNode(state, graphEntry.componentId, graphEntry.nodeId);
      const current = valueAtRelativePath(graphNode?.configuration, graphEntry.relativePath);
      if (!current.found) continue;
      updateLiveNodeParameterDiffIfPresent(
        state,
        graphEntry.componentId,
        graphEntry.nodeId,
        graphEntry.relativePath,
        clone(current.value),
        targetId,
      );
      continue;
    }
    const match = /^components\.(\d+)\.(.+)$/.exec(String(path || ""));
    if (!match) continue;
    const component = state.components?.[Number(match[1])];
    if (!component?.id) continue;
    const value = valueAtRelativePath(component, match[2]);
    if (!value.found) continue;
    updateLiveParameterDiffIfPresent(
      state,
      component.id,
      match[2],
      clone(value.value),
      targetId,
    );
  }
}

function valueAtRelativePath(target, path) {
  const parts = String(path || "").split(".").filter(Boolean).map((part) =>
    /^\d+$/.test(part) ? Number(part) : part
  );
  let cursor = target;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[part];
  }
  return { found: parts.length > 0, value: cursor };
}

// Live is an explicit performance layer. Authored edits may change the value
// underneath it, but must not silently disarm an active controller/UI override;
// only Reset does that. Structural edits still rebase chain overrides by the
// stable item identity so an old value can never land on a different element.
function rebaseLiveOverride(override, before, after, path = "") {
  if (Array.isArray(override)) {
    if (path !== "chain") {
      return before !== undefined && after === undefined
        ? undefined
        : clone(override);
    }
    const nextChain = Array.isArray(after) ? after : [];
    const result = [];
    override.forEach((entry, index) => {
      if (!hasLiveOverrideContent(entry)) return;
      const previousItem = before?.[index];
      const itemId = String(previousItem?.id || "");
      const nextIndex = itemId
        ? nextChain.findIndex((item) => String(item?.id || "") === itemId)
        : index < nextChain.length ? index : -1;
      if (nextIndex < 0) return;
      const rebased = rebaseLiveOverride(
        entry,
        previousItem,
        nextChain[nextIndex],
        "",
      );
      if (hasLiveOverrideContent(rebased)) result[nextIndex] = rebased;
    });
    return result.some(hasLiveOverrideContent) ? result : undefined;
  }
  if (override && typeof override === "object") {
    // Animation overrides address stable track and target-node IDs rather than
    // Component object paths. Track removal explicitly clears these entries.
    if (path === "animation") return clone(override);
    const result = {};
    for (const [key, value] of Object.entries(override)) {
      const rebased = rebaseLiveOverride(value, before?.[key], after?.[key], key);
      if (hasLiveOverrideContent(rebased)) result[key] = rebased;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return before !== undefined && after === undefined ? undefined : override;
}

function hasLiveOverrideContent(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasLiveOverrideContent);
  if (value && typeof value === "object") return Object.values(value).some(hasLiveOverrideContent);
  return true;
}
