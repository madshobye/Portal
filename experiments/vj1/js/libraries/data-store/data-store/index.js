import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export class ObservableDataStore {
  constructor(initialValue, { clone = structuredCloneValue } = {}) {
    this.value = initialValue;
    this.clone = clone;
    this.listeners = new Set();
    this.revision = 0;
  }

  snapshot(value = this.value) {
    return this.clone(value);
  }

  publish(value, event = { reason: "change" }) {
    this.value = value;
    this.revision++;
    const snapshot = this.snapshot(value);
    for (const listener of this.listeners) listener(snapshot, event.reason || "change", event);
    return snapshot;
  }

  replace(value, event = { reason: "replace" }) {
    return this.publish(value, event);
  }

  update(recipe, event = { reason: "update" }) {
    if (typeof recipe !== "function") throw new TypeError("DATA_STORE_RECIPE_REQUIRED");
    const draft = this.snapshot();
    recipe(draft);
    return this.publish(draft, event);
  }

  subscribe(listener, { emitCurrent = true, event = { reason: "init" } } = {}) {
    if (typeof listener !== "function") throw new TypeError("DATA_STORE_LISTENER_REQUIRED");
    this.listeners.add(listener);
    if (emitCurrent) listener(this.snapshot(), event.reason || "init", event);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.listeners.clear();
  }
}

export const DataStoreNode = defineNode({
  id: "core.data.observable-store",
  name: "Observable Data Store",
  version: "0.1.0",
  description: "Owns observable state snapshots, revisions, updates, and shared per-emission subscriber values.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    store: { type: "any", required: true },
    value: { type: "any", optional: true },
    event: { type: "event", optional: true },
  },
  parameters: { command: { type: { type: "enum", values: ["snapshot", "publish", "dispose"] }, defaultValue: "snapshot" } },
  outlets: {
    value: { type: "any" },
    revision: { type: "number" },
  },
  execution: { trigger: "manual", domain: "main", stateful: true },
  capabilities: ["data-store", "observable-state", "stateful", "graph-placeable"],
  presentation: { catalogs: ["graph", "data"], placeableOn: ["node-graph"] },
  parts: [{
    id: "observable-data-store",
    name: "Observable data store",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "ObservableDataStore",
    source: [ObservableDataStore, structuredCloneValue].map((value) => value.toString()).join("\n\n"),
  }],
  process: dataStoreNodeProcess,
});

export function dataStoreNodeProcess({ store, value, event, command = "snapshot" } = {}) {
  if (!(store instanceof ObservableDataStore)) throw new TypeError("DATA_STORE_INSTANCE_REQUIRED");
  let output;
  if (command === "publish") output = store.publish(value, event);
  else if (command === "dispose") {
    store.dispose();
    output = store.snapshot();
  } else output = store.snapshot();
  return { value: output, revision: store.revision };
}

function structuredCloneValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
