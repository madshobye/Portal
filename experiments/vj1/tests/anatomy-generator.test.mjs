import test from "node:test";
import assert from "node:assert/strict";

import { compileJavaScriptNodeModule, createProjectNodeFork } from "../js/libraries/node-engine/index.js";
import { createProjectVisualNodeResolver, getGeneratorNodeComponent } from "../js/libraries/visual-nodes/index.js";
import { anatomyNodeRuntimeModule } from "../js/output/specialized/specialized-source-runtime.js";

test("Low Poly Anatomy compiles its complete procedural geometry module", () => {
  const definition = getGeneratorNodeComponent("anatomy").nodeDefinition;
  const compiled = compileJavaScriptNodeModule(definition.parts, definition);

  assert.deepEqual(definition.parts.map((part) => part.id), ["anatomy-geometry-module", "anatomy-process"]);
  assert.equal(typeof compiled.exports.anatomyPartFitScale, "function");
  assert.equal(typeof compiled.exports.drawProceduralAnatomy, "function");
  assert.equal(compiled.exports.anatomyPartFitScale("heart"), 0.64);
});

test("Low Poly Anatomy project forks supply geometry directly to the retained target host", () => {
  const base = getGeneratorNodeComponent("anatomy").nodeDefinition;
  const fork = createProjectNodeFork(base, {
    forkId: "anatomy-project",
    overrides: {
      parts: base.parts.map((part) => part.id === "anatomy-geometry-module" ? {
        ...part,
        source: [
          "function anatomyPartFitScale() { return 2.5; }",
          "function drawProceduralAnatomy(_target, params) { return `forked-${params.part}`; }",
        ].join("\n"),
      } : part),
    },
  });
  const resolver = createProjectVisualNodeResolver({ nodes: { forks: [{ ...fork, active: true }] } });
  const module = anatomyNodeRuntimeModule({ nodeModule: resolver.definition(base.id).moduleExports });

  assert.equal(module.anatomyPartFitScale("face"), 2.5);
  assert.equal(module.drawProceduralAnatomy(null, { part: "heart" }), "forked-heart");
});
