import { createCoreValueTypeRegistry, valueTypeId } from "./node-types.js";

export class NodeInstance {
  constructor(definition, {
    id = "",
    parameters = {},
    typeRegistry = createCoreValueTypeRegistry(),
    clock = defaultClock,
    executor = null,
  } = {}) {
    if (!definition?.id) throw new Error("NODE_INSTANCE_MISSING_DEFINITION");
    this.definition = definition;
    this.id = String(id || `${definition.id}-${Math.random().toString(36).slice(2, 9)}`);
    this.typeRegistry = typeRegistry;
    this.clock = clock;
    this.executor = executor || definition.process;
    this.parameters = {};
    this.state = {};
    this.inletState = new Map();
    this.outputPackets = {};
    this.outputSequence = 0;
    this.lastExecutionAt = -Infinity;
    this.disposed = false;
    for (const [parameterId, parameter] of Object.entries(definition.parameters || {})) {
      const value = parameters[parameterId] ?? parameter.defaultValue;
      if (value !== undefined) this.setParameter(parameterId, value);
    }
  }

  setParameter(id, value) {
    const parameter = this.definition.parameters?.[id];
    if (!parameter) throw new Error(`NODE_PARAMETER_UNKNOWN:${this.definition.id}:${id}`);
    const normalized = normalizeInletValue(value, parameter, this.typeRegistry, `parameter:${id}`);
    this.parameters[id] = normalized;
    return normalized;
  }

  async run(inputs = {}, context = {}) {
    this.assertActive();
    assertExecutionContext(this.definition, context);
    if (typeof this.executor !== "function") throw new Error(`NODE_NOT_EXECUTABLE:${this.definition.id}`);
    const timestamp = packetTimestamp(context.timestamp, this.clock());
    const normalizedInputs = { ...this.parameters };
    for (const [id, value] of Object.entries(context.parameters || {})) {
      const parameter = this.definition.parameters?.[id];
      if (!parameter) throw new Error(`NODE_PARAMETER_UNKNOWN:${this.definition.id}:${id}`);
      normalizedInputs[id] = normalizeInletValue(value, parameter, this.typeRegistry, `parameter:${id}`);
    }
    for (const [id, inlet] of Object.entries(this.definition.inlets || {})) {
      const value = inputs[id] ?? this.currentInletValue(id) ?? inlet.defaultValue;
      if (value === undefined) {
        if (inlet.required) throw new Error(`NODE_INLET_REQUIRED:${this.definition.id}:${id}`);
        continue;
      }
      normalizedInputs[id] = normalizeInletValue(value, inlet, this.typeRegistry, `inlet:${id}`);
    }
    for (const [id, value] of Object.entries(inputs || {})) {
      if (!(id in normalizedInputs) && !(id in (this.definition.inlets || {}))) normalizedInputs[id] = value;
    }
    const result = await this.executor(normalizedInputs, {
      ...context,
      timestamp,
      instance: this,
      state: this.state,
      parameters: { ...this.parameters },
    });
    const outputs = normalizeOutputs(result, this.definition.outlets || {});
    this.outputPackets = {};
    for (const [id, outlet] of Object.entries(this.definition.outlets || {})) {
      if (!(id in outputs)) continue;
      this.typeRegistry.assert(outlet.type, outputs[id], `outlet:${this.definition.id}:${id}`);
      this.outputPackets[id] = createNodePacket(outputs[id], {
        timestamp,
        sequence: ++this.outputSequence,
        source: { nodeId: this.id, portId: id },
        port: outlet,
      });
    }
    this.lastExecutionAt = timestamp;
    return outputs;
  }

