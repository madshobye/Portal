import { createRegistryCache } from "./registry-cache.js?v=0.1.87-ui728";

export function createRegistryContext({
  chatState,
  connectionState,
  documentRef,
  fields,
  fetchRef,
  getAccessors,
  getCircuitView,
  localStorageRef,
  navigatorRef,
  projectState,
  registryCache = createRegistryCache(),
  requestAnimationFrameRef,
  setCircuitView,
  URLRef,
  windowRef,
} = {}) {
  const accessor = (name) => (...args) => getAccessors()[name](...args);

  return {
    accessor,
    chatState,
    connectionState,
    documentRef,
    fields,
    fetchRef,
    getAccessors,
    getCircuitView,
    localStorageRef,
    navigatorRef,
    projectState,
    registryCache,
    requestAnimationFrameRef,
    setCircuitView,
    URLRef,
    windowRef,
  };
}
