import { createConnectionFeatureRegistry } from "./connection-feature-registry.js?v=0.1.87-ui753";

export function createConnectionAppFeatureRegistry(options = {}) {
  let connectionFeatureRegistry = null;

  function getConnectionFeatureRegistry() {
    if (connectionFeatureRegistry) return connectionFeatureRegistry;
    connectionFeatureRegistry = createConnectionFeatureRegistry(options);
    return connectionFeatureRegistry;
  }

  return {
    getConnectionFeatureRegistry,
    getConnectionHistoryActions: () => getConnectionFeatureRegistry().getConnectionHistoryActions(),
    getConnectionMemoryService: () => getConnectionFeatureRegistry().getConnectionMemoryService(),
    getConnectionReconnectService: () => getConnectionFeatureRegistry().getConnectionReconnectService(),
    getConnectionRuntimeRegistry: () => getConnectionFeatureRegistry().getConnectionRuntimeRegistry(),
    getConnectionStartupService: () => getConnectionFeatureRegistry().getConnectionStartupService(),
    getConnectionTransportSession: () => getConnectionFeatureRegistry().getConnectionTransportSession(),
  };
}