  receive(inletId, packetOrValue, sourcePort = null) {
    this.assertActive();
    const inlet = this.definition.inlets?.[inletId];
    if (!inlet) throw new Error(`NODE_INLET_UNKNOWN:${this.definition.id}:${inletId}`);
    const packet = isNodePacket(packetOrValue)
      ? packetOrValue
      : createNodePacket(packetOrValue, { timestamp: this.clock(), port: sourcePort });
    const mapped = adaptPortValue(packet.value, sourcePort || packet.port, inlet);
    const value = normalizeInletValue(mapped, inlet, this.typeRegistry, `inlet:${inletId}`);
    const state = this.ensureInletState(inletId);
    const interval = rateIntervalMs(inlet.rate);
    const tooSoon = interval > 0 && packet.timestamp - state.lastAcceptedAt < interval;
    if (tooSoon) {
      if (inlet.rate.overflow === "drop") return { accepted: false, dropped: true };
      if (inlet.rate.overflow === "queue") state.queue.push({ value, packet });
      else state.deferred = { value, packet };
      return { accepted: false, coalesced: inlet.rate.overflow !== "queue" };
    }
    acceptInletValue(state, value, packet);
    return { accepted: true };
  }

  async flush(timestamp = this.clock(), context = {}) {
    this.assertActive();
    const now = packetTimestamp(timestamp, this.clock());
    let dirty = false;
    for (const [id, inlet] of Object.entries(this.definition.inlets || {})) {
      const state = this.ensureInletState(id);
      promoteDeferredValue(state, inlet, now);
      if (!state.dirty) continue;
      state.current = smoothValue(state.current, state.raw, inlet.smoothing, now - state.lastEffectiveAt);
      state.lastEffectiveAt = now;
      state.dirty = false;
      dirty = true;
    }
    const interval = executionIntervalMs(this.definition.execution);
    if (interval > 0 && now - this.lastExecutionAt < interval) return { executed: false, rateLimited: true, outputs: null };
    if (!dirty && context.force !== true) return { executed: false, idle: true, outputs: null };
    const inputs = {};
    for (const id of Object.keys(this.definition.inlets || {})) {
      const value = this.currentInletValue(id);
      if (value !== undefined) inputs[id] = value;
    }
    return { executed: true, outputs: await this.run(inputs, { ...context, timestamp: now }) };
  }

  currentInletValue(id) {
    return this.inletState.get(id)?.current;
  }

  outputPacket(id) {
    return this.outputPackets[id] || null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.inletState.clear();
    this.outputPackets = {};
    try { this.definition.execution?.dispose?.(this); } catch {}
  }

  ensureInletState(id) {
    let state = this.inletState.get(id);
    if (!state) {
      state = {
        current: undefined,
        raw: undefined,
        dirty: false,
        lastAcceptedAt: -Infinity,
        lastEffectiveAt: -Infinity,
        deferred: null,
        queue: [],
      };
      this.inletState.set(id, state);
    }
    return state;
  }

  assertActive() {
    if (this.disposed) throw new Error(`NODE_INSTANCE_DISPOSED:${this.id}`);
  }
}

export function assertExecutionContext(definition, context = {}) {
  const requested = context.executionClass || context.workload || "";
  const workload = definition?.execution?.workload || "interactive";
  if (requested === "live-frame" && (workload === "bounded" || workload === "offline")) {
    throw new Error(`NODE_EXECUTION_CLASS_MISMATCH:${definition.id}:${workload}:live-frame`);
  }
  if (requested === "interactive" && workload === "offline") {
    throw new Error(`NODE_EXECUTION_CLASS_MISMATCH:${definition.id}:offline:interactive`);
  }
  return true;
}

export function createNodePacket(value, {
  timestamp = defaultClock(),
  sequence = 0,
  source = null,
  port = null,
  metadata = {},
} = {}) {
  return Object.freeze({
    value,
    timestamp: packetTimestamp(timestamp, defaultClock()),
    sequence: Math.max(0, Math.round(Number(sequence) || 0)),
    source,
    port,
    metadata: Object.freeze({ ...(metadata || {}) }),
    nodePacket: true,
  });
}

export function isNodePacket(value) {
  return value?.nodePacket === true && "value" in value;
}

