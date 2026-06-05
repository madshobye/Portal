#pragma once

#include <Arduino.h>
#include "config.h"
#include "p1_msgpack.h"
#include "wrench.h"

static constexpr size_t P1_EMBED_LEGACY_SCRIPT_JSON_MAX_BYTES = 1024;

struct P1WifiSnapshot {
  bool configured = false;
  String status = "unknown";
  bool connected = false;
  int networkIndex = 0;
  int networkCount = 0;
  String ssid;
  String ip;
  int rssi = 0;
  String mac;
};

struct P1ConfigSnapshot {
  String deviceId;
  String deviceName;
  String projectId;
  String projectName;
  String revisionId;
  String scriptName;
  String timezone;
  String wifiSsid;
  bool wifiPasswordSet = false;
  int wifiNetworkCount = 0;
  String mqttHost;
  int mqttPort = 1883;
  String mqttRoot;
  String mqttUser;
  bool mqttPasswordSet = false;
  bool mqttEnabled = true;
  bool mqttAllowAnonymousUi = false;
  bool mqttAllowAnonymousScript = false;
  bool mqttGuestUiKeySet = false;
  String mqttGuestUiKey;
  int onlineAuthUserCount = 0;
  int onlineAuthUserMax = P1_EMBED_MQTT_MAX_USERS;
  P1WifiSnapshot wifi;
};

enum P1OnlineAuthUserAddResult : uint8_t {
  P1_ONLINE_AUTH_USER_ADDED = 0,
  P1_ONLINE_AUTH_USER_EMPTY_NAME,
  P1_ONLINE_AUTH_USER_BAD_KEY,
  P1_ONLINE_AUTH_USER_LIMIT
};

struct P1DebugSnapshot {
  const char* level = "info";
  uint8_t levelValue = 2;
  uint32_t queueDrops = 0;
  uint32_t queueHighWater = 0;
};

struct P1ScriptErrorSnapshot {
  bool hasError = false;
  const char* phase = "";
  const char* code = "";
  const char* message = "";
  const char* details = "";
  uint32_t atMs = 0;
  uint32_t count = 0;
};

struct P1ScriptSnapshot {
  String code;
  const char* state = "empty";
  bool stored = false;
  const char* runState = "ok";
  bool runPending = false;
  bool verificationArmed = false;
  uint32_t bytes = 0;
  uint32_t hash = 0;
  bool hasSetup = false;
  bool hasLoop = false;
  bool taskRunning = false;
  uint32_t loopCount = 0;
  float loopFps = 0.0f;
  bool loopHung = false;
  uint32_t taskStackHighWater = 0;
};

struct P1ScriptChunkGetResponse {
  uint32_t offset = 0;
  uint32_t nextOffset = 0;
  uint32_t scriptBytes = 0;
  bool done = true;
  String chunk;
  const char* state = "empty";
  const char* runState = "ok";
  String revisionId;
  String scriptName;
};

struct P1StatusSnapshot {
  uint32_t uptimeMs = 0;
  uint32_t heapSize = 0;
  uint32_t freeHeap = 0;
  uint32_t minFreeHeap = 0;
  uint32_t maxAllocHeap = 0;
  bool timeSynced = false;
  String localTime;
  String timezone;
  String deviceId;
  String deviceName;
  P1ScriptSnapshot script;
  P1WifiSnapshot wifi;
  P1ScriptErrorSnapshot lastError;
  P1DebugSnapshot debug;
};

struct P1ReusableBuffer {
  uint8_t* data = nullptr;
  size_t capacity = 0;
  size_t emaNeed = 0;
  size_t peakNeed = 0;
  size_t lastNeed = 0;
  uint32_t lastUseMs = 0;
  uint32_t reuseCount = 0;
  uint32_t growCount = 0;
  uint32_t shrinkCount = 0;
  uint32_t tempAllocCount = 0;
  uint32_t tempFreeCount = 0;
  uint32_t failCount = 0;
};

