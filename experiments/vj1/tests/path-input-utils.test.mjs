import test from "node:test";
import assert from "node:assert/strict";

import { getByPath, setByPath, setByPathCreate } from "../js/control/path-input-utils.js";

test("path input utilities read update and create nested array paths", () => {
  const state = { components: [{ source: { type: "black" } }] };
  setByPath(state, "components.0.source.type", "media");
  setByPathCreate(state, "components.0.source.params.amount", 0.75);

  assert.equal(getByPath(state, "components.0.source.type"), "media");
  assert.equal(getByPath(state, "components.0.source.params.amount"), 0.75);
});
