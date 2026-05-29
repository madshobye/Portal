#include <Arduino.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_MQTT_ENABLED
#include <MQTT.h>

static WiFiClient g_mqttNet;
static MQTTClient g_mqtt(P1_EMBED_MQTT_BUFFER_BYTES);
static bool g_mqttBegun = false;
static unsigned long g_mqttLastAttemptMs = 0;
static String g_mqttDeviceId;
static String g_mqttClientId;
static String g_mqttCmdTopicPrefix;
static String g_mqttEvtTopic;
static String g_mqttHelloTopic;
static String g_mqttScriptInTopic;
static String g_mqttScriptOutTopic;
static String g_mqttActiveResponseTopic;

static String mqttNormalizeTopicPart(String value) {
  value.trim();
  value.toLowerCase();
  value.replace(" ", "-");
  return value;
}

static String mqttDeviceTopicId() {
  String id = configDeviceId();
  if (id.length() >= 6) {
    return mqttNormalizeTopicPart(String("p1-embed-") + id.substring(id.length() - 6));
  }
  return mqttNormalizeTopicPart(id.length() ? id : configDeviceName());
}

static String mqttBaseTopic() {
  return String("p1e/") + configMqttRoot() + "/" + g_mqttDeviceId;
}

static String mqttResponseTopic(const String& clientId) {
  return mqttBaseTopic() + "/res/" + mqttNormalizeTopicPart(clientId);
}

static String mqttClientFromCommandTopic(const String& topic) {
  String prefix = g_mqttCmdTopicPrefix + "/";
  if (!topic.startsWith(prefix)) return "";
  String clientId = topic.substring(prefix.length());
  clientId.trim();
  return clientId;
}

static bool mqttIsScriptInTopic(const String& topic) {
  return g_mqttScriptInTopic.length() && topic == g_mqttScriptInTopic;
}

static bool mqttFrameIsResponse(const uint8_t* data, size_t len) {
  return data && len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == 1;
}

static bool mqttFrameIsEvent(const uint8_t* data, size_t len) {
  return data && len >= 2 && (data[0] & 0xf0) == 0x90 && data[1] == 2;
}

static void mqttPublishHello() {
  String payload = "{";
  payload += "\"deviceId\":" + jsonString(configDeviceId());
  payload += ",\"deviceName\":" + jsonString(configDeviceName());
  payload += ",\"topicId\":" + jsonString(g_mqttDeviceId);
  payload += ",\"firmwareVersion\":" + jsonString(P1_EMBED_FIRMWARE_VERSION);
  payload += ",\"transport\":\"mqtt.msgpack\"";
  payload += "}";
  g_mqtt.publish(g_mqttHelloTopic, payload, true, 0);
}

static void mqttHandleMessage(MQTTClient*, char topic[], char bytes[], int length) {
  if (!topic || !bytes || length <= 0) return;
  String topicText(topic);
  if (mqttIsScriptInTopic(topicText)) {
    String message;
    message.reserve(length);
    for (int i = 0; i < length; i++) message += bytes[i];
    message.trim();
    if (!wrenchInboxPush("mqtt", message)) {
      debugLog("warn", "mqtt", "script text inbox full");
    }
    return;
  }

  String clientId = mqttClientFromCommandTopic(topicText);
  if (clientId.length() == 0) return;
  g_mqttActiveResponseTopic = mqttResponseTopic(clientId);
  protocolHandleBytes(reinterpret_cast<const uint8_t*>(bytes), (size_t)length);
  g_mqttActiveResponseTopic = "";
}