struct P1ReusableBufferHandle {
  uint8_t* data = nullptr;
  size_t capacity = 0;
  bool temporary = false;
};

struct P1MemoryProfileSummary {
  bool enabled = false;
  uint16_t capacity = 0;
  uint16_t samples = 0;
  uint32_t staticBytes = 0;
  uint32_t baseFreeHeap = 0;
  uint32_t baseMaxAllocHeap = 0;
  uint32_t currentFreeHeap = 0;
  uint32_t currentMaxAllocHeap = 0;
  uint32_t currentMinFreeHeap = 0;
  uint32_t worstFreeHeap = 0;
  uint32_t worstMaxAllocHeap = 0;
};

struct P1WrenchAllocStats {
  uint32_t allocCount = 0;
  uint32_t freeCount = 0;
  uint32_t failCount = 0;
  uint32_t externalFreeCount = 0;
  uint32_t requestedBytes = 0;
  uint32_t allocatedBytes = 0;
  uint32_t freedBytes = 0;
  uint32_t activeBytes = 0;
  uint32_t highWaterBytes = 0;
  uint32_t largestRequest = 0;
  uint32_t largestAllocated = 0;
  uint32_t failedRequest = 0;
};

struct P1WrenchRuntimeSnapshot {
  const char* phase = "unknown";
  bool transitionActive = false;
  uint8_t transitionDepth = 0;
  char transitionReason[40] = {0};
  uint32_t transitionMs = 0;
  uint32_t transitionRecoveries = 0;
  bool runPending = false;
  uint32_t bytecodeBytes = 0;
  int taskTargetCore = 0;
  int taskCore = -1;
  int compileTargetCore = 0;
  P1ReusableBuffer compileSourceBuffer;
  P1WrenchAllocStats lastCompileAlloc;
};

struct P1WebTransportSnapshot {
  bool enabled = false;
  bool started = false;
  uint16_t port = 0;
  uint8_t clients = 0;
  bool mdns = false;
  String host;
};

struct P1MqttTransportSnapshot {
  bool enabled = false;
  bool configured = false;
  bool connected = false;
  bool begun = false;
  bool queueAllocated = false;
  String host;
  uint16_t port = 0;
  String root;
  String deviceId;
  String cmd;
  String evt;
  String scriptIn;
  String scriptOut;
  bool authRequired = false;
  uint16_t onlineAuthUsers = 0;
  bool anonymousUi = false;
  bool anonymousScript = false;
  bool guestUiKeySet = false;
  int ownerCore = -1;
  int loopCore = -1;
  uint32_t outQueuedCount = 0;
  uint32_t outDropCount = 0;
  uint32_t outHighWater = 0;
  uint32_t connectCount = 0;
  uint32_t lostCount = 0;
  uint32_t loopClosedCount = 0;
  uint32_t publishFailCount = 0;
  uint32_t securePublishFailCount = 0;
  uint32_t scriptOutPublishFailCount = 0;
  uint32_t helloPublishFailCount = 0;
  uint32_t lastLostMs = 0;
  uint32_t lastLoopClosedMs = 0;
  uint32_t lastPublishFailMs = 0;
  P1ReusableBuffer secureFrameBuffer;
  P1ReusableBuffer eventBatchBuffer;
};

struct P1WebRtcTransportSnapshot {
  bool enabled = false;
  bool started = false;
  bool peerOpen = false;
  bool dataChannelOpen = false;
  bool signalingParked = false;
  const char* peerState = "";
  String peerId;
  String remoteId;
  const char* signaling = "";
  String host;
  String root;
  uint16_t port = 0;
  bool secure = false;
  uint32_t sendDrops = 0;
  uint32_t recvDrops = 0;
  uint32_t signalDrops = 0;
  uint32_t connectFailures = 0;
  char lastSocketReason[96] = {0};
  bool suspended = false;
  bool scriptSuspended = false;
};

struct P1LedStripSnapshot {
  uint8_t strip = 0;
  bool ready = false;
  int pin = -1;
  uint16_t count = 0;
  uint16_t capacity = 0;
  uint8_t brightness = 0;
  const char* chipset = "";
  const char* order = "";
};

