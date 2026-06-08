export function createAppState() {
  let transport = null;
  let client = null;
  let lastInfo = null;
  let lastStatus = null;
  let isBusy = false;
  let suppressConnectionLogs = false;
  let isUnloading = false;
  let busyLabel = "";
  let connectionGeneration = 0;
  let connectionVerified = false;
  let reconnectAfterReturn = false;
  let reconnectAfterReturnAttempted = false;
  let lastLoggedScriptErrorCount = 0;
  let wifiDraftDirty = false;
  let lastConfig = null;

  const chatState = { busy: false };
  const connectionState = {
    get busyLabel() { return busyLabel; },
    set busyLabel(value) { busyLabel = value; },
    get client() { return client; },
    set client(value) { client = value; },
    get connectionGeneration() { return connectionGeneration; },
    set connectionGeneration(value) { connectionGeneration = value; },
    get connectionVerified() { return connectionVerified; },
    set connectionVerified(value) { connectionVerified = value; },
    get isBusy() { return isBusy; },
    set isBusy(value) { isBusy = value; },
    get isUnloading() { return isUnloading; },
    set isUnloading(value) { isUnloading = value; },
    get lastConfig() { return lastConfig; },
    set lastConfig(value) { lastConfig = value; },
    get lastInfo() { return lastInfo; },
    set lastInfo(value) { lastInfo = value; },
    get lastLoggedScriptErrorCount() { return lastLoggedScriptErrorCount; },
    set lastLoggedScriptErrorCount(value) { lastLoggedScriptErrorCount = value; },
    get lastStatus() { return lastStatus; },
    set lastStatus(value) { lastStatus = value; },
    get reconnectAfterReturn() { return reconnectAfterReturn; },
    set reconnectAfterReturn(value) { reconnectAfterReturn = value; },
    get reconnectAfterReturnAttempted() { return reconnectAfterReturnAttempted; },
    set reconnectAfterReturnAttempted(value) { reconnectAfterReturnAttempted = value; },
    get suppressConnectionLogs() { return suppressConnectionLogs; },
    set suppressConnectionLogs(value) { suppressConnectionLogs = value; },
    get transport() { return transport; },
    set transport(value) { transport = value; },
    get wifiDraftDirty() { return wifiDraftDirty; },
    set wifiDraftDirty(value) { wifiDraftDirty = value; },
  };
  const projectState = {
    chatMessages: [],
    currentProjectId: "",
    currentRevisionId: "",
    projectCache: [],
    currentSketchName: "",
    currentSketchSource: "",
    currentSketchVersionName: "",
    currentSketchDirty: false,
    currentSketchSaved: true,
    currentProjectDescription: "",
    currentProjectDescriptionSource: "",
    currentProjectSpecificationMode: "middle",
    currentProjectSpecificationModeSource: "middle",
    currentProjectCircuit: null,
    circuitChatLayout: null,
    projectSelectTimer: null,
    revisionSelectTimer: null,
  };

  return {
    chatState,
    connectionState,
    projectState,
  };
}
