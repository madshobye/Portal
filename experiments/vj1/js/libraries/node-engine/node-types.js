const TYPE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/i;

export class NodeValueTypeRegistry {
  constructor(definitions = []) {
    this.definitions = new Map();
    for (const definition of definitions) this.register(definition);
  }

  register(definition) {
    const id = String(definition?.id || "").trim();
    if (!TYPE_ID_PATTERN.test(id)) throw new Error(`NODE_VALUE_TYPE_INVALID_ID:${id || "missing"}`);
    if (this.definitions.has(id)) throw new Error(`NODE_VALUE_TYPE_ALREADY_REGISTERED:${id}`);
    if (typeof definition.validate !== "function") throw new Error(`NODE_VALUE_TYPE_MISSING_VALIDATOR:${id}`);
    const normalized = Object.freeze({
      id,
      name: String(definition.name || id),
      description: String(definition.description || ""),
      validate: definition.validate,
      serialize: typeof definition.serialize === "function" ? definition.serialize : (value) => value,
      fingerprint: typeof definition.fingerprint === "function" ? definition.fingerprint : null,
      dispose: typeof definition.dispose === "function" ? definition.dispose : null,
      transfer: typeof definition.transfer === "function" ? definition.transfer : null,
    });
    this.definitions.set(id, normalized);
    return normalized;
  }

  has(id) {
    return this.definitions.has(String(id || ""));
  }

  get(id) {
    const definition = this.definitions.get(String(id || ""));
    if (!definition) throw new Error(`NODE_VALUE_TYPE_UNKNOWN:${String(id || "")}`);
    return definition;
  }

  validate(specification, value) {
    const spec = normalizeValueSpec(specification);
    if (value === null || value === undefined) return spec.optional === true;
    return this.get(spec.type).validate(value, spec, this) === true;
  }

  assert(specification, value, location = "value") {
    if (!this.validate(specification, value)) {
      const spec = normalizeValueSpec(specification);
      throw new TypeError(`NODE_VALUE_TYPE_MISMATCH:${location}:${spec.type}`);
    }
    return value;
  }

  list() {
    return Array.from(this.definitions.values());
  }
}

export function valueType(type, options = {}) {
  return normalizeValueSpec({ ...options, type });
}

export function numberType(options = {}) {
  return valueType("number", options);
}

export function recordType(name, fields = {}, options = {}) {
  const normalizedFields = Object.fromEntries(Object.entries(fields).map(([id, spec]) => [id, normalizeValueSpec(spec)]));
  return normalizeValueSpec({ ...options, type: "record", name: String(name || "record"), fields: normalizedFields });
}

export function listType(items = "any", options = {}) {
  return normalizeValueSpec({ ...options, type: "list", items: normalizeValueSpec(items) });
}

export function optionalType(specification) {
  return normalizeValueSpec({ ...normalizeValueSpec(specification), optional: true });
}

export function normalizeValueSpec(specification = "any") {
  if (typeof specification === "string") return Object.freeze({ type: specification });
  const type = String(specification?.type || specification?.id || "any");
  return Object.freeze({ ...specification, type });
}

export function valueTypeId(specification) {
  return normalizeValueSpec(specification).type;
}

export function createCoreValueTypeRegistry() {
  return new NodeValueTypeRegistry(CORE_VALUE_TYPES);
}

export const CORE_VALUE_TYPES = Object.freeze([
  {
    id: "any",
    name: "Any",
    description: "An intentionally unconstrained value.",
    validate: () => true,
  },
  {
    id: "number",
    name: "Number",
    description: "A finite numeric value.",
    validate: (value) => typeof value === "number" && Number.isFinite(value),
  },
  {
    id: "boolean",
    name: "Boolean",
    description: "A true or false value.",
    validate: (value) => typeof value === "boolean",
  },
  {
    id: "string",
    name: "String",
    description: "A Unicode text value.",
    validate: (value) => typeof value === "string",
  },
  {
    id: "enum",
    name: "Enum",
    description: "A string selected from a declared set.",
    validate: (value, spec) => typeof value === "string" && (!Array.isArray(spec.values) || spec.values.includes(value)),
  },
  {
    id: "color",
    name: "Color",
    description: "A serializable color value.",
    validate: (value) => typeof value === "string" || (Array.isArray(value) && value.length >= 3),
  },
  {
    id: "vector2",
    name: "Vector 2",
    description: "A two-dimensional numeric vector.",
    validate: (value) => numericVector(value, 2),
  },
  {
    id: "vector3",
    name: "Vector 3",
    description: "A three-dimensional numeric vector.",
    validate: (value) => numericVector(value, 3),
  },
  {
    id: "transform2d",
    name: "Transform 2D",
    description: "A named two-dimensional transform record.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "transform3d",
    name: "Transform 3D",
    description: "A named three-dimensional transform record.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "image",
    name: "Image",
    description: "An image resource or image handle.",
    validate: (value) => !!value && (typeof value === "object" || typeof value === "function"),
  },
  {
    id: "texture",
    name: "Texture",
    description: "A GPU texture resource or texture handle.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "mesh",
    name: "Mesh",
    description: "A mesh resource or mesh handle.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "audio",
    name: "Audio",
    description: "An audio resource, buffer, stream, or handle.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "video",
    name: "Video",
    description: "A video resource, stream, or handle.",
    validate: (value) => !!value && typeof value === "object",
  },
  {
    id: "binary",
    name: "Binary",
    description: "An ArrayBuffer, typed-array view, or Blob-like value.",
    validate: (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value) || (value && typeof value.arrayBuffer === "function"),
  },
  {
    id: "file",
    name: "File",
    description: "A file or file-handle-like value.",
    validate: (value) => !!value && typeof value === "object" && (typeof value.arrayBuffer === "function" || value.kind === "file"),
  },
  {
    id: "event",
    name: "Event",
    description: "A discrete event payload.",
    validate: () => true,
  },
  {
    id: "command",
    name: "Command",
    description: "A semantic command payload.",
    validate: (value) => !!value && typeof value === "object" && typeof value.type === "string",
  },
  {
    id: "record",
    name: "Record",
    description: "A structurally typed named value.",
    validate: (value, spec, registry) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return Object.entries(spec.fields || {}).every(([id, field]) => registry.validate(field, value[id]));
    },
  },
  {
    id: "list",
    name: "List",
    description: "A list of values sharing a declared item type.",
    validate: (value, spec, registry) => Array.isArray(value) && value.every((item) => registry.validate(spec.items || "any", item)),
  },
]);

function numericVector(value, length) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return value.length === length && Array.from(value).every((item) => typeof item === "number" && Number.isFinite(item));
  }
  if (!value || typeof value !== "object") return false;
  const axes = length === 2 ? ["x", "y"] : ["x", "y", "z"];
  return axes.every((axis) => typeof value[axis] === "number" && Number.isFinite(value[axis]));
}
