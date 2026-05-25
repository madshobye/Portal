# ESP32 UVC Host

Arduino library wrapper around Espressif's `usb_host_uvc` component for ESP32-S2/S3 USB host projects.

This library vendors the Espressif USB Host UVC adapter and libuvc sources so the Arduino sketch can use the current ESP-IDF USB Host path instead of the older `ESP32_USB_STREAM` raw-HCD path.

Original component:
https://components.espressif.com/components/espressif/usb_host_uvc

The vendored code keeps Espressif/libuvc license headers in the source files.
