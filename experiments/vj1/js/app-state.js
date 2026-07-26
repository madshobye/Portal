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
} from "./domain/models.js?v=signal-load-observability-1";
import { compileLiveProjectionProgram } from "./domain/live-projection-program.js?v=live-output-matrix-contract-3";
import { firstEnabledLiveSurfaceId, liveSurfaceVisible } from "./domain/live-ui-state.js?v=live-output-matrix-contract-3";
import { stampChangedProjectItems, touchComponentUsed } from "./domain/component-activity.js?v=adaptive-component-demand-29";
import { componentFrameMetrics } from "./domain/component-frame.js?v=adaptive-component-demand-29";
import { WORKSPACES } from "./constants.js";
import { createChangeEvent } from "./libraries/state-engine/state-command/index.js?v=structural-world-state-2";
import { sceneLogicalSize } from "./domain/render-settings.js?v=surface-terminology-1";
import { nextCatalogMarker } from "./domain/catalog-marker.js?v=catalog-marker-four-state-1";
import { clearComponentReferences, countChainGroups, findChainItemLocation, insertChainItemNearSelection, moveById, moveChainItem } from "./domain/chain-operations.js?v=adaptive-component-demand-29";
import { copyComponentAsScene, pasteClipboardPayload } from "./domain/clipboard.js?v=canvas-global-resolution-1";
import { initializeLiveChainInsertion } from "./domain/scene-routing.js?v=live-output-matrix-contract-3";
import {
  materializeStructuralTree,
  ObservableDataStore,
  produceStructuralShare,
} from "./libraries/data-store/data-store/index.js?v=structural-world-state-2";
import { signalLoadMeter } from "./metrics/signal-load-meter.js";

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
    if ((event.scope === "project" || event.scope === "live") && event.phase === "commit") {
      authoredSignalMeter.record("transactions", 1, event.reason);
    } else if (event.scope === "assets") {
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
    state = event.projectRestore ? normalized : stampChangedProjectItems(previous, normalized);
    if (event.scope !== "live") reconcileLiveOverridesWithPersistentEdits(previous, state);
    emit(event);
  }

  function update(recipe, change = "update") {
    const event = classifyChange(change);
    const transactionBaseline = pendingEditBaseline || state;
    const next = produceStructuralShare(state, recipe);
    if (next === state && !pendingEditBaseline) return false;
    if (event.scope === "project" && (event.phase === "scrub" || event.phase === "edit")) {
      // A gesture is one transaction. Preserve the immutable pre-gesture root
      // while each sample path-copies only the branch it changes.
      pendingEditBaseline ||= state;
      state = projectMappingProjectionForChangedSelection(state, next);
      emit(event);
      return true;
    }
    pendingEditBaseline = null;
    let committed = projectMappingProjectionForChangedSelection(state, next);
    if (event.scope === "project") {
      committed = stampChangedOwners(transactionBaseline, committed);
      committed = produceStructuralShare(committed, (draft) => {
        reconcileLiveOverridesWithPersistentEdits(transactionBaseline, draft);
      });
      if (typeof prepareChange === "function") {
        committed = prepareChange(transactionBaseline, committed, event);
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
      scope: "ui",
    });
  }

  function updateRuntime(recipe, change = "runtime-update") {
    const metrics = clone(state.metrics);
    recipe(metrics);
    state = { ...state, metrics };
    emit({ reason: change, scope: "runtime" });
  }

  function updateDerived(recipe, change = "derived-update") {
    state = produceStructuralShare(state, recipe);
    const supplied = change && typeof change === "object" ? change : { reason: change };
    emit({
      ...supplied,
      reason: String(supplied.reason || "derived-update"),
      scope: "derived",
      history: "none",
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
      scope: "derived",
      history: "none",
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
    emit({ ...supplied, scope: "live" });
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
        scope: "project",
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
      updateUi((ui) => {
        ui.selectedSurfaceId = id;
        if (ui.workspace === "scene") ui.sceneInspectorTarget = "surface";
      }, {
        reason: "select-surface",
        changedPaths: ["ui.selectedSurfaceId"],
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
      const next = {
        ...state,
        mappings,
        ui: {
          ...state.ui,
          selectedSurfaceId: String(surfaceId),
        },
      };
      if (String(state.ui?.selectedMappingId || "") === String(nextMapping.id)) {
        projectSelectedMapping(next, nextMapping);
      }
      state = typeof prepareChange === "function"
        ? prepareChange(previous, next, classifyChange({
          reason: reason || `toggle:mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`,
          scope: "project",
        }))
        : next;
      pendingEditBaseline = null;
      const changeReason = reason ||
        `toggle:mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`;
      emit({
        reason: changeReason,
        scope: "project",
        changedPaths: [`mappings.${mappingIndex}.surfaces.${surfaceIndex}.enabled`],
        renderPatches: [{
          target: "state",
          path: "surfaces",
          value: mappingPreviewSurfaceRoutes(next, nextMapping),
        }],
      });
      return true;
    },
    setComponentValues(entries = [], {
      reason = "",
      selectAction = "",
      selectId = "",
    } = {}) {
      const normalizedEntries = entries.map((entry) => {
        const match = /^components\.(\d+)\.(.+)$/.exec(String(entry?.path || ""));
        return match ? {
          componentIndex: Number(match[1]),
          relativePath: match[2],
          value: entry.value,
        } : null;
      });
      const componentIndex = normalizedEntries[0]?.componentIndex;
      const previousComponent = state.components?.[componentIndex];
      if (
        !normalizedEntries.length ||
        normalizedEntries.some((entry) => !entry || entry.componentIndex !== componentIndex) ||
        !previousComponent
      ) return false;
      let nextComponent = previousComponent;
      for (const entry of normalizedEntries) {
        nextComponent = copyPathWithValue(
          nextComponent,
          entry.relativePath,
          entry.value,
          { createMissing: true },
        );
        if (!nextComponent) return false;
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
        ui.selectedChainItemId = String(selectId);
        if (ui.workspace === "scene") ui.sceneInspectorTarget = "element";
      } else if (selectAction === "data-select-component" && selectId) {
        ui.selectedComponentId = String(selectId);
      }
      const previous = state;
      const next = { ...state, components, ui };
      state = typeof prepareChange === "function"
        ? prepareChange(previous, next, classifyChange({
          reason: reason || `update:components.${componentIndex}.${normalizedEntries[0].relativePath}`,
          scope: "project",
        }))
        : next;
      reconcileLiveOverridesWithPersistentEdits(previous, state);
      pendingEditBaseline = null;
      emit({
        reason: reason || `update:components.${componentIndex}.${normalizedEntries[0].relativePath}`,
        scope: "project",
        changedPaths: normalizedEntries.map((entry) =>
          `components.${componentIndex}.${entry.relativePath}`
        ),
        renderPatches: normalizedEntries.filter((entry) =>
          !["activity", "thumbnail", "name", "catalogMarker"].includes(
            String(entry.relativePath).split(".")[0]
          )
        ).map((entry) => ({
          componentId: String(previousComponent.id),
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
      ui.selectedChainItemId = component.chain?.[0]?.id || "";
      if (ui.workspace === "scene") ui.sceneInspectorTarget = "element";
      rememberWorkspaceComponent({ ui }, ui.workspace, component);
      state = { ...state, components, ui };
      // Selection is local to the editor. It is still autosaved so recent-use
      // sorting survives reload, but it must not rebuild a Live render state.
      emit({
        reason: "select-component",
        scope: "ui",
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
      emit({ reason: "workspace", scope: "ui", history: "none" });
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
        draft.ui.selectedChainItemId = component.chain[0]?.id || "";
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
        draft.ui.selectedChainItemId = component.chain[0]?.id || "";
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
      if (!findChainItemLocation(selected?.chain, id)) return;
      updateUi((ui) => {
        ui.selectedChainItemId = id;
        if (ui.workspace === "scene") ui.sceneInspectorTarget = "element";
      }, {
        reason: "select-chain-item",
        changedPaths: ["ui.selectedChainItemId"],
      });
    },
    removeChainItem(componentId, itemId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component?.chain) return;
        const removed = removeChainItemFromChain(component.chain, itemId);
        if (removed && draft.ui.selectedChainItemId === itemId) {
          draft.ui.selectedChainItemId = firstChainItemId(component.chain);
        }
      }, "remove-chain-item");
    },
    addChainSource(componentId, source = { type: "generator", generatorId: "testPattern" }) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        if (source.type === "component" && component.type !== "scene") return;
        const layer = createComponentLayer(component.chain?.length || 0, source);
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
        component.chain ||= [];
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, layer);
        draft.ui.selectedChainItemId = layer.id;
      }, "add-chain-source");
    },
    addChainEffect(componentId, effectId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        const effect = createComponentEffect(effectId);
        initializeLiveChainInsertion(draft, component.id, effect);
        component.chain ||= [];
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, effect);
        draft.ui.selectedChainItemId = effect.id;
      }, "add-chain-effect");
    },
    addChainGroup(componentId) {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        if (!component) return;
        component.chain ||= [];
        const group = createComponentGroup(countChainGroups(component.chain));
        initializeLiveChainInsertion(draft, component.id, group);
        insertChainItemNearSelection(component.chain, draft.ui.selectedChainItemId, group);
        draft.ui.selectedChainItemId = group.id;
      }, "add-chain-group");
    },
    reorderChain(componentId, fromId, toId, position = "before") {
      update((draft) => {
        const component = draft.components.find((item) => item.id === componentId);
        const chain = component?.chain;
        if (!Array.isArray(chain)) return;
        moveChainItem(chain, fromId, toId, position);
      }, "reorder-chain");
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
        for (const component of draft.components) clearComponentReferences(component.chain, id);
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
        draft.ui.selectedSurfaceId = surface.id;
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
        draft.ui.selectedSurfaceId = mapping.surfaces[0]?.id || "";
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
      emit({ reason: "select-mapping", scope: "ui", history: "none" });
    },
    selectLiveScene(id) {
      updateLive((draft) => {
        const scene = draft.components.find((item) => item.type === "scene" && String(item.id) === String(id));
        if (!scene) return;
        const mapping = draft.mappings.find((item) => String(item.id) === String(draft.ui.selectedMappingId || "")) || draft.mappings[0];
        if (patchSelectedLiveSurface(draft, scene, mapping)) return;
        draft.ui.live.overallSourceCleared = false;
        draft.ui.live.sceneOverrides ||= {};
        const previousSceneId = String(draft.ui.live.selectedSceneId || "");
        const previousTarget = draft.components.find((item) =>
          !item.systemRole && String(item.id) === String(draft.ui.live.selectedComponentId || "")
        ) || draft.components.find((item) => item.type === "scene" && String(item.id) === previousSceneId);
        if (previousSceneId === String(scene.id)
          && String(previousTarget?.id || "") === String(scene.id)) return;
        const previousRoutes = compileLiveProjectionProgram(draft).currentRoutes;
        if (previousTarget?.id && Object.keys(draft.ui.live.componentOverrides || {}).length) {
          draft.ui.live.sceneOverrides[previousTarget.id] = clone(draft.ui.live.componentOverrides);
        }
        scheduleLiveRouteTransition(draft, previousRoutes);
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.selectedComponentId = scene.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
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
        const previousRoutes = compileLiveProjectionProgram(draft).currentRoutes;
        draft.ui.live.sceneOverrides ||= {};
        if (previousTarget?.id && Object.keys(draft.ui.live.componentOverrides || {}).length) {
          draft.ui.live.sceneOverrides[previousTarget.id] = clone(draft.ui.live.componentOverrides);
        }
        scheduleLiveRouteTransition(draft, previousRoutes);
        draft.ui.live.selectedComponentId = target.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[target.id] || {});
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
        draft.ui.live.transition = null;
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
        const previousRoutes = clone(compileLiveProjectionProgram(draft).currentRoutes);
        draft.ui.live.surfacePatches ||= {};
        delete draft.ui.live.surfacePatches[surfaceId];
        draft.ui.live.patchSourceId = "";
        scheduleLiveRouteTransition(draft, previousRoutes, clearedPatchTargetId, surfaceId);
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
        const previousRoutes = clone(compileLiveProjectionProgram(draft).currentRoutes);
        scheduleLiveRouteTransition(draft, previousRoutes);
        draft.ui.live.overallSourceCleared = true;
        draft.ui.live.selectedSceneId = "";
        draft.ui.live.selectedComponentId = "";
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.patchSourceId = "";
        draft.ui.live.componentOverrides = {};
      }, "live:overall-component-clear");
      return true;
    },
    restoreLiveScene(id) {
      updateLive((draft) => {
        const scene = draft.components.find((item) => item.type === "scene" && String(item.id) === String(id));
        if (!scene) return;
        draft.ui.live.sceneOverrides ||= {};
        draft.ui.live.overallSourceCleared = false;
        draft.ui.live.selectedSceneId = scene.id;
        draft.ui.live.inspectedComponentId = "";
        draft.ui.live.surfacePatches = {};
        draft.ui.live.patchSourceId = "";
        draft.ui.live.componentOverrides = clone(draft.ui.live.sceneOverrides[scene.id] || {});
        draft.ui.live.transition = null;
        draft.ui.live.selectedComponentId = scene.id;
      }, { reason: "live:scene-restore", history: "none" });
    },
    resetLiveScene(id) {
      updateLive((draft) => {
        const sceneId = String(id || draft.ui.live?.selectedSceneId || "");
        if (!sceneId) return;
        draft.ui.live.sceneOverrides ||= {};
        delete draft.ui.live.sceneOverrides[sceneId];
        if (String(draft.ui.live.selectedComponentId || "") === sceneId) {
          draft.ui.live.componentOverrides = {};
        }
      }, "live:reset");
    },
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
  draft.ui.selectedChainItemId = component.chain?.[0]?.id || "";
  if (workspace === "scene") draft.ui.sceneInspectorTarget = "element";
}