struct P1LedStatusSnapshot {
  bool available = false;
  bool ready = false;
  uint8_t stripCount = 0;
  uint16_t totalLeds = 0;
  uint16_t maxLeds = 0;
  uint8_t maxStrips = 0;
  const char* driver = "";
  const char* chipset = "";
  const char* order = "";
  P1LedStripSnapshot strips[P1_EMBED_MAX_LED_STRIPS];
};

struct P1UartPortSnapshot {
  uint8_t uart = 0;
  bool active = false;
  int rx = -1;
  int tx = -1;
  uint32_t baud = 0;
  uint32_t available = 0;
};

struct P1UartStatusSnapshot {
  P1UartPortSnapshot ports[2];
  uint8_t portCount = 0;
};

struct P1HttpFetchStatusSnapshot {
  int lastCode = 0;
  bool lastTruncated = false;
  String lastError;
  String lastMessage;
  String lastDetails;
  uint32_t lastBodyBytes = 0;
  bool lastSecure = false;
  uint32_t lastDurationMs = 0;
  uint32_t maxResponseBytes = 0;
  uint32_t defaultTimeoutMs = 0;
  bool tlsInsecureDefault = false;
  bool failuresAreScriptErrors = false;
};

bool p1ReusableBufferAcquire(P1ReusableBuffer& buffer, size_t needed, size_t retainMin, size_t retainMax, P1ReusableBufferHandle& handle);
void p1ReusableBufferReleaseHandle(P1ReusableBuffer& buffer, P1ReusableBufferHandle& handle);
void p1ReusableBufferMaintain(P1ReusableBuffer& buffer, size_t retainMin, size_t retainMax, uint32_t idleMs);
void p1ReusableBufferRelease(P1ReusableBuffer& buffer);

void transportSerialBegin();
void transportSerialPoll();
void transportSendRaw(const char* data);
void transportSendMsgPackBytes(const uint8_t* data, size_t len);
bool transportSerialMsgPackMode();
void transportSerialSetMsgPackMode(bool enabled);
void transportSendLine(const String& line);
void webTransportBegin();
void webTransportLoop();
void webTransportSendLine(const String& line);
P1WebTransportSnapshot webTransportSnapshot();
void webrtcTransportBegin();
void webrtcTransportLoop();
void webrtcTransportSendLine(const String& line);
void webrtcTransportSendBytes(const uint8_t* data, size_t len);
bool webrtcTransportDataChannelOpen();
P1WebRtcTransportSnapshot webrtcTransportSnapshot();
String webrtcTransportProbeJson();
void mqttTransportBegin();
void mqttTransportLoop();
void mqttTransportSendBytes(const uint8_t* data, size_t len);
void mqttTransportSendScriptText(const String& message, bool newline);
bool mqttTransportConnected();
P1MqttTransportSnapshot mqttTransportSnapshot();
void mqttTransportApplyConfig();
void mqttTransportRequestApplyConfig();
void mqttTransportPrepareMemoryPressure();

void memoryProfileBegin();
void memoryProfileReset();
void memoryProfileMark(const char* component, const char* phase);
P1MemoryProfileSummary memoryProfileSummarySnapshot();
String memoryProfileSummaryJson();
String memoryProfileJson(int limit = P1_EMBED_MEMORY_PROFILE_DEFAULT_LIMIT);

