#include <Arduino.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <mbedtls/sha256.h>

#ifndef P1E_UPDATER_DELTA_ENABLED
#define P1E_UPDATER_DELTA_ENABLED 0
#endif
#if P1E_UPDATER_DELTA_ENABLED
extern "C" {
#include "src/detools/detools.h"
}
#endif

#define P1E_UPDATER_VERSION "0.2.0-local-delta"
#define P1E_UPDATER_BAUD 115200
#define P1E_UPDATER_NVS_NS "p1ota"
#define P1E_UPDATER_PARTITION_LABEL "app"
#define P1E_UPDATER_PATCH_PARTITION_LABEL "patch"
#define P1E_UPDATER_BUFFER_BYTES 4096
#define P1E_UPDATER_FLASH_ERASE_BYTES 4096

struct UpdateRequest {
  bool pending = false;
  String kind = "delta";
  String patchSha256;
  String fromSha256;
  String toSha256;
  uint32_t fromSize = 0;
  uint32_t toSize = 0;
  uint32_t patchSize = 0;
  uint32_t memorySize = 0;
  uint32_t segmentSize = 0;
};

static UpdateRequest g_request;
static bool g_appPartitionTouched = false;

static void logLine(const String& message) {
  Serial.println(String("[p1e-updater] ") + message);
}

static bool loadRequest() {
  Preferences p;
  if (!p.begin(P1E_UPDATER_NVS_NS, true)) {
    logLine("failed to open request storage");
    return false;
  }
  g_request.pending = p.getBool("pending", false);
  g_request.kind = p.getString("kind", "delta");
  g_request.patchSha256 = p.getString("sha256", "");
  g_request.fromSha256 = p.getString("fromSha256", "");
  g_request.toSha256 = p.getString("toSha256", "");
  g_request.fromSize = p.getUInt("fromSize", 0);
  g_request.toSize = p.getUInt("toSize", 0);
  g_request.patchSize = p.getUInt("patchSize", 0);
  g_request.memorySize = p.getUInt("memorySize", 0);
  g_request.segmentSize = p.getUInt("segmentSize", 0);
  p.end();

  return g_request.pending &&
         g_request.kind == "delta" &&
         g_request.patchSha256.length() == 64 &&
         g_request.fromSha256.length() == 64 &&
         g_request.toSha256.length() == 64 &&
         g_request.fromSize > 0 &&
         g_request.toSize > 0 &&
         g_request.patchSize > 0 &&
         g_request.memorySize > 0 &&
         g_request.segmentSize > 0;
}

static void clearRequest(bool keepFailure) {
  Preferences p;
  if (!p.begin(P1E_UPDATER_NVS_NS, false)) return;
  if (keepFailure) {
    p.putBool("pending", false);
    p.putBool("failed", true);
  } else {
    p.clear();
  }
  p.end();
}

static const esp_partition_t* findAppPartition() {
  return esp_partition_find_first(
    ESP_PARTITION_TYPE_APP,
    ESP_PARTITION_SUBTYPE_APP_OTA_0,
    P1E_UPDATER_PARTITION_LABEL
  );
}

static const esp_partition_t* findPatchPartition() {
  return esp_partition_find_first(
    ESP_PARTITION_TYPE_DATA,
    ESP_PARTITION_SUBTYPE_DATA_SPIFFS,
    P1E_UPDATER_PATCH_PARTITION_LABEL
  );
}

static void bootAppIfSafe(const char* reason) {
  if (g_appPartitionTouched) {
    logLine(String("staying in updater after app write started: ") + reason);
    return;
  }
  const esp_partition_t* app = findAppPartition();
  if (!app) {
    logLine(String("no app partition to return to: ") + reason);
    return;
  }
  logLine(String("returning to app: ") + reason);
  esp_ota_set_boot_partition(app);
  delay(500);
  ESP.restart();
}

static bool hexDigest(const uint8_t* digest, size_t len, String& out) {
  static const char* hex = "0123456789abcdef";
  out = "";
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += hex[(digest[i] >> 4) & 0x0f];
    out += hex[digest[i] & 0x0f];
  }
  return true;
}

static bool hashPartitionRange(const esp_partition_t* partition, uint32_t size, String& out) {
  if (!partition || size > partition->size) return false;
  uint8_t* buffer = static_cast<uint8_t*>(malloc(P1E_UPDATER_BUFFER_BYTES));
  if (!buffer) return false;

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);

  uint32_t offset = 0;
  while (offset < size) {
    size_t chunk = min<uint32_t>(P1E_UPDATER_BUFFER_BYTES, size - offset);
    esp_err_t err = esp_partition_read(partition, offset, buffer, chunk);
    if (err != ESP_OK) {
      free(buffer);
      mbedtls_sha256_free(&sha);
      return false;
    }
    mbedtls_sha256_update(&sha, buffer, chunk);
    offset += chunk;
  }

  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  free(buffer);
  return hexDigest(digest, sizeof(digest), out);
}

#if P1E_UPDATER_DELTA_ENABLED
struct DeltaFlashContext {
  const esp_partition_t* app = nullptr;
  const esp_partition_t* patch = nullptr;
  uint32_t patchSize = 0;
  uint32_t patchOffset = 0;
  int step = 0;
};

