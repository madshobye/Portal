#include <Arduino.h>
#include "p1_embed_firmware.h"

#if P1_EMBED_OTA_SAFEBOOT_ENABLED
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>
#include <mbedtls/sha256.h>

#define P1_EMBED_OTA_PATCH_PARTITION_LABEL "patch"
#define P1_EMBED_OTA_DOWNLOAD_TIMEOUT_MS 15000
#define P1_EMBED_OTA_DOWNLOAD_BUFFER_BYTES 4096

static bool g_otaRestartPending = false;
static uint32_t g_otaRestartAtMs = 0;

static bool otaSafeBootValidUrl(const String& url) {
  if (url.startsWith("https://")) return true;
#if P1_EMBED_OTA_ALLOW_HTTP_URLS
  if (url.startsWith("http://")) return true;
#endif
  return false;
}

static bool otaSafeBootValidSha256(const String& sha256) {
  if (!sha256.length()) return true;
  if (sha256.length() != P1_EMBED_OTA_REQUEST_MAX_SHA256) return false;
  for (size_t i = 0; i < sha256.length(); i++) {
    char c = sha256[i];
    bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!hex) return false;
  }
  return true;
}

static bool otaSafeBootValidKind(const String& kind) {
  return kind == "delta";
}

static const esp_partition_t* otaSafeBootFindUpdaterPartition() {
  return esp_partition_find_first(
    ESP_PARTITION_TYPE_APP,
    ESP_PARTITION_SUBTYPE_APP_FACTORY,
    P1_EMBED_OTA_SAFEBOOT_PARTITION_LABEL
  );
}

static const esp_partition_t* otaSafeBootFindPatchPartition() {
  return esp_partition_find_first(
    ESP_PARTITION_TYPE_DATA,
    ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
    P1_EMBED_OTA_PATCH_PARTITION_LABEL
  );
}

static bool otaSafeBootHexDigest(const uint8_t* digest, size_t len, String& out) {
  static const char* hex = "0123456789abcdef";
  out = "";
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += hex[(digest[i] >> 4) & 0x0f];
    out += hex[digest[i] & 0x0f];
  }
  return true;
}

static bool otaSafeBootClearStoredRequest() {
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, false)) return false;
  p.clear();
  p.end();
  return true;
}

static bool otaSafeBootLoadRequest(P1OtaRequest& request) {
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, true)) return false;
  request.kind = p.getString("kind", "delta");
  request.url = p.getString("url", "");
  request.sha256 = p.getString("sha256", "");
  request.fromSha256 = p.getString("fromSha256", "");
  request.toSha256 = p.getString("toSha256", "");
  request.fromSize = p.getUInt("fromSize", 0);
  request.toSize = p.getUInt("toSize", 0);
  request.patchSize = p.getUInt("patchSize", 0);
  request.memorySize = p.getUInt("memorySize", 0);
  request.segmentSize = p.getUInt("segmentSize", 0);
  p.end();
  return request.url.length() > 0;
}

static bool otaSafeBootStorePhase(bool downloadPending, bool pending, const char* phase, const String& error) {
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, false)) return false;
  p.putBool("downloadPending", downloadPending);
  p.putBool("pending", pending);
  p.putString("phase", phase ? phase : "");
  p.putString("lastError", error);
  p.end();
  return true;
}

static bool otaSafeBootStoreDownloadedPatch(uint32_t patchSize, String& errOut) {
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, false)) {
    errOut = "Could not open OTA request storage after download";
    return false;
  }
  p.putBool("downloadPending", false);
  p.putBool("pending", true);
  p.putUInt("patchSize", patchSize);
  p.putString("phase", "patch_ready");
  p.putString("lastError", "");
  p.end();
  return true;
}

