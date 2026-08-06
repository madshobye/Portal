import { sceneSourceNodes } from "../domain/models.js";
import { runtimeVisualSourceComponents } from "../domain/runtime-visual-sources.js";
import { compileComponentRenderPrograms } from "../libraries/composition-engine/index.js";
import { runtimeRoiContract } from "../libraries/visual-nodes/shared/component-schema.js";

// Owns the compiled Component program set and the lookup indexes derived from
// it. Rendering reads these retained structures directly; compilation,
// validation, and disposal stay outside the frame loop.
export class ComponentProgramRuntime {
  constructor({
    mode = "output",
    getMode = null,
    getState,
    getVisualNodes,
    getCoreDefinition,
    getSourceRuntime,
    onCompile = null,
  }) {
    this.getMode = typeof getMode === "function" ? getMode : () => mode;
    this.getState = getState;
    this.getVisualNodes = getVisualNodes;
    this.getCoreDefinition = getCoreDefinition;
    this.getSourceRuntime = getSourceRuntime;
    this.onCompile = onCompile;
    this.programs = new Map();
    this.prepared = null;
    this.runtimeComponents = runtimeVisualSourceComponents();
    this.componentById = new Map();
    this.routeSourceNodeById = new Map();
    this.controlSignalKinds = new Set();
    this.controlSignalAddresses = new Set();
  }

  dispose() {
    disposePrograms(this.programs);
    this.programs = new Map();
    this.clearPrepared();
    this.componentById.clear();
    this.routeSourceNodeById.clear();
    this.controlSignalKinds.clear();
    this.controlSignalAddresses.clear();
  }

  rebuild(state = this.getState?.()) {
    disposePrograms(this.programs);
    this.runtimeComponents = runtimeVisualSourceComponents();
    this.programs = this.compile(state, this.runtimeComponents);
    this.indexControlSignalRequirements();
    this.onCompile?.(1, "component-program-rebuild");
    this.validate(this.programs);
    return this.programs;
  }

  ensureStateRoots(state = this.getState?.()) {
    const components = [...(state?.components || []), ...(this.runtimeComponents || [])];
    const roots = renderStateComponentProgramRoots(state, this.getMode(), components);
    if (!this.dependencyClosureIsIncomplete(roots)) return false;
    const additions = this.compile(state, this.runtimeComponents);
    this.validate(additions);
    for (const [componentId, program] of additions) {
      if (this.programs.has(componentId)) {
        program.dispose?.();
        continue;
      }
      this.programs.set(componentId, program);
    }
    this.indexControlSignalRequirements();
    this.onCompile?.(1, "component-root-materialization");
    return true;
  }

  compile(state = this.getState?.(), runtimeComponents = runtimeVisualSourceComponents()) {
    const components = [...(state?.components || []), ...runtimeComponents];
    return compileComponentRenderPrograms(
      components,
      state?.nodes?.groups || [],
      {
        rootComponentIds: renderStateComponentProgramRoots(
          state,
          this.getMode(),
          components,
        ),
        resolveNodeDefinition: (node) =>
          this.getVisualNodes?.()?.definition(node?.nodeId) ||
          this.getCoreDefinition?.(String(node?.nodeId || "")),
      },
    );
  }

  validate(programs = this.programs) {
    const sourceRuntime = this.getSourceRuntime?.();
    for (const program of programs.values()) {
      program.forEachOperation((operation) => {
        if (operation?.backend !== "native-specialized") return;
        const rendererId = String(
          operation.renderer || operation.compilerHook?.renderer || "",
        );
        if (!rendererId || sourceRuntime?.hasNativeRenderer(rendererId)) return;
        sourceRuntime?.reportMissingNativeRenderer(
          rendererId,
          operation.configuration?.source?.generatorId,
          operation,
        );
      });
    }
  }

