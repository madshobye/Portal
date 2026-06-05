#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "p1_embed_firmware.h"

static int g_httpLastCode = 0;
static bool g_httpLastTruncated = false;
static String g_httpLastError = "";
static String g_httpLastMessage = "";
static String g_httpLastDetails = "";
static P1ReusableBuffer g_httpBodyBuffer;
static size_t g_httpLastBodyLen = 0;
static uint32_t g_httpLastBodyAtMs = 0;
static bool g_httpLastSecure = false;
static uint32_t g_httpLastDurationMs = 0;

static constexpr size_t P1_HTTP_BODY_RETAIN_MIN = 512;
static constexpr size_t P1_HTTP_BODY_RETAIN_MAX = P1_EMBED_HTTP_MAX_RESPONSE_BYTES + 1;
static constexpr uint32_t P1_HTTP_BODY_IDLE_RELEASE_MS = 30000;

static bool httpValidUrl(const String& url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

static void httpSetError(const String& code, const String& message, const String& details = "") {
  g_httpLastError = code;
  g_httpLastMessage = message;
  g_httpLastDetails = details;
#if P1_EMBED_HTTP_FAILURES_ARE_SCRIPT_ERRORS
  scriptErrorSet("binding", code, message, details);
#endif
}

static String httpClientSecureLastError(NetworkClientSecure& client) {
  char err[96] = {0};
  int code = client.lastError(err, sizeof(err));
  if (code == 0) return "";
  String out = String(code);
  if (err[0]) {
    out += " ";
    out += err;
  }
  return out;
}

static void httpConfigureClient(HTTPClient& http, int timeoutMs) {
  http.setConnectTimeout(timeoutMs);
  http.setTimeout((uint16_t)timeoutMs);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.useHTTP10(true);
}

static void httpReleaseBodyStorage() {
  p1ReusableBufferRelease(g_httpBodyBuffer);
  g_httpLastBodyLen = 0;
  g_httpLastBodyAtMs = 0;
}

void httpFetchReleaseBody() {
  httpReleaseBodyStorage();
}

void httpFetchPrepareMemoryPressure() {
  httpReleaseBodyStorage();
}

static void httpMaintainBodyStorage() {
  if (!g_httpBodyBuffer.data || g_httpLastBodyLen == 0) return;
  if (P1_HTTP_BODY_IDLE_RELEASE_MS > 0 && millis() - g_httpLastBodyAtMs >= P1_HTTP_BODY_IDLE_RELEASE_MS) {
    httpReleaseBodyStorage();
  }
}

static String httpLastBodyString() {
  if (!g_httpBodyBuffer.data || g_httpLastBodyLen == 0) return "";
  return String(reinterpret_cast<const char*>(g_httpBodyBuffer.data));
}

static bool httpBeginWithClient(HTTPClient& http, NetworkClient& plain, NetworkClientSecure& secure, const String& url, int timeoutMs) {
  g_httpLastSecure = url.startsWith("https://");
  httpConfigureClient(http, timeoutMs);

  if (g_httpLastSecure) {
    secure.setHandshakeTimeout((unsigned long)max(1, timeoutMs / 1000));
#if P1_EMBED_HTTP_TLS_INSECURE_DEFAULT
    secure.setInsecure();
#endif
    if (!http.begin(secure, url)) {
      String details = "\"url\":" + jsonString(url);
      String tlsError = httpClientSecureLastError(secure);
      if (tlsError.length()) details += ",\"tlsError\":" + jsonString(tlsError);
      httpSetError("http_begin_failed", "HTTPS begin failed", details);
      return false;
    }
    return true;
  }

  if (!http.begin(plain, url)) {
    httpSetError("http_begin_failed", "HTTP begin failed", "\"url\":" + jsonString(url));
    return false;
  }
  return true;
}

static void httpSetRequestError(int code, NetworkClientSecure* secure = nullptr) {
  String err = HTTPClient::errorToString(code);
  String details = "\"httpCode\":" + String(code);
  if (secure) {
    String tlsError = httpClientSecureLastError(*secure);
    if (tlsError.length()) details += ",\"tlsError\":" + jsonString(tlsError);
  }
  httpSetError("http_request_failed", err, details);
}

static bool httpReadLimitedToBodyBuffer(HTTPClient& http, int maxBytes, int timeoutMs) {
  maxBytes = constrain(maxBytes, 0, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  httpReleaseBodyStorage();

  NetworkClient* stream = http.getStreamPtr();
  if (!stream) {
    httpSetError("http_no_stream", "HTTP response stream unavailable");
    return false;
  }

  if (maxBytes <= 0) {
    g_httpLastTruncated = http.getSize() != 0;
    return true;
  }

  P1ReusableBufferHandle body;
  if (!p1ReusableBufferAcquire(
        g_httpBodyBuffer,
        (size_t)maxBytes + 1,
        P1_HTTP_BODY_RETAIN_MIN,
        P1_HTTP_BODY_RETAIN_MAX,
        body)) {
    httpSetError("http_body_alloc_failed", "No heap for HTTP response body");
    return false;
  }

  uint8_t* out = body.data;
  size_t outLen = 0;
  int remaining = http.getSize();
  uint32_t deadline = millis() + (uint32_t)timeoutMs;
  while (http.connected() && (remaining > 0 || remaining == -1)) {
    size_t available = stream->available();
    if (!available) {
      if ((int32_t)(millis() - deadline) > 0) {
        httpSetError("http_read_timeout", "HTTP response read timed out");
        break;
      }
      delay(1);
      continue;
    }

    while (available-- && (remaining > 0 || remaining == -1)) {
      int c = stream->read();
      if (c < 0) break;
      if (outLen < (size_t)maxBytes) {
        out[outLen++] = (uint8_t)c;
      } else {
        g_httpLastTruncated = true;
      }
      if (remaining > 0) remaining--;
      deadline = millis() + (uint32_t)timeoutMs;
    }

    if (outLen >= (size_t)maxBytes) {
      g_httpLastTruncated = true;
      break;
    }
  }

  out[outLen] = 0;
  g_httpLastBodyLen = outLen;
  g_httpLastBodyAtMs = millis();
  p1ReusableBufferReleaseHandle(g_httpBodyBuffer, body);
  if (outLen == 0) httpReleaseBodyStorage();
  return true;
}

static bool httpPrepare(const String& url, int& maxBytes, int& timeoutMs) {
  g_httpLastCode = 0;
  g_httpLastTruncated = false;
  g_httpLastError = "";
  g_httpLastMessage = "";
  g_httpLastDetails = "";
  httpReleaseBodyStorage();
  g_httpLastSecure = false;
  g_httpLastDurationMs = 0;

  if (!httpValidUrl(url)) {
    httpSetError("http_bad_url", "HTTP URL must start with http:// or https://", "\"url\":" + jsonString(url));
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    httpSetError("http_wifi_disconnected", "HTTP request requires WiFi");
    return false;
  }

  maxBytes = constrain(maxBytes <= 0 ? P1_EMBED_HTTP_MAX_RESPONSE_BYTES : maxBytes, 0, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  timeoutMs = constrain(timeoutMs <= 0 ? P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS : timeoutMs, 500, 15000);
  return true;
}

String httpFetchGet(const String& url, int maxBytes, int timeoutMs) {
  if (!httpPrepare(url, maxBytes, timeoutMs)) return "";

  HTTPClient http;
  NetworkClient plain;
  NetworkClientSecure secure;
  uint32_t startedAt = millis();

  if (!httpBeginWithClient(http, plain, secure, url, timeoutMs)) {
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }

  g_httpLastCode = http.GET();
  if (g_httpLastCode <= 0) {
    httpSetRequestError(g_httpLastCode, g_httpLastSecure ? &secure : nullptr);
    http.end();
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }

  if (!httpReadLimitedToBodyBuffer(http, maxBytes, timeoutMs)) {
    http.end();
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }
  String body = httpLastBodyString();
  http.end();
  g_httpLastDurationMs = millis() - startedAt;
  return body;
}

String httpFetchJsonGet(const String& url, const String& path, int maxBytes, int timeoutMs) {
  String body = httpFetchGet(url, maxBytes, timeoutMs);
  if (g_httpLastCode < 200 || g_httpLastCode >= 300 || g_httpLastError.length()) return "";

  bool found = false;
  String value = jsonPathGetRaw(body, path, &found);
  return found ? value : String("");
}

int httpFetchJsonGetInt(const String& url, const String& path, int maxBytes, int timeoutMs) {
  String value = httpFetchJsonGet(url, path, maxBytes, timeoutMs);
  return value.toInt();
}

float httpFetchJsonGetFloat(const String& url, const String& path, int maxBytes, int timeoutMs) {
  String value = httpFetchJsonGet(url, path, maxBytes, timeoutMs);
  return value.toFloat();
}

bool httpFetchJsonGetBool(const String& url, const String& path, int maxBytes, int timeoutMs) {
  String value = httpFetchJsonGet(url, path, maxBytes, timeoutMs);
  value.trim();
  value.toLowerCase();
  return value == "true" || value.toInt() != 0;
}

int httpFetchJson(const String& url, int maxBytes, int timeoutMs) {
  httpFetchGet(url, maxBytes, timeoutMs);
  return g_httpLastCode;
}

String httpFetchPost(const String& url, const String& body, const String& contentType, int maxBytes, int timeoutMs) {
  if (!httpPrepare(url, maxBytes, timeoutMs)) return "";

  HTTPClient http;
  NetworkClient plain;
  NetworkClientSecure secure;
  uint32_t startedAt = millis();

  if (!httpBeginWithClient(http, plain, secure, url, timeoutMs)) {
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }

  http.addHeader("Content-Type", contentType.length() ? contentType : String("text/plain"));
  g_httpLastCode = http.POST(body);
  if (g_httpLastCode <= 0) {
    httpSetRequestError(g_httpLastCode, g_httpLastSecure ? &secure : nullptr);
    http.end();
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }

  if (!httpReadLimitedToBodyBuffer(http, maxBytes, timeoutMs)) {
    http.end();
    g_httpLastDurationMs = millis() - startedAt;
    return "";
  }
  String response = httpLastBodyString();
  http.end();
  g_httpLastDurationMs = millis() - startedAt;
  return response;
}

String httpFetchJsonValue(const String& path) {
  httpMaintainBodyStorage();
  if (!g_httpLastBodyLen) return "";
  if (g_httpLastCode < 200 || g_httpLastCode >= 300 || g_httpLastError.length()) return "";

  bool found = false;
  String value = jsonPathGetRaw(httpLastBodyString(), path, &found);
  return found ? value : String("");
}

int httpFetchJsonValueInt(const String& path) {
  return httpFetchJsonValue(path).toInt();
}

float httpFetchJsonValueFloat(const String& path) {
  return httpFetchJsonValue(path).toFloat();
}

bool httpFetchJsonValueBool(const String& path) {
  String value = httpFetchJsonValue(path);
  value.trim();
  value.toLowerCase();
  return value == "true" || value.toInt() != 0;
}

int httpFetchLastCode() {
  return g_httpLastCode;
}

bool httpFetchLastTruncated() {
  return g_httpLastTruncated;
}

String httpFetchLastError() {
  return g_httpLastError;
}

P1HttpFetchStatusSnapshot httpFetchStatusSnapshot() {
  httpMaintainBodyStorage();
  P1HttpFetchStatusSnapshot snapshot;
  snapshot.lastCode = g_httpLastCode;
  snapshot.lastTruncated = g_httpLastTruncated;
  snapshot.lastError = g_httpLastError;
  snapshot.lastMessage = g_httpLastMessage;
  snapshot.lastDetails = g_httpLastDetails;
  snapshot.lastBodyBytes = g_httpLastBodyLen;
  snapshot.lastSecure = g_httpLastSecure;
  snapshot.lastDurationMs = g_httpLastDurationMs;
  snapshot.maxResponseBytes = P1_EMBED_HTTP_MAX_RESPONSE_BYTES;
  snapshot.defaultTimeoutMs = P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS;
  snapshot.tlsInsecureDefault = P1_EMBED_HTTP_TLS_INSECURE_DEFAULT;
  snapshot.failuresAreScriptErrors = P1_EMBED_HTTP_FAILURES_ARE_SCRIPT_ERRORS;
  return snapshot;
}
