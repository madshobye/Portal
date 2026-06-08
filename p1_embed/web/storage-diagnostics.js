export function createStorageDiagnostics({
  storeCount,
} = {}) {
  function localStorageArrayCount(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return "missing";
      const value = JSON.parse(raw || "[]");
      return Array.isArray(value) ? String(value.length) : "not-array";
    } catch {
      return "invalid-json";
    }
  }

  async function indexedDbStoreCount(storeName) {
    return await storeCount(storeName);
  }

  return {
    indexedDbStoreCount,
    localStorageArrayCount,
  };
}
