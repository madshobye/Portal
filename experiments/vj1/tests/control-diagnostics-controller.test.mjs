import test from "node:test";
import assert from "node:assert/strict";

import { createControlDiagnosticsController } from "../js/control/control-diagnostics-controller.js";

test("diagnostics controller owns subscription, visibility, and entry presentation", () => {
  let subscriber = null;
  let rendered = "";
  const attributes = new Map();
  const classes = new Set();
  const classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    contains: (name) => classes.has(name),
  };
  const refs = {
    diagnosticsToggle: {
      classList,
      innerHTML: "",
      setAttribute: (name, value) => attributes.set(name, value),
    },
    diagnosticsSummary: { classList },
    diagnosticsSummaryContent: {},
  };
  const diagnostics = {
    summary: () => ({ level: "ok", counts: {}, entries: [] }),
    subscribe: (listener) => { subscriber = listener; },
  };
  const controller = createControlDiagnosticsController({
    diagnostics,
    getRefs: () => refs,
    replaceHtmlIfChanged: (_host, html) => { rendered = html; },
  });

  controller.mount();
  assert.equal(typeof subscriber, "function");
  controller.toggle();
  subscriber({
    level: "warning",
    counts: { warning: 1 },
    entries: [{ level: "warning", message: "Media missing", source: "output", lastAt: Date.now(), count: 1 }],
  });

  assert.equal(attributes.get("aria-expanded"), "true");
  assert.ok(rendered.includes("Media missing"));
  assert.ok(rendered.includes("data-diagnostics-copy"));
  controller.close();
  assert.equal(attributes.get("aria-expanded"), "false");
});
