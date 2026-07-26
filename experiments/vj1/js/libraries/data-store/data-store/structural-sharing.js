const DRAFT_STATE = Symbol("observable-data-store-draft");

// Copy-on-write transaction for the plain object/array state tree. Reads share
// the current world model; only branches actually written by a command are
// copied.
export function produceStructuralShare(base, recipe) {
  if (typeof recipe !== "function") throw new TypeError("DATA_STORE_RECIPE_REQUIRED");
  if (!isDraftable(base)) {
    const replacement = recipe(base);
    return replacement === undefined ? base : replacement;
  }
  const root = createDraft(base);
  const replacement = recipe(root.proxy);
  if (replacement !== undefined && replacement !== root.proxy) {
    return finalizeValue(replacement);
  }
  return finalizeDraft(root);
}

// structuredClone cannot consume a Proxy. A command may still invoke a
// legitimate local clone (for example, retaining a transition endpoint) while
// operating on a draft. Materialize only that requested draft subtree.
export function materializeStructuralValue(value) {
  const state = value?.[DRAFT_STATE];
  return state ? materializeDraft(state, new Map()) : value;
}

export function materializeStructuralTree(value) {
  return materializeTreeValue(value, new Map());
}

export function createDraft(base) {
  const state = {
    base,
    copy: null,
    drafts: new Map(),
    assigned: new Set(),
    proxy: null,
    finalized: false,
    result: undefined,
  };
  // Use an empty carrier so frozen/non-configurable records in the authored
  // model do not impose Proxy invariants on the mutable draft view.
  const carrier = Array.isArray(base) ? [] : {};
  state.proxy = new Proxy(carrier, {
    get(_target, property) {
      if (property === DRAFT_STATE) return state;
      const source = state.copy || state.base;
      const value = Reflect.get(source, property, state.proxy);
      if (!isDraftable(value)) return value;
      const existing = state.drafts.get(property);
      if (existing?.base === value) return existing.proxy;
      const child = createDraft(value);
      state.drafts.set(property, child);
      return child.proxy;
    },
    set(_target, property, value) {
      const source = state.copy || state.base;
      const current = Reflect.get(source, property, state.proxy);
      if (Object.is(current, value) && Object.prototype.hasOwnProperty.call(source, property)) {
        return true;
      }
      prepareCopy(state);
      state.drafts.delete(property);
      state.assigned.add(property);
      return Reflect.set(state.copy, property, value);
    },
    deleteProperty(_target, property) {
      const source = state.copy || state.base;
      if (!Object.prototype.hasOwnProperty.call(source, property)) return true;
      prepareCopy(state);
      state.drafts.delete(property);
      state.assigned.add(property);
      return Reflect.deleteProperty(state.copy, property);
    },
    has(_target, property) {
      return property in (state.copy || state.base);
    },
    ownKeys() {
      return Reflect.ownKeys(state.copy || state.base);
    },
    getOwnPropertyDescriptor(_target, property) {
      const source = state.copy || state.base;
      const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
      if (Array.isArray(carrier) && property === "length") {
        return {
          value: source.length,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      if (!descriptor) return undefined;
      // A draft is a mutable authoring view even when its immutable base
      // contains frozen definitions. Never project a frozen/accessor
      // descriptor onto the empty proxy carrier: Object.entries/spread only
      // need the current value and enumerability, while projecting the base
      // descriptor can violate Proxy invariants after ordinary draft writes.
      return {
        value: Reflect.get(source, property, state.proxy),
        writable: true,
        enumerable: descriptor.enumerable === true,
        configurable: true,
      };
    },
  });
  return state;
}

export function finalizeDraft(state) {
  if (state.finalized) return state.result;
  for (const [property, child] of state.drafts) {
    const childValue = finalizeDraft(child);
    const source = state.copy || state.base;
    const current = source[property];
    if (childValue !== child.base || current === child.proxy) {
      prepareCopy(state);
      state.copy[property] = childValue;
    }
  }
  if (state.copy) {
    for (const property of state.assigned) {
      if (!Object.prototype.hasOwnProperty.call(state.copy, property)) continue;
      state.copy[property] = finalizeValue(state.copy[property]);
    }
  }
  state.finalized = true;
  state.result = state.copy || state.base;
  return state.result;
}

export function finalizeValue(value) {
  const draftState = value?.[DRAFT_STATE];
  if (draftState) return finalizeDraft(draftState);
  if (Array.isArray(value)) {
    let result = value;
    for (let index = 0; index < value.length; index++) {
      const next = finalizeValue(value[index]);
      if (next === value[index]) continue;
      if (result === value) result = value.slice();
      result[index] = next;
    }
    return result;
  }
  if (isDraftable(value)) {
    let result = value;
    for (const property of Reflect.ownKeys(value)) {
      const next = finalizeValue(value[property]);
      if (next === value[property]) continue;
      if (result === value) result = { ...value };
      result[property] = next;
    }
    return result;
  }
  return value;
}

export function prepareCopy(state) {
  if (state.copy) return;
  state.copy = Array.isArray(state.base) ? state.base.slice() : { ...state.base };
}

export function isDraftable(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function materializeDraft(state, seen) {
  if (seen.has(state)) return seen.get(state);
  const source = state.copy || state.base;
  const result = Array.isArray(source) ? [] : {};
  seen.set(state, result);
  for (const property of Reflect.ownKeys(source)) {
    if (Array.isArray(source) && property === "length") continue;
    const child = state.drafts.get(property);
    const current = child?.proxy ?? source[property];
    // Helpers commonly create a new plain object/array around values read
    // from a draft (spread, map, filter, catalog merge). Materializing only a
    // direct child leaves those nested proxies inside an apparently ordinary
    // record, where BroadcastChannel and save-worker structured cloning fail.
    result[property] = materializeTreeValue(current, seen);
  }
  return result;
}

function materializeTreeValue(value, seen) {
  const state = value?.[DRAFT_STATE];
  if (state) return materializeDraft(state, seen);
  if (!isDraftable(value)) return value;
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const property of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && property === "length") continue;
    result[property] = materializeTreeValue(value[property], seen);
  }
  return result;
}
