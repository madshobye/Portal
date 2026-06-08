export function createMqttSettingsPanelController({
  fields,
  configFromStorageAndDevice,
  getLastConfig,
  renderOnlineAuthUsers,
}) {
  let accessBaseline = null;

  function populate() {
    const cfg = configFromStorageAndDevice();
    const lastConfig = getLastConfig();
    fields.mqttHost.value = cfg.mqttHost;
    fields.mqttPort.value = String(cfg.mqttPort || 1883);
    fields.mqttRoot.value = cfg.mqttRoot;
    fields.mqttUser.value = cfg.mqttUser;
    fields.mqttPassword.value = "";
    fields.mqttPassword.placeholder = lastConfig?.mqttPasswordSet ? "saved on board" : "default";
    fields.mqttEnabled.checked = cfg.mqttEnabled;
    fields.allowUnauthenticatedAccess.checked = cfg.allowUnauthenticatedAccess;
    fields.accessGuestUi.checked = cfg.mqttAllowAnonymousUi;
    fields.accessGuestScript.checked = cfg.mqttAllowAnonymousScript;
    updateAccessSaveVisibility({
      allowUnauthenticatedAccess: cfg.allowUnauthenticatedAccess,
      mqttAllowAnonymousUi: cfg.mqttAllowAnonymousUi,
      mqttAllowAnonymousScript: cfg.mqttAllowAnonymousScript,
    });
    renderOnlineAuthUsers();
  }

  function updateAccessSaveVisibility(baseline = null) {
    if (baseline && Object.hasOwn(baseline, "mqttAllowAnonymousUi")) {
      accessBaseline = {
        allowUnauthenticatedAccess: Boolean(baseline.allowUnauthenticatedAccess),
        mqttAllowAnonymousUi: Boolean(baseline.mqttAllowAnonymousUi),
        mqttAllowAnonymousScript: Boolean(baseline.mqttAllowAnonymousScript),
      };
    }
    if (!fields.accessSave) return;
    if (!accessBaseline) {
      fields.accessSave.hidden = true;
      return;
    }
    const changed =
      Boolean(fields.allowUnauthenticatedAccess?.checked) !== Boolean(accessBaseline.allowUnauthenticatedAccess) ||
      Boolean(fields.accessGuestUi?.checked) !== Boolean(accessBaseline.mqttAllowAnonymousUi) ||
      Boolean(fields.accessGuestScript?.checked) !== Boolean(accessBaseline.mqttAllowAnonymousScript);
    fields.accessSave.hidden = !changed;
  }

  return {
    populate,
    updateAccessSaveVisibility,
  };
}
