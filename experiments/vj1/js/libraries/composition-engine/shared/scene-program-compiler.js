import { OutputProgramNode } from "../output-program/index.js";
import { SceneProgramNode } from "../scene-program/index.js";
import { SurfaceRouteNode } from "../surface-route/index.js";
import { compileReachableProgramGraph } from "./program-graph-compiler.js";

export const SCENE_PROGRAM_GENERATOR = "vj1-scene-compiler";

export function sceneProgramGroupId(sceneId = "") {
  return `vj1.scene.${sceneId || "working"}`;
}

export function compileSceneGroupTopology(scene = {}, fallbackSurfaces = []) {
  const sceneId = String(scene.id || "");
  const surfaces = scene.snapshot?.surfaces || fallbackSurfaces || [];
  const sourceNodes = uniqueSourceNodes(surfaces);
  const routeNodes = surfaces.map((surface) => ({
    id: `route:${surface.id}`,
    nodeId: SurfaceRouteNode.id,
    nodeVersion: SurfaceRouteNode.version,
    role: "surface-route",
    surfaceId: String(surface.id || ""),
    sourceNodeId: String(surface.sourceNodeId || ""),
    componentId: String(surface.componentId || ""),
    parameters: routeParameters(surface),
    generatedBy: SCENE_PROGRAM_GENERATOR,
  }));
  const composition = {
    id: "surface-composition",
    nodeId: "core.composition.surface-routes",
    nodeVersion: "0.1.0",
    role: "composition",
    generatedBy: SCENE_PROGRAM_GENERATOR,
  };
  const mapping = {
    id: "projection-mapping",
    nodeId: "core.mapping.projection-engine",
    nodeVersion: "0.1.0",
    role: "mapping",
    generatedBy: SCENE_PROGRAM_GENERATOR,
  };
  const nodes = [...sourceNodes, ...routeNodes, composition, mapping];
  const connections = [];
  for (const route of routeNodes) {
    const source = sourceNodes.find((node) => node.sourceNodeId === route.sourceNodeId || (!route.sourceNodeId && node.componentId === route.componentId));
    if (source) connections.push({ from: `${source.id}.texture`, to: `${route.id}.texture`, type: "texture" });
    connections.push({ from: `${route.id}.route`, to: `${composition.id}.state`, type: "route" });
  }
  connections.push({ from: `${composition.id}.routes`, to: `${mapping.id}.config`, type: "routes" });
  connections.push({ from: `${mapping.id}.config`, to: "$out.routes", type: "routes" });
  return {
    id: sceneProgramGroupId(sceneId),
    nodeId: SceneProgramNode.id,
    nodeVersion: SceneProgramNode.version,
    sceneId,
    name: scene.name || (sceneId ? "Scene" : "Working Scene"),
    nodes,
    connections,
    publicInlets: {},
    publicOutlets: { routes: `${mapping.id}.config` },
    compiler: { id: "vj1.scene.route-program", target: "routing", strategy: "compile-reachable-routes" },
    sourceSignature: sceneSourceSignature(scene, surfaces),
    generatedBy: SCENE_PROGRAM_GENERATOR,
  };
}

export function compileOutputGroupTopology() {
  return {
    id: "vj1.output.main",
    nodeId: OutputProgramNode.id,
    nodeVersion: OutputProgramNode.version,
    name: "Main Output",
    nodes: [
      { id: "scene", nodeId: SceneProgramNode.id, nodeVersion: SceneProgramNode.version, role: "scene", generatedBy: SCENE_PROGRAM_GENERATOR },
      { id: "compose", nodeId: "core.composition.surface-routes", nodeVersion: "0.1.0", role: "composition", generatedBy: SCENE_PROGRAM_GENERATOR },
      { id: "map", nodeId: "core.mapping.projection-engine", nodeVersion: "0.1.0", role: "mapping", generatedBy: SCENE_PROGRAM_GENERATOR },
    ],
    connections: [
      { from: "scene.routes", to: "compose.state", type: "routes" },
      { from: "compose.routes", to: "map.config", type: "routes" },
      { from: "map.config", to: "$out.output", type: "texture" },
    ],
    publicInlets: {},
    publicOutlets: { output: "map.config" },
    compiler: { id: "vj1.output.route-program", target: "output", strategy: "compile-reachable-output" },
    topologyVersion: 1,
    generatedBy: SCENE_PROGRAM_GENERATOR,
  };
}

export function sceneProgramInstances(groups = []) {
  return (groups || []).flatMap((group) => (group.nodes || []).map((node) => ({
    id: `${group.id}/${node.id}`,
    nodeId: node.nodeId,
    nodeVersion: node.nodeVersion,
    parameters: node.parameters || {},
    parentGroupId: group.id,
    role: node.role,
    surfaceId: node.surfaceId || "",
    sourceNodeId: node.sourceNodeId || "",
    componentId: node.componentId || "",
    generatedBy: SCENE_PROGRAM_GENERATOR,
  })));
}

