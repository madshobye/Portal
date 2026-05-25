#include "Config.h"
#include "ButtonInput.h"
#include "UvcCamera.h"
#include "TsplBitmap.h"
#include "BleTsplPrinter.h"

ButtonInput captureButton(CAPTURE_BUTTON_PIN, BUTTON_HOLD_DEBOUNCE_MS);
UvcCamera camera;
BleTsplPrinter printer;

static bool jobRunning = false;
static bool autoPrintStarted = false;
static bool autoPrintDone = false;
static uint32_t bootAtMs = 0;

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

static void waitForStartCommand() {
  if (!WAIT_FOR_SERIAL_START_COMMAND) return;

  Serial.println("send 'g' to start LabelCam");
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

static void runCapturePrintJob() {
  if (jobRunning) return;
  jobRunning = true;

  Serial.println("LabelCam job start");
  logHeap("job start");

  if (ENABLE_TINY_TSPL_SANITY_PRINT) {
    static const char tinyHeader[] =
      "SIZE 150 mm,100 mm\r\n"
      "GAP 2 mm,0 mm\r\n"
      "DIRECTION 1\r\n"
      "DENSITY 6\r\n"
      "CLS\r\n"
      "BITMAP 20,20,8,64,0,";
    static const char tinyFooter[] = "\r\nPRINT 1,1\r\n";
    uint8_t tinyTspl[sizeof(tinyHeader) - 1 + 8 * 64 + sizeof(tinyFooter) - 1];
    size_t pos = 0;
    memcpy(tinyTspl + pos, tinyHeader, sizeof(tinyHeader) - 1);
    pos += sizeof(tinyHeader) - 1;
    for (uint16_t y = 0; y < 64; y++) {
      for (uint16_t xByte = 0; xByte < 8; xByte++) {
        const bool border = y < 4 || y >= 60 || xByte == 0 || xByte == 7;
        tinyTspl[pos++] = border ? 0x00 : ((y / 8 + xByte) % 2 == 0 ? 0xaa : 0x55);
      }
    }
    memcpy(tinyTspl + pos, tinyFooter, sizeof(tinyFooter) - 1);
    pos += sizeof(tinyFooter) - 1;
    Serial.printf("Tiny BITMAP TSPL bytes=%u\r\n", unsigned(pos));
    const bool ok = printer.write(tinyTspl, pos);
    if (!ok) {
      Serial.printf("Tiny BLE print failed: %s\r\n", printer.lastError());
    } else {
      Serial.println("Tiny LabelCam job sent");
    }
    logHeap("job end");
    jobRunning = false;
    return;
  }

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

  camera.suspendStream();
  ok = printer.write(tspl.data, tspl.length);
  camera.resumeStream();
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
  const uint32_t serialWaitStart = millis();
  while (!Serial && millis() - serialWaitStart < 3000) {
    delay(10);
  }
  Serial.println("serial open");
  Serial.setDebugOutput(true);
  delay(300);

  Serial.println();
  Serial.println("USB UVC to BLE LabelCam skeleton");
  logHeap("boot");
  waitForStartCommand();

  captureButton.begin();
  printer.begin();
  if (camera.begin()) {
    Serial.println("Camera backend ready");
  } else {
    Serial.printf("Camera backend not ready: %s\r\n", camera.lastError());
  }
  Serial.printf("Press GPIO %u to capture and BLE print\r\n", CAPTURE_BUTTON_PIN);
  if (ENABLE_AUTO_BLE_TEST_PRINT) {
    Serial.printf("Auto BLE test print starts in %u ms\r\n", unsigned(AUTO_PRINT_DELAY_MS));
  }
  bootAtMs = millis();
}

void loop() {
  camera.update();

  if (ENABLE_AUTO_BLE_TEST_PRINT && !autoPrintStarted) {
    if (millis() - bootAtMs < AUTO_PRINT_DELAY_MS) {
      delay(20);
      return;
    }
    autoPrintStarted = true;
    Serial.println("LabelCam auto capture + BLE print");
    runCapturePrintJob();
    autoPrintDone = true;
  }

  if (captureButton.pressed()) {
    runCapturePrintJob();
  }
  if (autoPrintDone) {
    delay(1000);
    return;
  }
  delay(5);
}