void protocolHandleLine(const char* line, P1ProtocolSource source = P1_PROTOCOL_SOURCE_SERIAL);
void protocolHandleBytes(const uint8_t* data, size_t len, P1ProtocolSource source = P1_PROTOCOL_SOURCE_SERIAL);
void protocolPollScriptJobs();
bool protocolHandleScriptSetCode(const String& id, const String& code, bool runAfterSet, bool saveAfterSet, bool sendResponse = true);
void protocolPrepareScriptUpload();
void protocolPrepareMemoryPressure();
void protocolSendResponseOk(const String& id, const String& dataJson = "{}");
void protocolSendResponseError(const String& id, const String& code, const String& message);
void protocolEmitEvent(const String& name, const String& dataFieldsJson);
void protocolEmitEventFields(const char* name, const P1EventField* fields, size_t fieldCount);
void protocolEmitErrorEvent(const String& name, const String& code, const String& message);
void protocolEmitLog(const String& level, const String& message);
void protocolEmitPrint(const String& message, bool newline);
void protocolEmitMsgPackEventFields(const char* name, const P1EventField* fields, size_t fieldCount);
void protocolEmitMsgPackEventFields(const char* name, const char* level, const char* category, const char* message, const P1EventField* fields, size_t fieldCount);
void protocolEmitBoot();
void protocolEmitStatusEvent();
uint32_t protocolFnv1a(const String& s);
bool protocolValidateScriptIntegrity(const String& id, const String& code, int expectedBytes, const String& expectedHashHex);

void scriptErrorClear();
void scriptErrorSet(const String& phase, const String& code, const String& message, const String& detailFieldsJson = "");
void scriptErrorWarn(const String& phase, const String& code, const String& message, const String& detailFieldsJson = "");
bool scriptErrorHasLast();
P1ScriptErrorSnapshot scriptErrorSnapshot();
String scriptErrorLastCode();
String scriptErrorLastPhase();
String scriptErrorLastMessage();
String scriptErrorLastDetails();
uint32_t scriptErrorLastAtMs();
uint32_t scriptErrorCount();
String scriptErrorLastJson();
String scriptErrorLastJson(const P1ScriptErrorSnapshot& snapshot);
String scriptErrorSummaryJson();
String scriptErrorSummaryJson(const P1ScriptErrorSnapshot& snapshot);
const char* scriptErrorWrenchName(int code);

void debugEventBegin();
void debugEventFlush();
void debugEventSetLevel(uint8_t level);
bool debugEventSetLevelName(const String& level);
uint8_t debugEventLevel();
const char* debugLevelName(uint8_t level);
uint32_t debugEventDrops();
uint32_t debugEventHighWater();
P1DebugSnapshot debugEventSnapshot();
void debugEventEmit(const String& name, const String& level, const String& category, const String& message, const String& dataFieldsJson = "");
void debugEventEmit(const char* name, const char* level, const char* category, const char* message, const String& dataFieldsJson = "");
void debugEventEmitFields(const String& name, const String& level, const String& category, const String& message, const P1EventField* fields, size_t fieldCount);
void debugEventEmitFields(const char* name, const char* level, const char* category, const char* message, const P1EventField* fields, size_t fieldCount);
void debugEventSendLine(const String& line);
void debugLog(const String& level, const String& category, const String& message);
void debugLog(const char* level, const char* category, const char* message);
void debugError(const String& category, const String& code, const String& message);
void debugError(const char* category, const char* code, const char* message);

void uiOutputFlush();

String jsonString(const String& s);
String jsonString(const char* s);
String jsonPathGetRaw(const String& json, const String& path, bool* foundOut = nullptr);
bool jsonPathHas(const String& json, const String& path);
String jsonPairString(const String& key, const String& value);
String jsonPairRaw(const String& key, const String& rawValue);
String jsonPairIntValue(const String& key, int value);
String jsonPairFloatValue(const String& key, float value, int decimals);
String jsonPairBoolValue(const String& key, bool value);
String jsonBuildObject(const String& fields);
bool jsonGetString(const char* json, const char* key, String& out);
bool jsonGetBool(const char* json, const char* key, bool& out);
bool jsonGetInt(const char* json, const char* key, int& out);

