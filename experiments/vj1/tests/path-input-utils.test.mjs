import test from "node:test";
import assert from "node:assert/strict";

import { getByPath, readInputValue, setByPath, setByPathCreate } from "../js/control/path-input-utils.js";

test("path input utilities read update and create nested array paths", () => {
  const state = { components: [{ source: { type: "black" } }] };
  setByPath(state, "components.0.source.type", "media");
  setByPathCreate(state, "components.0.source.params.amount", 0.75);

  assert.equal(getByPath(state, "components.0.source.type"), "media");
  assert.equal(getByPath(state, "components.0.source.params.amount"), 0.75);
});

test("path input utilities preserve linear and logarithmic input semantics", () => {
  assert.equal(readInputValue({ type: "checkbox", checked: true, dataset: {} }), true);
  assert.equal(readInputValue({ type: "range", value: "0.25", dataset: {} }), 0.25);
  assert.equal(readInputValue({
    type: "range",
    value: "0.5",
    dataset: { numberScale: "log", valueMin: "1", valueMax: "100" },
  }), 10);
});
