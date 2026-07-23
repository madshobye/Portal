import { materializeProjectNodeFork } from "../node-engine/node-editor.js";
import { resolveProjectNodePackages } from "../node-engine/node-package.js?v=project-group-authoring-compiler-transport-1";
import {
  componentFromNodeDefinition,
  listEffectNodeComponents,
  listGeneratorNodeComponents,
} from "./catalog.js?v=procedural-2d-1";
import {
  isIsfNodeDefinition,
  listProjectIsfVisualComponents,
  materializeIsfNodeDefinition,
  materializeIsfTransitionDefinition,
} from "../isf-engine/index.js?v=named-image-inputs-1";
import { resolveProjectVisualLibrary } from "./project-visual-library.js?v=installed-package-layers-compiler-transport-1";

export function createProjectVisualNodeResolver(state = {}, {
  installedLayers = [],
  installedPackages = [],
} = {}) {
  const projectIsfComponents = listProjectIsfVisualComponents(state);
  const visualLibrary = resolveProjectVisualLibrary(state, { installedLayers, installedPackages });
  const packageComponents = materializeInstalledPackageVisualComponents(
    state,
    installedPackages,
    visualLibrary,
  );
  const packageTransitions = materializeInstalledPackageTransitions(
    state,
    installedPackages,
    visualLibrary,
  );
  const allComponents = [
    ...listGeneratorNodeComponents(),
    ...listEffectNodeComponents(),
    ...packageComponents,
    ...projectIsfComponents,
  ];
  const componentByNodeId = new Map(allComponents.map((component) => [component.nodeDefinition.id, component]));
  const projectDefinitionByNodeId = new Map((state?.nodes?.definitions || [])
    .filter((definition) => definition?.persistence !== "package" && definition?.id)
    .map((definition) => [String(definition.id), definition]));
  const artifactByVisualKey = new Map(visualLibrary.list()
    .filter((artifact) => artifact.artifactType === "generator" || artifact.artifactType === "effect")
    .map((artifact) => [
      `${artifact.artifactType}:${artifact.implementation.visualId || artifact.id}`,
      artifact,
    ]));
  const activeForks = new Map();
  for (const fork of state?.nodes?.forks || []) {
    if (fork?.active === false || !fork?.base?.id) continue;
    activeForks.set(fork.base.id, fork);
  }
  const projectCache = new Map();
  const catalogComponent = (kind, id) => {
    const artifact = artifactByVisualKey.get(`${kind}:${String(id || "")}`);
    if (!artifact) return null;
    return componentByNodeId.get(String(artifact.implementation.nodeId || "")) || null;
  };
  const resolve = (base) => {
    if (!base?.nodeDefinition) return base || null;
    const fork = activeForks.get(base.nodeDefinition.id);
    if (!fork) return base;
    if (projectCache.has(fork.id)) return projectCache.get(fork.id);
    try {
      const definition = materializeProjectNodeFork(base.nodeDefinition, fork);
      const component = isIsfNodeDefinition(definition)
        ? Object.freeze({
          ...materializeIsfNodeDefinition(definition),
          projectForkId: fork.id,
          renderAuthority: "project-isf-node-fork",
        })
        : componentFromNodeDefinition(base, definition, {
          projectForkId: fork.id,
          renderAuthority: "project-node-fork",
        });
      projectCache.set(fork.id, component);
      return component;
    } catch (error) {
      console.warn("[VJ1_NODE_FORK_INVALID]", { forkId: fork.id, message: error?.message || String(error) });
      return base;
    }
  };
  const resolveDefinition = (nodeId) => {
    const id = String(nodeId || "");
    const component = resolve(componentByNodeId.get(id));
    if (component?.nodeDefinition) return component.nodeDefinition;
    const definition = projectDefinitionByNodeId.get(id);
    if (!definition) return null;
    const fork = activeForks.get(id);
    if (!fork) return definition;
    if (projectCache.has(fork.id)) return projectCache.get(fork.id);
    try {
      const materialized = materializeProjectNodeFork(definition, fork);
      projectCache.set(fork.id, materialized);
      return materialized;
    } catch (error) {
      console.warn("[VJ1_NODE_FORK_INVALID]", { forkId: fork.id, message: error?.message || String(error) });
      return definition;
    }
  };
  return Object.freeze({
    // File-backed definitions arrive after the lightweight project snapshot.
    // A project-local id is therefore allowed to be unresolved briefly; the
    // renderer treats null as pending instead of misrouting it to the strict
    // built-in catalog and throwing VJ1_UNKNOWN_*.
    effect: (id) => resolve(catalogComponent("effect", id)),
    generator: (id) => resolve(catalogComponent("generator", id)),
    generatorShader: (id) => {
      const component = resolve(catalogComponent("generator", id));
      if (!component?.nodeDefinition?.parts?.some((part) => part.kind === "shader")) return null;
      return Object.freeze({ ...component, type: component.shaderInterface || component.type });
    },
    definition: resolveDefinition,
    activeForks,
    projectIsfComponents,
    packageComponents,
    packageTransitions,
    visualLibrary,
    diagnostics: visualLibrary.diagnostics,
  });
}

