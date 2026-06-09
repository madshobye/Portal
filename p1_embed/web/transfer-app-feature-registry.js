import { createTransferFeatureRegistry } from "./transfer-feature-registry.js?v=0.1.87-ui725";

export function createTransferAppFeatureRegistry(options = {}) {
  let transferFeatureRegistry = null;

  function getTransferFeatureRegistry() {
    if (transferFeatureRegistry) return transferFeatureRegistry;
    transferFeatureRegistry = createTransferFeatureRegistry(options);
    return transferFeatureRegistry;
  }

  return {
    getBoardDownloadService: () => getTransferFeatureRegistry().getBoardDownloadService(),
    getScriptDownloadService: () => getTransferFeatureRegistry().getScriptDownloadService(),
    getScriptUploadService: () => getTransferFeatureRegistry().getScriptUploadService(),
    getTransferFeatureRegistry,
    getTransferRegistry: () => getTransferFeatureRegistry().getTransferRegistry(),
  };
}
