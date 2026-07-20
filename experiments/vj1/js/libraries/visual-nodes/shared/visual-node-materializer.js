import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export function materializeVisualNodeDefinition(component = {}, { shader = null, nativeRenderer = "", nativeModule = null } = {}) {
  const base = component.nodeDefinition || component;
  const shaderSource = String(shader?.code || "");
  if (shaderSource) {
    return defineNode({
      ...base,
      implementation: { kind: NODE_IMPLEMENTATION_KINDS.SHADER, language: "glsl" },
      process: executeVisualNode,
      parts: [{
        id: "fragment-shader",
        name: shader.name || base.name || "Fragment shader",
        kind: NODE_PART_KINDS.SHADER,
        language: "glsl",
        stage: "fragment",
        editable: true,
        source: shaderSource,
      }],
      metadata: {
        ...base.metadata,
        ...visualExecutionMetadata(component),
        nodeOwnedShader: true,
        // A complete fragment program must not be wrapped as an effect; doing
        // so would redeclare its uniforms and varying inputs.
        shaderInterface: String(shader?.type || component.shaderInterface || component.type || "effect"),
      },
    });
  }
  if (!nativeRenderer) return base;
  if (typeof nativeModule?.process === "function") {
    return defineNode({
      ...base,
      implementation: NODE_IMPLEMENTATION_KINDS.CODE,
      process: nativeModule.process,
      moduleBindings: nativeModule.bindings || {},
      moduleExports: nativeModule.exports || {},
      metadata: {
        ...base.metadata,
        ...visualExecutionMetadata(component),
        nativeRenderer,
        nodeOwnedNativeModule: true,
        nodeOwnedNativeProcess: nativeModule.direct !== false,
        allocationStableDirectPath: true,
      },
      parts: nativeModule.parts || [],
    });
  }
  return defineNode({
    ...base,
    process: executeVisualNode,
    metadata: {
      ...base.metadata,
      ...visualExecutionMetadata(component),
      nativeRenderer,
      allocationStableDirectPath: true,
    },
    parts: [{
      id: "direct-runtime",
      name: "Allocation-stable native renderer",
      kind: NODE_PART_KINDS.DOCUMENTATION,
      editable: false,
      source: `This node owns its visual contract and executes through ${nativeRenderer}, its allocation-stable native renderer.`,
    }],
  });
}

// The injected host only supplies GPU resources. The node remains the owner of
// ports, parameters, shader/native contract, and editable implementation parts.
export function executeVisualNode(inputs = {}, context = {}) {
  if (typeof context.renderVisualNode !== "function") {
    throw new Error(`VISUAL_NODE_RENDER_HOST_MISSING:${context.instance?.definition?.id || "unknown"}`);
  }
  return {
    texture: context.renderVisualNode({ definition: context.instance.definition, inputs, context }),
  };
}

function visualExecutionMetadata(component = {}) {
  return {
    visualId: String(component.id || component.metadata?.visualId || ""),
    visualKind: String(component.kind || ""),
    visualFamily: String(component.family || ""),
    visualType: String(component.type || ""),
    processor: String(component.processor || ""),
    sampling: String(component.sampling || "unknown"),
    transformSource: component.transformSource !== false,
    requiresBaseSample: component.requiresBaseSample !== false,
    fusible: component.fusible === true,
  };
}
