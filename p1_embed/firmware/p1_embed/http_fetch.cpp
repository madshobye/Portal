#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include "p1_embed_firmware.h"

static int g_httpLastCode = 0;
static bool g_httpLastTruncated = false;
static String g_httpLastError = "";
static String g_httpLastBody = "";

static bool httpValidUrl(const String& url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

static void httpSetError(const String& code, const String& message, const String& details = "") {
  g_httpLastError = code;
  scriptErrorSet("binding", code, message, details);
}

static String httpReadLimited(HTTPClient& http, int maxBytes, int timeoutMs) {
  String out;
  maxBytes = constrain(maxBytes, 0, P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  out.reserve(min(maxBytes, 512));

  NetworkClient* stream = http.getStreamPtr();
  if (!stream) {
    httpSetError("http_no_stream", "HTTP response stream unavailable");
    return out;
  }

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
      if ((int)out.length() < maxBytes) {
        out += (char)c;
      } else {
        g_httpLastTruncated = true;
      }
      if (remaining > 0) remaining--;
      deadline = millis() + (uint32_t)timeoutMs;
    }

    if ((int)out.length() >= maxBytes && maxBytes > 0) {
      g_httpLastTruncated = true;
      break;
    }
  }

  return out;
}

static bool httpPrepare(const String& url, int& maxBytes, int& timeoutMs) {
  g_httpLastCode = 0;
  g_httpLastTruncated = false;
  g_httpLastError = "";
  g_httpLastBody = "";

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
  http.setConnectTimeout(timeoutMs);
  http.setTimeout((uint16_t)timeoutMs);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.useHTTP10(true);

  if (!http.begin(url)) {
    httpSetError("http_begin_failed", "HTTP begin failed", "\"url\":" + jsonString(url));
    return "";
  }

  g_httpLastCode = http.GET();
  if (g_httpLastCode <= 0) {
    String err = HTTPClient::errorToString(g_httpLastCode);
    httpSetError("http_request_failed", err, "\"httpCode\":" + String(g_httpLastCode));
    http.end();
    return "";
  }

  String body = httpReadLimited(http, maxBytes, timeoutMs);
  g_httpLastBody = body;
  http.end();
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
  http.setConnectTimeout(timeoutMs);
  http.setTimeout((uint16_t)timeoutMs);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.useHTTP10(true);

  if (!http.begin(url)) {
    httpSetError("http_begin_failed", "HTTP begin failed", "\"url\":" + jsonString(url));
    return "";
  }

  http.addHeader("Content-Type", contentType.length() ? contentType : String("text/plain"));
  g_httpLastCode = http.POST(body);
  if (g_httpLastCode <= 0) {
    String err = HTTPClient::errorToString(g_httpLastCode);
    httpSetError("http_request_failed", err, "\"httpCode\":" + String(g_httpLastCode));
    http.end();
    return "";
  }

  String response = httpReadLimited(http, maxBytes, timeoutMs);
  g_httpLastBody = response;
  http.end();
  return response;
}

String httpFetchJsonValue(const String& path) {
  if (!g_httpLastBody.length()) return "";
  if (g_httpLastCode < 200 || g_httpLastCode >= 300 || g_httpLastError.length()) return "";

  bool found = false;
  String value = jsonPathGetRaw(g_httpLastBody, path, &found);
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

String httpFetchStatusJson() {
  String out = "{";
  out += "\"lastCode\":" + String(g_httpLastCode);
  out += ",\"lastTruncated\":" + String(g_httpLastTruncated ? "true" : "false");
  out += ",\"lastError\":" + jsonString(g_httpLastError);
  out += ",\"lastBodyBytes\":" + String(g_httpLastBody.length());
  out += ",\"maxResponseBytes\":" + String(P1_EMBED_HTTP_MAX_RESPONSE_BYTES);
  out += ",\"defaultTimeoutMs\":" + String(P1_EMBED_HTTP_DEFAULT_TIMEOUT_MS);
  out += "}";
  return out;
}
