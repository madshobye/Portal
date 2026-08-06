import { UI_STATE_LIFETIMES } from "./ui-node.js";

const ADDRESS_PART = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]*$/;

export function uiStateAddressPart(value, fallback = "unknown") {
  const source = String(value || fallback);
  const encoded = encodeURIComponent(source)
    .replaceAll("%", "_")
    .replace(/[^a-zA-Z0-9._:@-]/g, (character) => `_${character.codePointAt(0).toString(16)}_`);
  return /^[a-zA-Z0-9]/.test(encoded) ? encoded : `id-${encoded}`;
}

export function normalizeUiStateAddress(address) {
  const normalized = String(address || "").trim().replace(/^\/+|\/+$/g, "");
  if (!normalized || !ADDRESS_PART.test(normalized) || normalized.includes("..")) {
    throw new Error(`UI_STATE_ADDRESS_INVALID:${address || "missing"}`);
  }
  return normalized;
}

export function createUiStateStore({
  namespace = "ui",
  storage = null,
  initial = {},
} = {}) {
  const storageKey = `${String(namespace || "ui")}:ui-state@1`;
  const listeners = new Set();
  let values = {
    ...readStorageRecord(storage, storageKey),
    ...(initial || {}),
  };

  function get(address, fallback) {
    const key = normalizeUiStateAddress(address);
    return Object.hasOwn(values, key) ? values[key] : fallback;
  }

  function set(address, value) {
    const key = normalizeUiStateAddress(address);
    if (Object.is(values[key], value) && Object.hasOwn(values, key)) return false;
    values = { ...values, [key]: value };
    writeStorageRecord(storage, storageKey, values);
    for (const listener of listeners) listener(key, value, snapshot());
    return true;
  }

  function remove(address) {
    const key = normalizeUiStateAddress(address);
    if (!Object.hasOwn(values, key)) return false;
    const next = { ...values };
    delete next[key];
    values = next;
    writeStorageRecord(storage, storageKey, values);
    for (const listener of listeners) listener(key, undefined, snapshot());
    return true;
  }

  function snapshot() {
    return Object.freeze({ ...values });
  }

  return Object.freeze({
    get,
    set,
    remove,
    snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("UI_STATE_LISTENER_REQUIRED");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      values = {};
      writeStorageRecord(storage, storageKey, values);
    },
  });
}

export function createUiStateController({
  ephemeral = createUiStateStore({ namespace: "ui-ephemeral" }),
  session = createUiStateStore({
    namespace: "ui-session",
    storage: globalThis.sessionStorage,
  }),
  project = createUiStateStore({ namespace: "ui-project" }),
} = {}) {
  const stores = Object.freeze({ ephemeral, session, project });
  const storeFor = (lifetime) => stores[lifetime] || stores[UI_STATE_LIFETIMES.SESSION];
  return Object.freeze({
    get(address, fallback, lifetime = UI_STATE_LIFETIMES.SESSION) {
      return storeFor(lifetime).get(address, fallback);
    },
    set(address, value, lifetime = UI_STATE_LIFETIMES.SESSION) {
      return storeFor(lifetime).set(address, value);
    },
    remove(address, lifetime = UI_STATE_LIFETIMES.SESSION) {
      return storeFor(lifetime).remove(address);
    },
    snapshot(lifetime = UI_STATE_LIFETIMES.SESSION) {
      return storeFor(lifetime).snapshot();
    },
  });
}

function readStorageRecord(storage, key) {
  if (!storage?.getItem) return {};
  try {
    const value = JSON.parse(storage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStorageRecord(storage, key, value) {
  if (!storage?.setItem) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // UI view-state persistence is best effort. The in-memory authority remains
    // usable when storage is unavailable or full.
  }
}
