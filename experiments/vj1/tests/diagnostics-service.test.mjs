import test from "node:test";
import assert from "node:assert/strict";
import { createDiagnosticsService, DiagnosticsEngineNode, diagnosticsEngineNodeProcess } from "../js/libraries/diagnostics-engine/diagnostics-engine/index.js";
import { NodeInstance } from "../js/libraries/node-engine/index.js";

function fakeHost() {
  const listeners = new Map();
  const calls = [];
  const console = {
    info: (...args) => calls.push(["info", ...args]),
    warn: (...args) => calls.push(["warn", ...args]),
    error: (...args) => calls.push(["error", ...args]),
  };
  return {
    console,
    calls,
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
}

test("diagnostics capture relevant console levels, collapse repeats, and remain bounded", () => {
  const host = fakeHost();
  const originals = { ...host.console };
  const diagnostics = createDiagnosticsService({ host, maxEntries: 2 });
  diagnostics.install();

  host.console.info("ready", { renderer: "preview" });
  host.console.warn("slow");
  host.console.warn("slow");
  assert.equal(host.calls.length, 3, "wrapped console still calls the browser console");
  assert.equal(diagnostics.summary().level, "warning");
  assert.equal(diagnostics.summary().entries.at(-1).count, 2);

  host.console.error("failed");
  const summary = diagnostics.summary();
  assert.equal(summary.level, "error");
  assert.equal(summary.entries.length, 2);
  assert.equal(summary.entries[0].message, "slow");
  assert.match(diagnostics.copyText(), /ERROR failed/);

  diagnostics.clear();
  assert.deepEqual(diagnostics.summary(), {
    level: "ok",
    counts: { info: 0, warning: 0, error: 0 },
    entries: [],
  });

  diagnostics.destroy();
  assert.equal(host.console.info, originals.info);
  assert.equal(host.console.warn, originals.warn);
  assert.equal(host.console.error, originals.error);
});

test("diagnostics capture uncaught errors and rejected promises without polling", () => {
  const host = fakeHost();
  const diagnostics = createDiagnosticsService({ host });
  let notifications = 0;
  diagnostics.subscribe(() => { notifications += 1; });
  diagnostics.install();
  host.listeners.get("error")({ message: "window broke" });
  host.listeners.get("unhandledrejection")({ reason: new Error("promise broke") });
  assert.equal(diagnostics.summary().counts.error, 2);
  assert.equal(notifications, 3, "one initial snapshot plus one event per diagnostic");
  diagnostics.destroy();
});

test("diagnostics preserve origins and merge transported occurrence counts", () => {
  const diagnostics = createDiagnosticsService({ host: fakeHost() });
  diagnostics.record("error", ["renderer failed"], "output output-main · console", 3);
  diagnostics.record("error", ["renderer failed"], "output output-main · console", 2);
  diagnostics.record("error", ["renderer failed"], "console");

  const entries = diagnostics.summary().entries;
  assert.equal(entries.length, 2, "identical messages from different windows remain attributable");
  assert.equal(entries[0].count, 5);
  assert.match(diagnostics.copyText(), /renderer failed \[output output-main · console\]/);
});

test("diagnostics engine node owns the service policy", () => {
  const service = createDiagnosticsService({ host: fakeHost() });
  const result = diagnosticsEngineNodeProcess({
    service,
    command: "record",
    level: "warning",
    values: ["slow render"],
    source: "test",
  });
  assert.equal(result.summary.counts.warning, 1);
  assert.match(DiagnosticsEngineNode.parts[0].source, /function createDiagnosticsService/);
});

test("diagnostics engine node owns a persistent service when the host does not inject one", async () => {
  const node = new NodeInstance(DiagnosticsEngineNode, { parameters: { command: "record" } });
  const result = await node.run({ host: fakeHost(), level: "warning", values: ["owned warning"], source: "node" });
  assert.equal(result.summary.counts.warning, 1);
  assert.equal(node.state.service.summary().entries[0].source, "node");
  node.dispose();
});
