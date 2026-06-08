export function createMqttShellService({
  storage,
  storageArea,
  getLastConfig,
  isSecurePage,
  authProvider,
  mqttConfigFromStorageAndDevice,
  mqttTransportOptions,
  storeMqttConfigFields,
  storeMqttHistoryConfig,
  storeMqttParams,
} = {}) {
  function configFromStorageAndDevice() {
    return mqttConfigFromStorageAndDevice({ storage, storageArea, lastConfig: getLastConfig?.() });
  }

  function transportOptions(config = null) {
    return mqttTransportOptions(config || configFromStorageAndDevice(), {
      isSecurePage: Boolean(isSecurePage?.()),
      authProvider,
    });
  }

  function applyConfig(config = {}) {
    return storeMqttHistoryConfig(config, { storage, storageArea });
  }

  function applyParams(params) {
    return storeMqttParams(params, { storage, storageArea });
  }

  function storeConfigFields(config = {}) {
    return storeMqttConfigFields(config, { storage, storageArea });
  }

  return {
    applyConfig,
    applyParams,
    configFromStorageAndDevice,
    storeConfigFields,
    transportOptions,
  };
}