static bool otaSafeBootDownloadPatch(const String& url, const String& expectedSha256, uint32_t& patchSizeOut, String& errOut) {
  const esp_partition_t* patch = otaSafeBootFindPatchPartition();
  if (!patch) {
    errOut = "SafeBoot patch partition not found; flash the safeboot delta partition layout first";
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) {
    errOut = "WiFi is not connected; cannot download delta patch";
    return false;
  }

  HTTPClient http;
  WiFiClient httpClient;
  WiFiClientSecure httpsClient;
  http.setConnectTimeout(P1_EMBED_OTA_DOWNLOAD_TIMEOUT_MS);
  http.setTimeout(P1_EMBED_OTA_DOWNLOAD_TIMEOUT_MS);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.useHTTP10(true);

  if (url.startsWith("https://")) {
    httpsClient.setInsecure();
    if (!http.begin(httpsClient, url)) {
      errOut = "HTTP begin failed for delta patch";
      return false;
    }
  } else {
#if P1_EMBED_OTA_ALLOW_HTTP_URLS
    if (!http.begin(httpClient, url)) {
      errOut = "HTTP begin failed for delta patch";
      return false;
    }
#else
    errOut = "Delta patch URL must start with https://";
    return false;
#endif
  }

  int code = http.GET();
  if (code < 200 || code >= 300) {
    errOut = String("Delta patch download failed with HTTP ") + code;
    http.end();
    return false;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    errOut = "Delta patch response is missing Content-Length";
    http.end();
    return false;
  }
  if ((uint32_t)contentLength > patch->size) {
    errOut = String("Delta patch is too large: ") + contentLength + " > " + patch->size;
    http.end();
    return false;
  }

  uint32_t eraseSize = ((uint32_t)contentLength + 4095) & ~uint32_t(4095);
  esp_err_t err = esp_partition_erase_range(patch, 0, eraseSize);
  if (err != ESP_OK) {
    errOut = String("Could not erase patch partition: ") + esp_err_to_name(err);
    http.end();
    return false;
  }

  uint8_t* buffer = static_cast<uint8_t*>(malloc(P1_EMBED_OTA_DOWNLOAD_BUFFER_BYTES));
  if (!buffer) {
    errOut = "No heap for delta patch download buffer";
    http.end();
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);

  WiFiClient* stream = http.getStreamPtr();
  int written = 0;
  uint32_t lastProgress = millis();
  while (http.connected() && written < contentLength) {
    int available = stream ? stream->available() : 0;
    if (available <= 0) {
      if (millis() - lastProgress > P1_EMBED_OTA_DOWNLOAD_TIMEOUT_MS) {
        errOut = "Delta patch download stalled";
        free(buffer);
        mbedtls_sha256_free(&sha);
        http.end();
        return false;
      }
      delay(1);
      continue;
    }

    int toRead = min(available, P1_EMBED_OTA_DOWNLOAD_BUFFER_BYTES);
    toRead = min(toRead, contentLength - written);
    int n = stream->readBytes(buffer, toRead);
    if (n <= 0) continue;

    err = esp_partition_write(patch, written, buffer, n);
    if (err != ESP_OK) {
      errOut = String("Could not write delta patch: ") + esp_err_to_name(err);
      free(buffer);
      mbedtls_sha256_free(&sha);
      http.end();
      return false;
    }
    mbedtls_sha256_update(&sha, buffer, n);
    written += n;
    lastProgress = millis();
  }

  free(buffer);
  http.end();

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);

  if (written != contentLength) {
    errOut = String("Delta patch download incomplete: ") + written + " / " + contentLength;
    return false;
  }

  String actualSha256;
  otaSafeBootHexDigest(digest, sizeof(digest), actualSha256);
  if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
    errOut = String("Delta patch sha256 mismatch: ") + actualSha256;
    return false;
  }

  patchSizeOut = (uint32_t)contentLength;
  return true;
}

static bool otaSafeBootRequestPending() {
  Preferences p;
  bool pending = false;
  if (p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, true)) {
    pending = p.getBool("pending", false);
    p.end();
  }
  return pending;
}

static bool otaSafeBootDownloadPending() {
  Preferences p;
  bool pending = false;
  if (p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, true)) {
    pending = p.getBool("downloadPending", false);
    p.end();
  }
  return pending;
}

static bool otaSafeBootWaitForWifi(uint32_t timeoutMs) {
  uint32_t started = millis();
  while (!wifiIsConnected()) {
    wifiLoop();
    if (millis() - started >= timeoutMs) return false;
    delay(50);
  }
  return true;
}

static bool otaSafeBootSelectUpdater(String& errOut) {
  const esp_partition_t* updater = otaSafeBootFindUpdaterPartition();
  if (!updater) {
    errOut = "SafeBoot updater partition not found";
    return false;
  }
  esp_err_t err = esp_ota_set_boot_partition(updater);
  if (err != ESP_OK) {
    errOut = String("Failed to select updater partition: ") + esp_err_to_name(err);
    return false;
  }
  return true;
}