void configLoad();
void configSave();
void configFactoryReset();
String configDeviceId();
String configDeviceName();
void configSetDeviceName(const String& value);
String configProjectId();
String configProjectName();
void configSetProject(const String& id, const String& name);
String configRevisionId();
void configSetRevisionId(const String& id);
String configScriptName();
void configSetScriptName(const String& name);
String configTimezone();
void configSetTimezone(const String& value);
void configApplyTimezone();
void configSetWifiSsid(const String& value);
void configSetWifiPassword(const String& value);
bool configRemoveWifiNetworkAt(int index);
void configSetMqttHost(const String& value);
void configSetMqttPort(int value);
void configSetMqttRoot(const String& value);
void configSetMqttUser(const String& value);
void configSetMqttPassword(const String& value);
void configSetMqttEnabled(bool value);
void configSetMqttAllowAnonymousUi(bool value);
void configSetMqttAllowAnonymousScript(bool value);
void configSetMqttGuestUiKey(const String& value);
bool configAddOnlineAuthUserKey(const String& username, const String& keyHex);
P1OnlineAuthUserAddResult configAddOnlineAuthUserKeyChecked(const String& username, const String& keyHex);
bool configRemoveOnlineAuthUser(const String& username);
int configOnlineAuthUserCount();
String configOnlineAuthUserNameAt(int index);
bool configOnlineAuthUserKey(const String& username, uint8_t outKey[32]);
bool configOnlineAuthUserKey(const char* username, uint8_t outKey[32]);
bool configMqttEnabled();
bool configMqttAllowAnonymousUi();
bool configMqttAllowAnonymousScript();
String configMqttGuestUiKey();
bool configMqttGuestUiKeyMatches(const String& value);
String configEnsureMqttGuestUiKey();
String configWifiSsid();
String configWifiPassword();
int configWifiNetworkCount();
String configWifiSsidAt(int index);
String configWifiPasswordAt(int index);
String configMqttHost();
int configMqttPort();
String configMqttRoot();
String configMqttUser();
String configMqttPassword();
P1ConfigSnapshot configSnapshot();

void wifiBegin();
void wifiLoop();
void wifiReconnect();
void wifiDisconnect();
P1WifiSnapshot wifiSnapshot();
P1WifiSnapshot wifiCachedSnapshot();
bool wifiIsConnected();

bool scriptStoreBegin();
bool scriptStoreLoad(String& out);
bool scriptStoreSave(const String& code);
bool scriptStoreClear();
bool scriptStoreHasSaved();
bool scriptStoreLoadCurrent(String& out);
bool scriptStoreReadCurrentChunk(uint32_t offset, uint32_t maxBytes, String& chunkOut, size_t& totalBytesOut);
bool scriptStoreSaveCurrent(const String& code);
bool scriptStoreClearCurrent();
bool scriptStoreLoadIncoming(String& out);
bool scriptStoreSaveIncoming(const String& code);
bool scriptStoreBeginIncoming();
bool scriptStoreAppendIncoming(const String& chunk);
bool scriptStoreAppendIncomingBytes(const uint8_t* data, size_t len);
bool scriptStoreIncomingInfo(size_t& bytesOut, uint32_t& hashOut);
bool scriptStoreCopyIncomingToBuffer(uint8_t* dst, size_t capacity, size_t& bytesOut);
bool scriptStoreCopyIncomingToCurrent();
bool scriptStoreCopyIncomingToSaved();
bool scriptStoreClearIncoming();
void scriptStoreSaveIncomingRunOptions(bool runAfterSet, bool saveAfterSet);
void scriptStoreLoadIncomingRunOptions(bool& runAfterSet, bool& saveAfterSet);
uint8_t scriptStoreLoadRunState();
void scriptStoreSaveRunState(uint8_t state);
const char* scriptStoreRunStateName(uint8_t state);
bool scriptStoreVerificationArmed();
void scriptStoreArmVerification();
void scriptStoreMarkVerificationFailed(const char* reason);
void scriptStoreVerifyIfDue();

