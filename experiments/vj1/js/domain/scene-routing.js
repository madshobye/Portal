import { latestProjectActivity } from "./component-activity.js?v=adaptive-component-demand-29";

export function normalizeProjectionFit(value) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

export function sceneSourceNodeId(componentId = "", frameId = "") {
  return frameId
    ? `recording-frame:${encodeURIComponent(componentId)}:${encodeURIComponent(frameId)}`
    : `component:${encodeURIComponent(componentId)}`;
}

export function sceneSourceNodes(state = {}) {
  const frames = Array.isArray(state.recordingFrames) ? state.recordingFrames : [];
  return (state.components || []).flatMap((component) => {
    const componentNode = {
      id: sceneSourceNodeId(component.id),
      type: "component",
      name: component.name,
      thumbnail: component.thumbnail || "",
      componentId: component.id,
      outputFrameId: "",
      createdAt: component.activity?.createdAt || "",
      recentAt: latestProjectActivity(component.activity),
    };
    if (component.type !== "canvas") return [componentNode];
    return [
      componentNode,
      ...frames.map((frame) => ({
        id: sceneSourceNodeId(component.id, frame.id),
        type: "recording-frame",
        name: `${component.name} · ${frame.name}`,
        thumbnail: component.canvas?.frameThumbnails?.[frame.id] || component.thumbnail || "",
        componentId: component.id,
        outputFrameId: frame.id,
        frameId: frame.id,
        createdAt: latestTimestamp(component.activity?.createdAt, frame.activity?.createdAt),
        recentAt: Math.max(latestProjectActivity(component.activity), latestProjectActivity(frame.activity)),
      })),
    ];
  });
}

export function resolveSceneSourceNode(state = {}, sourceNodeId = "") {
  const nodes = sceneSourceNodes(state);
  if (!sourceNodeId) return null;
  // An unresolved route is empty. Never substitute an unrelated first
  // component: that makes stale/blank assignments sample whichever texture
  // happened to be rendered first and violates the explicit Empty route.
  return nodes.find((node) => node.id === sourceNodeId) || null;
}

export function applySceneSourceNode(route = {}, node = null) {
  return {
    ...route,
    sourceNodeId: node?.id || "",
    componentId: node?.componentId || "",
    outputFrameId: node?.outputFrameId || "",
  };
}

function latestTimestamp(...values) {
  return values.filter(Boolean).sort().at(-1) || "";
}