P1OtaSafeBootStatusSnapshot otaSafeBootStatusSnapshot() {
  P1OtaSafeBootStatusSnapshot snapshot;
  snapshot.enabled = true;
  const esp_partition_t* updater = otaSafeBootFindUpdaterPartition();
  const esp_partition_t* patch = otaSafeBootFindPatchPartition();
  Preferences p;
  String sha256;
  String fromSha256;
  String toSha256;
  snapshot.updaterPartition = updater != nullptr;
  snapshot.updaterLabel = P1_EMBED_OTA_SAFEBOOT_PARTITION_LABEL;
  snapshot.patchPartitionSize = patch ? (uint32_t)patch->size : 0;
  snapshot.kind = "full";
  if (p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, true)) {
    snapshot.pending = p.getBool("pending", false);
    snapshot.downloadPending = p.getBool("downloadPending", false);
    snapshot.kind = p.getString("kind", "full");
    snapshot.url = p.getString("url", "");
    sha256 = p.getString("sha256", "");
    fromSha256 = p.getString("fromSha256", "");
    toSha256 = p.getString("toSha256", "");
    snapshot.phase = p.getString("phase", "");
    snapshot.lastError = p.getString("lastError", "");
    snapshot.fromSize = p.getUInt("fromSize", 0);
    snapshot.toSize = p.getUInt("toSize", 0);
    snapshot.patchSize = p.getUInt("patchSize", 0);
    snapshot.memorySize = p.getUInt("memorySize", 0);
    snapshot.segmentSize = p.getUInt("segmentSize", 0);
    p.end();
  }
  snapshot.sha256Set = sha256.length() > 0;
  snapshot.fromSha256Set = fromSha256.length() > 0;
  snapshot.toSha256Set = toSha256.length() > 0;
  snapshot.restartPending = g_otaRestartPending;
  return snapshot;
}

bool otaSafeBootRequestUpdate(const P1OtaRequest& request, String& errOut) {
  String kind = request.kind.length() ? request.kind : String("full");
  String url = request.url;
  String sha256 = request.sha256;
  String fromSha256 = request.fromSha256;
  String toSha256 = request.toSha256;
  kind.trim();
  kind.toLowerCase();
  url.trim();
  sha256.trim();
  sha256.toLowerCase();
  fromSha256.trim();
  fromSha256.toLowerCase();
  toSha256.trim();
  toSha256.toLowerCase();

  if (!otaSafeBootFindUpdaterPartition()) {
    errOut = "SafeBoot updater partition not found; flash the safeboot partition layout first";
    return false;
  }
  if (!otaSafeBootValidKind(kind)) {
    errOut = "SafeBoot OTA is delta-only; set kind=delta";
    return false;
  }
  if (!otaSafeBootValidUrl(url)) {
#if P1_EMBED_OTA_ALLOW_HTTP_URLS
    errOut = "Firmware URL must start with http:// or https://";
#else
    errOut = "Firmware URL must start with https://";
#endif
    return false;
  }
  if (url.length() > P1_EMBED_OTA_REQUEST_MAX_URL) {
    errOut = "Firmware URL is too long";
    return false;
  }
  if (!otaSafeBootValidSha256(sha256)) {
    errOut = "sha256 must be empty or 64 hex characters";
    return false;
  }
  if (!sha256.length()) {
    errOut = "delta update requires patch sha256 as 64 hex characters";
    return false;
  }
  if (!otaSafeBootValidSha256(fromSha256) || !fromSha256.length()) {
    errOut = "delta update requires fromSha256 as 64 hex characters";
    return false;
  }
  if (!otaSafeBootValidSha256(toSha256) || !toSha256.length()) {
    errOut = "delta update requires toSha256 as 64 hex characters";
    return false;
  }
  if (request.fromSize == 0 || request.toSize == 0 || request.memorySize == 0 || request.segmentSize == 0) {
    errOut = "delta update requires fromSize, toSize, memorySize, and segmentSize";
    return false;
  }
  if ((request.segmentSize % 4096) != 0) {
    errOut = "delta segmentSize must be a multiple of 4096";
    return false;
  }
  if (request.fromSize > request.memorySize || request.toSize > request.memorySize) {
    errOut = "delta image sizes must fit inside memorySize";
    return false;
  }

  otaSafeBootClearStoredRequest();
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, false)) {
    errOut = "Could not open OTA request storage";
    return false;
  }
  p.putBool("downloadPending", true);
  p.putBool("pending", false);
  p.putString("kind", kind);
  p.putString("url", url);
  p.putString("sha256", sha256);
  p.putString("fromSha256", fromSha256);
  p.putString("toSha256", toSha256);
  p.putUInt("fromSize", request.fromSize);
  p.putUInt("toSize", request.toSize);
  p.putUInt("patchSize", 0);
  p.putUInt("memorySize", request.memorySize);
  p.putUInt("segmentSize", request.segmentSize);
  p.putString("deviceName", configDeviceName());
  p.putString("versionFrom", P1_EMBED_FIRMWARE_VERSION);
  p.putString("phase", "download_pending");
  p.putString("lastError", "");
  p.end();
  return true;
}

