#pragma once

// Keep this shim intentionally tiny. The copied ESP-IDF USB host files include
// "sdkconfig.h" from their own directory first, so this file can override only
// the USB host settings that matter while delegating the rest to Arduino's
// generated sdkconfig.
#include_next "sdkconfig.h"

#undef CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE
#define CONFIG_USB_HOST_CONTROL_TRANSFER_MAX_SIZE 4096