String wrenchDefaultScript();
String wrenchCurrentScript();
uint32_t wrenchCurrentScriptBytes();
uint32_t wrenchCurrentScriptHash();
bool wrenchSetCurrentScript(const String& code);
bool wrenchSetCurrentScriptFromIncoming();
void wrenchTaskBegin();
const char* wrenchStateName();
bool wrenchHasSetup();
bool wrenchHasLoop();
bool wrenchTaskIsRunning();
uint32_t wrenchLoopCount();
uint32_t wrenchLastLoopMs();
uint32_t wrenchLastLoopDurationMs();
float wrenchLoopFps();
uint32_t wrenchCurrentLoopStartedAt();
uint32_t wrenchSlowLoopCount();
uint32_t wrenchHungLoopCount();
bool wrenchLoopIsHung();
uint32_t wrenchLockTimeoutCount();
uint32_t wrenchTaskStackHighWater();
void wrenchWatchdogPoll();
void wrenchRuntimePoll();
P1WrenchRuntimeSnapshot wrenchRuntimeSnapshot();
void wrenchStop();
void wrenchReleaseCompiledProgram();
void wrenchBeginTransition(const String& reason);
void wrenchEndTransition();
void wrenchReportCompileCrashIfAny();
bool wrenchCompileAndSet(const String& userCode, String& errOut);
bool wrenchCompileAndSetIncoming(size_t scriptBytes, uint32_t scriptHash, String& errOut);
bool wrenchRunCompiled(String& errOut);
bool wrenchHasCompiledProgram();
void wrenchRequestRun();
bool wrenchRunIsPending();
bool wrenchCompileAndRun(const String& userCode, String& errOut);
bool wrenchSetCompiledBytecode(const String& userCode, const uint8_t* bytecodeData, size_t bytecodeLen, String& errOut);
void wrenchRegisterBindings(WRState* wr);
const char* wrenchBindingNameForHash(uint32_t hash);

void wrenchInboxBegin();
bool wrenchInboxPush(const String& channel, const String& message);
bool wrenchInboxRead(String& channelOut, String& messageOut);
uint32_t wrenchInboxAvailable();
uint32_t wrenchInboxDrops();
void wrenchInboxClear();

bool uiInputIsChannel(const String& channel);
bool uiInputPush(const String& channel, const String& message);
void uiRuntimeReset(const String& title = "", bool emitReset = true);
uint32_t uiInputQueued();
uint32_t uiInputDrops();

struct P1HaInputEvent {
  char id[P1_EMBED_HA_ID_MAX];
  char type[P1_EMBED_HA_TYPE_MAX];
  float value = 0.0f;
};

void haBridgeBegin();
void haBridgeLoop();
void haRuntimeReset();
bool haBeginDevice(const String& name);
bool haDeclareSensor(const String& id, const String& name, float value, const String& unit);
bool haDeclareBinarySensor(const String& id, const String& name, bool value);
bool haDeclareSwitch(const String& id, const String& name, bool value);
bool haDeclareNumber(const String& id, const String& name, float value, float minValue, float maxValue, float step);
bool haDeclareButton(const String& id, const String& name);
bool haDeclareLight(const String& id, const String& name, float brightness);
bool haDeclareOnOffLight(const String& id, const String& name, bool value);
bool haDeclareRgbLight(const String& id, const String& name, float red, float green, float blue, float brightness);
bool haUpdateValue(const String& id, float value);
bool haUpdateRgbValue(const String& id, float red, float green, float blue, float brightness);
bool haInputValue(const String& id, float& valueOut);
bool haInputRgbValue(const String& id, float& redOut, float& greenOut, float& blueOut);
bool haInputChanged(const String& id);
bool haInputPop(P1HaInputEvent& event);
bool haInputTakeMatching(const String& id, const String& type, P1HaInputEvent& event);
bool haPressButton(const String& id);

void pwmManagerBegin();
bool pwmAnalogWrite(int pin, int value);
bool pwmAnalogSetResolution(int bits);
bool pwmAnalogSetFrequency(int pin, int hz);
bool pwmDetachPin(int pin);
bool pwmServoAttach(int pin);
bool pwmServoWrite(int pin, int angle);
bool pwmServoWriteMicroseconds(int pin, int us);
bool pwmServoDetach(int pin);
bool pwmFanAttach(int pin);
bool pwmFanWrite(int pin, int percent);
bool pwmFanWriteRaw(int pin, int duty);
bool pwmFanDetach(int pin);

