import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const InstanceTimeNode = defineNode({
  id: "core.timing.instance-time",
  name: "Instance Time",
  version: "0.1.0",
  description: "Produces a stable per-instance phase offset when visual instances are unsynchronized.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    instanceId: { type: "string", required: true },
    baseTime: { type: "number", required: true },
  },
  outlets: { time: { type: "number" } },
  execution: { trigger: "frame", domain: "main", pure: true },
  capabilities: ["timing", "instance-phase", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "timing"], placeableOn: ["node-graph"] },
  parts: [
    {
      id: "instance-time-algorithm",
      name: "Instance time algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "instanceTime",
      source: [instanceTime, instanceTimeOffset].map((fn) => fn.toString()).join("\n\n"),
    },
    {
      id: "instance-time-process",
      name: "Instance time process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "instanceTimeNodeProcess",
      entry: "process",
      dependsOn: ["instance-time-algorithm"],
      source: instanceTimeNodeProcess.toString(),
    },
  ],
  process: instanceTimeNodeProcess,
});

export function instanceTimeNodeProcess({ instanceId, baseTime } = {}, { output = {} } = {}) {
  output.time = instanceTime(instanceId, baseTime);
  return output;
}

export function componentInstanceTime(component = {}, baseTime = 0, instanceId = "") {
  if (component?.syncInstances !== false) return Number(baseTime) || 0;
  return instanceTime(componentRenderInstanceKey(component, instanceId), baseTime);
}

export function componentRenderInstanceKey(component = {}, instanceId = "") {
  const componentId = String(component?.id || "");
  if (!componentId || component?.syncInstances !== false) return componentId;
  return `${componentId}:instance:${String(instanceId || "default")}`;
}

export function instanceTime(instanceId, baseTime = 0) {
  return Number(baseTime) + instanceTimeOffset(instanceId);
}

function instanceTimeOffset(instanceId = "") {
  const text = String(instanceId || "");
  if (!text) return 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * 97.0;
}
