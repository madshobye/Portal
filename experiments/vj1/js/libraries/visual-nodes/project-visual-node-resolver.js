import { materializeProjectNodeFork } from "../node-engine/node-editor.js";
import {
  componentFromNodeDefinition,
  getEffectNodeComponent,
  getGeneratorNodeComponent,
  listEffectNodeComponents,
  listGeneratorNodeComponents,
} from "./catalog.js";

export function createProjectVisualNodeResolver(state = {}) {
  const componentByNodeId = new Map([
    ...listGeneratorNodeComponents(),
    ...listEffectNodeComponents(),
  ].map((component) => [component.nodeDefinition.id, component]));
  const activeForks = new Map();
  for (const fork of state?.nodes?.forks || []) {
    if (fork?.active === false || !fork?.base?.id) continue;
    activeForks.set(fork.base.id, fork);
  }
  const projectCache = new Map();
  const resolve = (base) => {
    if (!base?.nodeDefinition) return base || null;
    const fork = activeForks.get(base.nodeDefinition.id);
    if (!fork) return base;
    if (projectCache.has(fork.id)) return projectCache.get(fork.id);
    try {
      const definition = materializeProjectNodeFork(base.nodeDefinition, fork);
      const component = componentFromNodeDefinition(base, definition, {
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
    effect: (id) => resolve(getEffectNodeComponent(id)),
    generator: (id) => resolve(getGeneratorNodeComponent(id)),
    generatorShader: (id) => {
      const component = resolve(getGeneratorNodeComponent(id));
      if (!component?.nodeDefinition?.parts?.some((part) => part.kind === "shader")) return null;
      return Object.freeze({ ...component, type: component.shaderInterface || component.type });
    },
    definition: (nodeId) => {
      const component = resolve(componentByNodeId.get(String(nodeId || "")));
      return component?.nodeDefinition || null;
    },
    activeForks,
  });
}
