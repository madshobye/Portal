import { materializeProjectNodeFork } from "../node-engine/node-editor.js";
import {
  componentFromNodeDefinition,
  getEffectNodeComponent,
  getGeneratorNodeComponent,
  listEffectNodeComponents,
  listGeneratorNodeComponents,
} from "./catalog.js";
import { isIsfNodeDefinition, listProjectIsfVisualComponents, materializeIsfNodeDefinition } from "../isf-engine/index.js?v=isf-definition-cache-1";

export function createProjectVisualNodeResolver(state = {}) {
  const projectIsfComponents = listProjectIsfVisualComponents(state);
  const allComponents = [
    ...listGeneratorNodeComponents(),
    ...listEffectNodeComponents(),
    ...projectIsfComponents,
  ];
  const componentByNodeId = new Map(allComponents.map((component) => [component.nodeDefinition.id, component]));
  const projectGenerators = new Map(projectIsfComponents.filter((component) => component.kind === "generator").map((component) => [component.id, component]));
  const projectEffects = new Map(projectIsfComponents.filter((component) => component.kind === "effect").map((component) => [component.id, component]));
  const activeForks = new Map();
  for (const fork of state?.nodes?.forks || []) {
    if (fork?.active === false || !fork?.base?.id) continue;
    activeForks.set(fork.base.id, fork);
  }
  const projectCache = new Map();
  const catalogEffect = (id) => {
    try { return getEffectNodeComponent(id); } catch { return null; }
  };
  const catalogGenerator = (id) => {
    try { return getGeneratorNodeComponent(id); } catch { return null; }
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
  return Object.freeze({
    // File-backed definitions arrive after the lightweight project snapshot.
    // A project-local id is therefore allowed to be unresolved briefly; the
    // renderer treats null as pending instead of misrouting it to the strict
    // built-in catalog and throwing VJ1_UNKNOWN_*.
    effect: (id) => resolve(projectEffects.get(String(id || "")) || catalogEffect(id)),
    generator: (id) => resolve(projectGenerators.get(String(id || "")) || catalogGenerator(id)),
    generatorShader: (id) => {
      const component = resolve(projectGenerators.get(String(id || "")) || catalogGenerator(id));
      if (!component?.nodeDefinition?.parts?.some((part) => part.kind === "shader")) return null;
      return Object.freeze({ ...component, type: component.shaderInterface || component.type });
    },
    definition: (nodeId) => {
      const component = resolve(componentByNodeId.get(String(nodeId || "")));
      return component?.nodeDefinition || null;
    },
    activeForks,
    projectIsfComponents,
  });
}
