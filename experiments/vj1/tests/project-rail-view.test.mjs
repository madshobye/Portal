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
  const scene = projectRailTemplate(state, { ...options, workspace: "scene" });
  const live = projectRailTemplate(state, { ...options, workspace: "live" });
  const mapping = projectRailTemplate(state, { ...options, workspace: "mapping" });

  assert.match(component, /data-add-component/);
  assert.match(component, /ui-list-section/);
  assert.match(component, /data-scroll-key="component-catalog"/);
  assert.match(scene, /data-add-scene/);
  assert.match(scene, /data-scroll-key="scene-surfaces"/);
  assert.match(live, /data-scroll-key="live-sources:sc"/);
  assert.match(live, /data-live-source-filter="scenes" aria-pressed="true"/);
  assert.match(live, /data-live-source-filter="components" aria-pressed="true"/);
  assert.match(live, /class="sculpt-card parameter-surface live-timing-params"/);
  assert.match(live, /<select class="param-select" data-update="ui\.live\.transitionId">/);
  assert.match(live, /data-update="global\.timeStretch"/);
  assert.match(mapping, /data-scroll-key="mapping-catalog"/);
  assert.match(mapping, /data-scroll-key="mapping-surfaces"/);
  assert.match(mapping, /mapping-surface-rail-section[\s\S]*?data-update="mappings\.0\.name"[\s\S]*?data-toggle-path="ui\.mappingTestPattern"[\s\S]*?data-scene-mapping-in-live/);
  assert.doesNotMatch(mapping, /type="checkbox"[^>]*ui\.mappingTestPattern/);
  assert.doesNotMatch(mapping, />Surfaces</);
  assert.deepEqual(catalogScopes, ["component", "scene", "live", "mapping"]);
  assert.deepEqual(sortScopes, ["component", "scene", "live", "mapping"]);
});

test("unknown project workspace has no implicit domain alias", () => {
  const html = projectRailTemplate(createInitialState(), { workspace: "unknown" });
  assert.equal(html, "");
});
