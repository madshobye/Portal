#include "Config.h"
#include "ButtonInput.h"
#include "UvcCamera.h"
#include "TsplBitmap.h"
#include "BleTsplPrinter.h"

ButtonInput captureButton(CAPTURE_BUTTON_PIN, BUTTON_HOLD_DEBOUNCE_MS);
UvcCamera camera;
BleTsplPrinter printer;

static bool jobRunning = false;

static void logHeap(const char *label) {
  Serial.printf(
    "LabelCam heap %-18s free=%u min=%u maxAlloc=%u psram=%u\r\n",
    label,
    unsigned(ESP.getFreeHeap()),
    unsigned(ESP.getMinFreeHeap()),
    unsigned(ESP.getMaxAllocHeap()),
    unsigned(ESP.getFreePsram())
  );
}

static void runCapturePrintJob() {
  if (jobRunning) return;
  jobRunning = true;

  Serial.println("LabelCam job start");
  logHeap("job start");

  GrayscaleFrame frame;
  TsplBuffer tspl;
  bool ok = camera.captureGrayscale(frame, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS);
  if (!ok) {
    Serial.printf("Capture failed: %s\r\n", camera.lastError());
    frame.release();
    jobRunning = false;
    return;
  }
  logHeap("captured");

  ok = makeTsplBitmapLabel(frame, tspl);
  frame.release();
  if (!ok) {
    Serial.println("TSPL encode failed");
    tspl.release();
    jobRunning = false;
    return;
  }
  Serial.printf("TSPL bytes=%u\r\n", unsigned(tspl.length));
  logHeap("encoded");

  ok = printer.write(tspl.data, tspl.length);
  tspl.release();
  if (!ok) {
    Serial.printf("BLE print failed: %s\r\n", printer.lastError());
  } else {
    Serial.println("LabelCam job sent");
  }
  logHeap("job end");
  jobRunning = false;
}

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  delay(300);

  Serial.println();
  Serial.println("USB UVC to BLE LabelCam skeleton");
  logHeap("boot");

  captureButton.begin();
  printer.begin();
  if (camera.begin()) {
    Serial.println("Camera backend ready");
  } else {
    Serial.printf("Camera backend not ready: %s\r\n", camera.lastError());
  }
  Serial.printf("Press GPIO %u to capture and BLE print\r\n", CAPTURE_BUTTON_PIN);
}

void loop() {
  if (captureButton.pressed()) {
    runCapturePrintJob();
  }
  delay(5);
}