export function compileSceneRenderPrograms(state = {}, groups = []) {
  const programs = new Map();
  for (const group of groups || []) {
    if (group.generatedBy !== SCENE_PROGRAM_GENERATOR || group.nodeId !== SceneProgramNode.id) continue;
    const plan = compileReachableProgramGraph(group, { outputs: ["$out.routes"] });
    const sourceSurfaces = sceneSurfaces(state, group.sceneId);
    const surfacesById = new Map(sourceSurfaces.map((surface) => [String(surface.id || ""), surface]));
    const routeNodes = plan.nodes.filter((node) => node.role === "surface-route");
    programs.set(group.sceneId || "", Object.freeze({
      id: group.id,
      sceneId: group.sceneId || "",
      surfaces: Object.freeze(routeNodes.map((node) => {
        const surface = surfacesById.get(String(node.surfaceId || ""));
        // Generated route-node parameters describe the compiled topology, but
        // the current Scene snapshot is the live parameter authority. During a
        // slider gesture the project model is patched in place without
        // regenerating node groups; allowing the generated copy to win here
        // made Presence/Fit update only after pointer release. Keeping the
        // route identity in the graph and values in the Scene also avoids a
        // second mutable source of truth.
        return surface ? { ...surface } : null;
      }).filter(Boolean)),
      plan,
      generatedBy: SCENE_PROGRAM_GENERATOR,
    }));
  }
  return programs;
}

export function compileOutputRenderProgram(groups = []) {
  const group = (groups || []).find((item) => item.id === "vj1.output.main");
  if (!group) return Object.freeze({ id: "vj1.output.main", enabled: true, legacy: true, plan: null });
  const plan = compileReachableProgramGraph(group, { outputs: ["$out.output"] });
  return Object.freeze({
    id: group.id,
    enabled: plan.nodes.some((node) => node.role === "scene") && plan.nodes.some((node) => node.role === "mapping"),
    plan,
  });
}

export function activeSceneProgramSurfaces(state = {}, programs = new Map(), outputProgram = null) {
  if (outputProgram && outputProgram.enabled === false) return [];
  const sceneId = String(state.ui?.selectedSceneId || state.ui?.live?.selectedSceneId || "");
  return programs.get(sceneId)?.surfaces || programs.get("")?.surfaces || state.surfaces || [];
}

function sceneSurfaces(state, sceneId) {
  if (!sceneId) return state.surfaces || [];
  const routes = state.scenes?.find((scene) => String(scene.id || "") === String(sceneId))?.snapshot?.surfaces;
  if (!Array.isArray(routes)) return state.surfaces || [];
  const physicalSurfaces = new Map((state.surfaces || []).map((surface) => [String(surface.id || ""), surface]));
  return routes.map((route) => {
    const physical = physicalSurfaces.get(String(route.id || ""));
    // Feather and destination/mapping geometry belong to the physical
    // surface, not to a Scene. Merge them underneath the Scene-owned routing
    // values so physical edits remain live in every Scene.
    return physical ? { ...physical, ...route, feather: physical.feather } : route;
  });
}

function sceneSourceSignature(scene, surfaces) {
  return JSON.stringify({
    sceneId: String(scene.id || ""),
    name: scene.name || "",
    surfaces: (surfaces || []).map((surface) => ({
      id: surface.id,
      sourceNodeId: surface.sourceNodeId,
      componentId: surface.componentId,
      enabled: surface.enabled,
      projectionFit: surface.projectionFit,
      feather: surface.feather,
      opacity: surface.opacity,
      blend: surface.blend,
      outputFrameId: surface.outputFrameId,
    })),
  });
}

function uniqueSourceNodes(surfaces) {
  const seen = new Set();
  const result = [];
  for (const surface of surfaces || []) {
    const key = String(surface.sourceNodeId || surface.componentId || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: `source:${key}`,
      nodeId: "core.composition.component-program",
      nodeVersion: "0.1.0",
      role: "component-source",
      sourceNodeId: String(surface.sourceNodeId || ""),
      componentId: String(surface.componentId || ""),
      componentGroupId: surface.componentId ? `vj1.component.${surface.componentId}` : "",
      generatedBy: SCENE_PROGRAM_GENERATOR,
    });
  }
  return result;
}

function routeParameters(surface = {}) {
  return {
    enabled: surface.enabled !== false,
    projectionFit: surface.projectionFit || "cover",
    feather: Math.max(0, Number(surface.feather) || 0),
    opacity: surface.opacity ?? 1,
    blend: surface.blend || "normal",
    outputFrameId: surface.outputFrameId || "",
  };
}
