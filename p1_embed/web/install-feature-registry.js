import { WebSerialTransport } from "./protocol/WebSerialTransport.js?v=0.1.87-ui350";
import { P1WebFlasher } from "./web-flasher.js?v=0.1.87-ui348";
import {
  firmwareCurrentVersion,
  firmwarePanelState,
  firmwareUpdateCandidateFor,
  firmwareUpdateFailureMessage,
  firmwareUpdatePayload,
} from "./firmware-update-model.js?v=0.1.87-ui755";
import { createInstallFirmwareRegistry } from "./install-firmware-registry.js?v=0.1.87-ui755";

const INSTALL_MANIFEST = "bin/p1e-firmware-safeboot.json";
const FIRMWARE_RELEASES_MANIFEST = "bin/p1e-firmware-releases.json";

export function createInstallFeatureRegistry({
  fields,
  formatBytes,
  getAppBusy,
  getClient,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionShellController,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getLastInfo,
  getLastStatus,
  getTransport,
  localStorageRef,
  navigatorRef,
  setConnectionIntentWanted,
  setLastInfo,
  setLastStatus,
  settle,
  storage,
  windowRef,
} = {}) {
  let installFirmwareRegistry = null;
  let flasher = null;
  let flasherBusy = false;
  let firmwareUpdateBusy = false;
  let firmwareReleasesManifest = null;
  let firmwareReleasesManifestUrl = "";
  let firmwareUpdateCandidate = null;

  function getInstallFirmwareRegistry() {
    if (installFirmwareRegistry) return installFirmwareRegistry;
    installFirmwareRegistry = createInstallFirmwareRegistry({
      P1WebFlasher,
      WebSerialTransport,
      firmwareCurrentVersion,
      firmwarePanelState,
      firmwareUpdateCandidateFor,
      firmwareUpdateFailureMessage,
      firmwareUpdatePayload,
      fields,
      formatBytes,
      getAppBusy,
      getClient,
      getCommandConsoleService,
      getConnectionAddressService,
      getConnectionShellController,
      getConnectionUiStateController,
      getConsoleController,
      getDeviceRefreshService,
      getDeviceStateController,
      getFirmwareReleasesManifest: () => firmwareReleasesManifest,
      getFirmwareReleasesManifestUrl: () => firmwareReleasesManifestUrl,
      getFirmwareUpdateBusy: () => firmwareUpdateBusy,
      getFirmwareUpdateCandidate: () => firmwareUpdateCandidate,
      getFlasher: () => flasher,
      getFlasherBusy: () => flasherBusy,
      getLastInfo,
      getLastStatus,
      getTransport,
      installManifest: INSTALL_MANIFEST,
      localStorageRef,
      manifestLabel: FIRMWARE_RELEASES_MANIFEST,
      navigatorRef,
      setConnectionIntentWanted,
      setFirmwareReleasesManifest: (manifest) => {
        firmwareReleasesManifest = manifest;
      },
      setFirmwareReleasesManifestUrl: (url) => {
        firmwareReleasesManifestUrl = url;
      },
      setFirmwareUpdateBusy: (busy) => {
        firmwareUpdateBusy = busy;
      },
      setFirmwareUpdateCandidate: (candidate) => {
        firmwareUpdateCandidate = candidate;
      },
      setFlasher: (value) => {
        flasher = value;
      },
      setFlasherBusy: (busy) => {
        flasherBusy = busy;
      },
      setLastInfo,
      setLastStatus,
      settle,
      storage,
      windowRef,
    });
    return installFirmwareRegistry;
  }

  return {
    getFirmwareUpdateController: () => getInstallFirmwareRegistry().getFirmwareUpdateController(),
    getInstallPanelController: () => getInstallFirmwareRegistry().getInstallPanelController(),
    getInstallWorkflowController: () => getInstallFirmwareRegistry().getInstallWorkflowController(),
  };
}