static bool mqttConnect() {
  g_mqttDeviceId = mqttDeviceTopicId();
  g_mqttClientId = String("p1e-device-") + g_mqttDeviceId;
  g_mqttCmdTopicPrefix = mqttBaseTopic() + "/cmd";
  g_mqttEvtTopic = mqttBaseTopic() + "/evt";
  g_mqttHelloTopic = mqttBaseTopic() + "/hello";
  g_mqttScriptInTopic = mqttBaseTopic() + "/script/in";
  g_mqttScriptOutTopic = mqttBaseTopic() + "/script/out";

  if (!g_mqttBegun) {
    g_mqtt.begin(configMqttHost().c_str(), configMqttPort(), g_mqttNet);
    g_mqtt.setOptions(15, true, 1000);
    g_mqtt.onMessageAdvanced(mqttHandleMessage);
    g_mqttBegun = true;
  }

  debugLog("debug", "mqtt", "connecting");
  String user = configMqttUser();
  String pass = configMqttPassword();
  bool ok = g_mqtt.connect(g_mqttClientId.c_str(), user.c_str(), pass.c_str());
  if (!ok) {
    debugLog("debug", "mqtt", "connect failed");
    return false;
  }

  g_mqtt.subscribe(g_mqttCmdTopicPrefix + "/+");
  g_mqtt.subscribe(g_mqttScriptInTopic);
  mqttPublishHello();
  debugLog("info", "mqtt", "open");
  return true;
}

void mqttTransportBegin() {
  g_mqttDeviceId = mqttDeviceTopicId();
}

void mqttTransportApplyConfig() {
  if (g_mqtt.connected()) g_mqtt.disconnect();
  g_mqttBegun = false;
  g_mqttCmdTopicPrefix = "";
  g_mqttEvtTopic = "";
  g_mqttHelloTopic = "";
  g_mqttScriptInTopic = "";
  g_mqttScriptOutTopic = "";
  g_mqttLastAttemptMs = 0;
}

void mqttTransportLoop() {
  if (!wifiIsConnected()) {
    if (g_mqtt.connected()) {
      g_mqtt.disconnect();
      debugLog("debug", "mqtt", "disconnected");
    }
    return;
  }

  if (g_mqtt.connected()) {
    g_mqtt.loop();
    return;
  }

  unsigned long now = millis();
  if (now - g_mqttLastAttemptMs < P1_EMBED_MQTT_RECONNECT_MS) return;
  g_mqttLastAttemptMs = now;
  mqttConnect();
}

void mqttTransportSendBytes(const uint8_t* data, size_t len) {
  if (!data || len == 0 || len > P1_EMBED_MQTT_BUFFER_BYTES || !g_mqtt.connected()) return;
  if (mqttFrameIsResponse(data, len)) {
    if (g_mqttActiveResponseTopic.length() == 0) return;
    g_mqtt.publish(g_mqttActiveResponseTopic.c_str(), reinterpret_cast<const char*>(data), (int)len, false, 0);
    return;
  }
  if (mqttFrameIsEvent(data, len) || g_mqttEvtTopic.length()) {
    g_mqtt.publish(g_mqttEvtTopic.c_str(), reinterpret_cast<const char*>(data), (int)len, false, 0);
  }
}

void mqttTransportSendScriptText(const String& message, bool newline) {
  if (!g_mqtt.connected() || !g_mqttScriptOutTopic.length()) return;
  String payload = message;
  if (newline && !payload.endsWith("\n")) payload += "\n";
  if (!payload.length()) return;
  g_mqtt.publish(g_mqttScriptOutTopic.c_str(), payload.c_str(), payload.length(), false, 0);
}

bool mqttTransportConnected() {
  return g_mqtt.connected();
}

String mqttTransportStatusJson() {
  String out = "{";
  out += "\"enabled\":true";
  out += ",\"connected\":" + String(g_mqtt.connected() ? "true" : "false");
  out += ",\"host\":" + jsonString(configMqttHost());
  out += ",\"port\":" + String(configMqttPort());
  out += ",\"root\":" + jsonString(configMqttRoot());
  out += ",\"deviceId\":" + jsonString(g_mqttDeviceId);
  out += ",\"cmd\":" + jsonString(g_mqttCmdTopicPrefix);
  out += ",\"evt\":" + jsonString(g_mqttEvtTopic);
  out += ",\"scriptIn\":" + jsonString(g_mqttScriptInTopic);
  out += ",\"scriptOut\":" + jsonString(g_mqttScriptOutTopic);
  out += "}";
  return out;
}

#else
void mqttTransportBegin() {}
void mqttTransportLoop() {}
void mqttTransportSendBytes(const uint8_t*, size_t) {}
void mqttTransportSendScriptText(const String&, bool) {}
bool mqttTransportConnected() { return false; }
String mqttTransportStatusJson() { return "{\"enabled\":false,\"connected\":false}"; }
void mqttTransportApplyConfig() {}
#endif