  dependencyClosureIsIncomplete(componentIds = []) {
    for (const componentId of componentIds || []) {
      const program = this.programs.get(String(componentId || ""));
      if (!program) return true;
      const dependencies = program.inspect()?.dependencies || {};
      for (const dependencyId of dependencies.componentPrograms || dependencies.components || []) {
        if (!this.programs.has(String(dependencyId || ""))) return true;
      }
    }
    return false;
  }

  requiresControlSignal(kind, address = "") {
    const signalKind = String(kind || "");
    if (!signalKind) return false;
    const signalAddress = String(address || "");
    return signalAddress
      ? this.controlSignalAddresses.has(`${signalKind}:${signalAddress}`)
      : this.controlSignalKinds.has(signalKind);
  }

  indexControlSignalRequirements() {
    this.controlSignalKinds.clear();
    this.controlSignalAddresses.clear();
    for (const program of this.programs.values()) {
      for (const requirement of program.inspect?.()?.readiness?.requirements || []) {
        if (requirement?.kind !== "control-signal") continue;
        const kind = String(requirement.signalKind || "");
        const address = String(requirement.address || "");
        if (!kind) continue;
        this.controlSignalKinds.add(kind);
        if (address) this.controlSignalAddresses.add(`${kind}:${address}`);
      }
    }
  }

  syncGraphNodes(componentId, nodeIds = [], state = this.getState?.()) {
    const id = String(componentId || "");
    const group = state?.nodes?.groups?.find((candidate) =>
      candidate.generatedBy === "vj1-component-compiler" &&
      String(candidate.componentId || "") === id
    );
    const program = this.programs.get(id);
    if (!group || !program) return Object.freeze({
      applied: false,
      componentId: id,
      changedIds: Object.freeze([]),
      missingIds: Object.freeze(Array.from(nodeIds || [], String)),
    });
    return Object.freeze({
      componentId: id,
      ...program.syncGraphNodes(group, nodeIds),
    });
  }

  rebuildLookups(state = this.getState?.()) {
    const components = [
      ...(state?.components || []),
      ...(this.runtimeComponents || []),
    ];
    const sourceNodes = sceneSourceNodes(state || {}, { includeSystem: true });
    this.componentById = new Map(
      components.map((component) => [component.id, component]),
    );
    this.routeSourceNodeById = new Map(
      sourceNodes.map((node) => [node.id, node]),
    );
  }

  refreshLookup(componentId, state = this.getState?.()) {
    const component = state?.components?.find((item) => item.id === componentId);
    if (component) {
      this.componentById.set(componentId, component);
      return;
    }
    const runtimeComponent = this.runtimeComponents?.find(
      (item) => item.id === componentId,
    );
    if (runtimeComponent) this.componentById.set(componentId, runtimeComponent);
    else this.componentById.delete(componentId);
  }

  componentForId(componentId, state = this.getState?.()) {
    const id = String(componentId || "");
    if (!id) return null;
    return this.componentById.get(id) ||
      state?.components?.find((component) => String(component?.id || "") === id) ||
      this.runtimeComponents?.find((component) => String(component?.id || "") === id) ||
      null;
  }

  createExecutionContext(state = this.getState?.()) {
    const runtimeComponents = this.runtimeComponents?.length
      ? this.runtimeComponents
      : runtimeVisualSourceComponents();
    const programs = this.compile(state, runtimeComponents);
    this.validate(programs);
    const components = [...(state?.components || []), ...runtimeComponents];
    const sourceNodes = sceneSourceNodes(state || {}, { includeSystem: true });
    return Object.freeze({
      state,
      programs,
      componentById: new Map(
        components.map((component) => [component.id, component]),
      ),
      routeSourceNodeById: new Map(
        sourceNodes.map((node) => [node.id, node]),
      ),
    });
  }

  // Transfers the currently executing program set to another runtime owner.
  // The caller must eventually pass the returned context to
  // disposeExecutionContext(). No program is cloned or recompiled here: this
  // is the exact branch that produced the previously presented frame.
  retainExecutionContext(state = this.getState?.()) {
    const context = Object.freeze({
      state,
      programs: this.programs,
      componentById: this.componentById,
      routeSourceNodeById: this.routeSourceNodeById,
    });
    this.programs = new Map();
    this.componentById = new Map();
    this.routeSourceNodeById = new Map();
    this.controlSignalKinds.clear();
    this.controlSignalAddresses.clear();
    return context;
  }

