import test from "node:test";
import assert from "node:assert/strict";

import { catalogMarkerAction, sortComponentCatalog } from "../js/control/catalog-view.js";

const items = [
  { id: "p", name: "Zulu", catalogMarker: 3, activity: { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "" } },
  { id: "b", name: "Beta", catalogMarker: 2, activity: { createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", lastUsedAt: "2026-01-06T00:00:00.000Z" } },
  { id: "a", name: "Alpha", catalogMarker: 1, activity: { createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", lastUsedAt: "" } },
  { id: "c", name: "Charlie", catalogMarker: 0, activity: { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z", lastUsedAt: "2026-01-05T00:00:00.000Z" } },
];

test("component catalogs keep pinned favorites first under every ordering", () => {
  assert.deepEqual(sortComponentCatalog(items, "recent").map((item) => item.id), ["p", "c", "a", "b"]);
  assert.deepEqual(sortComponentCatalog(items, "name").map((item) => item.id), ["p", "a", "b", "c"]);
  assert.deepEqual(sortComponentCatalog(items, "created").map((item) => item.id), ["p", "a", "b", "c"]);
  assert.deepEqual(sortComponentCatalog(items, "marker").map((item) => item.id), ["p", "b", "a", "c"]);
});

test("heart and pin are separate marker states", () => {
  const heart = catalogMarkerAction({ id: "favorite", catalogMarker: 2 });
  const pin = catalogMarkerAction({ id: "pinned", catalogMarker: 3 });
  assert.equal(heart.icon, "favorite");
  assert.match(heart.label, /^Favorite;/);
  assert.deepEqual(heart.target, { kind: "component", id: "favorite" });
  assert.equal(pin.icon, "keep");
  assert.match(pin.label, /^Pinned;/);
});
