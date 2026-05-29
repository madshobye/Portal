#pragma once

#include <Arduino.h>
#include "config.h"
#include "p1_msgpack.h"
#include "wrench.h"

struct P1WifiSnapshot {
  bool configured = false;
  const char* status = "unknown";
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
  int mqttAuthUserCount = 0;
  P1WifiSnapshot wifi;
};

struct P1DebugSnapshot {
  const char* level = "info";
  uint8_t levelValue = 2;
  uint32_t queueDrops = 0;
  uint32_t queueHighWater = 0;
};

struct P1ScriptErrorSnapshot {
  bool hasError = false;
  String phase;
  String code;
  String message;
  String details;
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

struct P1StatusSnapshot {
  uint32_t uptimeMs = 0;
  uint32_t heapSize = 0;
  uint32_t freeHeap = 0;
  uint32_t minFreeHeap = 0;
  uint32_t maxAllocHeap = 0;
  String deviceId;
  String deviceName;
  P1ScriptSnapshot script;
  P1WifiSnapshot wifi;
  P1ScriptErrorSnapshot lastError;
  P1DebugSnapshot debug;
};

void transportSerialBegin();
void transportSerialPoll();
void transportSendRaw(const char* data);
void transportSendLine(const String& line);
void webTransportBegin();
void webTransportLoop();
void webTransportSendLine(const String& line);
String webTransportStatusJson();
void webrtcTransportBegin();
void webrtcTransportLoop();
void webrtcTransportSendLine(const String& line);
void webrtcTransportSendBytes(const uint8_t* data, size_t len);
bool webrtcTransportDataChannelOpen();
String webrtcTransportStatusJson();
String webrtcTransportProbeJson();
void mqttTransportBegin();
void mqttTransportLoop();
void mqttTransportSendBytes(const uint8_t* data, size_t len);
void mqttTransportSendScriptText(const String& message, bool newline);
bool mqttTransportConnected();
String mqttTransportStatusJson();
void mqttTransportApplyConfig();

void memoryProfileBegin();
void memoryProfileReset();
void memoryProfileMark(const char* component, const char* phase);
String memoryProfileSummaryJson();
String memoryProfileJson(int limit = P1_EMBED_MEMORY_PROFILE_DEFAULT_LIMIT);

void protocolHandleLine(const char* line);
void protocolHandleBytes(const uint8_t* data, size_t len);
void protocolPollScriptJobs();
bool protocolHandleScriptSetCode(const String& id, const String& code, bool runAfterSet, bool saveAfterSet, bool sendResponse = true);
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
String debugEventStatusJson();
String debugEventStatusJson(const P1DebugSnapshot& snapshot);
void debugEventEmit(const String& name, const String& level, const String& category, const String& message, const String& dataFieldsJson = "");
void debugEventEmitFields(const String& name, const String& level, const String& category, const String& message, const P1EventField* fields, size_t fieldCount);
void debugEventSendLine(const String& line);
void debugLog(const String& level, const String& category, const String& message);
void debugError(const String& category, const String& code, const String& message);

void uiOutputFlush();

String jsonString(const String& s);
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
bool configAddMqttAuthUserKey(const String& username, const String& keyHex);
bool configRemoveMqttAuthUser(const String& username);
int configMqttAuthUserCount();
String configMqttAuthUserNameAt(int index);
bool configMqttAuthUserKey(const String& username, uint8_t outKey[32]);
bool configMqttAuthUserKey(const char* username, uint8_t outKey[32]);
bool configMqttEnabled();
bool configMqttAllowAnonymousUi();
bool configMqttAllowAnonymousScript();
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
String configAsJson();
String configAsJson(const P1ConfigSnapshot& snapshot);

void wifiBegin();
void wifiLoop();
void wifiReconnect();
void wifiDisconnect();
P1WifiSnapshot wifiSnapshot();
String wifiStatusJson();
String wifiStatusJson(const P1WifiSnapshot& snapshot);
bool wifiIsConnected();

bool scriptStoreBegin();
bool scriptStoreLoad(String& out);
bool scriptStoreSave(const String& code);
bool scriptStoreClear();
bool scriptStoreHasSaved();
bool scriptStoreLoadCurrent(String& out);
bool scriptStoreSaveCurrent(const String& code);
bool scriptStoreClearCurrent();
bool scriptStoreLoadIncoming(String& out);
bool scriptStoreSaveIncoming(const String& code);
bool scriptStoreBeginIncoming();
bool scriptStoreAppendIncoming(const String& chunk);
bool scriptStoreAppendIncomingBytes(const uint8_t* data, size_t len);
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
String wrenchRuntimeStatusJson();
void wrenchStop();
void wrenchReleaseCompiledProgram();
void wrenchBeginTransition(const String& reason);
void wrenchEndTransition();
bool wrenchCompileAndSet(const String& userCode, String& errOut);
bool wrenchRunCompiled(String& errOut);
bool wrenchHasCompiledProgram();
void wrenchRequestRun();
bool wrenchRunIsPending();
bool wrenchCompileAndRun(const String& userCode, String& errOut);
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
uint32_t uiInputQueued();
uint32_t uiInputDrops();

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
String uartStatusJson();

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
String httpFetchStatusJson();

void fastLedManagerBegin();
void fastLedReleaseScriptResources();
bool fastLedShow();
bool ledConfigureStrip(int strip, int pin, int count, int brightness);
bool ledRebootRequiredFor(int strip, int pin, int count);
bool ledReady(int strip);
int ledStripCount();
int ledPin(int strip);
int ledCount(int strip);
bool ledSetPixel(int strip, int index, int r, int g, int b);
bool ledFill(int strip, int r, int g, int b);
bool ledClear(int strip, bool show);
bool ledSetBrightness(int strip, int brightness);
String ledStatusJson();
