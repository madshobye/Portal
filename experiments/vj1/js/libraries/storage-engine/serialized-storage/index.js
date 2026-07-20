import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export class SerializedTaskQueue {
  constructor({ worker, onError = () => false } = {}) {
    if (typeof worker !== "function") throw new Error("SERIALIZED_TASK_QUEUE_WORKER_REQUIRED");
    this.worker = worker;
    this.onError = onError;
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
          this.pending.unshift(task);
          throw error;
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
  parts: [{
    id: "serialized-task-queue",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    name: "Serialized task queue",
    source: SerializedTaskQueue.toString(),
  }],
  capabilities: ["storage", "serialized-writes", "retry-retention"],
  process: async ({ job }, context = {}) => ({
    result: typeof context.write === "function" ? await context.write(job) : job,
    pending: 0,
  }),
});
