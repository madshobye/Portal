import { sceneSourceNodes } from "../domain/models.js";
import { runtimeVisualSourceComponents } from "../domain/runtime-visual-sources.js";
import { compileComponentRenderPrograms } from "../libraries/composition-engine/index.js";

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
  }

  dispose() {
    disposePrograms(this.programs);
    this.programs = new Map();
    this.clearPrepared();
    this.componentById.clear();
    this.routeSourceNodeById.clear();
  }

  rebuild(state = this.getState?.()) {
    disposePrograms(this.programs);
    this.runtimeComponents = runtimeVisualSourceComponents();
    this.programs = this.compile(state, this.runtimeComponents);
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

  syncConfiguration(componentId, state = this.getState?.()) {
    const id = String(componentId || "");
    const component = (state?.components || []).find(
      (candidate) => String(candidate?.id || "") === id,
    );
    const program = this.programs.get(id);
    if (!component || !program) return false;
    return program.syncProjectedConfiguration(component);
  }

  syncConfigurationItems(componentId, itemIds = [], state = this.getState?.()) {
    const id = String(componentId || "");
    const component = (state?.components || []).find(
      (candidate) => String(candidate?.id || "") === id,
    );
    const program = this.programs.get(id);
    if (!component || !program) {
      return Object.freeze({
        applied: false,
        componentId: id,
        changedIds: Object.freeze([]),
        missingIds: Object.freeze(Array.from(itemIds || [], String)),
      });
    }
    return Object.freeze({
      componentId: id,
      ...program.syncProjectedItems(component, itemIds),
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

  clearPrepared() {
    if (!this.prepared) return;
    disposePrograms(this.prepared.programs);
    this.prepared = null;
  }
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
  const collectSurfaces = (surfaces = [], { includeDisabled = false } = {}) => {
    for (const surface of surfaces || []) {
      if (!includeDisabled && surface?.enabled === false) continue;
      const componentId = String(surface?.componentId || "");
      if (availableIds.has(componentId)) roots.add(componentId);
    }
  };
  collectSurfaces(state.surfaces);
  collectSurfaces(state.liveTransition?.fromState?.surfaces, {
    includeDisabled: true,
  });
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