export function adaptPortValue(value, sourcePort = null, targetPort = null) {
  if (!targetPort) return value;
  const sourceType = sourcePort?.type ? valueTypeId(sourcePort.type) : valueTypeId(targetPort.type);
  const targetType = valueTypeId(targetPort.type);
  if (sourceType !== targetType && sourceType !== "any" && targetType !== "any") {
    throw new TypeError(`NODE_PORT_TYPE_INCOMPATIBLE:${sourceType}:${targetType}`);
  }
  if (targetType !== "number" || typeof value !== "number") return value;
  const sourceRange = sourcePort?.expectedRange;
  const targetRange = targetPort.expectedRange;
  let result = value;
  if (validRange(sourceRange) && validRange(targetRange)) {
    const normalized = normalizeRangeValue(value, sourceRange, sourcePort?.scale || "linear");
    result = denormalizeRangeValue(normalized, targetRange, targetPort.scale || "linear");
  }
  if (targetPort.clamp && validRange(targetRange)) result = clamp(result, targetRange[0], targetRange[1]);
  return result;
}

export function smoothValue(previous, target, smoothing = { mode: "none" }, deltaMs = 0) {
  if (previous === undefined || typeof previous !== "number" || typeof target !== "number") return target;
  const mode = smoothing?.mode || "none";
  if (mode === "none" || deltaMs <= 0 || !Number.isFinite(deltaMs)) return target;
  if (mode === "exponential" || mode === "linear") {
    const timeConstant = Math.max(0.0001, Number(smoothing.timeConstantMs) || 0.0001);
    const alpha = mode === "linear"
      ? Math.min(1, deltaMs / timeConstant)
      : 1 - Math.exp(-deltaMs / timeConstant);
    return previous + (target - previous) * alpha;
  }
  if (mode === "slew") {
    const step = Math.max(0, Number(smoothing.maxUnitsPerSecond) || 0) * deltaMs / 1000;
    return previous + clamp(target - previous, -step, step);
  }
  return target;
}

function normalizeInletValue(value, inlet, registry, location) {
  let result = value;
  if (valueTypeId(inlet.type) === "number" && typeof result === "number") {
    if (inlet.clamp && validRange(inlet.allowedRange)) result = clamp(result, inlet.allowedRange[0], inlet.allowedRange[1]);
  }
  registry.assert(inlet.type, result, location);
  return result;
}

function normalizeOutputs(result, outlets) {
  const ids = Object.keys(outlets);
  if (result && typeof result === "object" && !Array.isArray(result) && ids.some((id) => id in result)) return result;
  if (ids.length === 1) return { [ids[0]]: result };
  if (!ids.length && result === undefined) return {};
  throw new Error("NODE_OUTPUT_SHAPE_INVALID");
}

function acceptInletValue(state, value, packet) {
  state.raw = value;
  state.dirty = true;
  state.lastAcceptedAt = packet.timestamp;
  if (state.current === undefined) {
    state.current = value;
    state.lastEffectiveAt = packet.timestamp;
  }
}

function promoteDeferredValue(state, inlet, now) {
  const interval = rateIntervalMs(inlet.rate);
  if (interval > 0 && now - state.lastAcceptedAt < interval) return;
  const next = state.queue.length ? state.queue.shift() : state.deferred;
  if (!next) return;
  state.deferred = null;
  acceptInletValue(state, next.value, { ...next.packet, timestamp: Math.max(now, next.packet.timestamp) });
}

function normalizeRangeValue(value, range, scale) {
  if (scale === "log" && range[0] > 0 && range[1] > 0 && value > 0) {
    return (Math.log(value) - Math.log(range[0])) / (Math.log(range[1]) - Math.log(range[0]));
  }
  return (value - range[0]) / (range[1] - range[0]);
}

function denormalizeRangeValue(value, range, scale) {
  if (scale === "log" && range[0] > 0 && range[1] > 0) {
    return Math.exp(Math.log(range[0]) + value * (Math.log(range[1]) - Math.log(range[0])));
  }
  return range[0] + value * (range[1] - range[0]);
}

function validRange(value) {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] !== value[1];
}

function rateIntervalMs(rate) {
  const maxHz = Number(rate?.maxHz) || 0;
  return maxHz > 0 ? 1000 / maxHz : 0;
}

function executionIntervalMs(execution) {
  const maxHz = Number(execution?.maxHz) || 0;
  return maxHz > 0 ? 1000 / maxHz : 0;
}

function packetTimestamp(value, fallback) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function defaultClock() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
