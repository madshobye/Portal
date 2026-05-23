#ifndef USRSCTP_ARDUINO_CONFIG_H_
#define USRSCTP_ARDUINO_CONFIG_H_

// Match the compile definitions used by sepfy__usrsctp's ESP-IDF component.
#ifndef ESP32
#define ESP32 1
#endif

#ifndef HTTP_DO_NOT_USE_CUSTOM_CONFIG
#define HTTP_DO_NOT_USE_CUSTOM_CONFIG 1
#endif

#ifndef MQTT_DO_NOT_USE_CUSTOM_CONFIG
#define MQTT_DO_NOT_USE_CUSTOM_CONFIG 1
#endif

#ifndef HAVE_SIN_LEN
#define HAVE_SIN_LEN 1
#endif

#ifndef HAVE_SA_LEN
#define HAVE_SA_LEN 1
#endif

#ifndef HAVE_SCONN_LEN
#define HAVE_SCONN_LEN 1
#endif

#ifndef IPPORT_RESERVED
#define IPPORT_RESERVED 1024
#endif

#ifndef UIO_MAXIOV
#define UIO_MAXIOV 1024
#endif

#ifndef __linux__
#define __linux__ 1
#endif

#ifndef __Userspace__
#define __Userspace__ 1
#endif

#ifndef SCTP_PROCESS_LEVEL_LOCKS
#define SCTP_PROCESS_LEVEL_LOCKS 1
#endif

#ifndef SCTP_SIMPLE_ALLOCATOR
#define SCTP_SIMPLE_ALLOCATOR 1
#endif

#endif  // USRSCTP_ARDUINO_CONFIG_H_
