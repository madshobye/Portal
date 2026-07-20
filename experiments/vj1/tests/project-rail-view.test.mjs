import test from "node:test";
import assert from "node:assert/strict";

import { projectRailTemplate } from "../js/control/project-rail-view.js";
import { createInitialState } from "../js/domain/models.js";

test("project rail renders each workspace through one view boundary", () => {
  const state = createInitialState();
  const catalogScopes = [];
  const sortScopes = [];
  const options = {
    catalogItems(scope, items) {
      catalogScopes.push(scope);
      return items;
    },
    catalogSortMode(scope) {
      sortScopes.push(scope);
      return "recent";
    },
  };

  const component = projectRailTemplate(state, { ...options, workspace: "component" });
  const canvas = projectRailTemplate(state, { ...options, workspace: "canvas" });
  const scene = projectRailTemplate(state, { ...options, workspace: "scene" });
  const live = projectRailTemplate(state, { ...options, workspace: "live" });
  const mapping = projectRailTemplate(state, { ...options, workspace: "mapping" });

  assert.match(component, /data-add-component/);
  assert.match(component, /data-scroll-key="component-catalog"/);
  assert.match(canvas, /data-add-canvas-component/);
  assert.match(canvas, /data-scroll-key="recording-frames"/);
  assert.match(scene, /data-add-scene/);
  assert.match(scene, /data-scroll-key="scene-surfaces"/);
  assert.match(live, /data-scroll-key="live-scenes"/);
  assert.match(live, /data-update="global\.timeStretch"/);
  assert.match(mapping, /data-scroll-key="mapping-components"/);
  assert.deepEqual(catalogScopes, ["component", "canvas", "scene", "scene"]);
  assert.deepEqual(sortScopes, ["component", "canvas", "scene", "scene"]);
});

test("unknown project workspace uses the scene rail", () => {
  const html = projectRailTemplate(createInitialState(), { workspace: "unknown" });
  assert.match(html, /data-add-scene/);
  assert.match(html, /data-scroll-key="scene-catalog"/);
});
