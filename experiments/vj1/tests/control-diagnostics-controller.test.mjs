import test from "node:test";
import assert from "node:assert/strict";

import { DiagnosticsNode, UiNodeDefinitions } from "../js/libraries/ui-engine/index.js";

test("diagnostics presentation is an explicit UI node with semantic copy and clear events", () => {
  assert.equal(UiNodeDefinitions.filter((definition) => definition.id === DiagnosticsNode.id).length, 1);
  assert.deepEqual(Object.keys(DiagnosticsNode.outlets).sort(), ["clear", "copy"]);
  assert.equal(DiagnosticsNode.capabilities.includes("ui-diagnostics"), true);
});
