import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applySceneSourceNode,
  authoredSurfaceFields,
  materializeLiveSurfacePatchRoute,
  materializeLiveProgramSurfaceRoutes,
  materializeLiveTargetSurfaceRoutes,
  rebaseSurfaceRouteProgram,
  resolveSceneSourceNode,
  sceneSourceNodeId,
  sceneSourceNodes,
  visibleSceneSurfaceIds,
} from "../js/domain/scene-routing.js";
import {
  MAPPING_TEST_PATTERN_COMPONENT_ID,
  MAPPING_TEST_PATTERN_SOURCE_NODE_ID,
} from "../js/domain/runtime-visual-sources.js";

test("scene routing exposes user Components without inventing Frame sources", () => {
  const state = {
    components: [
      { id: "component-a", type: "chain", name: "A", activity: {} },
      { id: "scene-a", type: "scene", name: "Scene", activity: {} },
      { id: "system-a", type: "chain", name: "System", systemRole: "mapping-test-pattern", activity: {} },
    ],
  };
  const nodes = sceneSourceNodes(state);
  const sceneNode = nodes.find((node) => node.componentId === "scene-a");

  assert.deepEqual(nodes.map((node) => node.componentId), ["component-a", "scene-a"]);
  const runtimeNodes = sceneSourceNodes(state, { includeSystem: true });
  assert.deepEqual(runtimeNodes.map((node) => node.componentId), [
    "component-a",
    "scene-a",
    MAPPING_TEST_PATTERN_COMPONENT_ID,
  ]);
  assert.equal(runtimeNodes.at(-1).id, MAPPING_TEST_PATTERN_SOURCE_NODE_ID);
  assert.equal(runtimeNodes.at(-1).runtimeSource, true);
  assert.equal(resolveSceneSourceNode(state, ""), null);
  assert.equal(resolveSceneSourceNode(state, "missing-node"), null);
  assert.deepEqual(resolveSceneSourceNode(state, sceneNode.id), sceneNode);
  assert.deepEqual(applySceneSourceNode({}, sceneNode), {
    sourceNodeId: sceneNode.id,
    componentId: "scene-a",
    sceneCrop: false,
  });
});

test("models remains a facade for the scene-routing domain", () => {
  const source = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/scene-routing\.js"/);
  assert.doesNotMatch(source, /export function sceneSourceNodes\(/);
});

test("an Overall Component covers Scene space while preserving authored Surface geometry", () => {
  const surface = {
    id: "surface-a",
    x: 0.2,
    y: 0.1,
    width: 0.5,
    height: 0.75,
    projectionFit: "contain",
    destination: { type: "mapped" },
  };
  const state = { render: { sceneAspectRatio: 16 / 9 }, surfaces: [surface] };
  const target = { id: "component-a", type: "chain" };
  const routes = materializeLiveTargetSurfaceRoutes(state, target);

  assert.equal(routes.surfaces[0].componentId, target.id);
  assert.equal(routes.surfaces[0].sceneCrop, true);
  assert.equal(routes.surfaces[0].sourceFit, "cover");
  assert.equal(routes.surfaces[0].sourceFitActive, false);
  assert.equal(routes.surfaces[0].projectionFit, "contain");
  assert.equal(routes.surfaces[0].x, surface.x);
  assert.equal(routes.surfaces[0].width, surface.width);
  assert.deepEqual(state.surfaces, [surface]);
});

test("an individual Surface patch assigns the complete source through one cover stage", () => {
  const surface = {
    id: "surface-a",
    x: 0.2,
    y: 0.1,
    width: 0.5,
    height: 0.75,
    projectionFit: "contain",
  };
  const scene = { id: "scene-a", type: "scene" };
  const state = { components: [scene], surfaces: [surface] };

  const route = materializeLiveSurfacePatchRoute(state, scene, null, surface.id);

  assert.equal(route.sourceNodeId, sceneSourceNodeId(scene.id));
  assert.equal(route.componentId, scene.id);
  assert.equal(route.sceneCrop, false);
  assert.equal(route.sourceFitActive, false);
  assert.equal(route.projectionFit, "cover");
  assert.equal(route.x, surface.x);
  assert.equal(route.width, surface.width);
});

test("visible Scene guide ids are the enabled Surface ids", () => {
  const ids = visibleSceneSurfaceIds([
    { id: "surface-a", enabled: true },
    { id: "surface-b", enabled: false },
    { id: "surface-c" },
    { id: "", enabled: true },
  ]);
  assert.deepEqual([...ids], ["surface-a", "surface-c"]);
});

test("Live direct-output precedence follows explicit parent edges", () => {
  const parent = {
    id: "direct-parent",
    enabled: true,
    destination: { type: "direct", outputIds: ["main"], parentSurfaceId: "" },
  };
  const child = {
    id: "direct-child",
    enabled: true,
    destination: {
      type: "direct",
      outputIds: ["main", "side"],
      parentSurfaceId: "direct-parent",
    },
  };
  const state = {
    render: { sceneAspectRatio: 16 / 9 },
    components: [
      { id: "base", type: "chain", name: "Base" },
      { id: "patch", type: "chain", name: "Patch" },
    ],
    ui: {
      live: {
        surfacePatches: { "direct-parent": "patch" },
        surfaceVisibility: {},
      },
    },
  };
  const result = materializeLiveProgramSurfaceRoutes(
    state,
    state.components[0],
    { surfaces: [child, parent] },
  );

  assert.equal(result.surfaces.find((surface) => surface.id === "direct-parent").enabled, true);
  assert.equal(result.surfaces.find((surface) => surface.id === "direct-child").enabled, false);
});

test("authored Surface fields exclude compiled route bindings", () => {
  const authored = authoredSurfaceFields({
    id: "surface-a",
    x: 0.25,
    sourceNodeId: "component:a",
    componentId: "a",
    sceneCrop: true,
    sourceFit: "cover",
    sourceFitActive: false,
    sourceAspect: 1.5,
  });
  assert.deepEqual(authored, { id: "surface-a", x: 0.25 });
});

test("transition routes keep current Surface geometry and previous source bindings", () => {
  const current = [{
    id: "surface-a", x: 0.6, width: 0.3, componentId: "new",
    sourceNodeId: "component:new", projectionFit: "cover",
  }];
  const previous = [{
    id: "surface-a", x: 0.1, width: 0.8, componentId: "old",
    sourceNodeId: "component:old", sceneCrop: true, projectionFit: "contain",
  }];
  const [route] = rebaseSurfaceRouteProgram(previous, current);
  assert.equal(route.x, 0.6);
  assert.equal(route.width, 0.3);
  assert.equal(route.componentId, "old");
  assert.equal(route.sourceNodeId, "component:old");
  assert.equal(route.sceneCrop, true);
  assert.equal(route.projectionFit, "contain");
});