function firstChainItemId(chain = []) {
  if (!Array.isArray(chain) || !chain.length) return "";
  return chain[0]?.id || "";
}

function removeChainItemFromChain(chain = [], itemId = "") {
  if (!Array.isArray(chain) || !itemId) return false;
  const index = chain.findIndex((item) => item.id === itemId);
  if (index >= 0) {
    chain.splice(index, 1);
    return true;
  }
  for (const item of chain) {
    if (item.kind === "group" && removeChainItemFromChain(item.chain || [], itemId)) return true;
  }
  return false;
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
  const previousRoutes = clone(compileLiveProjectionProgram(state).currentRoutes);
  state.ui.live.surfacePatches ||= {};
  state.ui.live.surfacePatches[surfaceId] = target.id;
  state.ui.live.patchSourceId = target.id;
  state.ui.live.inspectedComponentId = "";
  scheduleLiveRouteTransition(state, previousRoutes, target.id, surfaceId);
  return true;
}

function scheduleLiveRouteTransition(state, previousRoutes, routeTargetId = "", surfaceId = "") {
  const durationMs = Math.round(Math.max(0, Number(state.ui.live.transitionDuration) || 0) * 1000);
  const previousTargetId = String(routeTargetId || state.ui.live.selectedComponentId || state.ui.live.selectedSceneId || "");
  state.ui.live.transition = durationMs > 0 && previousRoutes?.surfaces?.length
    ? {
        id: uid("live-transition"),
        fromSceneId: String(state.ui.live.selectedSceneId || ""),
        fromTargetId: previousTargetId,
        surfaceId: String(surfaceId || ""),
        fromSurfaceRoutes: clone(previousRoutes),
        fromComponentOverrides: clone(state.ui.live.componentOverrides || {}),
        startedAtMs: Date.now() + 50,
        durationMs,
      }
    : null;
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

function reconcileLiveOverridesWithPersistentEdits(previous, next) {
  const previousComponents = new Map((previous?.components || []).map((component) => [String(component.id), component]));
  const nextComponents = new Map((next?.components || []).map((component) => [String(component.id), component]));
  const rebaseBank = (bank = {}) => Object.fromEntries(Object.entries(bank || {}).flatMap(([componentId, override]) => {
    const rebased = pruneChangedLiveOverride(
      override,
      previousComponents.get(String(componentId)),
      nextComponents.get(String(componentId))
    );
    return hasLiveOverrideContent(rebased) ? [[componentId, rebased]] : [];
  }));

  next.ui.live.componentOverrides = rebaseBank(next.ui.live.componentOverrides);
  next.ui.live.sceneOverrides = Object.fromEntries(Object.entries(next.ui.live.sceneOverrides || {}).map(([sceneId, bank]) => [
    sceneId,
    rebaseBank(bank),
  ]));
  const selectedTargetId = String(next.ui.live.selectedComponentId || next.ui.live.selectedSceneId || "");
  if (selectedTargetId) {
    if (Object.keys(next.ui.live.componentOverrides).length) {
      next.ui.live.sceneOverrides[selectedTargetId] = clone(next.ui.live.componentOverrides);
    } else {
      delete next.ui.live.sceneOverrides[selectedTargetId];
    }
  }
}

function pruneChangedLiveOverride(override, before, after, path = "") {
  if (Array.isArray(override)) {
    if (path !== "chain") {
      return persistentValuesEqual(before, after) ? clone(override) : undefined;
    }
    const result = override.map((entry, index) => (
      pruneChangedLiveOverride(entry, before?.[index], after?.[index], "")
    ));
    return result.some(hasLiveOverrideContent) ? result : undefined;
  }
  if (override && typeof override === "object") {
    const result = {};
    for (const [key, value] of Object.entries(override)) {
      const rebased = pruneChangedLiveOverride(value, before?.[key], after?.[key], key);
      if (hasLiveOverrideContent(rebased)) result[key] = rebased;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return persistentValuesEqual(before, after) ? override : undefined;
}

function hasLiveOverrideContent(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasLiveOverrideContent);
  if (value && typeof value === "object") return Object.values(value).some(hasLiveOverrideContent);
  return true;
}

function persistentValuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => persistentValuesEqual(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(b, key) && persistentValuesEqual(a[key], b[key])
    ));
  }
  return false;
}