void uartManagerBegin();
bool uartBegin(int uart, int rxPin, int txPin, int baud);
bool uartEnd(int uart);
int uartAvailable(int uart);
int uartReadByte(int uart);
String uartReadString(int uart, int maxLen);
int uartWriteString(int uart, const String& value);
int uartWriteByte(int uart, int value);
P1UartStatusSnapshot uartStatusSnapshot();

String httpFetchGet(const String& url, int maxBytes, int timeoutMs);
String httpFetchJsonGet(const String& url, const String& path, int maxBytes, int timeoutMs);
int httpFetchJsonGetInt(const String& url, const String& path, int maxBytes, int timeoutMs);
float httpFetchJsonGetFloat(const String& url, const String& path, int maxBytes, int timeoutMs);
bool httpFetchJsonGetBool(const String& url, const String& path, int maxBytes, int timeoutMs);
int httpFetchJson(const String& url, int maxBytes, int timeoutMs);
String httpFetchPost(const String& url, const String& body, const String& contentType, int maxBytes, int timeoutMs);
String httpFetchJsonValue(const String& path);
int httpFetchJsonValueInt(const String& path);
float httpFetchJsonValueFloat(const String& path);
bool httpFetchJsonValueBool(const String& path);
int httpFetchLastCode();
bool httpFetchLastTruncated();
String httpFetchLastError();
P1HttpFetchStatusSnapshot httpFetchStatusSnapshot();
void httpFetchReleaseBody();
void httpFetchPrepareMemoryPressure();

struct P1OtaRequest {
  String kind = "full";
  String url;
  String sha256;
  String fromSha256;
  String toSha256;
  uint32_t fromSize = 0;
  uint32_t toSize = 0;
  uint32_t patchSize = 0;
  uint32_t memorySize = 0;
  uint32_t segmentSize = 0;
};

struct P1OtaSafeBootStatusSnapshot {
  bool enabled = false;
  bool updaterPartition = false;
  String updaterLabel;
  bool pending = false;
  bool downloadPending = false;
  String kind;
  String phase;
  String url;
  bool sha256Set = false;
  bool fromSha256Set = false;
  bool toSha256Set = false;
  String lastError;
  uint32_t fromSize = 0;
  uint32_t toSize = 0;
  uint32_t patchSize = 0;
  uint32_t patchPartitionSize = 0;
  uint32_t memorySize = 0;
  uint32_t segmentSize = 0;
  bool restartPending = false;
};

P1OtaSafeBootStatusSnapshot otaSafeBootStatusSnapshot();
bool otaSafeBootRequestUpdate(const P1OtaRequest& request, String& errOut);
bool otaSafeBootRequestUpdate(const String& url, const String& sha256, String& errOut);
bool otaSafeBootClearRequest();
bool otaSafeBootBootUpdater(String& errOut);
void otaSafeBootHandleBootDownload();
void otaSafeBootPoll();

void fastLedManagerBegin();
void fastLedReleaseScriptResources();
bool fastLedShowActive();
void fastLedSkipFor(uint32_t ms);
bool fastLedShow();
void ledBeginScriptRun();
bool ledConfigureStrip(int strip, int pin, int count, int brightness);
bool ledConfigureStrip(int strip, int pin, int count, int brightness, const char* chipsetName, const char* orderName);
bool ledRebootRequiredFor(int strip, int pin, int count);
bool ledReady(int strip);
int ledStripCount();
int ledPin(int strip);
int ledCount(int strip);
bool ledSetPixel(int strip, int index, int r, int g, int b);
bool ledGetPixel(int strip, int index, int& r, int& g, int& b);
bool ledFill(int strip, int r, int g, int b);
bool ledClear(int strip, bool show);
bool ledClearAllPhysical(bool show);
bool ledSetBrightness(int strip, int brightness);
P1LedStatusSnapshot ledStatusSnapshot();
