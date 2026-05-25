#include <Arduino.h>
#include "USB_STREAM.h"

static USB_STREAM usb;
static volatile uint32_t frameCount = 0;
static volatile uint32_t lastFrameBytes = 0;
static uint32_t lastReportMs = 0;

static constexpr USBStreamUVCKnownCameraProfile CAMERA_PROFILE =
  USBSTREAM_UVC_LOGITECH_046D_0821_640X480_MJPEG;
static constexpr bool PRINT_UVC_PACKET_STATS = true;

static uint8_t *allocBuffer(size_t bytes, const char *name) {
  uint8_t *ptr = (uint8_t *)ps_malloc(bytes);
  if (!ptr) {
    ptr = (uint8_t *)malloc(bytes);
  }
  Serial.printf("%s=%p size=%u\n", name, ptr, (unsigned)bytes);
  assert(ptr);
  return ptr;
}

static void onCameraFrame(uvc_frame_t *frame, void *userPtr) {
  (void)userPtr;
  frameCount++;
  lastFrameBytes = frame->data_bytes;
  if (frameCount <= 10 || (frameCount % 30) == 0) {
    Serial.printf("uvc frame #%lu format=%d seq=%lu %lux%lu bytes=%u data=%p\n",
                  (unsigned long)frameCount,
                  frame->frame_format,
                  (unsigned long)frame->sequence,
                  (unsigned long)frame->width,
                  (unsigned long)frame->height,
                  (unsigned)frame->data_bytes,
                  frame->data);
  }
}

static void onStreamState(usb_stream_state_t event, void *userData) {
  (void)userData;
  Serial.printf("usb stream state=%s\n", event == STREAM_CONNECTED ? "connected" : "disconnected");
}

static void waitForStartCommand() {
  Serial.println("send 'g' to start USB stream");
  while (true) {
    while (Serial.available() > 0) {
      const int ch = Serial.read();
      if (ch == 'g' || ch == 'G') {
        Serial.println("start command received");
        return;
      }
    }
    delay(20);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.printf("ESP32_USB_STREAM UVC smoke: %s\n", CAMERA_PROFILE.name);
  Serial.printf("free heap=%u psram=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());

  uint8_t *xferA = allocBuffer(CAMERA_PROFILE.bufferSize, "xferA");
  uint8_t *xferB = allocBuffer(CAMERA_PROFILE.bufferSize, "xferB");
  uint8_t *frameBuffer = allocBuffer(CAMERA_PROFILE.bufferSize, "frameBuffer");

  USBStreamUVCOptions uvcOptions =
    USBStreamUVCOptionsForProfile(CAMERA_PROFILE, PRINT_UVC_PACKET_STATS);

  usb.uvcConfiguration(CAMERA_PROFILE.width,
                       CAMERA_PROFILE.height,
                       FPS2INTERVAL(CAMERA_PROFILE.fps),
                       CAMERA_PROFILE.bufferSize,
                       xferA,
                       xferB,
                       CAMERA_PROFILE.bufferSize,
                       frameBuffer,
                       uvcOptions);
  usb.uvcCamRegisterCb(onCameraFrame, nullptr);
  usb.registerState(onStreamState, nullptr);

  waitForStartCommand();

  Serial.println("starting usb stream");
  usb.start();
  Serial.println("waiting for camera connect");
  usb.connectWait(10000);
  Serial.println("connect wait returned");
}

void loop() {
  const uint32_t now = millis();
  if (now - lastReportMs >= 1000) {
    lastReportMs = now;
    Serial.printf("status frames=%lu lastBytes=%lu free=%u psram=%u\n",
                  (unsigned long)frameCount,
                  (unsigned long)lastFrameBytes,
                  ESP.getFreeHeap(),
                  ESP.getFreePsram());
  }
  delay(20);
}
