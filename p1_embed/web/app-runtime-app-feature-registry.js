import { createAppRuntimeFeatureRegistry } from "./app-runtime-feature-registry.js?v=0.1.87-ui755";

export function createAppRuntimeAppFeatureRegistry(options = {}) {
  let appRuntimeFeatureRegistry = null;

  function getAppRuntimeFeatureRegistry() {
    if (appRuntimeFeatureRegistry) return appRuntimeFeatureRegistry;
    appRuntimeFeatureRegistry = createAppRuntimeFeatureRegistry(options);
    return appRuntimeFeatureRegistry;
  }

  return {
    getAppBootstrapController: () => getAppRuntimeFeatureRegistry().getAppBootstrapController(),
    getAppControlBindingsController: () => getAppRuntimeFeatureRegistry().getAppControlBindingsController(),
    getAppRuntimeFeatureRegistry,
    getAppRuntimeRegistry: () => getAppRuntimeFeatureRegistry().getAppRuntimeRegistry(),
    getPageLifecycleController: () => getAppRuntimeFeatureRegistry().getPageLifecycleController(),
  };
}
