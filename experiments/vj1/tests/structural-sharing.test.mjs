import test from "node:test";
import assert from "node:assert/strict";

import {
  materializeStructuralTree,
  produceStructuralShare,
} from "../js/libraries/data-store/data-store/structural-sharing.js";

test("structural transactions copy only changed branches and publish cloneable data", () => {
  const untouched = { id: "untouched", value: 3 };
  const base = {
    ui: { workspace: "mapping" },
    catalog: [untouched],
    nodes: {
      packageLock: [{
        id: "example.package",
        version: "1.0.0",
        integrity: `sha256-${"a".repeat(64)}`,
      }],
    },
  };

  const next = produceStructuralShare(base, (draft) => {
    draft.ui.workspace = "component";
  });

  assert.notStrictEqual(next, base);
  assert.notStrictEqual(next.ui, base.ui);
  assert.strictEqual(next.catalog, base.catalog);
  assert.strictEqual(next.nodes, base.nodes);
  assert.deepEqual(structuredClone(next), next);
});

test("plain helper records cannot retain nested transaction proxies", () => {
  const frozenDefinition = Object.freeze({
    id: "vj1.generator.example",
    version: "1.0.0",
    metadata: Object.freeze({ origin: "package" }),
  });
  const base = {
    nodes: {
      authority: "node-graph",
      definitions: [frozenDefinition],
      packages: [{ id: "example.package", version: "1.0.0", enabled: true }],
    },
  };

  const next = produceStructuralShare(base, (draft) => {
    // Mirrors the project asset refresh: a helper spreads one draft record,
    // filters another draft array, and wraps the retained values in new plain
    // containers before assigning the result back to the transaction.
    const retained = draft.nodes.definitions.filter(Boolean);
    draft.nodes = {
      ...draft.nodes,
      definitions: [...retained],
      packageLock: draft.nodes.packages.map((item) => ({
        id: item.id,
        version: item.version,
      })),
    };
  });

  assert.equal(next.nodes.definitions[0].version, "1.0.0");
  assert.doesNotThrow(() => Object.entries(next.nodes.definitions[0]));
  assert.deepEqual(structuredClone(next), next);
});

test("materializing a draft subtree recursively removes helper-wrapped proxies", () => {
  const base = {
    nodes: {
      definitions: [{ id: "one", version: "1.0.0" }],
    },
  };
  let materialized = null;

  produceStructuralShare(base, (draft) => {
    const wrapped = {
      definitions: draft.nodes.definitions.map((definition) => ({
        definition,
      })),
    };
    materialized = materializeStructuralTree(wrapped);
  });

  assert.deepEqual(materialized, {
    definitions: [{
      definition: { id: "one", version: "1.0.0" },
    }],
  });
  assert.deepEqual(structuredClone(materialized), materialized);
});