bool otaSafeBootRequestUpdate(const String& url, const String& sha256, String& errOut) {
  P1OtaRequest request;
  request.kind = "delta";
  request.url = url;
  request.sha256 = sha256;
  return otaSafeBootRequestUpdate(request, errOut);
}

bool otaSafeBootClearRequest() {
  Preferences p;
  if (!p.begin(P1_EMBED_OTA_REQUEST_NVS_NS, false)) return false;
  p.clear();
  p.end();
  g_otaRestartPending = false;
  return true;
}

bool otaSafeBootBootUpdater(String& errOut) {
  if (!otaSafeBootFindUpdaterPartition()) {
    errOut = "SafeBoot updater partition not found";
    return false;
  }
  if (!otaSafeBootRequestPending()) {
    if (otaSafeBootDownloadPending()) {
      otaSafeBootStorePhase(true, false, "download_reboot_pending", "");
      g_otaRestartPending = true;
      g_otaRestartAtMs = millis() + P1_EMBED_OTA_RESTART_DELAY_MS;
      return true;
    }
    errOut = "No pending firmware update request";
    return false;
  }
  if (!otaSafeBootSelectUpdater(errOut)) return false;
  g_otaRestartPending = true;
  g_otaRestartAtMs = millis() + P1_EMBED_OTA_RESTART_DELAY_MS;
  return true;
}

void otaSafeBootHandleBootDownload() {
  if (!otaSafeBootDownloadPending()) return;

  Serial.println("[p1e ota] download mode: waiting for WiFi");
  otaSafeBootStorePhase(true, false, "waiting_wifi", "");
  if (!otaSafeBootWaitForWifi(P1_EMBED_OTA_DOWNLOAD_WIFI_WAIT_MS)) {
    String err = "WiFi did not connect before OTA download timeout";
    Serial.println(String("[p1e ota] ") + err);
    otaSafeBootStorePhase(false, false, "download_failed", err);
    return;
  }

  P1OtaRequest request;
  if (!otaSafeBootLoadRequest(request)) {
    String err = "OTA download request is missing or corrupt";
    Serial.println(String("[p1e ota] ") + err);
    otaSafeBootStorePhase(false, false, "download_failed", err);
    return;
  }

  otaSafeBootStorePhase(true, false, "downloading", "");
  Serial.println(String("[p1e ota] downloading ") + request.url);
  uint32_t patchSize = 0;
  String err;
  if (!otaSafeBootDownloadPatch(request.url, request.sha256, patchSize, err)) {
    Serial.println(String("[p1e ota] download failed: ") + err);
    otaSafeBootStorePhase(false, false, "download_failed", err);
    return;
  }
  if (!otaSafeBootStoreDownloadedPatch(patchSize, err)) {
    Serial.println(String("[p1e ota] ") + err);
    otaSafeBootStorePhase(false, false, "download_failed", err);
    return;
  }
  if (!otaSafeBootSelectUpdater(err)) {
    Serial.println(String("[p1e ota] ") + err);
    otaSafeBootStorePhase(false, true, "updater_select_failed", err);
    return;
  }

  Serial.println(String("[p1e ota] patch ready, size=") + patchSize + "; rebooting updater");
  delay(200);
  ESP.restart();
}

void otaSafeBootPoll() {
  if (!g_otaRestartPending) return;
  if ((int32_t)(millis() - g_otaRestartAtMs) < 0) return;
  ESP.restart();
}

#else

P1OtaSafeBootStatusSnapshot otaSafeBootStatusSnapshot() {
  return P1OtaSafeBootStatusSnapshot();
}

bool otaSafeBootRequestUpdate(const String&, const String&, String& errOut) {
  errOut = "SafeBoot OTA is disabled in this firmware";
  return false;
}

bool otaSafeBootRequestUpdate(const P1OtaRequest&, String& errOut) {
  errOut = "SafeBoot OTA is disabled in this firmware";
  return false;
}

bool otaSafeBootClearRequest() {
  return false;
}

bool otaSafeBootBootUpdater(String& errOut) {
  errOut = "SafeBoot OTA is disabled in this firmware";
  return false;
}

void otaSafeBootHandleBootDownload() {
}

void otaSafeBootPoll() {
}

#endif
