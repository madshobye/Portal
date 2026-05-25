#include "UvcCamera.h"
#include "Config.h"

#include <inttypes.h>
#include "USB_STREAM.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "jpeg_decoder.h"

static USB_STREAM *s_usbStream = nullptr;
static UvcCamera *s_camera = nullptr;
static uint8_t *s_uvcTransferA = nullptr;
static uint8_t *s_uvcTransferB = nullptr;
static uint8_t *s_uvcFrameBuffer = nullptr;
static uint8_t *s_snapshotBuffer = nullptr;
static size_t s_snapshotCapacity = 0;
static size_t s_snapshotLength = 0;
static uint32_t s_snapshotWidth = 0;
static uint32_t s_snapshotHeight = 0;
static uint32_t s_snapshotSequence = 0;
static int s_snapshotFormat = UVC_FRAME_FORMAT_UNKNOWN;
static volatile bool s_snapshotReady = false;
static volatile bool s_snapshotLocked = false;
static volatile bool s_streamConnected = false;

static constexpr USBStreamUVCKnownCameraProfile CAMERA_PROFILE =
  USBSTREAM_UVC_LOGITECH_046D_0821_640X480_MJPEG;
static constexpr esp_jpeg_image_scale_t JPEG_DECODE_SCALE =
  JPEG_IMAGE_SCALE_0;
static constexpr bool PRINT_UVC_PACKET_STATS = false;
static constexpr size_t JPEG_WORKING_BUFFER_BYTES = 70 * 1024;

static size_t uvcBufferBytes() {
  return max<size_t>(UVC_FRAME_BUFFER_BYTES, CAMERA_PROFILE.bufferSize);
}

static uint8_t *allocateBytes(size_t length) {
  uint8_t *data = static_cast<uint8_t *>(ps_malloc(length));
  if (data == nullptr) {
    data = static_cast<uint8_t *>(malloc(length));
  }
  return data;
}

