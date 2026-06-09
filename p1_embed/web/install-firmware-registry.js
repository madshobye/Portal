import { createFirmwareUpdateController } from "./firmware-update-controller.js?v=0.1.87-ui722";
import { createInstallPanelController } from "./install-panel-controller.js?v=0.1.87-ui722";
import { createInstallWorkflowController } from "./install-workflow-controller.js?v=0.1.87-ui722";

export function createInstallFirmwareRegistry({
  P1WebFlasher,
  WebSerialTransport,
  firmwareCurrentVersion,
  firmwarePanelState,
  firmwareUpdateCandidateFor,
  firmwareUpdateFailureMessage,
  firmwareUpdatePayload,
  fields,
  formatBytes,
  getClient,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionShellController,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getFirmwareReleasesManifest,
  getFirmwareReleasesManifestUrl,
  getFirmwareUpdateBusy,
  getFirmwareUpdateCandidate,
  getFlasher,
  getAppBusy,
  getFlasherBusy,
  getLastInfo,
  getLastStatus,
  getTransport,
  installManifest,
  localStorageRef,
  manifestLabel,
  navigatorRef,
  setConnectionIntentWanted,
  setFirmwareReleasesManifest,
  setFirmwareReleasesManifestUrl,
  setFirmwareUpdateBusy,
  setFirmwareUpdateCandidate,
  setFlasher,
  setFlasherBusy,
  setLastInfo,
  setLastStatus,
  settle,
  storage,
  windowRef,
} = {}) {
  let installPanelController = null;
  let firmwareUpdateController = null;
  let installWorkflowController = null;

  function getInstallPanelController() {
    if (installPanelController) return installPanelController;
    installPanelController = createInstallPanelController({
      connectButton: fields.installConnect,
      flashButton: fields.installFlashManifest,
      clearDataInput: fields.installClearData,
      slowBaudInput: fields.installSlowBaud,
      goCodeButton: fields.installGoCode,
      manifestInput: fields.installManifest,
      firmwareVersion: fields.installFirmwareVersion,
      deviceNameInput: fields.installDeviceName,
      wifiSsidInput: fields.installWifiSsid,
      wifiPasswordInput: fields.installWifiPassword,
      progress: fields.installProgress,
      status: fields.installStatus,
      log: fields.installLog,
    });
    return installPanelController;
  }

  function getFirmwareUpdateController() {
    if (firmwareUpdateController) return firmwareUpdateController;
    firmwareUpdateController = createFirmwareUpdateController({
      fields,
      windowRef,
      manifestLabel,
      getManifest: getFirmwareReleasesManifest,
      setManifest: setFirmwareReleasesManifest,
      getManifestUrl: getFirmwareReleasesManifestUrl,
      setManifestUrl: setFirmwareReleasesManifestUrl,
      getCandidate: getFirmwareUpdateCandidate,
      setCandidate: setFirmwareUpdateCandidate,
      getBusy: getFirmwareUpdateBusy,
      setBusy: setFirmwareUpdateBusy,
      isAppBusy: getAppBusy,
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      getClient,
      getLastInfo,
      getLastStatus,
      refreshInfo: (options) => getDeviceRefreshService().refreshInfo(options),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      disconnectTransport: (options) => getConnectionShellController().disconnectTransport(options),
      autoReconnectLastConnection: (options) => getConnectionShellController().autoReconnectLastConnection(options),
      setConnectionIntentWanted,
      settle,
      logLine: (level, message) => getConsoleController().logLine(level, message),
      formatBytes,
      firmwareCurrentVersion,
      firmwareUpdateCandidateFor,
      firmwarePanelState,
      firmwareUpdatePayload,
      firmwareUpdateFailureMessage,
    });
    return firmwareUpdateController;
  }

  function getInstallWorkflowController() {
    if (installWorkflowController) return installWorkflowController;
    installWorkflowController = createInstallWorkflowController({
      P1WebFlasher,
      WebSerialTransport,
      storage,
      storageArea: localStorageRef,
      navigatorRef,
      windowRef,
      manifestDefault: installManifest,
      installPanel: getInstallPanelController(),
      hasFirmwareVersionField: () => Boolean(fields.installFirmwareVersion),
      shouldEraseAll: () => Boolean(fields.installClearData?.checked),
      getFlasher,
      setFlasher,
      getBusy: getFlasherBusy,
      setBusy: setFlasherBusy,
      getClient,
      getTransport,
      getLastInfo,
      setLastInfo,
      getLastStatus,
      setLastStatus,
      setConnectionIntentWanted,
      disconnectTransport: (options) => getConnectionShellController().disconnectTransport(options),
      connectTransport: (...args) => getConnectionShellController().connectTransport(...args),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      normalizeUsbHint: (hint) => getConnectionAddressService().normalizeUsbHint(hint),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      updateConfig: (config = {}) => getDeviceStateController().updateConfig(config),
      refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
      settle,
    });
    return installWorkflowController;
  }

  return {
    getFirmwareUpdateController,
    getInstallPanelController,
    getInstallWorkflowController,
  };
}
