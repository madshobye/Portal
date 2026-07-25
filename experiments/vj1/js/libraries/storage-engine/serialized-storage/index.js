import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export class SerializedTaskQueue {
  constructor({ worker, onError = () => false, retainFailed = true } = {}) {
    if (typeof worker !== "function") throw new Error("SERIALIZED_TASK_QUEUE_WORKER_REQUIRED");
    this.worker = worker;
    this.onError = onError;
    this.retainFailed = retainFailed;
    this.pending = [];
    this.drainPromise = null;
  }

  enqueue(task) {
    this.pending.push(task);
    if (!this.drainPromise) this.drainPromise = this.drain();
    return this.drainPromise;
  }

  async drain() {
    let completed = false;
    try {
      while (this.pending.length) {
        const task = this.pending.shift();
        try {
          completed = await this.worker(task) || completed;
        } catch (error) {
          if (this.retainFailed) {
            this.pending.unshift(task);
            throw error;
          }
          completed = this.onError(error) || completed;
        }
      }
      return completed;
    } catch (error) {
      return this.onError(error);
    } finally {
      this.drainPromise = null;
    }
  }

  wait() {
    return this.drainPromise || Promise.resolve(false);
  }

  clear() {
    if (this.drainPromise) throw new Error("SERIALIZED_TASK_QUEUE_ACTIVE");
    this.pending.length = 0;
  }

  get size() {
    return this.pending.length;
  }

  get active() {
    return !!this.drainPromise;
  }
}

export const SerializedStorageNode = defineNode({
  id: "core.storage.serialized-writes",
  name: "Serialized Storage",
  version: "0.1.0",
  description: "Runs immutable storage jobs in order, retaining a failed job for retry.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { job: { type: "any", required: true } },
  outlets: { result: { type: "any" }, pending: { type: "number" } },
  execution: { trigger: "input-change", domain: "main", stateful: true, asynchronous: true },
  parts: [
    {
      id: "serialized-task-queue",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Serialized task queue",
      export: "SerializedTaskQueue",
      source: SerializedTaskQueue.toString(),
    },
    {
      id: "serialized-storage-process",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      name: "Serialized storage process entry",
      export: "serializedStorageNodeProcess",
      entry: "process",
      dependsOn: ["serialized-task-queue"],
      source: serializedStorageNodeProcess.toString(),
    },
  ],
  capabilities: ["storage", "serialized-writes", "retry-retention"],
  process: serializedStorageNodeProcess,
});

export async function serializedStorageNodeProcess({ job } = {}, context = {}) {
  const state = context.state || {};
  state.write = context.write;
  state.onError = context.onError;
  const queue = state.queue || (state.queue = new SerializedTaskQueue({
    worker: (task) => typeof state.write === "function" ? state.write(task) : task,
    onError: (error) => typeof state.onError === "function" ? state.onError(error) : false,
  }));
  const result = await queue.enqueue(job);
  return { result, pending: queue.size };
}
