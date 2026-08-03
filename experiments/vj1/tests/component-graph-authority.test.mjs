import assert from "node:assert/strict";
import test from "node:test";

import { createVj1NodePackage } from "../js/app-node-package.js";
import { createAppState } from "../js/app-state.js";
import {
  componentLayerProjection,
  componentParameterAddressForPath,
  migrateLegacyComponentParameterAddress,
} from "../js/domain/component-layer-projection.js";
import {
  applyLiveRenderPatches,
  applyLiveRenderPatchesImmutable,
  createComponentRenderPatch,
  resolveLiveRenderPatches,
} from "../js/domain/live-render-patch.js";
import { createInitialState } from "../js/domain/models.js";
import { createLiveRenderState } from "../js/domain/models.js";
import { setLiveNodeParameterDiff } from "../js/domain/live-parameter-diffs.js";
import { compileComponentRenderPrograms } from "../js/libraries/composition-engine/index.js";

test("Component controls edit graph configuration and publish stable node render addresses", () => {
  const packageRoot = createVj1NodePackage();
  const store = createAppState(createInitialState(), {
    prepareState: packageRoot.prepareProjectState,
    prepareChange: packageRoot.prepareProjectChange,
  });
  const events = [];
  store.subscribe((_state, _reason, event) => events.push(event));
  const before = store.getState();
  const component = before.components[0];
  const layer = componentLayerProjection(before, component)[0];
  const path = `${layer.path}.enabled`;

  assert.equal(store.setComponentValue(path, false, { reason: `toggle:${path}` }), true);
  const after = store.getState();
  const changed = componentLayerProjection(after, after.components[0])[0];
  assert.equal(changed.item.enabled, false);
  assert.equal(after.components[0].chain[0].enabled, false, "the disposable execution projection is refreshed");
  assert.deepEqual(events.at(-1).renderPatches, [{
    componentId: component.id,
    nodeId: layer.nodeId,
    path: "enabled",
    value: false,
  }]);
});

test("render patches resolve and copy graph nodes without touching the Component projection", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const component = state.components[0];
  const layer = componentLayerProjection(state, component)[0];
  const patch = createComponentRenderPatch(component.id, layer.nodeId, "enabled", false);
  const resolution = resolveLiveRenderPatches(state, [patch]);

  assert.equal(resolution.applied, true);
  assert.deepEqual(resolution.configurationTargets, [{
    componentId: component.id,
    nodeIds: [layer.nodeId],
  }]);
  const result = applyLiveRenderPatchesImmutable(state, [patch]);
  assert.equal(result.applied, true);
  assert.strictEqual(result.state.components, state.components);
  assert.equal(componentLayerProjection(result.state, component)[0].item.enabled, false);
  assert.equal(state.components[0].chain[0].enabled, true);
});

test("semantic layer commands change Group topology before refreshing the execution projection", () => {
  const packageRoot = createVj1NodePackage();
  const store = createAppState(createInitialState(), {
    prepareState: packageRoot.prepareProjectState,
    prepareChange: packageRoot.prepareProjectChange,
  });
  const initial = store.getState();
  const component = initial.components[0];
  const sourceId = componentLayerProjection(initial, component)[0].nodeId;
  store.selectChainItem(sourceId);
  store.addChainGroup(component.id);
  let state = store.getState();
  let layers = componentLayerProjection(state, state.components[0]);
  const group = layers.find((layer) => layer.item.kind === "group");
  assert.ok(group);

  store.addChainEffect(component.id, "blur");
  state = store.getState();
  layers = componentLayerProjection(state, state.components[0]);
  const projectedGroup = layers.find((layer) => layer.nodeId === group.nodeId);
  assert.equal(projectedGroup.children.length, 1);
  assert.equal(projectedGroup.children[0].item.kind, "effect");

  store.removeChainItem(component.id, projectedGroup.children[0].nodeId);
  state = store.getState();
  assert.equal(
    componentLayerProjection(state, state.components[0])
      .find((layer) => layer.nodeId === group.nodeId).children.length,
    0,
  );
});

test("the optimized render plan patches retained operations from graph configuration", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const component = state.components[0];
  const layer = componentLayerProjection(state, component)[0];
  const programs = compileComponentRenderPrograms(state.components, state.nodes.groups, {
    resolveNodeDefinition: (node) => packageRoot.registry.get(node.nodeId, node.nodeVersion),
  });
  const program = programs.get(component.id);
  const patch = createComponentRenderPatch(component.id, layer.nodeId, "enabled", false);
  const resolution = resolveLiveRenderPatches(state, [patch]);
  resolution.destinations[0].target[resolution.destinations[0].leaf] = false;
  const group = state.nodes.groups.find((candidate) => candidate.componentId === component.id);

  assert.equal(program.syncGraphNodes(group, [layer.nodeId]).applied, true);
  assert.equal(program.inspect().operations.find((operation) => operation.id === layer.nodeId).enabled, false);
  program.dispose();
});

test("Live diffs use stable graph node addresses through cold activation", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const component = state.components[0];
  state.ui.live.selectedComponentId = component.id;
  const layer = componentLayerProjection(state, component)[0];

  assert.equal(setLiveNodeParameterDiff(
    state,
    component.id,
    layer.nodeId,
    "source.params.renderQuality",
    0.17,
  ), true);
  const live = createLiveRenderState(state);
  const group = live.nodes.groups.find((candidate) => candidate.componentId === component.id);
  const node = group.nodes.find((candidate) => candidate.id === layer.nodeId);

  assert.equal(node.configuration.source.params.renderQuality, 0.17);
  assert.equal(state.ui.live.parameterDiffs[component.id][component.id].chain, undefined);
  assert.equal(
    state.ui.live.parameterDiffs[component.id][component.id]
      .nodes[layer.nodeId].source.params.renderQuality,
    0.17,
  );
});

test("project preparation migrates positional Live diffs once and removes the old field", () => {
  const packageRoot = createVj1NodePackage();
  const legacy = createInitialState();
  const component = legacy.components[0];
  legacy.ui.live.selectedComponentId = component.id;
  legacy.ui.live.parameterDiffs = {
    [component.id]: {
      [component.id]: {
        chain: [{ source: { params: { renderQuality: 0.23 } } }],
      },
    },
  };
  const prepared = packageRoot.prepareProjectState(legacy);
  const layer = componentLayerProjection(prepared, prepared.components[0])[0];
  const override = prepared.ui.live.parameterDiffs[component.id][component.id];

  assert.equal(override.chain, undefined);
  assert.equal(override.nodes[layer.nodeId].source.params.renderQuality, 0.23);
});

test("runtime parameter addressing rejects positional chain paths outside project migration", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const component = state.components[0];
  const legacyPath = "chain.0.source.params.renderQuality";
  const layer = componentLayerProjection(state, component)[0];

  assert.equal(componentParameterAddressForPath(state, component, legacyPath), "");
  assert.equal(
    migrateLegacyComponentParameterAddress(state, component, legacyPath),
    `${layer.nodeId}::source.params.renderQuality`,
  );
});

test("renderer transport rejects positional projection paths", () => {
  const packageRoot = createVj1NodePackage();
  const state = packageRoot.prepareProjectState(createInitialState());
  const component = state.components[0];

  const result = applyLiveRenderPatches(state, [{
    target: "component",
    componentId: component.id,
    path: "chain.0.transform.x",
    value: 0.5,
  }]);

  assert.equal(result.applied, false);
  assert.equal(result.failedPatch.path, "chain.0.transform.x");
});
