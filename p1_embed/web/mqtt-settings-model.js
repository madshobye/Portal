export function mqttDefaults() {
  return {
    mqttHost: "public.cloud.shiftr.io",
    mqttPort: 1883,
    mqttRoot: "",
    mqttUser: "public",
    mqttPassword: "public",
  };
}

export function mqttRootOrEmpty(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/")
    .replace(/[+#]/g, "-");
}

export function mqttConfigFromStorageAndDevice({ storage, storageArea, lastConfig } = {}) {
  const defaults = mqttDefaults();
  const storedRoot = mqttRootOrEmpty(storageArea?.getItem(storage.mqttRoot));
  const deviceRoot = mqttRootOrEmpty(lastConfig?.mqttRoot);
  const storedPassword = storageArea?.getItem(storage.mqttPassword);
  const hasStoredPassword = storedPassword !== null && storedPassword !== undefined;
  const devicePassword = typeof lastConfig?.mqttPassword === "string" ? lastConfig.mqttPassword : "";
  const mqttPassword = hasStoredPassword
    ? storedPassword
    : devicePassword
      ? devicePassword
      : lastConfig?.mqttPasswordSet
        ? ""
        : defaults.mqttPassword;
  return {
    mqttHost: storageArea?.getItem(storage.mqttHost) || lastConfig?.mqttHost || defaults.mqttHost,
    mqttPort: Number(storageArea?.getItem(storage.mqttPort) || lastConfig?.mqttPort || defaults.mqttPort),
    mqttRoot: storedRoot || deviceRoot || defaults.mqttRoot,
    mqttUser: storageArea?.getItem(storage.mqttUser) || lastConfig?.mqttUser || defaults.mqttUser,
    mqttPassword,
    mqttEnabled: lastConfig?.mqttEnabled !== false,
    allowUnauthenticatedAccess: Boolean(lastConfig?.allowUnauthenticatedAccess),
    mqttAllowAnonymousUi: Boolean(lastConfig?.mqttAllowAnonymousUi),
    mqttAllowAnonymousScript: Boolean(lastConfig?.mqttAllowAnonymousScript),
  };
}

export function mqttTransportOptions(config, { isSecurePage = false, authProvider = null } = {}) {
  const cfg = config || mqttDefaults();
  const host = String(cfg.mqttHost || "").trim();
  const mqttUrl = host.startsWith("ws://") || host.startsWith("wss://")
    ? host
    : `${isSecurePage ? "wss" : "ws"}://${host}`;
  return {
    mqttUrl,
    username: cfg.mqttUser,
    password: cfg.mqttPassword,
    root: cfg.mqttRoot,
    authProvider,
  };
}

export function normalizeMqttHistoryConfig(config = {}) {
  const defaults = mqttDefaults();
  const host = String(config.mqttHost || config.host || defaults.mqttHost).trim() || defaults.mqttHost;
  const port = Number(config.mqttPort || config.port || defaults.mqttPort);
  return {
    mqttHost: host,
    mqttPort: Number.isFinite(port) && port > 0 ? port : defaults.mqttPort,
    mqttRoot: mqttRootOrEmpty(config.mqttRoot ?? config.root ?? ""),
    mqttUser: String(config.mqttUser || config.user || defaults.mqttUser).trim() || defaults.mqttUser,
    mqttPassword: String(config.mqttPassword || config.password || defaults.mqttPassword),
  };
}

export function storeMqttHistoryConfig(config = {}, { storage, storageArea } = {}) {
  const cfg = normalizeMqttHistoryConfig(config);
  if (cfg.mqttHost) storageArea.setItem(storage.mqttHost, cfg.mqttHost);
  if (cfg.mqttPort) storageArea.setItem(storage.mqttPort, String(cfg.mqttPort));
  if (cfg.mqttRoot) storageArea.setItem(storage.mqttRoot, cfg.mqttRoot);
  else storageArea.removeItem(storage.mqttRoot);
  if (cfg.mqttUser) storageArea.setItem(storage.mqttUser, cfg.mqttUser);
  if (Object.prototype.hasOwnProperty.call(config, "mqttPassword") || Object.prototype.hasOwnProperty.call(config, "password")) {
    if (cfg.mqttPassword) storageArea.setItem(storage.mqttPassword, cfg.mqttPassword);
    else storageArea.removeItem(storage.mqttPassword);
  }
  return cfg;
}

export function storeMqttConfigFields(config = {}, { storage, storageArea } = {}) {
  if (config.mqttHost) storageArea.setItem(storage.mqttHost, config.mqttHost);
  if (config.mqttPort) storageArea.setItem(storage.mqttPort, String(config.mqttPort));
  const mqttRoot = mqttRootOrEmpty(config.mqttRoot);
  if (mqttRoot) storageArea.setItem(storage.mqttRoot, mqttRoot);
  else storageArea.removeItem(storage.mqttRoot);
  if (config.mqttUser) storageArea.setItem(storage.mqttUser, config.mqttUser);
  if (config.mqttPassword) storageArea.setItem(storage.mqttPassword, config.mqttPassword);
  return {
    ...config,
    mqttRoot,
  };
}

export function storeMqttParams(params, { storage, storageArea } = {}) {
  const host = String(params.get("mqttHost") || "").trim();
  const port = Number(params.get("mqttPort") || 0);
  const root = mqttRootOrEmpty(params.get("mqttRoot"));
  const user = String(params.get("mqttUser") || "").trim();
  if (host) storageArea.setItem(storage.mqttHost, host);
  if (Number.isFinite(port) && port > 0) storageArea.setItem(storage.mqttPort, String(port));
  if (root) storageArea.setItem(storage.mqttRoot, root);
  if (user) storageArea.setItem(storage.mqttUser, user);
  return { mqttHost: host, mqttPort: port, mqttRoot: root, mqttUser: user };
}
