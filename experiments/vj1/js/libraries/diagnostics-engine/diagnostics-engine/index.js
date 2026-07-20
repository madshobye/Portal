import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const LEVELS = Object.freeze(["info", "warning", "error"]);

export function createDiagnosticsService({ host = globalThis, maxEntries = 80, maxMessageLength = 4000 } = {}) {
  const entries = [];
  const listeners = new Set();
  const consoleMethods = new Map();
  let installed = false;
  let nextId = 1;

  function install() {
    if (installed) return;
    installed = true;
    wrapConsole("info", "info");
    wrapConsole("warn", "warning");
    wrapConsole("error", "error");
    host.addEventListener?.("error", captureWindowError);
    host.addEventListener?.("unhandledrejection", captureUnhandledRejection);
  }

  function destroy() {
    if (!installed) return;
    installed = false;
    for (const [method, original] of consoleMethods) host.console[method] = original;
    consoleMethods.clear();
    host.removeEventListener?.("error", captureWindowError);
    host.removeEventListener?.("unhandledrejection", captureUnhandledRejection);
    listeners.clear();
  }

  function wrapConsole(method, level) {
    const original = host.console?.[method];
    if (typeof original !== "function") return;
    consoleMethods.set(method, original);
    host.console[method] = function vj1DiagnosticConsole(...args) {
      original.apply(this, args);
      record(level, args, "console");
    };
  }

  function captureWindowError(event) {
    record("error", [event?.error || event?.message || "Unhandled window error"], "window");
  }

  function captureUnhandledRejection(event) {
    record("error", ["Unhandled promise rejection", event?.reason], "promise");
  }

  function record(level, values, source = "app", occurrences = 1) {
    const normalizedLevel = LEVELS.includes(level) ? level : "info";
    const message = formatValues(values).slice(0, maxMessageLength);
    if (!message) return;
    const count = Math.max(1, Math.floor(Number(occurrences) || 1));
    const now = Date.now();
    const previous = entries.at(-1);
    if (previous && previous.level === normalizedLevel && previous.message === message && previous.source === source) {
      previous.count += count;
      previous.lastAt = now;
    } else {
      entries.push({ id: nextId++, level: normalizedLevel, message, source, count, firstAt: now, lastAt: now });
      if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
    }
    emit();
  }

  function clear() {
    if (!entries.length) return;
    entries.length = 0;
    emit();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    listener(summary());
    return () => listeners.delete(listener);
  }

  function emit() {
    const value = summary();
    for (const listener of listeners) listener(value);
  }

  function summary() {
    const counts = { info: 0, warning: 0, error: 0 };
    for (const entry of entries) counts[entry.level] += entry.count;
    const level = counts.error ? "error" : counts.warning ? "warning" : counts.info ? "info" : "ok";
    return { level, counts, entries: entries.slice() };
  }

  function copyText() {
    return entries.map((entry) => {
      const time = new Date(entry.lastAt).toISOString();
      const count = entry.count > 1 ? ` x${entry.count}` : "";
      return `${time} ${entry.level.toUpperCase()}${count} ${entry.message} [${entry.source}]`;
    }).join("\n\n");
  }

  return { install, destroy, record, clear, subscribe, summary, copyText };
}

function formatValues(values) {
  return (Array.isArray(values) ? values : [values]).map(formatValue).filter(Boolean).join(" ");
}

function formatValue(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return String(nested);
      if (typeof nested === "object" && nested !== null) {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    }, 2);
  } catch {
    return String(value);
  }
}

export const DiagnosticsEngineNode = defineNode({
  id: "core.diagnostics.engine",
  name: "Diagnostics Engine",
  version: "0.1.0",
  description: "Captures, bounds, coalesces, summarizes, and publishes application diagnostics.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: {
    service: { type: "any", required: true },
    level: { type: { type: "enum", values: ["info", "warning", "error"] }, optional: true, defaultValue: "info" },
    values: { type: "any", optional: true },
    source: { type: "string", optional: true, defaultValue: "app" },
  },
  parameters: { command: { type: { type: "enum", values: ["record", "clear", "summary"] }, defaultValue: "summary" } },
  outlets: { summary: { type: "any" } },
  execution: { trigger: "manual", domain: "main", stateful: true },
  capabilities: ["diagnostics", "event-log", "observable-state", "graph-placeable"],
  presentation: { catalogs: ["graph", "diagnostics"], placeableOn: ["node-graph"] },
  parts: [{
    id: "diagnostics-engine",
    name: "Diagnostics engine",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "createDiagnosticsService",
    source: [createDiagnosticsService, formatValues, formatValue].map((value) => value.toString()).join("\n\n"),
  }],
  process: diagnosticsEngineNodeProcess,
});

export function diagnosticsEngineNodeProcess({ service, command = "summary", level = "info", values, source = "app" } = {}) {
  if (!service || typeof service.summary !== "function") throw new TypeError("DIAGNOSTICS_SERVICE_REQUIRED");
  if (command === "record") service.record(level, Array.isArray(values) ? values : [values], source);
  else if (command === "clear") service.clear();
  return { summary: service.summary() };
}