function materializeInstalledPackageTransitions(state, installedPackages, visualLibrary) {
  if (!(state?.nodes?.packages || []).some((reference) => reference.enabled !== false)) return [];
  const definitions = new Map();
  for (const nodePackage of resolveProjectNodePackages(state.nodes, installedPackages)) {
    for (const definition of nodePackage.definitions || []) {
      definitions.set(String(definition.id || ""), definition);
    }
  }
  const result = [];
  for (const artifact of visualLibrary.list({ artifactType: "transition" })) {
    if (artifact.origin.kind !== "installed") continue;
    const definition = definitions.get(String(artifact.implementation.nodeId || ""));
    if (!definition || !isIsfNodeDefinition(definition)) continue;
    const transition = materializeIsfTransitionDefinition(definition);
    if (transition.id !== artifact.id) {
      throw new Error(`VISUAL_PACKAGE_TRANSITION_ID_MISMATCH:${artifact.id}:${transition.id}`);
    }
    result.push(Object.freeze({
      ...transition,
      origin: artifact.origin,
    }));
  }
  return result;
}

function materializeInstalledPackageVisualComponents(state, installedPackages, visualLibrary) {
  if (!(state?.nodes?.packages || []).some((reference) => reference.enabled !== false)) return [];
  const resolvedPackages = resolveProjectNodePackages(state.nodes, installedPackages);
  const definitions = new Map();
  for (const nodePackage of resolvedPackages) {
    for (const definition of nodePackage.definitions || []) {
      definitions.set(String(definition.id || ""), definition);
    }
  }
  const result = [];
  for (const artifact of visualLibrary.list()) {
    if (artifact.origin.kind !== "installed") continue;
    if (!["generator", "effect"].includes(artifact.artifactType)) continue;
    const definition = definitions.get(String(artifact.implementation.nodeId || ""));
    if (!definition) continue;
    if (
      artifact.implementation.nodeVersion &&
      artifact.implementation.nodeVersion !== definition.version
    ) {
      throw new Error(
        `VISUAL_PACKAGE_NODE_VERSION_MISMATCH:${artifact.id}:${artifact.implementation.nodeVersion}:${definition.version}`,
      );
    }
    if (isIsfNodeDefinition(definition)) {
      result.push(materializeIsfNodeDefinition(definition));
      continue;
    }
    result.push(componentFromNodeDefinition({
      id: artifact.implementation.visualId || artifact.id,
      kind: artifact.artifactType,
      family: definition.metadata?.visualFamily || "package",
      name: artifact.name,
      description: artifact.description,
      category: artifact.categories[0] || "Installed",
      processor: definition.metadata?.processor || "node",
      scheduler: "frame",
      runtime: {
        cacheable: definition.metadata?.renderInvalidation?.mode !== "frame",
        timeDependent: () => definition.metadata?.renderInvalidation?.mode === "frame",
      },
      type: definition.metadata?.visualType || definition.metadata?.shaderInterface || "node",
      code: "",
      params: [],
    }, definition, {
      renderAuthority: "installed-node-package",
      packageId: artifact.origin.id,
    }));
  }
  return result;
}