static uint8_t *allocateInternalBytes(size_t length) {
  uint8_t *data = static_cast<uint8_t *>(heap_caps_malloc(length, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  if (data == nullptr) {
    data = static_cast<uint8_t *>(ps_malloc(length));
  }
  if (data == nullptr) {
    data = static_cast<uint8_t *>(malloc(length));
  }
  return data;
}

static uint8_t rgb565ToGray(uint16_t pixel) {
  const uint8_t r = uint8_t(((pixel >> 11) & 0x1f) * 255 / 31);
  const uint8_t g = uint8_t(((pixel >> 5) & 0x3f) * 255 / 63);
  const uint8_t b = uint8_t((pixel & 0x1f) * 255 / 31);
  return uint8_t((uint16_t(r) * 30 + uint16_t(g) * 59 + uint16_t(b) * 11) / 100);
}

static const uint8_t JPEG_DEFAULT_DHT[] = {
  0xff, 0xc4, 0x01, 0xa2,
  0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b,
  0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04,
  0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05,
  0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
  0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1,
  0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19,
  0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54,
  0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84,
  0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97,
  0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa,
  0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4,
  0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
  0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
  0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  0x01, 0x00, 0x03, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b,
  0x11, 0x00, 0x02, 0x01, 0x02, 0x04, 0x04, 0x03, 0x04, 0x07, 0x05, 0x04,
  0x04, 0x00, 0x01, 0x02, 0x77, 0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05,
  0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32,
  0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52,
  0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1,
  0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37,
  0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53,
  0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67,
  0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82,
  0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95,
  0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8,
  0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2,
  0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5,
  0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8,
  0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa
};

static void dumpJpegHexOnce(const uint8_t *jpeg, size_t length) {
  static bool dumped = false;
  if (dumped || !ENABLE_JPEG_SERIAL_DUMP) return;
  dumped = true;

  Serial.printf("JPEGDUMP_BEGIN %u\r\n", unsigned(length));
  for (size_t offset = 0; offset < length; offset += 32) {
    const size_t count = min<size_t>(32, length - offset);
    Serial.print("JPEGDUMP ");
    for (size_t i = 0; i < count; i++) {
      if (jpeg[offset + i] < 0x10) Serial.print('0');
      Serial.print(jpeg[offset + i], HEX);
    }
    Serial.println();
  }
  Serial.println("JPEGDUMP_END");
}

static bool jpegHasMarker(const uint8_t *jpeg, size_t length, uint8_t marker) {
  for (size_t i = 0; i + 1 < length; i++) {
    if (jpeg[i] == 0xff && jpeg[i + 1] == marker) return true;
    if (jpeg[i] == 0xff && jpeg[i + 1] == 0xda) return false;
  }
  return false;
}

static int32_t findJpegMarkerOffset(const uint8_t *jpeg, size_t length, uint8_t marker) {
  for (size_t i = 0; i + 1 < length; i++) {
    if (jpeg[i] == 0xff && jpeg[i + 1] == marker) {
      return int32_t(i);
    }
  }
  return -1;
}

static bool addDefaultDhtIfNeeded(const uint8_t *jpeg, size_t length, uint8_t **outData, size_t *outLength) {
  *outData = nullptr;
  *outLength = 0;
  if (length < 4 || jpeg[0] != 0xff || jpeg[1] != 0xd8 || jpegHasMarker(jpeg, length, 0xc4)) {
    return false;
  }

  const int32_t sosOffset = findJpegMarkerOffset(jpeg, length, 0xda);
  if (sosOffset <= 2) {
    return false;
  }

  const size_t repairedLength = length + sizeof(JPEG_DEFAULT_DHT);
  uint8_t *repaired = allocateBytes(repairedLength);
  if (repaired == nullptr) {
    return false;
  }

  const size_t insertOffset = size_t(sosOffset);
  memcpy(repaired, jpeg, insertOffset);
  memcpy(repaired + insertOffset, JPEG_DEFAULT_DHT, sizeof(JPEG_DEFAULT_DHT));
  memcpy(repaired + insertOffset + sizeof(JPEG_DEFAULT_DHT),
         jpeg + insertOffset,
         length - insertOffset);
  *outData = repaired;
  *outLength = repairedLength;
  return true;
}

static uint8_t grayAtOriented(const uint8_t *source,
                              uint32_t sourceWidth,
                              uint32_t sourceHeight,
                              uint32_t sourceStride,
                              uint32_t x,
                              uint32_t y,
                              bool rotateClockwise) {
  if (!rotateClockwise) {
    return source[size_t(y) * sourceStride + x];
  }

  const uint32_t sourceX = min<uint32_t>(sourceWidth - 1, y);
  const uint32_t sourceY = sourceHeight - 1 - min<uint32_t>(sourceHeight - 1, x);
  return source[size_t(sourceY) * sourceStride + sourceX];
}

static void copyGrayCoverOriented(const uint8_t *source,
                                  uint32_t sourceWidth,
                                  uint32_t sourceHeight,
                                  uint32_t sourceStride,
                                  GrayscaleFrame &target,
                                  bool rotateClockwise) {
  const uint32_t viewWidth = rotateClockwise ? sourceHeight : sourceWidth;
  const uint32_t viewHeight = rotateClockwise ? sourceWidth : sourceHeight;
  const uint64_t lhs = uint64_t(target.width) * viewHeight;
  const uint64_t rhs = uint64_t(target.height) * viewWidth;
  uint32_t cropX = 0;
  uint32_t cropY = 0;
  uint32_t cropWidth = viewWidth;
  uint32_t cropHeight = viewHeight;

  if (lhs > rhs) {
    cropHeight = max<uint32_t>(1, uint32_t((uint64_t(viewWidth) * target.height) / target.width));
    cropY = (viewHeight - cropHeight) / 2;
  } else if (lhs < rhs) {
    cropWidth = max<uint32_t>(1, uint32_t((uint64_t(viewHeight) * target.width) / target.height));
    cropX = (viewWidth - cropWidth) / 2;
  }

  Serial.printf("cover crop gray src=%ux%u view=%ux%u rotate=%u crop=%u,%u %ux%u target=%ux%u\r\n",
                unsigned(sourceWidth), unsigned(sourceHeight),
                unsigned(viewWidth), unsigned(viewHeight),
                rotateClockwise ? 1 : 0,
                unsigned(cropX), unsigned(cropY),
                unsigned(cropWidth), unsigned(cropHeight),
                unsigned(target.width), unsigned(target.height));

  for (uint16_t y = 0; y < target.height; y++) {
    const uint32_t vy = cropY + min<uint32_t>(cropHeight - 1, (uint32_t(y) * cropHeight) / target.height);
    for (uint16_t x = 0; x < target.width; x++) {
      const uint32_t vx = cropX + min<uint32_t>(cropWidth - 1, (uint32_t(x) * cropWidth) / target.width);
      target.pixels[size_t(y) * target.width + x] =
        grayAtOriented(source, sourceWidth, sourceHeight, sourceStride, vx, vy, rotateClockwise);
    }
  }
}

static void copyGrayCover(const uint8_t *source,
                          uint32_t sourceWidth,
                          uint32_t sourceHeight,
                          uint32_t sourceStride,
                          GrayscaleFrame &target) {
  copyGrayCoverOriented(
    source,
    sourceWidth,
    sourceHeight,
    sourceStride,
    target,
    ROTATE_UVC_IMAGE_FOR_LABEL
  );
}

static void printAsciiFromGray(const uint8_t *gray, uint32_t width, uint32_t height, uint32_t stride) {
  static const char ramp[] = " .:-=+*#%@";
  constexpr size_t rampMax = sizeof(ramp) - 2;

  Serial.println();
  Serial.println("---- UVC ASCII preview ----");
  for (uint16_t row = 0; row < UVC_ASCII_HEIGHT; row++) {
    const uint32_t y = min<uint32_t>(height - 1, (uint32_t(row) * height) / UVC_ASCII_HEIGHT);
    for (uint16_t col = 0; col < UVC_ASCII_WIDTH; col++) {
      const uint32_t x = min<uint32_t>(width - 1, (uint32_t(col) * width) / UVC_ASCII_WIDTH);
      const uint8_t value = gray[size_t(y) * stride + x];
      Serial.print(ramp[(uint32_t(value) * rampMax) / 255]);
    }
    Serial.println();
  }
  Serial.println("---------------------------");
}

static bool decodeJpegToGrayCover(const uint8_t *jpeg, size_t length, GrayscaleFrame &target) {
  const int32_t soiOffset = findJpegMarkerOffset(jpeg, length, 0xd8);
  const int32_t sosOffset = findJpegMarkerOffset(jpeg, length, 0xda);
  const int32_t eoiOffset = findJpegMarkerOffset(jpeg, length, 0xd9);
  Serial.printf("MJPEG markers len=%u soi=%ld sos=%ld eoi=%ld head=%02x %02x tail=%02x %02x\r\n",
                unsigned(length),
                long(soiOffset),
                long(sosOffset),
                long(eoiOffset),
                length > 0 ? jpeg[0] : 0,
                length > 1 ? jpeg[1] : 0,
                length > 1 ? jpeg[length - 2] : 0,
                length > 0 ? jpeg[length - 1] : 0);

  uint8_t *repairedJpeg = nullptr;
  size_t repairedLength = 0;
  if (addDefaultDhtIfNeeded(jpeg, length, &repairedJpeg, &repairedLength)) {
    Serial.printf("MJPEG frame missing DHT; inserted default table (%u -> %u bytes)\r\n",
                  unsigned(length), unsigned(repairedLength));
    jpeg = repairedJpeg;
    length = repairedLength;
  }
  dumpJpegHexOnce(jpeg, length);

  esp_jpeg_image_cfg_t infoConfig = {};
  infoConfig.indata = const_cast<uint8_t *>(jpeg);
  infoConfig.indata_size = uint32_t(length);
  infoConfig.out_format = JPEG_IMAGE_FORMAT_RGB565;
  infoConfig.out_scale = JPEG_DECODE_SCALE;

  esp_jpeg_image_output_t info = {};
  esp_err_t err = esp_jpeg_get_image_info(&infoConfig, &info);
  if (err != ESP_OK || info.width == 0 || info.height == 0 || info.output_len == 0) {
    Serial.printf("JPEG header decode failed: %s\r\n", esp_err_to_name(err));
    if (repairedJpeg != nullptr) free(repairedJpeg);
    return false;
  }

  uint8_t *rgb565 = allocateBytes(info.output_len);
  uint8_t *gray = allocateBytes(size_t(info.width) * info.height);
  uint8_t *workingBuffer = allocateInternalBytes(JPEG_WORKING_BUFFER_BYTES);
  if (rgb565 == nullptr || gray == nullptr || workingBuffer == nullptr) {
    Serial.printf("JPEG decode buffer alloc failed rgb=%u gray=%u work=%u\r\n",
                  unsigned(info.output_len),
                  unsigned(size_t(info.width) * info.height),
                  unsigned(JPEG_WORKING_BUFFER_BYTES));
    if (rgb565 != nullptr) free(rgb565);
    if (gray != nullptr) free(gray);
    if (workingBuffer != nullptr) free(workingBuffer);
    if (repairedJpeg != nullptr) free(repairedJpeg);
    return false;
  }

  esp_jpeg_image_cfg_t decodeConfig = infoConfig;
  decodeConfig.outbuf = rgb565;
  decodeConfig.outbuf_size = uint32_t(info.output_len);
  decodeConfig.advanced.working_buffer = workingBuffer;
  decodeConfig.advanced.working_buffer_size = JPEG_WORKING_BUFFER_BYTES;
  esp_jpeg_image_output_t decoded = {};
  err = esp_jpeg_decode(&decodeConfig, &decoded);
  if (err != ESP_OK) {
    Serial.printf("JPEG decode failed: %s\r\n", esp_err_to_name(err));
    free(rgb565);
    free(gray);
    free(workingBuffer);
    if (repairedJpeg != nullptr) free(repairedJpeg);
    return false;
  }

  const uint16_t *pixels = reinterpret_cast<const uint16_t *>(rgb565);
  const uint32_t pixelCount = uint32_t(decoded.width) * decoded.height;
  for (uint32_t i = 0; i < pixelCount; i++) {
    gray[i] = rgb565ToGray(pixels[i]);
  }

  Serial.printf("JPEG decoded %ux%u out=%u\r\n",
                unsigned(decoded.width), unsigned(decoded.height), unsigned(decoded.output_len));
  copyGrayCover(gray, decoded.width, decoded.height, decoded.width, target);
  free(rgb565);
  free(gray);
  free(workingBuffer);
  if (repairedJpeg != nullptr) free(repairedJpeg);
  return true;
}

static bool printAsciiFromJpeg(const uint8_t *jpeg, size_t length) {
  esp_jpeg_image_cfg_t infoConfig = {};
  infoConfig.indata = const_cast<uint8_t *>(jpeg);
  infoConfig.indata_size = uint32_t(length);
  infoConfig.out_format = JPEG_IMAGE_FORMAT_RGB565;
  infoConfig.out_scale = JPEG_DECODE_SCALE;

  esp_jpeg_image_output_t info = {};
  esp_err_t err = esp_jpeg_get_image_info(&infoConfig, &info);
  if (err != ESP_OK || info.width == 0 || info.height == 0 || info.output_len == 0) {
    Serial.printf("JPEG header decode failed: %s\r\n", esp_err_to_name(err));
    return false;
  }

  uint8_t *rgb565 = allocateBytes(info.output_len);
  uint8_t *gray = allocateBytes(size_t(info.width) * info.height);
  uint8_t *workingBuffer = allocateInternalBytes(JPEG_WORKING_BUFFER_BYTES);
  if (rgb565 == nullptr || gray == nullptr || workingBuffer == nullptr) {
    Serial.printf("JPEG decode buffer alloc failed rgb=%u gray=%u work=%u\r\n",
                  unsigned(info.output_len),
                  unsigned(size_t(info.width) * info.height),
                  unsigned(JPEG_WORKING_BUFFER_BYTES));
    if (rgb565 != nullptr) free(rgb565);
    if (gray != nullptr) free(gray);
    if (workingBuffer != nullptr) free(workingBuffer);
    return false;
  }

  esp_jpeg_image_cfg_t decodeConfig = infoConfig;
  decodeConfig.outbuf = rgb565;
  decodeConfig.outbuf_size = uint32_t(info.output_len);
  decodeConfig.advanced.working_buffer = workingBuffer;
  decodeConfig.advanced.working_buffer_size = JPEG_WORKING_BUFFER_BYTES;
  esp_jpeg_image_output_t decoded = {};
  err = esp_jpeg_decode(&decodeConfig, &decoded);
  if (err != ESP_OK) {
    Serial.printf("JPEG decode failed: %s\r\n", esp_err_to_name(err));
    free(rgb565);
    free(gray);
    free(workingBuffer);
    return false;
  }

  const uint16_t *pixels = reinterpret_cast<const uint16_t *>(rgb565);
  for (uint32_t i = 0; i < uint32_t(decoded.width) * decoded.height; i++) {
    const uint16_t p = pixels[i];
    const uint8_t r = uint8_t(((p >> 11) & 0x1f) * 255 / 31);
    const uint8_t g = uint8_t(((p >> 5) & 0x3f) * 255 / 63);
    const uint8_t b = uint8_t((p & 0x1f) * 255 / 31);
    gray[i] = uint8_t((uint16_t(r) * 30 + uint16_t(g) * 59 + uint16_t(b) * 11) / 100);
  }

  Serial.printf("JPEG decoded %ux%u out=%u\r\n",
                unsigned(decoded.width), unsigned(decoded.height), unsigned(decoded.output_len));
  printAsciiFromGray(gray, decoded.width, decoded.height, decoded.width);
  free(rgb565);
  free(gray);
  free(workingBuffer);
  return true;
}

static void onUvcFrame(uvc_frame_t *frame, void *user_ptr) {
  UvcCamera *camera = static_cast<UvcCamera *>(user_ptr);
  if (camera == nullptr) {
    camera = s_camera;
  }
  if (camera == nullptr || frame == nullptr || frame->data == nullptr) {
    return;
  }

  camera->copyFrame(
    frame->data,
    frame->data_bytes,
    frame->width,
    frame->height,
    int(frame->frame_format),
    frame->sequence
  );
}

static void onUsbStreamState(usb_stream_state_t event, void *userData) {
  (void)userData;
  s_streamConnected = event == STREAM_CONNECTED;
  Serial.printf("UVC stream state=%s\r\n", s_streamConnected ? "connected" : "disconnected");
}

bool UvcCamera::begin() {
  if (beginAsciiPreview()) {
    _ready = true;
    _lastError = "";
    return true;
  }

  _ready = ENABLE_TEST_PATTERN_CAPTURE;
  _lastError = _ready ? "" : "UVC backend not integrated";
  return _ready;
}

void UvcCamera::update() {
  if (_streamSuspended) return;
  printPendingAsciiPreview();
}

bool UvcCamera::ready() const {
  return _ready;
}

bool UvcCamera::asciiPreviewDone() const {
  return _previewPrinted;
}

bool UvcCamera::captureGrayscale(GrayscaleFrame &frame, uint16_t width, uint16_t height) {
  if (!frame.allocate(width, height)) {
    _lastError = "frame allocation failed";
    return false;
  }

  if (ENABLE_TEST_PATTERN_CAPTURE) {
    fillTestPattern(frame);
    return true;
  }

  const uint32_t startMs = millis();
  uint32_t attempts = 0;
  while (millis() - startMs < UVC_CAPTURE_TIMEOUT_MS) {
    s_snapshotReady = false;
    while (!s_snapshotReady && millis() - startMs < UVC_CAPTURE_TIMEOUT_MS) {
      update();
      delay(20);
    }

    if (!s_snapshotReady) {
      break;
    }

    attempts++;
    s_snapshotLocked = true;
    const bool decoded = decodeSnapshotToGrayscale(frame);
    s_snapshotLocked = false;
    if (decoded) {
      if (attempts > 1) {
        Serial.printf("UVC capture used decodable frame after %" PRIu32 " attempts\r\n", attempts);
      }
      return true;
    }
    Serial.printf("UVC frame decode failed, waiting for next frame attempt=%" PRIu32 "\r\n", attempts);
    update();
  }

  _lastError = attempts == 0 ? "UVC frame timeout" : "no decodable UVC frame";
  return false;
}

void UvcCamera::suspendStream() {
  if (!_streamStarted || _streamSuspended || s_usbStream == nullptr) return;
  Serial.println("UVC stream suspend for BLE print");
  s_usbStream->uvcCamSuspend(nullptr);
  _streamSuspended = true;
  delay(100);
}

void UvcCamera::resumeStream() {
  if (!_streamStarted || !_streamSuspended || s_usbStream == nullptr) return;
  Serial.println("UVC stream resume");
  s_usbStream->uvcCamResume(nullptr);
  _streamSuspended = false;
  delay(100);
}

const char *UvcCamera::lastError() const {
  return _lastError;
}

void UvcCamera::fillTestPattern(GrayscaleFrame &frame) {
  for (uint16_t y = 0; y < frame.height; y++) {
    for (uint16_t x = 0; x < frame.width; x++) {
      const uint8_t gradient = uint8_t((uint32_t(x) * 255) / max<uint16_t>(1, frame.width - 1));
      const bool stripe = ((x / 32) + (y / 32)) % 2 == 0;
      frame.pixels[size_t(y) * frame.width + x] = stripe ? gradient : uint8_t(255 - gradient);
    }
  }
}

bool UvcCamera::beginAsciiPreview() {
  if (_streamStarted) {
    return true;
  }

  const size_t bufferBytes = uvcBufferBytes();
  s_snapshotBuffer = allocateBytes(bufferBytes);
  s_uvcTransferA = allocateBytes(bufferBytes);
  s_uvcTransferB = allocateBytes(bufferBytes);
  s_uvcFrameBuffer = allocateBytes(bufferBytes);
  s_snapshotCapacity = bufferBytes;

  if (s_snapshotBuffer == nullptr || s_uvcTransferA == nullptr || s_uvcTransferB == nullptr || s_uvcFrameBuffer == nullptr) {
    _lastError = "UVC buffer allocation failed";
    return false;
  }

  Serial.printf("UVC buffers allocated %u bytes each for %s\r\n",
                unsigned(bufferBytes),
                CAMERA_PROFILE.name);
  s_camera = this;
  s_usbStream = new USB_STREAM();
  if (s_usbStream == nullptr) {
    _lastError = "USB_STREAM allocation failed";
    return false;
  }

  USBStreamUVCOptions options =
    USBStreamUVCOptionsForProfile(CAMERA_PROFILE, PRINT_UVC_PACKET_STATS);
  s_usbStream->uvcConfiguration(CAMERA_PROFILE.width,
                                CAMERA_PROFILE.height,
                                FPS2INTERVAL(CAMERA_PROFILE.fps),
                                bufferBytes,
                                s_uvcTransferA,
                                s_uvcTransferB,
                                bufferBytes,
                                s_uvcFrameBuffer,
                                options);
  s_usbStream->uvcCamRegisterCb(onUvcFrame, this);
  s_usbStream->registerState(onUsbStreamState, this);
  s_usbStream->start();
  s_usbStream->connectWait(10000);

  _streamStarted = true;
  _lastError = "";
  Serial.printf("UVC stream started, waiting for %ux%u frames\r\n",
                unsigned(CAMERA_PROFILE.width), unsigned(CAMERA_PROFILE.height));
  return true;
}

bool UvcCamera::decodeSnapshotToGrayscale(GrayscaleFrame &frame) {
  if (s_snapshotBuffer == nullptr || s_snapshotLength == 0 || s_snapshotWidth == 0 || s_snapshotHeight == 0) {
    _lastError = "UVC snapshot missing";
    return false;
  }

  Serial.printf(
    "UVC print frame seq=%" PRIu32 " format=%d width=%" PRIu32 " height=%" PRIu32 " bytes=%u\r\n",
    s_snapshotSequence,
    s_snapshotFormat,
    s_snapshotWidth,
    s_snapshotHeight,
    unsigned(s_snapshotLength)
  );

  if (s_snapshotFormat == UVC_FRAME_FORMAT_GRAY8 &&
      s_snapshotLength >= size_t(s_snapshotWidth) * s_snapshotHeight) {
    copyGrayCover(s_snapshotBuffer, s_snapshotWidth, s_snapshotHeight, s_snapshotWidth, frame);
    _lastError = "";
    return true;
  }

  if (s_snapshotFormat == UVC_FRAME_FORMAT_YUYV &&
      s_snapshotLength >= size_t(s_snapshotWidth) * s_snapshotHeight * 2) {
    uint8_t *gray = allocateBytes(size_t(s_snapshotWidth) * s_snapshotHeight);
    if (gray == nullptr) {
      _lastError = "YUYV gray buffer alloc failed";
      return false;
    }
    for (uint32_t y = 0; y < s_snapshotHeight; y++) {
      for (uint32_t x = 0; x < s_snapshotWidth; x++) {
        gray[size_t(y) * s_snapshotWidth + x] = s_snapshotBuffer[(size_t(y) * s_snapshotWidth + x) * 2];
      }
    }
    copyGrayCover(gray, s_snapshotWidth, s_snapshotHeight, s_snapshotWidth, frame);
    free(gray);
    _lastError = "";
    return true;
  }

  if (s_snapshotFormat == UVC_FRAME_FORMAT_MJPEG ||
      (s_snapshotLength >= 2 && s_snapshotBuffer[0] == 0xff && s_snapshotBuffer[1] == 0xd8)) {
    if (decodeJpegToGrayCover(s_snapshotBuffer, s_snapshotLength, frame)) {
      _lastError = "";
      return true;
    }
    _lastError = "JPEG decode failed";
    return false;
  }

  _lastError = "unsupported UVC frame format";
  return false;
}

bool UvcCamera::copyFrame(const void *data, size_t length, uint32_t width, uint32_t height, int format, uint32_t sequence) {
  if (s_snapshotLocked || data == nullptr || length == 0 || s_snapshotBuffer == nullptr || length > s_snapshotCapacity) {
    return false;
  }

  memcpy(s_snapshotBuffer, data, length);
  s_snapshotLength = length;
  s_snapshotWidth = width;
  s_snapshotHeight = height;
  s_snapshotFormat = format;
  s_snapshotSequence = sequence;
  s_snapshotReady = true;
  return true;
}

void UvcCamera::printPendingAsciiPreview() {
  if (!ENABLE_UVC_ASCII_PREVIEW) {
    return;
  }

  if (!s_snapshotReady || _previewPrinted) {
    return;
  }

  _previewPrinted = true;
  s_snapshotReady = false;
  Serial.printf(
    "UVC frame captured seq=%" PRIu32 " format=%d width=%" PRIu32 " height=%" PRIu32 " bytes=%u\r\n",
    s_snapshotSequence,
    s_snapshotFormat,
    s_snapshotWidth,
    s_snapshotHeight,
    unsigned(s_snapshotLength)
  );

  if (s_snapshotFormat == UVC_FRAME_FORMAT_GRAY8) {
    printAsciiFromGray(s_snapshotBuffer, s_snapshotWidth, s_snapshotHeight, s_snapshotWidth);
    return;
  }

  if (s_snapshotFormat == UVC_FRAME_FORMAT_YUYV && s_snapshotLength >= size_t(s_snapshotWidth) * s_snapshotHeight * 2) {
    uint8_t *gray = allocateBytes(size_t(s_snapshotWidth) * s_snapshotHeight);
    if (gray == nullptr) {
      Serial.println("YUYV gray buffer alloc failed");
      return;
    }
    for (uint32_t y = 0; y < s_snapshotHeight; y++) {
      for (uint32_t x = 0; x < s_snapshotWidth; x++) {
        gray[size_t(y) * s_snapshotWidth + x] = s_snapshotBuffer[(size_t(y) * s_snapshotWidth + x) * 2];
      }
    }
    printAsciiFromGray(gray, s_snapshotWidth, s_snapshotHeight, s_snapshotWidth);
    free(gray);
    return;
  }

  if (s_snapshotFormat == UVC_FRAME_FORMAT_MJPEG || (s_snapshotLength >= 2 && s_snapshotBuffer[0] == 0xff && s_snapshotBuffer[1] == 0xd8)) {
    if (printAsciiFromJpeg(s_snapshotBuffer, s_snapshotLength)) {
      return;
    }
  }

  Serial.println("No ASCII converter for this UVC frame format yet");
}