static int deltaMemRead(void* arg, void* dst, uintptr_t src, size_t size) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx || !ctx->app || !dst || src + size > ctx->app->size) return -DETOOLS_IO_FAILED;
  return esp_partition_read(ctx->app, src, dst, size) == ESP_OK ? 0 : -DETOOLS_IO_FAILED;
}

static int deltaMemWrite(void* arg, uintptr_t dst, void* src, size_t size) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx || !ctx->app || !src || dst + size > ctx->app->size) return -DETOOLS_IO_FAILED;
  g_appPartitionTouched = true;
  return esp_partition_write(ctx->app, dst, src, size) == ESP_OK ? 0 : -DETOOLS_IO_FAILED;
}

static int deltaMemErase(void* arg, uintptr_t addr, size_t size) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx || !ctx->app || addr + size > ctx->app->size) return -DETOOLS_IO_FAILED;
  if ((addr % P1E_UPDATER_FLASH_ERASE_BYTES) != 0 || (size % P1E_UPDATER_FLASH_ERASE_BYTES) != 0) {
    logLine(String("delta erase alignment failed addr=") + addr + " size=" + size);
    return -DETOOLS_IO_FAILED;
  }
  g_appPartitionTouched = true;
  return esp_partition_erase_range(ctx->app, addr, size) == ESP_OK ? 0 : -DETOOLS_IO_FAILED;
}

static int deltaStepSet(void* arg, int step) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx) return -DETOOLS_IO_FAILED;
  ctx->step = step;
  return 0;
}

static int deltaStepGet(void* arg, int* step) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx || !step) return -DETOOLS_IO_FAILED;
  *step = ctx->step;
  return 0;
}

static int deltaPatchRead(void* arg, uint8_t* dst, size_t size) {
  DeltaFlashContext* ctx = static_cast<DeltaFlashContext*>(arg);
  if (!ctx || !ctx->patch || !dst || ctx->patchOffset + size > ctx->patchSize) return -DETOOLS_IO_FAILED;
  if (esp_partition_read(ctx->patch, ctx->patchOffset, dst, size) != ESP_OK) return -DETOOLS_IO_FAILED;
  ctx->patchOffset += size;
  return 0;
}

static bool applyDeltaPatch() {
  const esp_partition_t* app = findAppPartition();
  const esp_partition_t* patch = findPatchPartition();
  if (!app || !patch) {
    logLine("delta requires app and patch partitions");
    return false;
  }
  if (g_request.memorySize > app->size ||
      g_request.fromSize > app->size ||
      g_request.toSize > app->size ||
      g_request.patchSize > patch->size) {
    logLine("delta request exceeds partition bounds");
    return false;
  }

  String patchHash;
  if (!hashPartitionRange(patch, g_request.patchSize, patchHash)) {
    logLine("failed to hash local patch");
    return false;
  }
  if (!patchHash.equalsIgnoreCase(g_request.patchSha256)) {
    logLine(String("patch sha256 mismatch actual=") + patchHash);
    return false;
  }

  String sourceHash;
  if (!hashPartitionRange(app, g_request.fromSize, sourceHash)) {
    logLine("failed to hash current app");
    return false;
  }
  if (!sourceHash.equalsIgnoreCase(g_request.fromSha256)) {
    logLine(String("source sha256 mismatch actual=") + sourceHash);
    return false;
  }

  logLine(String("applying local delta patch bytes=") + g_request.patchSize);
  DeltaFlashContext ctx;
  ctx.app = app;
  ctx.patch = patch;
  ctx.patchSize = g_request.patchSize;

  int result = detools_apply_patch_in_place_callbacks(
    deltaMemRead,
    deltaMemWrite,
    deltaMemErase,
    deltaStepSet,
    deltaStepGet,
    deltaPatchRead,
    g_request.patchSize,
    &ctx
  );
  if (result < 0) {
    logLine(String("delta apply failed code=") + result + " " + detools_error_as_string(result));
    return false;
  }
  if ((uint32_t)result != g_request.toSize) {
    logLine(String("delta output size mismatch actual=") + result + " expected=" + g_request.toSize);
    return false;
  }

  String targetHash;
  if (!hashPartitionRange(app, g_request.toSize, targetHash)) {
    logLine("failed to hash patched app");
    return false;
  }
  if (!targetHash.equalsIgnoreCase(g_request.toSha256)) {
    logLine(String("target sha256 mismatch actual=") + targetHash);
    return false;
  }

  esp_err_t err = esp_ota_set_boot_partition(app);
  if (err != ESP_OK) {
    logLine(String("set app boot failed: ") + esp_err_to_name(err));
    return false;
  }

  logLine("delta update complete; booting app");
  return true;
}
#else
static bool applyDeltaPatch() {
  logLine("delta OTA is not compiled into this updater");
  return false;
}
#endif

void setup() {
  Serial.begin(P1E_UPDATER_BAUD);
  delay(100);
  logLine(String("version ") + P1E_UPDATER_VERSION);

  if (!loadRequest()) {
    logLine("no valid pending local delta request");
    bootAppIfSafe("no valid request");
    return;
  }

  if (!applyDeltaPatch()) {
    clearRequest(true);
    bootAppIfSafe("delta apply failed");
    return;
  }

  clearRequest(false);
  delay(500);
  ESP.restart();
}

void loop() {
  delay(1000);
}