  disposeExecutionContext(context = null) {
    disposePrograms(context?.programs);
  }

  componentRegionSafe(componentOrId, programs = this.programs, visiting = new Set()) {
    const component = componentOrId && typeof componentOrId === "object"
      ? componentOrId
      : this.componentForId(componentOrId);
    const id = String(component?.id || componentOrId || "");
    const program = programs?.get?.(id);
    if (!id || visiting.has(id) || !program) return false;
    const regionSafe = program.isRegionSafe?.(component, {
      resolveRoi: (operation, configuration) => {
        const runtimePolicy = operation?.runtimePolicy || {};
        // Static runtime ROI has already been normalized into the compiled
        // operation contract. Only a parameter-dependent policy may override
        // that authoritative contract here.
        if (typeof runtimePolicy.roiForParams !== "function") return null;
        const params =
          configuration?.source?.params ||
          configuration?.params ||
          {};
        return runtimeRoiContract(runtimePolicy, params, {
          component,
          operation,
        });
      },
    });
    if (!regionSafe) return false;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(id);
    const dependencies = program.inspect?.()?.dependencies?.components || [];
    return dependencies.every((dependencyId) =>
      this.componentRegionSafe(dependencyId, programs, nextVisiting));
  }

  resolveRouteSourceNode(surface = {}) {
    return this.routeSourceNodeById.get(surface.sourceNodeId) || null;
  }

  prepare(state) {
    if (this.prepared?.state === state) return this.prepared.programs;
    this.clearPrepared();
    const runtimeComponents = runtimeVisualSourceComponents();
    const programs = this.compile(state, runtimeComponents);
    this.validate(programs);
    this.prepared = { state, programs };
    return programs;
  }

  adoptPrepared(state) {
    const prepared = this.prepared;
    if (!prepared || !preparedProgramStateCompatible(prepared.state, state)) return false;
    disposePrograms(this.programs);
    this.programs = prepared.programs;
    this.prepared = null;
    this.runtimeComponents = runtimeVisualSourceComponents();
    this.indexControlSignalRequirements();
    this.rebuildLookups(state);
    this.onCompile?.(1, "component-program-arm");
    return true;
  }

  clearPrepared() {
    if (!this.prepared) return;
    disposePrograms(this.prepared.programs);
    this.prepared = null;
  }
}

function preparedProgramStateCompatible(preparedState, activeState) {
  if (!preparedState || !activeState) return false;
  // Output/Preview add host viewport hints when activating a prepared Live
  // state. Those hints do not alter graph compilation; the authored graph and
  // Component collections remain the same structural objects.
  return preparedState.components === activeState.components
    && preparedState.nodes === activeState.nodes;
}

export function renderStateComponentProgramRoots(
  state = {},
  mode = "output",
  components = state.components || [],
) {
  const roots = new Set();
  const availableIds = new Set(
    (components || [])
      .map((component) => String(component?.id || ""))
      .filter(Boolean),
  );
  if (mode === "component") {
    const requestedId = String(state.ui?.selectedComponentId || "");
    if (availableIds.has(requestedId)) roots.add(requestedId);
    else for (const componentId of availableIds) roots.add(componentId);
    return roots;
  }
  const collectSurfaces = (surfaces = []) => {
    for (const surface of surfaces || []) {
      if (surface?.enabled === false) continue;
      const componentId = String(surface?.componentId || "");
      if (availableIds.has(componentId)) roots.add(componentId);
    }
  };
  collectSurfaces(state.surfaces);
  if (!roots.size) {
    for (const component of components || []) {
      const componentId = String(component?.id || "");
      if (componentId) roots.add(componentId);
    }
  }
  return roots;
}

function disposePrograms(programs) {
  for (const program of programs?.values?.() || []) program.dispose?.();
}
