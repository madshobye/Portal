import { OutputProgramNode } from "../output-program/index.js";
import { MappingProgramNode } from "../mapping-program/index.js";
import { SurfaceRouteNode } from "../surface-route/index.js";
import { compileReachableProgramGraph } from "./program-graph-compiler.js";

export const MAPPING_PROGRAM_GENERATOR = "vj1-mapping-compiler";

export function mappingProgramGroupId(mappingId = "") {
  return `vj1.mapping.${mappingId || "working"}`;
}

export function compileMappingGroupTopology(mapping = {}, fallbackSurfaces = []) {
  const mappingId = String(mapping.id || "");
  const surfaces = mapping.surfaces || fallbackSurfaces || [];
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
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  }));
  const composition = {
    id: "surface-composition",
    nodeId: "core.composition.surface-routes",
    nodeVersion: "0.1.0",
    role: "composition",
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  };
  const projectionMapping = {
    id: "projection-mapping",
    nodeId: "core.mapping.projection-engine",
    nodeVersion: "0.1.0",
    role: "mapping",
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  };
  const nodes = [...sourceNodes, ...routeNodes, composition, projectionMapping];
  const connections = [];
  for (const route of routeNodes) {
    const source = sourceNodes.find((node) => node.sourceNodeId === route.sourceNodeId || (!route.sourceNodeId && node.componentId === route.componentId));
    if (source) connections.push({ from: `${source.id}.texture`, to: `${route.id}.texture`, type: "texture" });
    connections.push({ from: `${route.id}.route`, to: `${composition.id}.state`, type: "route" });
  }
  connections.push({ from: `${composition.id}.routes`, to: `${projectionMapping.id}.config`, type: "routes" });
  connections.push({ from: `${projectionMapping.id}.config`, to: "$out.routes", type: "routes" });
  return {
    id: mappingProgramGroupId(mappingId),
    nodeId: MappingProgramNode.id,
    nodeVersion: MappingProgramNode.version,
    mappingId,
    name: mapping.name || (mappingId ? "Mapping" : "Working Mapping"),
    nodes,
    connections,
    publicInlets: {},
    publicOutlets: { routes: `${projectionMapping.id}.config` },
    compiler: { id: "vj1.mapping.route-program", target: "routing", strategy: "compile-reachable-routes" },
    sourceSignature: mappingSourceSignature(mapping, surfaces),
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  };
}

export function compileOutputGroupTopology() {
  return {
    id: "vj1.output.main",
    nodeId: OutputProgramNode.id,
    nodeVersion: OutputProgramNode.version,
    name: "Main Output",
    nodes: [
      { id: "mapping", nodeId: MappingProgramNode.id, nodeVersion: MappingProgramNode.version, role: "mapping-program", generatedBy: MAPPING_PROGRAM_GENERATOR },
      { id: "compose", nodeId: "core.composition.surface-routes", nodeVersion: "0.1.0", role: "composition", generatedBy: MAPPING_PROGRAM_GENERATOR },
      { id: "map", nodeId: "core.mapping.projection-engine", nodeVersion: "0.1.0", role: "mapping", generatedBy: MAPPING_PROGRAM_GENERATOR },
    ],
    connections: [
      { from: "mapping.routes", to: "compose.state", type: "routes" },
      { from: "compose.routes", to: "map.config", type: "routes" },
      { from: "map.config", to: "$out.output", type: "texture" },
    ],
    publicInlets: {},
    publicOutlets: { output: "map.config" },
    compiler: { id: "vj1.output.route-program", target: "output", strategy: "compile-reachable-output" },
    topologyVersion: 1,
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  };
}

export function mappingProgramInstances(groups = []) {
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
    generatedBy: MAPPING_PROGRAM_GENERATOR,
  })));
}

export function compileMappingRenderPrograms(state = {}, groups = []) {
  const programs = new Map();
  for (const group of groups || []) {
    if (group.generatedBy !== MAPPING_PROGRAM_GENERATOR || group.nodeId !== MappingProgramNode.id) continue;
    // Mapping groups are generated topology. Scene selection materializes Frame
    // slots only when a render state is prepared, so compile that current
    // topology here instead of retaining source edges from the authored slot
    // definition. This happens on setState(), never during frame traversal.
    const runtimeMapping = state.mappings?.find((mapping) => String(mapping.id || "") === String(group.mappingId || ""));
    const activeGroup = runtimeMapping ? compileMappingGroupTopology(runtimeMapping) : group;
    const plan = compileReachableProgramGraph(activeGroup, { outputs: ["$out.routes"] });
    const sourceSurfaces = mappingSurfaces(state, group.mappingId);
    const routeNodes = plan.nodes.filter((node) => node.role === "surface-route");
    const reachableSurfaceIds = new Set(routeNodes.map((node) => String(node.surfaceId || "")));
    programs.set(group.mappingId || "", Object.freeze({
      id: group.id,
      mappingId: group.mappingId || "",
      // Graph reachability decides which routes execute. The Mapping array is
      // the presentation/order authority shared by embedded preview and
      // standalone Output; graph traversal order must never become z-order.
      surfaces: Object.freeze(sourceSurfaces.filter((surface) =>
        reachableSurfaceIds.has(String(surface.id || ""))
      ).map((surface) => {
        // Generated route-node parameters describe the compiled topology, but
        // the current Scene snapshot is the live parameter authority. During a
        // slider gesture the project model is patched in place without
        // regenerating node groups; allowing the generated copy to win here
        // made Presence/Fit update only after pointer release. Keeping the
        // route identity in the graph and values in the Scene also avoids a
        // second mutable source of truth.
        return { ...surface };
      })),
      plan,
      generatedBy: MAPPING_PROGRAM_GENERATOR,
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
    enabled: plan.nodes.some((node) => node.role === "mapping-program") && plan.nodes.some((node) => node.role === "mapping"),
    plan,
  });
}

export function activeMappingProgramSurfaces(state = {}, programs = new Map(), outputProgram = null) {
  if (outputProgram && outputProgram.enabled === false) return [];
  const mappingId = String(state.ui?.selectedMappingId || "");
  return programs.get(mappingId)?.surfaces || programs.get("")?.surfaces || state.surfaces || [];
}

function mappingSurfaces(state, mappingId) {
  if (!mappingId) return state.surfaces || [];
  const surfaces = state.mappings?.find((mapping) => String(mapping.id || "") === String(mappingId))?.surfaces;
  if (!Array.isArray(surfaces)) return state.surfaces || [];
  return surfaces;
}

function mappingSourceSignature(mapping, surfaces) {
  return JSON.stringify({
    mappingId: String(mapping.id || ""),
    name: mapping.name || "",
    surfaces: (surfaces || []).map((surface) => ({
      id: surface.id,
      sourceNodeId: surface.sourceNodeId,
      componentId: surface.componentId,
      enabled: surface.enabled,
      projectionFit: surface.projectionFit,
      feather: surface.feather,
      opacity: surface.opacity,
      blend: surface.blend,
      sceneCrop: surface.sceneCrop,
      sourceFit: surface.sourceFit,
      sourceFitActive: surface.sourceFitActive,
      sourceAspect: surface.sourceAspect,
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
      generatedBy: MAPPING_PROGRAM_GENERATOR,
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
    sceneCrop: surface.sceneCrop === true,
    sourceFit: surface.sourceFit || "cover",
    sourceFitActive: surface.sourceFitActive === true,
    sourceAspect: Math.max(0.0001, Number(surface.sourceAspect) || 1),
  };
}
