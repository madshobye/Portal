export function createRegistryCache() {
  const values = new Map();

  return {
    get(key, createValue) {
      if (values.has(key)) return values.get(key);
      const value = createValue();
      values.set(key, value);
      return value;
    },
  };
}
