import test from "node:test";
import assert from "node:assert/strict";

import { sortComponentCatalog } from "../js/control/control-shell-controller.js";

const items = [
  { id: "b", name: "Beta", activity: { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", lastUsedAt: "" } },
  { id: "a", name: "Alpha", activity: { createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", lastUsedAt: "" } },
  { id: "c", name: "Charlie", activity: { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z", lastUsedAt: "2026-01-05T00:00:00.000Z" } },
];

test("component catalogs sort by recent activity, name, or creation", () => {
  assert.deepEqual(sortComponentCatalog(items, "recent").map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(sortComponentCatalog(items, "name").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(sortComponentCatalog(items, "created").map((item) => item.id), ["a", "b", "c"]);
});
